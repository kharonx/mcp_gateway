import type { ZodRawShape } from "zod";
import type { GraphClient } from "../graph/client.js";
import type { AuditLogger, AuditEntry } from "../audit/audit.js";
import type { AppConfig } from "../config.js";

/** Logical toolsets of the Reporting profile (spec section 24). */
export type Toolset =
  | "mail"
  | "mail-write"
  | "shared-mail"
  | "shared-mail-write"
  | "calendar"
  | "calendar-write"
  | "teams"
  | "teams-write"
  | "meetings"
  | "onenote"
  | "sharepoint"
  | "onedrive"
  | "loop"
  | "search"
  | "users";

export const WRITE_TOOLSETS: Toolset[] = ["mail-write", "shared-mail-write", "calendar-write", "teams-write"];

export interface QueryCapabilities {
  filter?: boolean;
  search?: boolean;
  orderby?: boolean;
  select?: boolean;
  /** Fixed $expand value always sent (e.g. "fields" for list items). */
  expand?: string;
}

/**
 * Declarative endpoint definition: one entry = one MCP tool = one allowlisted
 * Microsoft Graph endpoint. This is the implementation of the
 * tool -> endpoint -> method -> permission -> READ/WRITE matrix.
 */
export interface EndpointDef {
  name: string;
  description: string;
  toolset: Toolset;
  write?: boolean;
  /** Delegated Graph scopes used by this tool (documentation + matrix). */
  scopes: string[];
  method: "GET" | "POST" | "PATCH";
  /** Graph v1.0 path template, placeholders in {braces} become required string inputs. */
  path: string;
  pathParamDescriptions?: Record<string, string>;
  /** Audit resource type. */
  resourceType: string;
  paginated?: boolean;
  /** Some endpoints reject $top above a lower bound (e.g. chat messages: 50). */
  maxTop?: number;
  /** Endpoints that reject $top entirely. */
  noTop?: boolean;
  /**
   * Collections that never return @odata.nextLink (OneNote notebooks/sections/
   * sectionGroups): page with $skip until a short page comes back.
   */
  skipPaging?: boolean;
  defaultSelect?: string;
  defaultOrderby?: string;
  query?: QueryCapabilities;
  /** Adds timeRange/from/to inputs, applied as $filter on this property. */
  timeFilterProperty?: string;
  /** "filter" (default): OData $filter; "queryParams": startDateTime/endDateTime query params (calendarView). */
  timeParamStyle?: "filter" | "queryParams";
  /** Fail if no time range was supplied (calendarView requires one). */
  timeRequired?: boolean;
  /** Send full-text search as plain `search=` instead of OData `$search` (OneNote pages). */
  plainSearch?: boolean;
  /** Mail only: when $search is used, fold the time range into KQL instead of $filter. */
  kqlTime?: boolean;
  /** Adds ConsistencyLevel: eventual + $count=true (advanced /users queries). */
  consistencyLevel?: boolean;
  staticQuery?: Record<string, string>;
  accept?: string;
  /** Fetch binary content and run text extraction (files, attachments). */
  binary?: boolean;
  /** Source-tracking mapper key (see graph/source.ts). */
  sourceType?: string;
  /** Extra tool inputs beyond path params and generic query params. */
  extraInput?: ZodRawShape;
  buildBody?: (args: Record<string, any>) => unknown;
  buildQuery?: (args: Record<string, any>) => Record<string, string | undefined>;
  /** Safety policy: tool refuses to run unless confirm=true is passed (send-mail). */
  confirmRequired?: boolean;
  /** Extract WRITE audit fields (recipients, subject, ...) from args/result. */
  auditWrite?: (args: Record<string, any>, result: any) => Partial<AuditEntry>;
  transform?: (data: any, args: Record<string, any>) => unknown | Promise<unknown>;
}

export interface ToolContext {
  graph: GraphClient;
  audit: AuditLogger;
  user: string;
  session: string;
  config: AppConfig;
}

export function pathParams(template: string): string[] {
  return [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
}
