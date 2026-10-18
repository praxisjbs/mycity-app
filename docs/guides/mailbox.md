# Mailbox · Engineering Guide

| | |
|---|---|
| Owner | GE |
| Milestone | M1 |
| Backend modules | `mailbox` |
| Frontend paths | `app/src/features/mailbox/` |
| Permission key(s) | `mailbox` |
| Capabilities | none |
| Screens (PROGRESS.md rows) | #18 Inbox, #19 Sent, #20 Drafts, #21 Archive, #22 Spam, #23 Trash; connection under Settings · Integrations |
| Status | Built |
| Last changed | 17/10/2026 |

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
| Mailbox · Connect (sheet) | Staff app | Owner | Opens over Mailbox when the user has no connection, or when the server refused the saved password | Connect with address and password; reconnect |
| Composer (modal; full screen on mobile) | Staff app | Owner | From, To, Cc, Bcc, Subject, rich text body, attachments | Write, format, attach, send now or schedule, discard |
| Settings · Integrations, mailbox connection | Staff app | Owner | Connection status, last sync | Reads the connection; connecting happens in Mailbox |
| Notification bell | Staff app | Owner | New mail (per Settings · Notifications) | Open the thread |

## 3 · How the screens relate

1. **Connect** (the Connect sheet, which opens over Mailbox the first time it is opened with no
   connection; GE, 17/10/2026): address and password →
   `autodiscover` uses the address's own domain as the IMAP and SMTP host (`mycityapp.io`, the name
   on the host's certificate; the `MAILBOX_*` settings override it) → `POST /connection` signs in to both before anything is saved → the password is stored
   encrypted in `integration_secret` under `mail_conn:<id>`, never on the connection row. The first
   sync starts at once (`mail_account.connected` → `mail-sync`).
2. **Sync**: the worker's `mail-sync` scheduler and the `mail-idle` loop (IMAP IDLE) pull new mail
   into the six folders, reading each from its last UID (a folder whose UIDVALIDITY changed is read
   again from the start). New mail raises `mail_message.received` → notification, and every change
   pushes `mailbox.updated` to the owner's socket so the open list refreshes. **Refresh** in the
   page header asks for a sync now (`POST /connection/sync`). A refused password marks the
   connection `needs_reconnect` and stops syncing it until the person reconnects.
