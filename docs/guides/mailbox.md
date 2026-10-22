# Mailbox · Engineering Guide

| | |
|---|---|
| Owner | GE |
| Milestone | M1; Write With AI and Summarise Thread are M10's mail AI, brought forward by TB on 22/10/2026 (§1.1) |
| Backend modules | `mailbox` |
| Frontend paths | `app/src/features/mailbox/` |
| Permission key(s) | `mailbox` |
| Capabilities | `mailbox.signature` (Configure Signature): the company links and what shows on everyone's signature (§8) |
| Screens (PROGRESS.md rows) | #18 Inbox, #19 Sent, #20 Drafts, #21 Archive, #22 Spam, #23 Trash, #94 Signature; the staff mail server's settings under Settings · Integrations (#77, `docs/guides/integrations.md`); the brand files under Settings · Organisation (#69, `docs/guides/foundation.md`) |
| Status | Built |
| Last changed | 22/10/2026 |

Sources: MILESTONES §6.5 and D6; REUSE_MAP §2.5; the internal workflow meeting of 12 October 2026.
The demo (`demo.html`, Mailbox) was updated the same day with the composer described here. Email
signatures: TB's brief and answers of 19/10/2026 (design B, Street Sign, chosen from three on the
design canvas; the eight answers are in §6). Write With AI and Summarise Thread: TB's brief and
answers of 22/10/2026 (§1.1).

---

## 1 · What it is for

Each member of staff reads and sends their **own MyCity mail** (`name@mycityapp.io`) inside the
app, without opening another mail client. It is a straightforward mail client: **receive and send,
manage your mail. It is not linked to operations, partnerships or any other module** in M1 (TB,
12 October). Linking a thread to a partner record is M7 (`mailbox/binding/`). The one bridge is a
mail's attachment sent on to a Staff Community chat with Forward to Chat (TB, 19/10/2026;
`docs/guides/community.md` §3 step 19): the file is copied into Community, the mail stays here.

Custom domain only: no Google, no Microsoft, no OAuth. A user connects with their address and
password, as with any mail app.

