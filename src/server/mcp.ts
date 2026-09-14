import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAllTools } from "../tools/registry.js";
import { allEndpoints } from "../tools/endpoints/all.js";
import type { EndpointDef, ToolContext } from "../tools/types.js";

import type { Toolset } from "../tools/types.js";
import { isToolEnabled } from "../tools/registry.js";
import { CHANGELOG, buildInfo } from "./changelog.js";

/** Short label per toolset for the generated instructions. */
const TOOLSET_LABELS: Record<Toolset, string> = {
  gateway: "gateway self-description (get-gateway-info)",
  mail: "Outlook mail - read",
  "shared-mail": "shared mailboxes - read",
  "mail-write": "Outlook mail - draft/send/reply/forward (WRITE)",
  "shared-mail-write": "shared mailboxes - draft/send/reply/forward (WRITE)",
  calendar: "calendar, colleagues' free/busy, meeting-time suggestions - read",
  "calendar-write": "calendar events - create/update/respond (WRITE)",
  teams: "Teams chats, channels, members - read",
  "teams-write": "Teams messages - chat/channel/reply (WRITE)",
  meetings: "online meetings, transcripts, recordings, attendance - read",
  onenote: "OneNote - read",
  sharepoint: "SharePoint sites, lists, files - read",
  onedrive: "OneDrive - read",
  loop: "Loop components - read",
  search: "cross-source Microsoft 365 search",
  users: "directory users, people, audit log - read",
  salesforce: "Salesforce - SOQL/SOSL, describe, records, account overview, reports (read, via the user's OWN linked Salesforce login)",
  "salesforce-write": "Salesforce - create/update record, task, event, Chatter post, note (WRITE, confirm=true, records appear under the user's name)",
  "salesforce-delete": "Salesforce - delete ONE record to the Recycle Bin (WRITE, opt-in toolset, confirm=true per record, name the record to the user first)",
};

/**
 * Instructions are GENERATED from the enabled tool profile and the newest
 * changelog entry, so they can never drift from what is actually registered
 * (they did once: the hand-written text said "no Salesforce writes" for nine
 * days after the write toolset shipped). The AI reads this at every
 * initialize, i.e. at the start of every conversation.
 */
export function buildInstructions(enabled: EndpointDef[], ctx: ToolContext): string {
  const build = buildInfo();
  const counts = new Map<Toolset, { n: number; w: number }>();
  for (const d of enabled) {
    const c = counts.get(d.toolset) ?? { n: 0, w: 0 };
    c.n++;
    if (d.write) c.w++;
    counts.set(d.toolset, c);
  }
  const profile = [...counts.entries()]
    .filter(([t]) => t !== "gateway")
    .map(([t, c]) => `  - ${t} (${c.n} tool${c.n === 1 ? "" : "s"}${c.w ? `, ${c.w} WRITE` : ""}): ${TOOLSET_LABELS[t] ?? t}`)
    .join("\n");
  const writeCount = enabled.filter((d) => d.write).length;
  const latest = CHANGELOG[0];
  const sf = ctx.salesforce;
  const sfLine = sf
    ? counts.has("salesforce")
      ? `- Salesforce is configured on this gateway. ${sf.info() ? "The caller's own Salesforce login IS linked." : `The caller has NOT linked their Salesforce login yet - Salesforce tools will fail until they do it at ${sf.connectUrl}.`} Never more than that Salesforce user can see or do.`
      : "- Salesforce is configured but its toolsets are disabled by the admin."
    : "- Salesforce is not configured on this gateway (no Salesforce tools).";

  return `AV MCP Gateway ${build.version} (deployed ${build.date}) - Microsoft 365 and optional Salesforce. Profile: read broadly, write narrowly.

TOOL PROFILE OF THIS GATEWAY RIGHT NOW (${enabled.length} tools, ${writeCount} of them WRITE; generated from the enabled toolsets${ctx.config.readOnly ? "; GLOBAL READ-ONLY MODE is on" : ""}):
${profile}
${sfLine}

LATEST CHANGE (${latest?.date ?? "-"}): ${latest?.title ?? "-"}${latest?.items?.length ? ` - ${latest.items[0]}` : ""} Older entries: get-gateway-info or ${ctx.config.baseUrl}/ujdonsagok.

STALE TOOL LISTS: clients cache tools/list when they connect, so the tool list you hold can be older than this gateway. If the user says the gateway was updated, or a capability you expect is missing, call get-gateway-info FIRST. If it lists tools you do not have, tell the user to reconnect the connector (ChatGPT: Settings > Connectors > Disconnect then Connect; Claude: Settings > Connectors > Disconnect/Connect; Claude Code: /mcp > reconnect). Do not claim a capability is missing without checking.

- Every call runs with the signed-in user's own Microsoft 365 permissions (delegated OAuth). Nothing beyond what the user could see in Outlook/Teams/SharePoint themselves.
- WRITE tools are narrow and explicit. Drafting content is NEVER an implicit permission to send; every send/create/update/delete requires confirm=true after explicit user approval.
- Every returned object carries a _source block (sourceType, sourceId, sourceUrl, ...). Keep these references so report statements stay traceable to their origin.
- Typical report flow: get-calendar-view (time range) -> find-online-meeting-by-join-url -> list-meeting-transcripts -> get-meeting-transcript-content; plus list-mail-messages, list-chat-messages, search-m365, search-onenote-pages, search-my-drive.
- All list tools paginate automatically (maxItems). When a response says truncated=true, call the same tool again with cursor=nextCursor - repeat until truncated=false to enumerate large collections.`;
}

export function buildMcpServer(ctx: ToolContext): { server: McpServer; enabled: EndpointDef[] } {
  const enabledDefs = allEndpoints.filter((d) => isToolEnabled(d, ctx.config, ctx.access));
  const fullCtx: ToolContext = { ...ctx, enabledTools: enabledDefs };
  const server = new McpServer(
    { name: "av-mcp-gateway", version: buildInfo().version },
    { capabilities: { tools: {} }, instructions: buildInstructions(enabledDefs, fullCtx) }
  );
  const enabled = registerAllTools(server, allEndpoints, fullCtx);
  return { server, enabled };
}
