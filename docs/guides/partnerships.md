# Partnerships · Engineering Guide

| | |
|---|---|
| Owner | LA |
| Milestone | M7 |
| Backend modules | `partners`, `partner_pipeline`, `leads`, `interactions`, `proposals`, `agreements`, `partnership_analytics` |
| Frontend paths | `app/src/features/partnerships/`, `public-app/src/pages/Proposal.tsx` |
| Permission key(s) | `partnerships` |
| Capabilities | `partnerships.configure` (the Categories tab: categories, their agreement templates, delivery checklists and custom fields; pipeline stages and lists; proof points; saved proposal templates); `partnerships.money` (see and enter commission, the merchant's take and returns; import returns) |
| Screens (PROGRESS.md rows) | #50 Pipeline, #51 Partners, #52 Leads, #53 Proposals, #54 Contracts & MOUs, #55 Analytics; new: Partnerships · Categories and Public · Proposal (ratified 05/11/2026; PR 1 registers them in the next two free PROGRESS rows, #104 and #105 while free, and corrects this guide if another milestone took one first); changes to My Workspace (#4 Today, #5 Tasks, #6 Calendar, #101 Projects), Settings · Approvals (#72), Settings · Imports (#93), Home, Mailbox, Public · Sign Offer and Verify Document |
| Status | Built |
| Last changed | 13/11/2026 |

---

## 0 · How to use this guide

**This guide is the single source of truth for Milestone 7.** Every pull request, every chat and every
reviewer working on Partnerships starts here and reads it in full. It defines what is built, how it
behaves, what each screen shows, how the work is cut into pull requests and when each is done. Nothing
else defines M7: the mock in `app/src/features/partnerships/`, the old draft of this guide (04/11/2026),
`demo.html` and the earlier handoff are superseded where they differ. `docs/handoff/m7-partnerships.md`
only ticks progress and keeps the log; it adds no requirement.

- **Where this guide sits among the binding documents** (CLAUDE.md step 3): MILESTONES §12 is M7's
  scope and decisions A1 to A26 bind it; this guide records how M7 meets them, and the decisions JBS
  Praxis took on 05/11/2026 (§13.1) amend MILESTONES §12 and §18 where they differ. PR 1 writes those
  amendments into MILESTONES, PROGRESS and the registries so the documents say the same. The frontend
  foundation's F1 to F32 bind every screen here. If you find a disagreement this guide does not settle,
  stop and raise it; do not pick.
- **Changing M7:** change this guide first, in the same pull request as the code, with a Change log
  line (§14). A decision that changes behaviour is recorded in §13 with its date and who took it.
- **Before you write code** also read what CLAUDE.md step 2 lists for your task type. This guide names,
  in each pull request of Appendix A, the other guides and chapters that PR must change.
- **Reading order for a newcomer:** §0 and §1 (what and why), §3 (how it flows), Appendix A (the plan),
  then the sections your pull request names.

### 0.1 Words used here

| Word | Means |
|---|---|
| **Lead** | An organisation MyCity is pursuing that has not signed yet. Its own record, its own tab |
| **Partner** | An organisation with at least one signed deal. A lead becomes one when its deal is signed |
| **Deal** | One thing being agreed with a lead or partner: an event edition, an offer, a listing, an integration. A partner has many. Table `partnership_opportunity` |
| **Category** | MyCity's partnership type (Event, Hospitality, Vendor...). Carries templates, a checklist, a default commission and custom fields |
| **Stage** | Where a deal is in MyCity's pipeline (Prospect Identified to Active Partnership, Closed Lost, On Hold). MyCity's own list |
| **Meaning** | The fixed code each stage counts as (`prospect` ... `on_hold`), so stages can be renamed without breaking counts |
| **Health** | How a deal is going beside its stage: On Track, Follow-up Required, Stalled |
| **Blockers** | What is in the way of a Stalled deal |
| **Option** | One priced line of a deal (Regular, VIP, VVIP), as in MyCity's Deal Merchant Agreement |
| **Validity** | How long a deal runs once signed: 30 days, 60 days or a date |
| **Return** | A month's money and downloads from a deal: units sold, gross, MyCity's commission, payout, downloads |
| **Deliverable** | A task MyCity owes on a signed deal, raised from the category's checklist |
| **Proof point** | A fact about MyCity a proposal may cite (a figure, a partner logo, an endorsement) |
| **Proposal Studio** | Where a proposal is briefed, questioned, drafted by Claude, edited and sent |
| **Design kit** | The designed layouts every proposal is built from |
| **Agreement** | A Deal Merchant Agreement, MOU, service agreement or contract, filled from a template |
| **Seal** | The final signed PDF: signatures stamped, certificate page, QR on every page, hashed and locked |
| **Verdicts** | The two checks on the verification page (A12): the content matches, the file is the one sealed |
| **360** | One record's whole picture on one screen: the Partner 360 and the Lead 360 |

### 0.2 Where things come from

The decisions JBS Praxis took on 05/11/2026 (27 answers, §13.1); the Partnerships Workflow Discovery
meeting of 5 November 2026 (Edidiong Etudor for MyCity, Tom-Blake Asaah and JBS Praxis); MyCity's
tracker read column by column on 05/11/2026 (contacts masked; §6.13); MyCity's Deal Merchant Agreement
(a signed sample of 5 November, redacted in `docs/MyCity-ERP-Documents/partnership-samples/`); the requirements review of 10 October and the discovery call of
2 September; MILESTONES §12, §18 and A14, A21, A23, A26; REUSE_MAP §8; the code as it stands on
05/11/2026 (`7000`, `7099`, the empty M7 modules, Home's `partners.source.js`). MyCity's material
inspires this guide; it does not limit it.

---

## 1 · What it is for

MyCity grows through partners: event organisers who ticket and check in on MyCityApp, hotels and
restaurants listed on it, vendors, media, government and strategic integrations (mobility, flights,
hotels). Today one Google Sheets workbook holds them, about a hundred rows kept by the growth team in
Abuja, Port Harcourt, Ibadan, Enugu, Lagos and Owerri, with agreements and proposals living in email.

This module is MyCity's partnership system of record and its sales studio:

- A lead owner captures a **lead** and its first **deal**, moves it through MyCity's stages with one
  press on its **360**, records **health** and **blockers**, logs every call and meeting, and the hub
  raises the follow-up when a partner goes quiet.
- To close, the hub fills the category's **agreement** from the record, routes it through **approval**,
  and sends it for a **signature** the partner draws on their phone after confirming a code; the
  signed document is **sealed**, hashed twice and **verifiable by QR**.
- A custom **proposal** is drafted by **Claude** from the meeting's notes or transcript and the record,
  in **designed layouts** that can close a million-dollar deal, and sent by a person who confirms where
  it goes, as a PDF and a tracked link.
- **Signing turns the lead into a partner.** The **Partner 360** then holds everything about the
  partner on one screen: deals, documents, returns, projects, tasks, events and history.
- **Analytics** reads it all per lead owner, as MyCity's monthly performance sheet does; **Praxis AI**
  answers questions about it within each reader's grants.

Used by **lead owners** (growth officers and marketing leads), **Heads of Department** (their team's
pipeline; first approval of agreements), **Operations & People, Management, Implementation, General
Management and the CEO** (everything, the money, final approval), and anyone whose project, task or
event is for a partner. Partners only ever see three public pages: the proposal, the signing page and the
verification page.

## 2 · Screens affected

| Screen / tab (slug) | Where | Who sees it | What it shows | What a person can do there |
|---|---|---|---|---|
| Partnerships · Pipeline (`pipeline`) | Staff app | `partnerships` view, within scope (§6.1) | KPI strip (open deals, signed this year, signed value, stalled), deals by stage, longest at a stage, stalled with their blockers | Filter by stage, category, region, owner, health; open a record; New Lead |
| Partnerships · Categories (`categories`), new, second tab | Staff app | `partnerships` view; writes need `partnerships.configure` | Categories; for the picked one: defaults, agreement templates, delivery checklist, custom fields, its partners and leads; Pipeline Settings; Proof Points | New Category, Edit, Add Template, Tidy With AI, Add Item, Add Field, Retire, Restore, Start From Tracker |
| Partnerships · Partners (`partners`) and the Partner 360 (`?id=`) | Staff app | `partnerships` view, within scope | The partner list beside the 360: header, four KPI cards, tabs Overview, Deals, Documents, Returns, Work, Activity, Contacts, Details | New Partner, New Deal, the stage switcher, Set Health, Log Interaction, Upload Document, Generate Agreement, New Proposal, Enter Returns, New Project, New Task, New Event, Add Contact, Export |
| Partnerships · Leads (`leads`) and the Lead 360 (`?id=`) | Staff app | `partnerships` view, within scope | The lead list (status from its deal) beside the Lead 360: header, KPI cards, tabs Overview, Deal, Documents, Work, Activity, Contacts, Details | New Lead, the stage switcher, Set Health, Log Interaction, New Proposal, Close as Lost, Convert to Partner |
| Partnerships · Proposals (`proposals`) and the Proposal Studio (`?id=`, `?new=`) | Staff app | `partnerships` view, within scope | The proposal list beside the proposal as it will be seen; the studio's Brief, Questions, Draft, Edit and Send steps | New Proposal, Write Draft, Reshuffle, Rewrite Section, Change Layout, Replace Image, Send Proposal, Download PDF, Copy Link, Mark Accepted, Mark Declined, Save as Template, Withdraw |
| Partnerships · Contracts & MOUs (`contracts-and-mous`) | Staff app | `partnerships` view, within scope | KPI strip, the lifecycle, agreements beside the picked one (approval, signers, verification, renewal) | Generate Agreement, Submit for Approval, Send for Signature, Record Signed Copy, Send Again, Renew, Close Agreement |
| Partnerships · Analytics (`analytics`) | Staff app | `partnerships` view, within scope; money needs `partnerships.money`; ratings follow Performance's rules | The period; per lead owner the performance sheet's eight measures; signed and returns per month; by category, region and stage | Pick a period, Export |
| My Workspace · Projects (#101), Tasks (#5), Calendar (#6), Today (#4) | Staff app | Workspace's own rules (A24) | A project, task or event connected to a partner shows it; a signed deal's event days on its team's calendar | **Connect to Partner** on New Project, New Task and New Event; a Partner filter on the lists |
| Settings · Approvals (#72) | Staff app | `settings` view; edit to change | The Partner Agreement flow (§6.9) | Edit Stages, Applies When, as every flow |
| Settings · Imports (#93) | Staff app | `partnerships` create; returns need `partnerships.money` | Importers Partnership Tracker and Partnership Returns | The engine's steps, with the new **Map Values** step (§6.13) |
| Home · Overview, Alerts, Reports | Staff app | Home's rules (home.md) | Open Opportunities, Active Partnerships, Signed Value, No Contact 30 Days, Proposals Out; the Partnership Pipeline chart; Partner Inactivity alerts | Open the record behind a card |
| Mailbox · a thread | Staff app | The mailbox's owner, with `partnerships` view | A Partner context on the thread | Link to Partner, Unlink |
| Public · Proposal (`go.mycityapp.io/proposal/<token>`), new | Public site | Whoever holds the link | The proposal as designed; the owner's contact | Read, Download PDF |
| Public · Sign Offer (`go.mycityapp.io/sign/<token>`, M5) | Public site | The signer the link was sent to | The agreement in full, then the signing steps | Send Code, enter it, type or draw a signature, Sign Agreement, Download Signed Copy |
| Public · Verify Document (`go.mycityapp.io/verify/...`, M5) | Public site | Anyone with a reference; the document itself only through its QR | Status, signers with date and time, the two verdicts; the document from its QR | Read |
| Notification bell, ⌘K, Praxis AI | Both shells | Within the reader's grants | §7; every record type by name and number; questions and cards (§9) | Open; ask; confirm a card |

## 3 · How the screens relate

1. **A lead is captured with its first deal.** Leads · New Lead (`POST /leads`): the organisation, its
   category, region and primary contact, and the deal being pursued (title, objective, stage, projected
   value, expected close, event dates and venue when it is an event). The deal opens at the first
   stage. The lead's status (New, Contacted, Qualified, Lost, Converted) is read from its deal's stage,
   never typed (§6.4). A likely duplicate is shown before saving (§6.2).
2. **The deal moves with one press.** On the 360, the **stage switcher** shows MyCity's stages in order;
   pressing the next one moves the deal (`POST /deals/:id/stage`), writes history and tells the owner
   when someone else moved it. Moving back, to On Hold or to Closed Lost asks why. **Health** is set
   beside it; Stalled requires **Blockers**. There is no board: the 5 November meeting agreed that
   fifteen swim lanes are worse than one press, and the lists filter by stage instead (§6.5).
3. **Contact is recorded and watched.** Log Interaction records a call, meeting, email, visit or note. A
   meeting yet to happen is a calendar event connected to the deal. A mail thread linked to the record
   adds each message (§6.15). Home's morning sweep raises Partner Inactivity for a quiet live partner;
   the `partner-inactivity` job then sets its live deals to Follow-up Required and gives the owner one
   Workspace task (§6.12).
4. **A proposal is written with Claude.** New Proposal opens the **Proposal Studio** on a deal: the
   person pastes notes or uploads a meeting transcript and adds images; Claude reads the brief, the
   record, the category, its past proposals and MyCity's proof points and asks **question cards** for
   what is missing; the person answers, accepts suggestions, skips or **reshuffles** cards; Claude
   writes the proposal into the **design kit**'s layouts; the person edits any section, layout or
   image; **Send Proposal** asks them to confirm the recipients and sends a PDF and a private link; the
   deal records Viewed when the link is opened (§6.10, §6.11).
5. **An agreement is filled, approved, signed and sealed.** Generate Agreement fills the category's
   template (the Deal Merchant Agreement for events, an MOU, a service agreement) from the partner, the
   contact and the deal's options; the person reviews it; Submit for Approval opens the Partner
   Agreement flow (Head of Department, then the CEO; editable on Settings · Approvals); Send for
   Signature mails each signer a link; on the signing page the signer reads the agreement, confirms a
   code sent to their email, types their name and title and draws or types their signature; the hub
   stamps it in, seals the PDF with a certificate page and a QR on every page, hashes it twice and locks
   it (§6.8, §6.9). Record Signed Copy takes a signature made on paper.
6. **Signing converts.** When a lead's deal is signed (a completed signature, a signed copy recorded, or
   a stage move with the copy attached), in the same transaction the lead becomes a partner and its
   deal, contacts, documents, interactions, linked mail, projects, tasks and events move with it (§6.4).
   The category's **delivery checklist** becomes Workspace tasks for the deal's owner, inside the deal's
   project when it has one, listed as Our Deliverables (§6.7). The deal's event days join the calendar
   of the deal's team (§6.16).
7. **Work connects to the partner.** On My Workspace, **Connect to Partner** on New Project, New Task and
   New Event reveals Partner and Deal; from the 360, the same forms open already connected. The 360's
   Work tab lists what the reader may already see and counts the rest; connecting never widens access
   (§6.16).
8. **Returns arrive monthly.** Units sold, gross, MyCity's commission, the payout and downloads are
   entered on the 360 or imported from the consumer app's report on Settings · Imports (Partnership
   Returns). The KPI cards, Analytics, Home and Praxis AI read them (§6.14).
9. **The tracker comes in once.** On Categories, **Start From Tracker** reads the workbook's dropdowns to
   set up stages, categories and impact; on Settings · Imports, **Partnership Tracker** maps its columns
   and values, matches staff names to people, places cities, splits contacts, and writes signed rows as
   partners and the rest as leads (§6.13).
10. **Agreements and deals live on.** The daily `agreement-renewals` job makes a signed agreement Active
    on its start and Expiring at its notice date (and tells the owner), completes deals past their
    validity, expires proposals and keeps each partner's status (§6.6, §6.8).
11. **Everything is found and asked.** ⌘K finds every record type and offers every New action; Praxis
    AI answers "what is our partnership value" or "who is our highest contributing partner" within the
    reader's grants and offers every create and edit form as a card (§9). Home and Analytics read the
    same figures (§6.17, §6.18).

## 4 · Data

`7000` is merged and never edited. Everything it lacks comes in fix-forward migrations from `7010`
(Appendix A, PR 1). Every table has `created_at` and `updated_at timestamptz`; ids are UUIDs; money is
`numeric(18,2)`, currency NGN; dates are `date` in Lagos days. Write paths are the owning module's
service, in a transaction, with `emit()`.

### 4.1 Tables at a glance

| Table | Owner module | State | One line |
|---|---|---|---|
| `partner_category` | `partner_pipeline` | new | A partnership type with its defaults |
| `partner_category_template` | `partner_pipeline` | new | Which agreement templates a category offers |
| `partner_category_checklist_item` | `partner_pipeline` | new | What MyCity delivers on a signed deal of the category |
| `partnership_field` | `partner_pipeline` | new | A custom field definition |
| `lead` | `leads` | new | An organisation before signing |
| `partner` | `partners` | 7000, extended | An organisation with a signed deal |
| `partner_contact` | `partners` | 7000, extended | A person at a lead or partner |
| `partner_document` | `partners` | new (`7060`, PR 3) | A vault document of a lead or partner: its kind, deal and origin |
| `partnership_opportunity` (deal) | `partner_pipeline` | 7000, extended | A deal |
| `deal_option` | `partner_pipeline` | new | A priced line of a deal |
| `deal_member` | `partner_pipeline` | new | The deal's team |
| `deal_deliverable` | `partner_pipeline` | new | A checklist item raised as a task |
| `deal_return` | `partner_pipeline` | new | A deal's month of returns and downloads |
| `partnership_stage_history` | `partner_pipeline` | 7000, extended | Stage and health history |
| `partner_interaction` | `interactions` | 7000, extended | A call, meeting, email, visit or note |
| `partner_mail_thread` | `interactions` | new | A mail thread linked to a record |
| `partnership_proposal` | `proposals` | 7000, extended | A proposal and its versions |
| `proposal_question` | `proposals` | new | A question card |
| `proposal_source` | `proposals` | new | Notes or a transcript given to Claude |
| `proposal_asset` | `proposals` | new | An image of a proposal |
| `proposal_template` | `proposals` | new | A saved structure for a category |
| `proposal_view` | `proposals` | new | One opening of the public link |
| `proof_point` | `proposals` | new | A fact about MyCity a proposal may cite |
| `partnership_agreement` | `agreements` | 7000, extended | An agreement |
| `agreement_obligation` | `agreements` | 7000, unused | Dropped by a fix-forward when empty; replaced by `deal_deliverable` |
| `signature_request`, `signature` | `signatures` (M5) | 5000 | Written only through the signatures service |
| `project`, `task`, `calendar_event` | `projects`, `tasks`, `calendar` (M2) | 2000, extended | Gain `partner_id`, `lead_id`, `deal_id` |
| `reference_value` | `settings` | 0050 | The stage, impact, source and document-kind lists; the health and interaction code lists |
| `place` | `maps` | 0490 | Headquarters, region cities, venues |
| `document`, `template_version`, `public_token` | M0 | 0080 and M0 | The vault, template wording, public tokens |

### 4.2 Columns

**`partner_category`**: `partner_category_id`; `name text NOT NULL UNIQUE`; `description text`;
`default_commission_pct numeric(5,2) CHECK 0..100`; `default_validity_days integer CHECK > 0`;
`counts_as_vendor boolean NOT NULL DEFAULT false`; `display_order integer`; `active boolean NOT NULL
DEFAULT true`. Not seeded (A26).

**`partner_category_template`**: `partner_category_template_id`; `partner_category_id NOT NULL`;
`template_key text NOT NULL` (a key of `template_version`); `kind text CHECK IN ('deal_merchant',
'mou', 'service_agreement', 'contract')`; `label text`; `is_default boolean`; `countersigned boolean`
(MyCity signs too); `active boolean`; `asks jsonb NOT NULL DEFAULT '[]'` (migration `7050`: the values a
person gives when an agreement is generated, each `{ key, label, type, options?, default? }`, named in the
wording as `{{ ask.<key> }}`; a key is made from the label once and never changes). One default per category
and kind (partial unique index).

**`partner_category_checklist_item`**: `partner_category_checklist_item_id`; `partner_category_id NOT
NULL`; `title text NOT NULL` (3 to 120 characters); `description text`; `due_from text CHECK IN
('signing', 'event_start')`; `due_days integer` (after signing, or before the event's start);
`position integer`; `active boolean`.

**`partnership_field`**: `partnership_field_id`; `key text NOT NULL UNIQUE` (snake_case, from the
label, never changed); `label text NOT NULL`; `field_type text CHECK IN ('text', 'long_text',
'number', 'money', 'date', 'pick', 'multi_pick', 'yes_no', 'url')`; `options jsonb` (for picks);
`applies_to text CHECK IN ('lead', 'partner', 'deal')`; `partner_category_id` (null: every category);
`filterable boolean`; `position integer`; `active boolean`.

**`lead`**: `lead_id`; `number text UNIQUE` (`LED-0001`); `name text NOT NULL`; `partner_category_id`;
`industry text`; `region_scope text CHECK IN ('cities', 'national', 'africa', 'worldwide')`; `website
text`; `objective text`; `source text` (a `lead_source` code); `owner_id uuid REFERENCES employee`;
`identified_on date`; `impact text[]` (`partnership_impact` codes); `impact_rating text CHECK IN
('high', 'medium', 'low')`; `impact_note text`; `comments text`; `custom jsonb NOT NULL DEFAULT '{}'`;
`status text CHECK IN ('new', 'contacted', 'qualified', 'lost', 'converted')`; `lost_reason text`;
`converted_partner_id uuid REFERENCES partner`; `converted_at timestamptz`. Checks: `status = 'lost'`
needs `lost_reason`; `status = 'converted'` needs `converted_partner_id`. Region cities are `place` rows
with owner `lead.cities` (one a city, keyed by the lead and the city's place in the list).

**`partner`** (7000 has `number`, `name`, `partner_type`, `status`, `website`, `industry`,
`country_code`, `owner_id`, `metadata`): adds `legal_name`, `partner_category_id`, `region_scope`,
`logo_document_id`, `since date`, `lead_id`, `custom jsonb`, `closed_at`, `close_reason`; `status`
becomes `CHECK IN ('active', 'dormant', 'closed')` (default `dormant`; a `prospect` row becomes
`dormant`); `partner_type` is copied into `partner_category_id` by the migration where rows exist (a
category named by 7099's label) and stops being required; nothing reads it after PR 1, and `7060`
drops it one release later, in PR 3 (docs/MIGRATIONS.md §8). Headquarters (an area) and region cities
are `place` rows (`partner.headquarters`, `partner.cities`).

**`partner_contact`** (7000): `partner_id` becomes nullable; adds `lead_id`; `CHECK (num_nonnulls
(partner_id, lead_id) = 1)`; `phones text[]` beside `phone`; `signatory boolean`; unique email per
record.

**`partner_document`** (`7060`, PR 3): `partner_document_id`; `document_id uuid NOT NULL UNIQUE
REFERENCES document ON DELETE CASCADE`; `partner_id` or `lead_id` (`CHECK (num_nonnulls(partner_id,
lead_id) = 1)`); `deal_id` (`ON DELETE SET NULL`); `kind text` (a `partner_document_kind` code, null for
a signed copy); `origin text CHECK IN ('upload', 'proposal', 'agreement', 'signed_copy')`;
`attached_by`. The vault's row names this row as its entity (`partner_document`), so conversion
re-points this row and never rewrites the vault (§6.4).

**`partnership_opportunity`**, the deal (7000 has `number`, `partner_id`, `title`, `stage`, `status`,
`owner_id`, `estimated_value`, `currency`, `probability`, `expected_close_on`, `closed_at`):
`partner_id` becomes nullable; adds `lead_id`; `CHECK (partner_id IS NOT NULL OR lead_id IS NOT NULL)`;
`event_title`, `event_starts_on`, `event_ends_on` (`>= event_starts_on`), `expected_attendance integer`,
`objective`, `health text` (`deal_health` code, default `on_track`), `blockers text`, `next_action`,
`next_action_on date`, `commission_pct numeric(5,2)`, `commission_deviates boolean`, `validity_days
integer`, `valid_until date`, `identified_on date`, `signed_at timestamptz`, `completed_at`,
`close_reason`, `impact text[]`, `impact_rating`, `impact_note`, `comments`, `custom jsonb`; `status`
becomes `CHECK IN ('open', 'live', 'completed', 'lost')`; `stage` default `lead` is dropped (the first
stage of MyCity's list is set by the service). Check: `health = 'stalled'` needs `blockers`. The venue is
a `place` row (`deal.venue`).

**`deal_option`**: `deal_option_id`; `deal_id NOT NULL ON DELETE CASCADE`; `position smallint CHECK
1..5`, unique per deal; `label text NOT NULL`; `original_price numeric(18,2)`; `discount_pct
numeric(5,2)`; `deal_price numeric(18,2)`; `price_note text` (a price that is not money: "App
download", "Free entry"); `commission_amount numeric(18,2)`; `merchant_take numeric(18,2)`.

**`deal_member`**: `deal_id`, `employee_id`, `role text` (Owner, Lead, Support, On-ground), unique
pair. The owner is always a member.

**`deal_deliverable`**: `deal_deliverable_id`; `deal_id`; `checklist_item_id` (nullable: added by hand);
`title`; `task_id uuid REFERENCES task`.

**`deal_return`**: `deal_return_id`; `deal_id`; `month date` (the 1st); `units_sold integer`;
`gross_sales`, `mycity_commission`, `paid_to_partner numeric(18,2)`; `downloads integer`; `note`;
`source text CHECK IN ('entered', 'import')`; `import_batch_id`; `entered_by`. Unique `(deal_id,
month)`.

**`partnership_stage_history`** (7000 has `from_stage`, `to_stage`, `changed_by`, `reason`,
`changed_at`): adds `kind text CHECK IN ('stage', 'health')`, `source text CHECK IN ('person',
'signature', 'import', 'system', 'conversion')`. For a health line `from_stage` and `to_stage` hold
health codes. Append only (no update path in the repo).

**`partner_interaction`** (7000): `partner_id` becomes nullable; adds `lead_id` (one of the two);
`interaction_type` gains `note`. Migration `7120` (PR 8): a message logged from a linked thread keeps
`mail_from`, `mail_to text[]` and `mail_thread_id` (`ON DELETE SET NULL`) on the interaction, and
`mail_message_id` lets its message go (`ON DELETE SET NULL`), so emptying Trash never takes the
record's history (§6.15).

**`partner_mail_thread`**: `mail_thread_id uuid UNIQUE REFERENCES mail_thread`; `partner_id` or
`lead_id` (one); `deal_id`; `bound_by`; `bound_at`; `unbound_at`.

**`partnership_proposal`** (7000 has `partnership_opportunity_id`, `number`, `version`, `status`,
`value`, `currency`, `document_id`, `sent_at`, `accepted_at`, `created_by`): adds `title`, `brief
jsonb`, `content jsonb` (the contract's `ProposalContent`), `design_template_id`, `ai_run_id`,
`valid_until`, `public_token_id`, `sent_to text[]`, `sent_cc text[]`, `first_viewed_at`,
`last_viewed_at`, `view_count integer`, `declined_at`, `decline_reason`, `withdrawn_at`,
`supersedes_id` (the version it revises); `status` `CHECK IN ('brief', 'questions', 'writing', 'draft',
'sent', 'viewed', 'accepted', 'declined', 'expired', 'withdrawn')`.

**`proposal_question`**: `proposal_question_id`; `partnership_proposal_id`; `position`; `group_key text
CHECK IN ('partner', 'offer', 'audience', 'money', 'timing', 'proof')`; `question text`; `why text`;
`answer_kind text CHECK IN ('short_text', 'long_text', 'number', 'money', 'date', 'pick',
'multi_pick')`; `options jsonb`; `suggested jsonb`; `suggested_from text`; `required boolean`;
`answer jsonb`; `state text CHECK IN ('open', 'answered', 'skipped', 'replaced')`; `replaces_id`.

**`proposal_source`**: `partnership_proposal_id`; `kind text CHECK IN ('notes', 'transcript')`;
`document_id` (a transcript upload); `text` (the notes, or the transcript's text).

**`proposal_asset`**: `partnership_proposal_id`; `document_id NOT NULL`; `role text CHECK IN ('cover',
'gallery', 'logo', 'section')`; `section_key`; `alt text NOT NULL`; `stand_in boolean` (a kit image
used until MyCity uploads one).

**`proposal_template`**: `name`; `partner_category_id`; `structure jsonb` (layouts, their order,
tone notes; never a partner's facts); `created_from_proposal_id`; `active`.

**`proposal_view`**: `partnership_proposal_id`; `viewed_at`; `ip_hash` (SHA-256 of the address with
a server secret, never the address); `user_agent`.

**`proof_point`**: `kind text CHECK IN ('stat', 'partner_logo', 'endorsement', 'result')`; `label`;
`value text` (the figure as said: "10,000+"); `detail`; `document_id` (a logo or image); `source_note`
(where the fact comes from); `position`; `active`.

**`partnership_agreement`** (7000 has `partner_id`, `partnership_opportunity_id`, `proposal_id`,
`number`, `title`, `status`, `starts_on`, `ends_on`, `value`, `currency`, `document_id`,
`signature_request_id`, `owner_id`): `partner_id` becomes nullable; adds `lead_id` (one of the two),
`kind`, `template_key`, `template_version`, `fields jsonb` (the values and asks it was filled with),
`body` (the edited wording, Markdown through the one renderer), `workflow_instance_id`,
`signed_document_id`, `signed_at`, `signed_outside boolean`, `renewal_notice_days integer DEFAULT 90`,
`renews_agreement_id`, `closed_at`, `close_reason`; `status CHECK IN ('draft', 'review', 'approval',
'sent', 'viewed', 'signed', 'active', 'expiring', 'renewed', 'closed')`; `starts_on` becomes nullable
until signing.

**Workspace (2000):** `project`, `task` and `calendar_event` each gain `partner_id`, `lead_id`,
`deal_id` (nullable, `CHECK (partner_id IS NULL OR lead_id IS NULL)`), indexed, written only through the
Workspace services.

### 4.3 Lists, seeds, numbering and indexes

- `reference_value` domains: **MyCity's** `partnership_stage` (with `metadata.meaning`),
  `partnership_impact`, `lead_source`, `partner_document_kind` (Proposal, MOU, Service Agreement,
  Contract, Brief, Invoice, Media, Other), entered on Categories or by Start From Tracker; **seeded**
  (code lists the code switches on, A26) `deal_health` (`on_track`, `follow_up_required`, `stalled`) and
  `interaction_type` (`call`, `meeting`, `email`, `visit`, `note`).
- `7099` (merged) seeds business choices A26 forbids; a fix-forward switches them off (`active =
  false`), deleting nothing a row uses.
- The reference seed adds `partnerships.configure` and `partnerships.money` with their holders (§8), the
  `partnership.agreement` flow, and the numbering schemes.
- **Numbering** (settled 05/11/2026, §13.1 item 27): `partner` `PAR-0001` (never resets), `lead`
  `LED-0001`, `deal` `DEAL-2026-0001` (yearly), `proposal` `PRO-0001`, `agreement` `AGR-2026-0001`
  (yearly). `schemes.js` drops `mou`; `7099`'s `POP` is replaced.
- **Indexes:** Home's four (`partner_interaction (partner_id, occurred_at DESC)`, `partner (owner_id)`,
  `partnership_opportunity (owner_id, status)`, `partnership_agreement (status, starts_on)`); GIN on
  every `custom`; trigram on `lead.name` and `partner.name`; `partnership_opportunity (stage)`,
  `(lead_id)`, `(partner_id)`; `deal_return (deal_id, month)` unique; Workspace's three link columns.
- **Staging** writes realistic leads, partners, deals, options, returns, proposals, agreements and
  proof points from a **synthetic** tracker (the real one's headers and shapes, invented organisations
  and contacts), and removes Home's demonstration rows first (§6.17). Production starts clean (A5).

## 5 · API

Contract files: `packages/contract/schemas/partners.js`, `partner_pipeline.js` (categories, lists,
fields, deals, options, returns, stages), `leads.js`, `interactions.js`, `proposals.js`,
`agreements.js`, `partnership_analytics.js`; the mailbox, projects, tasks and calendar contracts gain
their fields. Snake_case Zod; the frontend declares none (the INTERIM `app/src/api/types/partnerships.ts`
is deleted). Prefix `/api/v1/partnerships`. Every list is paged at 25 (`pageQuery`, `sendPaged`); no
page size anywhere. Places are `PlaceInput`; money is a string; a route behind a capability names it.
The schemas and their fields are catalogued in Appendix C.

| Method and path | Contract | Permission · scope | Paged | Notes |
|---|---|---|---|---|
| `GET /pipeline` | `PipelineQuery` → `PipelineSummary` | `partnerships` view · §6.1 | no | Counts, values, deals by stage, longest at stage, stalled |
| `GET /deals` | `DealListQuery` → `DealPage` | view · §6.1 | yes | Filters: stage, category, region, owner, health, status, `q`, filterable custom fields |
| `GET /deals/:id` | → `DealDetail` | view · §6.1 | no | Options, members, history, money with `partnerships.money` |
| `POST /deals`, `PATCH /deals/:id` | `DealCreate`, `DealUpdate` → `DealDetail` | create; edit · §6.1 | | On a lead or partner |
| `POST /deals/:id/stage` | `StageMove` → `DealDetail` | edit · §6.1 | | §6.5; a signed meaning converts a lead (§6.4) |
| `POST /deals/:id/health` | `HealthSet` → `DealDetail` | edit · §6.1 | | Stalled needs blockers |
| `GET /deals/:id/returns`, `PUT /deals/:id/returns/:month` | → `ReturnPage`; `ReturnSave` → `DealReturn` | view, edit · `partnerships.money` | yes | `month` is `YYYY-MM` |
| `GET /categories`, `GET /categories/:id` | → `CategoryPage`; → `CategoryDetail` | view | yes | |
| `POST /categories`, `PATCH /categories/:id` | `CategoryCreate`, `CategoryUpdate` → `CategoryDetail` | edit · `partnerships.configure` | | Retire and restore; never delete one in use |
| `POST /categories/:id/templates`, `PATCH /category-templates/:id` | `CategoryTemplateCreate` (name, kind, wording as the editor's HTML, asks), `CategoryTemplateUpdate` → `CategoryDetail` | edit · `partnerships.configure` | | The wording is saved in the same press, through `templates.agreements` on `template_version` |
| `GET /category-templates/:id`, `PUT /category-templates/:id/wording` | → `CategoryTemplateDetail`; `TemplateWordingSave` → `CategoryTemplateDetail` | view; edit · `partnerships.configure` | | The wording as the editor opens it (each field a chip), and its next version, with its asks |
| `POST /templates/tidy` | `TemplateTidy` → `TemplateTidyDraft` | edit · `partnerships.configure` | | AI tidies pasted wording and proposes its fields (§6.8); nothing kept; the answer says AI Is Off or the month's limit when there is no draft |
| `POST /categories/:id/checklist`, `PATCH /checklist-items/:id` | `ChecklistItemCreate`, `ChecklistItemUpdate` → `CategoryDetail` | edit · `partnerships.configure` | | |
| `GET /fields`, `POST /fields`, `PATCH /fields/:id` | `FieldListQuery` → `FieldList`; `FieldCreate`, `FieldUpdate` → `Field` | view; edit · `partnerships.configure` | no | §6.3 |
| `GET /lists/:list`, `POST /lists/:list`, `PATCH /lists/:list/:code` | → `ListValues`; `ListValueCreate`, `ListValueUpdate` | view; edit · `partnerships.configure` | no | Stages carry a meaning |
| `POST /setup/from-tracker`, `POST /setup/from-tracker/apply` | `TrackerSetup` → `TrackerSetupDraft`; `TrackerSetupApply` → `SetupResult` | edit · `partnerships.configure` | | Start From Tracker (§6.13) |
| `GET /proof-points`, `POST /proof-points`, `PATCH /proof-points/:id`, `POST /proof-points/:id/image` | `ProofPointCreate`, `ProofPointUpdate`, an upload → `ProofPoint` | view; edit · `partnerships.configure` | yes | §6.11; the image is uploaded to the proof point and stored against it, never named by `document_id` |
| `GET /leads/summary`, `GET /leads` | → `LeadsSummary`; `LeadListQuery` → `LeadPage` | view · §6.1 | yes | |
| `GET /leads/:id` | → `Lead360` | view · §6.1 | no | Zero-data safe |
| `POST /leads`, `PATCH /leads/:id` | `LeadCreate` (with its first deal), `LeadUpdate` → `Lead360` | create; edit · §6.1 | | Idempotency-Key |
| `POST /leads/:id/lose` | `LeadLose` → `Lead360` | edit · §6.1 | | Its deal to Closed Lost |
| `POST /leads/:id/convert` | `LeadConvert` → `LeadConverted` | edit · §6.1 | | Needs a signed deal or a signed copy; idempotent |
| `GET /partners/summary`, `GET /partners` | → `PartnersSummary`; `PartnerListQuery` → `PartnerPage` | view · §6.1 | yes | |
| `GET /partners/:id` | → `Partner360` | view · §6.1 | no | Zero-data safe; money only with `partnerships.money` |
| `POST /partners`, `PATCH /partners/:id`, `POST /partners/:id/close` | `PartnerCreate`, `PartnerUpdate`, `PartnerClose` → `Partner360` | create; edit · §6.1 | | §6.6 |
| `GET /duplicates` | `DuplicateQuery` → `Duplicates` | create | no | Over leads and partners, advisory, at most 25 |
| `POST /contacts`, `PATCH /contacts/:id` | `ContactCreate`, `ContactUpdate` → `Contact` | edit · §6.1 | | |
| `GET /interactions`, `POST /interactions` | `InteractionListQuery` → `InteractionPage`; `InteractionCreate` → `Interaction` | view; create · §6.1 | yes | |
| `GET /documents`, `POST /documents` | `PartnerDocumentQuery` → `PartnerDocumentPage`; `PartnerDocumentAttach` → `PartnerDocument` | view; edit · §6.1 | yes | Every document of a record; Upload Document tags a vault upload |
| `GET /work` | `PartnerWorkQuery` (`partner_id` or `lead_id`, `deal_id`, `kind`) → `PartnerWorkPage` | view · §6.1 | yes | Projects, tasks, events the reader may see, and the hidden counts (§6.16) |
| `GET /proposals/summary`, `GET /proposals`, `GET /proposals/:id` | → `ProposalsSummary`; `ProposalListQuery` → `ProposalPage`; → `ProposalDetail` | view · §6.1 | yes | |
| `POST /proposals` | `ProposalStart` → `ProposalDetail` | create · §6.1 | | Opens the studio, queues the questions |
| `GET /proposals/:id/preview` | → `ProposalPreview` | view · §6.1 | | The kit's HTML of the proposal as it stands, and the layouts each section may take (§6.11) |
| `POST /proposals/:id/questions/retry` | `EmptyBody` → `ProposalDetail` | edit · §6.1 | | Try Again after the questions failed |
| `POST /proposals/:id/questions/:qid/answer`, `/skip`, `/reshuffle` | `QuestionAnswer`; `EmptyBody` → `ProposalDetail` | edit · §6.1 | | |
| `POST /proposals/:id/draft` | `EmptyBody` → `ProposalDetail` | edit · §6.1 | | Queues the writing; refused while a required card is open |
| `PATCH /proposals/:id/content` | `ProposalContentEdit` → `ProposalDetail` | edit · §6.1 | | A section's text, layout, order, visibility, image |
| `POST /proposals/:id/sections/:key/rewrite` | `SectionRewrite` → `SectionRewriteDraft` | edit · §6.1 | | Nothing kept until Use Rewrite |
| `POST /proposals/:id/send` | `ProposalSend` → `ProposalDetail` | edit · §6.1 | | The person confirms the addresses (§6.10) |
| `POST /proposals/:id/message` | `EmptyBody` → `ProposalMessageDraft` | edit · §6.1 | | Write With AI: a subject and message for Send (`proposal-message`, Default); nothing kept |
| `POST /proposals/:id/pdf` | `EmptyBody` → `ExportFile` | view · §6.1 | | Download PDF: the sent PDF, or the draft's made in the worker (foundation.md §6.12) |
| `POST /proposals/:id/accept`, `/decline`, `/withdraw` | `EmptyBody`, `ProposalDecline`, `EmptyBody` → `ProposalDetail` | edit · §6.1 | | |
| `POST /proposals/:id/revise` | `EmptyBody` → `ProposalDetail` | edit · §6.1 | | A new version from a sent one |
| `POST /proposals/:id/save-as-template` | `ProposalTemplateSave` → `ProposalTemplate` | edit · `partnerships.configure` | | |
| `GET /agreements/summary`, `GET /agreements`, `GET /agreements/renewals`, `GET /agreements/:id` | → `AgreementsSummary`; `AgreementListQuery` → `AgreementPage`; → `RenewalPage`; → `AgreementDetail` | view · §6.1 | yes | |
| `POST /agreements` | `AgreementGenerate` → `AgreementDetail` | create · §6.1 | | Filled from the record (§6.8) |
| `PATCH /agreements/:id` | `AgreementUpdate` → `AgreementDetail` | edit · §6.1 | | Draft only |
| `POST /agreements/:id/submit` | `EmptyBody` → `AgreementDetail` | edit · §6.1 | | Opens `partnership.agreement` |
| `POST /agreements/:id/send` | `AgreementSend` → `AgreementDetail` | edit · §6.1 | | Approved only; the signature request |
| `POST /agreements/:id/signed-copy` | `SignedCopyRecord` → `AgreementDetail` | edit · §6.1 | | Record Signed Copy |
| `POST /agreements/:id/renew`, `/close`, `/resend` | `AgreementRenew`, `AgreementClose`, `EmptyBody` → `AgreementDetail` | edit · §6.1 | | |
| `GET /analytics` | `AnalyticsQuery` → `PartnershipAnalytics` | view · §6.1; money with `partnerships.money` | no | §6.18 |
| `GET /mailbox/threads/:id/partner`, `POST`, `DELETE` | → `ThreadContext`; `ThreadPartnerBind` → `ThreadContext`; → `ThreadContext` | `mailbox` view on the route; `partnerships` view checked by the service (403 without it) | | The caller's own thread only (404 otherwise); on the mailbox's routes, schemas in `interactions.js` (§6.15) |
| Public `GET /public/proposals/:token`, `GET /public/proposals/:token/pdf` | → `PublicProposal`; → PDF | none, the token | no | Records a view (§6.10); the PDF is the one sent; public routes never import auth |
| Public `GET /public/sign/:token`, `POST .../code`, `POST .../code/verify`, `POST .../sign`, `GET .../signed` | M5's signing contract, extended (§6.9) | none, the token | | |
| Public `GET /public/verify/:ref`, `GET /public/verify/t/:token` | → `VerifyResult` | none | | By reference: no content; by QR token: the document (§6.9) |

Approvals go through the shared `/workflow` routes and My Approvals. Imports go through `/imports` with
the keys `partnership_tracker` and `partnership_returns`. Exports are `POST /partnerships/exports` sources
`partnerships.partners`, `partnerships.leads`, `partnerships.deals` (the tracker's columns, PR 4) and
`partnerships.analytics` (the period's workbook, a sheet a table, Returns per Month only with
`partnerships.money`; PR 8).

## 6 · Rules and calculations

### 6.1 Who sees what

- A lead, a partner and a deal belong to their **owner** (`owner_id`). Scope runs through `scopeClause` on
  the owner, as Home does: `all` sees every one, `team` the owner's reporting line and the reader's own,
  `own` the reader's. A record with no owner is seen only with `all`.
- A deal is also seen by its **members**, and its lead or partner with it.
- A deal is also seen through the **owner of its lead or partner**: whoever may see the record's owner sees
  and acts on every deal on the record, as an account owner does (TB, 06/11/2026). A member who sees a
  record only through their own deal sees that deal, not the record's others; the 360's deals and figures
  are the deals the reader sees.
- A record or a deal is given only to an owner in the reader's scope (`all`: anyone), so nothing a person
  makes or edits vanishes from them.
- Proposals and agreements follow their deal; documents follow their record and keep their sensitivity.
- **Money is gated:** anyone who may see a record sees its projected and signed values. Commission rates
  and amounts, the merchant's take, returns and payouts need `partnerships.money` (held by Operations &
  People, Management, Implementation, General Management and the CEO). The **server leaves them out**
  of every response without it; the screen never merely hides them.
- Repos honour scope in SQL. One rule serves the lists, the 360s, ⌘K, Analytics, exports, Categories'
  counts and its partners and leads, and Praxis AI. **The one exception is the duplicate check** (§6.2):
  it searches every lead and partner whatever the reader's scope and returns only the number and the
  name, so two people never capture the same organisation twice (TB, 06/11/2026).

### 6.2 The 360s and duplicates

- **A 360 renders for a record created a minute ago.** `partners.360` and `leads.360` are one call each;
  every figure defaults to 0, every collection to `[]`, every tab has its empty state. A test creates a
  bare lead and a bare partner and reads both (MILESTONES §12 acceptance).
- **Layout:** desktop, the list in a narrow column on the left and the record filling the rest
  (`ListDetail`, F31); a phone, the record as a full-screen sheet over the list.
- **Header:** logo or initials, name, category, region, owner, status pill; the primary contact.
- **KPI cards (Partner 360):** Signed Value; Returns This Year (MyCity's commission received this
  calendar year; without `partnerships.money`, **Downloads This Year** takes its place); Active Deals;
  Days Since Last Contact. **Lead 360:** Projected Value, Days at Stage, Health, Days Since Last Contact.
- **Partner 360 tabs:** **Overview** (each open and live deal with its stage switcher, health, blockers,
  next action and expected close; the next three events; the latest five interactions; open
  deliverables), **Deals**, **Documents**, **Returns** (with `partnerships.money`), **Work**, **Activity**
  (interactions, linked mail, stage and health history: the latest 25 lines of the deals the reader sees,
  each naming its deal), **Contacts**, **Details** (organisation,
  region, headquarters, website, category, custom fields behind Advanced). **Lead 360 tabs:** Overview,
  Deal, Documents, Work, Activity, Contacts, Details.
- The stage moves only on a 360 (no board). Pipeline and the lists filter by stage.
- **Duplicates** are advisory, over leads and partners: name (similar, via `shared/dedup`), email,
  phone, website host; at most 25 candidates, a match from 55. New Lead and New Partner show the likely
  match before saving; a lead whose organisation is already a partner is offered **New Deal** on that
  partner. Nothing blocks. The check reads every lead and partner, whatever the reader's scope, and
  answers only each candidate's number, name, score and reasons (§6.1).

### 6.3 Categories, lists and custom fields

- **A category is a partnership type** (Event, Hospitality, Vendor, Media, Corporate, Community,
  Strategic, Tourism, University, Government, Sponsorship, Influencer as MyCity's tracker has them, and
  any MyCity adds; A21). It carries a default commission, a default validity, its agreement templates,
  its delivery checklist and its custom fields; `counts_as_vendor` marks the ones whose leads Analytics
  counts as vendor leads. A category in use is retired, never deleted. Its partner and lead counts, and the
  partners and leads the picked category lists, are those the reader may see (§6.1).
- **Stages** are MyCity's list; each carries a **meaning**: `prospect`, `contacted`, `meeting`,
  `proposal`, `negotiation`, `signed`, `active`, `closed_lost`, `on_hold`. MyCity's thirteen from the
  tracker's dropdown: Prospect Identified (`prospect`), Initial Contact (`contacted`), Introductory
  Meeting Scheduled and Introductory Meeting Held (`meeting`), Proposal Sent and Follow-up Ongoing
  (`proposal`), Negotiation, Verbal Approval and Contract Review (`negotiation`), Partnership Signed
  (`signed`), Active Partnership (`active`), Closed Lost (`closed_lost`), On Hold (`on_hold`). The list
  keeps at least one stage meaning `prospect`, `signed` and `closed_lost`; the last stage of a meaning
  in use cannot change meaning or retire. The first active stage in order is where new deals start.
- **Potential impact** (the tracker's nine: App Downloads & Visibility, Revenue Generation, Brand
  Visibility, User Acquisition, Vendor Acquisition, Content Collaboration, Community Growth, Business
  Listings, Strategic Positioning), **lead sources** and **document kinds** are lists too. Impact is one
  or more values, a rating (High, Medium, Low) and a note.
- **Custom fields:** holders of `partnerships.configure` add a field on Categories, for one category or
  all, for leads, partners or deals, of a type (text, long text, number, money, date, pick, multi-pick,
  yes or no, link). Values are checked by type on the server; money through `shared/money`; picks from
  the field's options. A filterable field joins the lists' filters (GIN on `custom`). Every field exports
  and imports as a column. Custom fields and the less-used built-in fields (legal name, website,
  headquarters, impact note, expected attendance, source, comments) sit behind **Advanced** on every
  form and in Details. Retiring a field keeps its values (shown as retired) and stops offering it.
- **Start From Tracker** reads the uploaded workbook's dropdowns (its data validations: stages,
  partnership types, potential impact, status) and proposes the stages with a suggested meaning each,
  the categories and the impact list; the person corrects and applies. Nothing is seeded; the press is
  MyCity's choice (A26).

### 6.4 Leads and conversion

- A lead is an organisation before a deal is signed, created with its first deal. Its contacts,
  documents, interactions, linked mail and work hang on the lead until conversion.
- **Its status is read from its deal's stage**: New (`prospect`), Contacted (`contacted`, `meeting`),
  Qualified (`proposal`, `negotiation`), Lost (`closed_lost`), Converted (`signed`, `active`). On Hold
  shows a pill and keeps the status it had before. The service keeps `lead.status` in step in the same
  transaction as every stage move.
- **Close as Lost** moves the deal to the first `closed_lost` stage with a reason; the lead is Lost and
  leaves the default list (the Lost chip shows it). Moving the deal on from Closed Lost (a move back, so
  with a reason) reopens the lead: its status is the new stage's and its lost reason is cleared.
- **Conversion is a transition** (the donor's rule: reachable from one state only, evidence the database
  enforces, the downstream record in the same transaction). When the lead's deal enters a `signed`
  meaning (a completed signature, Record Signed Copy, or a stage move with a signed copy attached), one
  transaction: creates the partner (numbered; name, category, industry, region, website, owner and
  custom values copied, a lead having no legal name; `lead_id` kept); sets the deal's `partner_id` (its
  `lead_id` kept);
  moves contacts, documents (their `partner_document` rows; the vault untouched), interactions, linked mail, and Workspace links (through the
  workspace services); sets the lead Converted with `converted_partner_id`; raises the deliverables
  (§6.7); makes the calendar event (§6.16); emits `lead.converted` and `deal.signed`.
- **Convert to Partner** on the Lead 360 is the same transition for a deal signed outside the hub; it
  asks for the signed copy. A converted lead is read only and links to its partner.
- Conversion is idempotent on the deal: a second press, a second tab or a repeated signature event
  converts once.

### 6.5 Deals: stage, health, blockers and terms

- **The stage switcher:** the stages in order, the current one marked; one press on another stage moves
  there. Refused to the same stage. A reason (at least 10 characters) is required for `on_hold`,
  `closed_lost` and any move to an earlier position. A move into `signed` without a signed agreement
  asks for the signed copy or offers Generate Agreement. Each move writes a history line, emits
  `deal.stage_changed` and, for a lead, sets its status, in one transaction.
- **Health:** On Track, Follow-up Required, Stalled, on open and live deals. Stalled requires
  **Blockers** (at least 10 characters), shown on the 360's Overview and in Pipeline's Stalled list.
  Health changes write a health history line.
- **A deal carries:** title; its event (title, start and end, venue picked from the address search,
  expected attendance) when it is one; objective; impact; projected value; expected close; next action
  and its date; its team; up to five **options**; its commission rate; its validity; its custom fields.
- **Days at stage** count from the last stage line, in Lagos days.
- **On Hold** sits last in the list, so leaving it resumes the deal at any stage and needs no reason.
- **After signing** a deal moves only to another signed meaning (`signed`, `active`), On Hold or Closed
  Lost; anything earlier is refused ("Already signed"). Only the first move into a signed meaning asks
  for the signed copy: a deal already signed, or with a signed agreement, asks for none. Convert to
  Partner's own move needs no reason; its signed copy is the evidence.

### 6.6 Partners, value and money terms

- A partner may have **many deals**: each edition of an event, each offer. **New Deal** on the 360 opens
  one at the first stage on the same partner, and the partner stays active or dormant by its other
  deals.
- **New Partner** records an organisation whose relationship is already signed (MyCity has about 33): it
  needs its first deal at a `signed` or `active` stage (the first `signed` stage when the form names
  none) and either a signed copy or "signed before the hub", which shows on its Documents tab and on
  verification.
- **Status:** `active` while any deal is live; `dormant` when none is; `closed` by Close Partner with a
  reason (its open deals are lost with it, each with that reason). Home reads `active`.
- **Options** follow MyCity's Deal Merchant Agreement: up to five, each with a label, Original Price,
  Discount %, Deal Price (or a price note: App Download, Free Entry), MyCity's Commission per sale and the
  Merchant's Take per sale. The commission amount defaults to the deal price times the deal's rate, the
  merchant's take to the price less the commission; both can be changed. A rate other than the
  category's default sets `commission_deviates`, shown on the deal and on the approval card.
- **Validity:** 30 days, 60 days or a chosen date, counted from signing; the deal is **Completed** by the
  daily job after the later of its validity and its event's end.
- **Signed value** of a deal is its agreement's value when it has one, else its projected value,
  counted in the month it was signed. **Projected value** is the owner's estimate (MyCity asked for it on
  5 November).

### 6.7 Delivery checklists

- A category's checklist lists what MyCity delivers on a signed deal. For events, from the Deal
  Merchant Agreement: event registration and check-in on MyCityApp; amplification across MyCity's
  channels; branded presence and souvenirs; on-ground documentation; the Ember to Remember calendar
  listing.
- On signing, each active item becomes a Workspace task through the tasks service: titled "<item> ·
  <deal>", assigned to the deal's owner (who reassigns as A24 allows), due `due_days` after signing or
  before the event's start, connected to the partner and the deal, inside the deal's project when it has
  one (the most recent active project connected to the deal). Each is a `deal_deliverable`; its status
  is its task's.
- Changing a checklist later never changes deals already signed. A deliverable can be added by hand on
  the Deals tab.

### 6.8 Agreements and templates

- **Templates are built in the hub**, on the one document engine (`shared/documents`, `template_version`,
  declared variables). A template has rich text, headings, numbered clauses, tables and named fields.
  A field is a **record field** (`today`, `org.name`, `partner.name`, `partner.legal_name`,
  `partner.headquarters`, `partner.region`, `contact.full_name`, `contact.title`, `contact.phones`,
  `contact.email`, `deal.title`, `deal.event_title`, `deal.event_starts_on`, `deal.event_ends_on`,
  `deal.objective`, `deal.expected_attendance`, `deal.comments`, `deal.valid_until`, `deal.validity_label`,
  `deal.options` as the options table, `category.checklist` as the numbered clauses of the delivery checklist,
  and `signer.name`, `signer.title`, `signer.signed_on`, `signer.signature`, which the signing service fills
  when the agreement is signed, §6.9), a **custom field** of the category or of every category
  (`custom.<key>`), or an **ask** (`ask.<key>`: a value the person gives when generating, with its label,
  type and default). The record fields are `AGREEMENT_RECORD_FIELDS` in the contract. The wording is kept
  as Markdown (headings, numbered clauses, pipe tables) with each field in `{{ }}` written with its house
  format (`{{ longdate deal.valid_until }}`); the editor draws each as a chip and a person never types
  braces. A template naming a field that is none of the three, or an ask it does not declare, is refused on
  save, naming it. If the renderer lacks a table loop for `deal.options`, PR 6 adds it
  to `shared/documents/render.js` for every template; there is no second engine.
- **Tidy With AI:** the person pastes the text of a Word agreement MyCity already uses. The AI returns
  it tidied (headings, numbered clauses, the financials grid as a table) with a proposed field for every
  value that belongs to a partner or a deal (the merchant's business name becomes `partner.name`, the grid
  becomes `deal.options`, "26th November, 2026" becomes `deal.valid_until`). Each field shows as a chip
  to Accept, Change or Make an Ask. Nothing is kept until Use Draft. MyCity's Deal Merchant Agreement is
  rebuilt this way as the Events category's default template (a staging seed holds the result); its wording, redacted, is
  `docs/MyCity-ERP-Documents/partnership-samples/deal-merchant-agreement.md`, with each placeholder's
  field.
- **Generate Agreement** on a deal picks the category's default template of the chosen kind, fills it
  from the record and the asks, numbers it and saves a Draft with its `template_version` and `fields`.
  The person edits the filled wording in Draft. An empty required field blocks Submit and names it.
- **The lifecycle** (MILESTONES §12):

| Status | Entered by | Rule |
|---|---|---|
| `draft` | Generate Agreement; a rejection | Editable |
| `review` | Submit for Approval | The flow's first stage is waiting |
| `approval` | The first stage approved | A later stage is waiting |
| `sent` | Send for Signature (approved only); a declined or expired signature | The PDF is rendered and frozen (`content_hash`); the signature request is made |
| `viewed` | The first signer opens the signing page | From the signature service; never by hand |
| `signed` | The last signature, or Record Signed Copy | `signed_at`; sealed and locked (§6.9); the deal is signed (§6.4) |
| `active` | The daily job on `starts_on` | |
| `expiring` | The daily job, `renewal_notice_days` before `ends_on` | The renewal reminder starts |
| `renewed` | The next agreement's signing | Linked by `renews_agreement_id` |
| `closed` | Close Agreement | A reason; from any status |

- **Renew** drafts the next agreement from the current one (same template, deal and fields, dates
  moved), and optionally a new deal for the next term.

### 6.9 Approval, signing and verification

- **Every agreement is approved before it is sent**, through the approval engine. The flow
  `partnership.agreement` is added to `DEFAULTS` in `shared/workflow/definitions.js`, validated by
  `validateDefinition()`, with two stages: the **Head of Department** of the deal owner's department
  (`employee_in_context`: the context's `department_head_employee_id`), then the **CEO**; 72 hours each.
  It is a flow like any other on **Settings · Approvals**: Edit Stages saves a new version; Applies When
  can, for example, limit the first stage to `commission_deviates` or a `value` above a figure. The
  context: `value`, `commission_pct`, `commission_deviates`, `kind`, `partner_category_id`,
  `owner_department_id`, `department_head_employee_id`. A stage that would ask the same person twice is
  skipped. A waiting approval reaches its approver on Home's Need You (My Approvals), whose row opens the
  agreement. **Approve** and **Reject** are on the agreement's Approval card, shown to whoever the waiting
  stage names and to the CEO, who may decide any stage, and never to the person who submitted it
  (`approval.can_decide`, the engine's `approvers.canAct`). Reject asks its Reason (`workflow.ReasonBody`).
  Both call the approval's own routes (`POST /workflow/instances/:id/approve` and `/reject`); the card has
  no Send Back.
- **Signing** is the signatures service (`src/modules/signatures/`, shared with M5's offers): one
  service, one signing page (`go.mycityapp.io/sign/<token>`, opaque, one signer, not indexable), one
  verification page. If M7 is built before M5's service exists, M7's PR 6 builds the shared service to
  this section and to MILESTONES §10, agreed with LA; never a second copy.
  1. **Send for Signature** asks the person to confirm each signer: the partner's signatory contact by
     default (name, title, email), and a MyCity countersignatory when the template asks for one.
  2. The signer opens the link and reads the agreement exactly as it will be signed (the same HTML as
     the PDF).
  3. **Identity:** Send Code emails a 6-digit code to the address the link was sent to; it lasts 10
     minutes, allows 5 tries, and can be resent after 60 seconds (`OtpField`). Email is the only channel
     (no SMS provider in the hub).
  4. The signer types their **full name** and **title**, then **draws** their signature
     (`SignatureField`, finger or mouse) or **types** it (rendered in a signature face), and ticks **I
     Agree to Sign Electronically**.
  5. The drawn signature leaves as a PNG data URL (base64), is stored through the vault, and is stamped
     into the agreement's execution block, never a "signed" placeholder.
  6. **Evidence** on the `signature` row: name, title, email, the code's verification time, the signing
     time (Lagos; ISO on the wire, day-first on the page), IP address, device and browser, and the
     document's `content_hash` (SHA-256 over the canonical payload, recomputable).
  7. **Seal:** when the last signer signs, the PDF is rendered once more with every signature, a
     signature certificate page (`templates/documents/signature-certificate.html`) listing each signer's
     evidence, and a **QR code** on every page linking to verification; it is vaulted, its
     `artifact_hash` (SHA-256 over the stored bytes, A12: hash what the store returns, not what was
     received) recorded, and locked. Every signer and the owner receive the sealed copy by email.
- **Verification:** the QR opens `go.mycityapp.io/verify/t/<token>` and shows the document itself, its
  status (signed, active, expiring, expired, closed), the signers with dates and times, and the **two
  verdicts**: the content matches what was signed, and the stored file is the one sealed. Typed by
  reference (`go.mycityapp.io/verify/AGR-2026-0001`) it shows status, signers and verdicts, **not the
  content**: a reference is not a secret (A9) and the commission terms are.
- **Record Signed Copy** takes a paper signature: the signed PDF or scan through the upload engine, who
  signed and when; it is vaulted and hashed, and verification says "signed outside the hub".

### 6.10 The Proposal Studio

The studio turns a meeting into a proposal MyCity is proud to send. Its steps, each a screen of the
studio (`StepBar`: Brief, Questions, Draft, Edit, Send):

1. **Brief.** New Proposal on a deal (from its 360, or from Proposals picking the lead or partner and
   deal). Notes (pasted, up to 20,000 characters) and/or a transcript (`.md` or `.txt` through the upload
   engine, up to 1 MB; Google Meet's Gemini notes export as Markdown), images (cover, gallery, the
   partner's logo; each with alt text), and optionally a saved template. With no cover, the kit uses the
   hub's own city photography (the sign-in screen's Lagos, London, Accra and Nairobi, WebP, in
   `packages/ui/src/illustrations/photos/`, copied into the kit's assets at build) and marks it a
   stand-in; the studio lists stand-ins before Send.
2. **Questions.** Claude reads the brief, the record (lead or partner, the deal, its options, dates,
   venue, category, region, impact, the latest interactions), up to three of the category's past
   accepted proposals, the saved template and the proof points, and returns **question cards** for what
   a strong proposal still needs. Each card: the question; **Why** in one line (a help term); an answer
   control matched to its kind (short text, long text, number, money, date, pick, multi-pick); a
   **suggested answer** with where it came from ("From the transcript, 00:21:51", "From the deal")
   when Claude has one; **Required** or not. Cards are grouped (The Partner, The Offer, Audience and
   Reach, Money, Timing, Proof) with progress ("6 of 9"). The person answers, presses **Use Suggestion**,
   **Skip** or **Reshuffle** (a different question in its place, from the same group; the replaced card
   kept as `replaced`; at most three reshuffles a card). Between 5 and 12 cards; **Write Draft** waits
   while a required card is open. Questions take seconds; a failure offers Try Again.
3. **Draft.** Claude writes the proposal as **structured content** (`ProposalContent`): an ordered list
   of sections, each naming a layout of the design kit (§6.11) and filling that layout's fields. The
   server validates it against the contract, checks its figures (below), renders it, and stores version
   1 as Draft. Writing runs as a job (`proposal-draft`): the studio shows its progress step by step
   (Reading, Writing, Checking Figures, Laying Out), since Claude writes the content in one answer, and
   the owner is notified when it is ready (it may take minutes). A failure keeps the brief and answers
   and offers Try Again.
4. **Edit.** On screen, as the partner will see it, in a sandboxed preview. Per section: edit the text in
   place (`RichTextField` limited to the layout's marks), **Change Layout** (among layouts that fit the
   section's content), Move Up, Move Down, Hide, **Replace Image**, **Rewrite Section** (an instruction
   for Claude on that section only; nothing kept until Use Rewrite). Brand, type and spacing come from
   the kit and cannot be broken by an edit. Every save is kept; a sent proposal is revised as a new
   version (Revise).
5. **Send.** **Send Proposal** opens a sheet that must be confirmed: **To** (the primary contact's
   email by default; other contacts to pick, or an address typed and checked; 1 to 5), **Cc** (up to 5),
   **Subject**, **Message** (Write With AI drafts both, `proposal-message`). It lists stand-in images and unconfirmed figures
   first. **Confirm and Send** mails the PDF attached and the private link from the system sender with
   the owner as reply-to. Nothing is sent without that press. **Download PDF** and **Copy Link** are
   always there.
6. **After.** Each opening of the link is a `proposal_view`; the first sets Viewed and tells the owner.
   **Mark Accepted** (suggests the deal's next stage, never moves it) and **Mark Declined** (a reason)
   record the outcome; **Withdraw** stops the link; the daily job expires a proposal past `valid_until`.
   **Save as Template** keeps the layouts, their order and tone notes for the category, never the
   partner's facts.

- **Figures are never invented.** Every number, date, price, percentage and named organisation in the
  content carries its **source** (the brief, an answer, a record field, a proof point). The server
  rejects a draft with an unsourced figure and asks Claude once more; then it marks the figure for the
  person to confirm, and Send lists it.
- **Prompts** live in `src/services/ai/prompts/` (`proposal-questions.md`, `proposal-draft.md`,
  `proposal-rewrite.md`, `proposal-message.md`) and say: write for the partner, name their goal in the
  first paragraph, benefits before features, specific and warm, no clichés, no exclamation marks, no em
  dashes, British English, every figure sourced, only the kit's layouts and fields.
- **The AI:** `proposal-questions`, `proposal-draft` and `proposal-rewrite` run on the **Top Tier** job
  with an action chain of **Anthropic Sonnet first, then Gemini Pro** (written reason: long drafting
  from many sources), chosen by JBS Praxis on 05/11/2026, registered in `src/services/ai/actions.js` with
  `chosen_by` and `personal_data: true` (contacts' names), so DeepSeek is never in the chain. It needs
  MyCity's Anthropic account funded and its key on Settings · Integrations; without it the chain falls to
  Gemini Pro. With AI off or the month's cap reached, the studio says **AI Is Off** or **AI Limit
  Reached** and a person may still build the proposal by hand from the kit's layouts.
- The public link's token is opaque, one proposal, not indexable (`X-Robots-Tag: noindex`), and stops
  working on Declined, Expired or Withdrawn ("This proposal is no longer available").
- **Statuses:** `brief`, `questions`, `writing`, `draft`, `sent`, `viewed`, `accepted`, `declined`,
  `expired`, `withdrawn`. Proposals need no approval to be sent (§13.2).

### 6.11 The proposal design kit

One masterpiece template, built to be accepted as it comes and edited only when a person wants to. It
lives in `templates/proposals/` and renders through the one document engine: the same HTML is the
studio's preview, the public page and, through Chromium, the PDF.

- **Brand:** MyCity's tokens (MILESTONES §5.1) and Geist with tabular figures; colours only from
  `packages/ui/src/styles/tokens.css`, exported to the kit at build (F4, gate 13); AA contrast on every
  pairing, including text on images, which always sits on a scrim.
- **Page:** 16:9 landscape, 338.7 × 190.5 mm (1280 × 720 at 96 dpi; TB, 07/11/2026), a 12-column grid,
  fixed margins, one section a page; a section longer than its page continues on the next with its
  heading repeated, and a table's header repeats; the reference and the page's place in the proposal in
  the footer from page 2. The web shows the same pages scaled to the window and reflows them to one
  column on a phone.
- **Layouts**, each with its own content schema in the contract, so Claude fills fields, never markup:

| Layout | Holds |
|---|---|
| `cover` | Full-bleed image under a scrim; MyCity's mark beside the partner's logo; title; Prepared For; date; reference |
| `letter` | A personal opening from the deal's owner: two or three short paragraphs; their name, title and photo |
| `opportunity` | The moment and the partner's goal; one pull quote |
| `why_mycity` | Three to six proof points as large figures with labels |
| `audience` | Reach and audience as stat cards and one chart (bar or donut), drawn by the renderer as SVG from data |
| `deliverables` | What MyCity does, numbered, an icon each (Lucide) |
| `packages` | The deal's options as cards (three or fewer) or a table: label, price, what is included, terms |
| `timeline` | Build-up, the event, follow-through, from the deal's dates |
| `proof` | Partner logos and past results from proof points |
| `terms` | Validity, payment and commission terms, plainly |
| `next_steps` | What happens after yes; the owner's contact card; a QR to the web version |
| `closing` | A back cover: a photograph, or one of the kit's drawings |
| `insight` | One chart across the page, the takeaway in a line, an optional note (TB, 07/11/2026) |

- **Charts anywhere** (TB, 07/11/2026): `opportunity`, `why_mycity`, `audience`, `packages` and `proof`
  may carry one chart, and `insight` is a page for one. Seven kinds: columns, bars, stacked columns, a
  line, an area, a donut and progress rings, drawn by the renderer as SVG in the kit's chart colours from
  figures (`ProposalChart`); every plotted value is a figure with its source like any other.
- **Drawings** (TB, 07/11/2026): the kit's own set of 24 line drawings in MyCity's colours (`skyline`,
  `stage`, `ticket`, `phone_app`, `map_pins`, `crowd`, `handshake`, `growth`, `calendar`, `megaphone`,
  `camera`, `check_in`, `souvenirs`, `storefront`, `hotel`, `dining`, `mobility`, `flight`, `campus`,
  `civic`, `media`, `trophy`, `globe`, `target`), named by Claude as it names icons and changed by a
  person in Edit, on `opportunity`, `deliverables`, `timeline`, `terms`, `next_steps` and `closing`.
  Nothing is generated: no image model is in the chain.

- **Rhythm:** one display size for the cover, three heading sizes, one body size, lines of 60 to 75
  characters, figures right-aligned in tables.
- **Proof points** are MyCity's own facts, entered on Categories: figures (the size of its network),
  partner logos (MTN Nigeria), endorsements (the Ember to Remember calendar, recognised by the Federal
  Government), past results. Claude cites only these and the record. Staging seeds a demonstration set;
  production starts empty.
- **Saved templates** choose and order layouts and carry tone notes; they never change the kit.
- The kit has a **gallery page** (`npm run gallery`, `#/ProposalKit`) rendering every layout with sample
  content, and a visual test in the screens group.

### 6.12 Interactions, quiet partners and follow-up

- An interaction is a call, meeting, email, visit or note: a time not in the future (a minute's grace
  for a phone's clock), a summary of at least 10 characters, an owner (who logs it), optionally the
  contact and the deal, each the record's own. Logging one is contact.
- **Quiet**, as Home defines it: a partner with a live deal and no interaction since the start of the day
  `N` days ago (Lagos); one never contacted counts from when it was made. `N` is the enabled Partner
  Inactivity rule's threshold on Home · Alerts (30 at go-live); no enabled rule, no follow-up. Partners'
  Quiet filter and figures use the same `N`, 30 while no rule is enabled (`PartnersSummary.quiet_days`, which
  the Quiet card's help names); Home's No Contact 30 Days card counts 30, as its title says.
- **The follow-up:** the `partner-inactivity` scheduler runs each morning after `home-alert-sweeps`. For
  each newly quiet partner it sets its live deals' health to Follow-up Required (source `system`) and
  creates one Workspace task for the owner, "Follow up with <partner>", due three working days later
  (`shared/time/working-week`), dedup key `partner-inactivity:<partner_id>:<date of last contact>`.
  One task per quiet spell. Leads' open deals follow the same rule.

### 6.13 The tracker importer and Start From Tracker

MyCity's workbook as read on 05/11/2026: sheet **Master Tracker**, headers on row 2, 102 numbered rows,
79 of them naming a partner, 18 columns, dropdowns on four columns; a hidden sheet **Monthly Partnership
Performance** (headers on row 3, four staff names, no figures).

| Tracker column | Goes to | What the rows hold, and the rule |
|---|---|---|
| S/N | nothing | A row with no partner name is skipped |
| Partner Name | lead or partner `name` | The duplicate check runs on it |
| Industry | `industry` | 48 distinct spellings; kept as typed and offered as suggestions |
| Contact Person, Position, Contact Details | a primary contact | Contact details are a phone (about 60), an email (about 14) or two phones in a cell; split by shape into `email` and `phones` |
| Region | region scope and cities | Cities in mixed case (Ibadan, IBADAN, ibadan), PH for Port Harcourt; National, Africa, Worldwide as scopes; each city matched to the city search; the unmatched listed to pick (F27) |
| Partnership Objective | `deal.objective` | Free text |
| Partnership Type | the category | The dropdown's 12, plus free text carrying terms ("Ticketing (exclusive), 8% commission" becomes a category and a commission of 8% on the deal) |
| Partnership Stage | `deal.stage` | The dropdown's 13 plus off-list values (Secured, Prospecting, Listing, "Proposal drafted, outreach to begin"); mapped in Map Values |
| Potential Impact | impact, rating, note | One value mostly; "High: ..." and "Medium: ..." become the rating and the note |
| Lead Owner | `owner_id` | About twelve spellings for about eight people (JOHN, Mr. John, Mr.John); each spelling matched to an employee once in Map Values; an unmatched one leaves No Owner |
| Date Identified | `identified_on` | Real dates and text in six shapes ("25th June 26", "3rd of July", "24th of July, 2026", "Sept 2026"); parsed day-first; a month alone is the 1st, marked; a missing year is the sheet's |
| Current Stage | not kept | Sealed, Ongoing, Invoicing repeat the stage; added to comments when it says more |
| Next Action, Expected Close Date | `next_action`, `expected_close_on` | Rarely filled; text that is not a date ("This week") joins the next action |
| Status | `health` | On Track and Follow-up Required map across; Stalled takes the comment as blockers (or "From the tracker"); Active Partnership adds nothing; Closed loses an open deal |
| Comments | `comments` | |
| any other column | a custom field | Ticked at commit |

- A row whose stage maps to `signed` or `active` becomes a **partner** with a live deal (signed before
  the hub); the rest become **leads** with an open deal; Closed Lost rows become lost leads.
- **Map Values** is a step the shared import engine gains (`shared/import`, every importer): for each
  list or reference field, every distinct value in the file is shown once with its row count and mapped to
  a list value, created (ticked) or left empty; the mapping is saved with the profile.
  `docs/guides/foundation.md`'s imports section changes with it.
- `partners.import.js` registers `partnership_tracker` (`defineImporter`, `permission ["partnerships",
  "create"]`), with `extract(sheets)` for the workbook as MyCity keeps it, `matchKeys` name then website
  host then primary email, `createMissing: "confirm"`, `isReferenced` (an interaction, proposal or
  agreement exists), reversible until referenced. Export back out in the tracker's columns.
- **Tests use a synthetic workbook** (`tests/fixtures/partnership-tracker.synthetic.xlsx`) with the real
  headers, dropdowns and value shapes and invented organisations and contacts; the real tracker, which
  holds partners' phones and emails, is never committed.

### 6.14 Returns and downloads

- Per deal and month: units sold (tickets or coupons), gross sales, MyCity's commission, paid to the
  partner, downloads, a note. Entered on the 360's Returns tab (**Enter Returns**, a month at a time) or
  imported (**Partnership Returns** on Settings · Imports, matched by deal number, or partner and deal
  title), both with `partnerships.money`.
- A month imported again replaces that month's figures for the deal, audited. Downloads show to anyone
  who may see the record; money only with `partnerships.money`.
- The Returns tab: the months as a table, a chart of commission by month, the year's totals.

### 6.15 Mail threads

- **Link to Partner** links one thread to one lead or partner (optionally a deal). Each message, sent or
  received, becomes an `email` interaction (dedup on `mail_message_id`), and so does each new message as
  the mailbox syncs. Each counts as contact. On conversion the link moves.
- A thread is its mailbox owner's. The record's readers see subject, from and to, date and the first 300
  characters of text; never the body or attachments; the full thread opens only for its owner. Unlink
  stops new interactions and keeps those logged.
- `mailbox/binding/` (`intake.service`, `mail-context.service`, `context-tabs`, `convert.service`) is
  filled with `docs/guides/mailbox.md` and `docs/manual/mailbox.md` changed in the same PR.
- **As built (PR 8):** Link to Partner is the conversation's menu in Mailbox, for its owner who sees
  Partnerships; Partner offers the partners and leads they may see (leads marked) and Deal that record's
  open and live deals (Workspace's own pickers, §6.16). Linked, a line under the conversation's header
  names the record (and deal), opening its 360, with Unlink; the menu then offers Change Partner. Linking
  logs what the thread holds; each message stored after it (synced or sent) is logged in the transaction
  that stores it (`intake.afterStoredIn`); Spam is never logged; a message is logged once
  (`partner_interaction_mail_message_uq`). An email interaction is owned by the mailbox's owner, its
  subject the message's, its summary the first 300 characters of its text cut on a word
  (`context-tabs.js`), with `mail_from` and `mail_to`. The 360's Activity opens an interaction in a
  sheet: When, Kind, By, From, To, Contact and its text, and **Open in Mailbox** for the thread's owner
  alone (`Interaction.mail.mail_thread_id` is null for anyone else). Unlink keeps what was logged;
  emptying Trash keeps it too (migration `7120`). Conversion moves the link with the lead
  (`convert.service.moveToPartnerIn`, from `interactions.service.moveToPartner`).

### 6.16 Projects, tasks and events

- **Connect to Partner:** New Project, New Task and New Event in My Workspace gain a Connect to Partner
  button; pressed, it reveals **Partner** (a `SelectField` of partners and leads the person may see,
  leads marked, 25 at a time, F32) and **Deal** (that record's open and live deals). Unpressed, the forms
  are as today. Edit forms show the connection with Disconnect. From a 360, the same forms open already
  connected.
- A project's tasks take its partner and deal unless set otherwise.
- **Visibility is Workspace's (A24):** the 360's Work tab lists the projects, tasks and events its reader
  may already see and counts the others ("3 more tasks you cannot see"). Connecting never widens access.
- **Deal dates on the calendar:** when a deal is signed, its event days become a calendar event (type
  `event`, the venue, connected to the deal, visibility `attendees`) whose attendees are the deal's team;
  a date change moves it; a lost or closed deal cancels it. Meetings with the partner are ordinary
  calendar events connected to it and listed on the 360.
- My Workspace's lists gain a Partner filter. Praxis AI's project, task and event cards gain the optional
  partner and deal (§9). `docs/guides/workspace.md` and `docs/manual/my-workspace.md` change in the same
  PR and the chapter's pictures are retaken.

### 6.17 Home

- `src/modules/dashboard/sources/partners.source.js` became M7's in PR 3: its `TABLES` true to the
  migrated schema, its `OWES` clear, every query the owning module's own read (`partner_pipeline.repo`,
  `partners.repo`, `proposals.repo`), Home's seed tests updated.
- **Open Opportunities** reads open deals; **Active Partnerships** reads `partner.status = 'active'`;
  **Signed Value** reads deals' signed values in the year signed (§6.6), NGN only, its records one row a
  deal (deal, partner, signed, value, owner) opening its lead's or partner's 360; **No Contact 30 Days**
  is §6.12's quiet; **Proposals Out** reads proposals `sent` or `viewed`. The Partnership Pipeline chart
  reads open deals by stage in the list's order.
- Staging's M7 seed calls `removeHomeStagingRows` for Home's five tables before writing, in the three
  steps `seeds/staging/lib/home-staging-rows.js` sets out.

### 6.18 Analytics

- **Period:** This Month, This Quarter, This Year, Custom (from and to); Lagos days.
- **Per lead owner, the performance sheet's eight measures:**

| Measure | Counts in the period |
|---|---|
| New Prospects Added | Leads identified (else created) |
| Meetings Held | Interactions of type meeting, and connected calendar meetings that have taken place, by their owner |
| Proposals Sent | Proposals sent, by the deal's owner |
| Partnerships Signed | Deals entering a `signed` meaning (imported history excluded) |
| Active Partnerships Managed | Partners with a live deal owned at the period's end |
| Downloads Generated | `deal_return.downloads` of the owner's deals |
| Vendor Leads Generated | Leads identified in categories marked `counts_as_vendor` |
| Performance Rating | The person's monthly rating from Performance, through the performance service; shown only where Performance lets the reader see it; blank otherwise |

- Also: signed deals and returns per month (returns with `partnerships.money`), stage-to-stage
  conversion, by category and by region; Export.
- **As built (PR 8):** This Month, This Quarter and This Year are whole Lagos periods; Custom is at most
  five years (60 months). Every measure is within the reader's scope by §6.1's one rule (a lead by
  `recordSeen`, a deal by `dealSeen`, an interaction or calendar meeting by its record). **Meetings
  Held** are interactions of type meeting and connected calendar meetings that started by now and were
  not called off, each by its own owner. **Partnerships Signed** leaves out a deal the tracker import
  signed (its import line into a signed meaning). **Active Partnerships Managed** counts partners whose
  owner is the person with a deal signed by the period's end and neither completed, lost nor closed
  before it. **Downloads** sum the returns of months that start in the period. **Performance Rating**
  is the person's latest closed monthly review in the period, read through Performance's own service
  (`reviews.service.ratingsFor`, its `readable` rule): a reader who may not list that person's reviews
  sees none. By Category and By Region count **open deals today** and deals signed in the period (a
  record in two cities counts in each); Stage Conversion takes the deals made or moved in the period,
  the furthest of MyCity's forward stages each reached (On Hold and Closed Lost are not forward), and
  gives each step the share of those at one stage that reached the next. Owners with nothing in the
  period are not listed; the table holds at most 200 owners, the groupings 100.

### 6.19 Money, dates and places

Money through `shared/money`, strings on the wire, NGN; Home sums NGN only. Dates ISO on the wire,
day-first for people, Lagos days; never a native date input. Headquarters (area), region cities and a
deal's venue are picked, never typed (F27, gate 22): `PlaceInput` in the contract, `places.save()` in the
owning service, owners `partner.headquarters`, `partner.cities`, `lead.cities`, `deal.venue` (gate 22
holds a `PlaceInput` key to its owner's name, and the contract's region key is `cities`);
`docs/guides/addresses.md` lists them.

## 7 · Events, jobs and notifications

| Event / job | When | Does |
|---|---|---|
| `lead.created`, `lead.updated`, `lead.lost` | Lead writes | Audit; lists refresh |
| `lead.converted` | §6.4 | The owner and Operations & People told, opening the partner |
| `partner.created`, `partner.updated`, `partner.closed`, `partner.status_changed` | Partner writes, the daily job | Audit; Home refresh |
| `deal.created`, `deal.updated` | Deal writes | Audit |
| `deal.stage_changed`, `deal.health_changed` | Switcher, conversion, import, inactivity job | History; the owner told when someone else moved it; Stalled tells the owner's Head of Department |
| `deal.signed` | A deal enters `signed` | Deliverables (§6.7); calendar event (§6.16); conversion when a lead's |
| `deal.completed`, `deal.lost` | Daily job; Closed Lost | Partner status recomputed; calendar event cancelled |
| `interaction.logged` | Log Interaction, a linked message | The quiet spell ends |
| `category.*`, `partnership_field.*`, `list_value.*`, `proof_point.*` | Categories writes | Audit |
| `proposal.started`, `proposal.questions_ready`, `proposal.drafted`, `proposal.revised` | The studio | The owner told when questions or a draft are ready |
| `proposal.sent` | Confirm and Send | `templates/email/proposal-sent.html` with the PDF and the link |
| `proposal.viewed` | First opening | The owner told |
| `proposal.accepted`, `proposal.declined`, `proposal.expired`, `proposal.withdrawn` | Marks, the daily job | The owner told |
| `agreement.generated`, `agreement.submitted` | Generate, Submit | Opens `partnership.agreement`; approvers told through My Approvals |
| `agreement.approved`, `agreement.rejected` | The flow | The owner told |
| `agreement.sent`, `agreement.viewed`, `agreement.signed` | The signature service | Status; the sealed copy to every signer and the owner; `deal.signed` |
| `agreement.activated`, `agreement.expiring`, `agreement.renewed`, `agreement.closed` | Daily job, Renew, Close | The reminder `agreement_renewal` (`defineReminder`) at the notice date and nearer |
| `deal_return.saved` | Enter Returns, the import | Audit |
| `mailbox.thread_bound`, `mailbox.thread_unbound` | Link to Partner, Unlink | Audit (mailbox's own events) |
| job `proposal-questions`, `proposal-draft` | The studio | The AI action, validation, render; Try Again on failure |
| job `partner-inactivity` (scheduler `partner-inactivity`) | Each morning after `home-alert-sweeps` | §6.12 |
| job `agreement-renewal` (scheduler `agreement-renewals`) | Daily, Lagos morning | Active, Expiring, deals Completed, proposals Expired, partner status |
| M0 jobs `import-validate`, `import-commit`, `pdf-render`, `email-send` | The engines | Unchanged |

Notification types sit in a **Partnerships** category in Settings · Notifications. Each module with inner
views declares them in its `<module>.views.js` (notifications.md §6), so the tabs carry their unread
counts and rows their marks. **As built (PR 8):** Deal Moved (a deal's owner, when someone else moved it
by hand: never an import, the system or a signing), Deal Stalled (the Head of Department of the deal
owner's department, high, with the blockers), Lead Signed (the lead's owner and Operations & People),
Questions Ready, Draft Ready (not after Build by Hand), Proposal Viewed (the first opening only),
Proposal Accepted, Declined, Withdrawn (not when a revision withdrew it) and Expired (each the owner of
the proposal's deal), beside PR 6's agreement notices; the person who acted is never told.
`leads.views.js` places a lead under its status's chip on Leads (a contacted lead under Open) and
`agreements.views.js` an agreement under its status's on Contracts & MOUs; Pipeline and Proposals have no
chips their notices could follow. Every scheduler is named in `SCHEDULERS`. The M7 `partner-inactivity` stub,
superseded for alerting by Home's sweep (README §5.15), is filled as the follow-up job.

## 8 · Permissions and visibility by role

Seeded in `0290`; this module adds no role.

| Role | Sees | Can do |
|---|---|---|
| Employee (`partnerships` own: view, create, edit) | Leads, partners and deals they own or are a member of | Capture leads, move stages, log interactions, start proposals, generate agreements, connect their work |
| Line Manager (`manager`, `partnerships` team: view, create, edit) | Their team's | The same for their team |
| Head of Department (`partnerships` team: view, create, edit, approve, export) | Their team's; Home's Partnerships Overview | The same; first approver of agreements; export |
| Operations & People (`partnerships` all, every action) | Everything | Everything; `partnerships.configure` and `partnerships.money` |
| Management (`partnerships` all, no delete) | Everything | Everything but delete; `partnerships.money` |
| Implementation (`partnerships` all, every action) | Everything | Everything; both capabilities |
| General Management (department) | As their role gives | `partnerships.money` without a role, as `goals.company` is given today |
| CEO | Everything | Everything; final approver; every capability |

Capabilities, declared once in `CAPABILITY_CATALOG` (README §5.2, BACKEND_GUIDE §5), seeded with their
holders, checked on the route after the permission, mirrored in the shell and ⌘K:
`partnerships.configure` (Implementation, Operations & People) and `partnerships.money` (Operations &
People, Management, Implementation, General Management). Restricted: money fields (§6.1); a linked mail's
body (§6.15); signature evidence (IP, device) shown to scope `all` only. Delete is not offered: leads are
lost, partners closed, proposals declined or withdrawn, agreements closed, so history stays.

## 9 · AI and search

- **Feature AI** (CLAUDE.md, ai-control.md §6.2), each in `src/services/ai/actions.js` with its job,
  chain, `chosen_by` and `personal_data: true`:

| Action | Job and chain | Chosen |
|---|---|---|
| `proposal-questions`, `proposal-draft`, `proposal-rewrite` | Top Tier: Anthropic Sonnet, then Gemini Pro | JBS Praxis, 05/11/2026 |
| `proposal-message` | Default (`personal_data: true`, so DeepSeek is never in its chain): ai-control §6.2 keeps Fast from drafts a person reads | TB, 07/11/2026 |
| `template-tidy` | Default (`personal_data: true`, so DeepSeek is never in its chain) | JP, 06/11/2026 |

- **AI reads** (`partners.ai.js`, `leads.ai.js`, `partner_pipeline.ai.js`, `proposals.ai.js`,
  `agreements.ai.js`, `partnership_analytics`'s summary): `leads.list`, `leads.get`, `partners.list`,
  `partners.get`, `deals.list`, `deals.get`, `categories.list`, `interactions.list`, `proposals.list`,
  `agreements.list`, `agreements.renewals`, and summary reads (20 groups, never a row) for the pipeline by stage, category and region, signed value
  by partner, and returns by partner and month (with `partnerships.money`). "What is our partnership
  value" and "who is our highest contributing partner" answer from data the reader may see. Scope and the
  money rule apply to every read. Gate 23 keeps the engine told of every schema change.
- **Cards** (praxis-ai.md decision 33, gate 23): `leads.create`, `leads.update`, `leads.lose`,
  `partners.create`, `partners.update`, `deals.create`, `deals.update`, `deals.move_stage`,
  `deals.set_health`, `interactions.log`, `contacts.create`, `contacts.update`, `deal_returns.save` (with
  `partnerships.money`), `proposals.start` (opens the studio with the brief), and the Workspace cards for
  projects, tasks and events with their optional partner and deal. Each `run` is the module's own service
  function. **Not in the chat**, each with its `not_offered` reason: Send Proposal, Send for Signature,
  Generate Agreement, Submit for Approval (`design`: a person confirms on screen), signing (`secret`),
  Record Signed Copy and Upload Document (`file`), categories, fields, lists, checklists and proof points
  (`design`), Tidy With AI and Rewrite Section (`ai`), the imports (`file`). `scripts/check/ai-forms-
  gaps.json` only shrinks. **Built in PR 3:** the reads `leads.list`, `leads.get`, `partners.list`,
  `partners.get`, `deals.list`, `deals.get`, `categories.list`, `interactions.list`; the cards
  `leads.create`, `leads.update`, `leads.lose`, `partners.create`, `partners.update`, `contacts.create`,
  `contacts.update`, `deals.create`, `deals.update`, `deals.move_stage`, `deals.set_health`,
  `interactions.log` and `deal_returns.save`, each card a small request of its own (`LeadAdd`,
  `PartnerAdd` signed before the hub, `DealAdd`, `DealReturnChange` and the rest) with the form's own
  request named by its `via` reason; the category, template, checklist, field and list writes are
  `design`.
- **Built in PR 8:** the summaries `partnerships.summary` (open, live and stalled deals, projected value,
  and value signed in a period, grouped by stage, category, region, partner or owner: "what is our
  partnership value", "who is our highest contributing partner") and `partnership_returns.summary`
  (returns by partner or month: downloads and units to every reader, gross, MyCity's commission and
  payouts only with `partnerships.money`), both in `partnership_analytics.ai.js`; the read
  `proposals.list`; the card `proposals.start` (`ProposalBriefAdd`: the deal and the notes; a transcript
  and images are files, added on the studio's Brief), run by `proposals.service.start`. Proposals' other
  forms are `design`. Analytics itself has no form.
- **AI routes:** "add a lead" opens Leads with New Lead; "move a deal" opens its 360; "write a proposal for
  X" opens the studio; "renewals due" opens Contracts & MOUs; "set up a category" opens Categories.
- **Search** (`partners.search.js`, `leads.search.js`, `partner_pipeline.search.js` for deals and
  categories, `proposals.search.js`, `agreements.search.js`): partners and leads by name, number, region
  and contact; deals by number, title and event; proposals and agreements by number, title and partner.
  Words: partner, lead, prospect, deal, event, sponsor, tracker, proposal, MOU, contract, agreement,
  commission, renewal. The route map's `partner`, `partner_deal`, `lead`, `proposal`, `contract`, `mou`,
  `agreement` lose `search:none`; Categories and the public Proposal page are added; New Lead, New
  Partner, New Deal, New Proposal and New Partner Category are ⌘K actions. The last is Categories' New
  Category, named in full in ⌘K and the phone's floating button because Expenses has a New Category too
  (§13.2). PR 3 built partners, leads and deals (`partner`, `partner_deal`, `lead` off `search:none`) and
  the New Lead and New Partner actions; New Deal needs its record, so it is the 360's own action. PR 6
  built agreements, MOUs and contracts with Generate Agreement; PR 7 New Proposal; PR 8 proposals
  (`proposals.search.js`: number, title, partner and deal, the newest version of each), `proposal` off
  `search:none`, and `partnership_proposal`, the type its events and notices name, opening Proposals.

- **Contracts and MoUs in the chat (planned; `praxis-ai.md` decisions 41 to 48, §6.18, Appendix A
  PR 2).** A contract or MoU attached on Praxis AI · Ask is read (`agreement-document-read`, Image
  Reading), summarised on the answer and the pane's Record tab, then filed by a card: Record Signed
  Copy (`agreements.record_signed_copy`, risk `approval`) when it matches an agreement in `sent` or
  `viewed`, otherwise Add Partner Document (`partner_documents.attach`) on the partner or lead it
  names. Each runs the route's own service; `not_offered` then reaches `SignedCopyRecord` and
  `PartnerDocumentAttach` through these cards instead of `file:`.

## 10 · On screen and mobile

**§3 and §6 are for engineers: nothing in them reaches a screen unless it is listed here as tier 1 or tier
2.** The mock was built before 5 November; where it differs, this section wins. Not built from the mock:
the Board button, the Lead to Partner card, the note above the proposal paper, the Value by Line chart, the
"Monthly In-App Downloads Attributed" caption, and the hard-coded type, industry and source lists. Every
label below follows the word limits (page title 3, card title 4, button 3, toast 8, help 35), Title Case,
Verb Noun buttons, Lucide icons.

### 10.1 Content tiers

| Screen | Open (tier 1) | Behind help (tier 2) | Not on screen (tier 3), lives in |
|---|---|---|---|
| Pipeline | KPI strip (Open Deals, Signed This Year, Signed Value, Stalled); filters (Stage, Category, Region, Owner, Health); Stages bars; Longest at a Stage (record, deal, stage, days, owner); Stalled (record, deal, blockers, owner); New Lead | Help on Stalled; help on Signed Value | Stage meanings and counting: §6.3, §6.6 |
| Categories | Category list (name, partners, leads, default commission); the picked category: Defaults (Default Commission, Default Validity, Counts as Vendor), Templates (name, kind, default, version; Add Template, Tidy With AI, Edit), Delivery Checklist (item, due; Add Item, Move Up, Move Down, Retire), Custom Fields (label, type, applies to, filterable; Add Field); Pipeline Settings (stages with what each counts as; impact; sources; document kinds); Proof Points; New Category; Start From Tracker | Help on Counts As; help on Counts as Vendor | Why lists are data (A26): §6.3 |
| Partner 360 | Header (logo, name, category, region, owner, status); KPI cards (§6.2); tabs; on Overview each deal's stage switcher, Health, Blockers, Next Action, Expected Close; New Deal, Log Interaction, New Proposal, Generate Agreement, Upload Document, Enter Returns, New Project, New Task, New Event, Add Contact | Help on Days Since Last Contact; help on Dormant | How the 360 is assembled: §6.2 |
| Lead 360 | Header with the status from the deal; KPI cards (Projected Value, Days at Stage, Health, Days Since Last Contact); tabs; the stage switcher; Log Interaction, New Proposal, Close as Lost, Convert to Partner | Help on Status: read from the deal's stage | The conversion transaction: §6.4 |
| Stage switcher, Set Health | Stages in order, the current marked; Why (required back, On Hold, Closed Lost); Health; Blockers (required for Stalled); Attach Signed Copy when moving to a signed stage | Help on a stage: what it counts as | History mechanics: §6.5 |
| Partners and Leads lists | List (name, category, region, stage, health, owner, last contact; leads: status); search; filters incl. filterable custom fields; Export; New Partner or New Lead; Lost chip on Leads | None | Dedup scoring: §6.2 |
| New Lead, New Partner, New Deal | Organisation (Name, Category, Region, Industry); Contact (Name, Position, Email, Phone); Deal (Title, Objective, Stage, Projected Value, Expected Close, Event Dates, Venue); Advanced (Legal Name, Website, Headquarters, Impact, Impact Rating, Impact Note, Expected Attendance, Source, Comments, custom fields); Deal Options on New Deal (up to five rows); a duplicate warning naming the match | Help on Projected Value; help on Commission when it differs from the category's | Dedup signals: §6.2 |
| Proposals, Studio | List (proposal, partner, value, status, viewed) beside the proposal as it will be seen; New Proposal; studio steps: Brief (Notes, Transcript, Images, Template), Questions (cards by group, progress, Use Suggestion, Skip, Reshuffle, Write Draft), Draft progress, Edit (Change Layout, Move Up, Move Down, Hide, Replace Image, Rewrite Section), Send (To, Cc, Subject, Message, the stand-ins and unconfirmed figures, Confirm and Send); Download PDF, Copy Link, Mark Accepted, Mark Declined, Withdraw, Revise, Save as Template | Help on a card's Why; help on a stand-in image | Prompts, figure checks, the job: §6.10, §6.11; no reassurance about AI on screen |
| Contracts & MOUs | KPI strip (Active, In Approval, Awaiting Signature, Renewals 180 Days); lifecycle bar; list (agreement, partner, kind, status, renewal); the picked agreement: the document, approval (stage, waiting on), signers and their state, reference and QR, renewal; Generate Agreement, Submit for Approval, Approve and Reject (when the waiting stage names the reader; Reject asks its Reason), Send for Signature, Record Signed Copy, Send Again, Renew, Close Agreement | Help on Renewal: the notice period | Hashes and evidence: §6.9, the manual |
| Analytics | Period; KPI strip (New Prospects, Meetings Held, Proposals Sent, Partnerships Signed); per lead owner table (the eight measures); Signed per Month; Returns per Month (money); By Category; By Region; Stage Conversion; Export | Help on each measure | Definitions: §6.18 |
| My Workspace forms | Connect to Partner; then Partner and Deal; on edit, Disconnect | None | Visibility: §6.16, workspace.md |
| Public · Proposal | The proposal as designed; Download PDF; the owner's contact | None | Tracking: §6.10 |
| Public · Sign | The agreement in full; Send Code, Your Code, Resend Code; Full Name, Title; Draw or Type; I Agree to Sign Electronically; Sign Agreement; Download Signed Copy | Help on the code: sent to the address the link was sent to | Evidence and hashes: the manual |
| Public · Verify | Status, signers with date and time, the two verdicts; the document when opened from its QR | Help on each verdict | How hashing works: the manual |

### 10.2 Phone layout

| Screen | First on a phone | Left off a phone | Main action | Navigation |
|---|---|---|---|---|
| Pipeline | Two KPI cards (Open Deals, Stalled), the filter chips, then deal cards (record, stage pill, health dot, days at stage) | Signed Value; stage bars beyond the top six | New Lead, full width | Bottom bar More → Partnerships; seven tabs scroll sideways |
| Categories | Category cards (name, partners, commission) | Pipeline Settings and Proof Points behind their own rows | New Partner Category, the floating button's action | A category opens as a sheet, its four sections (Defaults, Templates, Checklist, Fields) one at a time behind a segmented control |
| Partners, Partner 360 | Two KPI cards (Active, Quiet), then partner cards; a tapped partner opens the 360 full screen | Export; Owner and Region columns | On the 360, the next stage full width at the foot; Log Interaction in the page menu | The 360's tabs as a scrolling segmented control; Back closes it |
| Leads, Lead 360 | Two KPI cards (New, Qualified), then lead cards with a status pill | Leads by source | New Lead; on the 360 the next stage at the foot | As the Partner 360 |
| Proposals, Studio | Proposal cards (partner, status, viewed); the studio one step a screen; question cards one at a time, Skip and Reshuffle under the answer | Change Layout and Move (desktop only; the phone edits text and images) | Write Draft, then Send Proposal at the foot | StepBar at the top; Back steps back |
| Contracts & MOUs | Two KPI cards (Awaiting Signature, Renewals), then agreement cards with status and renewal date | The lifecycle bar | The agreement's next step at the foot of its sheet | Tabs scroll sideways |
| Analytics | The period, two KPI cards, then one card per lead owner with the eight measures | Charts beyond Signed per Month | Pick the period | Tabs scroll sideways |
| Public · Proposal | The cover, then sections in one column | Nothing | Download PDF | One page |
| Public · Sign | The agreement, then the code, then the signature pad full width | Nothing | Sign Agreement, full width | One step at a time |

### 10.3 Components

From `@mycity/ui` (docs/COMPONENTS.md): `ListDetail`, `DetailPane`, `DataView`, `PageHeader`,
`ProfileHeader`, `KpiCard`, `StatStrip`, `Tabs`, `SegmentedControl`, `Chips`, `FilterSelect`,
`SelectField`, `InlineSelect`, `PersonPicker`, `TextField`, `TextAreaField`, `RichTextField`,
`MoneyField`, `DateField`, `DateRangeField`, `AddressField`, `PlacesField`, `UploadField`, `Switch`,
`Wizard`, `StepBar`, `OtpField`, `SignatureField`, `PdfViewer`, `Timeline`, `Chain`, `Meter`,
`BarChart`, `AreaChart`, `DonutChart`, `TrendChart`, `ActionGroup`, `Tooltip`, `HelpTerm`, `EmptyState`,
`Paper`, `RichText`; and the app's own `ExportAction` (`app/src/features/shared/sections.tsx`), as
every screen's Export already uses. **New**, each added with `npm run new:component` (header, test,
gallery page), never inside the feature: `StageSwitcher` (stages in order, one press to move, keyboard
and 44 px targets), `QuestionCard` (a studio card: question, why, answer control by kind, suggestion,
Skip, Reshuffle), `DocumentFrame` (a sandboxed, token-styled preview of server HTML with section
overlays for the studio's edit controls). `DocumentEditor` (built in PR 2: headings, numbered clauses,
tables and field chips, with Insert Field) is the template editor, beside `RichTextField`.

## 11 · Edge cases

- **A record made a minute ago** shows zeros and empty sections (§6.2).
- **No owner** (an unmatched tracker owner): seen with scope `all`, flagged No Owner, assignable.
- **The owner leaves MyCity**: their records keep them as a former employee; Operations & People reassign;
  open proposals keep the sender until reassigned.
- **A duplicate**: warned, never blocked; a lead whose organisation is a partner is offered New Deal.
- **Conversion twice**: converts once (§6.4).
- **Signed outside the hub**: Record Signed Copy or a stage move with the copy; verification says so.
- **Two signers, one declines**: the request is declined, the agreement returns to `sent` with Send Again;
  the other's signature is void and says so.
- **A code mistyped five times**: spent; Send Code again after 60 seconds.
- **A wrong signer email**: corrected and sent again; the old link stops working.
- **An empty required field**: Submit refused, naming the field.
- **The approval flow edited while one waits**: the waiting request keeps its version (the engine's rule).
- **The owner's department has no head**: the first stage names nobody, so it falls to the CEO (the
  engine's rule), and the CEO stage after it is skipped as a repeat.
- **A template changed after generation**: the agreement keeps its `template_version`; Generate again
  uses the new one.
- **AI off, capped or failing**: the brief and answers kept; Try Again; the kit's layouts can be filled
  by hand; Tidy With AI says AI Is Off and the template editor works as before.
- **An unsourced figure**: marked for the person; Send lists it.
- **A proposal link forwarded**: anyone with it can read it; views count; Withdraw stops it.
- **A transcript as PDF or Word**: refused ("Upload Markdown or text"); paste the text instead.
- **Images too large or unsafe**: the upload engine's limits and checks apply.
- **Returns for an unknown deal**: in the error report, never guessed.
- **Returns without the money capability**: refused by the server.
- **A deal past validity with its event ahead**: live until the later of the two.
- **A partner with only completed deals**: Dormant; a new signed deal makes it Active.
- **A retired custom field**: values kept, shown as retired, not offered.
- **A tracker cell with two phones**: both kept.
- **Double press, Enter twice**: one request (F26); `ActionGroup` everywhere.
- **Large lists**: 25 a page; every server-fed select loads its next 25 (F32).
- **Non-NGN money**: kept and shown; Home's sums count NGN only.
- **Offline**: writes need the network; the 360 shows what was last loaded.

## 12 · Donor code

| From | File | Change on the way in |
|---|---|---|
| praxis | `src/modules/master/party-360.service.js` (332) | One call, every figure 0, every collection `[]`; for leads and partners; tabs |
| praxis | `src/modules/sales/partnership_request/` (1,117) | The decision as a transition, the downstream record in the same transaction: conversion, lost, approval |
| praxis | `src/modules/sales/{lead,opportunity,meeting}/` (1,943) | Leads, deals with stages, interaction history; MyCity's words |
| praxis | `src/modules/sales/proposal/`, `proposal_public/` (553) | Proposal records and a public view by token; rebuilt on the design kit and the studio |
| pixie | `src/modules/crm/` (2,830), `crm.presets.js` | Pipeline lists and their admin, as Categories and Pipeline Settings; no seeded presets; no board |
| pixie | `src/shared/contacts/` (2,681) | The contact shape, country codes, several phones |
| praxis | `src/modules/mail/binding/` (2,126) | A thread linked to a record; re-pointed at leads and partners; the excerpt rule is new |
| praxis | `src/modules/hr/vacancy/vacancy.draft.js` (453) | Structured AI output kept provisional until used; extended with question cards and figure sources |
| pixie | `src/shared/documents/documents.esign.service.js` (939), `esign.repo.js`, `esign.certificate.js`, `esign.signed-pdf.js` | M5's port; the email code, typed signatures and the QR seal through the same service |
| pixie | `src/modules/recruitment/recruitment.render.js` (742) | One renderer for the web page and the PDF |
| praxis | `services/signatures/` (`canonical.js`, `certificate.js`, `qr.js`, `verify-link.js`, `tokens.js`) | Dual hash (A12), the QR and the verification link |
| praxis | `master/_shared/dedup.service.js` | Already `shared/dedup` |

Nothing ported says where it came from (`scripts/check/provenance.js`).

## 13 · Open questions

### 13.1 Settled 05/11/2026 (JBS Praxis's answers)

1. Leads are separate records (new, contacted, qualified, lost), converted into a partner when the deal
   closes.
2. A partner has many deals.
3. Categories is a seventh Partnerships tab, after Pipeline, ratified; PR 1 registers it.
4. A category is the partnership type.
5. The stages run on deals; a lead's first deal moves with it at conversion.
6. Progress is Stage plus Health with Blockers required when Stalled; Current Stage is not kept.
7. Custom fields are defined per category (or for all) by `partnerships.configure`, typed, filterable,
   behind Advanced.
8. Region is cities picked from the search plus a scope (National, Africa, Worldwide).
9. The Partner 360 is as §6.2 says.
10. Projects connect to a partner through **Connect to Partner**, which reveals Partner and Deal; so do
    tasks and events; Praxis AI's cards and the User Guide's pictures follow.
11. Tasks keep Workspace's visibility; the 360 lists what the reader may see and counts the rest.
12. A deal carries its event's dates and venue; signed deals show on the team's calendar; meetings are
    connected events.
13. The 360's cards are Signed Value, Returns This Year, Active Deals, Days Since Last Contact.
14. Up to five options per deal with the Deal Merchant Agreement's figures and a validity; returns and
    downloads entered or imported per deal and month.
15. Values open to the record's readers; commission, merchant's take and returns need
    `partnerships.money` (Operations & People, Management, Implementation, General Management, CEO).
16. A category's delivery checklist becomes Workspace tasks on signing.
17. Templates are built in the hub; pasted Word text is tidied by AI, which proposes the fields.
18. Every agreement is approved (Head of Department, then CEO) through the approval engine, editable on
    Settings · Approvals.
19. Eight build PRs, then the Partnerships User Guide chapter after acceptance (Appendix A).
20. Signing: drawn (PNG, base64) or typed, confirmed by a one-time code, name, title, date and time,
    dual hashes, and a QR to verification showing the content and status.
21. Proposals on Top Tier, Anthropic Sonnet first, Gemini Pro as fallback.
22. Designed layouts that Claude fills: one masterpiece kit, everything it needs built or seeded,
    editable afterwards; well-structured question cards that can be reshuffled; the hub's city
    photography as stand-ins until MyCity uploads assets.
23. Claude's inputs: notes, a transcript, the record, question cards.
24. A proposal goes as a PDF and a tracked private link (a seventh public page, ratified), only after a
    person presses Send and confirms the address; the PDF can be downloaded.
25. Analytics shows the sheet's eight measures; the rating comes from Performance.
26. This guide is the only source of truth for M7, standalone and elaborate (§0).
27. Numbering prefixes are `PAR`, `LED`, `DEAL`, `PRO` and `AGR`, as §4.3 sets them ("use any
    prefixes, we don't mind").

### 13.2 Decided in writing this guide (change here if wrong)

- A lead's status is read from its deal's stage (§6.4), so 1 and 5 hold without typing a fact twice.
- Conversion happens when the lead's deal is signed, in the same transaction (§6.4).
- Start From Tracker reads the workbook's dropdowns instead of seeding lists (§6.3, A26).
- The tracker fixture is synthetic; the real contacts are never committed (§6.13).
- Verification by reference shows no content; only the QR's token shows the document (§6.9).
- The one-time code goes by email (no SMS provider in the hub).
- Linked mail shows an excerpt to the record's readers (§6.15).
- Proposals need no approval to be sent; a flow can be added on Settings · Approvals later.
- The public Sign Offer page serves agreements too, its heading following the document; renaming it in
  the inventory is for whoever next touches M5.
- A deal's calendar event is visible to its team (`attendees`), not to everyone.
- **In PR 1 (05/11/2026, JP), each to keep the build's own rules:**
  - The seven controllers stay empty until their PRs. Gate 23 (rule 6) asks a module with a filled
    controller to put every one of its create and edit forms in the chat or give a never word, and
    `scripts/check/ai-forms-gaps.json` may not grow; an `// ai:none not built yet` reason would fail it.
    Each module's PR writes its manifest (or its reasons) with its controller.
  - The Workspace link (`PartnerLink`) joins the Workspace forms in PR 5, not PR 1, so no request takes
    a field nothing writes and Praxis AI's project, task and event cards do not change before then.
  - `partner_type` is dropped one release after the code stopped reading it (MIGRATIONS §8), in PR 3.
  - The region's place owners are `lead.cities` and `partner.cities`, named for the contract's key, as
    gate 22 asks.
  - A deal's validity is optional (New Lead's form has none); the category's default applies.
  - `agreement_obligation`'s drop refuses to run if the table holds a row, so nothing is lost and the
    schema is the same on every database (MIGRATIONS §11).
- **In PR 2 (06/11/2026, JP):**
  - `template-tidy` runs on **Default**, chosen by JP, with `personal_data: true`.
  - A template's asks are a column, `partner_category_template.asks` (migration `7050`), because `7010` gave
    them no place; the agreement keeps the values given in its own `fields` (§4.2).
  - The wording is read and saved by `templates.agreements` in the `templates` module, on `template_version`
    and the shared template store; its routes sit with the category (`GET` and `PUT /category-templates/:id`),
    since the `templates` module's own routes are Queries' letters. A template key is made from the category
    and the name (`events-deal-merchant-agreement`) and never changes.
  - The editor is a new `packages/ui` component, `DocumentEditor`, beside `RichTextField`, which stays as it is
    (§10.3 allowed either); the shared Markdown converter keeps a table only when asked (`tables: true`), so
    letters and policies are unchanged.
  - A proof point's image is uploaded to it (`POST /proof-points/:id/image`, stored as `proof_point_image`,
    readable by anyone who may open Partnerships) as Settings' brand files are, so `ProofPointCreate` no longer
    names a `document_id`; `ProofPointUpdate` takes only `null`, to remove the image.
  - The record fields a template may name include `partner.headquarters`, `deal.event_ends_on`,
    `deal.expected_attendance`, `deal.comments`, `category.checklist` and the four `signer.*` fields (§6.8),
    which the redacted Deal Merchant Agreement needs; PR 6 renders them.
  - A stage's code is made from its name; MyCity's own "Negotiation" is `negotiation_2` where `7099`'s retired
    row holds the plain code. A list value is retired, never deleted.
  - `partner_pipeline`'s controller is filled, so gate 23 asks for the reason of every create and edit schema
    of its contract: `DealCreate`, `DealUpdate` and `ReturnSave` carry a `design:` reason that says the card
    arrives with PR 8; PR 8 declares `deals.create`, `deals.update` and `deal_returns.save` and removes them.
  - Tidy With AI's answer, `TemplateTidyDraft`, says whether there is a draft: `available`, and `reason`
    (`off`, `limit`) when there is none, so the editor says AI is off or the month's limit is reached instead
    of failing; the draft is `body_html`, the editor's HTML with each field a chip (it was `body`), with its
    `ai_run_id`.
- **At PR 2's review (06/11/2026, TB):**
  - ⌘K's labels are one each, and Expenses (M8) already had New Category, so both read in full: New Partner
    Category here and New Expense Category there. Each screen's own New action, which the phone's floating
    button offers, carries the same name, as the search coverage gate holds it to ⌘K; the screens' header
    buttons stay New Category (§9, §10.2; `expenses.md` §9, §10.2).
  - On a phone a category's four sections sit behind a segmented control, one at a time, as the 360s' tabs
    do: a sheet replaces the last one rather than stacking, and rows opening in place would hide the
    sections' buttons, which the Accordion is not for (§10.2).
- **In PR 3 (06/11/2026, JP):**
  - A record's documents are a table of their own, `partner_document` (`7060`), naming the vault's row:
    a document carries its kind, its deal and where it came from, and conversion moves a lead's
    documents by re-pointing these rows without rewriting the vault (§4.2, §6.4).
  - The read routes Pipeline, Partners and Leads need from PR 2's lane (`GET /categories`, `GET
    /fields`, `GET /lists/:list`) were built in PR 3 while PR 2 was open. PR 2 merged first, so its
    routes and files serve them, and the deals read through them: a stage rule from `.lists`, a
    category's defaults from `getCategory`, a custom value checked by `.fields`' `checkValue`.
  - The `deal_return` service and its two routes (behind `partnerships.money`) came with the rest of
    `partner_pipeline`'s controller, with the `deal_returns.save` card; PR 4 builds the Returns tab,
    Enter Returns and the import on them. The tab shows its empty state until then.
  - Leaving On Hold needs no reason, a signed deal moves only among signed meanings, On Hold and Closed
    Lost, and only the first move into a signed meaning asks for the signed copy (§6.5).
  - New Partner's deal starts at the first `signed` stage when the form names none (§6.6).
  - Partners' Quiet uses the enabled rule's `N`, 30 while none is enabled (§6.12).
  - Screens write Follow-Up Required with both parts capitalised, as Title Case asks (FRONTEND_GUIDE
    §5.4); the stored code is still `follow_up_required`, and this guide keeps the tracker's spelling.
    The demonstration stage Follow-Up Ongoing on the mock and staging is written the same way, since the
    stage switcher draws a stage's name as a button; MyCity's tracker keeps its own spelling.
  - Home's Signed Value card counts deals (its caption "deal"), each a row of its records (§6.17).
  - Merged after PR 2 (06/11/2026): PR 2's `7050` is the template's asks, so `partner_document` and the
    `partner_type` drop are `7060`. PR 3 declares `deals.create`, `deals.update` and `deal_returns.save`,
    so `DealCreate`, `DealUpdate` and `ReturnSave` carry `via` reasons naming those cards in place of the
    interim `design:` reasons recorded under PR 2 above; PR 8 has nothing left to declare for them. On
    the in-browser mock, Categories' data is the one source of the categories and MyCity's lists, which
    the deals read.
- **At the audit of PRs 1 to 3 (06/11/2026, TB), before PR 4:**
  - Who sees a deal: its owner's scope, its team, or the scope of its lead's or partner's owner, one rule
    for the lists, the 360s, ⌘K, Home, Praxis AI and every write (§6.1). The 360s list and count only the
    deals the reader sees, so the Overview never drops a deal the Deals tab shows.
  - The duplicate check stays outside scope, answering numbers and names only; Categories' counts and the
    picked category's partners and leads follow scope (§6.1, §6.2, §6.3).
  - New Deal and Edit Deal refuse an owner outside the reader's scope, as New Lead and New Partner do (§6.1).
  - A lost lead reopened by its deal's move loses its lost reason (§6.4).
  - The Partner 360's Activity carries the stage and health history of its deals (`Partner360.history`, each
    line naming its deal); `PartnersSummary.quiet_days` is the `N` Partners' Quiet uses (§6.2, §6.12).
  - The forms carry what §6.5, §6.6 and §10.1 list and PR 3 left out: Deal Options (up to five rows),
    Commission (with `partnerships.money`, help when it differs from the category's), Validity and Team on
    New Deal and Edit Deal; Impact and the custom fields behind Advanced on New Lead, New Partner, New Deal
    and the edits. The Partners and Leads lists gain Category, Region, Owner, Stage and Health filters and
    the filterable custom fields (desktop), with Owner and Region columns; Pipeline gains Owner. A deal
    opened with a new lead takes the lead's identified date. The 360's card reads Days Since Last
    Contact, as §13.1 item 13 names it.
  - PR 4's importer writes through the services in the engine's transaction: `leads.createIn` and
    `partners.createIn` (a lead or a partner with its first deal, the contact optional) and
    `partner_pipeline.createIn` take `source` (`import`, written on the history line and the events'
    payloads) and the identified date; `partner_pipeline.returns.saveIn` takes `source` and the import
    batch. The screens' routes call the same functions.
  - The Partners and Leads lists' **Export** (§10.1) comes with PR 4's export in the tracker's columns.
- **In PR 5 (07/11/2026, AJ with GE; TB's answer on deliverables):**
  - New Partner's **Signed Before the Hub** raises no deliverables: delivery of a relationship signed
    outside the hub already runs outside it. Its deal's event days still go on the team's calendar. A
    New Partner with only a signed copy raises them as any signing does (TB, 07/11/2026). A deal the
    tracker import signed (source `import`, PR 4) raises neither deliverables nor event days.
    `deal.signed` carries `signed_before_hub` so the handler can tell (§6.6, §6.7).
  - Deliverables and the event days are outbox handlers on `deal.signed` (`partner_pipeline.
    deliverables`, `partner_pipeline.event_days`), after the signing commits, never inside the
    conversion's transaction; each reads the deal as it stands, so a retry raises nothing twice
    (`deal_deliverable_item_uq`). A deliverable is set by the deal's owner for themselves, so they may
    reassign it (A24); an `event_start` item on a deal with no event date counts from signing; the
    batch emits `deal.deliverables_raised` (§6.7).
  - The deal's event days are one all-day event kept by its **partner** (`entity_type` `partner`,
    found by its `deal_id`): M2's `calendar_event_entity_check` allows `interview`, `partner` and
    `vacancy`, so no Workspace table changes, and the event opens the Partner 360. Edit Event and Call
    Off refuse it (`EVENT_OWNED_BY_RECORD`). It follows `deal.updated` (dates, title, venue, owner,
    team), is called off on `deal.lost` (Closed Lost, a lost lead, a closed partner), and comes back
    when a lost signed deal goes live again. A **completed** deal keeps its event, whose days have
    passed; §7's "calendar event cancelled" on `deal.completed` reads as §6.16's lost or closed (§6.16).
  - The inactivity follow-up keeps its spells in `partner_follow_up` (migration `7080`, unique
    `dedup_key`), since the outbox purges its own dedup keys sooner than a spell can last. It runs at
    06:30 Lagos, after `home-alert-sweeps`; a Stalled deal keeps its health and blockers; the task is
    High priority; an owner with no login gets no task (the spell is still recorded); `follow_up.raised`
    (§6.12).
  - Connect to Partner reads two pickers of its own on `partners.work` (`GET /work/records`: partners
    not closed and leads neither converted nor lost; `GET /work/deals`: a record's open and live
    deals, or every one the reader sees for a card), 25 a page; `PartnerLinkQuery` takes `lead_id`
    beside `partner_id`, since the filter offers leads too. The Calendar takes no Partner filter (a
    month of the reader's own), so Appendix C's three list queries are Tasks' and Projects' (§5).
  - Every task, project and event carries `partner_link`, its names filled only for a reader who sees
    the record (and the deal) in Partnerships, on the Workspace routes; anyone else reads the ids and
    the screen says A Partner You Cannot See (A24). An edit sends only what changes, a new record
    clearing the deal, and a link left as it was is never checked again. Who may connect is who may
    change the work: a task's manager (the link is a setter field), a project's owner, an event's owner.
  - The Work tab lists the work its reader may open in My Workspace (every project; a task they lead,
    set, share, watch or reach through scope; an event they own, are invited to or everyone sees),
    never cancelled tasks or called-off events, and counts the rest by kind. Its New Project, New Task
    and New Event (both 360s) open My Workspace's own forms in place, already connected; the Overview's
    Next Events shows the next three connected events the reader may see.
  - Praxis AI's task, project and event cards carry Partner, Lead and Deal, picked on Edit (`AiCardPicks`
    `partner`, `lead`, `partner_deal`), named by number and name, and found from words among the records
    the person sees (`partners.work.card`); the press checks the link as the form's save does.

- **In PR 4 (07/11/2026, LA), the tracker importer and returns:**
  - **Map Values** is the engine's (`shared/import`, foundation.md §5): a field declares `mapValues` as a
    list, a person or a place. The tracker maps Partnership Type and Partnership Stage (lists; a type may be
    created), Lead Owner (a person; unmatched leaves No Owner, `missing: "leave"`), Region (each city picked
    from the address search, F27; National, Africa and Worldwide are scopes, not listed) and Status (its five
    values). The choices are kept on the batch's mapping and its profile; no migration (the mapping is jsonb).
  - The tracker is read by `extract()` (`partners.import.js`) into the importer's fields, so the person's
    column map is the engine's own and Map Values reads clean values: Contact Details split into Contact
    Email and Contact Phones, Partnership Type into the category and the deal's Commission, the dates read
    day-first (a month alone is its 1st and the comments say so; a missing year is the year most of the
    sheet's dates name), Expected Close Date text joined to Next Action, Current Stage kept in the comments
    only when it says more.
  - A row that matches a record already in the hub (name, website host, primary email, whatever the
    importer's scope, as the duplicate check reads) is left as it is: the import never overwrites what
    people entered, so importing the file again makes nothing twice and the importer has no update to undo.
  - Revert removes what the import made (`leads.service` and `partners.service` `removeImportedIn`, events
    `lead.removed`, `partner.removed`) until the record is in use: an interaction, a proposal, an agreement,
    a document, a linked mail, returns, or a stage or health line not from the import.
  - An imported deal's title is its category's name and Partnership ("Event Partnership"); the tracker has
    no title column. A signed row's partner is "signed before the hub" and its deal dated by Date
    Identified. A Closed Lost stage, or Closed on an open deal, makes the lead lost through the stage move
    (reason "Closed lost in the tracker", source `import`); Closed on a signed row is a note, never a lost
    live deal. Commission from a type's terms needs `partnerships.money`, else it is left out with a note.
  - **Any other column** fills the custom field of the same label (lead or partner, or deal); a column with
    no such field is named on its rows ("add it on Categories to import it") rather than created at commit:
    the engine's ticks are per value, not per column, and a field needs its type, which a column does not
    say. Every column of the export reads back.
  - **Partnership Returns** (`partner_pipeline.returns.import.js`) needs `partnerships.money`; each row's line
    is its deal (number, or partner and title) and its month, made by `extract()`, so a month imported again
    is an update (replaced, audited) and the same figures again are unchanged. Revert puts back what the month
    held, or removes a month it made (`deal_return.removed`), refused once the month was entered or imported
    again since.
  - **Export** is `POST /partnerships/exports` (`partnerships` export) with `source` `partnerships.partners`,
    `partnerships.leads` or `partnerships.deals` and the list's own filters, on the shared export path
    (foundation.md §6.12; document type `partnership_export`): sheet Master Tracker in the tracker's eighteen
    columns, then a column a custom field; never money. Partners and Leads offer Export on a computer; a phone
    leaves it off (§10.2).
  - The Returns tab (`Returns.tsx`, `forms/ReturnsForm.tsx`): the deal (when the partner has several) and
    the year, the year's totals (Commission, Gross Sales, Units Sold, Downloads), Commission by Month, the
    months with Imported or Entered, and Enter Returns a month at a time (the last eighteen months; a row
    opens its month).
- **In PR 7 (07/11/2026, JP):**
  - The kit draws its own pages: `documents.generate()` takes a document type with a `draw` hook (the data
    in, the complete HTML out, checked by the type itself instead of the letter's variables), and
    `pdf.render` a `bare` option (no letterhead, header or footer: the kit's pages carry their own), so the
    studio's preview, the public page and the PDF are one HTML (§6.11).
  - **Download PDF** is an export (foundation.md §6.12): `POST /proposals/:id/pdf` answers `202` with the
    `ExportFile`, the sent PDF when there is one, else the draft's made in the worker.
  - The public link's token is kept encrypted on the proposal (`partnership_proposal.link_secret`,
    migration `7110`, bound to the proposal's id), so the worker can mail the link once the PDF is ready
    and the studio can show Copy Link; it is cleared when the link stops.
  - A proposal is valid for 30 days from sending (`valid_until`). The daily scheduler `proposal-expiry`
    expires it after, until PR 6's `agreement-renewals` takes the job over.
  - Sending version 2 withdraws version 1 and stops its link, so a partner never holds two live versions.
  - Skip is refused on a required card (`409`, the card says so); Write Draft waits while one is open.
  - With AI off or the month's cap reached, **Build by Hand** (Write Draft's route) fills the pages the
    record can without Claude (the cover, MyCity's figures, the packages, the timeline, the next steps and
    the back cover) and opens Edit, where a person writes the rest (§6.10).
  - Words are edited in a panel beside the page (**Edit Words**, one field a part of the layout), not in
    place: a section's content is plain text, so the kit's look cannot be broken by an edit.
  - The `proposal.viewed` notification to the owner and Home's views are left for PR 8; PR 7 records the
    views and sets Viewed.
  - `.md` is accepted as an attachment by the upload engine, so a Gemini notes export uploads as it comes.
  - `ProposalStart.assets` (each a `document_id`, its role and alt text) replaces `asset_document_ids`, so
    a brief's images carry what the kit needs to place them.
  - The tone notes Claude draws from the brief are kept in `partnership_proposal.brief` (`tone_notes`);
    Save as Template copies them into the template's `structure`.
  - `proposals`' controller carries `// ai:none`: Praxis AI's `proposals.start` card arrives with PR 8, so
    the studio's create and edit schemas carry `design:` reasons until then (gate 23).

- **In PR 6 (08/11/2026, TB; TB's calls of 07/11/2026), agreements, approval, signing and verification:**
  - AJ's #85 merged into `main` before this PR, so the one signatures service and its `5020` reached `main`
    through M5, unchanged; this PR improves it on top. The branch adds no M5 file, so gate 3 needs no
    exception and #85 needs no second merge.
  - Generate Agreement keeps a field with no value as its chip in the Draft (`fillMarkdown` `keepEmpty`), so
    the person sees it and Submit names it: the missing fields are the chips still in the wording, `signer.*`
    aside. Submit also needs the start date, since the term is part of what is signed (the content hash).
    Draft edits are the editor's HTML (`AgreementUpdate.body_html`); a value given in `fields` fills its chip.
  - The agreement's PDF is its own wording through the one renderer and letterhead (`generate.js`
    `ownWording`, `heading: false`), recorded with its category template's key and version. When sealed, the
    partner's signature is stamped into the wording's `signer.*`; any other signer prints after it, then the
    certificate; the QR prints in the letterhead's header, so on every page (offers' sealed copies too).
  - `review` while the first stage waits, `approval` while a later one waits and once every stage approved
    (`approval.state` `approved`), which Send for Signature then accepts. Rejected, not decided in time, the
    approval withdrawn, or changes asked for (withdrawn as its opener, as expenses' Send Back) return it to
    Draft with the reason (`returned_reason`, migration `7101`) until it is submitted again.
  - Send for Signature: the partner's signatory contact first, then MyCity's when the template is
    countersigned (the CEO offered; the person may change either). Every signer is mailed at once, after
    commit; a later signer's page says whom they sign after. A link lasts 30 days. Send Again ends the open
    request as withdrawn and stops every earlier link of the agreement, a declined one's included; a corrected
    address is Send for Signature again from Sent.
  - A decline or a lapse returns it to Sent with Send Again; a signature already on that request reads Void,
    on the signing page and on the agreement. The last signature makes it Signed and moves its deal to the
    first `signed` stage (source `signature`), which converts a lead; the agreement it renews becomes Renewed.
    The sealed copy is mailed to the owner too (the adapter's `sealedTo`) and filed among the partner's
    documents (origin `agreement`, `partners.documents.fileIn`), the vault's row unchanged.
  - Record Signed Copy is offered once approved, and while Sent or Viewed: the scan joins the record's
    documents (origin `signed_copy`) and `signatures.recordPaperIn` records a completed, sealed request over it
    (signature `paper`, no email: migration `7100` allows one only then). It has no QR, so it verifies by
    reference only and reads Signed outside the hub.
  - An agreement's wording is the agreement its partner signs, so whoever sees the agreement reads the terms it
    states, commission included; `partnerships.money` keeps gating the deal's own commission fields and its
    returns (§6.1).
  - `AgreementDetail.verify` is the reference, the by-reference page and that page as a QR: only the sealed
    copy's QR key's hash is kept, so the screen cannot show the QR's own link.
  - The daily job runs at 06:45 Lagos: Signed to Active on its start, to Expiring at its notice date, live deals
    past the later of validity and event end Completed (`deal.completed`, `partner_pipeline.completeLapsed`,
    each partner's status kept). An agreement past its end stays Expiring until renewed or closed and reads
    Expired on verification. The owner is reminded at the notice date, then 30, 7 and 1 days before the end.
    Proposals' expiry is PR 7's.
  - Renew drafts from a signed, active or expiring agreement (its asks kept, one open renewal at a time), on a
    new deal "<deal> (Renewal)" on the partner when asked. Close withdraws an open approval as its opener and
    ends an open signature request.
  - ⌘K finds agreements, MOUs and contracts by kind (three providers in `agreements.search.js`) and offers
    Generate Agreement, which opens its form on Contracts & MOUs to pick the deal. Praxis AI reads
    `agreements.list` and `agreements.renewals`; every agreement form is `design`, Record Signed Copy `file` and
    signing `secret` (§9).
  - The public signing page's words follow the document (Partnership Agreement, Sign Agreement, Decline to
    Sign); its consent box keeps the label it shipped with, Agree to Sign Electronically, as the public site's
    User Guide chapter and its pictures name it.

- **In PR 8 (08/11/2026, JP), analytics, mail, Praxis AI, search and finish:**
  - Analytics' rating goes through Performance's service (`reviews.service.ratingsFor` on
    `reviews.repo.latestRatings`, Performance's own `readable` rule), never a query of Analytics' own
    on its tables (§6.18).
  - Analytics' Export is a source of the partnerships export, `partnerships.analytics`, the period's
    workbook a sheet a table, money decided again in the worker (§5).
  - The record's history keeps a linked mail's sender, recipients and thread on the interaction
    (`7120`), and the message's link is set null when the message goes, so the owner emptying Trash
    never fails on, or takes, the record's history (§4.2, §6.15).
  - Link to Partner sits in the conversation's menu and the linked record in a line under its header,
    so a conversation not linked shows nothing new; it reuses Workspace's Partner and Deal pickers
    (`PartnerLinkFields` `open`) rather than a second copy (§6.15, workspace.md).
  - A linked message is logged in the transaction that stores it, not by an outbox handler: Mailbox
    emits `mail_message.received` only for fresh unread inbox mail, and a thread's sent and older
    messages must be logged too (§6.15).
  - The Partner Agreement flow's context reads the deal's rate, else its category's default, else 0:
    Submit for Approval failed (`context is missing "commission_pct"`) on a deal of a category with no
    default rate, which the staging seed found (§6.9).
  - The staging seed writes through the services as Operations & People (the real post's login), and
    its proposals are Build by Hand (`proposals.service.start` and `requestDraft` `byHand`), so a deploy
    never asks Claude. Home's demonstration rows in the five M7 tables leave `lib/forward-rows.js`, which
    now writes no row anywhere, and Home's seed tests no longer count Partnerships' figures (§6.17).
  - Home's Proposals Out records show Last Viewed (or Not Yet) and Views, the views PR 7 recorded.
  - `templates/documents/mou.html` and `templates/email/agreement-renewal.html` stayed empty and are
    deleted: MOUs are templates built in the hub (§6.8) and the renewal reminder is `defineReminder`'s
    (§7). `templates/documents/signature-certificate.html` is M5's, left as it is.

- **After PR 8 (10/11/2026, TB), found writing the chapter: the approver had no button.** §6.9 put Approve and
  Reject on the agreement's card, but PR 6 built the Approval card read only, so Home's Need You opened an
  agreement an approver could not decide. Built: `AgreementDetail.approval.can_decide` (the engine's
  `canAct` for the reader, the CEO any stage, never the submitter), **Approve** and **Reject** on the card and
  its Reason sheet, on the approval's own routes, in the demo as well. Tested against the real engine (the
  Head of Department at stage one, the CEO at both, the submitter and staff never). The demo's Write Draft now
  walks its steps over a few seconds, so the studio's progress can be pictured.

### 13.3 Still open

- **AI jobs:** settled. `template-tidy` is Default (JP, 06/11/2026) and `proposal-message` is Default (TB,
  07/11/2026) (§13.2).
- **MyCity's samples** (Edidiong Etudor is to send them, 5 November). The **Deal Merchant Agreement** is
  in hand, redacted in `docs/MyCity-ERP-Documents/partnership-samples/`. The **ticketing template**
  (Regular, VIP, VVIP) was wanted by **PR 2** as a second Events template; it had not arrived when PR 2 was
  built, so it is built the same way when it does (upload it in any chat: it is stored redacted beside the
  agreement and entered in the template editor, with no change to the code). A **sample proposal** is needed by **PR 7**,
  whose kit is checked against its tone, structure and proof points: upload it in PR 7's chat, which
  stores a redacted copy too. Neither blocks a PR from starting; each blocks only its PR's last step.
- **Proof points' first set:** MyCity enters them; staging seeds a demonstration set.
- **M5's signatures service** is shared; whichever milestone builds first builds it to §6.9 (GE with LA).
- **MyCity's owners for M7** after Cynthia Osakunih's handover: Edidiong Etudor for partnerships, the new
  Operations & People lead for approvals.
- **Expenses paid to a partner** (M8, merged 04/11/2026): an expense request's payee may be Partner, typed
  with its bank details and not linked to a partner record. Linking it, so the 360 can show what MyCity
  paid a partner beside what it earned, is a later decision for AJ and GE; nothing in M7 depends on it.
- **MyCity's Anthropic account** funded and its key entered on Settings · Integrations before the studio
  is demonstrated.

## Appendix A · The build plan

Eight build pull requests, then the User Guide chapter. Each is a draft until `npm run ci` is green on
**Node 20** (`.nvmrc`), then ready for review; it merges once CI is green (CLAUDE.md). Branch from `main`;
name `m7/<short-name>`; PR titles in Conventional Commits form. Contract first, then backend, then
frontend against the generated types, then the docs. Each PR ticks its rows in
`docs/handoff/m7-partnerships.md`, adds a line to its log, and updates PROGRESS, the README map and the
guides it names. The PR body carries a **Native app feel** section for any screen change. M7 is built in
parallel with M4 to M6 (TB, 05/11/2026); the demo is Fri 4 Dec (MILESTONES §4).

**Order and lanes:**

```
PR 1 ─┬─ PR 2 ─┬──────────── PR 6 ──┐
      │        │                    │
      └─ PR 3 ─┼─ PR 4              ├─ PR 8 ─ (accepted) ─ PR 9
               ├─ PR 5              │
               └─ PR 7 ─────────────┘
```

PR 1 first and alone. Then PR 2 and PR 3 in parallel. After both: PR 4, PR 5, PR 6 and PR 7 may run in
parallel (PR 7 needs only PR 2's proof points and PR 3's deals; PR 6 needs PR 2's templates). PR 8 last.
PR 9 after the milestone is accepted. Parallel PRs touch different files because PR 1 splits the frontend
into one file per screen.

### PR 1 · Contract, data and scaffolding (`m7/contract-data`) · GE, LA

- **Scope:** the seven contract files and every schema of Appendix C (Workspace, mailbox and public
  additions included); migrations `7010` onward for §4.2; the fix-forward switching off `7099`'s business
  choices and dropping `agreement_obligation` when empty; the reference seed (code lists, both
  capabilities and holders, the `partnership.agreement` flow, numbering); `CAPABILITY_CATALOG` entries;
  the **ratifications**: Partnerships · Categories and Public · Proposal written into MILESTONES §18 (and
  §12's amendments from §13.1), PROGRESS's next two free rows (#104 and #105 while free; M8 may claim one first, in which case PR 1 uses the next and corrects every mention here) and the summary counts, `scripts/check/
  progress.js` `SCREENS`, `src/shared/route-map.js` (tab order Pipeline, Categories, Partners, Leads,
  Proposals, Contracts & MOUs, Analytics), `src/shared/search/screens.js`, the app's catalogue, the public
  site's routes; module skeletons (each module's router mounted on `/partnerships`, empty until its PR,
  and `tests/unit/partnerships-skeleton.test.js` holding every route of the seven to the `partnerships`
  key; the controllers stay empty, so `// ai:none` and `// search:none` are written by the PR that fills
  each, §13.2); the place owners with their renames; `app/src/features/partnerships/` split into one file
  per screen on the mock; Home's `partners.source.js` `TABLES` true to the schema.
- **Docs:** this guide (Change log), DATABASE_SCHEMA M7 (Built and Owes rewritten), MIGRATIONS if a rule
  is touched, README §5.10 and the capability table, `docs/guides/addresses.md` (new place owners),
  `docs/guides/workspace.md` (the three columns, no screen change yet).
- **Tests:** migration up, down, up; schema drift and contract-columns; contract unit tests for the
  discriminated content schemas; Home's source table test.
- **Done when:** gates 3 to 7 green; the app shows the seven tabs as Coming Soon; nothing user-visible
  changes elsewhere.

### PR 2 · Categories, lists, fields, templates and proof points (`m7/categories`) · GE

- **Inputs:** the Deal Merchant Agreement (`docs/MyCity-ERP-Documents/partnership-samples/
  deal-merchant-agreement.md`); MyCity's ticketing template (Regular, VIP, VVIP), uploaded in this PR's
  chat when it arrives and stored redacted beside it. Neither blocks the start.
- **Scope:** `partner_pipeline` categories, lists (stages with meanings), fields, checklists, proof
  points, category templates (on the `templates` module and `template_version`), **Tidy With AI**
  (`template-tidy`, its job confirmed first), Start From Tracker (reading data validations through the
  import engine's reader); the template editor (`DocumentEditor`, a packages/ui component with tables and
  field chips, §13.2); the **Categories** screen (#104) on the real API, desktop and phone; the Events category's
  Deal Merchant Agreement rebuilt as a staging template.
- **Docs:** this guide; `docs/guides/foundation.md` if the template store changes; COMPONENTS.md.
- **Tests:** list rules (meanings kept, last of a meaning), field validation by type, template variable
  refusal, tidy draft not kept until Use Draft, setup from a synthetic workbook.
- **Done when:** Categories is API, UI and Mobile ticked; gates 8, 11, 12, 21 green.

### PR 3 · Leads, partners, deals and the 360s (`m7/leads-partners-deals`) · GE

- **Scope:** `leads`, `partners`, `partner_pipeline` deals (options, members, stage, health, history),
  `interactions` (without mail), contacts, documents tab (vault uploads), duplicates (`shared/dedup`),
  conversion (§6.4), `partners.360`, `leads.360` (zero-data tests), the `StageSwitcher` component; the
  Pipeline (#50), Partners (#51) and Leads (#52) screens with both 360s on the real API, desktop and phone
  (the Work and Returns tabs show their empty states until PRs 4 and 5); Home's `partners.source.js`
  moved to the modules' reads, `OWES` cleared, seed tests updated; the indexes (§4.3, made in PR 1); the
  fix-forward dropping `partner.partner_type`, which PR 1 copied into categories and nothing reads.
- **Docs:** this guide; `docs/guides/home.md` §4.1; COMPONENTS.md.
- **Tests:** scope (all, team, own, members, no owner), money left out without the capability,
  conversion in one transaction and idempotent, stage rules (reasons, signed needs a copy), health needs
  blockers, the 360 for a bare record, Home's cards.
- **Done when:** #50, #51, #52 ticked; the definition of done's "a partnership 360 ... renders correctly
  for a partnership created one minute ago" and "a record moves between stages with history" walk on
  staging.

### PR 4 · The tracker importer and returns (`m7/importers-returns`) · LA

- **Scope:** **Map Values** in `shared/import` (every importer); `partners.import.js`
  (`partnership_tracker`, §6.13, all column rules and date shapes), writing through `leads.createIn` and
  `partners.createIn` with source `import` (§13.2, the audit); `partnership_returns` through
  `partner_pipeline.returns.saveIn` (source `import`, the batch); the 360's Returns tab with Enter Returns
  (money-gated) on the `deal_return` service and routes PR 3 built; the synthetic fixture; exports in the
  tracker's columns, with the Partners and Leads lists' Export (`partnerships.partners`,
  `partnerships.leads`; `partnerships.deals` for the deals).
- **Docs:** this guide; `docs/guides/foundation.md` (imports: Map Values); `docs/manual/settings.md`
  (Imports) with its pictures retaken.
- **Tests:** each column rule on the synthetic workbook (contacts split, regions placed or listed,
  free-text types with commission, off-list stages mapped, owner spellings, the six date shapes, Current
  Stage dropped, Status to health), signed rows to partners, revert until referenced, returns replace a
  month, money refused without the capability.
- **Done when:** the synthetic tracker imports on staging with column map, value map, duplicate report,
  preview and revert (MILESTONES §12's first line).

### PR 5 · Work: projects, tasks, events and deliverables (`m7/workspace-links`) · AJ with GE

- **Scope:** Connect to Partner on New Project, New Task, New Event (and their edits) in My Workspace, the
  Partner filter, the services writing `partner_id`, `lead_id`, `deal_id`; `GET /partnerships/work` with
  hidden counts (A24 kept); the 360's Work tab; delivery checklists raised as tasks on signing
  (`deal_deliverable`, inside the deal's project); signed deals' event days on the team's calendar; the
  `partner-inactivity` follow-up job; Praxis AI's project, task and event cards with the optional
  partner and deal; conversion re-pointing Workspace links.
- **Docs:** this guide; `docs/guides/workspace.md` first; `docs/manual/my-workspace.md` and its pictures
  retaken (`npm run guide:shots -- --stale`); `docs/guides/praxis-ai.md` if the cards' list changes.
- **Tests:** visibility never widened through a partner; hidden counts; deliverables once per signing;
  calendar event moves and cancels; inactivity dedup per spell.
- **Done when:** My Workspace's changed screens pass gates 11 and 12; the inactivity follow-up walks on
  staging.

### PR 6 · Agreements, approval, signing and verification (`m7/agreements-signing`) · GE with LA

- **Scope:** `agreements` (generate from templates, Draft edits, lifecycle, renew, close); the table loop
  in `shared/documents/render.js` if missing; the `partnership.agreement` flow on Settings · Approvals; the
  **signatures service** to §6.9 (built here if M5 has not; shared, agreed with LA): email code,
  drawn and typed signatures, evidence, stamping, the certificate page, the QR seal, dual hashes; the
  public Sign and Verify pages extended (by reference without content, by QR token with it); Record Signed
  Copy; the `agreement-renewals` job and the `agreement_renewal` reminder; Contracts & MOUs (#54) on the
  real API; conversion triggered by signing.
- **Docs:** this guide; MILESTONES §10's signing notes if the service is built here; `docs/manual/
  settings.md` (Approvals) if its pictures change.
- **Tests:** the lifecycle table; approval through the engine (and Applies When); code expiry and tries;
  `content_hash` recomputes; `artifact_hash` over the stored bytes; the two verdicts; verification by
  reference never returns content; a declined signature returns to sent; renewal states by date.
- **Done when:** "An MOU runs its lifecycle to Signed" walks on staging with a drawn signature on a phone.

### PR 7 · The Proposal Studio and design kit (`m7/proposal-studio`) · GE, TB

- **Inputs:** a sample proposal MyCity has sent, uploaded in this PR's chat and stored redacted in
  `docs/MyCity-ERP-Documents/partnership-samples/`; the kit is checked against it before the PR is done.
  MyCity's Anthropic key on Settings · Integrations before the studio is demonstrated. Neither blocks the
  start.
- **Scope:** `proposals` (brief, sources, questions with reshuffle, the writing job, content validation,
  the figure check, edits, rewrites, versions, send with confirmation, the public link and views, accept,
  decline, withdraw, expire, save as template); the AI actions on Top Tier (Sonnet, then Gemini Pro) and
  their prompts; the **design kit** in `templates/proposals/` with every layout, the stand-in city
  photography, charts as SVG, the gallery page and its visual test; `QuestionCard` and `DocumentFrame`
  components; the Proposals screen (#53) and studio on the real API, desktop and phone; the public
  **Proposal** page (#105); `proposal-sent` mail.
- **Docs:** this guide; `docs/guides/ai-control.md` (the actions and their chain); COMPONENTS.md.
- **Tests:** content schema per layout; an unsourced figure rejected then marked; questions limits and
  reshuffles; nothing sent without `confirm: true`; the token stops on decline, expiry, withdrawal; views
  recorded without storing an address; PDF and web from the same HTML; AI off and capped paths.
- **Done when:** "A proposal is AI-generated from a questionnaire, exported as PDF and sent" walks on
  staging, and the sample proposal is one MyCity would send unchanged.

### PR 8 · Analytics, mail, Praxis AI, search and finish (`m7/analytics-finish`) · GE

- **Scope:** `partnership_analytics` (§6.18) and the Analytics screen (#55); mail binding
  (`mailbox/binding/`, Link to Partner, the excerpt rule); every `*.ai.js` read, summary and card of §9
  with `not_offered` reasons (gate 23, `ai-forms-gaps.json` shrinks); every `*.search.js` and ⌘K action
  (gate 10); `*.views.js` and notification types; the staging seed (`seeds/staging/70_partnerships.js`,
  synthetic, calling `removeHomeStagingRows`); the INTERIM types deleted; empty M7 stubs filled or deleted
  (README §11.5); the definition of done walked (Appendix B).
- **Docs:** this guide (Status Built); `docs/guides/mailbox.md` and `docs/manual/mailbox.md` (pictures
  retaken); `docs/guides/home.md`; PROGRESS (#50 to #55, #104, #105 and the counts); README map.
- **Tests:** analytics measures on a fixed dataset; the rating hidden where Performance hides it; mail
  excerpt only; Praxis AI reads respect scope and money; search coverage.
- **Done when:** `npm run ci` green on Node 20; every M7 screen Built; Appendix B's demo walks end to end on
  staging.

### PR 9 · The Partnerships User Guide chapter (`m7/user-guide`) · after acceptance

- `docs/manual/partnerships.md` with front matter, a section per screen, steps naming buttons in bold
  exactly as the screen reads them, `needs` on every step needing a grant, pictures on desktop and phone
  (`npm run guide:shots`); the Quick Start card for lead owners. The gate passes without a trailer.

## Appendix B · Done, demo and handover

**MILESTONES §12's definition of done, and where each line is met:**

| Line | Met by |
|---|---|
| The tracker's real data imports through the generic importer with a column map, a validation pass, a duplicate report and a reversible preview | PR 4 (the real file on staging, by a person; the synthetic one in tests) |
| A partnership 360 shows contacts, conversation history, stage, owner, expected close, documents and next action, and renders for one created a minute ago | PR 3 |
| A record moves between stages with history | PR 3 |
| A proposal is AI-generated from a questionnaire, exported as PDF and sent | PR 7 |
| An MOU runs its lifecycle to Signed using M5's signature | PR 6 |
| A mail thread binds to a partnership and appears in its history | PR 8 |
| An inactive partnership raises a follow-up | PR 5 |

**The demo walk (Fri 4 Dec, staging):**

1. Categories · Start From Tracker on the tracker; then Settings · Imports · Partnership Tracker: column
   map, Map Values (stages, owners, types), duplicate report, preview, import; revert; import again.
2. Open a partner made a minute ago: zeros and empty tabs, not a broken page.
3. New Lead with its first deal (options, event dates, venue); move it through stages; set it Stalled with
   blockers; log a call.
4. Connect a project and a task to it from its 360; see them on its Work tab.
5. New Proposal: paste notes, upload a transcript, answer and reshuffle cards, Write Draft, edit a section
   and its layout, Send Proposal confirming the address; open the link on a phone; Viewed on the deal.
6. Generate Agreement from the Events template; Submit for Approval; approve as Head of Department and
   CEO; Send for Signature; sign on a phone with the code and a drawn signature; scan the QR; see the two
   verdicts.
7. The lead is now a partner; its deliverables are tasks; the event is on the team's calendar.
8. Enter a month's returns; see Returns This Year; ask Praxis AI "who is our highest contributing
   partner".
9. Link a mail thread; see it in the history.
10. Date a staging partner back past 30 days; see Home's alert and the follow-up task.
11. Analytics for this quarter: a lead owner's row against the records behind it.

**Handover:** the User Guide chapter (PR 9); a recorded walk-through video, as M2 and M3 had (5 November);
MyCity's Anthropic key on Settings · Integrations; the first proof points entered by MyCity; the real
tracker imported on production by MyCity, never seeded.

## Appendix C · Contract catalogue

Schemas by file, with their main fields. Every create schema has its list, detail and update
counterparts; every list query has `page` and `q` only from `common.js`, never a size.

- **`partner_pipeline.js`**
  - `CategoryCreate` { `name`, `description?`, `default_commission_pct?`, `default_validity_days?`, `counts_as_vendor?` }; `CategoryUpdate` (all optional, `active?`); `CategoryDetail` (with `templates`, `checklist`, `fields`, `counts`)
  - `CategoryTemplateCreate` { `template_key?` (made from the category and the label), `kind`, `label`, `title?`, `body_html` (the wording), `asks?`, `is_default?`, `countersigned?` }; `TemplateAsk` { `key`, `label`, `type`, `options?`, `default?` }; `CategoryTemplateDetail` (the template with its wording and the record fields); `TemplateWordingSave` { `title?`, `body_html`, `asks?` }; `TemplateTidyDraft` { `available`, `reason`, `body_html`, `fields[]`, `ai_run_id` }
  - `ChecklistItemCreate` { `title`, `description?`, `due_from`, `due_days`, `position?` }
  - `FieldCreate` { `label`, `field_type`, `options?`, `applies_to`, `partner_category_id?`, `filterable?` }
  - `ListValueCreate` { `label`, `meaning?` (stages), `position?` }; `ListValueUpdate` { `label?`, `meaning?`, `position?`, `active?` }
  - `TrackerSetup` { `document_id` } → `TrackerSetupDraft` { `stages[]` with suggested meanings, `categories[]`, `impact[]` }; `TrackerSetupApply`
  - `DealCreate` { `lead_id` or `partner_id`, `title`, `event_title?`, `event_starts_on?`, `event_ends_on?`, `venue?: PlaceInput`, `expected_attendance?`, `objective?`, `stage?`, `estimated_value?`, `commission_pct?`, `validity?` ({ `days`: 30 or 60 } or { `until` }; the category's default when left out), `expected_close_on?`, `next_action?`, `next_action_on?`, `owner_id`, `member_ids?`, `options?: DealOptionInput[]` (at most 5), `impact?`, `impact_rating?`, `impact_note?`, `comments?`, `custom?` }
  - `DealOptionInput` { `position`, `label`, `original_price?`, `discount_pct?`, `deal_price?`, `price_note?`, `commission_amount?`, `merchant_take?` }
  - `StageMove` { `stage`, `reason?`, `signed_copy_document_id?` }; `HealthSet` { `health`, `blockers?` }
  - `ReturnSave` { `units_sold?`, `gross_sales?`, `mycity_commission?`, `paid_to_partner?`, `downloads?`, `note?` }
  - `PipelineQuery`, `DealListQuery` (filters of §5), `PipelineSummary`, `DealPage`, `DealDetail`, `ReturnPage`
- **`leads.js`**: `LeadCreate` { `name`, `partner_category_id`, `region` ({ `scope`, `cities?: PlaceInput[]` }), `industry?`, `website?`, `objective?`, `source?`, `owner_id`, `identified_on?`, `impact?`, `impact_rating?`, `impact_note?`, `comments?`, `custom?`, `contact` (`ContactInput`), `deal` (the deal fields without `lead_id`) }; `LeadUpdate`; `LeadLose` { `reason` }; `LeadConvert` { `signed_copy_document_id?` }; `LeadListQuery`; `LeadsSummary`; `Lead360`; `LeadConverted` { `partner_id` }
- **`partners.js`**: `PartnerCreate` (as `LeadCreate`, with `legal_name?`, `headquarters?: PlaceInput`, `logo_document_id?`, and a first deal at a signed or active stage with `signed_copy_document_id?` or `signed_before_hub: true`); `PartnerUpdate`; `PartnerClose` { `reason` }; `ContactInput` { `first_name`, `last_name`, `job_title?`, `email?`, `phones?`, `signatory?` }; `ContactCreate`; `ContactUpdate`; `DuplicateQuery`; `Duplicates`; `PartnerListQuery`; `PartnersSummary` (with `quiet_days`); `Partner360` { `partner`, `kpis` { `signed_value`, `returns_this_year?`, `downloads_this_year`, `active_deals`, `days_since_contact` }, `deals`, `contacts`, `overview`, `deliverables`, `custom_fields`, `history` (`RecordHistoryLine`: a stage or health line with its deal) }; `PartnerDocumentQuery`; `PartnerDocumentAttach` { `document_id`, `kind`, `deal_id?` }; `PartnerWorkQuery`; `PartnerWorkPage` (with `hidden` counts)
- **`interactions.js`**: `InteractionCreate` { `partner_id` or `lead_id`, `deal_id?`, `contact_id?`, `interaction_type`, `occurred_at`, `subject`, `summary` }; `InteractionListQuery`; `InteractionPage`; mailbox's `ThreadPartnerBind` { `partner_id` or `lead_id`, `deal_id?` } and `ThreadContext`
- **`proposals.js`**: `ProposalStart` { `deal_id`, `notes?`, `transcript_document_id?`, `assets?: BriefAsset[]` ({ `document_id`, `role` (`cover`, `gallery`, `logo`, `section`), `alt` }, at most 12), `design_template_id?` }; `ProposalQuestion`; `QuestionAnswer` { `answer` }; `ProposalContent` { `sections`: `Section[]` } with `Section` a discriminated union on `layout` (one schema per layout of §6.11) carrying `key`, `hidden`, the layout's fields and `sources: FigureSource[]` { `figure`, `source` (`brief`, `answer`, `record`, `proof_point`), `ref` }; `ProposalContentEdit`; `SectionRewrite` { `instruction` }; `ProposalSend` { `to` (1 to 5 emails), `cc?` (up to 5), `subject`, `message`, `confirm: true` }; `ProposalDecline` { `reason` }; `ProposalTemplateSave` { `name` }; `ProofPointCreate`; `ProposalListQuery`; `ProposalsSummary`; `ProposalDetail` (with `progress: ProposalProgress`, `link_url`, `ai`, `versions`, `can`); `ProposalPreview` { `html`, `sections` with the layouts each may take }; `ProposalMessageDraft` { `subject`, `message` }; `ProposalChart` { `kind` (`bar`, `hbar`, `stacked`, `line`, `area`, `donut`, `progress`), `series`, `sources` } on `opportunity`, `why_mycity`, `audience`, `packages`, `proof` and `insight`; `IllustrationName` (the kit's 24 drawings); `PublicProposal` { `title`, `partner_name`, `html`, `owner_contact`, `valid_until` }; `ProposalSentEmailVars` (the `proposal-sent` mail)
- **`agreements.js`**: `AgreementGenerate` { `deal_id`, `template_key?`, `asks?` }; `AgreementUpdate` { `body?`, `fields?`, `starts_on?`, `ends_on?`, `renewal_notice_days?` }; `AgreementSend` { `signers`: [{ `contact_id?`, `name`, `title?`, `email`, `side` (`partner`, `mycity`) }], `message?`, `confirm: true` }; `SignedCopyRecord` { `document_id`, `signed_on`, `signed_by_name`, `signed_by_title?` }; `AgreementRenew` { `starts_on`, `ends_on?`, `new_deal?` }; `AgreementClose` { `reason` }; `AgreementListQuery`; `AgreementsSummary`; `AgreementDetail` (its `approval` carries `can_decide`); `RenewalPage`; the signing contract (M5): `SignCodeVerify` { `code` }, `SignSubmit` { `full_name`, `title?`, `method` (`draw`, `type`), `signature_png?` (a PNG data URL), `typed?`, `consent: true` }; `VerifyResult` { `status`, `signers`, `verdicts` { `content`, `artifact` }, `document?` }
- **`partnership_analytics.js`**: `AnalyticsQuery` { `period` (`month`, `quarter`, `year`, `custom`), `from?`, `to?`, `partner_category_id?` }; `PartnershipAnalytics` { `kpis`, `by_owner` (the eight measures), `signed_per_month`, `returns_per_month?`, `by_category`, `by_region`, `stage_conversion` }
- **Workspace** (`projects.js`, `tasks.js`, `calendar.js`): create and update schemas gain `partner_id?`, `lead_id?`, `deal_id?`; list queries gain `partner_id?`. Declared once in PR 1 as `partners.js` `PartnerLink` (a partner or a lead, not both; a deal only with one) and `PartnerLinkQuery`; PR 5 spreads them into `ProjectCreate`, `ProjectEditFields`, `TaskCreate`, `TaskEditFields`, `CalendarEventCreate`, `CalendarEventEditFields` and the three list queries, with the services that write them

## Appendix D · File map

- **Backend** (`src/modules/`; template files `routes · controller · service · repo · events · ai ·
  search · test` in each, beyond them):
  - `partners/`: `.360`, `.dedup`, `.import` (the tracker), `.convert` (the conversion transaction),
    `.documents`, `.work`, `.views`
  - `leads/`: `.360`, `.views` (PR 8); a lead's status from its stage is `partner_pipeline.lists`'
    `leadStatusOf`, kept in step by `leads.service` `syncStatus` (PR 3)
  - `partner_pipeline/`: `.categories`, `.lists`, `.fields`, `.checklists`, deals in the template
    `.service` and `.repo` (PR 3), `.options`,
    `.stages`, `.health`, `.returns`, `.returns.import`, `.deliverables`, `.setup` (Start From Tracker),
    `.inactivity`, `.views`
  - `interactions/`: `.mail` (with `mailbox/binding/`)
  - `proposals/`: `.studio`, `.questions`, `.draft` (the jobs), `.content` (validation and the figure
    check), `.kit` (rendering), `.charts` (the charts as SVG), `.send`, `.public` with `.public.routes`,
    `.proof`; saved templates sit in `.service`, and the PDF is the document engine's (no `.templates`
    or `.pdf`; PR 7)
  - `agreements/`: `.generate`, `.tidy`, `.lifecycle`, `.approval`, `.signing` (calls `signatures`),
    `.renewals`, `.views`
  - `templates/` (M3's, shared): `.agreements` (the wording of a category's templates: its fields, chips and
    checks; PR 2)
  - `partnership_analytics/`: `.queries`, `.ai` (the summaries), no repo and no `.search` (figures, not
    records; PR 8)
  - `signatures/` (shared with M5): `.service`, `.code` (the email code), `.stamp`, `.certificate`,
    `.signed-pdf`, `.verify`, `.public.routes`
  - `mailbox/binding/`: `intake.service`, `mail-context.service`, `context-tabs`, `convert.service`
- **Jobs** (`src/jobs/`): handlers `proposal-questions`, `proposal-draft`, `partner-inactivity`,
  `agreement-renewal`; schedulers `partner-inactivity`, `agreement-renewals`, and `proposal-expiry` until
  `agreement-renewals` takes it (PR 7), each in `SCHEDULERS`.
- **Shared:** `shared/import` (Map Values), `shared/documents/render.js` (table loop if missing),
  `shared/workflow/definitions.js` (`partnership.agreement`), `shared/numbering/schemes.js`.
- **Templates:** `templates/documents/` (`proposal.html` as the kit's entry; an agreement's wording is its
  category template's, built in the hub, §6.8; `signature-certificate.html` is M5's);
  `templates/proposals/` (layouts, `kit.css` from tokens, assets); `templates/email/`
  (`proposal-sent.html`, `agreement-sign.html`; the sealed copy and the code are the signatures
  service's `signature-completed.html` and `signature-code.html`).
- **Prompts** (`src/services/ai/prompts/`): `proposal-questions.md`, `proposal-draft.md`,
  `proposal-rewrite.md`, `proposal-message.md`, `template-tidy.md`; `mou-draft.md` is deleted (MOUs are
  templates, not drafts).
- **Contract:** `packages/contract/schemas/` as Appendix C.
- **Frontend** (`app/src/features/partnerships/`): `index.tsx` (routing only), `Pipeline.tsx`,
  `Categories.tsx`, `Partners.tsx`, `Partner360.tsx`, `Leads.tsx`, `Lead360.tsx`, `Proposals.tsx`,
  `studio/` (`Brief.tsx`, `Questions.tsx`, `Draft.tsx`, `Edit.tsx`, `Send.tsx`), `Contracts.tsx`,
  `Analytics.tsx`, `forms/` (lead, partner, deal, contact, interaction, returns, category, field,
  checklist, template editor); Workspace's forms in `app/src/features/workspace/`.
- **Public** (`public-app/src/pages/`): `Proposal.tsx` (new), `SignOffer.tsx` and `Verify.tsx`
  (extended).
- **packages/ui:** `StageSwitcher`, `QuestionCard`, `DocumentFrame`, `DocumentEditor` (PR 2).
- **Seeds:** `seeds/reference/7190_seed_partnerships.sql` (code lists, capabilities, the flow, numbering,
  `7099`'s choices switched off); `seeds/staging/70_partnerships.js` (synthetic).
- **Migrations:** `7010` to `7060`, `7080`, `7100`, `7101`, `7110`, `7120` (a linked mail's sender,
  recipients and thread on its interaction, PR 8).
- **Mailbox** (`app/src/features/mailbox/PartnerContext.tsx`, PR 8): Link to Partner and the linked line.
- **Tests:** `tests/integration/partnerships-*.test.js` per module (PR 8: `-analytics`, `-mail`,
  `-notices`, `-staging-records`); `tests/unit/` for the importer's
  parsers, the content schema and the figure check; `tests/fixtures/partnership-tracker.synthetic.xlsx`.

---

## 14 · Change log

- 13/11/2026 · TB · Contracts and MoUs in the chat planned (`praxis-ai.md` decisions 41 to 48, Appendix A PR 2): read, summarised, and filed as Record Signed Copy or Add Partner Document (§9). Nothing built yet.
- 13/11/2026 · AJ · The signing service (§6.9), from M5's click-through: a request that ends unsigned
  (Close, a lapse, a decline) keeps its links, read only, so the signer reads *Agreement Withdrawn*,
  *This Link Has Expired* or *Agreement Declined* instead of *This Link Does Not Open*; the page shows
  nothing of the agreement then (no blocks, no PDF) and takes nothing. Send Again still stops every
  earlier link (`stopLinksFor`). For TB to review.

- 10/11/2026 · TB · The approver's buttons (§6.9, §10.1, §13.2): `approval.can_decide`, Approve and Reject on the
  agreement's card, the demo's approval and its Write Draft steps.
- 10/11/2026 · TB · PR 9, the Partnerships User Guide chapter (`m7/user-guide`): `docs/manual/partnerships.md` with a
  section for each of the seven screens, four Quick Start cards for lead owners and the partner's pages on the public Help
  (Your Proposal, Sign an Agreement, Check an agreement). Appendix A's PR 9 is done; nothing in this guide changed.

- 08/11/2026 · JP · PR 8, analytics, mail, Praxis AI, search and finish (`m7/analytics-finish`): Analytics
  (#55) on the contract, desktop and phone, with Export (§6.18); Link to Partner and a linked thread's
  mail on the record's Activity with the excerpt rule, migration `7120` (§6.15); the summaries
  `partnerships.summary` and `partnership_returns.summary`, the read `proposals.list` and the card
  `proposals.start` (§9); proposals in ⌘K (§9); who is told and where it waits (§7); Home's Proposals Out
  with its views; the synthetic staging seed `70_partnerships.js`, Home's M7 rows handed over (§6.17);
  the approval context's rate (§6.9); the INTERIM types and the empty stubs gone; Status Built. What it
  decided is in §13.2, In PR 8.
- 08/11/2026 · TB · PR 6, agreements, approval, signing and verification (`m7/agreements-signing`): the agreements
  module (generate, Draft, Submit through `partnership.agreement`, Send for Signature, Send Again, Record Signed
  Copy, Renew, Close), signing converting a lead, the seal filed with the partner's documents, the
  `agreement-renewals` job and reminder, Contracts & MOUs (#54) on the real API, and the public Sign and Verify
  pages for agreements; migrations `7100` and `7101`. What it decided is in §13.2, In PR 6.
- 08/11/2026 · JP · PR 7, the Proposal Studio and design kit (`m7/proposal-studio`, #94): `proposals` on the
  contract (brief, questions with reshuffle, the writing job and its progress, the figure check, edits,
  rewrites, versions, send with confirmation, the public link and its views, accept, decline, withdraw,
  expire, save as template); the four AI actions and their prompts (§9); the design kit at 16:9 with
  charts, the `insight` layout and the kit's 24 drawings (§6.11; TB, 07/11/2026); `QuestionCard` and
  `DocumentFrame`; Proposals (#53) and the public Proposal page (#105), desktop and phone; migration `7110`.
  Recorded in §13.2 (In PR 7): the `draw` hook and `bare` PDF, Download PDF as an export, the encrypted link
  token, 30 days' validity and `proposal-expiry`, v2 withdrawing v1, Skip refused on a required card, Build
  by Hand, words edited in a panel, views without notifications until PR 8, `.md` attachments,
  `ProposalStart.assets`, tone notes in the brief. Appendix C and D to match. MyCity's sample proposal has
  not arrived, so the kit is not yet checked against it (Appendix A PR 7).
- 07/11/2026 · AJ · PR 5, work for a partner (`m7/workspace-links`): Connect to Partner on New Project, New Task, New
  Event and their edits, with Disconnect, checked by `partners.work`; the Partner filter on Tasks and Projects; `GET
  /work` with hidden counts, the Work tab in its own file (`WorkTab.tsx`) and the Overview's Next Events; deliverables on
  `deal.signed` and the deal's event days on its team's calendar, moved and called off with the deal; the
  `partner-inactivity` follow-up (`partner_follow_up`, migration `7080`); Praxis AI's Workspace cards with the
  optional partner and deal; conversion moving Workspace links (`relinkIn`). Recorded in §13.2, In PR 5.
- 07/11/2026 · LA · PR 4, the tracker importer and returns (`m7/importers-returns`): Map Values on the import
  engine; the Partnership Tracker importer on the synthetic workbook through `leads.createIn` and
  `partners.createIn` (source `import`), reversible until a record is in use; the Partnership Returns
  importer through `partner_pipeline.returns.saveIn`; the 360's Returns tab with Enter Returns; Export on
  Partners and Leads in the tracker's columns. What it decided is in §13.2, In PR 4.

- 06/11/2026 · TB · The audit of PRs 1 to 3 before PR 4 (§13.2, the audit): a deal is seen through its
  lead's or partner's owner too, and the 360s list and count only the deals the reader sees (§6.1, §6.2);
  the duplicate check recorded as the one read outside scope; Categories' counts and its partners and
  leads within scope (§6.3); a deal's owner kept in scope; a reopened lead's lost reason cleared and a
  conversion copies no legal name (§6.4); the Partner 360's stage and health history, Partners' Quiet days
  (§6.12); the forms' Deal Options, Commission, Validity, Team, Impact and custom fields, and the lists'
  filters and Owner column, built to §10.1; PR 4's service hooks and its Export (Appendix A PR 4);
  Appendix A PR 2 names `DocumentEditor`; Appendix C's `Partner360` and `PartnersSummary`.
- 06/11/2026 · JP · PR 3 merged with `main` after PR 2 (#80) and M4's follow-ups (#79): PR 2's files serve categories, lists and
  fields, and the deals read through them (one value checker, `checkValue`); `partner_document` is migration
  `7060`, PR 2's `7050` being the template's asks; PR 3's cards replace the interim reasons PR 2 gave
  `DealCreate`, `DealUpdate` and `ReturnSave`; on the mock, Categories' data is the one source of the
  categories and lists, and its demonstration stage Follow-Up Ongoing is in Title Case (§13.2, In PR 3).
- 06/11/2026 · JP · PR 3, leads, partners, deals and the 360s: `leads`, `partners` and `partner_pipeline`'s
  deals (options, team, stage moves with history, health and blockers) on the contract, with
  `interactions` (without mail), contacts, the Documents tab on the vault, duplicates, conversion in one
  transaction (`partners.convert`), `partners.360` and `leads.360`; the `StageSwitcher` component; the
  Pipeline (#50), Partners (#51) and Leads (#52) screens with both 360s on the real API, desktop and
  phone, their forms and the mock (Work and Returns show their empty states until PRs 5 and 4); the
  reads and cards of §9 PR 3 names; partners, leads and deals in search with New Lead and New Partner;
  Home's `partners.source.js` on the modules' reads, `OWES` empty (home.md §4.1); migration `7060`.
  Corrected here, each recorded in §13.2: a record's documents are `partner_document` (§4.1, §4.2, §6.4)
  and `7060` drops `partner.partner_type`; the read routes of PR 2's lane (`GET /categories`, `GET
  /fields`, `GET /lists/:list`) built here while PR 2 was open; the `deal_return` service and its two routes came
  ahead of PR 4; the stage rules (leaving On Hold, moves after signing, the signed copy asked once, §6.5)
  and New Partner's first stage (§6.6); Partners' Quiet `N` (§6.12); Follow-Up Required written in Title
  Case on screen; Home's Signed Value counts deals, one row a deal (§6.17); the file map (Appendix D).
- 06/11/2026 · AJ · The signing and verification shapes (`SignTokenParams`, `SignCodeVerify`,
  `SignaturePng`, `SignSubmit`, `VerifyRefParams`, `VerifyResult`) moved from `agreements.js` to
  `signatures.js` (GE on #79: M5 builds the shared service first, LA reviews), with `SignDecline`,
  `SignerView` and `VerifyByToken` added. `VerifyResult` now names the document type and carries
  `record_status` for an agreement's own state. `docs/guides/offers.md`.
- 06/11/2026 · GE · (Ose) Public · Proposal's placeholder page moves to the public site's split layout with the rest of
  go.mycityapp.io (the approved design); its Coming Soon is unchanged. Verify Document's QR page,
  `/verify/t/<token>` (§6.9), is drawn on the mock: the record, both verdicts and the document with Download PDF, until
  M5's verify API.
- 06/11/2026 · TB · PR 2 reviewed (#80): `main` merged in (M4 and M8); New Partner Category in ⌘K and the
  phone's floating button (§9, §10.2, §13.2); a category's sections behind a segmented control on a phone
  (§10.2, §13.2); Tidy With AI's answer recorded (§13.2); Move Up and Move Down on Pipeline Settings renumber
  the list, so a value never lands two places over; Appendix D names `DocumentEditor`.
- 06/11/2026 · JP · PR 2, Categories (`m7/categories`): categories, MyCity's lists, custom fields, delivery
  checklists, agreement templates built in the hub (`DocumentEditor`), Tidy With AI, Start From Tracker, proof
  points and the Categories screen (#104) built to this guide. Corrected here: a template's asks have a column
  (§4.2, migration `7050`), the record fields a template may name (§6.8), the template and proof point routes
  (§5), `template-tidy`'s job (§9) and what PR 2 decided (§13.2, §13.3), and Appendix C and D to match.
- 05/11/2026 · JP · PR 1, contract, data and scaffolding: the seven contract files with Appendix C's
  schemas (the kit's twelve layouts one discriminated union; the mailbox's thread link in
  `interactions.js`; the Workspace link as `PartnerLink`); migrations `7010` to `7040` and seed `7190`
  as §4 has them; the capabilities, the `partnership.agreement` flow and the numbering; Categories and
  Public · Proposal ratified (MILESTONES §12 and §18, PROGRESS #104 and #105); the routers mounted, the
  place owners registered, the mock split one file a screen, Home's partners source on the new schema.
  Corrected here: the region's owners (§4.2, §6.19), `partner_type`'s drop in PR 3, validity optional,
  the skeleton's controllers (Appendix A), the Workspace link (Appendix C), each recorded in §13.2.
- 05/11/2026 · JP · Before merging: prefixes settled (§13.1 item 27); the redacted Deal Merchant
  Agreement added to `docs/MyCity-ERP-Documents/partnership-samples/`; which PR needs which MyCity sample
  (§13.3, Appendix A PR 2 and PR 7); My Workspace's PROGRESS rows corrected (#4, #5, #6, #101);
  `ExportAction`'s home corrected (§10.3); a department with no head (§11); no partner named from
  MyCity's documents; `main` merged (M8's partner payee noted in §13.3; the new rows are the next free
  ones).
- 05/11/2026 · JP · Made standalone as M7's only source of truth: §0 (how to use it, the words), table
  columns (§4.2), the full API, components (§10.3), the build plan (Appendix A), definition of done and
  demo (Appendix B), the contract catalogue (Appendix C) and the file map (Appendix D). The handoff only
  ticks and logs.
- 05/11/2026 · JP · Rewritten from the Partnerships Workflow Discovery meeting of 5 November, MyCity's
  tracker read column by column (contacts masked), the Deal Merchant Agreement, and JBS Praxis's answers
  (§13.1): leads and partners joined by deals; the Categories tab; no board; health and blockers; the
  360s; Connect to Partner; options, returns and downloads; agreements filled, approved through Settings ·
  Approvals, signed with a code and a drawn or typed signature, sealed and verified by QR; the Proposal
  Studio and its design kit on Claude; a public proposal page; Analytics' eight measures.
- 04/11/2026 · JP · First draft from the documents alone (replaced).
