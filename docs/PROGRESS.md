# MyCity App ERP · Progress

**The single record of what is built.** 99 screens (93 in the staff app, 6 on the public site) plus
the M0 foundation. Every change that moves a screen or a foundation item forward updates this file
in the same commit. An AI assistant does this as part of finishing a task (CLAUDE.md, step 5); a
person does it by hand. Nobody should have to ask "where are we on X".

Screen names and tab slugs are the approved inventory (MILESTONES §18, approved 12 October 2026).
A tab's slug is a URL and does not change when its label does.

---

## How to update this file

1. **Tick the columns** the change completed, on the row of each screen it touched:

   | Column | Ticked when |
   |---|---|
   | API | Every endpoint the screen calls exists with its contract, permission check and tests |
   | UI | The desktop screen is built against the real API (no mock data in the component) |
   | Mobile | The mobile shell is built (gate 11: a native mobile layout, not the desktop one shrunk) |

2. **Set Status** to one of: `Not started` · `In progress` · `Built` (all three ticked) ·
   `On staging` (deployed and demo script walked) · `Accepted` (signed off at the milestone demo).
3. **Set Updated** to the date, day-first: `13/10/2026`.
4. **Leave a note** under the module's **Notes**, newest first, one line per change:

   ```
   - 13/10/2026 · LA · My Attendance: API for the month view and the export; table toggle still to do.
   ```

   Say what was done and what is left. Name a blocker if there is one. Replace `_None yet._` with the
   first note.
5. **Update the summary** counts below when a Status changes.

A row is never deleted. A screen that is dropped by agreement gets Status `Dropped` and a note
saying who agreed and when.

---

## Summary

| Milestone | Screens | Not started | In progress | Built | On staging | Accepted |
|---|---|---|---|---|---|---|
| M0 Foundation | 32 items below: 31 done, 1 open | | | | | |
| M1 Core Operations & Employee Management | 32 | 0 | 0 | 32 | 0 | 0 |
| M2 Productivity & Performance | 10 | 6 | 0 | 4 | 0 | 0 |
| M3 Queries & Consequence Management | 5 | 5 | 0 | 0 | 0 | 0 |
| M4 Recruitment End to End | 8 | 8 | 0 | 0 | 0 | 0 |
| M5 Offers, Documentation & Onboarding | 5 | 5 | 0 | 0 | 0 | 0 |
| M6 Payroll & Notifications | 6 | 6 | 0 | 0 | 0 | 0 |
| M7 Partnerships, CRM & Trackers | 6 | 6 | 0 | 0 | 0 | 0 |
| M8 Expenses & Budget Control | 6 | 6 | 0 | 0 | 0 | 0 |
| M9 Settings & Governance | 12 | 1 | 0 | 11 | 0 | 0 |
| M10 Staff Knowledge Hub & AI Assistance | 9 | 6 | 0 | 3 | 0 | 0 |
| **Total** | **99** | **49** | **0** | **50** | **0** | **0** |

