# Notifications · Engineering Guide

| | |
|---|---|
| Owner | TB |
| Milestone | M0 (web push and personal preferences brought forward from M6 by TB, 19/10/2026) |
| Backend modules | `notifications` |
| Frontend paths | `app/src/features/notifications/`, `app/src/shell/Bell.tsx` |
| Permission key(s) | none: every route is the caller's own (`self`), and two are reached by a device token (`anonymous`) |
| Capabilities | none |
| Screens (PROGRESS.md rows) | none of their own: the bell, its pane, the banner and Notification Settings are shell parts on every screen; Settings · Notifications (#74) stays in M6 for company reminder rules |
| Status | Draft |
| Last changed | 19/10/2026 |

The build plan, TB's decisions of 19/10/2026 and the step-by-step status are in
`docs/handoff/push-notifications.md`. Read it first when continuing the build.

---

## 1 · What it is for

Something that happened to you reaches you wherever you are: in the app as a banner and in the
bell, on your phone or computer as a notification when the app is closed, and after your session
has ended, so a mail, a message or an approval is never missed. Every member of staff uses it; the
people who act on approvals, mail and messages depend on it most.

## 2 · Screens affected

| Screen / tab (slug) | Where | Who sees it | What it shows | What a person can do there |
|---|---|---|---|---|
| The bell (top bar on both shells) | Staff app, every screen | Everyone signed in | A dot while anything is unread | Open the pane |
| Notification pane, phone | Full-screen page over any screen | Everyone | All and Unread with counts; rows grouped Today, Yesterday, Earlier; Turn On when push is off on this device | Open a notice (marks it read), swipe left to mark read, Mark All Read, pull to refresh, the gear |
| Notification pane, desktop | Panel under the bell | Everyone | The same rows and groups in a 420 px panel | Open, Mark Read on hover, Mark All Read, the gear |
| Notification Settings | Phone: full-screen page from the gear; desktop: modal; ⌘K | Everyone, their own | This Device (push status, Sound in App), Other Devices, each category with In App, Email and Push | Turn On or Turn Off push here, Send Test, remove another device, switch a channel per category |
| In-app banner | Top of the screen on both shells | The person it is for, app open | Who or what, the line, an avatar or the category's glyph | Tap to open, swipe or × to dismiss |
| Turn-on notice (`ShellNotice`) | Foot of the shell, once per device | Everyone, until answered | One line and two buttons | Turn On, Not Now |
| Phone or computer notification | The device's own notification shade, lock screen and badge | The person, app closed or in the background | Title, line, the MyCity pin, the count | Tap to open the record (through sign-in when the session ended), Mark Read |
| Mailbox (`inbox` and the other folders) | Staff app | The mailbox owner | Unchanged | Reading a conversation marks its notices read |

## 3 · How the screens relate

1. A module commits a change and `emit()`s its event. After commit, the fan-out
   (`src/shared/notifications/fanout.js`) writes one `notification` row per person it notifies,
   with the channels their preferences allow (`categories.js`), and hands the rows to the
   `notification-deliver` job.
2. `notification-deliver` sends `in_app` over the person's socket (`notification`, with a link only
   when they may open its module), mails `email`, and queues one `notification-push` job per row
   carrying `push`. The push job waits 60 s when the person is active in front of the app on any
   device, unless the category is Security.
3. The app that receives `notification` shows the banner (3 s), plays the chime or vibrates (§6),
   updates the dot and the pane. The banner is not shown for the record already on screen.
4. `notification-push` checks the notice is still unread, then sends it to each of the person's
   devices through `services/push` and records each attempt in `push_delivery`.
5. On the device, the service worker shows a notification unless the app is visible there (then the
   page shows the banner instead; on iOS it always shows, see §11). A tap opens
   `<record path>&n=<notification_id>`: the app opens on the record, through sign-in when needed,
   and marks the notice read. Mark Read on the notification marks it read without opening the app.
6. A read mark anywhere (`notification.read`, `notification.read_all`, reading a mail conversation)
   reaches the person's other tabs (`notification_read`); when an app comes to the front it closes
   any notification in its shade that is already read.

## 4 · Data

