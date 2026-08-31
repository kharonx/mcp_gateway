# m365-reporting-mcp – working rules

- **Every deploy gets an "Újdonságok" entry.** Before redeploying, add a new entry at the top of
  `CHANGELOG` in `src/server/changelog.ts` (date, short hash of the deployed HEAD, Hungarian,
  user-facing bullets). The landing page shows the latest entry; `/ujdonsagok` lists all.
- Commit and push after every finished change (`main`, github.com/kharonx/mcp_gateway).
- Deploy: Coolify UI (http://coolify.alpha-vet.hu:8000, app **mcp-gateway**) → Actions → Redeploy.
  No push webhook. Production: https://mcp-gateway.doki4vet.hu.
- `npm run build` then `npm run matrix` (regenerates `docs/tool-matrix.md`) before committing tool changes.
- Salesforce is optional: tools with `provider: "salesforce"` are registered only when a Connected
  App is configured (admin UI / `SF_CLIENT_ID`); per-user OAuth (PKCE) keyed by Entra oid in
  `data/salesforce-tokens.json`; read-only only. Never write Salesforce (or any) secrets into the repo.
- Graph quirks already handled (keep them): OneNote notebooks/sections return no `@odata.nextLink`
  (`skipPaging`), OneNote pages have no full-text search in v1.0, `parentNotebook` needs `$expand`,
  `sectionGroup` has no `links` property, large collections continue via `cursor`/`nextCursor`.
