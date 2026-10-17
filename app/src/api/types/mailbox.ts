/**
 * Mailbox is on the contract (packages/contract/schemas/mailbox.js): the connection,
 * folders, threads, drafts and the send queue are typed by the generated `Endpoints`
 * (api/endpoints.ts). These are the contract's types under the names the screens use.
 */
export type {
  MailAddress,
  MailAttachment,
  MailConnection,
  MailDraft,
  MailDraftSave,
  MailFolder,
  MailMessage,
  MailSend,
  QueuedMail,
  Thread,
  ThreadRow,
} from "@mycity/contract/contract.gen.ts";
