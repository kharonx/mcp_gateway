import { z } from "zod";
import type { ToolContext } from "../types.js";

/**
 * Attachments for the compose tools (create-draft-email, send-mail and the
 * shared-mailbox variants). Sources: a OneDrive/SharePoint file (the gateway
 * downloads it with the caller's token, so the bytes never pass through the
 * AI), plain text written by the AI (CSV, TXT, ...) or base64 content.
 *
 * Graph limits: a JSON request is capped at 4 MB, so small files go inline as
 * fileAttachment; anything bigger is added to a draft via an upload session
 * (up to 150 MB per file) and the draft is sent afterwards.
 */

/** Inline budget for all fileAttachments of one request (base64 grows ~33%, Graph caps the request at 4 MB). */
const INLINE_TOTAL_BYTES = 2_900_000;
/** Whole message cap - Exchange Online's default send limit is 35 MB, keep a margin. */
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;
/** Upload-session chunk: must be a multiple of 320 KiB and below 4 MB. */
const CHUNK_BYTES = 320 * 1024 * 10;

export const attachmentInput = z
  .array(
    z.object({
      name: z
        .string()
        .optional()
        .describe("File name shown in the email, e.g. riport.csv. Required for text/contentBase64; defaults to the file's own name for itemId."),
      itemId: z.string().optional().describe("OneDrive/SharePoint driveItem id to attach (the gateway downloads it)"),
      driveId: z.string().optional().describe("Drive id of itemId (SharePoint library); omit for the user's own OneDrive"),
      text: z.string().optional().describe("Plain-text file content written by you (CSV, TXT, MD, JSON, ...). CSV gets a UTF-8 BOM so Excel shows accents."),
      contentBase64: z.string().optional().describe("Binary file content as base64"),
      contentType: z.string().optional().describe("MIME type (guessed from the name when omitted)"),
    })
  )
  .max(20)
  .optional()
  .describe(
    "Files to attach. Each item has exactly ONE source: itemId (+driveId) for a OneDrive/SharePoint file, text for content you wrote, or contentBase64. Max 25 MB per message."
  );

interface ResolvedAttachment {
  name: string;
  contentType: string;
  bytes: Buffer;
}

const MIME: Record<string, string> = {
  csv: "text/csv",
  txt: "text/plain",
  md: "text/markdown",
  json: "application/json",
  html: "text/html",
  htm: "text/html",
  xml: "application/xml",
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  zip: "application/zip",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  doc: "application/msword",
  xls: "application/vnd.ms-excel",
};

function guessType(name: string, fallback = "application/octet-stream"): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return MIME[ext] ?? fallback;
}

async function resolveOne(a: Record<string, any>, ctx: ToolContext): Promise<ResolvedAttachment> {
  const sources = [a.itemId, a.text, a.contentBase64].filter((v) => v !== undefined && v !== "").length;
  if (sources !== 1) throw new Error("Each attachment needs exactly one source: itemId, text or contentBase64.");

  if (a.itemId) {
    const base = a.driveId
      ? `/drives/${encodeURIComponent(a.driveId)}/items/${encodeURIComponent(a.itemId)}`
      : `/me/drive/items/${encodeURIComponent(a.itemId)}`;
    const meta = (await ctx.graph.request("GET", base, { query: { $select: "name,size,file,folder" } })) as any;
    if (meta?.folder) throw new Error(`"${meta.name}" is a folder - only files can be attached.`);
    if (Number(meta?.size) > MAX_TOTAL_BYTES) throw new Error(`"${meta.name}" is ${Math.round(meta.size / 1048576)} MB - too big to attach (max 25 MB). Share a link instead.`);
    const bin = await ctx.graph.requestBinary(`${base}/content`, { maxBytes: MAX_TOTAL_BYTES + 1 });
    const name = a.name || meta?.name || "attachment";
    return { name, contentType: a.contentType || meta?.file?.mimeType || guessType(name, bin.contentType), bytes: bin.buffer };
  }

  if (!a.name) throw new Error("name is required for text / contentBase64 attachments.");
  if (a.text !== undefined) {
    const isCsv = /\.csv$/i.test(a.name);
    const text = isCsv && !String(a.text).startsWith("﻿") ? "﻿" + a.text : String(a.text);
    const type = a.contentType || guessType(a.name, "text/plain");
    return { name: a.name, contentType: type.includes("charset") || !type.startsWith("text/") ? type : `${type}; charset=utf-8`, bytes: Buffer.from(text, "utf8") };
  }
  const bytes = Buffer.from(String(a.contentBase64), "base64");
  if (!bytes.length) throw new Error(`contentBase64 of "${a.name}" is empty or not valid base64.`);
  return { name: a.name, contentType: a.contentType || guessType(a.name), bytes };
}

