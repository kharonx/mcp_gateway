import { z } from "zod";
import type { EndpointDef } from "../types.js";
import { CHANGELOG, buildInfo } from "../../server/changelog.js";

/**
 * Gateway self-description. Always registered (no toolset switch, no provider
 * requirement), so an AI client can find out what THIS gateway offers right
 * now even when the tool list it cached at connect time is older than the
 * deployed build. See mcp.ts buildInstructions for the matching guidance.
 */
export const gatewayEndpoints: EndpointDef[] = [
  {
    name: "get-gateway-info",
    description:
      "What this AV MCP Gateway offers RIGHT NOW: build/version, the enabled toolsets with tool counts, whether the caller's Salesforce login is linked, and the latest 'Újdonságok' changelog entries. Call it FIRST when the user says the gateway was updated, when a capability you expect seems missing, or when you are unsure what is enabled - the tool list your client holds may be older than this gateway. If it lists tools you do not have, tell the user to reconnect the connector (ChatGPT: Disconnect/Connect; Claude: Connectors -> Disconnect/Connect; Claude Code: /mcp -> reconnect). Read-only, no side effects.",
    toolset: "gateway",
    provider: "gateway",
    scopes: [],
    method: "GET",
    path: "/gateway/info",
    resourceType: "gateway",
    extraInput: {
      changelogEntries: z.number().int().min(1).max(20).optional().describe("How many changelog entries to include (default 5)"),
    },
    handler: async (args, ctx) => {
      const enabled = ctx.enabledTools ?? [];
      const byToolset = new Map<string, { tools: number; write: number }>();
      for (const d of enabled) {
        const e = byToolset.get(d.toolset) ?? { tools: 0, write: 0 };
        e.tools++;
        if (d.write) e.write++;
        byToolset.set(d.toolset, e);
      }
      const n = Math.min(Number(args.changelogEntries) || 5, 20);
      const build = buildInfo();
      return {
        name: "av-mcp-gateway",
        version: build.version,
        build: { commit: build.commit, deployed: build.date },
        readOnlyMode: ctx.config.readOnly,
        toolCount: enabled.length,
        writeToolCount: enabled.filter((d) => d.write).length,
        toolsets: [...byToolset.entries()].map(([toolset, e]) => ({ toolset, tools: e.tools, writeTools: e.write })),
        tools: enabled.map((d) => d.name),
        salesforce: ctx.salesforce
          ? {
              configured: true,
              linkedForCaller: !!ctx.salesforce.info(),
              connectUrl: ctx.salesforce.connectUrl,
              writeEnabled: byToolset.has("salesforce-write"),
              deleteEnabled: byToolset.has("salesforce-delete"),
            }
          : { configured: false },
        changelog: CHANGELOG.slice(0, n),
        note:
          "If 'tools' above contains names that are not in your own tool list, your client cached an older tool list: ask the user to reconnect the connector (ChatGPT: Disconnect/Connect; Claude: Connectors -> Disconnect/Connect; Claude Code: /mcp -> reconnect). Every deploy adds a changelog entry here and on the gateway landing page (/ujdonsagok).",
      };
    },
  },
];
