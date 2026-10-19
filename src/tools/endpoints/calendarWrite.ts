import { z } from "zod";
import type { EndpointDef } from "../types.js";
import type { AuditEntry } from "../../audit/audit.js";

/**
 * Calendar WRITE toolset. Same safety policy as mail: every operation that
 * creates/changes an event or notifies attendees requires confirm=true after
 * explicit user approval. Deleting lives in the opt-in toolset calendar-delete.
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

/**
 * Opt-in toolset calendar-delete (see OPT_IN_TOOLSETS): one destructive tool.
 * Organizer with attendees -> POST /cancel (attendees get a cancellation, a plain DELETE would
 * leave the meeting in their calendars); own event without attendees -> DELETE. An attendee
 * deleting would silently drop out without telling the organizer, so that is refused (decline
 * instead) unless the organizer already cancelled the meeting.
 */
export const calendarDeleteEndpoints: EndpointDef[] = [
  {
    name: "delete-calendar-event",
    description:
      "DELETE one calendar event of the signed-in user. If the user is the organizer and the event has attendees, the meeting is CANCELLED instead (attendees get a cancellation notice with the optional comment). A meeting the user was only invited to cannot be deleted here - decline it with respond-to-calendar-event - unless the organizer already cancelled it. An occurrence id removes one occurrence, a series master id the whole series. The event goes to Deleted Items. DESTRUCTIVE WRITE - read the event first (get-calendar-event), tell the user exactly which event (subject, start, attendees) and call with confirm=true only after their explicit approval.",
    toolset: "calendar-delete",
    write: true,
    scopes: ["Calendars.ReadWrite"],
    method: "DELETE",
    path: "/me/events/{eventId}",
    pathParamDescriptions: { eventId: "Event id (from get-calendar-view / list-calendar-events / get-calendar-event)" },
    resourceType: "calendarEvent",
    confirmRequired: true,
    extraInput: {
      comment: z.string().optional().describe("Cancellation message sent to the attendees (organizer only)"),
    },
    handler: async (args, ctx) => {
      const id = encodeURIComponent(args.eventId);
      // Snapshot first, so the result and the audit log say WHAT was removed, and a wrong id fails before anything is touched.
      const ev: any = await ctx.graph.request("GET", `/me/events/${id}`, {
        query: { $select: "subject,start,end,type,isOrganizer,isCancelled,organizer,attendees" },
      });
      const attendees: string[] = (ev.attendees ?? []).map((a: any) => a.emailAddress?.address).filter(Boolean);
      const snapshot = {
        id: args.eventId,
        subject: ev.subject,
        start: ev.start,
        end: ev.end,
        type: ev.type,
        organizer: ev.organizer?.emailAddress?.address,
        attendees,
      };
      if (!ev.isOrganizer && !ev.isCancelled) {
        throw new Error(
          `"${ev.subject}" is organized by ${snapshot.organizer ?? "someone else"} - deleting it would not notify them. ` +
            "Decline it with respond-to-calendar-event instead. Nothing was deleted."
        );
      }
      if (ev.isOrganizer && attendees.length) {
        await ctx.graph.request("POST", `/me/events/${id}/cancel`, { body: { comment: args.comment ?? "" } });
        return { cancelled: true, notifiedAttendees: attendees, ...snapshot };
      }
      await ctx.graph.request("DELETE", `/me/events/${id}`);
      return { deleted: true, ...snapshot, recovery: "The event is in Deleted Items and can be restored from Outlook." };
    },
    auditWrite: (args, result) => ({
      sender: "me",
      recipients: result?.notifiedAttendees,
      subject: result?.subject,
      messageId: args.eventId,
      result: result ? (result.cancelled ? "ok (cancelled)" : "ok (deleted)") : "error",
    }),
  },
];
