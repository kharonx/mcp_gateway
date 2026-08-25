import { z } from "zod";
import type { EndpointDef } from "../types.js";

/**
 * Microsoft Search API (cross-source). Per spec section 14 the Search result
 * is a pointer, not the final content: after a hit, fetch the full object with
 * the dedicated tool of that source (get-mail-message, download-drive-item, ...).
 */

export function flattenSearchResponse(data: any): unknown {
  const hits: unknown[] = [];
  for (const value of data?.value ?? []) {
    for (const container of value?.hitsContainers ?? []) {
      for (const hit of container?.hits ?? []) {
        const resource = hit?.resource ?? {};
        hits.push({
          rank: hit?.rank,
          summary: hit?.summary,
          entityType: resource["@odata.type"]?.replace("#microsoft.graph.", ""),
          resource,
          _source: {
            sourceType: "searchHit",
            sourceId: resource.id ?? hit?.hitId,
            sourceUrl: resource.webUrl ?? resource.webLink,
            title: resource.subject ?? resource.name ?? resource.displayName,
          },
        });
      }
    }
  }
  const total = data?.value?.[0]?.hitsContainers?.[0]?.total;
  const moreAvailable = data?.value?.[0]?.hitsContainers?.[0]?.moreResultsAvailable;
  return {
    total,
    moreAvailable,
    note: "Search hits are pointers - fetch full content with the dedicated tool of the source (e.g. get-mail-message, get-calendar-event, download-drive-item, get-chat-message).",
    hits,
  };
}

const ENTITY_TYPES = ["message", "event", "chatMessage", "driveItem", "drive", "site", "list", "listItem"] as const;

export const searchEndpoints: EndpointDef[] = [
  {
    name: "search-m365",
    description:
      "Cross-source Microsoft 365 search (Mail, Calendar, Teams messages, SharePoint, OneDrive). KQL supported. " +
      "Restriction from Graph: driveItem/drive/site/list/listItem can be combined in one call; message, event and chatMessage must each be searched in a SEPARATE call. " +
      "Use the returned pointers with dedicated tools to fetch full content.",
    toolset: "search",
    scopes: ["Mail.Read", "Calendars.Read", "Chat.Read", "Sites.Read.All", "Files.Read.All"],
    method: "POST",
    path: "/search/query",
    resourceType: "searchQuery",
    extraInput: {
      query: z.string().describe('Search query (KQL supported), e.g. "AI Workshop 3.0"'),
      entityTypes: z
        .array(z.enum(ENTITY_TYPES))
        .optional()
        .describe('Entity types to search (default ["driveItem","site","listItem"]). message/event/chatMessage must be searched alone.'),
      from: z.number().int().min(0).optional().describe("Result offset for paging (default 0)"),
      size: z.number().int().min(1).max(100).optional().describe("Number of results (default 25)"),
    },
    buildBody: (args) => ({
      requests: [
        {
          entityTypes: args.entityTypes?.length ? args.entityTypes : ["driveItem", "site", "listItem"],
          query: { queryString: args.query },
          from: args.from ?? 0,
          size: args.size ?? 25,
        },
      ],
    }),
    transform: (data) => flattenSearchResponse(data),
  },
  {
    name: "search-people",
    description:
      "Search people relevant to the signed-in user (colleagues, frequent contacts). Good first step for fuzzy name resolution.",
    toolset: "search",
    scopes: ["People.Read"],
    method: "GET",
    path: "/me/people",
    resourceType: "person",
    paginated: true,
    defaultSelect: "id,displayName,jobTitle,department,scoredEmailAddresses,userPrincipalName,personType",
    extraInput: { query: z.string().optional().describe("Name fragment to search for") },
    buildQuery: (args) => (args.query ? { $search: `"${String(args.query).replace(/"/g, "")}"` } : {}),
  },
];
