# Notifications · Engineering Guide

| | |
|---|---|
| Owner | TB |
| Milestone | M0 (web push and personal preferences brought forward from M6 by TB, 19/10/2026; urgency, every device and urgent repeats added the same day; Settings · Notifications, the reminder engine, the daily digest and quiet hours brought forward from M6 the same day) |
| Backend modules | `notifications` |
| Frontend paths | `app/src/features/notifications/`, `app/src/shell/Bell.tsx`, `app/src/sw.ts`, `app/src/features/settings/Notifications.tsx` |
| Permission key(s) | `settings` (view, edit) for Settings · Notifications, the company's rules; every other route is the caller's own (`self`), and two are reached by a device token (`anonymous`) |
| Capabilities | none |
| Screens (PROGRESS.md rows) | #74 Settings · Notifications (brought forward from M6); the bell, its pane, the banner, the urgent bar and Notification Settings are shell parts on every screen |
| Status | Built |
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
screen and comes back every half hour of the working day until you deal with it. What waits on you
is brought back to you: an approval still undecided, a probation about to end, and a morning email
of what you have not read. Every member of staff uses it; the people who act on approvals, mail and
messages depend on it most. People decide for the whole company who is told of what, and how, in
Settings · Notifications; each person decides where their own notices reach them, and when to be
left alone.

## 2 · Screens affected

| Screen / tab (slug) | Where | Who sees it | What it shows | What a person can do there |
|---|---|---|---|---|
| The bell (top bar on both shells) | Staff app, every screen | Everyone signed in | A dot while anything is unread | Open the pane |
| Notification pane, phone | Full-screen page over any screen | Everyone | All and Unread with counts; rows grouped Today, Yesterday, Earlier; Turn On when push is off on this device | Open a notice (marks it read), swipe left to mark read, Mark All Read, pull to refresh, the gear |
| Notification pane, desktop | Panel under the bell | Everyone | The same rows and groups in a 420 px panel | Open, Mark Read on hover, Mark All Read, the gear |
| Notification Settings | Phone: full-screen page from the gear; desktop: modal; ⌘K | Everyone, their own | This Device (push status, Sound in App), Other Devices (when there are any), Notice Categories with In App, Email and Push, Quiet Hours, Daily Digest (while the company sends one) | Turn On or Turn Off push here, Send Test, Install App (an iPhone in Safari), remove another device, switch a channel per category, turn quiet hours on and set them, turn the digest off |
| Settings · Notifications (`settings`, tab `notifications`) | Staff app, Settings | Holders of `settings` view (the CEO, Operations & People, Management, the Administrator, Implementation) | Reminders: Approvals Waiting, Probation Ending and Daily Digest with what each is set to; Notices: every notice with who it goes to, its default channels, urgency and On or Off, 25 a page, filtered by category and searched | With `settings` edit: edit a reminder; edit a notice (On or Off, urgency, default In App, Email and Push, add roles or people where it takes copies), Reset to Default |
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
8. **The company's rules.** Before step 1 writes a row, the fan-out reads the notice's rule from
   Settings · Notifications (`notification_rule`): Off tells nobody (Security excepted); the roles
   and people added receive the notice's copy; the urgency set there replaces the code's; its
   default channels apply wherever the person has not chosen their own (§6).
9. **Reminders.** Every 5 minutes the `reminders` scheduler finds what has come due (approvals
   still waiting, probations about to end, and whatever a module scheduled), checks each is still
   due, and emits its event, which the fan-out turns into notices like any other: every device,
   the banner, urgency. At the company's digest time it queues each person's daily digest on the
   `reminders` queue, which emails what arrived unread in the last 24 hours.
10. **Quiet hours.** `notification-deliver` holds a person's pushes until their quiet hours end
   (a delayed `notification-push`, skipped if the notice was read meanwhile); urgent notices and
   Security go at once. The bell, the banner in an open app and email are not held.

## 4 · Data

