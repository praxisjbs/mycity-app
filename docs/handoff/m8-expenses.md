# M8 Expenses & Budget Control · Build Handoff

**Start here if you are continuing this work.** This file is self-contained: what the 04/11/2026
Modules Review asked for, the decisions AJ took (do not ask them again), the eight pull requests
with their checklist, and a dated log. The design itself is `docs/guides/expenses.md`; this file is
the build plan and its log.

| | |
|---|---|
| Branch | `m8/expenses` (PR 1 to PR 3); PR 4 to PR 8 and the review's fixes on `m8/expenses-requests` (AJ kept the one branch, 05/11/2026) |
| Pull request | not opened yet |
| Owner | AJ (Adole Jerome); every M8 decision is AJ's (TB, 04/11/2026) |
| Type | Full stack (CLAUDE.md step 1) |
| Started | 04/11/2026 |

---

## 0 · How to continue

**Before finishing any part, check it against `docs/handoff/m8-expenses-audit.md`** (each decision's
check, the open findings, the one PR body), and update it.

1. `git fetch origin && git checkout m8/expenses && git rebase origin/main`.
2. Read this file in full, then `docs/guides/expenses.md`, then what CLAUDE.md step 2 asks for
   full-stack work, and `docs/MyCity-ERP-Documents/MILESTONES.md` §13 as amended.
3. Take the first unticked item in §4. Build it, run its checks, tick it here with the date, add a
   line to §6.
4. Never re-open §2.

---

## 1 · What was asked

