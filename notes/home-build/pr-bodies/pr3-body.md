## What this changes

Home PR 3 of 5, to `main` (after tomblakeasaah196/mycity-app#56 and tomblakeasaah196/mycity-app#59): **Home · Team (#86) on the real API, desktop and phone**, plus the gated state for Home's three manager tabs. Built to `docs/guides/home.md` §2, §5, §6 Team, §9 and §10.

**Backend** (`src/modules/dashboard/dashboard.team.js`, under `/home`)
- `GET /home/team/summary`: the reader's scope (The Whole Organisation, Your Team or Just You) and today's four Team cards: Present Today, On Site, Remote and Flags. Each card equals the records it opens (`GET /home/kpi/:key`). Flags counts each person once, whether late, without a clock-out yesterday, or both.
- `GET /home/team`: today's roster, paged at 25. Filters: department, status, no clock-out yesterday and `q` (name or job title). Sorts: name, department or Clock-In. KPI and Open Tasks are null until M2.
- `GET /home/team/attendance`: Attendance This Month, one row a person, with My Attendance's figures from the 1st to today in Lagos (expected, on time, late, absent, on leave). Paged at 25 in one query; filters department and `q`; sorts by name or days on time.
- Every route needs `home` view and `home.team`, and reads within the `home` grant's scope (`own` included, for someone given the capability alone).
- **AI:** `team.today` returns today's roster in the asker's scope, and an empty page without `home.team`.

**Shared roster** (`src/modules/attendance/attendance.roster.js`, for LA)
- `month()`: one page of 25 people over a range of up to 31 days, each with My Attendance's totals, in one grouped query.
- `flagged`: a count on `summary()` and a filter on `page()`.
- Nothing Attendance records or decides changed. attendance.md §5 and §6.9 describe both.

**Frontend** (`app/src/features/home`)
- **Team:**
  - The scope line and the four cards, each opening its records through `KpiDetail`.
  - Department filter and status chips.
  - The roster: searched, filtered and sorted by the server.
  - A person's sheet with View Attendance and Open Profile, for a reader who may open those screens.
  - Attendance This Month, paged at 25.
- **Gated tabs:**
  - Every Home viewer now sees all four tabs (`app/src/shell/access.ts`).
  - Team, Alerts or Reports opened without its capability shows the lock and reads nothing (`access.ts` `mayUseTab`, `Gated.tsx`).
  - ⌘K still offers only the tabs a reader may use. BACKEND_GUIDE, FRONTEND_GUIDE and foundation.md §6.7 record this one exception.

## Screens and items

#86 Home · Team: API, UI and Mobile ticked, Built.

## Checklist

- [x] `npm run ci` is green locally: the whole run, 44 of 44 (Node 20, `CI_STRICT=1`, `RUN_DB_TESTS=1` on Postgres 16 with pgvector and Redis 7), on this code with PR 4 on top before the rebase onto today's `main`. After the rebase, the 20 gates it could touch pass, and GitHub CI runs the whole suite here.
- [x] `docs/PROGRESS.md`: rows ticked, Status and Updated set, a dated note added under the module
- [x] Feature guide in `docs/guides/` matches what was built, with a Change log line
- [x] New files are on the README map (README §11)
- [x] Every list pages at 25 through `shared/http/paged.js`
- [x] Contract changed first; `npm run gen:contract` run; `contract.gen.ts` not edited by hand
- [x] Desktop and mobile both done (frontend changes)
- [x] Screen text in three tiers: nothing explaining how the system works, help only through help terms or a Details row, word limits met (gate 8, FRONTEND_GUIDE §5)
- [x] The feature guide's §10 lists what each screen shows open, behind help and on a phone
- [x] Forms only from the form system in `@mycity/ui` (`packages/ui/src/form/`), validated as filled (gate 12, FRONTEND_GUIDE §8)
- [x] Shared components only from `@mycity/ui`; nothing new in `app/src/components/`
- [x] Styling tokens only: no hex, no arbitrary value, no inline `style` (F4, FRONTEND_GUIDE §9.3)

## Native app feel (frontend changes)

- **Phone:**
  - The four KPI cards sit two to a row, then the status chips.
  - The roster is person cards (avatar, name and department, status pill, Clock-In and KPI).
  - Attendance This Month is person cards (On Time, Late, Absent).
  - The scope line, the Department filter, and the Department and Open Tasks columns stay off.
  - A person or a card opens a bottom sheet, with View Attendance and Open Profile full width at its foot.
- **Desktop:**
  - The scope line, the four cards in a row, and Department beside the status chips.
  - The roster and Attendance This Month as tables with the shared pager.
  - A person opens a modal.
- **Locked tabs:** the same lock on both shells, and nothing is read behind it.

## For reviewers

- **LA:** `attendance.roster.js` gains `month()` and `flagged` (attendance.md §5, §6.9, change log). People · Attendance taking an employee would let View Attendance open that person's day; today it opens the screen.
- **AJ:** Home's tabs show locked rather than hidden, which is the one exception in FRONTEND_GUIDE's tab rule (`Gated.tsx`, `features/home/access.ts`).
- **Reviewed before opening:**
  - Six review lenses over PRs 3 and 4 together, each finding put to three independent skeptics.
  - For the Team tab, one held: a roster filter test that could time out under load. Its waits now follow the mock's requests rather than a time budget, checked 10 of 10 runs and under CPU load by an independent verifier.
  - No security or data-exposure defect was found in Team.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01GSPctB6tk9PFSR1aH3jrJE
