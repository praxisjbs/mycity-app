# Expenses & Budget Control · Engineering Guide

| | |
|---|---|
| Owner | AJ |
| Milestone | M8 |
| Backend modules | `expenses`, `expense_categories`, `requisitions`, `disbursements`, `budgets` |
| Frontend paths | `app/src/features/expenses/` |
| Permission key(s) | `expenses` |
| Capabilities | `expenses.finance` (group approved requests into requisitions, record disbursements, set budgets, manage categories) |
| Screens (PROGRESS.md rows) | #56 (in ESS), #57, #58, #59, #60, #61, #106 Projects |
| Status | Agreed |
| Last changed | 13/11/2026 |

Agreed by AJ on 04/11/2026 from the Modules Review meeting of the same day (TB handed every M8
decision to AJ). The decisions and the build plan are in `docs/handoff/m8-expenses.md`; where this
guide and MILESTONES §13 differ, MILESTONES §13 was amended to match on the same day.

---

## 1 · What it is for

Anybody at MyCity who needs company money raises one request for it, with every item on its own
line, and it is paid by bank transfer once the line manager, Operations & People and the CEO have
agreed. Operations & People collect approved requests into a requisition for the CEO, record each
transfer with its bank reference, and keep each department's budget for the year. It replaces the
daily expenditure sheet MyCity keeps today (`MyCityApp Expenditure Sheet`, tabs 2025, 2026 and
Projects).

## 2 · Screens affected

