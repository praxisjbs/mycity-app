import type { DocumentRef, IsoDateTime, Paged, Uuid } from "./common";

/** INTERIM Mailbox shapes (owner GE; docs/guides/mailbox.md §5). The owner's own mailbox only. */
export type MailFolder = "inbox" | "sent" | "drafts" | "archive" | "spam" | "trash";
export interface MailAddress {
  name: string | null;
  address: string;
}
export interface MailConnection {
  connection_id: Uuid;
  email_address: string;
  status: "connected" | "needs_reconnect" | "disconnected";
  last_sync_at: IsoDateTime | null;
  last_error_code: string | null;
}
/** A row of the folder list. */
export interface ThreadRow {
  thread_id: Uuid;
  folder: MailFolder;
  subject: string;
  /** The other party: the sender in Inbox, the first recipient in Sent and Drafts. */
  party: MailAddress | null;
  snippet: string;
  last_message_at: IsoDateTime;
  unread: boolean;
  has_attachment: boolean;
  message_count: number;
  /** Drafts only: the draft to continue, and the send queue entry when it is scheduled. */
  draft_id: Uuid | null;
  scheduled: { queue_id: Uuid; release_at: IsoDateTime } | null;
}
/** Uploaded through the upload engine; stored in the vault. */
export type MailAttachment = DocumentRef & { attachment_id: Uuid };
export interface MailMessage {
  message_id: Uuid;
  from: MailAddress;
  to: MailAddress[];
  cc: MailAddress[];
  sent_at: IsoDateTime;
  /** Sanitised on the server. Null for spam: spam bodies are not rendered. */
  body_html: string | null;
  attachments: MailAttachment[];
}
export interface Thread {
  thread_id: Uuid;
  folder: MailFolder;
  subject: string;
  messages: MailMessage[];
}
export interface MailDraft {
  draft_id: Uuid;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body_html: string;
  attachments: MailAttachment[];
  updated_at: IsoDateTime;
}
export interface MailDraftSave {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body_html: string;
  attachment_ids: Uuid[];
}
export interface MailSend extends MailDraftSave {
  draft_id?: Uuid;
  /** Scheduled send: Lagos time, in the future. */
  release_at?: IsoDateTime;
}
export interface QueuedMail {
  queue_id: Uuid;
  status: "queued" | "sending" | "sent" | "failed" | "cancelled";
  release_at: IsoDateTime | null;
}

declare module "@/api/endpoints" {
  interface Endpoints {
    "GET /api/v1/mailbox/connection": { query: never; body: never; params: never; response: MailConnection };
    "POST /api/v1/mailbox/connection": { query: never; body: { email_address: string; password: string }; params: never; response: MailConnection };
    "POST /api/v1/mailbox/connection/test": { query: never; body: Record<string, never>; params: never; response: MailConnection };
    "POST /api/v1/mailbox/connection/sync": { query: never; body: Record<string, never>; params: never; response: MailConnection };
    "POST /api/v1/mailbox/connection/disconnect": { query: never; body: Record<string, never>; params: never; response: MailConnection };
    "GET /api/v1/mailbox/threads": { query: { page?: number; q?: string; folder?: MailFolder; unread?: boolean }; body: never; params: never; response: Paged<ThreadRow> };
    "GET /api/v1/mailbox/threads/:id": { query: never; body: never; params: { id: string }; response: Thread };
    "POST /api/v1/mailbox/threads/:id/read": { query: never; body: Record<string, never>; params: { id: string }; response: null };
    "POST /api/v1/mailbox/threads/:id/move": { query: never; body: { to: "inbox" | "archive" | "spam" | "trash" }; params: { id: string }; response: ThreadRow };
    "POST /api/v1/mailbox/folders/:kind/empty": { query: never; body: Record<string, never>; params: { kind: "spam" | "trash" }; response: { removed: number } };
    "GET /api/v1/mailbox/drafts/:id": { query: never; body: never; params: { id: string }; response: MailDraft };
    "PUT /api/v1/mailbox/drafts/:id": { query: never; body: MailDraftSave; params: { id: string }; response: MailDraft };
    "DELETE /api/v1/mailbox/drafts/:id": { query: never; body: never; params: { id: string }; response: null };
    "POST /api/v1/mailbox/messages": { query: never; body: MailSend; params: never; response: QueuedMail };
    "POST /api/v1/mailbox/queue/:id/cancel": { query: never; body: Record<string, never>; params: { id: string }; response: QueuedMail };
  }
}
