import { z } from "zod";
import type { EndpointDef } from "../types.js";

/**
 * Entra (AD) groups: list every group of the tenant with its owners, read one
 * group, and list a group's owners / members. Read-only; the delegated
 * GroupMember.Read.All / Directory.Read.All scopes (admin consent) apply.
 */

const GROUP_SELECT =
  "id,displayName,description,mail,mailNickname,mailEnabled,securityEnabled,groupTypes,visibility,resourceProvisioningOptions,membershipRule,onPremisesSyncEnabled,createdDateTime";
const PRINCIPAL_SELECT = "id,displayName,userPrincipalName,mail,jobTitle,accountEnabled";
/** Graph returns at most 20 objects for an expanded directory relationship. */
const EXPAND_LIMIT = 20;

type AnyObj = Record<string, any>;

/** Human-readable group kind, same naming as get-user-access-report. */
export function groupKind(g: AnyObj): string {
  const types: string[] = g.groupTypes ?? [];
  if (types.includes("Unified")) return (g.resourceProvisioningOptions ?? []).includes("Team") ? "Team" : "M365 group";
  if (g.securityEnabled && g.mailEnabled) return "mail-enabled security group";
  if (g.securityEnabled) return "security group";
  if (g.mailEnabled) return "distribution list";
  return "unknown";
}

const principal = (o: AnyObj) => ({
  type: String(o["@odata.type"] ?? "").replace("#microsoft.graph.", "") || undefined,
  id: o.id,
  displayName: o.displayName,
  userPrincipalName: o.userPrincipalName,
  mail: o.mail,
  ...(o.accountEnabled === false ? { accountEnabled: false } : {}),
});

function shapeGroup(g: AnyObj, withOwners: boolean) {
  const owners: AnyObj[] | undefined = withOwners ? g.owners ?? [] : undefined;
  return {
    id: g.id,
    displayName: g.displayName,
    kind: groupKind(g),
    description: g.description || undefined,
    mail: g.mail || undefined,
    visibility: g.visibility || undefined,
    dynamic: (g.groupTypes ?? []).includes("DynamicMembership") || undefined,
    membershipRule: g.membershipRule || undefined,
    syncedFromOnPrem: g.onPremisesSyncEnabled || undefined,
    createdDateTime: g.createdDateTime,
    ...(owners
      ? {
          ownerCount: owners.length,
          owners: owners.map(principal),
          ...(owners.length >= EXPAND_LIMIT ? { ownersTruncated: true } : {}),
        }
      : {}),
    _source: g._source,
  };
}

export const groupsEndpoints: EndpointDef[] = [
  {
    name: "list-groups",
    description:
      "List ALL Entra (AD) groups of the organization - Teams, Microsoft 365 groups, security groups, mail-enabled security groups, distribution lists - WITH their owners (includeOwners, default true). Each item has kind, mail, visibility, dynamic membership rule, owners[] (user/service principal) and ownerCount; ownerless groups have ownerCount 0. Owners come from an expand that Graph caps at 20 per group: when ownersTruncated=true call list-group-owners. Filter by kind or by $filter, e.g. \"startswith(displayName,'AV')\", \"mailEnabled eq false\". Paged: follow nextCursor for the rest.",
    toolset: "users",
    scopes: ["GroupMember.Read.All", "Directory.Read.All"],
    method: "GET",
    path: "/groups",
    resourceType: "group",
    paginated: true,
    maxTop: 100,
    defaultSelect: GROUP_SELECT,
    query: { filter: true },
    sourceType: "group",
    extraInput: {
      includeOwners: z.boolean().optional().describe("Return each group's owners (default true)"),
      kind: z
        .enum(["team", "m365", "security", "distribution"])
        .optional()
        .describe("Only one kind of group: team / m365 (all Microsoft 365 groups incl. Teams) / security / distribution (mail-enabled, not security)"),
    },
    buildQuery: (args) => {
      const kindFilter: Record<string, string> = {
        team: "groupTypes/any(c:c eq 'Unified')",
        m365: "groupTypes/any(c:c eq 'Unified')",
        security: "securityEnabled eq true",
        distribution: "mailEnabled eq true and securityEnabled eq false",
      };
      return {
        ...(args.kind ? { $filter: kindFilter[args.kind] } : {}),
        ...(args.includeOwners === false ? {} : { $expand: `owners($select=${PRINCIPAL_SELECT})` }),
      };
    },
    transform: (data: any, args) => {
      let items = (data.items ?? []).map((g: AnyObj) => shapeGroup(g, args.includeOwners !== false));
      // Teams provisioning is not filterable server-side; narrow the Unified groups here.
      if (args.kind === "team") items = items.filter((g: AnyObj) => g.kind === "Team");
      return {
        ...data,
        count: items.length,
        ...(args.includeOwners !== false
          ? { ownerlessGroups: items.filter((g: AnyObj) => g.ownerCount === 0).length }
          : {}),
        items,
      };
    },
  },
  {
    name: "get-group",
    description: "Get one Entra group by object id, with its kind and owners.",
    toolset: "users",
    scopes: ["GroupMember.Read.All", "Directory.Read.All"],
    method: "GET",
    path: "/groups/{groupId}",
    pathParamDescriptions: { groupId: "Entra group object id (from list-groups)" },
    resourceType: "group",
    defaultSelect: GROUP_SELECT,
    query: { expand: `owners($select=${PRINCIPAL_SELECT})` },
    sourceType: "group",
    transform: (g: any) => shapeGroup(g, true),
  },
  {
    name: "list-group-owners",
    description: "List ALL owners of an Entra group (users and service principals), without the 20-owner cap of list-groups.",
    toolset: "users",
    scopes: ["GroupMember.Read.All", "Directory.Read.All"],
    method: "GET",
    path: "/groups/{groupId}/owners",
    pathParamDescriptions: { groupId: "Entra group object id (from list-groups)" },
    resourceType: "directoryObject",
    paginated: true,
    maxTop: 100,
    defaultSelect: PRINCIPAL_SELECT,
    transform: (data: any) => ({ ...data, items: (data.items ?? []).map(principal) }),
  },
  {
    name: "list-group-members",
    description:
      "List the direct members of an Entra group (users, nested groups, devices, service principals). Nested groups are listed as members, not expanded.",
    toolset: "users",
    scopes: ["GroupMember.Read.All", "Directory.Read.All"],
    method: "GET",
    path: "/groups/{groupId}/members",
    pathParamDescriptions: { groupId: "Entra group object id (from list-groups)" },
    resourceType: "directoryObject",
    paginated: true,
    maxTop: 999,
    defaultSelect: PRINCIPAL_SELECT,
    transform: (data: any) => ({ ...data, items: (data.items ?? []).map(principal) }),
  },
];
