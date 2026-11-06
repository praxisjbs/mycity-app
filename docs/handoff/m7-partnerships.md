# M7 Partnerships, CRM & Trackers · Build Tracker

**This file only tracks progress.** Everything M7 builds, and how, is in
**`docs/guides/partnerships.md`**, the milestone's single source of truth (its §0). Read the guide in full
before any M7 work; this file adds no requirement and settles no decision. Tick a line when it is done,
with the date, and add a line to §3.

| | |
|---|---|
| Source of truth | `docs/guides/partnerships.md` (Status Agreed, 05/11/2026) |
| Build plan | The guide's Appendix A (PR 1 to PR 9, lanes and order) |
| Owner | GE (Godwin-Okoh Elisha); LA (Love Adeola) the importers; AJ the Workspace links |
| Type | Full stack (CLAUDE.md step 1) |
| Demo | Fri 4 Dec 2026 (MILESTONES §4); built in parallel with M4 to M6 (TB, 05/11/2026) |
| Pull requests | PR 0 (#76, merged); PR 1 (#77, merged); PR 3 `m7/leads-partners-deals` (#83, draft) |

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
- [ ] The person confirms the `template-tidy` job
- [ ] MyCity's ticketing template uploaded in this PR's chat and stored redacted in
      `partnership-samples/` (does not block the start)
- [ ] Backend and Categories screen (#104), desktop and phone; template editor; Start From Tracker
- [ ] Events template from the Deal Merchant Agreement (staging)

### PR 3 · Leads, partners, deals, the 360s
- [x] Backend, conversion, duplicates, `StageSwitcher` (06/11/2026)
- [x] Pipeline (#50), Partners (#51), Leads (#52) and both 360s, desktop and phone (06/11/2026)
- [x] Home's partners source moved; home.md §4.1 (06/11/2026)

### PR 4 · Importers and returns
- [ ] Map Values in `shared/import`; foundation.md
- [ ] Partnership Tracker and Partnership Returns importers; synthetic fixture
- [ ] Returns tab and Enter Returns; settings.md chapter pictures retaken

### PR 5 · Workspace links and deliverables
- [ ] workspace.md first; Connect to Partner on projects, tasks, events; Partner filter
- [ ] Work tab with hidden counts; deliverables on signing; calendar event days; inactivity follow-up
- [ ] Praxis AI cards; my-workspace.md chapter and pictures retaken

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

- 06/11/2026 · JP · PR 3 (`m7/leads-partners-deals`, #83): `leads`, `partners`, `partner_pipeline`'s deals
  and `interactions` (without mail) on the contract, with contacts, documents, duplicates, conversion in
  one transaction and both 360s; `StageSwitcher` in packages/ui; Pipeline (#50), Partners (#51), Leads
  (#52), Partner 360 and Lead 360 on the real API, desktop and phone, with their forms and the mock; Home's
  `partners.source.js` on the modules' reads, `OWES` empty; migration `7050`; `main` (M4, #72) merged in.
  The calls the guide now records (§13.2, In PR 3): a record's documents are `partner_document` (`7050`,
  which also drops `partner.partner_type`); the read routes of PR 2's lane (`GET /categories`, `GET
  /fields`, `GET /lists/:list`) came with PR 3; the `deal_return` service and its two routes came ahead
  of PR 4; leaving On Hold needs no reason, a signed deal moves only among signed meanings, On Hold and
  Closed Lost, and only the first move into a signed meaning asks for the signed copy; New Partner's deal
  starts at the first `signed` stage; Partners' Quiet uses the enabled rule's `N`, 30 while none is
  enabled; Follow-Up Required in Title Case on screen; Home's Signed Value counts deals, one row a deal.
  Left: the Work tab (PR 5) and the Returns tab with Enter Returns (PR 4) show their empty states.
  Next: PR 2 alongside, then PRs 4 to 7.

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
