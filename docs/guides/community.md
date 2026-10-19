# Staff Community · Engineering Guide

| | |
|---|---|
| Owner | GE |
| Milestone | M1 |
| Backend modules | `community`, `announcements` |
| Frontend paths | `app/src/features/community/` |
| Permission key(s) | `community` |
| Capabilities | `announcements.post` (post to the announcements channel and track who has read a post: the Announcements tab's routes) |
| Screens (PROGRESS.md rows) | #15 Channels, #16 Direct Messages, #17 Announcements; reads shared with #66 Knowledge Hub · Announcements (M10) |
| Status | Agreed |
| Last changed | 19/10/2026 |

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
| Staff Community · Channels (`channels`) | Staff app | Every employee; only channels they belong to | Channel list (#announcements pinned first), the open channel's thread, its composer | Read, post, react, vote, recognise, celebrate, attach files, record voice notes, create a channel, view or edit members |
| Staff Community · Direct Messages (`direct-messages`) | Staff app | Every employee; only their own conversations | Conversation list (All / Unread), the open conversation, the colleague's profile | Message one colleague, attach files, record voice notes, view their profile, search the conversation, mute |
| Staff Community · Announcements (`announcements`) | Staff app | People and the CEO | The configuration and tracking side: KPI strip, every announcement with read counts and its level | Publish or schedule an announcement as Normal, Important or Urgent, see who has and has not read or acknowledged it |
| #announcements channel | Staff app, inside Channels | Every employee, read only | Published announcements, newest last, Urgent ones red and Important ones amber | Read; acknowledge an Urgent one; only People and the CEO post |
| Knowledge Hub · Announcements (M10) | Staff app | Every employee | The same announcement records, as an archive | Read. No second copy of the data |
| Notification bell and web push | Staff app, phone | Recipients | New announcement, direct message, mention | Open the message |
| People · Employees (employee record) | Staff app | People | `date_of_birth`, `start_date`, avatar | Source of the birthday and anniversary posts. Nothing is entered in Community for them |
| Settings · Notifications (M6) | Staff app | Every employee | "Community messages" category | Choose in-app, push or email |
| Mobile bottom bar "Community" | Staff app, phone | Every employee | Opens Staff Community | |

## 3 · How the screens relate

1. **Posting.** A member posts in a channel → `community.message.posted` is emitted in the
   transaction → after commit the worker pushes it to the Socket.io room `channel:<id>` (everyone
   with the channel open sees it at once, no polling) and fans out notifications to the members who
   have not muted it: every post alerts each of their devices (TB, 19/10/2026), and the open app
   shows no banner for the conversation already on screen.
2. **Announcements.** People or the CEO publish from Announcements → one `announcement` row and one
   message in #announcements, in the same transaction → `announcement.published` → notification to
   the whole audience (all staff, or chosen departments). A scheduled announcement is stored with
   `publish_at` and released by a delayed job; until then it is visible only on the Announcements
   tab, marked Scheduled, and its poster (anyone with `announcements.post`) can **Edit** its
   headline, message, audience and date, or **Cancel Announcement**. A cancelled one leaves the
   list and is never posted. The release checks the announcement is still scheduled and due, so a
   job queued for a date since moved does nothing. Opening the message marks it read; the Announcements tab shows the
   counts and the list of who has not read it.
   **Levels** (TB, 19/10/2026): the poster chooses Normal, Important or Urgent. Normal alerts the
   audience once. Important is amber, alerts once, and 4 hours later reminds whoever has not opened
   it. Urgent is red and pulses, puts the urgent bar on every screen of everyone in the audience,
   and alerts them again every 30 minutes from 08:00 to 18:00 Lagos time (at most 8 times a day)
   until each person presses **Acknowledge**, on the card in #announcements or on the bar
   (`docs/guides/notifications.md` §6). Opening an urgent announcement does not count as read; its
   Acknowledge does.
3. **Celebrations.** The `celebrations` scheduler runs at 05:00 Africa/Lagos, reads employees whose
   `date_of_birth` (day and month) or `start_date` anniversary is today, and posts one celebration
   card each to #general, as the system. The card uses the employee's avatar, or their initials when
   there is none, and a message rotated from a fixed list. Colleagues press Celebrate on it.
4. **Recognition.** From the ＋ beside the composer, in any channel → Recognise a Colleague → pick a
   person, say what they did (optional; a note is written if left blank) → a recognition card in
   **#general**, whichever channel it was started from, so everyone sees it (MILESTONES A19; GE,
   17/10/2026). Manager to subordinate, peer to peer and upward are all allowed. No rewards, no
   voting, no employee of the month (Cynthia).
5. **Channels are created** from New Channel: name, purpose, members (whole departments and/or
   individuals), and **who can post, decided at creation** (every member, or admins only). The
   creator is the channel's first admin. Channels are internal: there is no public or join link.
6. **Members** are reached from the channel's ⋮ menu (View Members, Edit Members for admins), never
   from a button on the page. In Edit Members each person's row carries **Make Admin** or
   **Remove Admin** beside Remove; a channel always keeps at least one admin, so the last one's
   Remove Admin is refused.
7. **Direct messages** start from New Message → employee picker → the conversation appears in the
   list once the first message is sent. The picker offers the caller too: a conversation with
   oneself keeps notes, drafts and files (GE, 17/10/2026). As on WhatsApp it is named **You** in the
   list and the header, "Message yourself" under it, and its profile is the caller's own. It has
   one member and shows no ticks or online dot.
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
11. **Voice notes** are recorded from the mic beside Send, in channels and in direct messages alike
    (the M1 definition of done asks for a voice note in a department channel; GE, 17/10/2026). They
    play inline with a progress waveform. **Transcribe** under a voice note asks the
    server for a transcript, shows "Transcribing…" and then the text, which can be hidden again.
    The transcript is stored once per voice note, so the second person to ask gets it at once.
12. **Announcement read tracking** (Announcements tab): each card shows its title, an "N of 25 read"
    pill (or Scheduled), the body and who posted it. Clicking a card opens **Announcement Reads**
    (**Scheduled Announcement** before it goes out, with **Edit** and **Cancel Announcement**): the headline, the posted line, the body, "Read
    by N of 25" with its bar, and under that two lists, **Not Read** (with a **Remind Them** button
    that notifies only those people) and **Read**. The lists live in the modal only, never on the
    card. **Average Read** on the tab is the mean, across published announcements, of the share of
    the audience who have opened each one. For an Urgent announcement, read means acknowledged: the
    pill reads "N of 25 acknowledged", and the lists are **Not Acknowledged** (with Remind Them) and
    **Acknowledged**, each person with the time they pressed it. Each card shows its level: a red
    edge for Urgent, amber for Important.
