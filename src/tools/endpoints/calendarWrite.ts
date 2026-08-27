import { z } from "zod";
import type { EndpointDef } from "../types.js";
import type { AuditEntry } from "../../audit/audit.js";

/**
 * Calendar WRITE toolset. Same safety policy as mail: every operation that
 * creates/changes an event or notifies attendees requires confirm=true after
 * explicit user approval. No delete.
 */

const DEFAULT_TZ = "Europe/Budapest";

const eventAudit = (args: Record<string, any>, result: any): Partial<AuditEntry> => ({
  sender: "me",
  recipients: args.attendees,
  subject: args.subject,
  messageId: result?.id ?? args.eventId,
  result: result ? "ok" : "error",
});

const eventFields = {
  subject: z.string().optional().describe("Event subject/title"),
  body: z.string().optional().describe("Event description (body)"),
  bodyType: z.enum(["HTML", "Text"]).optional().describe("Body content type (default HTML)"),
  start: z.string().optional().describe("Start datetime, ISO local format e.g. 2026-09-01T10:00:00"),
  end: z.string().optional().describe("End datetime, ISO local format"),
  timeZone: z.string().optional().describe(`IANA time zone (default ${DEFAULT_TZ})`),
  location: z.string().optional().describe("Location display name"),
  attendees: z.array(z.string()).optional().describe("Attendee email addresses (required attendees)"),
  isOnlineMeeting: z.boolean().optional().describe("Create it as a Teams online meeting"),
};

function eventPayload(args: Record<string, any>): Record<string, unknown> {
  const tz = args.timeZone ?? DEFAULT_TZ;
  const body: Record<string, unknown> = {};
  if (args.subject !== undefined) body.subject = args.subject;
  if (args.body !== undefined) body.body = { contentType: args.bodyType ?? "HTML", content: args.body };
  if (args.start !== undefined) body.start = { dateTime: args.start, timeZone: tz };
  if (args.end !== undefined) body.end = { dateTime: args.end, timeZone: tz };
  if (args.location !== undefined) body.location = { displayName: args.location };
  if (args.attendees !== undefined) {
    body.attendees = (args.attendees as string[]).map((address) => ({
      emailAddress: { address },
      type: "required",
    }));
  }
  if (args.isOnlineMeeting) {
    body.isOnlineMeeting = true;
    body.onlineMeetingProvider = "teamsForBusiness";
  }
  return body;
}

export const calendarWriteEndpoints: EndpointDef[] = [
  {
    name: "create-calendar-event",
    description:
      "CREATE a calendar event in the signed-in user's default calendar (optionally as a Teams online meeting; attendees get invitations). WRITE operation - requires confirm=true after explicit user approval.",
    toolset: "calendar-write",
    write: true,
    scopes: ["Calendars.ReadWrite"],
    method: "POST",
    path: "/me/events",
    resourceType: "calendarEvent",
    confirmRequired: true,
    sourceType: "calendarEvent",
    extraInput: {
      ...eventFields,
      subject: z.string().describe("Event subject/title"),
      start: z.string().describe("Start datetime, ISO local format e.g. 2026-09-01T10:00:00"),
      end: z.string().describe("End datetime, ISO local format"),
    },
    buildBody: eventPayload,
    auditWrite: eventAudit,
  },
  {
    name: "update-calendar-event",
    description:
      "UPDATE an existing calendar event (only the provided fields change; attendees are notified of changes). WRITE operation - requires confirm=true.",
    toolset: "calendar-write",
    write: true,
    scopes: ["Calendars.ReadWrite"],
    method: "PATCH",
    path: "/me/events/{eventId}",
    pathParamDescriptions: { eventId: "Event id (from get-calendar-view / list-calendar-events)" },
    resourceType: "calendarEvent",
    confirmRequired: true,
    sourceType: "calendarEvent",
    extraInput: eventFields,
    buildBody: eventPayload,
    auditWrite: eventAudit,
  },
  {
    name: "respond-to-calendar-event",
    description:
      "Respond to a meeting invitation (accept / decline / tentativelyAccept); the organizer is notified. WRITE operation - requires confirm=true.",
    toolset: "calendar-write",
    write: true,
    scopes: ["Calendars.ReadWrite"],
    method: "POST",
    path: "/me/events/{eventId}/{response}",
    pathParamDescriptions: { eventId: "Event id of the invitation" },
    resourceType: "calendarEvent",
    confirmRequired: true,
    extraInput: {
      response: z.enum(["accept", "decline", "tentativelyAccept"]).describe("Response action"),
      comment: z.string().optional().describe("Optional comment sent to the organizer"),
    },
    buildBody: (args) => ({ comment: args.comment ?? "", sendResponse: true }),
    auditWrite: (args, result) => ({
      sender: "me",
      messageId: args.eventId,
      result: result ? `ok (${args.response})` : "error",
    }),
  },
];
