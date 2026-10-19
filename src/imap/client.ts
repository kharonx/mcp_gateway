import dns from "node:dns/promises";
import net from "node:net";
import { ImapFlow, type FetchMessageObject, type MessageAddressObject, type SearchObject } from "imapflow";
import { simpleParser, type AddressObject } from "mailparser";
import { extractContent } from "../content/extract.js";
import type { ImapAccountInput, ImapCredentials, ImapSecurity } from "./store.js";

/**
 * IMAP access for the user's linked mailboxes: one short-lived connection per
 * tool call (no pooling, no IDLE). Read tools open folders read-only (EXAMINE)
 * and fetch with BODY.PEEK, so reading never sets \Seen; only setSeen opens a
 * folder read-write.
 *
 * The host is chosen by the user, so every connection is SSRF-guarded: the name
 * is resolved once, private/loopback/link-local targets are refused, and the
 * socket goes to that vetted address (TLS still verifies the certificate against
 * the hostname). Only 993 (implicit TLS) and 143 (mandatory STARTTLS) are allowed.
 */

export const IMAP_PORTS: Record<ImapSecurity, number> = { tls: 993, starttls: 143 };
const MAX_BODY_CHARS = 50_000;

const blocked = new net.BlockList();
for (const [a, p] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(a, p, "ipv4");
for (const [a, p] of [["::", 127], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["64:ff9b::", 96]] as const) blocked.addSubnet(a, p, "ipv6");

function isBlockedAddress(addr: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(addr);
  if (mapped) return blocked.check(mapped[1], "ipv4");
  return blocked.check(addr, net.isIPv6(addr) ? "ipv6" : "ipv4");
}

export function normalizeHost(raw: string): string {
  const host = raw.trim().toLowerCase().replace(/\.$/, "");
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host)) {
    throw new Error(`Érvénytelen IMAP-szerver: "${raw}" (pl. imap.gmail.com vagy mail.cegnev.hu).`);
  }
  return host;
}

async function vettedAddress(host: string): Promise<string> {
  const addrs = await dns.lookup(host, { all: true }).catch(() => {
    throw new Error(`Az IMAP-szerver neve nem oldható fel: ${host}`);
  });
  if (!addrs.length || addrs.some((a) => isBlockedAddress(a.address))) {
    throw new Error(`Az IMAP-szerver (${host}) belső hálózati címre mutat - ilyen szerverhez a gateway nem csatlakozik.`);
  }
  return addrs[0].address;
}

type Conn = Pick<ImapCredentials, "host" | "port" | "security" | "username" | "password">;

async function withImap<T>(acc: Conn, fn: (client: ImapFlow) => Promise<T>): Promise<T> {
  if (IMAP_PORTS[acc.security] !== acc.port) throw new Error("Only port 993 (TLS) and 143 (STARTTLS) are allowed for IMAP.");
  const address = await vettedAddress(acc.host);
  const client = new ImapFlow({
    host: address,
    servername: acc.host,
    port: acc.port,
    secure: acc.security === "tls",
    doSTARTTLS: acc.security === "starttls" ? true : undefined,
    tls: { servername: acc.host, rejectUnauthorized: true },
    auth: { user: acc.username, pass: acc.password },
    logger: false,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
    disableAutoIdle: true,
  });
  client.on("error", () => {
    /* surfaced through the pending command; keeps the process alive */
  });
  try {
    await client.connect();
  } catch (err: any) {
    const why = err?.authenticationFailed
      ? "a felhasználónév vagy a jelszó hibás (Gmailnél alkalmazásjelszó kell)"
      : err?.responseText || err?.message || String(err);
    throw new Error(`IMAP-csatlakozás sikertelen (${acc.host}:${acc.port}): ${why}`);
  }
  try {
    return await fn(client);
  } finally {
    await client.logout().catch(() => client.close());
  }
}

/** Portal: test the login before anything is stored. */
export async function verifyLogin(input: ImapAccountInput): Promise<{ folders: number }> {
  return withImap(input, async (c) => ({ folders: (await c.list()).length }));
}

// ── message ids: folder + UIDVALIDITY + UID, opaque to the AI client ──────