| Table | Key columns | Notes |
|---|---|---|
| `notification` | `notification_id`, `user_id`, `event_id`, `event_key`, `category`, `priority`, `title`, `body`, `entity_type`, `entity_id`, `channels`, `read_at`, `delivery_queued_at` | Written only by the fan-out; one row per (event, user) |
| `notification_preference` | `user_id`, `category`, `channel`, `enabled` | A row only where the person changed a default |
| `push_subscription` | `push_subscription_id`, `user_id`, `endpoint` (unique), `p256dh`, `auth`, `expires_at`, `revoked_at`, and from `0460`: `known_device_id`, `label`, `platform`, `device_token_hash`, `vapid_key_id`, `last_seen_at`, `last_success_at`, `last_failure_at`, `failure_count`, `last_error`, `revoked_reason` | One per browser install. Subscribing again from the same browser updates the row and moves it to whoever is signed in |
| `push_delivery` (new, `0460`) | `push_delivery_id`, `notification_id` (null for a test), `push_subscription_id`, `status`, `http_status`, `error`, `attempts`, `sent_at` | Unique per (notification, subscription): a retried job never sends twice |
| `integration_secret` | provider `web_push`, key `vapid` | The environment's VAPID pair, encrypted with `ENCRYPTION_KEY`, made on first start when `.env` gives none |

Schema migration file(s): `migrations/0460_web_push.sql`. Reference-data file(s): none.

## 5 · API

| Method and path | Contract | Permission · scope | Paged | Notes |
|---|---|---|---|---|
| `GET /api/v1/notifications` | `NotificationListQuery` → `NotificationPage` | self | yes, 25 | `status` unread or read |
| `GET /api/v1/notifications/unread-count` | → `UnreadCount` | self | | |
| `GET /api/v1/notifications/badges` | → `NavBadges` | self | | |
| `GET /api/v1/notifications/read-state` | `NotificationReadStateQuery` → `NotificationReadState` | self | at most 25 ids | Which of these ids are read, to close shade notifications |
| `POST /api/v1/notifications/:id/read`, `/read-all` | `EmptyBody` | self | | |
| `GET /api/v1/notifications/preferences` | → `NotificationPreferences` | self | | Every category with its three channels, defaults applied, `locked` |
| `PUT /api/v1/notifications/preferences` | `NotificationPreferenceUpdate` → `NotificationPreferences` | self | | One category and channel per call; a locked channel is refused |
| `GET /api/v1/notifications/push/config` | → `PushConfig` | self | | `enabled`, the public key and its id |
| `POST /api/v1/notifications/push/subscriptions` | `PushSubscriptionCreate` → `PushDevice` | self | | Upsert by endpoint; returns the device token once |
| `GET /api/v1/notifications/push/devices` | `PushDeviceListQuery` → `PushDevicePage` | self | yes, 25 | The caller's devices with push on |
| `POST /api/v1/notifications/push/devices/:id/remove` | `EmptyBody` | self | | Turns push off for that device |
| `POST /api/v1/notifications/push/test` | `PushTestRequest` → `PushTestResult` | self | | Sends now to one device or all, always shown |
| `POST /api/v1/notifications/push/renew` | `PushRenew` | anonymous, device token | | The service worker after `pushsubscriptionchange` |
| `POST /api/v1/notifications/push/read` | `PushDeviceRead` | anonymous, device token | | Mark Read on a notification |

## 6 · Rules and calculations

- **Channels.** A notice goes to `in_app` always (the bell is the record), and to `email` and `push`
  as the person's preference for its category says, else the category's default (`categories.js`).
  Security cannot be switched off where it is on by default.
- **Hold.** When the person is active (an app of theirs is visible and was touched in the last
  5 minutes), a push waits 60 s and is sent only if the notice is still unread. Security is sent at
  once.
- **Grouping on a device.** A notice's tag is its conversation: `mail_thread:<id>`,
  `community_channel:<id>` for direct messages and channels, else `n:<notification_id>`. Mail and
  direct messages replace the earlier notification for the same conversation and alert again;
  channel posts replace it quietly ("4 new posts in #general") until it is opened or dismissed.
- **Mail content.** Title: the sender's name, else the address. Body: the subject, a new line, the
  first line of the message (about 140 characters). Shown on the lock screen too.
- **Sound in the app.** A chime at 60% volume for mail, messages and approvals, at most once every
  5 s. iPhone: through the ambient audio session, which the silent switch mutes. Android: vibration
  only, unless Sound in App is on for that device (no browser reports the ringer mode). Closed or
  background apps use the device's own notification sound, which follows its ringer setting.
- **When a device stops.** Push switched off on it; someone else signs in on it (the subscription
  moves to them); the person is suspended or leaves; Sign Out Everywhere or Sign Out Others. A
  session ending or a plain Sign Out does not stop it.
- **Delivery.** TTL 24 hours (security 7 days), urgency high for high priority, the topic is the
  tag (so a newer push for the same conversation replaces a queued one). 404 and 410 revoke the
  subscription; 401 and 403 revoke it (the browser subscribes again with the current key on its
  next start); 429, 5xx and network errors retry with backoff; each (notice, device) is sent once.
