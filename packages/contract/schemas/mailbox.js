"use strict";
/**
 * Mailbox (M1, docs/guides/mailbox.md §5): each person's own company mailbox over IMAP
 * and SMTP. The connection, the six canonical folders, threads and their messages,
 * drafts and the send queue. Nobody reaches another person's mail.
 *
 * Addresses are plain strings on the wire. A message's sender carries its display name.
 */
const { z } = require("zod");
const { uuid, email, isoDateTime, listQuery, Paged } = require("./common");
const { DocumentRef } = require("./documents");

/** The six canonical folders (mailbox.md §4). Server folders beyond them are not synced. */
const MAIL_FOLDERS = ["inbox", "sent", "drafts", "archive", "spam", "trash"];
const MailFolder = z.enum(MAIL_FOLDERS);

const ACCOUNT_STATUSES = ["connected", "needs_reconnect", "disconnected"];
const AccountStatus = z.enum(ACCOUNT_STATUSES);

const QUEUE_STATUSES = ["queued", "sending", "sent", "failed", "cancelled"];
const QueueStatus = z.enum(QUEUE_STATUSES);

/** An address as a message names it. */
const MailAddress = z.object({ name: z.string().nullable(), address: z.string() }).strict();

/** The caller's connection, or `null` fields when they have none yet. */
const MailConnection = z
  .object({
    mail_account_id: uuid.nullable(),
    email: z.string().nullable(),
    status: AccountStatus,
    last_synced_at: isoDateTime.nullable(),
    last_error_code: z.string().nullable(),
  })
  .strict();

/** POST /mailbox/connection: the address and password, as with any mail app. */
const MailConnect = z
  .object({
    email,
    password: z.string().min(1).max(500),
  })
  .strict();

/** A row of a folder's list. Drafts are listed from the user's drafts, by draft id. */
const ThreadRow = z
  .object({
    mail_thread_id: uuid,
    folder: MailFolder,
    subject: z.string(),
    party: MailAddress.nullable(),
    snippet: z.string(),
    last_message_at: isoDateTime,
    unread: z.boolean(),
    has_attachment: z.boolean(),
    message_count: z.number().int().min(0),
    mail_draft_id: uuid.nullable(),
    scheduled: z.object({ mail_send_queue_id: uuid, release_at: isoDateTime }).strict().nullable(),
  })
  .strict();
const ThreadListQuery = listQuery({
  folder: MailFolder.default("inbox"),
  unread: z.coerce.boolean().optional(),
});
const ThreadPage = Paged(ThreadRow);

/** A file on a received or sent message. */
const MailAttachment = z
  .object({
    mail_attachment_id: uuid,
    document_id: uuid,
    file_name: z.string(),
    size_bytes: z.number().int().min(0),
    mime_type: z.string(),
  })
  .strict();

/** A part of a message drawn inside its body (a signature logo), which the body names as `cid:<content_id>`. */
const MailInlinePart = z
  .object({
    content_id: z.string(),
    document_id: uuid,
    mime_type: z.string(),
  })
  .strict();

/** One message of a thread. `body_html` is sanitised; it is null for spam (not rendered). */
const MailMessage = z
  .object({
    mail_message_id: uuid,
    from: MailAddress,
    to: z.array(z.string()),
    cc: z.array(z.string()),
    sent_at: isoDateTime,
    body_html: z.string().nullable(),
    attachments: z.array(MailAttachment),
    inline_parts: z.array(MailInlinePart),
    /** The owner chose Always Show Images for this sender: web images load without asking. */
    images_trusted: z.boolean(),
  })
  .strict();

/** POST /mailbox/image-trust: always show, or stop showing, web images from one sender. */
const MailImageTrust = z
  .object({
    sender_address: email,
    trusted: z.boolean(),
  })
  .strict();

const Thread = z
  .object({
    mail_thread_id: uuid,
    folder: MailFolder,
    subject: z.string(),
    messages: z.array(MailMessage).max(200),
  })
  .strict();

/** POST /mailbox/threads/:id/move. */
const ThreadMove = z.object({ to: z.enum(["inbox", "archive", "spam", "trash"]) }).strict();

const FolderParams = z.object({ kind: z.enum(["spam", "trash"]) }).strict();
const EmptyResult = z.object({ removed: z.number().int().min(0) }).strict();

const recipients = z.array(z.string().trim().min(1).max(254)).max(50);

/** A draft, as the composer saves it while the person types. */
const MailDraftSave = z
  .object({
    to_addresses: recipients.default([]),
    cc_addresses: recipients.default([]),
    bcc_addresses: recipients.default([]),
    subject: z.string().max(500).default(""),
    body_html: z.string().max(1_000_000).default(""),
    document_ids: z.array(uuid).max(20).default([]),
    in_reply_to: uuid.nullable().default(null),
  })
  .strict();

