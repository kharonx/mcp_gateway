import { z } from "zod";
import type { EndpointDef, ToolContext } from "../types.js";
import { GraphError } from "../../graph/client.js";

/**
 * Organization-wide Teams meeting transcripts (toolset meetings-org, provider "graph-app").
 * Unlike every other Graph tool these run with the gateway's APPLICATION permissions
 * (client credentials), not the caller's delegated token: an admin grants the toolset per
 * user on the "Felhasználók" tab. Prerequisites in the tenant: application permissions
 * OnlineMeetingTranscript.Read.All + OnlineMeetings.Read.All + User.Read.All with admin
 * consent, and a Teams application access policy for this app (Grant-CsApplicationAccessPolicy).
 * Every call is audited with the organizer in the path.
 */

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UPN = /^[^\s@/\\'"?#]+@[^\s@/\\'"?#]+\.[^\s@/\\'"?#]+$/;
const OPAQUE_ID = /^[A-Za-z0-9+/=_-]{8,}$/;

function app(ctx: ToolContext) {
  if (!ctx.appGraph) throw new Error("Organization-wide meeting access is not available on this gateway (Entra app not configured, or stdio mode).");
  return ctx.appGraph;
}

function opaqueId(v: unknown, name: string): string {
  const s = String(v ?? "").trim();
  if (!OPAQUE_ID.test(s)) throw new Error(`${name} is not a valid id - use the value returned by the meetings-org tools.`);
  return encodeURIComponent(s);
}

/** Organizer as Entra object id; a UPN/e-mail is resolved through the directory (app permission User.Read.All). */
async function organizerId(ctx: ToolContext, organizer: unknown): Promise<{ id: string; displayName?: string; upn?: string }> {
  const s = String(organizer ?? "").trim();
  if (GUID.test(s)) return { id: s.toLowerCase() };
  if (!UPN.test(s)) throw new Error("organizer must be the organizer's e-mail/UPN or Entra object id.");
  const u = (await app(ctx).request("GET", `/users/${encodeURIComponent(s)}`, {
    query: { $select: "id,displayName,userPrincipalName" },
  })) as { id: string; displayName?: string; userPrincipalName?: string };
  return { id: u.id, displayName: u.displayName, upn: u.userPrincipalName };
}

function isoDate(v: unknown, name: string, endOfDay = false): string | undefined {
  if (v === undefined || v === "") return undefined;
  const s = String(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`${name} must be YYYY-MM-DD.`);
  return `${s}T${endOfDay ? "23:59:59" : "00:00:00"}Z`;
}

const organizerInput = {
  organizer: z.string().describe("Meeting organizer: e-mail/UPN (e.g. kovacs.anna@alpha-vet.hu) or Entra object id"),
};

export const meetingsOrgEndpoints: EndpointDef[] = [
  {
    name: "list-org-meeting-transcripts",
    description:
      "ORGANIZATION-WIDE (app permission, admin-granted): list the Teams meeting transcripts of every scheduled meeting ORGANIZED by the given colleague, optionally within a date range (transcript creation date). Returns meetingId + transcriptId for get-org-meeting-transcript-content and get-org-online-meeting. Channel meetings are not included. To survey several people, call once per organizer (list-users / search-users give their e-mails).",
    toolset: "meetings-org",
    provider: "graph-app",
    scopes: [],
    method: "GET",
    path: "/users/{organizer}/onlineMeetings/getAllTranscripts",
    resourceType: "meetingTranscript",
    extraInput: {
      ...organizerInput,
      since: z.string().optional().describe("Transcripts created on or after this day (YYYY-MM-DD, UTC)"),
      until: z.string().optional().describe("Transcripts created on or before this day (YYYY-MM-DD, UTC)"),
      maxItems: z.number().int().positive().optional().describe("Max transcripts to return (default 50)"),
      cursor: z.string().optional().describe("nextCursor from a previous call"),
    },
    handler: async (args, ctx) => {
      const g = app(ctx);
      const org = await organizerId(ctx, args.organizer);
      const since = isoDate(args.since, "since");
      const until = isoDate(args.until, "until", true);
      const fn =
        `getAllTranscripts(meetingOrganizerUserId='${org.id}'` +
        (since ? `,startDateTime=${since}` : "") +
        (until ? `,endDateTime=${until}` : "") +
        ")";
      const maxItems = Math.min(Number(args.maxItems) || ctx.config.defaultPageItems, ctx.config.maxPageItems);
      const cursor = typeof args.cursor === "string" && args.cursor ? args.cursor : undefined;
      if (cursor && !cursor.startsWith("https://graph.microsoft.com/")) throw new Error("cursor must be a nextCursor value returned by this server.");
      const paged = await g.getPaged(`/users/${org.id}/onlineMeetings/${fn}`, {}, maxItems, undefined, { cursor });
      const items = (paged.items as Array<Record<string, any>>).map((t) => ({
        transcriptId: t.id,
        meetingId: t.meetingId,
        createdDateTime: t.createdDateTime,
        endDateTime: t.endDateTime,
        organizerId: t.meetingOrganizer?.user?.id ?? org.id,
      }));
      return {
        organizer: { id: org.id, displayName: org.displayName, upn: org.upn },
        count: items.length,
        truncated: paged.truncated,
        ...(paged.truncated ? { note: "More transcripts exist. Call again with cursor=nextCursor.", nextCursor: paged.nextLink } : {}),
        items,
      };
    },
  },
  {
    name: "find-org-online-meeting-by-join-url",
    description:
      "ORGANIZATION-WIDE (app permission, admin-granted): resolve ANY colleague's Teams meeting from its join URL (e.g. event.onlineMeeting.joinUrl of a calendar event). The organizer is read from the URL; returns the meetingId and organizerId for list-org-online-meeting-transcripts.",
    toolset: "meetings-org",
    provider: "graph-app",
    scopes: [],
    method: "GET",
    path: "/users/(organizer from join URL)/onlineMeetings",
    resourceType: "onlineMeeting",
    extraInput: {
      joinWebUrl: z.string().describe("The Teams meeting join URL (https://teams.microsoft.com/l/meetup-join/...)"),
    },
    handler: async (args, ctx) => {
      const url = String(args.joinWebUrl ?? "").trim();
      let oid: string | undefined;
      try {
        const u = new URL(url);
        if (!/(^|\.)teams\.(microsoft|live)\.com$/i.test(u.hostname)) throw new Error("not a Teams URL");
        const context = JSON.parse(u.searchParams.get("context") ?? "{}") as { Oid?: string };
        oid = context.Oid;
      } catch {
        throw new Error("joinWebUrl must be a Teams meeting join URL (https://teams.microsoft.com/l/meetup-join/...).");
      }
      if (!oid || !GUID.test(oid)) throw new Error("The join URL does not name its organizer (no Oid in the context parameter); use list-org-meeting-transcripts with the organizer instead.");
      const data = (await app(ctx).request("GET", `/users/${oid}/onlineMeetings`, {
        query: { $filter: `JoinWebUrl eq '${url.replace(/'/g, "''")}'` },
      })) as { value?: Array<Record<string, any>> };
      const meetings = (data.value ?? []).map((m) => ({
        meetingId: m.id,
        subject: m.subject,
        startDateTime: m.startDateTime,
        endDateTime: m.endDateTime,
        organizerId: oid,
        joinWebUrl: m.joinWebUrl,
      }));
      return { count: meetings.length, meetings };
    },
  },
  {
    name: "get-org-online-meeting",
    description: "ORGANIZATION-WIDE (app permission, admin-granted): details of a colleague's online meeting (subject, start/end, participants) by organizer + meetingId.",
    toolset: "meetings-org",
    provider: "graph-app",
    scopes: [],
    method: "GET",
    path: "/users/{organizer}/onlineMeetings/{meetingId}",
    resourceType: "onlineMeeting",
    extraInput: {
      ...organizerInput,
      meetingId: z.string().describe("meetingId from list-org-meeting-transcripts or find-org-online-meeting-by-join-url"),
    },
    handler: async (args, ctx) => {
      const org = await organizerId(ctx, args.organizer);
      const m = (await app(ctx).request("GET", `/users/${org.id}/onlineMeetings/${opaqueId(args.meetingId, "meetingId")}`)) as Record<string, any>;
      return {
        meetingId: m.id,
        subject: m.subject,
        startDateTime: m.startDateTime,
        endDateTime: m.endDateTime,
        organizerId: org.id,
        participants: m.participants,
        joinWebUrl: m.joinWebUrl,
      };
    },
  },
  {
    name: "list-org-online-meeting-transcripts",
    description: "ORGANIZATION-WIDE (app permission, admin-granted): list the transcripts of ONE colleague's online meeting (organizer + meetingId).",
    toolset: "meetings-org",
    provider: "graph-app",
    scopes: [],
    method: "GET",
    path: "/users/{organizer}/onlineMeetings/{meetingId}/transcripts",
    resourceType: "meetingTranscript",
    extraInput: {
      ...organizerInput,
      meetingId: z.string().describe("meetingId from find-org-online-meeting-by-join-url or list-org-meeting-transcripts"),
    },
    handler: async (args, ctx) => {
      const org = await organizerId(ctx, args.organizer);
      const data = (await app(ctx).request("GET", `/users/${org.id}/onlineMeetings/${opaqueId(args.meetingId, "meetingId")}/transcripts`)) as {
        value?: Array<Record<string, any>>;
      };
      const items = (data.value ?? []).map((t) => ({ transcriptId: t.id, meetingId: t.meetingId, createdDateTime: t.createdDateTime, endDateTime: t.endDateTime }));
      return { organizerId: org.id, count: items.length, items };
    },
  },
  {
    name: "get-org-meeting-transcript-content",
    description:
      "ORGANIZATION-WIDE (app permission, admin-granted): FULL TEXT of a colleague's meeting transcript (WebVTT: speaker, timestamp, text). If the tenant disallows speaker attribution, the text comes back without speaker names.",
    toolset: "meetings-org",
    provider: "graph-app",
    scopes: [],
    method: "GET",
    path: "/users/{organizer}/onlineMeetings/{meetingId}/transcripts/{transcriptId}/content",
    resourceType: "meetingTranscript",
    extraInput: {
      ...organizerInput,
      meetingId: z.string().describe("meetingId from list-org-meeting-transcripts"),
      transcriptId: z.string().describe("transcriptId from list-org-meeting-transcripts"),
    },
    handler: async (args, ctx) => {
      const g = app(ctx);
      const org = await organizerId(ctx, args.organizer);
      const path = `/users/${org.id}/onlineMeetings/${opaqueId(args.meetingId, "meetingId")}/transcripts/${opaqueId(args.transcriptId, "transcriptId")}/content`;
      try {
        return await g.request("GET", path, { query: { $format: "text/vtt" }, accept: "text/vtt" });
      } catch (err) {
        // Tenant setting "speaker attribution" off: only the unattributed format is served.
        if (err instanceof GraphError && err.status === 403 && err.code === "SpeakerAttributionNotAllowed") {
          return g.request("GET", path, { accept: "application/vnd.microsoft.graph.transcript+text" });
        }
        throw err;
      }
    },
  },
];
