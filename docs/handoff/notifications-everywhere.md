# Notifications Everywhere · Build Handoff

**Start here if you are continuing this work in a new session.** This file is self-contained: the
problem, every decision TB took (do not ask them again), the plan in two pull requests, the build
checklist with its status, and a dated log. The design itself is `docs/guides/notifications.md`;
this file is the build plan and its log. It follows `docs/handoff/push-notifications.md` (PR #72,
merged), which built web push, the banner, the pane and personal Notification Settings.

| | |
|---|---|
| Branch | `ccr-59381f61-k83jfs` (push only here; each PR targets `main`; PR 2 starts from `main` after PR 1 merges) |
| Pull requests | PR 1 #81 (merged 19/10/2026); PR 2 not opened yet |
| Owner | TB (Tom-Blake Asaah), who asked for it on 19/10/2026 |
| Type | Full stack (CLAUDE.md step 1) |
| Started | 19/10/2026 |

---

## 0 · How to continue

1. `git fetch origin ccr-59381f61-k83jfs && git checkout ccr-59381f61-k83jfs && git pull`.
2. Read this file in full, then `docs/guides/notifications.md` and `docs/guides/community.md`, then
   what CLAUDE.md step 2 asks for full-stack work.
3. Take the first unticked step in §4. Build it, run its checks, tick it here with the date, add a
   line to §8, commit and push. Small commits, pushed often: the session may end mid-task.
4. Never re-open §2. TB answered every question on 19/10/2026. The assumptions in §2.1 are open
   to TB only.
5. No background agents unless a step truly needs one (TB, 19/10/2026: they cost more). Open each
   PR as a draft; mark it ready once the whole `npm run ci` is green locally. Never put a model ID
   in commits, PR text or code.

---

## 1 · The problem

On 19/10/2026 GE published an announcement ("Attendance Monitoring") on staging and TB, in the app
on a phone, saw nothing: no banner, no bell, no push. The announcement came from the build account
(JBS Praxis Team), and TB's phone was signed in as the same account; the fan-out never tells the
person who acted (`src/shared/notifications/fanout.js`), so that account never hears of its own
posts. Everyone else in the audience got the notice. To test, post from one login and watch a phone
signed in as another person.

TB then asked for notifications across the whole platform, robust and on every registered device:
urgency for announcements (red, blinking until read, repeated until read), every direct message and
channel post alerting, the banner with its sound, and the company's Settings · Notifications page
built now rather than in M6, with reminders strong enough for tasks and calendars (M2).

---

## 2 · TB's decisions (19/10/2026, binding)

1. **Three urgency levels for an announcement.** Normal: as today, alerts every device once.
   Important: amber card, alerts every device once, one reminder to those who have not read it
   after 4 hours. Urgent: red card that pulses, alerts every device, and repeats until each person
   acknowledges.
2. **Urgent repeats every 30 minutes, 08:00 to 18:00 Lagos time,** on every device, until
   acknowledged; at most 8 a day, then again the next morning.
3. **Read means Acknowledge for Urgent, opening for the others.** For Urgent, opening is not
   enough: the person presses Acknowledge. The poster sees who has and has not acknowledged, with
   times, and can remind the rest.
4. **An urgent notice blinks on every screen.** A red bar under the top bar on every screen of both
   shells, pulsing slowly, with Acknowledge on it; the red card in #announcements; a red dot on
   Community. Steady, not pulsing, for people who turn motion off.
5. **People and the CEO choose the level.** Whoever holds `announcements.post` may send Normal,
   Important or Urgent.
6. **Direct messages have no urgency; every message alerts every device once.** In the open app
   every direct message shows the banner with its sound (when sound is on), exactly as mail does.
   It must be robust.
7. **Every channel post alerts** every device of every member who has not muted the channel. This
   replaces the morning's "one alert per channel until opened".
8. **Security changes and approvals past their time limit are urgent on their own:** shown red and
   repeated on the urgent schedule (decision 2) until opened. Everything else alerts once.
9. **Every registered device shows the notification, the one in your hand included,** which also
   shows the in-app banner. This replaces the one-minute hold while a person is in the app, and the
   service worker no longer stays silent when a window is on screen.
10. **No quiet hours unless the person turns them on** in their own Notification Settings.
11. **Settings · Notifications lets People choose who is told**, not only how: a row per notice
    with who it goes to (as built, plus roles or named people People add), its default In App,
    Email and Push, its urgency, and on or off company-wide (Security always on). These defaults
    apply until a person changes their own.
12. **Reminders:** approvals waiting on someone, probations ending, a daily digest of what is
    unread (each person can turn it off), and whatever else the platform needs, tasks and calendars
    in M2 first. "We are going to need a solid notification system around that. Check the codebase
    let us be sure" (§3 records what the codebase needs).

### 2.1 · Assumptions (mine, open to TB)

