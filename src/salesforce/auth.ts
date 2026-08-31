import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Request, Response } from "express";
import type { AppConfig, SalesforceConfig } from "../config.js";
import { SalesforceClient, SalesforceError, type SfConnection } from "./client.js";

/**
 * Optional Salesforce integration - per-user OAuth 2.0 web-server flow (with
 * PKCE) against ONE pre-registered Connected App. Each Microsoft 365 user links
 * their own Salesforce login; the refresh token is stored per Entra object id
 * in data/salesforce-tokens.json, so every Salesforce call runs with that
 * user's Salesforce permissions (never an integration user, never app-only).
 *
 *   portal (signed-in M365 user) -> /auth/salesforce/connect
 *   Salesforce login/consent      -> /auth/salesforce/callback?code&state
 *   MCP tool call                 -> client for the caller's oid (refresh on 401)
 */

interface PendingConnect {
  oid: string;
  upn?: string;
  verifier: string;
  createdAt: number;
}

const PENDING_TTL_MS = 10 * 60 * 1000;

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface SfConnectionInfo {
  instanceUrl: string;
  orgId: string;
  userId: string;
  username?: string;
  name?: string;
  email?: string;
  connectedAt: string;
  lastRefreshAt?: string;
}

export class SalesforceAuth {
  private connections = new Map<string, SfConnection>();
  private pending = new Map<string, PendingConnect>();
  private file: string;

  constructor(private getCfg: () => AppConfig, dataDir: string) {
    this.file = path.join(dataDir, "salesforce-tokens.json");
    fs.mkdirSync(dataDir, { recursive: true });
    if (fs.existsSync(this.file)) {
      try {
        for (const c of JSON.parse(fs.readFileSync(this.file, "utf8")) as SfConnection[]) this.connections.set(c.oid, c);
      } catch {
        /* corrupted store - start empty */
      }
    }
  }

  private sf(): SalesforceConfig {
    const sf = this.getCfg().salesforce;
    if (!sf.clientId || !sf.clientSecret) throw new Error("Salesforce is not configured on this server (admin: Salesforce Consumer Key / Secret).");
    return sf;
  }

  private persist(): void {
    fs.writeFileSync(this.file, JSON.stringify([...this.connections.values()], null, 2), { encoding: "utf8", mode: 0o600 });
  }

  private gc(): void {
    const now = Date.now();
    for (const [k, v] of this.pending) if (now - v.createdAt > PENDING_TTL_MS) this.pending.delete(k);
  }

  callbackUrl(): string {
    return `${this.getCfg().baseUrl}/auth/salesforce/callback`;
  }

  connectedCount(): number {
    return this.connections.size;
  }

  isConnected(oid: string): boolean {
    return this.connections.has(oid);
  }

  info(oid: string): SfConnectionInfo | null {
    const c = this.connections.get(oid);
    if (!c) return null;
    const { instanceUrl, orgId, userId, username, name, email, connectedAt, lastRefreshAt } = c;
    return { instanceUrl, orgId, userId, username, name, email, connectedAt, lastRefreshAt };
  }

  /** Redirect the signed-in portal user to the Salesforce authorization page. */
  startConnect(oid: string, upn: string | undefined, res: Response): void {
    this.gc();
    const sf = this.sf();
    const verifier = b64url(crypto.randomBytes(48));
    const state = crypto.randomUUID();
    this.pending.set(state, { oid, upn, verifier, createdAt: Date.now() });
    const u = new URL(`${sf.loginUrl}/services/oauth2/authorize`);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("client_id", sf.clientId);
    u.searchParams.set("redirect_uri", this.callbackUrl());
    u.searchParams.set("scope", sf.scopes);
    u.searchParams.set("state", state);
    u.searchParams.set("code_challenge", b64url(crypto.createHash("sha256").update(verifier).digest()));
    u.searchParams.set("code_challenge_method", "S256");
    res.redirect(u.toString());
  }

