# M8 Expenses & Budget Control · Audit

**Every session that builds an M8 PR checks its work against this file before it finishes**, and
ticks or adds to it. It holds what was decided in the planning session of 04/11/2026 and 05/11/2026
(the decisions themselves are `docs/handoff/m8-expenses.md` §2, which wins over this file; the
design is `docs/guides/expenses.md`), how to check each one in the code, the findings still open,
and the one PR body the single M8 branch keeps up to date.

| | |
|---|---|
| Branch | one branch and one PR for all of M8 (AJ, 05/11/2026) |
| Owner | AJ |
| Last audited | 05/11/2026, PR 1 to PR 4 |

---

## 0 · How to use it

1. Before you finish your PR's part: walk §1 for every decision your part touches, and §2's rules.
2. Run §3's commands. A row you cannot tick is a finding: fix it, or add it to §4 with who decides.
3. Close the §4 findings your part was asked to settle; write what you chose in the guide.
4. Update §5, the PR body, for what your part added. Do not rewrite another part's lines.
5. Add a line to §6, the audit log.

---

## 1 · The decisions, and how to check each

Status: ✓ checked in code · ⏳ due in the PR named · ✗ finding (§4).

| # | Decision (handoff §2) | Check in the code | Due | Status |
|---|---|---|---|---|
| 1 | No approval threshold, anywhere | `grep -rni threshold src/modules/{expenses,expense_categories,requisitions,disbursements,budgets}` finds only the budget-threshold job (90% warning, PR 5), never a routing rule; `expense_category` has no threshold column; DEFAULTS `expenses.request` has no amount condition | PR 2, 3 | ✓ |
| 2 | Bank reference asked for, not required | `POST /disbursements` answers 422 `REFERENCE_REQUIRED` on `payment_reference` without a reference, a receipt or `confirm_without_reference: true`; saved without one shows Reference Missing; `PATCH /disbursements/:id` adds it; no trigger on `disbursement`; the screen asks **Save Without Reference?**, No returns to the field (PR 7) | PR 4, 7 | ✓ API · ⏳ screen |
| 3 | Requisitions stay, first tab; the CEO decides the whole, may remove one first | Create Requisition takes 1 to 25 `approved` requests, each `in_requisition`; `POST /requisitions/:id/remove` only by the stage's approver, with a reason, back to `approved`; approve → every request `authorised`; reject → every request `approved` and out; emptied → `cancelled`; the removal is on the request's own history (§4 F3) | PR 4, 7 | ✓ API · ✗ F3 |
| 4 | Every stage can Reject or Send Back | Approvals' Approve, Send Back, Reject through `/workflow/instances/:id/...`; Send Back → `sent_back`, approval withdrawn, Send Again opens a new one (guide §6.1 rule 6); the CEO rejects a requisition with a reason | PR 3, 4 | ✓ |
| 5 | Each request paid to its own payee | one `disbursement` per request (unique index); recipient and bank copied from the request; the requisition holds no payee | PR 4 | ✓ |
| 6 | Payee types Staff, Vendor, Partner, Dedicated Task Team (DTT) | contract `PayeeType` and the CHECK say `staff`, `vendor`, `partner`, `task_team`; label **Dedicated Task Team (DTT)** (8100); Use My Company Account only for `staff`, copying the employee record's bank at sending | PR 2, 3, 7 | ✓ API · ⏳ screen |
| 7 | Department budgets for a year by category, editable, logged; over its remaining is flagged before approval; projects have optional budgets | `budget` per department per year, `budget_line` per category; every save an event with before and after (Budget History); committed and spent recounted from the requests; `over_budget` true before each approval decides (§4 F1, F2) | PR 5 | ⏳ · ✗ F1, F2 |
| 8 | Tabs: Requisitions, Approvals, Disbursements, Projects, Budgets, Categories; My Requests in ESS | `app/src/features/expenses/index.tsx` order; ESS has My Requests; route map's `expense` self link points at ESS; the Projects row via `npm run new:screen` | PR 7 | ⏳ |
| 9 | F31 amended: Expenses records open in the modal on desktop too | `ListDetail` has a modal layout in `packages/ui` (test, gallery page); every Expenses list uses it; gate 11 still taps the phone rows | PR 7 | ⏳ |
| 10 | Categories under A26: Add Suggested Categories, no reference seed | `POST /expense-categories/suggested` only while there are none, the twelve of guide §6.7; 8099's five taken out by a **reference** seed with a guarded DELETE so production is cleared too (§4 F4) | PR 3, 7 | ✓ API · ✗ F4 |
| 11 | Nothing imported from the expenditure sheet | no importer for expenses; the sheet shapes `seeds/staging/80_expenses.js` only | all | ✓ |
| 12 | One category and one project per request; lines are description, quantity, unit price | line amount = quantity × unit price through `shared/money`; request amount = their sum; 1 to 25 lines; one invoice per request | PR 2, 3 | ✓ |
| 13 | Requester cancels until Operations & People approve; then only `expenses.finance` withdraws, until paid | `CANCELLABLE` = draft, sent_back, submitted; `WITHDRAWABLE` = approved, in_requisition, authorised; withdraw needs a reason and the capability; one in a requisition leaves it and the total is counted again | PR 3 | ✓ |
| 14 | AI: invoice reading (Image Reading), duplicate check (Default), category suggestion (Default), all suggestions a person accepts | each registered in `services/ai/actions.js` with its job and `chosen_by: "AJ"`; run outside transactions; nothing kept until the person accepts; no personal data to DeepSeek | PR 6 | ⏳ |
| 15 | `expenses.finance` for grouping, disbursing, budgets, categories | `requireCapability("expenses.finance")` on requisitions (list, get, create), disbursements (all), category writes, withdraw, budget writes; the CEO passes; held by Operations & People and the Implementation Team | PR 2 to 5 | ✓ to PR 4 · ⏳ budgets |
| 16 | Home's Budget Used counts spent and committed | `src/modules/dashboard/sources/budgets.source.js` sums both; its `owes` item cleared; Home's tests and `docs/guides/home.md` updated | PR 5 | ⏳ |
| 17 | New Request from a project | Expenses · Projects offers New Request with the project filled, the same form and service | PR 7 | ⏳ |

