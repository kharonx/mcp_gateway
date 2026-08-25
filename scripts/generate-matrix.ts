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
  return `| \`${d.name}\` | ${d.toolset} | ${d.write ? "**WRITE**" : "READ"} | ${d.method} | \`${d.path}\` | ${d.scopes.join(", ")} | enabled | ${flags.join(", ")} |`;
});

const byToolset = new Map<string, number>();
for (const d of allEndpoints) byToolset.set(d.toolset, (byToolset.get(d.toolset) ?? 0) + 1);

const md = `# Microsoft 365 Reporting MCP v1.0 - Tool / Permission Matrix

> Generated from \`src/tools/endpoints/*.ts\` by \`npm run matrix\`. Do not edit by hand.

Principle: **read broadly, write narrowly** - the only WRITE surface is Outlook mail
(draft/send/reply/forward), each send gated by \`confirm=true\`.

Total tools: **${allEndpoints.length}** (${allEndpoints.filter((d) => d.write).length} WRITE, ${allEndpoints.filter((d) => !d.write).length} READ)

Toolsets: ${[...byToolset.entries()].map(([k, v]) => `${k} (${v})`).join(", ")}

| MCP tool | Toolset | R/W | HTTP | Graph endpoint (v1.0) | Delegated scopes | State | Capabilities |
|---|---|---|---|---|---|---|---|
${rows.join("\n")}

## Deliberately NOT exposed (safety layer, spec sections 19-20)

- No generic \`graph-request(method, url, body)\` passthrough tool.
- No \`$batch\` passthrough.
- No Calendar/Teams/Files/Sites/OneNote/User/Group write, no delete anywhere.
- Mail delete / folder delete / destructive mailbox operations are excluded.
`;

const out = path.resolve("docs/tool-matrix.md");
fs.writeFileSync(out, md, "utf8");
console.log(`Wrote ${out} (${allEndpoints.length} tools)`);
