import { z, type ZodRawShape, type ZodTypeAny } from "zod";
import type { EndpointDef } from "../types.js";
import type { TtConfig } from "../../config.js";
import { TtMcpClient, type TtTool } from "../../tt/client.js";

/**
 * Toolset "vectory": the TT MCP server's tools re-exposed through the gateway
 * (provider "tt"). Discovered at startup / when the admin saves the TT
 * settings, so the list follows whatever TT publishes. Every TT tool is a
 * read-only query over Vectory (meditrade), AP2/alphavet invoices and
 * Alphaportal tickets; the gateway forwards the call with its shared TT API
 * key and audits the caller's identity. Tool names get a "tt-" prefix and
 * underscores become hyphens (ugyfel_kereses -> tt-ugyfel-kereses).
 */

export function ttToolName(upstream: string): string {
  return "tt-" + upstream.replace(/_/g, "-");
}

/** Best-effort JSON-schema -> zod shape (the MCP SDK wants a ZodRawShape). Unknown shapes fall back to z.any(). */
function shapeFromJsonSchema(schema: Record<string, any> | undefined): ZodRawShape {
  const shape: ZodRawShape = {};
  const props: Record<string, any> = schema?.properties ?? {};
  const required = new Set<string>(Array.isArray(schema?.required) ? schema.required : []);
  for (const [key, p] of Object.entries(props)) {
    let t: ZodTypeAny;
    const type = Array.isArray(p?.type) ? p.type.find((x: string) => x !== "null") : p?.type;
    if (Array.isArray(p?.enum) && p.enum.every((e: unknown) => typeof e === "string") && p.enum.length) {
      t = z.enum(p.enum as [string, ...string[]]);
    } else if (type === "string") t = z.string();
    else if (type === "number") t = z.number();
    else if (type === "integer") t = z.number().int();
    else if (type === "boolean") t = z.boolean();
    else if (type === "array") t = z.array(z.any());
    else if (type === "object") t = z.record(z.any());
    else t = z.any();
    if (p?.description) t = t.describe(String(p.description));
    shape[key] = required.has(key) ? t : t.optional();
  }
  return shape;
}

export async function loadTtEndpoints(cfg: TtConfig): Promise<EndpointDef[]> {
  const client = new TtMcpClient(cfg);
  const tools = await client.listTools();
  return tools.map((t) => ttEndpoint(client, t));
}

function ttEndpoint(client: TtMcpClient, t: TtTool): EndpointDef {
  const name = ttToolName(t.name);
  return {
    name,
    description: `[TT - Vectory / AP2, read-only] ${t.description ?? t.name}`.trim() + " Start with tt-ugyfel-kereses to get the clinicId, then call the others with it.",
    toolset: "vectory",
    provider: "tt",
    scopes: ["TT MCP API key (shared)"],
    method: "POST",
    path: `/mcp/${t.name}`,
    resourceType: "tt",
    extraInput: shapeFromJsonSchema(t.inputSchema),
    handler: async (args) => {
      const { confirm: _c, ...rest } = args ?? {};
      const r = await client.callTool(t.name, rest);
      if (r.isError) throw new Error(`TT tool ${t.name} failed: ${r.text || "unknown error"}`);
      const data = r.data;
      if (data && typeof data === "object" && !Array.isArray(data)) {
        return { ...(data as Record<string, unknown>), _source: { sourceType: "tt", sourceId: t.name, sourceUrl: undefined } };
      }
      return { result: data, _source: { sourceType: "tt", sourceId: t.name } };
    },
  };
}
