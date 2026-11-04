# Partnerships · Engineering Guide

| | |
|---|---|
| Owner | GE (LA: the tracker importer) |
| Milestone | M7 |
| Backend modules | `partners`, `partner_pipeline`, `leads`, `interactions`, `proposals`, `agreements`, `partnership_analytics` |
| Frontend paths | `app/src/features/partnerships/` |
| Permission key(s) | `partnerships` |
| Capabilities | `partnerships.configure` (add, rename, reorder and retire the pipeline's lists: partner types, stages, potential impact and lead sources; the writes behind Manage Lists) |
| Screens (PROGRESS.md rows) | #50 Pipeline, #51 Partners, #52 Leads, #53 Proposals, #54 Contracts & MOUs, #55 Analytics; the partner 360 opens from #50 and #51; reads shared with Home (home.md §4.1) and the Mailbox |
| Status | Draft |
| Last changed | 04/11/2026 |

Sources: MILESTONES §12 (scope and definition of done), decisions A14, A21 and A26, §18; REUSE_MAP §8;
DATABASE_SCHEMA M7 (what `7000` built and what it owes); Home's `partners.source.js` and home.md §4.1
(what Home already reads); the MyCity requirements review of 10 October 2026 (Cynthia Osakunih walking
Tom-Blake Asaah through the Partnerships Pipeline Tracker), the discovery call of 2 September and the
planning call of 8 October. The tracker's workbook itself is **not in the repository yet**; §13 lists
what its arrival can still change. Written before any M7 code, as CLAUDE.md step 2 asks; the build
plan and its checklist are `docs/handoff/m7-partnerships.md`.

Everything below marked **Proposed** was written on 04/11/2026 from the documents alone and waits for
GE and LA (§13). Everything else restates a binding document.

---

## 1 · What it is for

MyCity's partnerships are their business: the telecom, banks, hotels, councils and event owners that
put MyCity App in front of people. Today they live in one Google Sheets workbook (a pipeline sheet and
a monthly performance sheet) kept by the marketing and partnership staff, with proposals and MOUs
written by hand and the website's contact form going to an inbox. This module replaces the workbook
with a pipeline MyCity can read at a glance, a single page per partner (the 360) that is correct from
the minute it is created, leads captured where the conversation happened, proposals and MOUs drafted
by AI and signed through the system, and a monthly performance page per lead owner.

Used by lead owners and marketing staff (leads, interactions, proposals), Heads of Department
(their team's pipeline; review of MOUs), Operations & People, Management and the CEO (everything;
approval of agreements). Nobody outside MyCity touches it: the only external surface is M5's signing
page, which this module uses and does not extend (A9).

## 2 · Screens affected

| Screen / tab (slug) | Where | Who sees it | What it shows | What a person can do there |
|---|---|---|---|---|
| Partnerships · Pipeline (`pipeline`) | Staff app | `partnerships` view, within scope (§6.1) | KPI strip (in the pipeline, signed this year, signed value, going quiet), open partnerships by stage, the partners longest at their stage | New Partner, Manage Lists, open a partner's 360 |
| Partnerships · Partners (`partners`) | Staff app | `partnerships` view, within scope | KPI strip (active, total value, renewals in 180 days, quiet over 30 days), the partner list with All Partners and Quiet chips, value by partnership type | New Partner, Export, search, open the 360, Manage Lists |
| The partner 360 (`partners` or `pipeline` with `id`) | Staff app | Whoever can see the partner | Header, stat strip, organisation, contacts, stage history with days at each stage, interaction log (calls, meetings, visits, bound mail), contracts and MOUs, our deliverables, downloads attributed, next action and expected close | Log Interaction, Move Stage, New Proposal, Edit Partner, Add Contact, Enter Downloads, Close Partnership |
| Partnerships · Leads (`leads`) | Staff app | `partnerships` view, within scope | KPI strip (new, contacted, qualified, converted this month), the lead list, leads by source | New Lead, Mark Contacted, Mark Qualified, Convert to Partner, Close as Lost |
| Partnerships · Proposals (`proposals`) | Staff app | `partnerships` view, within scope | KPI strip (sent this year, accepted, viewed with no reply, acceptance rate), the proposal list and the picked proposal on paper | New Proposal (questionnaire, AI draft), edit the draft, Download PDF, Send Proposal, Mark Viewed, Mark Accepted, Mark Declined, New Contract |
| Partnerships · Contracts & MOUs (`contracts-and-mous`) | Staff app | `partnerships` view, within scope | KPI strip (active, in review, draft, renewals in 180 days), the lifecycle, the document list, the renewal calendar | New Contract, submit for approval, Send for Signature, Renew, Close, obligations |
| Partnerships · Analytics (`analytics`) | Staff app | `partnerships` view, within scope | The month's prospects, meetings, proposals, signed; a table per lead owner; signed per month; downloads by partner; six months | Pick a month, Export |
| Manage Lists (sheet on Pipeline and Partners) | Staff app | `partnerships.configure` | Partner types, stages (with what each means), potential impact, lead sources | Add, Rename, Move Up, Move Down, Retire, Restore |
| Settings · Imports (`imports`), importer Partnership Tracker | Staff app | `partnerships` create | The import engine's steps: upload, map columns, validate, duplicates, preview, import, error report, history | Everything the engine does, on the tracker's two sheets (§6.8) |
| Home · Overview, Alerts, Reports (home.md) | Staff app | Home's rules | Cards Open Opportunities, Active Partnerships, Signed Value, No Contact 30 Days, Proposals Out; the Partnership Pipeline chart; the Partner Inactivity alert | Open the partner behind a card |
| Mailbox · a thread (mailbox.md) | Staff app | The mailbox's owner, with `partnerships` view | A Partner context on the thread; Link to Partner | Link to Partner, Unlink |
| My Workspace · Tasks (workspace.md) | Staff app | The partner's owner | The follow-up task an inactive partner raises (§6.5) | The task's own actions |
| Notification bell, ⌘K, Praxis AI | Both shells | Within the reader's grants | Notices (§7); partners, leads, proposals and agreements by name and number; questions and cards (§9) | Open the record |

## 3 · How the screens relate

1. **A lead becomes a partner.** Leads · New Lead (`POST /leads`) → Mark Contacted → Mark Qualified →
   Convert to Partner (`POST /leads/:id/convert`). Convert is a transition, not a column write:
   reachable only from Qualified, and in one transaction it creates the partner, its open partnership
   at the first stage and the first stage-history line, and stamps the lead Converted with the partner
   it made. Close as Lost needs a reason the database also enforces. A lead never turns into anything
   by editing its status.
2. **The tracker comes in.** Settings · Imports → Partnership Tracker → upload the sheet as downloaded
   from Google Sheets (`.xlsx`) → map columns (saved as a mapping profile, because the tracker may
   change after end-of-month feedback) → validate → duplicate report → preview → import → history,
   revertible. Each row writes through `partners.service` and `partner_pipeline.service`, never SQL
   (§6.8).
3. **A partner at work.** Partners → the 360 → Log Interaction (a call, meeting, email or visit; this
   restarts the inactivity clock) → Move Stage (a history line, `partner.stage_changed`) → New
   Proposal. The 360 is one call, `GET /partners/:id`, and renders for a partner created a minute ago
   (§6.2).
4. **A proposal goes out.** New Proposal asks a short questionnaire; the AI drafts the proposal's
   wording; the person reads and edits it; Download PDF previews it; Send Proposal mails it with the
   PDF and records `sent_at`. Viewed, Accepted and Declined are recorded by hand (§6.6). An accepted
   proposal offers New Contract.
5. **A contract or MOU runs its lifecycle.** New Contract (from an accepted proposal or blank) →
   Draft → **Review** → **Approval** (one workflow definition, `partnership.agreement`, over the M0
   engine; the approvals appear in My Approvals like every other) → **Sent** (a signature request,
   M5's service) → **Viewed** (the signer opened the page) → **Signed** (all signatures in; the
   document locks) → **Active** (on its start date) → **Expiring** (the notice period before its end)
   → **Renewed** or **Closed**. The daily `agreement-renewals` job moves Active and Expiring; the
   reminder engine tells the owner (§7).
6. **A mail thread joins a partner.** Mailbox → a thread → Link to Partner → the thread's messages
   appear in the partner's interaction log as emails, new messages on the thread keep arriving, and
   each counts as contact. Only an excerpt reaches the partner's readers (§6.10).
7. **A partner goes quiet.** Home's morning sweep raises the Partner Inactivity alert (30 days, set on
   Home · Alerts · Alert Rules). The `partner-inactivity` job, the same morning, creates one Workspace
   task for the partner's owner, "Follow up with <partner>", once per quiet spell (§6.5). Logging an
   interaction ends the spell.
