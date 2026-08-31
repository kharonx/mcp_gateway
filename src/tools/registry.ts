import { z, type ZodRawShape } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { GraphError } from "../graph/client.js";
import { SalesforceError } from "../salesforce/client.js";
import { isSalesforceConfigured } from "../settings.js";
import type { AppConfig } from "../config.js";
import { resolveTimeRange, NAMED_RANGES } from "../graph/timeRange.js";
import { withSource, withSourceList } from "../graph/source.js";
import { extractContent } from "../content/extract.js";
import type { EndpointDef, ToolContext } from "./types.js";
import { pathParams, WRITE_TOOLSETS } from "./types.js";

function buildInputSchema(def: EndpointDef, defaultPageItems: number, maxPageItems: number): ZodRawShape {
  const shape: ZodRawShape = {};
  for (const p of pathParams(def.path)) {
    shape[p] = z.string().min(1).describe(def.pathParamDescriptions?.[p] ?? `Value for ${p}`);
  }
  if (def.paginated) {
    shape.maxItems = z
      .number()
      .int()
      .min(1)
      .max(maxPageItems)
      .optional()
      .describe(`Maximum items to return across pages (default ${defaultPageItems}, max ${maxPageItems}). Pagination via @odata.nextLink is handled automatically; when the result is truncated, pass its nextCursor as cursor to continue.`);
    shape.cursor = z
      .string()
      .optional()
      .describe("Continuation token (nextCursor of a previous truncated response). Continues that listing; other query inputs are ignored.");
  }
  if (def.query?.filter) {
    shape.filter = z.string().optional().describe("OData $filter expression, e.g. \"importance eq 'high'\" or \"hasAttachments eq true\"");
  }
  if (def.query?.search) {
    shape.search = z.string().optional().describe(
      def.kqlTime
        ? 'Full-text search (KQL supported), e.g. \'from:kiss.peter@ceg.hu subject:"AI projekt" hasattachment:true\''
        : "Full-text search query"
    );
  }
  if (def.query?.orderby) {
    shape.orderby = z.string().optional().describe('OData $orderby, e.g. "receivedDateTime desc"');
  }
  if (def.query?.select) {
    shape.select = z.string().optional().describe("Comma separated list of properties to return (OData $select)");
  }
  if (def.timeFilterProperty) {
    shape.timeRange = z
      .enum(NAMED_RANGES as [string, ...string[]])
      .optional()
      .describe(`Named time range applied on ${def.timeFilterProperty}`);
    shape.from = z.string().optional().describe("Start of explicit time range (ISO date or datetime, overrides timeRange)");
    shape.to = z.string().optional().describe("End of explicit time range (ISO date or datetime)");
  }
  if (def.confirmRequired) {
    shape.confirm = z
      .boolean()
      .describe("Safety gate: must be explicitly true to execute this WRITE operation. Ask the user for approval before setting it.");
  }
  Object.assign(shape, def.extraInput);
  return shape;
}

function substitutePath(template: string, args: Record<string, any>): string {
  return template.replace(/\{(\w+)\}/g, (_, p) => encodeURIComponent(String(args[p])));
}

function buildQueryParams(def: EndpointDef, args: Record<string, any>): {
  query: Record<string, string | undefined>;
  headers: Record<string, string>;
} {
  const query: Record<string, string | undefined> = { ...def.staticQuery };
  const headers: Record<string, string> = {};
  if (def.buildQuery) Object.assign(query, def.buildQuery(args));

  const select = args.select ?? def.defaultSelect;
  if (select) query.$select = select;
  if (def.query?.expand) query.$expand = def.query.expand;

  const range = def.timeFilterProperty ? resolveTimeRange(args) : null;
  if (def.timeRequired && !range) {
    throw new Error("A time range is required: pass timeRange (e.g. last_7_days) or explicit from/to.");
  }
  const filterParts: string[] = [];
  // A $filter produced by buildQuery is combined with (not replaced by) user filter and time range.
  if (query.$filter) filterParts.push(`(${query.$filter})`);
  if (args.filter) filterParts.push(String(args.filter));

  let search: string | undefined = args.search ? String(args.search) : undefined;
  if (range && def.timeParamStyle === "queryParams") {
    query.startDateTime = range.from;
    query.endDateTime = range.to;
  } else if (range && def.timeFilterProperty) {
    if (search && def.kqlTime) {
      // Graph rejects $filter combined with $search on messages -> use KQL date restriction.
      search += ` received>=${range.from.slice(0, 10)} received<=${range.to.slice(0, 10)}`;
    } else {
      filterParts.push(`${def.timeFilterProperty} ge ${range.from} and ${def.timeFilterProperty} le ${range.to}`);
    }
  }
  if (search && def.plainSearch) {
    // OneNote pages: full-text search is the non-OData `search=` parameter; `$search` is rejected (Graph 20108).
    query.search = search;
  } else if (search) {
    query.$search = def.consistencyLevel ? `"${search.replace(/"/g, '')}"` : `"${search.replace(/"/g, '\\"')}"`;
  }
  if (filterParts.length && !search) query.$filter = filterParts.join(" and ");
  else if (filterParts.length && search && !def.kqlTime) query.$filter = filterParts.join(" and ");

  // $orderby cannot be combined with $search on most endpoints.
  const orderby = args.orderby ?? (!search ? def.defaultOrderby : undefined);
  if (orderby) query.$orderby = orderby;

  if (def.consistencyLevel && (search || query.$search || query.$filter || args.filter)) {
    headers["ConsistencyLevel"] = "eventual";
    query.$count = "true";
  }
  return { query, headers };
}

