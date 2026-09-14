import fs from "node:fs";
import path from "node:path";

/**
 * Known users of the gateway: everyone who signed in on the portal or called
 * the MCP endpoint with a valid Entra token, keyed by Entra object id.
 * Admin rights live here too - an admin promotes other already-seen users on
 * the admin "Felhasznalok" tab. ADMIN_KEY remains a bootstrap/fallback only.
 */
/**
 * Per-user access profile. `toolsets` is an allowlist applied ON TOP of the
 * gateway-wide toolset switches (null = every globally enabled toolset);
 * `readOnly` removes every WRITE tool for this user; `blocked` refuses MCP
 * calls entirely (the portal and admin UI stay reachable).
 */
export interface UserAccess {
  toolsets: string[] | null;
  readOnly: boolean;
  blocked?: boolean;
  setBy?: string;
  setAt?: string;
}

/** Resolve what a user may do: their own profile, or the gateway default for users without one. */
export function effectiveAccess(
  user: KnownUser | undefined,
  defaults: { toolsets: string[] | null; readOnly: boolean }
): UserAccess {
  if (user?.access) return user.access;
  return { toolsets: defaults.toolsets, readOnly: defaults.readOnly };
}

export interface KnownUser {
  oid: string;
  upn?: string;
  name?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  lastPortalLoginAt?: string;
  lastMcpCallAt?: string;
  mcpRequests: number;
  isAdmin: boolean;
  adminGrantedBy?: string;
  adminGrantedAt?: string;
  /** Individual access profile; absent = the gateway default applies. */
  access?: UserAccess;
}

export class UserRegistry {
  private users = new Map<string, KnownUser>();
  private lastWrite = 0;
  private dirty = false;

  constructor(private file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file)) {
      try {
        for (const u of JSON.parse(fs.readFileSync(file, "utf8")) as KnownUser[]) this.users.set(u.oid, u);
      } catch {
        /* corrupted store - start empty */
      }
    }
  }

  private persist(force = false): void {
    this.dirty = true;
    // MCP traffic can be chatty: coalesce writes to one per 5 s unless forced.
    if (!force && Date.now() - this.lastWrite < 5000) return;
    fs.writeFileSync(this.file, JSON.stringify([...this.users.values()], null, 2), { encoding: "utf8", mode: 0o600 });
    this.lastWrite = Date.now();
    this.dirty = false;
  }

  /** Record a sighting. Returns the (possibly new) user record. */
  touch(oid: string, info: { upn?: string; name?: string }, source: "portal" | "mcp"): KnownUser {
    if (!oid) throw new Error("oid required");
    const now = new Date().toISOString();
    let u = this.users.get(oid);
    if (!u) {
      u = { oid, firstSeenAt: now, lastSeenAt: now, mcpRequests: 0, isAdmin: false };
      this.users.set(oid, u);
    }
    if (info.upn) u.upn = info.upn;
    if (info.name) u.name = info.name;
    u.lastSeenAt = now;
    if (source === "portal") u.lastPortalLoginAt = now;
    else {
      u.lastMcpCallAt = now;
      u.mcpRequests++;
    }
    this.persist(source === "portal");
    return u;
  }

  get(oid: string): KnownUser | undefined {
    return this.users.get(oid);
  }

  list(): KnownUser[] {
    return [...this.users.values()].sort((a, b) => (a.lastSeenAt < b.lastSeenAt ? 1 : -1));
  }

  isAdmin(oid: string | undefined): boolean {
    return !!oid && !!this.users.get(oid)?.isAdmin;
  }

  adminCount(): number {
    return [...this.users.values()].filter((u) => u.isAdmin).length;
  }

  /** Grant/revoke admin. Refuses to remove the last admin. */
  setAdmin(oid: string, isAdmin: boolean, grantedBy: string): KnownUser {
    const u = this.users.get(oid);
    if (!u) throw new Error("Unknown user - the user must sign in on the portal (or call the MCP) first.");
    if (!isAdmin && u.isAdmin && this.adminCount() <= 1) {
      throw new Error("Cannot remove the last admin. Promote another user first.");
    }
    u.isAdmin = isAdmin;
    if (isAdmin) {
      u.adminGrantedBy = grantedBy;
      u.adminGrantedAt = new Date().toISOString();
    } else {
      delete u.adminGrantedBy;
      delete u.adminGrantedAt;
    }
    this.persist(true);
    return u;
  }

  /** Set (or with null: clear) a user's individual access profile. */
  setAccess(oid: string, access: Omit<UserAccess, "setBy" | "setAt"> | null, by: string): KnownUser {
    const u = this.users.get(oid);
    if (!u) throw new Error("Unknown user - the user must sign in on the portal (or call the MCP) first.");
    if (access === null) delete u.access;
    else {
      u.access = {
        toolsets: access.toolsets === null ? null : [...new Set(access.toolsets)],
        readOnly: !!access.readOnly,
        ...(access.blocked ? { blocked: true } : {}),
        setBy: by,
        setAt: new Date().toISOString(),
      };
    }
    this.persist(true);
    return u;
  }

  /** Flush a pending coalesced write (call on shutdown / after admin actions). */
  flush(): void {
    if (this.dirty) this.persist(true);
  }
}
