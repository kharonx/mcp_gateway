import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Router, type Request, type Response } from "express";
import express from "express";
import type { AppConfig } from "../config.js";

/**
 * OAuth 2.1 authorization-server facade in front of Microsoft Entra ID.
 *
 * Why: MCP clients such as ChatGPT expect RFC 7591 dynamic client registration,
 * which Entra ID does not support. This proxy speaks the MCP-required OAuth
 * surface (/register, /authorize, /token + AS metadata) towards the client and
 * uses the single pre-registered Entra app (CLIENT_ID/CLIENT_SECRET) towards
 * Microsoft. The access token handed to the client IS the Entra access token
 * issued for this API (audience api://CLIENT_ID), so /mcp validation is
 * unchanged and every Graph call still runs as the signed-in user (OBO).
 *
 * Flow:
 *   client -> /register                  (DCR, client stored locally)
 *   client -> /authorize                 (PKCE challenge stored, redirect to Entra)
 *   Entra  -> /auth/callback?code&state  (code exchanged at Entra, our own code minted)
 *   client -> /token (code + verifier)   (PKCE verified, Entra tokens returned)
 *   client -> /token (refresh_token)     (proxied to Entra)
 */

interface RegisteredClient {
  client_id: string;
  client_name?: string;
  redirect_uris: string[];
  createdAt: string;
}

interface PendingAuth {
  kind: "mcp" | "web";
  clientId?: string;
  redirectUri?: string;
  clientState?: string;
  codeChallenge?: string;
  createdAt: number;
}

export interface EntraTokens {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in: number;
  scope?: string;
}

interface IssuedCode {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  tokens: EntraTokens;
  createdAt: number;
}

