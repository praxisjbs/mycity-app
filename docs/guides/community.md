# Staff Community · Engineering Guide

| | |
|---|---|
| Owner | GE |
| Milestone | M1 |
| Backend modules | `community`, `announcements` |
| Frontend paths | `app/src/features/community/` |
| Permission key(s) | `community` |
| Capabilities | `announcements.post` (post to the announcements channel and track who has read a post: the Announcements tab's routes) |
| Screens (PROGRESS.md rows) | #15 Channels, #16 Direct Messages, #17 Announcements (#66 Knowledge Hub · Announcements was dropped, 29/10/2026) |
| Status | Built |
| Last changed | 26/10/2026 |

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
| Staff Community · Channels (`channels`) | Staff app | Every employee; only channels they belong to | Channel list (#announcements pinned first), the open channel's thread with its photos, albums, videos, files and link cards in place, its composer | Read, post, react, vote, recognise, celebrate and send wishes on a birthday or anniversary card, send photos and files with a caption, open them full screen, download or share them, post links with their card, record voice notes, create a channel, view or edit members |
| Staff Community · Direct Messages (`direct-messages`) | Staff app | Every employee; only their own conversations | Conversation list (All / Unread), the open conversation with its media and link cards, the colleague's profile | Message one colleague, send photos and files with a caption, open, download or share them, post links with their card, record voice notes, view their profile and the files shared, search the conversation, mute |
| File viewer (full screen, over either tab) | Staff app | Members of the conversation | One photo, video or PDF at a time, with the others on screen beside it | Zoom, step to the next or previous, Download, Share (phone), Forward |
| Forward To (sheet, over either tab and over Mailbox) | Staff app | Members of the conversation; a mailbox's owner for its attachments | The channels they may post in, their conversations and every colleague, searchable; the chats picked | Pick up to 5 chats, Forward |
| Staff Community · Announcements (`announcements`) | Staff app | People and the CEO | The configuration and tracking side: KPI strip, every announcement with read counts and its level | Publish or schedule an announcement as Normal, Important or Urgent, see who has and has not read or acknowledged it |
| #announcements channel | Staff app, inside Channels | Every employee, read only | Published announcements, newest last, Urgent ones red and Important ones amber | Read; acknowledge an Urgent one; only People and the CEO post |
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
   counts and the list of who has not read it. A published one can be taken down with **Archive
   Announcement** (TB, 19/10/2026): its message in #announcements reads "Message deleted", it
   leaves the tab and its figures, and the notices nobody has opened (acknowledged, when urgent)
   are withdrawn. Its reads stay on record.
   **Levels** (TB, 19/10/2026): the poster chooses Normal, Important or Urgent. Normal alerts the
   audience once. Important is amber, alerts once, and 4 hours later reminds whoever has not opened
   it. Urgent is red and pulses, puts the urgent bar on every screen of everyone in the audience,
   and alerts them again every 30 minutes from 08:00 to 18:00 Lagos time (at most 8 times a day)
   until each person presses **Acknowledge**, on the card in #announcements or on the bar
   (`docs/guides/notifications.md` §6). Opening an urgent announcement does not count as read; its
   Acknowledge does.
3. **Celebrations.** The `celebrations` scheduler runs at 08:00 Africa/Lagos, reads employees whose
   `date_of_birth` (day and month; without one, `birth_day` and `birth_month` from migration
   `1180`, which the staff loader fills from a DOB the sheet gives with no year) or `start_date`
   anniversary is today, and posts one celebration
   card each to #general, as the system, with a line rotated from a fixed list. The two cards are
   Cynthia's picks from `docs/MyCity-ERP-Documents/celebration-card-samples.html` (Birthday 1 and
   Anniversary 1, relayed by TB, 22/10/2026). A **birthday** is a plain card: the person's photo
   (their initials when there is none) in a yellow ring with a cake on it, "Happy Birthday, Ada",
   their name and title, and the line. A **work anniversary** is City Green: the years in a gold
   laurel, the person's photo, name, title and department, "Three years at MyCity today." with the
   line, and the day they joined (kept on the card when it is posted). Colleagues press
   **Celebrate** (pressed again, it is taken back) and **Send Wishes**: a short wish that stays under
   the card, never in the channel's stream, so a popular birthday does not fill #general. The card
   shows who celebrated, the latest two wishes and **View All Wishes** when there are more. Each
   wish tells the person it is for. A wish is not edited; its author or a moderator deletes it.
   **Confetti** bursts from the card the first time each person sees it on a device (remembered
   there), and again from Celebrate each time someone celebrates: paper for a birthday, stars for
   an anniversary. Nothing moves when the device asks for less motion.
4. **Recognition.** From the ＋ beside the composer, in any channel → Recognise a Colleague → pick a
   person, say what they did (optional; a note is written if left blank) → a recognition card in
   **#general**, whichever channel it was started from, so everyone sees it (MILESTONES A19; GE,
   17/10/2026). Manager to subordinate, peer to peer and upward are all allowed. No rewards, no
   voting, no employee of the month (Cynthia).
5. **Channels are created** from New Channel: name, purpose, members (whole departments and/or
   individuals), and **who can post, decided at creation** (every member, or admins only). The
   creator is the channel's first admin. Channels are internal: there is no public or join link.
   Its admins rename it and change its purpose from Channel Details (**Edit Channel**; TB,
   19/10/2026); the purpose shows beside the member count in the channel's header on desktop.
   #general and #announcements keep their names.
6. **Members** are reached from the channel's ⋮ menu (View Members, Edit Members for admins), never
   from a button on the page. In Edit Members each person's row carries **Make Admin** or
   **Remove Admin** beside Remove; a channel always keeps at least one admin, so the last one's
   Remove Admin is refused.
7. **Direct messages** start from New Message → employee picker → the conversation appears in the
   list once the first message is sent: one started and left empty is in nobody's list, and Forward
   To offers its colleague as a person (TB, 21/10/2026). The picker offers the caller too: a conversation with
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
    opened the conversation (read). Channels show no ticks. The other person's app says delivered
    when a new message reaches it (the conversation open, or the list), never because a receipt
    arrived; the server tells anyone only when a mark covered a message from the other person that
    it did not cover before, so a mark that changes nothing is silent and no two screens can answer
    each other's receipts in a loop (TB, 21/10/2026).
