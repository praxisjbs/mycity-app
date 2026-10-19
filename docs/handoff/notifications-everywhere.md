# Notifications Everywhere · Build Handoff

**Start here if you are continuing this work in a new session.** This file is self-contained: the
problem, every decision TB took (do not ask them again), the plan in two pull requests, the build
checklist with its status, and a dated log. The design itself is `docs/guides/notifications.md`;
this file is the build plan and its log. It follows `docs/handoff/push-notifications.md` (PR #72,
merged), which built web push, the banner, the pane and personal Notification Settings.

| | |
|---|---|
| Branch | `ccr-59381f61-k83jfs` (push only here; each PR targets `main`; PR 2 starts from `main` after PR 1 merges) |
| Pull requests | PR 1 and PR 2, not opened yet |
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

To be written: every time-based notice the modules already declare or will need (M2 tasks and
calendars first), and the one reminder engine that serves them.

---

## 4 · Build checklist

To be written after §3: PR 1 (every notice everywhere, and urgency) and PR 2 (Settings ·
Notifications, reminders, digest, quiet hours).

---

## 8 · Log

- 19/10/2026 · TB answered twelve questions (§2). Diagnosis of the silent announcement recorded
  (§1). Next: §3, the codebase review for reminders.