| Screen / tab (slug) | Where | Who sees it | What it shows | What a person can do there |
|---|---|---|---|---|
| ESS · My Requests (`my-requests`, #56) | staff app, ESS | every employee, own requests | KPI cards In Flight, Disbursed This Year, Average Turnaround, Rejected; the requests list; a request's detail in a modal | New Request, Save Draft, Send Request, Edit and Send Again a sent-back request, Cancel Request |
| Expenses · Requisitions (`requisitions`, #58) | staff app | `expenses.finance` holders and the CEO | approved requests not yet in a requisition; the requisitions and their status | tick requests and Create Requisition; open a request and Withdraw it; the CEO opens one, removes a request, approves or rejects it; New Request (their own), for anyone with `expenses` create, even where the list is not open to them |
| Expenses · Approvals (`approvals`, #57) | staff app | anyone a request's approval waits on (line managers, Operations & People) | requests waiting on the reader, with the invoice and the chain | Approve, Send Back, Reject; New Request (their own) |
| Expenses · Disbursements (`disbursements`, #59) | staff app | `expenses.finance` holders and the CEO | requests the CEO authorised, waiting to be paid; paid ones with their bank reference | open a waiting request, then Record Disbursement or Withdraw; Add Reference on one saved without it |
| Expenses · Projects (`projects`, #106) | staff app | `expenses` view, all scope | each project's budget, committed, spent and remaining, and the requests under it | New Request with the project filled; Set Budget (with `expenses.finance`); open a request (Withdraw with `expenses.finance`) |
| Expenses · Budgets (`budgets`, #60) | staff app | `expenses` view; a head sees their own department | each department's budget for the year by category: allocated, committed, spent, remaining | New Budget, Edit Budget (with `expenses.finance`); Budget History |
| Expenses · Categories (`categories`, #61) | staff app | `expenses` view | the categories, their type, this month's spend | New Category, Edit Category, Deactivate; Add Suggested Categories while there are none |
| Home · Overview, Expenses Awaiting Approval and Budget Used cards | staff app | as Home shows them | the requests waiting and the budget used | open the list |
| Settings · Approvals | staff app | Settings holders | the two flows `expenses.request` and `expenses.requisition` | change who approves, without a deploy |
| My Workspace projects | staff app | as Workspace shows them | the projects the Project picker offers | none here |
| Notifications (bell, push) | both shells | the people named in §7 | each step of a request | open the request |
| Praxis AI and ⌘K | both shells | within the reader's grant | requests, requisitions, disbursements, budgets, categories | ask, find, and draft the forms as cards (§9); a draft's card offers Add Another Item and Send Request |

## 3 · How the screens relate

1. **Raise.** An employee opens ESS · My Requests, New Request: what it is for (Purpose), Category,
   Project (optional, from the Workspace projects), Department (their own by default, picked from
   the org chart, never typed), one or more lines (Description, Quantity, Unit Price), the payee
   and the invoice. The payee is Staff, Vendor, Partner or Dedicated Task Team (DTT: the team MyCity pays by the day at activations). For Staff, Use My
   Company Account fills the bank details from their employee profile; for the others the bank
   (typed or picked from the banks suggested, §6.1 rule 7), account name and account number are
   entered. Category is picked in a popover: filtered by type and searched by name, never a long
   list to scroll. Save Draft keeps it; Send Request submits it
   (`expense_request.submitted`) and opens the `expenses.request` approval in the same transaction.
2. **Line manager.** The approval reaches the requester's line manager, unless the requester
   manages people themselves, then it goes straight to Operations & People (the stage's condition,
   §6.3). The request shows on Expenses · Approvals for them and in the bell. They Approve, Send
   Back (the requester edits it and sends it again) or Reject (it ends).
3. **Operations & People.** The same three choices. Approved, the request is `approved` and its
   amount counts as committed against its department's budget (§6.6).
4. **Requisition.** On Expenses · Requisitions an `expenses.finance` holder ticks approved requests
   and presses Create Requisition: one record that owns them (`requisition.submitted`), which opens
   the `expenses.requisition` approval for the CEO. Each request moves to `in_requisition`.
5. **CEO.** The CEO opens the requisition, may remove a request from it (it goes back to the
   Requisitions list as `approved`, with the removal and its reason in its history), and approves
   or rejects the whole requisition. Approved, each request in it is `authorised`. Rejected, each
   goes back to `approved` for Operations & People to regroup, or to reject one by one.
6. **Disbursement.** On Expenses · Disbursements an `expenses.finance` holder records the transfer
   for each authorised request: the bank transaction reference, or a receipt, and the day paid. A
   request is paid to its own payee. Without a reference the screen asks Save Without Reference?;
   Yes saves it flagged Reference Missing, No returns to the reference field. The request is
   `disbursed` and its amount moves from committed to spent (§6.6).
7. **Budgets and projects.** Expenses · Budgets shows each department's year; Expenses · Projects
   each project's. Whoever manages a project raises its requests from there: New Request opens
   with the project filled, the same form and service as on My Requests (handoff decision 17). New
   Request is on Expenses · Requisitions and Expenses · Approvals too (TB, 13/11/2026): the same form
   and service, the request the presser's own, found afterwards on their My Requests; not on the
   other tabs. A request larger than its department's remaining budget is flagged before the
   line manager and Operations & People decide it, never after.
8. **History.** Every step is one event through `emit()`, so a request's history (raised, each
   decision with its reason, grouped, removed, authorised, paid, reference added) reads from the
   audit ledger, on the request's modal (`GET /expenses/:id/history`). A removal by the CEO is an
   event on the requisition; the history reads it from the event's payload, which names the
   request (audit F3).

## 4 · Data

| Table | Key columns | Notes |
|---|---|---|
| `expense_request` | `number` (EXP-0001), `employee_id`, `department_id`, `expense_category_id`, `project_id`, `budget_line_id`, `purpose`, `amount` (sum of its lines), `currency` (NGN), `status`, `payee_type`, `payee_name`, `bank_name`, `account_name`, `account_number`, `uses_profile_account`, `invoice_document_id`, `requisition_id`, `workflow_instance_id`, `needed_on`, `submitted_at`, `approved_at`, `rejected_at` | 8000, widened by 8010. Bank fields are masked as `employee.bank`. `requisition_id` is the requisition that holds it now |
| `expense_request_line` | `expense_request_id`, `position`, `description`, `quantity`, `unit_price`, `amount` | 8010. `amount` is quantity times unit price, two places, written by the service |
| `expense_category` | `code`, `name`, `type` (operating, capital), `description`, `active` | 8000, widened by 8010. No approval threshold (decision 1). Entered by MyCity (A26) |
| `requisition` | `number` (REQ-0001), `requester_id` (who grouped it), `status`, `total_amount`, `workflow_instance_id`, `submitted_at`, `approved_at` | 8000, widened by 8010. `expense_request_id` (one request each) and `supplier_name` are no longer used: a requisition owns many requests through `expense_request.requisition_id` |
| `disbursement` | `number` (DSB-0001), `expense_request_id` (one each), `recipient_type`, `recipient_name`, `bank_name`, `account_name`, `account_number`, `amount`, `payment_reference` (null is Reference Missing), `receipt_document_id`, `paid_at`, `processed_by` | 8000, widened by 8010 |
| `budget` | `number` (BUD-2027-0001), `name`, `department_id`, `owner_id`, `starts_on` 1 January, `ends_on` 31 December, `status`, `approved_by`, `approved_at` | 8000. One per department per year |
| `budget_line` | `budget_id`, `expense_category_id`, `amount`, `committed_amount`, `spent_amount` | 8000. A department's allocation by category. Committed and spent are recounted from the requests (§6.6) |
| `project` | `budget_amount` | M2's table (2000), widened by 8010: a project's optional budget |
| `requisition_line`, `expense_transaction` | | 8000, not used by M8. Dropped one release after M8 ships, if still unused |

Schema migration file(s): `migrations/8000_expenses.sql` (merged), `migrations/8010_expenses_chain.sql`,
`migrations/8030_expense_line_discount.sql` (a line's unit price and amount may be negative, §6.1 rule 1; the quantity stays above zero).
Reference-data file(s): `seeds/reference/8099_seed_expenses.sql` (merged),
`seeds/reference/8100_seed_expense_flows.sql` (the two approval flows, the statuses, the
`expenses.finance` capability, numbering).

The five categories 8099 seeds (Travel, Office Supplies, Training, Utilities, Professional
Services) are a business choice A26 does not allow in a reference seed. The reference seed
`seeds/reference/8101_seed_expense_categories_out.sql` takes them out wherever nothing names them,
production included (audit F4); on staging, where Home's demonstration rows named them,
`seeds/staging/80_expenses.js` takes Home's rows away and the five with them, then sets up the
suggested twelve, three departments' budgets, two projects and requests at every stage on the
Implementation Team's own accounts.

## 5 · API

| Method and path | Contract | Permission · scope | Paged | Notes |
|---|---|---|---|---|
| `GET /api/v1/expenses/mine` | `ExpenseListQuery` → `ExpensePage` | self | yes, 25 | ESS · My Requests |
| `GET /api/v1/expenses/mine/summary` | → `ExpenseMineSummary` | self | no | the four KPI cards |
| `GET /api/v1/expenses/banks` | `ExpenseBankListQuery` → `ExpenseBankPage` | `expenses` create | yes, 25 | the Bank field's suggestions: the common banks, then every bank a request names, most used first; `q` narrows (§6.1 rule 7) |
| `POST /api/v1/expenses/mine` | `ExpenseCreate` → `ExpenseRequest` | `expenses` create · own | | `submit: true` sends it at once |
| `PATCH /api/v1/expenses/mine/:id` | `ExpenseUpdate` → `ExpenseRequest` | `expenses` edit · own | | draft or sent back only |
| `POST /api/v1/expenses/mine/:id/submit` | `EmptyBody` → `ExpenseRequest` | `expenses` create · own | | Send Request, Send Again |
| `POST /api/v1/expenses/mine/:id/cancel` | `ExpenseCancel` → `ExpenseRequest` | `expenses` edit · own | | until Operations & People approve |
| `GET /api/v1/expenses` | `ExpenseListQuery` → `ExpensePage` | `expenses` view · all/team/own | yes, 25 | filters `status`, `category_id`, `project_id`, `department_id`, `payee_type`, `q`; `disbursed_from` (paid on or after a Lagos day) and `approved_by_me_from` (approved by the reader on or after a day), for the KPI cards (audit F21) |
| `GET /api/v1/expenses/:id/history` | `PageQuery` → `ExpenseHistoryPage` | as `GET /:id` | yes, 25 | the modal's history: the request's own events, its approval's, and its requisition's and disbursement's that name it (audit F3) |
| `GET /api/v1/expenses/:id` | → `ExpenseRequest` | `expenses` view, or named on its approval | | lines, chain, history, budget check; `possible_duplicates` only those the reader may open, `possible_duplicates_hidden` the rest (§6.8) |
| `GET /api/v1/expenses/approvals` | `ExpenseListQuery` → `ExpensePage` | `expenses` approve | yes, 25 | waiting on the reader |
| `POST /api/v1/expenses/mine/invoice-reading` | `ExpenseInvoiceReading` → `ExpenseInvoiceSuggestion` | `expenses` create · own staged file | | Read Invoice (PR 6): payee, the payee's bank, lines (a discount a negative line) and category for the form; nothing kept |
| `POST /api/v1/expenses/mine/category-suggestion` | `ExpenseCategoryHint` → `ExpenseCategorySuggestion` | `expenses` create | | Suggest Category (PR 6); nothing kept |
| `POST /api/v1/expenses/:id/duplicate-check` | `EmptyBody` → `ExpenseDuplicateCheck` | `expenses` view, or named on its approval | | Check Duplicate (PR 6) on the modal; nothing kept |
| `GET /api/v1/expenses/approvals/summary` | → `ExpenseApprovalsSummary` | `expenses` approve | no | the four KPI cards on Approvals |
| `POST /api/v1/expenses/:id/withdraw` | `ExpenseCancel` → `ExpenseRequest` | `expenses` edit, `expenses.finance` | | after approval, before payment |
| `GET /api/v1/requisitions` | `RequisitionListQuery` → `RequisitionPage` | `expenses` view, `expenses.finance` | yes, 25 | the CEO passes |
| `POST /api/v1/requisitions` | `RequisitionCreate` → `Requisition` | `expenses` create, `expenses.finance` | | 1 to 25 approved requests |
| `GET /api/v1/requisitions/:id` | → `RequisitionDetail` | `expenses` view, `expenses.finance` | | its requests, paged in the detail |
| `POST /api/v1/requisitions/:id/remove` | `RequisitionRemove` → `RequisitionDetail` | the requisition's approver (the CEO) | | before it is decided |
| `GET /api/v1/disbursements` | `DisbursementListQuery` → `DisbursementPage` | `expenses` view, `expenses.finance` | yes, 25 | `reference_missing` filter |
| `POST /api/v1/disbursements` | `DisbursementCreate` → `Disbursement` | `expenses` create, `expenses.finance` | | `confirm_without_reference` |
| `PATCH /api/v1/disbursements/:id` | `DisbursementReference` → `Disbursement` | `expenses` edit, `expenses.finance` | | Add Reference |
| `GET /api/v1/budgets` | `BudgetListQuery` → `BudgetPage` | `expenses` view · all/team (on the department's head) | yes, 25 | by year, department, `q` |
| `GET /api/v1/budgets/:id` | → `Budget` | `expenses` view · all/team | | one budget and its lines (PR 5) |
| `POST /api/v1/budgets`, `PATCH /api/v1/budgets/:id` | `BudgetCreate`, `BudgetUpdate` → `Budget` | `expenses` create, edit, `expenses.finance` | | lines by category; one budget per department per year (409 `BUDGET_EXISTS`) |
| `GET /api/v1/budgets/:id/history` | `PageQuery` → `BudgetChangePage` | `expenses` view | yes, 25 | from the audit ledger |
| `GET /api/v1/budgets/projects` | `ProjectSpendListQuery` → `ProjectSpendPage` | `expenses` view · all (403 otherwise) | yes, 25 | Expenses · Projects: running projects and any with a budget or requests |
| `PATCH /api/v1/budgets/projects/:id` | `ProjectBudget` → `ProjectSpend` | `expenses` edit, `expenses.finance` | | sets `project.budget_amount` through the projects service |
| `GET /api/v1/expense-categories` | `ExpenseCategoryListQuery` → `ExpenseCategoryPage` | `expenses` view | yes, 25 | the pickers read it 25 at a time (F32) |
| `POST /api/v1/expense-categories`, `PATCH /:id` | `ExpenseCategoryCreate`, `ExpenseCategoryUpdate` → `ExpenseCategory` | `expenses` create, edit, `expenses.finance` | | |
| `POST /api/v1/expense-categories/suggested` | `EmptyBody` → `ExpenseCategoryPage` | `expenses` create, `expenses.finance` | | only while there are none |

Approve, Send Back and Reject are the approval's own routes (`/workflow/instances/:id/approve`,
`request-changes`, `reject`), as every flow in the hub: whoever the stage names decides, with
`expenses` approve.

An invoice, and a disbursement's receipt, is staged first through the upload engine
(`POST /api/v1/documents`) and named on the request by its `document_id`. Saving the record claims
it (`shared/documents/vault.claim`): the file becomes the record's (`expense_invoice` on the
request, `disbursement_receipt` on the disbursement, the requester its subject), so the vault's
read rule lets the requester, their line manager, Operations & People and the CEO open it. A file
somebody else staged is refused, `invoice_document_id: Upload it again`.

## 6 · Rules and calculations

### 6.1 A request

1. A request has 1 to 25 lines. Each line's amount is quantity times unit price, rounded to two
   places through `shared/money`; the request's `amount` is the sum of its lines. A line may carry a
   negative unit price (a discount, or a payment already made on the invoice, `praxis-ai.md`
   decision 45), so a request can show a whole invoice and ask for its balance due; the request's
   total is always above zero, else 422 `EXPENSE_TOTAL_NOT_POSITIVE` on `lines` ("Total above
   zero"). A discount, a credit or a charge on the whole invoice is a line of its own; a deposit or an
   amount already paid is read on its own and becomes one more minus line ("Paid to date on
   INV-..."), so Read Invoice's lines and Praxis AI's card come to what the invoice asks to be paid
   now. NGN only: a foreign invoice is converted before it is entered.
2. Send Request needs Purpose, Category, Department, at least one line, a payee and its bank
   details. An invoice is optional but asked for (the approvers see when there is none).
3. Payee type `staff` with Use My Company Account copies the bank name, account name and account
   number from the requester's employee record at the moment it is sent, so a later change to the
   profile does not change a request already in flight. Any other payee type types them.
4. A draft and a sent-back request are edited by their requester only. Nothing else is edited
   once sent: a change is a Send Back.
5. The requester cancels a request while it is a draft, sent back, or waiting on the line manager
   or Operations & People (its approval is withdrawn with it). Once Operations & People approve it,
   only an `expenses.finance` holder withdraws it, with a reason, until it is paid. One withdrawn
   from a requisition leaves it, and the requisition's total is counted again (emptied, it is
   cancelled).
6. **Send Back and Send Again** (decided 05/11/2026 in PR 3, as the handoff asked). The engine's
   Request Changes keeps an approval pending and moves it back to its first stage, where the line
   manager could still decide a request its requester is changing. So, as a performance review is
   returned to its reviewer, the handler for `workflow.changes_requested` withdraws the pending
   approval for its opener and sets the request `sent_back`. The requester edits it and presses Send
   Again, which opens a new `expenses.request` approval: the flow as Settings · Approvals holds it
   at that moment, starting again at the line manager. A request in flight still keeps the version
   it opened on; only a request sent again after a Send Back takes the current one. The earlier
   approval and its decisions stay on the request's history.
7. **The bank is typed or picked, never a closed list** (TB, 11/11/2026). The Bank field suggests
   the common banks (`COMMON_BANKS` in `expenses.service.js`) and every bank a request has named,
   most used first, one row a name whatever its case; a bank it does not know is offered as Add
   and kept as typed, so it is suggested to everyone from then on. Only bank names are read for
   the suggestions, never an account, and no request is named. Not a table: a bank is the text a
   request was saved with, as a KPI's unit is.

### 6.2 Statuses

`draft` → `submitted` (its approval decides; the stage says who) → `approved` (by Operations &
People, waiting for a requisition) → `in_requisition` → `authorised` (the CEO approved its
requisition) → `disbursed`. Off the line: `sent_back` (back to the requester), `rejected`,
`cancelled`. Home reads `submitted` as awaiting approval.

### 6.3 The approval chain

Two flows, both edited on Settings · Approvals (A11), and each request keeps the version it opened
on (the engine's rule; confirmed correct in the meeting):

- `expenses.request`: Line Manager (`manager_of_subject`, condition
  `requester_manages_people = false`), then Operations & People (role `operations_people`); 48
  hours each. Context `{ amount: money, requester_manages_people: boolean }`.
- `expenses.requisition`: CEO, 72 hours. Context `{ total: money }`.

There is no approval threshold anywhere (decision 1): every request takes the same path whatever
its amount, and the CEO decides the requisition as a whole.

### 6.4 Requisitions

1. Only requests in `approved` can be grouped, 1 to 25 at a time, by an `expenses.finance` holder.
2. Before the CEO decides, the CEO may remove a request, with a reason. It returns to `approved`
   and to the Requisitions list, and the requisition's total is recomputed. A requisition with no
   request left is cancelled.
3. Approved: every request in it is `authorised`. Rejected (a reason required): every request in it
   returns to `approved`.

### 6.5 Disbursements

1. One disbursement per request, only for an `authorised` request, by an `expenses.finance` holder.
2. The amount is the request's amount. The payee and bank details are copied from the request.
3. The bank transaction reference or a receipt is asked for. Saving with neither needs
   `confirm_without_reference: true` (the screen's Save Without Reference?); without it the API
   answers 422 `REFERENCE_REQUIRED` on `payment_reference`. A disbursement with no reference is
   Reference Missing until Add Reference fills it; the Disbursements KPI card counts them.
4. No database trigger refuses a disbursement without a reference (decision 2; the donor's
   trigger is not ported).

### 6.6 Budgets and projects

1. A department's budget is set for a calendar year, by category, by an `expenses.finance` holder,
   and can be changed at any time; each change is an event with the before and after amounts, read
   back as Budget History.
2. A request counts against the budget line of its department, its category and the year it was
   sent in (`budget_line_id`, set when it is sent). Committed is the sum of its requests that are
   `approved`, `in_requisition` or `authorised`; spent is the sum of those `disbursed`. Both are
   recounted from the requests in the transaction that moves one, never added to by hand.
3. Remaining is allocated less committed less spent. A request whose amount is more than its line's
   remaining (or that has no line for its category, or no department) carries `over_budget: true`
   and the approvers see it before they decide. It is a flag, never a block. **Over Budget is
   measured against the category line** (audit F1, AJ 05/11/2026): decision 7's "department's
   remaining budget" is read as what the department has left for that category; the department's
   whole remaining for the year is shown beside it (`department_remaining`), so the approver sees
   both. **The flag is never older than its line** (audit F2): it is set when the request is sent
   (and sent again), and worked out again for every request still `submitted` on a line whenever
   that line's figures move (a request on it approved, withdrawn or paid; the budget set or
   changed). A request already approved counts in its line's committed and keeps the flag it was
   decided with. **The recount locks its lines first** (audit F6), in one order, in a statement of
   its own, and only then counts the requests: two moves on one line at once (two approvals, a
   payment beside an approval, Edit Budget beside a settle) each read the other's, never drop it.
4. **A budget set after requests were sent** counts them: saving a budget gives each request of
   its department already sent in its year, in a category it has a line for and with no line yet,
   that line, and recounts it.
5. **A budget is in force once saved** (status `approved`, `approved_by` the saver): there is no
   separate approval of a budget; `expenses.finance` is the authority. One per department per
   year, held by the database (migration 8020's unique index on department and year, every budget
   but a closed one; two New Budget presses at once save one, the other answers 409
   `BUDGET_EXISTS`; audit F7). Its owner is the department's head **now**
   (`department.head_employee_id`, read with the budget, `owner_id` only when the department has
   none; audit F17), on whom the list's team scope and Edit Budget's notice run. Edit Budget sends
   every line again: a line left out is taken away, or set to 0 when a counted request (sent,
   approved, in a requisition, authorised or paid) names it; requests that name it otherwise (a
   draft, cancelled, rejected) let go of it first (audit F16). Budget History is one row per line a save changed,
   read from the save's event (`metadata.changes`: category, before, after).
6. A project's budget is optional, set on Expenses · Projects by an `expenses.finance` holder
   through the projects service (`projects.service.setBudget`, `project.budget_set`), whoever owns
   the project. Its committed and spent are counted the same way over the requests that name it,
   in the read (no stored total). Expenses · Projects is read with `expenses` view at scope all.
7. The budget-threshold job warns the department's head and Operations & People when a line
   reaches 90% used, committed and spent (the count Home's Budget Used makes), once per line (a line belongs to one year):
   `budget.line_threshold_reached`, deduplicated by the line.
8. **The monthly expenses report** runs through Home's report runner as the source
   `expenses_monthly` (Monthly Expenses, on Home · Reports' New Report form; `budgets.variance`):
   the calendar month before the report's moment (a report scheduled on the 1st covers the month
   just ended), three tables, by department (with the year's budget and remaining, read as
   `/budgets` reads them: approved, in naira, and only a budget whose department's head is in the
   reader's scope; audit F18), by project and
   by category: requests sent, their amount, paid in the month, committed now. Read in the
   reader's `expenses` scope on the requesters, as every Home report is built as its recipient.

### 6.7 Categories

1. A category has a name, a type (`operating` or `capital`) and an optional description. Its
   `code` is made from its name and never shown.
2. A category in use is deactivated, never deleted. A deactivated one is not offered on new
   requests.
3. Add Suggested Categories creates the twelve below in one press, only while there are none
   (A26: MyCity enters them, by pressing it): Advertising and Media, Branded Items and Printing,
   Content and Production, Events and Activations, Travel and Transport, Influencers and PR,
   Accommodation and Meals, Prizes and Giveaways, Data Airtime and Subscriptions, Legal and
   Professional Services, Office and Admin (operating), Equipment (capital). They come from
   MyCity's expenditure sheet and the demo; the list is one constant in
   `src/modules/expense_categories/`. Salaries are not a category (payroll, M6).

### 6.8 Possible duplicates

1. A sent request shows **Possible Duplicate** when another was sent within 30 days either side of
   it to the same payee (the same account number, or the same payee name with case and accents set
   aside) for the same amount: `possible_duplicates` on the request, at most five, the newest first,
   whatever their status (one sent again after a rejection is shown too). The flag is the
   database's, so every approver sees it without a model. **A duplicate is named only to a reader
   who may open it** (audit F8): their own, one in their `expenses` scope, or one whose pending
   stage names them, as `getFor` decides; the rest are a count, `possible_duplicates_hidden`
   ("1 request you cannot open"), never their number, purpose or amount.
2. **Check Duplicate** on the modal asks the model (Default) to compare their purposes and lines and
   name the one it most likely repeats, with a sentence why. It is given numbers, purposes, days,
   statuses and lines, never the requester, the payee or the bank details, and only the duplicates
   the reader is named (rule 1). Nothing is kept: the approver reads it and decides. Its verdict
   shows open in one line; the model's reason, cut to one sentence of at most 20 words, sits behind
   Details.

## 7 · Events, jobs and notifications

| Event / job | When | Does |
|---|---|---|
| `expense_request.created`, `.updated` | a draft is saved | audit only |
| `expense_request.submitted` | Send Request, Send Again | opens `expenses.request`; the engine tells the first approver |
| `workflow.completed` for `expenses.request` | the last stage decides | copies the outcome onto the request (approved or rejected), recounts the budget line; the engine tells the requester |
| `workflow.changes_requested` for `expenses.request` | Send Back | the approval is withdrawn for its opener (`engine.cancel` with `sentBack`, so no approver is told it was withdrawn) and the request is `sent_back` (`expense_request.sent_back`, §6.1 rule 6); the engine tells the requester with the reason |
| `workflow.cancelled` for `expenses.request` | withdrawn from the approvals screen | a request still `submitted` is `cancelled`; one already sent back or cancelled is left alone |
| `expense_request.approved`, `.rejected` | the approval's outcome copied | audit only (the engine told the requester) |
| `expense_request.cancelled`, `.withdrawn` | cancel, withdraw | the approval is withdrawn; a withdrawal tells the requester |
| `requisition.submitted` | Create Requisition | opens `expenses.requisition`; the engine tells the CEO |
| `requisition.request_removed` | the CEO removes one | the request's requester and whoever grouped it are told |
| `workflow.completed` for `expenses.requisition` | the CEO decides | every request in it moves (§6.4), `requisition.approved` or `.rejected`; the engine tells whoever grouped it |
| `requisition.cancelled` | its last request was removed or withdrawn | its approval is withdrawn; audit only |
| `disbursement.recorded` | Record Disbursement | the requester is told it was paid |
| `disbursement.reference_added` | Add Reference | audit only |
| `budget.set`, `budget.changed` | a budget is saved | Budget History; the department's head is told of a change |
| `budget.line_threshold_reached` | the budget-threshold sweep | the department's head and Operations & People are told (§6.6 rule 7) |
| `project.budget_set` | Set Budget on Expenses · Projects | audit only (the projects module's event) |
| `expense_category.created`, `.updated`, `.suggested` | Categories | audit only |
| `budget-threshold` scheduler | daily, 07:00 Lagos | §6.6 rule 7 |

## 8 · Permissions and visibility by role

| Role | Sees | Can do |
|---|---|---|
| Employee | their own requests (`expenses` own) | raise, edit while draft or sent back, cancel |
| Line manager (manager, head of department) | their team's requests (`expenses` team), the ones waiting on them | approve, send back, reject at their stage |
| Operations & People | every request, requisition, disbursement and budget (`expenses` all) | decide at their stage; with `expenses.finance`: group, withdraw, record disbursements, set budgets, manage categories |
| CEO | everything | decide requisitions, remove a request from one; holds every capability |
| Management | every request and budget (`expenses` all, no delete) | view, export |

`expenses.finance` is held by default by `operations_people`, the Implementation Team (which holds every capability) and the CEO. Bank details on a
request and a disbursement are restricted fields (`employee.bank`): a reader without that field
grant sees the account number masked, on screen, in exports and in AI reads. A request's own
requester always sees theirs.

## 9 · AI and search

- **AI reads** (`expenses.ai.js`, `requisitions.ai.js`, `disbursements.ai.js`, `budgets.ai.js`,
  `expense_categories.ai.js`): the person's own requests (`expenses.mine`); requests within reach by
  status, category, project, department and payee type (`expenses.list`); those waiting on the
  person (`expenses.approvals`); the categories; requisitions and disbursements (with a reference
  missing) for a holder of `expenses.finance`, an empty page for anyone else, as a read carries no
  capability; the departments' budgets with their lines (`budgets.list`) and each project's spend
  (`budgets.projects`, an empty page for a reader whose scope is not all). Paged at 25, with the reader's own grant
  and scope.
- **AI actions** (cards the person confirms; every create and edit form, the forms gate). Built in
  PR 3 and PR 4: New Request (`my_expenses.create`, `ExpenseRequestAdd`: the request with its first
  line flat, sent at once unless the person keeps a draft, which the model keeps when the person
  names more than one item), Add Line (`my_expenses.add_line`, `ExpenseLineAdd`), Send Request
  (`my_expenses.submit`, `ExpenseSend`: a draft or sent-back request of the person's own, sent as
  the modal's Send Request sends it; TB, 13/11/2026), Save Request (`my_expenses.edit`, `ExpenseChange`), New Category
  (`expense_categories.create`), Save Category (`expense_categories.edit`, `ExpenseCategoryChange`),
  Create Requisition (`requisitions.create`), Record Disbursement (`disbursements.create`, risk
  money) and Add Reference (`disbursements.add_reference`, `DisbursementReferenceAdd`). Built in
  PR 5: New Budget (`budgets.create`, `BudgetCreate`), Edit Budget (`budgets.edit`,
  `BudgetLinesChange`) and Set Budget on a project (`budgets.set_project`, `ProjectBudgetSet`). Approve, Send Back and Reject go through the approvals' own card
  (`approvals.decide`), the CEO's decision on a requisition too (tested, and an evaluation case;
  audit F20). Remove (`RequisitionRemove`) has no card: it is the CEO's press with a reason on the
  requisition's own modal, one request at a time, and no create or edit form, so the CEO is pointed
  to Expenses · Requisitions (`requisitions.ai.js` says why). An invoice or a receipt is a file and stays on the form. Each runs the
  module's own service function. New Category, Record Disbursement and New Budget carry their
  form's own schema (PR 7); the others say `form: "none: <reason>"`, because their form never names
  its record (Edit, Add Reference, Edit Budget, Set Budget), holds many lines (New Request), or is a
  press on ticked rows (Create Requisition).
- **Asking for an item** (TB, 13/11/2026). New Request and Add Line ask for their line in one turn:
  "What are you paying for? How many? How much is each?" (`also`, `praxis-ai.md` §6.11), the
  quantity 1 when the answer gives none, and "How much is each?" again only when the answer gave
  no price. The model's figures are read as the contract takes them (1 is "1", 700000 and
  "₦700,000" are "700000.00"), on every card. Once pressed, a request still a draft or sent back
  offers **Add Another Item** and **Send Request** under its result (`then`, `nextAfter`), each
  asking the next question; a request sent at once offers nothing, since a sent request is never
  edited (§6.1 rule 4).
- **AI features** (PR 6; jobs chosen by AJ, registered in `services/ai/actions.js` with
  `chosen_by: "AJ"`; each runs on the person's press, never in a transaction, and nothing is kept;
  off with no provider set up, or this month's budget spent, as Write With AI is):
  - **Read Invoice** (`expense-invoice-read`, Image Reading, `expenses.receipt-ai.js`): the file the
    person staged for New Request (or one their own request holds) goes to the model as a file
    (`complete({ files })`); it answers the payee and their bank, the lines, a category, the
    invoice's total, what was already paid and its balance due; the server matches the category
    among those offered (one it made up is left empty) and works the amounts out through
    `shared/money`. Everything the invoice adds or takes away between its items and its total is a
    line of its own (a tax on the whole invoice above zero, a discount or a credit below zero), and
    a deposit or an amount already paid becomes one more line below zero, "Paid to date on
    INV-...", built by the server as Praxis AI's card builds it (§6.1 rule 1; `praxis-ai.md`
    decision 45; prompt version 3, 13/11/2026, after a JBS Praxis invoice with a discount and a
    deposit paid was read as ₦550,000.00 where it asked for ₦150,000.00). The form is told the
    amount the invoice asks to be paid now (`amount_due`: its balance due, else its total), and
    when the lines' sum differs its toast says so ("Invoice asks ₦150,000.00. Check lines"). It fills the form, which the person checks and changes; nothing is saved until
    they press Save Draft or Send Request. A file the provider refuses (its kind or its size) answers
    `unreadable`, "This file cannot be read", as one of the wrong kind does; this month's AI budget
    spent answers `limit` (audit F9, F20).
  - **Suggest Category** (`expense-category-suggest`, Default): one offered category from the
    purpose and the lines typed so far, matched by name.
  - **Check Duplicate** (`expense-duplicate-check`, Default, `expenses.duplicates.js`): §6.8.
  No personal data goes to DeepSeek: each is registered `personal_data: true`.
- **AI routes**: "raise an expense" to ESS · My Requests with New Request open; "set a budget" to
  Expenses · Budgets.
- **Search** (`expenses.search.js`, `requisitions.search.js`, `disbursements.search.js`,
  `budgets.search.js`, `expense_categories.search.js`): a request by number or purpose (words
  expense, request, claim), a requisition and a disbursement by number or bank reference, a budget
  by department and year, a category by name. Categories' New Category is the ⌘K action **New
  Expense Category**, the name the phone's floating button gives it too, since Partnerships has a New
  Category of its own and ⌘K holds each label once; the header button stays New Category (TB,
  06/11/2026; `partnerships.md` §13.2).

- **Documents in the chat** (`praxis-ai.md` decisions 41 to 48, §6.18; built 13/11/2026, Appendix A
  PR 1). An invoice attached on Praxis AI · Ask (the Invoice tile, for anyone with `expenses`
  create) is read by Read Invoice's own action, widened, and becomes New Request's card from the
  file (`my_expenses.from_invoice`, `ExpenseRequestFromInvoice`, `expenses.ai.js` `files`): its
  balance due itemised, a discount and a payment already made as negative lines, the invoice's
  subject and number as the purpose, the payee's bank, the file as the request's invoice, a possible
  duplicate named in the answer. A payment receipt attached by an `expenses.finance` holder (the
  Payment Receipt tile) is read on `disbursement-receipt-read` and becomes Record Disbursement's
  card (`disbursements.ai.js` `files`), the authorised request matched by account number, else
  payee name, and amount in the disbursements service's SQL, the receipt attached; several or none
  matching ask "Which request was paid?". Read Invoice on New Request fills the payee's bank too, and
  a line takes a minus (`LinesField`, `MoneyField` `signed`).

## 10 · On screen and mobile

Every list is 25 a page. A request, a requisition and a disbursement open in the shared Modal on
desktop and on a phone (F31 as amended for Expenses, 04/11/2026): the list takes the full height of
the screen, and nothing opens until a row is pressed. KPI cards that have records behind them open
their list in a modal (the ESS rule); Average Turnaround and Rejected open nothing.

### 10.1 Content tiers

| Screen | Open (tier 1) | Behind help (tier 2) | Not on screen (tier 3), lives in |
|---|---|---|---|
| ESS · My Requests | KPI cards In Flight, Disbursed This Year, Average Turnaround, Rejected; the list (Reference, Purpose, Amount, Submitted, Stage); New Request. The modal: lines, total, payee, invoice, the chain with who it waits on, history; Edit, Send Again, Cancel Request (it asks first; after approval the request shows Withdraw to an `expenses.finance` holder instead). Disbursed This Year lists this year's paid requests (`disbursed_from`). Switching Payee off Staff clears Use My Company Account. Category opens a popover (Pick Category) with a Category Type filter (All, Operating, Capital) and a search over the categories, 25 a page; Bank suggests banks as typed and offers Add for one it does not know; Payee Name and Account Name show a person's name as their example, never the reader's own. Unit Price takes a minus for a line that takes money off (a discount, an amount already paid), shown red with (less). The modal's lines are two columns, Item (its quantity and the price of each under it) and Amount, so an invoice's long descriptions read in the modal. Read Invoice fills each price as a person types it ("-100,000") and names the category it picked. Edit Request shows a request's lines the same way ("1", "85,000"). A Send Back no longer tells its approvers "The requester withdrew this" (`engine.cancel` `sentBack`, expenses, agreements and payroll). The form: the lines (Item, Quantity, Unit Price, a minus taken for a discount, the Amount of each and the Total under them, Add Line), Read Invoice once an invoice is attached (the payee, the bank and the lines), Suggest Category in its footer, each filling the form for the person to check, Read Invoice's toast naming the amount the invoice asks for when the lines add up to another; nothing is saved until they press | help on Use My Company Account: "Pays the bank account on your profile." Help on Stage: "Who the request is waiting on now." | the approval routing and the budget recount: §3, §6 here, the manual |
| Expenses · Requisitions | New Request (secondary beside Create Requisition; alone, primary, above Not Open to You for a reader without `expenses.finance`); Approved Requests (tick boxes, Create Requisition), each opening its request in the modal with Withdraw (a reason, after a confirm); Requisitions (Reference, Requests, Total, Submitted, Status). The modal: its requests, each opening, Remove, Approve, Reject (the CEO) | help on Requisitions: "Approved requests grouped for the CEO." | why requests are batched: MILESTONES §13, the manual |
| Expenses · Approvals | New Request; KPI cards With You, Total Value, Oldest, Approved This Month (opens the requests the reader approved since the 1st, `approved_by_me_from`); the list; the modal with lines, invoice (opens as a PDF), budget remaining (the line's, and the department's beside it), an Over Budget pill, a Possible Duplicate pill with Check Duplicate; Approve, Send Back, Reject | help on Over Budget: "More than the department has left for this category this year." Help on Possible Duplicate: "Same payee and amount within 30 days." | the chain's configuration: Settings · Approvals, this guide |
| Expenses · Disbursements | KPI cards Waiting to Pay and Reference Missing, each opening its list; Waiting to Pay, a request opening in the modal with Record Disbursement and Withdraw; Paid; Record Disbursement (Bank Reference, Receipt, Paid On), No on Save Without Reference? back on Bank Reference; a Reference Missing pill and Add Reference; a paid one's Receipt row with Open Receipt when one was uploaded (TB, 11/11/2026). No chart (decision 7) | help on Bank Reference: "The bank's transaction ID for this transfer." | audit-anchor reasoning: §6.5 here |
| Expenses · Projects | projects with Budget, Committed, Spent, Remaining, to `expenses` view at scope all (a refused read is Not Open to You); a project's requests in its modal, each opening; New Request (the project filled), Set Budget (`expenses.finance`), Remove Budget after a confirm | help on Committed: "Approved but not yet paid." | how spend is counted: §6.6 |
| Expenses · Budgets | Year picker; departments with Allocated, Committed, Spent, Remaining; a budget's lines by category; New Budget, Edit Budget, Budget History | help on Remaining: "Allocated less committed and spent." | the 90% warning rule: §6.6 |
| Expenses · Categories | the list (Category, Type, This Month, Requests); New Category, Edit Category, Deactivate (after a confirm); Add Suggested Categories while empty | help on Type: "Capital is equipment kept for years." | A26 and where the defaults came from: §6.7, the handoff |

### 10.2 Phone layout

| Screen | First on a phone | Left off a phone | Main action | Navigation |
|---|---|---|---|---|
| ESS · My Requests | the four KPI cards two to a row, then request cards (purpose, amount, a stage pill) | Submitted date on the card | New Request, full width; the form is a full sheet, lines added one at a time | ESS tabs; bottom bar |
| Expenses · Requisitions | approved request cards with a tick, Create Requisition pinned at the bottom once one is ticked | the requisitions' Approved date | Create Requisition; in the sheet Approve, full width; New Request from the floating button (second after Create Requisition, first for a reader without `expenses.finance`) | Expenses tabs scroll sideways |
| Expenses · Approvals | the four KPI cards, then request cards with amount and requester | the requester's department | Approve, full width in the request's sheet, Send Back and Reject beside it; New Request, the floating button's action | Expenses tabs scroll sideways |
| Expenses · Disbursements | Waiting to Pay cards, then Paid with the Reference Missing pill | the Paid On column | Record Disbursement, full width in the sheet | Expenses tabs scroll sideways |
| Expenses · Projects | project cards with a used bar and Remaining | Committed and Spent (in the sheet) | Set Budget in the sheet | Expenses tabs scroll sideways |
| Expenses · Budgets | year picker, then department cards with a used bar | the category lines (in the sheet) | Edit Budget in the sheet | Expenses tabs scroll sideways |
| Expenses · Categories | category cards with type and this month | Requests count | New Expense Category, the floating button's action | Expenses tabs scroll sideways |

## 11 · Edge cases

- **Send Back tells the line manager "Withdrawn"**: withdrawing the approval on a Send Back (§6.1
  rule 6) goes through the engine's own withdrawal, whose notice tells the stage's approvers the
  requester withdrew it, beside the engine's Changes Requested notice. As for performance reviews;
  a wording of its own is the engine's to add.
- **Requester is a line manager**: the Line Manager stage is skipped (§6.3); they never decide
  their own request (the engine refuses self-approval; the CEO excepted).
- **No line manager** (the top of the chart): the engine skips the stage, as for leave.
- **Double press** of Send Request, Create Requisition or Record Disbursement: one press, one
  request (F26); a second Record Disbursement for the same request is refused 409.
- **A request in two requisitions**: refused; grouping locks the requests and checks `approved`.
- **Profile bank details missing** with Use My Company Account: refused on the bank fields, "Add
  your bank details to your profile first".
- **Category deactivated** while a request uses it: the request keeps it.
- **No budget for the year or the category**: the request is flagged Over Budget, never blocked.
- **Year end**: a request counts in the year it was sent, even if paid in January.
- **Empty states**: no requests yet, no budget for the year (New Budget), no categories (Add
  Suggested Categories).
- **A huge list**: 25 a page everywhere, the CEO's requisition detail too.

## 12 · Donor code

| From | File | Change on the way in |
|---|---|---|
| pixie | `src/modules/cash_request/cash-request.service.js` | the state machine's shape (draft, submit, decisions with reasons, send back, disburse with a bank reference, state history) kept; the finance and CEO stages become the `expenses.request` and `expenses.requisition` workflow definitions; the `business_config` threshold, the CEO fast-forward disbursement, GL posting, cash advances and settlement are not carried; the reference is asked for, not required (decision 2) |
| pixie | `src/modules/cash_request/cash-request.validator.js` | recipient types become `payee_type` (staff, vendor, partner, task_team); amounts are two-place strings in the contract |
| pixie | `src/modules/expenses/expenses.ai.service.js` | receipt reading for PR 6, through `services/ai/llm.service.complete()`, provisional until accepted |
| pixie | `src/modules/expenses/expenses.repo.js` | line items and categories, rewritten for `pageQuery` and scope |
| praxis | `src/modules/finance/office_expense/` | not used (thin; REUSE_MAP §9) |

## 13 · Open questions

None.

## 14 · Change log

- 13/11/2026 · TB · Documents in the chat built (`praxis-ai.md` Appendix A PR 1, §9): an invoice on Praxis AI becomes a New Request card for its balance due, a receipt a Record Disbursement card. §6.1 rule 1: a line may carry a negative unit price and a request's total is above zero, `EXPENSE_TOTAL_NOT_POSITIVE` replacing `AMOUNT_REQUIRED`, with migration 8030 dropping 8010's CHECKs on a line's price and amount (§4). Read Invoice fills the payee's bank (§5). New Request's lines are the shared `LinesField` (§10.1: a minus taken on a unit price, the total under the lines).
- 13/11/2026 · TB · Found filming the M8 handover video: Read Invoice read a real invoice with a discount and a deposit already paid as ₦550,000.00, where it asked for ₦150,000.00; the prompt left discounts out, and the database refused a line below zero, so nobody could enter one. A line may now take money off (§6.1 rule 1, migration 8030 (`8030_expense_line_discount.sql`, already on `main`), Unit Price's `MoneyField signed`), the request's amount still above zero; Read Invoice reads every addition and deduction as a line and the amount due beside them (`amount_due`, §9), and the form warns when they differ. The staging seed's sent-back and rejected requests are decided by whoever their stage names (a requester who manages people goes straight to Operations & People).
- 13/11/2026 · TB · Documents in the chat planned (`praxis-ai.md` decisions 41 to 48, Appendix A PR 1): an invoice attached on Praxis AI becomes a New Request card for its balance due, itemised, and a payment receipt a Record Disbursement card (§9). Nothing built yet; §6.1's negative line and total above zero come with PR 1.
- 13/11/2026 · TB · New Request on Expenses · Requisitions and Expenses · Approvals, the presser's own request through New Request's own form (§2, §3 step 7, §10.1, §10.2), not on the other tabs. Praxis AI: the New Request and Add Line cards ask for their item in one turn ("What are you paying for? How many? How much is each?"), read the model's figures as the contract takes them (Quantity and Unit Price were refused "Expected string, received number"), and a draft offers Add Another Item and Send Request once pressed; Send Request is a new card, `my_expenses.submit` (§9, §5 unchanged: it calls `submit`).
- 11/11/2026 · AJ · From the Milestones Review of 11/11/2026 (TB): Category on New Request is a popover with a type filter and a server search (§3, §10.1), not a dropdown, since thirty or forty categories are searched, not scrolled; Bank is typed or picked from `GET /expenses/banks` with Add for a bank it does not know (§3, §5, §6.1); Payee Name's example is a name, not the reader's own; a paid disbursement shows Open Receipt (§10.1). Staff asking from their own department only was checked at the review and holds (§8).

- 06/11/2026 · TB · Merging M7 PR 2 (#80): Categories' New Category is New Expense Category in ⌘K and the phone's floating button (§9, §10.2), as Partnerships' is New Partner Category, since ⌘K holds each label once; the header button, the form and the User Guide's step are unchanged. A note for AJ is in `docs/handoff/m8-expenses.md` §6.
- 05/11/2026 · AJ · The audit's F5 to F25 fixed (`docs/handoff/m8-expenses-audit.md` §4): Withdraw on every screen an `expenses.finance` holder opens an approved request (Requisitions, Disbursements, a project's or a requisition's request), Cancel Request until then, each after a confirm (§2, §10.1); Expenses · Projects gated on its read, Set Budget on `expenses.finance` (§2); the recount locks its lines first (§6.6 rule 3); one budget per department per year in migration 8020, its owner the head now, a line only uncounted requests name taken away (rule 5); the monthly report's budgets as `/budgets` reads them (rule 8); Possible Duplicates named only to a reader who may open them, the rest a count (§6.8, `possible_duplicates_hidden`, §5); `disbursed_from` and `approved_by_me_from` on `ExpenseListQuery` for the KPI cards (§5, §10.1); Read Invoice on Gemini through its native file reading, a refused file Unreadable (§9).
- 05/11/2026 · AJ · PR 7 built §10: every screen on the contract and the real API, records in `ListDetail layout="modal"`, My Requests in ESS, Projects (#106), the mock on the contract, the User Guide chapter. Decided on the way: Read Invoice and Suggest Category fill the form for the person to check, nothing saved until they press (§9, §10.1; no separate Use It); Categories opens a category in its Edit Category form, not a record modal; My Requests' In Flight card reads `in_flight` on `ExpenseListQuery` (§5); New Category, Record Disbursement and New Budget cards carry their forms' schemas (§9).

- 05/11/2026 · AJ · PR 7, backend half: `GET /expenses/:id/history` (§3 step 8, §5) reads the requisition's and disbursement's events that name the request, closing audit F3; the reference seed 8101 and the staging seed `80_expenses.js` take 8099's five categories out, closing F4 (§4); Home's forward expense and budget rows are gone from `lib/forward-rows.js`, replaced by the new seed's (DATABASE_SCHEMA M8). The screens are not moved yet.

- 05/11/2026 · AJ · PR 6 built the three AI features (§9): Read Invoice on Image Reading, Suggest Category and Check Duplicate on Default, each on the person's press and kept nowhere. Decided on the way: the duplicate flag is the database's (`possible_duplicates`, §6.8), the model only compares on Check Duplicate and is told nothing about who; three routes (§5); `complete()` takes files for an Image Reading action (`ai-control.md` change log).

- 05/11/2026 · AJ · PR 5 built §5's budget and project routes, the recount, the budget-threshold job and the monthly report. Decided on the way: Over Budget is measured against the category line with the department's whole remaining shown beside it (§6.6 rule 3, audit F1, AJ); the flag is worked out again for every request still deciding whenever its line moves (rule 3, audit F2); a request with no line or no department is flagged (rule 3); a budget saved counts requests already sent (rule 4); a budget is in force once saved, owned by the department's head, and a line in use is set to 0, never taken away (rule 5); `GET /budgets/:id` added (§5); Expenses · Projects needs scope all (rule 6); the threshold counts committed and spent (rule 7); the monthly report is Home's `expenses_monthly` source (rule 8); the card schemas `BudgetLinesChange` and `ProjectBudgetSet` and the card Set Budget (§9).

- 05/11/2026 · AJ · From the review's transcript (26:29): Expenses · Projects offers New Request with the project filled (§2, §3 step 7, §10.1; handoff decision 17). The transcript, not Gemini's summary, is the record: requisitions and department budgets stay (handoff §1).

- 05/11/2026 · AJ · PR 3 and PR 4 built §5's request, category, requisition and disbursement routes. Decided on the way: Send Back withdraws the approval and Send Again opens a new one (§6.1 rule 6); `GET /expenses/approvals/summary` for the Approvals cards (§5); invoices and receipts claimed from the upload engine through `vault.claim` (§5); the card schemas `ExpenseRequestAdd`, `ExpenseChange`, `ExpenseLineAdd`, `ExpenseCategoryChange`, `DisbursementReferenceAdd` (§9); until PR 5 recounts the budgets, a request with no budget line is not flagged Over Budget (§6.6 rule 3 applies from PR 5).

- 05/11/2026 · AJ · Decided the two open questions: the category suggestion is built in PR 6 on Default (§9); Home's Budget Used counts spent and committed (handoff decision 16). §13 now has none.
- 05/11/2026 · AJ · DTT confirmed as Dedicated Task Team: the payee type reads Dedicated Task Team (DTT); its code stays `task_team`. Taken off §13.
- 04/11/2026 · AJ · PR 2 built §4's tables (8010, 8100) and §5's contract shapes. Decided on the way: NGN only is held by the contract and the service, not a CHECK (Home's sums leave other currencies out); `expenses.finance` goes to the Implementation Team too, which holds every capability.
- 04/11/2026 · AJ · Written from the Modules Review of 04/11/2026: no thresholds, the reference warned not required, line items, payees with Use My Company Account, requisitions kept as Operations & People's batch, department and project budgets, My Requests in ESS, the modal, the twelve suggested categories, nothing imported from the expenditure sheet.