  /** Salesforce redirects back here; returns the oid whose connection was stored. */
  async handleCallback(req: Request): Promise<{ oid: string; info: SfConnectionInfo }> {
    const q = req.query as Record<string, string>;
    const p = q.state ? this.pending.get(q.state) : undefined;
    if (!p) throw new Error("Unknown or expired Salesforce authorization state - restart the connection.");
    this.pending.delete(q.state);
    if (q.error) throw new Error(`${q.error}: ${q.error_description ?? ""}`.trim());
    if (!q.code) throw new Error("Salesforce did not return an authorization code.");
    const sf = this.sf();
    const tok = await this.tokenRequest(sf, {
      grant_type: "authorization_code",
      code: q.code,
      redirect_uri: this.callbackUrl(),
      code_verifier: p.verifier,
    });
    if (!tok.refresh_token) {
      throw new Error(
        "Salesforce returned no refresh token. Enable the 'Perform requests at any time (refresh_token, offline_access)' scope on the Connected App and add it to the requested scopes."
      );
    }
    const ids = parseIdentityUrl(tok.id);
    const conn: SfConnection = {
      oid: p.oid,
      upn: p.upn,
      orgId: ids.orgId,
      userId: ids.userId,
      instanceUrl: String(tok.instance_url).replace(/\/+$/, ""),
      accessToken: String(tok.access_token),
      refreshToken: String(tok.refresh_token),
      connectedAt: new Date().toISOString(),
    };
    this.connections.set(p.oid, conn);
    this.persist();
    // Best effort: resolve display data with the user's own api scope.
    try {
      const client = this.clientFor(p.oid)!;
      const r = await client.request(
        "GET",
        client.data("/query"),
        { query: { q: `SELECT Id, Name, Username, Email FROM User WHERE Id = '${conn.userId}'` } }
      );
      const u = r?.records?.[0];
      if (u) {
        const stored = this.connections.get(p.oid);
        if (stored) {
          stored.username = u.Username;
          stored.name = u.Name;
          stored.email = u.Email;
          this.persist();
        }
      }
    } catch {
      /* display data only */
    }
    return { oid: p.oid, info: this.info(p.oid)! };
  }

  /** Revoke the refresh token at Salesforce and forget the connection. */
  async disconnect(oid: string): Promise<void> {
    const c = this.connections.get(oid);
    if (!c) return;
    this.connections.delete(oid);
    this.persist();
    try {
      const sf = this.sf();
      await fetch(`${sf.loginUrl}/services/oauth2/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: c.refreshToken }).toString(),
      });
    } catch {
      /* revocation is best effort */
    }
  }

  /** A client bound to this user's connection, or null when not connected. */
  clientFor(oid: string): SalesforceClient | null {
    const c = this.connections.get(oid);
    if (!c) return null;
    return new SalesforceClient(c, (conn) => this.refreshConnection(conn), this.getCfg().salesforce.apiVersion);
  }

  private async refreshConnection(conn: SfConnection): Promise<SfConnection> {
    const sf = this.sf();
    let tok;
    try {
      tok = await this.tokenRequest(sf, { grant_type: "refresh_token", refresh_token: conn.refreshToken });
    } catch (err) {
      // Refresh token revoked/expired -> drop the connection so the portal offers a reconnect.
      this.connections.delete(conn.oid);
      this.persist();
      throw new SalesforceError(401, "refresh_failed", err instanceof Error ? err.message : String(err));
    }
    const next: SfConnection = {
      ...conn,
      accessToken: String(tok.access_token),
      instanceUrl: String(tok.instance_url ?? conn.instanceUrl).replace(/\/+$/, ""),
      lastRefreshAt: new Date().toISOString(),
    };
    this.connections.set(conn.oid, next);
    this.persist();
    return next;
  }

  private async tokenRequest(sf: SalesforceConfig, params: Record<string, string>): Promise<Record<string, any>> {
    const body = new URLSearchParams({ client_id: sf.clientId, client_secret: sf.clientSecret, ...params });
    const res = await fetch(`${sf.loginUrl}/services/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, any>;
    if (!res.ok || !data.access_token) {
      throw new Error(`${data.error ?? res.status}: ${String(data.error_description ?? "Salesforce token request failed")}`);
    }
    return data;
  }
}

/** https://login.salesforce.com/id/00Dxx.../005xx... -> org + user id */
function parseIdentityUrl(id: unknown): { orgId: string; userId: string } {
  const m = /\/id\/([a-zA-Z0-9]+)\/([a-zA-Z0-9]+)\/?$/.exec(String(id ?? ""));
  return { orgId: m?.[1] ?? "", userId: m?.[2] ?? "" };
}