---

## 2 · Rules every part is checked against

From CLAUDE.md step 4 and the guide; the ones M8 is most likely to break.

- [ ] Every request is written by `expenses.service` alone; requisitions and disbursements call its `*In(client, …)` moves
- [ ] Every write in a transaction with `emit()`; follow-on work is an outbox handler
- [ ] Every list 25 a page through `pageQuery`; no `LIMIT`/`OFFSET`; the AI reads one page
- [ ] Money through `shared/money`, two-place strings on the wire; NGN only in the contract and service
- [ ] Numbers from `numbering.allocate` (`expense`, `requisition`, `disbursement`, `budget`)
- [ ] Files staged through `POST /documents` and bound with `vault.claim()`; a `document_id` stored
- [ ] Bank details masked under `employee.bank` for readers without that field grant, in AI reads too
- [ ] Every staff route has a permission; capability checks after the grant
- [ ] Search: every record type has a provider or `search:none <reason>`
- [ ] AI: every create and edit form is a card, a `via`, a never word, or on the gaps list; `npm run gen:ai-catalogue` after a contract change; an integration test and an evaluation case per action
- [ ] Migrations: merged ones never edited (8000, 8010, 8099, 8100 once merged); new ones in 8000 to 8999, UP and DOWN, idempotent
- [ ] Screens (PR 7): components only from `@mycity/ui`, tokens only, the form system, three tiers of text and the word limits, two shells
- [ ] Docs: the guide's change log, PROGRESS note (ticks only when the screen runs on the real API), the User Guide chapter and pictures with the screens, README map for new files, the handoff checklist and log

---

## 3 · Commands

```
npm run ci -- --serial                      # the whole suite, one gate at a time (Windows)
node scripts/check/ai-awareness.js          # after any contract or manifest change
node scripts/check/capabilities.js
node scripts/check/contract-columns.js
node scripts/check/guides.js && node scripts/check/progress.js
RUN_DB_TESTS=1 DATABASE_URL=... npx jest tests/integration/expenses.test.js tests/integration/ai-actions-expenses.test.js
grep -rni threshold src/modules/{expenses,expense_categories,requisitions,disbursements,budgets}
```

Failures that are not M8's and fail on `main` too: the `packages/ui` `CityShowcase` clock test and
`ActionCard` busy-state test under load; the `shell` gate on Windows without bash.

---

## 4 · Findings

Open until the PR named closes it here and in the guide.

