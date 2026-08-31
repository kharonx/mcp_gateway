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
  defaultPageItems?: number;
  maxPageItems?: number;
  maxDownloadBytes?: number;
  /** Optional Salesforce Connected App (Consumer Key / Secret). */
  salesforceClientId?: string;
  salesforceClientSecret?: string;
  salesforceLoginUrl?: string;
  salesforceScopes?: string;
  salesforceApiVersion?: string;
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
      if ((k === "clientSecret" || k === "salesforceClientSecret") && v === "") continue; // masked in UI - keep stored value
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
    };
  }
}

export function isEntraConfigured(cfg: AppConfig): boolean {
  return !!(cfg.tenantId && cfg.clientId && cfg.clientSecret);
}

/** Salesforce is optional: the toolset only exists when a Connected App is configured. */
export function isSalesforceConfigured(cfg: AppConfig): boolean {
  return !!(cfg.salesforce.clientId && cfg.salesforce.clientSecret);
}
