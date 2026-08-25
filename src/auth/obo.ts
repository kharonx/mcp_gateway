import { ConfidentialClientApplication } from "@azure/msal-node";
import { GRAPH_DEFAULT_SCOPE } from "./scopes.js";
import type { AppConfig } from "../config.js";

/**
 * HTTP mode: the MCP client (ChatGPT, Claude, ...) sends an Entra access token
 * issued for THIS application. We exchange it for a Microsoft Graph token via
 * the On-Behalf-Of flow, so every Graph call runs with the signed-in user's
 * own permissions - the MCP can never exceed what the user could do in M365.
 */
export class OboAuth {
  private cca: ConfidentialClientApplication;

  constructor(cfg: AppConfig) {
    this.cca = new ConfidentialClientApplication({
      auth: {
        clientId: cfg.clientId,
        clientSecret: cfg.clientSecret,
        authority: `https://login.microsoftonline.com/${cfg.tenantId}`,
      },
    });
  }

  async getGraphToken(userAssertion: string): Promise<string> {
    const res = await this.cca.acquireTokenOnBehalfOf({
      oboAssertion: userAssertion,
      scopes: GRAPH_DEFAULT_SCOPE,
    });
    if (!res?.accessToken) throw new Error("On-Behalf-Of token acquisition failed");
    return res.accessToken;
  }
}
