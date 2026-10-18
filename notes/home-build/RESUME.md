# Resume point (paused 17/10/2026, resumed the same evening)

Branch `m1/home-foundation` @ 046a11a (WIP, CI not run, no PR opened). PR 1 was built in five slices:

| Slice | Scope | State at pause |
|---|---|---|
| A | `migrations/1140_home_foundation.sql`, `seeds/reference/1199_seed_home.sql`, `report_run` numbering, settings DOC_TYPES/labels, `tests/integration/home-schema.test.js`, DATABASE_SCHEMA | Done |
| B | Capability convention: `access.catalog` CAPABILITY_CATALOG, `requireCapability`/`requireAnyCapability`, `/me.capabilities`, shell `access.ts`, ⌘K mirrors, `scripts/check/capabilities.js` gate, README §5.2, BACKEND_GUIDE §5, guide template, foundation/identity guides | Done |
| C | Contract `packages/contract/schemas/{dashboard,alerts,reports}.js` for all five PRs + rewrite `docs/guides/home.md` to DECISIONS.md | PARTIAL: dashboard.js and alerts.js partly written; reports.js and the guide rewrite not started |
| D | `src/modules/attendance/attendance.roster.js` + organisation counts with a `today` parameter + tests + attendance.md | NOT written (stopped early) |
| E | KPI catalogue `src/modules/dashboard/kpi-catalog/*` + `src/modules/dashboard/sources/*.source.js` + tests | Not started |

Next steps:
1. Merge `origin/main` into `m1/home-foundation` first: PR #52 (m1/ess) added the leave module, `migrations/1200_leave_requests.sql`
   (changes `leave_request`, which the roster reads) and `src/modules/leave/leave.balance.js` (use it for `my_leave_left`).
2. Finish slices C, D, E (prompts are in the workflow description in DECISIONS.md D1-D13 and the briefs).
3. Integrate: README map (kpi-catalog/shared.js, resolve.js, sources/, scripts/check/capabilities.js), PROGRESS note (Home, M0
   section for the new gate), DATABASE_SCHEMA forward Owes notes, REUSE_MAP §3.2 note, `npm run gen:contract`.
4. `npm run ci` (Node 20) + `RUN_DB_TESTS=1` integration suite, review, squash the WIP commits, open PR 1, then PRs 2-5.
Local test infra used: Postgres 16 + pgvector, Redis, DBs `mycity_test` and `mycity_[a-e]_test`.

## Update after resuming
- `origin/main` (PR #52, leave module) merged into `m1/home-foundation`; contract regenerated; doc conflicts kept both sides.
- Home's schema file renumbered `1140` → `migrations/1150_home_foundation.sql` (main took `1140` for community pins).
  Home now claims `1150`-`1159` and `1199`. The redundant `leave_request` index was dropped (1200 indexes it).
- Slices C (finish contract + guide), D (roster) and E (catalogue + sources) relaunched; autosave pushes every 5 minutes.

## 18/10/2026
- PR 1 OPEN: https://github.com/tomblakeasaah196/mycity-app/pull/56 (`m1/home-foundation`, one squashed commit 6f210d0,
  full CI green 44/44 with DB tests). LA's #55 merged in; the roster now reads attendance_day and LA's rules.
- PR 2 (Overview) started on `m1/home-overview`, stacked on `m1/home-foundation` (PR base = m1/home-foundation).