export function encodeMessageId(folder: string, uidValidity: bigint | number | string, uid: number): string {
  return Buffer.from(JSON.stringify([folder, String(uidValidity), uid])).toString("base64url");
}

function decodeMessageId(id: string): { folder: string; uidValidity: string; uid: number } {
  try {
    const [folder, uidValidity, uid] = JSON.parse(Buffer.from(id, "base64url").toString("utf8"));
    if (typeof folder === "string" && typeof uidValidity === "string" && Number.isInteger(uid)) return { folder, uidValidity, uid };
  } catch {
    /* fall through */
  }
  throw new Error("Invalid messageId - use a messageId returned by list-imap-messages.");
}

function checkValidity(c: ImapFlow, expected: string): void {
  const now = c.mailbox ? String(c.mailbox.uidValidity) : "";
  if (now !== expected) {
    throw new Error("The folder was rebuilt on the server (UIDVALIDITY changed), the messageId is stale - list the messages again.");
  }
}

const addr = (list?: MessageAddressObject[]) => (list ?? []).map((a) => (a.name ? `${a.name} <${a.address}>` : a.address ?? "")).filter(Boolean);
const parsedAddr = (a?: AddressObject | AddressObject[]) => (Array.isArray(a) ? a : a ? [a] : []).flatMap((x) => x.value.map((v) => (v.name ? `${v.name} <${v.address}>` : v.address ?? "")));

function isoDate(d?: Date | string): string | undefined {
  const t = d ? new Date(d) : undefined;
  return t && !isNaN(t.getTime()) ? t.toISOString() : undefined;
}

function hasAttachments(node: any): boolean {
  if (!node) return false;
  if (node.disposition === "attachment") return true;
  return Array.isArray(node.childNodes) && node.childNodes.some(hasAttachments);
}

// ── operations ────────────────────────────────────────────────────────────

export async function listFolders(acc: Conn) {
  return withImap(acc, async (c) => {
    const list = await c.list({ statusQuery: { messages: true, unseen: true } });
    return list.map((f) => ({
      path: f.path,
      name: f.name,
      ...(f.specialUse ? { specialUse: f.specialUse } : {}),
      ...(f.status ? { messages: f.status.messages, unseen: f.status.unseen } : {}),
    }));
  });
}

export interface MessageFilters {
  folder: string;
  from?: string;
  to?: string;
  subject?: string;
  text?: string;
  since?: string;
  before?: string;
  unreadOnly?: boolean;
  maxItems: number;
  cursor?: string;
}

export async function listMessages(acc: Conn, f: MessageFilters) {
  return withImap(acc, async (c) => {
    const lock = await c.getMailboxLock(f.folder, { readOnly: true });
    try {
      const validity = String((c.mailbox as any).uidValidity);
      let beforeUid: number | undefined;
      if (f.cursor) {
        const [v, u] = f.cursor.split(":");
        if (v !== validity || !/^\d+$/.test(u ?? "")) throw new Error("cursor is stale or invalid - list the messages again without cursor.");
        beforeUid = Number(u);
      }
      const q: SearchObject = {};
      if (f.from) q.from = f.from;
      if (f.to) q.to = f.to;
      if (f.subject) q.subject = f.subject;
      if (f.text) q.text = f.text;
      if (f.since) q.since = f.since;
      if (f.before) q.before = f.before;
      if (f.unreadOnly) q.seen = false;
      if (beforeUid !== undefined && beforeUid > 1) q.uid = `1:${beforeUid - 1}`;
      if (!Object.keys(q).length) q.all = true;
      const uids = beforeUid !== undefined && beforeUid <= 1 ? [] : (await c.search(q, { uid: true })) || [];
      uids.sort((a, b) => b - a);
      const page = uids.slice(0, f.maxItems);
      const msgs: FetchMessageObject[] = page.length
        ? await c.fetchAll(page.join(","), { uid: true, envelope: true, flags: true, internalDate: true, size: true, bodyStructure: true }, { uid: true })
        : [];
      msgs.sort((a, b) => b.uid - a.uid);
      const truncated = uids.length > page.length;
      return {
        folder: f.folder,
        count: msgs.length,
        totalMatches: uids.length,
        truncated,
        ...(truncated ? { note: "More messages match. Call again with cursor=nextCursor.", nextCursor: `${validity}:${page[page.length - 1]}` } : {}),
        items: msgs.map((m) => ({
          messageId: encodeMessageId(f.folder, validity, m.uid),
          subject: m.envelope?.subject,
          from: addr(m.envelope?.from),
          to: addr(m.envelope?.to),
          date: isoDate(m.envelope?.date ?? m.internalDate),
          isRead: m.flags?.has("\\Seen") ?? false,
          flagged: m.flags?.has("\\Flagged") ?? false,
          hasAttachments: hasAttachments(m.bodyStructure),
          sizeBytes: m.size,
        })),
      };
    } finally {
      lock.release();
    }
  });
}

