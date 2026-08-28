import { z } from "zod";
import type { EndpointDef } from "../types.js";

const USER_SELECT =
  "id,displayName,givenName,surname,mail,userPrincipalName,jobTitle,department,officeLocation,mobilePhone,businessPhones,accountEnabled,userType";

/**
 * Identity resolution (spec section 15): display name -> Entra user -> email,
 * user id, Teams identity, meeting participant, document author.
 */
export const usersEndpoints: EndpointDef[] = [
  {
    name: "list-users",
    description:
      "List ALL users of the organization including disabled accounts (accountEnabled=false) and guests. Paged: for directories larger than maxItems follow nextCursor. Supports $filter (e.g. \"accountEnabled eq false\") and advanced $search.",
    toolset: "users",
    scopes: ["User.Read.All"],
    method: "GET",
    path: "/users",
    resourceType: "user",
    paginated: true,
    maxTop: 999,
    defaultSelect: USER_SELECT,
    query: { filter: true, orderby: true, select: true },
    consistencyLevel: true,
    sourceType: "user",
  },
  {
    name: "get-user",
    description: "Get a user by object id or userPrincipalName (email).",
    toolset: "users",
    scopes: ["User.Read.All"],
    method: "GET",
    path: "/users/{userIdOrUpn}",
    pathParamDescriptions: { userIdOrUpn: "Entra object id or userPrincipalName, e.g. kiss.peter@ceg.hu" },
    resourceType: "user",
    defaultSelect: USER_SELECT,
    query: { select: true },
    sourceType: "user",
  },
  {
    name: "get-user-account-status-history",
    description:
      "When was a user DISABLED (or re-enabled), by whom, with what result? Reads the Entra directory audit log (category UserManagement) for the given user and returns only the events that changed accountEnabled: 'Disable account' / 'Enable account' activities and 'Update user' events whose modifiedProperties contain AccountEnabled (true -> false = disabled). Other user updates are excluded. Newest first. RETENTION: Entra keeps directory audits 30 days (P1/P2; 7 days Free) - if the change is older the result is explicitly 'not available in audit log'; no date is estimated. Read-only; needs delegated AuditLog.Read.All + Directory.Read.All with admin consent and a reader role (Reports Reader / Security Reader / Global Reader).",
    toolset: "users",
    scopes: ["AuditLog.Read.All", "Directory.Read.All"],
    method: "GET",
    path: "/auditLogs/directoryAudits",
    resourceType: "directoryAudit",
    paginated: true,
    timeFilterProperty: "activityDateTime",
    sourceType: "directoryAudit",
    extraInput: {
      userIdOrUpn: z.string().describe("Entra object id or userPrincipalName of the target user, e.g. kiss.peter@ceg.hu"),
      change: z
        .enum(["disabled", "enabled", "any"])
        .optional()
        .describe("Which state changes to return: disabled (true->false), enabled (false->true) or any (default)"),
    },
    buildQuery: (args) => {
      const u = String(args.userIdOrUpn).replace(/'/g, "''");
      const target = u.includes("@")
        ? `targetResources/any(t:t/userPrincipalName eq '${u}')`
        : `targetResources/any(t:t/id eq '${u}')`;
      const acts = ["Disable account", "Enable account", "Update user"].map((a) => `activityDisplayName eq '${a}'`).join(" or ");
      return { $filter: `category eq 'UserManagement' and (${acts}) and ${target}`, $orderby: "activityDateTime desc" };
    },
    transform: (data: any, args) => {
      const want = args.change ?? "any";
      const items = (data.items ?? [])
        .map((e: any) => {
          const target = (e.targetResources ?? []).find((t: any) => t.type === "User") ?? e.targetResources?.[0];
          const props: any[] = target?.modifiedProperties ?? [];
          const ae = props.find((p) => p.displayName === "AccountEnabled");
          const parse = (v: unknown) => {
            try { return JSON.parse(String(v)); } catch { return v; }
          };
          const oldV = ae ? parse(ae.oldValue) : undefined;
          const newV = ae ? parse(ae.newValue) : undefined;
          const enabledNow = Array.isArray(newV) ? newV[0] : newV;
          const enabledBefore = Array.isArray(oldV) ? oldV[0] : oldV;
          let stateChange: "disabled" | "enabled" | undefined;
          if (e.activityDisplayName === "Disable account" || enabledNow === false) stateChange = "disabled";
          else if (e.activityDisplayName === "Enable account" || enabledNow === true) stateChange = "enabled";
          if (!stateChange) return null; // an 'Update user' that did not touch AccountEnabled
          return {
            stateChange,
            activityDateTime: e.activityDateTime,
            activityDisplayName: e.activityDisplayName,
            category: e.category,
            result: e.result,
            resultReason: e.resultReason,
            initiatedBy: e.initiatedBy?.user
              ? { type: "user", id: e.initiatedBy.user.id, userPrincipalName: e.initiatedBy.user.userPrincipalName, displayName: e.initiatedBy.user.displayName, ipAddress: e.initiatedBy.user.ipAddress }
              : e.initiatedBy?.app
                ? { type: "app", id: e.initiatedBy.app.appId ?? e.initiatedBy.app.servicePrincipalId, displayName: e.initiatedBy.app.displayName }
                : undefined,
            target: target ? { id: target.id, userPrincipalName: target.userPrincipalName, displayName: target.displayName, type: target.type } : undefined,
            accountEnabled: ae ? { oldValue: enabledBefore, newValue: enabledNow } : undefined,
            modifiedProperties: props,
            targetResources: e.targetResources,
            auditId: e.id,
            correlationId: e.correlationId,
            loggedByService: e.loggedByService,
            _source: e._source,
          };
        })
        .filter((x: any) => x && (want === "any" || x.stateChange === want));
      const latestDisable = items.find((x: any) => x.stateChange === "disabled");
      return {
        user: args.userIdOrUpn,
        count: items.length,
        truncated: data.truncated,
        ...(data.nextCursor ? { nextCursor: data.nextCursor, note: data.note } : {}),
        disabledAt: latestDisable?.activityDateTime ?? null,
        disabledBy: latestDisable?.initiatedBy ?? null,
        availability:
          items.length > 0
            ? "found-in-audit-log"
            : "not-available-in-audit-log: no accountEnabled change for this user within the directory audit retention window (30 days on Entra ID P1/P2, 7 days on Free). The change is older or never happened; no date is estimated - check get-user for the current accountEnabled state.",
        items,
      };
    },
  },
  {
    name: "list-directory-audits",
    description:
      "Entra directory audit log (who changed what, when): user/group/app changes, password resets, role assignments. Time filter on activityDateTime; $filter e.g. \"category eq 'UserManagement' and activityDisplayName eq 'Update user'\" or \"targetResources/any(t:t/id eq '<userId>')\". Retention: 30 days (P1/P2). Read-only; needs AuditLog.Read.All + Directory.Read.All (admin consent).",
    toolset: "users",
    scopes: ["AuditLog.Read.All", "Directory.Read.All"],
    method: "GET",
    path: "/auditLogs/directoryAudits",
    resourceType: "directoryAudit",
    paginated: true,
    defaultOrderby: "activityDateTime desc",
    timeFilterProperty: "activityDateTime",
    query: { filter: true, orderby: true },
    sourceType: "directoryAudit",
  },
  {
    name: "search-users",
    description:
      'Resolve a person by (partial) display name or email, e.g. "Móré Attila" -> Entra user with email + id. Use search-people first for fuzzy matches among the user\'s contacts.',
    toolset: "users",
    scopes: ["User.Read.All"],
    method: "GET",
    path: "/users",
    resourceType: "user",
    paginated: true,
    defaultSelect: USER_SELECT,
    consistencyLevel: true,
    sourceType: "user",
    extraInput: { name: z.string().describe("Display name fragment or email address") },
    buildQuery: (args) => {
      const n = String(args.name).replace(/"/g, "");
      return { $search: `"displayName:${n}" OR "mail:${n}" OR "userPrincipalName:${n}"` };
    },
  },
];
