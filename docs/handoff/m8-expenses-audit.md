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
| Last audited | 05/11/2026, PR 1 to PR 8 and the review's F5 to F25 |

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
| 2 | Bank reference asked for, not required | `POST /disbursements` answers 422 `REFERENCE_REQUIRED` on `payment_reference` without a reference, a receipt or `confirm_without_reference: true`; saved without one shows Reference Missing; `PATCH /disbursements/:id` adds it; no trigger on `disbursement`; the screen asks **Save Without Reference?**, No puts focus on **Bank Reference** (PR 7, F12) | PR 4, 7 | ✓ (F12 closed) |
| 3 | Requisitions stay, first tab; the CEO decides the whole, may remove one first | Create Requisition takes 1 to 25 `approved` requests, each `in_requisition`; `POST /requisitions/:id/remove` only by the stage's approver, with a reason, back to `approved`; approve → every request `authorised`; reject → every request `approved` and out; emptied → `cancelled`; the removal is on the request's own history (§4 F3) | PR 4, 7 | ✓ (F3 closed) |
| 4 | Every stage can Reject or Send Back | Approvals' Approve, Send Back, Reject through `/workflow/instances/:id/...`; Send Back → `sent_back`, approval withdrawn, Send Again opens a new one (guide §6.1 rule 6); the CEO rejects a requisition with a reason | PR 3, 4 | ✓ |
| 5 | Each request paid to its own payee | one `disbursement` per request (unique index); recipient and bank copied from the request; the requisition holds no payee | PR 4 | ✓ |
| 6 | Payee types Staff, Vendor, Partner, Dedicated Task Team (DTT) | contract `PayeeType` and the CHECK say `staff`, `vendor`, `partner`, `task_team`; label **Dedicated Task Team (DTT)** (8100); Use My Company Account only for `staff`, copying the employee record's bank at sending; the form clears it when Payee leaves Staff (F11) | PR 2, 3, 7 | ✓ (F11 closed) |
| 7 | Department budgets for a year by category, editable, logged; over its remaining is flagged before approval; projects have optional budgets | `budget` per department per year, `budget_line` per category; every save an event with before and after (Budget History); committed and spent recounted from the requests; `over_budget` true before each approval decides (§4 F1, F2); the recount locks its lines first (F6); one per department per year held by migration 8020 (F7); a line only uncounted requests name taken away (F16); the owner the head now (F17); the monthly report's budgets as `/budgets` reads them (F18) | PR 5 | ✓ (F1, F2, F6, F7, F16 to F18 closed) |
| 8 | Tabs: Requisitions, Approvals, Disbursements, Projects, Budgets, Categories; My Requests in ESS | `app/src/features/expenses/index.tsx` order; ESS has My Requests; route map's `expense` self link points at ESS; the Projects row via `npm run new:screen` | PR 7 | ✓ |
| 9 | F31 amended: Expenses records open in the modal on desktop too | `ListDetail` has a modal layout in `packages/ui` (test, gallery page); every Expenses list uses it, Approved Requests and Waiting to Pay included (F22); gate 11 still taps the phone rows | PR 7 | ✓ (F22 closed) |
| 10 | Categories under A26: Add Suggested Categories, no reference seed | `POST /expense-categories/suggested` only while there are none, the twelve of guide §6.7; 8099's five taken out by a **reference** seed with a guarded DELETE so production is cleared too (§4 F4) | PR 3, 7 | ✓ (F4 closed) |
| 11 | Nothing imported from the expenditure sheet | no importer for expenses; the sheet shapes `seeds/staging/80_expenses.js` only | all | ✓ |
| 12 | One category and one project per request; lines are description, quantity, unit price | line amount = quantity × unit price through `shared/money`; request amount = their sum; 1 to 25 lines; one invoice per request | PR 2, 3 | ✓ |
| 13 | Requester cancels until Operations & People approve; then only `expenses.finance` withdraws, until paid | `CANCELLABLE` = draft, sent_back, submitted; `WITHDRAWABLE` = approved, in_requisition, authorised; withdraw needs a reason and the capability; one in a requisition leaves it and the total is counted again; on screen `OwnActions` shows Cancel Request (draft, sent back, sent) or Withdraw (approved, in a requisition, authorised) by status, on My Requests, Requisitions, Disbursements and a project's or a requisition's request, each after a confirm (F5, F13) | PR 3, 7 | ✓ (F5, F13 closed) |
| 14 | AI: invoice reading (Image Reading), duplicate check (Default), category suggestion (Default), all suggestions a person accepts | each registered in `services/ai/actions.js` with its job and `chosen_by: "AJ"`; run outside transactions; nothing kept until the person accepts; no personal data to DeepSeek; files only for `personal_data: true` (F19); Gemini reads files natively, a refused file Unreadable (F9); Check Duplicate given only the duplicates the reader may open (F8), its reason behind Details (F24) | PR 6 | ✓ (F8, F9, F19, F24 closed) |
| 15 | `expenses.finance` for grouping, disbursing, budgets, categories | `requireCapability("expenses.finance")` on requisitions (list, get, create), disbursements (all), category writes, withdraw, budget writes; the CEO passes; held by Operations & People and the Implementation Team | PR 2 to 5 | ✓ |
| 16 | Home's Budget Used counts spent and committed | `src/modules/dashboard/sources/budgets.source.js` sums both; its `owes` item cleared; Home's tests and `docs/guides/home.md` updated | PR 5 | ✓ |
| 17 | New Request from a project | Expenses · Projects offers New Request with the project filled, the same form and service; the tab is open to its read (`expenses` view, scope all), Set Budget to `expenses.finance`, its requests open (F10) | PR 7 | ✓ (F10 closed) |

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
| F1 | Over Budget is measured against the request's **category line**; decision 7 and MILESTONES §13 say the **department's** remaining budget. Recommendation: the line, and the department's total shown beside it; write it into guide §6.6 and MILESTONES §13 as one rule | AJ | PR 5 | closed 05/11/2026: AJ chose the line with the department's remaining beside it (`department_remaining`); guide §6.6 rule 3, MILESTONES §13 |
| F2 | `over_budget` is set once, when the request is sent; decision 7 says flagged before approval, so a budget changed meanwhile shows a stale flag. Recount it before each stage decides (PR 5's recount) and on Send Again | PR 5's session | PR 5 | closed 05/11/2026: worked out again for every `submitted` request on a line whenever the line moves (a request on it approved, withdrawn or paid; the budget set or changed), and on Send Again; guide §6.6 rule 3 |
| F3 | Removing a request from a requisition is an event on the **requisition** (`requisition.request_removed`); a request's own history, read by its entity, would not show it. Either the history read also takes events naming the request in their payload, or the removal is also emitted on the request | PR 7's session (history read) | PR 7 | closed 05/11/2026: `GET /expenses/:id/history` reads the request's own events and its requisition's and disbursement's whose payload names it; guide §3 step 8 |
| F4 | Add Suggested Categories works only while there are none, and 8099's five are on staging and production. PR 7 must take them out with a **reference** seed (it runs on production too) with a guarded DELETE, after its staging seed removes Home's rows that point at them; a staging seed alone leaves production blocked | PR 7's session | PR 7 | closed 05/11/2026: `seeds/reference/8101_seed_expense_categories_out.sql` (guarded DELETE, every environment) and `seeds/staging/80_expenses.js` after `removeHomeStagingRows`; guide §4 |
| F5 | Blocker · decision 13: Withdraw was on no screen; `OwnActions` always called `/mine/:id/cancel`, so an approved request of an Operations & People member showed Cancel Request (409), and requests opened on Requisitions, Disbursements and a project showed no actions | AJ (review) | review 05/11/2026 | closed 05/11/2026: `OwnActions` picks Cancel Request (draft, sent back, sent) or **Withdraw** (approved, in a requisition, authorised) by status; `WithdrawForm` asks a **Reason** and calls `POST /expenses/:id/withdraw`; on My Requests, Requisitions' Approved Requests and a requisition's requests, Disbursements' Waiting to Pay and a project's requests; manual task Withdraw an approved request; `Expenses.test.tsx` |
| F6 | Decision 7 · the recount was one UPDATE with `SET = (SELECT sum …)`: two moves on one line at once could drop one request's amount under READ COMMITTED | AJ (review) | review 05/11/2026 | closed 05/11/2026: `budgets.repo recount()` locks its lines in id order in a statement of its own, then counts; `budgets.test.js` runs two parallel settles on one line (fails without the lock: 2,000 of 3,000 counted) |
| F7 | Decision 7 · one budget per department per year checked without a lock, no unique constraint | AJ (review) | review 05/11/2026 | closed 05/11/2026: migration `8020_budget_one_per_year.sql` (a later open duplicate closed, then a unique index on `(department_id, starts_on)` for every budget but a closed one); `insertOnce` answers 409 `BUDGET_EXISTS` on the index; `budgets.test.js` presses New Budget twice at once: one 201, one 409, one row |
| F8 | Scope · Possible Duplicates returned other requests' number, purpose and amount to any reader, and Check Duplicate sent them to the model | AJ (review) | review 05/11/2026 | closed 05/11/2026: `expenses.service readableDuplicates()` with `getFor`'s test (own, scope all, `scope_ids`, or named on the pending stage); the rest a count, `possible_duplicates_hidden` (contract); Check Duplicate given only those named; `expenses.test.js` two requesters in two departments paying one vendor |
| F9 | Decision 14 · PDFs went to Gemini's OpenAI-compatible endpoint as `image_url` data URLs, which may refuse them (AI_VENDOR_CONFIG 503) | AJ (review) | review 05/11/2026 | closed 05/11/2026: `vendors/gemini.js complete()` sends a turn with files through the native `generateContent` with `inline_data`; a refused file (`AI_VENDOR_CONFIG`, `AI_FILE_TOO_LARGE`) is Read Invoice's `unreadable`; `ai-control.md` change log; unit test in `ai-files.test.js`, integration in `expenses-ai.test.js`. Not run: a real PDF through Gemini on staging |
| F10 | Decision 17, guide §2 · Projects gated the whole tab on `expenses.finance` | AJ (review) | review 05/11/2026 | closed 05/11/2026: the tab reads `/budgets/projects` (its own `expenses` view at scope all) and shows Not Open to You on a 403; Set Budget only to `expenses.finance`; a project's requests open the request; `Expenses.test.tsx`. The manual's Projects tasks keep their needs: the tab is shown to whoever may read it (F14) |
| F11 | Decision 6 · Payee from Staff to another left `uses_profile_account` true | AJ (review) | review 05/11/2026 | closed 05/11/2026: the Payee select clears it when the type is not staff; `Expenses.test.tsx` |
| F12 | Decision 2 · No on Save Without Reference? left focus on the button | AJ (review) | review 05/11/2026 | closed 05/11/2026: No puts focus on **Bank Reference**; `Expenses.test.tsx` |
| F13 | FRONTEND_GUIDE §8.4 · Cancel Request, Deactivate and Remove Budget acted without a confirm | AJ (review) | review 05/11/2026 | closed 05/11/2026: `useConfirm` before Cancel Request, Withdraw, Deactivate and Remove Budget; `Expenses.test.tsx` (Withdraw) |
| F14 | User Guide · Description read Item 1; Add Line on the Budget form is Add Category; Record Disbursement opens from the row; Deactivate and Save Category unnamed; Withdraw missing | AJ (review) | review 05/11/2026 | closed 05/11/2026: `docs/manual/expenses.md` fixed, Withdraw an approved request added, the confirms named; pictures retaken (`guide:shots --stale`, New Request, My Requests). The Projects tasks' `cap expenses.finance` not added: after F10 the tab is open to its read, and only Set Budget asks the capability, which its task already needs |
| F15 | PROGRESS · #56, #59 and #104 Built while F5 and F10 left guide §2 unbuilt | AJ (review) | review 05/11/2026 | closed 05/11/2026: F5 and F10 fixed in this change, so the rows stay Built; the PROGRESS note says so |
| F16 | A line any request ever named could not be deleted | AJ (review) | review 05/11/2026 | closed 05/11/2026: refused (set to 0) only when a counted request (sent to paid) names it; the rest let go of it (`expenses.service detachLineIn`); `budgets.test.js` |
| F17 | A budget's owner was the head at creation; scope and Edit Budget's notice went stale | AJ (review) | review 05/11/2026 | closed 05/11/2026: the budget reads `COALESCE(department.head_employee_id, owner_id)` for scope, the owner shown and the notice; `budgets.test.js` |
| F18 | The monthly report's budget columns ignored status, NGN and the reader's budget scope | AJ (review) | review 05/11/2026 | closed 05/11/2026: `budgets.variance` reads approved NGN budgets within the reader's scope on the department's head; `budgets.test.js` |
| F19 | `assertFiles` checked only the Image Reading job | AJ (review) | review 05/11/2026 | closed 05/11/2026: also `personal_data === true`; `ai-files.test.js` |
| F20 | The CEO's requisition decision through the AI untested; RequisitionRemove had no stated reason; no AI monthly-cap test | AJ (review) | review 05/11/2026 | closed 05/11/2026: `ai-actions-expenses.test.js` approves a requisition as the CEO through `approvals.decide` after Confirm It's You; evaluation case `card.requisition-approve` (`waiting_requisition`); `AI_CAP_REACHED` answers `limit` on Read Invoice and Suggest Category (`expenses-ai.test.js`). RequisitionRemove's reason is in `requisitions.ai.js` and guide §9: gate 23 keeps `not_offered` for create and edit schemas, so it cannot hold it |
| F21 | KPI cards: Approved This Month and Waiting to Pay opened nothing; Disbursed This Year opened every disbursed request | AJ (review) | review 05/11/2026 | closed 05/11/2026: `ExpenseListQuery` gains `disbursed_from` and `approved_by_me_from`; Approved This Month, Waiting to Pay and Disbursed This Year open their own requests; `expenses.test.js`, `Expenses.test.tsx` |
| F22 | Approved Requests opened a request with `modal.open`, not `ListDetail layout="modal"` (F31) | AJ (review) | review 05/11/2026 | closed 05/11/2026: Approved Requests and Waiting to Pay are `ListDetail layout="modal"`; `Expenses.test.tsx` |
| F23 | The empty remove cell left a blank row on a phone with one line | AJ (review) | review 05/11/2026 | closed 05/11/2026: the cell renders only with more than one line; `Expenses.test.tsx`; New Request's picture retaken |
| F24 | Check Duplicate's explanation showed open at any length | AJ (review) | review 05/11/2026 | closed 05/11/2026: the verdict open in one line, the reason cut to one sentence of 20 words behind Details |
| F25 | Tidy-ups | AJ (review) | review 05/11/2026 | closed 05/11/2026: `80_expenses.js` deletes with 8101's guard (code, name, no description); `blockOf` above `toAnthropic`'s JSDoc; rule numbers (§6.6 rule 7 in `budgets.service.js` and the scheduler, rule 6 in `projects.service.js`); guide §6.6 rule 7 no longer cites decision 16; `tiles/finance.js` says used; §5's PR 7 line |

---

## 5 · The PR body

One branch, one PR for all of M8. Each session updates the lines for its part and leaves the
rest. Title: `feat(expenses): M8 Expenses & Budget Control`.

```markdown
## What this changes

M8 Expenses & Budget Control, PR 3 to PR 8 of `docs/handoff/m8-expenses.md` (decisions §2),
built to `docs/guides/expenses.md` and checked against `docs/handoff/m8-expenses-audit.md`.
PR 1 and PR 2 (the design, migration 8010, seed 8100, the contract) merged as #74.

- **PR 3 · Requests and categories:** `/expenses/mine` (New Request, Edit, Send Request, Send Again,
  Cancel), `/expenses`, `/expenses/approvals` and its summary, Withdraw; `/expense-categories`
  with Add Suggested Categories; Send Back withdraws the approval and Send Again opens a new one;
  invoices bound through `vault.claim()`; search; AI reads and cards.
- **PR 4 · Requisitions and disbursements:** Create Requisition, the CEO's Remove and decision;
  Record Disbursement with Reference Missing and Add Reference; search; AI cards.
- **PR 5 · Budgets and projects:** `/budgets` (New Budget, Edit Budget, Budget History) and
  `/budgets/projects` with Set Budget; committed and spent recounted from the requests as one moves;
  Over Budget on the category line with the department's remaining beside it; the
  `budget-threshold` job; the Monthly Expenses report on Home's runner; Home's Budget Used on
  committed and spent; search; AI reads and the New Budget, Edit Budget and Set Budget cards.
- **PR 6 · AI features:** Read Invoice (Image Reading), Suggest Category and Check Duplicate
  (Default), each on the person's press and kept nowhere; `complete()` takes files for Image
  Reading; a request's possible duplicates from the database.
- **PR 7 · Screens, staging seed, User Guide:** a request's history with the CEO's removal
  (`GET /expenses/:id/history`); 8099's categories out (reference seed 8101) and the staging seed
  `80_expenses.js` on the Implementation Team's accounts, Home's expense rows taken away;
  `ListDetail layout="modal"` in `packages/ui`. Every Expenses screen on the contract: My Requests
  in ESS, the tabs Requisitions, Approvals, Disbursements, Projects (new, #104), Budgets,
  Categories; the line-item form with payee types, Use My Company Account, the invoice with Read
  Invoice and Suggest Category; Over Budget and Possible Duplicate with Check Duplicate; Save
  Without Reference?, Reference Missing and Add Reference; KPI cards opening their records; Add
  Suggested Categories; New Request from a project. The mock on the contract. User Guide
  `docs/manual/expenses.md` and its pictures.
- **Review fixes (audit F5 to F25):** Withdraw wherever an `expenses.finance` holder opens an
  approved request, Cancel Request until then, each after a confirm; Expenses · Projects on its
  read, Set Budget on the capability; the recount locks its lines; one budget per department per
  year (migration 8020); the owner the head now; a line only uncounted requests name taken away;
  the report's budgets as `/budgets` reads them; Possible Duplicates only to who may open them;
  Read Invoice on Gemini's native file reading, a refused file Unreadable; files only for personal
  data actions; the KPI cards opening their own requests; the CEO's requisition through
  `approvals.decide` tested and evaluated; the manual and its pictures.
- **PR 8 · Release check:** the evaluation set gains a read per role of guide §8 and a refused
  budget card; the access matrix and the cards end to end green; no M8 form on
  `ai-forms-gaps.json`; no stale picture; no empty M8 file.

Migrations: `8020_budget_one_per_year.sql` (new). Reference seed: `8101_seed_expense_categories_out.sql`
(DESTRUCTIVE, guarded). Staging seed: `80_expenses.js`.

## Screens and items

#56 My Requests, #57 Approvals, #58 Requisitions, #59 Disbursements, #60 Budgets,
#61 Categories, #104 Projects: all Built.

## Audit

Decisions 1 to 17 checked in `docs/handoff/m8-expenses-audit.md` §1; findings F1 to F25 closed
(§4). Open findings: none. Not verified until staging: `scripts/ai/eval-assistant.js` with a
provider (`--only=expenses`, `--only=card.`), and a real PDF invoice through Read Invoice on
Gemini (F9). The walkthrough for the staging test is a separate doc.

## Checklist

- [x] `npm run ci` green locally (`--serial`), but for `packages/ui`'s CityShowcase clock test,
      which fails on `main` too
- [x] `docs/PROGRESS.md`: rows ticked as each screen runs on the real API, a dated note per part
- [x] `docs/guides/expenses.md` matches what was built, with Change log lines
- [x] User Guide `docs/manual/expenses.md` and its pictures
- [x] New files are on the README map
- [x] Every list pages at 25 through `shared/http/paged.js`
- [x] Contract changed first; `gen:contract` and `gen:ai-catalogue` run
- [x] Desktop and mobile both done
- [x] Screen text in three tiers; §10 of the guide followed
- [x] Forms only from the form system
- [x] Shared components only from `@mycity/ui`; `ListDetail`'s modal layout added there
- [x] Styling tokens only

## Native app feel (frontend changes)

- **Phone:** every list is cards, not a table; a tapped card opens its record in the bottom sheet
  (`ListDetail layout="modal"`) and nothing opens until one is tapped; KPI cards two to a row; New
  Request and every form open as a full sheet with their buttons in the footer; Create Requisition
  shows once a request is ticked; Approve, Send Back, Reject and Withdraw sit in the request's
  sheet; 44 px targets; the Expenses tabs scroll sideways and My Requests is an ESS tab under
  Self-Service.
- **Desktop:** the lists take the full width and a record opens in the centred dialog (F31 as
  amended for Expenses), never beside or below its list; tables with sortable columns, 25 a page.
- **Text:** tier 1 open as guide §10.1 lists; help terms on Use My Company Account, Stage, Over
  Budget, Possible Duplicate, Bank Reference, Committed, Remaining and Type; Check Duplicate's
  reason behind Details; no explainer cards, footnotes or modal footer text; the screen gates
  (8, 11, 21, axe) pass.

## Exemptions

None.
```

---

## 6 · Audit log

- 05/11/2026 · AJ · PR 8, the release check: decisions 1 to 17 hold as §1 says, F1 to F25 closed. Every AI card of guide §9 is drawn and pressed end to end in `ai-actions-expenses.test.js` (the CEO's requisition through `approvals.decide` included), and `ai-matrix.test.js` checks every Expenses read and action against every role; the evaluation set holds a case per card and per role, to run on staging with a provider (not run here: no key). `ai-forms-gaps.json` holds no M8 form. `npm run ci -- --serial` green but for the CityShowcase clock test (§3). Open on staging: the evaluation run and a real PDF through Read Invoice on Gemini (F9).
- 05/11/2026 · AJ · The review's F5 to F25 fixed and recorded in §4, each with a test; §1's decisions 2, 6, 7, 9, 13, 14 and 17 rechecked with them. Withdraw is on every screen an `expenses.finance` holder opens an approved request; the recount's lock fails its test without it; migration 8020 runs on the test database's rebuild. Not run: a real PDF through Gemini on staging (F9's unit test covers the request shape).
- 05/11/2026 · AJ · PR 7's screens audited: decisions 2, 6, 8, 9, 14 and 17 hold on screen (Save Without Reference? returns to the reference on Add Reference; the payee types read Staff, Vendor, Partner, Dedicated Task Team (DTT); the tab order and My Requests in ESS, `expense`'s self link at ESS; `layout="modal"` on every Expenses list with a record; Read Invoice and Suggest Category fill the form for the person to check, nothing saved until they press; New Request on a project with the project filled). §2's screen rules: components only from `@mycity/ui`, tokens only, `useContractForm` with the contract's schemas, the screen gates five-second, two-shells, native-ui and axe green over the crawled Expenses screens. No finding open.
- 05/11/2026 · AJ · PR 7's backend half audited: F3 and F4 closed; 8101 runs UP, DOWN, UP clean (gate 4) and is marked DESTRUCTIVE with its guard; `80_expenses.js` writes only through the services (categories, budgets, projects, expenses, requisitions, disbursements, workflow decide), raises on the Implementation department alone, and runs twice to the same counts. Decision 9's `ListDetail` modal layout is in `packages/ui` with its test and gallery page; the screens do not use it yet. Not yet true: decisions 2, 6, 8, 9, 14 and 17 on screen (§1 ⏳), §2's screen rows.
- 05/11/2026 · AJ · PR 5 and PR 6 audited: decisions 1, 7, 14 (API), 15 and 16 hold in the code. `grep -rni threshold` over the five modules finds only the budget-threshold sweep (`budgets.service` `THRESHOLD_PERCENT`, the job) and no routing rule. Every new list pages through `pageQuery`; the three `LIMIT`s are marked batches (the threshold sweep, a card's 25 budget names, a request's five possible duplicates, a report's groups). Money through `shared/money`, `budget` numbering through `numbering.allocate`. The three AI actions are registered with their jobs and `chosen_by: "AJ"`, run on a press outside any transaction, and keep nothing; Check Duplicate sends no requester, payee or bank detail. F1 and F2 closed. Not yet true and due in PR 7: §2's screen rows, F3, F4.

- 05/11/2026 · AJ · PR 1 to PR 4 audited against decisions 1 to 17 (planning session): 1 to 6, 11 to 13 and 15 hold in the code; 7, 8, 9, 10, 14, 16 and 17 wait for PR 5 to PR 7 as planned. `vault.claim()` checked: only the uploader binds a file, once, in the save's transaction, with an audit event. Findings F1 to F4 opened.
- 05/11/2026 · AJ · PR 3 and PR 4 run on Linux, Node 22, PostgreSQL 16 with pgvector and Redis: backend 173 suites, 3,162 tests green (the new `expenses.test.js` and `ai-actions-expenses.test.js` included); every gate green, ai-awareness (103 actions, 0 gaps), capabilities, contract-columns, migrations, progress, guides, user-guide and components among them. Not run there: the four Chromium screen gates (a11y, five-second, native-ui, two-shells); no screen moved, CI runs them.
