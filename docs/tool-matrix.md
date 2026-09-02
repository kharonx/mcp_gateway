# Microsoft 365 Reporting MCP v1.0 - Tool / Permission Matrix

> Generated from `src/tools/endpoints/*.ts` by `npm run matrix`. Do not edit by hand.

Principle: **read broadly, write narrowly** - the WRITE surface is Outlook mail
(draft/send/reply/forward), calendar events, Teams messages and - when the optional
Salesforce Connected App is configured - Salesforce activity/record writes. Every
outbound send and every Salesforce write is gated by `confirm=true`.

Total tools: **120** (23 WRITE, 97 READ)

Toolsets: mail (7), shared-mail (5), mail-write (6), shared-mail-write (5), calendar (8), calendar-write (3), teams (12), teams-write (3), meetings (7), onenote (18), sharepoint (13), onedrive (7), loop (2), search (2), users (5), salesforce (11), salesforce-write (6)

| MCP tool | Toolset | R/W | HTTP | Endpoint (Graph v1.0 / Salesforce REST) | Delegated scopes | State | Capabilities |
|---|---|---|---|---|---|---|---|
| `list-mail-messages` | mail | READ | GET | `/me/messages` | Mail.Read | enabled | paginated, time-range, search |
| `get-mail-message` | mail | READ | GET | `/me/messages/{messageId}` | Mail.Read | enabled |  |
| `list-mail-folders` | mail | READ | GET | `/me/mailFolders` | Mail.Read | enabled | paginated |
| `list-mail-child-folders` | mail | READ | GET | `/me/mailFolders/{folderId}/childFolders` | Mail.Read | enabled | paginated |
| `list-mail-folder-messages` | mail | READ | GET | `/me/mailFolders/{folderId}/messages` | Mail.Read | enabled | paginated, time-range, search |
| `list-mail-attachments` | mail | READ | GET | `/me/messages/{messageId}/attachments` | Mail.Read | enabled | paginated |
| `get-mail-attachment-content` | mail | READ | GET | `/me/messages/{messageId}/attachments/{attachmentId}/$value` | Mail.Read | enabled | content-download |
| `list-shared-mailbox-folders` | shared-mail | READ | GET | `/users/{mailbox}/mailFolders` | Mail.Read.Shared | enabled | paginated |
| `list-shared-mailbox-messages` | shared-mail | READ | GET | `/users/{mailbox}/messages` | Mail.Read.Shared | enabled | paginated, time-range, search |
| `list-shared-mailbox-folder-messages` | shared-mail | READ | GET | `/users/{mailbox}/mailFolders/{folderId}/messages` | Mail.Read.Shared | enabled | paginated, time-range, search |
| `get-shared-mailbox-message` | shared-mail | READ | GET | `/users/{mailbox}/messages/{messageId}` | Mail.Read.Shared | enabled |  |
| `get-shared-mailbox-attachment-content` | shared-mail | READ | GET | `/users/{mailbox}/messages/{messageId}/attachments/{attachmentId}/$value` | Mail.Read.Shared | enabled | content-download |
| `create-draft-email` | mail-write | **WRITE** | POST | `/me/messages` | Mail.ReadWrite | enabled |  |
| `send-draft-email` | mail-write | **WRITE** | POST | `/me/messages/{messageId}/send` | Mail.Send | enabled | confirm-required |
| `send-mail` | mail-write | **WRITE** | POST | `/me/sendMail` | Mail.Send | enabled | confirm-required |
| `reply-mail` | mail-write | **WRITE** | POST | `/me/messages/{messageId}/reply` | Mail.Send | enabled | confirm-required |
| `reply-all-mail` | mail-write | **WRITE** | POST | `/me/messages/{messageId}/replyAll` | Mail.Send | enabled | confirm-required |
| `forward-mail` | mail-write | **WRITE** | POST | `/me/messages/{messageId}/forward` | Mail.Send | enabled | confirm-required |
| `create-shared-mailbox-draft` | shared-mail-write | **WRITE** | POST | `/users/{mailbox}/messages` | Mail.ReadWrite.Shared | enabled |  |
| `send-shared-mailbox-mail` | shared-mail-write | **WRITE** | POST | `/users/{mailbox}/sendMail` | Mail.Send.Shared | enabled | confirm-required |
| `reply-shared-mailbox-mail` | shared-mail-write | **WRITE** | POST | `/users/{mailbox}/messages/{messageId}/reply` | Mail.Send.Shared | enabled | confirm-required |
| `reply-all-shared-mailbox-mail` | shared-mail-write | **WRITE** | POST | `/users/{mailbox}/messages/{messageId}/replyAll` | Mail.Send.Shared | enabled | confirm-required |
| `forward-shared-mailbox-mail` | shared-mail-write | **WRITE** | POST | `/users/{mailbox}/messages/{messageId}/forward` | Mail.Send.Shared | enabled | confirm-required |
| `list-calendars` | calendar | READ | GET | `/me/calendars` | Calendars.Read | enabled | paginated |
| `get-calendar` | calendar | READ | GET | `/me/calendars/{calendarId}` | Calendars.Read | enabled |  |
| `get-calendar-view` | calendar | READ | GET | `/me/calendarView` | Calendars.Read | enabled | paginated, time-range |
| `list-calendar-events` | calendar | READ | GET | `/me/events` | Calendars.Read | enabled | paginated |
| `get-calendar-event` | calendar | READ | GET | `/me/events/{eventId}` | Calendars.Read | enabled |  |
| `list-event-attachments` | calendar | READ | GET | `/me/events/{eventId}/attachments` | Calendars.Read | enabled | paginated |
| `get-people-availability` | calendar | READ | POST | `/me/calendar/getSchedule` | Calendars.Read, Calendars.Read.Shared | enabled |  |
| `find-meeting-times` | calendar | READ | POST | `/me/findMeetingTimes` | Calendars.Read.Shared | enabled |  |
| `create-calendar-event` | calendar-write | **WRITE** | POST | `/me/events` | Calendars.ReadWrite | enabled | confirm-required |
| `update-calendar-event` | calendar-write | **WRITE** | PATCH | `/me/events/{eventId}` | Calendars.ReadWrite | enabled | confirm-required |
| `respond-to-calendar-event` | calendar-write | **WRITE** | POST | `/me/events/{eventId}/{response}` | Calendars.ReadWrite | enabled | confirm-required |
| `list-chats` | teams | READ | GET | `/me/chats` | Chat.Read | enabled | paginated |
| `get-chat` | teams | READ | GET | `/me/chats/{chatId}` | Chat.Read | enabled |  |
| `list-chat-messages` | teams | READ | GET | `/me/chats/{chatId}/messages` | Chat.Read | enabled | paginated, time-range |
| `get-chat-message` | teams | READ | GET | `/me/chats/{chatId}/messages/{messageId}` | Chat.Read | enabled |  |
| `list-joined-teams` | teams | READ | GET | `/me/joinedTeams` | Team.ReadBasic.All | enabled | paginated |
| `get-team` | teams | READ | GET | `/teams/{teamId}` | Team.ReadBasic.All | enabled |  |
| `list-team-channels` | teams | READ | GET | `/teams/{teamId}/channels` | Channel.ReadBasic.All | enabled | paginated |
| `get-team-channel` | teams | READ | GET | `/teams/{teamId}/channels/{channelId}` | Channel.ReadBasic.All | enabled |  |
| `list-channel-messages` | teams | READ | GET | `/teams/{teamId}/channels/{channelId}/messages` | ChannelMessage.Read.All | enabled | paginated |
| `get-channel-message` | teams | READ | GET | `/teams/{teamId}/channels/{channelId}/messages/{messageId}` | ChannelMessage.Read.All | enabled |  |
| `list-channel-message-replies` | teams | READ | GET | `/teams/{teamId}/channels/{channelId}/messages/{messageId}/replies` | ChannelMessage.Read.All | enabled | paginated |
| `list-team-members` | teams | READ | GET | `/teams/{teamId}/members` | TeamMember.Read.All | enabled | paginated |
| `send-chat-message` | teams-write | **WRITE** | POST | `/chats/{chatId}/messages` | ChatMessage.Send | enabled | confirm-required |
| `send-channel-message` | teams-write | **WRITE** | POST | `/teams/{teamId}/channels/{channelId}/messages` | ChannelMessage.Send | enabled | confirm-required |
| `reply-to-channel-message` | teams-write | **WRITE** | POST | `/teams/{teamId}/channels/{channelId}/messages/{messageId}/replies` | ChannelMessage.Send | enabled | confirm-required |
| `find-online-meeting-by-join-url` | meetings | READ | GET | `/me/onlineMeetings` | OnlineMeetings.Read | enabled | paginated, search |
| `get-online-meeting` | meetings | READ | GET | `/me/onlineMeetings/{meetingId}` | OnlineMeetings.Read | enabled |  |
| `list-meeting-transcripts` | meetings | READ | GET | `/me/onlineMeetings/{meetingId}/transcripts` | OnlineMeetingTranscript.Read.All | enabled | paginated |
| `get-meeting-transcript-content` | meetings | READ | GET | `/me/onlineMeetings/{meetingId}/transcripts/{transcriptId}/content` | OnlineMeetingTranscript.Read.All | enabled |  |
| `list-meeting-recordings` | meetings | READ | GET | `/me/onlineMeetings/{meetingId}/recordings` | OnlineMeetingRecording.Read.All | enabled | paginated |
| `list-meeting-attendance-reports` | meetings | READ | GET | `/me/onlineMeetings/{meetingId}/attendanceReports` | OnlineMeetingArtifact.Read.All | enabled | paginated |
| `list-meeting-attendance-records` | meetings | READ | GET | `/me/onlineMeetings/{meetingId}/attendanceReports/{reportId}/attendanceRecords` | OnlineMeetingArtifact.Read.All | enabled | paginated |
| `list-onenote-notebooks` | onenote | READ | GET | `/me/onenote/notebooks` | Notes.Read | enabled | paginated |
| `get-onenote-notebook` | onenote | READ | GET | `/me/onenote/notebooks/{notebookId}` | Notes.Read | enabled |  |
| `list-onenote-notebook-sections` | onenote | READ | GET | `/me/onenote/notebooks/{notebookId}/sections` | Notes.Read | enabled | paginated |
| `list-onenote-sections` | onenote | READ | GET | `/me/onenote/sections` | Notes.Read | enabled | paginated |
| `list-onenote-notebook-section-groups` | onenote | READ | GET | `/me/onenote/notebooks/{notebookId}/sectionGroups` | Notes.Read | enabled | paginated |
| `list-onenote-section-group-sections` | onenote | READ | GET | `/me/onenote/sectionGroups/{sectionGroupId}/sections` | Notes.Read | enabled | paginated |
| `list-onenote-section-pages` | onenote | READ | GET | `/me/onenote/sections/{sectionId}/pages` | Notes.Read | enabled | paginated, search |
| `search-onenote-pages` | onenote | READ | GET | `/me/onenote/pages` | Notes.Read | enabled | paginated, time-range, search |
| `get-onenote-page` | onenote | READ | GET | `/me/onenote/pages/{pageId}` | Notes.Read | enabled |  |
| `get-onenote-page-content` | onenote | READ | GET | `/me/onenote/pages/{pageId}/content` | Notes.Read | enabled |  |
| `list-site-onenote-notebooks` | onenote | READ | GET | `/sites/{siteId}/onenote/notebooks` | Notes.Read.All, Sites.Read.All | enabled | paginated |
| `list-site-onenote-notebook-sections` | onenote | READ | GET | `/sites/{siteId}/onenote/notebooks/{notebookId}/sections` | Notes.Read.All, Sites.Read.All | enabled | paginated |
| `list-site-onenote-sections` | onenote | READ | GET | `/sites/{siteId}/onenote/sections` | Notes.Read.All, Sites.Read.All | enabled | paginated |
| `list-site-onenote-notebook-section-groups` | onenote | READ | GET | `/sites/{siteId}/onenote/notebooks/{notebookId}/sectionGroups` | Notes.Read.All, Sites.Read.All | enabled | paginated |
| `list-site-onenote-section-group-sections` | onenote | READ | GET | `/sites/{siteId}/onenote/sectionGroups/{sectionGroupId}/sections` | Notes.Read.All, Sites.Read.All | enabled | paginated |
| `list-site-onenote-section-pages` | onenote | READ | GET | `/sites/{siteId}/onenote/sections/{sectionId}/pages` | Notes.Read.All, Sites.Read.All | enabled | paginated, search |
| `list-site-onenote-pages` | onenote | READ | GET | `/sites/{siteId}/onenote/pages` | Notes.Read.All, Sites.Read.All | enabled | paginated, search |
| `get-site-onenote-page-content` | onenote | READ | GET | `/sites/{siteId}/onenote/pages/{pageId}/content` | Notes.Read.All, Sites.Read.All | enabled |  |
| `search-sites` | sharepoint | READ | GET | `/sites` | Sites.Read.All | enabled | paginated, search |
| `get-site` | sharepoint | READ | GET | `/sites/{siteId}` | Sites.Read.All | enabled |  |
| `list-site-drives` | sharepoint | READ | GET | `/sites/{siteId}/drives` | Sites.Read.All | enabled | paginated |
| `get-drive` | sharepoint | READ | GET | `/drives/{driveId}` | Sites.Read.All, Files.Read.All | enabled |  |
| `list-drive-root-items` | sharepoint | READ | GET | `/drives/{driveId}/root/children` | Files.Read.All | enabled | paginated |
| `list-drive-folder-items` | sharepoint | READ | GET | `/drives/{driveId}/items/{itemId}/children` | Files.Read.All | enabled | paginated |
| `get-drive-item` | sharepoint | READ | GET | `/drives/{driveId}/items/{itemId}` | Files.Read.All | enabled |  |
| `search-drive-items` | sharepoint | READ | GET | `/drives/{driveId}/root/search(q='{q}')` | Files.Read.All | enabled | paginated |
| `download-drive-item` | sharepoint | READ | GET | `/drives/{driveId}/items/{itemId}/content` | Files.Read.All | enabled | content-download |
| `list-site-lists` | sharepoint | READ | GET | `/sites/{siteId}/lists` | Sites.Read.All | enabled | paginated |
| `get-site-list` | sharepoint | READ | GET | `/sites/{siteId}/lists/{listId}` | Sites.Read.All | enabled |  |
| `list-site-list-items` | sharepoint | READ | GET | `/sites/{siteId}/lists/{listId}/items` | Sites.Read.All | enabled | paginated |
| `get-site-list-item` | sharepoint | READ | GET | `/sites/{siteId}/lists/{listId}/items/{itemId}` | Sites.Read.All | enabled |  |
| `get-my-drive` | onedrive | READ | GET | `/me/drive` | Files.Read | enabled |  |
| `list-my-drive-root-items` | onedrive | READ | GET | `/me/drive/root/children` | Files.Read | enabled | paginated |
| `list-my-drive-folder-items` | onedrive | READ | GET | `/me/drive/items/{itemId}/children` | Files.Read | enabled | paginated |
| `get-my-drive-item` | onedrive | READ | GET | `/me/drive/items/{itemId}` | Files.Read | enabled |  |
| `get-my-drive-item-download-url` | onedrive | READ | GET | `/me/drive/items/{itemId}` | Files.Read | enabled |  |
| `search-my-drive` | onedrive | READ | GET | `/me/drive/root/search(q='{q}')` | Files.Read | enabled | paginated |
| `download-my-drive-item` | onedrive | READ | GET | `/me/drive/items/{itemId}/content` | Files.Read | enabled | content-download |
| `search-loop-components` | loop | READ | POST | `/search/query` | Files.Read.All, Sites.Read.All | enabled |  |
| `get-loop-component-content` | loop | READ | GET | `/drives/{driveId}/items/{itemId}/content` | Files.Read.All | enabled | content-download |
| `search-m365` | search | READ | POST | `/search/query` | Mail.Read, Calendars.Read, Chat.Read, Sites.Read.All, Files.Read.All | enabled |  |
| `search-people` | search | READ | GET | `/me/people` | People.Read | enabled | paginated, search |
| `list-users` | users | READ | GET | `/users` | User.Read.All | enabled | paginated |
| `get-user` | users | READ | GET | `/users/{userIdOrUpn}` | User.Read.All | enabled |  |
| `get-user-account-status-history` | users | READ | GET | `/auditLogs/directoryAudits` | AuditLog.Read.All, Directory.Read.All | enabled | paginated, time-range, search |
| `list-directory-audits` | users | READ | GET | `/auditLogs/directoryAudits` | AuditLog.Read.All, Directory.Read.All | enabled | paginated, time-range |
| `search-users` | users | READ | GET | `/users` | User.Read.All | enabled | paginated, search |
| `salesforce-connection-status` | salesforce | READ | GET | `Salesforce /services/data/vXX.X/limits` | Salesforce: api | optional (Connected App configured) |  |
| `salesforce-soql-query` | salesforce | READ | GET | `Salesforce /services/data/vXX.X/query` | Salesforce: api | optional (Connected App configured) | paginated |
| `salesforce-sosl-search` | salesforce | READ | GET | `Salesforce /services/data/vXX.X/search` | Salesforce: api | optional (Connected App configured) |  |
| `list-salesforce-objects` | salesforce | READ | GET | `Salesforce /services/data/vXX.X/sobjects` | Salesforce: api | optional (Connected App configured) |  |
| `describe-salesforce-object` | salesforce | READ | GET | `Salesforce /services/data/vXX.X/sobjects/{object}/describe` | Salesforce: api | optional (Connected App configured) |  |
| `get-salesforce-record` | salesforce | READ | GET | `Salesforce /services/data/vXX.X/sobjects/{object}/{id}` | Salesforce: api | optional (Connected App configured) |  |
| `list-salesforce-records` | salesforce | READ | GET | `Salesforce /services/data/vXX.X/query` | Salesforce: api | optional (Connected App configured) | paginated, time-range |
| `get-salesforce-recent-items` | salesforce | READ | GET | `Salesforce /services/data/vXX.X/recent` | Salesforce: api | optional (Connected App configured) |  |
| `get-salesforce-account-overview` | salesforce | READ | GET | `Salesforce /services/data/vXX.X/query` | Salesforce: api | optional (Connected App configured) |  |
| `list-salesforce-reports` | salesforce | READ | GET | `Salesforce /services/data/vXX.X/query` | Salesforce: api | optional (Connected App configured) | paginated |
| `run-salesforce-report` | salesforce | READ | GET | `Salesforce /services/data/vXX.X/analytics/reports/{reportId}` | Salesforce: api | optional (Connected App configured) |  |
| `create-salesforce-record` | salesforce-write | **WRITE** | POST | `Salesforce /services/data/vXX.X/sobjects/{object}` | Salesforce: api | optional (Connected App configured) | confirm-required |
| `update-salesforce-record` | salesforce-write | **WRITE** | PATCH | `Salesforce /services/data/vXX.X/sobjects/{object}/{recordId}` | Salesforce: api | optional (Connected App configured) | confirm-required |
| `create-salesforce-task` | salesforce-write | **WRITE** | POST | `Salesforce /services/data/vXX.X/sobjects/Task` | Salesforce: api | optional (Connected App configured) | confirm-required |
| `create-salesforce-event` | salesforce-write | **WRITE** | POST | `Salesforce /services/data/vXX.X/sobjects/Event` | Salesforce: api | optional (Connected App configured) | confirm-required |
| `post-salesforce-chatter` | salesforce-write | **WRITE** | POST | `Salesforce /services/data/vXX.X/sobjects/FeedItem` | Salesforce: api | optional (Connected App configured) | confirm-required |
| `create-salesforce-note` | salesforce-write | **WRITE** | POST | `Salesforce /services/data/vXX.X/sobjects/ContentNote` | Salesforce: api | optional (Connected App configured) | confirm-required |

## Deliberately NOT exposed (safety layer, spec sections 19-20)

- No generic `graph-request(method, url, body)` passthrough tool.
- No `$batch` passthrough.
- No Files/Sites/OneNote/User/Group write, and no delete anywhere.
- Mail delete / folder delete / destructive mailbox operations are excluded.
- Salesforce (optional): reads plus a narrow write surface (create/update record, task, event, Chatter post, note) - no delete, no Apex/Bulk/Metadata API; every call uses the user's own linked Salesforce login.