| ID | Finding | Decides | Closes in | Status |
|---|---|---|---|---|
| F1 | Over Budget is measured against the request's **category line**; decision 7 and MILESTONES §13 say the **department's** remaining budget. Recommendation: the line, and the department's total shown beside it; write it into guide §6.6 and MILESTONES §13 as one rule | AJ | PR 5 | open |
| F2 | `over_budget` is set once, when the request is sent; decision 7 says flagged before approval, so a budget changed meanwhile shows a stale flag. Recount it before each stage decides (PR 5's recount) and on Send Again | PR 5's session | PR 5 | open |
| F3 | Removing a request from a requisition is an event on the **requisition** (`requisition.request_removed`); a request's own history, read by its entity, would not show it. Either the history read also takes events naming the request in their payload, or the removal is also emitted on the request | PR 7's session (history read) | PR 7 | open |
| F4 | Add Suggested Categories works only while there are none, and 8099's five are on staging and production. PR 7 must take them out with a **reference** seed (it runs on production too) with a guarded DELETE, after its staging seed removes Home's rows that point at them; a staging seed alone leaves production blocked | PR 7's session | PR 7 | open |

---

## 5 · The PR body

One branch, one PR for all of M8. Each session updates the lines for its part and leaves the
rest. Title: `feat(expenses): M8 Expenses & Budget Control`.

```markdown
## What this changes

M8 Expenses & Budget Control, built to `docs/handoff/m8-expenses.md` (decisions §2) and
`docs/guides/expenses.md`, checked against `docs/handoff/m8-expenses-audit.md`.

- **PR 1 and PR 2** (merged as #74): the design, migration 8010, seed 8100, the contract.
- **PR 3 · Requests and categories:** `/expenses/mine` (New Request, Edit, Send Request, Send Again,
  Cancel), `/expenses`, `/expenses/approvals` and its summary, Withdraw; `/expense-categories`
  with Add Suggested Categories; Send Back withdraws the approval and Send Again opens a new one;
  invoices bound through `vault.claim()`; search; AI reads and cards.
- **PR 4 · Requisitions and disbursements:** Create Requisition, the CEO's Remove and decision;
  Record Disbursement with Reference Missing and Add Reference; search; AI cards.
- **PR 5 · Budgets and projects:** _to fill_
- **PR 6 · AI features:** _to fill_
- **PR 7 · Screens, staging seed, User Guide:** _to fill_
- **PR 8 · Release check:** _to fill_

## Screens and items

#56 My Requests, #57 Approvals, #58 Requisitions, #59 Disbursements, #60 Budgets,
#61 Categories, and Projects (row added in PR 7).

## Audit

Decisions 1 to 17 checked in `docs/handoff/m8-expenses-audit.md` §1. Open findings: F1, F2, F3, F4.

## Checklist

- [ ] `npm run ci` is green on the PR
- [ ] `docs/PROGRESS.md`: rows ticked as each screen runs on the real API, a dated note per part
- [ ] `docs/guides/expenses.md` matches what was built, with Change log lines
- [ ] User Guide `docs/manual/expenses.md` and its pictures (PR 7)
- [ ] New files are on the README map
- [ ] Every list pages at 25 through `shared/http/paged.js`
- [ ] Contract changed first; `gen:contract` and `gen:ai-catalogue` run
- [ ] Desktop and mobile both done (PR 7)
- [ ] Screen text in three tiers; §10 of the guide followed (PR 7)
- [ ] Forms only from the form system (PR 7)
- [ ] Shared components only from `@mycity/ui`; `ListDetail`'s modal layout added there (PR 7)
- [ ] Styling tokens only (PR 7)

## Native app feel (frontend changes)

_PR 7 fills this: phone, desktop, text._

## Exemptions

_None expected once PR 7 lands; until then:_
User-guide-unchanged: no screen changed yet; the Expenses chapter comes with PR 7
```

---

## 6 · Audit log

- 05/11/2026 · AJ · PR 1 to PR 4 audited against decisions 1 to 17 (planning session): 1 to 6, 11 to 13 and 15 hold in the code; 7, 8, 9, 10, 14, 16 and 17 wait for PR 5 to PR 7 as planned. `vault.claim()` checked: only the uploader binds a file, once, in the save's transaction, with an audit event. Findings F1 to F4 opened.
- 05/11/2026 · AJ · PR 3 and PR 4 run on Linux, Node 22, PostgreSQL 16 with pgvector and Redis: backend 173 suites, 3,162 tests green (the new `expenses.test.js` and `ai-actions-expenses.test.js` included); every gate green, ai-awareness (103 actions, 0 gaps), capabilities, contract-columns, migrations, progress, guides, user-guide and components among them. Not run there: the four Chromium screen gates (a11y, five-second, native-ui, two-shells); no screen moved, CI runs them.
