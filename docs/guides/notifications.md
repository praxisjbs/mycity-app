# Notifications · Engineering Guide

| | |
|---|---|
| Owner | TB |
| Milestone | M0 (web push and personal preferences brought forward from M6 by TB, 19/10/2026; urgency, every device and urgent repeats added the same day; Settings · Notifications and the reminder engine follow) |
| Backend modules | `notifications` |
| Frontend paths | `app/src/features/notifications/`, `app/src/shell/Bell.tsx`, `app/src/sw.ts` |
| Permission key(s) | none: every route is the caller's own (`self`), and two are reached by a device token (`anonymous`) |
| Capabilities | none |
| Screens (PROGRESS.md rows) | none of their own: the bell, its pane, the banner, the urgent bar and Notification Settings are shell parts on every screen; Settings · Notifications (#74) comes forward from M6 in the next pull request |
| Status | Agreed |
| Last changed | 19/10/2026 |

TB's decisions of 19/10/2026 and their build logs are in `docs/handoff/push-notifications.md` (web
push, the banner, the pane) and `docs/handoff/notifications-everywhere.md` (urgency, every device,
Settings · Notifications, reminders); running it on the server (keys, live mail, a device's health)
is `docs/runbooks/push-notifications.md`.

---

## 1 · What it is for

Something that happened to you reaches you wherever you are: in the app as a banner and in the
bell, on every phone and computer you have turned notifications on, and after your session has
ended, so a mail, a message or an approval is never missed. What cannot wait (an urgent
announcement, a change to who can do what, an approval past its time limit) stays red on every
screen and comes back every half hour of the working day until you deal with it. Every member of
staff uses it; the people who act on approvals, mail and messages depend on it most.

## 2 · Screens affected

| Screen / tab (slug) | Where | Who sees it | What it shows | What a person can do there |
|---|---|---|---|---|
| The bell (top bar on both shells) | Staff app, every screen | Everyone signed in | A dot while anything is unread | Open the pane |
| Notification pane, phone | Full-screen page over any screen | Everyone | All and Unread with counts; rows grouped Today, Yesterday, Earlier; Turn On when push is off on this device | Open a notice (marks it read), swipe left to mark read, Mark All Read, pull to refresh, the gear |
| Notification pane, desktop | Panel under the bell | Everyone | The same rows and groups in a 420 px panel | Open, Mark Read on hover, Mark All Read, the gear |
| Notification Settings | Phone: full-screen page from the gear; desktop: modal; ⌘K | Everyone, their own | This Device (push status, Sound in App), Other Devices (when there are any), Notice Categories with In App, Email and Push | Turn On or Turn Off push here, Send Test, Install App (an iPhone in Safari), remove another device, switch a channel per category |
| In-app banner | Top of the screen on both shells | The person it is for, app open | Who or what, two lines of its text, an avatar or the category's glyph; red for an urgent notice, amber for an important one | Tap to open, swipe or × to dismiss |
| Urgent bar | Under the top bar on every screen of both shells | The person, while any urgent notice of theirs is open | The newest open urgent notice's title, how many are open, pulsing slowly in red (steady when motion is off) | Acknowledge (an urgent announcement), Open (anything else urgent), step to the next one |
| Turn-on notice (`ShellNotice`) | Foot of the shell, once per device | Everyone, until answered | One line and two buttons | Turn On, Not Now |
| Phone or computer notification | The device's own notification shade, lock screen and badge | The person, on every device with notifications on, app open or closed (the device in hand shows it beside the banner) | Title (with how many are new when grouped), text, the sender's initials or the app icon, the MyCity pin, the count on the app icon; an urgent notice again every 30 minutes of the working day until it is dealt with | Tap to open the record (through sign-in when the session ended), Mark Read |
| Mailbox (`inbox` and the other folders) | Staff app | The mailbox owner | Unchanged | Reading a conversation marks its notices read |

## 3 · How the screens relate

1. A module commits a change and `emit()`s its event. After commit, the fan-out
   (`src/shared/notifications/fanout.js`) writes one `notification` row per person it notifies,
   with the channels their preferences allow (`categories.js`), and hands the rows to the
   `notification-deliver` job.
2. `notification-deliver` sends `in_app` over the person's socket (`notification`, the contract's
   `Notification`, with a link only when they may open its module), mails `email`, and queues one
   `notification-push` job per row carrying `push` (job id `push-<notification_id>`, so a retried
   delivery never queues it twice), at once: nothing waits while the person is in the app (TB,
   19/10/2026).
