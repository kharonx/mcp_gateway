import { randomUUID } from "node:crypto";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DeviceCodeAuth } from "../auth/deviceCode.js";
import { GraphClient } from "../graph/client.js";
import { AuditLogger } from "../audit/audit.js";
import { buildMcpServer } from "./mcp.js";
import type { AppConfig } from "../config.js";
import type { ToolContext } from "../tools/types.js";

export async function runStdio(cfg: AppConfig): Promise<void> {
  const auth = new DeviceCodeAuth(cfg);
  const audit = new AuditLogger(cfg.auditDir, true);
  const ctx: ToolContext = {
    graph: new GraphClient(async () => {
      const token = await auth.getToken();
      ctx.user = auth.username;
      return token;
    }),
    audit,
    user: auth.username,
    session: randomUUID(),
    config: cfg,
  };
  const { server, enabled } = buildMcpServer(ctx);
  process.stderr.write(`m365-reporting-mcp: stdio mode, ${enabled.length} tools registered\n`);
  await server.connect(new StdioServerTransport());
}
