import { z } from "zod";
import type { EndpointDef, ToolContext } from "../types.js";
import type { AuditEntry } from "../../audit/audit.js";
import { assertObjectName, requireSf } from "./salesforce.js";
import type { SalesforceClient } from "../../salesforce/client.js";

/**
 * Optional Salesforce WRITE toolset. The read toolset covers everything the
 * MCP surface can answer by querying; these tools cover what only the REST API
 * can do: putting something BACK into Salesforce.
 *
 * Same guarantees as the read side - the caller's own Salesforce connection,
 * so a write succeeds only where that Salesforce user could have done it by
 * hand, and the record shows up under their name. Every tool requires
 * confirm=true after explicit user approval, and there is deliberately no
 * delete tool.
 */

const SF_SCOPES = ["Salesforce: api"];

/** Value types Salesforce accepts in a field map (JSON scalars + null). */
const fieldValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);

function fieldsInput(what: string) {
  return z
    .record(fieldValue)
    .describe(`${what} Field API names as keys (e.g. {"Subject": "Call back", "Status": "Completed"}). Use describe-salesforce-object to look up the API names, picklist values and which fields are writable.`);
}

/**
 * Validate a field map against the object's describe BEFORE sending it.
 * describe() reflects the connected user's field-level security, so this
 * catches a mistyped or read-only field as a clear tool error instead of a
 * bare Salesforce 400. Returns the map with canonical field casing.
 *
 * Required fields are NOT pre-checked: an org may fill them from a trigger or
 * flow, and refusing such a write here would be wrong. Salesforce reports
 * REQUIRED_FIELD_MISSING with the field list if one is genuinely missing.
 */
async function writableFields(
  client: SalesforceClient,
  object: string,
  fields: Record<string, unknown>,
  mode: "create" | "update"
): Promise<Record<string, unknown>> {
  const entries = Object.entries(fields ?? {});
  if (!entries.length) throw new Error(`fields is empty - nothing to ${mode}.`);
  const d = await client.describe(object);
  if (mode === "create" && d.createable === false) {
    throw new Error(`The connected Salesforce user cannot create ${object} records in this org.`);
  }
  if (mode === "update" && d.updateable === false) {
    throw new Error(`The connected Salesforce user cannot update ${object} records in this org.`);
  }
  const byName = new Map<string, any>((d.fields ?? []).map((f: any) => [String(f.name).toLowerCase(), f]));
  const out: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    const f = byName.get(key.toLowerCase());
    if (!f) {
      throw new Error(
        `Field '${key}' does not exist on ${object}, or is not visible to the connected Salesforce user. Call describe-salesforce-object for the field API names (custom fields end with __c).`
      );
    }
    if (mode === "create" ? !f.createable : !f.updateable) {
      throw new Error(
        `Field '${f.name}' cannot be ${mode === "create" ? "set on create" : "updated"} - it is read-only, a formula/rollup field, or hidden by field-level security for this Salesforce user.`
      );
    }
    out[f.name] = value;
  }
  return out;
}

/** POST a record and return a uniform result with the Lightning URL. */
async function createRecord(client: SalesforceClient, object: string, body: Record<string, unknown>) {
  const res = await client.request("POST", client.data(`/sobjects/${encodeURIComponent(object)}`), { body });
  const id = String(res?.id ?? "");
  return {
    created: true,
    id,
    objectType: object,
    url: `${client.instanceUrl}/lightning/r/${encodeURIComponent(object)}/${encodeURIComponent(id)}/view`,
    fields: body,
    _source: {
      sourceType: "salesforceRecord",
      sourceId: id,
      objectType: object,
      sourceUrl: `${client.instanceUrl}/lightning/r/${encodeURIComponent(object)}/${encodeURIComponent(id)}/view`,
    },
  };
}

const writeAudit =
  (subjectOf: (args: Record<string, any>) => string) =>
  (args: Record<string, any>, result: any): Partial<AuditEntry> => ({
    sender: "me",
    subject: subjectOf(args).slice(0, 200),
    messageId: result?.id,
    result: result ? "ok" : "error",
  });