- **Keys.** The VAPID pair comes from `.env` when both halves are set, else from `integration_secret`,
  else it is generated once and stored. Subject `VAPID_SUBJECT` (`mailto:jbspraxisllc@gmail.com`).

## 7 · Events, jobs and notifications

| Event / job | When | Does |
|---|---|---|
| `notifications.fanout` (outbox, every event) | After any event commits | Writes the rows, hands them to `notification-deliver` |
| `notification-deliver` (job) | Per event with rows | Socket `notification`; email; queues `notification-push` per row with `push` |
| `notification-push` (job) | Per row, now or after the 60 s hold | Sends to each device, records `push_delivery`, revokes dead subscriptions |
| `notification.read`, `notification.read_all` | A read mark | Tells the person's other tabs (`notification_read`) |
| `notification.preference_changed` | A switch in Notification Settings | Audit |
| `push_subscription.saved`, `push_subscription.removed` | Turn On, a re-sync, Turn Off, a removed device | Audit |
| `push.test_requested` | Send Test | Outbox sends the test push |
| Suspension, leaving, Sign Out Everywhere, Sign Out Others | Those identity and people events | Revoke the person's subscriptions (or the other devices') |

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
| Notification pane | Notifications; All and Unread with counts; Today, Yesterday, Earlier; each row's avatar or glyph, title, line, time, unread dot; Mark All Read; the gear; Turn On with "Notifications are off on this device" when push is off | None | How the fan-out, hold and grouping work: §3 and §6 |
| Notification Settings | This Device with On, Off, Blocked or Needs Install; Turn On, Turn Off, Send Test; Sound in App; Other Devices with Remove; each category with In App, Email and Push switches, Security locked | Help term on Sound in App: "Android does not tell the app when it is on vibrate, so the app vibrates unless this is on." Help term on Blocked: how to allow notifications in the browser's site settings | Key storage, delivery retries, revocation rules: §6, the runbook |
| In-app banner | The notice's title and line, avatar or glyph, × | None | Why the system notification is held back: §3 |
| Turn-on notice | "Get notified of new mail and approvals"; Not Now, Turn On | None | Why the browser's own prompt is not used: §6 |

### 10.2 Phone layout

| Screen | First on a phone | Left off a phone | Main action | Navigation |
|---|---|---|---|---|
| Notification pane | Full-screen page from the right: Back, Notifications, Mark All Read, the gear; All and Unread; the day groups | Nothing | Tap a row to open it; swipe left to mark it read | Back or the system back gesture closes it |
| Notification Settings | Full-screen page from the gear: This Device first, then Other Devices, then the categories, each opening a sheet with its three switches | The categories table (desktop only) | Turn On for this device | Back returns to the pane |
| In-app banner | Drops from under the status bar, 44 px targets | The time | Tap to open | Swipe up dismisses |

## 11 · Edge cases

- **App open on the device a push reaches.** The service worker posts it to the page (deduped with
  the socket's copy) and shows no system notification. On iOS it always shows one: WebKit revokes a
  subscription whose pushes show nothing. The hold usually stops that push from being sent at all.
- **Signed out, session ended, or locked.** The push still arrives; the tap opens the record's URL;
  the sign-in or lock screen keeps the URL and opens the record once signed in.
- **Someone else signed in on the device.** The subscription moves to them on their next start;
  the earlier person's pushes stop there.
- **Browser replaced the subscription** (`pushsubscriptionchange`). Renewed with the device token;
  if that fails, the next app start subscribes again.
- **Server key changed** (`.env` pair added, or the stored pair rotated). Pushes to old
  subscriptions are refused (401 or 403) and revoked; each app subscribes again on its next start.
- **Permission blocked.** This Device reads Blocked, with the steps behind a help term; nothing is
  asked again.
- **iPhone not installed.** This Device reads Needs Install and offers the Add to Home Screen steps.
- **A notice read before its held push goes.** Skipped, recorded as `skipped_read`.
- **A burst in one channel.** One alert, then quiet updates until opened.
- **Payload too large.** The line is cut to fit 3 KB before sending.

## 12 · Donor code

| From | File | Change on the way in |
|---|---|---|
| praxis-ls | `shared/push/push.service.js` (MILESTONES §11) | Not available in this environment; built new on `web-push` to this guide |

## 13 · Open questions

None. TB answered the eight questions on 19/10/2026 (`docs/handoff/push-notifications.md` §2).

## 14 · Change log

- 19/10/2026 · TB · Guide written before the build, from TB's eight answers: web push, the banner,
  the pane on both shells and Notification Settings brought forward from M6.