async function fetchParsed(c: ImapFlow, messageId: string, maxBytes: number) {
  const { folder, uidValidity, uid } = decodeMessageId(messageId);
  const lock = await c.getMailboxLock(folder, { readOnly: true });
  try {
    checkValidity(c, uidValidity);
    const m = await c.fetchOne(String(uid), { uid: true, flags: true, size: true, source: { maxLength: maxBytes } }, { uid: true });
    if (!m || !m.source) throw new Error("The message no longer exists in this folder.");
    const parsed = await simpleParser(m.source);
    return { folder, m, parsed, sourceTruncated: (m.size ?? 0) > maxBytes };
  } finally {
    lock.release();
  }
}

export async function getMessage(acc: Conn, messageId: string, maxBytes: number) {
  return withImap(acc, async (c) => {
    const { folder, m, parsed, sourceTruncated } = await fetchParsed(c, messageId, maxBytes);
    let body = parsed.text ?? (typeof parsed.html === "string" ? parsed.html.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "");
    const bodyTruncated = body.length > MAX_BODY_CHARS;
    if (bodyTruncated) body = body.slice(0, MAX_BODY_CHARS);
    return {
      messageId,
      folder,
      subject: parsed.subject,
      from: parsedAddr(parsed.from),
      to: parsedAddr(parsed.to),
      cc: parsedAddr(parsed.cc),
      replyTo: parsedAddr(parsed.replyTo),
      date: parsed.date?.toISOString(),
      internetMessageId: parsed.messageId,
      isRead: m.flags?.has("\\Seen") ?? false,
      body,
      ...(bodyTruncated || sourceTruncated
        ? { truncated: true, note: sourceTruncated ? "Message exceeds MAX_DOWNLOAD_BYTES; only its beginning was read." : `Body truncated to ${MAX_BODY_CHARS} characters.` }
        : {}),
      attachments: parsed.attachments
        .filter((a) => a.contentDisposition !== "inline" || a.filename)
        .map((a, index) => ({ index, fileName: a.filename, contentType: a.contentType, sizeBytes: a.size })),
    };
  });
}

export async function getAttachment(acc: Conn, messageId: string, index: number, maxBytes: number) {
  return withImap(acc, async (c) => {
    const { parsed, sourceTruncated } = await fetchParsed(c, messageId, maxBytes);
    const list = parsed.attachments.filter((a) => a.contentDisposition !== "inline" || a.filename);
    const a = list[index];
    if (!a) {
      throw new Error(
        sourceTruncated
          ? "Attachment not found - the message exceeds MAX_DOWNLOAD_BYTES, so its later attachments cannot be read."
          : `No attachment with index ${index} (the message has ${list.length}).`
      );
    }
    return extractContent(a.content, a.contentType, a.filename);
  });
}

export async function setSeen(acc: Conn, messageId: string, seen: boolean) {
  return withImap(acc, async (c) => {
    const { folder, uidValidity, uid } = decodeMessageId(messageId);
    const lock = await c.getMailboxLock(folder);
    try {
      checkValidity(c, uidValidity);
      const ok = seen
        ? await c.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true })
        : await c.messageFlagsRemove(String(uid), ["\\Seen"], { uid: true });
      if (!ok) throw new Error("The server refused to change the read flag.");
      return { messageId, folder, isRead: seen };
    } finally {
      lock.release();
    }
  });
}
