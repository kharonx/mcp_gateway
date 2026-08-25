#!/usr/bin/env node
import { loadConfig, assertEntraConfig } from "./config.js";
import { runHttp } from "./server/http.js";
import { runStdio } from "./server/stdio.js";

async function main(): Promise<void> {
  const cfg = loadConfig();
  if (cfg.mode === "http") {
    // Entra settings can also be provided later via the /admin UI.
    await runHttp(cfg);
  } else {
    assertEntraConfig(cfg);
    await runStdio(cfg);
  }
}

main().catch((err) => {
  console.error(`Fatal: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
