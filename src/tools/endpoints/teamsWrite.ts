import { z } from "zod";
import type { EndpointDef } from "../types.js";
import type { AuditEntry } from "../../audit/audit.js";

/**
 * Teams WRITE toolset: sending messages as the signed-in user. Every send
 * requires confirm=true after explicit user approval - drafting a message
 * text in the conversation is never an implicit permission to post it.
 */

const messageInput = {
  message: z.string().describe("Message text to send"),
  contentType: z.enum(["text", "html"]).optional().describe("Message content type (default text)"),
};

const messageBody = (args: Record<string, any>) => ({
  body: { contentType: args.contentType ?? "text", content: args.message },
});

const teamsAudit = (target: string) =>
  (args: Record<string, any>, result: any): Partial<AuditEntry> => ({
    sender: "me",
    recipients: [target === "chat" ? `chat:${args.chatId}` : `team:${args.teamId}/channel:${args.channelId}`],
    messageId: result?.id,
    result: result ? "ok" : "error",
  });

export const teamsWriteEndpoints: EndpointDef[] = [
  {
    name: "send-chat-message",
    description:
      "SEND a message to a Teams chat (1:1 or group) as the signed-in user. WRITE operation - requires confirm=true after explicit user approval.",
    toolset: "teams-write",
    write: true,
    scopes: ["ChatMessage.Send"],
    method: "POST",
    path: "/chats/{chatId}/messages",
    pathParamDescriptions: { chatId: "Chat id (from list-chats)" },
    resourceType: "chatMessage",
    confirmRequired: true,
    sourceType: "chatMessage",
    extraInput: messageInput,
    buildBody: messageBody,
    auditWrite: teamsAudit("chat"),
  },
  {
    name: "send-channel-message",
    description:
      "POST a new message to a team channel as the signed-in user. WRITE operation - requires confirm=true after explicit user approval.",
    toolset: "teams-write",
    write: true,
    scopes: ["ChannelMessage.Send"],
    method: "POST",
    path: "/teams/{teamId}/channels/{channelId}/messages",
    resourceType: "chatMessage",
    confirmRequired: true,
    sourceType: "chatMessage",
    extraInput: messageInput,
    buildBody: messageBody,
    auditWrite: teamsAudit("channel"),
  },
  {
    name: "reply-to-channel-message",
    description:
      "REPLY to an existing channel message (thread) as the signed-in user. WRITE operation - requires confirm=true.",
    toolset: "teams-write",
    write: true,
    scopes: ["ChannelMessage.Send"],
    method: "POST",
    path: "/teams/{teamId}/channels/{channelId}/messages/{messageId}/replies",
    resourceType: "chatMessage",
    confirmRequired: true,
    sourceType: "chatMessage",
    extraInput: messageInput,
    buildBody: messageBody,
    auditWrite: teamsAudit("channel"),
  },
];