export function registerEndpointTool(server: McpServer, def: EndpointDef, ctx: ToolContext): void {
  const { config } = ctx;
  const inputSchema = buildInputSchema(def, config.defaultPageItems, config.maxPageItems);

  server.registerTool(
    def.name,
    {
      title: def.name,
      description: def.description,
      inputSchema,
      annotations: {
        readOnlyHint: !def.write,
        destructiveHint: false,
        idempotentHint: !def.write,
        openWorldHint: true,
      },
    },
    async (args: Record<string, any>) => {
      const started = Date.now();
      const graphPath = substitutePath(def.path, args);
      const auditBase = {
        timestamp: new Date(started).toISOString(),
        user: ctx.user,
        session: ctx.session,
        tool: def.name,
        operation: def.write ? ("WRITE" as const) : ("READ" as const),
        resourceType: def.resourceType,
        graphEndpoint: def.provider === "salesforce" ? `salesforce:${graphPath}` : graphPath,
        httpMethod: def.method,
      };
      try {
        if (def.confirmRequired && args.confirm !== true) {
          throw new Error(
            `Refused: ${def.name} is a WRITE operation and requires confirm=true. ` +
              `Creating a draft is never an implicit permission to send - ask the user for explicit approval first.`
          );
        }

        let result: unknown;
        if (def.handler) {
          result = await def.handler(args, ctx);
        } else if (def.binary) {
          const bin = await ctx.graph.requestBinary(graphPath, {
            query: buildQueryParams(def, args).query,
            maxBytes: config.maxDownloadBytes,
          });
          result = await extractContent(bin.buffer, bin.contentType, args.fileName ?? args.name, bin.truncated);
          if (bin.truncated) {
            (result as any).note =
              `${(result as any).note ?? ""} File exceeds MAX_DOWNLOAD_BYTES (${config.maxDownloadBytes}); content was truncated.`.trim();
          }
        } else if (def.method !== "GET") {
          const body = def.buildBody ? def.buildBody(args) : {};
          result = await ctx.graph.request(def.method, graphPath, { body });
        } else if (def.paginated) {
          const { query, headers } = buildQueryParams(def, args);
          const maxItems = Math.min(Number(args.maxItems) || config.defaultPageItems, config.maxPageItems);
          const top = def.noTop ? undefined : String(Math.min(maxItems, def.maxTop ?? 100));
          const cursor = typeof args.cursor === "string" && args.cursor ? args.cursor : undefined;
          if (cursor && !cursor.startsWith("https://graph.microsoft.com/")) {
            throw new Error("cursor must be a nextCursor value returned by this server.");
          }
          const paged = await ctx.graph.getPaged(
            graphPath,
            { ...query, ...(top ? { $top: top } : {}) },
            maxItems,
            headers,
            { skipPaging: def.skipPaging, cursor }
          );
          result = {
            count: paged.count,
            truncated: paged.truncated,
            ...(paged.truncated
              ? {
                  note: "More items exist. Call again with cursor=nextCursor to continue (or narrow the query).",
                  nextCursor: paged.nextLink,
                }
              : {}),
            items: withSourceList(paged.items, def.sourceType),
          };
        } else {
          const { query, headers } = buildQueryParams(def, args);
          const data = await ctx.graph.request("GET", graphPath, { query, headers, accept: def.accept });
          result = typeof data === "object" ? withSource(data, def.sourceType) : data;
        }

        if (def.transform) result = await def.transform(result, args);

        ctx.audit.log({
          ...auditBase,
          success: true,
          durationMs: Date.now() - started,
          ...(def.write && def.auditWrite ? def.auditWrite(args, result) : {}),
        });

        const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        const message =
          err instanceof GraphError || err instanceof SalesforceError
            ? err.toToolMessage()
            : err instanceof Error
              ? err.message
              : String(err);
        ctx.audit.log({
          ...auditBase,
          success: false,
          durationMs: Date.now() - started,
          error: message.slice(0, 500),
          ...(def.write && def.auditWrite ? def.auditWrite(args, undefined) : {}),
        });
        return { content: [{ type: "text" as const, text: `ERROR: ${message}` }], isError: true };
      }
    }
  );
}

/**
 * Profile filter shared by the MCP server, the admin tool list and the portal:
 * read-only mode, toolset allowlist, and optional providers (Salesforce tools
 * exist only when a Connected App is configured).
 */
export function isToolEnabled(def: EndpointDef, cfg: AppConfig): boolean {
  if (cfg.readOnly && (def.write || WRITE_TOOLSETS.includes(def.toolset))) return false;
  if (cfg.enabledToolsets && !cfg.enabledToolsets.includes(def.toolset)) return false;
  if (def.provider === "salesforce" && !isSalesforceConfigured(cfg)) return false;
  return true;
}

/** Apply profile filtering (toolsets + read-only + providers) then register everything. */
export function registerAllTools(server: McpServer, defs: EndpointDef[], ctx: ToolContext): EndpointDef[] {
  const enabled = defs.filter((d) => isToolEnabled(d, ctx.config));
  for (const def of enabled) registerEndpointTool(server, def, ctx);
  return enabled;
}
