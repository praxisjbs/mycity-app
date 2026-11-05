# Expenses & Budget Control · Engineering Guide

| | |
|---|---|
| Owner | AJ |
| Milestone | M8 |
| Backend modules | `expenses`, `expense_categories`, `requisitions`, `disbursements`, `budgets` |
| Frontend paths | `app/src/features/expenses/` |
| Permission key(s) | `expenses` |
| Capabilities | `expenses.finance` (group approved requests into requisitions, record disbursements, set budgets, manage categories) |
| Screens (PROGRESS.md rows) | #56, #57, #58, #59, #60, #61; Projects gets its row with `new:screen` in PR 7 |
| Status | Agreed |
| Last changed | 04/11/2026 |

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
| Expenses · Requisitions (`requisitions`, #58) | staff app | `expenses.finance` holders and the CEO | approved requests not yet in a requisition; the requisitions and their status | tick requests and Create Requisition; the CEO opens one, removes a request, approves or rejects it |
| Expenses · Approvals (`approvals`, #57) | staff app | anyone a request's approval waits on (line managers, Operations & People) | requests waiting on the reader, with the invoice and the chain | Approve, Send Back, Reject |
| Expenses · Disbursements (`disbursements`, #59) | staff app | `expenses.finance` holders and the CEO | requests the CEO authorised, waiting to be paid; paid ones with their bank reference | Record Disbursement; Add Reference on one saved without it |
| Expenses · Projects (`projects`, row added in PR 7) | staff app | `expenses` view, all scope | each project's budget, committed, spent and remaining, and the requests under it | Set Budget (with `expenses.finance`); open a request |
| Expenses · Budgets (`budgets`, #60) | staff app | `expenses` view; a head sees their own department | each department's budget for the year by category: allocated, committed, spent, remaining | New Budget, Edit Budget (with `expenses.finance`); Budget History |
| Expenses · Categories (`categories`, #61) | staff app | `expenses` view | the categories, their type, this month's spend | New Category, Edit Category, Deactivate; Add Suggested Categories while there are none |
| Home · Overview, Expenses Awaiting Approval and Budget Used cards | staff app | as Home shows them | the requests waiting and the budget used | open the list |
| Settings · Approvals | staff app | Settings holders | the two flows `expenses.request` and `expenses.requisition` | change who approves, without a deploy |
| My Workspace projects | staff app | as Workspace shows them | the projects the Project picker offers | none here |
| Notifications (bell, push) | both shells | the people named in §7 | each step of a request | open the request |
| Praxis AI and ⌘K | both shells | within the reader's grant | requests, requisitions, disbursements, budgets, categories | ask, find, and draft the forms as cards (§9) |

## 3 · How the screens relate

1. **Raise.** An employee opens ESS · My Requests, New Request: what it is for (Purpose), Category,
   Project (optional, from the Workspace projects), Department (their own by default, picked from
   the org chart, never typed), one or more lines (Description, Quantity, Unit Price), the payee
   and the invoice. The payee is Staff, Vendor, Partner or Dedicated Task Team (DTT: the team MyCity pays by the day at activations). For Staff, Use My
   Company Account fills the bank details from their employee profile; for the others the bank,
   account name and account number are typed. Save Draft keeps it; Send Request submits it
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
   each project's. A request larger than its department's remaining budget is flagged before the
   line manager and Operations & People decide it, never after.
8. **History.** Every step is one event through `emit()`, so a request's history (raised, each
   decision with its reason, grouped, removed, authorised, paid, reference added) reads from the
   audit ledger and the approval's own record, on the request's modal.

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

Schema migration file(s): `migrations/8000_expenses.sql` (merged), `migrations/8010_expenses_chain.sql`.
Reference-data file(s): `seeds/reference/8099_seed_expenses.sql` (merged),
`seeds/reference/8100_seed_expense_flows.sql` (the two approval flows, the statuses, the
`expenses.finance` capability, numbering).

The five categories 8099 seeds (Travel, Office Supplies, Training, Utilities, Professional
Services) are a business choice A26 does not allow in a reference seed. They are taken out with
M8's staging seed (PR 7), because Home's staging rows point at them until then
(`seeds/staging/lib/forward-rows.js`).

## 5 · API

| Method and path | Contract | Permission · scope | Paged | Notes |
|---|---|---|---|---|
| `GET /api/v1/expenses/mine` | `ExpenseListQuery` → `ExpensePage` | self | yes, 25 | ESS · My Requests |
| `GET /api/v1/expenses/mine/summary` | → `ExpenseMineSummary` | self | no | the four KPI cards |
| `POST /api/v1/expenses/mine` | `ExpenseCreate` → `ExpenseRequest` | `expenses` create · own | | `submit: true` sends it at once |
| `PATCH /api/v1/expenses/mine/:id` | `ExpenseUpdate` → `ExpenseRequest` | `expenses` edit · own | | draft or sent back only |
| `POST /api/v1/expenses/mine/:id/submit` | `EmptyBody` → `ExpenseRequest` | `expenses` create · own | | Send Request, Send Again |
| `POST /api/v1/expenses/mine/:id/cancel` | `ExpenseCancel` → `ExpenseRequest` | `expenses` edit · own | | until Operations & People approve |
| `GET /api/v1/expenses` | `ExpenseListQuery` → `ExpensePage` | `expenses` view · all/team/own | yes, 25 | filters `status`, `category_id`, `project_id`, `department_id`, `payee_type`, `q` |
| `GET /api/v1/expenses/:id` | → `ExpenseRequest` | `expenses` view, or named on its approval | | lines, chain, history, budget check |
| `GET /api/v1/expenses/approvals` | `ExpenseListQuery` → `ExpensePage` | `expenses` approve | yes, 25 | waiting on the reader |
| `POST /api/v1/expenses/:id/withdraw` | `ExpenseCancel` → `ExpenseRequest` | `expenses` edit, `expenses.finance` | | after approval, before payment |
| `GET /api/v1/requisitions` | `RequisitionListQuery` → `RequisitionPage` | `expenses` view, `expenses.finance` | yes, 25 | the CEO passes |
| `POST /api/v1/requisitions` | `RequisitionCreate` → `Requisition` | `expenses` create, `expenses.finance` | | 1 to 25 approved requests |
| `GET /api/v1/requisitions/:id` | → `RequisitionDetail` | `expenses` view, `expenses.finance` | | its requests, paged in the detail |
| `POST /api/v1/requisitions/:id/remove` | `RequisitionRemove` → `RequisitionDetail` | the requisition's approver (the CEO) | | before it is decided |
| `GET /api/v1/disbursements` | `DisbursementListQuery` → `DisbursementPage` | `expenses` view, `expenses.finance` | yes, 25 | `reference_missing` filter |
| `POST /api/v1/disbursements` | `DisbursementCreate` → `Disbursement` | `expenses` create, `expenses.finance` | | `confirm_without_reference` |
| `PATCH /api/v1/disbursements/:id` | `DisbursementReference` → `Disbursement` | `expenses` edit, `expenses.finance` | | Add Reference |
| `GET /api/v1/budgets` | `BudgetListQuery` → `BudgetPage` | `expenses` view · all/team | yes, 25 | by year |
| `POST /api/v1/budgets`, `PATCH /api/v1/budgets/:id` | `BudgetCreate`, `BudgetUpdate` → `Budget` | `expenses` create, edit, `expenses.finance` | | lines by category |
| `GET /api/v1/budgets/:id/history` | `PageQuery` → `BudgetChangePage` | `expenses` view | yes, 25 | from the audit ledger |
| `GET /api/v1/budgets/projects` | `ProjectSpendListQuery` → `ProjectSpendPage` | `expenses` view · all | yes, 25 | Expenses · Projects |
| `PATCH /api/v1/budgets/projects/:id` | `ProjectBudget` → `ProjectSpend` | `expenses` edit, `expenses.finance` | | sets `project.budget_amount` through the projects service |
| `GET /api/v1/expense-categories` | `ExpenseCategoryListQuery` → `ExpenseCategoryPage` | `expenses` view | yes, 25 | the pickers read it 25 at a time (F32) |
| `POST /api/v1/expense-categories`, `PATCH /:id` | `ExpenseCategoryCreate`, `ExpenseCategoryUpdate` → `ExpenseCategory` | `expenses` create, edit, `expenses.finance` | | |
| `POST /api/v1/expense-categories/suggested` | `EmptyBody` → `ExpenseCategoryPage` | `expenses` create, `expenses.finance` | | only while there are none |

Approve, Send Back and Reject are the approval's own routes (`/workflow/instances/:id/approve`,
`request_changes`, `reject`), as every flow in the hub: whoever the stage names decides, with
`expenses` approve.

## 6 · Rules and calculations

### 6.1 A request

1. A request has 1 to 25 lines. Each line's amount is quantity times unit price, rounded to two
   places through `shared/money`; the request's `amount` is the sum of its lines. NGN only: a
   foreign invoice is converted before it is entered.
2. Send Request needs Purpose, Category, Department, at least one line, a payee and its bank
   details. An invoice is optional but asked for (the approvers see when there is none).
3. Payee type `staff` with Use My Company Account copies the bank name, account name and account
   number from the requester's employee record at the moment it is sent, so a later change to the
   profile does not change a request already in flight. Any other payee type types them.
4. A draft and a sent-back request are edited by their requester only. Nothing else is edited
   once sent: a change is a Send Back.
5. The requester cancels a request while it is a draft, sent back, or waiting on the line manager
   or Operations & People (its approval is withdrawn with it). Once Operations & People approve it,
   only an `expenses.finance` holder withdraws it, with a reason, until it is paid.

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
   remaining (or that has no line for its category) carries `over_budget: true` and the approvers
   see it before they decide. It is a flag, never a block.
4. A project's budget is optional. Its committed and spent are counted the same way over the
   requests that name it.
5. The budget-threshold job warns the department's head and Operations & People when a line
   passes 90% used (once per line per year).

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

## 7 · Events, jobs and notifications

| Event / job | When | Does |
|---|---|---|
| `expense_request.created`, `.updated` | a draft is saved | audit only |
| `expense_request.submitted` | Send Request, Send Again | opens `expenses.request`; the engine tells the first approver |
| `workflow.completed` for `expenses.request` | the last stage decides | copies the outcome onto the request (approved or rejected), recounts the budget line; the engine tells the requester |
| `workflow.changes_requested` for `expenses.request` | Send Back | the request is `sent_back`; the requester is told with the reason |
| `expense_request.cancelled`, `.withdrawn` | cancel, withdraw | the approval is withdrawn; a withdrawal tells the requester |
| `requisition.submitted` | Create Requisition | opens `expenses.requisition`; the engine tells the CEO |
| `requisition.request_removed` | the CEO removes one | the request's requester and Operations & People are told |
| `workflow.completed` for `expenses.requisition` | the CEO decides | every request in it moves (§6.4); Operations & People are told |
| `disbursement.recorded` | Record Disbursement | the requester is told it was paid |
| `disbursement.reference_added` | Add Reference | audit only |
| `budget.set`, `budget.changed` | a budget is saved | Budget History; the department's head is told of a change |
| `expense_category.created`, `.updated`, `.suggested` | Categories | audit only |
| `budget-threshold` scheduler | daily, 07:00 Lagos | §6.6 rule 5 |

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
  `expense_categories.ai.js`): requests by status, category, project, department and payee type;
  requisitions waiting on the CEO; disbursements with a reference missing; a department's or a
  project's budget, committed, spent and remaining. Paged at 25, with the reader's own grant and
  scope.
- **AI actions** (cards the person confirms; every create and edit form, the forms gate):
  New Request (from `ExpenseCreate`), New Category, Create Requisition, Record Disbursement,
  Add Reference, New Budget and Edit Budget; Approve and Reject through the Approvals cards already
  shipped. Each runs the module's own service function.
- **AI features** (PR 6; jobs chosen by AJ): invoice reading (Image Reading) fills amount, payee
  and category from an uploaded invoice for the person to accept; duplicate check (Default) flags a
  request with the same payee and amount within 30 days of another; a category suggestion (Default)
  proposes a category from the purpose and lines as the form is filled.
- **AI routes**: "raise an expense" to ESS · My Requests with New Request open; "set a budget" to
  Expenses · Budgets.
- **Search** (`expenses.search.js`, `requisitions.search.js`, `disbursements.search.js`,
  `budgets.search.js`, `expense_categories.search.js`): a request by number or purpose (words
  expense, request, claim), a requisition and a disbursement by number or bank reference, a budget
  by department and year, a category by name.

## 10 · On screen and mobile

Every list is 25 a page. A request, a requisition and a disbursement open in the shared Modal on
desktop and on a phone (F31 as amended for Expenses, 04/11/2026): the list takes the full height of
the screen, and nothing opens until a row is pressed. KPI cards that have records behind them open
their list in a modal (the ESS rule); Average Turnaround and Rejected open nothing.

### 10.1 Content tiers

| Screen | Open (tier 1) | Behind help (tier 2) | Not on screen (tier 3), lives in |
|---|---|---|---|
| ESS · My Requests | KPI cards In Flight, Disbursed This Year, Average Turnaround, Rejected; the list (Reference, Purpose, Amount, Submitted, Stage); New Request. The modal: lines, total, payee, invoice, the chain with who it waits on, history; Edit, Send Again, Cancel Request | help on Use My Company Account: "Pays the bank account on your profile." Help on Stage: "Who the request is waiting on now." | the approval routing and the budget recount: §3, §6 here, the manual |
| Expenses · Requisitions | Approved Requests (tick boxes, Create Requisition); Requisitions (Reference, Requests, Total, Submitted, Status). The modal: its requests, Remove, Approve, Reject (the CEO) | help on Requisitions: "Approved requests grouped for the CEO." | why requests are batched: MILESTONES §13, the manual |
| Expenses · Approvals | KPI cards With You, Total Value, Oldest, Approved This Month; the list; the modal with lines, invoice (opens as a PDF), budget remaining and an Over Budget pill; Approve, Send Back, Reject | help on Over Budget: "More than the department has left this year." | the chain's configuration: Settings · Approvals, this guide |
| Expenses · Disbursements | Waiting to Pay and Paid lists; Record Disbursement (Bank Reference, Receipt, Paid On); a Reference Missing pill and Add Reference. No chart (decision 7) | help on Bank Reference: "The bank's transaction ID for this transfer." | audit-anchor reasoning: §6.5 here |
| Expenses · Projects | projects with Budget, Committed, Spent, Remaining; a project's requests in its modal; Set Budget | help on Committed: "Approved but not yet paid." | how spend is counted: §6.6 |
| Expenses · Budgets | Year picker; departments with Allocated, Committed, Spent, Remaining; a budget's lines by category; New Budget, Edit Budget, Budget History | help on Remaining: "Allocated less committed and spent." | the 90% warning rule: §6.6 |
| Expenses · Categories | the list (Category, Type, This Month, Requests); New Category, Edit Category, Deactivate; Add Suggested Categories while empty | help on Type: "Capital is equipment kept for years." | A26 and where the defaults came from: §6.7, the handoff |

### 10.2 Phone layout

| Screen | First on a phone | Left off a phone | Main action | Navigation |
|---|---|---|---|---|
| ESS · My Requests | the four KPI cards two to a row, then request cards (purpose, amount, a stage pill) | Submitted date on the card | New Request, full width; the form is a full sheet, lines added one at a time | ESS tabs; bottom bar |
| Expenses · Requisitions | approved request cards with a tick, Create Requisition pinned at the bottom once one is ticked | the requisitions' Approved date | Create Requisition; in the sheet Approve, full width | Expenses tabs scroll sideways |
| Expenses · Approvals | the four KPI cards, then request cards with amount and requester | the requester's department | Approve, full width in the request's sheet, Send Back and Reject beside it | Expenses tabs scroll sideways |
| Expenses · Disbursements | Waiting to Pay cards, then Paid with the Reference Missing pill | the Paid On column | Record Disbursement, full width in the sheet | Expenses tabs scroll sideways |
| Expenses · Projects | project cards with a used bar and Remaining | Committed and Spent (in the sheet) | Set Budget in the sheet | Expenses tabs scroll sideways |
| Expenses · Budgets | year picker, then department cards with a used bar | the category lines (in the sheet) | Edit Budget in the sheet | Expenses tabs scroll sideways |
| Expenses · Categories | category cards with type and this month | Requests count | New Category | Expenses tabs scroll sideways |

## 11 · Edge cases

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

- 05/11/2026 · AJ · Decided the two open questions: the category suggestion is built in PR 6 on Default (§9); Home's Budget Used counts spent and committed (handoff decision 16). §13 now has none.
- 05/11/2026 · AJ · DTT confirmed as Dedicated Task Team: the payee type reads Dedicated Task Team (DTT); its code stays `task_team`. Taken off §13.
- 04/11/2026 · AJ · PR 2 built §4's tables (8010, 8100) and §5's contract shapes. Decided on the way: NGN only is held by the contract and the service, not a CHECK (Home's sums leave other currencies out); `expenses.finance` goes to the Implementation Team too, which holds every capability.
- 04/11/2026 · AJ · Written from the Modules Review of 04/11/2026: no thresholds, the reference warned not required, line items, payees with Use My Company Account, requisitions kept as Operations & People's batch, department and project budgets, My Requests in ESS, the modal, the twelve suggested categories, nothing imported from the expenditure sheet.
