import fs from "node:fs";
import path from "node:path";

/**
 * Audit log entry - metadata only. Message bodies, transcripts, file contents
 * and tokens are deliberately never written to the audit log.
 */
export interface AuditEntry {
  timestamp: string;
  user: string;
  session: string;
  tool: string;
  operation: "READ" | "WRITE";
  resourceType: string;
  graphEndpoint: string;
  httpMethod: string;
  success: boolean;
  durationMs: number;
  error?: string;
  // WRITE-only fields
  sender?: string;
  recipients?: string[];
  cc?: string[];
  subject?: string;
  messageId?: string;
  result?: string;
}

export class AuditLogger {
  private recent: AuditEntry[] = [];

  constructor(private dir: string, private toStderr = false) {
    fs.mkdirSync(dir, { recursive: true });
  }

  log(entry: AuditEntry): void {
    const line = JSON.stringify(entry);
    const file = path.join(this.dir, `audit-${entry.timestamp.slice(0, 10)}.jsonl`);
    try {
      fs.appendFileSync(file, line + "\n", "utf8");
    } catch {
      /* audit must never crash a tool call */
    }
    if (this.toStderr) process.stderr.write(`[audit] ${line}\n`);
    this.recent.push(entry);
    if (this.recent.length > 500) this.recent.splice(0, this.recent.length - 500);
  }

  /** Recent in-memory entries for the admin dashboard. */
  getRecent(limit = 100): AuditEntry[] {
    return this.recent.slice(-limit).reverse();
  }

  /** Days that have an audit file on disk, newest first. */
  listDays(): string[] {
    try {
      return fs
        .readdirSync(this.dir)
        .map((f) => /^audit-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(f)?.[1])
        .filter((d): d is string => !!d)
        .sort()
        .reverse();
    } catch {
      return [];
    }
  }

  /** Read back entries of a given day from disk (admin API). */
  readDay(day: string, limit = 500): AuditEntry[] {
    const file = path.join(this.dir, `audit-${day}.jsonl`);
    if (!fs.existsSync(file)) return [];
    const lines = fs.readFileSync(file, "utf8").trim().split("\n");
    return lines.slice(-limit).map((l) => {
      try {
        return JSON.parse(l) as AuditEntry;
      } catch {
        return null;
      }
    }).filter((e): e is AuditEntry => e !== null);
  }
}
