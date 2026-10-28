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
| Last changed | 27/10/2026 |

Sources: MILESTONES §8 (scope and definition of done); REUSE_MAP §4; DATABASE_SCHEMA M3; ESS guide
§3 step 3, §6 and §8 (what the employee sees); attendance guide §13 (the late-arrival query is this
milestone's). Four decisions taken with GE on 19/10/2026 before this guide was written are recorded
in §13 as settled: the chain is a step table over the approval engine, the ladder has six rungs
(five since 27/10/2026, one suspension), every sanction follows a query, and a query a rule raised is
seen only by those who see every query and the CEO.

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
| Queries & Sanctions · Queries (`queries`) | Staff app | `queries` view: scope `all` sees every query; anyone else only the queries they raised (§6.1) | KPI strip (open, awaiting response, closed this month, escalated), the query list, the open query's card (subject, raised by, due, the policy cited, the response, the letter), Queries by Reason | Raise a Query, Send Reminder, View Letter, Record Decision (close with no action, or propose a sanction) |
| Queries & Sanctions · Rules (`rules`) | Staff app | `queries` view; writes need `queries.configure` | KPI strip (active, draft, fired this month, queries raised), one card per rule with its threshold, Recent Firings. Attendance's own rules are not here: they are the Attendance policy's (§6.3) | New Rule, Edit Rule, Activate, Pause |
| Queries & Sanctions · Sanctions (`sanctions`) | Staff app | `queries` view, same visibility as the query a sanction follows | KPI strip (active, awaiting approval, fines this year, fines recovered), sanction history | Issue Sanction (opens Queries: a sanction starts from a query's decision), Chain Settings: the ladder in order; Add Step, Move Up, Move Down, Retire need `queries.configure` |
| Queries & Sanctions · Letter Templates (`letter-templates`) | Staff app | `queries` view; writes need `queries.configure` | KPI strip, the template list with status, the selected template's preview filled with sample values | New Template, Edit Template, Preview, Activate |
| ESS · My Queries (`my-queries`) | Staff app | Every employee, own records (ESS guide) | One tab with a Queries and Sanctions switch: their queries, open ones first, and their issued sanctions | Respond to an open query in rich text; open a query's or a sanction's letter. Sanctions are read only |
| Employee 360 · Queries, Sanctions | Staff app | `people` view within scope, and `queries` view for the two tabs | Two tabs: the person's queries and their sanctions, each the ones the viewer may see (§6.1), newest first | Open the query (a sanction opens the query it follows) on Queries & Sanctions |
| The query's card on Queries (`queries`) | Staff app | Whoever the `queries.consequence` approval waits on (§6.5) | A proposed sanction waiting on them: its step, reason, fine | Approve Sanction (Operations & People sign it), Reject with a reason |
| Notification bell | Both shells | The employee; the raiser; People | Query raised, reminder, response in, sanction issued | Open the record |
| ⌘K | Both shells | Within the reader's visibility | Queries by number, person and subject; sanctions by number and person | Open the record |

## 3 · How the screens relate

1. **A rule raises a query.** Two kinds of rule raise one, both through `queries.service`, never a
   second path:
   - **The Attendance policy's rules** (late arrivals, early departures, absences, forgotten
     clock-outs, location flags; attendance.md §6.16, T3). Attendance counts them and records a
     breach; when the version in force has Raise Query on, it emits `attendance.rule_breached` with
     `raise_query`. The outbox hands it to `queries.raise_from_breach`, which raises **one** query for
     the breach (its days as evidence, its policy version cited, dedup `attendance-breach:<id>`) and
     links it back on the breach through the attendance service (`attachQuery`). Lateness is set
     there and only there (AJ with GE and TB, 27/10/2026).
   - **The rules on Rules** (§6.3): overdue tasks, low monthly scores, unregistered devices and,
     with M2's KPIs, missed targets. The evaluator (`query_rules.evaluator`, job
     `query-rule-evaluate`) counts each active rule's window from the owning module, never its
     tables, and on the threshold raises **one** query through `raiseForRule()` with the counted
     days or tasks as evidence. The next breach needs the threshold again (§6.3). The rule's firing
     shows on Rules · Recent Firings.
2. **A manager raises a query.** Queries · Raise a Query → `POST /queries` → the same `raise()`. The
   query is numbered (`QRY-0001`), its letter is generated and filed (§6.7), and `query.raised`
   notifies the employee (opening ESS · My Queries) and emails them the letter.
3. **The employee responds.** ESS · My Queries → `POST /ess/queries/:id/response` → through
   `queries.response`. The response is written in the rich text editor and arrives as HTML
   (`body_html`); the service turns it into Markdown with the one renderer's whitelist
   (`shared/documents/markdown.htmlToMarkdown`, as Policies do), so no tag survives, and keeps that.
   Every reader gets it back as blocks (`RichTextBlock`, drawn by `RichText`) and the letters as
   HTML from the same renderer. The query moves to Under Review and `query.responded` tells whoever
   raised it (People when a rule raised it). One response a query; it is never edited.
4. **Someone decides.** Queries · Record Decision → `POST /queries/:id/decision`. Close with no
   action resolves the query. Propose a sanction names a rung of the chain (the next rung for this
   person is offered first, §6.5) with the reason, the evidence and an optional fine, writes a
   `sanction` waiting for approval and opens the `queries.consequence` approval in the same
   transaction. The proposer does not sign it. The query shows as escalated.
5. **The approval decides the sanction.** The query's card shows **Approve Sanction** and **Reject**
   to whoever the approval waits on → `POST /sanctions/:id/approve` or `/reject`. At the Operations &
   People stage the approver draws their signature: it is kept through the vault, and they sign the
   letters (`sanction.signed_by`; MyCity's letters are signed by its People & Operations Lead, for the
   company). The service records it and decides the stage through the workflow service in the same
   transaction (`workflow.service.decideIn`). `workflow.completed` for `queries.consequence` reaches
   `sanctions.events`: approved issues the sanction (numbered `SAN-0001`), generates the rung's
   letter, files it and mails it; any fine becomes pending for payroll (§6.6); the query is resolved.
   Rejected withdraws the proposal and the query returns to Under Review so a different decision can
   be recorded.
6. **Payroll takes the fine.** M6 reads pending fines through `sanctions.fines` and accepts each one
   into a run, or waives it with a reason. ESS · My Payslips shows the deduction with its query
   number (ESS guide §6).
7. **The record stays.** Every step is on the employee 360 and in ESS · My Queries, append-only.

## 4 · Data

