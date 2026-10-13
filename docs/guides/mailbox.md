# Mailbox · Engineering Guide

| | |
|---|---|
| Owner | GE |
| Milestone | M1 |
| Backend modules | `mailbox` |
| Frontend paths | To be set when the frontend foundation lands (AJ). |
| Permission key(s) | `mailbox` |
| Screens (PROGRESS.md rows) | #18 Inbox, #19 Sent, #20 Drafts, #21 Archive, #22 Spam, #23 Trash; connection under Settings · Integrations |
| Status | Agreed |
| Last changed | 13/10/2026 |

Sources: MILESTONES §6.5 and D6; REUSE_MAP §2.5; the internal workflow meeting of 12 October 2026.
The demo (`demo.html`, Mailbox) was updated the same day with the composer described here.

---

## 1 · What it is for

Each member of staff reads and sends their **own MyCity mail** (`name@mycityapp.io`) inside the
app, without opening another mail client. It is a straightforward mail client: **receive and send,
manage your mail. It is not linked to operations, partnerships or any other module** in M1 (TB,
12 October). Linking a thread to a partner record is M7 (`mailbox/binding/`).

Custom domain only: no Google, no Microsoft, no OAuth. A user connects with their address and
password, as with any mail app.

## 2 · Screens affected

| Screen / tab (slug) | Where | Who sees it | What it shows | What a person can do there |
|---|---|---|---|---|
| Mailbox · Inbox (`inbox`) | Staff app | The mailbox owner only | Threads, newest first; the open message | Read, reply, reply all, forward, archive, move to spam or trash, download attachments |
| Mailbox · Sent (`sent`), Drafts (`drafts`), Archive (`archive`), Spam (`spam`), Trash (`trash`) | Staff app | Owner | The canonical six folders | As above; continue a draft; empty spam and trash |
| Composer (modal; full screen on mobile) | Staff app | Owner | From, To, Cc, Bcc, Subject, rich text body, attachments | Write, format, attach, send now or schedule, discard |
| Settings · Integrations, mailbox connection | Staff app | Owner | Connection status, last sync | Connect with address and password, test, reconnect, disconnect |
| Notification bell | Staff app | Owner | New mail (per Settings · Notifications) | Open the thread |

## 3 · How the screens relate

1. **Connect** (Settings · Integrations, or the first time Mailbox is opened): address and password →
   `autodiscover` finds the IMAP and SMTP hosts from the domain → `POST /connections` tests both →
   the password is stored encrypted in `integration_secret` under `mail_conn:<id>`, never on the
   connection row.
2. **Sync**: the worker's `mail-sync` scheduler and the `mail-idle` loop (IMAP IDLE) pull new mail
   into the six folders. New mail raises `mailbox.message.received` → notification.
3. **Read**: opening a thread marks it read on the server too. Remote images are not loaded until the
   reader asks.
4. **Compose / Reply / Forward**: the composer opens prefilled for Reply (To = sender, `Re:` subject,
   the original quoted) and Forward (`Fwd:`, original quoted, attachments carried). Drafts save as
   the person types.
5. **Send**: `POST /messages` puts the message on the send queue (`send-queue`) → `email-send`
   delivers through SMTP → the message lands in Sent. Scheduled mail waits on the queue until its
   release time and can be cancelled until then.

## 4 · Data

Proposed for the M1 migration block. Ported from praxis-ls `mail/mail` without the tenant columns.

| Table | Key columns | Notes |
|---|---|---|
| `mail_connection` | `connection_id`, `user_id`, `email_address`, `imap_host`, `imap_port`, `smtp_host`, `smtp_port`, `status`, `last_sync_at`, `last_error_code` | One per user in M1. Secret in `integration_secret` (`mail_conn:<id>`) |
| `mail_folder` | `folder_id`, `connection_id`, `kind` (`inbox` / `sent` / `drafts` / `archive` / `spam` / `trash` / `user`), `remote_name`, `uidvalidity` | The six canonical folders; server folders beyond them are read only |
| `mail_thread` | `thread_id`, `connection_id`, `subject`, `last_message_at`, `unread_count`, `has_attachment` | Threading by Message-ID / In-Reply-To / References (`threading.js`) |
| `mail_message` | `message_id`, `thread_id`, `folder_id`, `remote_uid`, `from_address`, `to` / `cc` jsonb, `subject`, `snippet`, `body_html_ref`, `flags`, `sent_at` | Bodies stored once; HTML sanitised before it is ever rendered |
| `mail_attachment` | `attachment_id`, `message_id`, `document_id`, `filename`, `mime`, `bytes` | Stored through the vault like any other file |
| `mail_draft` | `draft_id`, `user_id`, `to` / `cc` / `bcc` jsonb, `subject`, `body_html`, `attachment_ids`, `updated_at` | Autosaved |
| `mail_send_queue` | `queue_id`, `user_id`, `payload` jsonb, `status` (`queued` / `sending` / `sent` / `failed` / `cancelled`), `release_at`, `attempts`, `smtp_error_code` | Scheduled send and retry |

## 5 · API

All under `/api/v1/mailbox`. Every list is paged at 25.

