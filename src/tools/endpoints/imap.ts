import { z } from "zod";
import type { EndpointDef, ToolContext } from "../types.js";
import { listFolders, listMessages, getMessage, getAttachment, setSeen } from "../../imap/client.js";

/**
 * Optional IMAP mailboxes (provider "imap"): external mailboxes the user linked
 * on the portal (hosting provider, Gmail with an app password, ...). Credentials
 * never pass through a tool - the AI only sees account ids. Toolset imap reads
 * (never sets \Seen), toolset imap-write only flips the read flag.
 */

function account(ctx: ToolContext, accountId: string) {
  if (!ctx.imap) throw new Error("IMAP mailboxes are not available on this gateway (IMAP_ENCRYPTION_KEY not set, or stdio mode).");
  return ctx.imap.credentials(accountId);
}

const accountIdParam = { accountId: "Id of a linked IMAP mailbox (from list-imap-accounts)" };
const messageIdInput = { messageId: z.string().describe("messageId returned by list-imap-messages") };

export const imapEndpoints: EndpointDef[] = [
  {
    name: "list-imap-accounts",
    description:
      "List the external IMAP mailboxes (non-Microsoft 365: hosting provider, Gmail, ...) the signed-in user linked on the gateway portal. Returns account ids for the other imap tools. Mailboxes can only be linked or removed by the user on the portal, never through a tool.",
    toolset: "imap",
    provider: "imap",
    scopes: [],
    method: "GET",
    path: "imap://accounts",
    resourceType: "imapAccount",
    handler: async (_args, ctx) => {
      if (!ctx.imap) throw new Error("IMAP mailboxes are not available on this gateway (IMAP_ENCRYPTION_KEY not set, or stdio mode).");
      const accounts = ctx.imap.accounts();
      return {
        count: accounts.length,
        accounts: accounts.map(({ id, label, email, host, username }) => ({ accountId: id, label, email, host, username })),
        ...(accounts.length ? {} : { note: `No IMAP mailbox linked yet. The user can link one on the gateway portal: ${ctx.imap.connectUrl}` }),
      };
    },
  },
  {
    name: "list-imap-folders",
    description: "List the folders of a linked IMAP mailbox with message and unread counts. Use the returned path (e.g. INBOX, INBOX.Sent, [Gmail]/Sent Mail) in list-imap-messages; specialUse marks \\Sent, \\Trash, \\Junk, \\Drafts, \\Archive.",
    toolset: "imap",
    provider: "imap",
    scopes: [],
    method: "GET",
    path: "imap://{accountId}/folders",
    pathParamDescriptions: accountIdParam,
    resourceType: "imapFolder",
    handler: async (args, ctx) => ({ accountId: args.accountId, folders: await listFolders(account(ctx, args.accountId)) }),
  },
  {
    name: "list-imap-messages",
    description:
      "List or search messages in a folder of a linked IMAP mailbox, newest first (subject, from, to, date, read flag, attachments). Filters combine with AND. Reading never marks anything as read. When truncated=true call again with cursor=nextCursor.",
    toolset: "imap",
    provider: "imap",
    scopes: [],
    method: "GET",
    path: "imap://{accountId}/messages",
    pathParamDescriptions: accountIdParam,
    resourceType: "imapMessage",
    extraInput: {
      folder: z.string().optional().describe("Folder path from list-imap-folders (default INBOX)"),
      from: z.string().optional().describe("Sender contains (address or name)"),
      to: z.string().optional().describe("Recipient contains"),
      subject: z.string().optional().describe("Subject contains"),
      text: z.string().optional().describe("Text anywhere in headers or body"),
      since: z.string().optional().describe("Received on or after this date (YYYY-MM-DD)"),
      before: z.string().optional().describe("Received before this date (YYYY-MM-DD)"),
      unreadOnly: z.boolean().optional().describe("Only unread messages"),
      maxItems: z.number().int().positive().optional().describe("Max messages to return (default 50)"),
      cursor: z.string().optional().describe("nextCursor from a previous call"),
    },
    handler: async (args, ctx) => {
      for (const k of ["since", "before"] as const) {
        if (args[k] !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(args[k])) throw new Error(`${k} must be YYYY-MM-DD.`);
      }
      return {
        accountId: args.accountId,
        ...(await listMessages(account(ctx, args.accountId), {
          folder: args.folder || "INBOX",
          from: args.from,
          to: args.to,
          subject: args.subject,
          text: args.text,
          since: args.since,
          before: args.before,
          unreadOnly: args.unreadOnly,
          maxItems: Math.min(Number(args.maxItems) || ctx.config.defaultPageItems, ctx.config.maxPageItems),
          cursor: args.cursor,
        })),
      };
    },
  },
  {
    name: "get-imap-message",
    description: "Read one message of a linked IMAP mailbox: headers, plain-text body and the attachment list (index, name, type, size). Does not mark it as read.",
    toolset: "imap",
    provider: "imap",
    scopes: [],
    method: "GET",
    path: "imap://{accountId}/message",
    pathParamDescriptions: accountIdParam,
    resourceType: "imapMessage",
    extraInput: messageIdInput,
    handler: async (args, ctx) => ({
      accountId: args.accountId,
      ...(await getMessage(account(ctx, args.accountId), args.messageId, ctx.config.maxDownloadBytes)),
    }),
  },
  {
    name: "get-imap-attachment-content",
    description: "Read an attachment of an IMAP message as text (PDF, Word, Excel, PowerPoint, text/CSV/HTML) or base64. index comes from get-imap-message.",
    toolset: "imap",
    provider: "imap",
    scopes: [],
    method: "GET",
    path: "imap://{accountId}/attachment",
    pathParamDescriptions: accountIdParam,
    resourceType: "imapAttachment",
    binary: true,
    extraInput: {
      ...messageIdInput,
      index: z.number().int().min(0).describe("Attachment index from get-imap-message"),
    },
    handler: async (args, ctx) => getAttachment(account(ctx, args.accountId), args.messageId, Number(args.index), ctx.config.maxDownloadBytes),
  },
];

export const imapWriteEndpoints: EndpointDef[] = [
  {
    name: "mark-imap-mail-read",
    description:
      "Mark a message in a linked IMAP mailbox as read (isRead=true, default) or unread (isRead=false). Changes only the \\Seen flag - nothing is sent, moved or deleted.",
    toolset: "imap-write",
    write: true,
    provider: "imap",
    scopes: [],
    method: "PATCH",
    path: "imap://{accountId}/message/flags",
    pathParamDescriptions: accountIdParam,
    resourceType: "imapMessage",
    extraInput: {
      ...messageIdInput,
      isRead: z.boolean().optional().describe("true = mark as read (default), false = mark as unread"),
    },
    handler: async (args, ctx) => ({
      accountId: args.accountId,
      ...(await setSeen(account(ctx, args.accountId), args.messageId, args.isRead ?? true)),
    }),
    auditWrite: (args, result) => ({ messageId: args.messageId, result: result ? `ok (isRead=${args.isRead ?? true})` : "error" }),
  },
];
