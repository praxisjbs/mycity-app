# Staff Community · Engineering Guide

| | |
|---|---|
| Owner | GE |
| Milestone | M1 |
| Backend modules | `community`, `announcements` |
| Frontend paths | `app/src/features/community/` |
| Permission key(s) | `community` |
| Screens (PROGRESS.md rows) | #15 Channels, #16 Direct Messages, #17 Announcements; reads shared with #66 Knowledge Hub · Announcements (M10) |
| Status | Agreed |
| Last changed | 15/10/2026 |

Sources: MILESTONES §6.4 and A19, A20; REUSE_MAP §2.4; the internal workflow meeting of 12 October
2026 (GE presenting, TB reviewing). The demo (`demo.html`, Staff Community) was updated the same day
to match this guide; where they differ, this guide wins.

---

## 1 · What it is for

Internal communication for MyCity staff, in one place and on the company's own record: channels for
departments, projects and the whole company (part WhatsApp group, part WhatsApp channel), one to one
direct messages, and company announcements from People and the CEO. It also carries the two
culture features MyCity asked for: peer recognition (A19) and automatic birthday and work
anniversary posts (A20).

Used by every member of staff. People (Operations and HR) and the CEO also publish announcements and
track who has read them.

## 2 · Screens affected

| Screen / tab (slug) | Where | Who sees it | What it shows | What a person can do there |
|---|---|---|---|---|
| Staff Community · Channels (`channels`) | Staff app | Every employee; only channels they belong to | Channel list (#announcements pinned first), the open channel's thread, its composer | Read, post, react, vote, recognise, celebrate, attach files, create a channel, view or edit members |
| Staff Community · Direct Messages (`direct-messages`) | Staff app | Every employee; only their own conversations | Conversation list (All / Unread), the open conversation, the colleague's profile | Message one colleague, attach files, record voice notes, view their profile, search the conversation, mute |
| Staff Community · Announcements (`announcements`) | Staff app | People and the CEO | The configuration and tracking side: KPI strip, every announcement with read counts | Publish or schedule an announcement, see who has and has not read it |
| #announcements channel | Staff app, inside Channels | Every employee, read only | Published announcements, newest last | Read; only People and the CEO post |
| Knowledge Hub · Announcements (M10) | Staff app | Every employee | The same announcement records, as an archive | Read. No second copy of the data |
| Notification bell and web push | Staff app, phone | Recipients | New announcement, direct message, mention | Open the message |
| People · Employees (employee record) | Staff app | People | `date_of_birth`, `start_date`, avatar | Source of the birthday and anniversary posts. Nothing is entered in Community for them |
| Settings · Notifications (M6) | Staff app | Every employee | "Community messages" category | Choose in-app, push or email |
| Mobile bottom bar "Community" | Staff app, phone | Every employee | Opens Staff Community | |

## 3 · How the screens relate

1. **Posting.** A member posts in a channel → `community.message.posted` is emitted in the
   transaction → after commit the worker pushes it to the Socket.io room `channel:<id>` (everyone
   with the channel open sees it at once, no polling) and fans out notifications to members who are
   not looking at the channel and have not muted it.
2. **Announcements.** People or the CEO publish from Announcements → one `announcement` row and one
   message in #announcements, in the same transaction → `announcement.published` → notification to
   the whole audience (all staff, or chosen departments). A scheduled announcement is stored with
   `publish_at` and released by a delayed job; until then it is visible only on the Announcements
   tab, marked Scheduled. Opening the message marks it read; the Announcements tab shows the
   counts and the list of who has not read it.
3. **Celebrations.** The `celebrations` scheduler runs at 05:00 Africa/Lagos, reads employees whose
   `date_of_birth` (day and month) or `start_date` anniversary is today, and posts one celebration
   card each to #general, as the system. The card uses the employee's avatar, or their initials when
   there is none, and a message rotated from a fixed list. Colleagues press Celebrate on it.
4. **Recognition.** From the ＋ beside the composer → Recognise a Colleague → pick a person, say what
   they did (optional; a note is written if left blank) → a recognition card in the current channel.
   People posting in #announcements can recognise there too. Manager to subordinate, peer to peer and
   upward are all allowed. No rewards, no voting, no employee of the month (Cynthia).
5. **Channels are created** from New Channel: name, purpose, members (whole departments and/or
   individuals), and **who can post, decided at creation** (every member, or admins only). The
   creator is the channel's admin. Channels are internal: there is no public or join link.
6. **Members** are reached from the channel's ⋮ menu (View Members, Edit Members for admins), never
   from a button on the page.
7. **Direct messages** start from New Message → employee picker → the conversation appears in the
   list once the first message is sent.
8. **View Profile** (the person's name in the thread header, or ⋮ → View Profile): a third column on
   desktop, a sheet on mobile. It shows title, status, work email, phone, worksite and local time,
   the files and voice notes shared in this conversation, channels in common, a mute switch, and
   **View in People** (only for users with the `people` grant, opening the employee 360). No work
   details (department, manager, pattern, start date): those belong to People. It reads the employee
   record; nothing is stored in Community.
9. **Search in Conversation** (the search icon in the thread header, ⋮ in a DM, or ⋮ → Search in
   Channel): matches are highlighted in place with a count ("2 of 4"), Enter and the arrows move
   between them, Escape closes. The search runs on the server over the caller's own conversation
   (`GET /channels/:id/messages?q=`), never across conversations they are not in.
10. **Message ticks** on direct messages the user sent: one tick when the server has it (sent), two
    grey ticks when it reached the other person's device (delivered), two blue ticks once they have
    opened the conversation (read). Channels show no ticks.
11. **Voice notes** play inline with a progress waveform. **Transcribe** under a voice note asks the
    server for a transcript, shows "Transcribing…" and then the text, which can be hidden again.
    The transcript is stored once per voice note, so the second person to ask gets it at once.
12. **Announcement read tracking** (Announcements tab): each card shows its title, an "N of 25 read"
    pill (or Scheduled), the body and who posted it. Clicking a card opens **Announcement Reads**
    (**Scheduled Announcement** before it goes out): the headline, the posted line, the body, "Read
    by N of 25" with its bar, and under that two lists, **Not Read** (with a **Remind Them** button
    that notifies only those people) and **Read**. The lists live in the modal only, never on the
    card. **Average Read** on the tab is the mean, across published announcements, of the share of
    the audience who have opened each one.
13. **Resizable list.** On desktop the divider between the list and the conversation can be dragged
    (or moved with the arrow keys; double click resets). The width is remembered per browser. The
    list and the conversation each scroll on their own; the page never scrolls behind them.

## 4 · Data

Proposed for the M1 migration block (1000 to 1999). Column names are the contract's keys (gate 6).

| Table | Key columns | Notes |
|---|---|---|
| `community_channel` | `channel_id`, `name` (unique, `^[a-z0-9][a-z0-9-]{1,29}$`), `description`, `kind` (`channel` / `direct`), `post_policy` (`members` / `admins` / `people_ceo`), `is_system`, `pinned`, `archived_at`, `created_by` | `#announcements` (`people_ceo`, pinned) and `#general` are seeded system channels and cannot be deleted or left |
| `community_member` | `channel_id`, `user_id`, `role` (`admin` / `member`), `muted`, `last_delivered_message_id`, `last_read_message_id`, `joined_at` | **Membership is the authorisation boundary** for every read and write. The two pointers drive the ticks |
| `community_message` | `message_id`, `channel_id`, `author_id` (null for system posts), `kind` (`text` / `file` / `voice` / `recognition` / `celebration` / `poll` / `announcement`), `body`, `document_id`, `meta` jsonb, `transcript`, `reply_to_id`, `edited_at`, `deleted_at`, `created_at` | `meta` holds the kind's fields: poll options, voice duration, celebration type and employee. `transcript` is filled on first request |
| `community_reaction` | `message_id`, `user_id`, `emoji` | Celebrate and thumbs up are reactions |
| `community_poll_vote` | `message_id`, `user_id`, `option_index` | One vote per person, changeable |
| `community_recognition` | `message_id`, `from_user_id`, `to_employee_id`, `note`, `note_written_by_system` | Kept separately so M2 performance and Home can count recognitions |
| `announcement` | `announcement_id`, `title`, `body`, `audience` jsonb (all / department ids), `publish_at`, `published_at`, `author_id`, `message_id` | The record. #announcements and the M10 Knowledge Hub both read it |
| `announcement_read` | `announcement_id`, `user_id`, `read_at` | Read receipts; visible to the poster only |

Files: documents (pdf, xlsx, docx) go to the vault as `document` rows; chat images, voice notes and
video go to the comms media store (`media/comms/...`, BACKEND_STRUCTURE §1, §5.3). Voice notes are
transcoded to Opus by `av-transcode`.

## 5 · API

All under `/api/v1/community`. Every list is paged at 25 (BACKEND_STRUCTURE §16).

| Method and path | Contract | Permission · scope | Paged | Notes |
|---|---|---|---|---|
| `GET /channels` | `ChannelListQuery` → `ChannelPage` | `community` view · own membership | yes | Filters: `q`. Pinned first |
| `POST /channels` | `ChannelCreate` → `Channel` | `community` create | | Members by department ids and/or user ids; `post_policy` |
| `GET /channels/:id` | → `Channel` | member | | |
| `GET /channels/:id/members` | `PageQuery` → `MemberPage` | member | yes | |
| `POST /channels/:id/members`, `DELETE /channels/:id/members/:user_id` | `MemberAdd` | channel admin | | |
| `POST /channels/:id/mute`, `POST /channels/:id/read` | | member | | |
| `GET /channels/:id/messages` | `MessageListQuery` → `MessagePage` | member | yes | Newest page first; "Load Older" asks for the next page. `q` searches this conversation and returns the matching pages |
| `POST /channels/:id/messages` | `MessageCreate` → `Message` | member, and allowed by `post_policy` | | Idempotency-Key required |
| `POST /channels/:id/media` | multipart → `Message` | member, `post_policy` | | Through `middleware/upload` (sniffed, size-capped, progress on the client) |
| `POST /channels/:id/recognitions` | `RecognitionCreate` → `Message` | member, `post_policy` | | `to_employee_id` cannot be the sender |
| `POST /messages/:id/reactions`, `POST /messages/:id/vote` | `ReactionToggle`, `PollVote` | member | | |
| `GET /direct` | `PageQuery` → `ConversationPage` | own | yes | Filter `unread` |
| `GET /people/:user_id/card` | → `ProfileCard` | `community` view | | The profile panel: public work fields only, field masking applied. Restricted fields never appear |
| `POST /direct` | `{ user_id }` → `Conversation` | `community` create | | Returns the existing conversation if there is one |
| `GET /announcements` | `AnnouncementListQuery` → `AnnouncementPage` | `announcements.post` capability | yes | The tracking tab |
| `POST /announcements` | `AnnouncementCreate` → `Announcement` | `announcements.post` capability | | `publish_at` optional (day-first on screen, ISO on the wire) |
| `GET /announcements/:id/reads` | `ReadListQuery` → `ReadPage` | author or capability | yes | Filter `read` / `not_read` |
| `POST /announcements/:id/remind` | → `{ reminded }` | author or capability | | Notifies only those who have not read it; once per day per announcement |
| `POST /messages/:id/transcript` | → `Transcript` | member | | Voice notes only. Through `services/ai/transcription.js` (governance, ledger); cached on the message |
| `POST /channels/:id/delivered` | `{ up_to_message_id }` | member | | The client acknowledges receipt: drives the delivered tick |

Posting to #announcements is gated by the `announcements.post` capability (BACKEND_STRUCTURE §11,
`capability` / `user_capability`), held by People and the CEO.

