import { z } from "zod";
import type { EndpointDef } from "../types.js";

/**
 * Teams meeting artifacts: online meetings, transcripts, recordings,
 * attendance. Link a calendar event to its online meeting via
 * find-online-meeting-by-join-url (the event's onlineMeeting.joinUrl).
 */
export const meetingsEndpoints: EndpointDef[] = [
  {
    name: "find-online-meeting-by-join-url",
    description:
      "Resolve an onlineMeeting from a Teams join URL (calendar event -> onlineMeeting.joinUrl -> this tool). This is how a calendar event is connected to its transcripts/recordings/attendance.",
    toolset: "meetings",
    scopes: ["OnlineMeetings.Read"],
    method: "GET",
    path: "/me/onlineMeetings",
    resourceType: "onlineMeeting",
    paginated: true,
    noTop: true,
    sourceType: "onlineMeeting",
    extraInput: {
      joinWebUrl: z.string().describe("The Teams meeting join URL (event.onlineMeeting.joinUrl)"),
    },
    buildQuery: (args) => ({ $filter: `JoinWebUrl eq '${String(args.joinWebUrl).replace(/'/g, "''")}'` }),
  },
  {
    name: "get-online-meeting",
    description: "Get an online meeting by its onlineMeeting id (subject, organizer, participants, join URL, start/end).",
    toolset: "meetings",
    scopes: ["OnlineMeetings.Read"],
    method: "GET",
    path: "/me/onlineMeetings/{meetingId}",
    resourceType: "onlineMeeting",
    sourceType: "onlineMeeting",
  },
  {
    name: "list-meeting-transcripts",
    description: "List transcripts available for an online meeting (metadata: id, created date).",
    toolset: "meetings",
    scopes: ["OnlineMeetingTranscript.Read.All"],
    method: "GET",
    path: "/me/onlineMeetings/{meetingId}/transcripts",
    resourceType: "meetingTranscript",
    paginated: true,
    noTop: true,
  },
  {
    name: "get-meeting-transcript-content",
    description:
      "Get the FULL TEXT of a meeting transcript in WebVTT format (speaker, timestamp, text preserved). Use for meeting summaries, decisions and commitments extraction.",
    toolset: "meetings",
    scopes: ["OnlineMeetingTranscript.Read.All"],
    method: "GET",
    path: "/me/onlineMeetings/{meetingId}/transcripts/{transcriptId}/content",
    resourceType: "meetingTranscript",
    staticQuery: { $format: "text/vtt" },
    accept: "text/vtt",
  },
  {
    name: "list-meeting-recordings",
    description: "List recordings of an online meeting (metadata + content URL; the recording itself stays in OneDrive/SharePoint).",
    toolset: "meetings",
    scopes: ["OnlineMeetingRecording.Read.All"],
    method: "GET",
    path: "/me/onlineMeetings/{meetingId}/recordings",
    resourceType: "meetingRecording",
    paginated: true,
    noTop: true,
  },
  {
    name: "list-meeting-attendance-reports",
    description: "List attendance reports of an online meeting.",
    toolset: "meetings",
    scopes: ["OnlineMeetingArtifact.Read.All"],
    method: "GET",
    path: "/me/onlineMeetings/{meetingId}/attendanceReports",
    resourceType: "attendanceReport",
    paginated: true,
    noTop: true,
  },
  {
    name: "list-meeting-attendance-records",
    description: "List attendance records (who joined, when, for how long) of an attendance report.",
    toolset: "meetings",
    scopes: ["OnlineMeetingArtifact.Read.All"],
    method: "GET",
    path: "/me/onlineMeetings/{meetingId}/attendanceReports/{reportId}/attendanceRecords",
    resourceType: "attendanceRecord",
    paginated: true,
    noTop: true,
  },
];
