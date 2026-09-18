import fs from "node:fs";
import path from "node:path";
import type { AppConfig } from "./config.js";

/**
 * Admin-editable settings persisted to data/settings.json.
 * Values here OVERRIDE the .env defaults, so the server can be configured
 * entirely from the /admin UI after first start.
 */
export interface MutableSettings {
  tenantId?: string;
  clientId?: string;
  clientSecret?: string;
  baseUrl?: string;
  readOnly?: boolean;
  enabledToolsets?: string[] | null;
  /** Default per-user access for users without an individual profile. */
  defaultUserToolsets?: string[] | null;
  defaultUserReadOnly?: boolean;
  defaultPageItems?: number;
  maxPageItems?: number;
  maxDownloadBytes?: number;
  /** Optional Salesforce Connected App (Consumer Key / Secret). */
  salesforceClientId?: string;
  salesforceClientSecret?: string;
  salesforceLoginUrl?: string;
  salesforceScopes?: string;
  salesforceApiVersion?: string;
  /** Optional TT MCP server (Vectory / AP2). */
  ttMcpUrl?: string;
  ttMcpApiKey?: string;
  /** Optional Vectory SQL replica (read-only login). */
  sqlServer?: string;
  sqlPort?: number;
  sqlDatabase?: string;
  sqlUser?: string;
  sqlPassword?: string;
  sqlEncrypt?: boolean;
}

export class SettingsStore {
  private settings: MutableSettings = {};

  constructor(private file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file)) {
      try {
        this.settings = JSON.parse(fs.readFileSync(file, "utf8")) as MutableSettings;
      } catch {
        this.settings = {};
      }
    }
  }

  get(): MutableSettings {
    return { ...this.settings };
  }

  /** Merge a patch and persist. Empty-string secret means "keep existing". */
  save(patch: MutableSettings): void {
    const next: MutableSettings = { ...this.settings };
    for (const [k, v] of Object.entries(patch) as [keyof MutableSettings, unknown][]) {
      if (v === undefined) continue;
      if ((k === "clientSecret" || k === "salesforceClientSecret" || k === "ttMcpApiKey" || k === "sqlPassword") && v === "") continue; // masked in UI - keep stored value
      (next as Record<string, unknown>)[k] = v;
    }
    this.settings = next;
    fs.writeFileSync(this.file, JSON.stringify(next, null, 2), "utf8");
  }

  /** Effective config = env/base config overridden by stored settings. */
  effective(base: AppConfig): AppConfig {
    const s = this.settings;
    return {
      ...base,
      tenantId: s.tenantId ?? base.tenantId,
      clientId: s.clientId ?? base.clientId,
      clientSecret: s.clientSecret ?? base.clientSecret,
      baseUrl: (s.baseUrl ?? base.baseUrl).replace(/\/+$/, ""),
      readOnly: s.readOnly ?? base.readOnly,
      enabledToolsets: s.enabledToolsets !== undefined ? s.enabledToolsets : base.enabledToolsets,
      defaultUserAccess: {
        toolsets: s.defaultUserToolsets !== undefined ? s.defaultUserToolsets : base.defaultUserAccess.toolsets,
        readOnly: s.defaultUserReadOnly ?? base.defaultUserAccess.readOnly,
      },
      defaultPageItems: s.defaultPageItems ?? base.defaultPageItems,
      maxPageItems: s.maxPageItems ?? base.maxPageItems,
      maxDownloadBytes: s.maxDownloadBytes ?? base.maxDownloadBytes,
      salesforce: {
        clientId: s.salesforceClientId ?? base.salesforce.clientId,
        clientSecret: s.salesforceClientSecret ?? base.salesforce.clientSecret,
        loginUrl: (s.salesforceLoginUrl || base.salesforce.loginUrl).replace(/\/+$/, ""),
        scopes: s.salesforceScopes || base.salesforce.scopes,
        apiVersion: s.salesforceApiVersion || base.salesforce.apiVersion,
      },
      tt: {
        url: (s.ttMcpUrl || base.tt.url).replace(/\/+$/, ""),
        apiKey: s.ttMcpApiKey ?? base.tt.apiKey,
      },
      sql: {
        server: s.sqlServer || base.sql.server,
        port: s.sqlPort || base.sql.port,
        database: s.sqlDatabase || base.sql.database,
        user: s.sqlUser ?? base.sql.user,
        password: s.sqlPassword ?? base.sql.password,
        encrypt: s.sqlEncrypt ?? base.sql.encrypt,
      },
    };
  }
}

/** Vectory SQL is optional: tools exist only with server, user and password. */
export function isSqlConfigured(cfg: AppConfig): boolean {
  return !!(cfg.sql.server && cfg.sql.user && cfg.sql.password);
}

/** TT (Vectory / AP2) is optional: its toolset exists only with a URL and an API key. */
export function isTtConfigured(cfg: AppConfig): boolean {
  return !!(cfg.tt.url && cfg.tt.apiKey);
}

export function isEntraConfigured(cfg: AppConfig): boolean {
  return !!(cfg.tenantId && cfg.clientId && cfg.clientSecret);
}

/** Salesforce is optional: the toolset only exists when a Connected App is configured. */
export function isSalesforceConfigured(cfg: AppConfig): boolean {
  return !!(cfg.salesforce.clientId && cfg.salesforce.clientSecret);
}
