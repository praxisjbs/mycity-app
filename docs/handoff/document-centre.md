# Document Centre · Build Tracker

**This file only tracks progress.** Everything the Document Centre builds, and how, is in
**`docs/guides/document-centre.md`**, its single source of truth. Read the guide in full before any
work on it; this file adds no requirement and settles no decision. Tick a line when it is done, with
the date, and add a line to §3.

| | |
|---|---|
| Source of truth | `docs/guides/document-centre.md` (Status Agreed, 16/11/2026) |
| Build plan | The guide's Appendix A (PR 0 to PR 2) |
| Owner | TB (Tom-Blake Asaah) |
| Type | Full stack (CLAUDE.md step 1) |
| Branches | PR 1 `m10/document-centre-library`, PR 2 `m10/document-centre-company` (a cloud session uses the branch it was given) |
| Pull requests | PR 0 (the plan) praxisjbs/mycity-app#163; PR 1 praxisjbs/mycity-app#164; PR 2 adds its number here |

---

## 1 · How to continue

1. Read `docs/guides/document-centre.md` in full, then what CLAUDE.md step 2 lists for a full-stack
   task. Its §1.1 decisions (D1 to D13) are TB's and are never re-opened.
2. Take the next PR whose predecessor is merged (PR 0, then PR 1, then PR 2; never in parallel).
   Branch from `main`.
3. Build it to the guide. If the guide is wrong or silent, change the guide first, in the same PR,
   with a Change log line.
4. Run `npm run ci` on Node 20. Tick the PR's lines below with the date and add a log line.
5. Open the PR, mark it ready for review, drive GitHub's CI to green and merge it (TB, 16/11/2026).
   Then ask the planning chat for the next start prompt, or take it from the guide's Appendix A.

**In one paragraph.** Every file the ERP keeps is already a row of the vault's `document` table. The
Document Centre is a new rail module (key `documents`) whose Library lists the business documents a
reader could already open from their own modules, with four KPI cards, filters, search, a preview and
a download, found from ⌘K too (PR 1). PR 2 adds the company's own documents in categories with an
audience, tags, versions, expiry reminders, a letterhead as PDF and Word, search inside files and
Praxis AI's read.

**Things every session needs:**

- The one rule that must never break: the library lists nothing `vault.canRead` would refuse
  (guide §6.3). `tests/integration/library-access.test.js` proves it both ways for every system role.
- Integration tests need PostgreSQL 16 with pgvector and Redis; the cloud session's start hook runs them.
- A new module key changes the hard-coded counts in `tests/integration/settings.test.js`; a new
  screen changes `SCREENS` in `scripts/check/progress.js` and the screen count and `LABEL_TO_MODULE`
  in `tests/unit/foundation/events-workflow.test.js`; a new module needs `SECTIONS` in
  `packages/contract/plan.js`, or its screen reads Coming Soon forever.
- `npm run new:screen` cannot create a module: Library is registered by hand (guide, PR 1); once
  `documents` is in the script's `SECTION` map it adds Categories.
- Migration numbers are M10's, free from 10500 on 16/11/2026: take the next free one if that has gone.

## 2 · Checklist

### PR 0 · The plan

- [x] 16/11/2026 · The guide, its row in `docs/guides/README.md`, its CODEOWNERS line
- [x] 16/11/2026 · MILESTONES §18: ratified, applied by PR 1 and PR 2
- [x] 16/11/2026 · This tracker

### PR 1 · The library over what exists