## 6 · Rules and calculations

- A user reads and writes only in channels they are a member of. Removed members lose the channel's
  history.
- `post_policy` is chosen when a channel is created and cannot be changed afterwards. #announcements
  is `people_ceo`.
- The author of a message, recognition, poll, channel or announcement is always the signed-in user.
  Nobody posts on another person's behalf, so the forms do not ask or say who is posting.
- A channel name is 2 to 30 characters of lower case letters, numbers and hyphens, starting with a
  letter or number, and unique.
- #announcements and #general are pinned, cannot be left, and cannot be deleted.
- A recognition note left blank is written by the system ("Thank you for the great work this week").
  A recognition to oneself is refused.
- Celebrations post at 05:00 Africa/Lagos, every day of the week, one card per person per occasion.
  An employee with no `date_of_birth` gets no birthday post. Only the day and month are ever shown.
- A poll has 2 to 4 options and one vote per person; voting again moves the vote.
- Read counts on announcements are visible to the poster and to holders of `announcements.post` only.
- Calls are **not** part of this module (no call button, no WebRTC): they do not work on the donor
  either (TB, 12 October).
- Copy a person reads: Title Case chrome, no em dashes, day-first dates.

## 7 · Events, jobs and notifications

| Event / job | When | Does |
|---|---|---|
| `community.message.posted` | After a message commits | Realtime push to `channel:<id>`; notifications to non-muted members not viewing; mentions notify |
| `community.recognition.posted` | After a recognition commits | As above; counted for Home and M2 |
| `announcement.published` | On publish, or when a scheduled one is released | Message in #announcements; notification and push to the audience |
| `announcement-publish` (delayed job) | At `publish_at` | Releases a scheduled announcement (README §5.15) |
| `celebrations` (scheduler + handler) | 05:00 Africa/Lagos daily | Birthday and anniversary cards in #general |
| `av-transcode`, `media-scan` | After an upload | Voice note to Opus, video to MP4; a file from outside scanned. Image variants are made at upload; `media-derive` makes a file's variants again on request |

