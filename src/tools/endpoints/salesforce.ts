import { z } from "zod";
import type { EndpointDef, ToolContext } from "../types.js";
import { resolveTimeRange } from "../../graph/timeRange.js";
import { escapeSosl, isSfId, sfRecord, soqlString, type SalesforceClient } from "../../salesforce/client.js";

/**
 * Optional Salesforce toolset (READ-ONLY). Registered only when a Connected
 * App is configured; each call runs through the calling M365 user's own
 * Salesforce connection (linked on the landing page), so the AI sees exactly
 * what that Salesforce user may see - never more.
 */

const SF_SCOPES = ["Salesforce: api"];

const DEFAULT_FIELDS: Record<string, string> = {
  Account: "Id, Name, Type, Industry, Phone, Website, BillingCity, BillingCountry, Owner.Name, CreatedDate, LastModifiedDate",
  Contact: "Id, Name, Email, Phone, MobilePhone, Title, Account.Name, AccountId, Owner.Name, CreatedDate, LastModifiedDate",
  Opportunity:
    "Id, Name, StageName, Amount, CloseDate, Probability, IsClosed, IsWon, Type, Account.Name, AccountId, Owner.Name, CreatedDate, LastModifiedDate",
  Lead: "Id, Name, Company, Status, Email, Phone, Title, LeadSource, IsConverted, Owner.Name, CreatedDate, LastModifiedDate",
  Case: "Id, CaseNumber, Subject, Status, Priority, Origin, Account.Name, AccountId, Contact.Name, ContactId, Owner.Name, CreatedDate, ClosedDate, LastModifiedDate",
  Task: "Id, Subject, Status, Priority, ActivityDate, Who.Name, What.Name, Owner.Name, CreatedDate, LastModifiedDate",
  Event: "Id, Subject, StartDateTime, EndDateTime, Location, Who.Name, What.Name, Owner.Name, CreatedDate, LastModifiedDate",
  User: "Id, Name, Username, Email, Title, IsActive, Profile.Name, LastLoginDate",
  Campaign: "Id, Name, Type, Status, StartDate, EndDate, IsActive, Owner.Name, LastModifiedDate",
  Product2: "Id, Name, ProductCode, Family, IsActive, LastModifiedDate",
};

const SOSL_RETURNING: Record<string, string> = {
  Account: "Id, Name, Type, Industry, BillingCity",
  Contact: "Id, Name, Email, Phone, Title, Account.Name",
  Opportunity: "Id, Name, StageName, Amount, CloseDate, Account.Name",
  Lead: "Id, Name, Company, Status, Email",
  Case: "Id, CaseNumber, Subject, Status, Account.Name",
};

const SIMPLE_TYPES = new Set([
  "string", "picklist", "multipicklist", "email", "phone", "url", "currency", "percent", "double", "int",
  "boolean", "date", "datetime", "reference", "textarea",
]);

function requireSf(ctx: ToolContext): SalesforceClient {
  if (!ctx.salesforce) {
    throw new Error("Salesforce integration is not available in this mode (HTTP mode with a configured Connected App is required).");
  }
  const client = ctx.salesforce.client();
  if (!client) {
    throw new Error(
      `Salesforce is not connected for ${ctx.user}. Ask the user to open ${ctx.salesforce.connectUrl}, sign in with their Microsoft account and click "Salesforce összekötése" (link their own Salesforce login), then retry.`
    );
  }
  return client;
}

function assertSelect(soql: string): string {
  const q = String(soql ?? "").trim();
  if (!/^SELECT\s/i.test(q)) throw new Error("Only read-only SOQL SELECT statements are allowed.");
  return q;
}

function assertObjectName(name: string): string {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) throw new Error(`Invalid Salesforce object name: ${name}`);
  return name;
}

function assertFieldList(fields: string): string {
  if (!/^[A-Za-z0-9_.,\s()]+$/.test(fields)) throw new Error("fields must be a comma separated list of field names (relationship fields like Account.Name allowed).");
  return fields;
}

