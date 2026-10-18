## What this changes

Home PR 5 of 5, to `main` (after tomblakeasaah196/mycity-app#62, Alerts): **Home · Reports (#3) on the real API, desktop and phone**, the reports engine behind it, the Overview's Export, and the Home staging seed. With it, all four Home screens are Built. Built to `docs/guides/home.md` §3 step 7, §4, §5 Reports, §6 Reports, §7, §8, §9, §10 and §11, and decisions O1, O8, O11 and D9.

**Backend** (`src/modules/reports`, under `/home`)
- **Sources** (`reports.sources.js`, keys equal to the contract's `HOME_REPORT_SOURCES`):
  - Daily Attendance, Leave, Open Alerts and Headcount read each screen's own query, gathered page by page as the reader, at most 2,000 rows a table.
  - Tasks, Partnerships, Expenses and Recruitment read their milestones' tables and find nothing until those milestones use them.
  - `overview` is the reader's own Overview, for the Export.
- **Reports:**
  - Name, source, filters (checked against the source, 422 on the field) and Share With Managers. The name is unique per owner, whatever its case.
  - A shared report is seen by `home.reports` holders who may open its source.
  - Only the owner or the CEO edits, pauses, resumes or archives one. Archiving stops the schedule and keeps the runs.
- **Schedules** (`reports.schedule.js`):
  - A `shared/time/recurrence.js` rule from a start day, at a time in Lagos, optionally on working days only; never cron.
  - Formats are PDF, XLSX or both. Recipients must hold `home.reports` and the source's grant, and a refusal names the person.
  - A paused schedule has no next slot. Saving keeps it paused or running as it was, and a slot already due when it is saved still fires once.
- **Runs:**
  - Run Now (`POST /home/reports/:id/run`) and the Overview Export (`POST /home/overview/export`) each answer one pending run for the caller. A second press, or the same Idempotency-Key, is the same run.
  - Numbers come from `numbering.allocate(client, "report_run")` (RPT-0001).
  - `GET /home/report-runs` lists the runs a reader received and every run of the reports they own, paged at 25. `GET /home/report-runs/:id` is one of them, or a 404.
- **Jobs:**
  - `scheduled-reports` scans for due schedules every 5 minutes, under the cron lock.
  - `scheduled-report` makes one run per recipient and format for a slot, however often it runs, and moves the schedule to its next slot.
  - A slot and an edit to its report take turns: report, then schedule, then counter, in every path.
- **Generation** (`reports.generate.js`, `reports.files.js`, outbox handler `reports.generate`):
  - Each file is built as its recipient (their grants, scope and field masks), so it never holds a row they could not open on screen.
  - The PDF goes through `documents.generate` (one `home_report` doc type, landscape, the run's number on it). The XLSX goes through `shared/spreadsheet` and the vault. Both use day-first dates and Naira.
  - A recipient who is no longer active or has lost the grant is `skipped`, and checked again before emailing. A file is emailed once it exists.
  - `vault.defineAccess("home_report_run")`: only the recipient, the report's owner and the CEO open it.
  - `shared/events/outbox.js` now passes `max_attempts` to handlers, so a handler that keeps its own status records a final failure instead of throwing forever.
- **AI and search:**
  - `reports.mine` and `runs.mine` read only.
  - ⌘K finds reports and runs (route-map `home_report`, `home_report_run`), and New Report is a ⌘K action for `home.reports` holders.

**Frontend** (`app/src/features/home/Reports.tsx`, `ReportForm.tsx`, `Overview.tsx`)
- **The four counts:** Scheduled, Paused, Runs This Month and Recipients.
- **A card per report** with its status, source, schedule in words and audience, plus:
  - Run Now: in the report's format, or a choice of PDF or XLSX, toasted with the run's number.
  - For the owner or the CEO: Edit Report, Pause or Resume Report, and Archive Report, which is confirmed.
- **Recent Runs:**
  - Paged at 25, with Pending, Failed, Skipped or Download.
  - It reads itself again every 10 s while a run on the page is pending.
- **New Report and Edit Report:**
  - One three-step form through the form system: Report, Schedule, Delivery. There is no Delivery step for On Demand.
  - The server's 409 and 422 field errors land on their fields.
- **Deep links:** `?id=`, `?run=` (any run, read on its own) and `?action=new`. New Report is also in the floating button and ⌘K.
- **Overview Export:** a numbered PDF or XLSX run of the reader's Overview.
- **Mock** retyped to the contract.

**Staging seed** (`seeds/staging/60_home.js`, `seeds/staging/lib/`)
- It gives every Home card, chart, list and tab figures on staging:
  - attendance for the real staff today and over the last 14 working days, written through the attendance module's own writers;
  - forward rows by SQL with fixed ids;
  - four alert rules and the morning sweep, so every alert is a real breach;
  - four reports through the reports service.
- Running it twice changes nothing, and it survives seats filled and teams changed between runs. It refuses production.
- The ids of every forward row are written out in `seeds/staging/lib/home-staging-rows.js` (`HOME_STAGING_ROWS`), not worked out from the rows. `removeHomeStagingRows` deletes them with the alerts about them, and DATABASE_SCHEMA's Read by Home notes tell each owning milestone to call it when its own staging seed lands.

## Screens and items

#3 Home · Reports: API, UI and Mobile ticked, Built. The four Home screens (#1, #2, #3, #86) are now all Built; M1 has no screen In Progress.

## Checklist

- [x] `npm run ci` is green locally, the whole run, 44 of 44 (Node 20, `CI_STRICT=1`, `RUN_DB_TESTS=1` on Postgres 16 with pgvector and Redis 7), on this commit with PRs 3 and 4 beneath it on today's `main`
- [x] `docs/PROGRESS.md`: rows ticked, Status and Updated set, the M1 and total counts moved, a dated note added under the module
- [x] Feature guide in `docs/guides/` matches what was built, with Change log lines
- [x] New files are on the README map (README §11): the `reports` row, the two templates and the staging seed
- [x] Every list pages at 25 through `shared/http/paged.js`
- [x] Contract changed first; `npm run gen:contract` run; `contract.gen.ts` not edited by hand
- [x] Desktop and mobile both done (frontend changes)
- [x] Screen text in three tiers: nothing explaining how the system works, help only through help terms or a Details row, word limits met (gate 8, FRONTEND_GUIDE §5)
- [x] The feature guide's §10 lists what each screen shows open, behind help and on a phone
- [x] Forms only from the form system in `@mycity/ui` (`packages/ui/src/form/`), validated as filled (gate 12, FRONTEND_GUIDE §8)
- [x] Shared components only from `@mycity/ui`; nothing new in `app/src/components/`
- [x] Styling tokens only: no hex, no arbitrary value, no inline `style` (F4, FRONTEND_GUIDE §9.3)
- [x] No empty Home stubs left (README §11.5): `src/modules/reports/*`, both report jobs and the email template are filled. The empty M7 and M8 alert stubs (partner inactivity, budget threshold, approval ageing) belong to their milestones and stay, as README §5.15 says.

## Native app feel (frontend changes)

- **Phone:**
  - The four counts two to a row, then the report cards one to a row with Run Now as a full-size tap target.
  - The owner's actions and Run Now's PDF or XLSX choice open as bottom action sheets.
  - Recent Runs is a card list (the report with its number, Run, Recipient, Status, and Download on a done run).
  - New Report is also in the floating button's fan. New Report and Edit Report open as a full-screen sheet with the steps and Next full width at the bottom.
  - A report or run opened from a link is a bottom sheet. Export stays off the phone Overview (§10.2).
- **Desktop:**
  - The counts in a row of four, and report cards three to a row with the owner's actions in a menu beside Run Now.
  - Recent Runs is a table (Number, Report, Run as a day-first date and time, Recipient, Format, Status) with the shared pager.
  - The form is a centred modal with its step indicator. Archive is confirmed.
  - Export is a header button beside New, with a PDF or XLSX menu.

## For reviewers

- **LA:** the staging seed writes attendance through `attendance.repo` `insertEvent`, `reconcile.recomputeDay` and `reconcile.closeDay` (source `import`, idempotency keys prefixed `staging-home:`), and changes no attendance code. An attendance staging seed of yours can take over `seeds/staging/lib/attendance.js`.
- **AJ (M2, M8), TB (M4), GE (M7):** staging now holds Home's rows in your milestones' tables. When your own staging seed lands, call `removeHomeStagingRows` for your tables and take their entries out of `forward-rows.js` in the same PR (DATABASE_SCHEMA, Read by Home).
- **GE (shared code):**
  - `src/shared/events/outbox.js` passes `max_attempts` in each handler's ctx.
  - `scripts/check/schema-drift.js` now reads `FOR NO KEY UPDATE OF` and `FOR KEY SHARE OF` as row locks, with gate tests.
- **Staging:** PDF runs need Chromium wired for `documents.generate`, as the other generated documents do. Without it a PDF run ends Failed with why; XLSX is unaffected.
- **Reviewed before opening:**
  - Five review lenses over the diff, each finding put to three independent skeptics. 10 held, none of them security or data exposure; the two that questioned an owner opening recipients' files were refuted, since D9 decides it.
  - Fixed, each with a test shown to fail without it:
    - a deadlock between a slot firing and an edit or Run Now, reproduced in Postgres;
    - a due slot dropped by a save;
    - Run Now answering an old scheduled run;
    - two seed re-run crashes;
    - alerts left behind by the seed's cleanup;
    - cleanup steps that undid themselves;
    - `?run=` beyond the first page;
    - one recipient who lost access blocking every edit, unnamed;
    - a test that depended on the clock (proved at Monday 08:00, Lagos midnight and a month start with a faked clock).
  - An independent verifier re-ran every scenario. Its one follow-up, a refusal message over the 4-word field-error limit, now reads "Name: no access".

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01GSPctB6tk9PFSR1aH3jrJE
