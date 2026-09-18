import sql from "mssql";
import type { SqlConfig } from "../config.js";

/**
 * Read-only SQL Server access to the Vectory replica (database `meditrade`,
 * cross-db `alphavet.dbo.*` on the same connection). Two safety layers:
 *  1. the login itself should be read-only (db_datareader) - ask the DBA;
 *  2. every statement that reaches the server goes through assertReadOnlySelect
 *     (single SELECT/WITH statement, no DML/DDL/EXEC keywords) and gets a row cap.
 * Curated tools use parameterised queries; the ad-hoc tool passes AI-written SQL
 * only after the same validation.
 */

const FORBIDDEN = /\b(insert|update|delete|merge|truncate|drop|alter|create|grant|revoke|deny|exec|execute|sp_|xp_|openrowset|openquery|opendatasource|bulk|backup|restore|shutdown|kill|dbcc|waitfor|into\s+#?\w)\b/i;

export function assertReadOnlySelect(query: string): string {
  const q = String(query ?? "").trim().replace(/;+\s*$/, "");
  if (!q) throw new Error("Empty SQL query.");
  if (q.includes(";")) throw new Error("Only a single statement is allowed (no ';').");
  if (/--|\/\*/.test(q)) throw new Error("Comments are not allowed in the query.");
  if (!/^(select|with)\b/i.test(q)) throw new Error("Only SELECT (or WITH ... SELECT) statements are allowed.");
  const m = q.match(FORBIDDEN);
  if (m) throw new Error(`Forbidden keyword in query: ${m[1]}. The Vectory connection is read-only.`);
  return q;
}

export class SqlClient {
  private pool: sql.ConnectionPool | null = null;
  private connecting: Promise<sql.ConnectionPool> | null = null;

  constructor(private cfg: SqlConfig) {}

  private async getPool(): Promise<sql.ConnectionPool> {
    if (this.pool?.connected) return this.pool;
    if (!this.connecting) {
      const pool = new sql.ConnectionPool({
        server: this.cfg.server,
        port: this.cfg.port || 1433,
        database: this.cfg.database,
        user: this.cfg.user,
        password: this.cfg.password,
        requestTimeout: 180_000,
        connectionTimeout: 20_000,
        pool: { max: 4, min: 0, idleTimeoutMillis: 60_000 },
        options: {
          encrypt: this.cfg.encrypt,
          trustServerCertificate: true,
          enableArithAbort: true,
          appName: "av-mcp-gateway",
          readOnlyIntent: true,
        },
      });
      this.connecting = pool
        .connect()
        .then((p) => {
          this.pool = p;
          return p;
        })
        .finally(() => {
          this.connecting = null;
        });
    }
    return this.connecting;
  }

  async close(): Promise<void> {
    const p = this.pool;
    this.pool = null;
    if (p) await p.close().catch(() => undefined);
  }

  /**
   * Run one validated SELECT with named parameters (@name). Rows are capped at
   * maxRows via SET ROWCOUNT (reset afterwards on the same connection).
   */
  async select(query: string, params: Record<string, unknown> = {}, maxRows = 500): Promise<{ rows: Record<string, unknown>[]; truncated: boolean }> {
    const q = assertReadOnlySelect(query);
    const cap = Math.max(1, Math.min(Math.floor(maxRows), 5000));
    const pool = await this.getPool();
    const req = pool.request();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined) continue;
      req.input(k, v === null ? sql.NVarChar : inferType(v), v as never);
    }
    const r = await req.query(`SET ROWCOUNT ${cap + 1}; ${q}; SET ROWCOUNT 0;`);
    const rows = (r.recordset ?? []) as Record<string, unknown>[];
    const truncated = rows.length > cap;
    return { rows: truncated ? rows.slice(0, cap) : rows, truncated };
  }

  /** Connection self-test: server, database, and whether the Vectory / alphavet tables are visible. */
  async test(): Promise<{ ok: boolean; server?: string; database?: string; login?: string; vectoryCustomers?: number; alphavetCustomers?: number; error?: string }> {
    try {
      const pool = await this.getPool();
      const info = await pool.request().query("SELECT @@SERVERNAME AS server, DB_NAME() AS db, SUSER_SNAME() AS login");
      const r = info.recordset[0] as Record<string, string>;
      let vectoryCustomers: number | undefined;
      let alphavetCustomers: number | undefined;
      try {
        vectoryCustomers = Number((await pool.request().query("SELECT COUNT(*) AS n FROM UGYFEL")).recordset[0].n);
      } catch { /* table not visible */ }
      try {
        alphavetCustomers = Number((await pool.request().query("SELECT COUNT(*) AS n FROM alphavet.dbo.UGYFEL WITH(NOLOCK)")).recordset[0].n);
      } catch { /* cross-db not visible */ }
      return { ok: true, server: r.server, database: r.db, login: r.login, vectoryCustomers, alphavetCustomers };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

function inferType(v: unknown): sql.ISqlType | (() => sql.ISqlType) {
  if (typeof v === "number") return Number.isInteger(v) ? sql.Int : sql.Float;
  if (typeof v === "boolean") return sql.Bit;
  if (v instanceof Date) return sql.DateTime;
  return sql.NVarChar;
}