/** Salesforce ids are 15 or 18 chars; reject anything else before it reaches the API. */
function optionalId(args: Record<string, any>, key: string): string | undefined {
  const v = args[key];
  if (v === undefined || v === null || v === "") return undefined;
  const s = String(v);
  if (!/^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/.test(s)) {
    throw new Error(`${key} must be a 15 or 18 character Salesforce record id (got '${s}').`);
  }
  return s;
}

/** Plain text -> minimal HTML, for ContentNote (which stores HTML). */
function textToNoteHtml(text: string): string {
  const esc = text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
  return esc
    .split(/\r?\n/)
    .map((line) => `<p>${line || "<br/>"}</p>`)
    .join("");
}

export const salesforceWriteEndpoints: EndpointDef[] = [
  {
    name: "create-salesforce-record",
    description:
      "CREATE any Salesforce record (Case, Lead, a custom __c object, ...) as the connected Salesforce user. Pass the object API name and a field map; field names and picklist values come from describe-salesforce-object. WRITE operation - requires confirm=true after explicit user approval. For activities prefer create-salesforce-task / create-salesforce-event.",
    toolset: "salesforce-write",
    write: true,
    provider: "salesforce",
    scopes: SF_SCOPES,
    method: "POST",
    path: "/services/data/vXX.X/sobjects/{object}",
    pathParamDescriptions: { object: "Salesforce object API name, e.g. Case, Lead, Account or MyObject__c" },
    resourceType: "salesforce",
    confirmRequired: true,
    extraInput: { fields: fieldsInput("Values for the new record.") },
    handler: async (args, ctx) => {
      const client = requireSf(ctx);
      const object = assertObjectName(args.object);
      const body = await writableFields(client, object, args.fields, "create");
      return createRecord(client, object, body);
    },
    auditWrite: writeAudit((a) => `create ${a.object}`),
  },
  {
    name: "update-salesforce-record",
    description:
      "UPDATE fields of an existing Salesforce record (e.g. move an Opportunity to a new stage, close a Case). Only the fields you pass are changed. WRITE operation - requires confirm=true after explicit user approval. Read the record first (get-salesforce-record) so the user can approve a concrete change.",
    toolset: "salesforce-write",
    write: true,
    provider: "salesforce",
    scopes: SF_SCOPES,
    method: "PATCH",
    path: "/services/data/vXX.X/sobjects/{object}/{recordId}",
    pathParamDescriptions: {
      object: "Salesforce object API name, e.g. Opportunity",
      recordId: "15 or 18 character record id",
    },
    resourceType: "salesforce",
    confirmRequired: true,
    extraInput: { fields: fieldsInput("Fields to change; everything else stays untouched.") },
    handler: async (args, ctx) => {
      const client = requireSf(ctx);
      const object = assertObjectName(args.object);
      const recordId = optionalId(args, "recordId")!;
      const body = await writableFields(client, object, args.fields, "update");
      // A successful PATCH returns 204 No Content - the client maps that to { ok: true }.
      await client.request("PATCH", client.data(`/sobjects/${encodeURIComponent(object)}/${encodeURIComponent(recordId)}`), { body });
      return {
        updated: true,
        id: recordId,
        objectType: object,
        url: `${client.instanceUrl}/lightning/r/${encodeURIComponent(object)}/${encodeURIComponent(recordId)}/view`,
        changedFields: body,
      };
    },
    auditWrite: writeAudit((a) => `update ${a.object} ${a.recordId}`),
  },
  {
    name: "create-salesforce-task",
    description:
      "LOG a Salesforce task (activity) - a call to make, a follow-up, a done action - optionally linked to an account/opportunity/case (whatId) and a contact/lead (whoId). Appears in the Salesforce activity timeline of the linked record, owned by the connected Salesforce user. WRITE operation - requires confirm=true after explicit user approval.",
    toolset: "salesforce-write",
    write: true,
    provider: "salesforce",
    scopes: SF_SCOPES,
    method: "POST",
    path: "/services/data/vXX.X/sobjects/Task",
    resourceType: "salesforce",
    confirmRequired: true,
    extraInput: {
      subject: z.string().min(1).describe("Task subject (short title shown in the activity timeline)"),
      description: z.string().optional().describe("Longer note / comments"),
      status: z.string().optional().describe("Status picklist value, e.g. 'Not Started', 'In Progress', 'Completed' (org specific - check describe-salesforce-object)"),
      priority: z.string().optional().describe("Priority picklist value, e.g. 'Normal', 'High'"),
      activityDate: z.string().optional().describe("Due date, YYYY-MM-DD"),
      whatId: z.string().optional().describe("Related record id: Account, Opportunity, Case, Campaign or custom object"),
      whoId: z.string().optional().describe("Related person id: Contact or Lead"),
      extraFields: z.record(fieldValue).optional().describe("Any further Task fields (API name -> value), e.g. custom fields"),
    },
    handler: async (args, ctx) => {
      const client = requireSf(ctx);
      if (args.activityDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(args.activityDate))) {
        throw new Error("activityDate must be a date in YYYY-MM-DD format.");
      }
      const whatId = optionalId(args, "whatId");
      const whoId = optionalId(args, "whoId");
      const fields: Record<string, unknown> = {
        Subject: args.subject,
        ...(args.description ? { Description: args.description } : {}),
        ...(args.status ? { Status: args.status } : {}),
        ...(args.priority ? { Priority: args.priority } : {}),
        ...(args.activityDate ? { ActivityDate: args.activityDate } : {}),
        ...(whatId ? { WhatId: whatId } : {}),
        ...(whoId ? { WhoId: whoId } : {}),
        ...(args.extraFields ?? {}),
      };
      const body = await writableFields(client, "Task", fields, "create");
      return createRecord(client, "Task", body);
    },
    auditWrite: writeAudit((a) => `create Task: ${a.subject}`),
  },
  {
    name: "create-salesforce-event",
    description:
      "CREATE a Salesforce calendar event / visit (meeting held or planned) in the connected Salesforce user's calendar, optionally linked to a record (whatId) and a person (whoId). This writes SALESFORCE - use create-calendar-event for Microsoft 365. WRITE operation - requires confirm=true after explicit user approval.",
    toolset: "salesforce-write",
    write: true,
    provider: "salesforce",
    scopes: SF_SCOPES,
    method: "POST",
    path: "/services/data/vXX.X/sobjects/Event",
    resourceType: "salesforce",
    confirmRequired: true,
    extraInput: {
      subject: z.string().min(1).describe("Event subject"),
      startDateTime: z.string().describe("Start, ISO 8601 with offset or Z (e.g. 2026-09-03T09:00:00Z)"),
      endDateTime: z.string().optional().describe("End, ISO 8601. Either this or durationMinutes is required."),
      durationMinutes: z.number().int().min(1).max(1440).optional().describe("Length in minutes, used when endDateTime is omitted"),
      description: z.string().optional().describe("Notes / agenda"),
      location: z.string().optional().describe("Location"),
      whatId: z.string().optional().describe("Related record id: Account, Opportunity, Case or custom object"),
      whoId: z.string().optional().describe("Related person id: Contact or Lead"),
      extraFields: z.record(fieldValue).optional().describe("Any further Event fields (API name -> value)"),
    },
    handler: async (args, ctx) => {
      const client = requireSf(ctx);
      if (!args.endDateTime && !args.durationMinutes) {
        throw new Error("Provide either endDateTime or durationMinutes.");
      }
      if (Number.isNaN(Date.parse(String(args.startDateTime)))) {
        throw new Error("startDateTime must be an ISO 8601 datetime, e.g. 2026-09-03T09:00:00Z.");
      }
      if (args.endDateTime && Number.isNaN(Date.parse(String(args.endDateTime)))) {
        throw new Error("endDateTime must be an ISO 8601 datetime, e.g. 2026-09-03T10:00:00Z.");
      }
      const whatId = optionalId(args, "whatId");
      const whoId = optionalId(args, "whoId");
      const fields: Record<string, unknown> = {
        Subject: args.subject,
        StartDateTime: args.startDateTime,
        ...(args.endDateTime ? { EndDateTime: args.endDateTime } : { DurationInMinutes: args.durationMinutes }),
        ...(args.description ? { Description: args.description } : {}),
        ...(args.location ? { Location: args.location } : {}),
        ...(whatId ? { WhatId: whatId } : {}),
        ...(whoId ? { WhoId: whoId } : {}),
        ...(args.extraFields ?? {}),
      };
      const body = await writableFields(client, "Event", fields, "create");
      return createRecord(client, "Event", body);
    },
    auditWrite: writeAudit((a) => `create Event: ${a.subject}`),
  },
  {
    name: "post-salesforce-chatter",
    description:
      "POST a Chatter message to a Salesforce record's feed (or to a group / a user's profile) as the connected Salesforce user. Everyone following that record sees it. WRITE operation - requires confirm=true after explicit user approval.",
    toolset: "salesforce-write",
    write: true,
    provider: "salesforce",
    scopes: SF_SCOPES,
    method: "POST",
    path: "/services/data/vXX.X/sobjects/FeedItem",
    resourceType: "salesforce",
    confirmRequired: true,
    extraInput: {
      parentId: z.string().describe("Id of the record, Chatter group or user the post goes to"),
      message: z.string().min(1).describe("Post text"),
      linkUrl: z.string().url().optional().describe("Optional link to attach to the post"),
    },
    handler: async (args, ctx) => {
      const client = requireSf(ctx);
      const fields: Record<string, unknown> = {
        ParentId: optionalId(args, "parentId"),
        Body: args.message,
        ...(args.linkUrl ? { LinkUrl: args.linkUrl } : {}),
      };
      const body = await writableFields(client, "FeedItem", fields, "create");
      return createRecord(client, "FeedItem", body);
    },
    auditWrite: writeAudit((a) => `chatter post on ${a.parentId}`),
  },
  {
    name: "create-salesforce-note",
    description:
      "ATTACH a note to a Salesforce record: creates a ContentNote and links it to the record, so it shows up under Notes on the record page. WRITE operation - requires confirm=true after explicit user approval.",
    toolset: "salesforce-write",
    write: true,
    provider: "salesforce",
    scopes: SF_SCOPES,
    method: "POST",
    path: "/services/data/vXX.X/sobjects/ContentNote",
    resourceType: "salesforce",
    confirmRequired: true,
    extraInput: {
      recordId: z.string().describe("Record the note is attached to (Account, Opportunity, Case, ...)"),
      title: z.string().min(1).describe("Note title"),
      content: z.string().min(1).describe("Note text (plain text; line breaks are preserved)"),
    },
    handler: async (args, ctx) => {
      const client = requireSf(ctx);
      const recordId = optionalId(args, "recordId")!;
      // ContentNote.Content is base64-encoded HTML; a ContentNote's own id IS
      // the ContentDocumentId used by the link record.
      const note = await client.request("POST", client.data("/sobjects/ContentNote"), {
        body: {
          Title: args.title,
          Content: Buffer.from(textToNoteHtml(String(args.content)), "utf8").toString("base64"),
        },
      });
      const noteId = String(note?.id ?? "");
      try {
        await client.request("POST", client.data("/sobjects/ContentDocumentLink"), {
          body: { ContentDocumentId: noteId, LinkedEntityId: recordId, ShareType: "V" },
        });
      } catch (err) {
        // The note exists but is not attached: say so rather than reporting a
        // clean failure, otherwise the user creates it again.
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
          `The note was created (id ${noteId}) but could not be linked to ${recordId}: ${msg}. Link it manually in Salesforce, or delete the orphan note.`
        );
      }
      return {
        created: true,
        id: noteId,
        objectType: "ContentNote",
        linkedTo: recordId,
        url: `${client.instanceUrl}/lightning/r/ContentNote/${encodeURIComponent(noteId)}/view`,
        _source: {
          sourceType: "salesforceRecord",
          sourceId: noteId,
          objectType: "ContentNote",
          sourceUrl: `${client.instanceUrl}/lightning/r/ContentNote/${encodeURIComponent(noteId)}/view`,
        },
      };
    },
    auditWrite: writeAudit((a) => `note on ${a.recordId}: ${a.title}`),
  },
];
