/**
 * Source tracking (spec section 18): every returned object carries a _source
 * block so AI-generated report statements remain traceable to their
 * Microsoft 365 origin.
 */

export interface SourceInfo {
  sourceType: string;
  sourceId?: string;
  sourceUrl?: string;
  title?: string;
  author?: string;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  [k: string]: unknown;
}

type AnyObj = Record<string, any>;

function mailSource(m: AnyObj): SourceInfo {
  return {
    sourceType: "mailMessage",
    sourceId: m.id,
    messageId: m.internetMessageId ?? m.id,
    conversationId: m.conversationId,
    sourceUrl: m.webLink,
    title: m.subject,
    author: m.from?.emailAddress?.address ?? m.sender?.emailAddress?.address,
    sender: m.from?.emailAddress?.address ?? m.sender?.emailAddress?.address,
    receivedDateTime: m.receivedDateTime,
    createdDateTime: m.createdDateTime,
    lastModifiedDateTime: m.lastModifiedDateTime,
  };
}

function eventSource(e: AnyObj): SourceInfo {
  return {
    sourceType: "calendarEvent",
    sourceId: e.id,
    calendarEventId: e.id,
    sourceUrl: e.webLink,
    title: e.subject,
    author: e.organizer?.emailAddress?.address,
    organizer: e.organizer?.emailAddress?.address,
    participants: Array.isArray(e.attendees)
      ? e.attendees.map((a: AnyObj) => a?.emailAddress?.address).filter(Boolean)
      : undefined,
    start: e.start?.dateTime,
    end: e.end?.dateTime,
    createdDateTime: e.createdDateTime,
    lastModifiedDateTime: e.lastModifiedDateTime,
  };
}

function chatMessageSource(m: AnyObj): SourceInfo {
  return {
    sourceType: "chatMessage",
    sourceId: m.id,
    chatId: m.chatId,
    channelId: m.channelIdentity?.channelId,
    teamId: m.channelIdentity?.teamId,
    sourceUrl: m.webUrl,
    title: m.subject ?? undefined,
    author: m.from?.user?.displayName ?? m.from?.application?.displayName,
    createdDateTime: m.createdDateTime,
    lastModifiedDateTime: m.lastModifiedDateTime,
  };
}

function driveItemSource(d: AnyObj): SourceInfo {
  return {
    sourceType: "driveItem",
    sourceId: d.id,
    driveId: d.parentReference?.driveId,
    sourceUrl: d.webUrl,
    title: d.name,
    author: d.createdBy?.user?.displayName,
    createdDateTime: d.createdDateTime,
    lastModifiedDateTime: d.lastModifiedDateTime,
  };
}

function onenotePageSource(p: AnyObj): SourceInfo {
  return {
    sourceType: "onenotePage",
    sourceId: p.id,
    sourceUrl: p.links?.oneNoteWebUrl?.href,
    title: p.title,
    createdDateTime: p.createdDateTime,
    lastModifiedDateTime: p.lastModifiedDateTime,
  };
}

function meetingSource(m: AnyObj): SourceInfo {
  return {
    sourceType: "onlineMeeting",
    sourceId: m.id,
    meetingId: m.id,
    sourceUrl: m.joinWebUrl ?? m.joinUrl,
    title: m.subject,
    organizer: m.participants?.organizer?.upn ?? m.participants?.organizer?.identity?.user?.displayName,
    createdDateTime: m.creationDateTime,
    start: m.startDateTime,
    end: m.endDateTime,
  };
}

function siteSource(s: AnyObj): SourceInfo {
  return {
    sourceType: "site",
    sourceId: s.id,
    sourceUrl: s.webUrl,
    title: s.displayName ?? s.name,
    createdDateTime: s.createdDateTime,
    lastModifiedDateTime: s.lastModifiedDateTime,
  };
}

function userSource(u: AnyObj): SourceInfo {
  return {
    sourceType: "user",
    sourceId: u.id,
    title: u.displayName,
    mail: u.mail ?? u.userPrincipalName,
  };
}

const MAPPERS: Record<string, (o: AnyObj) => SourceInfo> = {
  mailMessage: mailSource,
  calendarEvent: eventSource,
  chatMessage: chatMessageSource,
  driveItem: driveItemSource,
  onenotePage: onenotePageSource,
  onlineMeeting: meetingSource,
  site: siteSource,
  user: userSource,
};

/** Attach a _source block to a single object (mutating copy). */
export function withSource(item: unknown, sourceType?: string): unknown {
  if (!sourceType || !item || typeof item !== "object") return item;
  const mapper = MAPPERS[sourceType];
  if (!mapper) return item;
  const src = mapper(item as AnyObj);
  // strip empty keys
  const clean: SourceInfo = { sourceType: src.sourceType };
  for (const [k, v] of Object.entries(src)) {
    if (v !== undefined && v !== null) clean[k] = v;
  }
  return { ...(item as AnyObj), _source: clean };
}

export function withSourceList(items: unknown[], sourceType?: string): unknown[] {
  if (!sourceType) return items;
  return items.map((i) => withSource(i, sourceType));
}