3. The app that receives `notification` updates the dot and the pane and, when the window is on
   screen, shows the banner (3 s) and plays the chime or vibrates (§6). The banner is not shown for
   the record already on screen.
4. `notification-push` checks the notice is still unread, then sends it to each of the person's
   devices through `services/push` and records each attempt in `push_delivery`.
5. On the device, the service worker (`app/src/sw.ts`) shows a notification on every device,
   the one in the person's hand included, and posts the push to each window of the app on screen
   (`mycity:push`), which shows its banner unless the socket's copy already did. A tap focuses a
   window of the app and sends it to the record (`mycity:open`), or
   opens a new one on `<record path>&n=<notification ids>` (`/?pane=notifications&n=…` when the
   notice has no screen): the app opens on the record, through sign-in when needed, and marks the
   notices read. Mark Read on the notification marks them read without opening the app (the device
   token, §5).
6. A read mark anywhere (`notification.read`, `notification.read_all`, reading a mail conversation)
   reaches the person's other tabs (`notification_read`); when an app comes to the front it closes
   any notification in its shade that is already read.
7. **Urgency.** The fan-out writes each notice's urgency (`normal`, `important`, `urgent`) and
   whether it needs Acknowledge. An urgent notice stays open until it is acknowledged (when it needs
   Acknowledge) or opened (otherwise). Every open urgent notice shows in the urgent bar on every
   screen (`GET /notifications/urgent`), and the `urgent-repeats` sweep alerts it again on every
   device and as a banner every 30 minutes from 08:00 to 18:00 Lagos time, at most 8 times a day,
   until it closes. Acknowledge on the bar (`POST /notifications/:id/acknowledge`) or on the
   announcement itself closes it on every device; the announcement records who acknowledged
   (`docs/guides/community.md`).

## 4 · Data

| Table | Key columns | Notes |
|---|---|---|
| `notification` | `notification_id`, `user_id`, `event_id`, `event_key`, `category`, `priority`, `title`, `body`, `entity_type`, `entity_id`, `channels`, `read_at`, `delivery_queued_at`, and from `0470`: `urgency` (`normal`, `important`, `urgent`), `acknowledge_required`, `acknowledged_at`, `repeat_count`, `last_alert_at`, `repeat_day`, `repeats_on_day` | Written by the fan-out, one row per (event, user); this module marks it read, acknowledged and repeated |
| `notification_preference` | `user_id`, `category`, `channel`, `enabled` | A row only where the person changed a default |
| `push_subscription` | `push_subscription_id`, `user_id`, `endpoint` (unique), `p256dh`, `auth`, `expires_at`, `revoked_at`, and from `0460`: `known_device_id`, `label`, `platform`, `device_token_hash`, `vapid_key_id`, `last_seen_at`, `last_success_at`, `last_failure_at`, `failure_count`, `last_error`, `revoked_reason` (`turned_off`, `refused`, `moved`, `signed_out`, `suspended`, `left`) | One per browser install. Subscribing again from the same browser updates the row and moves it to whoever is signed in; `device_token_hash` is the hash of the token its service worker shows (§5) |
| `push_delivery` (new, `0460`) | `push_delivery_id`, `notification_id` (null for a test), `push_subscription_id`, `status` (`sent`, `failed`, `gone`, `skipped_read`), `http_status`, `error`, `attempts`, `sent_at`, and from `0470`: `round` (0 the first alert, then each urgent repeat) | Unique per (notification, subscription, round): a retried job sends only to the devices still owed |
| `integration_secret` | provider `web_push`, key `vapid` | The environment's VAPID pair, encrypted with `ENCRYPTION_KEY`, made the first time a browser asks for it (`GET /push/config`) when `.env` gives none |

Schema migration file(s): `migrations/0460_web_push.sql`, `migrations/0470_notification_urgency.sql`.
Reference-data file(s): none.

## 5 · API

