# Verifying MyCity's QA audit findings (shared brief)

## Background
MyCity App Ltd (the client) ran a QA audit on staging (hub.staging.mycityapp.io) on 16-17/11/2026,
logged in as a Management-role user. They reported findings F01 to F83. We (JBS Praxis, the vendor)
must decide, for every finding, whether it is real, already fixed, by design, seed data, a setup
task for MyCity, or outside the contracted scope. The result goes into a fix tracker we will share
back with MyCity, so every verdict must be one we can defend with evidence.

Repository: /home/user/mycity-app, branch at HEAD 697f1db (main as of 24/11/2026). Read
/home/user/mycity-app/CLAUDE.md first: it is the map of how the repo is documented. Code merged
AFTER the audit includes 4978ae8 (#170, "Work tab for every reader, and the QA audit's controls",
17/11, fixed many Partnerships findings; see docs/guides/partnerships.md lines ~1721-1736 and
docs/PROGRESS.md line ~1385), 9793ccf, 264eaee, 697f1db. `git log --since=2026-11-16` lists them.
Something fixed after 16/11 is FIXED_SINCE_AUDIT, but only once you have checked the fix works.

## Scope: what was contracted
- docs/MyCity-ERP-Documents/MILESTONES.md is binding for scope (A1 to A26 and each milestone's
  section and Definition of done). docs/MyCity-ERP-Documents/REUSE_MAP.md wins over it where they
  disagree. Amendments inside MILESTONES (dated) are part of scope.
- Each module's guide (docs/guides/<module>.md) records decisions taken with MyCity (§13 usually),
  and docs/handoff/<module>.md records build decisions. A behaviour a guide or MILESTONES decided
  deliberately is BY_DESIGN, even if the auditor dislikes it: cite the line. It may still be worth
  logging as an IMPROVEMENT if it is cheap and clearly better, but say it was a decision.
- A request for a capability no milestone covers is OUT_OF_SCOPE (it goes to a Change Report for
  discussion). Already ruled out of scope by our lead: a finance core (invoicing, AR/AP, ledger,
  bank reconciliation, VAT/WHT), sales/inventory/orders, and the Mailbox module (a change request
  MyCity rejected). Do not argue scope from memory: cite the MILESTONES section that does or does
  not cover it.
- "Seed data": the staging demonstration seed is ours (seeds/staging/), MyCity's real staff list is
  ours too (seeds/staff/, loaded on staging AND production). Bad data in those files is a bug of
  ours (SEED_DATA, name the file and line). Data MyCity typed into staging themselves is CLIENT_ACTION.
  Production is never seeded with demo data (A5), so staging-only demo noise does not reach go-live.

## How to verify (be sure; this is the point of the exercise)
Use the strongest means available, in this order:
1. **Reproduce it with a test against the real backend.** Integration tests run here against real
   PostgreSQL. Use YOUR OWN database and Redis index (given in your prompt) on every jest command:
   `RUN_DB_TESTS=1 DATABASE_URL=postgres://mycity:mycity@127.0.0.1:5432/<your_db> REDIS_URL=redis://127.0.0.1:6379/<n> npx jest <path>`
   Never use mycity_test (another session's) or another agent's database. A run takes ~15-60 s.
   Look first for an existing test that already covers the rule (grep tests/integration and
   src/modules/*/*.test.js) and run it. Where none covers it, write a short throwaway reproduction
   by copying the setup of the nearest existing integration file (they use supertest on buildApp,
   helpers/schema rebuild, createAdmin). Name it `tests/integration/zz-audit-<yourgroup>-<topic>.test.js`
   and DELETE every such file before you finish. Do not modify any other file in the repository.
   Do not commit, push or run `npm run ci` / screen gates.
2. Contract rules (Zod schemas in packages/contract/schemas/) can be checked directly with a
   one-off `node -e "const s=require('/home/user/mycity-app/packages/contract/schemas/<x>.js'); ..."`.
3. Frontend behaviour: read the screen in app/src/features/<module>/ and the shared component in
   packages/ui/src/, and the screen's existing tests. Frontend tests run with vitest
   (`npx vitest run <file>` inside app/ or packages/ui/; check package.json for the exact script).
   Cite file:line.
4. Code reading alone is acceptable only when 1 to 3 are impractical; say so in the evidence.

Where an auditor's claim is half right, split it into parts (e.g. "F09a bank picker free-add: BUG",
"F09b supplier master list: OUT_OF_SCOPE"). Check the auditor's numbers and claims rather than
assuming they are right: they tested as one role on staging and some observations are their
misreading.

## Verdicts (pick one per finding or part)
- FIXED_SINCE_AUDIT: was real, fixed after 16/11; give the commit and how you verified the fix.
- BUG: the product does something wrong against its own spec.
- GAP: in scope (cite) but not built or incomplete.
- IMPROVEMENT: works as specified, but a clear, in-scope, worthwhile improvement (UX, clarity,
  validation hardening). Keep these honest: not every auditor wish is one.
- BY_DESIGN: works as specified and decided; cite the decision. No fix.
- SEED_DATA: bad data in our seeds (file:line).
- CLIENT_ACTION: the capability exists; MyCity must configure, enter data, decide policy, or train
  staff (e.g. set a setting, enter statutory figures, send invites). Say exactly what they do and where.
- NOT_REPRODUCED: you tried and the claim does not hold; say what you did.
- OUT_OF_SCOPE: not in any milestone; cite why. Say what a Change Report would need to cover.

## What to return (your final message, nothing else needed)
For each finding (and part), one block in exactly this form:

```
ID: F09a
Title: <our own short title, plain English, max 12 words>
Verdict: BUG | GAP | IMPROVEMENT | FIXED_SINCE_AUDIT | BY_DESIGN | SEED_DATA | CLIENT_ACTION | NOT_REPRODUCED | OUT_OF_SCOPE
Severity: Critical | High | Medium | Low      (OUR assessment for go-live, not the auditor's)
Module: <module>
Evidence: <what you ran and its result, or file:line read; be specific and short>
Scope ref: <MILESTONES § / guide § / decision line that governs it>
Fix: <what to change, where (files), 1-3 sentences; "None" if no fix>
Effort: S (< half day) | M (1-2 days) | L (3+ days)
For MyCity: <one or two plain sentences we can show the client: what we found and what happens next>
```

Then a final line listing any throwaway test files you created and confirming you deleted them,
and `git -C /home/user/mycity-app status --short` output (must be empty).
Write in plain English, no em dashes. Dates day-first.
