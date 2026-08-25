import { z } from "zod";
import type { EndpointDef } from "../types.js";
import type { AuditEntry } from "../../audit/audit.js";

/**
 * The ONLY write surface of the Reporting profile v1: Outlook drafting + sending.
 * Safety policy (spec section 5):
 *  - CREATE DRAFT and SEND are separate tools;
 *  - a draft is never an implicit permission to send;
 *  - every actual send/reply/forward requires confirm=true.
 */

const recipients = (list?: string[]) => (list ?? []).map((address) => ({ emailAddress: { address } }));

const composeInput = {
  to: z.array(z.string()).min(1).describe("Recipient email addresses"),
  cc: z.array(z.string()).optional().describe("CC email addresses"),
  bcc: z.array(z.string()).optional().describe("BCC email addresses"),
  subject: z.string().describe("Email subject"),
  body: z.string().describe("Email body content"),
  bodyType: z.enum(["HTML", "Text"]).optional().describe("Body content type (default HTML)"),
};

function messagePayload(args: Record<string, any>) {
  return {
    subject: args.subject,
    body: { contentType: args.bodyType ?? "HTML", content: args.body },
    toRecipients: recipients(args.to),
    ...(args.cc?.length ? { ccRecipients: recipients(args.cc) } : {}),
    ...(args.bcc?.length ? { bccRecipients: recipients(args.bcc) } : {}),
    ...(args.importance ? { importance: args.importance } : {}),
  };
}

function composeAudit(args: Record<string, any>, result: any): Partial<AuditEntry> {
  return {
    sender: args.mailbox ?? "me",
    recipients: args.to,
    cc: args.cc,
    subject: args.subject,
    messageId: result?.id ?? result?.internetMessageId,
    result: result ? "ok" : "error",
  };
}

function replyAudit(args: Record<string, any>, result: any): Partial<AuditEntry> {
  return {
    sender: args.mailbox ?? "me",
    recipients: args.to,
    messageId: args.messageId,
    result: result ? "ok" : "error",
  };
}