| Method and path | Contract | Permission · scope | Paged | Notes |
|---|---|---|---|---|
| `GET /api/v1/notifications` | `NotificationListQuery` → `NotificationPage` | self | yes, 25 | `status` unread or read |
| `GET /api/v1/notifications/unread-count` | → `UnreadCount` | self | | |
| `GET /api/v1/notifications/badges` | → `NavBadges` | self | | |
| `GET /api/v1/notifications/read-state` | `NotificationReadStateQuery` → `NotificationReadState` | self | at most 25 ids | Which of these ids are read, to close shade notifications |
| `POST /api/v1/notifications/:id/read`, `/read-all` | `EmptyBody` | self | | |
| `GET /api/v1/notifications/urgent` | `UrgentNoticeQuery` → `NotificationPage` | self | yes, 25 | The caller's open urgent notices, newest first: the urgent bar |
| `POST /api/v1/notifications/:id/acknowledge` | `EmptyBody` → `Notification` | self | | Marks it acknowledged and read; 422 `NOT_ACKNOWLEDGEABLE` when it needs no Acknowledge. Emits `notification.acknowledged` |
| `GET /api/v1/notifications/preferences` | → `NotificationPreferences` | self | | Every category with its three channels, defaults applied, `locked` |
| `PUT /api/v1/notifications/preferences` | `NotificationPreferenceUpdate` → `NotificationPreferences` | self | | One category and channel per call; switching off a locked channel is 422 `CATEGORY_LOCKED`, an unknown category 404 |
| `GET /api/v1/notifications/push/config` | → `PushConfig` | self | | `enabled`, the public key and its id |
| `POST /api/v1/notifications/push/subscriptions` | `PushSubscriptionCreate` → `PushDeviceSaved` | self | | Upsert by endpoint, or by `push_subscription_id` with the browser's `device_token` when its endpoint changed; moves the device to the caller; `device_token` is issued once (null when the browser proved the one it holds) |
| `GET /api/v1/notifications/push/devices` | `PushDeviceListQuery` → `PushDevicePage` | self | yes, 25 | The caller's devices with push on |
| `POST /api/v1/notifications/push/devices/:id/remove` | `EmptyBody` → 204 | self | | Turns push off for that device (`turned_off`) |
| `POST /api/v1/notifications/push/test` | `PushTestRequest` → `PushTestResult` | self | | `push.test_requested`: the worker sends to one device or all, always shown; answers how many devices |
| `POST /api/v1/notifications/push/renew` | `PushRenew` → 204 | anonymous, device token | | The service worker after `pushsubscriptionchange`. A wrong token (or a device turned off) is 403 `DEVICE_NOT_RECOGNISED`; 30 refusals in 15 minutes from one address are refused for the rest of the window (`pushDeviceLimiter`) |
| `POST /api/v1/notifications/push/read` | `PushDeviceRead` → 204 | anonymous, device token | at most 25 ids | Mark Read on a notification; the same limit and refusal |

## 6 · Rules and calculations

- **Channels.** A notice goes to `in_app` always (the bell is the record), and to `email` and `push`
  as the person's preference for its category says, else the category's default (`categories.js`).
  Security cannot be switched off where it is on by default.
- **Every device, at once.** A push goes to every device the person has turned notifications on,
  the moment the notice is written, whether or not they are in the app (TB, 19/10/2026). The device
  in their hand shows its notification as well as the banner.
- **Urgency.** `normal` alerts once. `important` alerts once in amber. `urgent` is red, stays in the
  urgent bar and repeats until it closes. A declaration sets it (`urgency`, a value or a function of
  the event); every Security notice and `workflow.escalated` (an approval past its time limit) are
  urgent; an announcement takes the level its poster chose (community.md). A declaration may also
  ask for Acknowledge (`acknowledge`), which only an urgent announcement does today.
- **Open and closed.** An urgent notice needing Acknowledge is open until acknowledged; opening it
  is not enough. Any other urgent notice is open until read (opened). Acknowledge also reads it.
- **Urgent repeats.** Every 5 minutes the `urgent-repeats` sweep alerts each open urgent notice
  again when its last alert is 30 minutes old or more, it is between 08:00 and 18:00 Lagos time, and
  it has repeated fewer than 8 times that Lagos day: a push to every device (a new `round`), and the
  banner in the open app. A notice written in the evening alerts at once and repeats from 08:00.
  It stops when the notice closes, or when its person is suspended or leaves.
