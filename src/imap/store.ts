import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Optional IMAP mailboxes - each Microsoft 365 user links their OWN external
 * mailboxes (hosting provider, Gmail app password, ...) on the portal. Stored
 * per Entra object id in data/imap-accounts.json; the password is encrypted
 * with AES-256-GCM under IMAP_ENCRYPTION_KEY (env only), so the data volume
 * alone does not reveal it. Credentials never pass through an MCP tool.
 */

export type ImapSecurity = "tls" | "starttls";

export interface ImapAccountInput {
  label?: string;
  email?: string;
  host: string;
  port: number;
  security: ImapSecurity;
  username: string;
  password: string;
}

/** Everything about an account except the password (safe for UI, tools and audit). */
export interface ImapAccountInfo {
  id: string;
  label: string;
  email?: string;
  host: string;
  port: number;
  security: ImapSecurity;
  username: string;
  connectedAt: string;
}

interface StoredAccount extends ImapAccountInfo {
  oid: string;
  /** base64(iv | tag | ciphertext) */
  secret: string;
}

export interface ImapCredentials extends ImapAccountInfo {
  password: string;
}

export const MAX_ACCOUNTS_PER_USER = 10;

export class ImapStore {
  private accounts: StoredAccount[] = [];
  private file: string;

  constructor(private getKey: () => string, dataDir: string) {
    this.file = path.join(dataDir, "imap-accounts.json");
    fs.mkdirSync(dataDir, { recursive: true });
    if (fs.existsSync(this.file)) {
      try {
        this.accounts = JSON.parse(fs.readFileSync(this.file, "utf8")) as StoredAccount[];
      } catch {
        /* corrupted store - start empty */
      }
    }
  }

  private key(): Buffer {
    const k = this.getKey();
    if (k.length < 16) throw new Error("IMAP is not configured on this server (IMAP_ENCRYPTION_KEY).");
    return crypto.createHash("sha256").update(k).digest();
  }

  private encrypt(plain: string): string {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv("aes-256-gcm", this.key(), iv);
    const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64");
  }

  private decrypt(secret: string): string {
    const buf = Buffer.from(secret, "base64");
    const d = crypto.createDecipheriv("aes-256-gcm", this.key(), buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    try {
      return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
    } catch {
      throw new Error("The stored IMAP password cannot be decrypted (IMAP_ENCRYPTION_KEY changed?) - remove and re-link the mailbox on the portal.");
    }
  }

  private persist(): void {
    fs.writeFileSync(this.file, JSON.stringify(this.accounts, null, 2), { encoding: "utf8", mode: 0o600 });
  }

  private static info(a: StoredAccount): ImapAccountInfo {
    const { id, label, email, host, port, security, username, connectedAt } = a;
    return { id, label, ...(email ? { email } : {}), host, port, security, username, connectedAt };
  }

  list(oid: string): ImapAccountInfo[] {
    return this.accounts.filter((a) => a.oid === oid).map(ImapStore.info);
  }

  count(oid?: string): number {
    return oid ? this.accounts.filter((a) => a.oid === oid).length : this.accounts.length;
  }

  /** Decrypted credentials for a tool call; only accounts of the caller are reachable. */
  credentials(oid: string, accountId: string): ImapCredentials {
    const a = this.accounts.find((x) => x.oid === oid && x.id === accountId);
    if (!a) throw new Error(`No linked IMAP mailbox with id "${accountId}" - call list-imap-accounts.`);
    return { ...ImapStore.info(a), password: this.decrypt(a.secret) };
  }

  /** Stores an account (caller has already verified the login). Same host+user replaces the old entry. */
  add(oid: string, input: ImapAccountInput): ImapAccountInfo {
    const host = input.host.toLowerCase();
    const existing = this.accounts.find((a) => a.oid === oid && a.host === host && a.username === input.username);
    if (!existing && this.count(oid) >= MAX_ACCOUNTS_PER_USER) {
      throw new Error(`Legfeljebb ${MAX_ACCOUNTS_PER_USER} IMAP-fiók csatolható.`);
    }
    const acc: StoredAccount = {
      oid,
      id: existing?.id ?? crypto.randomBytes(4).toString("hex"),
      label: input.label?.trim() || input.email || input.username,
      ...(input.email ? { email: input.email } : {}),
      host,
      port: input.port,
      security: input.security,
      username: input.username,
      connectedAt: new Date().toISOString(),
      secret: this.encrypt(input.password),
    };
    this.accounts = [...this.accounts.filter((a) => a !== existing), acc];
    this.persist();
    return ImapStore.info(acc);
  }

  remove(oid: string, accountId?: string): number {
    const before = this.accounts.length;
    this.accounts = this.accounts.filter((a) => !(a.oid === oid && (accountId === undefined || a.id === accountId)));
    if (this.accounts.length !== before) this.persist();
    return before - this.accounts.length;
  }
}