8. **Home reads all of it.** `src/modules/dashboard/sources/partners.source.js` reads the partner
   tables for Home's cards and chart. M7 owns that file's queries from the PR that builds the tables
   (§6.11).
9. **Analytics is a reading of the rest.** Prospects from identified dates, meetings from
   interactions, proposals from sent proposals, signed and active from stage history, downloads from
   the figures a lead owner enters (§6.9).

## 4 · Data

`7000` is merged and is never edited (MIGRATIONS). Everything marked **owed** is a fix-forward
migration from `7010`, split by PR 1 as it sees fit. The numbers in this guide are proposals.

| Table | Key columns | Notes |
|---|---|---|
| `partner` (7000) | `partner_id`, `number`, `name`, `partner_type`, `status`, `website`, `industry`, `country_code`, `owner_id`, `metadata` | `status` is `prospect`, `signed`, `active`, `on_hold` or `closed`, set by stage moves (§6.3). `partner_type` is a code of the `partner_type` list (§6.3). **Owed:** `region` text, `legal_name`, `place_id` (the headquarters, an area from the address search, saved with `places.save()` in `partners.service`; F27, gate 22), `closed_at`, `close_reason` |
| `partner_contact` (7000) | `partner_id`, names, `email` (unique per partner), `phone`, `job_title`, `primary_contact` | The tracker's contact person, position and contact details. A partner has one primary contact |
| `partnership_opportunity` (7000) | `number`, `partner_id`, `title`, `stage`, `status`, `owner_id`, `estimated_value`, `currency`, `probability`, `expected_close_on`, `closed_at` | One row is what a tracker row is: a partnership being pursued. **Owed:** `objective`, `identified_on`, `next_action`, `comments`, `lead_id`, a partial unique index so a partner has **at most one open** opportunity, `status` limited to `open` or `closed` with `close_reason`. `stage` holds a code of the `partnership_stage` list; its default `lead` goes (§6.3) |
| `partnership_impact` (**owed**) | `partnership_opportunity_id`, `impact` | The tracker's multi-select Potential Impact; `impact` is a code of the `partnership_impact` list |
| `partnership_stage_history` (7000) | `partnership_opportunity_id`, `from_stage`, `to_stage`, `changed_by`, `reason`, `changed_at` | Append only. **Owed:** `source` (`move`, `convert`, `import`): an imported row's first line is `import` and counts toward no month (§6.9) |
| `partner_interaction` (7000) | `partner_id`, `partnership_opportunity_id`, `contact_id`, `interaction_type`, `subject`, `summary`, `occurred_at`, `owner_id`, `mail_message_id` | `interaction_type` is `call`, `meeting`, `email`, `visit` (code list `interaction_type`, which code switches on). Home reads `partner_id` and `occurred_at` |
| `lead` (**owed**) | `lead_id`, `title`, `contact_name`, `contact_detail`, `source`, `owner_id`, `status`, `next_action`, `qualified_at`, `lost_reason`, `converted_partner_id`, timestamps | `status` is `new`, `contacted`, `qualified`, `converted`, `lost`. Database checks: `lost` needs `lost_reason`; `converted` needs `converted_partner_id`. Not numbered |
| `partner_download_figure` (**owed**) | `partner_id`, `month`, `downloads`, `entered_by` | One row per partner and month, entered by the lead owner or imported (Proposed, §13 Q3). Feeds Analytics only |
| `partner_mail_thread` (**owed**) | `mail_thread_id` (unique), `partner_id`, `partnership_opportunity_id`, `bound_by`, `bound_at` | A thread joins one partner. The interactions it produces carry `mail_message_id` |
| `partnership_proposal` (7000) | `partnership_opportunity_id`, `number`, `version`, `status`, `value`, `currency`, `document_id`, `sent_at`, `accepted_at`, `created_by` | `status` is `draft`, `sent`, `viewed`, `accepted`, `declined`. **Owed:** `questionnaire` jsonb, `body` (the wording, Markdown through the one renderer), `ai_run_id`, `viewed_at`, `declined_at`, `valid_until` |
| `partnership_agreement` (7000) | `partner_id`, `partnership_opportunity_id`, `proposal_id`, `number`, `title`, `status`, `starts_on`, `ends_on`, `value`, `currency`, `document_id`, `signature_request_id`, `owner_id` | `status` is the lifecycle of §6.7. **Owed:** `kind` (`mou` or `contract`), `body`, `questionnaire`, `ai_run_id`, `workflow_instance_id`, `viewed_at`, `signed_at`, `renewal_notice_days`, `renews_agreement_id`, `closed_at`, `close_reason`. `ends_on` is not before `starts_on` (checked in 7000) |
| `agreement_obligation` (7000) | `partnership_agreement_id`, `title`, `description`, `owner_id`, `due_on`, `status`, `completed_at` | What MyCity owes under an agreement; the 360's Our Deliverables |
| `reference_value` (0050), domains `partner_type`, `partnership_stage`, `partnership_impact`, `lead_source`, `interaction_type` | `code`, `label`, `display_order`, `metadata`, `active` | The lists. A stage's `metadata.meaning` is the code the system counts by (§6.3). Entered by MyCity on Manage Lists or loaded by the import; **not seeded** (A26) except `interaction_type`, which code switches on |
| `signature_request`, `signature` (5000, M5) | `subject_type`, `subject_id`, `document_id`, `status`, signer fields | Used, never written here except through M5's service |