| Table | Key columns | Notes |
|---|---|---|
| `query_rule` (3000, extended by 3010, 3030) | `code`, `name`, `source_event`, `measure`, `threshold`, `window_days`, `letter_template`, `policy_id`, `policy_clause`, `active`, `activated_at` | One rule a row. `source_event` is the trigger (§6.3); `lateness`, `absence` and `missing_clock_out` are no longer offered (the Attendance policy's, §6.3), and a row with one never fires. A rule is a draft until first activated (`activated_at` null), active, or paused (`active` false after activation). No rule is seeded: thresholds are MyCity's choice (A26) |
| `employee_query` (3000, 3010, 3020, 3040) | `number`, `employee_id`, `query_rule_id`, `raised_by`, `source` (`person`, `rule` or `attendance`), `subject`, `details`, `evidence`, `status`, `outcome`, `response_due_at`, `reminded_at`, `dedup_key`, `letter_document_id`, `signature_document_id`, `policy_version_id`, `policy_clause`, `workflow_instance_id`, `reviewed_by`, `reviewed_at` | `raised_by` null means a rule raised it. `dedup_key` is unique, so a breach delivered twice raises one query. `status` is `awaiting_response`, `under_review`, `resolved`; `outcome` is `no_action` or `sanctioned` once resolved |
| `query_response` (3000) | `employee_query_id`, `employee_id`, `body`, `submitted_at` | One per query, never updated |
| `consequence_step` (3010) | `code`, `name`, `position`, `letter_template`, `financial_effect`, `default_days`, `valid_days`, `evidence_required`, `active` | MyCity's ladder, one rung a row, ordered by `position`. Entered on Chain Settings, not seeded (A26). `financial_effect`: `none`, `unpaid_days`, `ends_employment` |
| `sanction` (3000, 3010, 3020, 3040) | `number`, `employee_query_id`, `employee_id`, `consequence_step_id`, `sanction_type`, `letter_template`, `reason`, `evidence`, `decided_by`, `signature_document_id` and `signed_by` (the Operations & People approver who signed it, §6.4), `effective_on`, `ends_on`, `status`, `workflow_instance_id` | Always from a query (NOT NULL). `sanction_type` is the rung's code at the time, kept if the rung is renamed; `letter_template` its letter at the time, so a rung pointed at another letter later never strands an approved sanction (null before 3040: the rung's). `status`: `pending_approval`, `issued`, `rejected`, `withdrawn` |
| `sanction_fine` (3000) | `sanction_id`, `amount_ngn`, `settlement_status`, `settled_at` | An attachable outcome on any sanction, never a rung. `pending` until M6 accepts it into a run (`accepted`, then `settled`) or waives it |
| `sanction_letter` (3000) | `sanction_id`, `document_id`, `letter_type` | The issued letters, from the vault: the rung's, and `salary-deduction-letter` when it carries a fine |
| `letter_signature` (3050) | `user_id`, `document_id` | One a login: the signature they saved on Edit Signature, from the vault (§6.9). Replaced when they draw again; never printed on a letter itself (each letter keeps its own copy) |
| `letter_template` (3010) | `key`, `name`, `purpose`, `status` | The letters this module may send. The wording is `template_version` (0080) under the same key; the shipped default is `templates/documents/<key>.html`. `purpose`: `query`, `sanction` or `fine` (§6.6) |

