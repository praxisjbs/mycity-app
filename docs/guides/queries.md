# Queries & Sanctions · Engineering Guide

| | |
|---|---|
| Owner | GE |
| Milestone | M3 |
| Backend modules | `queries`, `query_rules`, `sanctions`, `templates` |
| Frontend paths | `app/src/features/queries/` |
| Permission key(s) | `queries` |
| Capabilities | `queries.configure` (write query rules, the consequence chain and letter templates: the writes on Rules, Sanctions · Chain Settings and Letter Templates) |
| Screens (PROGRESS.md rows) | #34 Queries, #35 Rules, #36 Sanctions, #37 Letter Templates; reads shared with #13 ESS · My Queries (AJ) and the employee 360 |
| Status | Draft |
| Last changed | 19/10/2026 |

Sources: MILESTONES §8 (scope and definition of done); REUSE_MAP §4; DATABASE_SCHEMA M3; ESS guide
§3 step 3, §6 and §8 (what the employee sees); attendance guide §13 (the late-arrival query is this
milestone's). Four decisions taken with GE on 19/10/2026 before this guide was written are recorded
in §13 as settled: the chain is a step table over the approval engine, the ladder has six rungs,
every sanction follows a query, and a query a rule raised is seen by People and the CEO only.

---

## 1 · What it is for

Due process for MyCity staff. A manager, or a rule the system runs, raises a query; the employee
answers it in writing; someone with authority decides. Most queries close with no action. When one
is upheld, the outcome is the next rung of MyCity's own consequence ladder, approved, written up as a
letter, filed to the employee's documents and mailed to them, with any fine waiting for payroll.

Used by line managers and heads of department (raise queries, read the answers to their own), People
(Operations & People: every query, the decisions, the rules, the chain and the letters), Management
and the CEO (approve the heavier sanctions). The employee sees their own queries and sanctions in
ESS · My Queries.

## 2 · Screens affected

| Screen / tab (slug) | Where | Who sees it | What it shows | What a person can do there |
|---|---|---|---|---|
| Queries & Sanctions · Queries (`queries`) | Staff app | `queries` view: scope `all` sees every query; anyone else only the queries they raised (§6.1) | KPI strip (open, awaiting response, closed this month, escalated), the query list, the open query's card (subject, raised by, due, the response, the letter), Queries by Reason | Raise a Query, Send Reminder, View Letter, Record Decision (close with no action, or propose a sanction) |
| Queries & Sanctions · Rules (`rules`) | Staff app | `queries` view; writes need `queries.configure` | KPI strip (active, draft, fired this month, queries raised), one card per rule with its threshold, Recent Firings | New Rule, Edit Rule, Activate, Pause |
| Queries & Sanctions · Sanctions (`sanctions`) | Staff app | `queries` view, same visibility as the query a sanction follows | KPI strip (active, awaiting approval, fines this year, fines recovered), sanction history, a person's standing on the ladder | Issue Sanction (from an upheld query), Chain Settings (needs `queries.configure`): add, reorder, edit or retire a rung |
| Queries & Sanctions · Letter Templates (`letter-templates`) | Staff app | `queries` view; writes need `queries.configure` | KPI strip, the template list with status, the selected template's preview filled with sample values | New Template, Edit Template, Preview, Activate |
| ESS · My Queries (`my-queries`) | Staff app | Every employee, own records (ESS guide) | Open Queries, Archived, Sanctions | Respond to an open query; open a letter |
| Employee 360 · History | Staff app | `people` view within scope | The person's queries and sanctions, append-only, newest first | Open the query or sanction |
| My Approvals (`approvals`) | Staff app | The approvers of `queries.consequence` | A proposed sanction waiting on them | Approve, Reject, Request Changes |
| Notification bell | Both shells | The employee; the raiser; People | Query raised, reminder, response in, sanction issued | Open the record |
| ⌘K | Both shells | Within the reader's visibility | Queries by number, person and subject; sanctions by number and person | Open the record |

## 3 · How the screens relate

1. **A rule raises a query.** Attendance commits a late punch (`attendance.punched`, result `late`).
   The outbox hands it to the rule evaluator (`query_rules.evaluator`, job `query-rule-evaluate`),
   which counts the person's late arrivals inside each active `lateness` rule's window, from the
   attendance service, never its tables. On the third (the rule's threshold) it raises **one** query
   through `queries.service.raise()`, the same function a manager's form calls, with the counted
   days as evidence and the rule's query letter. The fourth and fifth late arrivals count towards the
   next breach, not this one (§6.3). The rule's firing shows on Rules · Recent Firings.
2. **A manager raises a query.** Queries · Raise a Query → `POST /queries` → the same `raise()`. The
   query is numbered (`QRY-0001`), its letter is generated and filed (§6.7), and `query.raised`
   notifies the employee (opening ESS · My Queries) and emails them the letter.
3. **The employee responds.** ESS · My Queries → `POST /ess/queries/:id/response` → through
   `queries.response`. The query moves to Under Review and `query.responded` tells whoever raised it
   (People when a rule raised it). One response a query; it is never edited.
4. **Someone decides.** Queries · Record Decision → `POST /queries/:id/decision`. Close with no
   action resolves the query. Propose a sanction names a rung of the chain (the next rung for this
   person is offered first, §6.5) with the reason, the evidence and an optional fine, writes a
   `sanction` waiting for approval and opens the `queries.consequence` approval in the same
   transaction. The query shows as escalated.
5. **The approval decides the sanction.** My Approvals → `POST /workflow/instances/:id/approve`.
   `workflow.completed` for `queries.consequence` reaches `sanctions.events`: approved issues the
   sanction (numbered `SAN-0001`), generates the rung's letter, files it and mails it; any fine
   becomes pending for payroll (§6.6); the query is resolved. Rejected withdraws the proposal and
   the query returns to Under Review so a different decision can be recorded.
6. **Payroll takes the fine.** M6 reads pending fines through `sanctions.fines` and accepts each one
   into a run, or waives it with a reason. ESS · My Payslips shows the deduction with its query
   number (ESS guide §6).
7. **The record stays.** Every step is on the employee 360 and in ESS · My Queries, append-only.

## 4 · Data

| Table | Key columns | Notes |
|---|---|---|
| `query_rule` (3000, extended by 3010) | `code`, `name`, `source_event`, `measure`, `threshold`, `window_days`, `letter_template`, `active`, `activated_at` | One rule a row. `source_event` is the trigger (§6.3). A rule is a draft until first activated (`activated_at` null), active, or paused (`active` false after activation). No rule is seeded: thresholds are MyCity's choice (A26) |
| `employee_query` (3000, 3010) | `number`, `employee_id`, `query_rule_id`, `raised_by`, `subject`, `details`, `evidence`, `status`, `outcome`, `response_due_at`, `reminded_at`, `dedup_key`, `letter_document_id`, `workflow_instance_id`, `reviewed_by`, `reviewed_at` | `raised_by` null means a rule raised it. `dedup_key` is unique, so a breach delivered twice raises one query. `status` is `awaiting_response`, `under_review`, `resolved`; `outcome` is `no_action` or `sanctioned` once resolved |
| `query_response` (3000) | `employee_query_id`, `employee_id`, `body`, `submitted_at` | One per query, never updated |
| `consequence_step` (3010) | `code`, `name`, `position`, `letter_template`, `financial_effect`, `default_days`, `valid_days`, `evidence_required`, `active` | MyCity's ladder, one rung a row, ordered by `position`. Entered on Chain Settings, not seeded (A26). `financial_effect`: `none`, `unpaid_days`, `ends_employment` |
| `sanction` (3000, 3010) | `number`, `employee_query_id`, `employee_id`, `consequence_step_id`, `sanction_type`, `reason`, `evidence`, `decided_by`, `effective_on`, `ends_on`, `status`, `workflow_instance_id` | Always from a query (NOT NULL). `sanction_type` is the rung's code at the time, kept if the rung is renamed. `status`: `pending_approval`, `issued`, `rejected`, `withdrawn` |
| `sanction_fine` (3000) | `sanction_id`, `amount_ngn`, `settlement_status`, `settled_at` | An attachable outcome on any sanction, never a rung. `pending` until M6 accepts it into a run (`accepted`, then `settled`) or waives it |
| `sanction_letter` (3000) | `sanction_id`, `document_id`, `letter_type` | The issued letter, from the vault |
| `letter_template` (3010) | `key`, `name`, `purpose`, `status` | The letters this module may send. The wording is `template_version` (0080) under the same key; the shipped default is `templates/documents/<key>.html`. `purpose`: `query` or `sanction` |

Schema migration file(s): `migrations/3000_queries_sanctions.sql` (merged), `migrations/3010_queries_chain.sql`.
Reference-data file(s): `seeds/reference/3099_seed_queries_sanctions.sql` (merged),
`seeds/reference/3190_seed_queries_chain.sql`: the `queries.configure` capability and its holders,
the `queries.consequence` approval, the shipped letter templates' rows, and `3099`'s invalid
`employee_consequence` definition switched off. Numbering schemes `query`, `sanction` and `letter`
are already seeded by `0099`.

## 5 · API

Contract files: `schemas/queries.js`, `schemas/query_rules.js`, `schemas/sanctions.js`,
`schemas/templates.js`.

| Method and path | Contract | Permission · scope | Paged | Notes |
|---|---|---|---|---|
| `GET /api/v1/queries/summary` | → `QueriesSummary` | `queries` view · §6.1 | no | |
| `GET /api/v1/queries` | `QueryListQuery` (`status`, `employee_id`, `raised`: `mine`, `rules`, `q`, `sort`) → `QueryPage` | `queries` view · §6.1 | yes, 25 | |
| `GET /api/v1/queries/:id` | → `QueryDetail` | `queries` view · §6.1 | no | 404 outside visibility |
| `POST /api/v1/queries` | `QueryCreate` → `QueryDetail` | `queries` create | | Idempotency-Key |
| `POST /api/v1/queries/:id/remind` | `EmptyBody` → `QueryDetail` | `queries` create · §6.1 | | Once a day, while awaiting a response |
| `POST /api/v1/queries/:id/decision` | `QueryDecision` → `QueryDetail` | `queries` edit · §6.1 | | §6.4 |
| `GET /api/v1/query-rules/summary` | → `QueryRulesSummary` | `queries` view | no | |
| `GET /api/v1/query-rules` | `QueryRuleListQuery` (`state`, `source_event`, `q`, `sort`) → `QueryRulePage` | `queries` view | yes, 25 | |
| `POST /api/v1/query-rules` | `QueryRuleCreate` → `QueryRule` | `queries` create, `queries.configure` | | Saved as a draft |
| `PATCH /api/v1/query-rules/:id` | `QueryRuleUpdate` → `QueryRule` | `queries` edit, `queries.configure` | | |
| `POST /api/v1/query-rules/:id/activate` | `EmptyBody` → `QueryRule` | `queries` edit, `queries.configure` | | |
| `POST /api/v1/query-rules/:id/pause` | `EmptyBody` → `QueryRule` | `queries` edit, `queries.configure` | | |
| `GET /api/v1/query-rules/firings` | `QueryRuleFiringListQuery` (`query_rule_id`) → `QueryRuleFiringPage` | `queries` view · scope `all` sees all; else firings whose query the reader may see | yes, 25 | A firing is a rule-raised query |
| `GET /api/v1/sanctions/summary` | → `SanctionsSummary` | `queries` view · §6.1 | no | |
| `GET /api/v1/sanctions` | `SanctionListQuery` (`status`, `employee_id`, `consequence_step_id`, `q`, `sort`) → `SanctionPage` | `queries` view · §6.1 | yes, 25 | |
| `GET /api/v1/sanctions/:id` | → `SanctionDetail` | `queries` view · §6.1 | no | |
| `GET /api/v1/sanctions/standing` | `SanctionStandingQuery` (`employee_id`) → `SanctionStanding` | `queries` view · §6.1 | no | The rungs in force and the next one |
| `GET /api/v1/sanctions/chain` | `ConsequenceStepListQuery` (`active`) → `ConsequenceStepPage` | `queries` view | yes, 25 | In ladder order |
| `POST /api/v1/sanctions/chain` | `ConsequenceStepCreate` → `ConsequenceStep` | `queries` create, `queries.configure` | | `position` inserts it there; the rungs below move down |
| `PATCH /api/v1/sanctions/chain/:id` | `ConsequenceStepUpdate` → `ConsequenceStep` | `queries` edit, `queries.configure` | | Moving, renaming, retiring |
| `GET /api/v1/letter-templates/summary` | → `LetterTemplatesSummary` | `queries` view | no | |
| `GET /api/v1/letter-templates` | `LetterTemplateListQuery` (`purpose`, `status`, `q`) → `LetterTemplatePage` | `queries` view | yes, 25 | |
| `GET /api/v1/letter-templates/:id` | → `LetterTemplateDetail` | `queries` view | no | The current wording and its version |
| `GET /api/v1/letter-templates/:id/preview` | → `LetterPreview` | `queries` view | no | Rendered with sample values |
| `POST /api/v1/letter-templates` | `LetterTemplateCreate` → `LetterTemplateDetail` | `queries` create, `queries.configure` | | Saved as a draft |
| `PUT /api/v1/letter-templates/:id/body` | `LetterTemplateBodySave` → `LetterTemplateDetail` | `queries` edit, `queries.configure` | | A new `template_version` |
| `POST /api/v1/letter-templates/:id/activate` | `EmptyBody` → `LetterTemplateDetail` | `queries` edit, `queries.configure` | | Refused while it has no wording |
| `GET /api/v1/ess/queries` | `EssQueryListQuery` (`status`: `open`, `archived`) → `MyQueryPage` | `ess` · own | yes, 25 | ESS module, through the queries service |
| `POST /api/v1/ess/queries/:id/response` | `QueryResponseCreate` → `MyQuery` | `ess` · own | | Through `queries.response` |
| `GET /api/v1/ess/sanctions` | `PageQuery` → `MySanctionPage` | `ess` · own | yes, 25 | |

Each module mounts its own base path (`/queries`, `/query-rules`, `/sanctions`,
`/letter-templates`), so no router's `/:id` meets another's word. A proposed sanction is decided
with the approval's own routes (`POST /workflow/instances/:id/approve`, `reject`), never a route
here.

## 6 · Rules and calculations

### 6.1 Who sees a query (the hard rule)

- Scope `all` on `queries` (Implementation, Operations & People, Management) and the CEO see every
  query and sanction.
- Anyone else sees **only the queries they raised** (`employee_query.raised_by` = their user), and
  the sanctions that follow those queries, whatever their scope says. Scope `team` does not widen it:
  a manager does not see a query another manager, or a rule, raised on their team.
- A query a rule raised (`raised_by` null) is seen by scope `all` and the CEO only.
- The employee sees their own in ESS, never on these screens.
- `queries.visibility` is the one predicate; the repo, the search provider, the AI reads and the
  summaries all use it. A record outside it is a 404, not a 403.

### 6.2 Raising a query

- One path: `queries.service.raise()` for the form, a rule, the AI's route and a script.
- Subject 4 to 150 characters, details 20 to 4,000. The employee must be active and must not be the
  person raising it.
- `response_due_at` is raised-at plus the response window, 48 hours unless Settings · Queries
  (M9) says otherwise. After it passes without a response the query still waits, and a decision may
  be recorded.
- The query letter is generated in the same transaction (§6.7). A manual query uses the active
  letter template of purpose `query` chosen on the form, or the default `query-letter`.

### 6.3 Rules

- A rule is `{ source_event, measure, threshold, window_days, letter_template }`. Triggers:
  `lateness` (a late punch), `absence` (an absent day at the day-close), `missing_clock_out` (the
  day-close opened one), `unenrolled_device` (a punch from a device not on the person's list),
  `overdue_task` (M2 tasks), `missed_target` (an M2 KPI closed below its target).
- `measure` is `count` (events) or `minutes` (late minutes summed, `lateness` only), so "three late
  arrivals in thirty days" and "five cumulative hours in a month" are both settings
  (MILESTONES §8 left the number open).
- The window is `shared/rules/window-counter`: the `window_days` days ending on the event's date,
  in Lagos dates.
- Counting starts after the last query the same rule raised for the person, so three late arrivals
  raise exactly one query, and the next query needs three more. The counted dates are the query's
  evidence.
- `dedup_key` is `<query_rule_id>:<employee_id>:<breach date>`; the outbox delivers at least once,
  and the unique key makes the second delivery a no-op.
- Counts come from the owning module's service (attendance, tasks, kpis), never their tables.
- A draft or paused rule never fires. Activating a rule does not reach back: it counts events from
  its activation onwards.
- A rule may not be deleted once it has fired; it is paused.

### 6.4 Deciding a query

- Needs `queries` edit and visibility (§6.1). The person the query is about can never decide it.
- Before the response window ends, a decision needs the employee's response; after it, it does not.
- **Close, no action**: a reason of at least 10 characters. Status `resolved`, outcome `no_action`.
- **Propose a sanction**: a rung (`consequence_step_id`), a reason, evidence when the rung requires
  it, the dates when its financial effect is `unpaid_days`, an optional fine. Writes the `sanction`
  as `pending_approval` and opens `queries.consequence` with context `{ rank, fine_amount }`, in one
  transaction. One open proposal a query.

### 6.5 The chain

- The rungs, top to bottom, are `consequence_step` rows in `position` order. MyCity's ladder (Cynthia,
  10 October): Caution, Warning, Second Warning, Suspension, Suspension Without Pay, Dismissal or
  Termination. It is entered on Chain Settings; adding a rung is inserting a row at a position.
- A rung names: its letter template, its financial effect, its default length in days (suspensions),
  how long it stays in force for escalation (`valid_days`, null for ever) and whether evidence is
  required.
- **Next rung**: the rung after the highest one still in force for the person (issued, and inside
  its `valid_days`). With none in force it is the first rung. This is what a second offence offers
  without code. People may choose a different rung; the choice and reason are recorded.
- A retired rung keeps its sanctions; it is no longer offered. A rung with sanctions is never deleted.
- Who decides is the `queries.consequence` approval, edited on Settings · Approvals: Operations &
  People for every rung, then Management from rank 4 (Suspension and above, by position at the
  time). The rank travels in the approval's context, so a definition change never needs code.

### 6.6 Fines

- A fine is never a rung: it attaches to any sanction (property damage, deducted from salary).
- Amount `numeric(18,2)` in Naira, a string on the wire, above 0.00.
- It is `pending` once the sanction is issued, and reaches the payroll run only when M6 accepts it
  (`sanctions.fines.accept`) or is waived with a reason. It is never automatic.

### 6.7 Letters

- Every query and every issued sanction has a letter: `documents.generate()` from the current
  version of its template, inside the letterhead, numbered `LTR-0001`, filed to the employee's
  documents (`personal`), rendered to PDF in the worker and emailed after commit.
- One variable schema serves every letter (`ConsequenceLetterVars`: the employee, the record's
  number, subject or rung, reason, dates, fine, response due, signer), so a template added on the
  screen fills from the same record.
- An edit saves a new `template_version`; a letter records the version it used. A template is
  `awaiting_sample` while it has no wording (the sanction letters' files stay empty until MyCity
  sends the samples; `query-letter` ships with wording and is seeded active, so a rule can raise a
  query on a fresh database), `draft` until activated, `active`, or `retired`. Only an active
  template can be chosen.
- Letter templates added on the screen take a key `<slug>-letter`; generate() is given the template
  key with the shared doc types `query_letter` and `sanction_letter` (a small extension to
  `shared/documents/generate.js`: an explicit `template` for a doc type that allows it).

### 6.8 Every outcome is recorded

Each decision keeps reason, evidence, decision-maker and date (`reviewed_by`, `decided_by`, the
approval's decisions). Queries, responses, sanctions and letters are never deleted or edited after
the fact; a mistake is a withdrawn sanction or a further note, both audited.

## 7 · Events, jobs and notifications

| Event / job | When | Does |
|---|---|---|
| `query.raised` | After a query commits | Notification and email (with the letter) to the employee; Queries list refresh |
| `query.reminded` | Send Reminder | Notification and email to the employee |
| `query.responded` | The employee responds | Notification to the raiser, or People when a rule raised it |
| `query.closed` | Close, no action | Notification to the employee |
| `query.escalated` | A sanction is proposed | Opens `queries.consequence`; the engine tells the first approvers |
| `query_rule.fired` | A rule raised a query | Recent Firings refresh |
| `query_rule.saved`, `query_rule.activated`, `query_rule.paused` | Rules writes | Audit |
| `sanction.issued` | `queries.consequence` approved | Letter generated, filed, emailed; fine pending; query resolved; notification to the employee |
| `sanction.rejected` | The approval rejected it | Proposal withdrawn; the proposer is told |
| `consequence_step.saved` | Chain Settings writes | Audit |
| `letter_template.saved`, `letter_template.activated` | Letter Templates writes | Audit |
| job `query-rule-evaluate` | Outbox, on each trigger event | Counts and raises (§6.3); idempotent |

## 8 · Permissions and visibility by role

| Role | Sees | Can do |
|---|---|---|
| Employee | Their own queries and sanctions, in ESS only | Respond |
| Line Manager (`manager`, `queries` team, view and create) | Queries they raised | Raise, remind; read the response |
| Head of Department (`queries` team, view, create, edit, approve) | Queries they raised | Raise, remind, decide their own queries |
| Operations & People (`queries` all) | Everything | Everything, including rules, chain and letters (`queries.configure`); first approver of every sanction |
| Management (`queries` all, no delete) | Everything | Decide; second approver from Suspension up |
| Implementation | Everything | Everything (`queries.configure`) |
| CEO | Everything | Everything; holds every capability |

`queries.configure` is held by default by Implementation and Operations & People (seed `3190`).
Restricted fields: none beyond the employee's own masks; a query's evidence carries dates and
counts, never coordinates or device identifiers.

## 9 · AI and search

- **AI reads** (`queries.ai.js`, `sanctions.ai.js`): `queries.list` and `queries.get` (open and
  closed queries the reader may see, §6.1), `sanctions.list`, `sanctions.standing` (a person's rungs
  in force and the next one). `queries` view, paged at 25, cited by number. `query_rules` and
  `templates` carry `// ai:none` (configuration, nothing a question needs).
- **AI routes**: "raise a query for <person>" → `queries.queries` with `new: 1` and the employee
  prefilled; "issue a sanction" → `queries.sanctions`.
- **Search** (`queries.search.js`, `sanctions.search.js`): queries by number, employee and subject
  ("query", "QRY"); sanctions by number, employee and rung ("sanction", "warning", "suspension").
  Both use §6.1, so a manager finds only their own: the provider pins results to the raiser
  (`owner: { column: "q.raised_by", exceptAll: true }`), lifted for scope all. `query_rules` and `templates` carry
  `// search:none` with their screens registered in the route map.

## 10 · On screen and mobile

**§3 and §6 are for engineers: nothing in them reaches a screen unless it is listed here as tier 1
or tier 2.**

### 10.1 Content tiers

| Screen | Open (tier 1) | Behind help (tier 2) | Not on screen (tier 3), lives in |
|---|---|---|---|
| Queries | KPI strip; the list (employee, number, subject, raised by, raised, response, status); the query card (subject, raised by or Rule, raised, response due, response, letter); Raise a Query, Send Reminder, View Letter, Record Decision | Help on Escalated: a sanction is waiting for approval. Help on Response Due: the 48 hour window | Who can see which query, the dedup, how a rule counts: §6 here, the manual |
| Record Decision | Outcome (Close No Action, or a rung with the next rung first), reason, evidence, fine, dates | Help on the next rung: why it is offered | The approval route and its thresholds: Settings · Approvals, §6.5 |
| Rules | KPI strip; rule cards (name, trigger, threshold as "3 in 30 days", status); Recent Firings; New Rule, Activate, Pause | Help on Measure: count or late minutes | Counting after the last query, the dedup key: §6.3 |
| Sanctions | KPI strip; the history (employee, number, sanction, reason, decided by, date, fine, status); a person's standing on the ladder; Issue Sanction, Chain Settings | Help on Fines Recovered: accepted into payroll | The rank rule for approvals, valid_days mechanics: §6.5 |
| Chain Settings | The rungs in order (name, letter, financial effect, in force for); Add Rung, Move, Edit, Retire | Help on In Force For: how long a rung counts for the next offence | Why a fine is not a rung: §6.6 |
| Letter Templates | KPI strip; the list (template, used for, status); the preview; New Template, Edit, Preview, Activate | Help on the variables a letter can use | Versioning, the shipped defaults: §6.7 |

### 10.2 Phone layout

| Screen | First on a phone | Left off a phone | Main action | Navigation |
|---|---|---|---|---|
| Queries | Two KPI cards (Open, Awaiting Response), then query cards with a status pill | Queries by Reason; the Number and Raised By columns | Raise a Query, full width; a query opens in a sheet with Record Decision at its foot | Bottom bar More → Queries; the four tabs scroll sideways |
| Rules | Rule cards, one a row, with Activate on drafts | Recent Firings | New Rule in the header | Tabs scroll sideways |
| Sanctions | Sanction cards with the rung and status | KPI strip after the first two; Chain Settings (desktop only) | Issue Sanction | Tabs scroll sideways |
| Letter Templates | The template list | The preview beside the list (it opens in a sheet instead); editing (desktop only) | Preview | Tabs scroll sideways |

## 11 · Edge cases

- **Double submit**: Raise a Query and Record Decision take an Idempotency-Key; one press, one request.
- **A rule fires twice for one breach** (outbox redelivery): the unique `dedup_key` makes it one query.
- **The employee is on leave or suspended** when a rule fires: the query is still raised; the
  response window starts when it is raised. People may close it with no action.
- **The employee leaves**: open queries stay open on their record; a decision can still be recorded.
- **The raiser leaves or changes role**: their queries stay theirs; People see them through scope all.
- **A rung is retired while a proposal waits on it**: the approval decides it as proposed.
- **A template is retired while a rule uses it**: the rule falls back to `query-letter`, and Rules
  shows the rule needs a letter.
- **No active letter template for a rung**: the sanction cannot be proposed on that rung; Chain
  Settings shows the rung needs a letter.
- **The chain is empty** (a fresh production): Record Decision offers Close, No Action only, and
  Sanctions shows the empty chain with Add Rung.
- **Huge lists**: every list pages at 25 on the server.
- **Raising a query on yourself**: refused.

## 12 · Donor code

| From | File | Change on the way in |
|---|---|---|
| praxis | `src/modules/hr/attendance/attendance.query.js` | The upsert on `(employee, work_date, rule)` becomes the rule evaluator's `dedup_key` over a window; no attendance tables read from here |
| pixie | `src/shared/hr_payroll/hr_ops.service.js` (the waive/uphold loop) | The pattern for the fine: pending until payroll accepts or waives it; nothing deducted automatically |
| praxis | `src/modules/hr/hr_query/`, `hr_sanction/` | Table shape only. No severity, no fixed sanction list, no currency in a column name |

## 13 · Open questions

- **Settled 19/10/2026 (GE).** The chain is `consequence_step` rows with `queries.consequence` on the
  approval engine deciding who approves, not one workflow definition whose stages are rungs.
  MILESTONES §8 says "a workflow definition"; the intent (a rung is data, adding one needs no code,
  A11 decides who approves) is kept.
- **Settled 19/10/2026 (GE).** The ladder has six rungs, as `3099` lists them, with Second Warning;
  AJ's screen gains it and "Dismissal" reads "Dismissal or Termination".
- **Settled 19/10/2026 (GE).** Every sanction follows a query (`sanction.employee_query_id NOT NULL`);
  Issue Sanction starts from an upheld query.
- **Settled 19/10/2026 (GE).** A query a rule raised is seen by scope `all` and the CEO only
  (MILESTONES §8). The Queries empty state that says otherwise changes.
- **The lateness threshold** (three, four, or five cumulative hours a month): MyCity, through
  Cynthia. Built as a rule setting; no default is seeded.
- **The ladder on production**: A26 keeps it out of the reference seed, so People enter the six
  rungs on Chain Settings at go-live; staging gets them from its seed. TB to confirm.
- **Dismissal or Termination** records the sanction and tells People; ending the employment stays
  in People · Employees (organisation). GE and TB, before the M3 demo.
- **The sample letters**: MyCity has sent the caution and warning letters; suspension, suspension
  without pay and termination are awaited (Cynthia).
- `sanction_fine.employee_accepted_at`, `employee_rejected_at` and `rejection_reason` (3000) are not
  used: an employee disputes a fine in their query response. Drop in a later release, or keep for
  M6. LA to say.

## 14 · Change log

- 19/10/2026 · GE · Queries built (§3 steps 1 to 4, §5, §6.1 to §6.4, §7, §9): raise, remind,
  close with no action, the ESS response, ⌘K and the AI reads. The letter is emailed with its PDF
  once rendered (`templates/email/query-raised.html`). ⌘K keeps §6.1 through the search provider's
  `owner: { exceptAll }`, a pin lifted for scope all. Proposing a sanction arrives with the
  sanctions module.
- 19/10/2026 · GE · Letter Templates built (§5, §6.7): `query-letter` ships with wording and is
  seeded active so a rule can raise a query on a fresh database; the sanction letters stay
  `awaiting_sample`. Letter variables carry ISO dates and the template formats them.
- 19/10/2026 · GE · Guide written before the build: screens, data (3010, 3190 on top of the merged
  3000 and 3099), API, rules, chain, letters, and the four decisions in §13.