| Table | Key columns | Notes |
|---|---|---|
| `notification` | `notification_id`, `user_id`, `event_id`, `event_key`, `category`, `priority`, `title`, `body`, `entity_type`, `entity_id`, `channels`, `read_at`, `delivery_queued_at`, and from `0470`: `urgency` (`normal`, `important`, `urgent`), `acknowledge_required`, `acknowledged_at`, `repeat_count`, `last_alert_at`, `repeat_day`, `repeats_on_day` | Written by the fan-out, one row per (event, user); this module marks it read, acknowledged and repeated |
| `notification_preference` | `user_id`, `category`, `channel`, `enabled` | A row only where the person changed a default |
| `push_subscription` | `push_subscription_id`, `user_id`, `endpoint` (unique), `p256dh`, `auth`, `expires_at`, `revoked_at`, and from `0460`: `known_device_id`, `label`, `platform`, `device_token_hash`, `vapid_key_id`, `last_seen_at`, `last_success_at`, `last_failure_at`, `failure_count`, `last_error`, `revoked_reason` (`turned_off`, `refused`, `moved`, `signed_out`, `suspended`, `left`) | One per browser install. Subscribing again from the same browser updates the row and moves it to whoever is signed in; `device_token_hash` is the hash of the token its service worker shows (§5) |
| `push_delivery` (new, `0460`) | `push_delivery_id`, `notification_id` (null for a test), `push_subscription_id`, `status` (`sent`, `failed`, `gone`, `skipped_read`), `http_status`, `error`, `attempts`, `sent_at`, and from `0470`: `round` (0 the first alert, then each urgent repeat) | Unique per (notification, subscription, round): a retried job sends only to the devices still owed |
| `integration_secret` | provider `web_push`, key `vapid` | The environment's VAPID pair, encrypted with `ENCRYPTION_KEY`, made the first time a browser asks for it (`GET /push/config`) when `.env` gives none |
| `notification_rule` (new, `0480`) | `notification_rule_id`, `event_key` (unique), `enabled`, `urgency` (null: as the code says), `in_app`, `email`, `push` (each null: the category's default), `updated_by`, `updated_at` | The company's rule for one notice. A row only where People changed something; Reset to Default deletes it |
| `notification_rule_recipient` (new, `0480`) | `notification_rule_recipient_id`, `notification_rule_id`, `role_id` or `user_id` (exactly one) | The roles and people a notice is copied to. Unique per rule and role, per rule and person |
| `notification_reminder_rule` (new, `0480`) | `notification_reminder_rule_id`, `reminder_key` (`approvals`, `probation`, `digest`, unique), `enabled`, `every_hours`, `days_ahead`, `at_time`, `updated_by`, `updated_at` | The company's reminders. A row only once People save one; until then the defaults in §6 apply |
| `notification_setting` (new, `0480`) | `notification_setting_id`, `user_id` (unique), `quiet_enabled`, `quiet_from`, `quiet_to`, `digest`, `digest_sent_on` | A person's quiet hours and digest switch, and the Lagos day their last digest was decided. Made the first time either is needed |
| `reminder` (new, `0480`) | `reminder_id`, `reminder_key`, `entity_type`, `entity_id`, `occurrence`, `due_at`, `every_minutes`, `work_hours`, `payload`, `fired_count`, `last_fired_at`, `state` (`pending`, `done`, `cancelled`) | One occurrence of a declared reminder (§7.1). Unique per (key, record, occurrence), so finding or scheduling it twice adds nothing |

Schema migration file(s): `migrations/0460_web_push.sql`, `migrations/0470_notification_urgency.sql`,
`migrations/0480_notification_rules.sql`.
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
| `GET /api/v1/notifications/preferences` | → `NotificationPreferences` | self | | Every category with its three channels, defaults applied, `locked`; the person's quiet hours; the digest (theirs, and whether the company sends one, at what time) |
| `PUT /api/v1/notifications/preferences` | `NotificationPreferenceUpdate` → `NotificationPreferences` | self | | One category and channel per call; switching off a locked channel is 422 `CATEGORY_LOCKED`, an unknown category 404 |
| `PUT /api/v1/notifications/preferences/quiet-hours` | `QuietHoursUpdate` → `NotificationPreferences` | self | | On or off, from and to (HH:MM, Lagos); the same time twice is 422 |
| `PUT /api/v1/notifications/preferences/digest` | `DigestUpdate` → `NotificationPreferences` | self | | The person's own digest on or off |
| `GET /api/v1/notifications/rules` | `NotificationRuleQuery` → `NotificationRulePage` | `settings` view · all | yes, 25 | Every notice with its rule applied, in category order; `category`, `q` (the notice's name) |
| `PUT /api/v1/notifications/rules/:key` | `NotificationRuleUpdate` → `NotificationRule` | `settings` edit · all | | The whole rule for one notice. 404 for a key that is not a notice; 422 `NOTICE_LOCKED` switching off a Security notice, its channels, or its urgency; 422 `NOTICE_TAKES_NO_COPIES` adding roles or people to a personal notice; 422 `URGENCY_SET_BY_POSTER` for an announcement |
| `POST /api/v1/notifications/rules/:key/reset` | `EmptyBody` → `NotificationRule` | `settings` edit · all | | Back to the code's defaults (the rule and its copies deleted) |
| `GET /api/v1/notifications/reminders` | → `NotificationReminders` | `settings` view · all | | The three reminders, defaults applied |
| `PUT /api/v1/notifications/reminders` | `NotificationRemindersUpdate` → `NotificationReminders` | `settings` edit · all | | All three at once; a changed approval interval moves the next reminder of every waiting approval |
| `GET /api/v1/notifications/push/config` | → `PushConfig` | self | | `enabled`, the public key and its id |
| `POST /api/v1/notifications/push/subscriptions` | `PushSubscriptionCreate` → `PushDeviceSaved` | self | | Upsert by endpoint, or by `push_subscription_id` with the browser's `device_token` when its endpoint changed; moves the device to the caller; `device_token` is issued once (null when the browser proved the one it holds) |
| `GET /api/v1/notifications/push/devices` | `PushDeviceListQuery` → `PushDevicePage` | self | yes, 25 | The caller's devices with push on |
| `POST /api/v1/notifications/push/devices/:id/remove` | `EmptyBody` → 204 | self | | Turns push off for that device (`turned_off`) |
| `POST /api/v1/notifications/push/test` | `PushTestRequest` → `PushTestResult` | self | | `push.test_requested`: the worker sends to one device or all, always shown; answers how many devices |
| `POST /api/v1/notifications/push/renew` | `PushRenew` → 204 | anonymous, device token | | The service worker after `pushsubscriptionchange`. A wrong token (or a device turned off) is 403 `DEVICE_NOT_RECOGNISED`; 30 refusals in 15 minutes from one address are refused for the rest of the window (`pushDeviceLimiter`) |
| `POST /api/v1/notifications/push/read` | `PushDeviceRead` → 204 | anonymous, device token | at most 25 ids | Mark Read on a notification; the same limit and refusal |

## 6 · Rules and calculations

- **Channels.** For each channel (In App, Email, Push) of a notice, in order: the person's own
  switch for its category (Notification Settings); else the company's default for that notice
  (Settings · Notifications); else the category's default (`categories.js`). Security cannot be
  switched off where it is on by default, by the person or the company. A person with every channel
  off gets no row.
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

**Settings · Notifications (TB, 19/10/2026)**

- **The notices.** Every `defineNotification` declaration is a notice, and so is every Security
  event that only reaches the access watchers. Its name is its event's summary in the catalogue
  (`shared/events/catalogue.js`); its category is the one its rows take. Who it goes to as built is
  read from the declaration: the approvers, the requester, the employee it is about, the CEO, the
  holders of a permission ("People · Approve"), or the `who` a declaration gives for an audience its
  code chooses ("The channel's members"); a Security event adds "The CEO and Settings editors".
- **On or Off.** Off tells nobody, company-wide, on any channel. A notice in the Security category
  or marked Security in the catalogue is always on.
- **Copies.** People may add roles and named people to a notice written about someone else: its
  declaration gives `copy` (`true`, or the title and text a copy reads, as "Waiting on its
  approvers" where the notice says "Waiting on you"). They receive it as the copy, through their own
  channels, unless they are already in its audience; nobody is told of their own action. A notice
  personal to its audience (a direct message, a channel post, mail, a person's own account and
  sign-in, "your import finished", an announcement, whose audience its poster chose) takes no
  copies. Suspended people and people who left are never told; a role's holders are read when the
  notice is written.
- **Urgency.** People may set Normal, Important or Urgent for a notice whose urgency the code
  fixes. Security stays urgent; an announcement keeps the level its poster chose. A notice People
  make urgent stays in the urgent bar and repeats until opened (only an urgent announcement needs
  Acknowledge).
- **Default channels.** In App, Email and Push per notice, used for everyone who has not switched
  that channel for the notice's category themselves. Security's channels that are on by default stay
  on.
- **Reset to Default** deletes the rule and its copies: the notice behaves as the code says again.

**Reminders (the company's, Settings · Notifications)**

| Reminder | Default | Who | What it says |
|---|---|---|---|
| Approvals Waiting | On, every 24 hours (1 to 168), 08:00 to 18:00 Lagos | The approvers of the stage it waits on (copies as People add them) | "Reminder: Leave request", "Line manager has waited 2 days on you." Important (amber). Stops when the approval is decided, withdrawn or moves on; a new stage starts its own count |
| Probation Ending | On, 14 days ahead (1 to 90), at 09:00 Lagos | Holders of People · Approve over the person: People (scope all) and the line managers above them | "Probation ending: Ada Okafor", "Confirmation is due on 02/11/2026." Once per due date; a new due date reminds again; none once confirmed or archived |
| Daily Digest | On, at 07:30 Lagos | Each person, by email, unless they turned it off | Up to 25 notices that arrived in the last 24 hours and are still unread, newest first, with how many more; nothing is sent when there are none |

A reminder is an ordinary notice (`workflow.reminded`, `employee.probation_ending`): People can
switch it off, copy it, change its urgency and channels like any other. A changed approval interval
moves the next reminder of every approval already waiting. Turning a reminder off stops it; turning
it on again reminds what is still waiting at the next tick.

**Quiet hours (each person's own)**

- Off until the person turns them on in Notification Settings (TB, 19/10/2026); 21:00 to 07:00
  when first turned on, any two different times, across midnight or not, Lagos time.
- During them, a push waits until they end, then goes unless the notice was read meanwhile.
  Urgent notices and Security come through at once (assumption A, `notifications-everywhere.md`).
  The bell, the banner in an open app and email are not held; neither is Send Test.

## 7 · Events, jobs and notifications

| Event / job | When | Does |
|---|---|---|
| `notifications.fanout` (outbox, every event) | After any event commits | Writes the rows, hands them to `notification-deliver` |
| `notification-deliver` (job) | Per event with rows | Socket `notification`; email; queues `notification-push` per row with `push`, at once (counted as `push_queued`) |
| `notification-push` (job) | Per row; per urgent repeat (`round`); a test from `push.test_requested` | Skips a notice read meanwhile (`skipped_read`, not Security; a repeat skips a closed notice), sends to each device still owed in its round, records `push_delivery`, revokes dead subscriptions; fails to be retried while a device is owed |
| `urgent-repeats` (scheduler, every 5 minutes) | 08:00 to 18:00 Lagos | Alerts again each open urgent notice due (§6): socket `notification` with its `repeat`, and `notification-push` for the next round |
| `notification.read`, `notification.read_all` | A read mark | Tells the person's other tabs (`notification_read`) |
| `notification.acknowledged` | Acknowledge on the urgent bar | Tells the person's other tabs (`notification_read`); the record's module hears it (an announcement records the acknowledgement) |
| `announcement.acknowledged` (community) | Acknowledge on the announcement in #announcements | Marks the person's notices of that announcement acknowledged and read, and tells their other tabs |
| `notification.preference_changed` | A switch in Notification Settings | Audit |
| `push_subscription.saved`, `push_subscription.removed`, `push_subscription.renewed` | Turn On, a re-sync that adds or moves a device; Turn Off, a removed or refused device; a service worker's renewal | Audit |
| `push.test_requested` | Send Test | Outbox queues the test on `notification-push` (`push-test-<event_id>`) |
| `app_user.suspended`, `employee.archived`, `auth.session_ended` (Sign Out Everywhere, Sign Out Others) | Suspension, leaving, every session ended at once | Revoke the person's subscriptions (`suspended`, `left`, `signed_out`); Sign Out Others keeps the device it was pressed on (`kept_session_id`) |
| `reminders` (scheduler, every 5 minutes) | Always | Each declared reminder's `find` adds what has come due (Approvals Waiting, Probation Ending); every due occurrence is checked and fired in its own transaction (§7.1); from the digest time on, each person's digest for the day is queued once (`digest-<user>-<day>`) |
| `reminders` (job, `digest`) | Per person and Lagos day | Emails the digest (`templates/email/digest.html`) when something arrived unread in the last 24 hours; paced like all system mail |
| `workflow.reminded` | An approval has waited its interval | The stage's approvers: "Reminder: <approval>" (important) |
| `employee.probation_ending` | The probation reminder's day | People · Approve holders over the person |
| `notification_rule.changed` | Save or Reset to Default on a notice | Audit (the notice, what it is now, who changed it) |
| `notification_reminder.changed` | Save on Reminders | Audit; moves the next reminder of waiting approvals when the interval changed |
| `notification_setting.changed` | Quiet hours or the digest switched by a person | Audit |

### 7.1 Reminders for modules (the recipe)

One engine (`src/modules/notifications/notifications.reminders.js`) runs every reminder; a module
never writes its own clock for one. M2's tasks and calendars are its first users after the company's
reminders.

1. **Declare the event** in the module's `<module>.events.js` (`"task.due_soon": { summary: "A task
   is due soon" }`) and its notice with `defineNotification` (who, what it says, its urgency,
   `copy` when it is about someone else). People see it in Settings · Notifications at once.
2. **Declare the reminder** once, beside it:

   ```js
   const reminders = require("../notifications/notifications.reminders");

   reminders.defineReminder("task_due_soon", {
     event: EVENTS.TASK_DUE_SOON,
     module: "workspace",
     // Before each firing, in the firing's transaction: null ends it; { later } moves it;
     // { entity, payload } fires the event with that payload.
     check: async (client, row) => {
       const task = await repo.findOpen(client, row.entity_id);
       return task ? { entity: { type: "task", id: task.task_id }, payload: { title: task.title } } : null;
     },
   });
   ```

3. **Schedule and cancel inside your own transaction**, beside the change that makes it due:
   `await reminders.schedule(client, { key: "task_due_soon", entity: { type: "task", id }, occurrence:
   due_on, at, every_minutes, work_hours })` and `await reminders.cancel(client, { key, entity })`.
   Scheduling the same (key, record, occurrence) again moves it and starts its count again; a new
   occurrence (a new due date) is a new reminder.
4. **Repeat** with `every_minutes` (at least 5) and `work_hours: true` (08:00 to 18:00 Lagos): an
   overdue task every day until done, an event "starting in 15 minutes" once. A reminder whose
   `check` answers null is finished, so a closed record never reminds.
5. **Or find instead of schedule**, for something that becomes due by the calendar alone (a date on
   a record): `find: async (client, { now, rule }) => [{ entity_type, entity_id, occurrence, due_at,
   payload }]`, called every tick; what it returns is added once (Probation Ending works this way).
6. Test it with `reminders.tick({ now })` in an integration test: it finds, fires and returns what
   it did, with the clock you give it.

## 8 · Permissions and visibility by role

| Role | Sees | Can do |
|---|---|---|
| Everyone signed in | Their own notices, devices and preferences | Read and mark them, switch channels, turn push on or off, send a test, set quiet hours, turn their digest off |
| Holders of `settings` view (scope all) | Settings · Notifications: every notice's rule, the reminders | Nothing |
| Holders of `settings` edit (scope all): Operations & People, the Administrator, Implementation, the CEO | The same | Edit a notice's rule or reset it; edit the reminders |
| A device holding a device token | Nothing | Mark one of its owner's notices read; renew its own subscription |

No restricted fields. A notice whose record the reader may not open shows no link and opens nothing.

## 9 · AI and search

- **AI reads**: none (`ai:none`): a person's notices are about other records, which their own modules answer.
- **AI routes**: none.
- **Search**: no record type (`search:none` on the controller): a notice's rule is a setting, not a
  record. ⌘K actions: Notification Settings, Turn On Notifications, Send Test Notification, Mark All
  Read; Settings · Notifications is reached as a screen (the route map's `settings` tab).

## 10 · On screen and mobile

What each screen shows open, what sits behind help, and how it is laid out on a phone
(FRONTEND_GUIDE §5, §7). §3 and §6 are for engineers: nothing in them reaches a screen unless it is
listed here as tier 1 or tier 2.

### 10.1 Content tiers

| Screen | Open (tier 1) | Behind help (tier 2) | Not on screen (tier 3), lives in |
|---|---|---|---|
| Notification pane | Notifications; All and Unread with counts; Today, Yesterday, Earlier; each row's avatar or glyph, title, two lines of text, time, unread dot; Mark Read on hover (desktop); Mark All Read; the gear; Turn On with "Notifications are off on this device" when push is off | None | How the fan-out, hold and grouping work: §3 and §6 |
| Notification Settings | This Device with On, Off, Blocked, Install First, Not Supported or Not Available; Turn On, Turn Off, Send Test, Install App; Sound in App; Other Devices (only when there are any), each with Remove Device; Notice Categories with In App, Email and Push switches, Security's locked ones reading Always on; Quiet Hours and Digest: Quiet Hours with its switch and, when on, From and To; Daily Digest with its switch and "Each day at 07:30", while the company sends one | Help term on Sound in App (Android only): "Android does not tell the app when the phone is on vibrate, so the app only vibrates unless this is on." Help term Allow in Browser when Blocked: "Open this site's settings in your browser, allow notifications, then come back here." Help term on Quiet Hours: "Pushes wait until these hours end. Urgent notices and security alerts still come through." | Key storage, delivery retries, revocation rules: §6, the runbook |
| Settings · Notifications | Notifications (title), "Who is told, how and when" (desktop subtitle); Reminders: each reminder's name, what it is set to ("Every 24 hours", "14 days ahead", "Daily at 07:30") and On or Off, Edit Reminders (settings edit); Notices: the search, the category filter, and per notice its name, who it goes to, its channels, its level with Off or Always On; Edit Notice with the notice's name, category and who, On, Level, In App, Email, Push, Add Roles, Add People, Reset to Default | Help term on Add Roles and People: "They receive a copy of this notice. Notices meant for one person take no copies." Help term on Level: "Urgent stays in a red bar and repeats every 30 minutes until opened." | How the fan-out applies a rule, the reminder engine, the copies' wording: §3, §6, §7.1 |
| In-app banner | The notice's title and two lines of text, avatar or glyph, Dismiss (×); red when urgent, amber when important | None | How every device is alerted: §3 |
| Urgent bar | The newest open urgent notice's title; "1 of 3" when more are open; Acknowledge (an urgent announcement) or Open; the arrows to step through them on desktop | None | The repeat schedule and what closes a notice: §6 |
| Turn-on notice | "Get notified of new mail and approvals"; Not Now, Turn On | None | Why the browser's own prompt is not used: §6 |

### 10.2 Phone layout

| Screen | First on a phone | Left off a phone | Main action | Navigation |
|---|---|---|---|---|
| Notification pane | Full-screen page from the right: Back, Notifications, Mark All Read, the gear; All and Unread; the day groups | Nothing | Tap a row to open it; swipe left to mark it read | Back or the system back gesture closes it |
| Notification Settings | Full-screen page over the pane from the gear: This Device first, then Other Devices, then Notice Categories, one row per category saying what is on ("In App, Push" or Off), each opening a sheet with its three switches; then Quiet Hours and Daily Digest | The categories table (desktop only) | Turn On for this device | Back returns to the pane |
| Settings · Notifications | Reminders as three rows (name, what it is set to, On or Off), then the search and the category filter, then Notices as cards of 25 (the name, then Who, Channels and Level with Off or Always On) | The table (cards instead) | Tap a card: Edit Notice in a sheet, Save Notice in its footer | Pager under the cards; the sheet closes with Cancel or a swipe down |
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
- **The company switched a notice off, a person switched its category on.** Off wins: nobody is
  told. The person's own switch only chooses channels for what is sent.
- **A copy to someone already in the audience.** They get the notice once, as its audience reads
  it.
- **A role added as a copy loses or gains holders.** Who holds it is read each time a notice is
  written; a removed role takes its copies with it (`ON DELETE CASCADE`).
- **An approval decided, withdrawn or moved on between two reminders.** The check before firing
  finds it closed (or at another stage) and ends that reminder; a new stage counts from when it
  started.
- **A probation's due date changed or the person confirmed.** A new date is a new occurrence and
  reminds again; the old one's check finds the date gone and ends it; a confirmed or archived
  person is never reminded.
- **Reminders and the digest while the worker was down.** What came due fires at the next tick,
  once; a digest day already passed is not sent late.
- **Quiet hours across midnight** (21:00 to 07:00): a push at 23:00 goes at 07:00; one at 06:59
  goes at 07:00 too. Turning quiet hours off does not bring held pushes forward; they go at the old
  end time.
- **Nothing unread in the last day.** No digest. A person who reads everything never receives one.
- **The digest's time changed after today's was sent.** Tomorrow's goes at the new time.

## 12 · Donor code

| From | File | Change on the way in |
|---|---|---|
| praxis-ls | `shared/push/push.service.js` (MILESTONES §11) | Not available in this environment; built new on `web-push` to this guide |

## 13 · Open questions

TB answered the eight questions of PR #72 and the twelve of this work on 19/10/2026
(`docs/handoff/push-notifications.md` §2, `docs/handoff/notifications-everywhere.md` §2). Three
assumptions wait on TB (`notifications-everywhere.md` §2.1): Urgent and Security pass a person's
quiet hours; reading on one device still clears the others; Settings · Notifications moves from M6.
The design choices of Settings · Notifications (copies only on notices about someone else, which
channel wins, the reminders' defaults) are in `notifications-everywhere.md` §5, open to TB.

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
  day; Security and approvals past their time limit are urgent. §1 to §7, §10, §11 and §13 updated.
- 19/10/2026 · TB · Settings · Notifications (#74) brought forward from M6, from TB's decisions 10
  to 12 (`docs/handoff/notifications-everywhere.md` §2, §5): the company's rule per notice (On or
  Off, copies to roles and people where the notice allows, urgency, default channels), the
  reminders (Approvals Waiting, Probation Ending, Daily Digest) on one reminder engine with a
  recipe for M2 (§7.1), and each person's quiet hours and digest switch. §1 to §11 updated.
- 19/10/2026 · TB · Built (PR 1 of `docs/handoff/notifications-everywhere.md`). As built: urgent
  repeats run on the notice rows (`0470`; the general reminder engine follows with Settings ·
  Notifications); `UrgentBar` in `@mycity/ui` sits in the shells' new `alert` slot; a module's nav
  count shows red while an urgent notice waits there; a read mark or Acknowledge on another device
  reloads the bell and the bar; the service worker keeps an urgent notification on screen until
  acted on, and a repeat replaces it without counting as new. Checked in Chromium (pushes over the
  DevTools protocol) and by the whole `npm run ci`.
- 19/10/2026 · TB · Built (PR 2 of `docs/handoff/notifications-everywhere.md`). As built: Settings ·
  Notifications lists the notices from the code (`fanout.notices()`, the API loading every module's
  declarations), each named by its event's summary; the Reminders card edits all three at once;
  Edit Notice opens in a modal on desktop and a sheet on a phone; Notification Settings gains a
  Quiet Hours and Digest card. Checked by the `notifications-rules` integration suite and the
  whole `npm run ci`.
