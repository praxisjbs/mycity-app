# M7 Partnerships, CRM & Trackers · Build Tracker

**This file only tracks progress.** Everything M7 builds, and how, is in
**`docs/guides/partnerships.md`**, the milestone's single source of truth (its §0). Read the guide in full
before any M7 work; this file adds no requirement and settles no decision. Tick a line when it is done,
with the date, and add a line to §3.

| | |
|---|---|
| Source of truth | `docs/guides/partnerships.md` (Status Agreed, 05/11/2026) |
| Build plan | The guide's Appendix A (PR 1 to PR 9, lanes and order) |
| Owner | LA (Love Adeola), M7's owner as CLAUDE.md, the guide and PROGRESS name it; GE (Godwin-Okoh Elisha) builds most PRs, LA the importers, AJ the Workspace links (the guide's Appendix A) |
| Type | Full stack (CLAUDE.md step 1) |
| Demo | Fri 4 Dec 2026 (MILESTONES §4); built in parallel with M4 to M6 (TB, 05/11/2026) |
| Pull requests | PR 0 (#76, merged); PR 1 (#77, merged); PR 2 (#80, merged); PR 3 (#83, merged); the audit of PRs 1 to 3 (`ccr-511a90ef-tw2tud`); PR 5 (`m7/workspace-links`) |

---

## 1 · How to continue

1. Read `docs/guides/partnerships.md` in full, then what CLAUDE.md step 2 lists for your task type and
   the guides your PR names in the guide's Appendix A.
2. Take the next PR whose predecessors are merged (the guide's Appendix A, "Order and lanes"). Branch
   from `main` as it names.
3. Build it to the guide. If the guide is wrong or silent, change the guide first, in the same PR.
4. Run `npm run ci` on Node 20. Tick its lines below with the date, add a log line, mark the PR ready.

## 2 · Checklist

### PR 0 · The guide
- [x] Guide written from the documents (04/11/2026), then rewritten from the 5 November meeting, the
      tracker, the Deal Merchant Agreement and JBS Praxis's answers, standalone as the source of truth
      (05/11/2026)
- [x] MILESTONES A14 amended (04/11/2026)
- [x] Numbering prefixes settled: `PAR`, `LED`, `DEAL`, `PRO`, `AGR` (05/11/2026)
- [x] The Deal Merchant Agreement redacted into `docs/MyCity-ERP-Documents/partnership-samples/`
      (05/11/2026)
- [ ] GE and LA read the guide; tick Written in `docs/guides/README.md`
- [ ] The guide's §13.3 items answered as they come (AI jobs before PR 2 and PR 7; samples in PR 2 and
      PR 7; Anthropic key before PR 7's demo)

### PR 1 · Contract, data and scaffolding
- [x] Contracts (Appendix C), migrations from `7010`, `7099`'s choices switched off, reference seed
      (05/11/2026)
- [x] Capabilities, the `partnership.agreement` flow, numbering (05/11/2026)
- [x] Ratifications applied: Categories and the public Proposal page (MILESTONES §18, PROGRESS #104 and
      #105, `SCREENS`, route map, search screens, catalogue, public routes) (05/11/2026)
- [x] Frontend split into one file per screen; module skeletons (05/11/2026)
- [x] Docs: DATABASE_SCHEMA M7, README §5.10, addresses.md, workspace.md; gates green (05/11/2026)

### PR 2 · Categories, lists, fields, templates, proof points
- [x] The person confirms the `template-tidy` job: Default, JP, 06/11/2026
- [ ] MyCity's ticketing template uploaded in this PR's chat and stored redacted in
      `partnership-samples/` (does not block the start): not yet received; it is entered in the template
      editor and stored redacted beside the agreement when it arrives
- [x] Backend and Categories screen (#104), desktop and phone; template editor; Start From Tracker
      (06/11/2026)
- [x] Events template from the Deal Merchant Agreement (staging) (06/11/2026)

### PR 3 · Leads, partners, deals, the 360s
- [x] Backend, conversion, duplicates, `StageSwitcher` (06/11/2026)
- [x] Pipeline (#50), Partners (#51), Leads (#52) and both 360s, desktop and phone (06/11/2026)
- [x] Home's partners source moved; home.md §4.1 (06/11/2026)
- [x] Audit of PRs 1 to 3 against the guide, TB's four calls applied (the guide's §13.2, the audit) (06/11/2026)

### PR 4 · Importers and returns
- [x] Map Values in `shared/import`; foundation.md (07/11/2026)
- [x] Partnership Tracker and Partnership Returns importers, through `leads.createIn`, `partners.createIn`
      and `partner_pipeline.returns.saveIn` with source `import` (ready since the audit); synthetic fixture
      (07/11/2026)
- [x] Returns tab and Enter Returns on PR 3's service and routes; settings.md chapter pictures retaken
      (07/11/2026)
- [x] Export on Partners and Leads in the tracker's columns (`partnerships.partners`, `partnerships.leads`,
      `partnerships.deals`) (07/11/2026)

### PR 5 · Workspace links and deliverables
- [x] workspace.md first; Connect to Partner on projects, tasks, events; Partner filter (07/11/2026)
- [x] Work tab with hidden counts; deliverables on signing; calendar event days; inactivity follow-up
      (07/11/2026)
- [x] Praxis AI cards; my-workspace.md chapter and pictures retaken (07/11/2026)

### PR 6 · Agreements, approval, signing, verification
- [ ] Generate, lifecycle, renewals; the approval flow on Settings · Approvals
- [ ] The shared signatures service to §6.9 (agreed with LA); Sign and Verify pages
- [ ] Contracts & MOUs (#54)

### PR 7 · Proposal Studio and design kit
- [ ] The person confirms the `proposal-message` job
- [ ] MyCity's sample proposal uploaded in this PR's chat and stored redacted in `partnership-samples/`;
      the kit checked against it (does not block the start)
- [ ] Studio, AI actions (Top Tier, Sonnet then Gemini Pro), the figure check, the kit and its gallery
- [ ] Proposals (#53) and the public Proposal page (#105)

### PR 8 · Analytics, mail, Praxis AI, search, finish
- [ ] Analytics (#55); mail binding; manifests, cards and search; views and notifications
- [ ] Staging seed; INTERIM types deleted; empty stubs filled or deleted
- [ ] PROGRESS rows and counts; the demo walked (Appendix B)

### PR 9 · User Guide chapter (after acceptance)
- [ ] `docs/manual/partnerships.md` with pictures; the Quick Start card

## 3 · Log

- 07/11/2026 · AJ · PR 5 (`m7/workspace-links`): Connect to Partner on New Project, New Task and New Event and their
  edits (Partner, leads marked, Deal, Disconnect), checked by `partners.work`; the Partner filter on Tasks and
  Projects; `partner_link` named only for readers who see the record; `GET /work` with hidden counts, the 360s' Work
  tab (`WorkTab.tsx`) and Next Events; deliverables and the deal's event days as outbox handlers on `deal.signed`,
  moved with the deal's dates and called off when it is lost; the `partner-inactivity` follow-up once a quiet spell
  (`partner_follow_up`, migration `7080`); Praxis AI's Workspace cards with Partner, Lead and Deal; conversion moving
  Workspace links (`relinkIn`); workspace.md, my-workspace.md (pictures retaken) and praxis-ai.md. TB answered: New
  Partner's Signed Before the Hub raises no deliverables, its event days still go on the calendar (the guide's §13.2,
  In PR 5). Tests: eleven integration tests, two screen tests. Next: PR 6 and PR 7, then PR 8.
- 07/11/2026 · LA · PR 4 (`m7/importers-returns`): Map Values on the import engine (`GET` and `PUT
  /imports/:id/values`, kept on the mapping and its profile); `partnership_tracker` (`partners.import.js`) on
  `tests/fixtures/partnership-tracker.synthetic.xlsx`, every column rule of §6.13, signed rows to partners and
  the rest to leads through the services with source `import` (a signed row's `deal.signed` carries it, for PR
  5 to skip), revert until referenced; `partnership_returns` (`partner_pipeline.returns.import.js`) with
  `partnerships.money`; the Partner 360's Returns tab with Enter Returns; Export on Partners and Leads
  (`POST /partnerships/exports`) in the tracker's columns, reading back through the importer. The calls are in
  the guide's §13.2, In PR 4. Tests: ten integration, ten unit, two screen. Left: the real tracker is imported
  on staging by a person (Appendix B); PRs 5 to 7 run beside this one.
- 07/11/2026 · TB · PR 6 (`m7/agreements-signing`) started, draft, unfinished. TB's calls: the one
  signatures service is AJ's from #85, brought in unchanged (credited) and improved here, landing on
  `main` through PR 6; AJ's migration `5020` carried byte for byte (gate 3 needs a named exception);
  our schema from `7100`; Sign and Verify wired here for every document. Done: the import (AJ's 73
  tests pass on `main`), `RichTextBlock` tables, `render.js` block values (clauses, grid, stamped
  signature) and `fillMarkdown`, `SigningView.blocks`, `SignerStatus` with `void`. Next: the PR's
  handover prompt.
- 06/11/2026 · TB · Audit of PRs 1 to 3 against the guide before PR 4, with TB's four calls (the guide's
  §13.2, the audit; §14). Who sees a deal: its owner's scope, its team, or its lead's or partner's
  owner's, one rule everywhere, so the 360s list and count only the deals the reader sees; New Deal and
  Edit Deal keep the owner in scope; the duplicate check stays outside scope (numbers and names only);
  Categories' counts follow scope and the picked category lists its partners and leads (PR 2's review
  note, done). Fixed: a reopened lost lead kept its lost reason; a signed deal's validity changed lost its
  date; an earlier stage on a signed deal asked why before refusing; a refusal's toast said "Check the
  highlighted fields" over nothing. Built to §10.1 where PR 3 left it out: Deal Options, Commission,
  Validity and Team on New Deal and Edit Deal; Impact and the custom fields behind Advanced on every form;
  the Partners and Leads lists' filters (Stage, Category, Region, Owner, Health, filterable custom fields)
  with Owner and Region columns, Pipeline's Owner; the Partner 360's stage and health history
  (`Partner360.history`), help on Dormant and on a stage, Signed Before the Hub on Documents, Days Since
  Last Contact; Partners' Quiet help names its days (`PartnersSummary.quiet_days`). For PR 4: the
  in-transaction `leads.createIn`, `partners.createIn` and `partner_pipeline.returns.saveIn` take source
  `import` (and the batch), the deal's history line and its events carry `source`, and a new lead's deal
  takes the lead's identified date; Export is PR 4's. Home reads `lead.owner_id` (home.md). Tests: six
  integration tests and two screen tests. Next: PR 4 to PR 7.
- 06/11/2026 · JP · PR 3 (`m7/leads-partners-deals`, #83): `leads`, `partners`, `partner_pipeline`'s deals
  and `interactions` (without mail) on the contract, with contacts, documents, duplicates, conversion in
  one transaction and both 360s; `StageSwitcher` in packages/ui; Pipeline (#50), Partners (#51), Leads
  (#52), Partner 360 and Lead 360 on the real API, desktop and phone, with their forms and the mock; Home's
  `partners.source.js` on the modules' reads, `OWES` empty; migration `7060`; `main` merged in (M4 #72, then
  PR 2 #80).
  The calls the guide now records (§13.2, In PR 3): a record's documents are `partner_document` (`7060`,
  which also drops `partner.partner_type`); the read routes of PR 2's lane (`GET /categories`, `GET
  /fields`, `GET /lists/:list`) were built here while PR 2 was open, and PR 2's serve them now; the `deal_return` service and its two routes came ahead
  of PR 4; leaving On Hold needs no reason, a signed deal moves only among signed meanings, On Hold and
  Closed Lost, and only the first move into a signed meaning asks for the signed copy; New Partner's deal
  starts at the first `signed` stage; Partners' Quiet uses the enabled rule's `N`, 30 while none is
  enabled; Follow-Up Required in Title Case on screen; Home's Signed Value counts deals, one row a deal.
  Merged after PR 2: PR 2's files serve categories, lists and fields, and the deals read through them (one
  value checker); PR 3's cards replace the interim reasons PR 2 gave `DealCreate`, `DealUpdate` and
  `ReturnSave`; the mock's categories and lists come from Categories' data alone. Left: the Work tab (PR 5)
  and the Returns tab with Enter Returns (PR 4) show their empty states; PR 2's review note that
  Categories' picked category shows its partners and leads as counts only (guide §2 lists them) is not
  done here. Next: PRs 4 to 7.

- 06/11/2026 · TB · PR 2 reviewed (#80) against Appendix A and merged: `main` merged in (M4 #72 and M8 #75; M7's
  PROGRESS rows carry LA as owner, as #72 set them); the AI Control test reads the registry's second page (26
  actions, 25 a page); New Partner Category in ⌘K and the phone's floating button, and Expenses' New Expense
  Category, since ⌘K holds a label once (a note for AJ in `m8-expenses.md`); the phone's category sheet keeps
  its segmented control; Pipeline Settings' Move Up and Move Down renumber the list, so a value never lands two
  places over; the guide's §9, §10.2, §13.2 and Appendix D to match. For PR 3: Categories' picked category
  shows its partners and leads as counts only (§2 lists them), and on a phone an edit opened from Pipeline
  Settings or Proof Points replaces that sheet. Next: PR 3, then PR 4 to PR 7.
- 06/11/2026 · JP · PR 2 (`m7/categories`): Categories (#104) on the real API, desktop and phone. Backend:
  categories, MyCity's lists with the rules that keep the pipeline whole, custom fields checked by type, the
  delivery checklist, agreement templates on `template_version` (`templates.agreements`), Tidy With AI
  (`template-tidy`, Default), Start From Tracker (`readDropdowns`), proof points with images; migration `7050`
  (a template's asks); the Events category's Deal Merchant Agreement, checklist and a demonstration set on
  staging. Screen: `DocumentEditor` (a new `packages/ui` component), the list beside the record, Pipeline
  Settings, Proof Points, and on a phone a sheet with the sections one at a time. Calls the guide now records
  (§13.2): asks get a column; the wording's routes sit with the category; a proof point's image is an upload,
  so `ProofPointCreate` lost `document_id`; the record fields a template may name were completed; `DealCreate`,
  `DealUpdate` and `ReturnSave` carry `design:` reasons until PR 8 declares their cards. Left: MyCity's ticketing
  template (not received), then PR 3 and PR 6.
- 05/11/2026 · JP · PR 1 (`m7/contract-data`): the seven contract files (Appendix C), migrations `7010` to
  `7040`, seed `7190`, the capabilities, the flow and the numbering; Categories (#104) and Public ·
  Proposal (#105) ratified; the routers mounted on `/partnerships`, the place owners registered, the mock
  split one file a screen, Home's partners source on the new schema; DATABASE_SCHEMA, README §5.10,
  addresses.md, workspace.md, home.md and foundation.md. Five calls the guide now records (§13.2): the
  controllers stay empty until their PRs (gate 23 rule 6), `PartnerLink` joins the Workspace forms in PR 5,
  `partner_type` is dropped in PR 3 (MIGRATIONS §8), the region's owners are `lead.cities` and
  `partner.cities` (gate 22), a deal's validity is optional. Next: PR 2 and PR 3, in parallel; PR 2 asks
  the person to confirm `template-tidy`'s job first.
- 05/11/2026 · JP · Before merging PR 0: prefixes settled ("use any prefixes"); the Deal Merchant
  Agreement redacted into `partnership-samples/` with each placeholder's field; the ticketing template
  placed on PR 2 and the sample proposal on PR 7, uploaded in those PRs' chats; `main` merged in.
- 05/11/2026 · JP · The guide rewritten from the Partnerships Workflow Discovery meeting of 5 November
  (Edidiong Etudor), MyCity's tracker (102 rows, 79 named, read column by column with contacts masked),
  the House of Hevix Deal Merchant Agreement and JBS Praxis's 26 answers, and made the single source of
  truth. This file reduced to the checklist and the log; the decisions that were proposed here on
  04/11/2026 are superseded by the guide's §13.
- 04/11/2026 · JP · PR 0 first written from the documents alone.