Schema migration file(s): `migrations/3000_queries_sanctions.sql` (merged), `migrations/3010_queries_chain.sql`,
`migrations/3020_queries_signatures.sql` (the drawn signatures' `signature_document_id`),
`migrations/3030_queries_policy.sql` (the policy a rule names and a query cites), `migrations/3040_queries_attendance.sql` (the key from `attendance_rule_breach.employee_query_id` to the query it raised, owed since attendance's 1430, a query's `source`, and on `sanction` its signer `signed_by` and its `letter_template` at proposal), `migrations/3050_queries_my_signature.sql` (`letter_signature`, §6.9).
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
| `GET /api/v1/queries` | `QueryListQuery` (`status`, `employee_id`, `raised`: `mine`, `rules`, `raised_from` and `raised_to` (Lagos days, both inclusive; a review's month), `q`, `sort`) → `QueryPage` | `queries` view · §6.1 | yes, 25 | |
| `GET /api/v1/queries/:id` | → `QueryDetail` | `queries` view · §6.1 | no | 404 outside visibility. `approval` names the stage a proposed sanction waits on, whether the reader may decide it and whether they sign |
| `POST /api/v1/queries` | `QueryCreate` → `QueryDetail` | `queries` create | | Idempotency-Key |
| `POST /api/v1/queries/:id/remind` | `EmptyBody` → `QueryDetail` | `queries` create · §6.1 | | Once a day, while awaiting a response |
| `POST /api/v1/queries/:id/decision` | `QueryDecision` → `QueryDetail` | `queries` edit · §6.1 | | §6.4 |
| `GET /api/v1/queries/policies` | `CitablePolicyListQuery` (`q`) → `CitablePolicyPage` | `queries` view | yes, 25 | The policies a query or rule may cite: each with a published version in force, through `policies.service.citable()` |
| `GET /api/v1/queries/my-signature` | → `LetterSignature` | `queries` view | no | The reader's saved signature as a PNG data URL, or null (§6.9) |
| `PUT /api/v1/queries/my-signature` | `LetterSignatureSave` → `LetterSignature` | `queries` view | | Kept through the vault, replacing the last (§6.9) |
| `GET /api/v1/queries/assist` | → `AiAvailability` | `queries` create | no | Whether Write With AI may answer now: `off` or `limit` otherwise |
| `POST /api/v1/queries/assist` | `QueryDraftRequest` → `QueryDraft` | `queries` create | no | A Subject and What Happened; nothing is kept (§9) |
| `GET /api/v1/letter-templates/assist` | → `AiAvailability` | `queries` edit, `queries.configure` | no | As above, for the letter editor |
| `POST /api/v1/letter-templates/assist` | `LetterDraftRequest` → `LetterDraft` | `queries` edit, `queries.configure` | no | The letter's wording as HTML for the editor; nothing is kept (§9) |
| `GET /api/v1/query-rules/summary` | → `QueryRulesSummary` | `queries` view | no | |
| `GET /api/v1/query-rules` | `QueryRuleListQuery` (`state`, `source_event`, `q`, `sort`) → `QueryRulePage` | `queries` view | yes, 25 | Each rule with `has_fired` |
| `POST /api/v1/query-rules` | `QueryRuleCreate` → `QueryRule` | `queries` create, `queries.configure` | | Saved as a draft |
| `PATCH /api/v1/query-rules/:id` | `QueryRuleUpdate` → `QueryRule` | `queries` edit, `queries.configure` | | |
| `POST /api/v1/query-rules/:id/activate` | `EmptyBody` → `QueryRule` | `queries` edit, `queries.configure` | | |
| `POST /api/v1/query-rules/:id/pause` | `EmptyBody` → `QueryRule` | `queries` edit, `queries.configure` | | |
| `GET /api/v1/query-rules/firings` | `QueryRuleFiringListQuery` (`query_rule_id`) → `QueryRuleFiringPage` | `queries` view · scope `all` sees all; else firings whose query the reader may see | yes, 25 | A firing is a rule-raised query |
| `GET /api/v1/sanctions/summary` | → `SanctionsSummary` | `queries` view · §6.1 | no | |
| `GET /api/v1/sanctions` | `SanctionListQuery` (`status`, `employee_id`, `consequence_step_id`, `q`, `sort`) → `SanctionPage` | `queries` view · §6.1 | yes, 25 | |
| `GET /api/v1/sanctions/:id` | → `SanctionDetail` | `queries` view · §6.1 | no | |
| `GET /api/v1/sanctions/standing` | `SanctionStandingQuery` (`employee_id`) → `SanctionStanding` | `queries` view · §6.1 | no | The rungs in force and the next one |
| `POST /api/v1/sanctions/:id/approve` | `SanctionApprove` (`signature` at the Operations & People stage) → `SanctionDetail` | the approver the stage waits on (§6.5) | | Signs and approves the stage in one transaction; 422 `SIGNATURE_REQUIRED` without it there |
| `POST /api/v1/sanctions/:id/reject` | `SanctionReject` (`reason`, at least 10 characters) → `SanctionDetail` | the approver the stage waits on | | The query returns to Under Review |
| `GET /api/v1/sanctions/chain` | `ConsequenceStepListQuery` (`active`) → `ConsequenceStepPage` | `queries` view | yes, 25 | In ladder order |
| `POST /api/v1/sanctions/chain` | `ConsequenceStepCreate` → `ConsequenceStep` | `queries` create, `queries.configure` | | `position` inserts it there; the rungs below move down |
| `PATCH /api/v1/sanctions/chain/:id` | `ConsequenceStepUpdate` → `ConsequenceStep` | `queries` edit, `queries.configure` | | Moving, renaming, retiring |
| `GET /api/v1/letter-templates/summary` | → `LetterTemplatesSummary` | `queries` view | no | |
| `GET /api/v1/letter-templates` | `LetterTemplateListQuery` (`purpose`, `status`, `q`) → `LetterTemplatePage` | `queries` view | yes, 25 | |
| `GET /api/v1/letter-templates/:id` | → `LetterTemplateDetail` | `queries` view | no | The current wording and its version |
| `GET /api/v1/letter-templates/:id/preview` | → `LetterPreview` | `queries` view | no | The wording filled with sample values, as paragraphs of runs; `filled` marks the record's words (the demo build's preview) |
| `GET /api/v1/letter-templates/:id/preview.pdf` | → the PDF (`no_content`) | `queries` view | no | The letter as sent: sample values, the reader's saved signature, nothing stored (§6.7) |
| `POST /api/v1/letter-templates` | `LetterTemplateCreate` (`body_html` from the editor, or `body` in Markdown; `status` `draft` or `active`) → `LetterTemplateDetail` | `queries` create, `queries.configure` | | Save Draft or Save and Activate |
| `PUT /api/v1/letter-templates/:id/body` | `LetterTemplateBodySave` (`body_html` or `body`) → `LetterTemplateDetail` (with `body_html` for the editor) | `queries` edit, `queries.configure` | | A new `template_version` |
| `POST /api/v1/letter-templates/:id/activate` | `EmptyBody` → `LetterTemplateDetail` | `queries` edit, `queries.configure` | | Refused while it has no wording |
| `POST /api/v1/letter-templates/:id/deactivate` | `EmptyBody` → `LetterTemplateDetail` | `queries` edit, `queries.configure` | | Back to a draft; 409 `TEMPLATE_IN_USE` while something sends it (§6.7) |
| `PATCH /api/v1/letter-templates/:id` | `LetterTemplateUpdate` (`name`, `purpose`) → `LetterTemplateDetail` | `queries` edit, `queries.configure` | | Used For changes only while nothing sends it |
| `GET /api/v1/ess/queries/summary` | → `MyQueriesSummary` | `ess` · own | no | Open, archived, sanctions and the latest one's date |
| `GET /api/v1/ess/queries` | `EssQueryListQuery` (`status`: `open`, `archived`) → `MyQueryPage` | `ess` · own | yes, 25 | ESS module, through the queries service. Without `status`, every query, open ones first, then newest first |
| `POST /api/v1/ess/queries/:id/response` | `QueryResponseCreate` (`body_html`) → `MyQuery` | `ess` · own | | Through `queries.response`; 20 to 4,000 characters of text once the markup is taken out |
| `GET /api/v1/ess/sanctions` | `PageQuery` → `MySanctionPage` | `ess` · own | yes, 25 | |

Each module mounts its own base path (`/queries`, `/query-rules`, `/sanctions`,
`/letter-templates`), so no router's `/:id` meets another's word. A proposed sanction is decided
only on the query's card (`POST /sanctions/:id/approve`, `/reject`, §6.4). It is listed in My
Approvals and read through `GET /workflow/instances/:id` (`can_decide` false there), but the generic
`/workflow/instances/:id/approve` and `/reject` refuse it (409 `DECIDE_ON_RECORD`): only the card
keeps the Operations & People signature (`definitions.decidedOnRecord`).

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
- `response_due_at` is raised-at plus the response window, **24 hours** (MyCity's handbook §4.7.1:
  "not later than 24 hours after receipt"; AJ, 27/10/2026), a constant (`RESPONSE_HOURS`) until a
  setting is asked for. After it passes without a response the query still waits, and a decision may
  be recorded.
- The query letter is generated in the same transaction (§6.7). A manual query uses the active
  letter template of purpose `query` chosen on the form, or the default `query-letter`.
- **A policy it breaches** (meeting 26/10): the form may cite one of the Knowledge Hub's policies
  with a version in force (`policy_id`, and optionally `policy_clause`, the line to quote, at most
  300 characters). The query keeps the version in force that day (`policy_version_id`) and the
  clause; the letter quotes them: "This is against our Attendance Policy (POL-0003, version 2):
  ...". The list to pick from is `GET /queries/policies`, the policies service's `citable()`,
  never the policy tables. A policy no longer in force is refused (422 `POLICY_NOT_IN_FORCE`).
- **Signed.** The person raising it draws their signature on the form (`SignatureField`, a PNG
  data URL, `signature`); the service stores it through the vault (`purpose: "signature"`, doc type
  `query_signature`) as `employee_query.signature_document_id` and prints it on the letter above
  their name. A rule's or an attendance breach's query has no signer to draw one: its letter is
  signed Operations & People.
- **From an attendance breach** (§3 step 1): `queries.raise_from_breach` on `attendance.rule_breached`
  with `raise_query` true. Subject "3 Late Arrivals This Month" (the breach's own words), details
  naming the days, evidence the days, the Attendance policy version in force on the breach's last day
  cited, `source` `attendance`, no `query_rule_id`, dedup `attendance-breach:<breach id>`. The breach
  is linked to the query through the attendance service (`attachQuery`), in the same transaction,
  and read under a row lock (`breachForQuery`), so two deliveries at once raise one query and spend
  one number. A breach whose person has left raises nothing. Shown as raised by **Attendance Policy**, and seen as
  a rule's query is (§6.1).

### 6.3 Rules

- **Attendance counts its own rules.** Late arrivals, early departures, absences, forgotten clock-outs
  and location flags are the Attendance policy's (attendance.md §6.16, T3: "a query is raised only
  when its switch is on"; MyCity's handbook sets them as policy). MILESTONES §8's "three late arrivals
  in thirty days raises a query" is met there: the policy's late-arrival row (3 in a month) with Raise
  Query on, configured on its screen, and three late arrivals raise exactly one query (§6.2). The
  Rules screen no longer offers `lateness`, `absence` or `missing_clock_out`, so one pattern never
  raises two queries (AJ with GE and TB, 27/10/2026).
- A rule on Rules is `{ source_event, threshold, window_days, letter_template }`. Triggers:
  `unenrolled_device` (a punch from a device not on the person's list), `overdue_task` (a Workspace
  task whose due day passed before it was done: still open, or done late, counted on its due day),
  `low_performance` (a month's review closed rated Below, counted on the day it closed),
  `missed_target` (an M2 KPI closed below its target; not counted yet). `measure` is always `count`:
  the contract no longer takes it, and a stored `minutes` row (lateness's, before 27/10/2026) never
  fires. A rule says whether it has fired (`has_fired`), and from then its trigger is fixed (409
  `RULE_HAS_FIRED`); Edit Rule shows it instead of offering it. Activate is offered only for a
  trigger something counts.
- The window is `shared/rules/window-counter`: the `window_days` days ending on the event's date,
  in Lagos dates.
- Counting starts after the last query the same rule raised for the person, so a threshold of three
  raises exactly one query, and the next query needs three more. The counted dates are the query's
  evidence.
- `dedup_key` is `<query_rule_id>:<employee_id>:<breach date>`; the outbox delivers at least once,
  and the unique key makes the second delivery a no-op.
- Counts come from the owning module, never their tables: attendance answers unknown-device punches
  in `attendance.auto-query.js`, tasks in `tasks.auto-query.js`, reviews in `reviews.auto-query.js`
  (each `offences()`); an exception People accepted ("the record stands") is not an offence. A task
  counts against its primary assignee; a cancelled or archived task never counts. `missed_target`
  may be drafted but not switched on until M2's KPIs count it (409 `TRIGGER_NOT_AVAILABLE`).
- A rule may name the policy it enforces (`policy_id`, `policy_clause`): its queries cite the
  version in force on the breach day, and their letters quote it, as a manual query's (§6.2). A
  rule whose policy has no version in force still raises its query, without the citation. The
  rule form's **Clause** (Optional, at most 300 characters, shown once a policy is picked) is the
  line its letters quote; taking the policy off clears it.
- A draft or paused rule never fires. Activating a rule does not reach back: it counts events from
  its activation onwards. **Edit Rule** changes a rule's name, threshold, window, letter, policy and clause;
  its trigger is fixed once it has fired.
- A rule may not be deleted once it has fired; it is paused.

### 6.4 Deciding a query

- Needs `queries` edit and visibility (§6.1). The person the query is about can never decide it.
- Before the response window ends, a decision needs the employee's response; after it, it does not.
- **Close, no action**: a reason of at least 10 characters. Status `resolved`, outcome `no_action`.
- **Propose a sanction**: a rung (`consequence_step_id`), a reason, evidence when the rung requires
  it, the dates when its financial effect is `unpaid_days`, and an optional fine. Writes the
  `sanction` as `pending_approval`, with the rung's letter kept on it (`letter_template`), and opens
  `queries.consequence` with context `{ rank, financial_effect, fine_amount }` and the person queried
  excluded (`exclude_employee_ids`), in one transaction. One open proposal a query. The proposer is
  `decided_by` and does not sign.
- **Approve or reject** (`POST /sanctions/:id/approve`, `/reject`), on the query's card only (§5):
  only whoever the current stage waits on, and never the person the sanction is about (403, the
  CEO included). The approval is decided first, so someone who may not act is refused (403) before
  anything of theirs is kept. At the `operations_people` stage the approver draws their signature
  (`signature`, 422 `SIGNATURE_REQUIRED` without it, which undoes the decision), stored through the
  vault as `sanction.signature_document_id`, with `signed_by` the approver. The issued letters (§6.7) carry that signature, name and job title,
  "For" the company, as every sample MyCity sent is signed by its People & Operations Lead (AJ,
  27/10/2026). A rejection needs a reason of at least 10 characters.

### 6.5 The chain

- The rungs, top to bottom, are `consequence_step` rows in `position` order. MyCity's ladder, in
  MILESTONES §8 as ratified on 27/10/2026 (Cynthia's of 10 October, with one suspension): **Caution, Warning, Second Warning, Suspension Without
  Pay, Dismissal or Termination**. The Caution is MyCity's own letter (CAUTION, a performance
  caution); "Question" was the meeting transcript mishearing it. A disciplinary suspension is always
  without pay, 3 days the first time and up to 7 for a repeat (handbook §4.6.2, §4.7.4, and the one
  sample, SUSPENSION); a suspension on full pay is a precaution during an investigation, not a rung.
  So the ladder has one suspension (AJ, 27/10/2026, settling GE's 26/10 order). It is entered on
  Chain Settings; adding a rung is inserting a row at a position.
- A rung names: its letter template, its financial effect, its default length in days (suspensions),
  how long it stays in force for escalation (`valid_days`, null for ever) and whether evidence is
  required.
- **Next rung**: the rung after the highest one still in force for the person (issued, and inside
  its `valid_days`), of the sanctions the reader may see (§6.1): a manager's card counts only those
  on queries they raised, so it never hints at the others; Operations & People, who approve every
  sanction, see the whole standing. With none in force it is the first rung. This is what a second offence offers
  without code. People may choose a different rung; the choice and reason are recorded.
- A retired rung keeps its sanctions; it is no longer offered. A rung with sanctions is never deleted.
- Who decides is the `queries.consequence` approval, edited on Settings · Approvals: Operations &
  People for every rung (who sign it, §6.4), then the CEO for a rung that suspends without pay or
  ends employment (`financial_effect` `unpaid_days` or `ends_employment`), wherever it sits on the
  ladder: the handbook has the CEO and the HR Manager decide a suspension (§4.7.4). The rung's
  financial effect and position travel in the approval's context, so a definition change never
  needs code, and adding or leaving out a rung never moves the CEO (GE, 27/10/2026; it was
  position 4 before).

### 6.6 Fines

- A fine is never a rung: it attaches to any sanction (property damage, deducted from salary).
- Amount `numeric(18,2)` in Naira, a string on the wire, above 0.00.
- It is `pending` once the sanction is issued, and reaches the payroll run only when M6 accepts it
  (`sanctions.fines.accept`) or is waived with a reason. It is never automatic.
- **Salary Deduction letter.** A sanction issued with a fine sends a second letter beside its rung's:
  `salary-deduction-letter`, the one shipped template of purpose `fine`, quoting the amount through
  `shared/money` (`{{ money fine_amount }}`). It is generated, numbered and filed in the same
  transaction as the rung's letter, and both leave in one email once both PDFs exist. A fine cannot
  be proposed while that letter is not active (422 `LETTER_NOT_READY` on `fine_amount`).

### 6.7 Letters

- Every query and every issued sanction has a letter: `documents.generate()` from the current
  version of its template, inside the letterhead, numbered `LTR-0001`, filed to the employee's
  documents (`personal`), rendered to PDF in the worker and emailed after commit.
- One variable schema serves every letter (`ConsequenceLetterVars`: the employee, the record's
  number, subject or rung, reason, dates, fine, response due, signer), so a template added on the
  screen fills from the same record.
- An edit saves a new `template_version`; a letter records the version it used. The wording is
  written in the rich text editor (meeting 26/10) and kept as Markdown through the one renderer's
  whitelist (`htmlToMarkdown`), its `{{ names }}` as written; the detail hands it back as HTML
  (`body_html`) for the editor; a shipped letter's HTML file comes through the same whitelist
  (`htmlToMarkdown`, then `markdownToHtml`), so Edit Template opens with MyCity's wording and its
  first save keeps it as version 1 (GE, 27/10/2026). A script may still send Markdown (`body`). A
  template is `awaiting_sample` while it has no wording, `draft` until activated, `active`, or
  `retired`. Only an active template can be chosen.
- **New, activate, deactivate** (GE, 27/10/2026): New Template saves a draft or, with `status`
  `active`, Save and Activate. Deactivate (`POST /:id/deactivate`) takes an active letter back to a
  draft only while nothing sends it; `in_use` says when something does: a step or rule on it
  (`used_by`), or its being the Query Letter (every manual query) or the Salary Deduction Letter
  (every fine), and the 409 `TEMPLATE_IN_USE` names it. `PATCH /:id` renames a letter, and changes
  what it is used for (Queries or Sanctions) on the same condition.
- **What sends it**: a rung names its letter on Chain Settings, a rule on New Rule or Edit Rule
  (`query_rule.letter_template`; none sends the Query Letter), and both show under Used By.
- Purposes: `query` (a query's letter), `sanction` (a rung's letter), `fine` (the deduction letter
  a fine sends, §6.6). Six letters ship, each with wording and seeded active, so every rung is ready
  on a fresh database: Query, Caution, Warning (also the Second Warning's), Suspension Without Pay,
  Termination and Salary Deduction.
- **The wording is MyCity's** (the samples Cynthia's team sent on 15/10/2026, brought in on
  27/10/2026; redacted copies in
  `docs/MyCity-ERP-Documents/letter-samples/`): the Query letter follows QUER 2 and QUERY
  NOTIFICATION (respond within the window, "stating why appropriate disciplinary action should not be
  taken"); Caution, Warning, Suspension Without Pay and Termination follow CAUTION, WARNING,
  SUSPENSION and DISMISSAL, with the record's facts where the samples name a person, a date or an
  offence. The Salary Deduction letter is ours, for MyCity's HR to read before go-live.
- **Layout** (meeting 26/10): a letter fits one page where its wording allows (the letterhead's
  margins and type are set for it, and the signature block never splits from its name). Past one
  page, the letterhead's header (logo, number, date) and footer (Settings · Organisation: name,
  RC number, address, phone, email, website) repeat on every page, and every page is numbered
  "Page 2 of 3". The letterhead is the shared one (`templates/documents/letterhead.html`), so every
  generated document gains the repeat.
- **As MyCity's own letters** (GE, 27/10/2026, from the samples CAUTION, WARNING, SUSPENSION,
  DISMISSAL): `query_letter` and `sanction_letter` declare `letter` (the date and the addressee:
  name, job title, department), so the letterhead opens the body with the date (the query raised, or
  the sanction effective) and the addressee, prints no page title, and closes with "Yours
  faithfully," and **FOR: MYCITY APP LTD** (the organisation's name in capitals) above the signer's
  signature, name in bold and job title, leaving room to sign when there is no drawn signature. The
  wording starts at "Dear", its heading in bold capitals after it; the logo header (number) and the
  footer stay. A document that is not a letter keeps the plain "For" line.
- **The preview is the PDF** (GE, 27/10/2026): `GET /letter-templates/:id/preview.pdf` renders the
  letter through the same engine and letterhead (`documents.previewPdf`), filled with sample values
  and signed with the reader's saved signature (§6.9), nothing stored, numbered or sent; Letter
  Templates shows it with Download PDF, the PDF's frame waiting while it is drawn (never the wording
  first), Try Again if it fails. The demo build, which has no PDF renderer, shows the wording on paper
  (`GET /:id/preview`), which the API build never fetches. The deduction letter's sample carries an
  amount.
- Letter templates added on the screen take a key `<slug>-letter`; generate() is given the template
  key with the shared doc types `query_letter` and `sanction_letter` (a small extension to
  `shared/documents/generate.js`: an explicit `template` for a doc type that allows it).

### 6.8 Every outcome is recorded

Each decision keeps reason, evidence, decision-maker and date (`reviewed_by`, `decided_by`, the
approval's decisions). Queries, responses, sanctions and letters are never deleted or edited after
the fact; a mistake is a withdrawn sanction or a further note, both audited.

### 6.9 My Signature

- A person draws their signature once, on Letter Templates (**Edit Signature**, anyone with
  `queries` view), and it is kept through the vault (doc type `query_signature`, entity the login)
  as `letter_signature.document_id`, one row a login (migration `3050`). Drawing again replaces it;
  `letter_signature.saved` records it.
- Raise a Query and Approve Sanction open their pad with it (`GET /queries/my-signature`, the PNG as
  a data URL), so nobody draws each time; they may clear it and redraw. What is sent is still the
  pad's image, stored with the query or sanction as before (§6.2, §6.4), so a letter already sent
  never changes when the saved signature does.
- The letter preview on Letter Templates signs with the reader's saved signature (§6.7).

## 7 · Events, jobs and notifications

| Event / job | When | Does |
|---|---|---|
| `query.raised` | After a query commits | Notification and email (with the letter) to the employee; Queries list refresh |
| `query.reminded` | Send Reminder | Notification and email to the employee |
| `query.responded` | The employee responds | Notification to the raiser, or People when a rule raised it |
| `query.closed` | Close, no action | Notification to the employee |
| `sanction.proposed` | A sanction is proposed from a query's decision | Opens `queries.consequence`; the engine tells the first approvers, who decide on the query's card |
| `query_rule.fired` | A rule raised a query | Recent Firings refresh |
| `query_rule.saved`, `query_rule.activated`, `query_rule.paused` | Rules writes | Audit |
| `sanction.issued` | `queries.consequence` approved | Numbered; letter generated, filed, emailed with the PDF once rendered (`templates/email/sanction-issued.html`); fine pending; query resolved; notification to the employee |
| `sanction.rejected` | The approval rejected it | Query back under review; the proposer is told |
| `sanction.withdrawn` | The approval was withdrawn | Query back under review |
| `consequence_step.saved` | Chain Settings writes | Audit |
| `sanction_fine.accepted`, `.settled`, `.waived` | M6 takes, deducts or waives a fine (`sanctions.fines`) | Audit |
| `letter_template.saved`, `letter_template.activated` | Letter Templates writes | Audit |
| `attendance.rule_breached` (Attendance) | A policy rule is reached with Raise Query on | Outbox `queries.raise_from_breach`: one query for the breach, linked back on it (§6.2) |
| job `query-rule-evaluate` | Queued by `query_rules.events` on `attendance.review_required` (an unknown device) and `review.closed` (a month rated Below), once per event, and by the schedule below | Counts the person's active rules as of the event's day and raises one query per breach (§6.3); idempotent |
| schedule `query-rule-sweep` | Every day at 06:20 Lagos | For each person with a task due yesterday that is still open or was done late, queues `query-rule-evaluate` for `overdue_task` as of yesterday; only while an `overdue_task` rule is active |

## 8 · Permissions and visibility by role

| Role | Sees | Can do |
|---|---|---|
| Employee | Their own queries and sanctions, in ESS only | Respond |
| Line Manager (`manager`, `queries` team, view and create) | Queries they raised | Raise, remind; read the response |
| Head of Department (`queries` team, view, create, edit, approve) | Queries they raised | Raise, remind, decide their own queries |

A team scope never widens a sanction's approval either: `GET /workflow/instances/:id` reads a
`queries` request only for scope `all`, the CEO, its opener, its approvers and deciders, and the
person it is about (`workflow.service` NARROW_MODULES). The query's card shows who a sanction waits
on to whoever may see the query (`workflow.pendingStage`).
| Operations & People (`queries` all) | Everything | Everything, including rules, chain and letters (`queries.configure`); first approver of every sanction, who signs its letters |
| Management (`queries` all, no delete) | Everything | Decide queries |
| Implementation | Everything | Everything (`queries.configure`) |
| CEO | Everything | Everything; holds every capability; second approver from Suspension Without Pay up |

`queries.configure` is held by default by Implementation and Operations & People (seed `3190`).
Restricted fields: none beyond the employee's own masks; a query's evidence carries dates and
counts, never coordinates or device identifiers.

## 9 · AI and search

- **AI reads** (`queries.ai.js`, `sanctions.ai.js`): `queries.list` and `queries.get` (open and
  closed queries the reader may see, §6.1), `sanctions.list`, `sanctions.standing` (a person's rungs
  in force and the next one; scope all only). `queries` view, paged at 25, cited by number. `query_rules` and
  `templates` carry `// ai:none` (configuration, nothing a question needs).
- **Write With AI** (meeting 26/10; built like the mailbox's, `mailbox.assist.js`): on Raise a Query
  (`POST /queries/assist`, prompt `query-draft`, job Default) the Subject and What Happened from the
  raiser's own words, the employee's first name, job title and department, the raiser's name and
  title, today and the policy cited; on the letter editor (`POST /letter-templates/assist`, prompt
  `letter-draft`, job Deep Reasoning, `queries.configure`) the wording from the letter's name,
  purpose, current wording and an instruction, using only the names a letter may fill. Both chosen by
  GE (26/10/2026), registered in `services/ai/actions.js`, `personal_data` true (DeepSeek passed by).
  Contact details and numbers leave as tokens (`redact.shield`) and are put back. An answer with a
  gap left to fill (`services/ai/drafts.js`, the mailbox's guard, a letter's own names allowed) goes
  back once, then fails. **Nothing is kept**: the form takes the draft only when the person presses
  Use Draft, and raising or saving is their own press. With AI off, switched off for Queries, out of
  this month's budget or no provider set up, `GET /queries/assist` and `GET /letter-templates/assist`
  say so (`available` false, `reason` `off` or `limit`), the button reads AI Is Off or AI Limit
  Reached, and the form works as before.
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
| Raise a Query | Employee, Subject, What Happened, Policy and Clause (both Optional), Your Signature; Write With AI (What To Say, Write Draft, the draft, Try Again, Use Draft), reading AI Is Off or AI Limit Reached when it cannot answer | Help on Clause: the line of the policy the letter quotes | Where the signature is kept, the version cited: §6.2 |
| Queries | KPI strip; All Queries and Raised by Me chips; the list (employee, number, subject, raised by or the rule, raised, response, status); the query card (subject, raised by (a person, the rule, or Attendance Policy), raised, response due, counted days, response, sanction, and while a sanction waits: its step and who it waits on); Raise a Query (only with `queries` create; also from ⌘K), Send Reminder, View Letter (the PDF the employee received), Record Decision; Approve Sanction (Your Signature at the Operations & People stage) and Reject (Reason) for whoever it waits on; a refused proposal reads "Not Approved" | Help on Escalated (the KPI) and on Waiting On: a sanction is waiting for approval. Help on Response Due: the 24 hour window. Help on Your Signature when approving: it signs the letters | Who can see which query, the dedup, how a rule counts: §6 here, the manual |
| Record Decision | Outcome (Close, No Action or Sanction), the step (the next one marked Next; only steps whose letter is ready), dates for an unpaid suspension, Evidence (one item a line) for a step that requires it, fine, reason | Help on the next rung: why it is offered. Help on Evidence: the step needs the facts it rests on | The approval route and its thresholds: Settings · Approvals, §6.5 |
| Rules | KPI strip; rule cards (name, trigger, threshold as "3 in 14 days", the policy it enforces, status), a page at a time; Recent Firings; New Rule, Edit Rule, Activate, Pause; the rule form's Name, What Sets It Off, How Many Times, Within, Days, Policy and Clause (both Optional); an empty state when there are no rules | Help on Policy and on Clause, as the form reads them | Counting after the last query, the dedup key: §6.3 |
| Sanctions | KPI strip; the history (employee, sanction, query, reason, decided by, date, fine, status); Issue Sanction (with `queries` edit: Query, a picker of those under review, then Record Decision at Sanction), Chain Settings | None | The rank rule for approvals, valid_days mechanics: §6.5 |
| Chain Settings | The steps in order (position and name, Ready, Needs a Letter or Retired, letter, financial effect, in force for); Add Step, Move Up, Move Down, Retire, Restore | Help on In Force For: how long a step counts for the next offence | Why a fine is not a rung: §6.6 |
| Letter Templates | Stat strip; the list (template, used by, status); the selected letter as its PDF, with Download PDF (on paper, the record's words underlined, in the demo build); Edit Signature; New Template (Name, Used For, Letter; Save Draft, Save and Activate), Edit Template (Name, Used For while nothing sends it, Letter, opening with its wording), Activate on a draft, Deactivate on an active letter | Help on Letter: the names a letter can use. Help on Used For when it is fixed | Versioning, the shipped defaults: §6.7 |
| ESS · My Queries | The Queries and Sanctions switch with each one's count; Queries: the list (number, subject, raised, status), the picked query (subject, raised, respond by, what happened, your response, outcome, sanction), View Letter, Respond; Sanctions: the list (sanction, query, reason, date, fine), each opening its letter | Help on Respond By: the 24 hour window | The sanitising, the Markdown kept: §3 step 3 |

### 10.2 Phone layout

| Screen | First on a phone | Left off a phone | Main action | Navigation |
|---|---|---|---|---|
| Queries | Two KPI cards (Open, Awaiting Response), then query cards with a status pill | Queries by Reason; the Number and Raised By columns | Raise a Query, full width; a query opens in a sheet with Record Decision at its foot | Bottom bar More → Queries; the four tabs scroll sideways |
| Rules | Rule cards, one a row, with Activate on drafts whose trigger is counted | Recent Firings | New Rule in the header | Tabs scroll sideways |
| Sanctions | Sanction cards with the step and status | The query and decided-by columns | Issue Sanction | Tabs scroll sideways |
| Letter Templates | The template list, then the selected letter's preview | The Used By column | New Template | Tabs scroll sideways |
| ESS · My Queries | The switch at the top as a segmented control, then the chosen list as cards | The Number and Query columns | Respond, full width at the foot of the query's sheet; a sanction opens its letter full screen | Bottom bar Self-Service → My Queries |

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
  Sanctions shows the empty chain with Add Step.
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
- **Settled 19/10/2026 (GE), superseded 27/10/2026.** ~~The ladder has six rungs, as `3099` lists
  them~~, with Second Warning; AJ's screen gains it and "Dismissal" reads "Dismissal or Termination".
  Now five rungs, one suspension (below; MILESTONES §8 ratified); 3099's list is switched off by 3190.
- **Settled 19/10/2026 (GE).** Every sanction follows a query (`sanction.employee_query_id NOT NULL`);
  Issue Sanction starts from an upheld query.
- **Settled 19/10/2026 (GE).** A query a rule raised is seen by scope `all` and the CEO only
  (MILESTONES §8). The Queries empty state that says otherwise changes.
- **Settled 27/10/2026 (AJ, from MyCity's samples and handbook).** These replace the points they
  name below and the 27/10 morning answers where they differ:
  - **Lateness and the attendance rules are the Attendance policy's** (§3 step 1, §6.3). The
    threshold is the policy's setting; MyCity's handbook reads 3 late arrivals in a month. Rules no
    longer offers `lateness`, `absence` or `missing_clock_out`.
  - **The ladder, ratified in MILESTONES §8 (27/10/2026):** Caution, Warning, Second Warning, Suspension Without Pay,
    Dismissal or Termination (§6.5). The 26/10 "Question Letter" was the transcript mishearing
    "Caution"; the shipped letter is `caution-letter` again.
  - **One suspension, without pay** (handbook §4.7.4); the paid suspension is a precaution, not a rung.
    The CEO approves from Suspension Without Pay up, after Operations & People (handbook §4.7.4).
  - **The response window is 24 hours** (handbook §4.7.1, both query samples).
  - **Operations & People sign a sanction's letters when they approve it**, "For" the company, as
    every sample is signed; the proposer no longer signs (§6.4).
  - **The letters' wording is MyCity's samples** (§6.7), the Salary Deduction letter ours; all six
    ship active.
  - **Dismissal or Termination** records the sanction and tells People; ending the employment stays
    in People · Employees, where the letter's effective date is the Last Day (GE and TB, 27/10/2026).
  - **The ladder on production** is entered on Chain Settings at go-live by Operations & People, on
    the go-live checklist (TB, 27/10/2026); staging gets it from its seed.
  - `sanction_fine.employee_accepted_at`, `employee_rejected_at` and `rejection_reason` (3000) stay,
    unused, for a later milestone to use or drop (AJ, 27/10/2026).
- **Settled 27/10/2026 (GE, AJ), the morning.** Every manual query is signed, Operations & People's
  too; the Salary Deduction letter keeps our wording, for MyCity's HR to read before go-live (at the show
  and tell, AJ 27/10/2026);
  `overdue_task` counts the primary assignee on the due day and `low_performance` a month rated
  Below only; one reminder a day. The rule form gains an Optional Clause (`policy_clause`, at most
  300 characters) that the rule's query letters quote (§6.3).
- **Settled 27/10/2026 (GE).** Staging's seed carries the five rungs, a rule, and demo queries and
  sanctions. Built in `seeds/staging/50_queries.js`: the five rungs when the chain is empty, the
  Unregistered Device rule switched on, and six queries on the Implementation department's people
  only (the JBS Praxis team's accounts, never MyCity's staff: staging sends real mail; TB,
  27/10/2026), each raised and signed by the person's line manager, one at each stage, two sanctions Management proposed and Operations & People approved and
  signed (one with a fine), one waiting on them.

## 14 · Change log

- 27/10/2026 · GE · Letters as MyCity's own (handoff §9, S3; §6.7): the date and addressee open
  them, "Yours faithfully" and FOR: the organisation close them; the preview is the real PDF with
  Download PDF; the deduction letter's sample names its amount.
- 28/10/2026 · GE · Issue Sanction picks the query in place (handoff §9, S4; §10): a picker of the
  queries under review, then Record Decision on it at Sanction; only with `queries` edit.
- 28/10/2026 · GE · Staging walk (handoff §9.4): the preview drew nothing (PdfViewer was handed the
  link, not the bytes) and the paper wording flashed first; it now opens in the PDF's frame. A
  browser that darkens every site darkened the signature pad under its dark ink: `SignatureField`
  now paints its paper into the bitmap, which no browser repaints.
- 27/10/2026 · GE · My Signature (handoff §9, S2; §6.9): drawn once on Letter Templates' Edit
  Signature, kept through the vault (`letter_signature`, migration `3050`); Raise a Query's and
  Approve Sanction's pads open with it.
- 27/10/2026 · GE · Letter Templates (handoff §9, S1; §5, §6.7, §10): Edit Template opens a shipped
  letter with its wording and edits its Name and Used For (while nothing sends it); Deactivate while
  unused; Save Draft or Save and Activate; a rule picks its Letter.
- 27/10/2026 · GE · The audit's small items (handoff §8.3): the `minutes` measure and the attendance
  triggers' labels gone (§6.3); `has_fired` on a rule, its trigger shown fixed on Edit Rule, Activate
  only for what is counted, a pager on Rules (§10); the next rung from the sanctions the reader may
  see (§6.5) and a team scope never reading a sanction's approval (§8); the mock reminds once a day,
  keeps a fine's letter and the dates proposed, and counts Queries by Reason per rule; Employee
  360's status words and raised dates match Queries.
- 27/10/2026 · GE · From the audit, the screens (§10): Record Decision asks for Evidence on a step
  that requires it (the top two could not be proposed); Raise a Query only with `queries` create,
  and on ⌘K; after Approve Sanction the card is read again once the worker has issued it, and the
  toast names who is next; a refused proposal reads Not Approved; a phone shows two KPIs and leaves
  off Queries by Reason and Recent Firings (§10.2); Rules has its empty and error states; My
  Queries' Respond says why it failed.
- 27/10/2026 · GE · From the audit (handoff §8): a sanction is decided only on the query's card (the
  generic workflow routes refuse it), never by the person queried, and the approver is checked
  before their signature is kept (§5, §6.4); the CEO is asked by the rung's financial effect, not
  its position (§6.5); a sanction keeps its letter from proposal (§4); a breach is locked while its
  query is raised (§6.2); the letterhead signs "For" the organisation; the staging seed queries the
  Implementation department's accounts only (TB, §13).
- 27/10/2026 · AJ · The rule form's Optional Clause built (§6.3): New Rule and Edit Rule, cleared with the policy.
- 27/10/2026 · AJ · From MyCity's samples and handbook (§13): attendance breaches raise their query
  (`queries.raise_from_breach`, migration 3040's key and `source`); Rules drops the three attendance
  triggers; Caution, Warning, Second Warning, Suspension Without Pay, Dismissal or Termination; a
  24 hour window; Approve Sanction and Reject on the query's card, Operations & People signing
  (`signed_by`), the CEO from rank 4; Edit Rule; the six letters' wording from the samples, shipped
  active; a review shows its month's queries (performance.md).
- 27/10/2026 · AJ · The User Guide chapter `docs/manual/queries-and-sanctions.md` written, My Queries
  and the person's tabs in it. Open: no screen lets the approvers of `queries.consequence` decide a
  proposed sanction (§3 step 5 has the routes, §2's My Approvals row has no screen yet).
- 27/10/2026 · AJ · §13's last point settled with GE: as built, except the rule form gains an
  Optional Clause its letters quote (§6.3, §13).
- 27/10/2026 · GE · Meeting 26/10 items 1 to 10 built; handed to Victor. Left: the staging seed's
  demo queries and sanctions, the User Guide chapter and its pictures, once §13's last point is agreed.
- 26/10/2026 · GE · Rules count overdue Workspace tasks and low monthly performance (meeting 26/10;
  §6.3, §7): `overdue_task` from `tasks.auto-query.js` through the daily `query-rule-sweep`, and
  the new trigger `low_performance` (a month closed rated Below) from `reviews.auto-query.js` on
  `review.closed`. `missed_target` still waits for M2's KPIs.
- 26/10/2026 · GE · Write With AI on Raise a Query and the letter editor (meeting 26/10; §5, §9):
  prompts `query-draft` (Default) and `letter-draft` (Deep Reasoning), chosen by GE; nothing kept
  until Use Draft; the mailbox's placeholder guard moved to `services/ai/drafts.js` for both.
- 26/10/2026 · GE · The letter editor is rich text (meeting 26/10): `body_html` in, kept as Markdown,
  `body_html` back for the editor (§5, §6.7).
- 26/10/2026 · GE · Policies (meeting 26/10): a rule names the policy it enforces and a manual query
  may cite one, with the clause to quote; the query keeps the version in force, and its letter
  quotes it (§6.2, §6.3, migration 3030, `GET /queries/policies` through the policies service).
- 26/10/2026 · GE · Signatures and layout (meeting 26/10): Raise a Query and a sanction's proposal
  take a drawn signature, stored through the vault (`signature_document_id`, migration 3020) and
  printed on the letter (§6.2, §6.4); the shared letterhead repeats its header and footer on every
  page past the first, numbered (§6.7).
- 26/10/2026 · GE · Letters (meeting 26/10): the Caution Letter is the Question Letter, its rung after
  the Warning (§6.5, §13); a fine sends the new Salary Deduction letter (purpose `fine`, amount
  through `shared/money`) beside the rung's, in one email (§4, §6.6, §6.7).
- 26/10/2026 · GE · Employee 360 gains Queries and Sanctions tabs (meeting 26/10: TB saw them mixed),
  shown only with `queries` view, each `GET /queries` or `GET /sanctions` with the person's
  `employee_id`, so §6.1 decides what a viewer sees there as on Queries (§2).
- 26/10/2026 · GE · ESS · My Queries is one tab with a Queries and Sanctions switch (meeting 26/10:
  ESS has twelve tabs, TB): the three cards go; Queries lists every query, open ones first, and a
  picked one opens beside the list (a sheet on a phone); Sanctions is read only, each opening its
  letter. The response is written in the rich text editor (`body_html`), kept as Markdown through
  the shared renderer and returned as blocks (§3 step 3, §5, §10).
- 19/10/2026 · GE · The screens are on the contract (§2, §10): Issue Sanction opens Queries, since every
  sanction starts from a query's decision; View Letter shows the PDF the employee received; a
  letter's preview is its wording on paper with the record's words marked (`LetterPreview`
  paragraphs, not HTML); ESS · My Queries gains `GET /ess/queries/summary` for its three cards.
- 19/10/2026 · GE · The definition of done (MILESTONES §8) walked end to end in
  `tests/integration/queries-done.test.js`, one step a test. ESS's sanctions list orders a day's
  sanctions newest first.
- 19/10/2026 · GE · Rules built (§5, §6.3, §7): drafts, activate and pause (`queries.configure`),
  Recent Firings within §6.1, and the evaluator (`query-rule-evaluate`, queued from
  `query_rules.events` beside the attendance events it counts). The breach day is the day of the
  offence that reached the threshold; the window starts after the last breach the rule raised.
  M2's two triggers wait for their modules.
- 19/10/2026 · GE · Sanctions and the chain built (§3 steps 4 to 6, §5, §6.4 to §6.6, §7, §9): Chain
  Settings' writes renumber the ladder in one transaction; a proposal opens `queries.consequence`
  with the rung's position as its rank; the approval's end issues (numbered, lettered, emailed),
  rejects or withdraws it. §7 names `sanction.proposed` (not `query.escalated`), the fine events
  and the sanction email. The standing (scope all only) names the next rung.
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