| Method and path | Contract | Permission · scope | Paged | Notes |
|---|---|---|---|---|
| `GET /connection` | → `MailConnection` | `mailbox` view · own | | |
| `POST /connection` | `MailConnect` → `MailConnection` | `mailbox` create · own | | Address and password; autodiscover; test both directions before saving |
| `POST /connection/test`, `POST /connection/sync`, `POST /connection/disconnect` | | own | | |
| `GET /threads` | `ThreadListQuery` → `ThreadPage` | own | yes | Filters: `folder`, `q`, `unread` |
| `GET /threads/:id` | → `Thread` (messages) | own | | |
| `POST /threads/:id/read`, `POST /threads/:id/move` | `ThreadMove` | own | | Move to archive, spam, trash, inbox |
| `POST /folders/:kind/empty` | | own | | Spam and trash only |
| `GET /drafts/:id`, `PUT /drafts/:id`, `DELETE /drafts/:id` | `MailDraft` | own | | |
| `POST /messages` | `MailSend` → `QueuedMail` | `mailbox` create · own | | Send now or `release_at`; Idempotency-Key required |
| `POST /queue/:id/cancel` | | own | | Scheduled mail only |
| `POST /attachments` | multipart → `MailAttachment` | own | | Through `middleware/upload`, 25 MB |
| `GET /attachments/:id/content` | file | own | | Served through the gated document route |

## 6 · Rules and calculations

- A user reaches **only their own mailbox**. No one, People and the CEO included, can open another
  person's mail. Shared mailboxes are not in M1 (see §13).
- From is always the user's own connected address.
- Recipients must be email addresses; an invalid one is marked on its chip as it is typed.
- **Composer tools** (same as praxis-ls): Bold, Italic, Underline, Strikethrough, Heading, Bulleted
  and Numbered lists, Quote, Link (`https://` or `mailto:` only), Clear formatting, attachments.
  Later from the donor if wanted: code, table, rule, image by https address, text colour,
  highlight, mail-safe fonts only.
- **No native dialogs**: links are added in an inline field; discarding a draft asks inline.
- HTML mail is sanitised; scripts never run; remote images load only on request.
- Attachments: 25 MB each through the upload engine; types by the mime policy.
- Spam bodies are not rendered.
- Copy: Title Case chrome, no em dashes, day-first dates.

## 7 · Events, jobs and notifications

| Event / job | When | Does |
|---|---|---|
| `mail-sync` (scheduler + handler) | Every few minutes per connection | Pulls folders and new mail |
| `loops/mail-idle` | Continuously in the worker | IMAP IDLE: new mail arrives without polling |
| `email-send` | When a queued message is released | Delivers through SMTP; moves it to Sent; classifies failures (`smtp-errors`) |
| `mailbox.message.received` | New inbound message | Notification to the owner (`mail-notify`) |
| `mailbox.message.sent` / `mailbox.send.failed` | After delivery or a hard failure | Updates the queue; notifies on failure |

## 8 · Permissions and visibility by role

| Role | Sees | Can do |
|---|---|---|
| Every employee with `mailbox` view | Their own mailbox only | Connect, read, send, manage their folders |
| People, CEO | Their own mailbox only | Same. No access to other mailboxes |
| Leaver | Nothing | Connection disconnected and secret deleted on deactivation |

## 9 · AI and search

- **AI reads**: `// ai:none` in M1. Mail is private correspondence; the donor's mail assist is not
  ported (REUSE_MAP §2.5) and nothing in M1 asks for it.
- **Search** (`mailbox.search.js`, ⌘K): the caller's own threads by sender and subject, through the
  donor's `search.js`. Never another person's mail.

## 10 · Mobile

- Folder tabs scroll horizontally; the list fills the screen.
- Tapping a message opens the reader **full screen** with a Back button.
- The composer opens **full screen**, with Send always reachable at the bottom.

## 11 · Edge cases

- **Wrong password / server refuses**: the connection test fails with the classified reason and
  the fix (`smtp-error.map.js`); nothing is saved.
- **Password changed on the mail server**: sync fails → connection marked `needs_reconnect` → banner
  in Mailbox asks for the new password.
- **First sync of a large mailbox**: newest first, paged; older mail fills in in the background.
- **Hard-bounced recipient**: warned on the chip before sending again.
- **Double send** on a bad connection: refused by the Idempotency-Key.
- **Offline**: not supported; the draft is kept.
- **Dangerous attachment types**: refused by the mime policy; inbound ones are listed but not opened
  inline.

## 12 · Donor code

| From | File | Change on the way in |
|---|---|---|
| praxis-ls | `src/modules/mail/mail/` (12,250 loc, 39 files): `mail.service`, `providers/imapSmtp.provider`, `thread.*`, `threading`, `outbox.*` (send queue), `folders`, `autodiscover`, `smtp-error.map`, `compose`, `mail.validator`, `mail-notify.service`, `access`, `visible`, `search`, `presend`, `attachment.service`, `schedule`, `origin` | **First, cut the five `require` lines** into triage, binding and assist (MILESTONES §6.5). Delete the Microsoft and Google providers and OAuth. No tenant |
| praxis-ls | `src/jobs/mail-sync.js`, `handlers/mail-sync-scheduler.js`, `mail-idle.js` | Into `src/jobs/` per README §5.15 |
| praxis-ls | `client/src/features/comms/inbox/` incl. `composer/` (`toolbar.tsx`, `index.tsx`, `recipient-field.tsx`, `attachment-tray.tsx`) | The rich text composer, ported with MyCity branding |
| praxis-ls | `doc/SMART_MAIL_ENGINEERING_GUIDE.md`, `doc/SMART_MAIL_FIELD_NOTES.md` | **Read the field notes before starting** |

## 13 · Open questions

- Shared mailboxes (for example `people@mycityapp.io`): wanted, and in which milestone?
- Email signatures: the donor's signature builder was left out; is a plain text signature enough?
- Which server hosts MyCity's mail (cPanel or other), for autodiscover and the connection guide?
- Undo send window, and how long scheduled mail may wait.

## 14 · Change log

- 13/10/2026 · GE · First version, from the 12 October internal workflow meeting and MILESTONES §6.5.
