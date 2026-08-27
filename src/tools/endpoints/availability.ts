import { z } from "zod";
import type { EndpointDef } from "../types.js";

/**
 * Availability (free/busy) of OTHER users' calendars - READ semantics even
 * though Graph exposes them as POST actions. The caller only sees free/busy
 * blocks and working hours, never event contents, unless the target calendar
 * is explicitly shared with the signed-in user.
 */

const DEFAULT_TZ = "Europe/Budapest";

export const availabilityEndpoints: EndpointDef[] = [
  {
    name: "get-people-availability",
    description:
      "Free/busy availability (getSchedule) of one or more colleagues' calendars for a time window. Returns availabilityView (0=free, 1=tentative, 2=busy, 3=out of office) and busy time slots - event details stay hidden unless their calendar is shared with the user.",
    toolset: "calendar",
    scopes: ["Calendars.Read", "Calendars.Read.Shared"],
    method: "POST",
    path: "/me/calendar/getSchedule",
    resourceType: "scheduleInformation",
    extraInput: {
      emails: z.array(z.string()).min(1).describe("Email addresses of the people (their calendars) to check"),
      start: z.string().describe("Window start, ISO local format e.g. 2026-09-01T08:00:00"),
      end: z.string().describe("Window end, ISO local format"),
      timeZone: z.string().optional().describe(`IANA time zone (default ${DEFAULT_TZ})`),
      intervalMinutes: z.number().int().min(5).max(1440).optional().describe("availabilityView slot size in minutes (default 30)"),
    },
    buildBody: (args) => ({
      schedules: args.emails,
      startTime: { dateTime: args.start, timeZone: args.timeZone ?? DEFAULT_TZ },
      endTime: { dateTime: args.end, timeZone: args.timeZone ?? DEFAULT_TZ },
      availabilityViewInterval: args.intervalMinutes ?? 30,
    }),
  },
  {
    name: "find-meeting-times",
    description:
      "Suggest meeting time slots that work for the signed-in user and the given attendees (findMeetingTimes), based on free/busy data and working hours.",
    toolset: "calendar",
    scopes: ["Calendars.Read.Shared"],
    method: "POST",
    path: "/me/findMeetingTimes",
    resourceType: "meetingTimeSuggestions",
    extraInput: {
      attendees: z.array(z.string()).min(1).describe("Attendee email addresses"),
      durationMinutes: z.number().int().min(5).max(1440).describe("Meeting length in minutes"),
      windowStart: z.string().describe("Search window start, ISO local format"),
      windowEnd: z.string().describe("Search window end, ISO local format"),
      timeZone: z.string().optional().describe(`IANA time zone (default ${DEFAULT_TZ})`),
      maxCandidates: z.number().int().min(1).max(50).optional().describe("Max suggestions to return (default 10)"),
    },
    buildBody: (args) => ({
      attendees: (args.attendees as string[]).map((address) => ({
        emailAddress: { address },
        type: "required",
      })),
      timeConstraint: {
        activityDomain: "work",
        timeSlots: [
          {
            start: { dateTime: args.windowStart, timeZone: args.timeZone ?? DEFAULT_TZ },
            end: { dateTime: args.windowEnd, timeZone: args.timeZone ?? DEFAULT_TZ },
          },
        ],
      },
      meetingDuration: `PT${args.durationMinutes}M`,
      maxCandidates: args.maxCandidates ?? 10,
      returnSuggestionReasons: true,
    }),
  },
];
