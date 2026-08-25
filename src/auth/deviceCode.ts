import fs from "node:fs";
import path from "node:path";
import {
  PublicClientApplication,
  type Configuration,
  type ICachePlugin,
  type TokenCacheContext,
} from "@azure/msal-node";
import { ALL_SCOPES } from "./scopes.js";
import type { AppConfig } from "../config.js";

const CACHE_FILE = path.resolve(".token-cache.json");

const cachePlugin: ICachePlugin = {
  async beforeCacheAccess(ctx: TokenCacheContext) {
    if (fs.existsSync(CACHE_FILE)) {
      ctx.tokenCache.deserialize(fs.readFileSync(CACHE_FILE, "utf8"));
    }
  },
  async afterCacheAccess(ctx: TokenCacheContext) {
    if (ctx.cacheHasChanged) {
      fs.writeFileSync(CACHE_FILE, ctx.tokenCache.serialize(), "utf8");
    }
  },
};

/**
 * Delegated auth for local stdio mode: Entra ID device code flow with a file
 * token cache. The MCP always acts as the signed-in user - no app-only tokens.
 */
export class DeviceCodeAuth {
  private pca: PublicClientApplication;
  username = "unknown";

  constructor(cfg: AppConfig) {
    const config: Configuration = {
      auth: {
        clientId: cfg.clientId,
        authority: `https://login.microsoftonline.com/${cfg.tenantId}`,
      },
      cache: { cachePlugin },
    };
    this.pca = new PublicClientApplication(config);
  }

  async getToken(): Promise<string> {
    const cache = this.pca.getTokenCache();
    const accounts = await cache.getAllAccounts();
    if (accounts.length > 0) {
      try {
        const res = await this.pca.acquireTokenSilent({ account: accounts[0], scopes: ALL_SCOPES });
        if (res?.accessToken) {
          this.username = res.account?.username ?? this.username;
          return res.accessToken;
        }
      } catch {
        /* fall through to interactive device code */
      }
    }
    const res = await this.pca.acquireTokenByDeviceCode({
      scopes: ALL_SCOPES,
      deviceCodeCallback: (info) => {
        // stdout is reserved for the MCP protocol in stdio mode
        process.stderr.write(`\n${info.message}\n\n`);
      },
    });
    if (!res?.accessToken) throw new Error("Device code authentication failed");
    this.username = res.account?.username ?? this.username;
    return res.accessToken;
  }
}
