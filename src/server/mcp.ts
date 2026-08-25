import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAllTools } from "../tools/registry.js";
import { allEndpoints } from "../tools/endpoints/all.js";
import type { EndpointDef, ToolContext } from "../tools/types.js";

const INSTRUCTIONS = `Microsoft 365 Reporting MCP (v1.0). Profile: read broadly, write narrowly.

- Every call runs with the signed-in user's own Microsoft 365 permissions (delegated OAuth). Nothing beyond what the user could see in Outlook/Teams/SharePoint themselves.
- READ tools cover Mail, Calendar, Teams, Meetings + transcripts, OneNote, SharePoint, OneDrive, Loop, cross-source Search and Users.
- The ONLY write capability is Outlook mail: create-draft / send / reply / forward. Creating a draft is NEVER an implicit permission to send; sending requires confirm=true after explicit user approval.
- Every returned object carries a _source block (sourceType, sourceId, sourceUrl, ...). Keep these references so report statements stay traceable to their Microsoft 365 origin.
- Typical report flow: get-calendar-view (time range) -> find-online-meeting-by-join-url -> list-meeting-transcripts -> get-meeting-transcript-content; plus list-mail-messages, list-chat-messages, search-m365, search-onenote-pages, search-my-drive.
- All list tools handle @odata.nextLink pagination automatically (maxItems parameter).`;

export function buildMcpServer(ctx: ToolContext): { server: McpServer; enabled: EndpointDef[] } {
  const server = new McpServer(
    { name: "m365-reporting-mcp", version: "1.0.0" },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS }
  );
  const enabled = registerAllTools(server, allEndpoints, ctx);
  return { server, enabled };
}