- **Grouping on a device.** A notice's tag is its conversation: the event's own tag when its
  notification declares one (`community_channel:<id>` for direct messages and channels), else its
  record (`mail_thread:<id>`, `<entity_type>:<entity_id>`), else `n:<notification_id>`. Mail,
  direct messages and channel posts replace the earlier notification for the same conversation and
  alert again ("Tom-Blake Asaah · 2 new", "#general · 4 new"; every post alerts, TB 19/10/2026). A
  notice with no record stands alone. The grouped notification keeps the last 25 notice ids, so a
  tap or Mark Read reads them all.
- **Mail content.** Title: the sender's name, else the address. Body: the subject, a new line, the
  first line of the message (about 140 characters). Shown on the lock screen too.
- **Sound in the app.** A chime at 60% volume for mail, direct messages, channel posts,
  announcements, approvals and anything important or urgent (an urgent repeat included), at most
  once every 5 s. iPhone: through the ambient audio session, which the silent switch mutes. Android: vibration
  only, unless Sound in App is on for that device (no browser reports the ringer mode). Closed or
  background apps use the device's own notification sound, which follows its ringer setting.
- **When a device stops.** Push switched off on it; someone else signs in on it (the subscription
  moves to them); the person is suspended or leaves; Sign Out Everywhere or Sign Out Others. A
  session ending or a plain Sign Out does not stop it.
- **Delivery.** TTL 24 hours (Security 7 days, a test 1 hour); the push service's urgency high for
  high priority and for important and urgent notices, normal otherwise; the topic is the tag (hashed to 32 characters when
  longer; none for a notice that stands alone), so a newer push for the same conversation replaces
  a queued one. 404 and 410 revoke the subscription; 401 and 403 revoke it (the browser subscribes
  again with the current key on its next start); 429, 5xx and network errors retry with backoff (8
  tries from 10 s, doubling, about 20 minutes); each (notice, device) is sent once.
- **Turning it on.** Never the browser's prompt unasked: a one-time notice per device after sign-in
  (Turn On, Not Now; Not Now holds 14 days on that device), the pane's Turn On while push is off
  there, Notification Settings and ⌘K. The browser asks only after a press (iOS requires it). Turn
  Off is remembered on that device. Every signed-in start saves the device again (so it moves to
  whoever is signed in) and subscribes again when the subscription was lost or made under an older
  key; it never asks.
- **The banner.** Each notice once on a device, whichever way it came (the socket or the service
  worker), and none for the record already on screen; an urgent repeat shows it again. 3 s, held
  while touched or hovered; up to 3 stack on desktop. Opening it marks the notice read. Red for
  urgent, amber for important.
- **The urgent bar.** Shows the newest open urgent notice and how many are open; Acknowledge or
  Open closes it there and on every other device (`notification_read`), and the next one shows. It
  pulses slowly (once every 2 s, never flashing); with reduced motion it is steady red.
- **Keys.** The VAPID pair comes from `.env` when both halves are set, else from `integration_secret`,
  else it is generated once, the first time a browser asks for it, and stored. Subject
  `VAPID_SUBJECT` (`mailto:jbspraxisllc@gmail.com`).

## 7 · Events, jobs and notifications

| Event / job | When | Does |
|---|---|---|
| `notifications.fanout` (outbox, every event) | After any event commits | Writes the rows, hands them to `notification-deliver` |
| `notification-deliver` (job) | Per event with rows | Socket `notification`; email; queues `notification-push` per row with `push`, at once (counted as `push_queued`) |
| `notification-push` (job) | Per row; per urgent repeat (`round`); a test from `push.test_requested` | Skips a notice read meanwhile (`skipped_read`, not Security; a repeat skips a closed notice), sends to each device still owed in its round, records `push_delivery`, revokes dead subscriptions; fails to be retried while a device is owed |
| `urgent-repeats` (scheduler, every 5 minutes, and its job) | 08:00 to 18:00 Lagos | Alerts again each open urgent notice due (§6): socket `notification` with its `repeat`, and `notification-push` for the next round |
| `notification.read`, `notification.read_all` | A read mark | Tells the person's other tabs (`notification_read`) |
| `notification.acknowledged` | Acknowledge on the urgent bar | Tells the person's other tabs (`notification_read`); the record's module hears it (an announcement records the acknowledgement) |
| `announcement.acknowledged` (community) | Acknowledge on the announcement in #announcements | Marks the person's notices of that announcement acknowledged and read, and tells their other tabs |
| `notification.preference_changed` | A switch in Notification Settings | Audit |
| `push_subscription.saved`, `push_subscription.removed`, `push_subscription.renewed` | Turn On, a re-sync that adds or moves a device; Turn Off, a removed or refused device; a service worker's renewal | Audit |
| `push.test_requested` | Send Test | Outbox queues the test on `notification-push` (`push-test-<event_id>`) |
| `app_user.suspended`, `employee.archived`, `auth.session_ended` (Sign Out Everywhere, Sign Out Others) | Suspension, leaving, every session ended at once | Revoke the person's subscriptions (`suspended`, `left`, `signed_out`); Sign Out Others keeps the device it was pressed on (`kept_session_id`) |

