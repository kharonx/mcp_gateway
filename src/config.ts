import dotenv from "dotenv";
import path from "node:path";

dotenv.config();

function num(v: string | undefined, dflt: number): number {
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : dflt;
}

/** Optional Salesforce Connected App (OAuth web-server flow). Empty clientId = integration off. */
export interface SalesforceConfig {
  clientId: string;
  clientSecret: string;
  /** https://login.salesforce.com, https://test.salesforce.com (sandbox) or a My Domain URL. */
  loginUrl: string;
  /** Space separated OAuth scopes requested (must be enabled on the Connected App). */
  scopes: string;
  /** REST API version, e.g. v62.0 */
  apiVersion: string;
}

/** Optional TT MCP server (Vectory / AP2 / Alphaportal, read-only). Empty url or apiKey = integration off. */
export interface TtConfig {
  url: string;
  apiKey: string;
}

export const TT_DEFAULTS = { url: "https://tt.dokiforvet.hu/mcp" };

/** Optional direct READ-ONLY SQL access to the Vectory replica (meditrade + alphavet cross-db). Empty server/user/password = off. */
export interface SqlConfig {
  server: string;
  port: number;
  database: string;
  user: string;
  password: string;
  encrypt: boolean;
}

export const SQL_DEFAULTS = { server: "sqlreplica.alpha-vet.hu", port: 1433, database: "meditrade", encrypt: false };

export const SALESFORCE_DEFAULTS = {
  loginUrl: "https://login.salesforce.com",
  scopes: "api refresh_token",
  apiVersion: "v62.0",
};

export interface AppConfig {
  salesforce: SalesforceConfig;
  tt: TtConfig;
  sql: SqlConfig;
  tenantId: string;
  clientId: string;
  clientSecret: string;
  mode: "http" | "stdio";
  port: number;
  baseUrl: string;
  enabledToolsets: string[] | null;
  readOnly: boolean;
  /** Access profile for users without an individual one (admin UI: "alapértelmezett jogosultság"). */
  defaultUserAccess: { toolsets: string[] | null; readOnly: boolean };
  defaultPageItems: number;
  maxPageItems: number;
  maxDownloadBytes: number;
  auditDir: string;
  adminKey: string;
}

export function loadConfig(argv: string[] = process.argv.slice(2)): AppConfig {
  const modeArg = argv.includes("--http") ? "http" : argv.includes("--stdio") ? "stdio" : undefined;
  const mode = (modeArg ?? process.env.MCP_MODE ?? "stdio") === "http" ? "http" : "stdio";
  const toolsets = (process.env.ENABLED_TOOLSETS ?? "").trim();
  return {
    tenantId: process.env.TENANT_ID ?? "",
    clientId: process.env.CLIENT_ID ?? "",
    clientSecret: process.env.CLIENT_SECRET ?? "",
    mode,
    port: num(process.env.PORT, 3000),
    baseUrl: (process.env.BASE_URL ?? `http://localhost:${num(process.env.PORT, 3000)}`).replace(/\/+$/, ""),
    enabledToolsets: toolsets ? toolsets.split(",").map((s) => s.trim()).filter(Boolean) : null,
    readOnly: (process.env.READ_ONLY ?? "false").toLowerCase() === "true",
    defaultUserAccess: {
      toolsets: (process.env.DEFAULT_USER_TOOLSETS ?? "").trim() ? (process.env.DEFAULT_USER_TOOLSETS as string).split(",").map((s) => s.trim()).filter(Boolean) : null,
      readOnly: (process.env.DEFAULT_USER_READ_ONLY ?? "false").toLowerCase() === "true",
    },
    defaultPageItems: num(process.env.DEFAULT_PAGE_ITEMS, 50),
    maxPageItems: num(process.env.MAX_PAGE_ITEMS, 500),
    maxDownloadBytes: num(process.env.MAX_DOWNLOAD_BYTES, 10 * 1024 * 1024),
    auditDir: path.resolve(process.env.AUDIT_DIR ?? "./logs"),
    adminKey: process.env.ADMIN_KEY ?? "",
    sql: {
      server: process.env.VECTORY_SQL_SERVER || SQL_DEFAULTS.server,
      port: num(process.env.VECTORY_SQL_PORT, SQL_DEFAULTS.port),
      database: process.env.VECTORY_SQL_DATABASE || SQL_DEFAULTS.database,
      user: process.env.VECTORY_SQL_USER ?? "",
      password: process.env.VECTORY_SQL_PASSWORD ?? "",
      encrypt: (process.env.VECTORY_SQL_ENCRYPT ?? "false").toLowerCase() === "true",
    },
    tt: {
      url: (process.env.TT_MCP_URL || TT_DEFAULTS.url).replace(/\/+$/, ""),
      apiKey: process.env.TT_MCP_API_KEY ?? "",
    },
    salesforce: {
      clientId: process.env.SF_CLIENT_ID ?? "",
      clientSecret: process.env.SF_CLIENT_SECRET ?? "",
      loginUrl: (process.env.SF_LOGIN_URL || SALESFORCE_DEFAULTS.loginUrl).replace(/\/+$/, ""),
      scopes: process.env.SF_SCOPES || SALESFORCE_DEFAULTS.scopes,
      apiVersion: process.env.SF_API_VERSION || SALESFORCE_DEFAULTS.apiVersion,
    },
  };
}

export function assertEntraConfig(cfg: AppConfig): void {
  const missing: string[] = [];
  if (!cfg.tenantId) missing.push("TENANT_ID");
  if (!cfg.clientId) missing.push("CLIENT_ID");
  if (cfg.mode === "http" && !cfg.clientSecret) missing.push("CLIENT_SECRET (required in http mode)");
  if (missing.length) {
    throw new Error(`Missing required configuration: ${missing.join(", ")}. See .env.example.`);
  }
}