function cursorOf(args: Record<string, any>): string | undefined {
  const c = typeof args.cursor === "string" && args.cursor ? args.cursor : undefined;
  if (c && !c.startsWith("/services/data/") && !/^offset:\d+$/.test(c)) {
    throw new Error("cursor must be a nextCursor value returned by a Salesforce tool of this server.");
  }
  return c;
}

function maxItemsOf(args: Record<string, any>, ctx: ToolContext): number {
  return Math.min(Number(args.maxItems) || ctx.config.defaultPageItems, ctx.config.maxPageItems);
}

async function fieldsFor(client: SalesforceClient, object: string, requested?: string): Promise<string> {
  if (requested) return assertFieldList(requested);
  if (DEFAULT_FIELDS[object]) return DEFAULT_FIELDS[object];
  const d = await client.describe(object);
  const names: string[] = [];
  for (const f of d.fields ?? []) {
    if (f.name === "Id" || f.nameField || ["CreatedDate", "LastModifiedDate", "OwnerId"].includes(f.name)) names.push(f.name);
    else if (SIMPLE_TYPES.has(f.type) && names.length < 30) names.push(f.name);
  }
  return names.join(", ");
}

function timeClause(args: Record<string, any>, field: string): string | null {
  const range = resolveTimeRange(args);
  if (!range) return null;
  if (!/^[A-Za-z][A-Za-z0-9_.]*$/.test(field)) throw new Error(`Invalid timeField: ${field}`);
  return `${field} >= ${range.from} AND ${field} <= ${range.to}`;
}

