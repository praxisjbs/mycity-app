# Staff Community · Engineering Guide

| | |
|---|---|
| Owner | GE |
| Milestone | M1 |
| Backend modules | `community`, `announcements` |
| Frontend paths | To be set when the frontend foundation lands (AJ). |
| Permission key(s) | `community` |
| Screens (PROGRESS.md rows) | #15 Channels, #16 Direct Messages, #17 Announcements; reads shared with #66 Knowledge Hub · Announcements (M10) |
| Status | Agreed |
| Last changed | 13/10/2026 |

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
| Mobile bottom bar "Chat" | Staff app, phone | Every employee | Opens Staff Community | |

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
    pill (or Scheduled), the body and who posted it. Clicking a card opens it: the posted line, the
    body, "Read by N of 25" with its bar, and under that two lists, **Not read** (with a **Remind
    Them** button that notifies only those people) and **Read**. The lists live in the modal only,
    never on the card.
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
- `post_policy` is chosen when a channel is created. #announcements is `people_ceo`.
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
| `media-derive`, `av-transcode`, `media-scan` | After an upload | Image variants, voice note to Opus, scan |

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

## 10 · Mobile

- Channels and Direct Messages open on the list. Tapping a channel or conversation opens it **full
  screen**, covering the top bar, tabs and bottom bar, with a Back button to the list.
- Inside a channel, a menu button opens a **side drawer** with the channel list to switch quickly.
- The composer is **locked at the bottom**; the page itself does not scroll, only the messages.
- Announcements tab: four KPI cards on mobile (**This Month** is desktop only).
- Modals open as bottom sheets.

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