M1 counts Employees with People although its API is M0 work. Three ESS tabs are counted with the
milestone that delivers their module: My Performance (M2), My Queries (M3), My Payslips (M6). Policy
Updates and Knowledge Hub · Policies are M1: policies were brought forward from M10 and Settings ·
Attendance Policy (#73) dropped, its row kept as Dropped and counted nowhere (TB, 20/10/2026). M4 and M5 include their public-site
pages. Settings → Notifications was brought forward to M0 by TB on 19/10/2026 and is counted with
M1, like the other M0 screens.

---

## M0 · Foundation

Not a screen each, so tracked as items. `☑` done, `☐` not yet. Same note format as the screens.
Source: BACKEND_STRUCTURE §13 (definition of done) and the 12 October internal meeting.

| Item | Owner | Done | Updated |
|---|---|---|---|
| Server: 4 subdomains, TLS, proxy settings per `docs/runbooks/proxy.md` | GE | ☑ | 17/10/2026 |
| Root config: `package.json`, `.nvmrc`, `.gitignore`, `.gitattributes`, ESLint, Jest | GE | ☑ | 14/10/2026 |
| `src/config/*`, `app.js`, `server.js`, `worker.js`, `http/*`, `middleware/*` | GE | ☑ | 14/10/2026 |
| Shared core: `db`, `crud`, `http`, `errors`, `events`, `workflow`, `numbering`, `money`, `time`, `access`, `rbac` | GE | ☑ | 14/10/2026 |
| Pagination gate: `shared/http/paged.js`, `common.js` page schemas, `check/pagination.js` (§16) | GE | ☑ | 13/10/2026 |
| Contract package + generator (`gen:contract`) + `http/route.js` | GE | ☑ | 14/10/2026 |
| M0 migrations and reference seed 0001 to 0099 | LA | ☑ | 16/10/2026 |
| Staging seed data: MyCity's staff (`seeds/staging/10_staff.js`); each later module seeds its own records | LA · TB | ☑ | 17/10/2026 |
| Nine M0 modules: identity, access, audit, organisation, settings, notifications, workflow, documents, imports | GE · TB | ☑ | 17/10/2026 |
| Sign-in and sessions: `identity`, `access`, `users`; session rules, lock screen, credential links, the seven roles, the four-city sign-in screen (`docs/guides/identity.md`) | TB | ☑ | 16/10/2026 |
| Two-step sign-in, passkeys and the PIN: the `security` module, the code step, PIN and passkey sign-in, the lock screen's PIN and passkey, the fresh-sign-in window, Reset Two-Step (`docs/guides/identity.md`) | TB | ☑ | 16/10/2026 |
| `create-admin` seeds a full employee, login and role (§17) | GE | ☑ | 13/10/2026 |
| Documents, media, uploads, PDF generation | GE | ☑ | 19/10/2026 |
| Import engine + staff importer; real staff sheet imported on staging | GE · LA · TB | ☑ | 17/10/2026 |
| AI foundation: `services/ai`, manifests, registry, gate 9 | GE | ☑ | 15/10/2026 |
| CI wiring: `package.json`, lockfile, ESLint, Jest, `ci-local.js`, `ci.yml` | GE | ☑ | 13/10/2026 |
| Process gates: progress, guides, README map, CODEOWNERS; PR template; Claude Stop hook | GE | ☑ | 13/10/2026 |
| GitHub settings applied by TB (`docs/runbooks/github-settings.md`; branch protection and required reviewers wait for a public repository or a plan that offers them) | TB | ☑ | 17/10/2026 |
| CODEOWNERS usernames: GE `@swizfcodes`, TB `@tomblakeasaah196`, AJ `@Ghosted34`, LA `@LovedataX` | GE | ☑ | 13/10/2026 |
| CI gates 1 to 8 and pipeline guards (gate 6: schema-drift and contract-columns) | GE · TB | ☑ | 16/10/2026 |
| Release pipeline: `release.yml`, `deploy-gate`, staging seal, production approval (manual run by GE or TB while the repository is private) | GE | ☑ | 17/10/2026 |
| Operations: nightly backup, weekly restore drill, offsite copy, uptime probe; runbooks backup-restore, incident, monitoring, add-a-module | GE | ☐ | 17/10/2026 |
| Docs: `CLAUDE.md`, backend guide, frontend guide, this file, guide template | GE | ☑ | 13/10/2026 |
| Screen gates 8, 11, 12, 17: `five-second`, `two-shells`, `forms`, `dashes`; screen conventions in FRONTEND_GUIDE §5, §7, §8 | TB | ☑ | 14/10/2026 |
| Frontend foundation PR 1 · Ground: `packages/ui` (tokens, primitives, overlays, help, toast, form system, data client), catalogue and gallery, new gates, docs (FRONTEND_FOUNDATION §4) | AJ | ☑ | 15/10/2026 |
| Frontend foundation PR 2 · Shell: both apps' shells on `packages/ui`, bottom bar, More, floating button, session, PWA, what opens where | AJ | ☑ | 15/10/2026 |
| Frontend foundation PR 3 · Build kit: DataView, KPI, charts, kanban, calendar, pickers, upload, editor, PDF preview, voice, maps; app component folders emptied; every screen on the token scale | AJ | ☑ | 16/10/2026 |
| Gate 21 · nothing the browser styles itself (F25): branded `SelectMenu` behind every select, `Tooltip` for every hover label, the `base.css` reset, `check/native-ui.js` in source and on every rendered screen | AJ | ☑ | 18/10/2026 |
| One press, one request (F26): every button busy from the press until its work settles, a second press refused, its `ActionGroup` waiting, no modal dismissed mid-save, Enter twice sends one form, a Reload that always reloads; lint `mycity/no-void-press` | AJ | ☑ | 18/10/2026 |
| Notifications brought forward from M6 (TB, 19/10/2026): web push to phones and computers, the in-app banner, the pane on both shells, Notification Settings, live mail (`docs/guides/notifications.md`, build plan `docs/handoff/push-notifications.md`) | TB | ☑ | 19/10/2026 |
| Notifications everywhere (TB, 19/10/2026): every device at once, every channel post alerting, urgency with Acknowledge, the urgent bar and urgent repeats (`docs/guides/notifications.md`, build plan `docs/handoff/notifications-everywhere.md`) | TB | ☑ | 19/10/2026 |
| Notification rules and reminders (TB, 19/10/2026): Settings · Notifications brought forward from M6 (#74), the reminder engine with approval and probation reminders, the daily digest, quiet hours (`docs/guides/notifications.md`, build plan `docs/handoff/notifications-everywhere.md`) | TB | ☑ | 19/10/2026 |
| Maps (F21): `GET /maps/search`, `/maps/tiles`, `/maps/reverse` (Geoapify through our API, `GEOAPIFY_API_KEY`), `AddressField` on every address a person types, `MapView` tiles fetched with the session | TB | ☑ | 19/10/2026 |
| Addresses picked, never typed (F27, gate 22; TB, 20/10/2026): every address a person enters is a pick from the search, a pin, or the device's location while search is down, signed by our API and kept in `place` with its naming job (`docs/guides/addresses.md`) | TB | ☑ | 20/10/2026 |
| Refresh and history in the hub (F28, F29; TB, 20/10/2026): pull to refresh with two depths (the Pin Drop), the desktop capsule with the Hold Ring, back and forward in the installed app, Back closing a phone's sheets first, this device's trail (8 back, 1 ahead), the installed app reopening where the person was, ⌘K Refresh Screen and Reload App (`docs/FRONTEND_FOUNDATION.md` §3, §5) | TB | ☑ | 20/10/2026 |

**Notes**

- 21/10/2026 · TB · The form system (PR 1 · Ground), from the 21/10 System Health brief (fault #2): `DateField` keeps what is typed. It had rewritten its text from the value it had just handed over, so at 28/10/20 the year read 2020 and a typed 28/10/2026 left the form as 2020-10-28 while the field showed red; the leave server refused it as Already Past. The form now holds only the date the text shows (none while it is half typed or outside `min` and `max`), and a control tells the form what only it can see through the binding's new `onProblem`: "Not a real date" after the pause, "Pick 21/10/2026 or later" at once for a whole date outside the range, and check() refuses both. `DateRangeField` passes either end's. Tests beside each (`DateField.test.tsx`, `useContractForm.test.tsx`). Left: nothing; every `DateField` bound with `f.field` has it, and People · Attendance's Export passes its Period's.
- 21/10/2026 · TB · `BarChart` (Build kit) copes with a month of days, found on AI Control · Spend (#100): its
  drawing is laid out in the card's own pixels at the chart's height (the placeholder's), so labels stay 11 px
  and the chart no longer grows taller with the screen. Up to 12 bars every label shows and a narrow card
  scrolls the drawing; past 12, labels that would touch are left off at an even step, the first and the last
  always, none past an edge, and the read-out list keeps every bar. The tallest bar now fills the chart when
  every figure is under 1. Gallery state Month of Days; `docs/COMPONENTS.md` regenerated. Tests: 6 unit.
  Left: nothing.
- 20/10/2026 · TB · Refresh and history in the hub (FRONTEND_FOUNDATION F28, F29; TB's eight answers in
  §5, asked on a live design board). Refresh is in place first: the data client's `refresh` asks every
  read on screen again quietly and settles when the last lands. Phone: the page pulls to refresh
  (`PullIndicator`, the Pin Drop; a second notch at 136 px reloads the app); the pull only listens, starts
  at the top after a clear move down, never on a fit page or over `data-pull="off"`, and the hub turns the
  browser's own pull off; the bell's pane uses the same pull. Desktop: `NavCapsule` at the start of the top
  bar, refresh everywhere (a click refreshes, a 0.6 s hold closes the ring and reloads) and back and
  forward in the installed app, with `TrailMenu` (the last 8 places and the 1 ahead) on a held or right
  clicked arrow, or the held pin. History has one owner (`@mycity/ui` `lib/history.ts`): a screen, tab or
  record is a step, filters and pages change it in place, and on a phone every overlay takes a step so
  Back closes it first. Each device keeps its trail (`app/src/lib/trail.ts`); the installed app reopens
  where the person was within 12 hours, for the same person only, and Sign Out wipes it. ⌘K gains Refresh
  Screen and Reload App. Left: try it on an installed Android, an iPhone home-screen app and a Windows
  window; screens other than the employee record name their records on the trail (`useTrailTitle`) as
  they are touched.
- 20/10/2026 · TB · System Health fault #1 on staging ("Maps are not answering." once on `GET /maps/search`, build `b301312`): Geoapify gave no answer within 4.5 seconds, or the connection dropped; not a defect of the address work, but it alerted as an error and turned the field to its outage state on one blip. Fixed with TB's four answers: the server asks a dropped connection once more at once (never a timeout) and logs its network code; the field asks a failed search or pin once more after 400 ms before it calls search down; the provider not answering is recorded as a `warning` (counted, never alerting), while the `maps` check and Settings · Integrations carry an outage (`docs/guides/addresses.md` §6.5, `system-health.md` §6); and, TB's fifth answer, System Health pushes only `fatal` and `error` faults: a new, returning or spiking `warning` or `notice` (a 422) is counted on Faults and no longer pushed, as §6 already said of notices. Left: a fault's fingerprint holds the release folder, so every deploy files a recurring fault as new and Came Back cannot fire across releases (System Health, proposed separately).
- 20/10/2026 · TB · Addresses picked, never typed (F27, gate 22; `docs/guides/addresses.md`, TB's four answers). Backend: `place` (`0490`, backfilled from every address saved before as typed and unverified), the signed token (HMAC from `ENCRYPTION_KEY`, checked at the edge by the contract's `PlaceInput`), the owners registry, `GET /maps/pin` in place of `/maps/reverse` (open to everyone signed in), the search from the second character with memory, Redis (seven days) and the provider's rate, and `places-name` (every 5 minutes) naming device locations saved in an outage. Frontend: `AddressField` rebuilt (instant: 100 ms, a session cache, matches held for a shorter text shown at once, cancelled requests; Change, Details, Unverified, Drop a Pin, and in an outage Try Again and Use Current Location) and `PlacesField`. Moved: Settings · Organisation (#69), Worksites (#28), Field Assignments and People · Attendance (#25), Work Location Requests (#87), My Attendance's Home Location (#9), My Profile (#8), the vacancy form (#38, area), the partner form (#51, area) and the proposal's cities (#53, `PlacesField`); People · Employees (#24) reads the line as before; go has no address field yet. Left: TB to confirm the typed-before rule (guide §13.1); go's public search with its first address field (§13.2); a paid Geoapify plan if 3,000 credits a day prove short (§13.3).
- 20/10/2026 · TB · System mail to `mycityapp.io` was refused as a trapped route (System Health fault #1: every staging digest failed with `MAIL_ROUTE_TRAPPED`). The domain's MX is Namecheap's spam filter in front of the same cPanel host that holds the mailboxes, which the route check cannot tell from a real trap by DNS. New `SMTP_LOCAL_DOMAINS` (default `mycityapp.io`) names the domains whose mailboxes are on the relay; they are not checked, every other domain still is (`docs/guides/foundation.md` §6.14). Today's failed digests are not re-sent. Left: nothing.
- 19/10/2026 · TB · Map tiles and a worksite's address (decided 19/10/2026; `docs/guides/foundation.md` §5, §6.13): `GET /api/v1/maps/tiles/:z/:x/:y.png` (signed in; `MapView` takes `loadTile` and the app fetches each tile with the session, as photos load, so no public route spends the quota; kept a day on the server, a week in the browser) and `GET /api/v1/maps/reverse` (`people` create or edit; a worksite's centre only, never a home or a punch). Left: `GEOAPIFY_API_KEY` on staging and production (GE).
- 19/10/2026 · TB · Address search (F21; `docs/guides/foundation.md` §6.13): `GET /api/v1/maps/search` in a new `maps` module (`self`, reads and writes nothing) over `services/maps/geoapify.service.js` (Geoapify autocomplete with the key on the server, biased to Lagos, six places at most, answers kept ten minutes; 503 `MAPS_OFF` with no `GEOAPIFY_API_KEY`), and `AddressField` in `packages/ui` (a combobox that suggests places as it is typed and hands back the place picked; `maps/usePlaces.ts` now shared with `PlaceSearch`). On every address a person types: Worksites, field sites, work location requests, homes, My Profile, Settings · Organisation, a vacancy's location. Left: `GEOAPIFY_API_KEY` set on staging and production (GE); the map tiles and the reverse lookup through our API (`MapView`, `LocationLabel`), whose tiles load without the session's token.
- 19/10/2026 · TB · Documents and media: a PDF's pages are drawn in the app by PDF.js (`PdfViewer`, its own chunk; its fonts, character maps and decoders served from `/pdfjs/`, never precached), replacing the browser's own viewer, which drew nothing on Android and was blocked by the security policy (`object-src 'none'`) on staging and production (FRONTEND_FOUNDATION §5, PR 3 question 4). `MediaViewer` opens a photo, a video or a PDF full screen everywhere a file is opened (Staff Community, My Documents, a mail's attachments), with Download and Share on a phone; `MediaRef` carries a file's shape, page count, length and sizes; the worker counts a PDF's pages and draws its first page (`document.page_count`, migration 1147, `document.derived`). Checked in Chromium on the live build under the production policy, desktop and an emulated Pixel 7: a three-page PDF, a JPEG 2000 photo (WebAssembly refused by the policy, PDF.js's plain decoder used) and Japanese text (character maps from `/pdfjs/cmaps`). Left: Share on a real phone; the worker's first page shows boxes for Japanese or Chinese text in a PDF that does not carry its fonts (no such fonts on the servers).
- 19/10/2026 · TB · Notification rules and reminders built (PR 2 of
  `docs/handoff/notifications-everywhere.md`, after PR 1 merged as #81): Settings · Notifications
  (#74) brought forward from M6; the fan-out applies the company's rule per notice (Off, copies,
  urgency, default channels); one reminder engine (`notifications.reminders.js`, the `reminders`
  scheduler every 5 minutes) with Approvals Waiting and Probation Ending; the daily digest email
  (the `reminders` job, `templates/email/digest.html`); quiet hours holding pushes (urgent and
  Security pass). Left: TB's view on the design choices in the handoff's §5.
- 19/10/2026 · TB · Exports download on the device that pressed, never by email (TB's four answers, 19/10/2026; `docs/guides/foundation.md` §6.12). One path for every Export and Download button: `src/shared/documents/exports.js` reserves the file in the request (or `documents.generate` for a PDF), the module's outbox handler makes it, `GET /exports/:id` answers while the screen waits, and `GET /documents/:id/content` downloads it; `ExportFile` in the contract replaces the four "queued, and the email it goes to" shapes. The app's `api/exports.ts` waits and saves wherever the person is in the app; `api/download.ts` saves into Downloads (Android, desktop) or opens the share sheet with Save to Files on an iPhone app; `ExportButton` stays busy until the file is saved. Export files are kept 24 hours (`export-cleanup`, hourly, replaces `data-export-cleanup`), never locked. Only a report schedule's files are still emailed. The integration suite passes locally (80 suites, 1,726 tests), and every frontend test (UI 823, app 260). Left: the M6 payslips screen's Email a Copy is still in its plan (`docs/guides/ess.md` §2), for TB to confirm against this decision.
- 19/10/2026 · TB · Notifications everywhere, started from TB's twelve answers
  (`docs/handoff/notifications-everywhere.md`). An announcement GE posted from the build account
  reached no device signed in as that account, by design: nobody is told of their own action.
  Built in PR 1: every device at once, every channel post alerting, urgency with Acknowledge, the
  urgent bar on both shells, urgent repeats (`0470`, `1145`); the whole `npm run ci` passes locally
  and Chromium shows the pushes as designed. Left: PR 2 (Settings · Notifications brought forward
  from M6, the reminder engine, the digest, quiet hours).
- 19/10/2026 · AJ · CI runs as four jobs side by side (`.github/workflows/ci.yml`: backend, frontend, screens, checks, and the `ci` check over them; `npm run ci -- --group=<name>`), the three frontend workspaces' tests at once (`scripts/fe-test.js`: 430 s to 254 s here), Chromium and ffmpeg's packages cached. Left: compare a week of run times and Actions minutes; four jobs bill more minutes than one.
- 19/10/2026 · AJ · Frontend foundation: a module's tab strip on a narrow desktop window keeps the tabs that fit (the active one always) and folds the rest into More Tabs, a ⋯ menu, instead of scrolling sideways (`packages/ui` `Tabs`; every module). Phones unchanged.
- 19/10/2026 · TB · CI does only what a change needs (`.github/workflows/ci.yml`,
  `scripts/check/lib/scope.js`, BACKEND_GUIDE §8.4), after a week of CI used 2,275 Actions minutes
  (902 of them re-testing merges on `main`) and GitHub stopped starting jobs. A draft PR runs no CI
  on GitHub (marking it ready starts the run); editing a PR's description re-runs it only when the
  description or the base changed; a change to documents only runs the seven gates that read
  documents (about a minute instead of about 13); a push to `main` whose tree the PR's last full run
  passed runs those gates too, not the whole suite, and Release deploys it as before. Left: compare
  a week of runs with these numbers.
- 19/10/2026 · TB · An out-of-date gate can no longer go unnoticed. `deploy-gate status` now prints
  the gate's own `sha256` first, and `release.yml` asks for it before `stage` and before `promote`:
  `scripts/deploy/check-gate.js` compares it with the copy in the commit being deployed and, on a
  mismatch (or a gate too old to report one), fails before the server is touched. The job summary
  gives the fix with that commit's download link, the hash to check, the install line and the
  re-run; `docs/runbooks/deploy.md` §5 has the same. CI still never installs the gate. Left: the
  first deploy after this merges stops on staging until the new gate is installed by hand, once.
- 19/10/2026 · TB · Notifications built (`docs/guides/notifications.md` is Built; PR #72). Web push to
  phones and computers through the app's own service worker (`app/src/sw.ts`: one notification per
  conversation, Mark Read, the pin in the status bar and the count on the app icon, a tap through
  sign-in to the record), the in-app banner (3 s, the chime or a buzz, once per notice, none in a
  window in the background), the pane on both shells (`NotificationCenter`: a page from the right on
  a phone, a panel under the bell on desktop), Notification Settings (this device, other devices, In
  App, Email and Push per category), the one-time Turn On offer, three ⌘K actions, and live mail on
  staging and production. The integration suite passes locally, 26 suites and 635 tests, with
  `notifications-push.test.js`. GE's runbook: `docs/runbooks/push-notifications.md` (nothing to set
  in `.env`; check `MAILBOX_IDLE_MAX` is not 0). The whole `npm run ci` passes locally (45 gates),
  and pushes delivered to the built service worker in Chromium show as designed (handoff §8). Left:
  TB's phone check after the staging deploy (handoff §7).
- 19/10/2026 · TB · Notifications, in progress (TB's eight decisions in `docs/handoff/push-notifications.md`
  §2; design `docs/guides/notifications.md`). The backend of web push: migration `0460`
  (`push_subscription` as a device with its token, key id and health; `push_delivery`, one row per
  notice and device), the environment's VAPID pair made on first start and kept encrypted
  (`services/push/vapid.js`, `.env` may override, subject `mailto:jbspraxisllc@gmail.com`), the sender
  with error mapping (`web-push.js`), the payload (`payload.js`), the `notification-push` job (a
  minute's hold while the person is in front of the app, Security never held; one send per device;
  dead subscriptions revoked; retries with backoff), the routes for preferences, devices, Send Test,
  read state and the service worker's two device-token calls, push off on suspension, leaving, Sign
  Out Everywhere and Sign Out Others. Mail: IMAP IDLE on by default (24 production, 4 staging), the
  first line in the notice, reading a conversation reads its notices. Channel posts alert once per
  channel. Left: the service worker, the banner, the pane and Notification Settings on both shells,
  tests, the runbook for GE.
- 19/10/2026 · TB · The staff roster and the staff importer (`docs/guides/foundation.md` §6.1, §6.5,
  §6.6, §11), from a review of what staging shows. A VACANT row's Line Manager is the seat's own
  line (the importer dropped it without a word); `roles.json` gives a post outside the sheet its line
  manager (the build account reports to the CTO), only while it has none; a row whose staff number
  is held by someone with its own name is that person, so a corrected email no longer takes their
  number and makes a second record; each row's dotted line comes from its own cell, so a preview no
  longer costs its commit a dotted line; a link that writes nothing is not counted as an update;
  the import preview lists warning rows (someone saved without a Line Manager) with the errors.
  Approvals, team scope, the notifications that follow it and `manages_people` pass through a
  vacant seat to the first person above it (`1160` `employee_effective_manager`); a loop through a
  seat is refused. MyCity's sheet corrected (TB, 19/10/2026). Left: the server's `deploy-gate` is
  still the one provisioned before the roster step (no `[staff]` line in staging's Release run 159),
  so `docs/runbooks/staff-roster.md` §2 needs someone with root on the server; staging's on-screen
  corrections are §6 there.

- 18/10/2026 · TB · One press, one request (F26, FRONTEND_GUIDE §8.4). Reload on "A new version is
  ready" looked dead, and after a hard refresh did nothing; any button could send its request twice.
  Now `Button`, `IconButton` and `BigButton` are busy from the press until the work their handler
  hands back settles: brand colour kept and softened, a spinner where the icon was (centred over the
  label when there is none), a second press refused at once, `aria-busy` but never `disabled`. The
  new `ActionGroup` makes the buttons beside a busy one wait; modals, forms, form footers, card and
  page header actions, shell notices and DataView's bulk bar are groups already, and a modal cannot
  be dismissed mid-save. `Form` sends one save however often Enter is pressed. Reload now always
  reloads: when the new version takes over, when it activates on a page loaded with a hard refresh,
  or after 4 s. Lint `mycity/no-void-press` refuses a handler that throws its work away; 91 handlers
  in both apps converted, and six buttons that disabled themselves and swapped their label (the
  public site's Apply, Start, Sign and Decline, Payroll's Email All) use the shared busy. No screen's
  ticks change. Left: a mail attachment chip, a hand-drawn
  button, can still start its download twice.

- 18/10/2026 · TB · Gate 21 and F25, nothing the browser styles itself (FRONTEND_GUIDE §8.8). A
  phone showed its own grey picker over the branded Create Rule sheet (Home · Alert Rules), because
  `SelectField`, `FilterSelect` and `InlineSelect` were native `<select>`s. All three now draw the new
  `SelectMenu`: a Radix listbox in our tokens on desktop, a bottom sheet of 44 px rows on a phone,
  titled by the field's label. Every `title` tooltip is now `Tooltip` (IconButton, the collapsed
  rail, Calendar events, file names, the clock button, message ticks, mail recipients, policy
  summaries); map markers use Leaflet's tooltip in our tokens. `base.css` resets control appearance,
  spinners, the search clear and autofill buttons, the autofill tint, the invalid glow, the tap
  flash, the selection, accent and caret colours; the Toaster styles every sonner part.
  `check/native-ui.js` runs in `npm run ci` and the Stop hook: source plus every gallery page and
  app screen at phone and desktop size, no exemptions; green on all 402 views. Left: nothing.
- 18/10/2026 · TB · Phone sheets fixed for typing (F6 amended): with the keyboard up, a sheet was
  pinned behind it and the browser panned the page to reach the field, pushing the header off the
  top with no way back, and a swipe down or a tap on the scrim closed it and lost what was typed.
  `Sheet` now follows the visible area itself (Vaul's input repositioning is off): its bottom sits
  on the keyboard, its height never passes what is left, and the focused field scrolls back into
  view. Once a sheet with a close button holds a text field it has no grab handle and closes only
  from that button, Cancel or Esc; a scrim tap puts the keyboard away. `dismissible={false}` no
  longer blocks the close button on a phone. Every Modal, SidePanel and Popover on a phone gets it.
  Left: check on a real Android and iPhone on staging (the tests stub the keyboard).
- 18/10/2026 · TB · The staff roster has never run on staging, which still shows only the build
  account. `/srv/mycity/bin/deploy-gate` is root-owned and installed by `ops/provision/provision.sh`
  alone, and a release carries `scripts/db` but not `scripts/deploy`, so the roster step added with
  track A never reached the server: every staging deploy prints `[migrate]` then `[ai-catalogue]`
  with no `[staff]` line and no warning. Nothing in the repository can fix that, so
  `docs/runbooks/staff-roster.md` is new: what happened, the one command that loads the roster from
  the running release, and the one that puts the current gate back for both environments. Fixed here:
  the first administrator is given 00001, which the sheet says is the CEO's, and the loader read that
  as a match and skipped the CEO (17 people, no CEO, two reporting lines lost to an unresolved "CEO").
  A staff number the sheet gives one of its people is now taken back, the holder moving to the next
  free number with their record, login and roles intact (`reclaim_staff_numbers`,
  `roster_work_emails`, `organisation.renumberEmployee`, `repo.setStaffNumber`); a holder the same
  sheet names is reported instead, and importing a sheet by hand moves nobody. The import engine now
  reports what a service wrote rather than what the match predicted, so a preview that says create
  means create. Proved on a copy of staging's own state: 20 rows, 20 created, 18 logins invited, the
  CEO on 00001, the build account on 00004. Nothing ticked; the roster is still not on staging until
  the runbook is run.
- 17/10/2026 · TB · Capabilities made a convention every module follows (README §5.2, BACKEND_GUIDE §5,
  the guide template's new Capabilities row on every guide): each one declared once in
  `access.catalog.js`, seeded by its milestone, checked on the route after the module grant
  (`requireCapability`, new `requireAnyCapability`), sent on `/me.capabilities` and mirrored in the
  shell and ⌘K. New gate `check/capabilities.js`. Left: nothing.
- 17/10/2026 · GE · Two-column Grid panes polished: a thin scrollbar kept inside the card's rounded corners (its track margin is the card radius) and a card's header that stays put while its body scrolls (`data-panes`, `data-card-header`). Left: nothing.
- 17/10/2026 · GE · Two cards side by side now scroll on their own on desktop, as the mailbox's panes do: `Grid` (2, "1.4/1", "1/1.5") caps each column at the window's height under the top bar (`max-h-card-pane`) with its own scroll, from the width the columns sit side by side; the page still scrolls around them, and `scroll={false}` opts a grid out. Phones are unchanged (one column, the page scrolls). Checked on Settings · Security at 1440 by 520: the role card scrolls alone while the rules card and the page stay put. Left: nothing.
- 17/10/2026 · GE · GitHub settings ticked: TB restricted the production environment to `main`, and
  the team accepted the rest as it stands for M0. Left: branch protection on `main` and required
  reviewers on production, once the repository is public or on a plan that offers them.
  Operations: provisioning re-run on the server, confirmed over SSH, so the backup and restore-drill
  timers are installed. Still open: the offsite backup host and the WhatsApp alert links.
- 17/10/2026 · GE · Release pipeline ticked: the team accepted the manual production run by GE or TB
  (`release.yml` approver job) as M0's production approval while the repository is private. Left:
  required reviewers on the production environment once the repository is public or on a plan
  that offers them; the GitHub settings and operations items stay open.
- 17/10/2026 · GE · M0 table brought up to date: 24 of 27 items done. Ticked the server (staging
  verify passes over HTTPS with HSTS and each host refusing the other's API, production serves the
  sealed releases, the uptime probe is green) and the staging seed (MyCity's staff through
  `seeds/staging/10_staff.js`; later modules seed their own records). Still open, each with
  something outside the code: GitHub settings (the repository is private, so required reviewers
  and branch protection are not offered); the release pipeline's production approval (interim
  manual run until then); operations (backups, restore drill and offsite copy need provisioning
  re-run on the server, the offsite host and the WhatsApp alert links, none confirmed yet).
- 17/10/2026 · GE · Production runs only by hand while the repository is private: GitHub offers no
  required reviewers there, so releases 130 to 134 reached production seconds after the seal. The
  automatic `release.yml` run now stops at the seal and names the sha; an approver (GE or TB)
  starts Release from `main` with it, and an `approver` job in `release.yml` and `rollback.yml`
  refuses anyone else (SYSTEM_ARCHITECTURE §9.3, deploy runbook §2). Left: TB sets the production
  environment to Selected branches `main`; the server-side approval if the repository stays private.
- 17/10/2026 · TB · ⌘K additions (`docs/guides/foundation.md` §6.7): Waiting on You first with nothing
  typed (the requests waiting on the reader, opening the record each is about), open seats (opening
  the Organogram focused on the seat), preferred and middle names, Use Dark Theme, Use Light Theme,
  Change Density, Install App and Sign Out as actions the app runs, and one forgiven slip in screens
  and actions. Left: nothing.
- 17/10/2026 · TB · Track D of `docs/guides/foundation.md` built: the `workflow` module's routes (My
  Approvals and `/workflow/mine/count` for Home's Waiting on You, one request with its route and
  decisions, approve, reject and request changes with a reason, withdraw, and reassign from the guide's
  §11, migration `0450`), the leave flow `leave.approval` seeded in `0499` (the line manager, then
  Operations & People over 5 days), and ⌘K search on `GET /search` in a new `search` module: screens
  with synonyms, actions (each screen's New action: Add Employee, Start Import, Invite User, New Role,
  New Holiday, Add Role; and Import Staff, Clock In, Request Leave, Change Password, Set PIN, Mark All Read) and every module's records, each group 25 a
  page by the reader's grants. The search coverage gate now fails a route-map screen, an `ENTITY_ROUTES`
  type or a `useScreenAction` label that search cannot reach, unless it carries `search:none <reason>`;
  65 types not built yet carry `not built yet (src/modules/<m>)`, which fails once that module is built.
  `useScreenAction` no longer re-registers on every render (an inline `onSelect` looped). Left: the nine
  modules row, ticked with this merge now that tracks A, B and C are in.
- 17/10/2026 · TB · Foundation track A (`docs/guides/foundation.md` §1.1): the `organisation`
  module on the real API, the staff importer, and MyCity's real staff loaded by every deploy.
  Backend: the register at 25 with search, filters and server sort, the employee 360 masked per
  viewer, Add, Edit, Archive and Restore, reporting lines to a person or to a vacant seat with a
  dotted line beside it, departments, `org_seat` writes, the whole tree in one bounded read (2,000
  nodes), `organisation.search.js` (employees and departments) and `organisation.ai.js` (three
  reads, no writes); migration `0300` (archiving, a start date that may be unknown, the register's
  indexes) and reference seed `0349`. The staff importer `employee.import.js` reads one Name cell, a
  department by name and a line manager in prose (a name, a post, or a post with a dotted line
  beside it), and a VACANT row becomes a seat that carries reports. `scripts/db/load-staff.js` runs
  on every deploy, on staging AND production, as the system: it is quiet when the sheet has not
  changed, drops a column the whole sheet gets wrong (MyCity's DOB holds a day and month with no
  year; Phone is a placeholder in every row), commits the valid rows, gives each person a login in
  the invited state with the roles `seeds/staff/roles.json` grants their post, sends no email, and
  never writes over an edit made in the app. `seeds/staff/staff-list.xlsx` (18 people, 2 open seats)
  and `roles.json` are committed, the repository being private. `seeds/staging/10_staff.js` loads the
  same roster for a demonstration. Shared, additive: `numbering.advanceTo()` (the counter past the
  numbers a sheet brings), `blank()` in the contract (an optional field a form leaves empty), the
  import engine takes batch `options` and honours a service that answers "nothing to write".
  Left: track D (`workflow`); the Documents tab on the employee record, which arrives with the
  documents work; the people tasks in the guide's §1.2.
- 17/10/2026 · TB · Track C of `docs/guides/foundation.md` built, three more of the nine M0 modules:
  `access` (roles created, edited and deleted with their grants, field visibility and capabilities
  in one save; the matrix; nobody can take away their own Settings), `settings` (the organisation
  profile, the working week, public holidays entered on screen, numbering schemes, the security
  rules) and `audit` (`GET /audit` at 25 with filters, the summary, the Excel export emailed through
  the outbox, values masked per reader; Settings view with scope all, or the CEO). Migration `0400`
  (`role_capability`, `role.two_step_required`, audit and session indexes, the `two_step_setup`
  ticket) and seed `0449` (the §6.3 field visibility and capabilities). Security rules are settings
  within the `.env` floor (`PASSWORD_MIN_LENGTH` is new); requiring two-step by role came forward
  from M9 and adds a set-up step to sign-in, so `identity`, `security` and the grants cache changed
  too. Each module has an `.ai.js` (reads only) and a `.search.js`, or `audit`'s written none. Left
  for the row above: `organisation` (track A) and `workflow` (track D).
- 17/10/2026 · TB · Track B of `docs/guides/foundation.md` built: the `imports` module (the
  BACKEND_STRUCTURE §9.3 API over any registered importer, plus `GET /imports/:id` so the wizard
  survives a reload), the `documents` module (`POST /documents` for a file with no record yet,
  `GET /documents/:id` with `/content`, `/variant/:kind` and `/versions`, `POST /documents/:id/versions`
  and `/verify`, `GET|POST /employees/:id/documents` with `/summary` and `/document-requests`), and the
  `ess` module's first tab. Migration `0350` adds `document_request` and `document.verified_at`;
  reading a file stays the vault's rule, so a document the caller may not read is a 404. M0's
  definition of done for files is proved through the gated routes in
  `tests/integration/documents-api.test.js`: a photo, a scanned document and a voice note upload,
  process and download; a direct `/media/vault/...` request is a JSON 404; a letter template
  generates a numbered, hashed, locked PDF that only its readers can fetch. Left for the row above:
  the staff importer and the real sheet on staging, which are track A's.
- 17/10/2026 · TB · Sign-in made luxurious on both shells (TB: slight glassmorphism, motion on
  the phone too): smoked glass for the form and the desktop's city dock, film grain, darkened
  edges, rising points of city light, the city's name arriving out of focus and a ticking colon.
  The phone now drifts, glows and crossfades like desktop. Left: nothing.
- 17/10/2026 · TB · Sign-in: four more cities (Johannesburg, Rabat, Abidjan, Douala; TB's images),
  eight in turn, each photograph fetched only when its city is shown or next. The phone sign-in is
  redesigned: a still portrait crop of the photograph at the top, the brand and a glass clock on it,
  the form in a frosted panel in the dark theme's colours; nothing moves but the crossfade. The
  staging bar is off both apps by TB's decision (MILESTONES §6 and SYSTEM_ARCHITECTURE §10
  updated); the tab icon, theme colour, header and mail marks stay. Left: nothing.
- 17/10/2026 · TB · Sign-in photographs: Lagos, London, Accra and Nairobi at dusk (TB's images, WebP
  at 1280 and 640, about 250 KB for all four) behind the sign-in screen, each drifting and zooming on
  its own path, the lights glowing, a few pixels of pointer parallax, crossfades with a short focus
  pull. The drawings stay as the stand-in until a photograph loads. Left: sharper sources (the
  images are 1280 wide, a little soft on large screens).
- 16/10/2026 · TB · Release fix: staging deployed, but verify-staging refused to seal on two
  checks. The migrations head now counts reference seeds, which share the ledger's numbering
  (`10099_seed_knowledge_ai` is the head, not `10000_…`). `/socket.io` on the public host is now the
  API's JSON 404 (docs/runbooks/proxy.md §5): Engine.IO hands a wrong-host request back to the app,
  and refuses a wrong-host upgrade with a 404, where it answered 400 before. Left: the PENDING
  checks wait for their modules.
- 16/10/2026 · TB · `docs/guides/foundation.md`: the rest of M0 and the foundation in four tracks (A
  people and the staff roster, B imports and documents, C access, settings and audit, D workflow and
  search), with TB's twenty decisions of 16/10/2026. TB claims the remaining M0 modules from GE's row
  (GE reviews). The repository is private; MyCity's staff sheet and role map go into `seeds/staff/`
  with track A and load on staging and production with each deploy (the one exception to
  "production is never seeded"). CLAUDE.md gains that exception and the rule that search reaches every screen,
  action and record type. Left: the four tracks; the people tasks in the guide's §1.2.
- 16/10/2026 · TB · The bell on the real API, one of the nine M0 modules: `notifications`
  (`GET /notifications` at 25 a page with a `status` filter, `/unread-count`, `/badges`, `POST
  /notifications/:id/read` and `/read-all`), the caller's own rows only. Badges count unread
  notifications per module the reader may open; a link is derived from the record and dropped when
  the reader cannot open its module. A read mark is recorded and pushed to the person's other tabs
  (`notification_read`). The shell's bell and the mock moved onto the contract: Open marks a notice
  read, and a notice with no screen has Mark Read. Fixed: `password-reset.html` and `user-invite.html`
  were empty, so every Forgot Password, invitation and reset link failed in the worker after the
  screen said it was sent; both are written, and a test fails any declared email without a template.
  Left: preferences and web push (M6, #74); badges count notifications only, so mail and tasks add
  their own counts when built; audit, settings, workflow, documents and imports routes.
- 16/10/2026 · TB · Two-step sign-in, passkeys and the PIN built (`docs/guides/identity.md` §3, §6),
  reversing "drop WebAuthn for now" (REUSE_MAP §1.1, MILESTONES §5 and §14 amended, DATABASE_SCHEMA
  §4). Backend: migration `0220_sign_in_methods.sql` (the `mfa_*` and `pin_*` columns, `mfa_recovery_code`,
  `passkey`, `spent_challenge`, `pin_totp` sessions); the `security` module (RFC 6238 codes on
  `node:crypto`, ten Argon2id recovery codes used once each, passkeys through `@simplewebauthn/server`
  with the fingerprint or face required, the four-digit PIN with the password's wait and a switch-off
  after 10 wrong in a row or 20 in 30 days, single-use tickets between steps, the 15-minute fresh
  sign-in window and `POST /security/confirm`); `/auth/two-step`, `/auth/pin`, `/auth/passkey`;
  Reset Two-Step on Settings · Users; `WEBAUTHN_RP_ID` and `WEBAUTHN_ORIGIN` (default: the staff
  origin's host). Frontend: the code step and Use Passkey and Use PIN on the sign-in card, the lock
  screen's PIN, passkey and code, My Security's Two-Step Sign-In, PIN and Passkeys, Confirm It's You,
  `OtpField` `secret` and `onComplete`. Tests: unit, `tests/integration/security.test.js` on the
  real migrations with a software authenticator, and a browser run on the real API with Chromium's
  virtual authenticator. Left: passkeys on a real phone; enforcement by role (M9); the servers'
  `.env` may add the two WebAuthn lines (optional: the default is right).
- 16/10/2026 · TB · `create-admin --build-account --env=<name>` makes the implementation team's
  login with every employee field filled (JBS Praxis Implementation Team, known as JBS Praxis,
  consultant, remote, contract 09/10/2026 to 09/12/2026 at ₦1,850,000.00 a month, phone 0802 749 2738,
  address, next of kin, bank); only the email and password are typed, so neither is in the
  repository. Empty by design: worksite, managers, seats and `left_on`. `employee` gained
  `home_address` and `contract_ends_on` (`0210`); the contract now also takes `middle_name`,
  `preferred_name`, `personal_email` and the confirmation dates. Left: run it on staging and
  production (`docs/runbooks/first-accounts.md`).
- 16/10/2026 · GE · Mail host values in (`docs/runbooks/dns-and-mail.md` §4): `mycityapp.io`,
  465 and 993, 50 recipients an hour, 30 IMAP connections per IP, 30 mailboxes. System mail is now
  paced to the hourly limit (`services/mail/pace.js`, `MAIL_SEND_PER_HOUR`: production 40, staging
  10, required on servers); over it, jobs wait for a slot instead of failing. The env templates
  carry the values. Left: the SMTP password and `MAIL_SEND_PER_HOUR` in both `.env` files on the
  server; whether the 50 is per mailbox or per account; the IMAP limit is a rule for the Mailbox
  module (`mailbox.md` §6).
- 16/10/2026 · TB · Sign-in and sessions built (`docs/guides/identity.md`). Backend: migration
  `0200_identity_sessions.sql` and seed `0290_seed_roles_and_grants.sql` (the seven real roles with
  a home view and rank, and the grants matrix); `identity` (sign-in, refresh with rotation and reuse
  detection, sign-out, the device cookie and new-device notice, forgot, reset and invitation links
  through the outbox, change password, own sessions, the throttle instead of a lockout, the breach
  check), `access` (roles), `users` (Settings · Users) and the first `organisation` service code;
  contract schemas `identity`, `users`, `access`. Sessions last 2 hours, lock after 30 idle minutes,
  every token capped at the session's end, the refresh token in an HttpOnly cookie. Passwords are 8
  characters with mixed case, a number and a symbol. Frontend: the four-city sign-in screen
  (`CityShowcase`), Forgot, Reset and Welcome, the lock screen (`LockScreen`) with the session clock
  and cross-tab locking in `AuthProvider`, refreshes serialised across tabs in `createApi`, the app
  typed from `contract.gen.ts`. `organisation` writes the employee columns of `0110`. Fixed on the
  way: the rate limiters shared one counter. Left: two-step sign-in, passkeys and the PIN (the
  second sign-in PR); the notifications and search routes (the bell and
  ⌘K still on INTERIM types); the organisation routes, so the employee screens still use the mock;
  `create-admin` on staging and production for the operations lead and the build account
  (`docs/runbooks/first-accounts.md`).
- 16/10/2026 · GE · `docs/DATABASE_SCHEMA.md` rewritten as the database design: the M0 core and how a
  module attaches to it, each milestone's block, owner, tables as built and what it still owes (from
  the coverage audit), what is not built and why (passkeys per REUSE_MAP; nothing for M11), and the
  open decisions (payroll design, the role permission matrix, moving business choices out of seeds).
  M6 payroll is in scope (MILESTONES §11); the earlier "not modelled" note is withdrawn.
- 16/10/2026 · GE · The integration suite runs on the real migrations: `tests/integration/helpers/schema.js`
  rebuilds the schema with `migrate.js` and `fixtures/shared-layer.sql` is gone; CI now has PostgreSQL 16
  with pgvector and Redis, so the suite and gate 4's round trip run on every PR. `1100` lets the alerts
  code raise an alert with no trigger and returns `over_by` to two places. 82 of 82 integration tests
  pass. Left: the role permission matrix (M9), the staff-number counter after an import.
- 16/10/2026 · GE · M0 schema made to match the foundation code: `0100` lets the shared layer write
  what it writes (emit's empty diff, bell rows without a body, untitled uploads, 0-based import
  header rows, refused AI runs, the AI settings defaults); `0110` gives `employee` the contract's
  columns (`staff_number`, gender, date of birth, next of kin, bank, gross monthly, dotted line,
  vacant seats in `org_seat`) with checks equal to the contract's enums; `0120` indexes the 43
  unindexed M0 foreign keys; `0199` fixes `on_site`, adds employment types, makes Saturday
  09:00 to 15:00 (A22) and staff numbers `00001`. `migrate.js --down` now rolls back to empty; the
  health check reports the real head. Phone numbers abroad are accepted in international form.
  `0130` lets the error reporter record an error with no extra detail (it was silently lost).
  Left: `home_alert` (M1 block) and the integration suite on the real migrations (next PR); role
  permissions wait on a role matrix; the importer must advance the staff-number counter past
  imported IDs.
- 16/10/2026 · GE · Gate 6 built: `check/schema-drift.js` (every SQL string in `src/` and `scripts/` names only
  tables and columns the migrations create: qualified columns, INSERT column lists, UPDATE SET lists,
  dropped or unknown tables, a table created twice with different columns) and `check/contract-columns.js`
  (each contract file's `TABLES` names the table every object schema's keys are columns of, with a
  reason for any key that is not), over one catalogue read from the migrations (`check/lib/catalogue.js`,
  checked column for column against a migrated database). Run against the schema PR 25 merged,
  contract-columns reports the 12 employee mismatches. `CI_STRICT` is on: no gate can sit empty again.
  Left: nothing for gate 6; every new contract file declares its `TABLES`.
- 16/10/2026 · GE · Migration conventions written (`docs/MIGRATIONS.md`) after the audit of the PR 25
  schema, and A26 added (reference seeds hold only what the code cannot run without). Left: a
  fix-forward M0 file for the six columns the shared layer cannot write (`audit_ledger.changed_fields`,
  `notification.body`, `document.title`, `import_batch.header_row`, `ai_run` vendor and prompt,
  `home_alert.trigger`), the `0002` DOWN, the employee columns the contract and staff importer need,
  and the integration suite moved onto the real migrations.
- 16/10/2026 · GE · Alerts go to WhatsApp: one sender (`shared/observability/alert.js`) for errors,
  the backup, the restore drill and the uptime probe; `ALERT_WHATSAPP_URLS` holds one gateway link
  per person (CallMeBot, or TextMeBot), `ALERT_WEBHOOK_URL` stays for a Slack or Google Chat
  webhook. Messages cut to 900 characters, 5 per person per 10 minutes. Setup:
  `docs/runbooks/monitoring.md` §2. Left: each person's link, then the setting on the server and
  the repository secret.
- 16/10/2026 · GE · Operations built: `scripts/db/backup.sh` (nightly, both databases with the
  migration head and every table's row count read from the dump's own snapshot, media as
  hard-linked snapshots, 14 of each, offsite mirror over SSH into its own folder, alert on failure),
  `scripts/db/restore-drill.js` (newest nightly into a scratch database, exact counts demanded,
  timed, fails when the backup has stopped), `mycity-backup` and `mycity-restore-drill` services
  and timers installed by `provision.sh`, `ops/monitoring/uptime-probe.js` with
  `.github/workflows/uptime.yml` (every 10 minutes from GitHub: readiness, environment header,
  certificate days; alerts on change). Exercised in a copy of the server layout, including a dump
  taken under constant writes. Runbooks written: `backup-restore.md`, `incident.md`,
  `monitoring.md`, `add-a-module.md`. Left: re-run provisioning on the server to install them,
  the offsite host (`backup-restore.md` §2), the WhatsApp alert links in production's `.env` and as
  a repository secret; the M11 rehearsal in front of MyCity.
- 16/10/2026 · GE · RichTextField no longer touches a destroyed editor: TipTap's `useEditor` can
  destroy its first editor before the mount effect runs on a slow machine, and the draft sync then
  threw (gate 11 on CI). `syncDraft` skips a destroyed editor, with a test. Nothing left.
- 16/10/2026 · LA · Moved deterministic reference SQL to `seeds/reference/` while retaining CLAUDE.md's milestone blocks (`0099`, `1099`, and so on). `db:migrate` now interleaves both folders and the migration gates enforce unique numbers and milestone ownership across both. Payroll tables remain deferred; only shared numbering configuration required by the existing numbering contract is seeded. Left: create environment-specific staging people and transaction data through services.
- 15/10/2026 · LA · PostgreSQL 16 migrations and deterministic reference seeds added for M0 to M10, with the table catalogue and relationship map in `docs/DATABASE_SCHEMA.md`. Payroll schema is deliberately deferred pending the tax-reform contract; sanction fines remain standalone. Migration number, idempotency, reversibility and PostgreSQL 16 UP/DOWN/UP checks pass (the local check substituted the vector type because pgvector is not installed). Left: verify the unchanged pgvector statements where the extension is installed, then create environment-specific staging people and transaction data through services.
- 16/10/2026 · TB · Frontend foundation PR 3 (Build kit) done, and with it the whole frontend foundation (`docs/FRONTEND_FOUNDATION.md` §4 and §6; the four questions answered in §5: one `sort` key with a per-list allow-list, both styling-exemption lists emptied and deleted, TipTap in a lazy chunk for rich text, the browser's own PDF viewer plus an image viewer with Open in Tab). `packages/ui` now holds 157 components: a Data group (DataView with the pager, server sort, selection, bulk actions and Export; Kanban to F19; Calendar), a Charts group (area, bar, donut, bands, sparkline, each its own lazy chunk, both palettes from the chart tokens), a Documents group (DocumentPreview, ImageViewer, Paper, Reader), a Maps group (MapView, PlaceSearch, LocationLabel on Leaflet with the tiles, the address search and the reverse lookup all proxied), the KPI pieces and the record display parts, and the pickers, the upload engine, SignatureField, RichTextField, VoiceField and Tick in Forms. The contract gained one `sort` key per list (a field name, a leading `-` for descending, allow-listed, a 422 naming `sort` otherwise) and `shared/http/paged.js` gained `orderBy()`, which builds the ORDER BY from the repo's own map so a caller picks a key and never a character of SQL. Both apps' `components/` folders are deleted, LEGACY and §7 are empty, and `styling-exemptions.json` is gone with its readers: 804 arbitrary values converged onto the named type, spacing, radius and leading scales, and the last 10 inline styles became shared components, because an app may not write `style` at all. The mailbox composer runs on the shared editor rather than its own `contentEditable` on the deprecated `execCommand`. The map's drawing holds no focus (Leaflet's keyboard panning, focusable markers, zoom control and Leaflet link are off; the zoom buttons are ours, outside the hidden part), a list's pages are a landmark named after that list, a board's stages are a screen's second level, and the file input sits out of the reading order behind the words a person presses. 663 tests green in the package, the whole `npm run ci` green. Left: the Geoapify proxy routes are backend work (attendance, worksites), so the map components run against the paths `maps/geoapify.ts` names; voice input waits on the M2 transcription route; screens adopt server sort as each module's contract names its sortable fields.
- 15/10/2026 · GE · Release pipeline built: `deploy-gate` (stage, seal, promote, rollback, status;
  each deploy key forced to its own commands), `release-manifest.js` (release tarball with
  `RELEASE`, `BUILD.env`, `SHA256SUMS`), `verify-staging.js`, `rollback.sh`, `release.yml` (build,
  staging, verify and seal, approval, promote, tag) and `rollback.yml`. Exercised end to end in a
  cloud copy of the server layout. Server fixes: the environment folder belongs to `mycity-deploy`,
  the units read the release's `BUILD.env`. Runbooks: `deploy.md`, `rollback.md`. Left: the
  one-time setup in `deploy.md` §1 (keys, GitHub environments), re-running provisioning, then the
  first release once DNS and mail are in; the checks waiting for modules (sign-in, RBAC, workflow,
  PDF, mail, Playwright); nightly backups (`backup.sh`, `restore-drill.js`).
- 15/10/2026 · GE · Server 108.181.196.53 (Ubuntu 24.04): `ops/provision/provision.sh` takes a fresh
  install to a ready server (Node 20, PostgreSQL 16 + pgvector, Redis, Chrome, ffmpeg, ClamAV,
  nginx + Let's Encrypt, firewall), with the two environments' users, databases, `.env` files and
  directories; the four systemd units, the nginx files and the deploy key template. Proxy is nginx
  from `ops/nginx/` (no hosting panel); processes run under systemd. Runbook:
  `docs/runbooks/server-setup.md`. Run once on the server the same day. Left: DNS for the four hosts
  (`docs/runbooks/dns-and-mail.md`), mail settings, then the release pipeline (`deploy-gate`, `release.yml`) for the first deploy.
- 15/10/2026 · TB · Frontend foundation PR 2 (Shell) done, to `docs/FRONTEND_FOUNDATION.md` §4 and §5 (four questions answered: the frame in `packages/ui`, the session sheet in place, the phone top bar, the install offer). `packages/ui` gains a Shell group (15 components) and one copy of the environment and the delivery plan. Staff app: desktop rail and top bar; phone top bar with the pin, search, bell and avatar over a title rail; bottom bar Home, Workspace, Community, Self-Service, More (F16); More as a launcher of the modules the `/me` grants allow (F17); the floating button with the screen's New action, Clock In or Out, Praxis AI, Help and Hide Here (F18); ⌘K search; the bell on Socket.io; sign-in, sign-out and the in-place session sheet; update, install and offline in the PWA. Both apps open screens by F14: production at API, UI and Mobile, staging at API, the Prototype View switch only on the mock. Public site on PublicPage, ComingSoon and the staging bar. `/gallery/` on the staff host everywhere but production. The a11y gate now crawls all 86 app screens at both sizes and they pass; `npm run new:screen` adds a screen to the catalogue, route map, module, PROGRESS and the gates at once. Left: PR 3 (Build kit); screens adopt `useScreenAction` as they are touched; presence needs M1 chat; the release pipeline must carry `packages/ui/dist-gallery`.
- 15/10/2026 · TB · Frontend foundation PR 1 (Ground) done, to `docs/FRONTEND_FOUNDATION.md` (decisions F1 to F24). `packages/ui` (`@mycity/ui`) is the one design system for both apps: tokens, density and motion, 87 components (primitives, overlays, help, toast, the form system, the shared data client), the generated catalogue `docs/COMPONENTS.md`, `npm run new:component` and the gallery (`npm run gallery`). Both apps import every Ground part from `@mycity/ui`; the app copies are deleted and FRONTEND_FOUNDATION §7 lists what PR 2 and PR 3 still move. Merged with the screen conventions work: its screens and copy stay, and `@mycity/ui` takes its API (`useContractForm(initial, rules or schema)`, `Button busy`, `Wizard`, `CardHeader help`). New gates: components, palette, contrast, native dialogs, upload, mock-free, a11y, frontend typecheck, lint, test and build; gates 8 and 11 crawl the gallery and every app screen. Left: PR 2 (Shell) and PR 3 (Build kit).
- 15/10/2026 · AJ · Screen conventions in the staff app (FRONTEND_GUIDE §5, §7, §8): gates 8 and 11 now crawl all 86 app screens at phone and desktop size (the build writes `dist/screens.json`; `scripts/check/lib/screens.js` builds and serves the demo app, CI installs `app/`), and both pass. `HelpTerm` and `Details` replace the ⓘ toggle; about 60 explainer cards, footnotes and long captions are gone; titles are Title Case and within the word limits; `Table` is a card list on a phone; controls are 44 px on a phone. Forms: `useContractForm` on react-hook-form, the §8.6 names, `FormFooter`, `Wizard` (seven long forms), `PhoneField`, `CheckboxField`, the Optional tag; Submit is never disabled. Left for this item: the contract client (waits on `contract.gen.ts`), Lucide icons and the illustration set (§5.5), and crawling as Staff and the CEO.
- 15/10/2026 · GE · CI gates, first group. Gate 3 migration numbers (unique across `migrations/`
  and `seeds/reference/`, in the milestone's block), gate 4 reversibility (a DOWN or `-- IRREVERSIBLE:
  <reason>`, DOWN names what UP creates, `-- DESTRUCTIVE: <reason>` on destructive steps, and UP,
  DOWN, UP on a throwaway database when RUN_DB_TESTS=1), gate 5 idempotency (and a merged migration
  never edited, by git), gate 17's backend half widened to packages/ and AI prompts, gate 15 day-first dates
  (backend formats only through `shared/time`), gate 20 money, and the guards: module catalogue,
  production environment references, shell scripts LF and parse, every JavaScript file parses.
  `migrate.js`: four digits through M9 and five from M10, with schema and reference-seed steps
  ordered together; `--down` refuses an
  irreversible file. `scripts/import/run.js`: list, template, upload, map, preview, errors, commit,
  revert, as a named person. Left: gate 6 (schema-drift, contract-columns); the catalogue gate's
  `--exact` at M9; a Postgres service in `ci.yml` so the round trip and integration tests run in CI;
  the real staff sheet on staging.
- 15/10/2026 · GE · Shared foundation, phase 6 of 6: AI and search. `services/ai`: `complete()` through
  governance (switch, per-module switch, monthly cap in naira), redaction (Nigerian identifiers,
  restricted fields), prompt files, Gemini (or the stub with no key), structured output against the
  contract with one corrective retry, and the ledger (`ai_run`, `ai_run_step`, cost from tokens);
  transcription's seam (Gemini audio in M2). `shared/ai`: `defineManifest` (reads and routes only,
  A23), registry, `authorise` (caller's grant and scope, pages of 25, masking, citations), catalogue
  sync (worker boot and deploy). `shared/search`: providers, registry, ⌘K service (grant first, scope,
  pages of 25, typo matching). `rbac.scopeFor` for non-route callers. Gates built: 9, 10 (backend
  half), 19, AI vendor imports. New env: `GEMINI_*`, `AI_*`. 22 unit and 16 integration tests. Left:
  migration 0095 (LA: ai tables in BACKEND_STRUCTURE §11.1), the M10 assistant, the screen-registry
  half of gate 10 (AJ), per-module manifests and providers with the modules.
- 15/10/2026 · AJ · `npm run contract:status` (in `app/`, FRONTEND_GUIDE §9.1): reports, for both apps, which modules still run on INTERIM types and which are ready to move to `contract.gen.ts`. Today 19 INTERIM files, 317 endpoints, none in the contract yet.
- 15/10/2026 · AJ · Delivery plan in both apps (FRONTEND_GUIDE §9.2): production shows Coming Soon for any screen whose row here is not fully ticked, with its milestone and date from this file and MILESTONES §4 (the public site hides both from visitors); development, the demo build and staging get the demo's "Prototype View" switch: Full Design, or As Delivered at the current milestone (the earliest not past its demo day and not fully ticked; M1 today). This file is now read by the frontend build, so the table format (backticked slug, M column, three tick columns) must hold.
- 15/10/2026 · AJ · Both apps pass gate 12 (`scripts/check/forms.js`): every field, the `<form>` and the field components moved to `components/form/` (FRONTEND_GUIDE §8.6, §9.4), imported from `@/components/form`; screens no longer write a raw form element; placeholders are short examples, with any instruction moved to the field's ⓘ. Left for the screen-conventions PR: the §8.6 names, `useContractForm` on `react-hook-form`, and Submit never disabled.
- 15/10/2026 · AJ · Staging bar in both apps (MILESTONES §6): shown on a `staging.` host or when the API answers `X-Mycity-Environment: staging`; fixed above everything in `app/`, sticky in `public-app/`. Production renders nothing. The tab icon becomes the pin on amber (`favicon-staging.svg`) and the browser bar takes the staging amber (`theme-color`). Left from §6: the installed staff app's home-screen icon and splash colour come from the PWA manifest, which is fixed at build; varying them needs `src/http/static.js` to serve a staging manifest on `hub.staging` (GE).
- 14/10/2026 · GE · Shared foundation, phase 5 of 6: the worker. `worker.js` (loads the shared and
  module events files and importers before `markReady()`, then consumers, schedules, a heartbeat that
  /api/health/ready reads), `jobs/{queues,registry,cron-lock}` (BullMQ, prefix `mycity:<env>`, one
  run per tick under a Postgres lock), the eight M0 handlers and five schedulers (outbox every
  second in process; workflow timeouts, alert ageing, media reconcile, import cleanup), outbox
  triggers (document stored or render requested queues the scan, transcode or PDF job), Socket.io
  on the API (staff host only, HTTP sign-in rules, `user:` and `session:` rooms, closed at token
  expiry or session end) and the realtime emitter the worker publishes through, `db:migrate`,
  `db:seed` (three production checks) and `gen:contract` (contract gate now built). New: the
  notification email template, `WORKER_DB_POOL_MAX`, `import.expired`; Chromium no longer calls out; quoted template front matter.
  New packages: bullmq, socket.io, @socket.io/redis-adapter and redis-emitter (socket.io-client for
  tests): run `npm install`. 27 unit and 18 integration tests added, one starting the real worker
  process and rendering a PDF through it. Left: phase 6 (AI and search); M0 migrations and reference seed 0001 to 0099
  (LA: `schema_migration` and `system_marker` columns in BACKEND_STRUCTURE §11.1); web push (M6).
- 14/10/2026 · GE · M0 table brought up to date with phases 1 to 4. Ticked: root config, the shared
  core, and documents, media, uploads and PDF generation. Partly done, so not ticked: the app
  entry points (`worker.js` is phase 5), the contract package (`common.js` and `http/route.js`
  are built; the `gen:contract` generator is phase 5), and imports (the engine is built; the staff
  importer lands with the imports and organisation modules, then the staging import). Next:
  phase 5, the worker, jobs, realtime and the db and gen scripts.
- 14/10/2026 · GE · Reuse pass on phases 3 and 4 (REUSE_MAP §1.4 records every change on the
  way in): deliverability (DMARC, PTR, RBL, route check; system mail refuses a trapped route),
  encryption as is, spreadsheets with a workbook context and live totals, photo enhancement,
  a doc-type register (`documents/types.js`: reader module, signing ceiling) that `vault.store`
  enforces, served types limited to the allow-list, one name for derived files, versioned
  canonical signature payloads, and an escape-first Markdown renderer (`marked` removed).
  272 tests (228 unit, 44 integration) and `npm run ci` pass on Node 20.
- 14/10/2026 · TB · Screen gates built: gate 8 (three tiers of screen text, word limits, Title Case),
  gate 11 (phone and desktop shells), gate 12 (one form system), gate 17 (no dashes in copy). They
  render demo.html at 390 and 1440 px in Chromium and will read `app/` once it has a build.
  MILESTONES gates 8, 11 and 12 amended; guide template §10 now lists content tiers and the phone
  layout. Every demo module now passes all four. Left: the crawler blind spots listed in PR #16.
- 14/10/2026 · GE · Shared foundation, phase 4 of 6: files (`sniff` by bytes, per-purpose
  `mime-policy`, `safe-name`, `hash`), `services/storage` (atomic, contained keys), the vault
  (store, versions, lock, quarantine and scan, access rules, range downloads),
  `services/media` (image profiles with metadata stripped, voice and video through ffmpeg,
  clamd scan, reconcile), generated documents (`generate` queues HTML, the worker renders
  through Chromium, stores, hashes, locks), the template language, template versions and
  variables, Markdown, canonical hashing, spreadsheets (xlsx and CSV in and out, day-first dates,
  formula escaping), the import engine (map, real preview, commit, revert, error file), system mail
  (captured off servers, marked on staging), deliverability checks, encryption, QR and ICS.
  Letterhead and mail layout templates written. 223 unit tests, 43 integration tests (with real
  Chromium and ffmpeg). New env: media tools and SMTP (SMTP_HOST required on servers). Tables in
  BACKEND_STRUCTURE §11.1 (LA). `web-push` stays for M6.
- 14/10/2026 · GE · Shared foundation, phase 3 of 6: `events/{catalogue,emit,outbox}` (one `emit()`
  writes event, audit and outbox in one statement; handlers run after commit with per-handler
  retry), `workflow/{conditions,definitions,approvers,engine}` (test.threshold, versioned
  definitions, no self-approval, timeouts, My Approvals), `rbac/field-mask`, `alerts`,
  `notifications/{categories,fanout}`, `route-map` (links derived, never stored; checked against this
  file's tabs) and `crud/resource`. Integration suite added (`tests/integration`, `RUN_DB_TESTS=1`,
  27 tests against Postgres 16); 188 unit tests. Gates: pagination allows a marked worker batch
  claim, numbering checks the resource kit's `docType`. Tables these read are in BACKEND_STRUCTURE
  §11.1 (LA); Home's alert columns aligned in `docs/guides/home.md` (TB). `db.js` provenance line
  removed again (it had come back on disk).
- 14/10/2026 · GE · Shared foundation, phase 2 of 6: `shared/db/{query-helpers,effective-dated}`,
  `money` (decimal.js, Naira, kobo-exact `allocate`), `time/{lagos,day-first,working-week,recurrence}`,
  `numbering/{numbering,schemes}` (rollback-safe, gap-free), `geo`, `rules/window-counter`,
  `state/state-history`, `dedup`, `tokens/public-token` and `middleware/public-token`. Gate built:
  numbering-schemes. 155 unit tests; numbering under 20 concurrent saves, rollback, effective dating,
  tokens and the working week also checked against real Postgres. `crud/resource.js` moves to phase 3
  (it writes through `emit()`). New columns for LA in BACKEND_STRUCTURE §11.1.
- 14/10/2026 · GE · Review of phase 1: the API now serves both frontend builds by host (`http/static.js`:
  `app/dist` on hub., `public-app/dist` on go., SPA fallback, cache headers, a host guard that 404s
  the other surface's API); the proxy only forwards (`docs/runbooks/proxy.md` rewritten). Code never
  names the project it was ported from; `check/provenance.js` enforces it. Responses are
  checked as the client receives them (dates as strings); path params reach `req.validated`. Suite
  green on Node 20, 22 and 24.
- 14/10/2026 · GE · Shared foundation, phase 1 of 6 (branch `m0/shared-foundation`): the app boots.
  Written: `config/*` (env refuses an unsafe server boot), `app.js`, `server.js`, `http/*`
  (`route()` enforces a contract and a permission on every route), every middleware except
  `public-token`, `shared/http/{validate,respond,body-limits}`, `shared/db/{tx,pg-types}`,
  `shared/rbac/{grants-cache,scope,sessions}`, `shared/access/access.catalog`, observability.
  Gates now built: env-template, route-contracts, public-surface. 80 unit tests; the request path
  also checked against a real Postgres 16 and Redis. Left: `worker.js` (phase 5), `public-token`
  (phase 2). The columns this code reads are listed in BACKEND_STRUCTURE §11.1 for the 0010 to
  0040 migrations (LA).
- 13/10/2026 · GE · CI wired: `npm run ci` runs every gate locally and in Actions; empty gates are
  reported NOT BUILT, not passed. Process gates and the Claude Stop hook added. Branch protection
  needs TB to apply the runbook; CODEOWNERS needs LA and AJ usernames.
- 13/10/2026 · GE · Pagination gate, `create-admin` and the engineering docs written (12 October
  meeting actions). `create-admin` calls the organisation, identity and access services, which are
  still empty; it runs once those M0 modules land. Root `package.json` is still an empty file, so no
  Node command runs in the repo yet.

---

## Screens

### Home

| # | Screen | Tab | M | Owner | API | UI | Mobile | Status | Updated |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Overview | `overview` | M1 | TB | ☑ | ☑ | ☑ | Built | 21/10/2026 |
| 2 | Alerts | `alerts` | M1 | TB | ☑ | ☑ | ☑ | Built | 21/10/2026 |
| 3 | Reports | `reports` | M1 | TB | ☑ | ☑ | ☑ | Built | 19/10/2026 |
| 86 | Team | `team` | M1 | TB | ☑ | ☑ | ☑ | Built | 21/10/2026 |

**Notes**

- 21/10/2026 · TB · Overview (#1): Add Work Site's sheet opens on Hours (Usual Shift or Site Hours); on a day of a site with its own hours the Staff day strip's Shift Today shows the site's hours (`docs/guides/home.md` §3 step 10, §6). Left: nothing.
- 21/10/2026 · TB · Attendance's PR 3 (rules and schedules, `docs/guides/attendance.md` §1.2): Alerts (#2) shows attendance's alerts as the Attendance policy's breaches on the five rules the system keeps (People Approvers, no Over By, Query Due while M3's query is not in), Alert Rules opens with the read-only Attendance Policy card and Set in Attendance Policy, and Home's own Late Arrivals and Missing Clock-Outs rules are switched off with their open alerts dismissed (`1445`; the staging seed keeps two rules). Overview (#1): the day strip and Your Week read the person's own shift (their work schedule, else the company hours). Team (#86): the roster counts only people with a login as expected. Left: nothing on Home for PR 3.
- 20/10/2026 · TB · Overview (#1): Add Work Site (attendance's PR 4, `docs/guides/home.md` §3 step 10, `docs/guides/attendance.md` §6.11): a button beside New, an entry in New and, on a phone, the floating button's second action, each opening Attendance's temporary site sheet over the Overview (`?action=work-site`, also ⌘K's). The Purpose list is searchable (`SelectField searchable`, packages/ui). A present day on an approved site reads Field on the roster and Team, a Temporary Home Remote. Left: nothing.
- 19/10/2026 · TB · Overview (#1): the clock-in prompt left Home (owner decision of 19/10/2026, replacing O12; `docs/guides/home.md` §3, §6). `HomeOverview.prompt_clock_in`, `dashboard.prompt.js` and the Overview's opener are gone; Attendance decides the prompt and the shell opens it on whatever screen comes first (`docs/guides/attendance.md` §6.14). The Overview still reads itself again after a clock-in (its screen test now punches directly). Left: nothing.
- 19/10/2026 · TB · Overview (#1) and Reports (#3): the Overview's Export and Run Now download their file on the device that pressed instead of emailing it (`docs/guides/home.md` §3, §5 to §7, §10; foundation.md §6.12). The button is busy while the run's file is made, Recent Runs shows it Pending meanwhile, and the toast reads "RPT-0215 downloaded". `GET /home/overview/export/:id` lets Staff, who hold no `home.reports`, wait on their own Overview run. A schedule's runs are still emailed. Left: nothing.
- 19/10/2026 · LA · Home · Team (#86) and Clocked In Today: the roster's `field` status (`docs/guides/attendance.md` §6.9, §6.12; `docs/guides/home.md` §6): someone present on a field assignment's day reads Field, counted in Present Today and Clocked In Today, with a Field chip on Team and in Clocked In Today's groups, and the site in the Worksite column. Team's four cards are unchanged. Left: nothing.
- 18/10/2026 · TB · Home PR 5 (`m1/home-reports`): Reports #3 built on the real API, desktop and
  phone, which completes Home. `src/modules/reports`: the source registry (Daily Attendance, Leave,
  Open Alerts, Headcount, the four forward sources and the reader's own Overview, each over its
  screen's own query, gathered page by page as the reader); reports with sharing, filters and a
  recurrence schedule (start day, time in Lagos, working days only, PDF or XLSX, recipients who hold
  `home.reports` and the source's grant); pause, resume and archive for the owner or the CEO; Run Now
  and the Overview Export as pending runs, the same run on a second press; `scheduled-reports` and
  `scheduled-report` (one run per recipient and format per slot); `reports.generate` building each
  numbered file (RPT-0001) as its recipient, skipped when they may no longer have it, emailed once it
  exists and opened only by its recipient, its owner and the CEO. The tab: the four counts, a card
  per report with Run Now, Edit, Pause or Resume and Archive, Recent Runs paged at 25 with Download,
  and New Report and Edit Report as one three-step form. The staging seed (`seeds/staging/60_home.js`)
  gives every Home card, chart, list and tab figures on staging: attendance for the real staff through
  the attendance module, forward rows by fixed ids in its `HOME_STAGING_ROWS` manifest, the morning
  sweep's alerts and four reports through the reports service; it refuses production. Left: each
  owning milestone deletes its `HOME_STAGING_ROWS` entries when its own staging seed lands
  (DATABASE_SCHEMA, Read by Home); PDF rendering on staging needs Chromium wired.
- 18/10/2026 · TB · Home PR 4 (`m1/home-alerts`): Alerts #2 built on the real API, desktop and
  phone. The metric registry (`alerts.metrics.js`, nine metrics, each breach read in SQL a batch at
  a time) and the 06:00 Lagos sweep (`home-alert-sweeps`, each subject in its own transaction, a rule
  it cannot read logged and skipped); late arrivals re-read on `attendance.punched` and late arrivals
  and missing clock-outs on `attendance.day_closed`; a breach a person cleared is not raised again
  for the same evidence. Who sees an alert is one condition in `alerts.repo.js`, read by the list,
  the counts, the Overview, the Open High Alerts card, ⌘K and the assistant; clearing needs
  `alerts.clear` and the rule's grant reaching the subject; rules are created, edited and switched
  off by `alerts.manage` holders (switching off dismisses their open alerts in the same
  transaction). The tab: the four counts, category chips, Alert Sources, the paged list with View
  Dismissed, Clear Alert and Dismiss Alert (the sheet sends the outcome; the API's optional note is
  not asked for, as home.md §10.1 lists no note field), and Alert Rules (New Rule also in ⌘K, and
  ⌘K's rule results open Edit Rule at `?rule=`). The M7 and M8 stub jobs (partner inactivity,
  budget threshold, approval ageing) are superseded by the sweep. Left: Reports (PR 5); partner,
  budget and recruitment alerts find nothing until M4, M7 and M8 use their tables.
- 18/10/2026 · TB · Home PR 3 (`m1/home-team`): Team #86 built on the real API, desktop and phone.
  `GET /home/team/summary`, `/home/team` and `/home/team/attendance` behind `home` view and
  `home.team`, in the grant's scope; the four Team cards each equal the records they open (Flags counts
  each person once, late or no clock-out yesterday); Attendance This Month is My Attendance's figures
  per person from the roster's new `month()`, one paged query; `team.today` for the assistant. Home's
  Team, Alerts and Reports tabs now show to every Home viewer, locked ("For Managers") without their
  capability, and ⌘K still hides them. Left: Alerts (PR 4), Reports (PR 5); People · Attendance taking
  an employee so View Attendance opens that person's day (LA).
- 18/10/2026 · TB · Home PR 2 review fixes: Your Week reads each working day on its own page, so a
  busy week keeps Friday and Saturday; a role saved with no card follows its Home view; Choose Cards
  starts from the cards showing, so a lock added after a pick saves; the Overview reads itself again
  after a punch; Monthly Signed Value adds up to the Signed Value card; Upcoming Leave has View All
  to My Leave; the guide says when the clock-in prompt opens and which lists have a paged home.
  Nothing ticked. Left: as below.
- 18/10/2026 · TB · Home PR 2 (`m1/home-overview`): Overview #1 built on the real API, desktop and
  phone. `GET /home/overview` resolves each Home view's sections (Operations: attendance over 14
  working days and the On Time donut from the shared roster; CEO: goals and Org KPI; Partnerships:
  signed value by month and the pipeline; Staff: the day strip, My Goals and Upcoming Leave; Your Week,
  Activity Today and Need You for everyone) and decides the clock-in prompt (the first session of a
  working day with no clock-in and no leave), which replaces the old after-sign-in trigger. The
  records behind every card (paged at 25, masked, 404 when not the reader's), Choose Cards with the new
  `CardPicker` (locks, Move Up, Move Down, Use Role Default), a role's cards over the API (the editor is
  M9), the prune after an access change, `cards.mine` for the assistant and `home_kpi` in ⌘K. Left:
  Team (PR 3), Alerts (PR 4), Reports and the Overview's Export (PR 5).
- 18/10/2026 · TB · Home PR 1 merged with Attendance's clock-in and clock-out (LA, #55). The shared
  roster now reads each day as Attendance records it (`attendance_day`) and a day with no record by
  the register's rules, so Clocked In Today, the Team cards and My Attendance on Home equal People ·
  Attendance and My Attendance; the roster gains `absent`, remote is the work pattern, and `1150`
  drops its index on `attendance_event`. Nothing ticked. Left: as below.
- 17/10/2026 · TB · Home PR 1 of 5 (foundation, `m1/home-foundation`), built to the owner's twelve answers in
  `docs/guides/home.md` (rewritten first). Schema `1150` (rule names, `home_alert.subject_employee_id`,
  report schedules with start day, run time, formats and recipients as users, `home_report_run`,
  `role_kpi`, `home_kpi_pick`) and reference seed `1199` (capabilities `home.team`, `home.reports`,
  `alerts.manage` and their grants, `alerts.clear` for Heads of Department and Managers, the
  `report_run` numbers, 1099's thresholds moved out per A26). Capabilities on `/me` and in the shell and
  ⌘K mirrors. The contract for all four tabs (`dashboard.js`, `alerts.js`, `reports.js`). The KPI
  catalogue (29 cards, 26 live; Goals On Track and My Targets wait for M2, Payroll In Progress for M6),
  nine source adapters for the later milestones' tables, and the shared attendance roster
  (`attendance.roster.js`, LA to review). No route is mounted and no screen moved, so nothing is
  ticked. Left: Overview with the card picker (PR 2), Team (PR 3), Alerts (PR 4), Reports and the
  staging seed (PR 5).
- 15/10/2026 · AJ · Frontend built in `app/src/features/home/` against the in-browser mock API (INTERIM shapes in `app/src/api/types/home.ts`), desktop and phone, checked against demo.html. No ticks: UI is ticked once the screens run on the real API. Left: the backend endpoints and contract, then swap the INTERIM types for `contract.gen.ts`.
- 13/10/2026 · TB · Team tab ratified into the inventory (MILESTONES §18): Home is now four tabs, with Team added as #86 (`team`, M1). Summary counts and the SCREENS constant moved to 86. Full engineering guide written at `docs/guides/home.md`; Home reads live from the owning modules and owns the alert and report engines.
- 13/10/2026 · TB · Home demo upgraded in `docs/MyCity-ERP-Documents/demo.html` from the two 12
  October meetings: role sensitive Overview (Operations, CEO, Partnerships, Staff), every KPI card
  opens a detail modal paged at 25, Alerts gained an Over by (days past threshold) column and a
  create or dismiss rule modal, and Reports is role gated. Added a new Team tab (manager and CEO
  view of the roster and today's attendance). Team is not yet in the approved inventory
  (MILESTONES §18); adopting it would take M1 to 25 screens and needs sign off. Demo prototype only,
  no app screens built, so API, UI and Mobile stay unticked and Status stays Not started.

### My Workspace

| # | Screen | Tab | M | Owner | API | UI | Mobile | Status | Updated |
|---|---|---|---|---|---|---|---|---|---|
| 4 | Today | `today` | M2 | AJ | ☑ | ☑ | ☑ | Built | 19/10/2026 |
| 5 | Tasks | `tasks` | M2 | AJ | ☑ | ☑ | ☑ | Built | 19/10/2026 |
| 6 | Calendar | `calendar` | M2 | AJ | ☑ | ☑ | ☑ | Built | 19/10/2026 |
| 7 | Analytics | `analytics` | M2 | AJ | ☑ | ☑ | ☑ | Built | 19/10/2026 |

**Notes**

- 21/10/2026 · AJ · My Workspace (#4 to #7), the CI run after the second merge with `main` (7 failures in 4 suites, all from Workspace meeting `main`'s tests): Settings · Documents & Numbering lists 23 schemes, 3 resetting (Project and Task added; `settings.test.js`); `task-recurrence` is on the worker's scheduler list (`worker.test.js`); New Event no longer answers "invite", which is Invite User's (`search.test.js`); the Workspace seed takes the run's date as Home's does, sets Operations and the head's first report an overdue task and puts this week's meetings on its Monday, so Home's seed tests read them on their fixed day (`home-staging-seed.test.js`). Settings and search pass here on PGlite; worker and Home's seed suites take longer than this harness allows, checked by what they read; CI decides.
- 21/10/2026 · AJ · My Workspace (#4 to #7) after the merge with `main`: a task due on a day off failed to save (the working week now keeps no hours for a day off, and `shared/time/working-week.js` loadCalendar hands that back as the text "null"; GE to look at the loader), so a day with no closing time now closes at 17:00 (`tasks.recurrence.js`, with a unit test). An event's Location is marked `address:none` for gate 22 (a room or call link, not an address). Checks, backend and frontend groups pass (typecheck, lint, 359 app tests, build, no mock); the workspace, home-schema and home-team integration suites pass on PGlite, bar the known Postgres 17 error code in home-schema; the staging seed lands and re-runs clean. Not run here: Home's overview and staging-seed suites and the browser screen gates (CI).
- 21/10/2026 · AJ · My Workspace (#4 to #7) after Performance left M2's PR: the task form's Counts Towards field is gone until a KPIs API exists; the staging seed is `seeds/staging/40_workspace.js` (tasks by the CEO, the head and the line manager for their people and people's own, this week's meetings, through the services), which runs before Home's and takes Home's forward rows out of `task` and `calendar_event`; Home keeps its forward goals, targets and review cycle. Merged with `main` (21/10/2026).
- 21/10/2026 · AJ · My Workspace (#4 to #7): AJ stays owner; TB (the lead) takes what is left on these four: the click-through on the live API and the final checks. The code ships in the one M2 PR from `m2/perf-goals` after `main` is pulled.
- 19/10/2026 · AJ · My Workspace on the real API (#4 to #7; `docs/guides/workspace.md`). Tasks: a manager sets a task for anyone in their workspace scope and the employee adds their own beside it (A24), Cadence Daily or Weekly due at the end of that working day or week (Saturday 15:00), numbers from `numbering` (`TSK-0001`), the board moves by drag and Move To (`POST /tasks/:id/move`, fractional order within a column), Mark Blocked, Cancel Task with a reason (the setter only; Show Cancelled lists them), comments and history on the panel, repeats made by the morning `task-recurrence` sweep with due-today and due-tomorrow reminders. Calendar: events with attendees, visibility and Accept or Decline, the reader's task deadlines and approved leave on the month. Today and Analytics (completion rate, overdue, average completion time, done per week, workload by person, by priority) over the same scope. Migration 2010, seed 2090, contracts `tasks`, `calendar`, `workspace`; screens on `contract.gen.ts`, INTERIM `api/types/workspace.ts` deleted, mock in the contract's shapes; ⌘K New Task and New Event; Home's task and calendar adapters count cancelled and invitations. 10 integration tests on the real migrations; screen gates green. Left: Counts Towards on the task form waits for the KPIs API (#31); the staging seed (with Home's forward rows taken away); a click-through on the live API.
- 15/10/2026 · AJ · Frontend built in `app/src/features/workspace/` against the in-browser mock API (INTERIM shapes in `app/src/api/types/workspace.ts`), desktop and phone, checked against demo.html. No ticks: UI is ticked once the screens run on the real API. Left: the backend endpoints and contract, then swap the INTERIM types for `contract.gen.ts`.

### Employee Self-Service

| # | Screen | Tab | M | Owner | API | UI | Mobile | Status | Updated |
|---|---|---|---|---|---|---|---|---|---|
| 8 | My Profile | `my-profile` | M1 | AJ | ☑ | ☑ | ☑ | Built | 21/10/2026 |
| 9 | My Attendance | `my-attendance` | M1 | AJ | ☑ | ☑ | ☑ | Built | 21/10/2026 |
| 10 | My Performance | `my-performance` | M2 | TB | ☐ | ☐ | ☐ | Not started | |
| 11 | My Payslips | `my-payslips` | M6 | AJ | ☐ | ☐ | ☐ | Not started | |
| 12 | My Leave | `my-leave` | M1 | AJ | ☑ | ☑ | ☑ | Built | 21/10/2026 |
| 13 | My Queries | `my-queries` | M3 | AJ | ☐ | ☐ | ☐ | Not started | |
| 14 | My Documents | `my-documents` | M1 | TB | ☑ | ☑ | ☑ | Built | 19/10/2026 |
| 87 | Work Location Requests | `work-location-requests` | M1 | LA | ☑ | ☑ | ☑ | Built | 21/10/2026 |
| 88 | My Devices | `my-devices` | M1 | LA | ☑ | ☑ | ☑ | Built | 17/10/2026 |
| 89 | Policy Updates | `policy-updates` | M1 | TB | ☑ | ☑ | ☑ | Built | 21/10/2026 |
| 90 | My Security | `my-security` | M1 | AJ | ☑ | ☑ | ☑ | Built | 19/10/2026 |
| 91 | Org Chart | `org-chart` | M1 | TB | ☑ | ☑ | ☑ | Built | 19/10/2026 |

**Notes**

- 21/10/2026 · TB · My Leave (#12), faults #1 and #2 of the 21/10 System Health brief (the server refused LEAVE_SPANS_YEARS and LEAVE_IN_THE_PAST after Send Request): Request Leave's types read what is left of the First Day's year ("Annual · 12 days left", from `GET /ess/leave/balances?year=`), a Last Day in another year reads "Ends in another year" as it is typed (`schemas/leave.js`, for Record Leave too), and a typed day before today "Pick 21/10/2026 or later" at once (the shared `DateField`, M0 note). Tests: `app/src/features/people/Leave.test.tsx`, `leave.test.js`, `tests/integration/leave.test.js`. Left: nothing.
- 21/10/2026 · TB · My Attendance (#9): My Days as a chart labels each day 13/10 (it read 13/10/, with a
  stray slash), and the shared bar chart leaves off the days that would touch, every few days at an even step,
  the first and the last always. Left: nothing.
- 21/10/2026 · TB · Attendance's PR 2 built (clock fixes, `docs/guides/attendance.md` §1.2): the clock panel (opened from every screen and My Attendance, #9) reads the location through one reader (`app/src/features/attendance/location.ts`: up to ten seconds, the best fix, stopping at 50 m, a watchdog so Not Now, Esc and the close button work while it reads), Check In and the home's Use This Location too; a reading that cannot prove the place names the fix for this device (Precise Location Off with the iPhone or Android steps, Use Your Phone on a computer, Location Blocked with this browser's steps and no ask step, Secure Address Needed), unsupported offers no Retry, Clock In Anyway sends what was read. My Attendance reads Location Unclear (help: the reading could not prove where you were) and a punch's location as Unclear with its reason. Left: nothing for PR 2; not checked on a real phone (the device fixes are covered by tests with each user agent).
- 21/10/2026 · TB · Work Location Requests (#87): Add Work Site opens on Hours, Usual Shift or Site Hours with a start and an end, and a site shows its hours (`docs/guides/attendance.md` §6.11). Left: nothing.
- 21/10/2026 · TB · Attendance's PR 3: My Attendance (#9) shows the month's Deductions and Overtime (day, kind, minutes, amount from the monthly gross, or No Salary Set, and status; an item opens with its method and reason), the Home Location card whenever the week has a Remote day, and Give Real Time on a System Clock-Out (Real Time, Your Note, Send Time); My Profile (#8) reads the person's own work schedule with its hours. Policy Updates (#89): the Attendance policy's sentences cover every rule. Left: the query a breach raises (M3) and payroll taking pending items into a run (M6).
- 20/10/2026 · TB · My Attendance (#9), Work Location Requests (#87) and Policy Updates (#89), attendance's PR 4 (`docs/guides/attendance.md` §6.11, §6.12, §6.15; `docs/guides/ess.md`): Work Location Requests lists the person's temporary sites with Add Work Site (header, full width on a phone, the floating button) and a site's view with its addresses on maps, its people, its approval and Withdraw Submission (a reason); `?site=` opens one; their requests made before PR 4 stay under the sites and New Request is gone. My Attendance shows Temporary Sites waiting, in progress or to come, and each day's route of check-ins between the punches. The clock panel names the site and its addresses and, once clocked in, offers Check In with the day's check-ins under it. Policy Updates reads the site section as At a Temporary Site. Left: nothing.
- 20/10/2026 · TB · Policy Updates (#89) rebuilt for every policy (`app/src/features/policies/PolicyUpdates.tsx`, `docs/guides/policies.md`): To Acknowledge, All Policies and Waiting On You; a policy opens as its text or its sentences with what changed, its signatures, Download PDF and earlier versions; an approver approves with a signature or rejects with a reason; the acknowledge sheet after the clock (`AcknowledgeSheet.tsx`). Checked by 8 screen tests on the mock and, on the real API in Chromium (20/10/2026), the Attendance policy's Version 1 published with a drawn signature, a written policy for Engineering, the sign-in prompt then the sheet for each at 390 px with touch, Later holding until tomorrow, Acknowledge recorded, and the PDF made on the letterhead. Left: Tidy With AI against a real model (the local stub's answer is refused by the word check, as it should be).
- 20/10/2026 · TB · Policy Updates (#89) moves to M1 with Knowledge Hub · Policies and will carry every policy that applies to the person, with the acknowledge sheet after the clock (`docs/guides/policies.md`); In progress until PR 1 rebuilds it. The attendance redesign of 20/10/2026 (`docs/guides/attendance.md` §1.1, four PRs) also changes My Attendance (#9: deductions, overtime, check-ins, System Clock-Out) and Work Location Requests (#87: becomes the person's temporary sites) in PRs 3 and 4; both stay Built until then.
- 19/10/2026 · LA · Policy Updates (#89) on the real API, built with Settings · Attendance Policy (owner decisions, 19/10/2026; `docs/guides/attendance.md` §6.15): the newest version of the attendance policy as full sentences, one a rule and mode with People's values filled in (`features/attendance/policy-text.ts`), under Clocking In, At the Office, Working From Home, At a Field Site, Your Location and Your Devices, a section the version changed tagged Changed; People's note, its first day and state (In Force, or Starts on a date), Acknowledge, and All Versions, each opening its own sentences; a notice opens its version by `?version=`. Acknowledging never blocks the clock; everyone at work with a login is told of a new version (bell and push) and reminded once after 3 days, in the working day (the reminder engine's `attendance_policy_unacknowledged`). Before any version, the default rules show with nothing to acknowledge. Checked by 3 screen tests and 5 sentence tests on the mock (desktop and 390 px), 8 integration tests on the real migrations, and on the real API in Chromium at 390 px with touch (20/10/2026): Version 1 published from Settings, its web push delivered to a local push service (VAPID-signed, aes128gcm, decrypting to the notice and its link), the push's link opening Policy Updates, Acknowledge (332 by 44 px) recorded and the notice read; the 3-day reminder pushed once to the person who had not acknowledged, and never to the one who had; the live build's service worker, given those pushes, showed the device notification (title, line, badge, icon, Mark Read) with no window open and left it to the in-app banner with one on screen, and the link a tap opens kept through sign-in to Policy Updates, marking the notice read. Left: a physical phone through a real push service (Google's or Apple's) and its notification shade; a staging seed publishing a first version (it would tell every member of staff on staging).
- 19/10/2026 · TB · My Attendance (#9) and the clock panel: the three gaps against the 12 and 13 October rules closed (`docs/guides/attendance.md` §6.14). The sign-in prompt opens on whatever screen the day's first session lands on, Home or a link (`sign_in_prompt` on today, decided by Attendance); the start reminder's push is not sent to someone in front of the app, who has the start prompt instead, and reaches them if they leave it still not clocked in within the hour; every prompt opens over a blurred screen on both shells (`Modal` and `Sheet` take `blur`, also through `useModal().open`). Checked by 10 integration tests on the real migrations, 4 screen tests of the prompts at a held clock and 2 component tests of the blur. Left: nothing of the three; not yet seen on a phone with push on.
- 19/10/2026 · TB · My Documents (#14): View File opens a PDF or a photo full screen in the file viewer shared with Staff Community (Download, Share on a phone), and the preview beside the list draws a PDF's pages in the app with PDF.js, where the browser's own viewer showed nothing on Android and was blocked by the security policy on staging and production. Checked in Chromium on the live build under the production policy (upload, preview, View File). Left: walk it on a phone once staging has it.
- 19/10/2026 · AJ · My Security (#90): the Clock-In Devices card lists the person's registered and new devices (name and platform, status, last clock-in, This Device) from `GET /devices/mine`, with Manage My Devices; the phone tile counts the registered ones (the team lead, 19/10/2026).
- 19/10/2026 · TB · My Profile (#8), My Attendance (#9) and Org Chart (#91): Download My Data, Export Month and Download PDF save the file on the device that pressed, never by email (`docs/guides/ess.md` §3 step 8, §5 to §7; attendance.md §5, §7; organogram.md §5 to §7; foundation.md §6.12). Download My Data pressed again the same day gives the same file; the CEO is refused for that person that day as before; a failed file does not count; the file is kept a day, not seven. Left: nothing.
- 19/10/2026 · TB · My Attendance (#9) and the clock panel: clock prompts, reminders and the automatic clock-out (owner decisions, 19/10/2026, from the 12 and 13 October meetings; `docs/guides/attendance.md` §6.14). On both shells the panel opens by itself at the shift's start for someone not clocked in (once a day on each device, not after the sign-in prompt or Clock In already showed it) and at its end for someone still in, with Remind Me (15 minutes, 30 minutes, 1 hour); Esc, the scrim and a drag leave it open, and it never replaces a dialog that is open. Job `attendance-clock-watch` (every 5 minutes) sends one reminder a day in the first hour after the start (the bell and push, read on clock-in) and clocks out a shift left open once its end has passed and the person has been away from the app 15 minutes, at the end or the last moment they were on it; the person is told. My Days and a day's punches read Automatic, and Explain Time sends a note that People keep or correct. `1360`, `1394`; `POST /attendance/me/events/:id/explanation`; `useModal().open` takes `dismissible`. Checked by 8 integration tests on the real migrations, 3 backend unit tests, 5 tests of the prompts' timing and 3 of the prompts on the mock at a held clock. Left: configurable reminder rules stay M6 (#74); a cap on Remind Me is not decided; not yet seen on a phone with push on.
- 19/10/2026 · AJ · My Profile (#8): the photo now also shows on the employee record's header (People · Employees) and on Settings · Users and a role's people. Left: the organogram PDF still draws initials.
- 19/10/2026 · LA · The client's clock-in rules (owner decisions, 19/10/2026; `docs/guides/attendance.md` §6.5, §6.11, §6.13). My Profile (#8): the Work Schedule shows each day's place, Office, Remote or Off (`EssWorkDay.place`, from attendance's week). My Attendance (#9): the Home Location card shows for hybrid staff whose schedule has home days too, and they set a home as remote staff do; the clock panel names a client visit's site (Client Visit · 200 m), says No Office Assigned for someone expected at an office with none (and still takes a reading, the punch going to review), and matches a hybrid home day to the approved home. Work Location Requests (#87): a client visit carries its site, a Client Site card with Latitude, Longitude and Radius (100 to 500 m), checked by the contract, and the request shows it. Checked by screen tests on the mock (the request form, the record's tab at 1440 and 390 px, the clock panel with no office) and integration tests on the real migrations. Left: picking a client's site from an address once address search exists (F21).
- 19/10/2026 · AJ · My Profile (#8): photos everywhere a person appears and Download My Data. `photo_url` on `PersonRef` and the register, org chart and worksite rows (one SQL helper, `shared/db/person.js`, 192 px for lists), shown through `Avatar`/`Who` on People · Employees, Leave and Attendance, Devices, Worksites, the Organogram and Org Chart, Community, Home Team and a card's records and the pickers (`usePhotos`, fetched once). Download My Data on My Profile (`POST /ess/profile/export`) and the CEO's Download Their Data on the employee record (`POST /employees/:id/data-export`): one workbook (cover and ten sheets) built in the worker, restricted in the vault, emailed, removed after 7 days, once a day. Left: payslips join it in M6; the employee record header and the org chart PDF still show initials.
- 19/10/2026 · AJ · My Profile (#8): the photo. Profile Photo uploads through the upload engine as an `avatar` (`POST /ess/profile/photo`, Remove Photo `DELETE`), `employee.photo_document_id` (1170) points at it, every colleague may read it, and My Profile and the shell avatar show it. Community and People lists still show initials until their rows carry `photo_url`. Left: Download My Data (needs the lead's decisions on what it holds, its format and delivery).
- 19/10/2026 · LA · My Attendance (#9): Field Assignments, the person's in progress and to come (number and name, dates, the site), each opening with the client, its sites with their address and radius, and who else is on it; on an assignment's day the clock names its site (both, "A or B", when there are two) and matches the punch to the nearer, as a worksite. Opened from a notice by `?assignment=`. Checked by a screen test and on the mock at 390 and 1440 px (Adedotun). Left: nothing.
- 19/10/2026 · LA · Work Location Requests (#87) built on the real API (owner decisions, 19/10/2026; `docs/guides/attendance.md` §6.11): a temporary home (remote staff, with one reading taken there and refused when too coarse), a remote day (on-site and hybrid staff) or a client visit (anyone), for at most 90, 5 or 14 days, from today and within 90 days, never overlapping another. Each is numbered `WLR-0001` and approved by the line manager, then Operations & People; the person withdraws one waiting or cancels an approved one before its first day, and each request opens with its approval route and every decision's reason. On an approved day the clock names the place (Temporary Home · 100 m, or the request), fences a temporary home like a home, and otherwise keeps the reading as evidence; a present remote day counts as remote on Home's roster. A request waiting on someone is in their Need You on Home and opens on People · Attendance. ⌘K: New Request and the requests by number. Checked by 3 screen tests and 6 integration tests, and on the mock at 390 and 1440 px (Chidera, Kemi, Cynthia). Policy Updates (#89) moves to M9 with Settings · Attendance Policy (owner decision, 19/10/2026). Left: field assignments.
- 19/10/2026 · TB · ESS · Org Chart (#91), TB's four decisions on the phone (`docs/guides/organogram.md`
  §8, §10.2): a Focus or Everyone switch, opening on Focus at the person looking, with the path
  from the top, their team, Dotted Line and Same Manager; Everyone opens the way down to them and
  marks their row You. A card opens the person's sheet on both shells: Send Message (My Profile on
  your own), Open Record and Change Manager only by grant, so staff are no longer sent to Home.
  Download PDF works: drawn in the worker as the person asking and emailed to them. Left: nothing.
- 19/10/2026 · TB · ESS · Org Chart (#91): someone who is not on the chart starts at the top, the
  CEO, instead of a card of their own with nowhere to go; on a phone a search lists the matching
  cards to tap, and anyone else at the top is listed under Also At The Top (`docs/guides/organogram.md`
  §10.2). The build account now sits under the CTO, so it opens with Reports To. Left: nothing.
- 18/10/2026 · LA · My Attendance (#9): remote staff are fenced on an approved home (owner decision, 18/10/2026; `docs/guides/attendance.md` §6.5, §6.10). A remote employee sees a Home Location card first (Approved, Waiting, Not Set, or Rejected with People's reason) and sends their home from Set Home Location: one reading taken at home, refused when coarser than the policy's accuracy, and the address in their words. The clock panel asks a remote employee for their location too, matches it to the approved home (100 m), and without one shows No Approved Home with Set Home and sends the punch to People's review, never rejected. Checked on the mock at 390 and 1440 px through People's side; the card and sheet by 3 panel tests (the demonstration sign-ins work hybrid). Left: hybrid staff's home days (a per-day schedule), temporary homes (#87).
- 18/10/2026 · AJ · My Attendance (#9): the 12 October asks (`docs/guides/ess.md` §13) on LA's screen, LA to review: the month picker beside Export Month (arrows, or a year and month picked directly), the share of days present on Late Days, Days Present, Late Days and Absent opening their days paged at 25 (`GET /attendance/me` takes `status`), and the days as a table or a chart of hours. Leave on staging: `seeds/staging/30_leave.js` puts the mock's twelve sample requests on the real staff through the leave service. My Leave (#12) gains Leave Calendar (`GET /ess/leave/calendar`): approved and waiting leave for the reader and everyone under them, everyone for the CEO and Operations & People (the team lead, 18/10/2026).
- 17/10/2026 · LA · My Attendance (#9) and My Devices (#88) on the real API (`docs/guides/attendance.md`): the clock panel (location read only after the press, the worksite named first; Retry Location and Clock In Anyway; No Connection keeps the punch's key and body for Try Again; the server's result, with Send Note on a punch under review), the month's figures and days with each day's punches, open exceptions with Explain, Export Month by email; My Devices lists the person's devices, registers this one behind a fresh sign-in (three at most) and removes one. Checked on the real API at 390 and 1440 px. Left: Work Location Requests (#87) and Policy Updates (#89) stay on INTERIM shapes until home locations and policy versions are decided (attendance guide §13).
- 17/10/2026 · AJ · My Profile (#8) on the real API: the caller's record from the employee 360 (account by its last four digits), Edit Profile for phone, home address, next of kin and bank through the organisation service (a bank change tells `people` edit holders), Record History, the organisation's working week (Saturday 09:00 to 15:00). Screen on `contract.gen.ts`, INTERIM `MyProfile` gone, mock in the contract's shapes; 5 integration tests. Left, each needing a module AJ does not own: the photo (`employee.photo_document_id`, written by the organisation module, read by the shell and Community; GE, TB), each person's own schedule (LA, attendance), Download My Data.
- 17/10/2026 · AJ · My Performance (#10), My Queries (#13) and My Payslips (#11) now carry the milestone of the module they show (M2, M3, M6), as `docs/guides/ess.md` §6 already said, so the shell's Coming Soon names that milestone and its date instead of M1 (AJ, 17/10/2026). Summary counts moved with them. MILESTONES §18 still lists all twelve ESS tabs under M1: TB to note.
- 17/10/2026 · AJ · My Leave (#12) on the real API: `/ess/leave` (list, one request, the year per type, ask, cancel), the caller's own only. A request is counted in working days (Monday to Saturday, holidays out) and refused when it overlaps other leave, crosses New Year, has no working day, starts in the past or passes the type's allowance; it opens `leave.approval` (line manager, then Operations & People over 5 days) and the request copies the outcome after commit, every read taking the approval's outcome meanwhile. Cancel while it waits (the approval is withdrawn) or before it starts. Screen on `contract.gen.ts`; the INTERIM `app/src/api/types/leave.ts` is deleted and the mock answers in the contract's shapes. 13 integration tests on the real migrations. Left: a personal leave calendar (the demo's View Calendar, `ess.md` §13); the screen gates that crawl a browser (8, 11, a11y) were not run here and need `npm run ci`.
- 17/10/2026 · TB · ESS · Org Chart (#91) on the real API, read only for every member of staff:
  the whole company from one bounded read (`GET /api/v1/org-chart`, 2,000 nodes), open seats drawn as
  vacant, dotted lines tagged, no restricted field on any card. On a phone it starts on the signed-in
  person as a focus view. Built with People · Organogram (#92) from `docs/guides/organogram.md`.

- 17/10/2026 · TB · My Documents (#14) built on the real API (M0, track B): the Vault list is what is
  held and what People have asked for in one paged list, the counts come from
  `GET /ess/documents/summary`, a row opens its details with Download, a missing row opens Upload
  Document, and the preview is the chosen document itself. Desktop and phone. The hard-coded contract
  and the "Your vault" subtitle are gone (`docs/guides/ess.md` §10). Left: the other ESS tabs, with
  their milestones.
- 16/10/2026 · TB · My Security (#90) built: Two-Step Sign-In (set up from a QR code or the key, on
  with the first code, ten recovery codes shown once, Ask for a Code every sign-in, once a day or once
  a month, New Codes, Change App, Turn Off), Passkeys (Add Passkey on this device, rename, remove;
  the fingerprint or face on a phone), the PIN (Set, Change, Remove; weak PINs and the birthday
  refused), Recent Sign-Ins with the Method. Past the window, adding or removing a way in asks Confirm
  It's You (password, PIN or passkey). Desktop and phone. Left: passkeys on a real phone.
- 16/10/2026 · TB · My Security (#90) on the real API: Password (Change Password with the contract's rule), Signed In with Sign Out per device and Sign Out Others, Recent Sign-Ins, Clock-In Devices; desktop and phone. In progress until two-step sign-in, passkeys and the PIN arrive with the security module (the second sign-in PR); no ticks until then.
- 15/10/2026 · AJ · Frontend built in `app/src/features/ess/` against the in-browser mock API (INTERIM shapes in `app/src/api/types/ess.ts`), desktop and phone, checked against demo.html. No ticks: UI is ticked once the screens run on the real API. Left: the backend endpoints and contract, then swap the INTERIM types for `contract.gen.ts`.
- 15/10/2026 · AJ · My Leave: the four KPI tiles open their modal on a phone only (`Kpi` `opensOn="phone"`); on desktop they are plain tiles because the requests table and entitlement card already sit beside them. Home keeps desktop drill-down, as `docs/guides/home.md` asks.
- 15/10/2026 · TB · Five ESS tabs ratified into the inventory (MILESTONES §18): Work Location Requests (#87), My Devices (#88) and Policy Updates (#89), owned by LA from the attendance work; My Security (#90, AJ); Org Chart (#91, TB). Inventory now 92 screens; SCREENS constant and `src/shared/route-map.js` updated.
- 13/10/2026 · AJ · ESS demo updated from the 12 October meeting. Desktop: photo upload on My Profile,
  work schedule inside Employment (read from LA's attendance data), year switcher and a deductions
  breakdown on My Payslips, pension text removed, three cards on My Queries (Open, Archived, Sanctions)
  with the build flowchart removed, leave approval text removed, Coming Soon preview for tabs not in M1.
  Mobile: icon cards that open the shared modal, previews on tap. New My Security tab (devices link to
  LA's My Devices). Demo gained a viewport tag and a mobile menu drawer. LA's four attendance tabs
  untouched on desktop; on a phone they get the same icon cards, built from her page. Guide
  `docs/guides/ess.md` written (Draft). My Security is not in the approved inventory (MILESTONES §18)
  and needs sign off. Demo only, no app screens, so no ticks.

### Staff Community

| # | Screen | Tab | M | Owner | API | UI | Mobile | Status | Updated |
|---|---|---|---|---|---|---|---|---|---|
| 15 | Channels | `channels` | M1 | GE | ☑ | ☑ | ☑ | Built | 20/10/2026 |
| 16 | Direct Messages | `direct-messages` | M1 | GE | ☑ | ☑ | ☑ | Built | 20/10/2026 |
| 17 | Announcements | `announcements` | M1 | GE | ☑ | ☑ | ☑ | Built | 17/10/2026 |

**Notes**

- 19/10/2026 · TB · Forwarding in Channels (#15) and Direct Messages (#16), from TB's four answers (`docs/guides/community.md` §3 step 19, §6): Forward on a message's menu, an album's menu and in the file viewer; Select, or a long press on a phone, picks several, with "N Selected", Copy for texts and Forward in place of the composer. Forward To searches the channels the person may post in, their conversations and every colleague (their own chat as You), up to 5 at once (`GET /community/forward-targets`, `POST /community/forward`, 20 a minute). A copy is marked Forwarded and keeps its caption, album, link card, voice note length and transcript; it names only the person forwarding, and the first sender stays in the history (`forwarded_from` on the event). A forwarded file is the same document, readable in every chat holding it. Checked in Chromium on the live build, desktop and an emulated Pixel 7 with real touch (a long press on a link starts picking and opens nothing). Left: a long press on a real phone.
- 20/10/2026 · GE · From TB's review (19/10): every active login is now in #general and #announcements from the moment it is made (`app_user.created` and `app_user.reactivated`), with an hourly `community-membership` sweep, instead of from the person's first visit, so a new employee is in the audience of every announcement at once. Integration suite 23 of 23. Left from the same review: archive a published announcement, rename a channel and show its description, voice notes (real waveform, no first-play delay), celebrations at 08:00, a message pinned for a period, measuring real-time delay. Notifications and attachment previews are TB's.
- 20/10/2026 · GE · Archive Announcement on a published announcement (TB's review, 19/10): it leaves #announcements ("Message deleted") and the Announcements tab, its unopened notices are withdrawn by a new `notifications.withdrawForRecord` (TB to review), its reads are kept. Integration suite 24 of 24. Left: rename a channel and its description, voice notes, celebrations at 08:00, pinning for a period, real-time delay.
- 20/10/2026 · GE · A channel's admins rename it and change its purpose from Channel Details (Edit Channel); the purpose shows in Channel Details and, on desktop, in the channel's header. #general and #announcements keep their names. Integration suite 25 of 25.
- 20/10/2026 · GE · Celebrations post at 08:00 Lagos instead of 05:00. Found: the staff sheet's DOB holds a day and month with no year, which the importer drops, so no birthday card could post for MyCity's staff (start dates import, so anniversaries do). Fixed: migration 1180 (`employee.birth_day`, `birth_month`), filled by the staff loader on every deploy and read by the celebrations. Organisation and community integration suites pass (53, 25).
- 20/10/2026 · GE · Voice notes (TB's review): the waveform is the note's measured loudness (migration 1190, `document.waveform`, from the worker's transcode) and fills from the audio's real position; the note is fetched as its bubble is drawn, so Play starts at once instead of after about 2 seconds. `Waveform` in `@mycity/ui` takes `peaks` and `progress`. Integration suites pass (community 25, documents 16, mailbox 12). Left: walk it on a phone on staging; notes sent before this keep the steady shape until `media-derive` is run for them.
- 20/10/2026 · GE · Pin a message for 24 hours, 7 days or 30 days (TB's review): moderators in a channel, either person in a direct conversation, at most 3 at once (a fourth replaces the oldest), a pinned bar above the messages that steps through them, Unpin from the bar or the message; it unpins itself when its time is up (migration 1195). Integration suite 26 of 26. Left: walk it on a phone on staging.
- 20/10/2026 · GE · Real time (TB's review): measured locally, the server's part is about 30 ms (post 12, handlers 5, refetch 14); the wait was the worker's one-second outbox tick and the sender's second request. Now a commit wakes the dispatcher at once (Postgres NOTIFY, `jobs/loops/outbox-wake.js`; the tick stays as the safety net) and the sender's message shows from the POST's answer. Worker suite 22 of 22. Left: feel it on two phones on staging; what remains is the phone network's round trips.
- 19/10/2026 · TB · Media and links in Channels (#15) and Direct Messages (#16), from TB's four answers (`docs/guides/community.md` §3 steps 17 and 18, §6). Photos show in place at their own shape, 4 or more sent together as one 2 by 2 album with "+N"; a video shows its poster and length; a PDF its first page (drawn by the worker), its name and "N pages · PDF · size"; any other file its name, type and size; captions under their media; every link clickable. Send Files (＋ Attach a File; Attach → Photo or Video, Document) opens the device's picker at once, takes up to 10 files with a percentage each, shows them as tiles in the order picked, a caption, and posts them in that order under one album key. A photo, video or PDF opens the file viewer (zoom, step, Download, Share on a phone; a PDF's pages drawn by PDF.js), and so does the profile's Shared in Conversation. The first link gets a card the server fetches (`POST /community/link-previews`, 30 a minute; the public web only, private addresses refused, 1 MB and 8 seconds; its picture copied into the vault; kept a week), shown above the composer with Remove Preview and on the message; job `link-preview` attaches it after the commit when it was not ready. Migration 1147 (`community_link_preview`, `community_message.community_link_preview_id`, `document.page_count`); `MediaRef` on messages and the upload's answer. 48 unit tests of the link rules and the fetcher, 20 integration tests on the real migrations (a card fetched once and kept, a private address refused, the job attaching and idempotent, Remove Preview, an edit following its link, an album and its caption, a real three-page PDF drawn by the worker, a broken one failing at once, the upload's answer), and the components' tests. Walked in Chromium on the live build with the production security policy, desktop and an emulated Pixel 7: albums, captions, the composer's card and Remove Preview, the viewer on photos and PDFs, Send Files as a sheet. Fixed on the way: files sent together kept the order they finished uploading in, not the order picked; a caption widened its photo's bubble; the viewer opened with Close's tooltip showing, so the first Esc closed only the tooltip. Left: Share on a real phone; the link fetch from staging (this environment cannot reach the web); the worker's first page shows boxes for Japanese or Chinese text in a PDF that does not carry its fonts.
- 17/10/2026 · GE · Fixed on a phone: picking a channel from the Channels drawer switched channel but left the drawer open (the drawer opened the shared sheet and never closed it; the only place in the app that did this). Fixed: a celebration posted by hand showed "years at MyCity" with no number; it now carries the years from the start date, and "Another year" when there is none. Left: nothing.
- 17/10/2026 · GE · #announcements has no composer (announcements come only from the tab; the server refuses a plain post there, People and the CEO included) and a lock on its row. The Announcements tab's figures come from the server (`GET /community/announcements/stats`): Audience is the active staff an all-staff announcement reaches, where it read 0 until one was published; the other figures were counted from the first page only. Polls sit on the sender's side up to 560 px as in the demo; announcements read as a feed on the left. Ctrl+Enter (Cmd+Enter) starts a new line on desktop too. Left: nothing.
- 17/10/2026 · GE · Each person pins up to 3 channels or conversations for themselves (migration 1140; ⋮ Pin to Top, Unpin; under #general and #announcements, which stay pinned for everyone). Muted and pinned rows show a bell and a pin. Fixed: a muted channel always read as unmuted (pg returns 'infinity' as Infinity), so it could not be unmuted from the screen; notifications were correctly held back throughout. Messages and announcements keep their line breaks, and the composer is a box that grows (Enter sends and Shift+Enter is a new line on desktop; on a phone Enter is a new line). Left: nothing.
- 17/10/2026 · GE · Scheduled announcements can be edited or cancelled until they go out (migration 1130; the release now checks the announcement is still scheduled and due). Channel admins are chosen in Edit Members (Make Admin, Remove Admin; a channel keeps one). Messages carry a ⋮: Edit your text for 15 minutes, Edit a poll before its first vote, Close Poll, Delete by the author or a moderator (channel admins; People and the CEO in #general and #announcements), "Message deleted" in place, a deleted recognition leaves the counts. Polls in #general and hand-posted celebrations are for moderators; recognition stays open to all (A19). A conversation with yourself is named You. The people pickers leave you out except New Message. Sheets opened from a conversation on a phone now sit above it (the open conversation was layered over every sheet). Left: nothing new.
- 17/10/2026 · GE · Backend built: contract (`community.js`, `announcements.js`), migration 1110, the `community` and `announcements` modules (channels, members, messages, uploads, voice notes, polls, reactions, transcripts, direct messages with sent, delivered and read ticks, presence, profile card, recognition always to #general per A19, announcements with audience, scheduling, reads and reminders), the 05:00 celebrations job, the announcement release job and its safety net, ⌘K for announcements, the AI read manifest; unit tests and an integration suite on the real migrations. AJ's screens moved onto the contract and the mock rewritten in its shapes; voice notes record and upload in channels too; search steps between matches; Edit Members, Mute and the copy in §10 done. Walked on the live API on a laptop, desktop and phone, two people: announcement, text, a recorded voice note, a direct message with its read ticks arriving over the socket, presence; the dev server now proxies the socket too. A new `GET /community/people` lets every member of staff pick a colleague (the staff register needs People). Left: the Average Read help term needs StatStrip to take one; the Knowledge Hub (M10) needs its own read route for announcements, as `/community/announcements` is for People and the CEO.
- 15/10/2026 · AJ · Frontend built in `app/src/features/community/` against the in-browser mock API (INTERIM shapes in `app/src/api/types/community.ts`), desktop and phone, checked against demo.html. No ticks: UI is ticked once the screens run on the real API. Left: the backend endpoints and contract, then swap the INTERIM types for `contract.gen.ts`.
- 13/10/2026 · GE · Demo updated per the 12 October meeting (guides removed, ＋ menu, members behind ⋮, fixed
  composer, read-only pinned #announcements, birthday and recognition cards, Praxis-style DMs with
  voice notes, mobile full screen). Engineering guide `docs/guides/community.md` written. No product code yet.
- 20/10/2026 · TB · Voice notes in Channels (#15) and Direct Messages (#16) transcribe through Groq, then Gemini, then the captions the sender's browser wrote while recording (`docs/guides/integrations.md` §6.14, `community.md` §3 step 11): the captions go with the note, a browser draft is marked Draft and never stored, the stub's placeholder is never stored (the "[AI placeholder]" transcript seen on staging reads as none), and a failure is a toast instead of a stuck Transcribing. Left: set Groq's and Gemini's keys on staging and production.

### Mailbox

| # | Screen | Tab | M | Owner | API | UI | Mobile | Status | Updated |
|---|---|---|---|---|---|---|---|---|---|
| 18 | Inbox | `inbox` | M1 | GE | ☑ | ☑ | ☑ | Built | 19/10/2026 |
| 19 | Sent | `sent` | M1 | GE | ☑ | ☑ | ☑ | Built | 19/10/2026 |
| 20 | Drafts | `drafts` | M1 | GE | ☑ | ☑ | ☑ | Built | 19/10/2026 |
| 21 | Archive | `archive` | M1 | GE | ☑ | ☑ | ☑ | Built | 19/10/2026 |
| 22 | Spam | `spam` | M1 | GE | ☑ | ☑ | ☑ | Built | 19/10/2026 |
| 23 | Trash | `trash` | M1 | GE | ☑ | ☑ | ☑ | Built | 19/10/2026 |
| 94 | Signature | `signature` | M1 | GE | ☑ | ☑ | ☑ | Built | 19/10/2026 |

**Notes**

- 19/10/2026 · TB · The reader in every folder (#18 to #23): Forward to Chat beside each attachment and in the file viewer sends the file to up to 5 Staff Community chats (`docs/guides/community.md` §3 step 19, `docs/guides/mailbox.md` §6): only the mailbox's owner, only a file scanned clean, never from Spam. The file is copied into Community once; the mail keeps its own. Left: try it on a live mailbox.
- 19/10/2026 · TB · The reader in every folder (#18 to #23): a photo, a video or a PDF attached to a mail opens in the file viewer shared with Staff Community (a PDF's pages drawn by PDF.js on a phone as on desktop, Download, Share on a phone), with each attachment's own glyph; any other attachment downloads as before. Typechecked and linted; not walked on a live mailbox here (no mail server in this environment). Left: walk it on staging.
- 19/10/2026 · TB · Signature (#94) built, from TB's brief and answers (design B, Street Sign, chosen on the design canvas from three): one signature for everyone, drawn from the employee record, the mailbox and Settings · Organisation, never designed by hand. Backend: contract (`MySignature`, `MySignatureSave`, `SignaturePreview*`, `SignatureConfig*`), migration 1127 (`mail_signature`, `mail_signature_config`), seed 1129 (`mailbox.signature` for System Administrator and Implementation), `mailbox/signature/` (the model, the email-safe full signature and slim line in HTML and text, the pictures drawn at 2x and stored once by hash, placement above the quoted mail), five routes, and `send()` baking the signature into the queued message with its pictures sent inline (`cid:`) and kept on the Sent copy. The slim line goes on replies and on mail only for colleagues. Screens: the tab shows it as it sends (New Mail or Reply) with Copy Signature, the person's numbers (the mobile through the organisation service, as Edit Profile) and two switches; Configure for holders (app links, six social links as icons, what shows); the composer previews it behind Show Signature. 21 unit tests (the model, the drawings, placement, the full-or-slim rule, the pictures) and 7 integration tests on the real migrations (the tab, numbers through the employee record, the preview rule, Configure's capability, sending with inline pictures and the Sent copy, a reply's placement, a queued message keeping its signature, a failed bake leaving without it); the brand files' test in `tests/integration/settings.test.js`. Left: walk it on a phone once staging has it; the brand files are uploaded by MyCity in Settings · Organisation.
- 19/10/2026 · GE · Signature added with npm run new:screen (catalogue, route map, screen file, Coming Soon); not started.
- 18/10/2026 · GE · Reader brought level with the reference client: remote content held back by every route it can fetch (images, `srcset`, posters, `background`, style `url()`), so Load Images is offered whenever anything was held; Always Show Images per sender (`mail_image_trust`, migration 1125, `POST /mailbox/image-trust`, Stop Showing Images in the thread menu); signature logos (`cid:` inline parts) drawn from the vault; quoted history folded behind Show Quoted Text, in English and French, from a blockquote, an "On … wrote:" line or trailing `>` lines. Also fixed: the frame's spacing came out of its measured height and clipped the last lines of every message. Checked in the mock app at 390 px and with the integration suite (12 of 12). Left: walk it on a phone once staging has it.
- 20/10/2026 · GE · Scheduled mail fixed from a staging test: scheduling a draft again added a second send (twice in Drafts, and it would have gone twice); its edits never reached the waiting send; Discard left the send to go. Now one waiting send per draft (migration 1128 cancels doubles and enforces it), autosave keeps the send in step, Discard cancels it, and Edit Scheduled Mail shows the scheduled time (change it, or Send Now) and Done. Integration suite 13 of 13. Left: try it on staging.
- 18/10/2026 · GE · Reader fixed from a phone test: HTML mail was written into the page, so a sender's fixed 600 px layout (a cPanel notice) ran off the phone and their styles could reach ours. It now renders in `EmailFrame` (new in `packages/ui`): a sealed frame, as tall as its content, scaled down to the column's width when wider, with its own policy (no scripts, frames or forms; web images after Load Images); a `mailto:` link opens the composer. On a dark surface a message designed for a white page is recoloured as Outlook does (light backgrounds onto our card, dark text onto our foreground, hue kept in OKLab; brand colours already right for dark, accent borders and images untouched; a message with its own `prefers-color-scheme` left alone). Checked in Chromium at 360 px: the 600 px table shows at 0.49 and the page no longer scrolls sideways; the cPanel-style notice draws as sent in light and on our dark card in dark. Left: walk it on a phone once staging has it.
- 18/10/2026 · GE · Composer fixed from a phone test: attachments were all refused (422, "Check the highlighted fields") because the composer sent the purpose `mail`, which the upload contract does not take; it now sends `attachment`, with an integration test sending a phone photograph the way the composer does. "Draft saved" moved out of the footer to quiet text beside Attach a File (guide §10); on the phone the footer is one row (Discard and Schedule as icons, Send filling the rest). `UploadField` gains Remove on a failed file and `handOff`, so a finished attachment shows once, as its chip. Left: walk it on a phone once staging has it.
- 17/10/2026 · GE · ⌘K now finds a person's own mail by subject, address or sender name, pinned to the caller so the CEO and People find nobody else's; a result opens the conversation in any folder. Connecting uses `mycityapp.io` as the mail host, the certificate's name, instead of `mail.mycityapp.io`. Virus scanning checked against a real clamd with a local test signature (the signature download is blocked here): an inbound attachment carrying the EICAR string stays in quarantine marked infected, a clean one is released. Left: the real host and clamd's real signatures on staging; disconnecting a leaver needs a deactivation event.
- 17/10/2026 · GE · Built on the real API: contract `mailbox.js`, migration 1120 (connection status, folder kinds and UID cursor, thread keys, `mail_draft`, `mail_send_queue`), the `mailbox` module (IMAP and SMTP provider, autodiscover to `mail.<domain>` on 993 and 465, threading by References, sanitised HTML in and out, send queue with Bcc in the envelope only, a copy to the server's Sent, deferrals retried three times, paced to 50 an hour), `mail-sync` and `mail-send` jobs, IMAP IDLE in the worker, `mailbox.updated` over the socket. Screens on the contract: the Connect sheet opens over Mailbox ("Password refused" on the field), Reconnect banner, scheduled mail in Drafts with Cancel Schedule, field errors in the composer, Discard with buttons only. Unit tests and an integration suite on a fake provider; checked against a real Dovecot IMAP server and an SMTP relay (15 of 15), then walked on a laptop and a phone: connect, sync with an attachment, reply, Sent, the reply arriving in the other person's inbox. Empty stubs deleted. Left: the real `mycityapp.io` host (Namecheap) is untested; disconnecting a leaver needs a deactivation event; ⌘K inside mail needs an owner-scoped provider.
- 15/10/2026 · AJ · Frontend built in `app/src/features/mailbox/` against the in-browser mock API (INTERIM shapes in `app/src/api/types/mailbox.ts`), desktop and phone, checked against demo.html. No ticks: UI is ticked once the screens run on the real API. Left: the backend endpoints and contract, then swap the INTERIM types for `contract.gen.ts`.
- 13/10/2026 · GE · Demo composer added (rich text, recipient chips, attachments with progress, schedule,
  inline discard), reader full screen on mobile. Engineering guide `docs/guides/mailbox.md` written.

### People

| # | Screen | Tab | M | Owner | API | UI | Mobile | Status | Updated |
|---|---|---|---|---|---|---|---|---|---|
| 24 | Employees | `employees` | M0 | TB | ☑ | ☑ | ☑ | Built | 21/10/2026 |
| 25 | Attendance | `attendance` | M1 | LA | ☑ | ☑ | ☑ | Built | 21/10/2026 |
| 26 | Leave | `leave` | M1 | AJ | ☑ | ☑ | ☑ | Built | 21/10/2026 |
| 27 | Devices | `devices` | M1 | LA | ☑ | ☑ | ☑ | Built | 17/10/2026 |
| 28 | Worksites | `worksites` | M1 | LA | ☑ | ☑ | ☑ | Built | 21/10/2026 |
| 92 | Organogram | `organogram` | M1 | TB | ☑ | ☑ | ☑ | Built | 19/10/2026 |

**Notes**

- 21/10/2026 · TB · Leave (#26): Record Leave marks a Last Day in another year as it is typed (the contract's New Year check, with My Leave's, #12). Attendance (#25): Export's Period says what is wrong with a typed day after today ("Pick 21/10/2026 or earlier") through `DateRangeField`'s `onProblem`, and every attendance date field keeps a four-digit year as typed (M0 note). Left: nothing.
- 21/10/2026 · TB · Attendance's PR 2 built (clock fixes, `docs/guides/attendance.md` §1.2): Attendance (#25) lists every refused punch's exception (outside the fence or an unknown device under Refuse, its detail Refused), decided as §6.8 says (accept keeps the refusal, reject marks it wrong; neither makes it count); Location Unclear in place of Location Unverified, with its reason (no reading, rough reading, at the edge, no home, no office). A punch People reject frees its slot: the person clocks in or out again, and a clock-out rejected on a day already closed opens its missing clock-out for Add Clock-Out, which recalculates the day. Backend: the reading judged with its accuracy (`attendance.geofence.js` `judgeReading`), `1380` (`attendance_event.slot`, the unique index a slot at a time; applied on a fresh database before `1405`, `1450` and `1460`, and on one already holding them), `1397` (the label), leave read on the work date and re-projected onto a closed day when granted later (`attendance.day_reprojected`), a stored key reused for the other punch after 48 hours is 422, `shared/geo`'s second geofence removed. This closes PR 3's "Left: PR 2". Left: the M3 query subscriber and payroll's `in_run` (M6), as before.
- 21/10/2026 · TB · Attendance (#25) and Worksites (#28), a temporary site's hours (owner decision, 21/10/2026; `docs/guides/attendance.md` §6.11): Add Work Site and Add Temporary Site open on Hours, Usual Shift or Site Hours with Starts At and Ends At, and a site shows its hours. Site Hours make every day of the site worked for its people, weekends and holidays included, on the site's own clock: the clock-in reminder and the start prompt at its start, lateness from it with the policy's grace, the closing prompt, overtime and the system clock-out from its end, and a day with no clock-in closed absent; the register and the roster count those days as worked. Migration `1475`. Left: nothing.
- 21/10/2026 · TB · Attendance's PR 3 built (rules and schedules, `docs/guides/attendance.md` §1.2): Employees (#24) gains the record's Work Schedule tab after Job, in place of the Attendance tab (Work Setup, the week day by day, Set Schedule for anyone, never one's own); Attendance (#25) gains Deductions and Overtime in the view switch (Waive Selected up to 25 with a reason, Confirm and Cut on overtime, Approve Overtime on a person's day), System Clock-Out as a punch's source with the real time a person gave, early departures and overtime on a day. Backend: work schedules (`1420`), each day judged once (`1425`), the consequence rules (`attendance.rules-engine.js`, `1430`), pending deductions and overtime (`attendance.pay.js`, `1435`), reminders to clock out every 30 minutes and the System Clock-Out (`1440`). This closes the #24 and #25 part of the 20/10/2026 note, with PR 4's places beside it. PR 2 (clock fixes) is not built: it was not on main, so none of it is here. Checked on the real API in Chromium at 1440 × 900 and at 390 px with touch: a version published on Policies (grace 10 minutes from 22/10), a schedule set from 22/10, a late clock-in run through the watch (reminders at 17:00, 17:30 and 18:00, the System Clock-Out at 18:30), Give Real Time and Correct Time to 17:40 (the day 8h 05m, late 35, overtime 40), a deduction waived, overtime confirmed, 19 breach alerts on Home; not checked: a push on a real phone. Left: PR 2, the M3 query subscriber, payroll's `in_run` (M6).
- 20/10/2026 · TB · Attendance (#25) and Worksites (#28), attendance's PR 4 (`docs/guides/attendance.md` §6.11, §6.12, §10): Worksites has a Permanent and Temporary switch; Permanent is the worksites as before, alone. Temporary lists the sites in the reader's scope with state chips, Add Temporary Site (People's own, in force at once; ⌘K's too), and a site's view with Approve and Reject (through its approval; nobody on a site decides it), Take Off and Cancel Site with a reason; while a request or assignment made before PR 4 waits or is in force, Requests and Field sit beside the sites. People · Attendance loses Requests, Field and New Assignment; a day's evidence and an exception show the route of check-ins between the punches, and a check-in's flag is decided Accept or Reject. Backend: migrations 1450, 1455, 1460, seed 1470, `attendance.sites`, `.sites.repo`, `.check-ins`, the site first in `contextFor` with its time zone, the approval's exclusions in the workflow engine. Checked live in Chromium against the real API (1440 by 900 and a 390 px phone with touch): Add Work Site with the purpose searched and an address from the device while search was down, the approval on Worksites, a clock-in matched to the site, Check In listed Inside on the panel and on People's route, the phone's fan and full sheets. Left: PR 2's location reader is not merged, so Check In reads the location itself; PR 3's Location Flags do not yet count flagged check-ins.
- 20/10/2026 · TB · Attendance redesign agreed (`docs/guides/attendance.md` §1.1, TB's decisions of 20/10/2026, after an audit of the clock path the same day), built in four PRs (§1.2): 1, policies foundation (in progress); 2, clock fixes; 3, rules and schedules (lateness from the start, alerts and queries from the policy, pending deductions, overtime, work schedules on a Work Schedule tab, reminders and the system clock-out); 4, places (permanent and temporary sites on Worksites #28, Add Work Site on Home, HR approval, check-ins). Attendance (#25), Worksites (#28) and Employees (#24) stay Built until their PR lands.
- 19/10/2026 · TB · Attendance (#25), New Assignment, and Work Location Requests (#87), a client visit: each site shows its centre and fence on a map under the radius once both coordinates are real, a tap moving the centre (`SiteMap.tsx`, shared with Worksites #28; `docs/guides/attendance.md` §10). No address lookup on these two (worksites only). Nothing left on maps for these forms.
- 19/10/2026 · TB · Worksites (#28): the form and a worksite's details draw the centre and its fence on a map; a tap on the form's map moves the centre, and coordinates typed with no address fill it from the reverse lookup (worksites only). Left: the same map on a field site's and a client visit's form (`docs/guides/attendance.md` §13).
- 19/10/2026 · TB · Worksites (#28): Add Worksite and Edit Worksite search the address as it is typed and the place picked fills Latitude and Longitude, which stay open to correct; the same on a field assignment's sites on Attendance (#25) and a client visit's site on Work Location Requests (#87). A home's address (My Attendance #9, a temporary home) suggests addresses too, the coordinates staying the reading's (`docs/guides/attendance.md` §5, §10; `docs/guides/foundation.md` §6.13). Left: a map of the fence on the worksite's form, with the map tiles.
- 19/10/2026 · TB · Attendance (#25), Employees (#24) and Organogram (#92): Export Register, the CEO's Download Their Data and Download PDF save the file on the device that pressed, never by email (`docs/guides/attendance.md` §5, §7; ess.md §5; organogram.md §5 to §7, §11; foundation.md §6.12). Export Register's sheet closes once the request is taken and the file arrives wherever the person is in the app. Left: nothing.
- 19/10/2026 · TB · People · Attendance (#25): automatic clock-outs (`docs/guides/attendance.md` §6.14). A day's evidence names a punch's source Automatic, and the register keeps the person's own punch's location and device after one. An explained automatic clock-out is an Automatic Clock-Out exception, decided Accept or Correct Time (People's time stands in its place and the automatic one stops counting; Reject is refused). Left: nothing.
- 19/10/2026 · LA · Hybrid staff's weekly schedule (owner decisions, 19/10/2026; `docs/guides/attendance.md` §6.13): Employees (#24) gains an Attendance tab on the record (Work Setup: pattern, office and radius or No Office Assigned, home state; Work Week: each day Office, Remote or Off, From and Next), and Set Schedule for a hybrid employee (`people` edit within scope, never your own): one Office or Remote choice per working day, From (today to 90 days), Reason; at least one working day left for home. `attendance_schedule` in `1340`; `GET` and `POST /attendance/schedules/:employee_id`; event `attendance.schedule_set` (Record History: Work schedule set; the person is told). On the clock a hybrid home day is fenced on the approved home (100 m) as a remote day is, an office day on the worksite; Home's roster and the register (#25) read a present home day as remote. An office day with no office assigned now goes to review (`no_worksite`) instead of being accepted unchecked; a client visit is fenced on its site (`1350`). The INTERIM `EmployeeDetails.tsx` and setup types are deleted. 4 integration tests, 3 screen tests. Left: People still need to add MTN Plaza on Worksites with its coordinates and assign the hybrid staff (data, not code); a temporary home for hybrid staff.
- 19/10/2026 · LA · People · Attendance (#25): Field beside Requests, field assignments (owner decisions, 19/10/2026; `docs/guides/attendance.md` §6.12). A line manager (their team) or People (anyone) send one to 25 people to one or two sites, typed with a centre and a radius of 100 to 500 m, for up to 31 days from today: New Assignment, numbered `FA-0001`, in force at once, each person told. Never yourself; one active assignment a person a day. An assignment opens with its details, sites and people; Take Off (a reason, never the last) and Cancel Assignment (a reason) while it runs. On its days it decides the place before anything else; beyond every site is outside the worksite, named with the nearer. Search finds one by number, name, client or person. `1330`, `1393`; seven routes; three events. Checked by 5 integration tests, 2 screen tests and on the mock at 390 and 1440 px (Cynthia). Left: adding people to an assignment or changing its sites and dates (cancel and set a new one); fencing a site from its address once address search exists (F21).
- 19/10/2026 · LA · People · Attendance (#25): Requests beside Homes, the work location requests in the reader's scope waiting first (Waiting, Approved, Rejected, Cancelled, All), searched by name or number, each opening with its details, its approval route and the decisions so far; Record Decision (Approve, or Reject with the reason the person reads) when its stage waits on the reader, through the approval's own routes. The temporary home's point is shown to People with scope all only. Left: nothing.
- 19/10/2026 · TB · People · Organogram (#92), TB's four decisions on the phone
  (`docs/guides/organogram.md` §5 to §8, §10): Focus and Everyone, opening on Everyone, the whole
  company as one folding list; Focus has the path from the top, each card's team ("3 direct · 13 in
  all"), Dotted Line and Same Manager, and cards carry their department again. A card opens the
  person's sheet on both shells, with Change Manager (the record's reporting line form, now
  `app/src/features/shared/ReportingForm.tsx`), so a phone moves a line without dragging. Download
  PDF is real (`POST /org-chart/exports`, `org-chart.layout.js`, `templates/documents/org-chart.html`,
  emailed; a failed render tells the person), where it was a toast that made nothing. Add Role is in
  the floating button alone on a phone. The build account keeps every grant until handover
  (`docs/guides/identity.md` §8), held by a test. Left: nothing.
- 19/10/2026 · TB · People · Organogram (#92), from a review of the roster on staging, which drew
  four tops (the CEO, both open seats and the build account) and hid the seven marketing officers
  under a seat a phone could not reach. TB's four decisions of 19/10/2026: the sheet's VACANT rows
  name their seat's line (Head Sales & Revenue under the Program Manager, Technical Assistant under
  the CEO) and the importer applies it; `roles.json` puts the build account under the CTO; while a
  seat is empty the first person above it approves for its reports and has them in team scope
  (`employee_effective_manager`, `1160`); the sheet's errors are corrected. Screens: the CEO first,
  the desktop tree opens and returns (Expand All) centred on the CEO, an open seat's branch folds
  and unfolds like a person's, a phone search lists the matching cards, and Also At The Top lists
  any other card at the top. Loops through a seat are refused. Left: staging takes the sheet's
  corrections on screen and the roster step goes back on the server
  (`docs/runbooks/staff-roster.md` §2, §6).
- 18/10/2026 · LA · People · Attendance (#25): Homes beside Register and Exceptions, remote staff's home locations waiting first (Waiting, Approved, Rejected, All), each with the person, accuracy, when it was sent, how far it is from the home in force and, for scope all, the address and point (masked under personal details); People with scope all approve or reject one (a reason the person reads, never their own), and a link opens it (`?home=`). A remote punch outside the approved home is `outside_home` (warn reviews, block rejects); no approved home is Location Unverified for review. `attendance_home`, `home_radius_m` and the type in `1310`, its name in `1391`; five routes, two events; no address or point in any event, notification, audit line, AI read or search result. 41 integration tests on the real migrations, 35 unit tests. Left: hybrid staff's home days, temporary homes and field assignments (§13).
- 17/10/2026 · LA · People · Attendance (#25), Devices (#27) and Worksites (#28) on the real API (`docs/guides/attendance.md`): modules `attendance`, `devices`, `worksites`, migration `1300`, reference seed `1390`. The punch is judged on the server (clock guard, geofence off, warn or block, device off, warn or block, device time ahead), recorded with its evidence and the day in one transaction with its event, audit and outbox rows, under an advisory lock and an Idempotency-Key; the day-close (01:30) opens missing clock-outs and absences once. People see the day's figures and register within their scope, a person's day with each punch's evidence (coordinates for scope all only), and decide exceptions (accept, reject, add the clock-out; scope all, never their own); Export Register emails up to 31 days. Devices: Remove Device with a reason. Worksites: add, edit, retire, restore, assign. 34 integration tests on the real migrations, 43 unit tests, 4 panel tests; checked on the real API at 390 and 1440 px. Left: the map and address search (F21), field assignments and approved homes (§13), the late-query rule (M3), Settings · Attendance Policy (M9).
- 17/10/2026 · AJ · People · Leave (#26): Leave Types (add, change, retire; delete only a type nothing has used, `LEAVE_TYPE_IN_USE` otherwise) and Allowances (one person's allowance of a type for a year, or back to the type's; the person is told). The four types are seeded in `seeds/reference/1290_seed_leave.sql` with DO NOTHING, by the team lead's decision of 17/10/2026 (an exception to A26), replacing the staging seed. 15 leave integration tests.
- 17/10/2026 · AJ · People · Leave (#26) on the real API: the `leave` module (`/api/v1/leave`): requests within the `people` scope (Operations & People everyone, a line manager their team) with search, status, type, employee and date filters; the four figures; Also Away (who else in the department is away on those days); Record Leave for someone, approved at once and the person told (`people` create); cancel granted leave before it ends (`people` edit); leave types listed for every form and added or changed by People. Approve and Reject use the approval's own routes. `1200` checks the four statuses and indexes the lists, `1290` adds Cancelled to the code list. Leave types and allowances followed the same day (note above).
- 17/10/2026 · TB · ⌘K finds an employee by their work phone, typed any way (0803 123 4567,
  +234 803 123 4567, the last four digits), as `docs/guides/foundation.md` §6.7 promised: a `phones`
  option on search providers compares the digits. Masked numbers (personal, next of kin) are never
  searched. Left: nothing.
- 17/10/2026 · TB · People · Employees (#24) and People · Organogram (#92) on the real API, with
  ESS · Org Chart (#91): the register lists 25 a page with search, the department, status and work
  pattern filters and the server's own sort, each row opening the record; Add Employee and Edit are
  the contract's `EmployeeCreate` and `EmployeeUpdate`, Archive asks why and Restore brings a record
  back, Send Invite gives a person a login, and Import Staff opens Settings · Imports on the
  employees importer (track B builds that screen, so the link lands on Settings until it does). The
  record has Profile, Job, Reporting Line, Login and History as tabs; a field the viewer may not see
  shows Restricted behind a help term. Change Manager sets a person or an open seat, with a dotted
  line beside it. The organogram draws people and open seats from one bounded read, drag moves a
  card (desktop), Add Role adds a seat, and the legend carries the two help terms; on a phone it is
  the focus view the guide asks for (Reports To, the person, Direct Reports, tap to refocus, Show Me
  or Show Top). The in-browser mock answers the contract's shapes, sort included. Left: the
  Documents tab (track B); Attendance Today and the attendance and location modal come back to the
  register with LA's attendance API (`app/src/features/people/EmployeeDetails.tsx` holds them and
  nothing links to it until then); PDF export on the chart.

- 15/10/2026 · AJ · Frontend built in `app/src/features/people/` against the in-browser mock API (INTERIM shapes in `app/src/api/types/organisation.ts`), desktop and phone, checked against demo.html. No ticks: UI is ticked once the screens run on the real API. Left: the backend endpoints and contract, then swap the INTERIM types for `contract.gen.ts`.
- 15/10/2026 · TB · Organogram ratified as #92 (`organogram`, M1, TB) alongside ESS · Org Chart (#91). Owner and milestone assigned; build follows `docs/guides/organogram.md`.
- 13/10/2026 · TB · Organogram agreed with the client rep and written up as
  `docs/guides/organogram.md`: two screens, People · Organogram (HR builder) and ESS · Org Chart
  (read-only viewer for all staff), over the live reporting tree. Proposed scope addition to the
  §18 inventory (85 to 87), pending ratification, so no numbered screen rows added here yet. A demo
  preview was added to `demo.html` for sign-off. What is left: ratify the inventory, assign owner
  and milestone, then add the rows and build.

### Performance

| # | Screen | Tab | M | Owner | API | UI | Mobile | Status | Updated |
|---|---|---|---|---|---|---|---|---|---|
| 29 | Goals | `goals` | M2 | TB | ☐ | ☐ | ☐ | Not started | |
| 30 | Targets | `targets` | M2 | TB | ☐ | ☐ | ☐ | Not started | |
| 31 | KPIs | `kpis` | M2 | TB | ☐ | ☐ | ☐ | Not started | |
| 32 | Reviews | `reviews` | M2 | TB | ☐ | ☐ | ☐ | Not started | |
| 33 | Analytics | `analytics` | M2 | TB | ☐ | ☐ | ☐ | Not started | |

**Notes**

- 21/10/2026 · AJ · Performance (#29 to #33, #10) left out of M2's PR, as the lead asked (21/10/2026): it is new, the donors do not have it, and TB builds it from MyCity's sheets on the Google Drive. The API, migrations 2020 and 2030, seed 2091, contracts and screens built on 19 and 20/10 are removed from the branch (they stay in its history, commit d820732); the screens are back on the mock. Rows back to Not started, owner TB.
- 15/10/2026 · AJ · Frontend built in `app/src/features/performance/` against the in-browser mock API (INTERIM shapes in `app/src/api/types/performance.ts`), desktop and phone, checked against demo.html. No ticks: UI is ticked once the screens run on the real API. Left: the backend endpoints and contract, then swap the INTERIM types for `contract.gen.ts`.

### Queries & Sanctions

| # | Screen | Tab | M | Owner | API | UI | Mobile | Status | Updated |
|---|---|---|---|---|---|---|---|---|---|
| 34 | Queries | `queries` | M3 | GE | ☐ | ☐ | ☐ | Not started | |
| 35 | Rules | `rules` | M3 | GE | ☐ | ☐ | ☐ | Not started | |
| 36 | Sanctions | `sanctions` | M3 | GE | ☐ | ☐ | ☐ | Not started | |
| 37 | Letter Templates | `letter-templates` | M3 | GE | ☐ | ☐ | ☐ | Not started | |

**Notes**

- 15/10/2026 · AJ · Frontend built in `app/src/features/queries/` against the in-browser mock API (INTERIM shapes in `app/src/api/types/queries.ts`), desktop and phone, checked against demo.html. No ticks: UI is ticked once the screens run on the real API. Left: the backend endpoints and contract, then swap the INTERIM types for `contract.gen.ts`.

### Recruitment

| # | Screen | Tab | M | Owner | API | UI | Mobile | Status | Updated |
|---|---|---|---|---|---|---|---|---|---|
| 38 | Vacancies | `vacancies` | M4 | TB | ☐ | ☐ | ☐ | Not started | |
| 39 | Candidates | `candidates` | M4 | TB | ☐ | ☐ | ☐ | Not started | |
| 40 | Assessments | `assessments` | M4 | TB | ☐ | ☐ | ☐ | Not started | |
| 41 | Interviews | `interviews` | M4 | TB | ☐ | ☐ | ☐ | Not started | |
| 42 | Offers | `offers` | M5 | LA | ☐ | ☐ | ☐ | Not started | |
| 43 | Onboarding | `onboarding` | M5 | LA | ☐ | ☐ | ☐ | Not started | |
| 44 | Talent Pool | `talent-pool` | M5 | LA | ☐ | ☐ | ☐ | Not started | |

**Notes**

- 15/10/2026 · AJ · Frontend built in `app/src/features/recruitment/` against the in-browser mock API (INTERIM shapes in `app/src/api/types/recruitment.ts`), desktop and phone, checked against demo.html. No ticks: UI is ticked once the screens run on the real API. Left: the backend endpoints and contract, then swap the INTERIM types for `contract.gen.ts`.

### Payroll

| # | Screen | Tab | M | Owner | API | UI | Mobile | Status | Updated |
|---|---|---|---|---|---|---|---|---|---|
| 45 | Payroll Runs | `payroll-runs` | M6 | LA | ☐ | ☐ | ☐ | Not started | |
| 46 | Payslips | `payslips` | M6 | LA | ☐ | ☐ | ☐ | Not started | |
| 47 | Salary Structure | `salary-structure` | M6 | LA | ☐ | ☐ | ☐ | Not started | |
| 48 | Deductions | `deductions` | M6 | LA | ☐ | ☐ | ☐ | Not started | |
| 49 | Statutory | `statutory` | M6 | LA | ☐ | ☐ | ☐ | Not started | |

**Notes**

- 15/10/2026 · AJ · Frontend built in `app/src/features/payroll/` against the in-browser mock API (INTERIM shapes in `app/src/api/types/payroll.ts`), desktop and phone, checked against demo.html. No ticks: UI is ticked once the screens run on the real API. Left: the backend endpoints and contract, then swap the INTERIM types for `contract.gen.ts`.

### Partnerships

| # | Screen | Tab | M | Owner | API | UI | Mobile | Status | Updated |
|---|---|---|---|---|---|---|---|---|---|
| 50 | Pipeline | `pipeline` | M7 | GE | ☐ | ☐ | ☐ | Not started | |
| 51 | Partners | `partners` | M7 | GE | ☐ | ☐ | ☐ | Not started | |
| 52 | Leads | `leads` | M7 | GE | ☐ | ☐ | ☐ | Not started | |
| 53 | Proposals | `proposals` | M7 | GE | ☐ | ☐ | ☐ | Not started | |
| 54 | Contracts & MOUs | `contracts-and-mous` | M7 | GE | ☐ | ☐ | ☐ | Not started | |
| 55 | Analytics | `analytics` | M7 | GE | ☐ | ☐ | ☐ | Not started | |

**Notes**

- 15/10/2026 · AJ · Frontend built in `app/src/features/partnerships/` against the in-browser mock API (INTERIM shapes in `app/src/api/types/partnerships.ts`), desktop and phone, checked against demo.html. No ticks: UI is ticked once the screens run on the real API. Left: the backend endpoints and contract, then swap the INTERIM types for `contract.gen.ts`.

### Expenses

| # | Screen | Tab | M | Owner | API | UI | Mobile | Status | Updated |
|---|---|---|---|---|---|---|---|---|---|
| 56 | My Requests | `my-requests` | M8 | AJ | ☐ | ☐ | ☐ | Not started | |
| 57 | Approvals | `approvals` | M8 | AJ | ☐ | ☐ | ☐ | Not started | |
| 58 | Requisitions | `requisitions` | M8 | AJ | ☐ | ☐ | ☐ | Not started | |
| 59 | Disbursements | `disbursements` | M8 | AJ | ☐ | ☐ | ☐ | Not started | |
| 60 | Budgets | `budgets` | M8 | AJ | ☐ | ☐ | ☐ | Not started | |
| 61 | Categories | `categories` | M8 | AJ | ☐ | ☐ | ☐ | Not started | |

**Notes**

- 15/10/2026 · AJ · Frontend built in `app/src/features/expenses/` against the in-browser mock API (INTERIM shapes in `app/src/api/types/expenses.ts`), desktop and phone, checked against demo.html. No ticks: UI is ticked once the screens run on the real API. Left: the backend endpoints and contract, then swap the INTERIM types for `contract.gen.ts`.

### Knowledge Hub

| # | Screen | Tab | M | Owner | API | UI | Mobile | Status | Updated |
|---|---|---|---|---|---|---|---|---|---|
| 62 | Policies | `policies` | M1 | TB | ☑ | ☑ | ☑ | Built | 21/10/2026 |
| 63 | SOPs | `sops` | M10 | TB | ☐ | ☐ | ☐ | Not started | |
| 64 | FAQs | `faqs` | M10 | TB | ☐ | ☐ | ☐ | Not started | |
| 65 | Training | `training` | M10 | TB | ☐ | ☐ | ☐ | Not started | |
| 66 | Announcements | `announcements` | M10 | TB | ☐ | ☐ | ☐ | Not started | |

**Notes**

- 21/10/2026 · TB · Policies (#62): the Attendance worksheet shows every rule (Working Hours, Lateness, Late Arrivals, Early Departure, Absence, Forgotten Clock-Outs, Location Flags, Overtime, Location Checks, Devices, Clock Prompts; `app/src/features/policies/worksheet.ts`), each a switch with its figures, with the server's suggestions for a first draft; a rule compares as changed whatever order its keys came in. Closes PR 1's "Left: the worksheet's PR 3 sections". Left: Tidy With AI against a real model.
- 20/10/2026 · TB · Policies (#62), attendance's PR 4: the Attendance policy's `site_geofence_mode` reads Temporary Site Check on the worksheet, with new help, and its section At a Temporary Site covers a site's addresses and its check-ins and ends with "Working somewhere else? Add it from Home, or ask People." (`docs/guides/policies.md` §14). Left: nothing.
- 20/10/2026 · TB · Policies (#62) built (PR 1): the `policies` module, contract and migrations `1400`, `1405` (the Attendance policy's versions moved over with their ids), seed `1396`; the screen in `app/src/features/policies/` (the list, a policy's draft with the editor or the Attendance worksheet, Publish or Submit with a signature, Withdraw, Recall, Archive, versions and acknowledgements, Download PDF), the mock, and `RichText` in `packages/ui`. Tests: unit, `tests/integration/policies.test.js` on the real migrations, the screen on the mock. Tidy With AI runs on the Default job, carrying personal data (never DeepSeek), TB 20/10/2026. Left: the worksheet's PR 3 sections; Tidy With AI against a real model.
- 20/10/2026 · TB · Policies (#62) brought forward from M10 to M1 (TB's decisions of 20/10/2026; MILESTONES §18 ratified 20/10/2026): Knowledge Hub · Policies becomes the one place for every company policy, documents and rules policies, the Attendance policy first, with versions, Applies To, an optional approval route with signatures, Tidy With AI and the letterhead PDF; staff acknowledge on ESS · Policy Updates. Guide written (`docs/guides/policies.md`); the build is PR 1 of four (`docs/guides/attendance.md` §1.2). Left: the contract, the `policies` module and migrations `1400`, `1405`, `1396`, the screens; Tidy With AI waits for the AI area convention to pick its model.
- 15/10/2026 · AJ · Frontend built in `app/src/features/knowledge/` against the in-browser mock API (INTERIM shapes in `app/src/api/types/knowledge.ts`), desktop and phone, checked against demo.html. No ticks: UI is ticked once the screens run on the real API. Left: the backend endpoints and contract, then swap the INTERIM types for `contract.gen.ts`.

### Praxis AI

| # | Screen | Tab | M | Owner | API | UI | Mobile | Status | Updated |
|---|---|---|---|---|---|---|---|---|---|
| 67 | Ask | `ask` | M10 | TB | ☐ | ☐ | ☐ | Not started | |
| 68 | History | `history` | M10 | TB | ☐ | ☐ | ☐ | Not started | |

**Notes**

- 15/10/2026 · AJ · Frontend built in `app/src/features/assistant/` against the in-browser mock API (INTERIM shapes in `app/src/api/types/knowledge.ts`), desktop and phone, checked against demo.html. No ticks: UI is ticked once the screens run on the real API. Left: the backend endpoints and contract, then swap the INTERIM types for `contract.gen.ts`.
- 15/10/2026 · AJ · Fixed a blank screen on Ask: the scroll effect returned a value, which crashed React in browsers where `scrollIntoView` returns a Promise. The shell now wraps every screen in an error boundary, so a crash in one screen shows an error card there and the menu and back button keep working.

### AI Control

| # | Screen | Tab | M | Owner | API | UI | Mobile | Status | Updated |
|---|---|---|---|---|---|---|---|---|---|
| 98 | Actions | `actions` | M10 | TB | ☑ | ☑ | ☑ | Built | 20/10/2026 |
| 99 | Models | `models` | M10 | TB | ☑ | ☑ | ☑ | Built | 21/10/2026 |
| 100 | Spend | `spend` | M10 | TB | ☑ | ☑ | ☑ | Built | 21/10/2026 |

**Notes**

- 20/10/2026 · TB · AI Control built (PR2 of the AI plan, M10 brought forward; `docs/guides/ai-control.md`,
  decisions 12 to 28): its own module under System, the `ai_governance` stub filled and shown as AI Control
  with its own `ai_control` key (IT edits, Operations & People view, seed 10290). Actions: the seven jobs and
  the registered actions, each chain a first choice and up to three fallbacks with each model's state, Edit
  Chain, Make First, an action's own chain and Use Job Chain. Models: every provider's models in dollars and
  naira at the day's rate, Edit Price, and Find Prices (Deep Reasoning with Google Search, in the worker) with
  Accept, Edit Price and Dismiss. Spend: this Lagos month per provider against its cap, all AI against the
  overall cap, by day and by action; Set Cap. Every AI call now walks its action's chain (`services/ai/jobs.js`)
  across Gemini, Anthropic and DeepSeek, passing a model that is not set up, off the key, at a Free plan's
  daily limit, skipped until its reset, at its provider's cap, DeepSeek on personal data, or unable to search;
  each step keeps the naira prices and rate it was charged at (`services/ai/prices.js`, migration 10200).
  The registry `services/ai/actions.js` holds Voice Note Transcription, Tidy Policy, Data Answers (registered,
  built in M10) and Find Prices; gate `check/ai-actions.js` fails a call that names no registered action.
  Tests: 10 integration, 11 unit, 6 screen. Left: Data Answers and the per-module switch's screen with M10's
  Assistant; set Find Prices' first prices on staging and production once the keys are in.
- 21/10/2026 · TB · Find Prices fixed after the first run on staging proposed nothing for 129 models (the
  answer was capped at 60 and cut short; decisions 29 to 32). Fewer models: a key's list now leaves off
  `-latest` aliases, Gemma and snapshots of a model already listed, unless a chain uses one (migration 10210
  clears those already stored). Find Prices asks only about models with no price, 20 to a request with
  thinking kept low, and marks Not Listed what the page does not price (asked again after 7 days); each press
  is an `ai_price_run` with its progress, run as the `ai-find-prices` job and claimed once, since a run
  outlasts an outbox handler (a review found retries searching twice). Models: the New Prices sheet (Batch 2 of 4, each price with Accept
  and Dismiss, Accept All, Find More, Still to Price and Not Listed), opened by Find Prices or Review Prices;
  the list opens on models in a chain, with a Show filter (On Key, Not on Key, Any); a failed run's reason
  stays beside Find Prices. Tests: 14 integration, 2 unit, 4 screen for Models. Left: on staging and production, press Test on the Gemini connection to re-read
  its list, then Find Prices until Still to Price reaches 0.
- 21/10/2026 · TB · Spend (#100) fixed after staging showed Spend by Day's labels run together and a bare
  `transcription` row in By Action. Each bar carried the whole date (`dayLabel` split `formatDate` on a space
  it no longer has) and the shared bar drawing printed every label at a size that grew with the card; each
  day now reads 14/10, the chart sits in one card, not two, and `BarChart` keeps its labels 11 px, leaving off
  those that would touch (M0 note). The `transcription` row was 4 voice notes kept under the old key before
  the registry: migration 10220 moves them onto Voice Note Transcription, the old key kept in
  `ai_run.original_purpose` so its DOWN is exact. Tests: 1 integration, 1 screen. Left: nothing; 10220 runs
  with the next deploy.

### Settings

| # | Screen | Tab | M | Owner | API | UI | Mobile | Status | Updated |
|---|---|---|---|---|---|---|---|---|---|
| 69 | Organisation | `organisation` | M9 | GE | ☑ | ☑ | ☑ | Built | 19/10/2026 |
| 95 | Status | `status` | M9 | GE | ☑ | ☑ | ☑ | Built | 20/10/2026 |
| 96 | Performance | `performance` | M9 | GE | ☑ | ☑ | ☑ | Built | 20/10/2026 |
| 97 | Faults | `faults` | M9 | GE | ☑ | ☑ | ☑ | Built | 21/10/2026 |
| 70 | Users | `users` | M9 | GE | ☑ | ☑ | ☑ | Built | 16/10/2026 |
| 71 | Roles & Permissions | `roles-and-permissions` | M9 | GE | ☑ | ☑ | ☑ | Built | 18/10/2026 |
| 72 | Approvals | `approvals` | M9 | GE | ☑ | ☑ | ☑ | Built | 17/10/2026 |
| 73 | Attendance Policy | `attendance-policy` | M9 | LA | ☑ | ☑ | ☑ | Dropped | 20/10/2026 |
| 74 | Notifications | `notifications` | M0 | TB | ☑ | ☑ | ☑ | Built | 19/10/2026 |
| 75 | Appearance | `appearance` | M9 | GE | ☐ | ☐ | ☐ | Not started | |
| 76 | Documents & Numbering | `documents-and-numbering` | M9 | GE | ☑ | ☑ | ☑ | Built | 21/10/2026 |
| 77 | Integrations | `integrations` | M9 | TB | ☑ | ☑ | ☑ | Built | 21/10/2026 |
| 78 | Security | `security` | M9 | GE | ☑ | ☑ | ☑ | Built | 17/10/2026 |
| 79 | Audit Log | `audit-log` | M9 | GE | ☑ | ☑ | ☑ | Built | 19/10/2026 |
| 93 | Imports | `imports` | M0 | TB | ☑ | ☑ | ☑ | Built | 19/10/2026 |

**Notes**

- 21/10/2026 · TB · From the 21/10 System Health brief. Documents & Numbering (#76), fault #3: a scheme's three rules are the contract's (`NumberingSchemeSave`), so the form marks them as it is filled rather than on Save ("Needed when it resets", "Add sequence digits", "Add digits or period"), and Each Year or Each Month ticks Period. Faults (#97): a refused form is recorded under its own rule and the route as declared (`LEAVE_SPANS_YEARS: ends_on` at `POST /api/v1/ess/leave`, where three lines had read `VALIDATION_FAILED` at `POST /leave`). Of the brief's other faults, #5 and #6 were already fixed (Find Prices as a job, #107; refused addresses, #111) and #4 is Geoapify's outage (Ignore it). Tests: `app/src/features/settings/Numbering.test.tsx`, `domain.test.js`, `middleware.test.js`. Left: mark #1 to #3 Fixed and #4 Ignored once this is on staging.
- 21/10/2026 · TB · Faults (#97) on a phone: a tap on a row's tick opened the fault instead of picking
  it, so nothing could be picked for Download Brief. The phone card's open button is stretched over the
  whole card and covered the tick (`DataView`, since Faults moved to the list's own selection on
  20/10); the tick now sits above it, kept inside its card. Attendance · Pay Items had the same fault
  and is fixed with it. Left: nothing.
- 21/10/2026 · TB · Integrations (#77): Pause Mail and Resume Mail on the System Sender, for the Milestone 1
  handover on the 50-an-hour plan (`docs/guides/integrations.md` §1.3, §6.15, §6.16; TB's answers of
  21/10/2026). While paused only invitations, password resets, Send Test Email and the server's health alarm
  go out; a notice due by email is pushed instead (past the person's push switch), digests are dropped, other
  mail waits for Resume; Settings · Status reads Mail as Paused without a check-down notice. A queued
  invitation or reset whose link was replaced or expired is dropped. An address the mail server refuses for
  good (cPanel's 550) is not retried: one warning on Faults and a Refused Addresses list on the System Sender
  with the person's name (`mail_refusal`, `9230`). A host over its own hourly limit is waited on for an hour.
  The daily digest goes only to people who have signed in. A fault's Where is the stack's first "at" line.
  Phone: the Paused pill on the card, the banner and Pause Mail in the sheet's footer, Refused Addresses as
  cards. Left: press Pause Mail on each environment until the plan moves to 10,000 an hour, then raise the
  Hourly Limit and Resume (`docs/runbooks/dns-and-mail.md` §5).

- 20/10/2026 · TB · Integrations (#77) with AI Control (`docs/guides/ai-control.md` decision 26): the AI
  providers no longer send Daily Limit Near at 80%, and their Daily Limit help says so; an AI connection's In
  Use reads the chains saved on AI Control; Open AI Control on each AI connection, and Open Connection on a
  model on AI Control · Models, which opens that connection here (`?id=` its code). Left: nothing.
- 20/10/2026 · TB · Attendance Policy (#73) dropped: the Attendance policy moves to Knowledge Hub · Policies as a rules policy (MILESTONES §18, ratified 20/10/2026; `docs/guides/policies.md`). Its row stays, Dropped, counted nowhere. Left: the tab, its routes, its registrations and its screen come out in PR 1.
- 20/10/2026 · TB · Integrations (#77) built, brought forward from M9 by TB (owner GE → TB) from TB's
  twelve answers (`docs/guides/integrations.md`): the system sender, the staff mail server, Geoapify,
  Gemini and the web push keys are set on the page per environment instead of the server's `.env`,
  which stays the fallback. One registry (`shared/integrations/providers.js`) and one reader
  (`settings.js`, a change reaching the API and the worker within a second); secrets encrypted and
  bound to their row, never shown again (a key's last four), a fresh sign-in to set one; every save
  tested first, the free tests watched every 15 minutes, paid ones judged by real use counted per
  day against a daily limit (warned at 80%); failures reach IT through System Health's new Maps and
  Staff Mail Server checks. A server with no mail settings starts and holds its mail; a staff mail
  server change re-points every mailbox. Migration 9200, seed 9290 (the `integrations` key for the
  Implementation Team and the System Administrator). Left: set the keys on staging and production;
  Appearance (#75) stays M9.
- 20/10/2026 · TB · Integrations (#77), PR1 of TB's AI answers (`docs/guides/integrations.md` §1.2,
  `docs/guides/ai-control.md`): Groq, OpenAI, Anthropic (Sonnet and Haiku only), DeepSeek and
  Exchange Rates join Gemini; each AI connection keeps a model list (seeded by `9291`, read from the
  provider with the key on every save and test, Add Model with an optional endpoint), and each job's
  model comes from it (`services/ai/jobs.js`), so a new Google key no longer fails on the old
  `gemini-2.5-flash` default. Free or Paid per connection, the Free limit a hard stop
  (`shared/integrations/quota.js`, Geoapify included). Exchange rates daily after midnight Lagos and
  by Sync Rates (`exchange_rate`, `shared/money/fx.js`). Every connection is a check on Settings ·
  Status. Migrations 9210, 9220, seed 9291. Left: PR2, AI Control (actions and their chains, Make
  First, Spend and per-provider caps, Find Prices, the job conventions' check, Data Answers); set the
  new keys and plans on staging and production; confirm the seeded Gemini and DeepSeek ids with a
  real key (guide §13).
- 20/10/2026 · TB · Faults (#97) on a phone put each row's tick inside the card's open button (the
  a11y gate's nested-interactive); the picking now goes through the list's own selection, with
  Download Brief, Mark Fixed, Ignore Faults and Open Again in its bar. Left: nothing.
- 20/10/2026 · TB · Performance (#96) rebuilt from TB's six answers (`docs/guides/system-health.md`
  §6, §14): four tiles judged against targets (99.9% up, p95 under 800 ms, under 1% failing),
  editable with Edit Targets (`system_health` edit, audited; Status's disk, memory, processor and
  connection checks read the same levels); Processor, Memory and Disk in real units, each split
  by what uses it (production, staging, database, Redis, the upload scanner; the disk by each
  environment's database and files, backups and logs), with steal, I/O wait, cache, reserved space
  and days to full; Network and Server facts; nine trend charts over an Hour, a Day, a Week or a
  Month; and Slowest Routes (p95 per route), Database (slow SQL from `pg_stat_statements`, largest
  tables, connections), Background Work (queues, events, every scheduler's runs) and Processes
  (people online, memory, event loop, restarts). Availability now counts minutes the API answered,
  not minutes every check was up, which read 0.0% while the app served. New: migration 9120, a
  one-minute sampler, per-process beats, a root timer for the disk's parts, 10 routes, `TrendChart`
  and `StackBar` in `packages/ui`. Also (#95, #97): System Health's notices opened nothing, because
  their record types had no route; a fault notice now opens its sheet on Faults and a check or the
  digest opens Status, and the three tabs follow `system_health` in the shell and ⌘K. Tested: 13
  new integration tests, 21 unit tests, 3 screen tests, the component tests. Left: `provision.sh`
  run again on the server (one PostgreSQL restart) turns on slow SQL and the disk's parts
  (`docs/runbooks/system-health.md` §8); until then both say so on screen.
- 20/10/2026 · TB · Status (#95) made for investigating. It refreshes every 30 seconds; each check
  opens a sheet (`GET /system-health/checks/:key`) with what its probe measured, since when, its 7
  days of changes 25 a page, every scheduler for Background Jobs (what the code set it to, in words,
  last run, result, error, next run, why it is late) and every queue for Worker. **Download Brief**
  on Status writes the whole system as Markdown (`system_health.status-brief.js`) with instructions
  that make an AI understand first, ask 4 to 10 questions, gather evidence with read-only SSH
  commands pasted back, change the server only with a yes, open a draft PR for code and walk the
  owner through the rest; the Faults brief shares those instructions and gains the system's state
  at each occurrence. On the server, `npm run health:brief` (`scripts/ops/health-brief.js`) builds
  the same file without the app, and `mycity-health-watch-<env>.timer` mails it every time
  something is down to intelligence@jbspraxis.com, copying tomblakeasaah@gmail.com and
  praxisjbs@gmail.com. Fixed: `outbox-dispatch` was never recorded (so it always read as not run),
  a nightly job read as late before its first slot, a run that failed on its first try kept no
  failure time, and Status failed outright while the database was down. Left: install the two
  watch timers once on the server (`docs/runbooks/system-health.md` §7.3), and confirm the first
  mail arrives.
- 20/10/2026 · TB · System Health split into three tabs (#95 Status, #96 Performance, #97 Faults)
  after TB walked the first release on staging, and the engine behind it fixed. **The three
  schedulers were never registered in `src/jobs/registry.js`, so nothing ran for an hour and the
  Performance card read "Nothing Recorded Yet", which looks like good news.** Now: the schedulers
  are registered; every tick is recorded in `schedule_run` (migration 9110); a new `schedulers`
  readiness check reports any job that has not run within three of its own intervals; and
  `scripts/check/schedulers.js` fails the build when a file in `jobs/schedulers/` is not started by
  the worker, which is the gate that would have caught it. Status gains the resources people ask
  for first: disk, memory, processor, and the database's size and connections. Performance now
  shows response time and the share of requests that failed, from `request_stat`, a row a minute
  written by the API (the snapshot runs in the worker and cannot read the API's own metrics), and
  says plainly when nothing is recording instead of showing a neutral empty state. Left: thresholds
  for disk and memory are first guesses and want a week of real numbers.
- 19/10/2026 · LA · Attendance Policy (#73) on the real API, brought forward from M9 with Policy Updates (owner decisions, 19/10/2026; `docs/guides/attendance.md` §6.15): one organisation policy in numbered versions. People with `settings` edit change the clock checks (Grace Minutes 0 to 60; the location check for the office, a home and a field site, each Off, Warn or Block; GPS Accuracy 50 to 250 m; Home Radius 50 to 500 m; the Device Check), Save Draft (each changed rule tagged), Discard Changes, and Publish Policy from a first day (today to 90 days, after any version waiting) with a note, which makes it `Version N` and tells everyone; a version waiting can be withdrawn with a reason, its rules going back to the draft. Versions list each one's first day, state and acknowledgements; a version opens with its rules and who has acknowledged it (Everyone, Acknowledged, Pending). The location mode is now per place on the clock, and each punch keeps the version it was judged by. `1370` (versions, place modes, `attendance_policy_acknowledgement`), `1395` (1099's Standard policy out, A26); 12 routes; 6 events; one job. Owner set to LA, as the 17/10 note says. Checked by 8 integration tests, 4 backend unit tests and 3 screen tests on the mock (desktop and 390 px), and on the real API in Chromium at 390 px (20/10/2026): Save Draft, Publish Policy and Versions with who acknowledged; with the office on Block, a clock-in 1 km away was refused and one 30 m away accepted, each recorded with Version 1. Left: the pay rules (lateness deduction, overtime) join the policy with payroll (M6) and the late-arrivals query rule with Queries (M3).
- 20/10/2026 · TB · System Health (#95) built, second tab after Organisation, from TB's brief and
  answers (`docs/guides/system-health.md`): the readiness checks as they stand, a day or a week of
  snapshots, and every fault the code reports, grouped on the fingerprint the error reporter already
  writes, with a status the team shares. Ticking faults downloads one Markdown brief that tells an AI
  how this repository works and requires 4 to 10 clarity questions before any fix; the ticked faults
  become Being Handled so nobody fixes one twice. Its own `system_health` permission key, seeded to
  the Implementation Team and the System Administrator only, so HR, Management and the CEO are never
  alerted about a stack trace. Backend: contract, migration 9100 (`error_group`, `error_group_note`,
  `health_snapshot`), seed 9190, eight routes, three schedulers (roll-up and snapshot every 5
  minutes, the 08:00 digest, the nightly purge). Notices sit in a new locked System Health category:
  the bell and push cannot be switched off, email only on the 24 hour escalation, through a new
  per-notice `channels` default on `defineNotification` (`docs/guides/notifications.md`). 30 unit
  tests and 19 integration tests on the real migrations. Left: walk it on a phone once staging has
  it; `ops/monitoring` still alerts by WhatsApp for infrastructure, which is unchanged.
- 19/10/2026 · TB · Notifications (#74), brought forward from M6 to M0 by TB with the rest of the
  notifications work (`docs/handoff/notifications-everywhere.md`, PR 2), built on both shells: the
  Reminders card (Approvals Waiting, Probation Ending, Daily Digest; Edit Reminders) and every
  notice the code sends, 25 a page, searched and filtered by category, each with who it goes to,
  its channels and its level; Edit Notice sets On or Off, the level, the default channels and
  copies to roles and people where the notice is about someone else, or resets it
  (`GET /notifications/rules`, `PUT /rules/:key`, `POST /rules/:key/reset`, `GET` and `PUT
  /reminders`; `0480`). Each person's Notification Settings gains Quiet Hours and the Daily Digest.
  Tested: `notifications-rules` (10 integration tests), unit tests, the app's form tests. Left:
  nothing; M2's tasks and calendars declare their reminders from the guide's §7.1.
- 19/10/2026 · TB · Audit Log (#79): Export saves the whole filtered log as a workbook on the device that pressed, never by email (`docs/guides/foundation.md` §5, §6.12, §7); its cover now says the filters, how many entries and what Restricted means, which the email used to say. A login with no email is no longer refused. Left: nothing.
- 19/10/2026 · TB · Organisation (#69): the brand files (`docs/guides/foundation.md` §6.11). A Brand card takes the Logo, the White Logo (shown on Deep Green) and the Icon, each one upload that applies at once (`POST`, `DELETE /settings/organisation/brand/:slot`, purpose `brand`: PNG or WebP, kept a PNG, colours untouched), and Remove. Letterheads and PDFs draw the Logo, system mail's header the White Logo inside the message, email signatures the White Logo or the Icon. One reader of the profile for all of them (`shared/organisation/profile.js`) also fixes letterheads and system mail, which read an `organisation.profile` row nothing wrote and so always printed the defaults; the letterhead's footer now carries the RC number. Left: MyCity uploads its files.
- 19/10/2026 · TB · Imports (#93): a row saved with something missing (a warning: a person left
  without a Line Manager, say) is a problem beside the errors and duplicates. The preview lists
  those rows (`GET /imports/:id/rows?status=problem`, contract `ImportRowListQuery`) and counts
  them, in amber when nothing blocks, and the history's Problems column counts them too, so the
  preview never says Every Row Is Fine over a person left at the top of the tree
  (`docs/guides/foundation.md` §10.1, §11). Left: nothing.
- 18/10/2026 · TB · Roles & Permissions (#71) redesigned from three drawn options per shell (`docs/guides/foundation.md` §6.10): desktop is a split view, the roles beside the role in view with Access, Details and People, and Roles or Matrix at the page head; the phone opens a role full screen with its modules grouped by level as chips, a chip opening a sheet while editing. Each module's access is one level (No Access, View, Add, Edit, Full) with Approve and Export, mapped to the six actions on screen only (the API and contract are unchanged; a grant that fits no level reads Custom). Edit Role, then Save Role reviews what the role gains, loses and changes and how many people it reaches. The letters T, O, A, X carry help and a key; the role's summary sits behind an ⓘ; People lists who holds it and opens their login on Users (Users now opens a login linked by `?id=`). Unsaved edits ask before another role, the matrix, New Role or another screen; New Role is a name and Start From, then the role opens in place through Access, Details and Review. New shared components: `LevelMeter`, `ItemChip`, `StepBar` (Wizard uses it) and `RadioCards`; the app router gains `useLeaveGuard`. Left: nothing.
- 17/10/2026 · TB · Approvals (#72) built on the real API, track D of `docs/guides/foundation.md`: the
  flows (25 a page, with search), their KPIs (Flows, Open Requests, Overdue, Needs Fixing), a flow's
  route and stages in a side panel, and Edit Stages: change a stage's approver, when it applies and its
  time limit, add, remove and reorder stages, Save Stages as the next version (open requests keep
  theirs; a stale version is refused). Desktop table and side panel; phone cards and full sheets. Left:
  `3099`'s consequence flow shows Needs Fixing until M3 seeds a valid one.
- 17/10/2026 · TB · Organisation (#69): Nigeria's public holidays for 2026 and 2027 are seeded
  (`seeds/reference/0448`, 33 days): the eight the Public Holidays Act fixes as Declared, and the
  Eids and the weekday given for a weekend holiday as Expected (`0410`), confirmed or moved on the
  card with Confirm Holiday. Left: 2028's list, in a later seed or a yearly job.
- 17/10/2026 · TB · Organisation (#69), Roles & Permissions (#71), Documents & Numbering (#76),
  Security (#78) and Audit Log (#79) built on the real API, track C of `docs/guides/foundation.md`,
  desktop and phone; the mock follows the same paths and contract shapes. Organisation: the company
  profile, public holidays by year and the working week (Monday to Friday 09:00 to 17:00, Saturday
  09:00 to 15:00). Roles: the role list and matrix, a role's modules with actions and scope,
  sensitive fields and capabilities, New Role and Delete Role. Numbering: every scheme with its next
  number, editable. Security: session minutes, idle lock and password minimum within the server's
  floor, two-step by role, everyone's sessions with End Session, failed sign-ins. Audit Log:
  filters, entries with their changes (Restricted where masked), Export by email. Left: no document
  setting other than numbering is specified for #76; the organisation profile is empty until
  entered on staging and production; Integrations, Appearance and Notifications stay Coming Soon;
  Attendance Policy (#73) is LA's.
- 17/10/2026 · TB · Imports (#93) built on the real API, track B of `docs/guides/foundation.md`: the
  wizard (Upload, Map, Preview with the rows that have problems, Commit, with Blank Sheet, the new
  values to tick and Commit Valid Rows) over ANY registered importer, opened with `?importer=<key>`;
  and the history, every batch with its counts, Download Errors and Revert. Desktop and phone. The
  screen knows nothing about what is being imported: the columns and choices come from
  `GET /imports/importers`. The staff importer itself is track A's. Left: the mock cannot carry a
  sheet, so the wizard in a mock build says so and stops at Upload.
- 16/10/2026 · TB · Users (#70): Reset Two-Step in a login's sheet (confirm, then the fresh-sign-in
  check; the person is signed out everywhere, told, and sets two-step up again from My Security), and
  a Two-Step column on desktop.
- 16/10/2026 · TB · Users (#70) built on the real API, the lean screen agreed with TB: counts, status chips, the paged list, Users by Role, Invite User, and per login Save Roles, Resend Invitation, Send Reset Link, Sign Out Everywhere, Suspend with a reason, Reactivate; desktop and phone. The roles picker reads `GET /access/roles`. Left for M9: the role editor on the real API (Roles & Permissions is still on the mock).
- 15/10/2026 · AJ · Frontend built in `app/src/features/settings/` against the in-browser mock API (INTERIM shapes in `app/src/api/types/settings.ts`), desktop and phone, checked against demo.html. No ticks: UI is ticked once the screens run on the real API. Left: the backend endpoints and contract, then swap the INTERIM types for `contract.gen.ts`.
- 15/10/2026 · AJ · Roles & Permissions: New Role and Edit Role (name, purpose, per module the actions and the record scope, and the three sensitive fields), delete for an unused custom role, the CEO role locked, built-in roles keep their names. The matrix, the roles list and the role pickers in Users read the saved roles; every change is audited. Copy now says four layers with no entity layer (MILESTONES §14, A2). INTERIM endpoints in `app/src/api/types/settings.ts`: `GET /settings/roles/catalogue`, `GET|PUT|DELETE /settings/roles/:id`, `POST /settings/roles`, for GE to confirm. Left: the mock's demo sign-ins do not yet take their access from these roles.

### Public site · `go.mycityapp.io` (separate app)

| # | Screen | Path | M | Owner | API | UI | Mobile | Status | Updated |
|---|---|---|---|---|---|---|---|---|---|
| 80 | Careers | `/jobs` | M4 | TB | ☐ | ☐ | ☐ | Not started | |
| 81 | Vacancy | `/jobs/<slug>` | M4 | TB | ☐ | ☐ | ☐ | Not started | |
| 82 | Apply | `/apply/<token>` | M4 | TB | ☐ | ☐ | ☐ | Not started | |
| 83 | Assessment | `/assess/<token>` | M4 | TB | ☐ | ☐ | ☐ | Not started | |
| 84 | Sign Offer | `/sign/<token>` | M5 | LA | ☐ | ☐ | ☐ | Not started | |
| 85 | Verify Document | `/verify/<number>` | M5 | LA | ☐ | ☐ | ☐ | Not started | |

**Notes**

- 15/10/2026 · AJ · Built `public-app/` (A9) from the demo's Public Site pages: Careers, Vacancy, Apply, Assessment, Sign Offer and Verify Document, desktop and phone, light and dark with a visitor toggle, against an in-browser mock of `/api/public/v1`. Added the states the demo does not draw: application received, assessment start, finished and time up, offer signed, declined and expired, the three failed verify verdicts and a reference lookup, and every bad link (unknown, expired, used). No ticks: UI is ticked once the pages run on the real API. Left: the public routes in the contract. Only `GET /verify/:number` and `GET /<surface>/:token/document` are named in BACKEND_STRUCTURE §8; the rest are INTERIM in `public-app/src/api/types/public.ts` for TB (M4) and LA (M5) to agree, including `POST /jobs/:slug/apply` minting the apply token and `POST /apply/:token/cv` for the CV.
