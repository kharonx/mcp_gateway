import { z } from "zod";
import type { EndpointDef } from "../types.js";
import { flattenSearchResponse } from "./search.js";

/**
 * Microsoft Loop adapter (spec section 13).
 *
 * IMPORTANT implementation honesty: Microsoft Graph has NO generally available
 * dedicated Loop workspace API today. Loop components (.loop/.fluid files) are
 * stored in SharePoint/OneDrive, so this adapter goes through the Search API
 * and the drive tools instead of fictional Graph endpoints. Loop workspaces
 * backed by SharePoint Embedded containers may not be reachable at all with
 * delegated Graph permissions - surface that limitation to the user instead of
 * fabricating results.
 */
export const loopEndpoints: EndpointDef[] = [
  {
    name: "search-loop-components",
    description:
      "Search Microsoft Loop components (.loop/.fluid files stored in SharePoint/OneDrive) by keyword. " +
      "Note: Loop workspaces in SharePoint Embedded containers are not exposed via delegated Graph and may be missing from results.",
    toolset: "loop",
    scopes: ["Files.Read.All", "Sites.Read.All"],
    method: "POST",
    path: "/search/query",
    resourceType: "loopComponent",
    extraInput: {
      query: z.string().describe("Keyword to search for in Loop components"),
      from: z.number().int().min(0).optional().describe("Result offset (default 0)"),
      size: z.number().int().min(1).max(100).optional().describe("Number of results (default 25)"),
    },
    buildBody: (args) => ({
      requests: [
        {
          entityTypes: ["driveItem"],
          query: { queryString: `(${args.query}) AND (filetype:loop OR filetype:fluid)` },
          from: args.from ?? 0,
          size: args.size ?? 25,
        },
      ],
    }),
    transform: (data) => flattenSearchResponse(data),
  },
  {
    name: "get-loop-component-content",
    description:
      "Download a Loop component's raw content by driveId + itemId (from search-loop-components hit resource.parentReference). Content is Fluid/JSON-like text.",
    toolset: "loop",
    scopes: ["Files.Read.All"],
    method: "GET",
    path: "/drives/{driveId}/items/{itemId}/content",
    resourceType: "loopComponent",
    binary: true,
    extraInput: {
      fileName: z.string().optional().describe("File name, e.g. board.loop (helps text decoding)"),
    },
  },
];
