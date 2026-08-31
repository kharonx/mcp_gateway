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

export const SALESFORCE_DEFAULTS = {
  loginUrl: "https://login.salesforce.com",
  scopes: "api refresh_token",
  apiVersion: "v62.0",
};

export interface AppConfig {
  salesforce: SalesforceConfig;
  tenantId: string;
  clientId: string;
  clientSecret: string;
  mode: "http" | "stdio";
  port: number;
  baseUrl: string;
  enabledToolsets: string[] | null;
  readOnly: boolean;
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
    defaultPageItems: num(process.env.DEFAULT_PAGE_ITEMS, 50),
    maxPageItems: num(process.env.MAX_PAGE_ITEMS, 500),
    maxDownloadBytes: num(process.env.MAX_DOWNLOAD_BYTES, 10 * 1024 * 1024),
    auditDir: path.resolve(process.env.AUDIT_DIR ?? "./logs"),
    adminKey: process.env.ADMIN_KEY ?? "",
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
