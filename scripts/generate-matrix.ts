/**
 * Generates docs/tool-matrix.md - the developer configuration appendix:
 * MCP tool -> Graph endpoint -> HTTP method -> delegated permission -> READ/WRITE -> enabled.
 * Run: npm run matrix
 */
import fs from "node:fs";
import path from "node:path";
import { allEndpoints } from "../src/tools/endpoints/all.js";

const rows = allEndpoints.map((d) => {
  const flags: string[] = [];
  if (d.paginated) flags.push("paginated");
  if (d.timeFilterProperty) flags.push("time-range");
  if (d.query?.search || d.buildQuery) flags.push("search");
  if (d.binary) flags.push("content-download");
  if (d.confirmRequired) flags.push("confirm-required");
  const endpoint = d.provider === "salesforce" ? `Salesforce ${d.path}` : d.path;
  const state = d.provider === "salesforce" ? "optional (Connected App configured)" : "enabled";
  return `| \`${d.name}\` | ${d.toolset} | ${d.write ? "**WRITE**" : "READ"} | ${d.method} | \`${endpoint}\` | ${d.scopes.join(", ")} | ${state} | ${flags.join(", ")} |`;
});

const byToolset = new Map<string, number>();
for (const d of allEndpoints) byToolset.set(d.toolset, (byToolset.get(d.toolset) ?? 0) + 1);

const md = `# Microsoft 365 Reporting MCP v1.0 - Tool / Permission Matrix

> Generated from \`src/tools/endpoints/*.ts\` by \`npm run matrix\`. Do not edit by hand.

Principle: **read broadly, write narrowly** - the WRITE surface is Outlook mail
(draft/send/reply/forward), calendar events, Teams messages and - when the optional
Salesforce Connected App is configured - Salesforce activity/record writes. Every
outbound send and every Salesforce write is gated by \`confirm=true\`.

Total tools: **${allEndpoints.length}** (${allEndpoints.filter((d) => d.write).length} WRITE, ${allEndpoints.filter((d) => !d.write).length} READ)

Toolsets: ${[...byToolset.entries()].map(([k, v]) => `${k} (${v})`).join(", ")}

| MCP tool | Toolset | R/W | HTTP | Endpoint (Graph v1.0 / Salesforce REST) | Delegated scopes | State | Capabilities |
|---|---|---|---|---|---|---|---|
${rows.join("\n")}

## Deliberately NOT exposed (safety layer, spec sections 19-20)

- No generic \`graph-request(method, url, body)\` passthrough tool.
- No \`$batch\` passthrough.
- No Files/Sites/OneNote/User/Group write, and no delete anywhere.
- Mail delete / folder delete / destructive mailbox operations are excluded.
- Salesforce (optional): reads plus a narrow write surface (create/update record, task, event, Chatter post, note) - no delete, no Apex/Bulk/Metadata API; every call uses the user's own linked Salesforce login.
`;

const out = path.resolve("docs/tool-matrix.md");
fs.writeFileSync(out, md, "utf8");
console.log(`Wrote ${out} (${allEndpoints.length} tools)`);
