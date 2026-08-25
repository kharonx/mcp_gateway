/**
 * Delegated Microsoft Graph scopes of the Reporting MCP profile.
 * Principle: read broadly, write narrowly (Outlook mail only).
 */
export const READ_SCOPES = [
  "User.Read",
  "User.ReadBasic.All",
  "People.Read",
  "Mail.Read",
  "Mail.Read.Shared",
  "Calendars.Read",
  "Chat.Read",
  "Team.ReadBasic.All",
  "Channel.ReadBasic.All",
  "ChannelMessage.Read.All",
  "TeamMember.Read.All",
  "OnlineMeetings.Read",
  "OnlineMeetingTranscript.Read.All",
  "OnlineMeetingRecording.Read.All",
  "OnlineMeetingArtifact.Read.All",
  "Notes.Read",
  "Notes.Read.All",
  "Sites.Read.All",
  "Files.Read.All",
];

/** The only WRITE surface of v1: Outlook mail drafting + sending. */
export const WRITE_SCOPES = [
  "Mail.ReadWrite",
  "Mail.Send",
  "Mail.ReadWrite.Shared",
  "Mail.Send.Shared",
];

export const ALL_SCOPES = [...READ_SCOPES, ...WRITE_SCOPES];

/** Scope set requested when acquiring Graph tokens via On-Behalf-Of. */
export const GRAPH_DEFAULT_SCOPE = ["https://graph.microsoft.com/.default"];