export const salesforceEndpoints: EndpointDef[] = [
  {
    name: "salesforce-connection-status",
    description:
      "Is Salesforce linked for the signed-in user? Returns the connected org (instance URL, org id), the Salesforce user (name, username, email) and the org's daily API usage. When not connected, returns connected=false with the landing-page URL where the user links their own Salesforce login - call this first if a Salesforce tool reports a missing connection.",
    toolset: "salesforce",
    provider: "salesforce",
    scopes: SF_SCOPES,
    method: "GET",
    path: "/services/data/vXX.X/limits",
    resourceType: "salesforce",
    handler: async (_args, ctx) => {
      if (!ctx.salesforce) return { configured: false, connected: false, note: "Salesforce integration not available in this mode." };
      const info = ctx.salesforce.info();
      if (!info) {
        return {
          configured: true,
          connected: false,
          user: ctx.user,
          connectUrl: ctx.salesforce.connectUrl,
          note: `Not connected. The user must open ${ctx.salesforce.connectUrl}, sign in with Microsoft and click "Salesforce összekötése" to link their own Salesforce account.`,
        };
      }
      const client = ctx.salesforce.client()!;
      let limits: unknown;
      try {
        const l = await client.request("GET", client.data("/limits"));
        limits = { DailyApiRequests: l.DailyApiRequests, DailyBulkApiBatches: l.DailyBulkApiBatches };
      } catch (err) {
        limits = { error: err instanceof Error ? err.message : String(err) };
      }
      return {
        configured: true,
        connected: true,
        user: ctx.user,
        org: { instanceUrl: info.instanceUrl, orgId: info.orgId, apiVersion: client.apiVersion },
        salesforceUser: { id: info.userId, name: info.name, username: info.username, email: info.email },
        connectedAt: info.connectedAt,
        lastRefreshAt: info.lastRefreshAt,
        limits,
        _source: { sourceType: "salesforceOrg", sourceId: info.orgId, sourceUrl: info.instanceUrl },
      };
    },
  },
  {
    name: "salesforce-soql-query",
    description:
      "Run a read-only SOQL SELECT query (e.g. \"SELECT Id, Name, Industry FROM Account WHERE Type = 'Customer' ORDER BY LastModifiedDate DESC\"). Relationship fields (Account.Name), subqueries, aggregate functions (COUNT(), SUM(Amount) ... GROUP BY) and date literals (LAST_N_DAYS:30, THIS_QUARTER) are supported. Returns at most maxItems records (totalSize tells the full size); pass nextCursor as cursor to continue exactly where it stopped. Not every org exposes every standard object (e.g. Opportunity may be unavailable) - use list-salesforce-objects / describe-salesforce-object to discover objects and field names first.",
    toolset: "salesforce",
    provider: "salesforce",
    scopes: SF_SCOPES,
    method: "GET",
    path: "/services/data/vXX.X/query",
    resourceType: "salesforce",
    paginated: true,
    extraInput: {
      q: z.string().describe("SOQL SELECT statement"),
      includeDeleted: z.boolean().optional().describe("Also return deleted/archived records (queryAll)"),
    },
    handler: async (args, ctx) => {
      const client = requireSf(ctx);
      const r = await client.query(assertSelect(args.q), {
        maxItems: maxItemsOf(args, ctx),
        cursor: cursorOf(args),
        includeDeleted: args.includeDeleted === true,
      });
      return {
        totalSize: r.totalSize,
        count: r.count,
        truncated: r.truncated,
        ...(r.truncated ? { note: "More records exist. Call again with cursor=nextCursor to continue.", nextCursor: r.nextCursor } : {}),
        items: r.records,
      };
    },
  },
  {
    name: "salesforce-sosl-search",
    description:
      "Full-text search across Salesforce (SOSL) for a term - name, email, phone, subject etc. Default targets: Account, Contact, Opportunity, Lead, Case (override with objects). Returns hits grouped by object type with key fields; use get-salesforce-record or salesforce-soql-query for details.",
    toolset: "salesforce",
    provider: "salesforce",
    scopes: SF_SCOPES,
    method: "GET",
    path: "/services/data/vXX.X/search",
    resourceType: "salesforce",
    extraInput: {
      term: z.string().min(2).describe("Search term (at least 2 characters; wildcards * and ? allowed)"),
      objects: z.array(z.string()).optional().describe("Object API names to search, default Account, Contact, Opportunity, Lead, Case"),
      limitPerObject: z.number().int().min(1).max(200).optional().describe("Max hits per object (default 20)"),
    },
    handler: async (args, ctx) => {
      const client = requireSf(ctx);
      let objects: string[] = (args.objects?.length ? args.objects : Object.keys(SOSL_RETURNING)).map(assertObjectName);
      const limit = Number(args.limitPerObject) || 20;
      const skipped: string[] = [];
      let sosl = "";
      let data: any;
      // Orgs may not expose every default object (e.g. no Opportunity): drop
      // objects Salesforce reports as unsupported and retry instead of failing.
      for (let attempt = 0; attempt < 6; attempt++) {
        if (!objects.length) throw new Error(`None of the requested objects is searchable in this org (${skipped.join(", ")}).`);
        const returning = objects.map((o) => `${o}(${SOSL_RETURNING[o] ?? "Id, Name"} LIMIT ${limit})`).join(", ");
        sosl = `FIND {${escapeSosl(String(args.term))}} IN ALL FIELDS RETURNING ${returning}`;
        try {
          data = await client.request("GET", client.data("/search"), { query: { q: sosl } });
          break;
        } catch (err) {
          const bad = /sObject type '(\w+)' is not supported|No such (?:column|object) '(\w+)'/i.exec(err instanceof Error ? err.message : String(err));
          const obj = bad?.[1] ?? bad?.[2];
          if (!obj || !objects.includes(obj)) throw err;
          objects = objects.filter((o) => o !== obj);
          skipped.push(obj);
        }
      }
      const groups: Record<string, unknown[]> = {};
      for (const rec of data?.searchRecords ?? []) {
        const t = rec.attributes?.type ?? "Unknown";
        (groups[t] ??= []).push(sfRecord(rec, client.instanceUrl));
      }
      return {
        sosl,
        count: (data?.searchRecords ?? []).length,
        ...(skipped.length ? { note: `Objects not available in this org were skipped: ${skipped.join(", ")}.` } : {}),
        byObject: groups,
      };
    },
  },
  {
    name: "list-salesforce-objects",
    description:
      "List the Salesforce objects (standard and custom) the connected user can query, with label, API name and key prefix. Filter by a name/label substring. Use it to find custom objects (__c) before querying them.",
    toolset: "salesforce",
    provider: "salesforce",
    scopes: SF_SCOPES,
    method: "GET",
    path: "/services/data/vXX.X/sobjects",
    resourceType: "salesforce",
    extraInput: {
      search: z.string().optional().describe("Substring of the API name or label (case-insensitive)"),
      customOnly: z.boolean().optional().describe("Only custom objects (__c)"),
      includeNonQueryable: z.boolean().optional().describe("Include objects that cannot be queried with SOQL (default false)"),
    },
    handler: async (args, ctx) => {
      const client = requireSf(ctx);
      const data = await client.request("GET", client.data("/sobjects"));
      const q = String(args.search ?? "").toLowerCase();
      const items = (data.sobjects ?? [])
        .filter((o: any) => (args.includeNonQueryable ? true : o.queryable))
        .filter((o: any) => (args.customOnly ? o.custom : true))
        .filter((o: any) => !q || String(o.name).toLowerCase().includes(q) || String(o.label).toLowerCase().includes(q))
        .map((o: any) => ({
          name: o.name,
          label: o.label,
          labelPlural: o.labelPlural,
          custom: o.custom,
          keyPrefix: o.keyPrefix,
          queryable: o.queryable,
          searchable: o.searchable,
        }));
      return { count: items.length, apiVersion: client.apiVersion, items };
    },
  },
  {
    name: "describe-salesforce-object",
    description:
      "Describe a Salesforce object: fields (API name, label, type, picklist values, lookup targets), child relationships and record types - what the connected user can see. Use before writing SOQL against unfamiliar or custom objects. fieldSearch narrows the field list.",
    toolset: "salesforce",
    provider: "salesforce",
    scopes: SF_SCOPES,
    method: "GET",
    path: "/services/data/vXX.X/sobjects/{object}/describe",
    pathParamDescriptions: { object: "Object API name, e.g. Account, Opportunity, MyObject__c" },
    resourceType: "salesforce",
    extraInput: {
      fieldSearch: z.string().optional().describe("Substring of a field API name or label to filter the field list"),
    },
    handler: async (args, ctx) => {
      const client = requireSf(ctx);
      const d = await client.describe(assertObjectName(String(args.object)));
      const q = String(args.fieldSearch ?? "").toLowerCase();
      const fields = (d.fields ?? [])
        .filter((f: any) => !q || String(f.name).toLowerCase().includes(q) || String(f.label).toLowerCase().includes(q))
        .map((f: any) => ({
          name: f.name,
          label: f.label,
          type: f.type,
          ...(f.length ? { length: f.length } : {}),
          nillable: f.nillable,
          custom: f.custom,
          filterable: f.filterable,
          ...(f.referenceTo?.length ? { referenceTo: f.referenceTo, relationshipName: f.relationshipName } : {}),
          ...(f.picklistValues?.length ? { picklistValues: f.picklistValues.filter((p: any) => p.active).map((p: any) => p.value) } : {}),
        }));
      return {
        name: d.name,
        label: d.label,
        labelPlural: d.labelPlural,
        custom: d.custom,
        queryable: d.queryable,
        searchable: d.searchable,
        fieldCount: (d.fields ?? []).length,
        fields,
        childRelationships: (d.childRelationships ?? [])
          .filter((c: any) => c.relationshipName)
          .slice(0, 80)
          .map((c: any) => ({ childSObject: c.childSObject, field: c.field, relationshipName: c.relationshipName })),
        recordTypes: (d.recordTypeInfos ?? []).map((r: any) => ({ id: r.recordTypeId, name: r.name, available: r.available, default: r.defaultRecordTypeMapping })),
      };
    },
  },
  {
    name: "get-salesforce-record",
    description:
      "Get one Salesforce record by object and id (15/18-char id). Returns sensible default fields per object (Account, Contact, Opportunity, Lead, Case, Task, Event ...) or the fields you request.",
    toolset: "salesforce",
    provider: "salesforce",
    scopes: SF_SCOPES,
    method: "GET",
    path: "/services/data/vXX.X/sobjects/{object}/{id}",
    pathParamDescriptions: { object: "Object API name, e.g. Account", id: "Record id, e.g. 001XXXXXXXXXXXX" },
    resourceType: "salesforce",
    extraInput: {
      fields: z.string().optional().describe("Comma separated field list (relationship fields like Account.Name allowed). Default: object-specific key fields"),
    },
    handler: async (args, ctx) => {
      const client = requireSf(ctx);
      const object = assertObjectName(String(args.object));
      const id = String(args.id);
      if (!isSfId(id)) throw new Error("id must be a 15 or 18 character Salesforce record id.");
      const fields = await fieldsFor(client, object, args.fields);
      const r = await client.query(`SELECT ${fields} FROM ${object} WHERE Id = ${soqlString(id)}`, { maxItems: 1 });
      if (!r.records.length) throw new Error(`No ${object} record with id ${id} is visible to the connected Salesforce user.`);
      return r.records[0];
    },
  },
  {
    name: "list-salesforce-records",
    description:
      "List records of any Salesforce object without writing SOQL: object + optional fields, where clause (SOQL syntax, e.g. \"Type = 'Customer' AND BillingCountry = 'Hungary'\"), orderby and a time range on timeField (default LastModifiedDate; use CreatedDate or any date field as needed). Returns at most maxItems records; continue with cursor=nextCursor.",
    toolset: "salesforce",
    provider: "salesforce",
    scopes: SF_SCOPES,
    method: "GET",
    path: "/services/data/vXX.X/query",
    resourceType: "salesforce",
    paginated: true,
    timeFilterProperty: "LastModifiedDate",
    extraInput: {
      object: z.string().describe("Object API name, e.g. Opportunity or MyObject__c"),
      fields: z.string().optional().describe("Comma separated fields. Default: object-specific key fields (unknown objects: Id, name field and simple fields from describe)"),
      where: z.string().optional().describe("SOQL WHERE condition without the WHERE keyword"),
      orderby: z.string().optional().describe("SOQL ORDER BY, e.g. \"CloseDate DESC\" (default LastModifiedDate DESC)"),
      timeField: z.string().optional().describe("Date/datetime field the timeRange/from/to applies to (default LastModifiedDate)"),
    },
    handler: async (args, ctx) => {
      const client = requireSf(ctx);
      const object = assertObjectName(String(args.object));
      const fields = await fieldsFor(client, object, args.fields);
      const clauses: string[] = [];
      if (args.where) clauses.push(`(${String(args.where)})`);
      const t = timeClause(args, String(args.timeField ?? "LastModifiedDate"));
      if (t) clauses.push(t);
      const orderby = String(args.orderby ?? "LastModifiedDate DESC");
      if (!/^[A-Za-z0-9_.,\s]+$/.test(orderby)) throw new Error("orderby must be a field list with optional ASC/DESC.");
      const soql = `SELECT ${fields} FROM ${object}${clauses.length ? " WHERE " + clauses.join(" AND ") : ""} ORDER BY ${orderby}`;
      const r = await client.query(soql, { maxItems: maxItemsOf(args, ctx), cursor: cursorOf(args) });
      return {
        soql,
        totalSize: r.totalSize,
        count: r.count,
        truncated: r.truncated,
        ...(r.truncated ? { note: "More records exist. Call again with cursor=nextCursor to continue.", nextCursor: r.nextCursor } : {}),
        items: r.records,
      };
    },
  },
  {
    name: "get-salesforce-recent-items",
    description: "Recently viewed Salesforce records of the connected user (any object), newest first.",
    toolset: "salesforce",
    provider: "salesforce",
    scopes: SF_SCOPES,
    method: "GET",
    path: "/services/data/vXX.X/recent",
    resourceType: "salesforce",
    extraInput: { limit: z.number().int().min(1).max(200).optional().describe("Max items (default 25)") },
    handler: async (args, ctx) => {
      const client = requireSf(ctx);
      const data = await client.request("GET", client.data("/recent"), { query: { limit: String(Number(args.limit) || 25) } });
      const items = (Array.isArray(data) ? data : []).map((r: any) => sfRecord(r, client.instanceUrl));
      return { count: items.length, items };
    },
  },
  {
    name: "get-salesforce-account-overview",
    description:
      "360° view of one Account: the account, its contacts, opportunities (open + closed summary with pipeline amount), recent cases and recent activities (tasks/events). Give accountId, or accountName to search by name (returns candidates when ambiguous). Each section reports its own error if the user lacks access to that object.",
    toolset: "salesforce",
    provider: "salesforce",
    scopes: SF_SCOPES,
    method: "GET",
    path: "/services/data/vXX.X/query",
    resourceType: "salesforce",
    extraInput: {
      accountId: z.string().optional().describe("Account id (001...)"),
      accountName: z.string().optional().describe("Account name or name fragment (used when accountId is not given)"),
    },
    handler: async (args, ctx) => {
      const client = requireSf(ctx);
      let accountId = args.accountId ? String(args.accountId) : "";
      if (!accountId) {
        if (!args.accountName) throw new Error("Pass accountId or accountName.");
        const cands = await client.query(
          `SELECT Id, Name, Type, Industry, BillingCity, Owner.Name FROM Account WHERE Name LIKE ${soqlString("%" + String(args.accountName) + "%")} ORDER BY LastModifiedDate DESC`,
          { maxItems: 10 }
        );
        if (!cands.records.length) throw new Error(`No Account matching "${args.accountName}" is visible to the connected user.`);
        const exact = cands.records.filter((r) => String(r.Name).toLowerCase() === String(args.accountName).toLowerCase());
        if (cands.records.length > 1 && exact.length !== 1) {
          return { ambiguous: true, note: "Several accounts match - call again with accountId.", candidates: cands.records };
        }
        accountId = (exact[0] ?? cands.records[0]).Id;
      }
      if (!isSfId(accountId)) throw new Error("accountId must be a 15/18 character Salesforce id.");
      const idLit = soqlString(accountId);
      const section = async (soql: string, maxItems: number) => {
        try {
          const r = await client.query(soql, { maxItems });
          return { count: r.count, totalSize: r.totalSize, items: r.records };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      };
      const account = await client.query(`SELECT ${DEFAULT_FIELDS.Account}, Description, AnnualRevenue, NumberOfEmployees, BillingStreet, BillingPostalCode FROM Account WHERE Id = ${idLit}`, { maxItems: 1 });
      if (!account.records.length) throw new Error(`Account ${accountId} is not visible to the connected Salesforce user.`);
      const [contacts, opportunities, cases, tasks, events] = await Promise.all([
        section(`SELECT ${DEFAULT_FIELDS.Contact} FROM Contact WHERE AccountId = ${idLit} ORDER BY LastModifiedDate DESC`, 50),
        section(`SELECT ${DEFAULT_FIELDS.Opportunity} FROM Opportunity WHERE AccountId = ${idLit} ORDER BY CloseDate DESC`, 100),
        section(`SELECT ${DEFAULT_FIELDS.Case} FROM Case WHERE AccountId = ${idLit} ORDER BY CreatedDate DESC`, 30),
        section(`SELECT ${DEFAULT_FIELDS.Task} FROM Task WHERE AccountId = ${idLit} ORDER BY ActivityDate DESC NULLS LAST`, 25),
        section(`SELECT ${DEFAULT_FIELDS.Event} FROM Event WHERE AccountId = ${idLit} ORDER BY StartDateTime DESC`, 25),
      ]);
      const opps = (opportunities as any).items ?? [];
      const sum = (rows: any[]) => rows.reduce((a, o) => a + (Number(o.Amount) || 0), 0);
      const open = opps.filter((o: any) => !o.IsClosed);
      const won = opps.filter((o: any) => o.IsWon);
      return {
        account: account.records[0],
        contacts,
        opportunities: {
          ...opportunities,
          summary: { open: open.length, openAmount: sum(open), won: won.length, wonAmount: sum(won), lost: opps.filter((o: any) => o.IsClosed && !o.IsWon).length },
        },
        cases,
        activities: { tasks, events },
      };
    },
  },
  {
    name: "list-salesforce-reports",
    description: "List Salesforce reports (name, folder, format, last run) visible to the connected user; filter by name. Run one with run-salesforce-report.",
    toolset: "salesforce",
    provider: "salesforce",
    scopes: SF_SCOPES,
    method: "GET",
    path: "/services/data/vXX.X/query",
    resourceType: "salesforce",
    paginated: true,
    extraInput: { search: z.string().optional().describe("Substring of the report name") },
    handler: async (args, ctx) => {
      const client = requireSf(ctx);
      const where = args.search ? ` WHERE Name LIKE ${soqlString("%" + String(args.search) + "%")}` : "";
      const r = await client.query(
        `SELECT Id, Name, DeveloperName, FolderName, Format, Description, LastRunDate, LastModifiedDate FROM Report${where} ORDER BY LastRunDate DESC NULLS LAST`,
        { maxItems: maxItemsOf(args, ctx), cursor: cursorOf(args) }
      );
      return {
        count: r.count,
        truncated: r.truncated,
        ...(r.truncated ? { nextCursor: r.nextCursor } : {}),
        items: r.records.map((rep) => ({ ...rep, _source: { ...rep._source, sourceUrl: `${client.instanceUrl}/lightning/r/Report/${rep.Id}/view` } })),
      };
    },
  },
  {
    name: "run-salesforce-report",
    description:
      "Run a saved Salesforce report synchronously and return its result: detail columns and rows (tabular), plus grouping labels and aggregates (summary/matrix). Salesforce returns at most 2000 detail rows; allData=false means the report was cut off. Get report ids from list-salesforce-reports.",
    toolset: "salesforce",
    provider: "salesforce",
    scopes: SF_SCOPES,
    method: "GET",
    path: "/services/data/vXX.X/analytics/reports/{reportId}",
    pathParamDescriptions: { reportId: "Report id (00O...)" },
    resourceType: "salesforce",
    extraInput: { maxRows: z.number().int().min(1).max(2000).optional().describe("Max detail rows to return (default 200)") },
    handler: async (args, ctx) => {
      const client = requireSf(ctx);
      const id = String(args.reportId);
      if (!isSfId(id)) throw new Error("reportId must be a 15/18 character Salesforce id.");
      const maxRows = Number(args.maxRows) || 200;
      const data = await client.request("GET", client.data(`/analytics/reports/${encodeURIComponent(id)}`), { query: { includeDetails: "true" } });
      const meta = data.reportMetadata ?? {};
      const colInfo = data.reportExtendedMetadata?.detailColumnInfo ?? {};
      const columns: string[] = meta.detailColumns ?? Object.keys(colInfo);
      const labels = columns.map((c) => colInfo[c]?.label ?? c);
      const fm = data.factMap ?? {};
      const rowsOf = (key: string) =>
        (fm[key]?.rows ?? []).slice(0, maxRows).map((row: any) => {
          const o: Record<string, unknown> = {};
          row.dataCells?.forEach((cell: any, i: number) => (o[labels[i] ?? String(i)] = cell.label ?? cell.value));
          return o;
        });
      const aggOf = (key: string) =>
        (fm[key]?.aggregates ?? []).map((a: any, i: number) => ({ name: meta.aggregates?.[i] ?? String(i), value: a.value, label: a.label }));
      const groupings = (data.groupingsDown?.groupings ?? []).map((g: any) => ({
        label: g.label,
        value: g.value,
        aggregates: aggOf(`${g.key}!T`),
        rowCount: fm[`${g.key}!T`]?.rows?.length ?? 0,
      }));
      return {
        report: { id: meta.id ?? id, name: meta.name, format: meta.reportFormat, allData: data.allData, hasDetailRows: data.hasDetailRows },
        columns: labels,
        rows: rowsOf("T!T"),
        totals: aggOf("T!T"),
        groupings,
        _source: { sourceType: "salesforceReport", sourceId: meta.id ?? id, title: meta.name, sourceUrl: `${client.instanceUrl}/lightning/r/Report/${id}/view` },
      };
    },
  },
];