13. **Resizable list.** On desktop the divider between the list and the conversation can be dragged
    (or moved with the arrow keys; double click resets). The width is remembered per browser. The
    list and the conversation each scroll on their own; the page never scrolls behind them.
14. **Edit, delete and close.** Each message has a menu (⋮ beside its time, shown on hover on
    desktop and always on a phone; none when there is nothing to do) with only what the caller may
    do: **Edit** on their own text message for 15 minutes (Edit Message, the text and Save
    Changes), marked "Edited" after; **Edit** on their own poll until its first vote (Edit Poll, the Start a Poll form filled in),
    and **Close Poll** after
    (by its author or a moderator), which stops voting and keeps the result; **Delete** on their own
    message, or on anyone's for a moderator (the channel's admins; People and the CEO in #general
    and #announcements). A deleted message stays in its place as "Message deleted". Deleting a
    recognition also takes it out of the counts Home and M2 read. An announcement's post is not
    deleted from the channel: it is managed from the Announcements tab.
15. **Who posts what.** Recognition is open to every member of staff, always (A19). A poll in
    #general is posted by People and the CEO only; in any other channel it follows Who Can Post. A
    celebration posted by hand (Celebrate) comes from the channel's admins, or People and the CEO in
    #general; the 05:00 posts (step 3) need nobody. The ＋ menu offers only what the caller may post.