## 8 · Permissions and visibility by role

| Role | Sees | Can do |
|---|---|---|
| Employee | Channels they belong to, their own DMs, #announcements | Post where `post_policy` allows, react, vote, recognise, create channels, start DMs |
| Channel admin (creator) | As employee | Edit members, archive the channel |
| People (Operations and HR) | As employee, plus the Announcements tab | Publish and schedule announcements, see read receipts, post in #announcements |
| CEO | As People | As People |

Nobody, including People and the CEO, can read a direct message they are not part of.

## 9 · AI and search

- **AI reads** (`community.ai.js`): `announcements.list` (published announcements, any staff);
  `channels.list` (the caller's channels). **No read over message bodies or direct messages.**
  Private conversation is not material for the assistant. Paged at 25.
- **AI routes**: "post an announcement" → Announcements · New Announcement; "message someone" →
  Direct Messages · New Message, prefilled with the person.
- **Search** (`community.search.js`, ⌘K): channels by name, announcements by title and body, the
  caller's own conversations by person. Words people use: chat, group, channel, notice, memo.

## 10 · On screen and mobile

What each screen shows open, what sits behind help, and how it is laid out on a phone
(FRONTEND_GUIDE §5, §7). **§3 and §6 are for engineers: nothing in them reaches a screen unless it
is listed here as tier 1 or tier 2.** Tier 3 (how the system works, why it was built this way,
reassurance nobody asked for) is never on a screen; say where it lives instead (this guide, the
manual, the AI assistant). Both tables are read by `scripts/check/guides.js`.

Messages, announcements, recognitions, polls and celebration cards are content a person wrote or
received, not interface copy; the copy rules apply to the chrome around them.

### 10.1 Content tiers

| Screen | Open (tier 1) | Behind help (tier 2) | Not on screen (tier 3), lives in |
|---|---|---|---|
| Staff Community · Channels (`channels`) | "6 channels · 25 staff" (desktop subtitle); New Channel; Search Channels; Pinned and Channels, each row the channel name (a lock when read only), its last message, time and unread count; the open channel: name, member count, a Read Only pill, the ⋮ menu (View Members, Edit Members, Channel Details, Search in Channel, Mute Notifications), the messages and the celebration, recognition and poll cards (Celebrate, votes), the composer with ＋ (Recognise a Colleague, Celebrate, Start a Poll, Attach a File) and Send; where the user may not post, "Only People and the CEO post here" in place of the composer. New Channel: Channel Name, Purpose (Optional), Departments (Optional), People (Optional, with the count selected), Who Can Post (Every Member, Admins Only); Cancel, Create Channel. Channel Members and Edit Members (Remove, Add People, Close); Channel Details (Channel, Members, Who Can Post). Recognise a Colleague (Colleague, Note Optional; Post Recognition); Celebrate (Colleague, Occasion: Birthday or Work Anniversary; Post Celebration); Start a Poll (Question, Option 1 to 4, the last two Optional; Post Poll); Attach a File (the files, then the upload percentage). Field errors of at most 4 words on the field: "Not a valid name", "Choose a colleague", "Add a question", "Add an option" | Help term on Channel Name: "Lower case letters, numbers and hyphens, 2 to 30 characters. Two channels cannot share a name." Help term on Note in Recognise a Colleague: "Leave it blank and a thank you note is written for you." | Who can post being fixed when the channel is created, that only members read a channel, that channels are internal with no join link: §3 step 5, §6 (the New Channel ⓘ text is removed, and so is the Visibility row of Channel Details). Files going to the vault: §4 (the "Files are stored in the vault" line is removed). Who posts: §6 |
| Staff Community · Direct Messages (`direct-messages`) | "N unread" or "All caught up" (desktop subtitle); New Message; Search People; All and Unread; each conversation: avatar with the online dot, name, last message ("You:" when it was the user's), time, unread count; the open conversation: name, Online or Last Seen, department, search, ⋮ (View Profile, Search in Conversation, Mute Notifications), the messages with their ticks, voice notes (Play, Transcribe, Hide Transcript), the composer (Attach: Photo or Video, Document; record a voice note; Send). Profile: avatar, name, title, status pill, Message, View in People; Contact (work email, phone, worksite, local time); Shared in Conversation; Channels in Common; Mute Notifications; Search in Conversation. New Message: the person picker | None | What one tick, two grey and two blue mean: §3 step 10. Transcripts stored once per voice note: §3 step 11. The profile reading the employee record and showing no work details: §3 step 8. Search covering only the caller's own conversation: §3 step 9 |
| Staff Community · Announcements (`announcements`) | New Announcement; Published, Scheduled, Average Read, Audience, This Month (desktop); a card per announcement: headline, a Scheduled or "N of 25 read" pill, the body, "Posted" or "Goes out" with the date and author. A card opens Announcement Reads (or Scheduled Announcement): headline, posted line, body, "Read by N of 25" with its bar, Not Read with Remind Them, Read; Close. New Announcement: Headline, Message, Audience (All Staff or Departments, then the department chips), When (Now or Schedule, then Publish Date, DD/MM/YYYY); Cancel, Publish Announcement (Schedule Announcement when scheduled) | Help term on Average Read: "Across published announcements, the share of the audience who have opened each one." | Who may post, #announcements being pinned and read only, the notification on publish, scheduling, read counts visible to the poster only: §3 step 2, §6, §7, §8 (the page subtitle "Posted by People and the CEO · staff read them in #announcements" and its ⓘ text are removed). "Not yet visible to staff" on the scheduled pill: §3 step 2. "Posting as" in the form: §6 |
| #announcements channel | As Channels: the published announcements as cards (author, date, headline, body), newest last; the Read Only pill; for staff, "Only People and the CEO post here" in place of the composer | None | The `announcements.post` capability: §5, §8 |
| Knowledge Hub · Announcements (M10) | Owned by Knowledge Hub (M10): the same announcement records, read only | The M10 guide | The M10 guide. That it reads the same records, no second copy: §2 |
| Notification bell and web push | Owned by the frontend foundation (FRONTEND_GUIDE §9.6): the sender and first line; a tap opens the conversation | None | Fan-out, muting and who is notified: §3 step 1, §7 |
| People · Employees (employee record) | Owned by People: that module's guide | That module's guide | How birthdays and anniversaries become posts: §3 step 3, §6 |
| Settings · Notifications (M6) | Owned by Settings (M6): the Community Messages category with in-app, push and email | The M6 guide | The M6 guide |
| Mobile bottom bar "Community" | The Community icon and word; it opens Staff Community | None | FRONTEND_GUIDE §7 |

### 10.2 Phone layout

| Screen | First on a phone | Left off a phone | Main action | Navigation |
|---|---|---|---|---|
| Staff Community · Channels (`channels`) | New Channel beside the title; the search box; Pinned and Channels as full-width rows (channel name, last message, time, unread count) | The subtitle; the open channel beside the list (a channel opens full screen instead); the resizable divider | Tap a channel: it opens full screen over the top bar, tabs and bottom bar, with Back; the composer is locked at the bottom (44 px buttons) and only the messages scroll; ＋ opens Recognise, Celebrate, Poll and Attach as a menu, each form as a bottom sheet | Bottom bar Chat; the three tabs along the top; inside a channel the menu button opens the channel list as a side drawer; Back returns to the list |
| Staff Community · Direct Messages (`direct-messages`) | New Message beside the title; the search box; All and Unread as a full-width two-part switch (44 px); the conversation rows | The subtitle; the profile column (View Profile opens it as a sheet); the resizable divider | Tap a conversation: it opens full screen with Back; Attach, the voice note button and Send at the bottom, 44 px | As Channels |
| Staff Community · Announcements (`announcements`) | New Announcement under the title; four stat cards two to a row (Published, Scheduled, Average Read, Audience; Average Read's help opens as a sheet); the announcement cards one to a row | This Month | New Announcement opens the form as a bottom sheet, the primary full width; a card opens its reads as a sheet | Bottom bar Chat; the three tabs along the top |
| #announcements channel | As Channels | As Channels | Staff read only; People and the CEO post from the composer | As Channels |
| Knowledge Hub · Announcements (M10) | Owned by Knowledge Hub | The M10 guide | The M10 guide | The M10 guide |
| Notification bell and web push | The bell in the top bar; push on the phone | None | A tap opens the conversation full screen | The top bar |
| People · Employees (employee record) | Owned by People | That module's guide | That module's guide | That module's guide |
| Settings · Notifications (M6) | Owned by Settings | The M6 guide | The M6 guide | The M6 guide |
| Mobile bottom bar "Community" | Community, third of the five bottom bar items (F16), with the unread count | The desktop rail | Tap: Staff Community opens on Channels | The bottom bar (FRONTEND_GUIDE §7) |

Every modal opens as a bottom sheet on a phone (FRONTEND_GUIDE §7); a form's errors sit on its
fields, never in a toast.

## 11 · Edge cases

- **Leaver**: removed from every channel and DM on deactivation; their past messages stay, shown with
  their name.
- **No avatar**: the celebration card shows initials.
- **Same birthday**: one card each.
- **A birthday on a non-working day**: still posted; the job runs every day.
- **Message deleted**: replaced by "Message deleted"; the row keeps `deleted_at` for the audit.
- **Double send** on a bad connection: refused by the Idempotency-Key.
- **Offline**: not supported (BACKEND_STRUCTURE §15). The composer says so and keeps the draft.
- **Huge history**: paged at 25; "Load Older" fetches the next page.
- **Unsupported file type**: refused by the upload engine's mime policy, with the reason.
- **Announcement scheduled in the past**: refused; the date must be today or later.

## 12 · Donor code

| From | File | Change on the way in |
|---|---|---|
| praxis-ls | `src/modules/smartcomm/` chat half: `service`, `repo`, `controller`, `routes`, `validator`, `media.service`, `presence`, `links.service`, `erp.service`, `config.service`, `schedule.service`, `events`, `ai` (4,212 loc) | No tenant; contract schemas; membership checks kept as is; paging through `pageQuery` |
| praxis-ls | `smartcomm.call.*`, `diagnostics.*`, `turn.*` (5,750 loc) | **Not ported** |
| praxis-ls | `client/src/features/comms/team-chat.tsx`, `chat/` (composer, message-bubble, voice-note, voice-recorder, attachments) | Layout and behaviour ported; MyCity branding |
| new | Recognition, celebrations, polls, announcements tracking | Built here (A19, A20) |

## 13 · Open questions

- Can any employee create a channel, or only managers and People? (Default here: any employee.)
- Birthday privacy: offer an opt-out for staff who do not want their birthday posted (NDPA)?
- Message edit and delete windows (Praxis allows edit of your own message; proposed: 15 minutes).
- Voice note maximum length (proposed: 5 minutes).
- Is the donor's certified (SHA-256) channel export wanted?
- Transcription runs through the AI service (cost per minute of audio): on request only, as in the
  demo, or automatically for every voice note? Can a user switch off read receipts?

## 14 · Change log

- 13/10/2026 · GE · First version, from the 12 October internal workflow meeting and MILESTONES §6.4.
- 13/10/2026 · GE · Added View Profile and Search in Conversation (TB review of the demo).
- 13/10/2026 · GE · Added message ticks, voice note playback and transcription, read and not read lists on announcements, resizable list; removed work details from the profile (TB review).
- 13/10/2026 · GE · Announcement cards back to the original design; read and not read lists moved into the card's modal. Page header slides away while reading a conversation (TB review).
- 14/10/2026 · GE · §7 jobs aligned with the worker as built: image variants are made at upload, `media-derive` re-derives on request.
- 14/10/2026 · TB · §10 rewritten to the template's content tiers and phone layout tables, from the demo as rebuilt to the screen conventions (FRONTEND_GUIDE §5, §7, §8): the Announcements subtitle and ⓘ text, the New Channel ⓘ text, the vault line, the Visibility row and "Posting as" left the screen; the channel name rule and the blank note became help terms; Average Read gained a help term; every community form uses the form helpers with errors on the field. §3 step 12 names the reads modal and defines Average Read; §6 gained the channel name rule, the fixed post policy and who posts.
- 15/10/2026 · AJ · Channels, Direct Messages and Announcements built in `app/` against the mock API (load older paging, voice notes, ticks, profile panel, read report); not wired yet.
- 15/10/2026 · AJ · Screens brought to §10 and the screen conventions: the ⓘ texts on Announcements and Who Can Post are a help term or gone; chat lists, threads and announcements are marked as content for gate 8; filter chips are 44 px on a phone; forms use the shared footer and mark fields on Submit.
- 15/10/2026 · AJ · Frontend foundation PR 2 (Shell): the third bottom bar place is Community (F16: Home, Workspace, Community, Self-Service, More), with its unread count; the rows that named it Chat follow. The bell and the chat panes are unchanged; the pane splitter now says its width to assistive technology, a read receipt is a named image, the info pane's headings are h3, a selected row and a recognition's quote keep AA contrast, for the a11y gate that crawls the app.