**One signature for everyone.** Every message a person sends from the composer carries the company
signature, built from records and never designed by hand: their name, job title and department
from their employee record, their numbers, their mailbox address, and the company's name, address,
website and logo from Settings · Organisation. There is one design (Street Sign: the person on white
over a Deep Green band carrying the logo, under the yellow rule of MyCity's own system mail). A
person sees their signature on the Signature tab and changes only their numbers there; the
company's links and what shows are set once, with Configure, by the holders of
`mailbox.signature`.

**AI on the person's own press** (§1.1). In the composer, **Write With AI** drafts a reply, a
forward's note or a new message from the conversation, a line of what to say (typed or dictated)
and an optional note, or tidies what the person wrote; the draft is ready to send, with no
placeholder and nothing invented, and reaches the composer only when the person presses Use Draft.
In the reader, **Summarise Thread** puts the conversation's gist, its key points and what is asked
of the reader in a card above it. The AI writes nothing on its own: a draft is sent only when the
person presses Send, and Praxis AI still reads no mail (§9).

### 1.1 Decisions (TB, 22/10/2026, binding)

REUSE_MAP §2.5 left the donor's `mail/assist/` (semantic search and OCR over mail) until M10, and
§9 had no AI on mail. These answers bring M10's mail AI forward, as AI Control was on 20/10/2026;
nothing of `mail/assist/` is ported (§12).

1. **Write With AI in the composer, Summarise Thread in the reader.** Write With AI starts from
   nothing but the conversation, from a line of what the mail should say, or tidies what the
   person wrote (Tidy Up). Voice for people who would rather not type (Dictate), and a note for
   context behind a checkbox (Add a Note).
2. **The Default job, Gemini Flash first** (`ai-control.md` §6.2): drafting, tidying and the
   summary are everyday drafting and summarising; the Fast job (Flash-Lite) is not for a draft a
   person reads. Mail carries personal data, so DeepSeek is never asked. Dictation is the
   Transcription job (Groq's Whisper, then Gemini).
3. **The AI step opens inside the composer's own window**, since modals never stack, with Back to
   the composer. The draft shows there first: **Use Draft** puts it in the composer in one press,
   **Try Again** writes another; nothing in the composer changes until Use Draft.
4. **Ready to send, or it asks.** When the mail needs a fact only the person knows (a date, a
   price, a yes or no), the step shows up to three short questions before drafting, answered by
   typing or Dictate; **Write Anyway** drafts without them, around what it does not know. Every
   answer is checked on the server and sent back once if a placeholder slipped in.
5. **A closing line only.** The draft ends "Kind regards," (or the conversation's own closing);
   the signature that follows at send (§3 steps 8, 9) carries the name, title and numbers.
6. **The summary is a card on top of the conversation**: the gist, Key Points and Asked of You
   (with dates and amounts), Copy Summary and Close.
7. **Kept until new mail.** A summary is kept with the conversation, only its owner sees it, and
   reopening shows it at once at no cost; a new message makes the next press summarise afresh.
8. **This conversation only.** The model reads the conversation's messages (quoted copies
   stripped), who is on it, the person's name, title and department, the company's details,
   today's date in Lagos and the attachments' names, never their contents and never other mail.
9. **No tone choices.** The draft matches the conversation's formality, in British English or the
   sender's language; the person steers it in What To Say ("keep it firm", "shorter").

Refinements made while building, within those answers (TB to overrule): contact details and
identifying numbers are swapped for tokens before anything leaves and put back in the draft (§6);
Spam is never drafted from or summarised; a conversation is read to its last 30 messages; a
dictation's recording is removed once it is transcribed.

## 2 · Screens affected

| Screen / tab (slug) | Where | Who sees it | What it shows | What a person can do there |
|---|---|---|---|---|
| Mailbox · Inbox (`inbox`) | Staff app | The mailbox owner only | Threads, newest first; the open message; the Summary card once asked for | Read, reply, reply all, forward, archive, move to spam or trash, download attachments; Summarise Thread |
| Mailbox · Sent (`sent`), Drafts (`drafts`), Archive (`archive`), Spam (`spam`), Trash (`trash`) | Staff app | Owner | The canonical six folders | As above (Spam: no Summarise Thread); continue a draft; empty spam and trash |
| Mailbox · Connect (sheet) | Staff app | Owner | Opens over Mailbox when the user has no connection, or when the server refused the saved password | Connect with address and password; reconnect |
| Composer (modal; full screen on mobile) | Staff app | Owner | From, To, Cc, Bcc, Subject, rich text body, attachments; the signature that will be added, behind Show Signature | Write, format, attach, send now or schedule, discard; preview the signature; Write With AI |
| Composer · Write With AI (a step inside the composer) | Staff app | Owner | What To Say, Add a Note and the Note, each with Dictate; Write or Tidy Up when the composer holds the person's words; the AI's questions, or its draft | Write Draft, Tidy Email, answer the questions or Write Anyway, Try Again, Use Draft, Back |
| Mailbox · Signature (`signature`) | Staff app | Every employee with `mailbox` view, their own | Their signature as it sends (New Mail, or Reply for the slim line), the details it is built from, their numbers | Edit Numbers (mobile, office line); show or hide the mobile and its WhatsApp link; Copy Signature |
| Configure Signature (wizard over the Signature tab) | Staff app | `mailbox.signature` holders | The company's app and social links, and what shows on everyone's signature | Set the App Store and Google Play links, six social links, the confidentiality note; switch WhatsApp links, app links, social links and the legal line on or off |
| Settings · Integrations, Staff Mail Server | Staff app | IT (`integrations` view) | The IMAP and SMTP hosts and ports every mailbox uses, the hourly limit per person, the sync interval and the live connections; no person's mailbox (TB, 20/10/2026: connecting stays in Mailbox) | IT changes them; a change re-points every mailbox (§3 step 11) |
| Notification bell | Staff app | Owner | New mail (per Settings · Notifications) | Open the thread |

## 3 · How the screens relate

1. **Connect** (the Connect sheet, which opens over Mailbox the first time it is opened with no
   connection; GE, 17/10/2026): address and password →
   `autodiscover` uses the address's own domain as the IMAP and SMTP host (`mycityapp.io`, the name
   on the host's certificate; the staff mail server's hosts on Settings · Integrations override it,
   else the `MAILBOX_*` fallback in the server file) → `POST /connection` signs in to both before anything is saved → the password is stored
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
   A scheduled message waits in Drafts, labelled Scheduled, until it is released. A draft has at
   most one waiting send (migration `1128`): scheduling it again replaces the one it had, editing it
   keeps that send in step with what is saved, and discarding it cancels the send. Continue Editing
   on a scheduled message opens Edit Scheduled Mail, whose footer shows the time it goes (a menu to
   change it, or Send Now) and **Done**, which keeps that time with what is on screen (GE, 20/10/2026).
6. **Layout.** On desktop the message list and the reader scroll on their own and the page does not
   scroll behind them. The divider between them can be dragged, or moved with the arrow keys, to
   widen the list; double click resets it. The width is remembered per browser.
7. **Signature, what it is made of** (`signature/`). `signature.resolve.js` (pure) builds one model
   from the records: the name (preferred name, else first name, then last name), job title and
   department from the employee; the mobile from `employee.phone` unless the person hid it, with a
   `wa.me` link when both the person and the company allow WhatsApp; the office line and the two
   switches from `mail_signature`; the address they send from (the connected mailbox, else the work
   email); the company's name (trading, else legal), address, website and RC number from Settings ·
   Organisation (`shared/organisation/profile.js`); the links and switches from
   `mail_signature_config`. A value that is not there leaves its line out, never an empty line or a
   stray separator. `signature.html.js` (pure) draws the model two ways, as email-safe HTML (tables,
   inline styles, a web-safe stack, no web fonts) and as plain text: the **full signature** (the
   person, then the Deep Green band with the logo at the left and the social icons at the right,
   the yellow rule under it, the app icons, the company line and the legal line) and the **slim
   line** (two lines beside a yellow rule: name and title; company and mobile).
8. **Which one a message gets.** The server decides, in one place (`signatureFor` in
   `signature.service.js`): a reply (`in_reply_to` set) gets the slim line; so does a message whose
   every recipient (To, Cc and Bcc) is at the sender's own mail domain; anything else, a new message
   or a forward, gets the full signature. The composer's preview asks the same function.
9. **Where it goes and when.** `send()` bakes the signature into the queued payload, so what the
   person approved is what leaves: a later change to a record never rewrites queued or sent mail, and
   scheduled mail carries the signature as it was when it was scheduled. `deliver()` places it after
   the person's words and above any quoted mail (before the composer's "On … wrote:" line when it
   sits directly over the quote; of several, the last one outside every quote, since a reply to a
   reply carries older ones inside its own), otherwise at the end, and at the end too when the
   person wrote below the quote; in both the HTML and the text part (after a blank line: no `-- `
   separator line, which the dash rule keeps out of anything a person reads). The bake runs in
   its own transaction before the send's: a signature that cannot be built is logged and the
   message queues without it. Its pictures (the logo or the drawn pin, the social and app icons) travel inside the
   message as inline parts (`cid:`), so a first-time reader sees them without loading anything from
   the web; each picture is stored once in the vault (`mail_signature_image`, keyed by its hash) and
   the Sent copy names it as an inline part, so this mailbox's own reader draws it too.
10. **Brand files** (Settings · Organisation, `docs/guides/foundation.md`). The white logo, when
   uploaded, replaces the drawn pin and the company name on the band; until then the band carries
   the app's own pin and the company's name. Replacing a file changes the next signature at once.
11. **The staff mail server moves** (Settings · Integrations, `docs/guides/integrations.md` §3 step
   8): on `integration.saved` or `integration.removed` for `mailbox_server`, this module's outbox
   handler re-points every connected mailbox at the new hosts (the same autodiscover as Connect,
   `mail_account.server_moved`, audited) and queues a sync for each, which is its retest: a refused
   password marks it `needs_reconnect` as in step 2. The IDLE loop re-reads the settings every 30
   seconds and reopens its connections on the new hosts; the sync interval and the live connections
   apply at the next tick.