## 8 · Permissions and visibility by role

| Role | Sees | Can do |
|---|---|---|
| Everyone signed in | Their own notices, devices and preferences | Read and mark them, switch channels, turn push on or off, send a test |
| A device holding a device token | Nothing | Mark one of its owner's notices read; renew its own subscription |

No restricted fields. A notice whose record the reader may not open shows no link and opens nothing.

## 9 · AI and search

- **AI reads**: none (`ai:none`): a person's notices are about other records, which their own modules answer.
- **AI routes**: none.
- **Search**: no record type (`search:none` on the controller). ⌘K actions: Notification Settings,
  Turn On Notifications, Send Test Notification, Mark All Read.

## 10 · On screen and mobile

What each screen shows open, what sits behind help, and how it is laid out on a phone
(FRONTEND_GUIDE §5, §7). §3 and §6 are for engineers: nothing in them reaches a screen unless it is
listed here as tier 1 or tier 2.

### 10.1 Content tiers

| Screen | Open (tier 1) | Behind help (tier 2) | Not on screen (tier 3), lives in |
|---|---|---|---|
| Notification pane | Notifications; All and Unread with counts; Today, Yesterday, Earlier; each row's avatar or glyph, title, two lines of text, time, unread dot; Mark Read on hover (desktop); Mark All Read; the gear; Turn On with "Notifications are off on this device" when push is off | None | How the fan-out, hold and grouping work: §3 and §6 |
| Notification Settings | This Device with On, Off, Blocked, Install First, Not Supported or Not Available; Turn On, Turn Off, Send Test, Install App; Sound in App; Other Devices (only when there are any), each with Remove Device; Notice Categories with In App, Email and Push switches, Security's locked ones reading Always on | Help term on Sound in App (Android only): "Android does not tell the app when the phone is on vibrate, so the app only vibrates unless this is on." Help term Allow in Browser when Blocked: "Open this site's settings in your browser, allow notifications, then come back here." | Key storage, delivery retries, revocation rules: §6, the runbook |
| In-app banner | The notice's title and two lines of text, avatar or glyph, Dismiss (×); red when urgent, amber when important | None | How every device is alerted: §3 |
| Urgent bar | The newest open urgent notice's title; "1 of 3" when more are open; Acknowledge (an urgent announcement) or Open; the arrows to step through them on desktop | None | The repeat schedule and what closes a notice: §6 |
| Turn-on notice | "Get notified of new mail and approvals"; Not Now, Turn On | None | Why the browser's own prompt is not used: §6 |

### 10.2 Phone layout

| Screen | First on a phone | Left off a phone | Main action | Navigation |
|---|---|---|---|---|
| Notification pane | Full-screen page from the right: Back, Notifications, Mark All Read, the gear; All and Unread; the day groups | Nothing | Tap a row to open it; swipe left to mark it read | Back or the system back gesture closes it |
| Notification Settings | Full-screen page over the pane from the gear: This Device first, then Other Devices, then Notice Categories, one row per category saying what is on ("In App, Push" or Off), each opening a sheet with its three switches | The categories table (desktop only) | Turn On for this device | Back returns to the pane |
| In-app banner | Drops from under the status bar, 44 px targets | The time | Tap to open | Swipe up dismisses |
| Urgent bar | Full width under the top bar on every screen: the title on one line and the count | The step arrows (swipe the bar sideways instead) | Acknowledge or Open, 44 px | Stays until every urgent notice is closed |

## 11 · Edge cases

- **App open on the device a push reaches.** The notification shows anyway (TB, 19/10/2026), and
  the service worker posts the push to the page, which shows its banner unless the socket's copy
  already did. A signed-out or locked page shows no banner; the notification is still there.