Schema migration file(s): `migrations/7000_partnerships.sql` (merged); fix-forwards `7010` onward.
Reference-data file(s): `seeds/reference/7099_seed_partnerships.sql` (merged) **seeds business
choices A26 forbids** (stages `lead` to `closed`, partner type `ngo`); a fix-forward switches them off
and the file keeps only `interaction_type` and the capability's holders. Numbering: `proposal`
(`PRO`) and `mou` (`MOU`) are in `schemes.js`; `partner` (`PAR`), `partnership_opportunity` (`POP`)
and `partnership_agreement` (`AGR`) are in `7099`'s rows only (§13 Q8). Prefixes are proposals for MyCity to confirm.

## 5 · API

Contract files: `schemas/partners.js`, `partner_pipeline.js`, `leads.js`, `interactions.js`,
`proposals.js`, `agreements.js`, `partnership_analytics.js`. Everything is snake_case Zod; the
frontend declares none (`app/src/api/types/partnerships.ts`, INTERIM, goes when the contract lands).
Money is a string, dates ISO, an address is `PlaceInput`. Prefix `/api/v1/partnerships`. Every list
is paged at 25. The mock's endpoint names are kept where they hold.

| Method and path | Contract | Permission · scope | Paged | Notes |
|---|---|---|---|---|
| `GET /pipeline` | → `PipelineSummary` | `partnerships` view · §6.1 | no | Counts, signed, going quiet, open partnerships by stage, the longest at a stage |
| `GET /lists/:list` | → `ListValues` | `partnerships` view | no | `:list` is `partner_type`, `partnership_stage`, `partnership_impact`, `lead_source`. Active values in order; `?all=true` for Manage Lists |
| `POST /lists/:list`, `PATCH /lists/:list/:code` | `ListValueCreate`, `ListValueUpdate` → `ListValues` | `partnerships` edit · `partnerships.configure` | | Add, rename, reorder, retire, restore. A value in use is retired, never deleted. A stage carries `meaning` (§6.3) |
| `GET /partners/summary` | → `PartnersSummary` | `partnerships` view · §6.1 | no | |
| `GET /partners` | `PartnerListQuery` (`stage`, `partner_type`, `owner_id`, `status`, `quiet`, `q`) → `PartnerPage` | `partnerships` view · §6.1 | yes, 25 | `q` matches name, number, region and contact |
| `GET /partners/:id` | → `Partner360` | `partnerships` view · §6.1 | no | One call, zero-data safe (§6.2). 404 outside scope |
| `GET /partners/:id/interactions` | `InteractionListQuery` → `InteractionPage` | `partnerships` view · §6.1 | yes, 25 | The 360 shows the newest; this reads the rest |
| `GET /partners/duplicates` | `PartnerDuplicateQuery` (`name`, `email`, `phone`) → `PartnerDuplicates` | `partnerships` create | no | Advisory, at most 25, scored by `shared/dedup` (§6.2) |
| `POST /partners` | `PartnerCreate` → `Partner360` | `partnerships` create | | Idempotency-Key. Opens its first partnership at the first stage |
| `PATCH /partners/:id` | `PartnerUpdate` → `Partner360` | `partnerships` edit · §6.1 | | Includes the owner; each change is audited |
| `POST /partners/:id/stage` | `StageMove` → `Partner360` | `partnerships` edit · §6.1 | | §6.3 |
| `POST /partners/:id/close` | `PartnerClose` → `Partner360` | `partnerships` edit · §6.1 | | Needs a reason; closes the open partnership |
| `POST /partners/:id/contacts`, `PATCH /contacts/:id` | `ContactCreate`, `ContactUpdate` → `Partner360` | `partnerships` edit · §6.1 | | |
| `POST /partners/:id/interactions` | `InteractionCreate` → `Partner360` | `partnerships` create · §6.1 | | §6.5 |
| `PUT /partners/:id/figures/:month` | `DownloadFigureSave` → `Partner360` | `partnerships` edit · §6.1 | | `month` is `YYYY-MM`. Replaces that month's figure |
| `GET /leads/summary`, `GET /leads` | → `LeadsSummary`; `LeadListQuery` (`status`, `source`, `owner_id`, `q`) → `LeadPage` | `partnerships` view · §6.1 | yes, 25 | |
| `POST /leads`, `PATCH /leads/:id` | `LeadCreate`, `LeadUpdate` → `Lead` | `partnerships` create / edit · §6.1 | | |
| `POST /leads/:id/advance` | `LeadAdvance` (`to`: `contacted` or `qualified`) → `Lead` | `partnerships` edit · §6.1 | | Forward one step only (§6.4) |
| `POST /leads/:id/convert` | `EmptyBody` → `LeadConverted` | `partnerships` create · §6.1 | | From Qualified only. Repeating it returns the same partner |
| `POST /leads/:id/lose` | `LeadLose` → `Lead` | `partnerships` edit · §6.1 | | Reason required |
| `GET /proposals/summary`, `GET /proposals` | → `ProposalsSummary`; `ProposalListQuery` (`status`, `partner_id`, `q`) → `ProposalPage` | `partnerships` view · §6.1 | yes, 25 | |
| `GET /proposals/:id`, `GET /proposals/:id/document` | → `ProposalDetail`; → `ProposalDocument` | `partnerships` view · §6.1 | no | The document is the paper as the PDF will read |
| `POST /proposals` | `ProposalCreate` (the questionnaire, §6.6) → `ProposalDetail` | `partnerships` create | | AI drafts the wording; saved as Draft. Idempotency-Key |
| `PATCH /proposals/:id` | `ProposalUpdate` (`body`, `value`, `valid_until`) → `ProposalDetail` | `partnerships` edit · §6.1 | | Draft only; a sent proposal is revised as a new version |
| `POST /proposals/:id/send` | `ProposalSend` (`to`, `message`) → `ProposalDetail` | `partnerships` edit · §6.1 | | Renders the PDF, mails it, sets `sent_at` |
| `POST /proposals/:id/viewed`, `/accept`, `/decline` | `EmptyBody`, `EmptyBody`, `ProposalDecline` → `ProposalDetail` | `partnerships` edit · §6.1 | | Recorded by hand (§6.6) |
| `GET /agreements/summary`, `GET /agreements`, `GET /agreements/renewals` | → `AgreementsSummary`; `AgreementListQuery` (`status`, `kind`, `partner_id`, `q`) → `AgreementPage`; → `RenewalPage` | `partnerships` view · §6.1 | yes, 25 | Renewals ordered by due date |
| `GET /agreements/:id` | → `AgreementDetail` | `partnerships` view · §6.1 | no | With obligations, the approval's stage and who it waits on, the signature state |
| `POST /agreements` | `AgreementCreate` → `AgreementDetail` | `partnerships` create | | From a proposal or blank. An MOU's wording is AI drafted |
| `PATCH /agreements/:id` | `AgreementUpdate` → `AgreementDetail` | `partnerships` edit · §6.1 | | Draft and Review only |
| `POST /agreements/:id/submit` | `EmptyBody` → `AgreementDetail` | `partnerships` edit · §6.1 | | Opens `partnership.agreement` (§6.7) |
| `POST /agreements/:id/send` | `AgreementSend` → `AgreementDetail` | `partnerships` edit · §6.1 | | Only once approved. Creates the signature request (M5) |
| `POST /agreements/:id/renew`, `/close` | `AgreementRenew`, `AgreementClose` → `AgreementDetail` | `partnerships` edit · §6.1 | | Renew drafts the next agreement and links it |
| `POST /agreements/:id/obligations`, `PATCH /obligations/:id` | `ObligationCreate`, `ObligationUpdate` → `AgreementDetail` | `partnerships` edit · §6.1 | | |
| `GET /analytics` | `AnalyticsQuery` (`month`) → `PartnershipAnalytics` | `partnerships` view · §6.1 | no | One row per lead owner, within scope |
| `POST /mailbox/threads/:id/partner`, `DELETE` the same | `ThreadPartnerBind` → `ThreadContext` | `mailbox` view and `partnerships` view | | In the **mailbox** contract and guide (PR 3 changes `mailbox.md` first) |

