# M10 Knowledge Hub (SOPs and Training) · Build Tracker

**This file only tracks progress.** Everything M10's Knowledge Hub builds, and how, is in
**`docs/guides/knowledge.md`**, its single source of truth. Read the guide in full before any work on it;
this file adds no requirement and settles no decision. Tick a line when it is done, with the date, and add a
line to §3.

| | |
|---|---|
| Source of truth | `docs/guides/knowledge.md` (Status Agreed, 11/11/2026) |
| Build plan | The guide's Appendix A (PR 0 to PR 6) |
| Owner | TB (Tom-Blake Asaah) |
| Type | Full stack (CLAUDE.md step 1) |
| Demo | Fri 18 Dec 2026 (MILESTONES §15) |
| Pull requests | PR 0 (this documentation) praxisjbs/mycity-app#112; PR 1 praxisjbs/mycity-app#113; PR 3 praxisjbs/mycity-app#115 |

Praxis AI and AI Control, M10's other half, were brought forward and are built (`praxis-ai.md`,
`ai-control.md`); this tracker is the Knowledge Hub's only.

---

## 1 · How to continue

1. Read `docs/guides/knowledge.md` in full, then what CLAUDE.md step 2 lists for your task type, and
   `docs/guides/policies.md` (the versions, signatures and letterhead PDF this reuses).