3. **Read**: opening a thread marks it read on the server too (`\Seen`), and read state comes back
   from the server's `\Seen` flag on each sync. Remote content (images, `srcset`, posters,
   `background`, `url()` in styles) is held back until the reader presses Load Images, or chooses
   Always Show Images for that sender (`mail_image_trust`, the owner's own; Stop Showing Images in the
   thread's menu undoes it). Inline parts the body names by `cid:` (signature logos) are fetched
   through the vault and drawn in place. Quoted history (the first `<blockquote>`, an "On … wrote:" /
   "Le … a écrit :" line, or a trailing run of `>` lines) folds behind Show Quoted Text.
4. **Compose / Reply / Forward**: the composer opens prefilled for Reply (To = sender, `Re:` subject,
   the original quoted) and Forward (`Fwd:`, original quoted, attachments carried). Drafts save as
   the person types; a Draft Saved pill at the end of the formatting bar confirms it.
5. **Send**: `POST /messages` puts the message on `mail_send_queue` (Idempotency-Key required) →
   the `mail-send` job, delayed to the release time, delivers through SMTP (Bcc in the envelope
   only), appends a copy to the server's Sent folder and files it in Sent here. A deferral is
   retried three times; a permanent refusal fails at once and notifies the sender. The `mail-sync`
   scheduler also flushes anything due, so a lost delayed job still goes out. Scheduled mail waits on the queue until its
   release time and can be cancelled until then. Schedule offers tomorrow 08:00, next Monday 08:00,
   or **any date and time** (day-first date, 24 hour time, Lagos); a time already passed is refused.
   A scheduled message waits in Drafts, labelled Scheduled, until it is released.
6. **Layout.** On desktop the message list and the reader scroll on their own and the page does not
   scroll behind them. The divider between them can be dragged, or moved with the arrow keys, to
   widen the list; double click resets it. The width is remembered per browser.

## 4 · Data

The tables come from `1000_core_operations.sql`; `1120_mailbox.sql` adds what M1 needs.

| Table | Key columns | Notes |
|---|---|---|
| `mail_account` | `mail_account_id`, `user_id` (unique), `email`, hosts and ports, `status` (`connected` / `needs_reconnect` / `disconnected`), `last_synced_at`, `last_error_code`, `consecutive_failures`, `integration_secret_id` | One per user. Secret in `integration_secret` (`mail_conn:<id>`) |
| `mail_folder` | `mail_folder_id`, `mail_account_id`, `remote_key`, `name`, `special_use`, `kind` (the six, or null), `uidvalidity`, `last_uid`, `last_sync_at`, `last_error` | Each kind claimed once per account (`folders.js`); folders with no kind are kept but not synced |
| `mail_thread` | `mail_thread_id`, `mail_account_id`, `thread_key` (unique per account), `subject`, `participant_addresses`, `last_message_at`, `unread_count`, `has_attachment`, `message_count` | Keyed by the root of References, else In-Reply-To, else the message's own id (`threading.js`); never by subject |
| `mail_message` | `mail_message_id`, `mail_account_id`, `mail_thread_id`, `mail_folder_id`, `remote_id` (the UID), `internet_message_id` (unique per account), `direction`, `from_address`, `from_name`, `to_addresses` / `cc_addresses`, `subject`, `snippet`, `body_text`, `body_html`, `in_reply_to`, `references_header`, `has_attachment`, `sent_at`, `received_at`, `read_at` | One row per message per mailbox; a move on the server moves the row. HTML sanitised on the way in (`visible.js`) |
| `mail_attachment` | `mail_attachment_id`, `mail_message_id`, `document_id`, `content_id`, `inline` (name, type and size come from the document) | Stored through the vault, doc type `mail_attachment`, owner-only access rule |
| `mail_image_trust` (1125) | `mail_image_trust_id`, `mail_account_id`, `sender_address` (citext), `created_at`; unique per account and sender | Always Show Images: the senders whose web images load without asking. Added and removed, never updated |
| `mail_draft` | `mail_draft_id`, `user_id`, `mail_account_id`, `to_addresses` / `cc_addresses` / `bcc_addresses`, `subject`, `body_html`, `document_ids`, `in_reply_to` | Autosaved; listed in Drafts |
| `mail_send_queue` | `mail_send_queue_id`, `user_id`, `mail_draft_id`, `payload`, `status` (`queued` / `sending` / `sent` / `failed` / `cancelled`), `release_at`, `attempts`, `error_code`, `idempotency_key` (unique), `sent_message_id` | Scheduled send and retry |

## 5 · API

All under `/api/v1/mailbox`. Every list is paged at 25.

| Method and path | Contract | Permission · scope | Paged | Notes |
|---|---|---|---|---|
| `GET /connection` | → `MailConnection` | `mailbox` view · own | | `status` `disconnected` when there is none |
| `POST /connection` | `MailConnect` → `MailConnection` | `mailbox` create · own | | Address and password; autodiscover; signs in to IMAP and SMTP before saving; also reconnects |
| `POST /connection/sync`, `POST /connection/disconnect` | empty → `MailConnection` | view · own | | Disconnect deletes the stored password |
| `GET /threads` | `ThreadListQuery` → `ThreadPage` | view · own | yes | Filters: `folder` (default `inbox`), `unread`. Drafts lists `mail_draft` rows, scheduled ones with `scheduled` |
| `GET /threads/:id` | → `Thread` (messages, attachments, `inline_parts`, `images_trusted`) | view · own | | Spam carries no inline parts and is never trusted |
| `POST /image-trust` | `MailImageTrust` → 204 | view · own | | `trusted: true` adds the sender, `false` removes them; emits `mail_account.images_trusted` |
| `POST /threads/:id/read` | empty → 204 | view · own | | Sets `\Seen` on the server |
| `POST /threads/:id/move` | `ThreadMove` → 204 | view · own | | To inbox, archive, spam or trash, on the server too |
| `POST /folders/:kind/empty` | `FolderParams` → `EmptyResult` | `mailbox` delete · own | | Spam and trash only |
| `GET /drafts/:id`, `PUT /drafts/:id`, `DELETE /drafts/:id` | `MailDraftSave` → `MailDraft`; 204 | create · own | | `PUT` creates the draft on first save |
| `POST /messages` | `MailSend` → `QueuedMail` | create · own | | Send now or at `release_at`; Idempotency-Key required |
| `POST /queue/:id/cancel` | empty → `QueuedMail` | create · own | | Scheduled mail only, until it is released |
| `POST /attachments` | multipart `file` → `DocumentRef` | create · own | | Through `middleware/upload` (purpose `attachment`) |

Attachments are read through `GET /api/v1/documents/:id/content`; the vault rule on
`mail_message` and `mail_account` lets only the mailbox owner open them.

## 6 · Rules and calculations

- A user reaches **only their own mailbox**. No one, People and the CEO included, can open another
  person's mail. Shared mailboxes are not in M1 (see §13).
- From is always the user's own connected address.
- Recipients must be email addresses; an invalid one is marked on its chip as it is typed.
- **Composer tools** (same as praxis-ls): Bold, Italic, Underline, Strikethrough, Heading, Bulleted
  and Numbered lists, Quote, Link (`https://` or `mailto:` only), Clear formatting, attachments.
  Later from the donor if wanted: code, table, rule, image by https address, text colour,
  highlight, mail-safe fonts only.
- **No native dialogs**: links are added in a field under the formatting bar. Discard turns the
  footer into Keep Editing and a red Discard Draft, buttons only; discarding drops the draft and its
  attachments.
- Schedule send times are Lagos time on the 24 hour clock; the date is day-first.
- HTML mail is sanitised; scripts never run; remote content loads only on request or for a trusted
  sender, and the count of what was held back is honest (every fetching attribute and style `url()`).
- Attachments: 25 MB each through the upload engine; types by the mime policy.
- Spam bodies are not rendered.
- Copy: Title Case chrome, no em dashes, day-first dates.
- **The mail host's limits** (Namecheap plan, `docs/runbooks/dns-and-mail.md` §4): IMAP and SMTP
  at `mycityapp.io` (993, 465), strict certificate check on that name. At most **30 IMAP connections
  at once from one IP address**, and production and staging share the server's address: production
  holds at most one IDLE connection per connected mailbox and runs sync with short-lived
  connections under a shared cap (IDLE plus sync never above 24, leaving room for staging; mailboxes beyond that
  are polled);
  staging never IDLEs, it polls with one connection at a time. People's own phones and webmail
  connect from other addresses and do not count. **30 mailboxes** on the plan. **50 recipients an
  hour** to send; whether that is per mailbox or for the whole account is still open (§13), and
  the send queue paces each user to it either way.

## 7 · Events, jobs and notifications

| Event / job | When | Does |
|---|---|---|
| `mail-sync` (scheduler, every `MAILBOX_SYNC_EVERY_MIN` minutes) | On schedule | Syncs every connected mailbox, then flushes due mail from the send queue |
| `mail-sync` (handler) | `mail_account.connected`, `mail_account.sync_requested`, IDLE | Syncs one mailbox |
| `loops/mail-idle` | Continuously in the worker, up to `MAILBOX_IDLE_MAX` mailboxes (0 on staging) | IMAP IDLE on the inbox; new mail enqueues `mail-sync` |
| `mail-send` | `mail_message.queued`, delayed to `release_at` | Delivers through SMTP, paced to `MAILBOX_SEND_PER_HOUR`; files it in Sent; classifies failures (`smtp-errors`) |
| `mail_message.received` | New inbound message | Notification to the owner |
| `mail_account.needs_reconnect` | The server refused the saved password | Notification to the owner; banner in Mailbox |
| `mail_message.sent` / `mail_send.failed` | After delivery or a permanent failure | Updates the queue; notifies on failure |
| `mail_account.connected` / `disconnected`, `mail_thread.moved`, `mail_folder.emptied` | As named | Audit; `mailbox.updated` to the owner's socket |
| `mail_account.images_trusted` | Always Show Images or Stop Showing Images | Audit |

Settings (`.env`, group Mailbox): `MAILBOX_IMAP_HOST`, `MAILBOX_IMAP_PORT`, `MAILBOX_SMTP_HOST`,
`MAILBOX_SMTP_PORT`, `MAILBOX_TLS`, `MAILBOX_SEND_PER_HOUR`, `MAILBOX_SYNC_EVERY_MIN`,
`MAILBOX_IDLE_MAX`.

## 8 · Permissions and visibility by role

| Role | Sees | Can do |
|---|---|---|
| Every employee with `mailbox` view | Their own mailbox only | Connect, read, send, manage their folders |
| People, CEO | Their own mailbox only | Same. No access to other mailboxes |
| Leaver | Nothing | Connection to be disconnected and secret deleted on deactivation (not built: nothing raises a deactivation event yet, §13) |

## 9 · AI and search

- **AI reads**: `// ai:none` in M1. Mail is private correspondence; the donor's mail assist is not
  ported (REUSE_MAP §2.5) and nothing in M1 asks for it.
- **Search** (`mailbox.search.js`, ⌘K): the caller's own conversations by subject, the addresses
  on them and the senders' names. The provider is pinned to the caller's `user_id` (`owner`), so
  the CEO and People, whose grants reach everyone, still find only their own mail. A result opens
  the conversation in Mailbox by its id, whichever folder it is in. Messages are found through
  their conversation (`mail_message` is `search:none`). Words inside a body are not searched.

## 10 · On screen and mobile

What each screen shows open, what sits behind help, and how it is laid out on a phone
(FRONTEND_GUIDE §5, §7). **§3 and §6 are for engineers: nothing in them reaches a screen unless it
is listed here as tier 1 or tier 2.** Tier 3 (how the system works, why it was built this way,
reassurance nobody asked for) is never on a screen; say where it lives instead (this guide, the
manual, the AI assistant). Both tables are read by `scripts/check/guides.js`.

Email bodies, subjects, senders and attachments are content a person received or wrote, not
interface copy; the copy rules apply to the chrome around them.

### 10.1 Content tiers

| Screen | Open (tier 1) | Behind help (tier 2) | Not on screen (tier 3), lives in |
|---|---|---|---|
| Mailbox · Inbox (`inbox`) | "N messages · N unread" (desktop subtitle); Refresh, Compose; Folder, Messages, Unread, Attachments, Mailbox (desktop: the user's address); the message list (unread dot, sender, subject, time); the open message: sender avatar, subject, sender and address, time, Reply, Forward, the body as the sender laid it out in its own sealed frame (`EmailFrame`: nothing in it runs or reaches the app; a `mailto:` link opens our composer; signature logos drawn in place), "Remote images are hidden." with Load Images and Always Show Images when anything was held back, Show Quoted Text and Hide Quoted Text when the message quotes earlier mail, the attachments with their sizes; the thread menu adds Stop Showing Images for a trusted sender | None | Custom domain only, no Google or Microsoft, signing in with an address and a password, sending and receiving only with no link to other modules: §1, §3 step 1 (the page's ⓘ text is removed). What Refresh does: §3 step 2 |
| Mailbox · Sent (`sent`), Drafts (`drafts`), Archive (`archive`), Spam (`spam`), Trash (`trash`) | As Inbox, for that folder. Drafts lists scheduled mail as "Scheduled: subject" with its release time | None | Scheduled mail waiting in Drafts until release: §3 step 5. Spam bodies not rendered: §6 |
| Composer (modal; full screen on mobile) | New Message, Reply or Forward as the title; From (the user's address), To (address chips, each removable; Cc Bcc), Cc, Bcc, Subject; the formatting bar (Bold, Italic, Underline, Strikethrough, Heading, Bulleted List, Numbered List, Quote, Link with its address field and Add Link, Clear Formatting); Attach a File with "Draft saved" (or "Saving…") as quiet text at the end of its row, never in the footer; the body; attachments as chips with their size and Remove, each with its upload bar while it travels and a Remove on one that failed; Schedule Send (Send Date, DD/MM/YYYY; Send Time, HH:MM; Cancel, Schedule Send). Footer: Discard, Schedule (Tomorrow at 08:00, Monday at 08:00, Pick Date and Time), Send; after Discard, Keep Editing and Discard Draft. Errors of at most 4 words where they happen: "Add a recipient" and "Not an email address" on the To row, "Not a real date", "Not a valid time", "Time already passed" | Help term on Send Time: "Lagos time, on the 24 hour clock: 08:30, 17:45." | How drafts save: §3 step 4. Scheduled mail and its release: §3 step 5. Link addresses limited to `https://` and `mailto:`: §6. The discard question ("Discard this draft and its attachments?") and the "That time has already passed" sentence are removed: the Discard Draft button and the field error say it (§6) |
| Mailbox · Connect (sheet) | Connect Mailbox as the title; Email Address, Password; Connect. On a refused password the banner over the list reads "Mail server refused the password" with Reconnect. Errors of at most 4 words on the field: "Not an email address", "Password refused", "Mail server not found" | None | Autodiscover, the test in both directions and where the password is kept: §3 step 1, §4 |
| Settings · Integrations, mailbox connection | Owned by Settings · Integrations: that module's guide | That module's guide | How the connection is tested and where the password is kept: §3 step 1, §4 |
| Notification bell | Owned by the frontend foundation (FRONTEND_GUIDE §9.6): the sender and subject; a tap opens the message | None | Which mail notifies: §7, Settings · Notifications |

### 10.2 Phone layout

| Screen | First on a phone | Left off a phone | Main action | Navigation |
|---|---|---|---|---|
| Mailbox · Inbox (`inbox`) | Refresh and Compose beside the title; four stat cards two to a row (Folder, Messages, Unread, Attachments); the message list, full width | The subtitle; the Mailbox address card; the reader beside the list; the resizable divider | Tap a message: the reader opens full screen with Back, Reply and Forward, and a message laid out wider than the phone is scaled down to its width, never scrolled sideways; Compose opens the composer full screen | Mailbox from the menu drawer (it is not on the bottom bar); the six folder tabs scroll sideways along the top |
| Mailbox · Sent (`sent`), Drafts (`drafts`), Archive (`archive`), Spam (`spam`), Trash (`trash`) | As Inbox | As Inbox | As Inbox | As Inbox |
| Composer (modal; full screen on mobile) | A full screen sheet: From, To, Subject as compact 44 px rows; the formatting bar in two rows of 44 px buttons; the body | Nothing: the same fields as desktop | One footer row: Discard and Schedule as 44 px icon buttons, Send taking the rest of the width | Close at the top of the sheet; Discard asks once in the footer (Keep Editing and Discard Draft share the row) |
| Mailbox · Connect (sheet) | A bottom sheet: Email Address, Password, Connect full width | Nothing | Connect | Opens by itself over Mailbox; Close returns to the menu |
| Settings · Integrations, mailbox connection | Owned by Settings | That module's guide | That module's guide | That module's guide |
| Notification bell | The bell in the top bar; push on the phone | None | A tap opens the message in the full screen reader | The top bar |

## 11 · Edge cases

- **Wrong password / server refuses**: the connection test fails with the classified reason and
  the fix (`smtp-errors.js`): "Password refused" or "Mail server not found" on the field; nothing is
  saved.
- **Password changed on the mail server**: sync fails → connection marked `needs_reconnect` → a
  banner in Mailbox with **Reconnect**, which opens the Connect sheet with the address filled in.
- **First sync of a large mailbox**: read in batches from the last UID; each run takes the next
  batch until the folder is caught up.
- **Hard-bounced recipient**: the send fails with `RECIPIENT_REFUSED` and the sender is notified.
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
- Answered 16/10/2026: Namecheap cPanel, `mycityapp.io` for IMAP (993) and SMTP (465).
- Is the 50 an hour sending limit per mailbox or for the whole hosting account? (asked of the
  domain manager)
- Undo send window, and how long scheduled mail may wait.
- Leavers: which event disconnects a deactivated person's mailbox (needs a deactivation event from
  identity).
- Search inside message bodies: wanted, given the cost of matching every body on each keystroke?

## 14 · Change log

- 13/10/2026 · GE · First version, from the 12 October internal workflow meeting and MILESTONES §6.5.
- 13/10/2026 · GE · Schedule send at any date and time; independent panes with a resizable list (TB review).
- 13/10/2026 · GE · Page header slides away while reading so the panes get the full height (TB review).
- 14/10/2026 · TB · §10 rewritten to the template's content tiers and phone layout tables, from the demo as rebuilt to the screen conventions (FRONTEND_GUIDE §5, §7, §8): the page's ⓘ text (custom domain, no Google or Microsoft, not linked to other modules) left the screen for §1; the composer's labels became aria-labels on its compact rows, the schedule fields use the form helpers with a help term on Send Time, recipient and time errors sit on the field, the Draft Saved pill moved out of the footer and Discard asks with buttons only. §3 and §6 updated to match (Refresh, Draft Saved, discard, Lagos time).
- 15/10/2026 · AJ · Six folders and the composer built in `app/` against the mock API (autosaved drafts, schedule, inline discard, sanitised reader); not wired yet.
- 16/10/2026 · GE · §6 and §13: the mail host's limits from the domain manager (30 IMAP connections per IP, 30 mailboxes, 50 an hour), and how sync and IDLE stay inside them.
- 15/10/2026 · AJ · Screens brought to §10 and the screen conventions: the ⓘ text on the folder title is gone; message rows are marked as content for gate 8; the composer's fields come from the form system.
- 15/10/2026 · AJ · Frontend foundation PR 2 (Shell): Mailbox opens from the rail on desktop and from More on a phone (F17); the list's pane splitter now says its width to assistive technology (the a11y gate crawls the app). No Mailbox behaviour changed.
- 16/10/2026 · TB · Frontend foundation PR 3 (Build kit): the composer's body is now the shared `RichTextField` (TipTap, its own lazy chunk) instead of its own `contentEditable` on the deprecated `execCommand`. Paste from Word and Gmail is parsed into the document rather than carried in as foreign markup, which is why TipTap was chosen (FRONTEND_FOUNDATION §5, PR 3 question 3). The bar carries exactly what §6 and §10 list: Bold, Italic, Underline, Strikethrough, Heading, Bulleted List, Numbered List, Quote, Link (`https://` or `mailto:` only, typed in a field under the bar, never a native dialog) and Clear Formatting, with Undo and Redo at its end and Attach a File beside it. The list beside the reader is `SplitPanes`, shared with Chat.
- 17/10/2026 · GE · Built on the real API: `1120_mailbox.sql`, the `mailbox` module (IMAP and SMTP provider, threading, folders, send queue), `mail-sync`, `mail-send` and `loops/mail-idle` in the worker. §3 to §5, §7, §9 and §11 rewritten as built; the empty stubs the donor list implied (`threads.*`, `send-queue.*`, `access`, `find`, `presend`, `schedule`, `origin`, `mail-notify`, `attachments.service`, `.ai`, `.search`) were deleted: their work lives in `mailbox.service`, `mailbox.repo` and `mailbox.events`. Search is `search:none`.
- 17/10/2026 · GE · Connecting moved into Mailbox: a Connect sheet opens over it when there is no connection, and the refused-password banner carries Reconnect, which opens the same sheet. Settings · Integrations only shows the connection.
- 17/10/2026 · GE · ⌘K finds the owner's own mail (§9): `mailbox.search.js` with the provider's new `owner` pin, and a result opens its conversation by id in any folder. Connect now uses the address's own domain as the mail host (`mycityapp.io`, the name on the host's certificate; `mail.mycityapp.io` fails the check, runbook dns-and-mail §4).
- 17/10/2026 · TB · Header gains the Capabilities row every guide now carries (README §5.2): none, each mailbox is its owner's.
- 18/10/2026 · GE · §10, the composer, from a phone test: attachments were refused because the composer sent the purpose `mail`, which the upload contract does not know (it is `attachment`). "Draft saved" back out of the footer to quiet text beside Attach a File; on the phone the footer is one row, Discard and Schedule as icons with Send taking the rest; a failed file can be removed, and a finished one shows once, as its chip.
- 18/10/2026 · GE · §10, the reader, from a phone test and TB's review of how mail is formatted: HTML mail now renders in `EmailFrame`, a sealed frame with its own policy (no scripts, frames or forms; web images only after Load Images), as tall as its content and scaled down when wider than the column, so a 600 px cPanel notice fits a phone. The Drafts preview uses it too. In the dark theme, mail designed for a white page is recoloured by partial inversion, as Outlook does: light backgrounds onto our card, dark text onto our foreground, hue kept; colours already right for a dark page, accent borders and images untouched, and a message with its own dark design left alone. In the light theme mail is drawn as sent.
- 18/10/2026 · GE · Everything the reader still lacked against the reference client: remote content held back by every route it can fetch (images, `srcset`, posters, `background`, style `url()`), with the count behind Load Images honest; Always Show Images per sender (`mail_image_trust`, migration 1125, `POST /image-trust`, Stop Showing Images in the thread menu); inline `cid:` parts (signature logos) drawn from the vault; quoted history folded behind Show Quoted Text in English and French. §3, §4, §5, §6, §7 and §10 updated.
