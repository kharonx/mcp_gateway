import type { AppConfig } from "../config.js";

/**
 * App-only (client-credentials) Graph token for the few tools that must read across the
 * organization (toolset meetings-org). Never used for the delegated OBO path. The token is
 * cached until shortly before it expires and dropped when the Entra settings change.
 */
export class AppTokenProvider {
  private cached: { token: string; expiresAt: number; key: string } | null = null;

  constructor(private getCfg: () => AppConfig) {}

  async getToken(): Promise<string> {
    const cfg = this.getCfg();
    const key = `${cfg.tenantId}|${cfg.clientId}|${cfg.clientSecret}`;
    if (this.cached && this.cached.key === key && Date.now() < this.cached.expiresAt) return this.cached.token;
    const data = await this.request(cfg);
    const token = String(data.access_token);
    this.cached = { token, key, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 - 5 * 60_000 };
    return token;
  }

  private async request(cfg: AppConfig): Promise<Record<string, unknown>> {
    const body = new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: "client_credentials",
      scope: "https://graph.microsoft.com/.default",
    });
    const r = await fetch(`https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const data = (await r.json()) as Record<string, unknown>;
    if (!r.ok || !data.access_token) {
      throw new Error(`App-only token request failed: ${data.error ?? r.status}: ${String(data.error_description ?? "").split("\n")[0]}`);
    }
    return data;
  }
}
