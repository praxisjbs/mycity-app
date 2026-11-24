# MyCity QA audit response (work in progress)

MyCity's QA audit of staging (16 and 17/11/2026, findings F01 to F83, tests T01 to T86) is being
checked against the code on `main` at 697f1db. Every finding is tested or read, and given a verdict.
The result is a workbook JBS Praxis fixes from and later shares with MyCity.

Checkpoint pushed 24/11/2026 · TB's session · branch `claude/peaceful-clarke-fo8vc9`.

## Decisions already taken (TB, 24/11/2026)

- Out of scope, so they go to the **To be Discussed (Change Report)** sheet: the finance core
  (F03: invoicing, AR/AP, ledger, reconciliation), sales and inventory (F04), and Mailbox (F47:
  a change request MyCity rejected). Anything else a verifier marks OUT_OF_SCOPE joins them.
- The main sheet holds only verified bugs, gaps, improvements and seed-data fixes, with a
  **Fixed ✓** column that is ticked as each one is fixed.

## The workbook (build.py)

Sheets: Summary (live counts by formula), Bugs & Gaps (the tracker), To be Discussed (Change
Report), MyCity Actions (setup, data and policy decisions for MyCity), Audit Reconciliation (every
F-number and where it went). `build.py items.json out.xlsx` builds it from one JSON file with
four lists: `tracker`, `change`, `client`, `recon`, plus `meta`. See the docstring and the keys
each list's row reads.

## Where the work stands

- [x] Audit read, scope checked against MILESTONES.md (M6 and M8 amendments matter: expenses
      have no amount threshold by decision; duplicate-claim detection IS in M8's scope).
- [x] Partnerships fixes merged after the audit noted (#170, 4978ae8): F05 retested, 13 of 13
      in `tests/integration/partnerships-work.test.js` pass.
- [~] Five verifiers, one per group (`groups/`), each following `BRIEF.md`. Their verdicts are
      saved in `verdicts/a.md` to `e.md` (a Partnerships, b Payroll/People/Settings,
      c Expenses/Workspace, d Recruitment/Performance/Queries, e Home/platform/ESS).
      A file may be partial if the session stopped mid-run.
- [ ] Compile the verdicts into `items.json` (one row per item, the reconciliation for all 83).
- [ ] Build the workbook, recalculate it (zero formula errors), check every F-number is
      accounted for, deliver it.

## To resume in a new session

1. Read this file, then `BRIEF.md`.
2. For each group, compare `groups/<g>.txt` (the finding numbers) with `verdicts/<g>.md`. Any
   finding with no block there still needs verifying: give a fresh agent `BRIEF.md` and only the
   missing findings, with its own `*_test` database (the integration tests need one per agent).
3. Compile everything into `items.json` and run `python3 build.py items.json <out>.xlsx`, then
   the xlsx skill's recalc.
