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
import { renderPortal, buildCapabilities } from "./portalUi.js";
import { allEndpoints } from "../tools/endpoints/all.js";
import { WRITE_TOOLSETS, type Toolset, type ToolContext } from "../tools/types.js";
import { SettingsStore, isEntraConfigured, type MutableSettings } from "../settings.js";
import type { AppConfig } from "../config.js";

const ALL_TOOLSETS: Toolset[] = [
  "mail",
  "shared-mail",
  "mail-write",
  "shared-mail-write",
  "calendar",
  "teams",
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

  // ── Web portal sessions (landing-page Microsoft login) ──────────────
  const sessions = new Map<string, WebSession>();
  oauthProxy.webLoginHandler = (tokens, _req, res) => {
    const sid = crypto.randomBytes(24).toString("base64url");
    const id = decodeJwtPayload(tokens.id_token);
    const ac = decodeJwtPayload(tokens.access_token);
    sessions.set(sid, {
      accessToken: tokens.access_token,
      expiresAt: Date.now() + Math.min(tokens.expires_in * 1000, SESSION_TTL_MS),
      name: (id.name ?? ac.name) as string | undefined,
      upn: (id.preferred_username ?? ac.preferred_username ?? ac.upn) as string | undefined,
    });
    const secure = cfg.baseUrl.startsWith("https") ? "; Secure" : "";
    res.setHeader(
      "Set-Cookie",
      `${SESSION_COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${secure}`
    );
    res.redirect("/");
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
    const enabled = allEndpoints.filter((d) => {
      if (cfg.readOnly && (d.write || WRITE_TOOLSETS.includes(d.toolset))) return false;
      if (cfg.enabledToolsets && !cfg.enabledToolsets.includes(d.toolset)) return false;
      return true;
    });
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
    let user: { name?: string; mail?: string; upn?: string; jobTitle?: string } | undefined;
    let graphOk: boolean | undefined;
    let graphError: string | undefined;
    if (sess) {
      user = { name: sess.name, upn: sess.upn };
      if (obo) {
        try {
          const gt = await obo.getGraphToken(sess.accessToken);
          const me = await fetch(
            "https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName,jobTitle",
            { headers: { Authorization: `Bearer ${gt}` } }
          );
          if (me.ok) {
            const m = (await me.json()) as Record<string, string>;
            user = { name: m.displayName, mail: m.mail, upn: m.userPrincipalName, jobTitle: m.jobTitle };
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
    res.type("html").send(
      renderPortal({
        configured: isEntraConfigured(cfg),
        baseUrl: cfg.baseUrl,
        ...profileSummary(),
        user,
        graphOk,
        graphError,
        loginError: typeof req.query.login_error === "string" ? req.query.login_error : undefined,
      })
    );
  });

  app.get("/login", (_req: Request, res: Response) => {
    if (!isEntraConfigured(cfg)) {
      res.redirect("/?login_error=" + encodeURIComponent("Az Entra ID beállítás még hiányzik (lásd /admin)."));
      return;
    }
    oauthProxy.startWebLogin(res);
  });

  app.get("/logout", (req: Request, res: Response) => {
    const { sid } = getSession(req);
    if (sid) sessions.delete(sid);
    res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; Max-Age=0`);
    res.redirect("/");
  });

  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok", name: "m365-reporting-mcp", version: "1.0.0", configured: isEntraConfigured(cfg) });
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
    const ctx: ToolContext = {
      graph: new GraphClient(() => oboRef.getGraphToken(token)),
      audit,
      user: userFromClaims(claims),
      session: (claims.oid as string) ?? randomUUID(),
      config: cfg,
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
  const adminAuth = (req: Request, res: Response, next: NextFunction) => {
    const key = (req.headers["x-admin-key"] as string) ?? "";
    if (!cfg.adminKey || !safeEqual(key, cfg.adminKey)) {
      res.status(401).json({ error: "Invalid or missing x-admin-key header (set ADMIN_KEY in .env)" });
      return;
    }
    next();
  };

  app.get("/admin", (_req, res) => {
    res.type("html").send(ADMIN_HTML);
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
      .filter((d) => {
        if (cfg.readOnly && (d.write || WRITE_TOOLSETS.includes(d.toolset))) return false;
        if (cfg.enabledToolsets && !cfg.enabledToolsets.includes(d.toolset)) return false;
        return true;
      })
      .map((d) => ({
        name: d.name,
        toolset: d.toolset,
        write: !!d.write,
        method: d.method,
        path: d.path,
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
  });
}
