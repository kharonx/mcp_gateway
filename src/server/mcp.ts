import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAllTools } from "../tools/registry.js";
import { allEndpoints } from "../tools/endpoints/all.js";
import type { EndpointDef, ToolContext } from "../tools/types.js";

const INSTRUCTIONS = `Microsoft 365 Reporting MCP (v1.0). Profile: read broadly, write narrowly.

- Every call runs with the signed-in user's own Microsoft 365 permissions (delegated OAuth). Nothing beyond what the user could see in Outlook/Teams/SharePoint themselves.
- READ tools cover Mail, Calendar (incl. colleagues' free/busy availability and meeting-time suggestions), Teams, Meetings + transcripts, OneNote, SharePoint, OneDrive, Loop, cross-source Search and Users.
- WRITE capabilities are narrow and explicit: Outlook mail (draft/send/reply/forward), calendar events (create/update/respond to invitations) and Teams messages (chat/channel/reply). Drafting content is NEVER an implicit permission to send; every send/create/update requires confirm=true after explicit user approval.
- Every returned object carries a _source block (sourceType, sourceId, sourceUrl, ...). Keep these references so report statements stay traceable to their Microsoft 365 origin.
- Typical report flow: get-calendar-view (time range) -> find-online-meeting-by-join-url -> list-meeting-transcripts -> get-meeting-transcript-content; plus list-mail-messages, list-chat-messages, search-m365, search-onenote-pages, search-my-drive.
- All list tools handle @odata.nextLink pagination automatically (maxItems parameter). When a response says truncated=true, call the same tool again with cursor=nextCursor to fetch the next batch - repeat until truncated=false to enumerate large collections (e.g. every user of the directory).
- OPTIONAL Salesforce toolset (present only when the gateway has a Salesforce Connected App configured): read-only SOQL/SOSL, object describe, records, account overview and reports, running through the user's OWN linked Salesforce login (salesforce-connection-status tells whether it is linked and where to link it). Never more than that Salesforce user can see; no writes.`;

export function buildMcpServer(ctx: ToolContext): { server: McpServer; enabled: EndpointDef[] } {
  const server = new McpServer(
    { name: "m365-reporting-mcp", version: "1.0.0" },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS }
  );
  const enabled = registerAllTools(server, allEndpoints, ctx);
  return { server, enabled };
}