2. Take the next PR whose predecessors are merged (the guide's Appendix A). Branch from `main` as it names.
3. Build it to the guide. If the guide is wrong or silent, change the guide first, in the same PR, with a
   Change log line. Never re-open its §1.1.
4. Run `npm run ci` on Node 20. Tick the PR's lines below with the date, add a log line, mark the PR ready.

**In one paragraph.** The Knowledge Hub keeps Policies (built, M1) and the User Guide (built, M0), loses FAQs
and Announcements, and gains department SOPs (structured, versioned, written by the department's head or
`sops.manage`, read by everyone, linked from the screens their steps name) and Training (courses of files,
video links, course links and lessons; assigned with a due date and a task, or open in the Library; Mark
Done, optional proof, and a MyCity certificate issued on completion with the publisher's signature and a QR
verified on `go.mycityapp.io`). As of 11/11/2026 only a mock exists: every `knowledge` file and the
`knowledge.js` contract are empty, there is no `training` module, and the screens in
`app/src/features/knowledge/index.tsx` run on INTERIM shapes and the browser mock.

**Things every session needs:**

- Integration tests need PostgreSQL 16 with pgvector and Redis; the cloud session's start hook runs them.
- New capabilities and numbering schemes change the hard-coded lists in `tests/integration/settings.test.js`
  and `home-schema.test.js`; a new screen changes `SCREENS` in `scripts/check/progress.js` and the screen
  count in `events-workflow.test.js`.
- `npm run gen:contract` and `npm run gen:ai-catalogue` after any contract change.
- The donors are not in a cloud container; nothing here needs them (guide §12).

## 2 · Checklist

### PR 0 · The guide
- [x] `docs/guides/knowledge.md` written from TB's eight answers and the 4 November Modules Review (11/11/2026)
- [x] The certificate sample drawn (`docs/MyCity-ERP-Documents/training-samples/`, its README, an INDEX row) (11/11/2026)
- [x] MILESTONES §15 and §18 amended; PROGRESS: #64 FAQs Dropped, #110 ESS · My Training added, a note (11/11/2026)
- [x] FAQs removed from the code (tab, mock, INTERIM types, route map, ⌘K, Coming Soon, record type, category,
      catalogue description); My Training added with `npm run new:screen` as an empty screen (11/11/2026)
- [x] Guides index row, the guide's CODEOWNERS line, DATABASE_SCHEMA M10 pointer (11/11/2026)
- [ ] TB shows MyCity the certificate sample and records the answers (guide §13 item 4)
- [ ] Written ticked for `knowledge.md` in `docs/guides/README.md` once PR 0 merges

### PR 1 · Contract, data and scaffolding
- [x] `knowledge.js` and `training.js` contracts, `gen:contract` (11/11/2026)
- [x] Migrations `10400`, `10410`; seed `10490` (capabilities, numbering schemes) (11/11/2026)
- [x] `sops.manage`, `training.manage` in `access.catalog.js`; the schemes in `schemes.js`, Settings' labels and the contract's document types (11/11/2026)
- [x] The `training` module folder and CODEOWNERS line; record types `sop`, `training_course`, `training_enrolment` (11/11/2026)
- [x] DATABASE_SCHEMA M10 as built (11/11/2026)
- [x] `npm run ci` green; the PR marked ready (#113, merged 11/11/2026)

### PR 2 · SOPs
- [ ] Backend: repo, service (the writer rule, §6.2), controller, routes, events, search, AI reads, `sop-draft`
- [ ] `for-screen` and the Procedures list in the User Guide's help
- [ ] The SOPs tab on the contract, desktop and phone, its mock in the contract's shapes
- [ ] Tests; PROGRESS #63

### PR 3 · Training backend
- [x] Courses, items, publish with signature, assignments, enrolments, tasks, progress, proof, completion (11/11/2026)
- [x] Reminders, `training-lesson-draft`, search, AI reads (11/11/2026)
- [x] Tests, including 300 people assigned at once (11/11/2026)
- [x] `npm run ci` green; the PR marked ready (#115, 11/11/2026)

### PR 4 · Certificates
- [ ] `training-certificate.html` from the signed-off sample, embedded fonts
- [ ] `training.issue_certificate`, verification on `go.mycityapp.io`; tests rendering real PDFs

### PR 5 · Training screens
- [ ] Knowledge Hub · Training and ESS · My Training on the contract, desktop and phone
- [ ] YouTube player (CSP `frame-src`), viewer, proof; INTERIM types and the old mock deleted
- [ ] Screen gates at 390 and 1440 px; PROGRESS #65, #110; the PR body's Native app feel section

### PR 6 · Staging seed, User Guide, release
- [ ] `seeds/staging/` through the services
- [ ] User Guide: SOPs and Training sections, My Training in the ESS chapter, pictures
- [ ] Empty stubs deleted and off `README.MD`; PROGRESS Status; Appendix B ticked on staging

## 3 · Log

- 11/11/2026 · TB · PR 3 built on PR 1: the `training` module (every `/training` route of the guide's §5 but Download Certificate's two, which PR 4 builds with the PDF), Draft Lesson (`training-lesson-draft`, Default, chosen by TB 11/11/2026), the `training_due` reminder and Remind Overdue, joiners (`training.enrol_joiners`, the `training-joiners` job at 06:00 Lagos) and leavers, ⌘K and four AI reads; `tasks.service.completeForRecord`; migration `10420` (a task may name a `training_enrolment`); the `TRAINING_CERTIFICATE` canonical payload. `tests/integration/training.test.js` (14, 300 people assigned at once among them) and the module's unit tests (26) pass. Found on the way: the guide named `user.roles_changed`, which no module emits (roles change on `access.roles_set`), and closed leavers on `employee.updated`, where `employee.archived` is the leaving; it said a reload would complete someone after an item was removed, now done in the removal's transaction (guide §14). Left for PR 5: the Training tab's `training.manage` rule in both mirrors (`app/src/shell/access.ts`, `src/shared/search/screens.js`) and ⌘K's New Course, with the screen. Next: PR 4 (certificates) and PR 5 (screens).
- 11/11/2026 · TB · PR 1 built on top of PR 0: contracts `knowledge.js` and `training.js`, migrations `10400` and `10410`, seed `10490`, the capabilities, schemes, labels and record types; `tests/integration/knowledge-schema.test.js` (16) passes, and so do `settings.test.js` and `home-schema.test.js` with their lists updated. Found on the way: a `published` SOP version with no number passed its CHECK (NULL > 0 is unknown), fixed before merge; Settings · Documents & Numbering answered 500 for the new types until the contract's `DOC_TYPES` listed them. Next: PR 2 (SOPs) and PR 3 (training) can run in parallel once PR 1 merges.
- 11/11/2026 · TB · PR 0: the guide written from TB's eight answers of 11/11/2026 and the Modules Review of 4
  November (FAQs and Announcements out; SOPs kept as department procedures; Training as a course of items with
  Mark Done, proof and a signed certificate; assignments with due dates and tasks, and a Library; Draft With AI
  and Draft Lesson on the Default job). The certificate sample drawn, one A4 landscape page. MILESTONES §15
  and §18 amended, PROGRESS updated (#64 Dropped, #110 added). In code: FAQs removed everywhere (guide §6.1) and
  ESS · My Training added with `npm run new:screen` as an empty screen. Next: MyCity signs off the sample; PR 1.