From the Modules Review of 04/11/2026 (TB with AJ; the transcript is the meeting's Gemini notes):

1. Requests route line manager, then Operations & People (straight to Operations & People when the
   requester is a line manager), then the CEO, read from Settings · Approvals.
2. A request keeps the approval flow it was created with (confirmed as correct).
3. A request's detail opens in a pop-up modal on desktop and on a phone; the list takes the full
   height of the screen.
4. The KPI cards with records behind them open their list in a pop-up (the ESS rule).
5. An invoice is uploaded on the request and opens as a PDF for the approvers; categories are set
   up on the last tab; no thresholds.
6. A request has several line items instead of one description.
7. Requisitions stay: Operations & People batch approved requests into one for the CEO.
8. Every request carries its payment details: Use My Company Account, or the bank, account name and
   amount entered.
9. A Projects tab, with a project picker over the Workspace projects, to track spend per project.
10. Disbursements need the bank transaction ID, but without it the screen warns and saves on yes.
11. The chart on Disbursements goes.
12. Every form works in the AI chat, and the Playwright user-guide pictures are retaken: both are
    release gates.

TB shared `MyCityApp Expenditure Sheet` (tabs 2025, 2026, Projects, Sheet4) as the picture of how
MyCity tracks spend today. It is a reference, not data to load (decision 11).

**Read the transcript, not Gemini's summary.** Two of the summary's lines contradict what was said
and must not reopen §2: "Requisitions merge directly into standard requests" (TB asked why
requisitions exist at 16:41, then, with the sheet open, said Operations "makes a batch of request
and put within a requisition" at 22:47 and "we should even have requisitions before approvals" at
27:39; decision 3), and "remove the general budget tab" (TB said "we are taking off budgets", then
"this is quite important as well… we can leave it but we need to add projects" at 25:17; decision 7).

---

## 2 · AJ's decisions (04/11/2026, binding)

1. **No approval threshold.** Every request takes the same chain whatever its amount. The category
   carries no threshold; MILESTONES §13's per-line threshold flag is withdrawn.
2. **The bank reference is asked for, not required.** Save Without Reference? on the screen; a
   disbursement saved without one is flagged Reference Missing with Add Reference, and counted on a
   KPI card. No database trigger.
3. **Requisitions stay**, ordered first among the Expenses tabs. The CEO approves or rejects the
   requisition as a whole and may remove a single request first, which returns to Operations &
   People with its history.
4. **Every stage can Reject or Send Back.** Reject ends the request; Send Back returns it to the
   requester to edit and send again.
5. **Each request is paid to its own payee**, with its own transaction reference. The requisition is
   the CEO's approval batch only.
6. **Payee types**: Staff (Use My Company Account), Vendor, Partner, Dedicated Task Team (DTT; confirmed
   05/11/2026). Its code is `task_team`.
7. **Department budgets stay**: set at the start of the year by category, editable, every change
   logged. A request over its department's remaining budget is flagged before approval. A project
   has an optional budget too.
8. **Tabs**: Requisitions, Approvals, Disbursements, Projects, Budgets, Categories. My Requests is
   an ESS tab.
9. **F31 is amended for Expenses**: a request, a requisition and a disbursement open in the shared
   Modal on desktop too (the centred dialog), a bottom sheet on a phone as before.
10. **Categories under A26**: no reference seed. An Add Suggested Categories button on the empty
    Categories tab creates the twelve defaults (guide §6.7) in one press; MyCity then adds, edits
    and deactivates its own. The five 8099 seeded are taken out with M8's staging seed.
11. **Nothing is imported** from the expenditure sheet: its rows have no transaction references, its
    Category column is the payee type, departments are typed by hand, and salaries are 72% of the
    2026 tab's amount (₦17.29M of ₦24.06M, five monthly rows; corrected 05/11/2026, it read 36%)
    and belong to payroll (M6). The sheet stays MyCity's archive and shapes the staging demo rows.
12. **One category and one project per request**, chosen on the request; lines carry description,
    quantity and unit price. The request's total is the sum of its lines; one invoice covers it.
13. **Cancelling**: the requester cancels until Operations & People approve; after that only an
    `expenses.finance` holder withdraws it, until it is paid.
14. **AI**: invoice reading on Image Reading, the duplicate check on Default, and a category
    suggestion from the purpose and lines on Default, all three suggestions a person accepts (PR 6;
    the category suggestion decided 05/11/2026).
15. **The `expenses.finance` capability** decides who groups requisitions, records disbursements,
    sets budgets and manages categories: Operations & People and the CEO by default.
16. **Home's Budget Used counts spent and committed** (05/11/2026), as the Budgets tab's Remaining
    does, so Home warns before the money leaves.
17. **A request is raised from its project too** (05/11/2026, from TB at 26:29 of the review: whoever
    manages a project sets up the request "within that project"). Expenses · Projects offers New
    Request with the project filled; it is New Request's own form and service, the project still
    changeable. PR 7.

---

## 3 · The pull requests

| PR | What | Depends on |
|---|---|---|
| 1 | Docs: this file, `docs/guides/expenses.md`, MILESTONES §13 and §18, F31's amendment, PROGRESS | nothing |
| 2 | Schema and contract: `8010_expenses_chain.sql`, `8100_seed_expense_flows.sql`, the five contract schemas, `schemes.js`, the two workflow DEFAULTS, DATABASE_SCHEMA, Home's two sources | 1 |
| 3 | Categories and requests backend: `expense_categories` and `expenses` modules, the capability, ESS routes, the approval and its settle handler, notifications, search, AI manifests and cards | 2 |
| 4 | Requisitions and disbursements backend | 3 |
| 5 | Budgets and projects backend, the recount, the budget-threshold job, the monthly report | 3 |
| 6 | AI features: invoice reading, duplicate check, category suggestion | 3 |
| 7 | Frontend on the real API, the Projects tab and its PROGRESS row (`npm run new:screen`), `ListDetail`'s modal layout for F31's amendment, the staging seed (taking out Home's forward rows and the five 8099 categories), the User Guide chapter and its pictures | 4, 5 |
| 8 | Release check: every AI card end to end, the forms and screenshot gates, `npm run ci`, empty stubs deleted, PROGRESS ticked | 7 |

---

## 4 · Checklist

- [x] PR 1 · guide, handoff, MILESTONES §13 and §18, F31 amended, PROGRESS (04/11/2026)
- [x] PR 2 · 8010 schema (04/11/2026)
- [x] PR 2 · 8100 seed: flows, statuses, numbering, `expenses.finance` (04/11/2026)
- [x] PR 2 · contract schemas and `TABLES`, `gen:contract` (04/11/2026)
- [x] PR 2 · `schemes.js` `budget`; DEFAULTS `expenses.request`, `expenses.requisition` (04/11/2026)
- [x] PR 2 · DATABASE_SCHEMA M8, Home's `expenses.source.js` and `budgets.source.js` (04/11/2026)
- [x] PR 3 · `expense_categories` module, Add Suggested Categories (05/11/2026)
- [x] PR 3 · `expenses` module: mine, list, get, approvals, submit, cancel, withdraw, settle (05/11/2026)
- [x] PR 3 · notifications, search, AI reads and cards, tests (05/11/2026)
- [x] PR 4 · requisitions, CEO removal, disbursements with Reference Missing (05/11/2026)
- [x] PR 5 · budgets, history, projects, recount, threshold job, monthly report (05/11/2026)
- [x] PR 6 · AI features (05/11/2026)
- [x] PR 7 · frontend, staging seed, User Guide chapter and pictures (05/11/2026)
  - [x] PR 7 · backend half: request history (F3), 8101 and `80_expenses.js` (F4), Home's forward rows out (05/11/2026)
  - [x] PR 7 · `ListDetail` `layout="modal"` in `packages/ui`, its test and gallery page (05/11/2026)
  - [x] PR 7 · the screens on the contract, the Projects row (#106), My Requests in ESS (05/11/2026)
  - [x] PR 7 · `docs/manual/expenses.md` and its pictures; the stale pictures retaken (05/11/2026)
- [x] Review fixes · audit F5 to F25, each with a test (05/11/2026)
- [x] PR 8 · release check (05/11/2026)
  - [x] PR 8 · every AI card of guide §9 as each role of §8: the matrix (`ai-matrix.test.js`) and the cards end to end (`ai-actions-expenses.test.js`) green; the evaluation set holds a case per card and a read per role, each listed (`eval-assistant.js --list`); run on staging with a provider before release
  - [x] PR 8 · no M8 form on `ai-forms-gaps.json` (0 gaps); no stale User Guide picture; no empty M8 file to delete
  - [x] PR 8 · PROGRESS: #56 to #61 and #106 Built (`On staging` once deployed and walked)

---

## 5 · Notes

- Running the whole suite locally needs PostgreSQL 16 with pgvector and Redis (BACKEND_GUIDE
  §8.4); without them the integration files and gate 4's round trip are skipped, and CI runs them.
- The two Home sources (`src/modules/dashboard/sources/expenses.source.js`, `budgets.source.js`)
  change in the same PR as any column they read (their `OWES` lists).

---

## 6 · Log

- 13/11/2026 · TB · Filming the M8 video (`docs/runbooks/training-videos.md`): a line may take money off (a discount, an amount already paid; migration 8030, guide §6.1 rule 1), Read Invoice reads them and the amount due (guide §9), and the staging seed's sent-back and rejected walks decide at the stage the request is at. Decision 12 stands: lines carry description, quantity and unit price; the unit price may now be below zero.
- 13/11/2026 · TB · For AJ, on `claude/keen-noether-ro2mik`: New Request on Requisitions and Approvals (the presser's own; not the other tabs; TB). Praxis AI's New Request and Add Line ask their item in one turn ("What are you paying for? How many? How much is each?"), the model's figures are read as the contract's strings (Quantity and Unit Price were refused "Expected string, received number" on staging), and a draft offers Add Another Item and Send Request, the new card `my_expenses.submit` (guide §2, §3 step 7, §9, §10). Decision 8's tabs are unchanged.
- 11/11/2026 · AJ · Milestones Review of 11/11/2026 (TB), on `m8/expenses-requests`: Category is a popover (Pick Category) with a Category Type filter and `RecordPicker` over `/expense-categories`, 25 a page; Bank is `ComboField` over the new `GET /expenses/banks` (`COMMON_BANKS` in `expenses.service.js` and every bank a request names; a bank not listed is kept as typed and offered from then on, no table); Payee Name's example is a name, not the reader's own; Open Receipt on a paid disbursement. Guide §3, §5, §6.1 rule 7, §10.1 and the change log; the manual's steps and pictures. Staff asking only from their own department was checked live at the review and holds. Next: walk it on staging before the training video.
- 06/11/2026 · TB · For AJ: merging M7 PR 2 (#80, Partnerships · Categories) renamed Expenses · Categories' ⌘K action `new_expense_category` to **New Expense Category** (`src/shared/search/actions.js`) and its screen action (`useScreenAction` in `features/expenses/index.tsx`, the phone's floating button) to match. Partnerships added a New Category of its own, ⌘K refuses a label twice, and the search coverage gate holds a screen's New action to a ⌘K label. The header button (on both shells), the modal's title, the form and `docs/manual/expenses.md` still read New Category. `expenses.md` §9 and §10.2 say so; change them back if you want another name.
- 05/11/2026 · AJ · PR 8, the release check, on `m8/expenses-requests`. The evaluation set gained eleven Expenses cases (a read per role of guide §8: an employee's own requests and never another's, a head's waiting and team requests, Operations & People's to pay, missing references and categories, the CEO's requisitions, Management's budgets and projects; a head refused a budget card) beside the card cases and the CEO's requisition decision; `eval-assistant.js` needs staging and a provider, so it is listed, not run here. The access matrix and the cards end to end green; `ai-forms-gaps.json` holds no M8 form; no stale picture; no empty M8 file. Six pictures retaken (stale after the Withdraw form's placeholder). `npm run ci -- --serial` green but for `packages/ui`'s CityShowcase clock test, which fails on `main` too (audit §3). Next: open the PR; on staging, run `node scripts/ai/eval-assistant.js --only=expenses`, `--only=card.expense`, `--only=card.budget`, `--only=card.disbursement` and `--only=card.requisition`, and read a real PDF invoice with Read Invoice (audit F9), then set the rows On staging.
- 05/11/2026 · AJ · PR 7, the screens, on `m8/expenses-requests`. `features/expenses/index.tsx` is a `switch`; Projects added with `npm run new:screen` (#106); My Requests moved into ESS after My Leave (`MyRequests.tsx`, rendered by `features/ess/index.tsx`; catalogue, access, route map, ⌘K screens and `tabVisible`, Coming Soon, the AI route); the Expenses tabs ordered Requisitions, Approvals, Disbursements, Projects, Budgets, Categories. `app/src/api/types/expenses.ts` deleted: every screen reads `contract.gen.ts`, every form is `useContractForm` with its schema, every list and record `ListDetail layout="modal"`. The New Request form (`parts.tsx`): lines, payee type with Use My Company Account, invoice upload with Read Invoice, Suggest Category; the request's modal with Over Budget, Possible Duplicate and Check Duplicate, the chain and History; Approve, Send Back, Reject on the approval's own routes; Save Without Reference? and Add Reference; KPI cards with records open their list; no Disbursements chart; Add Suggested Categories on the empty tab; New Request on a project with the project filled. `ExpenseListQuery` gained `in_flight` for My Requests' card. The mock (`api/mock/modules/expenses.ts`, `data/expenses.ts`) answers every route of guide §5 and the approval's own routes in contract shapes, modelled on `80_expenses.js`. New Category, Record Disbursement and New Budget drop `form: "none"`; ⌘K offers New Request, Create Requisition, New Budget and New Category. `docs/manual/expenses.md` written with eight pictures; the ESS chapter points at it; the stale pictures retaken. PROGRESS: #56 to #61 and #106 ticked and Built. Next: PR 8.

- 05/11/2026 · AJ · PR 7, backend half, on `m8/expenses-requests`. Built: `GET /expenses/:id/history` (the request's events and its requisition's and disbursement's that name it; audit F3 closed); `seeds/reference/8101_seed_expense_categories_out.sql` (8099's five out where nothing names them, every environment) and `seeds/staging/80_expenses.js` (Home's expense rows away first, then the twelve categories, three budgets, two projects with budgets, thirteen requests on the Implementation Team's accounts at every stage, one paid without a reference; idempotent; audit F4 closed); Home's `lib/forward-rows.js` writes no expense or budget rows; Home's seed tests run M8's seed and the build account. `ListDetail` gained `layout="modal"` (F31 as amended) with its test and gallery page. Tests: `expenses-staging-seed.test.js`, the history case in `expenses.test.js`, Home's seed tests, `ListDetail.test.tsx`. The screens are not moved: see §5 "PR 7 where it stands". PR 8 waits for them.

- 05/11/2026 · AJ · PR 6, on `m8/expenses-requests` (one branch for M8). Built: Read Invoice (`expense-invoice-read`, Image Reading; `POST /expenses/mine/invoice-reading`), Suggest Category (`expense-category-suggest`, Default; `POST /expenses/mine/category-suggestion`) and Check Duplicate (`expense-duplicate-check`, Default; `POST /expenses/:id/duplicate-check`), registered `chosen_by: "AJ"`, `personal_data: true` (never DeepSeek), each on the person's press, outside any transaction, kept nowhere, off with no provider or the month's cap spent. `services/ai/llm.service.complete()` gained `files` for an Image Reading action (data URLs in the person's turn; Claude's image and document blocks in `vendors/anthropic.js`), the one foundation change (`ai-control.md` change log). The duplicate flag is the database's: `possible_duplicates` on a request (same payee and amount within 30 days, guide §6.8); the model only compares, told nothing about who. Tests: `tests/integration/expenses-ai.test.js` with the model scripted, `tests/unit/foundation/ai-files.test.js`. Next: PR 7 puts Read Invoice, Suggest Category and Check Duplicate on the screens.
- 05/11/2026 · AJ · PR 5, on `m8/expenses-requests`. Built: the `budgets` module (`/budgets` list within scope on the department's head, one budget, New Budget, Edit Budget, Budget History from the save's event metadata, 25 a page; `/budgets/projects` and Set Budget through `projects.service.setBudget`), the recount (`budgets.recountIn`, called through `expenses.service.countIn` from settle, withdraw and paid), the `budget-threshold` scheduler and handler (90% committed and spent, once per line), the Monthly Expenses report as Home's `expenses_monthly` source (`budgets.variance`), Home's Budget Used on committed and spent with a Committed column (decision 16; `budgets.source.js` `owes` cleared of it), ⌘K for budgets, the reads `budgets.list` and `budgets.projects` and the cards `budgets.create`, `budgets.edit` (`BudgetLinesChange`) and `budgets.set_project` (`ProjectBudgetSet`) with tests and evaluation cases. Audit F1 closed (AJ: the category line, the department's remaining beside it as `department_remaining`) and F2 closed (the flag worked out again for every request still deciding whenever its line moves). A request with no budget line is now flagged. A budget saved counts requests sent before it. `GET /budgets/:id` added to guide §5. Tests: `tests/integration/budgets.test.js` and the cards in `ai-actions-expenses.test.js`. Next: PR 6.

- 05/11/2026 · AJ · Checked the docs against the Modules Review transcript and the expenditure sheet: §2 and MILESTONES §13 match the transcript; §1 now warns that Gemini's summary contradicts it on requisitions and budgets; decision 11's salaries figure corrected (72% of the 2026 tab's amount, not 36%); decision 17 added, New Request on Expenses · Projects (guide §2, §3 step 7, §10.1), from TB at 26:29.
- 05/11/2026 · AJ · PR 3 and PR 4, on `m8/expenses-requests` from `main` after #74 merged PR 1 and PR 2. Built: `expense_categories` (list, add, edit, deactivate, Add Suggested Categories only while none exist: 8099's five block it until PR 7's seed takes them out), `expenses` (`/expenses/mine` with Send Request, Edit, Send Again, Cancel; `/expenses`, `/expenses/:id` within scope or for whoever its stage names; `/expenses/approvals` and `/approvals/summary`, a route the guide gained; Withdraw), `requisitions` (Create Requisition, the CEO's Remove, an emptied one cancelled, the CEO's decision copied onto every request) and `disbursements` (Record Disbursement with `REFERENCE_REQUIRED` and `confirm_without_reference`, Add Reference, one per request). Send Back is designed into guide §6.1 rule 6: the handler withdraws the pending approval for its opener (as reviews do) and Send Again opens a new one on the flow's current version. Invoices and receipts are staged through `POST /documents` and claimed with a new `vault.claim()` (foundation.md change log). The requests are written only by `expenses.service`; requisitions and disbursements call its `*In(client, …)` moves. `over_budget` is set from a budget line when one exists, else false until PR 5. Search on all four; AI reads and eight cards (`my_expenses.create`, `.add_line`, `.edit`, `expense_categories.create`, `.edit`, `requisitions.create`, `disbursements.create`, `.add_reference`), each `form: "none: …"` until PR 7, with integration tests and evaluation cases. `requisitions.lines.js` deleted (nothing fills it). `tests/integration/ai-attacks.test.js` pay.colleague now checks the system turn only for the colleague's value, since New Request's card names `account_number` as a field. Tests: unit 11, `expenses.test.js` 13, `ai-actions-expenses.test.js` 4, the matrix, search, settings, Home's schema, documents, workflow, cards and attacks green. PROGRESS's API ticks wait for PR 7: a ticked API opens a screen on staging (`shared/delivery-plan.js`), and the screens still call their INTERIM paths. My Requests' summary type in `app/src/api/types/expenses.ts` now matches the contract (`average_turnaround_days`), as `app/src/api/endpoints.ts` must extend the generated endpoints. Next: PR 5; PR 7 moves the screens onto the contract, drops the cards' `form: "none"` for the forms' own schemas, and points the route map's `expense` self link at ESS once My Requests moves there.
- 05/11/2026 · AJ · Decided: Home's Budget Used counts spent and committed (decision 16); PR 6 builds the category suggestion on Default (decision 14).
- 05/11/2026 · AJ · DTT confirmed as Dedicated Task Team; the payee type's label in 8100, the guide and MILESTONES §13 say so.
- 04/11/2026 · AJ · PR 2: 8010 (lines, payee, invoice, project, many requests to a requisition, approvals' instances, Reference Missing, category type, project budget, statuses, indexes) and 8100 (the two flows, statuses, payee types, `expenses.finance` for Operations & People and the Implementation Team, 8099's unused `expense_request` scheme out); the five contract schemas; `budget` in `schemes.js` and the settings contract; the flows in DEFAULTS; DATABASE_SCHEMA; Home's sources' `owes`. NGN only is the contract's and the service's rule, not a CHECK, because Home's tests and sums carry other currencies. Unit 1803 and integration 1331 green against the real migrations, with the UP, DOWN, UP round trip. Next: PR 3.
- 04/11/2026 · AJ · PR 1: decisions §2 taken; guide written; MILESTONES §13 amended and §18 given the Projects tab; F31 amended for Expenses; PROGRESS note. The Projects row and tab come in PR 7 through `npm run new:screen`, after `app/src/features/expenses/index.tsx` becomes a `switch` (the script needs a `default:` case).

---

## 7 · Prompts for the remaining PRs

Paste one into a new session opened on this repository. Each also checks its work against
`docs/handoff/m8-expenses-audit.md` before it finishes, closes the findings §4 there names for it,
and updates the PR body in §5 there (one branch, one PR for all of M8). Each assumes the PRs before it are merged
to `main` (or that the session works on top of their branch). Every prompt carries the same rules:
CLAUDE.md steps 1 to 5, this handoff read first, §2 never re-opened, the guide updated before any
behaviour it describes changes, and the checklist (§4) and log (§6) ticked as you go.

Lessons from PR 1 and PR 2 that every session needs:

- Integration tests need PostgreSQL 16 **with pgvector** and Redis; `.claude/hooks/session-start.sh`
  starts them in a cloud session (install `postgresql-16-pgvector` if `vector` is missing).
- Several tests hard-code each role's capabilities and the numbering totals
  (`tests/integration/settings.test.js`, `home-schema.test.js`); a new capability or scheme updates
  them.
- `npm run gen:contract` and `npm run gen:ai-catalogue` after any contract change; never export one
  schema under two names (the catalogue then names other modules' reads after yours).
- `app/src/features/expenses/index.tsx` must become a `switch` with a `default:` before
  `npm run new:screen` will add the Projects tab.
- Known failures that are not M8's: `packages/ui` `CityShowcase` clock test fails on `main`; the
  `shell` gate fails on Windows without bash. A Windows `npm run ci` with every group at once times
  out frontend tests; use `-- --serial`.

### PR 3 · Categories and requests backend

> This is a backend change to M8 Expenses (branch `m8/expenses-requests`). Read
> `docs/handoff/m8-expenses.md` in full, then `docs/guides/expenses.md`, then what CLAUDE.md step 2
> asks for backend work (BACKEND_GUIDE in full; `src/modules/leave/` is the pattern for a request
> with an approval). Build PR 3 of the handoff: the `expense_categories` module (list, create, edit,
> deactivate; the twelve defaults of guide §6.7 as one constant; `POST /expense-categories/suggested`
> only while there are none) and the `expenses` module (`/expenses/mine` list, summary, create with
> `submit`, edit while draft or sent back, submit, cancel; `/expenses` list and get within scope;
> `/expenses/approvals`; withdraw with `expenses.finance`). A request's lines are written by the
> service (line amount = quantity × unit price via `shared/money`; request amount = their sum); Use
> My Company Account copies the bank details from the employee record at sending; sending opens
> `expenses.request` in the same transaction with context `{ amount, requester_manages_people }`;
> `expenses.events.js` settles the approval's outcome onto the request (as `leave.events.js` does)
> and turns the approval's Request Changes into `sent_back`. Check first how the engine's
> `request_changes` returns an instance to its first stage and design Send Again to fit it; write
> what you chose into guide §6.1. Bank fields are masked under `employee.bank`. Add
> `expenses.search.js`, `expense_categories.search.js`, the AI manifests with reads and the New
> Request and New Category cards (gate 23: `npm run gen:ai-catalogue`, an integration test and an
> evaluation case per action), notifications per guide §7, `budget_line_id` and `over_budget` set on
> sending (budget recount is PR 5; until then `over_budget` is false when no budget line exists).
> Delete the stubs this PR leaves empty only if no later PR fills them. Unit and integration tests
> for every endpoint. Finish with `npm run ci` green, PROGRESS API ticks for #56 and #61 only if every
> endpoint they call exists, the guide's change log, the handoff ticked.

### PR 4 · Requisitions and disbursements backend

> This is a backend change to M8 Expenses (branch `m8/expenses-payouts`). Read
> `docs/handoff/m8-expenses.md` in full, then `docs/guides/expenses.md` §3 steps 4 to 6, §6.4, §6.5,
> §7, and CLAUDE.md step 2 for backend work. Build PR 4: the `requisitions` module (list and get with
> `expenses.finance`, the CEO passing; create from 1 to 25 `approved` requests, locking them and
> moving each to `in_requisition`, opening `expenses.requisition` with `{ total }`; the CEO's
> remove-a-request with a reason, which returns it to `approved` and recomputes the total, cancelling
> an emptied requisition; the approval's outcome settled onto every request in it: `authorised`, or
> back to `approved` on reject) and the `disbursements` module (list with the `reference_missing`
> filter; create for one `authorised` request, the payee copied from the request, 422
> `REFERENCE_REQUIRED` on `payment_reference` unless a reference, a receipt or
> `confirm_without_reference: true` is given; `PATCH` Add Reference; the request moves to
> `disbursed`). Numbers from `numbering.allocate` (`requisition`, `disbursement`). Search providers,
> AI reads and the Create Requisition, Record Disbursement and Add Reference cards (gate 23), the
> notifications of guide §7, unit and integration tests. No database trigger on the reference
> (decision 2). Finish as CLAUDE.md step 5 says; tick #58 and #59 API when complete.

### PR 5 · Budgets and projects backend

> This is a backend change to M8 Expenses (branch `m8/expenses-budgets`). Read
> `docs/handoff/m8-expenses.md` in full, then `docs/guides/expenses.md` §3 step 7, §6.6, and
> CLAUDE.md step 2 for backend work, plus `src/modules/dashboard/sources/budgets.source.js` (Home
> reads these tables). Build PR 5: the `budgets` module (a department's budget for a calendar year
> with lines by category, numbered `budget`; create and edit with `expenses.finance`, each save an
> event with before and after amounts; `GET /budgets/:id/history` from the audit ledger, paged at
> 25 with `common.PageQuery`), the recount (committed = requests `approved`, `in_requisition`,
> `authorised`; spent = `disbursed`; recomputed from the requests in the transaction that moves one,
> called from the expenses, requisitions and disbursements services), `over_budget` set before each
> approval, Expenses · Projects (`GET /budgets/projects`, `PATCH /budgets/projects/:id` setting
> `project.budget_amount` through the projects service, AJ owns M2), the `budget-threshold` job
> (90% of a line, once per line per year, to the head and Operations & People), and the monthly
> expenses report by department, project and category through Home's report runner if it fits,
> otherwise say what you chose in the guide. Home's Budget Used counts spent and committed (decision 16):
> change `budgets.source.js`, clear that `owes` item, update Home's tests and `docs/guides/home.md`. Search, AI reads, the New Budget and Edit Budget cards, tests.
> Finish as CLAUDE.md step 5 says; tick #60 API when complete.

### PR 6 · AI features

> This is a backend change to M8 Expenses (branch `m8/expenses-ai`). Read
> `docs/handoff/m8-expenses.md` (decision 14), `docs/guides/expenses.md` §9 and
> `docs/guides/ai-control.md` §6.2. AJ chose the jobs: invoice reading on **Image Reading**, the
> duplicate check on **Default**, and the category suggestion (from the purpose and lines) on
> **Default**; register each AI action with `chosen_by: "AJ"`. Build
> through `services/ai/llm.service.complete()` with prompts in `services/ai/prompts/`, in outbox
> handlers or on the person's request, never in a transaction; results are suggestions a person
> accepts (invoice reading fills amount, payee and category on the New Request form; the duplicate
> check flags a request with the same payee and amount within 30 days, shown to approvers; the
> category suggestion proposes one as the form is filled). No
> personal data to DeepSeek. Tests with the model scripted. Finish as CLAUDE.md step 5 says.

### PR 7 · Frontend, staging seed and User Guide

> This is a full-stack change to M8 Expenses, mostly frontend (branch `m8/expenses-screens`). Read
> `docs/handoff/m8-expenses.md` in full, `docs/guides/expenses.md` (all of it, §10 above all), then
> what CLAUDE.md step 2 asks for frontend work (FRONTEND_GUIDE, FRONTEND_FOUNDATION with F31 as
> amended for Expenses, COMPONENTS). Build PR 7: make `app/src/features/expenses/index.tsx` a
> `switch`, add the Projects tab with `npm run new:screen` (it adds the PROGRESS row and counts);
> move My Requests into ESS; order the Expenses tabs Requisitions, Approvals, Disbursements,
> Projects, Budgets, Categories; replace the INTERIM types in `app/src/api/types/expenses.ts` and
> the mock with `contract.gen.ts` and the real API; add a modal layout to `ListDetail` in
> `packages/ui` (via its own test and gallery page) so Expenses records open in the centred dialog on
> desktop and the sheet on a phone; the line-item form, payee type with Use My Company Account,
> invoice upload, Save Without Reference?, Reference Missing and Add Reference, clickable KPI cards,
> no Disbursements chart, Add Suggested Categories on the empty tab, New Request on Expenses ·
> Projects with the project filled (decision 17); every form through
> `useContractForm`. Write `seeds/staging/80_expenses.js` through the services with realistic rows
> modelled on MyCity's expenditure sheet, following the three steps in
> `seeds/staging/lib/home-staging-rows.js`, and take out 8099's five categories after Home's rows
> are gone (a seed with a guarded DELETE). Write `docs/manual/expenses.md` and take its pictures
> (`npm run guide:shots`). The PR body's Native app feel section says what each shell does. Finish
> as CLAUDE.md step 5 says; tick UI and Mobile on each screen built.

### PR 8 · Release check

> This is the M8 release check (branch `m8/expenses-release`). Read `docs/handoff/m8-expenses.md`
> in full. Walk every AI card of guide §9 end to end as each role of guide §8 (the evaluation set
> and the matrix), confirm the forms gate leaves no M8 form on `scripts/check/ai-forms-gaps.json`,
> retake stale User Guide pictures, run `npm run ci` green, delete every M8 stub still empty and take
> it off README.MD (README §11.5), set each M8 screen's Status in PROGRESS, close §4 and write the
> last §6 line.