export const mailWriteEndpoints: EndpointDef[] = [
  {
    name: "create-draft-email",
    description:
      "Create a DRAFT email in the signed-in user's Drafts folder. Does NOT send anything - use send-draft-email (with explicit user approval) to send it.",
    toolset: "mail-write",
    write: true,
    scopes: ["Mail.ReadWrite"],
    method: "POST",
    path: "/me/messages",
    resourceType: "mailMessage",
    extraInput: { ...composeInput, importance: z.enum(["low", "normal", "high"]).optional() },
    buildBody: messagePayload,
    auditWrite: composeAudit,
  },
  {
    name: "send-draft-email",
    description:
      "SEND a previously created draft. WRITE operation - requires confirm=true and explicit user approval.",
    toolset: "mail-write",
    write: true,
    scopes: ["Mail.Send"],
    method: "POST",
    path: "/me/messages/{messageId}/send",
    pathParamDescriptions: { messageId: "Draft message id returned by create-draft-email" },
    resourceType: "mailMessage",
    confirmRequired: true,
    buildBody: () => ({}),
    auditWrite: replyAudit,
  },
  {
    name: "send-mail",
    description:
      "Compose and SEND an email in one step as the signed-in user. WRITE operation - requires confirm=true and explicit user approval. Prefer create-draft-email + user review for report emails.",
    toolset: "mail-write",
    write: true,
    scopes: ["Mail.Send"],
    method: "POST",
    path: "/me/sendMail",
    resourceType: "mailMessage",
    confirmRequired: true,
    extraInput: {
      ...composeInput,
      importance: z.enum(["low", "normal", "high"]).optional(),
      saveToSentItems: z.boolean().optional().describe("Save to Sent Items (default true)"),
    },
    buildBody: (args) => ({ message: messagePayload(args), saveToSentItems: args.saveToSentItems ?? true }),
    auditWrite: composeAudit,
  },
  {
    name: "reply-mail",
    description: "Reply to a message as the signed-in user. Requires confirm=true.",
    toolset: "mail-write",
    write: true,
    scopes: ["Mail.Send"],
    method: "POST",
    path: "/me/messages/{messageId}/reply",
    resourceType: "mailMessage",
    confirmRequired: true,
    extraInput: { comment: z.string().describe("Reply body text") },
    buildBody: (args) => ({ comment: args.comment }),
    auditWrite: replyAudit,
  },
  {
    name: "reply-all-mail",
    description: "Reply-all to a message as the signed-in user. Requires confirm=true.",
    toolset: "mail-write",
    write: true,
    scopes: ["Mail.Send"],
    method: "POST",
    path: "/me/messages/{messageId}/replyAll",
    resourceType: "mailMessage",
    confirmRequired: true,
    extraInput: { comment: z.string().describe("Reply body text") },
    buildBody: (args) => ({ comment: args.comment }),
    auditWrite: replyAudit,
  },
  {
    name: "forward-mail",
    description: "Forward a message as the signed-in user. Requires confirm=true.",
    toolset: "mail-write",
    write: true,
    scopes: ["Mail.Send"],
    method: "POST",
    path: "/me/messages/{messageId}/forward",
    resourceType: "mailMessage",
    confirmRequired: true,
    extraInput: {
      to: z.array(z.string()).min(1).describe("Forward recipients"),
      comment: z.string().optional().describe("Comment prepended to the forwarded message"),
    },
    buildBody: (args) => ({ comment: args.comment ?? "", toRecipients: recipients(args.to) }),
    auditWrite: replyAudit,
  },
  // ── Shared mailbox variants ─────────────────────────────────────────
  {
    name: "create-shared-mailbox-draft",
    description: "Create a DRAFT in a shared mailbox. Does NOT send.",
    toolset: "shared-mail-write",
    write: true,
    scopes: ["Mail.ReadWrite.Shared"],
    method: "POST",
    path: "/users/{mailbox}/messages",
    pathParamDescriptions: { mailbox: "Shared mailbox address" },
    resourceType: "mailMessage",
    extraInput: { ...composeInput, importance: z.enum(["low", "normal", "high"]).optional() },
    buildBody: messagePayload,
    auditWrite: composeAudit,
  },
  {
    name: "send-shared-mailbox-mail",
    description: "Compose and SEND an email from a shared mailbox. Requires confirm=true and explicit user approval.",
    toolset: "shared-mail-write",
    write: true,
    scopes: ["Mail.Send.Shared"],
    method: "POST",
    path: "/users/{mailbox}/sendMail",
    pathParamDescriptions: { mailbox: "Shared mailbox address" },
    resourceType: "mailMessage",
    confirmRequired: true,
    extraInput: {
      ...composeInput,
      saveToSentItems: z.boolean().optional().describe("Save to Sent Items (default true)"),
    },
    buildBody: (args) => ({ message: messagePayload(args), saveToSentItems: args.saveToSentItems ?? true }),
    auditWrite: composeAudit,
  },
  {
    name: "reply-shared-mailbox-mail",
    description: "Reply to a shared-mailbox message. Requires confirm=true.",
    toolset: "shared-mail-write",
    write: true,
    scopes: ["Mail.Send.Shared"],
    method: "POST",
    path: "/users/{mailbox}/messages/{messageId}/reply",
    pathParamDescriptions: { mailbox: "Shared mailbox address" },
    resourceType: "mailMessage",
    confirmRequired: true,
    extraInput: { comment: z.string().describe("Reply body text") },
    buildBody: (args) => ({ comment: args.comment }),
    auditWrite: replyAudit,
  },
  {
    name: "reply-all-shared-mailbox-mail",
    description: "Reply-all to a shared-mailbox message. Requires confirm=true.",
    toolset: "shared-mail-write",
    write: true,
    scopes: ["Mail.Send.Shared"],
    method: "POST",
    path: "/users/{mailbox}/messages/{messageId}/replyAll",
    pathParamDescriptions: { mailbox: "Shared mailbox address" },
    resourceType: "mailMessage",
    confirmRequired: true,
    extraInput: { comment: z.string().describe("Reply body text") },
    buildBody: (args) => ({ comment: args.comment }),
    auditWrite: replyAudit,
  },
  {
    name: "forward-shared-mailbox-mail",
    description: "Forward a shared-mailbox message. Requires confirm=true.",
    toolset: "shared-mail-write",
    write: true,
    scopes: ["Mail.Send.Shared"],
    method: "POST",
    path: "/users/{mailbox}/messages/{messageId}/forward",
    pathParamDescriptions: { mailbox: "Shared mailbox address" },
    resourceType: "mailMessage",
    confirmRequired: true,
    extraInput: {
      to: z.array(z.string()).min(1).describe("Forward recipients"),
      comment: z.string().optional().describe("Comment prepended to the forwarded message"),
    },
    buildBody: (args) => ({ comment: args.comment ?? "", toRecipients: recipients(args.to) }),
    auditWrite: replyAudit,
  },
];