- [x] 16/11/2026 · Contract `library.js`; `SECTIONS` in `plan.js`
- [x] 16/11/2026 · The `documents` key, its grants (`10590`), README §5.2, the settings test's counts
- [x] 16/11/2026 · `10500`: the two indexes on `document`
- [x] 16/11/2026 · The registry `shared/documents/library.js`: sources, the default rule as SQL, `NOT_IN_LIBRARY`
- [x] 16/11/2026 · The `<module>.library.js` sources of the guide's §6.2: 15 sources in 13 modules, 17 document types
- [x] 16/11/2026 · `src/modules/library/`: list, summary, one document, filters
- [x] 16/11/2026 · `library-access.test.js`, both directions, the seven system roles, the CEO and three made-up roles
- [x] 16/11/2026 · ⌘K: `library.search.js`, `library_item`, the screen's entry; the empty `documents.search.js` deleted
- [x] 16/11/2026 · Document Centre · Library on both shells, on the contract; the mock
- [x] 16/11/2026 · PROGRESS section and row #113, the counts; MILESTONES §18's table; the guides of the modules touched
- [x] 16/11/2026 · The User Guide chapter and its pictures
- [x] 16/11/2026 · `npm run ci` green; PR opened, ready, green on GitHub, merged (praxisjbs/mycity-app#164)

### PR 2 · Company documents and the extras

- [x] 17/11/2026 · Contract: company documents, categories, tags, the letterhead; the list's new filters
- [x] 17/11/2026 · `10510`, `10520`, `10591`; `documents.manage`
- [x] 17/11/2026 · Company documents: upload, edit, versions, archive, the audience rule and its proof
- [x] 17/11/2026 · Document Centre · Categories (row #114)
- [x] 17/11/2026 · The files' text: the job, the sweep, search inside files
- [x] 17/11/2026 · The letterhead as PDF and Word
- [x] 17/11/2026 · Expiry: the reminder, the notice, Home's alert subject
- [x] 17/11/2026 · Praxis AI: read, summary, routes, actions; the catalogue snapshot
- [x] 17/11/2026 · Staging's seed; the mock's writes
- [x] 17/11/2026 · PROGRESS, MILESTONES, the guides, the User Guide chapter and its pictures
- [ ] `npm run ci` green; PR opened, ready, green on GitHub, merged

## 3 · Log

- 17/11/2026 · TB · PR 2 built in a fresh chat from its start prompt: company documents in categories with an audience (`10510`, `documents.manage` in `10591`), Upload Document from a staged file, Edit Details, Upload New Version, Archive and Restore; Document Centre · Categories (#114); the files' text (`10520`, the `document-text` job and its nightly sweep) and search inside files in the Library and ⌘K; the letterhead as PDF and Word; the expiry reminder and Home's alert opening the Library; Praxis AI's read, summary and three cards; staging's seed and the mock's writes. What the build settled beyond the plan, now in the guide: a new version is claimed and followed (`vault.follow`), not superseded, since the library takes a staged file; the read rule lives in `library.access.js`, an archived company document is for keepers alone, and the uploader is `company_document.created_by`; a source may name a row's `number`, `archived` and `area_label` (Company); `GET /categories/:id`; ⌘K's action is Upload Company Document, since Upload Document names other modules' buttons too; the generator's `blank: true`. The proof (`library-access.test.js`) now holds the audience rule for every role. Left: §13's open questions, TB's.

- 16/11/2026 · TB · PR 1 built, in the planning chat as TB asked (the same model and effort): the `documents` key, the registry and its 15 sources, the `library` module, Document Centre · Library (#113) on both shells, ⌘K's Documents group, the chapter and its pictures. What the build settled beyond the plan, now in the guide: a row is a file that can be opened (scanned and drawn, §6.1); a source names its entity types and may give a finer `kind`, a `listed` narrowing and an `expires` date (§6.2); Expiring shows before Signed and an agreement's term counts (§6.6); a search holds every word to the row (§6.7); the filters offer only the types a reader holds (§5). What PR 2 should know: `library.readable()` already takes `{ listed: false }` for the access test; `vault.hasAccess()` exists; `NOT_IN_LIBRARY` must lose nothing when `company_document` joins; the mock's ⌘K does not list documents (the real API does). Left: PR 2.
- 16/11/2026 · TB · Planned in one chat from a study of the vault (63 document types, 25 read rules) and TB's nine answers: the guide with its Appendix A, MILESTONES §18 ratified, this tracker. No code. Left: PR 1, then PR 2.
