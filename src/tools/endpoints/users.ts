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
