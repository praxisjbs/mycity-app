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
- [x] Every finding F01 to F83 verified (174 parts), saved in `verdicts/a.md` to `e.md`
      (a Partnerships, b Payroll/People/Settings, c Expenses/Workspace,
      d Recruitment/Performance/Queries, e Home/platform/ESS). Finished 24/11/2026.
- [x] Compiled into `items.json` by `compile.py`, which holds the routing tables (module
      milestone and owner, Change Report rows, MyCity Actions rows).
- [x] Workbook built: `MyCity-QA-Audit-Response.xlsx` (zero formula errors, 83 of 83 findings
      reconciled once each).
- [ ] Before PR #173 is ready: give `docs/qa-audit/` its lines in `README.MD` (README §11), or
      move the folder out of the repository.
- [ ] Fix the open items, ticking Fixed ✓ with the PR and date.

## To rebuild the workbook

```
python3 docs/qa-audit/compile.py docs/qa-audit/items.json
python3 docs/qa-audit/build.py docs/qa-audit/items.json docs/qa-audit/MyCity-QA-Audit-Response.xlsx
```

Then recalculate it (the xlsx skill's `recalc.py`). Rebuilding replaces any ticks typed into the
workbook, so once fixing starts, tick in the workbook itself and do not rebuild it.
