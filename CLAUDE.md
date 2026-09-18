# AV MCP Gateway – working rules

- **Every deploy gets an "Újdonságok" entry.** Before redeploying, add a new entry at the top of
  `CHANGELOG` in `src/server/changelog.ts` (date, short hash of the deployed HEAD, Hungarian,
  user-facing bullets). The landing page shows the latest entry; `/ujdonsagok` lists all.
- Commit and push after every finished change (`main`, github.com/kharonx/mcp_gateway).
- Deploy: Coolify UI (http://coolify.alpha-vet.hu:8000, app **mcp-gateway**) → Actions → Redeploy.
  No push webhook. Production: https://mcp-gateway.doki4vet.hu.
- `npm run build` then `npm run matrix` (regenerates `docs/tool-matrix.md`) before committing tool changes.
- MCP `instructions` are GENERATED in `src/server/mcp.ts` (`buildInstructions`) from the enabled toolsets plus
  the newest changelog entry; never hand-edit capability claims there - add a toolset label to `TOOLSET_LABELS`
  when adding a toolset. `get-gateway-info` (toolset `gateway`, always on) returns the same profile to the AI.
- Per-user access: `KnownUser.access` (`src/users.ts`, edited on the admin "Felhasználók" tab) narrows the
  gateway-wide profile per user (toolset allowlist, readOnly, blocked); users without one get
  `cfg.defaultUserAccess` (admin settings). `isToolEnabled(def, cfg, access)` is the single enforcement point,
  used by the MCP server, the portal and the admin user list; blocked users get 403 on /mcp.
- TT / Vectory / AP2 is optional: toolset `vectory`, provider `tt`. The gateway is an MCP *client* of the TT
  server (`src/tt/client.ts`, shared API key from admin settings / `TT_MCP_API_KEY`); tools are discovered at
  runtime (`loadTtEndpoints`, re-run on settings save) and passed to `buildMcpServer(ctx, extra)`. Never add
  direct SQL access to meditrade/alphavet here - read-only TT tools only.
- Salesforce is optional: tools with `provider: "salesforce"` are registered only when a Connected
  App is configured (admin UI / `SF_CLIENT_ID`); per-user OAuth (PKCE) keyed by Entra oid in
  `data/salesforce-tokens.json`. Reads live in `salesforce.ts` (toolset `salesforce`), writes in
  `salesforceWrite.ts` (toolset `salesforce-write`, every tool `confirmRequired`); the single delete tool
  lives in the same file under toolset `salesforce-delete`, which is opt-in (enabled only when listed
  explicitly in `ENABLED_TOOLSETS` / the admin toolset list). Mirrors Salesforce's hosted MCP split
  (SObject Reads / Mutations / Deletes).
  Never write Salesforce (or any) secrets into the repo.
- Graph quirks already handled (keep them): OneNote notebooks/sections return no `@odata.nextLink`
  (`skipPaging`), OneNote pages have no full-text search in v1.0, `parentNotebook` needs `$expand`,
  `sectionGroup` has no `links` property, large collections continue via `cursor`/`nextCursor`.