const MailDraft = z
  .object({
    mail_draft_id: uuid,
    to_addresses: z.array(z.string()),
    cc_addresses: z.array(z.string()),
    bcc_addresses: z.array(z.string()),
    subject: z.string(),
    body_html: z.string(),
    attachments: z.array(DocumentRef),
    in_reply_to: uuid.nullable(),
    updated_at: isoDateTime,
  })
  .strict();

/**
 * POST /mailbox/messages: send now, or at `release_at` (Lagos, in the future). Recipients
 * must be addresses; the From is always the caller's own connected address.
 */
const MailSend = z
  .object({
    mail_draft_id: uuid,
    to_addresses: z.array(email).min(1, "Add a recipient").max(50),
    cc_addresses: z.array(email).max(50).default([]),
    bcc_addresses: z.array(email).max(50).default([]),
    subject: z.string().max(500).default(""),
    body_html: z.string().max(1_000_000).default(""),
    document_ids: z.array(uuid).max(20).default([]),
    in_reply_to: uuid.nullable().default(null),
    release_at: isoDateTime.optional(),
  })
  .strict();

const QueuedMail = z
  .object({
    mail_send_queue_id: uuid,
    status: QueueStatus,
    release_at: isoDateTime,
  })
  .strict();

const TABLES = {
  MailAddress: { table: null, reason: "an address and its display name, as a message carries it" },
  MailConnection: {
    table: "mail_account",
    virtual: {},
  },
  MailConnect: {
    table: "mail_account",
    virtual: { password: "kept encrypted in integration_secret under mail_conn:<id>, never on the account row" },
  },
  ThreadRow: {
    table: "mail_thread",
    virtual: {
      folder: "the folder the thread's latest message is in, from mail_folder.kind",
      party: "the other side: the sender in Inbox, the first recipient in Sent and Drafts",
      snippet: "the start of the latest message's text",
      unread: "whether any message in the thread has no read_at",
      mail_draft_id: "a draft in Drafts, from mail_draft",
      scheduled: "a draft waiting on the send queue, from mail_send_queue",
    },
  },
  ThreadListQuery: { table: null, reason: "list controls, the folder and the unread filter" },
  ThreadPage: { table: null, reason: "a page of a folder" },
  MailAttachment: {
    table: "mail_attachment",
    virtual: {
      file_name: "the stored file's name, from document",
      size_bytes: "the stored file's size, from document",
      mime_type: "the stored file's type, from document",
    },
  },
  MailMessage: {
    table: "mail_message",
    virtual: {
      from: "from_address with its display name, from_name",
      to: "to_addresses",
      cc: "cc_addresses",
      attachments: "the message's files, from mail_attachment and document",
      inline_parts: "the parts the body draws by cid:, from mail_attachment where content_id is set",
      images_trusted: "whether the owner trusts this sender's images, from mail_image_trust",
    },
  },
  MailInlinePart: {
    table: "mail_attachment",
    virtual: { mime_type: "the stored file's type, from document" },
  },
  MailImageTrust: {
    table: "mail_image_trust",
    virtual: { trusted: "true adds the sender's row, false removes it" },
  },
  Thread: {
    table: "mail_thread",
    virtual: { folder: "the folder of the latest message", messages: "the thread's messages, oldest first" },
  },
  ThreadMove: { table: null, reason: "the folder to move a thread to" },
  FolderParams: { table: null, reason: "the folder in the path" },
  EmptyResult: { table: null, reason: "how many messages emptying a folder removed" },
  MailDraftSave: { table: "mail_draft" },
  MailDraft: {
    table: "mail_draft",
    virtual: { attachments: "the files named by document_ids, from document" },
  },
  MailSend: {
    table: "mail_draft",
    virtual: { release_at: "when it leaves, kept on mail_send_queue" },
  },
  QueuedMail: { table: "mail_send_queue" },
};

module.exports = {
  TABLES,
  MAIL_FOLDERS,
  ACCOUNT_STATUSES,
  QUEUE_STATUSES,
  MailFolder,
  AccountStatus,
  QueueStatus,
  MailAddress,
  MailConnection,
  MailConnect,
  ThreadRow,
  ThreadListQuery,
  ThreadPage,
  MailAttachment,
  MailInlinePart,
  MailMessage,
  MailImageTrust,
  Thread,
  ThreadMove,
  FolderParams,
  EmptyResult,
  MailDraftSave,
  MailDraft,
  MailSend,
  QueuedMail,
};