Approvals of an agreement go through the shared `/workflow` routes and My Approvals, not new ones.
Import goes through `/imports` with the importer key `partnership_tracker`. Export is the shared
`ExportAction` (source `partnerships.partners`, `partnerships.analytics`).

## 6 · Rules and calculations

### 6.1 Who sees what

- A partner, its partnership, interactions and agreements belong to their **owner** (`owner_id`). Scope
  is applied through `scopeClause` on the owner, as Home already does: `all` sees every partner, `team`
  the owner's reporting line and the reader's own, `own` only the reader's. A record with **no owner**
  is seen only with scope `all` (Home's rule, kept).
- A proposal follows its partnership's owner. A lead follows its own `owner_id`.
- Repos honour scope in SQL, never in the controller. The 360, its interaction log and the lists are
  one rule.
- Analytics shows the lead owners the reader may see, and nothing else.

### 6.2 Partners and the 360

- **The 360 renders for a partner created a minute ago.** `partners.360` returns every figure
  defaulting to 0 and every collection to `[]`; `stage` is the first stage, `days_at_stage` starts at
  0, contacts, interactions, documents, deliverables and downloads are empty. A test creates a bare
  partner and reads the 360 (acceptance, MILESTONES §12). No screen assumes a figure exists.
- The 360 carries what MILESTONES §12 lists: the contacts, the conversation history, the stage, the
  owner, the **expected close**, the documents and the **next action**.
- **A partner has at most one open partnership** (Proposed, §13 Q10): the tracker has one row per
  partner. Its stage is the open partnership's; a closed partner shows its last. Pipeline counts open
  partnerships.
- **Status** follows the stage's meaning (§6.3): `prospect` until a `signed` meaning, then `signed`,
  `active`, `on_hold`; `closed` only by Close Partnership (a reason; the open partnership closes with
  it). Home reads `active`.
- **Duplicates are advisory.** New Partner and the import call `shared/dedup`: signals name
  (similar), email, phone and website host; at most 25 candidates, `min` 55; the person merges,
  links or carries on. Nothing blocks.
- Creating a partner numbers it (`PAR-0001`), emits `partner.created` and writes the first
  stage-history line, all in one transaction.

### 6.3 Stages, types and the lists

- Partner types, stages, potential impact and lead sources are **data** (`reference_value`), entered on
  Manage Lists or by the import, and the code never names one (A26). On staging they are loaded from
  the tracker. A retired value stays on the records that use it and is not offered again.
- **A stage carries a meaning**, `metadata.meaning`, one of `prospect`, `contacted`, `meeting`,
  `proposal`, `negotiation`, `signed`, `active`, `on_hold`. The system counts and switches by
  meaning, never by the stage's code or label, so MyCity can rename or add a stage. MyCity's twelve,
  as the tracker has them: prospect identified (`prospect`), initial contact (`contacted`),
  introductory meeting scheduled and held (`meeting`), proposal sent and follow up (`proposal`),
  ongoing negotiation, verbal approval and contract review (`negotiation`), partnership signed
  (`signed`), active partnership (`active`), on hold (`on_hold`). A stage with no meaning is saved
  and counts toward nothing but its own bar.
- **Moving a stage is a transition.** It is refused to the same stage; it needs a reason for `on_hold`
  and for any move to an earlier position; it writes a history line (from, to, who, reason, when) and
  sets the partner's status, in one transaction, then emits `partner.stage_changed`. Moving into
  `signed` or `active` is allowed without an agreement, because the tracker's rows have none.
- The twelve partner types of the tracker are strategic, events, media, tourism, hospitality,
  university, government, corporate, vendor, sponsorship, community and influencer. **Adding more is
  A21**: Manage Lists, Partner Types.
- Industry is free text; the field offers the values already used.

### 6.4 Leads

- Statuses move forward one step at a time: `new` → `contacted` → `qualified` → `converted`, and
  `lost` from any open status with a reason. No status is edited directly.
- Convert to Partner is §3 step 1. It reuses the lead's title as the partner's name until edited, keeps
  the lead (`converted_partner_id`) and its history, and is idempotent.
- Leads are entered by hand after a business development conversation (decision of 10 October). There
  is no intake from the website in M7; the website's contact form is MyCity's to wire later.
- Source is Optional and comes from the `lead_source` list. It is not on MyCity's tracker (§13 Q6).

### 6.5 Interactions and inactivity

- An interaction is a call, meeting, email or visit with a date not in the future, a summary of at
  least 10 characters, an owner and optionally the contact. Logging one is contact.
- **Quiet** is Home's definition, unchanged: an active partner with no interaction since the start of
  the day `N` days ago (Lagos), one never contacted counting from when it was added. `N` is the
  enabled Partner Inactivity rule's threshold on Home · Alerts (30 at go-live); with no enabled rule
  there is no follow-up.
- **The follow-up (Proposed, §13 Q4).** The `partner-inactivity` scheduler runs each morning after
  Home's sweep, finds the newly quiet partners and, for each, creates one Workspace task for the
  owner through the workspace service ("Follow up with <partner>", due that day plus 3 working days),
  dedup key `partner-inactivity:<partner_id>:<date of last contact>`. One task per quiet spell. The
  alert is Home's and clears itself when contact is logged.
- A meeting that has not happened yet is a calendar event (Proposed, cut line): `calendar_event`
  with `entity_type` `partner` and the partner's id. Log Interaction records what happened.

### 6.6 Proposals

- **The questionnaire** (the mock's six questions, kept): Who It Is For (a partner), What We Propose
  (at least 20 characters), Why Now (at least 10), Cities (one or more, each picked from the city
  search; `PlaceInput`, saved with `places.save()`), Weeks (at least 1), Value We Ask (greater than
  0, `shared/money`), Payment Terms.
- **AI drafts the wording from the answers**; nothing is kept until the person presses Draft
  Proposal, which saves a Draft with `ai_run_id`. When AI is off or the month's budget is spent the
  button says so (AI Is Off, AI Limit Reached) and the person writes the wording by hand. The job and
  who chose it are registered before the feature is built (§9).
- A proposal is **numbered when drafted** (`numbering.allocate`, `PRO-0001`), is edited as rich text
  (sanitised on the server through the one Markdown renderer) and carries a `version`. Draft is
  editable. Once sent it is not: revising it makes version + 1 as a new Draft, and the sent one stays.
- **Send Proposal** renders the PDF through `documents.generate` (doc type `partner_proposal`, template
  `proposal`, in the vault, hashed), mails it to the partner's primary contact (or an address typed
  on the send step) from the system sender, and sets `sent_at` and `sent`.
- **Viewed, Accepted and Declined are recorded by hand** (Proposed, §13 Q5): there is no public page
  for a proposal in the six-page public site (A9). Accepted sets `accepted_at`, offers New Contract
  and, when it is the open partnership's, suggests the `negotiation` stage without moving it.
- "Viewed, no reply" on the KPI strip is `viewed` with no later status. "Acceptance rate" is accepted
  over sent this year (a whole percentage, `0%` when none were sent).

### 6.7 Agreements, MOUs and contracts

- `kind` is `mou` or `contract`. Both follow one lifecycle.
- **The statuses** and who moves them:

| Status | Entered by | Rule |
|---|---|---|
| `draft` | New Contract | Wording AI drafted for an MOU (§9), by hand for a contract; editable |
| `review` | Submit for Approval | The reviewer stage of `partnership.agreement` |
| `approval` | The review stage approved | The approval stage |
| `sent` | Send for Signature, after approval | Creates the `signature_request` through M5's service with the partner's signers; the PDF is rendered and locked |
| `viewed` | M5's signing page, on first open | Set by the signature service's event; never by hand |
| `signed` | The last signature | `signed_at` is the last signature's time; the document locks; Home counts it signed |
| `active` | The daily job, on `starts_on` | A signed agreement whose start has arrived |
| `expiring` | The daily job, `renewal_notice_days` before `ends_on` (90 at go-live) | An active agreement nearing its end |
| `renewed` | Renew | The next agreement is drafted and linked (`renews_agreement_id`); this one closes as renewed on the new one's signing |
| `closed` | Close | A reason; allowed from any status |

- **Approval (Proposed, §13 Q5).** `partnership.agreement` has two stages, review by the owner's Head of
  Department (a `role` approver), then the CEO, each with a time limit, added to `DEFAULTS` in
  `shared/workflow/definitions.js` and validated by `validateDefinition()`. A stage that would ask the
  same person twice is skipped, as elsewhere. A rejection returns the agreement to Draft with the
  reason.
- A **declined or expired signature** returns the agreement to `sent` with a Send Again action; it is
  never silently `signed`.
- **Obligations** are what MyCity owes under it: a title, an owner, a due date. They appear on the 360
  as Our Deliverables and remind their owner through the reminder engine.
- Value is `numeric(18,2)`; currency NGN. Home's sums count NGN only (home.md §13).
- Signed means signed **by the agreement**. The Pipeline's "Signed This Year" counts partnerships
  that entered a `signed` meaning this year, because the tracker's imported rows have no agreement;
  Home's Signed Value counts agreements. Both are right and the screens name which they are (§13 Q9).

### 6.8 The tracker importer (LA)

- `partners.import.js` registers `partnership_tracker` on the existing engine with `defineImporter`
  (`permission: ["partnerships", "create"]`). The workbook is read as downloaded from Google Sheets;
  no Google integration (MILESTONES §12). The mapping is by column, saved as a profile, so a changed
  template is a new mapping, not a new parser. The importer's `extract(sheets)` reads the workbook's
  two sheets as MyCity keeps them.
- **Pipeline sheet → fields:** partner name → `partner.name`; industry → `industry`; contact person
  → a primary `partner_contact` (name split on the first space), position → `job_title`, contact
  details → `email` or `phone` by shape; region → `region`; partnership objective →
  `objective`; partnership type → `partner_type` (a value not in the list is listed "will be created"
  and made only when ticked at commit: `createMissing: "confirm"`); current stage → `stage`; potential
  impact (a list) → `partnership_impact`; lead owner → `owner_id` by name (an unmatched name is kept
  as a note and the row reads "No owner"); date identified → `identified_on`; next action →
  `next_action`; expected close date → `expected_close_on`; status and comments → `comments`
  (§13 Q1 reads the Status column's values from the workbook); everything is a text the person may fix
  in the preview.
- **Match keys:** the partner's normalised name, then website host, then primary email. A match
  updates; a likely duplicate (score 55 or more) is listed and decided in the preview.
- Each row writes through `partners.service` (numbering, audit, events, the dedup call). An imported
  row writes its first stage-history line with source `import`.
- **Reversible:** the batch can be reverted until a row's record is referenced (`isReferenced`: an
  interaction, proposal or agreement exists), after which that row stays and says why.
- The **second sheet** (monthly performance per lead owner) is **not imported** (Proposed, §13 Q2):
  Analytics computes the same measures from the system's records going forward.
- Export back out is the shared `ExportAction` on Partners, in the tracker's column order.

### 6.9 Analytics

One month at a time (Lagos months), per lead owner (the partner's current owner), within the reader's
scope. The first four are what the tracker's performance sheet counts and A21 names.

| Measure | Counts |
|---|---|
| Prospects | Partnerships with `identified_on` in the month |
| Meetings held | Interactions of type `meeting` with `occurred_at` in the month, by the interaction's owner |
| Proposals sent | Proposals with `sent_at` in the month, by the partnership's owner |
| Signed | Partnerships whose stage history enters a `signed` meaning in the month, excluding history from an import |
| Active | Partners whose stage meaning was `active` on the month's last day, from history (an imported row counts from the day imported) |
| Downloads generated | The sum of the month's `partner_download_figure` for the owner's partners |

"Signed per month" is the same measure over twelve months; "Conversion" in Six Months is signed over
prospects for the month, a whole percentage. Definitions are re-read against the workbook's own
formulas when it arrives (§13 Q1).

### 6.10 Mail binding

- Link to Partner binds one thread to one partner (`partner_mail_thread`). Each message of the thread,
  sent or received, becomes an interaction of type `email` (dedup on `mail_message_id`), and so does
  each new message as the mailbox syncs it. Each counts as contact.
- **Privacy (Proposed, §13 Q7).** A thread is its mailbox owner's. The partner's readers see the
  interaction: subject, from and to, date and the first 300 characters of the text, never the full
  body or any attachment. The full thread opens only for the mailbox's owner. Unlink stops new
  interactions and keeps those already logged.
- The four `mailbox/binding/` files (`intake.service`, `mail-context.service`, `context-tabs`,
  `convert.service`) are filled by PR 3, with `mailbox.md` changed first.

### 6.11 Home's reads

- `partners.source.js` is M7's from the PR that builds the tables. That PR keeps its `TABLES` true to
  every column named, clears its `OWES`, moves or replaces its queries with the module's own reads and
  updates Home's seed tests, in the same PR (DATABASE_SCHEMA M7).
- Its vocabulary changes to match §6.3 and §6.7: an **active partnership** is `partner.status =
  'active'`; **signed** widens from `signed` or `active` to `signed`, `active`, `expiring` and
  `renewed`, counted in the year of `signed_at` (the year it starts, until then).
- Contact adds bound mail (§6.10). The indexes Home asked for ship in `7010`.
- The staging seed deletes Home's demonstration rows once (`removeHomeStagingRows`; the steps are at
  the top of `seeds/staging/lib/home-staging-rows.js`) and writes the tracker's realistic rows
  instead.

### 6.12 Money, dates, places

Money through `shared/money`, `numeric(18,2)`, strings on the wire. Dates ISO on the wire, day-first
for people, Lagos days. A partner's headquarters and a proposal's cities are picked, never typed
(addresses.md §6.9): `PlaceInput` in the contract, `places.save()` in the owning service.

## 7 · Events, jobs and notifications

| Event / job | When | Does |
|---|---|---|
| `partner.created`, `partner.updated`, `partner.closed`, `partner.owner_changed` | Partner writes | Audit; Partners and Pipeline refresh |
| `partner.stage_changed` | A stage move, a conversion or an import | History line; notice to the owner when someone else moved it; Pipeline refresh |
| `partner.interaction_logged` | Log Interaction, or a bound message | The inactivity spell ends |
| `partner.figures_saved` | Enter Downloads | Audit |
| `lead.created`, `lead.advanced`, `lead.lost` | Lead writes | Audit |
| `lead.converted` | Convert to Partner | Notice to the lead's owner opening the partner |
| `proposal.drafted`, `proposal.sent`, `proposal.viewed`, `proposal.accepted`, `proposal.declined` | Proposal writes | Audit; `proposal.sent` mails the PDF (`templates/email/proposal-sent.html`) once rendered; the owner is told on accepted and declined |
| `agreement.created`, `agreement.submitted` | Agreement writes | Opens `partnership.agreement`; the first approvers are told through My Approvals |
| `agreement.approved`, `agreement.rejected` | The workflow's decision | The owner is told; approved offers Send for Signature |
| `agreement.sent`, `agreement.viewed`, `agreement.signed` | M5's signature events | Status moves; `signed` locks the document and notifies the owner and the partner's readers |
| `agreement.activated`, `agreement.expiring` | The daily job | Status moves; `expiring` starts the renewal reminder |
| `agreement.renewed`, `agreement.closed` | Renew, Close | Audit |
| `agreement.obligation_due` | The reminder engine | Notice to the obligation's owner |
| `mailbox.thread_bound`, `mailbox.thread_unbound` | Link to Partner / Unlink | Audit (mailbox's own events) |
| job `partner-inactivity` (scheduler `partner-inactivity`) | Each morning, after Home's `home-alert-sweeps` | The follow-up task of §6.5 |
| job `agreement-renewal` (scheduler `agreement-renewals`) | Daily, Lagos morning | Moves `signed` to `active` and `active` to `expiring`; the reminder `agreement_renewal`, declared with `defineReminder`, tells the owner at the notice date and again as it nears |
| imports `import-validate`, `import-commit` (M0) | The importer | Unchanged; the importer only declares |

Notification types and categories are declared with the module and appear in Settings · Notifications
under Partnerships. An approval waiting uses the shared `approval-pending` mail and notice. The
module's tabs carry their unread counts and its rows are marked unread; a module with inner views
declares them in its `<module>.views.js` (notifications.md §6). The M7 stub job named
`partner-inactivity` was superseded for the alert by Home's sweep (README §5.15); the job of that name
here is the follow-up, which the sweep does not do.

## 8 · Permissions and visibility by role

Seeded in `0290`; this module adds no role.

| Role | Sees | Can do |
|---|---|---|
| Employee (`partnerships` own: view, create, edit) | Partners, leads, proposals and agreements they own | Enter leads, log interactions, draft proposals, on their own |
| Line Manager (`manager`, `partnerships` team: view, create, edit) | Their team's | The same for their team |
| Head of Department (`partnerships` team: view, create, edit, approve, export) | Their team's; the Partnerships Overview on Home | The same, plus reviews an agreement for their team (§6.7), export |
| Operations & People (`partnerships` all, every action) | Everything | Everything, including Manage Lists (`partnerships.configure`) |
| Management (`partnerships` all: view, create, edit, approve, export) | Everything | Everything but delete |
| Implementation (`partnerships` all, every action) | Everything | Everything, including Manage Lists |
| CEO | Everything | Everything; holds every capability; the agreement's approver (§6.7) |

`partnerships.configure` is held by default by Implementation and Operations & People (and the CEO),
seeded in the milestone's reference seed and declared once in `CAPABILITY_CATALOG`. Restricted fields:
none beyond the employee masks on the owner's name; a bound mail's body is never shown to anyone but
the mailbox's owner (§6.10). Delete is not offered on a partner, a lead, a proposal or an agreement:
partners close, leads are lost, proposals are declined and agreements close, so the history stays.

## 9 · AI and search

- **Feature AI** (a job each, chosen by a person before the feature is built, CLAUDE.md and
  ai-control.md §6.2): `proposal-draft` and `mou-draft` (prompts in `src/services/ai/prompts/`, empty
  today), each registered in `src/services/ai/actions.js` with `chosen_by` and `personal_data: true`
  (a partner's contact is personal data, so DeepSeek is never in their chain). **Recommendation:**
  proposals on Default (one short questionnaire, one source), the MOU on Top Tier with a written
  reason (a long legal document with clauses). The person decides; this guide changes with the answer.
- **AI reads** (`partners.ai.js`, `leads.ai.js`, `proposals.ai.js`, `agreements.ai.js`,
  `partnership_analytics`'s summary): `partners.list`, `partners.get`, `leads.list`, `proposals.list`,
  `agreements.list`, `agreements.renewals`, and a summary read for the pipeline by stage and for the
  month's analytics (20 groups, never a row). Each carries the reader's scope and pages at 25.
- **Cards the person confirms** (praxis-ai.md decision 33; a form of the contract is a card or never,
  for a named reason): `partners.create` (New Partner), `partners.log_interaction`,
  `partners.move_stage`, `leads.create`, `leads.convert`, `leads.lose`, `proposals.create` (the
  questionnaire asked first; saves a Draft). Each `run` is the module's own service function. Not in
  the chat, with the reason: Send Proposal, Mark Accepted and every agreement transition (`design:
  they follow reading the document or the approval chain`), Enter Downloads (`design`), Manage Lists
  (`design`), the import (`file`).
- **AI routes**: "add a partner" opens Partners with New Partner; "move a partner" opens the 360;
  "write a proposal" opens Proposals with New Proposal prefilled; "renewals due" opens Contracts & MOUs.
- **Search** (`partners.search.js`, `leads.search.js`, `proposals.search.js`, `agreements.search.js`):
  partners by name, number, region and contact; leads by title; proposals and agreements by number,
  title and partner. People say "partner", "sponsor", "tracker", "lead", "proposal", "MOU", "contract".
  The route map already names `partner`, `partner_deal`, `lead`, `proposal`, `contract`, `mou` and
  `agreement`; each loses its `search:none` comment as its provider lands.

## 10 · On screen and mobile

**§3 and §6 are for engineers: nothing in them reaches a screen unless it is listed here as tier 1
or tier 2.** The in-browser mock (`app/src/features/partnerships/`) was built to demo.html; where it
differs from this section, this section wins.

### 10.1 Content tiers

| Screen | Open (tier 1) | Behind help (tier 2) | Not on screen (tier 3), lives in |
|---|---|---|---|
| Pipeline | KPI strip (In the Pipeline, Signed This Year, Signed Value, Going Quiet); the Stages bars; Longest at a Stage (partner, stage, days at stage, owner, action); New Partner, Manage Lists | Help on Going Quiet: no contact for the inactivity rule's days. Help on Signed This Year: partnerships that reached signed | The stages' meanings and what each counts: §6.3. The mock's stage note |
| Partners | KPI strip (Active, Total Value, Renewals 180 Days, Quiet Over 30 Days); All Partners and Quiet chips; the list (partner and industry, type, stage, owner, value, last contact); Value by Partnership Type; New Partner, Export | Help on Value: the estimated value of the open partnership | One partnership at a time, status rules: §6.2 |
| Partner 360 | Header (name, industry, type, owner), pills (stage, value, since, last contact); Log Interaction, New Proposal, Move Stage; the stat strip (Partnership Value, Signed Documents, Open Tasks, Interactions 90 Days, Renewal); Organisation (legal name, industry, type, region, headquarters, website, lead owner, stage, **Next Action, Expected Close**); Primary Contacts; Stage History with days at each stage; Interaction Log; Contracts and MOUs; Our Deliverables; Monthly Downloads | Help on Days at Each Stage. Help on Interactions 90 Days | How the 360 is built and why it is never empty: §6.2. The mock's Value by Line chart is **not built**: no table holds it. Chart captions are tier 3 on a phone |
| Move Stage | Stage; Note (Optional), or Why It Is on Hold (required) | Help on a stage: what it means | The transition rules: §6.3 |
| Leads | KPI strip (New, Contacted, Qualified, Converted This Month); the list (lead, source, owner, added, next action, status); Leads by Source; a pressed row opens the lead in a sheet with Mark Contacted, Mark Qualified, Convert to Partner, Close as Lost; New Lead | None | The mock's Lead to Partner card and its sentences: it is an explainer card and is **not built**; §6.4 holds it |
| Proposals | KPI strip (Sent This Year, Accepted, Viewed No Reply, Acceptance Rate); the list (proposal, partner, value, status); a pressed row opens the proposal on paper with Download PDF, Send Proposal, Mark Viewed, Mark Accepted, Mark Declined, New Contract; New Proposal (The Idea: Who It Is For, What We Propose, Why Now; Scope and Value: Cities, Weeks, Value We Ask, Payment Terms) | Help on Value We Ask | The note above the paper ("Six questions in...") is **not built**: a person is told by Draft Proposal's own toast. How the draft is made: §6.6 |
| Contracts & MOUs | KPI strip (Active, In Review, Draft, Renewals 180 Days); the lifecycle bar; the list (document, partner, type, start, renewal, value, status); Renewal Calendar (renewal, partner, due, days, owner); a pressed row opens the agreement with its approval, signature state and obligations; New Contract, Submit for Approval, Send for Signature, Renew, Close | Help on Renewal: the notice period | The workflow's stages and times: §6.7 and Settings · Approvals |
| Analytics | The month; KPI strip (Prospects This Month, Meetings Held, Proposals Sent, Signed); the table per lead owner (prospects, meetings, proposals, signed, active, downloads); Signed Partnerships per Month; Downloads Attributed by Partner; Six Months; Export | Help on each measure: what it counts | The definitions: §6.9. The mock's note under Downloads |
| Manage Lists | Four lists (Partner Types, Stages, Potential Impact, Lead Sources); each value's name and, for a stage, what it counts as; Add, Rename, Move Up, Move Down, Retire, Restore | Help on what a stage counts as | Why lists are data: §6.3 and A26 |
| Mailbox · Link to Partner | A Partner context on the thread (partner, owner, stage, last contact); Link to Partner, Unlink | None | What reaches the partner's readers: §6.10 |

### 10.2 Phone layout

| Screen | First on a phone | Left off a phone | Main action | Navigation |
|---|---|---|---|---|
| Pipeline | Two KPI cards (In the Pipeline, Going Quiet), then the Stages bars, then partner cards with a stage pill | Signed Value, the Longest at a Stage columns for owner | New Partner, full width | Bottom bar More → Partnerships; the six tabs scroll sideways |
| Partners | Two KPI cards (Active, Quiet Over 30 Days), the two chips, then partner cards (name, stage pill, last contact) | Total Value, Value by Partnership Type, Owner and Type columns, Export | New Partner | Tabs scroll sideways |
| Partner 360 | The header, then the stat strip's first three, Next Action, then the sections as stacked cards | Days at each stage meters, Our Deliverables, the downloads chart | Move Stage, full width at the foot; Log Interaction in the page menu | Back to Partners or Pipeline |
| Leads | Two KPI cards (New, Qualified), then lead cards with a status pill; a tapped lead in a bottom sheet | Leads by Source, the Source and Owner columns | New Lead; the sheet's action full width at its foot | Tabs scroll sideways |
| Proposals | Two KPI cards (Sent This Year, Accepted), then proposal cards; a tapped proposal opens full screen as paper (F31, `ListDetail`) | Acceptance Rate, the Partner column | New Proposal; Send Proposal at the sheet's foot | Tabs scroll sideways |
| Contracts & MOUs | Two KPI cards (Active, In Review), then agreement cards with a status pill and renewal date | The lifecycle bar, the Start and Type columns | New Contract; the sheet's next step at its foot | Tabs scroll sideways |
| Analytics | Two KPI cards (Prospects This Month, Signed), then one card per lead owner | The charts, the Six Months table, Export | Pick the month | Tabs scroll sideways |
| Manage Lists | The four lists as a segmented control, then the values as rows | Move Up and Move Down (drag handles stay) | Add | A sheet from Partners or Pipeline |

## 11 · Edge cases

- **A partner created a minute ago**: the 360 shows zeros and empty sections with their empty states;
  Pipeline counts it at the first stage (§6.2).
- **No owner**: allowed (an imported row whose owner name matched nobody). Seen with scope `all`, flagged
  "No owner" on the list, assignable by anyone who can edit it.
- **The owner leaves the company**: their partners keep the owner and the list shows them as a former
  employee; Operations & People reassign by Edit Partner. Nothing is reassigned automatically.
- **Converting a lead twice** (a double press, a second tab): the second call returns the same partner.
- **A duplicate partner** (New Partner or the import): listed with the reasons, never blocked.
- **Move to the same stage**, or backwards without a reason: refused with what to do.
- **Two open partnerships for one partner**: refused by the database's partial unique index.
- **An import row with a type or stage the list lacks**: listed "will be created"; created only when
  ticked at commit. Untick it and the row is held with a warning.
- **The second sheet is missing, or the columns moved**: the mapping step shows what is unmapped and
  names the required fields still without a column; nothing is sent until they have one.
- **An MOU rejected in Approval**: back to Draft with the reason on its card; the owner is told.
- **A signature declined or expired**: the agreement returns to `sent` with Send Again; the document
  is not locked.
- **An agreement ending before it starts**: refused by the database.
- **AI off, or the month's budget spent**: Draft Proposal says AI Is Off or AI Limit Reached and the
  wording is written by hand; nothing else changes.
- **Bound mail**: a message deleted from the mailbox leaves its interaction; a thread bound to a
  partner the reader cannot see is not shown to them.
- **Double press and Enter twice**: one request (F26); every action button is an `ActionGroup`.
- **A very large list**: 25 a page; a select of partners loads the next 25 as its menu nears its end
  (F32).
- **A partner in a currency other than NGN**: counts in lists; Home's sums leave it out.
- **Offline**: writes need the network; the lists show what the app last loaded.

## 12 · Donor code

| From | File | Change on the way in |
|---|---|---|
| praxis | `src/modules/master/party-360.service.js` (332) | The pattern: one call, every figure defaulting to 0, every collection `[]`. Re-pointed at `partner`; no addresses, banks or registrations |
| praxis | `src/modules/sales/partnership_request/` (1,117) | The decision as a transition (reachable only from one state, a reason the database enforces, the downstream record in the same transaction): here Convert to Partner, Close as Lost and the agreement's approval |
| praxis | `src/modules/sales/{lead,opportunity,meeting}/` (1,943) | Stages, stage movement and interaction history. Sales vocabulary dropped; MyCity's words used |
| praxis | `src/modules/sales/proposal/`, `proposal_public/` (553) | Proposal generation. The public view is **not** taken (A9: no public proposal page) |
| pixie | `src/modules/crm/` (2,830), `crm.presets.js` | Pipeline presets as the lists on Manage Lists; no seeded presets (A26) |
| pixie | `src/shared/contacts/` (2,681) | The contact shape and country codes only |
| praxis | `src/modules/mail/binding/` (2,126): `intake.service` (288), `mail-context.service` (283), `context-tabs` (227), `convert.service` (203) | How a thread attaches to a record. Re-pointed at `partner`; the excerpt-only rule of §6.10 is new |
| praxis | `src/modules/hr/vacancy/vacancy.draft.js` (453) | The AI drafting pattern, re-pointed at proposals and MOUs. M3's `queries.assist` and `letter-draft` are the built examples in this repository |
| praxis | `master/_shared/dedup.service.js` | Already ported as `shared/dedup` (M0) |
| praxis | `hr_contract` (992) | The closest lifecycle for the agreement's statuses |
| pixie | `src/shared/documents/documents.esign.service.js` (939) and neighbours | M5 ports it; M7 only calls the signature service |

Nothing ported says where it came from: no project names, paths or "ported from" in code, comments,
tests or config (`scripts/check/provenance.js`).

## 13 · Open questions

Proposed answers wait for GE and LA. A question is moved up into the rules, with the date and who
decided, when it is settled.

- **Q1. The workbook.** The tracker is not in the repository. Needed before the importer or Analytics
  is final: the Status column's values (the stages already include on hold and active), the second
  sheet's own formulas, whether any column holds a value in naira, and how many rows there are.
  Cynthia Osakunih agreed on 10 October to send the workbook and asked that the tracker's owners
  join when M7 starts. JBS Praxis holds a copy (it was passed around by mistake in the 13 October
  call), but it is not in the repository and its contents are unchecked. **Decide:** GE obtains the
  copy MyCity means us to use and a redacted fixture for tests, and books the owners.
- **Q2. History before go-live.** Recommendation: do not import the performance sheet's past months;
  Analytics computes from the system going forward (§6.8). Alternative: import them as fixed monthly
  figures. **Decide:** GE and Cynthia, after seeing the sheet.
- **Q3. Downloads generated** has no source in any document. Recommendation: a figure per partner and
  month, entered by the lead owner on the 360 (Enter Downloads) or imported (§4). Alternatives: a
  campaign-link attribution (a larger feature), or drop the measure. **Decide:** GE with Cynthia.
- **Q4. Follow-up on inactivity.** Recommendation: a Workspace task for the owner, once per quiet spell
  (§6.5). MILESTONES says only "automatic follow-up". **Decide:** GE.
- **Q5. Approval and "Viewed".** Recommendation: review by the owner's Head of Department, approval by
  the CEO; a proposal's Viewed, Accepted and Declined by hand, an MOU's Viewed from M5's signing page.
  A public page for proposals would be a seventh public page and needs ratifying (A9, §18).
  **Decide:** GE; MyCity confirm who approves.
- **Q6. Lead sources** and **industry** are not on the tracker; the mock invented its lists.
  Recommendation: Source Optional, from a list MyCity enters; industry free text with suggestions.
  Drop either if MyCity does not use it.
- **Q7. Mail privacy.** Recommendation: excerpt of 300 characters, subject and parties only, for the
  partner's readers (§6.10). **Decide:** GE and TB (the mailbox's owner).
- **Q8. Numbering.** `schemes.js` has `proposal` (`PRO`) and `mou` (`MOU`); `7099` has `partner`
  (`PAR`), `partnership_opportunity` (`POP`), `partnership_agreement` (`AGR`). Recommendation: one
  scheme a table, `PRO` for proposals, `AGR` for agreements of both kinds (the kind is a column),
  `PAR` for partners, and retire `mou`. Prefixes are MyCity's to confirm (the naming email).
  **Decide:** GE; PR 1 applies it.
- **Q9. Two meanings of signed.** Pipeline counts partnerships that reached `signed`, Home counts
  agreements (§6.7). Confirm both are wanted, or Pipeline follows agreements once imported rows have
  one. **Decide:** GE.
- **Q10. One open partnership a partner.** Recommendation as the tracker has it (one row a partner).
  If MyCity runs two concurrent partnerships with one partner (a media deal and an events deal), the
  partial unique index and the 360's single stage change. **Decide:** GE with Cynthia.
- **Q11. Pipeline's Board button.** The mock's Board button opens Partners. Recommendation: a stage
  board (`Kanban`), a second view of Pipeline on desktop only, or remove the button. **Decide:** AJ
  with GE.
- **Q12. Lead owners "come from that department"** (MILESTONES §12). Recommendation: the owner picker
  offers any active employee and does not restrict by department, since departments are data
  (People · Departments). **Decide:** GE.
- **Q13. Wording.** MyCity's sample proposal and MOU are needed for the templates (`templates/documents/
  proposal.html`, `mou.html`, `templates/email/proposal-sent.html`, `agreement-renewal.html` are empty),
  as M3 had MyCity's letters. Ask Cynthia for one of each that MyCity has sent or signed.
- **Q14. M5's signature service** lands 16 to 20 November; M7 starts 30 November. If it slips, the
  lifecycle is built to Sent and a Record Signed Copy upload (upload engine, vault) stands in until it
  lands. **Decide:** GE on 27 November.
- **Q15. Schedule Meeting.** A scheduled partner meeting as a calendar event (§6.5) is a cut-line item.
- **Q16. The AI jobs** are asked of the person before PR 4 (§9).

## 14 · Change log

- 04/11/2026 · JP · Guide written before any M7 code (CLAUDE.md step 2), with the build plan in
  `docs/handoff/m7-partnerships.md`. Sources: MILESTONES §12 and A14, A21, A26; REUSE_MAP §8; the
  `7000` migration and `7099` seed as they stand; Home's `partners.source.js`; the 10 October
  requirements review; the mock in `app/src/features/partnerships/`. Every answer marked Proposed is
  JBS Praxis's reading of those documents and is for GE and LA to confirm or change in §13.