- **Signed out, session ended, or locked.** The push still arrives; the tap opens the record's URL;
  the sign-in or lock screen keeps the URL and opens the record once signed in.
- **Someone else signed in on the device.** The subscription moves to them on their next start;
  the earlier person's pushes stop there.
- **Browser replaced the subscription** (`pushsubscriptionchange`). Renewed with the device token;
  if that fails, the next app start subscribes again.
- **Server key changed** (`.env` pair added, or the stored pair rotated). Pushes to old
  subscriptions are refused (401 or 403) and revoked; each app subscribes again on its next start.
- **Permission blocked.** This Device reads Blocked, with the steps behind a help term (Allow in
  Browser); nothing is asked again.
- **iPhone not installed.** This Device reads Install First and offers Install App, which shows the
  Add to Home Screen steps; the turn-on notice waits until the app is installed.
- **Two windows of the app open, or one in the background.** Only a window on screen shows the
  banner and sounds; one behind other windows or tabs only reloads its bell, and the device's own
  notification sounds.
- **A device turned off, then the app restarted.** Turn Off is remembered on that device, so the
  next start does not subscribe again; Turn On (or the pane's Turn On) does.
- **A notice read before its push goes** (the seconds before the job runs). Skipped, recorded as
  `skipped_read`.
- **A burst in one channel.** Every post alerts; on a device they share one notification that
  counts them ("#general · 4 new").
- **The person who acted.** Never told of their own action, so an announcement posted from an
  account never alerts a device signed in as that same account. Test with two people.
- **Acknowledged on one device.** The bar closes on every other device at once (`notification_read`)
  and the repeats stop; the device's earlier notification closes when the app comes to the front.
- **Urgent with no device turned on.** The bar and the banner in the app still repeat; nothing is
  pushed.
- **Written at night.** It alerts at once and repeats from 08:00 Lagos time. After 8 repeats in a
  day it waits for the next morning.
- **Suspended or left.** Repeats stop with the person's devices.
- **Payload too large.** The text is cut to fit 3 KB before sending (the title to 120 characters,
  the text to 600 and then shorter until it fits).

## 12 · Donor code

| From | File | Change on the way in |
|---|---|---|
| praxis-ls | `shared/push/push.service.js` (MILESTONES §11) | Not available in this environment; built new on `web-push` to this guide |

## 13 · Open questions

TB answered the eight questions of PR #72 and the twelve of this work on 19/10/2026
(`docs/handoff/push-notifications.md` §2, `docs/handoff/notifications-everywhere.md` §2). Three
assumptions wait on TB (`notifications-everywhere.md` §2.1): Urgent and Security pass a person's
quiet hours; reading on one device still clears the others; Settings · Notifications moves from M6.

## 14 · Change log

- 19/10/2026 · TB · Guide written before the build, from TB's eight answers: web push, the banner,
  the pane on both shells and Notification Settings brought forward from M6.
- 19/10/2026 · TB · Built (PR #72). As built, beyond the draft: `POST /push/subscriptions` answers
  `PushDeviceSaved` and also takes `push_subscription_id` with the browser's `device_token`, so a
  browser whose endpoint changed keeps its device; the socket's `notification` is the contract's
  `Notification`; the service worker asks the visible windows on a message channel (1.5 s) before
  showing a notification, and Safari always shows one; grouped notifications read "Name · 2 new"
  and "#general · 4 new posts"; a quiet channel post goes with low urgency; refused device tokens
  are limited per address; This Device reads On, Off, Blocked, Install First, Not Supported or Not
  Available, with Install App on an iPhone in Safari; a window in the background shows no banner and
  plays no chime. §2 to §7, §10 and §11 updated. Running it on the server:
  `docs/runbooks/push-notifications.md`.
- 19/10/2026 · TB · From TB's twelve answers (`docs/handoff/notifications-everywhere.md`): every
  device is alerted at once, the one in hand included (the hold and the service worker's silence
  for an open app are gone); every channel post alerts; urgency (normal, important, urgent) with
  Acknowledge, the urgent bar on every screen and urgent repeats every 30 minutes of the working
  day; Security and approvals past their time limit are urgent. Status back to In progress until it
  is built. §1 to §7, §10, §11 and §13 updated.
