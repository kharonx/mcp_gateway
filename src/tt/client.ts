import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { TtConfig } from "../config.js";

/**
 * Thin MCP client for the TT server (tt.dokiforvet.hu/mcp): the read-only
 * front door to Vectory (meditrade), AP2/alphavet invoices and Alphaportal
 * tickets. The TT server is stateless HTTP with a shared bearer API key, so
 * every call opens a short-lived MCP session (initialize -> call -> close).
 * The gateway never touches the SQL databases directly.
 */
export interface TtTool {
  name: string;
  description?: string;
  inputSchema: Record<string, any>;
}

export interface TtCallResult {
  isError: boolean;
  /** Parsed JSON when the server returned JSON text or structuredContent, else the joined text. */
  data: unknown;
  text: string;
}

export class TtMcpClient {
  constructor(private cfg: TtConfig) {}

  private async withClient<T>(fn: (c: Client) => Promise<T>): Promise<T> {
    const transport = new StreamableHTTPClientTransport(new URL(this.cfg.url), {
      requestInit: { headers: { Authorization: `Bearer ${this.cfg.apiKey}` } },
    });
    const client = new Client({ name: "av-mcp-gateway", version: "1.0" });
    try {
      await client.connect(transport);
    } catch (err) {
      const msg = err instanceof Error ? err.message.trim() : String(err);
      const detail = /\S$/.test(msg) && !/endpoint:$/.test(msg) ? msg : `${msg} (no HTTP status in the response - most likely an invalid TT API key (401) or a wrong URL)`;
      throw new Error(`TT MCP ${this.cfg.url}: ${detail}`);
    }
    try {
      return await fn(client);
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  async listTools(): Promise<TtTool[]> {
    return this.withClient(async (c) => {
      const out: TtTool[] = [];
      let cursor: string | undefined;
      do {
        const r = await c.listTools(cursor ? { cursor } : undefined);
        for (const t of r.tools) out.push({ name: t.name, description: t.description, inputSchema: (t.inputSchema ?? { type: "object" }) as Record<string, any> });
        cursor = r.nextCursor;
      } while (cursor);
      return out;
    });
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<TtCallResult> {
    return this.withClient(async (c) => {
      const r = (await c.callTool({ name, arguments: args })) as any;
      const texts: string[] = [];
      for (const part of r.content ?? []) {
        if (part.type === "text") texts.push(String(part.text ?? ""));
        else texts.push(`[${part.type} content omitted]`);
      }
      const text = texts.join("\n");
      let data: unknown = r.structuredContent ?? undefined;
      if (data === undefined) {
        try {
          data = text ? JSON.parse(text) : {};
        } catch {
          data = text;
        }
      }
      return { isError: !!r.isError, data, text };
    });
  }
}