16. **Pinning and muting.** #general and #announcements are pinned for everyone and cannot be
    unpinned. Anyone may also pin up to 3 channels or direct conversations **for themselves**
    (⋮ → Pin to Top, Unpin), as on WhatsApp: they sit under the two company channels, the most
    recently pinned first, with a pin on their row; a fourth is refused ("Unpin one first"). Mute
    Notifications (⋮ in a channel, the Mute switch on a conversation's profile) stops that
    conversation's notifications and push; its messages still arrive and count as unread, and its
    row shows a muted bell. Both are the caller's own and change nothing for anyone else.

## 4 · Data

Built in migrations `1000` (the tables) and `1110` (what the first version left out). Column names
are the contract's keys (gate 6).

| Table | Key columns | Notes |
|---|---|---|
| `community_channel` | `community_channel_id`, `channel_type` (`company` / `department` / `team` / `group` / `direct`), `name` (unique among live, named channels; `^[a-z0-9][a-z0-9-]{1,29}$`), `description`, `post_policy` (`everyone` / `admins` / `people_ceo`), `pinned`, `system_key` (`general` / `announcements`), `created_by` (null for the two system channels), `archived_at` | A direct conversation is a channel of type `direct` with its two members. #general and #announcements are made by the system the first time they are needed |
| `community_member` | `community_channel_id`, `user_id`, `member_role` (`admin` / `member`), `muted_until` (`infinity` when muted), `pinned_at` (the member's own pin, 1140), `last_read_at`, `last_delivered_at`, `joined_at` | **Membership is the authorisation boundary** for every read and write. The two pointers drive unread counts and the ticks. Everyone who opens Community joins #general and #announcements |
| `community_message` | `community_message_id`, `community_channel_id`, `sender_user_id` (null for system posts), `message_type` (`text` / `image` / `audio` / `video` / `file` / `system` / `poll` / `recognition` / `birthday` / `anniversary` / `announcement`), `body`, `document_id`, `metadata` jsonb, `transcript`, `sent_at`, `deleted_at` | `audio` is a voice note. `metadata` holds the kind's extras: a voice note's `duration_s`, a poll's `options`, a card's `subject_employee_id` and `years`. `transcript` is filled on first request |
| `community_reaction` | `community_message_id`, `user_id`, `reaction` | Celebrate (🎉 or 👏) and thumbs up (👍) are reactions, one per person, toggled |
| `community_poll_vote` | `community_message_id`, `user_id`, `option_index` | One vote per person; voting again moves it |
| `peer_recognition` | `from_employee_id`, `to_employee_id`, `message`, `community_message_id`, `note_written_by_system` | Kept separately so M2 performance and Home can count recognitions |
| `community_presence` | `user_id`, `last_seen_at` | Touched by the socket on connect, every 30 seconds and on disconnect; online means a touch in the last 90 seconds |
| `announcement` | `announcement_id`, `title`, `body`, `audience` jsonb (`{ kind: all \| departments, department_ids }`), `status` (`scheduled` / `published` / `cancelled`), `publish_at`, `published_at`, `published_by`, `community_message_id`, `audience_size`, `last_reminded_at`, and from `1145`: `urgency` (`normal`, `important`, `urgent`) | The record. #announcements and the M10 Knowledge Hub both read it |
| `announcement_read` | `announcement_id`, `user_id`, `read_at`, and from `1145`: `acknowledged_at` | One row per person in the audience, written when it is published; `read_at` is set when they open #announcements, and also by Acknowledge; `acknowledged_at` only by Acknowledge |

Files (images, voice notes, video, documents) are uploaded to the conversation first
(`POST /channels/:id/media`, purpose `attachment`) and stored by the vault against the channel
(`entity_type` `community_channel`, doc type `community_media`); a vault rule lets only the
channel's members read them, whoever they are. Audio and video are made playable by
`av-transcode`.

## 5 · API

All under `/api/v1/community`. Every list is paged at 25 (BACKEND_STRUCTURE §16). Contract:
`packages/contract/schemas/community.js` and `announcements.js`. A channel the caller is not a
member of answers 404, whatever their grants.

| Method and path | Contract | Permission · scope | Paged | Notes |
|---|---|---|---|---|
| `GET /channels` | `ChannelListQuery` → `ChannelPage` | `community` view · membership | yes | Pinned first, then latest activity. Filter `q` |
| `POST /channels` | `ChannelCreate` → `Channel` | `community` create | | Members by employee ids and/or department ids; `post_policy` `everyone` or `admins` |
| `GET /channels/:id` | → `Channel` | member | | |
| `GET /channels/:id/members` | `MemberListQuery` → `MemberPage` | member | yes | Admins first |
| `POST /channels/:id/members`, `DELETE /channels/:id/members/:user_id` | `MemberAdd` | channel admin | | Not on #general or #announcements |
| `PUT /channels/:id/members/:user_id/role` | `MemberRoleSet` → `Member` | channel admin | | `admin` or `member`; the last admin cannot step down. Not on #general or #announcements |
| `POST /channels/:id/mute`, `POST /channels/:id/read` | `MuteSet`, empty | member | | |
| `PUT /channels/:id/pin` | `PinSet` → 204 | member | | The caller's own pin, channels and direct conversations alike; at most 3 (409 `PIN_LIMIT`); not on #general or #announcements, which are pinned for everyone |
| `POST /channels/:id/delivered` | `DeliveredAck` | member | | The client acknowledges direct messages it received: the delivered tick |
| `GET /channels/:id/messages` | `MessageListQuery` → `MessagePage` | member | yes | Newest page first, each page oldest to newest; "Load Older" asks for the next page. `q` returns only the matches, and the screen steps between them |
| `POST /channels/:id/media` | multipart `file` → `DocumentRef` | member, `post_policy` | | Upload first, then post the message with its `document_id` |
| `POST /channels/:id/messages` | `MessageCreate` → `Message` | member, `post_policy` | | `text`, `image`/`audio`/`video`/`file` with `document_id` (`audio` with `duration_s`), `poll` with 2 to 4 `options`, `birthday`/`anniversary` with `subject_employee_id`. Idempotency-Key honoured |
| `POST /recognitions` | `RecognitionCreate` → `Message` | `community` create | | Always posted to #general (A19). `to_employee_id` cannot be the sender |
| `PUT /messages/:id` | `MessageEdit` → `Message` | author | | Text within 15 minutes; a poll's question and options before its first vote (409 after) |
| `DELETE /messages/:id` | → 204 | author or moderator | | Soft delete (`deleted_at`); a recognition's `peer_recognition` row goes too; not an announcement's post |
| `POST /messages/:id/close` | empty → `Message` | poll author or moderator | | Polls only; votes are refused after |
| `POST /messages/:id/reactions`, `POST /messages/:id/vote` | empty, `PollVote` → `Message` | member | | |
| `POST /messages/:id/transcript` | → `Transcript` | member | | Voice notes only, through `services/ai/transcription.js`; stored on the message |
| `GET /direct` | `ConversationListQuery` → `ConversationPage` | own | yes | Filters `q`, `unread` |
| `POST /direct` | `{ employee_id }` → `Conversation` | `community` create | | Returns the existing conversation if there is one (one per pair, under a lock) |
| `GET /people` | `ColleagueListQuery` → `ColleaguePage` | `community` view | yes | Colleagues with a login, for the people pickers (New Message, Recognise, Celebrate, members): public work fields only, open to every member of staff. The caller is left out unless `with_self` is set: New Message offers a conversation with oneself; Recognise, Celebrate and the member pickers never offer the caller. The staff register needs People |
| `GET /people/:id/card` | → `ProfileCard` | `community` view | | The profile panel: public work fields only (work email, phone, worksite), presence, what this conversation shares |
| `GET /announcements` | `AnnouncementListQuery` → `AnnouncementPage` | `announcements.post` capability | yes | The tracking tab |
| `GET /announcements/stats` | → `AnnouncementStats` | capability | | The tab's figures, counted on the server over every announcement: published, scheduled, average read, this month, and the audience (active staff an all-staff announcement reaches now) |
| `POST /announcements` | `AnnouncementCreate` → `Announcement` | `announcements.post` capability | | `audience` all staff or departments; `urgency` normal (the default), important or urgent; `publish_at` optional and in the future (day-first on screen, ISO on the wire) |
| `PUT /announcements/:id` | `AnnouncementUpdate` → `Announcement` | capability | | Scheduled only (409 once posted or cancelled): headline, message, audience, level, `publish_at` in the future |
| `POST /announcements/:id/acknowledge` | empty → 204 | `community` view, in its audience | | Urgent only (422 `NOT_URGENT`); 404 for anyone outside its audience. Sets `acknowledged_at` and `read_at` once (pressing again changes nothing); emits `announcement.acknowledged` |
| `POST /announcements/:id/cancel` | empty → `Announcement` | capability | | Scheduled only; it is never posted |
| `GET /announcements/:id/reads` | `AnnouncementReadQuery` → `AnnouncementReadPage` | capability | yes | Filter `read` / `not_read`; for an Urgent announcement read means acknowledged, and each row carries `acknowledged_at` |
| `POST /announcements/:id/remind` | → `RemindResult` | capability | | Notifies only those who have not read it (not acknowledged, for Urgent); once per day per announcement (429 after) |

Posting to #announcements and the Announcements routes are gated by the `announcements.post`
capability (BACKEND_STRUCTURE §11, `capability` / `role_capability`), held by People and the CEO.
An announcement for chosen departments notifies and tracks those departments; the post itself is
in #announcements, which every member of staff reads.

## 6 · Rules and calculations

- A user reads and writes only in channels they are a member of. Removed members lose the channel's
  history.
- A channel has at least one admin. Admins add and remove members and make or unmake admins; the
  creator is the first. An admin cannot remove themselves, and the last admin cannot step down.
- A scheduled announcement can be edited or cancelled until it goes out, by anyone holding
  `announcements.post`; once posted it is never edited, because people may have read it.
- An announcement's level is Normal unless its poster chooses Important or Urgent; anyone holding
  `announcements.post` (People and the CEO) may choose any level (TB, 19/10/2026). It cannot change
  once posted.
- An Important announcement reminds whoever has not opened it once, 4 hours after it went out, as
  the system (Remind Them stays available to the poster). An Urgent one needs Acknowledge from each
  person in its audience. The poster, who is never told of their own post, counts as having read it
  (and acknowledged it, when Urgent) from the moment it goes out.
- `post_policy` is chosen when a channel is created and cannot be changed afterwards. #announcements
  is `people_ceo`.
- The author of a message, recognition, poll, channel or announcement is always the signed-in user.
  Nobody posts on another person's behalf, so the forms do not ask or say who is posting.
- A channel name is 2 to 30 characters of lower case letters, numbers and hyphens, starting with a
  letter or number, and unique.
- #announcements and #general are pinned for everyone, cannot be unpinned, left or deleted.
- Nothing is posted straight into #announcements: an announcement is published from the
  Announcements tab, where it gets its audience and read tracking. The channel has no composer.
- A person pins at most 3 other conversations, channels and direct ones together, for themselves.
- A recognition note left blank is written by the system ("Thank you for the great work this week").
  A recognition to oneself is refused.
- Celebrations post at 05:00 Africa/Lagos, every day of the week, one card per person per occasion.
  An employee with no `date_of_birth` gets no birthday post. Only the day and month are ever shown.
- A poll has 2 to 4 options and one vote per person; voting again moves the vote. A closed poll takes
  no votes.
- A moderator of a channel is one of its admins; in #general and #announcements, which have none,
  People and the CEO (`announcements.post`). In a direct conversation only the author edits or
  deletes.
- Text is editable by its author for 15 minutes after it was sent; a poll until its first vote.
  Recognitions, celebrations, files and voice notes are not edited: they are deleted and posted
  again.
- Read counts on announcements are visible to the poster and to holders of `announcements.post` only.
- Calls are **not** part of this module (no call button, no WebRTC): they do not work on the donor
  either (TB, 12 October).
- Copy a person reads: Title Case chrome, no em dashes, day-first dates.

## 7 · Events, jobs and notifications

| Event / job | When | Does |
|---|---|---|
| `community.message.posted` | After a message commits | Realtime push to `channel:<id>`; notifications to non-muted members. A channel post's notice is titled with the channel (`#general`) and reads "Name: first line"; every post and every direct message alerts each device, replacing the one before from the same conversation, which counts them ("#general · 3 new"; TB, 19/10/2026; `docs/guides/notifications.md` §6) |
| `community.recognition.posted` | After a recognition commits | As above; counted for Home and M2 |
| `announcement.published` | On publish, or when a scheduled one is released | Message in #announcements; notification and push to the audience at its level (urgent ones need Acknowledge); an Important one queues `announcement-remind` for 4 hours later |
| `announcement-remind` (delayed job) | 4 hours after an Important announcement went out | Reminds, as the system, whoever has not opened it (`announcement.reminded`) |
| `announcement.acknowledged` | Acknowledge on the card or, through `notification.acknowledged`, on the urgent bar | Records it on the reads; the person's notices of it close on every device |
| `announcement-publish` (delayed job) | At `publish_at` | Releases a scheduled announcement (README §5.15) if it is still scheduled and due |
| `announcement.updated` | A scheduled announcement edited | A new delayed release at its new `publish_at`; audit |
| `announcement.cancelled` | A scheduled announcement cancelled | Audit; nothing is posted |
| `community.channel.members_changed` | Members added or removed, or an admin made or unmade | Audit; the channel list refreshes for those affected |
| `celebrations` (scheduler + handler) | 05:00 Africa/Lagos daily | Birthday and anniversary cards in #general |
| `av-transcode`, `media-scan` | After an upload | Voice note to Opus, video to MP4; a file from outside scanned. Image variants are made at upload; `media-derive` makes a file's variants again on request |

## 8 · Permissions and visibility by role

| Role | Sees | Can do |
|---|---|---|
| Employee | Channels they belong to, their own DMs, #announcements | Post where `post_policy` allows, react, vote, recognise, create channels, start DMs |
| Channel admin (the creator, and anyone an admin makes admin) | As employee | Add and remove members, make or unmake admins, delete any message and close any poll in the channel, post polls and celebrations |
| People (Operations and HR) | As employee, plus the Announcements tab | Moderate #general and #announcements (delete, close polls, post polls and celebrations in #general), publish and schedule announcements, edit or cancel them until they go out, see read receipts, post in #announcements |
| CEO | As People | As People |

Nobody, including People and the CEO, can read a direct message they are not part of.

## 9 · AI and search

- **AI reads** (`community.ai.js`): `announcements.list` (published announcements, any staff);
  `channels.list` (the caller's channels). **No read over message bodies or direct messages.**
  Private conversation is not material for the assistant. Paged at 25.
- **AI routes**: "post an announcement" → Announcements · New Announcement; "message someone" →
  Direct Messages · New Message, prefilled with the person.
- **Search** (`community.search.js`, ⌘K): published announcements by headline and text. Words
  people use: announcement, notice, memo. Channels and conversations are not offered: membership
  decides who may see one, and a search provider is gated by the module grant alone
  (`shared/route-map.js` marks those types `search:none` with that reason).

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
| Staff Community · Channels (`channels`) | "6 channels · 25 staff" (desktop subtitle); New Channel; Search Channels; Pinned and Channels, each row the channel name (a lock when read only), its last message, time and unread count; the open channel: name, member count, a Read Only pill, the ⋮ menu (View Members, Edit Members, Channel Details, Search in Channel, Pin to Top or Unpin, Mute Notifications); a pin and a muted bell on rows, the messages and the celebration, recognition and poll cards (Celebrate, votes), each message's menu (Edit, Close Poll, Delete, only those the caller may use), an "Edited" mark and "Message deleted" in place; the composer with ＋ (Recognise a Colleague, Celebrate and Start a Poll where the caller may, Attach a File), record a voice note and Send; Edit Message (Message; Cancel, Save Changes; "Too late to edit" on the field when the 15 minutes have passed) and Edit Poll (the poll form; Save Changes); Delete asks once (Keep It, Delete Message); Close Poll asks once (Keep Open, Close Poll) and the poll shows a Closed pill; voice notes (Play, Transcribe, Hide Transcript); where the user may not post (an admins-only channel), "Only admins post here" in place of the composer; #announcements has none. New Channel: Channel Name, Purpose (Optional), Departments (Optional), People (Optional, with the count selected), Who Can Post (Every Member, Admins Only); Cancel, Create Channel. Channel Members and Edit Members (Make Admin or Remove Admin, Remove, Add People, Close); Channel Details (Channel, Members, Who Can Post). Recognise a Colleague (Colleague, Note Optional; Post Recognition; the toast "Posted to #general"); Celebrate (Colleague, Occasion: Birthday or Work Anniversary; Post Celebration); Start a Poll (Question, Option 1 to 4, the last two Optional; Post Poll); Attach a File (the files, then the upload percentage). Field errors of at most 4 words on the field: "Not a valid name", "Choose a colleague", "Add a question", "Add an option" | Help term on Channel Name: "Lower case letters, numbers and hyphens, 2 to 30 characters. Two channels cannot share a name." Help term on Note in Recognise a Colleague: "Leave it blank and a thank you note is written for you." | Who can post being fixed when the channel is created, that only members read a channel, that channels are internal with no join link: §3 step 5, §6 (the New Channel ⓘ text is removed, and so is the Visibility row of Channel Details). Files going to the vault: §4 (the "Files are stored in the vault" line is removed). Who posts: §6 |
| Staff Community · Direct Messages (`direct-messages`) | "N unread" or "All caught up" (desktop subtitle); New Message; Search People; All and Unread; each conversation: avatar with the online dot, name, last message ("You:" when it was the user's), time, unread count; the open conversation: name, Online or Last Seen, department, search, ⋮ (View Profile, Search in Conversation, Pin to Top or Unpin, Mute Notifications), a pin and a muted bell on rows, the messages with their ticks, voice notes (Play, Transcribe, Hide Transcript), the composer (Attach: Photo or Video, Document; record a voice note; Send). Profile: avatar, name, title, status pill, Message, View in People; Contact (work email, phone, worksite, local time); Shared in Conversation; Channels in Common; Mute Notifications; Search in Conversation. New Message: the person picker | None | What one tick, two grey and two blue mean: §3 step 10. Transcripts stored once per voice note: §3 step 11. The profile reading the employee record and showing no work details: §3 step 8. Search covering only the caller's own conversation: §3 step 9 |
| Staff Community · Announcements (`announcements`) | New Announcement; Published, Scheduled, Average Read, Audience, This Month (desktop); a card per announcement: headline, a Scheduled or "N of 25 read" pill, the body, "Posted" or "Goes out" with the date and author. A card opens Announcement Reads (or Scheduled Announcement, with Edit and Cancel Announcement; Edit opens Edit Announcement, the New Announcement form filled in, with Save Changes; Cancel Announcement asks once, Keep It or Cancel Announcement): headline, posted line, body, "Read by N of 25" with its bar, Not Read with Remind Them, Read; Close. An Urgent card has a red edge and reads "N of 25 acknowledged", and its modal lists Not Acknowledged (with Remind Them) and Acknowledged, each with its time; an Important card has an amber edge. New Announcement: Headline, Message, Level (Normal, Important, Urgent), Audience (All Staff or Departments, then the department chips), When (Now or Schedule, then Publish Date, DD/MM/YYYY); Cancel, Publish Announcement (Schedule Announcement when scheduled) | Help term on Average Read: "Across published announcements, the share of the audience who have opened each one." Help term on Level: "Urgent stays red on everyone's screens and repeats every 30 minutes of the working day until each person acknowledges. Important reminds the unread after 4 hours." | Who may post, #announcements being pinned and read only, the notification on publish, scheduling, read counts visible to the poster only: §3 step 2, §6, §7, §8 (the page subtitle "Posted by People and the CEO · staff read them in #announcements" and its ⓘ text are removed). "Not yet visible to staff" on the scheduled pill: §3 step 2. "Posting as" in the form: §6 |
| #announcements channel | As Channels: the published announcements as cards (author, date, headline, body), newest last; a lock on its row and the Read Only pill; no composer at all, for anyone (announcements are published from the Announcements tab). An Urgent card is red and pulses slowly (steady when motion is off) with Acknowledge until pressed, then "Acknowledged" and its time; an Important card has an amber edge. A red dot on Community while an urgent announcement waits on the person | None | The `announcements.post` capability: §5, §8. The repeat schedule: `docs/guides/notifications.md` §6 |
| Knowledge Hub · Announcements (M10) | Owned by Knowledge Hub (M10): the same announcement records, read only | The M10 guide | The M10 guide. That it reads the same records, no second copy: §2 |
| Notification bell and web push | Owned by the frontend foundation (FRONTEND_GUIDE §9.6): the sender and first line; a tap opens the conversation | None | Fan-out, muting and who is notified: §3 step 1, §7 |
| People · Employees (employee record) | Owned by People: that module's guide | That module's guide | How birthdays and anniversaries become posts: §3 step 3, §6 |
| Settings · Notifications (M6) | Owned by Settings (M6): the Community Messages category with in-app, push and email | The M6 guide | The M6 guide |
| Mobile bottom bar "Community" | The Community icon and word; it opens Staff Community | None | FRONTEND_GUIDE §7 |

### 10.2 Phone layout

| Screen | First on a phone | Left off a phone | Main action | Navigation |
|---|---|---|---|---|
| Staff Community · Channels (`channels`) | New Channel beside the title; the search box; Pinned and Channels as full-width rows (channel name, last message, time, unread count) | The subtitle; the open channel beside the list (a channel opens full screen instead); the resizable divider | Tap a channel: it opens full screen over the top bar, tabs and bottom bar, with Back; the composer is locked at the bottom (＋, the voice note button and Send, 44 px) and only the messages scroll; ＋ opens Recognise, Celebrate, Poll and Attach as a menu, each form as a bottom sheet | Bottom bar Chat; the three tabs along the top; inside a channel the menu button opens the channel list as a side drawer; Back returns to the list |
| Staff Community · Direct Messages (`direct-messages`) | New Message beside the title; the search box; All and Unread as a full-width two-part switch (44 px); the conversation rows | The subtitle; the profile column (View Profile opens it as a sheet); the resizable divider | Tap a conversation: it opens full screen with Back; Attach, the voice note button and Send at the bottom, 44 px | As Channels |
| Staff Community · Announcements (`announcements`) | New Announcement under the title; four stat cards two to a row (Published, Scheduled, Average Read, Audience; Average Read's help opens as a sheet); the announcement cards one to a row | This Month | New Announcement opens the form as a bottom sheet, the primary full width; a card opens its reads as a sheet | Bottom bar Chat; the three tabs along the top |
| #announcements channel | As Channels | As Channels | Staff read only; Acknowledge on an Urgent card, full width at 44 px | As Channels |
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
- **Urgent announcement acknowledged on the bar**: the card in #announcements turns to
  "Acknowledged" too, and the other way round; both reach the same reads row.
- **Urgent announcement for chosen departments**: only their people get the bar and the repeats;
  everyone else sees a red card in #announcements without Acknowledge.
- **The build account posts**: it is never told of its own announcement; test the alerts from a
  second account.

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
- Answered 17/10/2026 (GE): text edits for 15 minutes; delete by the author or a moderator (§6).
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
- 16/10/2026 · TB · Frontend foundation PR 3 (Build kit): Chat's two panes and its divider are now `SplitPanes` from `@mycity/ui`, shared with the Mailbox, and the celebration card, the voice note's bars and a poll's share bars are `Confetti`, `Waveform` and `ShareBar`, so no screen writes an inline style. The chat bubble's tail now uses the same two corners as the assistant's (`bubble-them`, `bubble-me`). §10 is unchanged: the same parts, drawn by shared components.
- 17/10/2026 · GE · Decisions after comparing the demo with the built screens: a recognition always posts to #general (A19), from whichever channel it was started; voice notes are recorded in channels as well as direct messages; search in a conversation runs on the server and the screen steps between the matches it highlights (§3 step 9, unchanged); New Announcement keeps its Audience (all staff or departments).
- 17/10/2026 · GE · Backend built: §4 and §5 now describe the tables (migrations 1000 and 1110) and the routes as built; contract keys follow the columns (`community_channel_id`, `community_message_id`, `message_type`, `audio` for a voice note). Files are uploaded to the conversation first and readable by its members only; presence is a socket heartbeat; #general and #announcements are made on first use; ⌘K finds published announcements only (§9).
- 17/10/2026 · GE · Status Built. The stubs left empty (`community.media`, `.links`, `.export`; `announcements.ai`, `.search`) were deleted: uploads live in `community.service`, announcements are read and found through `community.ai.js` and `community.search.js`. The certified channel export stays an open question (§13).
- 17/10/2026 · GE · A scheduled announcement can be edited or cancelled until it goes out (§3 step 2, §5, §6); the release now checks it is still scheduled and due. Channel admins are chosen in Edit Members with Make Admin and Remove Admin; a channel keeps at least one admin (§3 step 6, §5, §6, §8).
- 17/10/2026 · GE · Messages can be edited, deleted and polls closed (§3 step 14, §5, §6); polls in #general and hand-posted celebrations are for moderators, recognition stays open to all (§3 step 15, A19). The people pickers leave the caller out.
- 17/10/2026 · GE · Personal pinning, up to 3 (§3 step 16, §4, §5, §6); a muted bell on muted rows; messages and the composer keep their line breaks.

- 17/10/2026 · GE · #announcements has no composer and a lock on its row; announcements come only from the tab. The tab's figures come from the server (`GET /announcements/stats`): Audience is the active staff an all-staff announcement reaches, not the largest past audience on the first page. Polls sit on the sender's side at up to 560 px; Ctrl+Enter starts a new line.
- 17/10/2026 · GE · A hand-posted work anniversary carries its years from the start date, as the 05:00 ones do ("Another year" with no start date). The phone's Channels drawer closes when a channel is picked.
- 17/10/2026 · TB · Header gains the Capabilities row every guide now carries (README §5.2): `announcements.post`, as built and seeded by `0449`.
- 19/10/2026 · TB · §7: how posts and direct messages reach a phone (one alert per channel, then quiet updates; every direct message alerts, one notification per conversation) and the channel's name in a post's notice (`channel_name` in the event's payload), from TB's notification decisions.
- 19/10/2026 · AJ · `PersonRef` carries `photo_url` (`shared/db/person.js`, which replaces `community.repo.js`'s own `PERSON`): members, direct messages and their profile panel, posts, celebration and recognition cards, the colleague picker and announcement readers show each face (the app's `usePhotos`), initials when there is none. GE to review.
- 19/10/2026 · TB · From TB's answers (`docs/handoff/notifications-everywhere.md` §2): announcements get
  a level (Normal, Important, Urgent; §3 step 2, §6); Urgent needs Acknowledge, shows red with the
  urgent bar and repeats until acknowledged; Important reminds the unread after 4 hours; every
  channel post alerts each device (§3 step 1, §7); the poster counts as having read their own.
  §2 to §7, §10 and §11 updated; Status In progress until built.