export async function resolveAttachments(list: unknown, ctx: ToolContext): Promise<ResolvedAttachment[]> {
  if (!Array.isArray(list) || !list.length) return [];
  const out: ResolvedAttachment[] = [];
  for (const a of list) out.push(await resolveOne(a as Record<string, any>, ctx));
  const total = out.reduce((n, a) => n + a.bytes.length, 0);
  if (total > MAX_TOTAL_BYTES) {
    throw new Error(`Attachments total ${Math.round(total / 1048576)} MB - over the 25 MB per-message limit. Share a link instead.`);
  }
  return out;
}

const asFileAttachment = (a: ResolvedAttachment) => ({
  "@odata.type": "#microsoft.graph.fileAttachment",
  name: a.name,
  contentType: a.contentType,
  contentBytes: a.bytes.toString("base64"),
});

/** Split into the ones that fit inline in one JSON request and the ones that need an upload session. */
function partition(list: ResolvedAttachment[]): { inline: ResolvedAttachment[]; large: ResolvedAttachment[] } {
  const inline: ResolvedAttachment[] = [];
  const large: ResolvedAttachment[] = [];
  let used = 0;
  for (const a of [...list].sort((x, y) => x.bytes.length - y.bytes.length)) {
    if (used + a.bytes.length <= INLINE_TOTAL_BYTES) {
      inline.push(a);
      used += a.bytes.length;
    } else large.push(a);
  }
  return { inline, large };
}

async function uploadLarge(ctx: ToolContext, messagePath: string, a: ResolvedAttachment): Promise<void> {
  const session = (await ctx.graph.request("POST", `${messagePath}/attachments/createUploadSession`, {
    body: { AttachmentItem: { attachmentType: "file", name: a.name, size: a.bytes.length, contentType: a.contentType } },
  })) as { uploadUrl?: string };
  if (!session?.uploadUrl) throw new Error(`Graph did not return an upload URL for "${a.name}".`);
  // The upload URL is pre-authenticated: no Authorization header (Graph rejects it).
  for (let start = 0; start < a.bytes.length; start += CHUNK_BYTES) {
    const chunk = a.bytes.subarray(start, Math.min(start + CHUNK_BYTES, a.bytes.length));
    const res = await fetch(session.uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(chunk.length),
        "Content-Range": `bytes ${start}-${start + chunk.length - 1}/${a.bytes.length}`,
      },
      body: new Uint8Array(chunk),
    });
    if (!res.ok) throw new Error(`Uploading "${a.name}" failed at byte ${start}: HTTP ${res.status} ${await res.text().catch(() => "")}`.trim());
  }
}

const summary = (list: ResolvedAttachment[]) => list.map((a) => ({ name: a.name, sizeBytes: a.bytes.length, contentType: a.contentType }));

/**
 * Compose with attachments. mailboxBase = "/me" or "/users/{mailbox}".
 * send=false: creates a draft and returns it. send=true: sends (inline via
 * sendMail when everything fits, otherwise draft + upload sessions + send).
 */
export async function composeWithAttachments(
  ctx: ToolContext,
  mailboxBase: string,
  message: Record<string, unknown>,
  attachments: ResolvedAttachment[],
  opts: { send: boolean; saveToSentItems?: boolean }
): Promise<unknown> {
  const { inline, large } = partition(attachments);
  const withInline = { ...message, ...(inline.length ? { attachments: inline.map(asFileAttachment) } : {}) };

  if (opts.send && !large.length) {
    const r = await ctx.graph.request("POST", `${mailboxBase}/sendMail`, {
      body: { message: withInline, saveToSentItems: opts.saveToSentItems ?? true },
    });
    return { ...(r as object), sent: true, attachments: summary(attachments) };
  }

  const draft = (await ctx.graph.request("POST", `${mailboxBase}/messages`, { body: withInline })) as any;
  const messagePath = `${mailboxBase}/messages/${encodeURIComponent(draft.id)}`;
  for (const a of large) await uploadLarge(ctx, messagePath, a);

  if (!opts.send) {
    return { id: draft.id, webLink: draft.webLink, subject: draft.subject, isDraft: true, attachments: summary(attachments) };
  }
  // A draft is saved in Sent Items on send; saveToSentItems=false is not available on this path.
  await ctx.graph.request("POST", `${messagePath}/send`, { body: {} });
  return { id: draft.id, sent: true, attachments: summary(attachments) };
}
