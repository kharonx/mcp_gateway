/** CLI helper: run the device code login once and cache the token (stdio mode). */
import { loadConfig, assertEntraConfig } from "../config.js";
import { DeviceCodeAuth } from "./deviceCode.js";

const cfg = loadConfig(["--stdio"]);
assertEntraConfig(cfg);

const auth = new DeviceCodeAuth(cfg);
auth
  .getToken()
  .then(() => {
    console.error(`Login successful. Signed in as: ${auth.username}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error(`Login failed: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
