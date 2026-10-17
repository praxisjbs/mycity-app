# Mailbox · Engineering Guide

| | |
|---|---|
| Owner | GE |
| Milestone | M1 |
| Backend modules | `mailbox` |
| Frontend paths | `app/src/features/mailbox/` |
| Permission key(s) | `mailbox` |
| Screens (PROGRESS.md rows) | #18 Inbox, #19 Sent, #20 Drafts, #21 Archive, #22 Spam, #23 Trash; connection under Settings · Integrations |
| Status | Agreed |
| Last changed | 15/10/2026 |

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
   `autodiscover` finds the IMAP and SMTP hosts from the domain → `POST /connections` tests both →
   the password is stored encrypted in `integration_secret` under `mail_conn:<id>`, never on the
   connection row.
2. **Sync**: the worker's `mail-sync` scheduler and the `mail-idle` loop (IMAP IDLE) pull new mail
   into the six folders. New mail raises `mailbox.message.received` → notification. **Refresh** in
   the page header asks for a sync now (`POST /connection/sync`).
3. **Read**: opening a thread marks it read on the server too. Remote images are not loaded until the
   reader asks.
4. **Compose / Reply / Forward**: the composer opens prefilled for Reply (To = sender, `Re:` subject,
   the original quoted) and Forward (`Fwd:`, original quoted, attachments carried). Drafts save as
   the person types; a Draft Saved pill at the end of the formatting bar confirms it.
5. **Send**: `POST /messages` puts the message on the send queue (`send-queue`) → `email-send`
   delivers through SMTP → the message lands in Sent. Scheduled mail waits on the queue until its
   release time and can be cancelled until then. Schedule offers tomorrow 08:00, next Monday 08:00,
   or **any date and time** (day-first date, 24 hour time, Lagos); a time already passed is refused.
   A scheduled message waits in Drafts, labelled Scheduled, until it is released.
6. **Layout.** On desktop the message list and the reader scroll on their own and the page does not
   scroll behind them. The divider between them can be dragged, or moved with the arrow keys, to
   widen the list; double click resets it. The width is remembered per browser.

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
- **No native dialogs**: links are added in a field under the formatting bar. Discard turns the
  footer into Keep Editing and a red Discard Draft, buttons only; discarding drops the draft and its
  attachments.
- Schedule send times are Lagos time on the 24 hour clock; the date is day-first.
- HTML mail is sanitised; scripts never run; remote images load only on request.
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
| Mailbox · Inbox (`inbox`) | "N messages · N unread" (desktop subtitle); Refresh, Compose; Folder, Messages, Unread, Attachments, Mailbox (desktop: the user's address); the message list (unread dot, sender, subject, time); the open message: sender avatar, subject, sender and address, time, Reply, Forward, the body, the attachments with their sizes | None | Custom domain only, no Google or Microsoft, signing in with an address and a password, sending and receiving only with no link to other modules: §1, §3 step 1 (the page's ⓘ text is removed). What Refresh does: §3 step 2 |
| Mailbox · Sent (`sent`), Drafts (`drafts`), Archive (`archive`), Spam (`spam`), Trash (`trash`) | As Inbox, for that folder. Drafts lists scheduled mail as "Scheduled: subject" with its release time | None | Scheduled mail waiting in Drafts until release: §3 step 5. Spam bodies not rendered: §6 |
| Composer (modal; full screen on mobile) | New Message, Reply or Forward as the title; From (the user's address), To (address chips, each removable; Cc Bcc), Cc, Bcc, Subject; the formatting bar (Bold, Italic, Underline, Strikethrough, Heading, Bulleted List, Numbered List, Quote, Link with its address field and Add Link, Clear Formatting, Attach a File) and a Draft Saved pill at its end; the body; attachments with their upload bar; Schedule Send (Send Date, DD/MM/YYYY; Send Time, HH:MM; Cancel, Schedule Send). Footer: Discard, Schedule (Tomorrow at 08:00, Monday at 08:00, Pick Date and Time), Send; after Discard, Keep Editing and Discard Draft. Errors of at most 4 words where they happen: "Add a recipient" and "Not an email address" on the To row, "Not a real date", "Not a valid time", "Time already passed" | Help term on Send Time: "Lagos time, on the 24 hour clock: 08:30, 17:45." | How drafts save: §3 step 4. Scheduled mail and its release: §3 step 5. Link addresses limited to `https://` and `mailto:`: §6. The discard question ("Discard this draft and its attachments?") and the "That time has already passed" sentence are removed: the Discard Draft button and the field error say it (§6) |
| Mailbox · Connect (sheet) | Connect Mailbox as the title; Email Address, Password; Connect. On a refused password the banner over the list reads "Mail server refused the password" with Reconnect. Errors of at most 4 words on the field: "Not an email address", "Password refused", "Mail server not found" | None | Autodiscover, the test in both directions and where the password is kept: §3 step 1, §4 |
| Settings · Integrations, mailbox connection | Owned by Settings · Integrations: that module's guide | That module's guide | How the connection is tested and where the password is kept: §3 step 1, §4 |
| Notification bell | Owned by the frontend foundation (FRONTEND_GUIDE §9.6): the sender and subject; a tap opens the message | None | Which mail notifies: §7, Settings · Notifications |

### 10.2 Phone layout

| Screen | First on a phone | Left off a phone | Main action | Navigation |
|---|---|---|---|---|
| Mailbox · Inbox (`inbox`) | Refresh and Compose beside the title; four stat cards two to a row (Folder, Messages, Unread, Attachments); the message list, full width | The subtitle; the Mailbox address card; the reader beside the list; the resizable divider | Tap a message: the reader opens full screen with Back, Reply and Forward; Compose opens the composer full screen | Mailbox from the menu drawer (it is not on the bottom bar); the six folder tabs scroll sideways along the top |
| Mailbox · Sent (`sent`), Drafts (`drafts`), Archive (`archive`), Spam (`spam`), Trash (`trash`) | As Inbox | As Inbox | As Inbox | As Inbox |
| Composer (modal; full screen on mobile) | A full screen sheet: From, To, Subject as compact 44 px rows; the formatting bar in two rows of 44 px buttons; the body | Nothing: the same fields as desktop | Send, full width at the bottom, with Discard and Schedule above it | Close at the top of the sheet; Discard asks once in the footer |
| Mailbox · Connect (sheet) | A bottom sheet: Email Address, Password, Connect full width | Nothing | Connect | Opens by itself over Mailbox; Close returns to the menu |
| Settings · Integrations, mailbox connection | Owned by Settings | That module's guide | That module's guide | That module's guide |
| Notification bell | The bell in the top bar; push on the phone | None | A tap opens the message in the full screen reader | The top bar |

## 11 · Edge cases

- **Wrong password / server refuses**: the connection test fails with the classified reason and
  the fix (`smtp-error.map.js`); nothing is saved.
- **Password changed on the mail server**: sync fails → connection marked `needs_reconnect` → a
  banner in Mailbox with **Reconnect**, which opens the Connect sheet with the address filled in.
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
- Answered 16/10/2026: Namecheap cPanel, `mycityapp.io` for IMAP (993) and SMTP (465).
- Is the 50 an hour sending limit per mailbox or for the whole hosting account? (asked of the
  domain manager)
- Undo send window, and how long scheduled mail may wait.

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
- 17/10/2026 · GE · Connecting moved into Mailbox: a Connect sheet opens over it when there is no connection, and the refused-password banner carries Reconnect, which opens the same sheet. Settings · Integrations only shows the connection.