const PENDING_TTL_MS = 10 * 60 * 1000;
const CODE_TTL_MS = 5 * 60 * 1000;

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function validRedirectUri(uri: string): boolean {
  try {
    const u = new URL(uri);
    return u.protocol === "https:" || u.hostname === "localhost" || u.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

export class OAuthProxy {
  private clients = new Map<string, RegisteredClient>();
  private pending = new Map<string, PendingAuth>();
  private codes = new Map<string, IssuedCode>();
  private clientsFile: string;

  constructor(private getCfg: () => AppConfig, dataDir: string) {
    this.clientsFile = path.join(dataDir, "oauth-clients.json");
    fs.mkdirSync(dataDir, { recursive: true });
    if (fs.existsSync(this.clientsFile)) {
      try {
        for (const c of JSON.parse(fs.readFileSync(this.clientsFile, "utf8")) as RegisteredClient[]) {
          this.clients.set(c.client_id, c);
        }
      } catch {
        /* corrupted client store - start empty */
      }
    }
  }

  private persistClients(): void {
    fs.writeFileSync(this.clientsFile, JSON.stringify([...this.clients.values()], null, 2), "utf8");
  }

  private gc(): void {
    const now = Date.now();
    for (const [k, v] of this.pending) if (now - v.createdAt > PENDING_TTL_MS) this.pending.delete(k);
    for (const [k, v] of this.codes) if (now - v.createdAt > CODE_TTL_MS) this.codes.delete(k);
  }

  private entraScope(cfg: AppConfig): string {
    return `api://${cfg.clientId}/access_as_user offline_access openid profile`;
  }

  registeredClientCount(): number {
    return this.clients.size;
  }

  /** Set by the HTTP server: called when a portal ("web") login completes at /auth/callback. */
  webLoginHandler?: (tokens: EntraTokens, req: Request, res: Response) => void | Promise<void>;

  /** Start an Entra login for the web portal (landing page) using the same redirect URI. */
  startWebLogin(res: Response): void {
    this.gc();
    const cfg = this.getCfg();
    const pendingId = crypto.randomUUID();
    this.pending.set(pendingId, { kind: "web", createdAt: Date.now() });
    const entra = new URL(`https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/authorize`);
    entra.searchParams.set("client_id", cfg.clientId);
    entra.searchParams.set("response_type", "code");
    entra.searchParams.set("redirect_uri", `${cfg.baseUrl}/auth/callback`);
    entra.searchParams.set("scope", this.entraScope(cfg));
    entra.searchParams.set("state", pendingId);
    entra.searchParams.set("prompt", "select_account");
    res.redirect(entra.toString());
  }

  router(): Router {
    const r = Router();
    r.use(express.urlencoded({ extended: false }));

    // ── AS metadata (RFC 8414) ────────────────────────────────────────
    r.get("/.well-known/oauth-authorization-server", (_req, res) => {
      const cfg = this.getCfg();
      res.json({
        issuer: cfg.baseUrl,
        authorization_endpoint: `${cfg.baseUrl}/authorize`,
        token_endpoint: `${cfg.baseUrl}/token`,
        registration_endpoint: `${cfg.baseUrl}/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
        scopes_supported: [`api://${cfg.clientId}/access_as_user`],
      });
    });

    // ── Dynamic client registration (RFC 7591) ────────────────────────
    r.post("/register", express.json(), (req: Request, res: Response) => {
      const body = req.body ?? {};
      const redirectUris: string[] = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
      if (!redirectUris.length || !redirectUris.every(validRedirectUri)) {
        res.status(400).json({
          error: "invalid_redirect_uri",
          error_description: "redirect_uris must be non-empty https (or localhost) URLs",
        });
        return;
      }
      const client: RegisteredClient = {
        client_id: crypto.randomUUID(),
        client_name: typeof body.client_name === "string" ? body.client_name.slice(0, 100) : undefined,
        redirect_uris: redirectUris,
        createdAt: new Date().toISOString(),
      };
      this.clients.set(client.client_id, client);
      this.persistClients();
      res.status(201).json({
        client_id: client.client_id,
        client_name: client.client_name,
        redirect_uris: client.redirect_uris,
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      });
    });

    // ── Authorize: hand off to Entra ──────────────────────────────────
    r.get("/authorize", (req: Request, res: Response) => {
      this.gc();
      const cfg = this.getCfg();
      const q = req.query as Record<string, string>;
      const client = this.clients.get(q.client_id ?? "");
      if (!client) {
        res.status(400).send("Unknown client_id - register first via POST /register");
        return;
      }
      if (!q.redirect_uri || !client.redirect_uris.includes(q.redirect_uri)) {
        res.status(400).send("redirect_uri does not match the registered redirect_uris");
        return;
      }
      if (q.response_type !== "code" || !q.code_challenge || q.code_challenge_method !== "S256") {
        res.status(400).send("Only response_type=code with PKCE S256 is supported");
        return;
      }
      const pendingId = crypto.randomUUID();
      this.pending.set(pendingId, {
        kind: "mcp",
        clientId: client.client_id,
        redirectUri: q.redirect_uri,
        clientState: q.state,
        codeChallenge: q.code_challenge,
        createdAt: Date.now(),
      });
      const entra = new URL(`https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/authorize`);
      entra.searchParams.set("client_id", cfg.clientId);
      entra.searchParams.set("response_type", "code");
      entra.searchParams.set("redirect_uri", `${cfg.baseUrl}/auth/callback`);
      entra.searchParams.set("scope", this.entraScope(cfg));
      entra.searchParams.set("state", pendingId);
      entra.searchParams.set("prompt", "select_account");
      res.redirect(entra.toString());
    });

    // ── Entra redirects back here ─────────────────────────────────────
    r.get("/auth/callback", async (req: Request, res: Response) => {
      const cfg = this.getCfg();
      const q = req.query as Record<string, string>;
      const p = q.state ? this.pending.get(q.state) : undefined;
      if (!p) {
        res.status(400).send("Unknown or expired authorization state - restart the connection flow");
        return;
      }
      this.pending.delete(q.state);

      if (p.kind === "web") {
        if (q.error) {
          res.redirect(`/?login_error=${encodeURIComponent(q.error_description ?? q.error)}`);
          return;
        }
        try {
          const tokens = await this.entraTokenRequest(cfg, {
            grant_type: "authorization_code",
            code: q.code,
            redirect_uri: `${cfg.baseUrl}/auth/callback`,
          });
          if (this.webLoginHandler) await this.webLoginHandler(tokens, req, res);
          else res.redirect("/");
        } catch (err) {
          res.redirect(`/?login_error=${encodeURIComponent(err instanceof Error ? err.message : "login failed")}`);
        }
        return;
      }

      const back = new URL(p.redirectUri!);
      if (q.error) {
        back.searchParams.set("error", q.error);
        if (q.error_description) back.searchParams.set("error_description", q.error_description);
        if (p.clientState) back.searchParams.set("state", p.clientState);
        res.redirect(back.toString());
        return;
      }
      try {
        const tokens = await this.entraTokenRequest(cfg, {
          grant_type: "authorization_code",
          code: q.code,
          redirect_uri: `${cfg.baseUrl}/auth/callback`,
        });
        const ourCode = b64url(crypto.randomBytes(32));
        this.codes.set(ourCode, {
          clientId: p.clientId!,
          redirectUri: p.redirectUri!,
          codeChallenge: p.codeChallenge!,
          tokens,
          createdAt: Date.now(),
        });
        back.searchParams.set("code", ourCode);
        if (p.clientState) back.searchParams.set("state", p.clientState);
        res.redirect(back.toString());
      } catch (err) {
        back.searchParams.set("error", "server_error");
        back.searchParams.set("error_description", err instanceof Error ? err.message : "token exchange failed");
        if (p.clientState) back.searchParams.set("state", p.clientState);
        res.redirect(back.toString());
      }
    });

    // ── Token endpoint ────────────────────────────────────────────────
    r.post("/token", async (req: Request, res: Response) => {
      this.gc();
      const cfg = this.getCfg();
      const b = req.body ?? {};
      try {
        if (b.grant_type === "authorization_code") {
          const issued = this.codes.get(b.code ?? "");
          if (!issued || Date.now() - issued.createdAt > CODE_TTL_MS) {
            res.status(400).json({ error: "invalid_grant", error_description: "Unknown or expired code" });
            return;
          }
          this.codes.delete(b.code); // single use
          if (b.client_id && b.client_id !== issued.clientId) {
            res.status(400).json({ error: "invalid_grant", error_description: "client_id mismatch" });
            return;
          }
          if (b.redirect_uri && b.redirect_uri !== issued.redirectUri) {
            res.status(400).json({ error: "invalid_grant", error_description: "redirect_uri mismatch" });
            return;
          }
          const challenge = b64url(crypto.createHash("sha256").update(String(b.code_verifier ?? "")).digest());
          if (challenge !== issued.codeChallenge) {
            res.status(400).json({ error: "invalid_grant", error_description: "PKCE verification failed" });
            return;
          }
          res.json({
            access_token: issued.tokens.access_token,
            token_type: "Bearer",
            expires_in: issued.tokens.expires_in,
            refresh_token: issued.tokens.refresh_token,
            scope: issued.tokens.scope ?? this.entraScope(cfg),
          });
          return;
        }
        if (b.grant_type === "refresh_token") {
          if (!b.refresh_token) {
            res.status(400).json({ error: "invalid_request", error_description: "refresh_token missing" });
            return;
          }
          const tokens = await this.entraTokenRequest(cfg, {
            grant_type: "refresh_token",
            refresh_token: String(b.refresh_token),
            scope: this.entraScope(cfg),
          });
          res.json({
            access_token: tokens.access_token,
            token_type: "Bearer",
            expires_in: tokens.expires_in,
            refresh_token: tokens.refresh_token,
            scope: tokens.scope ?? this.entraScope(cfg),
          });
          return;
        }
        res.status(400).json({ error: "unsupported_grant_type" });
      } catch (err) {
        res.status(400).json({
          error: "invalid_grant",
          error_description: err instanceof Error ? err.message : "token request failed",
        });
      }
    });

    return r;
  }

  private async entraTokenRequest(cfg: AppConfig, params: Record<string, string>): Promise<EntraTokens> {
    const body = new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      ...params,
    });
    const res = await fetch(`https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      throw new Error(`${data.error ?? res.status}: ${String(data.error_description ?? "Entra token request failed").split("\n")[0]}`);
    }
    return {
      access_token: String(data.access_token),
      refresh_token: data.refresh_token ? String(data.refresh_token) : undefined,
      id_token: data.id_token ? String(data.id_token) : undefined,
      expires_in: Number(data.expires_in ?? 3600),
      scope: data.scope ? String(data.scope) : undefined,
    };
  }
}
