import crypto, { randomUUID, timingSafeEqual } from "node:crypto";
import path from "node:path";
import express, { type Request, type Response, type NextFunction } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { TokenValidator, userFromClaims } from "../auth/jwt.js";
import { OboAuth } from "../auth/obo.js";
import { OAuthProxy } from "../auth/oauthProxy.js";
import { GraphClient } from "../graph/client.js";
import { AuditLogger } from "../audit/audit.js";
import { buildMcpServer } from "./mcp.js";
import { ADMIN_HTML } from "./adminUi.js";
import { renderPortal, buildCapabilities, renderNav, PORTAL_STYLE } from "./portalUi.js";
import { renderChangelogPage } from "./changelog.js";
import { allEndpoints } from "../tools/endpoints/all.js";
import { isToolEnabled } from "../tools/registry.js";
import type { Toolset, ToolContext } from "../tools/types.js";
import { SettingsStore, isEntraConfigured, isSalesforceConfigured, type MutableSettings } from "../settings.js";
import { SalesforceAuth } from "../salesforce/auth.js";
import { UserRegistry } from "../users.js";
import type { AppConfig } from "../config.js";

const ALL_TOOLSETS: Toolset[] = [
  "salesforce",
  "mail",
  "shared-mail",
  "mail-write",
  "shared-mail-write",
  "calendar",
  "calendar-write",
  "teams",
  "teams-write",
  "meetings",
  "onenote",
  "sharepoint",
  "onedrive",
  "loop",
  "search",
  "users",
];

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function decodeJwtPayload(token: string | undefined): Record<string, unknown> {
  try {
    const mid = (token ?? "").split(".")[1];
    return JSON.parse(Buffer.from(mid, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

interface WebSession {
  accessToken: string;
  expiresAt: number;
  /** Entra object id - key of the user's optional Salesforce connection. */
  oid?: string;
  name?: string;
  upn?: string;
}

const SESSION_COOKIE = "mcp_portal";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export async function runHttp(baseCfg: AppConfig): Promise<void> {
  const store = new SettingsStore(path.resolve("data", "settings.json"));
  const audit = new AuditLogger(baseCfg.auditDir);

  // Runtime state - rebuilt whenever settings change from the admin UI.
  let cfg = store.effective(baseCfg);
  let validator: TokenValidator | null = null;
  let obo: OboAuth | null = null;
  function applySettings(): void {
    cfg = store.effective(baseCfg);
    if (isEntraConfigured(cfg)) {
      validator = new TokenValidator(cfg.tenantId, cfg.clientId);
      obo = new OboAuth(cfg);
    } else {
      validator = null;
      obo = null;
    }
  }
  applySettings();

  const oauthProxy = new OAuthProxy(() => cfg, path.resolve("data"));
  // Optional Salesforce: per-user OAuth connections keyed by Entra oid.
  const sfAuth = new SalesforceAuth(() => cfg, path.resolve("data"));
  // Everyone who signed in (portal or MCP) + admin rights.
  const users = new UserRegistry(path.resolve("data", "users.json"));
  process.on("beforeExit", () => users.flush());

  // ── Web portal sessions (landing-page Microsoft login) ──────────────
  const sessions = new Map<string, WebSession>();
  oauthProxy.webLoginHandler = (tokens, _req, res, next) => {
    const sid = crypto.randomBytes(24).toString("base64url");
    const id = decodeJwtPayload(tokens.id_token);
    const ac = decodeJwtPayload(tokens.access_token);
    const sess: WebSession = {
      accessToken: tokens.access_token,
      expiresAt: Date.now() + Math.min(tokens.expires_in * 1000, SESSION_TTL_MS),
      oid: (ac.oid ?? id.oid) as string | undefined,
      name: (id.name ?? ac.name) as string | undefined,
      upn: (id.preferred_username ?? ac.preferred_username ?? ac.upn) as string | undefined,
    };
    sessions.set(sid, sess);
    if (sess.oid) users.touch(sess.oid, { upn: sess.upn, name: sess.name }, "portal");
    const secure = cfg.baseUrl.startsWith("https") ? "; Secure" : "";
    res.setHeader(
      "Set-Cookie",
      `${SESSION_COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${secure}`
    );
    res.redirect(next || "/");
  };
  const getSession = (req: Request): { sid?: string; sess?: WebSession } => {
    const sid = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    const sess = sid ? sessions.get(sid) : undefined;
    if (sid && sess && sess.expiresAt < Date.now()) {
      sessions.delete(sid);
      return { sid };
    }
    return { sid, sess };
  };
  const profileSummary = () => {
    const enabled = allEndpoints.filter((d) => isToolEnabled(d, cfg));
    return {
      toolCount: enabled.length,
      writeToolCount: enabled.filter((d) => d.write).length,
      ...buildCapabilities(enabled),
    };
  };

  const app = express();
  app.use(express.json({ limit: "4mb" }));
  app.use(oauthProxy.router());

  // ── Landing page ────────────────────────────────────────────────────
  app.get("/", async (req: Request, res: Response) => {
    const { sess } = getSession(req);
    let user: { name?: string; mail?: string; upn?: string; jobTitle?: string; isAdmin?: boolean } | undefined;
    let graphOk: boolean | undefined;
    let graphError: string | undefined;
    if (sess) {
      user = { name: sess.name, upn: sess.upn, isAdmin: users.isAdmin(sess.oid) };
      if (obo) {
        try {
          const gt = await obo.getGraphToken(sess.accessToken);
          const me = await fetch(
            "https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName,jobTitle",
            { headers: { Authorization: `Bearer ${gt}` } }
          );
          if (me.ok) {
            const m = (await me.json()) as Record<string, string>;
            user = { name: m.displayName, mail: m.mail, upn: m.userPrincipalName, jobTitle: m.jobTitle, isAdmin: users.isAdmin(sess.oid) };
            graphOk = true;
          } else {
            graphError = `Graph /me HTTP ${me.status}`;
          }
        } catch (err) {
          graphError = err instanceof Error ? err.message : String(err);
        }
      } else {
        graphError = "A szerver Entra ID konfigurációja hiányos.";
      }
    }
    const sfConfigured = isSalesforceConfigured(cfg);
    const sfInfo = sfConfigured && sess?.oid ? sfAuth.info(sess.oid) : null;
    res.type("html").send(
      renderPortal({
        configured: isEntraConfigured(cfg),
        baseUrl: cfg.baseUrl,
        ...profileSummary(),
        user,
        graphOk,
        graphError,
        loginError: typeof req.query.login_error === "string" ? req.query.login_error : undefined,
        salesforce: sfConfigured
          ? {
              connected: !!sfInfo,
              info: sfInfo ?? undefined,
              loginUrl: cfg.salesforce.loginUrl,
              error: typeof req.query.sf_error === "string" ? req.query.sf_error : undefined,
              justConnected: req.query.sf === "connected",
              justDisconnected: req.query.sf === "disconnected",
            }
          : undefined,
      })
    );
  });

  // ── Optional Salesforce: link the signed-in user's own Salesforce login ──
  app.get("/auth/salesforce/connect", (req: Request, res: Response) => {
    const { sess } = getSession(req);
    if (!isSalesforceConfigured(cfg)) {
      res.redirect("/?sf_error=" + encodeURIComponent("A Salesforce-integráció nincs beállítva (admin: Salesforce Connected App)."));
      return;
    }
    if (!sess?.oid) {
      res.redirect("/?login_error=" + encodeURIComponent("Előbb jelentkezz be a Microsoft-fiókoddal, utána kötheted össze a Salesforce-ot."));
      return;
    }
    sfAuth.startConnect(sess.oid, sess.upn, res);
  });

  app.get("/auth/salesforce/callback", async (req: Request, res: Response) => {
    try {
      await sfAuth.handleCallback(req);
      res.redirect("/?sf=connected");
    } catch (err) {
      res.redirect("/?sf_error=" + encodeURIComponent(err instanceof Error ? err.message : String(err)));
    }
  });

  app.get("/auth/salesforce/disconnect", async (req: Request, res: Response) => {
    const { sess } = getSession(req);
    if (sess?.oid) await sfAuth.disconnect(sess.oid);
    res.redirect("/?sf=disconnected");
  });

  app.get("/login", (req: Request, res: Response) => {
    if (!isEntraConfigured(cfg)) {
      res.redirect("/?login_error=" + encodeURIComponent("Az Entra ID beállítás még hiányzik (lásd /admin)."));
      return;
    }
    oauthProxy.startWebLogin(res, typeof req.query.next === "string" ? req.query.next : "/");
  });

  app.get("/logout", (req: Request, res: Response) => {
    const { sid } = getSession(req);
    if (sid) sessions.delete(sid);
    res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; Max-Age=0`);
    res.redirect("/");
  });

  app.get("/ujdonsagok", (_req, res) => {
    res.type("html").send(renderChangelogPage(renderNav("/ujdonsagok"), PORTAL_STYLE));
  });

  app.get("/healthz", (_req, res) => {
    res.json({
      status: "ok",
      name: "m365-reporting-mcp",
      version: "1.0.0",
      configured: isEntraConfigured(cfg),
      salesforce: isSalesforceConfigured(cfg),
    });
  });

  // MCP resource metadata: this server is its own authorization server
  // (OAuth proxy in front of Entra) so ChatGPT-style DCR clients can connect.
  app.get("/.well-known/oauth-protected-resource", (_req, res) => {
    res.json({
      resource: `${cfg.baseUrl}/mcp`,
      authorization_servers: [cfg.baseUrl],
      bearer_methods_supported: ["header"],
      scopes_supported: [`api://${cfg.clientId}/access_as_user`],
      resource_documentation: `${cfg.baseUrl}/admin`,
    });
  });
  app.get("/.well-known/oauth-protected-resource/mcp", (_req, res) => {
    res.redirect(301, "/.well-known/oauth-protected-resource");
  });

  // ── MCP endpoint (stateless Streamable HTTP, per-request auth) ──────
  app.post("/mcp", async (req: Request, res: Response) => {
    if (!isEntraConfigured(cfg) || !validator || !obo) {
      res.status(503).json({
        error: "configuration_incomplete",
        error_description: "Entra ID settings are missing. Configure the server on /admin first.",
      });
      return;
    }
    const authHeader = req.headers.authorization ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) {
      res
        .status(401)
        .set("WWW-Authenticate", `Bearer resource_metadata="${cfg.baseUrl}/.well-known/oauth-protected-resource"`)
        .json({ error: "unauthorized", error_description: "Missing bearer token" });
      return;
    }
    let claims;
    try {
      claims = await validator.validate(token);
    } catch (err) {
      res
        .status(401)
        .set("WWW-Authenticate", `Bearer resource_metadata="${cfg.baseUrl}/.well-known/oauth-protected-resource"`)
        .json({
          error: "invalid_token",
          error_description: err instanceof Error ? err.message : "Token validation failed",
        });
      return;
    }

    const oboRef = obo;
    const oid = (claims.oid as string) ?? "";
    if (oid) users.touch(oid, { upn: userFromClaims(claims), name: claims.name as string | undefined }, "mcp");
    const ctx: ToolContext = {
      graph: new GraphClient(() => oboRef.getGraphToken(token)),
      audit,
      user: userFromClaims(claims),
      session: oid || randomUUID(),
      config: cfg,
      ...(isSalesforceConfigured(cfg) && oid
        ? {
            salesforce: {
              connectUrl: `${cfg.baseUrl}/`,
              client: () => sfAuth.clientFor(oid),
              info: () => sfAuth.info(oid),
            },
          }
        : {}),
    };

    const { server } = buildMcpServer(ctx);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
      console.error("MCP request error:", err);
    }
  });

  const methodNotAllowed = (_req: Request, res: Response) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed. This server runs in stateless mode - use POST /mcp." },
      id: null,
    });
  };
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  // ── Admin dashboard ─────────────────────────────────────────────────
  // Admin = signed-in Microsoft user flagged as admin in the user registry.
  // ADMIN_KEY (x-admin-key header) stays as bootstrap/fallback so the very
  // first admin can be created and the server can be configured headlessly.
  const hasAdminKey = (req: Request) => {
    const key = (req.headers["x-admin-key"] as string) ?? "";
    return !!cfg.adminKey && !!key && safeEqual(key, cfg.adminKey);
  };
  const adminPrincipal = (req: Request): { via: "session" | "key"; oid?: string; upn?: string; name?: string } | null => {
    const { sess } = getSession(req);
    if (sess?.oid && users.isAdmin(sess.oid)) return { via: "session", oid: sess.oid, upn: sess.upn, name: sess.name };
    if (hasAdminKey(req)) return { via: "key", oid: sess?.oid, upn: sess?.upn ?? "admin-key", name: sess?.name };
    return null;
  };
  const adminAuth = (req: Request, res: Response, next: NextFunction) => {
    const p = adminPrincipal(req);
    if (!p) {
      const { sess } = getSession(req);
      res.status(401).json({
        error: sess
          ? "Nem vagy admin. Kérj admin jogot egy meglévő admintól (Felhasználók fül), vagy add meg az admin kulcsot."
          : "Jelentkezz be a Microsoft-fiókoddal (adminként), vagy add meg az admin kulcsot.",
        loggedIn: !!sess,
      });
      return;
    }
    (req as Request & { admin?: typeof p }).admin = p;
    next();
  };

  app.get("/admin", (_req, res) => {
    res.type("html").send(ADMIN_HTML);
  });

  /** Who am I on the admin UI (no auth): drives the login/key bar. */
  app.get("/admin/api/me", (req, res) => {
    const { sess } = getSession(req);
    res.json({
      loggedIn: !!sess,
      name: sess?.name,
      upn: sess?.upn,
      isAdmin: users.isAdmin(sess?.oid),
      viaKey: !users.isAdmin(sess?.oid) && hasAdminKey(req),
      adminCount: users.adminCount(),
      keyConfigured: !!cfg.adminKey,
      entraConfigured: isEntraConfigured(cfg),
    });
  });

  /** Bootstrap: a signed-in user who knows ADMIN_KEY becomes admin (no admin needed yet). */
  app.post("/admin/api/claim-admin", (req, res) => {
    const { sess } = getSession(req);
    const key = String((req.body ?? {}).key ?? "");
    if (!sess?.oid) {
      res.status(401).json({ error: "Előbb jelentkezz be a Microsoft-fiókoddal." });
      return;
    }
    if (!cfg.adminKey || !safeEqual(key, cfg.adminKey)) {
      res.status(401).json({ error: "Hibás admin kulcs." });
      return;
    }
    users.touch(sess.oid, { upn: sess.upn, name: sess.name }, "portal");
    users.setAdmin(sess.oid, true, "admin-key");
    res.json({ ok: true, isAdmin: true });
  });

  app.get("/admin/api/users", adminAuth, (_req, res) => {
    res.json(
      users.list().map((u) => ({
        ...u,
        salesforce: sfAuth.info(u.oid),
      }))
    );
  });

  app.put("/admin/api/users/:oid", adminAuth, (req, res) => {
    const p = (req as Request & { admin?: ReturnType<typeof adminPrincipal> }).admin!;
    const b = (req.body ?? {}) as Record<string, unknown>;
    try {
      if (typeof b.isAdmin === "boolean") {
        const u = users.setAdmin(String(req.params.oid), b.isAdmin, p.upn ?? p.via);
        res.json({ ok: true, user: u });
        return;
      }
      res.status(400).json({ error: "Nothing to change (isAdmin expected)." });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.delete("/admin/api/users/:oid/salesforce", adminAuth, async (req, res) => {
    await sfAuth.disconnect(String(req.params.oid));
    res.json({ ok: true });
  });

  app.post("/admin/api/test-salesforce", adminAuth, async (req, res) => {
    const { sess } = getSession(req);
    try {
      res.json(await sfAuth.testApp(sess?.oid));
    } catch (err) {
      res.json({ ok: false, checks: [{ name: "config", ok: false, message: err instanceof Error ? err.message : String(err) }] });
    }
  });

  app.get("/admin/api/settings", adminAuth, (_req, res) => {
    res.json({
      tenantId: cfg.tenantId,
      clientId: cfg.clientId,
      clientSecretSet: !!cfg.clientSecret,
      baseUrl: cfg.baseUrl,
      port: cfg.port,
      readOnly: cfg.readOnly,
      enabledToolsets: cfg.enabledToolsets,
      defaultPageItems: cfg.defaultPageItems,
      maxPageItems: cfg.maxPageItems,
      maxDownloadBytes: cfg.maxDownloadBytes,
      toolsetsAvailable: ALL_TOOLSETS,
      configured: isEntraConfigured(cfg),
      registeredMcpClients: oauthProxy.registeredClientCount(),
      redirectUri: `${cfg.baseUrl}/auth/callback`,
      salesforce: {
        clientId: cfg.salesforce.clientId,
        clientSecretSet: !!cfg.salesforce.clientSecret,
        loginUrl: cfg.salesforce.loginUrl,
        scopes: cfg.salesforce.scopes,
        apiVersion: cfg.salesforce.apiVersion,
        callbackUrl: sfAuth.callbackUrl(),
        configured: isSalesforceConfigured(cfg),
        connectedUsers: sfAuth.connectedCount(),
      },
    });
  });

  app.put("/admin/api/settings", adminAuth, (req, res) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const patch: MutableSettings = {};
    if (typeof b.tenantId === "string") patch.tenantId = b.tenantId.trim();
    if (typeof b.clientId === "string") patch.clientId = b.clientId.trim();
    if (typeof b.clientSecret === "string") patch.clientSecret = b.clientSecret.trim();
    if (typeof b.baseUrl === "string" && b.baseUrl.trim()) patch.baseUrl = b.baseUrl.trim();
    if (typeof b.readOnly === "boolean") patch.readOnly = b.readOnly;
    if (b.enabledToolsets === null) patch.enabledToolsets = null;
    else if (Array.isArray(b.enabledToolsets)) {
      patch.enabledToolsets = b.enabledToolsets.filter(
        (t): t is string => typeof t === "string" && (ALL_TOOLSETS as string[]).includes(t)
      );
    }
    for (const k of ["defaultPageItems", "maxPageItems", "maxDownloadBytes"] as const) {
      const v = Number(b[k]);
      if (Number.isFinite(v) && v > 0) patch[k] = Math.floor(v);
    }
    // Optional Salesforce Connected App (empty secret = keep, empty key = integration off).
    if (typeof b.salesforceClientId === "string") patch.salesforceClientId = b.salesforceClientId.trim();
    if (typeof b.salesforceClientSecret === "string") patch.salesforceClientSecret = b.salesforceClientSecret.trim();
    if (typeof b.salesforceLoginUrl === "string") {
      const u = b.salesforceLoginUrl.trim().replace(/\/+$/, "");
      if (!u || /^https:\/\/[a-z0-9.-]+$/i.test(u)) patch.salesforceLoginUrl = u;
    }
    if (typeof b.salesforceScopes === "string") patch.salesforceScopes = b.salesforceScopes.trim();
    if (typeof b.salesforceApiVersion === "string" && /^(v\d+\.\d+)?$/.test(b.salesforceApiVersion.trim())) {
      patch.salesforceApiVersion = b.salesforceApiVersion.trim();
    }
    store.save(patch);
    applySettings();
    res.json({ ok: true, configured: isEntraConfigured(cfg) });
  });

  // Validates tenant/client/secret with a client-credentials token request.
  app.post("/admin/api/test-connection", adminAuth, async (_req, res) => {
    if (!isEntraConfigured(cfg)) {
      res.json({ ok: false, message: "Tenant ID, Client ID es Client Secret megadasa szukseges." });
      return;
    }
    try {
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
      if (r.ok && data.access_token) {
        res.json({ ok: true, message: "Entra ID kapcsolat rendben (tenant, client ID es secret ervenyes)." });
      } else {
        res.json({
          ok: false,
          message: `${data.error ?? r.status}: ${String(data.error_description ?? "ismeretlen hiba").split("\n")[0]}`,
        });
      }
    } catch (err) {
      res.json({ ok: false, message: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/admin/api/tools", adminAuth, (_req, res) => {
    const tools = allEndpoints
      .filter((d) => isToolEnabled(d, cfg))
      .map((d) => ({
        name: d.name,
        toolset: d.toolset,
        write: !!d.write,
        method: d.method,
        path: d.provider === "salesforce" ? `Salesforce ${d.path}` : d.path,
        scopes: d.scopes,
        description: d.description,
      }));
    res.json(tools);
  });

  app.get("/admin/api/audit/days", adminAuth, (_req, res) => {
    res.json(audit.listDays());
  });

  app.get("/admin/api/audit", adminAuth, (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 200, 2000);
    const day = typeof req.query.day === "string" && req.query.day ? req.query.day : undefined;
    const user = typeof req.query.user === "string" ? req.query.user.toLowerCase() : "";
    const tool = typeof req.query.tool === "string" ? req.query.tool.toLowerCase() : "";
    let entries = day ? audit.readDay(day, 5000) : audit.getRecent(2000);
    if (day) entries = entries.reverse(); // newest first, like getRecent
    if (user) entries = entries.filter((e) => e.user.toLowerCase().includes(user));
    if (tool) entries = entries.filter((e) => e.tool.toLowerCase().includes(tool));
    res.json(entries.slice(0, limit));
  });

  app.listen(cfg.port, () => {
    console.log(`m365-reporting-mcp listening on ${cfg.baseUrl}`);
    console.log(`  MCP endpoint : POST ${cfg.baseUrl}/mcp (bearer token required)`);
    console.log(`  OAuth proxy  : ${cfg.baseUrl}/.well-known/oauth-authorization-server (DCR-capable clients: ChatGPT, Claude)`);
    console.log(`  Admin UI     : ${cfg.baseUrl}/admin`);
    if (!isEntraConfigured(cfg)) {
      console.log(`  NOTE: Entra ID is NOT configured yet - open ${cfg.baseUrl}/admin to set it up.`);
    }
    console.log(`  Salesforce   : ${isSalesforceConfigured(cfg) ? `optional toolset ON (callback ${sfAuth.callbackUrl()})` : "off (no Connected App configured)"}`);
  });
}
