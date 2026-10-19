"use strict";
/**
 * Mailbox (M1, docs/guides/mailbox.md §5): each person's own company mailbox over IMAP
 * and SMTP. The connection, the six canonical folders, threads and their messages,
 * drafts and the send queue. Nobody reaches another person's mail.
 *
 * Addresses are plain strings on the wire. A message's sender carries its display name.
 */
const { z } = require("zod");
const { uuid, email, phone, blank, isoDateTime, listQuery, Paged } = require("./common");
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

/* ------------------------------------------------------------------ *
 * Signatures (mailbox.md §3 steps 7 to 9, §6): one design for everyone, built from records
 * ------------------------------------------------------------------ */

/** The full signature (new mail, forwards) or the slim line (replies, colleague-only mail). */
const SIGNATURE_VARIANTS = ["full", "slim"];
const SignatureVariant = z.enum(SIGNATURE_VARIANTS);

/** The company links Configure sets, in the order the wizard asks for them. */
const SIGNATURE_LINKS = [
  "app_store_url",
  "google_play_url",
  "instagram_url",
  "tiktok_url",
  "linkedin_url",
  "x_url",
  "facebook_url",
  "youtube_url",
];

/** An https address with a host: one rule, so a wrong link always reads "Not a web address". */
function isHttps(v) {
  if (!/^https:\/\/[^\s/]+\.[^\s]+$/i.test(v)) return false;
  try {
    return new URL(v).protocol === "https:";
  } catch {
    return false;
  }
}

/** A link a person pastes: an https address, or empty for none. */
const httpsLink = z
  .union([z.literal("").transform(() => null), z.string().trim().max(300).refine(isHttps, "Not a web address")])
  .nullable();

/** GET /mailbox/signature: the caller's signature drawn both ways, and what it is made of. */
const MySignature = z
  .object({
    name: z.string(),
    job_title: z.string().nullable(),
    department: z.string().nullable(),
    email: z.string().nullable(),
    /** E.164, from the employee record. */
    mobile: z.string().nullable(),
    office_line: z.string().nullable(),
    show_mobile: z.boolean(),
    show_whatsapp: z.boolean(),
    /** Whether the company shows WhatsApp links at all (Configure). */
    whatsapp_allowed: z.boolean(),
    /** Email HTML, its pictures inline as data: URLs, for a frame that shows no web images. */
    full_html: z.string(),
    slim_html: z.string(),
  })
  .strict();

/**
 * PATCH /mailbox/signature: the caller's numbers and switches, only the fields sent. A mobile
 * replaces the one on their employee record (through the organisation service, as Edit Profile
 * does); empty or absent leaves it as it is, as on Edit Profile. An empty office line clears it.
 */
const MySignatureSave = z
  .object({
    mobile: blank(phone),
    office_line: z.union([z.literal("").transform(() => null), phone]).nullable().optional(),
    show_mobile: z.boolean().optional(),
    show_whatsapp: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), "Change at least one field");

/** POST /mailbox/signature/preview: the composer's recipients and the message it answers. */
const SignaturePreviewRequest = z
  .object({
    in_reply_to: uuid.nullable().default(null),
    to_addresses: recipients.default([]),
    cc_addresses: recipients.default([]),
    bcc_addresses: recipients.default([]),
  })
  .strict();

/** What a message with those recipients would carry. */
const SignaturePreview = z.object({ variant: SignatureVariant, html: z.string() }).strict();

/** GET /mailbox/signature/config: the company's links and what shows on every signature. */
const SignatureConfig = z
  .object({
    app_store_url: z.string().nullable(),
    google_play_url: z.string().nullable(),
    instagram_url: z.string().nullable(),
    tiktok_url: z.string().nullable(),
    linkedin_url: z.string().nullable(),
    x_url: z.string().nullable(),
    facebook_url: z.string().nullable(),
    youtube_url: z.string().nullable(),
    confidentiality_note: z.string().nullable(),
    show_whatsapp: z.boolean(),
    show_app_links: z.boolean(),
    show_social_links: z.boolean(),
    show_legal: z.boolean(),
    updated_at: isoDateTime.nullable(),
  })
  .strict();

/** PUT /mailbox/signature/config: all of it at once, as the wizard's last step saves it. */
const SignatureConfigSave = z
  .object({
    app_store_url: httpsLink,
    google_play_url: httpsLink,
    instagram_url: httpsLink,
    tiktok_url: httpsLink,
    linkedin_url: httpsLink,
    x_url: httpsLink,
    facebook_url: httpsLink,
    youtube_url: httpsLink,
    confidentiality_note: z
      .union([z.literal("").transform(() => null), z.string().trim().max(300)])
      .nullable(),
    show_whatsapp: z.boolean(),
    show_app_links: z.boolean(),
    show_social_links: z.boolean(),
    show_legal: z.boolean(),
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
  MySignature: {
    table: "mail_signature",
    virtual: {
      name: "preferred name, else first name, then last name, from employee",
      job_title: "from employee",
      department: "the employee's department name, from department",
      email: "the connected mailbox address, from mail_account, else the work email",
      mobile: "employee.phone",
      whatsapp_allowed: "mail_signature_config.show_whatsapp",
      full_html: "the full signature drawn from all of the above and mail_signature_config",
      slim_html: "the slim line drawn from the same",
    },
  },
  MySignatureSave: {
    table: "mail_signature",
    virtual: { mobile: "employee.phone, written through the organisation service" },
  },
  SignaturePreviewRequest: { table: null, reason: "the composer's recipients and the message it answers" },
  SignaturePreview: { table: null, reason: "the signature a message with those recipients would carry" },
  SignatureConfig: { table: "mail_signature_config" },
  SignatureConfigSave: { table: "mail_signature_config" },
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
  SIGNATURE_VARIANTS,
  SIGNATURE_LINKS,
  SignatureVariant,
  MySignature,
  MySignatureSave,
  SignaturePreviewRequest,
  SignaturePreview,
  SignatureConfig,
  SignatureConfigSave,
};