12. **Write With AI** (§1.1; Write With AI in the composer's attach row). The composer's window
   turns to the AI step (Back returns to the composer, and what was typed in the step is kept
   while the composer is open). **Write** takes What To Say, optional on a reply or a forward and
   needed on a new message, and behind **Add a Note** a Note; **Tidy Up**, offered when the
   composer holds the person's own words, takes those words. **Write Draft** (or **Tidy Email**)
   sends `POST /assist`. The service reads, for a reply, the conversation the reply answers
   (`in_reply_to`, the owner's own, never Spam), and for a forward the quoted mail under the
   person's words; the person and the company from the signature's model (step 7); and asks the
   `mail-draft` or `mail-tidy` action (§9) with what §6 lists. The answer is one of two:
   - **questions** (decision 4): up to three, each shown with its own answer field and Dictate.
     Write Draft asks again with the answers; **Write Anyway** asks for a draft with no
     questions allowed (`write_anyway`).
   - **a draft**: drawn in its own frame, with the suggested subject when the composer's subject
     is empty. **Try Again** asks again with the same inputs. **Use Draft** puts it in the
     composer in place of the person's own words, above any quoted mail, and sets the subject only
     when it was empty; the composer's Undo brings back what was there. The draft then saves and
     sends as if typed: the AI saves nothing and sends nothing.
13. **Dictate** (`VoiceField`, beside What To Say, the Note and each answer): records up to two
   minutes in the browser, uploads the recording (`POST /dictation`, purpose `voice_note`, doc type
   `mail_dictation`), then `POST /dictation/:id/transcript` transcribes it through `mail-dictation`
   (Transcription: Groq's Whisper, then Gemini) and removes it from the vault whatever the outcome;
   the words are added to the field. The doc type is `transient`: the vault makes no playable copy
   of it, and one left behind by a closed tab is removed by the hourly `export-cleanup` sweep once
   it is an hour old (§7).
14. **Summarise Thread** (`POST /threads/:id/summary`; not in Spam). The kept summary
   (`mail_thread_summary`) answers at once while the conversation's newest message is the one it
   covered; otherwise the service asks `mail-summary` and keeps the answer in place of the old one
   (`mail_thread.summarised`, audited, no mail text in the event). The card shows above the
   messages until Close; Copy Summary copies its text; pressing again while it shows asks again
   if new mail has arrived since.

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
| `mail_send_queue` | `mail_send_queue_id`, `user_id`, `mail_draft_id`, `payload`, `status` (`queued` / `sending` / `sent` / `failed` / `cancelled`), `release_at`, `attempts`, `error_code`, `idempotency_key` (unique), `sent_message_id` | Scheduled send and retry; one `queued` row per draft at most (`1128`). `payload.signature` holds the baked signature: its HTML, its text and its inline parts (`content_id`, `document_id`) |
| `mail_signature` (1127) | `mail_signature_id`, `user_id` (unique), `office_line`, `show_mobile`, `show_whatsapp` | A person's own choices; no row reads as both switches on and no office line. The mobile is `employee.phone`, never copied here |
| `mail_signature_config` (1127) | `mail_signature_config_id`, one row at most; `app_store_url`, `google_play_url`, `instagram_url`, `tiktok_url`, `linkedin_url`, `x_url`, `facebook_url`, `youtube_url`, `confidentiality_note`, `show_whatsapp`, `show_app_links`, `show_social_links`, `show_legal`, `updated_by` | The company's links and switches (Configure). No row reads as no links and every switch on. Not seeded: the links are MyCity's to enter |
| `mail_thread_summary` (10300, M10's block: mail AI brought forward) | `mail_thread_summary_id`, `mail_thread_id` (unique, cascades with its conversation), `gist`, `key_points` and `asked_of_you` (`text[]`, at most 5 each), `message_count`, `last_message_id` (the newest message it covered; set null if that message goes), `ai_run_id`, `summarised_at` | Summarise Thread's answer, kept until the conversation's newest message changes (decision 7). One row per conversation, replaced in place. Read only through the owner's own conversation |

Signature pictures are documents of type `mail_signature_image` (module `mailbox`), one per distinct
picture, found again by their hash (`entity_type` `mail_signature_image`, `entity_id` the SHA-256 of
the bytes); any signed-in person may read one, since every recipient receives it. A sent message's
pictures are `mail_attachment` rows with `inline` and a `content_id`, like an inbound logo.

A dictation's recording is a document of type `mail_dictation` (module `mailbox`, personal,
`transient`), held against the owner's `mail_account` only while it is transcribed (§3 step 13).
A draft from Write With AI is not kept anywhere but the composer's own draft once Use Draft is
pressed; its run is on `ai_run` like every AI call.

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
| `GET /signature` | → `MySignature` | view · own | | The caller's details, numbers and switches, both signatures drawn (`full_html`, `slim_html`, pictures inline as `data:`), and `whatsapp_allowed` (the company's switch) |
| `PATCH /signature` | `MySignatureSave` → `MySignature` | edit · own | | Only the fields sent: `office_line`, `show_mobile`, `show_whatsapp`, and `mobile`, which is written to the employee record through `organisation.service` (the path ESS Edit Profile takes) in the same transaction; an empty mobile leaves the record's as it is (Show Mobile hides it) |
| `POST /signature/preview` | `SignaturePreviewRequest` → `SignaturePreview` | view · own | | The composer's preview: the recipients and `in_reply_to` in, the `variant` (`full` or `slim`) and its HTML out, chosen by `signatureFor` |
| `GET /signature/config`, `PUT /signature/config` | → `SignatureConfig`; `SignatureConfigSave` → `SignatureConfig` | view · `mailbox.signature` | | Configure. A link is an `https://` address or empty |
| `POST /assist` | `MailAssistRequest` → `MailAssist` | create · own | | Write With AI and Tidy Up (§3 step 12, §6): `mode` (`write`, `tidy`), `in_reply_to`, the recipients, subject, the person's own words (`body_html`) and the quoted mail under them (`quoted_html`), `instruction`, `note`, `answers`, `write_anyway` in; `available`, `kind` (`draft`, `questions`), `subject`, `body_html`, `questions`, `ai_run_id` out. 422 `NOTHING_TO_WRITE` on `instruction` for a new message with nothing to go on, on `body_html` for Tidy Up with no words; 422 `SPAM_NOT_READ` for a reply in Spam |
| `POST /dictation` | multipart `file` → `DocumentRef` | create · own | | The recording (purpose `voice_note`, at most 10 MB), held only until it is transcribed |
| `POST /dictation/:id/transcript` | empty → `MailDictation` | create · own | | Transcribes the caller's own recording, then removes it; `text`, and `draft` when only the stub answered (no provider set up) |
| `POST /threads/:id/summary` | empty → `ThreadSummary` | view · own | | The kept summary, or a fresh one (§3 step 14): `available`, `gist`, `key_points`, `asked_of_you`, `message_count`, `summarised_at`, `ai_run_id`. 422 `SPAM_NOT_READ` in Spam |

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
- Spam bodies are not rendered, and a spam mail's attachments are never forwarded to a chat.
- Copy: Title Case chrome, no em dashes, day-first dates.
- **Signatures** (TB, 19/10/2026):
  - One design for everyone, Street Sign (§1). Nobody designs or edits a signature; Settings has no
    signature section. The Configure wizard sets links and switches only.
  - The full signature goes on new messages and forwards. Replies, and mail whose every recipient is
    at the sender's own domain, carry the slim line. Nothing is added to a draft while it is written;
    the composer only previews it, behind Show Signature, hidden each time it opens.
  - Numbers: the mobile is the one on the employee record, shown unless the person hides it, and
    changing it on the Signature tab changes the record (one number, not two). The office line is
    the signature's own and optional. WhatsApp is a link built from the mobile, shown when the
    company allows it and the person has not switched it off.
  - Additions (Configure): App Store and Google Play icons, social icons with no names (Instagram,
    TikTok, LinkedIn, X, Facebook, YouTube; an empty link shows nothing), the legal line (the RC
    number from Settings · Organisation and the confidentiality note). Each group has a switch.
  - Job titles print exactly as the employee record holds them; the staff sheet's spellings were
    corrected in the roster on 19/10/2026 (PR 71, `docs/runbooks/staff-roster.md`).
  - Every picture is an image with its own ground, never a dark glyph on the page, so dark mode
    (which recolours text and backgrounds, never images) cannot hide it; the social icons sit on the
    band and the app icons on Deep Green tiles. Secondary text is `#32413D`, which keeps 10.7:1 on
    white and still 4.6:1 after a dark-mode inversion (MyCity's own paper greys fall to 2.8:1).
  - At most 400 px wide, so a phone shows it at full size instead of shrinking it.
- **Write With AI, Tidy Up and Summarise Thread** (§1.1, TB, 22/10/2026):
  - **What the model is given** (decision 8). The conversation's messages oldest first, at most
    its last 30: who sent each to whom and when, whether it was the person's own, the attachments'
    names, and its own words with the quoted history cut away (an "On … wrote:" or "Le … a écrit :"
    line, an Outlook header block of From, Sent and To, "Original Message", a trailing run of `>`
    lines), at most 6,000 characters each, 12,000 for the newest, 60,000 in all. The person, from
    the signature's model (§3 step 7, so a mobile hidden there stays hidden): name, job title,
    department, mailbox address, the numbers their signature shows, the company's name, website and
    address. Today's date and time in Lagos. The composer: its recipients (with the names this
    conversation gives them), its subject, the person's own words for Tidy Up, and for a forward
    the quoted mail under them. What To Say, the Note and the answers, as facts from the person.
    Nothing from other mail, another module or an attachment's contents.
  - **Contact details never leave.** Every email address, phone number, account, card or IBAN
    number, BVN, NIN, passport and tax number, and any long run of digits, is swapped for a token
    (`KEPT001`) before the call (`services/ai/redact.js` `shield()`, the patterns the external
    redaction masks); the prompt keeps tokens as they are, and the answer has the real values put
    back, so a draft can say "call me on 0803 …" without the model ever seeing the number.
  - **Ready to send** (decision 4). Before anyone sees it, every answer is checked
    (`mailbox.assist.js` `placeholdersIn`): a gap left to fill (`[Your Name]`, `{name}`, `<date>`,
    "Insert …", XXX), a redaction mark (`[EMAIL]`, `[PHONE]`) or a token that stands for nothing goes back
    to the model once with the problem named (llm.service's corrective retry), and a second miss
    fails the press with `AI_BAD_OUTPUT`. The prompt forbids inventing a date, time, amount, name,
    promise or attachment that is not in what it was given.
  - **Questions** only when a fact only the person knows is essential: at most three, each one short
    line. Write Anyway (`write_anyway`) forbids them; the draft then writes around what it does not
    know ("I will confirm the time by Friday") and never fills it in.
  - **The closing** (decision 5): a closing line and nothing after it; the signature follows at
    send. **Language and tone** (decision 9): the conversation's language and formality, British
    English otherwise; dates day first ("Monday, 26 October 2026"), amounts as the mail writes them,
    no em dashes. A new message gets a suggested subject of at most 8 words.
  - **Form.** The model answers Markdown (paragraphs, lists, bold), made into the composer's HTML
    by the one renderer (`shared/documents/markdown.js`); the send's own sanitiser still runs.
  - **Tidy Up** keeps every fact, figure, name, date and commitment in the person's words and what
    they meant; it fixes spelling, grammar, order and tone, using the conversation to get names and
    references right.
  - **The summary**: the gist in one or two sentences, up to 5 Key Points and up to 5 things Asked of
    You (who asked, by when), nothing invented; an empty section is left out. Kept per
    conversation until its newest message changes (decision 7).
  - **Spam** is never drafted from or summarised (`SPAM_NOT_READ`); its bodies are not shown either.
  - **Limits**: What To Say 2,000 characters, the Note 4,000, an answer 1,000; a dictation two
    minutes and 10 MB.
  - **AI off** (switched off, the month's cap reached, every model passed by, or no provider set up
    so only the stub would answer): Write With AI answers `available: false` and the step says
    "Write With AI is off"; Summarise Thread says "AI summaries are off". The composer and the mail
    are untouched.
  - Each press is one AI run under its action, on AI Control · Spend (`ai-control.md` §6.5).
- **The mail host's limits** (Namecheap plan, `docs/runbooks/dns-and-mail.md` §4): IMAP and SMTP
  at `mycityapp.io` (993, 465), strict certificate check on that name. At most **30 IMAP connections
  at once from one IP address**, and production and staging share the server's address: production
  holds at most one IDLE connection per connected mailbox, up to 24 (Live Connections on Settings ·
  Integrations, else `MAILBOX_IDLE_MAX`, 24 on production when unset), and syncs with one short-lived connection at a time; mailboxes beyond that
  are polled. Staging holds up to 4 (its default) and syncs with one connection at a time, so the
  two stay inside 30 (TB, 19/10/2026: new mail is noticed the moment it lands on both). People's own phones and webmail
  connect from other addresses and do not count. **30 mailboxes** on the plan. **50 recipients an
  hour** to send; whether that is per mailbox or for the whole account is still open (§13), and
  the send queue paces each user to it either way.

## 7 · Events, jobs and notifications

| Event / job | When | Does |
|---|---|---|
| `mail-sync` (scheduler, ticks every minute) | Once Sync Every minutes have passed since the last full pass (Settings · Integrations, else `MAILBOX_SYNC_EVERY_MIN`) | Syncs every connected mailbox, then flushes due mail from the send queue |
| `mail-sync` (handler) | `mail_account.connected`, `mail_account.sync_requested`, IDLE | Syncs one mailbox |
| `loops/mail-idle` | Continuously in the worker, up to Live Connections mailboxes (Settings · Integrations, else `MAILBOX_IDLE_MAX`; unset: 24 on production, 4 on staging, 0 on laptops), re-read every 30 seconds | IMAP IDLE on the inbox; new mail enqueues `mail-sync`; a change of host, port or limit closes the connections and opens them again within it |
| `mail-send` | `mail_message.queued`, delayed to `release_at` | Delivers through SMTP, paced to the Hourly Limit per Person (Settings · Integrations, else `MAILBOX_SEND_PER_HOUR`); files it in Sent; classifies failures (`services/mail/smtp-errors.js`, shared with the integration tests) |
| `mail_message.received` | New inbound message | Notification to the owner: the sender as the title, the subject and the message's first line as the text (`payload.preview`); on a phone a conversation's mail shares one notification (`docs/guides/notifications.md` §6). Reading the conversation marks its notices read |
| `mail_account.needs_reconnect` | The server refused the saved password | Notification to the owner; banner in Mailbox |
| `mail_account.server_moved` | The staff mail server's hosts changed on Settings · Integrations (§3 step 11) | Audit; the mailbox is re-pointed and a sync queued |
| `mail_message.sent` / `mail_send.failed` | After delivery or a permanent failure | Updates the queue; notifies on failure |
| `mail_account.connected` / `disconnected`, `mail_thread.moved`, `mail_folder.emptied` | As named | Audit; `mailbox.updated` to the owner's socket |
| `mail_account.images_trusted` | Always Show Images or Stop Showing Images | Audit |
| `mail_signature.changed` | A person saves their numbers or switches | Audit (the mobile's own change is the organisation service's `employee.updated`) |
| `mail_signature.config_changed` | Configure saved | Audit, with the links before and after |
| `mail_thread.summarised` | Summarise Thread kept a fresh summary (§3 step 14) | Audit: the conversation, its message count and the AI run; never the summary's text |
| `document.stored`, `document.removed` (the vault's) | A dictation's recording stored, then removed once transcribed (§3 step 13) | Audit. A `transient` doc type gets no playable copy (`av-transcode` is not queued); `export-cleanup` (hourly, at twenty past) also removes any transient file older than an hour |

Settings: the staff mail server on Settings · Integrations (`docs/guides/integrations.md` §6.3: the
IMAP and SMTP hosts and ports, the hourly limit per person, Sync Every and Live Connections), read
through `shared/integrations/settings.js`. The server file's `MAILBOX_IMAP_HOST`, `MAILBOX_IMAP_PORT`,
`MAILBOX_SMTP_HOST`, `MAILBOX_SMTP_PORT`, `MAILBOX_SEND_PER_HOUR`, `MAILBOX_SYNC_EVERY_MIN` and
`MAILBOX_IDLE_MAX` (group Mailbox) are the fallback when nothing is saved there. `MAILBOX_TLS` stays
in the file only (off for a local test server).

## 8 · Permissions and visibility by role

| Role | Sees | Can do |
|---|---|---|
| Every employee with `mailbox` view | Their own mailbox only | Connect, read, send, manage their folders; Summarise Thread (view) on their own conversations; Write With AI and Dictate (create) in their own composer |
| People, CEO | Their own mailbox only | Same. No access to other mailboxes |
| Leaver | Nothing | Connection to be disconnected and secret deleted on deactivation (not built: nothing raises a deactivation event yet, §13) |
| Holders of `mailbox.signature` (by default System Administrator, which the CTO holds, and Implementation Team) | Their own mailbox; Configure on the Signature tab | Set the company's signature links and switches for everyone. Anyone else in Technology is given the capability directly (Settings · Roles & Permissions). Without it, Configure is not shown and the routes answer 403 `CAPABILITY_REQUIRED` |

## 9 · AI and search

- **AI reads**: `// ai:none`. Mail is private correspondence, and Praxis AI reads none of it: the
  module has no read manifest, so no question to the assistant reaches anyone's mail (A23).
- **Feature AI**, each run only when its owner presses it, on their own mail (§1.1, §3 steps 12 to
  14, §6), registered in `services/ai/actions.js` with personal data, chosen by TB on 22/10/2026:

  | Action | What presses it | Job | Prompt |
  |---|---|---|---|
  | `mail-draft` (Write Email) | Write Draft, Write Anyway, Try Again in Write | Default | `services/ai/prompts/mail-draft.md` |
  | `mail-tidy` (Tidy Email) | Tidy Email, Write Anyway, Try Again in Tidy Up | Default | `services/ai/prompts/mail-tidy.md` |
  | `mail-summary` (Thread Summary) | Summarise Thread, when no current summary is kept | Default | `services/ai/prompts/mail-summary.md` |
  | `mail-dictation` (Mail Dictation) | Dictate | Transcription | `voice-note-transcription.md`, the one every transcription uses (`integrations.md` §6.14) |

  The donor's `mail/assist/` (semantic search and OCR over mail) is not ported (§12).
- **Search** (`mailbox.search.js`, ⌘K): the caller's own conversations by subject, the addresses
  on them and the senders' names. The provider is pinned to the caller's `user_id` (`owner`), so
  the CEO and People, whose grants reach everyone, still find only their own mail. A result opens
  the conversation in Mailbox by its id, whichever folder it is in. Messages are found through
  their conversation (`mail_message` is `search:none`). Words inside a body are not searched.
- The Signature tab is a screen in ⌘K (`src/shared/search/screens.js`: signature, email signature,
  sign-off, WhatsApp, social links). A signature is one per person and the configuration one per
  company, so neither is a searchable record (`search:none`).

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
| Mailbox · Inbox (`inbox`) | "N messages · N unread" (desktop subtitle); Refresh, Compose; Folder, Messages, Unread, Attachments, Mailbox (desktop: the user's address); the message list (unread dot, sender, subject, time); the open message: sender avatar, subject, sender and address, time, Reply, Forward, the body as the sender laid it out in its own sealed frame (`EmailFrame`: nothing in it runs or reaches the app; a `mailto:` link opens our composer; signature logos drawn in place), "Remote images are hidden." with Load Images and Always Show Images when anything was held back, Show Quoted Text and Hide Quoted Text when the message quotes earlier mail, the attachments with their sizes (a photo, a video or a PDF opens full screen in the file viewer, with Download and, on a phone, Share; any other file downloads), each with Forward to Chat beside it (and in the viewer), which opens Community's Forward To; the thread menu adds Stop Showing Images for a trusted sender; Summarise Thread beside Reply and Forward (not in Spam), which opens the Summary card above the messages: Summary as its title, the gist, Key Points and Asked of You (each only when it has something), Copy Summary and Close, loading lines while it is written; toasts "Summary copied", "AI summaries are off" | Help term on the Summary card's title: "Written by AI from this conversation. Check dates and amounts against the mail before acting." | Custom domain only, no Google or Microsoft, signing in with an address and a password, sending and receiving only with no link to other modules: §1, §3 step 1 (the page's ⓘ text is removed). What Refresh does: §3 step 2. What the summary reads, how it is kept and when it is made again: §3 step 14, §6 |
| Mailbox · Sent (`sent`), Drafts (`drafts`), Archive (`archive`), Spam (`spam`), Trash (`trash`) | As Inbox, for that folder. Drafts lists scheduled mail as "Scheduled: subject" with its release time. Spam offers no Forward to Chat | None | Scheduled mail waiting in Drafts until release: §3 step 5. Spam bodies not rendered: §6 |
| Composer (modal; full screen on mobile) | New Message, Reply or Forward as the title; From (the user's address), To (address chips, each removable; Cc Bcc), Cc, Bcc, Subject; the formatting bar (Bold, Italic, Underline, Strikethrough, Heading, Bulleted List, Numbered List, Quote, Link with its address field and Add Link, Clear Formatting); Attach a File and Write With AI with "Draft saved" (or "Saving…") as quiet text at the end of their row, never in the footer; the body; Show Signature under it (Hide Signature once open), which opens the signature this message will carry, full or the slim line, in its own frame ("Signature not available" when it cannot be drawn); attachments as chips with their size and Remove, each with its upload bar while it travels and a Remove on one that failed; Schedule Send (Send Date, DD/MM/YYYY; Send Time, HH:MM; Cancel, Schedule Send). Footer: Discard, Schedule (Tomorrow at 08:00, Monday at 08:00, Pick Date and Time), Send; editing a scheduled mail (title Edit Scheduled Mail), the scheduled time in place of Schedule (the same menu, with Send Now) and Done in place of Send, the toast "Scheduled mail updated"; after Discard, Keep Editing and Discard Draft. Errors of at most 4 words where they happen: "Add a recipient" and "Not an email address" on the To row, "Not a real date", "Not a valid time", "Time already passed" | Help term on Send Time: "Lagos time, on the 24 hour clock: 08:30, 17:45." | How drafts save: §3 step 4. Scheduled mail and its release: §3 step 5. Which messages carry the full signature or the slim line, and where it lands: §3 steps 8 and 9. Link addresses limited to `https://` and `mailto:`: §6. The discard question ("Discard this draft and its attachments?") and the "That time has already passed" sentence are removed: the Discard Draft button and the field error say it (§6) |
| Composer · Write With AI (a step inside the composer) | Write With AI as the step's title with Back; Write and Tidy Up as a choice when the composer holds the person's own words; What To Say (Optional on a reply or a forward) with Dictate; Add a Note (a checkbox) opening Note with Dictate; footer Write Draft, or Tidy Email in Tidy Up. The questions: each question with its answer box and Dictate; footer Write Anyway, Write Draft. The draft: the suggested subject (when the composer's is empty) and the draft in its own frame; footer Try Again, Use Draft. Dictate while recording: Stop Recording and the time; "Writing it down"; "Microphone not allowed", "Could not transcribe". Error "Say what to write" on What To Say. Toasts "Draft added", "Write With AI is off" | Help term on What To Say: "A line on what the mail should say: agree, decline or ask, and the facts it needs." | What the AI reads and never sees, the placeholder check, the questions and the closing line: §6. Which model answers: §9 and AI Control. Where the draft lands: §3 step 12 |
| Mailbox · Signature (`signature`) | Signature as the title; Configure in the header for `mailbox.signature` holders; Your Signature: New Mail and Reply (a segmented switch), the signature in its own frame exactly as it sends, Copy Signature; Details: Name, Job Title, Department, Email; Numbers: Mobile, Office Line, the switches Show Mobile and WhatsApp Link (WhatsApp Link only when the company allows it), Edit Numbers. Edit Numbers (a modal): Mobile, Office Line (Optional); Cancel, Save Numbers; "Not a phone number" on the field. Toasts: "Numbers saved", "Signature copied" (or "Not copied. Try again."), "Mobile hidden", "Mobile shown", "WhatsApp link off", "WhatsApp link on" | Help term on the Details title: "From your employee record and your mailbox. People change your name, title and department." | The one design and why: §1. What each line is made of and where it comes from: §3 step 7. Full or slim, and where it lands in a message: §3 steps 8 and 9. Pictures sent inside the message: §3 step 9. Dark mode and phone widths: §6 |
| Configure Signature (wizard) | Configure Signature as the title; three steps: App Links (App Store, Google Play, each Optional), Social Links (Instagram, TikTok, LinkedIn, X, Facebook, YouTube, each Optional), What Shows (WhatsApp Links, App Links, Social Links, Legal Line as checkboxes; Confidentiality Note, Optional); Back, Next, Save Signature; "Not a web address" on a link field. Toast: "Signature saved" | Help term on Confidentiality Note: "Printed under the company line with the RC number from Settings, Organisation, when Legal Line is ticked." (A checkbox's label cannot carry a help term: it would join the label.) | Who may configure: §8. An empty link shows nothing: §6 |
| Mailbox · Connect (sheet) | Connect Mailbox as the title; Email Address, Password; Connect. On a refused password the banner over the list reads "Mail server refused the password" with Reconnect. Errors of at most 4 words on the field: "Not an email address", "Password refused", "Mail server not found" | None | Autodiscover, the test in both directions and where the password is kept: §3 step 1, §4 |
| Settings · Integrations, Staff Mail Server | Owned by Settings · Integrations: that module's guide | That module's guide | How a mailbox is tested and where its password is kept: §3 step 1, §4 |
| Notification bell | Owned by the frontend foundation (FRONTEND_GUIDE §9.6): the sender and subject; a tap opens the message | None | Which mail notifies: §7, Settings · Notifications |

### 10.2 Phone layout

| Screen | First on a phone | Left off a phone | Main action | Navigation |
|---|---|---|---|---|
| Mailbox · Inbox (`inbox`) | Refresh and Compose beside the title; four stat cards two to a row (Folder, Messages, Unread, Attachments); the message list, full width | The subtitle; the Mailbox address card; the reader beside the list; the resizable divider | Tap a message: the reader opens full screen with Back, Reply and Forward, Summarise Thread as a 44 px icon button beside them, and a message laid out wider than the phone is scaled down to its width, never scrolled sideways; the Summary card sits full width under the subject, its Copy Summary and Close 44 px icon buttons; Compose opens the composer full screen | Mailbox from the menu drawer (it is not on the bottom bar); the six folder tabs scroll sideways along the top |
| Mailbox · Sent (`sent`), Drafts (`drafts`), Archive (`archive`), Spam (`spam`), Trash (`trash`) | As Inbox | As Inbox | As Inbox | As Inbox |
| Composer (modal; full screen on mobile) | A full screen sheet: From, To, Subject as compact 44 px rows; the formatting bar in two rows of 44 px buttons; Attach a File and Write With AI (a 44 px button with its word) under it; the body; Show Signature under it as a 44 px button | Nothing: the same fields as desktop | One footer row: Discard and Schedule as 44 px icon buttons, Send taking the rest of the width | Close at the top of the sheet; Discard asks once in the footer (Keep Editing and Discard Draft share the row) |
| Composer · Write With AI (a step inside the composer) | The composer's full screen sheet turns to the step: Back and the title at the top; Write and Tidy Up as 44 px segments when offered; What To Say as a three line box with Dictate (44 px) under it; Add a Note as a 44 px checkbox row; the draft at full width in its frame | Nothing: the same step as desktop | One footer row: the primary (Write Draft, Tidy Email or Use Draft) taking the rest of the width, Write Anyway or Try Again beside it | Back at the top returns to the composer with what was typed in the step kept; the sheet's close closes the composer as before |
| Mailbox · Signature (`signature`) | Your Signature first: the New Mail and Reply switch full width (44 px segments), the signature at full width (it is at most 400 px, so it is never shrunk), Copy Signature as a 44 px icon button; then Numbers with its two switches; Configure as a 44 px icon button beside the title for holders | The Details card: a Details row at the foot of Numbers, closed, opening Name, Job Title, Department and Email as a bottom sheet | Edit Numbers opens a bottom sheet, Save Numbers full width at its foot | Mailbox from More; the seven tabs scroll sideways along the top |
| Configure Signature (wizard) | A full screen sheet: the step number and title, the step's fields, Next full width at the bottom | Nothing: the same steps as desktop | Save Signature full width on the last step | Close at the top of the sheet; Back on the steps after the first |
| Mailbox · Connect (sheet) | A bottom sheet: Email Address, Password, Connect full width | Nothing | Connect | Opens by itself over Mailbox; Close returns to the menu |
| Settings · Integrations, Staff Mail Server | Owned by Settings · Integrations | That module's guide | That module's guide | That module's guide |
| Notification bell | The bell in the top bar; push on the phone | None | A tap opens the message in the full screen reader | The top bar |

## 11 · Edge cases

- **Wrong password / server refuses**: the connection test fails with the classified reason and
  the fix (`services/mail/smtp-errors.js`): "Password refused" or "Mail server not found" on the field; nothing is
  saved.
- **Password changed on the mail server**: sync fails → connection marked `needs_reconnect` → a
  banner in Mailbox with **Reconnect**, which opens the Connect sheet with the address filled in.
- **The staff mail server moves** (§3 step 11): every connected mailbox is re-pointed and synced; one
  whose password the new server refuses goes to `needs_reconnect` with the same banner. A message
  queued before the move is delivered through the new hosts.
- **First sync of a large mailbox**: read in batches from the last UID; each run takes the next
  batch until the folder is caught up.
- **Hard-bounced recipient**: the send fails with `RECIPIENT_REFUSED` and the sender is notified.
- **Double send** on a bad connection: refused by the Idempotency-Key.
- **Offline**: not supported; the draft is kept.
- **Dangerous attachment types**: refused by the mime policy; inbound ones are listed but not opened
  inline.
- **Signature with gaps**: no mobile on the record, or hidden: no mobile line and no WhatsApp link.
  No office line, no website, no address, no links: each line is left out, never shown empty.
- **Signature cannot be built** (the record cannot be read at that moment): the message still
  queues and leaves without it, and the failure is logged. A missing signature is recoverable; a
  message refused for the want of one is not.
- **Mixed recipients**: a new message to colleagues and one outside address gets the full signature;
  any reply gets the slim line, whoever is on it.
- **Mail written in another app** (a phone's own mail app on the same mailbox) never passes through
  the server's send, so it carries no signature; Copy Signature puts the full signature on the
  clipboard to paste into that app's own signature setting.
- **A brand file removed** in Settings · Organisation: the next signature carries the drawn pin and
  the company name again; sent mail keeps the picture it left with.
- **AI off, capped or not set up**: Write With AI says "Write With AI is off" and Summarise Thread
  "AI summaries are off"; nothing in the composer or the mail changes. With no provider set up (a
  laptop, CI) the stub cannot write a real draft, so this is what a laptop shows.
- **A placeholder in the answer twice**: the press fails with "The AI answer could not be used. Try
  again, or write it yourself."; the composer is untouched.
- **The model asks when it need not, or writes when it should ask**: Write Anyway always drafts;
  a draft that guessed shows in the step before Use Draft, so the person reads it first.
- **A reply to a conversation moved to Spam since the composer opened**: refused with
  `SPAM_NOT_READ`; the composer stays as it was.
- **The original of a reply is gone** (Trash emptied): Write With AI drafts from the quoted mail
  in the composer instead, as for a forward.
- **A long conversation**: its last 30 messages are read, each cut at its quoted history and
  trimmed; the summary covers those.
- **New mail while the Summary card shows**: the card keeps what it said; Summarise Thread again
  asks afresh because the newest message changed.
- **A dictation that fails**: "Could not transcribe" beside Dictate; the recording is removed all
  the same, and the person can type.
- **A closed tab mid dictation**: the recording waits at most an hour before `export-cleanup`
  removes it.
- **A token or a redaction mark the model made up** (KEPT099, [PHONE]): treated as a placeholder,
  sent back once (§6).

## 12 · Donor code

| From | File | Change on the way in |
|---|---|---|
| praxis-ls | `src/modules/mail/mail/` (12,250 loc, 39 files): `mail.service`, `providers/imapSmtp.provider`, `thread.*`, `threading`, `outbox.*` (send queue), `folders`, `autodiscover`, `smtp-error.map`, `compose`, `mail.validator`, `mail-notify.service`, `access`, `visible`, `search`, `presend`, `attachment.service`, `schedule`, `origin` | **First, cut the five `require` lines** into triage, binding and assist (MILESTONES §6.5). Delete the Microsoft and Google providers and OAuth. No tenant |
| praxis-ls | `src/jobs/mail-sync.js`, `handlers/mail-sync-scheduler.js`, `mail-idle.js` | Into `src/jobs/` per README §5.15 |
| praxis-ls | `client/src/features/comms/inbox/` incl. `composer/` (`toolbar.tsx`, `index.tsx`, `recipient-field.tsx`, `attachment-tray.tsx`) | The rich text composer, ported with MyCity branding |
| praxis-ls | `doc/SMART_MAIL_ENGINEERING_GUIDE.md`, `doc/SMART_MAIL_FIELD_NOTES.md` | **Read the field notes before starting** |
| praxis-ls | `src/modules/mail/assist/` (semantic search and OCR over mail) | Not taken (§1.1): Write With AI, Tidy Up and Summarise Thread are new, on `services/ai/llm.service` and AI Control's chains |
| praxis-ls | `src/modules/mail/signature/` (`signature.resolve`, `signature.html`, the send-time bake in `outbox.service`) | Taken in a much smaller form: the pure model then email-safe HTML, lines left out when empty, `tel:` links of digits only, baked into the queued payload and never rewritten in sent mail. Left: templates and department defaults, the designer and palette roles, the PNG card and its batch export, languages, the render cache and its invalidation handlers, gap analysis. Changed: one design for everyone; pictures sent inline (`cid:`) instead of one hosted picture of the whole card, which an image-blocking reader never saw; the slim line on replies; placed above the quoted mail instead of after it |

## 13 · Open questions

- Shared mailboxes (for example `people@mycityapp.io`): wanted, and in which milestone?
- Answered 19/10/2026 (TB): email signatures are built in, one design for everyone (§1, §6).
- Answered 16/10/2026: Namecheap cPanel, `mycityapp.io` for IMAP (993) and SMTP (465).
- Is the 50 an hour sending limit per mailbox or for the whole hosting account? (asked of the
  domain manager)
- Undo send window, and how long scheduled mail may wait.
- Leavers: which event disconnects a deactivated person's mailbox (needs a deactivation event from
  identity).
- Search inside message bodies: wanted, given the cost of matching every body on each keystroke?
- Write With AI reading an attachment's contents (a PDF, a photographed form) for context: that is
  the Image Reading job and more of a person's files sent to a model. Wanted, and on which mail?
- A monthly AI allowance per person for mail, beside AI Control's provider caps?

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
- 19/10/2026 · TB · §6 and §7 from TB's notification decisions (`docs/guides/notifications.md`): IMAP IDLE on by default, 24 inboxes on production and 4 on staging when `MAILBOX_IDLE_MAX` is unset, so mail is noticed the moment it lands; the new-mail notice carries the message's first line; reading a conversation marks its notices read (`notifications.markReadForRecord` in `markRead`'s transaction).
- 19/10/2026 · TB · Email signatures, from TB's brief and answers: one design for everyone (Street Sign, chosen on the design canvas from three), built from the employee record, the mailbox and Settings · Organisation, never designed by hand. The Signature tab (#94) shows it as it sends (New Mail or Reply) and takes only the person's numbers (the mobile through the employee record, an office line, Show Mobile and WhatsApp Link); Configure (capability `mailbox.signature`, System Administrator and Implementation Team) sets the app and social links and the switches. The full signature goes on new mail and forwards, the slim line on replies and colleague-only mail, baked when queued, placed above the quoted mail, with its pictures inline. The composer previews it behind Show Signature. §1 to §14 updated; migration 1127, seed 1129.
- 19/10/2026 · TB · §10: a photo, a video or a PDF attached to a mail opens in the file viewer shared with Staff Community (`MediaViewer`: a PDF's pages drawn in the app by PDF.js on a phone as on desktop, Download, and Share on a phone); any other attachment downloads as before.
- 19/10/2026 · TB · Mail's notices name their audience (The mailbox's owner) in Settings ·
  Notifications (`docs/guides/notifications.md` §6) and take no copies.
- 19/10/2026 · TB · §1 and §10: Forward to Chat beside each attachment and in the file viewer sends the file to up to 5 Staff Community chats (`docs/guides/community.md` §3 step 19, `POST /community/forward` with `mail_attachment_id`); only the mailbox's owner, only a file scanned clean and of a type chats take, never from Spam (§6).
- 20/10/2026 · GE · From a test on staging: scheduling a scheduled draft again added a second send (it showed twice in Drafts and would have gone twice), its edits never reached the waiting send, and Discard left the send to go anyway. Now one waiting send per draft (`1128` cancels the doubles and indexes the rule), autosave keeps it in step, Discard cancels it, and Edit Scheduled Mail has the time and Done in its footer (§3 step 5, §4, §10).
- 20/10/2026 · TB · Settings · Integrations (#77, `docs/guides/integrations.md`, TB's answer 12,
  "Nothing here"): mailbox connections stay in Mailbox and no person's mailbox is on that page. The
  staff mail server's hosts, ports, hourly limit per person, sync interval and live connections
  move there, with the `MAILBOX_*` variables as the fallback; a change re-points every mailbox
  (`mail_account.server_moved`) and syncs it as its retest (§3 step 11, §7, §11). The sync scheduler
  ticks every minute to honour a changed interval; `smtp-errors.js` moved to `services/mail/`.
- 20/10/2026 · TB · Nothing in the mailbox changed. Always Show Images' `sender_address` is an email address, marked `address:none` in the contract so gate 22 (addresses picked, never typed, `docs/guides/addresses.md`) knows it is not a place.
- 22/10/2026 · TB · Write With AI and Summarise Thread, from TB's brief and eight answers (§1.1; M10's mail AI brought forward): in the composer, a step that drafts a reply, a forward's note or a new message from the conversation, What To Say and a note (each dictated or typed), or tidies the person's words, asking up to three questions first when a fact only the person knows is missing, then Use Draft; in the reader, a Summary card (gist, Key Points, Asked of You) kept until new mail (`mail_thread_summary`, migration 10300). Actions `mail-draft`, `mail-tidy`, `mail-summary` (Default) and `mail-dictation` (Transcription), personal data. Contact details are swapped for tokens before anything leaves and put back in the draft; every answer is checked for placeholders. §1, §1.1, §2 to §14 updated.