- A. Urgent and Security still come through during a person's quiet hours (decision 10).
- B. Reading a notice on one device still clears it from the others, as built in PR #72.
- C. Settings · Notifications moves from M6 (LA) to this work (TB); MILESTONES and PROGRESS record
  the move.

---

## 3 · What the codebase needs (TB's decision 12)

Reviewed on 19/10/2026.

- **Notices today.** 49 `defineNotification` declarations: the shared layer (workflow, Home
  alerts) and 13 modules (attendance 11, identity 5, community 3, mailbox 3, leave 3, imports 2,
  announcements 2, documents, security, devices, ess, organisation, workflow). Every one goes
  through the fan-out (`src/shared/notifications/fanout.js`), so a rule there reaches all of them.
- **Time-based notices today** each run their own clock: scheduled announcements
  (`announcement-publish`), clock-in reminders (`attendance-clock-watch`), approval time limits
  (`workflow-timeout`, then `workflow.escalated`), Home's alert ageing, celebrations.
- **Waiting for their milestones, reminders by nature:** M2 `task-recurrence` and
  `review-cycle-open` with the empty `tasks` and `calendar` modules (AJ, 20 to 23 Oct); M4
  `interview-feedback-reminder`, `assessment-expire`; M5 `offer-expiry`, `signature-reminder`; M6
  `notifications.reminders.js` and the `reminders` job and scheduler (README §5.15, the planned
  engine); M7 `agreement-renewal`.
- **M2 will need**: a task assigned, due soon, overdue (repeating until done), sent for review and
  done; a calendar invite, a change, a cancellation, and "starting in N minutes" before each event;
  a review's self-rating and manager stage due.

**So one reminder engine, in `notifications`, that every module uses by declaration** instead of
writing its own clock (the planned M6 `notifications.reminders.js`, filled now):

- A module declares a reminder once (`defineReminder(key, …)`: who, what it says, its urgency) and,
  inside its own transaction, schedules or cancels occurrences: `reminders.schedule(client,
  { key, user_ids, entity, at, repeat })` and `reminders.cancel(client, { key, entity })`.
- One `reminder` table holds every occurrence; the `reminders` scheduler fires what is due through
  the fan-out, so a reminder is an ordinary notice: preferences, every device, the banner, urgency.
- A repeat is part of the occurrence (every N minutes, inside Lagos work hours, at most N a day,
  until a condition holds), which is how urgent notices repeat (decision 2).
- First users: urgent repeats and the Important reminder (PR 1). Then approvals waiting, probations
  ending and the daily digest as company rules (PR 2). M2's tasks and calendars declare theirs
  from the guide's recipe (`docs/guides/notifications.md` §7).

---

## 4 · Build checklist

Tick each step with its date and add a line to §8 when it is pushed.

### PR 1 · Every notice on every device, and urgency

1. [x] 19/10/2026 Guides first: `docs/guides/notifications.md` (urgency, every device, banner and
   notification, repeats, the red bar, Acknowledge), `docs/guides/community.md` (announcement
   levels, Acknowledge, every post alerts), MILESTONES and PROGRESS notes.
2. [x] 19/10/2026 Contract: `urgency` on a notice and on an announcement, Acknowledge, open urgent
   notices for the bar, acknowledgement on the readers list; `npm run gen:contract`.
3. [x] 19/10/2026 Migrations `0470` (notice urgency, Acknowledge, the repeats' pace,
   `push_delivery.round`) and `1145` (announcement level, `announcement_read.acknowledged_at`; M1's
   block, because `0470` would run before the tables it alters exist on a new database).
4. [x] 19/10/2026 Delivery: no hold (decision 9); every channel post alerts (7). The service
   worker's part is in step 7.
5. [x] 19/10/2026 Urgency: the fan-out's `urgency` (Security and `workflow.escalated` urgent, 8);
   announcement levels and Acknowledge (1, 3, 5); the Important reminder after 4 hours (1).
6. [x] 19/10/2026 The urgent repeats (`urgent-repeats`, on the notice rows): every 30 minutes,
   08:00 to 18:00 Lagos, at most 8 a day, until acknowledged or opened (2). The general reminder
   engine moved to PR 2, with the reminders that need it.
7. [x] 19/10/2026 Screens, both shells: the service worker always shows and passes the push to an open window
   for its banner (9); direct messages' banner and sound robust (6); the red bar with Acknowledge
   on every screen (4), red and amber cards and the level on the announcement form,
   acknowledgement on the readers list, the red dot on Community, urgency in the pane and the
   banner.
