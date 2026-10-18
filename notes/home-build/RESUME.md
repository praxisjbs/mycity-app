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

## 18/10/2026, later
- PR 2 OPEN: https://github.com/tomblakeasaah196/mycity-app/pull/57 (`m1/home-overview` @ 92f815f, one squashed commit,
  base `m1/home-foundation`, full CI 44/44). Pre-squash history kept as local tag `home-pr2-prequash` (b03c829).
- PR 3 `m1/home-team` @ 5f10bc4: squashed and rebased onto 92f815f (only PR 2's review fixes came in; doc notes kept both
  sides). Full CI was 44/44 before the restack. Under adversarial review now (with PR 4). Not yet opened.
- PR 4 `m1/home-alerts` @ a75973c: built, integrated (README, PROGRESS #2 Built, counts, note), rebased onto 5f10bc4.
  Full CI running (DB mycity_d_test, Redis 14). Under adversarial review (workflow wf_e1b9c371-2d7). Not yet opened.
- Next: fix the review findings in PR 3 / PR 4 (fix in the branch that owns the code, then rebase PR 4), CI each, open PR 3
  (base m1/home-overview) and PR 4 (base m1/home-team); then PR 5 Reports on `m1/home-reports` from m1/home-alerts.

## PAUSED 18/10/2026 (owner out of credit)
State on GitHub:
- PR 1 #56 and PR 2 #57 OPEN (CI 44/44 each).
- PR 3 `m1/home-team` @ 5f10bc4 and PR 4 `m1/home-alerts` @ a75973c: built, restacked on PR 2, full CI on PR 4
  (which contains PR 3) 44/44. NOT opened yet. Bodies drafted: notes/home-build/pr-bodies/pr3-body.md, pr4-body.md
  (replace REVIEW_LINE after the review).
- PR 5 `m1/home-reports`: build had just started (backend R1 + screen R2 reading the code); any partial files are
  in the "wip(home): PR 5 partial build (paused)" commit, if one exists.
Review of PRs 3+4 was stopped mid-way: lenses team-logic (no findings) done; security found one candidate:
  "A line manager or Head of Department can see, clear and dismiss alerts about themselves, and that closure stops
  the evidence from ever raising again" (src/shared/alerts) — needs verifying and probably a fix (exclude the
  reader's own employee id from what they may clear, or from visibility, except the CEO).
To resume (same session): Workflow resumeFromRunId wf_e1b9c371-2d7 (review, script notes/home-build/workflows/
  pr34-review.js) and wf_ce59fb57-df5 (PR 5 build, notes/home-build/workflows/home-pr5-reports.js). New session:
  re-run those scripts (args are in the files' callers: repo /home/user/mycity-pr4, base 92f815f; PR 5 worktree
  from m1/home-alerts).
Then: fix confirmed findings, CI, open PR 3 (base m1/home-overview) and PR 4 (base m1/home-team), finish PR 5.

## Resumed 18/10/2026 morning
- PR 2 reached main through #59 (#57 had merged into m1/home-foundation, not main). main = PR 1 + PR 2 + #58 (Roles).
- From now on each Home PR targets main (GitHub CI runs only on PRs to main) and is merged by Claude once green (owner's
  instruction: "You are supposed to merge please. Using my admin rights.").
- PR 3/4 review: 19 confirmed (notes/home-build/pr34-review-confirmed.json); fixes running (workflow wf_179d92fb-06f):
  self-clearing excluded (CEO excepted), deadline today vs expired, evidence keys, ?rule= deep link, Team test flake, docs.
- PR 5 built (backend, Reports tab, staging seed), integrated (PROGRESS #3 Built), under review (wf_9ae5febb-69d).
