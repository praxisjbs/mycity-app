# M7 Partnerships, CRM & Trackers · Build Handoff

**Start here if you are continuing this work.** This file is self-contained: what MyCity asked for and
where, the decisions that are binding and the ones still to confirm, how the build is cut into pull
requests, the checklist with its status, the calendar, and a dated log. The design itself is
`docs/guides/partnerships.md`; this file is the build plan and its log. It was written on 04/11/2026,
before any M7 code, as PR 0.

| | |
|---|---|
| Branches | One a pull request, each from `main`: `m7/guide-and-handoff` (PR 0), `m7/contract-data` (1), `m7/partners-pipeline` (2), `m7/leads-interactions` (3), `m7/proposals-agreements` (4), `m7/analytics-finish` (5), `m7/user-guide` (6) |
| Pull requests | None yet |
| Owner | GE (Godwin-Okoh Elisha); LA (Love Adeola) the tracker importer |
| Type | Full stack (CLAUDE.md step 1) |
| Window | Mon 30 Nov to Fri 4 Dec 2026. Demo Fri 4 Dec |
| Started | 04/11/2026 (PR 0) |

---

## 0 · How to continue

1. `git fetch origin main` and branch from it as the table above says. A merged pull request is
   finished; follow-up work restarts from `main`.
2. Read this file in full, then `docs/guides/partnerships.md` in full, then what CLAUDE.md step 2 asks
   for full-stack work: `docs/PROGRESS.md` (Partnerships, rows #50 to #55), `docs/guides/home.md` §4.1
   and §6 (what Home reads), `docs/guides/mailbox.md` (PR 3 changes it), `docs/guides/addresses.md`
   §6.9, `docs/guides/praxis-ai.md` decision 33, `docs/guides/ai-control.md` §6.2, the M7 section of
   `MILESTONES.md` (§12) and `REUSE_MAP.md` §8, `docs/BACKEND_GUIDE.md`, `docs/FRONTEND_GUIDE.md`,
   `docs/FRONTEND_FOUNDATION.md`, `docs/COMPONENTS.md`, `docs/MIGRATIONS.md`.
3. Confirm §2.2 with GE and LA first. Nothing in PR 1 starts before D1 to D3 are answered: they shape
   the migration. Record each answer there with its date and move the line up into the guide.
4. Take the first unticked step in §4. Build it, run its checks, tick it here with the date, add a line
   to §6, commit and push. **Contract first**, then the backend, then the frontend against the
   generated types, then the guide.
5. Never re-open §2.1. Run `npm run ci` on Node 20 (`.nvmrc`; it refuses another major) before a pull
   request leaves draft. A draft runs no CI on GitHub.

---

## 1 · What was asked

MyCity's partnerships live in one Google Sheets workbook, the Partnerships Pipeline Tracker, kept by
marketing and sales. The asks, in the order they were made:

1. **2 September 2026, discovery call.** Cynthia Osakunih (Operations and People Lead): a tracker for
   the partnership pipeline, "every single partnership whether ongoing or closed", and MOUs, contracts
   and proposals that can be sent or downloaded as a PDF. Tom-Blake Asaah showed a CRM pipeline and
   automated proposals. Cynthia asked whether the other Excel trackers could follow.
2. **8 October, planning call.** A Partnership 360 for relationships, proposals, MOUs and contracts,
   AI generated. The tracker to be migrated; "if you look at milestone 7 that's what it is literally
   on".
3. **10 October, requirements review.** Cynthia shared the workbook on screen. Two sheets in one
   book: the pipeline (partner name, industry, contact person, position, contact details, region,
   partnership objective, partnership type, current stage, potential impact, lead owner, date
   identified, next action, expected close date, status, comments) and the monthly performance of each
   marketing lead (prospects, meetings, proposals, signed, active, downloads). Tom-Blake Asaah:
   a configuration UI to add partnership types, an analytics page, manual lead capture (new,
   contacted, qualified, converted, lost) because marketing officers enter leads after their
   conversations, an Excel importer with mapping, validation and preview, and export back out.
   Cynthia: bring the tracker's owners in when M7 starts. Marketing and sales own it.
4. **21 October, Milestone 1 sign-off.** Home's partnership cards and pipeline are empty "because those
   features are part of milestone 7"; Partnerships reads "pending milestone 7".

Binding scope: `MILESTONES.md` §12, A14, A21 and A26; the screen inventory §18 (six Partnerships
tabs, 102 screens, no new tab without ratifying it).

---

## 2 · Decisions

### 2.1 Binding (from the documents; do not ask again)

1. **Six tabs**, fixed: Pipeline, Partners, Leads, Proposals, Contracts & MOUs, Analytics (§18). The
   partner 360 is a view inside Partners and Pipeline, not a seventh tab.
2. **The import engine is built** (M0, A14 as amended 04/11/2026). M7 adds the partnership tracker
   importer on it, in `partners.import.js`, plus the mapping polish. Google Sheets is read as a
   downloaded `.xlsx`; no Google integration; the mapping is chosen at import time because the
   template may change.
3. **Partnership types are configurable (A21)** and the tracker's twelve are the starting set.
   Business choices are not seeded (A26): stages, types and impact are entered or imported.
4. **The partnership analytics page (A21)** counts, per lead owner and month: prospects, meetings
   held, proposals sent, signed, active partnerships and downloads generated.
5. **The decision is a transition, not a column write**: conversion, lost, the agreement's approval.
6. **The 360 renders for a partner created a minute ago** with zero data (acceptance criterion).
7. **The agreement lifecycle** is `Draft → Review → Approval → Sent → Viewed → Signed → Active →
   Expiring → Renewed/Closed`, a workflow definition over the M0 engine, signed through M5's service.
8. **AI generates proposals and MOUs from a short questionnaire**; AI reads and never acts except
   through a declared action a person confirms (A23 as amended); every AI feature names its job and
   the person chooses it (CLAUDE.md).
9. **Addresses are picked, never typed** (F27, gate 22): a partner's headquarters (area) and a
   proposal's cities (city) are `PlaceInput`, saved with `places.save()`.
10. **Pages of 25, server side, everywhere**; one write path through the module's service with `emit()`;
    money through `shared/money`; numbers from `numbering.allocate()`; files through the upload engine
    and the vault.
11. **A record opens in a sheet on a phone** (F31); two shells (gate 11); components only from
    `@mycity/ui`; the mock never ships (F12 to F14).
12. **`7000` is merged and is never edited.** Fix-forwards from `7010`, idempotent, with `-- UP` and
    `-- DOWN`.

### 2.2 Proposed 04/11/2026 (JBS Praxis, from the documents alone; GE and LA to confirm)

| # | Proposed | Needed by | Confirmed |
|---|---|---|---|
| D1 | The twelve stages and twelve types are `reference_value` rows entered on Manage Lists or imported, never seeded. A stage carries a meaning (`prospect`, `contacted`, `meeting`, `proposal`, `negotiation`, `signed`, `active`, `on_hold`) in its `metadata`; the system counts by meaning. Staging loads them from the tracker. `7099`'s business choices are switched off | PR 1 | |
| D2 | The lists are managed from a sheet on Pipeline and Partners (Manage Lists, behind `partnerships.configure`), not a new tab | PR 1 | |
| D3 | "Downloads generated" is a figure per partner per month entered on the 360 by the lead owner (or imported). No attribution feature | PR 1 | |
| D4 | The inactivity follow-up is one Workspace task for the owner per quiet spell, created by the `partner-inactivity` scheduler after Home's sweep | PR 3 | |
| D5 | An agreement is reviewed by the owner's Head of Department, approved by the CEO. A proposal's Viewed, Accepted and Declined are recorded by hand; an MOU's Viewed comes from M5's sign page | PR 4 | |
| D6 | The second sheet (monthly performance) is not imported; Analytics computes from the system going forward | PR 2 | |
| D7 | Bound mail shows the partner's readers an excerpt only (subject, parties, date, 300 characters) | PR 3 | |
| D8 | One scheme a table: `PAR`, `PRO`, `AGR` (both kinds); `mou` retired from `schemes.js`. Prefixes are MyCity's to confirm | PR 1 | |
| D9 | A partner has at most one open partnership (a partial unique index) | PR 1 | |
| D10 | Proposal wording on Default, MOU wording on Top Tier with a written reason. **Asked of the person before PR 4**; recorded in `src/services/ai/actions.js` with `chosen_by` | PR 4 | |

Move a line into §2.1 and the guide's rules when it is confirmed, with the date and who.

---

## 3 · Inputs and dependencies

| Need | From | Needed by | State |
|---|---|---|---|
| The tracker workbook (both sheets) and a redacted copy for tests | Cynthia agreed on 10 October to send it; JBS Praxis holds a copy (passed around by mistake on 13 October, contents unchecked). GE confirms which copy is current and saves it redacted under `tests/fixtures/` | PR 1 and PR 2 | **Not in the repository** |
| The tracker's owners at M7's start (Cynthia, 10 October) | MyCity | 30 November | To book |
| A proposal and an MOU MyCity has sent or signed, for the templates | Cynthia | PR 4 | To ask |
| MyCity's confirmation of the numbering prefixes | The naming email | PR 1 | Open (HANDOFF §5) |
| M5's signature service (`src/modules/signatures/`, empty today) and the `5000` tables | LA, GE (M5, 16 to 20 November) | PR 4 | Tables exist; the service does not |
| The document types and templates `partner_proposal` and `partner_mou`, `templates/documents/proposal.html`, `mou.html`, `templates/email/proposal-sent.html`, `agreement-renewal.html` (all empty) | PR 4 | PR 4 | Empty files |
| `mailbox/binding/` (four empty files from M1) | PR 3 | PR 3 | Empty files |

**If M5 slips** (decided 27 November): build the lifecycle to Sent and add Record Signed Copy (an
upload through the upload engine, vaulted, `signed_at` set by hand) until M5 lands. The definition of
done says an MOU runs to Signed using M5's signature; the fallback is named so nobody is surprised.

---

## 4 · Checklist

Each pull request: contract first, then the backend, then the frontend moved off the mock (the INTERIM
types in `app/src/api/types/partnerships.ts` go with the last screen), then the guide, PROGRESS and
the README map. Draft until `npm run ci` is green locally. Ticks in PROGRESS follow the real API (F14).

### PR 0 · Guide and handoff (this file)

- [x] `docs/guides/partnerships.md` from the template, all fourteen sections, both §10 tables (04/11/2026)
- [x] The guide's row in `docs/guides/README.md` (Written stays ☐ until GE and LA have read it) (04/11/2026)
- [x] This handoff (04/11/2026)
- [x] A14 amended in `MILESTONES.md`, with the note under §12's import engine; `BACKEND_STRUCTURE.md` §9.1
      and `docs/HANDOFF.md` §5 no longer ask for it (04/11/2026)
- [x] A PROGRESS note under Partnerships, no ticks (04/11/2026)
- [ ] GE and LA read the guide; §2.2 and the guide's §13 answered; tick Written in the index
- [ ] The workbook obtained and a redacted fixture saved under `tests/fixtures/` (needs MyCity's file)
- [ ] The tracker's owners booked for 30 November
- [ ] A sample proposal and MOU asked of Cynthia

### PR 1 · Contract and data (GE, LA)

- [ ] `packages/contract/schemas/{partners, partner_pipeline, leads, interactions, proposals, agreements, partnership_analytics}.js`; `PlaceInput` for headquarters and cities; the mailbox contract's thread-partner schema
- [ ] Migrations from `7010`: `lead`; the tracker's columns on `partner` and `partnership_opportunity`; `partnership_impact`; `partner_download_figure`; `partner_mail_thread`; stage history `source`; proposal and agreement columns of guide §4; the partial unique index (D9); Home's four indexes
- [ ] `seeds/reference/` fix-forward: switch off `7099`'s stages and types; keep `interaction_type`; seed `partnerships.configure` and its holders; numbering per D8
- [ ] `CAPABILITY_CATALOG` entry and README's capability table; `src/shared/route-map.js` unchanged (already maps every record type)
- [ ] `DATABASE_SCHEMA.md` M7 **Owes** rewritten to match; gate 6 (schema drift) and the numbering gate green
- [ ] Home's `partners.source.js` `TABLES` true to the migrated schema (its unit test)

### PR 2 · Partners, Pipeline, importer (GE; LA the importer)

- [ ] `partners` (`.360`, `.dedup`, `.import`), `partner_pipeline` (`.stages`, `.types`): repo, service, controller, routes, events; the 360 zero-data test; stage move with history
- [ ] `partners.import.js`: `partnership_tracker` with `extract` for the two sheets, the mapping of guide §6.8, `createMissing: "confirm"`, `isReferenced`, a reversible batch; tested on the redacted fixture
- [ ] Manage Lists (list routes, `partnerships.configure`)
- [ ] Frontend: Pipeline, Partners, the 360, Manage Lists on the real API; hard-coded lists gone; `useInfinite` with `paging` on every partner select; Enter Downloads; Next Action and Expected Close on the 360
- [ ] PROGRESS #50 and #51: API, UI, Mobile
- [ ] The real tracker imported on staging; the duplicate report and a revert walked

### PR 3 · Leads, interactions, mail binding

- [ ] `leads` (`.convert`) and `interactions`; Convert to Partner in one transaction, idempotent; Close as Lost with its database check
- [ ] `partner-inactivity` scheduler and handler (the follow-up task); delete the superseded alert stub notes
- [ ] `docs/guides/mailbox.md` changed first, then `mailbox/binding/` (`intake.service`, `mail-context.service`, `context-tabs`, `convert.service`), the thread context tab and Link to Partner; the excerpt rule of D7
- [ ] `docs/manual/mailbox.md` and its pictures retaken (`npm run guide:shots -- --stale`)
- [ ] Frontend: Leads (no explainer card), Log Interaction against the real API
- [ ] PROGRESS #52

### PR 4 · Proposals and agreements

- [ ] **Ask the person which AI job each draft uses** (D10), then register `proposal-draft` and `mou-draft` in `src/services/ai/actions.js` with `chosen_by`, `personal_data: true`; write the two prompts
- [ ] `proposals` (`.questionnaire`, `.draft`, `.pdf`): numbered on draft, versions, `documents.defineDocType("partner_proposal")` and the template, Send Proposal by mail with the PDF; AI Is Off and AI Limit Reached honoured
- [ ] `agreements` (`.lifecycle`, `.renewals`): `partnership.agreement` added to `DEFAULTS` and validated; M5's signature service called; `agreement-renewals` scheduler (Active, Expiring) and the `agreement_renewal` reminder; obligations
- [ ] Templates written from MyCity's samples: `proposal.html`, `mou.html`, `proposal-sent.html`, `agreement-renewal.html`
- [ ] Frontend: Proposals (paper, the sheet on a phone) and Contracts & MOUs (the lifecycle, the renewal calendar, obligations)
- [ ] PROGRESS #53 and #54

### PR 5 · Analytics and finish

- [ ] `partnership_analytics` (`.queries`): the measures of guide §6.9, within scope; the Analytics screen; Export
- [ ] Home: `partners.source.js` moved to the module's reads, `OWES` cleared, vocabulary of guide §6.11; Home's seed tests updated
- [ ] `seeds/staging/70_partnerships.js` from the tracker's realistic rows, calling `removeHomeStagingRows` for the five tables; forward-rows updated; staging only, never production
- [ ] `partners.ai.js`, `leads.ai.js`, `proposals.ai.js`, `agreements.ai.js`: reads, summary reads and cards; every create and edit form a card or a named `not_offered` reason (gate 23); `scripts/check/ai-forms-gaps.json` only shrinks
- [ ] `*.search.js` for partners, leads, proposals and agreements; `search:none` comments off the route map; the search coverage gate (10)
- [ ] `*.views.js` for the tabs' unread counts; notification types and categories; Settings · Notifications shows Partnerships
- [ ] Delete the empty stubs of this milestone that stayed empty and take them off the README map and the guide (README §11.5)
- [ ] The guide matches what was built: Status Agreed, Last changed, change log
- [ ] PROGRESS #55 and the summary counts; `README.MD` lists every new file
- [ ] Screen gates (5, 8, 11, 12, 21, 22) and `npm run ci` green on Node 20; the PR's **Native app feel** section written
- [ ] The definition of done walked on staging, step by step (§5)

### PR 6 · User Guide (after Friday's acceptance)

- [ ] `docs/manual/partnerships.md` with front matter, sections by screen, `needs` on every step that needs a grant, pictures (`npm run guide:shots`); `User-guide-unchanged` leaves earlier PRs only when true
- [ ] The Quick Start card for lead owners

---

## 5 · The demo walk (the definition of done, MILESTONES §12)

1. Import the real tracker: column map, validation, duplicate report, preview, then import.
2. Revert the batch, import it again.
3. Create a partner and open its 360 at once: zeros and empty sections, not a broken page.
4. Move it through stages and read its history. Log an interaction; the quiet clock restarts.
5. Link a mail thread to it; the conversation appears in its history.
6. Enter a lead, qualify it, convert it; lose another with a reason.
7. Draft a proposal from the questionnaire, edit it, download the PDF, send it.
8. Create an MOU from the accepted proposal, review and approve it, send it, sign it as the partner,
   see it Signed, Active, and in the renewal calendar.
9. Let a partner go quiet (a staging partner dated back); see Home's alert and the follow-up task.
10. Open Analytics for the month; compare a lead owner's row with the records behind it.

---

## 6 · Calendar

M7's window is five working days. PRs 0 and 1 land before it. GE is on M5 until 20 November and LA on
M5 and M6 until 27 November, so LA's importer work starts 30 November with the fixture and the field
map ready.

| When | Work |
|---|---|
| Now to 27 Nov | PR 0 read and answered; the workbook obtained; PR 1 (contract and data) merged |
| Mon 30 Nov | PR 2 backend, the 360; LA starts the importer |
| Tue 1 Dec | PR 2 screens; the real tracker imported on staging |
| Wed 2 Dec | PR 3: leads, interactions, mail binding |
| Thu 3 Dec | PR 4: proposals and agreements |
| Fri 4 Dec | PR 5: analytics, Home, search, AI, seeds, gates, `npm run ci`; the demo |
| After the demo | PR 6: the User Guide chapter |

**The cut line, if time runs out, in this order:** Schedule Meeting (not in the plan at all), mail
binding (PR 3), the obligations tracker, Top Tier tuning for the MOU. **Never cut:** the zero-data 360,
the import with its duplicate report and revert, stage history, a proposal drafted, exported and sent,
an MOU run to Signed, the inactivity follow-up.

**Risks.** M5's signing service is not built (§3). The workbook is not in the repository. The mock
carries things that must not be copied: a six-item type list, a fixed industry list, a lead source
list nobody asked for, a Value by Line chart with no table behind it, and two explainer sentences.

---

## 7 · Log

- 04/11/2026 · JP · PR 0 written: `docs/guides/partnerships.md` (Draft), its index row (Written ☐),
  this handoff, the A14 amendment in `MILESTONES.md` with the matching lines in `BACKEND_STRUCTURE.md`
  §9.1 and `docs/HANDOFF.md` §5, and a PROGRESS note under Partnerships. No code, no ticks. Found while
  reading the code: `7000` has no leads table, no partnership-type configuration and none of the
  tracker's region, objective, impact or next action; `7099` seeds business choices A26 forbids and
  numbering is split between `schemes.js` and the seed; every M7 module, contract, template and prompt
  file is empty; the mock's 360 omits Next Action and Expected Close, which the definition of done names.
  Left: everything in §4 after PR 0.