8. [x] 19/10/2026 Tests (unit, integration, the app's), the whole `npm run ci`, a real-browser
   check, the PR body, then drive it green and merge with TB's admin rights (TB, 19/10/2026):
   #81, merged.

### PR 2 · Settings · Notifications, reminders and quiet hours

1. [x] 19/10/2026 Guides first: Settings · Notifications in `notifications.md`, the reminder
   recipe for modules (§7.1), PROGRESS #74 moved from M6 to M0, MILESTONES note.
2. [x] 19/10/2026 Contract and migration `0480`: a rule per notice (on or off, extra roles and people, default
   channels, urgency), reminder rules (approvals every N hours, probation N days ahead, the digest's
   time), a person's quiet hours and digest switch.
3. [x] 19/10/2026 Backend: the notice catalogue (a label per declaration), the fan-out applying the company's
   rules, approval and probation reminders, the daily digest, quiet hours that hold push (Urgent and
   Security pass, assumption A).
4. [ ] Screens: Settings · Notifications on both shells (desktop table, phone rows and sheets), quiet
   hours and the digest in each person's Notification Settings.
5. [ ] Tests, the whole `npm run ci`, the PR, drive it green and merge.

---

## 5 · PR 2 design (mine, from TB's decisions 10 to 12; open to TB)

- **The notices People see.** Every `defineNotification` declaration, and the Security events that
  only reach the access watchers. A notice is named by its event's summary in the catalogue; who it
  goes to as built is read from the declaration (`who` names an audience the code chooses).
- **Copies, never a new audience.** People add roles or people only to a notice written about
  someone else, which declares `copy` (approvals, attendance reviews, bank details changed, alerts,
  probations ending). A notice personal to its audience (a direct message, mail, your own account,
  "your import finished") takes no copies: nobody reads another person's messages, and nobody is
  told "waiting on you" when it is not.
- **Which channel wins.** The person's own switch for the category, else the company's default
  for the notice, else the category's default. The company's Off beats everything but Security.
- **Urgency.** People set it for a notice whose urgency the code fixes. Security stays urgent; an
  announcement's level stays with its poster.
- **Reminders.** Approvals Waiting: on, every 24 hours between 08:00 and 18:00 Lagos, to the stage's
  approvers, important (amber). Probation Ending: on, 14 days ahead at 09:00 Lagos, to People and the
  line managers above. Daily Digest: on, 07:30 Lagos, an email listing up to 25 notices that arrived
  in the last 24 hours and are still unread, none when there are none; each person can turn it off.
- **Quiet hours.** Off until a person turns them on (21:00 to 07:00 when first turned on). Pushes
  wait until they end; urgent notices and Security come through (assumption A).
- **The engine.** One `reminder` table of occurrences; `defineReminder` (its event, `check`, an
  optional `find`), `schedule` and `cancel`; the `reminders` scheduler every 5 minutes; each
  person's digest is a job on the `reminders` queue.

---

## 8 · Log

- 19/10/2026 · TB answered twelve questions (§2). Diagnosis of the silent announcement recorded
  (§1). Next: §3, the codebase review for reminders.
- 19/10/2026 · §3 written from the codebase review: one reminder engine in `notifications`, used by
  declaration. §4 lays out PR 1 and PR 2. TB: open each PR, drive it green, merge it with TB's
  admin rights, then go on. Next: PR 1 step 1, the guides.
- 19/10/2026 · PR 1 steps 1 to 6 pushed (guides, contract, migrations `0470` and `1145`, the
  backend). Unit tests and the push, Community and worker integration suites pass locally. Next:
  step 7, the screens.
- 19/10/2026 · PR 1 step 7 pushed: `UrgentBar`, `Card` urgency, the shells' `alert` slot, red nav
  counts, the service worker always showing, the announcement level, Acknowledge and reads. The
  whole `npm run ci` passes locally (45 of 45) and Chromium shows the pushes as designed
  (`push-check-3`: shown with the app on screen, urgent kept on screen, a repeat not counted as
  new). Next: step 8, the PR.
- 19/10/2026 · PR 1 opened as #81; scope, checks, backend, frontend and screens green on GitHub;
  merged with TB's admin rights. PR 2 starts from `main`: §5 records its design. Next: PR 2 step 1,
  the guides.
- 19/10/2026 · PR 2 steps 1 and 2 pushed: the guides (`notifications.md` §1 to §11, PROGRESS #74
  moved to M0, MILESTONES), the contract (rules, reminders, quiet hours, the digest) and `0480`
  (round trip passes). Next: step 3, the backend.
- 19/10/2026 · PR 2 step 3 pushed: the notice catalogue (`fanout.notices()`, `who`, `copy`), the
  company's rules in the fan-out (Off, copies, urgency, default channels), Settings · Notifications'
  routes (`notifications.rules.js`), the reminder engine with Approvals Waiting and Probation Ending
  (`notifications.reminders.js`, the `reminders` scheduler), the daily digest (the `reminders` job,
  `templates/email/digest.html`) and quiet hours holding pushes. New integration suite
  `notifications-rules` (10 tests) and unit tests pass. Next: step 4, the screens.