11. **Voice notes** are recorded from the mic beside Send, in channels and in direct messages alike
    (the M1 definition of done asks for a voice note in a department channel; GE, 17/10/2026). They
    play inline. Their bars are the note's own loudness, measured by the worker when it makes the
    Opus copy (`document.waveform`, migration `1190`; a steady shape until then), and they fill
    from the audio's real position, starting with its first sound. The note is fetched as its
    bubble is drawn, so Play starts at once (TB's review, 19/10/2026). **Transcribe** under a voice note asks the
    server for a transcript, shows "Transcribing…" and then the text, which can be hidden again.
    The transcript is stored once per voice note, so the second person to ask gets it at once. It
    comes from Groq, then Gemini (`docs/guides/integrations.md` §1.2, §6.14). While the sender
    records, the browser writes captions where it can (Chrome, Edge, Safari: `startCaptions` in
    `@mycity/ui`), sent with the note as `captions` and kept in its metadata; when neither service
    answers, Transcribe shows those captions marked Draft, stores nothing, and the next Transcribe asks
    the services again. A failed transcription says so in a toast.
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
    (or moved with the arrow keys). The width is remembered per browser. The
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
    #general; the 08:00 posts (step 3) need nobody. The ＋ menu offers only what the caller may post.
16. **Pinning and muting.** #general and #announcements are pinned for everyone and cannot be
    unpinned. Anyone may also pin up to 3 channels or direct conversations **for themselves**
    (⋮ → Pin to Top, Unpin), as on WhatsApp: they sit under the two company channels, the most
    recently pinned first, with a pin on their row; a fourth is refused ("Unpin one first"). Mute
    Notifications (⋮ in a channel, the Mute switch on a conversation's profile) stops that
    conversation's notifications and push; its messages still arrive and count as unread, and its
    row shows a muted bell. Both are the caller's own and change nothing for anyone else.
    **A message is pinned for everyone** for 24 hours, 7 days or 30 days (TB, 19/10/2026), as on
    WhatsApp: the message's menu → Pin Message, then the period. Channel moderators pin in a
    channel (its admins; People and the CEO in #general and #announcements), either person in a
    direct conversation. At most 3 are pinned at once; a fourth takes the place of the oldest. A
    bar above the messages shows the newest; a tap steps to the next and brings it into view, and
    its ✕ (or the message's Unpin) takes it down. It unpins itself when its time is up
    (`pinned_until`, migration `1195`; nothing runs).
17. **Photos, videos and files** (TB, 19/10/2026: shown in place as on WhatsApp, sent several at
    once with a caption, opened full screen). ＋ → Attach a File in a channel, or Attach → Photo or
    Video and Document in a direct message, opens **Send Files**: the device's picker opens at once
    where the browser allows it (else the person taps the drop zone), up to 10 files upload with a
    percentage each, and each one that arrives becomes a tile (a photo as its picture, anything
    else as its glyph and name) with Remove; Add More picks more. **Caption** (optional) goes with
    the first file. **Send Files** posts each file as its own message, in the order picked, all
    carrying one album key. In the conversation:
    - a **photo** shows in place at its own shape, a very tall or very wide one cropped to fit;
    - **four or more** photos or videos sent together show as one **album**, a 2 by 2 grid whose
      fourth tile carries "+N" when there are more; fewer than four show one by one;
    - a **video** shows its first frame (the `poster` `av-transcode` makes) with a play mark and
      its length;
    - a **PDF** shows its first page (drawn by the worker), its name and "N pages · PDF · size";
      any other file (Word, Excel, PowerPoint, CSV, text) shows its name, type and size, and
      downloads when tapped;
    - a **caption** shows under its media, its links clickable;
    - pictures are fetched with the session as they come into view, never from outside.

    Tapping a photo, video or PDF opens the **file viewer**, full screen: a photo zooms (pinch or
    double tap on a phone, Zoom In and Zoom Out on desktop), a video plays, and a PDF's pages are
    drawn in the app by PDF.js, on a phone as on desktop, with the page number and zoom. The
    viewer steps through the photos, videos and PDFs of the messages on screen (the arrows or the
    keyboard on desktop, a swipe on a phone). **Download** saves the file; on a phone **Share**
    opens the phone's share sheet (Save Image to Photos on an iPhone, or another app). Close or
    Esc returns to the conversation. The profile's Shared in Conversation opens the same viewer.
18. **Links** (TB, 19/10/2026). Every link in a message, a caption or an announcement is
    clickable and opens in a new tab. While a person types, the first link in the composer gets
    its **card** above the message box: the page's picture, the site, the title and the
    description; **Remove Preview** sends the message without it. Our server fetches the card,
    never the person's browser (`POST /community/link-previews`): it reads the page's Open Graph
    and Twitter tags (else its title and description), copies its picture into the vault
    (resized, metadata stripped), and keeps the card for a week, so the next person to post the
    link gets it at once and no phone ever contacts the site. A page with no title, one that
    cannot be reached, or one on a private address shows no card. A message sent before its card
    arrived gets it from the worker a moment after it is posted, in place. Only a text message
    carries a card (the first link's); editing the text within its 15 minutes follows the new
    first link. A caption's links are clickable without a card.
19. **Forward** (TB, 19/10/2026: as on WhatsApp, marked Forwarded, up to 5 chats, several
    messages at once, mail attachments too). A message's menu has **Forward** and **Select**;
    Select, or a long press on a phone, starts picking: each tap ticks or unticks a message, and
    the bar in place of the composer shows "N Selected" with Cancel and Forward, and Copy when
    every message picked is a text (a long press no longer selects words on a phone, so Copy
    puts the texts on the clipboard). An album is forwarded whole. Forward opens **Forward To**: one search over the channels the person may
    post in, their conversations and every colleague with a login (their own chat is "You",
    as in Direct Messages); a colleague with no conversation yet gets one. Up to 5 chats are picked, shown as chips; **Forward** sends every
    message to each, in the order they were sent, and the toast says where it went. A forwarded
    copy is marked **Forwarded** and carries what the message carried: a text and its link card,
    a photo, video or file with its caption (an album stays one album), a voice note with its
    length and transcript. It is posted by the person forwarding; who first sent it is kept in
    the record's history, never shown. Polls, celebrations, recognitions and announcements are
    not forwarded. In the file viewer, Forward sends the message holding the file on view. In
    Mailbox, **Forward to Chat** beside an attachment (and in the viewer for it) sends that file
    the same way, except from Spam. Files in My Documents are never forwarded: they hold IDs, contracts and other
    personal or restricted files.
20. **Scrolling a conversation** (TB, 21/10/2026: as on WhatsApp), in channels and direct messages
    alike. A conversation opens at its newest message, or, when it has unread messages, at the
    first of them under an **"N Unread Messages"** line (the pages it needs are read at once, up to
    4 pages; past that it opens at the oldest one read, with the line). Older messages load 25 at
    a time as the person nears the top, with a small spinner, and what is on screen stays where it
    was. A new message moves the view down only when the person is already at the bottom, or sent
    it; while they read older messages a round **Newest Messages** arrow sits above the composer
    with the count of new ones, and takes them down. The day's label (Today, Yesterday, a date)
    stays at the top of the conversation while its messages scroll under it. A new message, an
    edit or a receipt reads the newest page again quietly: nothing blinks, older pages already on
    screen stay, and "No messages yet. Say hello." shows only once the first page has answered
    empty.

## 4 · Data

Built in migrations `1000` (the tables), `1110` (what the first version left out), `1140` (each
member's own pin), `1145` (an announcement's level and its acknowledgements), `1147` (link
cards, and a PDF's page count on its document) and `1480` (wishes under celebration cards). Column names are
the contract's keys (gate 6).

| Table | Key columns | Notes |
|---|---|---|
| `community_channel` | `community_channel_id`, `channel_type` (`company` / `department` / `team` / `group` / `direct`), `name` (unique among live, named channels; `^[a-z0-9][a-z0-9-]{1,29}$`), `description`, `post_policy` (`everyone` / `admins` / `people_ceo`), `pinned`, `system_key` (`general` / `announcements`), `created_by` (null for the two system channels), `archived_at` | A direct conversation is a channel of type `direct` with its two members. #general and #announcements are made by the system the first time they are needed |
| `community_member` | `community_channel_id`, `user_id`, `member_role` (`admin` / `member`), `muted_until` (`infinity` when muted), `pinned_at` (the member's own pin, 1140), `last_read_at`, `last_delivered_at`, `joined_at` | **Membership is the authorisation boundary** for every read and write. The two pointers drive unread counts and the ticks. Every active login is a member of #general and #announcements from the moment it is made (`app_user.created`, and `app_user.reactivated`), with an hourly sweep for any that slipped through; opening Community joins them too. A suspended login or a leaver is never swept in |
| `community_message` | `community_message_id`, `community_channel_id`, `sender_user_id` (null for system posts), `message_type` (`text` / `image` / `audio` / `video` / `file` / `system` / `poll` / `recognition` / `birthday` / `anniversary` / `announcement`), `body` (a file's caption), `document_id`, `community_link_preview_id` (the first link's card, 1147), `metadata` jsonb, `transcript`, `sent_at`, `deleted_at`, and from `1195`: `pinned_until`, `pinned_at`, `pinned_by` | `audio` is a voice note. `metadata` holds the kind's extras: a voice note's `duration_s`, a poll's `options`, a card's `subject_employee_id`, `years` and `since` (the start date an anniversary counts from, kept from 22/10/2026), the `album_key` of files sent together, `no_link_preview` when the sender removed the card, `forwarded` (true) and `forwarded_from` (the message it was forwarded from, never shown) on a forwarded copy. `transcript` is filled on first request, or copied with a forwarded voice note |
| `community_link_preview` | `community_link_preview_id`, `url` (unique: the link as posted, normalised), `status` (`ready` / `empty` / `failed`), `site_name`, `title`, `description`, `image_document_id` (the page's picture, copied into the vault), `fetched_at` | One card per address, shared by every message that posts it. A `ready` card is used for a week, an `empty` or `failed` one is tried again after an hour; written by `community.links.js` only |
| `community_reaction` | `community_message_id`, `user_id`, `reaction` | Celebrate (🎉 or 👏) and thumbs up (👍) are reactions, one per person, toggled |
| `community_poll_vote` | `community_message_id`, `user_id`, `option_index` | One vote per person; voting again moves it |
| `community_wish` | `community_wish_id`, `community_message_id` (the card; goes with it), `user_id` (who sent it), `body` (1 to 280 characters), `created_at`, `updated_at`, `deleted_at` | Migration `1480`. A wish under a birthday or anniversary card, never in the channel's stream. A deleted one keeps its row for the audit and leaves every list and count |
| `peer_recognition` | `from_employee_id`, `to_employee_id`, `message`, `community_message_id`, `note_written_by_system` | Kept separately so M2 performance and Home can count recognitions |
| `community_presence` | `user_id`, `last_seen_at` | Touched by the socket on connect, every 30 seconds and on disconnect; online means a touch in the last 90 seconds |
| `announcement` | `announcement_id`, `title`, `body`, `audience` jsonb (`{ kind: all \| departments, department_ids }`), `status` (`scheduled` / `published` / `cancelled` / `archived`), `publish_at`, `published_at`, `published_by`, `community_message_id`, `audience_size`, `last_reminded_at`, and from `1145`: `urgency` (`normal`, `important`, `urgent`) | The record. #announcements and the M10 Knowledge Hub both read it |
| `announcement_read` | `announcement_id`, `user_id`, `read_at`, and from `1145`: `acknowledged_at` | One row per person in the audience, written when it is published; `read_at` is set when they open #announcements, and also by Acknowledge; `acknowledged_at` only by Acknowledge |

Files (images, voice notes, video, documents) are uploaded to the conversation first
(`POST /channels/:id/media`, purpose `attachment`) and stored by the vault against the channel
(`entity_type` `community_channel`, doc type `community_media`); a vault rule lets only the
channel's members read them, whoever they are. Audio and video are made playable by
`av-transcode` (a video gets `mp4-720` and its `poster`). A photo's `webp-320` and `webp-960` are
made when it is stored; a PDF's are its first page, drawn by `media-derive` with PDF.js, which
also writes `document.page_count`. A message's file travels as a `MediaRef`: the `DocumentRef`
with its width, height, page count, length, a voice note's `waveform` (48 bars, 0 to 100) and
the derived sizes it has, so a screen draws it
at its own shape before a byte of it arrives. A forwarded message carries the same document as
the one it came from, never a copy: the vault rule also lets the members of any conversation
holding a live message with that file read it, so deleting the first message leaves the forwarded
copies as they are. A mail's attachment forwarded to a chat is copied into Community once (doc
type `community_media`, against the first chat picked), through the same type and size rules as
an upload, and shared with the other chats the same way. A link card's picture is a vault document too (doc
type `link_preview_image`, entity `community_link_preview`), readable by every member of staff:
it came from a public page.

## 5 · API

All under `/api/v1/community`. Every list is paged at 25 (BACKEND_STRUCTURE §16). Contract:
`packages/contract/schemas/community.js` and `announcements.js`. A channel the caller is not a
member of answers 404, whatever their grants.

| Method and path | Contract | Permission · scope | Paged | Notes |
|---|---|---|---|---|
| `GET /channels` | `ChannelListQuery` → `ChannelPage` | `community` view · membership | yes | Pinned first, then latest activity. Filter `q` |
| `POST /channels` | `ChannelCreate` → `Channel` | `community` create | | Members by employee ids and/or department ids; `post_policy` `everyone` or `admins` |
| `GET /channels/:id` | → `Channel` | member | | |
| `PUT /channels/:id` | `ChannelUpdate` → `Channel` | `community` create, channel admin | | Name (unique among live channels, 409 `NAME_TAKEN`) and `description` (blank clears it); 403 `NOT_CHANNEL_ADMIN` for a member, 422 `SYSTEM_CHANNEL` for #general and #announcements. Emits `channel.updated` |
| `GET /channels/:id/members` | `MemberListQuery` → `MemberPage` | member | yes | Admins first |
| `POST /channels/:id/members`, `DELETE /channels/:id/members/:user_id` | `MemberAdd` | channel admin | | Not on #general or #announcements |
| `PUT /channels/:id/members/:user_id/role` | `MemberRoleSet` → `Member` | channel admin | | `admin` or `member`; the last admin cannot step down. Not on #general or #announcements |
| `POST /channels/:id/mute`, `POST /channels/:id/read` | `MuteSet`, empty | member | | |
| `PUT /channels/:id/pin` | `PinSet` → 204 | member | | The caller's own pin, channels and direct conversations alike; at most 3 (409 `PIN_LIMIT`); not on #general or #announcements, which are pinned for everyone |
| `POST /channels/:id/delivered` | `DeliveredAck` | member | | The client acknowledges direct messages it received: the delivered tick. Emits `direct_thread.delivered` only when it covered a message from the other person not delivered before; `POST /channels/:id/read` emits `direct_thread.read` only when something was unread (§3 step 10) |
| `GET /channels/:id/messages` | `MessageListQuery` → `MessagePage` | member | yes | Newest page first, each page oldest to newest; scrolling up asks for the next page (§3 step 20). `q` returns only the matches (captions included), and the screen steps between them. A message's file is a `MediaRef`; `link` is its card; `album_key` groups files sent together |
| `POST /channels/:id/media` | multipart `file` → `MediaRef` | member, `post_policy` | | Upload first, then post the message with its `document_id`. The answer says the sizes the file already has, so Send Files draws a photo's tile from its 320 px size. Uploads count against their own budget, 60 a minute per person, not the API's, so a busy screen never blocks a file (429 after) |
| `POST /channels/:id/messages` | `MessageCreate` → `Message` | member, `post_policy` | | `text`, `image`/`audio`/`video`/`file` with `document_id` (`audio` with `duration_s`; `body` as the caption; `album_key` on files sent together), `poll` with 2 to 4 `options`, no two the same (§6), `birthday`/`anniversary` with `subject_employee_id`. `no_link_preview` when the sender removed the card. The kind of a file message is the stored file's (a photo is `image` whatever was asked). Idempotency-Key honoured |
| `POST /link-previews` | `LinkPreviewRequest` → `LinkPreviewAnswer` | `community` create | | The composer's card for one link: from the week's cache, else fetched now (8 seconds at most per request). `preview` is null when the page shows nothing or cannot be reached; a private address is never fetched. 30 a minute per person (429 after) |
| `GET /forward-targets` | `ForwardTargetQuery` → `ForwardTargetPage` | `community` view · own | yes | Where the caller may forward to: the channels they may post in and their conversations, latest activity first, then colleagues with a login and no conversation yet, by name. Filter `q` (names) |
| `POST /forward` | `ForwardRequest` → `ForwardResult` | `community` create · member of each message's channel and posting in each chat; a mailbox's owner for `mail_attachment_id` | | `message_ids` (1 to 25) or one `mail_attachment_id`; `channel_ids` and `employee_ids` together 1 to 5 chats (a colleague's conversation is started if new). All or nothing, in one transaction. 20 a minute per person (429 after). Idempotency-Key honoured |
| `POST /recognitions` | `RecognitionCreate` → `Message` | `community` create | | Always posted to #general (A19). `to_employee_id` cannot be the sender |
| `PUT /messages/:id` | `MessageEdit` → `Message` | author | | Text within 15 minutes; a poll's question and options before its first vote (409 after) |
| `DELETE /messages/:id` | → 204 | author or moderator | | Soft delete (`deleted_at`); a recognition's `peer_recognition` row goes too; not an announcement's post |
| `POST /messages/:id/close` | empty → `Message` | poll author or moderator | | Polls only; votes are refused after |
| `PUT /messages/:id/pin` | `MessagePin` (`period`: `24h`, `7d`, `30d`) → `Message` | moderator in a channel, either person in a direct conversation | | Pinned until now plus the period (again starts it again); a fourth live pin unpins the oldest. 403 `NOT_MODERATOR`. Emits `channel_message.pinned` |
| `DELETE /messages/:id/pin` | → `Message` | as above | | Unpins it; emits `channel_message.pinned` with `pinned_until` null |
| `GET /channels/:id/pins` | `PinListQuery` → `MessagePage` | member | yes | What is pinned now, newest pin first (at most 3) |
| `POST /messages/:id/reactions`, `POST /messages/:id/vote` | empty, `PollVote` → `Message` | member | | |
| `GET /messages/:id/wishes` | `WishListQuery` → `WishPage` | `community` view · member | yes | A celebration card's wishes, newest first. 422 `NOT_A_CARD` for any other message |
| `POST /messages/:id/wishes` | `WishCreate` → `Message` | `community` create · member | | A wish under a birthday or anniversary card (422 `NOT_A_CARD` otherwise, 404 once the card is deleted); the answer is the card with its latest wishes. Emits `celebration.wished`. Idempotency-Key honoured |
| `DELETE /wishes/:id` | → 204 | its author, or a moderator of the card's channel | | Soft delete (`deleted_at`); 403 `NOT_YOURS` for anyone else. Emits `celebration.wish_deleted` |
| `POST /messages/:id/transcript` | → `Transcript` | member | | Voice notes only, through `services/ai/transcription.js`; stored on the message |
| `GET /direct` | `ConversationListQuery` → `ConversationPage` | own | yes | Filters `q`, `unread` |
| `POST /direct` | `{ employee_id }` → `Conversation` | `community` create | | Returns the existing conversation if there is one (one per pair, under a lock) |
| `GET /people` | `ColleagueListQuery` → `ColleaguePage` | `community` view | yes | Colleagues with a login, for the people pickers (New Message, Recognise, Celebrate, members): public work fields only, open to every member of staff. The caller is left out unless `with_self` is set: New Message offers a conversation with oneself; Recognise, Celebrate and the member pickers never offer the caller. The staff register needs People |
| `GET /people/:id/card` | → `ProfileCard` | `community` view | | The profile panel: public work fields only (work email, phone, worksite), presence, what this conversation shares (its files as `MediaRef`s, which open the viewer) |
| `GET /announcements` | `AnnouncementListQuery` → `AnnouncementPage` | `announcements.post` capability | yes | The tracking tab |
| `GET /announcements/stats` | → `AnnouncementStats` | capability | | The tab's figures, counted on the server over every announcement: published, scheduled, average read, this month, and the audience (active staff an all-staff announcement reaches now) |
| `POST /announcements` | `AnnouncementCreate` → `Announcement` | `announcements.post` capability | | `audience` all staff or departments; `urgency` normal (the default), important or urgent; `publish_at` optional and in the future (day-first on screen, ISO on the wire) |
| `PUT /announcements/:id` | `AnnouncementUpdate` → `Announcement` | capability | | Scheduled only (409 once posted or cancelled): headline, message, audience, level, `publish_at` in the future |
| `POST /announcements/:id/acknowledge` | empty → 204 | `community` view, in its audience | | Urgent only (422 `NOT_URGENT`); 404 for anyone outside its audience. Sets `acknowledged_at` and `read_at` once (pressing again changes nothing); emits `announcement.acknowledged` |
| `POST /announcements/:id/cancel` | empty → `Announcement` | capability | | Scheduled only; it is never posted |
| `POST /announcements/:id/archive` | empty → `Announcement` | capability | | Published only (409 `NOT_POSTED` while scheduled, 404 once cancelled or archived); deletes its #announcements message and emits `announcement.archived` |
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
  `announcements.post`; once posted it is never edited, because people may have read it. A posted
  one can only be archived, which keeps its reads.
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
- Celebrations post at 08:00 Africa/Lagos, every day of the week, one card per person per occasion.
  An employee with no `date_of_birth` gets no birthday post. A birthday card shows no date and no
  age. An anniversary card shows the years and the day the person joined (`since`, from their
  start date when the card was posted).
- **Wishes.** Anyone in the card's channel sends wishes, as many as they like, the person
  celebrated included (a thank you). A wish is 1 to 280 characters, only on a birthday or
  anniversary card, never edited, and deleted by its author or a moderator; a deleted one leaves
  the card and its counts. The card carries its latest two wishes, oldest first, and how many
  there are; View All Wishes pages them at 25, newest first. Nobody is told of their own wish.
- **Confetti** is only on celebration cards. It bursts once per card per device, the first time
  the card is well in view (60 %), and from Celebrate on each press that celebrates (not on the
  press that takes it back). With reduced motion it does not move.
- A poll has 2 to 4 options and one vote per person; voting again moves the vote. A closed poll takes
  no votes.
- No two options of a poll are the same, compared as a person reads them: spaces at the ends and
  between words and the case are ignored ("Bukka Hut" and " bukka  hut" are one choice). A repeat is
  marked "Already an option" on its own field as it is filled, and the contract (`repeatedChoices`,
  `PollChoices`) and the service refuse it on Start a Poll and Edit Poll alike (422, `options.n`).
- A moderator of a channel is one of its admins; in #general and #announcements, which have none,
  People and the CEO (`announcements.post`). In a direct conversation only the author edits or
  deletes.
- Text is editable by its author for 15 minutes after it was sent; a poll until its first vote.
  Recognitions, celebrations, files and voice notes are not edited: they are deleted and posted
  again.
- Read counts on announcements are visible to the poster and to holders of `announcements.post` only.
- Calls are **not** part of this module (no call button, no WebRTC): they do not work on the donor
  either (TB, 12 October).
- **Files sent together** are posted one message each, in the order picked, sharing an
  `album_key`; the caption rides on the first. Four or more photos or videos in a row with the
  same key, none deleted, show as one album; fewer show one by one. Up to 10 files a pick, 25 MB
  each (the upload engine's caps).
- **What opens in the app**: photos, videos and PDFs, in the file viewer. Word, Excel,
  PowerPoint, CSV and text files download when tapped. A PDF is drawn by PDF.js (F22, its own
  chunk, loaded when a PDF is first opened), not by the browser, so it opens the same on Android,
  an iPhone and desktop. Download is always there; Share only where the device can share files.
- **A PDF's first page** is drawn by the worker (`media-derive`) at 960 and 320 px, and its pages
  counted, in a process of its own with a 60 second limit; a PDF it cannot read keeps the plain
  file card. Until the picture exists, the card shows the file's glyph.
- **Link cards.** Only `http` and `https` links, on ports 80 and 443, are fetched, and only by
  the server. Every address a name resolves to is checked, and the connection is made to that
  checked address, before each request and each of at most 4 redirects: loopback, private,
  link-local, carrier-grade NAT, multicast, documentation and other reserved ranges, IPv4 and
  IPv6, are refused. A page is read for at most 1 MB and 8 seconds; its picture must be a photo
  type the vault takes, at most 5 MB. The card shows the site (`og:site_name`, else the host),
  the title (at most 200 characters) and the description (at most 300). The server says who it is
  in its user agent. A ready card is kept for a week, a page that gave nothing for an hour.
- **Forwarding.** Texts, photos, videos, files and voice notes are forwarded; polls,
  celebrations, recognitions, announcements and deleted messages are not (422
  `NOT_FORWARDABLE`). At most 25 messages and 5 chats a forward. The person forwarding must be a
  member of each message's conversation and may post in each chat (#announcements takes nothing;
  a read-only channel only from its admins). A forwarded copy is a new message from them, marked
  Forwarded; forwarding a forwarded message marks it Forwarded again, never twice. A removed link
  card stays removed. A mail's attachment is forwarded only by its mailbox's owner, only once it
  is scanned clean, and only a type chats take (the attachment rules: PDF, photos, Word, Excel,
  PowerPoint, CSV, text, audio, video); anything else is refused with the reason. Nothing from
  My Documents is ever forwarded.
- **Receipts.** A delivered or read mark is stored every time, but `direct_thread.delivered` and
  `direct_thread.read` are emitted only when the mark covered a live message from the other
  person (or the system) that it did not cover before. A delivered receipt goes to the other
  person only; a read one to both, so the reader's other devices clear the count. The app says
  delivered on a new message, never on a receipt (§3 step 10).
- **Uploads** (`POST` with a multipart body, anywhere under `/api/v1`) count against their own
  limit, 60 a minute per person, and not against the API's per-person limit; every other request
  counts against the API's only.
- A message's first link is the first `http://` or `https://` address in it, or a `www.` or bare
  domain on a known ending (`nfelia.com`, `mycityapp.io`); the composer and the server find it by
  the same rule.
- Copy a person reads: Title Case chrome, no em dashes, day-first dates.

## 7 · Events, jobs and notifications

| Event / job | When | Does |
|---|---|---|
| `community.message.posted` | After a message commits | Realtime push to `channel:<id>`; notifications to non-muted members. A channel post's notice is titled with the channel (`#general`) and reads "Name: first line"; every post and every direct message alerts each device, replacing the one before from the same conversation, which counts them ("#general · 3 new"; TB, 19/10/2026; `docs/guides/notifications.md` §6) |
| `community.recognition.posted` | After a recognition commits | As above; counted for Home and M2 |
| `direct_thread.delivered`, `direct_thread.read` | A delivered or read mark that covered a message from the other person not covered before (§6) | Realtime `community.receipt`: delivered to the other person, read to both; the open conversation reads its newest page again for the ticks and the list its counts. A mark that covers nothing new emits nothing |
| `channel_message.posted`, `direct_message.sent` for a forward | Each forwarded copy, after the forward commits | As any post: realtime push and notifications. The payload carries `forwarded_from` (the message and its first sender), so the audit log keeps who first sent it |
| `announcement.published` | On publish, or when a scheduled one is released | Message in #announcements; notification and push to the audience at its level (urgent ones need Acknowledge); an Important one queues `announcement-remind` for 4 hours later |
| `announcement-remind` (delayed job) | 4 hours after an Important announcement went out | Reminds, as the system, whoever has not opened it (`announcement.reminded`) |
| `announcement.acknowledged` | Acknowledge on the card or, through `notification.acknowledged`, on the urgent bar | Records it on the reads; the person's notices of it close on every device |
| `announcement-publish` (delayed job) | At `publish_at` | Releases a scheduled announcement (README §5.15) if it is still scheduled and due |
| `announcement.updated` | A scheduled announcement edited | A new delayed release at its new `publish_at`; audit |
| `announcement.cancelled` | A scheduled announcement cancelled | Audit; nothing is posted |
| `announcement.archived` | A published announcement archived | Withdraws its unopened notices (`notifications.withdrawForRecord`, which emits `notification.withdrawn` so the person's bell and urgent bar refresh on every tab); the "Message deleted" update to #announcements' members; audit |
| `community.channel.members_changed` | Members added or removed, or an admin made or unmade | Audit; the channel list refreshes for those affected |
| `community.channel.updated` | A channel renamed or its purpose changed | Audit; the channel list refreshes for its members |
| `celebrations` (scheduler + handler) | 08:00 Africa/Lagos daily | Birthday and anniversary cards in #general |
| `celebration.wished` | A wish committed | Realtime `community.message_updated` to the channel's members, so the card shows it; a notice to the person it is for ("Tolu Adeyemi sent you wishes", the wish as its body), grouped per card on a phone, never to themselves |
| `celebration.wish_deleted` | A wish deleted by its author or a moderator | Realtime `community.message_updated` to the channel's members; audit |
| `app_user.created`, `app_user.reactivated` (identity) | A login is made or comes back | `community.join_company`: the login joins #general and #announcements at once, so a new employee receives announcements before they ever open Community |
| `community-membership` (scheduler) | Hourly, at minute 7 | Every active login added to #general and #announcements; idempotent |
| `av-transcode`, `media-scan` | After an upload | Voice note to Opus, video to MP4 and its poster; a file from outside scanned. Image variants are made at upload; `media-derive` makes a file's variants again on request |
| `media-derive` | After a PDF is stored (`document.stored` with `needs` `pdf`) | Page 1 drawn as `webp-960` and `webp-320`, the pages counted (`services/media/pdf-pipeline.js`); then `document.derived` |
| `document.derived` | A PDF's page or a video's poster is ready | Realtime `community.message_updated` to the members of every conversation holding that file, so its card fills in |
| `link_preview.fetched` | A link's card was fetched (`POST /link-previews`, or the job below) | Audit: the address and who asked. The card is kept for every later message |
| `community.channel_message.pinned` | A message pinned or unpinned (a fourth pin also unpins the oldest) | Pushes `community.message_updated` to the members, whose pinned bar reloads; audit |
| `link-preview` (job) | `channel_message.posted`, `direct_message.sent` or `channel_message.edited` carrying `link_url`: a text message whose first link had no card yet | Fetches the card, attaches it to the message (`channel_message.link_previewed`), and pushes `community.message_updated` to the members |

## 8 · Permissions and visibility by role

| Role | Sees | Can do |
|---|---|---|
| Employee | Channels they belong to, their own DMs, #announcements | Post where `post_policy` allows, react, vote, recognise, celebrate and send wishes, delete their own wishes, create channels, start DMs |
| Channel admin (the creator, and anyone an admin makes admin) | As employee | Add and remove members, make or unmake admins, delete any message or wish and close any poll in the channel, post polls and celebrations |
| People (Operations and HR) | As employee, plus the Announcements tab | Moderate #general and #announcements (delete messages and wishes, close polls, post polls and celebrations in #general), publish and schedule announcements, edit or cancel them until they go out, see read receipts, post in #announcements |
| CEO | As People | As People |

Nobody, including People and the CEO, can read a direct message they are not part of.

## 9 · AI and search

- **AI reads** (`community.ai.js`): `announcements.list` (published announcements, any staff);
  `channels.list` (the caller's channels). **No read over message bodies or direct messages.**
  Private conversation is not material for the assistant. Paged at 25.
- **AI actions** (`docs/guides/praxis-ai.md` §6.11, decision 19): `community.message` (`community`
  create, standard risk, may be suggested: "Tell Ada her leave is approved?"; input
  `DirectMessageSend`: the colleague and the words; the colleague named through the repo; at the
  press on the staff with a login (`assertColleague`); run `sendDirect`: the conversation opened if
  there is none, then `postMessage` as the chat box posts, the message linking to the conversation)
  and `community.post` (`community` create; input `ChannelPost`: the channel and the words; the
  channel named for a member; at the press a member who may post there (`assertMayPost`, so never
  #announcements); run `postMessage`). The words are the person's and the records the reads
  returned: the assistant still reads no message. `ChannelCreate`, `WishCreate`, `MessageCreate`,
  `RecognitionCreate` and `DirectCreate` are `not_offered`.
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
| Staff Community · Channels (`channels`) | "6 channels" (desktop subtitle); New Channel; Search Channels; Pinned and Channels, each row the channel name (a lock when read only), its last message, time and unread count; the open channel: name, member count, a Read Only pill, the ⋮ menu (View Members, Edit Members, Channel Details, Search in Channel, Pin to Top or Unpin, Mute Notifications); a pin and a muted bell on rows, the messages and the celebration, recognition and poll cards (Celebrate, votes), each message's menu (Edit, Close Poll, Pin Message or Unpin, Delete, only those the caller may use); Pin Message (Pin For: 24 Hours, 7 Days, 30 Days; Cancel, Pin Message; the toast "Message pinned"); the pinned bar above the messages (the pinned message's line, "N of 3" when there are several, Unpin for those who may); the day's label held at the top while its messages scroll; the "N Unread Messages" line above the first unread; a spinner while older messages load (Load Older when a page fails); the Newest Messages arrow with the count of new ones while older ones are read; an "Edited" mark and "Message deleted" in place; a birthday card (the photo or initials in a yellow ring with a cake, "Happy Birthday, Ada", name and title, the line) and an anniversary card (City Green: the years in a gold laurel, "3" over "years", a star when the years are not known; the photo, name, title and department; "Three years at MyCity today." with the line; "Joined 21/10/2023"), each with Celebrate (Celebrated once pressed), Send Wishes, who celebrated ("Tolu, Ifeoma and 6 others celebrated", or "Be the first to celebrate"), its latest two wishes (the face, the first name, the wish; Delete Wish for its author or a moderator) and, past two, "12 wishes" with View All; Send Wishes (Wish; Cancel, Send Wishes; the toast "Wishes sent"; "Write a wish" or "At most 280 characters" on the field); Wishes (each wish with its face, name, time and Delete Wish where the caller may; the count with Previous and Next; Close); Delete Wish asks once (Keep It, Delete Wish; the toast "Wish deleted"); the composer with ＋ (Recognise a Colleague, Celebrate and Start a Poll where the caller may, Attach a File), record a voice note and Send; Edit Message (Message; Cancel, Save Changes; "Too late to edit" on the field when the 15 minutes have passed) and Edit Poll (the poll form; Save Changes); Delete asks once (Keep It, Delete Message); Close Poll asks once (Keep Open, Close Poll) and the poll shows a Closed pill; voice notes (Play, Transcribe, Hide Transcript, a Draft pill on the browser's captions); photos in place at their own shape, an album of four tiles with "+N", a video's first frame with Play and its length, a PDF's first page with its name and "N pages · PDF · size", any other file with its name, type, size and Download; captions; clickable links and a link's card (picture, site, title, description); the composer's link card with Remove Preview; the file viewer (the sender and time, Close, Previous and Next, Zoom In and Zoom Out, a PDF's page number, Download, Share on a phone, Forward; "Cannot Open File" with Download when a file will not open); each message's menu adds Forward and Select (not on polls, cards or announcements), an album's menu Forward; a Forwarded mark above a forwarded message; picking: a tick on each picked message and, in place of the composer, "N Selected" with Cancel, Copy (texts only; the toast "Copied", or "Copy did not work. Try again." when the browser refuses the clipboard) and Forward; Forward To (Search Chats; each chat a row with its avatar or #, its name and Channel, Direct Message or the colleague's title, the person's own chat "You" and "Message yourself"; the chats picked as chips with Remove; "At most 5 chats" past the fifth; Cancel, Forward; the toast "Forwarded to 3 chats"); where the user may not post (an admins-only channel), "Only admins post here" in place of the composer; #announcements has none. New Channel: Channel Name, Purpose (Optional), Departments (Optional), People (Optional, with the count selected), Who Can Post (Every Member, Admins Only); Cancel, Create Channel. Channel Members and Edit Members (Make Admin or Remove Admin, Remove, Add People, Close); Channel Details (Channel, Purpose, Members, Who Can Post; Edit Channel for its admins, then Channel Name, Purpose Optional; Cancel, Save Changes; the toast "Channel saved"); the purpose beside the member count in the header (desktop). Recognise a Colleague (Colleague, Note Optional; Post Recognition; the toast "Posted to #general"); Celebrate (Colleague, Occasion: Birthday or Work Anniversary; Post Celebration); Start a Poll (Question, Option 1 to 4, the last two Optional; Post Poll); Send Files (the drop zone, each file's upload percentage, the files as tiles with Remove, a file that failed with why, Retry and Remove, Add More, Caption Optional; Cancel, Send Files). Field errors of at most 4 words on the field: "Not a valid name", "Choose a colleague", "Add a question", "At least 4 characters", "Add an option", "Already an option" on a poll option that repeats an earlier one, a recognition Note past 500 characters "At most 500 characters" as it is typed; a message over 4,000 characters is refused before it is sent ("Messages hold 4,000 characters at most") and stays in the box; Remove on Edit Members asks once (Keep Them, Remove); a refused poll keeps its form and words; a refusal no field holds (a channel save, a member add or removal, an announcement edit, Unpin, a reaction, a vote, Acknowledge, Send Files) is an error toast in the server's words | Help term on Channel Name: "Lower case letters, numbers and hyphens, 2 to 30 characters. Two channels cannot share a name." Help term on Note in Recognise a Colleague: "Leave it blank and a thank you note is written for you." | Who can post being fixed when the channel is created, that only members read a channel, that channels are internal with no join link: §3 step 5, §6 (the New Channel ⓘ text is removed, and so is the Visibility row of Channel Details). Files going to the vault: §4 (the "Files are stored in the vault" line is removed). Who posts: §6. When confetti bursts and that it is remembered on the device, wishes kept under the card and out of the stream, who is told of a wish: §3 step 3, §6, §7. How a link card is fetched (by the server, private addresses refused, its picture copied, kept a week), when files become an album, who draws a PDF's first page, which files open in the app: §3 steps 17 and 18, §6 |
| Staff Community · Direct Messages (`direct-messages`) | "N unread" or "All caught up" (desktop subtitle); New Message; Search People; All and Unread; each conversation: avatar with the online dot, name, last message ("You:" when it was the user's), time, unread count; the open conversation: name, Online or Last Seen, department, search, ⋮ (View Profile, Search in Conversation, Pin to Top or Unpin, Mute Notifications), a pin and a muted bell on rows, the messages with their ticks, the day's label, the "N Unread Messages" line, older messages loading and the Newest Messages arrow as in Channels, voice notes (Play, Transcribe, Hide Transcript, a Draft pill on the browser's captions), photos, albums, videos, files, captions, links and link cards as in Channels, the composer (Attach: Photo or Video, Document, each opening Send Files; the link card with Remove Preview; record a voice note; Send), the file viewer, Forward, Select, the Forwarded mark and Forward To as in Channels. Profile: avatar, name, title, status pill, Message, View in People; Contact (work email, phone, worksite, local time); Shared in Conversation (each file opens the viewer); Channels in Common; Mute Notifications; Search in Conversation. New Message: the person picker | None | What one tick, two grey and two blue mean: §3 step 10. Transcripts stored once per voice note: §3 step 11. The profile reading the employee record and showing no work details: §3 step 8. Search covering only the caller's own conversation: §3 step 9 |
| Staff Community · Announcements (`announcements`) | New Announcement; Published, Scheduled, Average Read, Audience, This Month (desktop); a card per announcement: headline, a Scheduled or "N of 25 read" pill, the body, "Posted" or "Goes out" with the date and author. A card opens Announcement Reads (or Scheduled Announcement, with Edit and Cancel Announcement; Edit opens Edit Announcement, the New Announcement form filled in, with Save Changes; Cancel Announcement asks once, Keep It or Cancel Announcement; a published one's Archive Announcement asks once, Keep It or Archive Announcement, and toasts "Announcement archived"): headline, posted line, body, "Read by N of 25" with its bar, Not Read with Remind Them, Read; Close. An Urgent card has a red edge and reads "N of 25 acknowledged", and its modal lists Not Acknowledged (with Remind Them) and Acknowledged, each with its time; an Important card has an amber edge. New Announcement: Headline, Message, Level (Normal, Important, Urgent), Audience (All Staff or Departments, then the department chips), When (Now or Schedule, then Publish Date, DD/MM/YYYY); Cancel, Publish Announcement (Schedule Announcement when scheduled) | Help term on Average Read: "Across published announcements, the share of the audience who have opened each one." Help term on Level: "Urgent stays red on everyone's screens and repeats every 30 minutes of the working day until each person acknowledges. Important reminds the unread after 4 hours." | Who may post, #announcements being pinned and read only, the notification on publish, scheduling, read counts visible to the poster only: §3 step 2, §6, §7, §8 (the page subtitle "Posted by People and the CEO · staff read them in #announcements" and its ⓘ text are removed). "Not yet visible to staff" on the scheduled pill: §3 step 2. "Posting as" in the form: §6 |
| #announcements channel | As Channels: the published announcements as cards (author, date, headline, body), newest last; a lock on its row and the Read Only pill; no composer at all, for anyone (announcements are published from the Announcements tab). An Urgent card is red and pulses slowly (steady when motion is off) with Acknowledge until pressed, then "Acknowledged" and its time; an Important card has an amber edge. A red dot on Community while an urgent announcement waits on the person | None | The `announcements.post` capability: §5, §8. The repeat schedule: `docs/guides/notifications.md` §6 |
| Knowledge Hub · Announcements (M10) | Owned by Knowledge Hub (M10): the same announcement records, read only | The M10 guide | The M10 guide. That it reads the same records, no second copy: §2 |
| Notification bell and web push | Owned by the frontend foundation (FRONTEND_GUIDE §9.6): the sender and first line; a tap opens the conversation | None | Fan-out, muting and who is notified: §3 step 1, §7 |
| People · Employees (employee record) | Owned by People: that module's guide | That module's guide | How birthdays and anniversaries become posts: §3 step 3, §6 |
| Settings · Notifications (M6) | Owned by Settings (M6): the Community Messages category with in-app, push and email | The M6 guide | The M6 guide |
| Mobile bottom bar "Community" | The Community icon and word; it opens Staff Community | None | FRONTEND_GUIDE §7 |

### 10.2 Phone layout

| Screen | First on a phone | Left off a phone | Main action | Navigation |
|---|---|---|---|---|
| Staff Community · Channels (`channels`) | New Channel beside the title; the search box; Pinned and Channels as full-width rows (channel name, last message, time, unread count) | The subtitle; the open channel beside the list (a channel opens full screen instead); the resizable divider; the viewer's arrows and zoom buttons (a swipe and a pinch instead) | Tap a channel: it opens full screen over the top bar, tabs and bottom bar, with Back; the composer is locked at the bottom (＋, the voice note button and Send, 44 px) and only the messages scroll; older messages load as the person scrolls up, and the Newest Messages arrow (44 px) sits above the composer while they read older ones; ＋ opens Recognise, Celebrate, Poll and Attach as a menu, each form as a bottom sheet; Send Files is a bottom sheet with Send Files full width at its foot; the link card sits above the message box with its Remove Preview; on a celebration card Celebrate and Send Wishes share a row, 44 px each, and Send Wishes and Wishes open as bottom sheets; a photo, video or PDF opens the viewer over everything, black, with Close, the sender, Share and Download in its top bar, swiped left and right, a photo pinched or double tapped to zoom; a long press on a message starts picking (a tick on each one tapped) and the bar at the bottom shows the count with Forward; Forward To is a bottom sheet, the search at its top and Forward full width at its foot | Bottom bar Chat; the three tabs along the top; inside a channel the menu button opens the channel list as a bottom sheet; Back returns to the list; Close or the phone's Back leaves the viewer |
| Staff Community · Direct Messages (`direct-messages`) | New Message beside the title; the search box; All and Unread as a full-width two-part switch (44 px); the conversation rows | The subtitle; the profile column (View Profile opens it as a sheet); the resizable divider; the viewer's arrows and zoom buttons | Tap a conversation: it opens full screen with Back; Attach, the voice note button and Send at the bottom, 44 px; Send Files, the link card, the viewer, picking and Forward To as in Channels | As Channels |
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
- **No start date**: an anniversary card holds a star in its laurel and reads "Another year at
  MyCity today."; it has no Joined line. A card posted before 22/10/2026 has no Joined line either:
  the date was not kept then.
- **The person celebrated sends wishes**: allowed, as a thank you; nobody is notified.
- **A card deleted**: its wishes go from view with it, and a wish sent to it is refused (404).
- **A wish deleted after its notice went out**: the notice stays; it opens the card without it.
- **Reduced motion**: the cards show no confetti.
- **Same birthday**: one card each.
- **A birthday on a non-working day**: still posted; the job runs every day.
- **Message deleted**: replaced by "Message deleted"; the row keeps `deleted_at` for the audit.
- **Double send** on a bad connection: refused by the Idempotency-Key.
- **Offline**: not supported (BACKEND_STRUCTURE §15). The composer says so and keeps the draft.
- **Huge history**: paged at 25; scrolling up fetches the next page, and a page that fails shows
  Load Older to try again.
- **New messages while older ones load**: the next page may repeat a message already on screen;
  it shows once.
- **More than 100 unread**: the conversation opens at the oldest of the 4 pages read, under the
  "N Unread Messages" line; scrolling up reaches the rest.
- **A started conversation left empty**: in neither person's list; the colleague is offered as a
  person in Forward To, and New Message opens the same conversation again.
- **A file that failed to upload** (a lost connection, too many at once): its tile says why, with
  Retry and Remove; a file over 25 MB has Remove only.
- **Unsupported file type**: refused by the upload engine's mime policy, with the reason.
- **Announcement scheduled in the past**: refused; the date must be today or later.
- **A photo or a page picture that fails to load**: its tile keeps its shape with the file's glyph;
  tapping it still opens the viewer, which offers Download.
- **A PDF that is broken, locked with a password or too heavy**: no first page in the bubble; the
  viewer says Cannot Open File and offers Download.
- **A video before `av-transcode` has finished**: a dark tile with Play; the viewer plays the
  original if the browser can, else offers Download. The poster arrives in place once made.
- **A deleted photo in an album**: shown as "Message deleted" in its place; the rest of the album
  shows one by one when fewer than four remain.
- **A link to a private or internal address** (`http://10.0.0.5`, `localhost`, an address that
  resolves to one): never fetched; the link stays clickable, with no card.
- **A page with no title, a page that times out, a picture that is too big or not a photo**: no
  card, or a card without its picture. Asked again after an hour.
- **The same link posted twice in a week**: the second message gets the card at once from the
  cache; nothing is fetched again.
- **Sent before the card arrived**: posted at once; the card fills in a moment later.
- **A chat that changed while Forward To was open** (the person left it, or it became read only):
  that forward is refused whole and says why ("You cannot post in #ops"); nothing is half sent.
- **A message deleted while it was picked**: the forward is refused ("A message was deleted"),
  and the person picks again.
- **The first message deleted after it was forwarded**: the forwarded copies keep their text and
  file; the file stays readable in every chat that holds it.
- **A sixth chat picked**: not added; "At most 5 chats" under the search.
- **A mail attachment still being scanned, or quarantined**: Forward to Chat says "Still being
  checked" or "This file cannot be sent"; a type chats do not take (a ZIP) is refused with the
  types they do.
- **Forwarding to yourself**: allowed, into the conversation with yourself, as notes to keep.
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
| new | Photos in place, albums, the file viewer, PDF pages drawn by PDF.js, link cards fetched by the server | Built here (TB, 19/10/2026) |

## 13 · Open questions

- Can any employee create a channel, or only managers and People? (Default here: any employee.)
- Birthday privacy: offer an opt-out for staff who do not want their birthday posted (NDPA)?
- Answered 17/10/2026 (GE): text edits for 15 minutes; delete by the author or a moderator (§6).
- Voice note maximum length (proposed: 5 minutes).
- Is the donor's certified (SHA-256) channel export wanted?
- Transcription stays on request only (TB, 20/10/2026, `integrations.md` §1.2 decision 9). Can a user
  switch off read receipts?

## 14 · Change log

- 01/11/2026 · JP · Praxis AI Engine PR5 (`praxis-ai.md` §6.17): `channels.list`, `community.post` and `community.message` carry matrix probes (#general listed and open to a post, a private channel of an outsider's alone never listed and refused as a card's channel, a message to an id that is nobody's refused); the probes go through the community service, never SQL.
- 01/11/2026 · JP · Praxis AI Engine PR4 (`docs/guides/praxis-ai.md` §6.11, decision 19): the assistant's cards `community.message` (a direct message a person sends with one press, `community.service.sendDirect`) and `community.post` (a post in a channel they may post in); the assistant reads no message still; §9. Nothing on the Staff Community screens changes.

- 29/10/2026 · GE · Knowledge Hub's Announcements tab (#66, M10) is dropped (GE, 29/10/2026): announcements are published and kept on Staff Community · Announcements and read in #announcements. Its interim page, ⌘K screen and the `knowledge_announcement` record type are gone. Nothing on these screens changes.
- 26/10/2026 · JP · From the QA bug register (M1): a poll's options must differ, their case and spaces ignored; a repeat reads "Already an option" on its own field as it is typed, and the contract (`PollChoices`), the service and the mock refuse it on Start a Poll and Edit Poll (§5, §6, §10.1). A refused option's mark lands on the field it came from when an optional one was left empty. The shell's update, install and notifications offers no longer float over the composer: they wait off every Staff Community tab (FRONTEND_GUIDE, PWA). Left: nothing.

- 26/10/2026 · JP · From the User Guide audit's screen defects: every refusal is said (Remove, Add People, Unpin, Celebrate and the thumbs up, a vote, Start a Poll, Send Files, Acknowledge, Channel Details and New Channel without a field, an announcement's save); Remove asks first; Start a Poll closes only once posted; a channel's Purpose takes the API's `description` marks; a message deleted meanwhile reads "That message is no longer here" (the service's `messageGone`), and Edit Message and Send Wishes toast it rather than marking the field; a message over 4,000 characters and a recognition note over 500 are said before sending; a headline, message or question of one to three characters reads At least 4 characters; Who Can Post reads Every Member and Admins Only everywhere; LAST_ADMIN shows the server's words; the Announcements tab follows `announcements.post`, as its routes do (shell and search); Read and Not Read page; the recorder's refusal says to type instead; the desktop profile's Message focuses the message box; the phone profile's Mute Notifications follows its own change; Average Read carries its help (StatStrip `help`); Edit opens as Edit Announcement. §3 step 13 no longer says the divider resets on a double click, §10.1's subtitle is the channel count, and §10.2's channel list is a bottom sheet, as the code does.
- 25/10/2026 · JP · A channel's name at the head of its thread is its heading (h2), so each post's title (h3) sits under it: the accessibility gate refused h1 straight to h3 (heading-order). Nothing on screen changes.
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
- 19/10/2026 · TB · Media and links, from TB's four answers: photos show in place and 4 or more sent together as an album; Send Files takes several files with a caption; photos, videos and PDFs open in a full-screen viewer with Download and, on a phone, Share; PDFs are drawn by PDF.js on every device (the browser's own viewer cannot draw one on Android, and the app's security policy blocks it everywhere), their first page drawn by the worker for the bubble; links are clickable and the first carries a card the server fetches, shown in the composer with Remove Preview. §2, §3 steps 17 and 18, §4 (`1147`, `community_link_preview`, `MediaRef`), §5 (`POST /link-previews`), §6, §7, §10, §11 and §12. FRONTEND_FOUNDATION §5 PR 3 question 4 records the PDF change.
- 19/10/2026 · TB · From TB's answers (`docs/handoff/notifications-everywhere.md` §2): announcements get
  a level (Normal, Important, Urgent; §3 step 2, §6); Urgent needs Acknowledge, shows red with the
  urgent bar and repeats until acknowledged; Important reminds the unread after 4 hours; every
  channel post alerts each device (§3 step 1, §7); the poster counts as having read their own.
  §2 to §7, §10 and §11 updated.
- 19/10/2026 · TB · Built: migration `1145` (M1's block, after the tables it alters), Acknowledge on
  the card (`POST /announcements/:id/acknowledge`) or the urgent bar (recorded through
  `notification.acknowledged`), the Level field, red and amber cards (`Card` urgency), the reads by
  acknowledgement with their times, and the Important reminder on `announcement-publish` (`remind`).
  GE to review `1145` and the announcement changes.
- 19/10/2026 · TB · Community's notices are listed in Settings · Notifications
  (`docs/guides/notifications.md` §6), each naming its audience (`who`): direct messages, channel
  posts and announcements take no copies, and an announcement's level stays with its poster.
- 19/10/2026 · TB · Forward, from TB's four answers (as on WhatsApp): a message, several picked
  together or an album go to up to 5 chats (channels the person may post in, their
  conversations, any colleague), marked Forwarded, the first sender kept in the history only; a
  mail's attachment goes the same way from Mailbox; My Documents never. The forwarded file is the
  same document, read by every chat holding it. §2, §3 step 19, §4, §5 (`GET /forward-targets`,
  `POST /forward`), §6, §7, §10 and §11.
- 20/10/2026 · GE · From TB's review: everyone is in #general and #announcements from the moment their login exists (`app_user.created`), with an hourly `community-membership` sweep, instead of from their first visit, so a new employee gets announcements at once (§4, §7).
- 20/10/2026 · GE · From TB's review: a published announcement can be archived (§3 step 2, §4, §5, §6, §7, §10). Its unopened notices are withdrawn through a new `notifications.withdrawForRecord`; TB to review that addition to the notifications module.
- 20/10/2026 · GE · From TB's review: a channel's admins rename it and change its purpose from Channel Details (Edit Channel), `PUT /channels/:id`; Channel Details shows the purpose, and the header shows it on desktop (§3 step 5, §5, §7, §10).
- 20/10/2026 · GE · Celebrations post at 08:00 Africa/Lagos instead of 05:00 (TB's review, 19/10): §3 step 3, §6, §7.
- 20/10/2026 · GE · A birthday known only as a day and month posts too (§3 step 3): migration `1180` adds `employee.birth_day` and `birth_month`, the staff loader fills them from the sheet's DOB on every deploy (by work email, else staff number; never over a date on screen), through `organisation.setBirthday`.
- 20/10/2026 · GE · Voice notes from TB's review (§3 step 11, §4): the bars are the note's measured loudness (`document.waveform`, migration `1190`, written by `av-transcode` and `media-derive`) and follow the audio's position from its first sound; the note's Opus copy is fetched as the bubble is drawn, so Play no longer waits about 2 seconds for the download. Notes sent before this keep the steady shape until `media-derive` is run for them.
- 20/10/2026 · GE · From TB's review: a message is pinned for everyone for 24 hours, 7 days or 30 days, at most 3 at once, with a pinned bar above the messages (§3 step 16, §4 `1195`, §5, §7, §10).
- 20/10/2026 · GE · Real time, from TB's review: a message reaches the other screen as soon as it commits (the outbox wake, foundation guide), not up to a second later, and the sender's own message shows from the server's answer instead of after reading the page again.
- 20/10/2026 · TB · Voice notes (§3 step 11, §10): transcribed through Groq, then Gemini, then the captions the browser wrote while the note was recorded (sent as `captions`, kept in metadata), shown as a Draft and never stored; a failure is a toast instead of a stuck "Transcribing…"; the stub's placeholder is never stored, and one stored before reads as none (`integrations.md` §1.2, §6.14). Transcription on request only is decided (§13).
- 21/10/2026 · TB · Direct messages on staging blinked "No messages yet. Say hello." and refused a photo with "Too many requests": an open conversation answered every receipt with a delivered mark, and every mark emitted another receipt, so two screens (or one) acknowledged each other without end and spent the person's per-minute request budget. Now the app says delivered only on a new message, and the server emits a receipt only when a mark covered something new (§3 step 10, §5, §6, §7). A conversation left empty stays out of both lists, as step 7 always said; the live list had kept it for its starter. Uploads have their own budget and a failed file has Retry (§5, §6, §10, §11). Conversations scroll as on WhatsApp: 25 at a time as the person scrolls up, the first unread under "N Unread Messages", no jump while reading older ones (the Newest Messages arrow), the day's label held at the top (§3 step 20, §10, §11).
- 22/10/2026 · TB · Celebration cards, Cynthia's picks from the samples page (Birthday 1, Anniversary 1) with TB's four answers: a quiet birthday card and a City Green anniversary card with the years in a laurel and the day the person joined (`since`, kept on the card); **Send Wishes**, wishes kept under the card (latest two, View All Wishes at 25) and never in the stream, each telling the person it is for, deleted by their author or a moderator, never edited (migration `1480`, `community_wish`); confetti bursts once per card per device and from Celebrate, still under reduced motion. §2, §3 step 3, §4, §5, §6, §7, §8, §10 and §11.
- 25/10/2026 · JP · Send, Post Recognition, Post Celebration and Mute or Unmute Notifications (a channel's and a conversation's) say why when refused; the composer keeps the words to send again (`Thread.test.tsx`). Found while writing the M1 User Guide.
