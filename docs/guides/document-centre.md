# Document Centre · Engineering Guide

| | |
|---|---|
| Owner | TB |
| Milestone | M10 |
| Backend modules | `library` |
| Frontend paths | `app/src/features/documents/` |
| Permission key(s) | `documents` |
| Capabilities | `documents.manage` (the Categories tab: categories and who sees each; see, edit, replace and archive every company document) |
| Screens (PROGRESS.md rows) | new: Document Centre · Library and Document Centre · Categories (ratified 16/11/2026; PR 1 registers Library and PR 2 Categories in the next free PROGRESS rows, #113 and #114 while free, and corrects this guide if another change takes a number first) |
| Status | Agreed |
| Last changed | 16/11/2026 |

**This guide is the Document Centre's single source of truth.** It was planned with TB on 16/11/2026
from a study of the vault as built (63 document types, 25 module read rules) and nine answers TB gave
that day (§1.1). The decisions of §1.1 are not re-opened by a build chat; a build chat that finds this
guide wrong or silent changes the guide first, in the same PR, with a Change log line. The build is
two PRs, planned in Appendix A, each built in a fresh chat from its start prompt.

---

## 1 · What it is for

MyCity's documents are kept where they were made: a service agreement on its partner, an offer on its
candidate, a query letter on its employee. To find one a person has to know which record holds it and
walk there. The Document Centre is one place to find any of them: a library with search, filters and
four figures, where a document is previewed and downloaded without visiting its record, and which
⌘K and Praxis AI search too. It is also the home of the company's own papers, which had none: the CAC
certificate, the status report, licences, and a blank letterhead to download as PDF or Word.

Everyone in the company uses it. Nobody sees more than before: the library lists only what the
reader could already open from the document's own module.

**It is a view of the vault, not a second store.** Every file the ERP keeps is already one row of
`document` (M0, `src/shared/documents/vault.js`). The library lists those rows where they are; nothing
is copied or moved, and a document's own module stays its owner and its one write path.

### 1.1 Decisions (TB, 16/11/2026; not re-opened)

| # | Decision |
|---|---|
| D1 | A module of its own on the rail, **Document Centre** (short name Documents), permission key `documents`: the 19th key of the catalogue and the 17th module on the rail. Area Work, after Mailbox. |
| D2 | **Same as today.** The library lists a document only for a reader `vault.canRead` would let open it. The `documents` grant opens the screen; it never opens a file. |
| D3 | **Business documents.** The library holds the types of §6.2: agreements and MOUs, partner documents, proposals, offer letters, employment contracts, query and sanction letters, staff record documents, expense invoices and disbursement receipts, statutory sources and leaving certificates, training certificates, SOP files, and company documents. Chat media, mail attachments, photos, signature drawings, dictations and one-day exports are never listed. |
| D4 | **No payslips.** They stay on Payroll · Payslips and ESS · My Payslips. |
| D5 | **Company documents** are uploaded here: the company's official and administrative papers (CAC, status report, licences, templates), with no other record to belong to. |
| D6 | **Categories with an audience, and tags.** A company document sits in one category MyCity names; each category is seen by Everyone or by named roles. A document also carries free tags. No folders. |
| D7 | **Four KPI cards**: All Documents, Added This Month, Expiring Soon, Signed. Each counts only what the reader may see and opens the list filtered to its documents. |
| D8 | **A blank letterhead** is offered as PDF and as Word, drawn from Settings · Organisation and the brand files at the press, so it is never out of date. It is not an uploaded file. |
| D9 | **Search inside files**: the text of PDF and Word files is kept so a word in an agreement finds it, in the library and in ⌘K. A scanned page has no text and is found by name. |
| D10 | **Expiry reminders**: a company document may carry an expiry date; its uploader and the holders of `documents.manage` are told ahead of it. |
| D11 | **Versions**: Upload New Version replaces a company document and keeps the old file in its history. |
| D12 | **Find with Praxis AI**: the assistant lists documents by the asker's own permissions with a button to open each. A file's contents are never sent to a model. |
| D13 | **Two build PRs** after this plan's documentation PR (Appendix A): PR 1 the library over what exists, PR 2 company documents and the extras. Each is opened ready for review, driven to green and merged by its chat. |

### 1.2 What the study found

- The catalogue holds 18 permission keys, not the 15 its comments say (AI Control, System Health and
  Integrations joined after M0). AI Control is the precedent for a key with its own rail section
  (`seeds/reference/10290_seed_ai_control.sql`, `docs/guides/ai-control.md`).
- `src/modules/documents/` (M0, covered by `foundation.md`) owns the file routes (`/documents/:id`,
  `/content`, `/variant`, `/versions`) and an employee's Vault list, under the `people` key. It is
  left as it is: the library is a new module, `library`, so the two guides do not cover the same code.
  Its empty stub `documents.search.js` is deleted by PR 1 (README §11.5).
- Reading is decided one document at a time: `vault.canRead` applies a module's own rule where one is
  registered (`vault.defineAccess`, 25 of them) and a default rule otherwise. A list paged at 25 on the
  server cannot filter in JavaScript, so each rule the library needs is written once more as SQL
  (§6.3). Three already have a SQL builder that ⌘K uses (`dealSeen`, `recordSeen`,
  `interviews.repo.visible`).
- `document` has no index on `doc_type` or on `(entity_type, entity_id)`; PR 1 adds both.
- Home's `document_expiry` alert (`src/modules/alerts/alerts.metrics.js`) already raises every current
  document with an expiry, under the subject type `document`, whose link opens People · Employees.
  That is right for a staff document and wrong for a company document (§6.9).
- Reading the text of a PDF exists for CVs only (`src/services/media/pdf-text.js`, 10 pages); no code
  reads a Word file's text, and `shared/documents/docx.js` writes body text only (no header, footer or
  picture).

---

## 2 · Screens affected

| Screen / tab (slug) | Where | Who sees it | What it shows | What a person can do there |
|---|---|---|---|---|
| Document Centre · Library (`library`), new | Staff app | `documents` view; each row by the vault's rule (D2) | Four KPI cards, search, filters, the documents beside the picked one with its preview | Search, filter, sort, open a document, View File, Download, Open Record; PR 2: Upload Document, Download Letterhead, Edit Details, Upload New Version, Archive Document, Restore Document |
| Document Centre · Categories (`categories`), new, PR 2 | Staff app | `documents` view and `documents.manage` | The categories beside the picked one: its audience and how many documents it holds | New Category, Edit Category, Archive Category, Restore Category |
| ⌘K | Staff app | Every signed-in person, by the same rule | The Documents group; the screens and actions of §9 | Open a document in the Library |
| Praxis AI · Ask (#67) | Staff app | `praxis_ai` and `documents` view | Documents found for a question, each with a button to open it (PR 2) | Open the document, or the Library filtered |
| Home · Alerts | Staff app | As Home's alert rules say | An expiring company document's alert opens the Library, not People · Employees (PR 2, §6.9) | Open the document |
| Settings · Roles & Permissions (#71) | Staff app | `settings` view | Document Centre as a module row; `documents.manage` among the capabilities | Grant or withdraw them |
| Settings · Notifications (#74) | Staff app | `settings` view | The Document Expiring notice (PR 2) | Change who is told and how |
| Knowledge Hub · User Guide (#102) | Staff app | Readers with `documents` view | The Document Centre chapter (`docs/manual/document-centre.md`) | Follow a step to the screen |

The file routes of the `documents` module and every record screen that shows its own documents
(Partner 360 · Documents, People · Employees · Documents, ESS · My Documents) are unchanged.

## 3 · How the screens relate

1. **A document is stored where it always was.** A module stores or generates a file through the
   vault (`vault.store`, `documents.generate`, `vault.claim`). Nothing tells the library: it reads
   `document` at the moment it is asked.
2. **A person opens Document Centre · Library.** `GET /library/documents/summary` fills the four
   cards and `GET /library/documents` the first page of 25, newest first, both through the one
   readable condition of §6.3.
3. **They search or filter.** Search, the filters and the sort go to the server (FRONTEND_GUIDE §4).
   A KPI card sets the filter behind its number.
4. **They open a row.** The record opens beside the list on a wide desktop and in a full sheet on a
   phone (`ListDetail`, F31), from `GET /library/documents/:id`. Its preview and Download read the
   vault's own routes (`GET /documents/:id/content`, `/variant/:kind`), where `vault.canRead` decides
   once more.
5. **Open Record** goes to the record the document belongs to (`shared/route-map.js`), when the
   reader may open that screen.
6. **⌘K** finds the same documents by the same condition (`library.search.js`) and opens the Library
   on the one picked (`?tab=library&id=<document id>`).
7. **PR 2: Upload Document** stages the file through the upload engine (`POST /documents`), then
   `POST /library/documents` claims it as a company document in one transaction (§6.5).
8. **PR 2: the text is read after the commit.** `document.stored`, `document.claimed` and
   `document.generated` queue `document-text` for a library type; the job writes `document_text`
   (§6.7). A nightly sweep reads what has none.
9. **PR 2: an expiry nears.** The reminder engine raises `company_document.expiring`; the notice and
   Home's alert both open the Library on the document (§6.9).

## 4 · Data

No table of another module changes except two indexes on `document`.

| Table | Key columns | Notes |
|---|---|---|
| `document` (0080, M0) | `doc_type`, `entity_type`, `entity_id`, `subject_employee_id`, `uploaded_by`, `is_current`, `scan_status`, `locked_at`, `expires_on`, `title`, `original_name`, `number` | Read only by the library. PR 1 adds `document_library_idx (doc_type, created_at DESC) WHERE is_current` and `document_entity_idx (entity_type, entity_id)` |
| `document_category`, PR 2 | `document_category_id` uuid PK, `name` citext UNIQUE, `description`, `audience` text CHECK (`everyone`, `roles`), `archived_at`, `created_by`, `created_at`, `updated_at` | MyCity's own list. Never seeded outside staging (A26) |
| `document_category_role`, PR 2 | `document_category_id` FK CASCADE, `role_id` FK CASCADE; PK both | The roles of a `roles` audience. A check in the service: `roles` needs at least one |
| `company_document`, PR 2 | `company_document_id` uuid PK, `number` UNIQUE (`DOC-0001`, the existing `document` scheme), `document_id` UNIQUE FK RESTRICT (the current version), `document_category_id` FK RESTRICT, `title`, `description`, `tags` text[] (GIN), `archived_at`, `archived_by`, `created_by`, `created_at`, `updated_at` | One company document through all its versions. The vault's row names it as its entity (`company_document`), as `partner_document` does. Expiry is the vault's `document.expires_on`, not a second column |
| `document_text`, PR 2 | `document_id` PK FK CASCADE, `status` text CHECK (`done`, `empty`, `failed`), `text`, `pages`, `chars`, `extracted_at`, `created_at`, `updated_at` | The searchable text of one stored file. GIN trigram index on `search_fold(text)`, the pattern of `employee_search_idx` (0300). Only library types are read (§6.7) |

Schema migration file(s): PR 1 `migrations/10500_document_centre.sql` (the two indexes); PR 2
`migrations/10510_company_documents.sql` and `migrations/10520_document_text.sql`. Reference-data
file(s): PR 1 `seeds/reference/10590_seed_document_centre.sql` (the `documents` grants of §8); PR 2
`seeds/reference/10591_seed_document_centre_manage.sql` (the capability and its holders). All are in
M10's block (10000 to 10999), free from 10500 on 16/11/2026; a build chat takes the next free number
if one has gone. Every rule of `docs/MIGRATIONS.md` applies: `-- UP` and `-- DOWN`, idempotent, an
index on every foreign key, `<table>_set_updated_at` triggers, `ON CONFLICT DO NOTHING` on grants.

Contract file: `packages/contract/schemas/library.js`, each schema with its `TABLES` entry.

## 5 · API

The module is `src/modules/library/`, mounted at `/api/v1/library`. Every route needs `documents`
view first; the reader's documents are then narrowed by §6.3, never by the `documents` scope.

**PR 1**

| Method and path | Contract | Permission · scope | Paged | Notes |
|---|---|---|---|---|
| `GET /library/documents` | `LibraryListQuery` → `LibraryPage` | `documents` view · §6.3 | yes, 25 | Filters: `q`, `area`, `type`, `status` (`signed`, `expiring`), `from`, `to` (added on), `added` (`this_month`). Sort: `-created_at` (default), `title`, `expires_on`. PR 2 adds `category_id`, `tag`, `archived` |
| `GET /library/documents/summary` | → `LibrarySummary` | `documents` view · §6.3 | | The four figures over every document the reader may see, not the page |
| `GET /library/documents/:id` | `IdParams` → `LibraryDocument` | `documents` view · §6.3 | | A document id of any version answers its current version. 404 when the reader may not read it, never 403 |
| `GET /library/filters` | → `LibraryFilters` | `documents` view | | The areas and types the reader can reach: a code list from the registry of §6.2, not a list of records |

A file's bytes stay on the vault's routes (`GET /documents/:id/content`, `/variant/:kind`,
`/versions`), unchanged.

**PR 2**

| Method and path | Contract | Permission · scope | Paged | Notes |
|---|---|---|---|---|
| `POST /library/documents` | `CompanyDocumentCreate` (`document_id` of the staged upload, `title`, `document_category_id`, `tags`, `expires_on`, `description`) → `LibraryDocument` | `documents` create | | §6.5. The category must be one the uploader sees |
| `PATCH /library/documents/:id` | `CompanyDocumentUpdate` → `LibraryDocument` | `documents` edit · the uploader, or `documents.manage` | | Company documents only; another module's document answers `DOCUMENT_NOT_YOURS` |
| `POST /library/documents/:id/versions` | `CompanyDocumentVersion` (`document_id` of the staged upload) → `LibraryDocument` | `documents` edit · as above | | `vault.supersede`; the old file is kept |
| `POST /library/documents/:id/archive`, `/restore` | `EmptyBody` → `LibraryDocument` | `documents` delete · as above | | Reversible; nothing is deleted |
| `GET /library/categories` | `CategoryListQuery` → `CategoryPage` | `documents` view | yes, 25 | Only the categories the reader sees; `archived` for `documents.manage` |
| `POST /library/categories`, `PATCH /library/categories/:id`, `POST /library/categories/:id/archive`, `/restore` | `DocumentCategoryCreate`, `DocumentCategoryUpdate`, `EmptyBody` → `DocumentCategory` | `documents` edit, `documents.manage` | | |
| `GET /library/tags` | `TagListQuery` → `TagPage` | `documents` view | yes, 25 | The tags in use on documents the reader sees, for the tag field's suggestions |
| `POST /library/letterhead` | `LetterheadRequest` (`format`: `pdf`, `docx`) → `ExportRef` | `documents` view | | 202, then `GET /exports/:id` as every export (`docs/guides/foundation.md` §6.12) |

Every list is paged at 25 through `shared/http/paged.js`. No route takes a page size.

## 6 · Rules and calculations

### 6.1 What a library row is

One row is one current file: `document.is_current`, `scan_status <> 'infected'`, a type of §6.2, and
readable by §6.3. A superseded version is reached from its document's history, never listed. A staged
upload (`staged_upload`) is never listed. A company document that is archived is listed only with the
Archived filter, for a holder of `documents.manage`.

A source may narrow further to the files its record still holds (`listed`): a regenerated agreement
draft the agreement no longer points at is not a library row.

### 6.2 Library sources

A module declares the documents it gives the library in `src/modules/<module>/<module>.library.js`,
found by name as a search provider is (`shared/documents/library.js` is the registry; no list to
register in):

```js
module.exports = librarySource({
  types: ["partner_document"],            // registered doc types
  area: "partnerships",                   // the module key; its label is the Area filter's
  label: "Partner Document",              // the Type filter's, Title Case
  record: {                               // the record the file belongs to, as SQL over alias d
    type: "CASE WHEN pd.partner_id IS NULL THEN 'lead' ELSE 'partner' END",
    id: "COALESCE(pd.partner_id, pd.lead_id)",
    label: "COALESCE(p.name, l.name)",
    ref: "NULL",
    join: "JOIN partner_document pd ON pd.partner_document_id = d.entity_id::uuid LEFT JOIN ...",
  },
  reach: (client, user) => scopeFor(user, "partnerships", "view"),   // once per request
  readable: (reach, params) => recordSeenSql(reach, params),         // or `default: true`
});
```

- `readable` is a condition over `d` that pushes its own parameters, as a search provider's does.
  `default: true` takes the vault's default rule from the registry (§6.3) and needs no SQL.
- The registry wraps every source's SQL in `CASE WHEN d.doc_type = ANY(<its types>) THEN ... END`, so
  an `entity_id::uuid` cast is never evaluated for another type's row (a brand slot or a hash is not
  a uuid, and a `WHERE` gives no order of evaluation).
- **Every registered doc type is accounted for.** A unit test fails a type that no source lists and
  `NOT_IN_LIBRARY` (in the registry, each with its reason) does not name. A new type must choose.

| Area | Type (doc type) | Belongs to | Rule | PR |
|---|---|---|---|---|
| Partnerships | Agreement (`partnership_agreement`) | The agreement, its number, its partner or lead | `agreement`: `dealSeen` | 1 |
| Partnerships | Partner Document (`partner_document`) | The partner or lead | `partner_document`: `recordSeen` | 1 |
| Partnerships | Proposal (`proposal`) | The proposal, its number, its partner or lead | default | 1 |
| Recruitment | Offer Letter (`offer_letter`) | The offer, its candidate | default | 1 |
| Recruitment | Employment Contract (`employment_contract`) | The employee | default | 1 |
| Queries & Sanctions | Query Letter (`query_letter`), Sanction Letter (`sanction_letter`) | The employee, the query number | default | 1 |
| People | Employee Document (`employee_document`), Identification (`employee_identification`), Certificate (`employee_certificate`), Rent Evidence (`rent_evidence`) | The employee | default | 1 |
| Expenses | Expense Invoice (`expense_invoice`) | The request, its number | default | 1 |
| Expenses | Disbursement Receipt (`disbursement_receipt`) | The disbursement, its number | default | 1 |
| Payroll | Statutory Source (`statutory_source`) | The statutory rate it evidences | default | 1 |
| Payroll | Leaving Certificate (`leaving_certificate`) | The employee | default | 1 |
| Knowledge Hub | Training Certificate (`training_certificate`) | The employee, the course | `training_enrolment`: the employee, or `training.manage` | 1 |
| Knowledge Hub | SOP File (`sop_file`) | The SOP | `sop`: any `knowledge` view | 1 |
| Company | Company Document (`company_document`) | Its category | `company_document`: §6.4 | 2 |

**Not in the library**, each named in `NOT_IN_LIBRARY`: payslips (D4); every export and transient
type (kept a day or a request); chat files and link pictures; mail attachments, signature pictures
and dictations; profile photos; brand files; signature drawings (`signature_image`, `query_signature`,
`policy_signature`, `training_signature`); proposal images, transcripts and proof point pictures;
imported spreadsheets; staged uploads; and, until TB decides otherwise (§13), CVs, assessment answers,
interview forms, review files, scheduled reports, training material and training proof.

### 6.3 Who sees a row (D2)

**The library never lists what `vault.canRead` refuses.** `library.readable(reach, params)` is the OR
of every source the reader can reach, and the list, the summary, the one document, ⌘K and the AI
read all use it; nothing else decides.

- **The default rule in SQL**, for a source with `default: true`, mirrors `canRead` line for line:
  the CEO; `d.subject_employee_id` is the reader; `d.uploaded_by` is the reader; otherwise the `view`
  grant of the type's module, and for a `restricted` row its `edit` grant too, within scope: `all`
  reads every row, `team` the rows whose subject is in the reader's team
  (`grantsCache.getTeamEmployeeIds`), `own` the reader's own. A row with no subject needs `all`.
- **A module's own rule** is that module's `readable`, built from the builder its search already
  uses where one exists.
- `reach` runs once per request per source (scopes, the team, capabilities, role ids) and is bound
  as parameters; no rule runs per row in JavaScript.
- **Proved, not asserted.** `tests/integration/library-access.test.js` stores one document of every
  library type, with and without a subject, normal and restricted, and for every system role and
  scope checks both ways: a listed row passes `vault.canRead`, and a row of a library type that
  passes `canRead` and is `listed` is in the library. The first direction is the security rule; the
  second is completeness. A source whose rule drifts from its `defineAccess` fails here.
- Opening, previewing and downloading still go through `vault.getReadable`, so a file is checked
  again by the vault at the moment it is read.

### 6.4 Company documents: categories and audience (D5, D6)

A company document is read by: the CEO; a holder of `documents.manage`; its uploader; and anyone
with `documents` view when its category's audience is `everyone`, or `roles` and the reader holds
one of them. This is `vault.defineAccess("company_document", ...)` and the same rule as SQL in
`library.library.js`. Narrowing an audience hides its documents at once; nothing is cached.

- A category's name is unique without regard to case. A category in use is archived, never deleted:
  its documents stay, and it is no longer offered on Upload Document.
- Upload Document and Edit Details offer only the categories the person sees.
- Tags: at most 8 a document, each 2 to 30 characters, stored lower case; the field suggests the
  tags already in use (`GET /library/tags`).
- No category or tag is seeded in production (A26); staging's seed adds a demonstration set.

### 6.5 Upload, edit, versions, archive (D5, D11)

- **Upload Document** takes PDF, pictures, Word and Excel files (the upload engine's `document`
  purpose), 25 MB at most. The file is staged (`POST /documents`), then `POST /library/documents`
  runs one transaction in `library.service`: allocate `DOC-` from `numbering.allocate("document")`,
  insert `company_document`, `vault.claim` the staged file as `company_document` with that row as its
  entity, set its title and expiry through the vault, `emit("company_document.uploaded")`.
- The vault gains what the module needs rather than the module writing `document`: a title and
  expiry setter beside `vault.setTitle`. No module updates `document` directly.
- **The same file twice** is refused: a current, unarchived company document with the same
  `content_hash` answers 422 on the file field (`Already in library`).
- **Edit Details** changes title, category, tags, expiry and description.
- **Upload New Version** is `vault.supersede` and re-points `company_document.document_id` in the
  same transaction; the number, category, tags and expiry carry over unless changed. Versions are
  listed from the vault's `GET /documents/:id/versions`.
- **Archive Document** sets `archived_at`; Restore Document clears it. Nothing is deleted, and a
  download of an archived document still works for those who may list it.
- Documents of other modules are read only here. Their writes stay with their owners (one write
  path): a partner's document is uploaded on the partner.

### 6.6 The figures (D7)

| Card | Counts | Opens |
|---|---|---|
| All Documents | Every library row the reader may see | The list, filters cleared |
| Added This Month | Rows whose `created_at` is in the current month, Lagos time | `added=this_month` |
| Expiring Soon | Rows whose `expires_on` is within the Expiring window or has passed | `status=expiring` |
| Signed | Rows with `locked_at`: signed, sent or filed, never replaceable | `status=signed` |

The Expiring window is the one the Vault lists already use (60 days,
`docs/guides/foundation.md` §6.9), read from the same place. A row's status pill is worked out, never
stored: Signed, then Expiring, then none, by that section's order. Archived shows on an archived
company document.

### 6.7 Search (D9)

- `q` is matched folded (`search_fold`), as a prefix and a substring, against the title, the
  original file name, the number, the type's label, the record's label and reference, and in PR 2 the
  tags and the file's text.
- **The file's text** (PR 2): the `document-text` job reads a library type's PDF with
  `services/media/pdf-text.js` (its limits made a parameter: the first 200 pages and 500,000
  characters for the library, 10 pages for a CV as before) and a Word file's `word/document.xml`
  through `jszip`, already a dependency. No new package, and no second extractor.
- Text is read only for library types: a chat file's or a mail attachment's is never kept.
- A match in the text shows the words around it under the row's title (`matched_text`, at most 160
  characters), to a reader the row is listed for and nobody else.
- A scanned page has no text: `status` is `empty`, and the document is found by name. Reading
  pictures of text is not built (§13).
- A nightly `document-text-sweep` reads documents that have no `document_text` row, in batches: the
  backfill of what was stored before PR 2, and the retry of a failed read.
- ⌘K runs the same match inside its two second limit; the trigram index on `document_text` is what
  keeps a search of the text inside it.

### 6.8 The letterhead (D8)

Download Letterhead asks PDF or Word and answers as an export (202, then the file on the device that
pressed). The PDF is `templates/documents/letterhead.html` with an empty body, through
`shared/documents/generate` and the worker's PDF render, so it is the letterhead every generated
letter wears. The Word file is `shared/documents/docx.js` given a header (the logo and the yellow
rule) and a footer (the organisation line): the one Word writer gains header, footer and picture
parts; no second writer is made. Both read Settings · Organisation and the brand files at the press.
The type is `letterhead_export` (`export: true`), kept a day like every export.

### 6.9 Expiry (D10)

- A company document's expiry is `document.expires_on`.
- `company_document.expiring` is raised by the reminder engine (`reminders.defineReminder`, as the
  agreements' renewal reminder is) 60, 30 and 7 days ahead and on the day, once each, to the uploader
  and the holders of `documents.manage`. An archived document raises nothing.
- Home's `document_expiry` alert already covers every document with an expiry. For a company
  document it names the subject `library_item`, so the alert opens the Library; every other
  document keeps `document` and opens where it does today. `docs/guides/home.md` changes with it.

## 7 · Events, jobs and notifications

All under `defineEvents("documents", ...)` in `library.events.js`.

| Event / job | When | Does | PR |
|---|---|---|---|
| `company_document.uploaded`, `.updated`, `.version_added`, `.archived`, `.restored` | After the write commits | Audit; the text job for a new file | 2 |
| `document_category.created`, `.updated`, `.archived`, `.restored` | After the write commits | Audit | 2 |
| `company_document.expiring` | 60, 30, 7 days ahead and on the day | Notification Document Expiring to the uploader and `documents.manage` (Settings · Notifications can change it); opens the Library on the document | 2 |
| Outbox handler on `document.stored`, `document.claimed`, `document.generated` | A library type's file exists | Queues `document-text` | 2 |
| Job `document-text` | Queued | Reads the file's text into `document_text`; idempotent | 2 |
| Scheduler `document-text-sweep` | Nightly | Queues `document-text` for library documents with no text row or a failed one, in batches | 2 |

`documents` joins `MODULE_TO_CATEGORY` in `shared/notifications/categories.js`. Every scheduler is in
`SCHEDULERS` (`src/jobs/registry.js`, the `schedulers` gate). PR 1 emits nothing: it only reads.

## 8 · Permissions and visibility by role

Seeded by `10590` (grants) and `10591` (the capability), `ON CONFLICT DO NOTHING`, so a grant changed
on Roles & Permissions is never written over. The scope is `all` for every role: the `documents`
scope narrows nothing (D2).

| Role | Sees | Can do |
|---|---|---|
| Staff, Line Manager | The Library: their own documents, and whatever their other grants open; company documents of an Everyone category or one their role is named on | View, preview, download, Download Letterhead |
| Head of Department, Management | The same, wider by their other grants | Also Upload Document; edit and replace their own uploads |
| Operations & People, System Administrator | Every company document; other modules' documents by their other grants; the Categories tab | Everything: upload, edit, replace, archive and restore any company document; categories and audiences (`documents.manage`) |
| Implementation Team | As above, until handover | Everything |
| CEO | Every document of the library | Everything (the CEO passes every check) |

`documents.manage` is declared in `CAPABILITY_CATALOG`, seeded to Implementation, System
Administrator and Operations & People, checked on the route after the permission, and mirrored in
the shell and ⌘K (BACKEND_GUIDE §5). Permissions are checked by code, never by a model.

A restricted document (an ID, a bank letter) is listed only for a reader the vault would let open it:
the `edit` grant on its own module, the subject, the uploader or the CEO.

## 9 · AI and search

- **Search** (`library.search.js`, PR 1): one provider, type `library_item`, group **Documents**,
  words `document`, `file`, `doc`. Its id is the document's id; it opens
  `/documents?tab=library&id=<id>`. `reach` and `readable` are §6.3's, so ⌘K lists exactly what the
  Library does. `library_item` joins `ENTITY_ROUTES`; `document` and `document_request` keep their
  routes and their `search:none` markers. PR 2 adds `company_document` (marked `search:none found as
  a library_item`) and a provider for `document_category` (group Document Categories, for
  `documents.manage`).
- **Screens and actions**: Library (words: library, document centre, files, vault, agreement,
  contract, letterhead, CAC) and, in PR 2, Categories; the actions Upload Document (`documents`
  create), Download Letterhead (`documents` view) and New Category (`documents.manage`). The word
  `documents` alone keeps finding ESS · My Documents too.
- **AI reads** (`library.ai.js`, PR 2): `documents.find` (params `LibraryListQuery`, permission
  `documents` view, run `library.service.list`, cite `library_item`), paged at 25, and its summary
  `documents.summary` (the four figures). The read never returns `matched_text`: a file's contents
  are not sent to a model (D12). PR 1 keeps `// ai:none` in the controller with its reason.
- **AI routes**: "open the document centre", "find a document" go to `documents.library`, with `q`
  prefilled where the question names one.
- **AI actions**: gate 23 asks that every Create and Update schema of `library.js` is an action a
  person confirms or is named in `not_offered` with an allowed reason. `CompanyDocumentCreate` and
  `CompanyDocumentVersion` are `file:`; the category forms and Edit Details are declared as actions
  whose `run` is the module's own service function. No new model call is made, so no new AI job is
  named; if a build chat finds one is needed, it asks TB which job first (`ai-control.md` §6.2).

## 10 · On screen and mobile

### 10.1 Content tiers

| Screen | Open (tier 1) | Behind help (tier 2) | Not on screen (tier 3), lives in |
|---|---|---|---|
| Document Centre · Library | The four KPI cards; search; the filters Area, Type, Status, Added and, in PR 2, Category and Tag; the list: Document, Type, Belongs To, Added, Expires, status pill; the record: the preview, Type, Belongs To, Number, Added, Added By, Size, Expires, Version, and View File, Download, Open Record; PR 2: Upload Document, Download Letterhead, Edit Details, Upload New Version, Archive Document, Category, Tags, the words found in the file | A help term on Expiring Soon (the window) and on Signed (a signed document is never replaced); a Details row on the record for the file name and, where a file has no text, that it is found by name | That the library is a view of the vault, how a read rule is applied, why a document is missing for one reader: this guide §6, the User Guide |
| Document Centre · Categories | The categories: Category, Seen By, Documents; the record: name, description, Seen By with its roles; New Category, Edit Category, Archive Category | A help term on Seen By (uploaders and document managers always see their documents) | How audiences are enforced: §6.4 |

Word limits are FRONTEND_GUIDE §5's: the page title is Library, card titles are the four of D7, every
button is Verb Noun. A file's preview is content (`data-copy="content"`).

### 10.2 Phone layout

| Screen | First on a phone | Left off a phone | Main action | Navigation |
|---|---|---|---|---|
| Document Centre · Library | The four KPI cards two to a row, the search, Filter Documents (the filters in a sheet), then document cards: title, type pill, what it belongs to, the date | The subtitle; the Added By, Size and Version columns (they are in the record's sheet) | Download, full width at the foot of the record's full sheet; Upload Document from the screen's New action | Documents in the More tiles; the two tabs scroll sideways; a tapped card opens its sheet and nothing opens before a tap (F31) |
| Document Centre · Categories | Category cards: name, Seen By, the count | The description (in the sheet) | New Category | The second tab |

Desktop is the list beside the record (`ListDetail`, `cols="1/1.5"`, `full`), a table with a sticky
filter row, the preview drawn in the pane (`DocumentPreview` over `useFileBlob`), View File in the
full screen viewer (`useFileViewer`). Model the list on `app/src/features/partnerships/Contracts.tsx`
and `recruitment/TalentPool.tsx`, the record and the upload on `people/EmployeeDocuments.tsx`; do
not copy `ess/Documents.tsx`, which opens its record in a modal (the older pattern). Selects from a
server list load as they scroll (`useInfinite` with `paging`, F32). Tags use `ComboListField`; no tag
input exists and none is added. No folder icon exists; the module's icon is `doc`.

## 11 · Edge cases

- **A document the reader cannot open**: never listed, and `GET /library/documents/:id` is a 404.
- **A link to an old version** (`?id=` of a superseded file) opens the current version.
- **A file removed after the list was read**: the record answers 404; the list refreshes and a toast
  says the document was removed.
- **Not previewable** (Word, Excel): the record shows the file's card with Download; no preview pane
  is faked.
- **A stranger's file still being scanned** is listed (its source decides) but opens nothing until
  the scan is clean, as the vault serves it today; an infected file is never listed.
- **Open Record without the grant** (an employee's own offer letter, in Recruitment): the button is
  not drawn. A document about the reader links to its Self-Service screen where the route map has one.
- **A record with no name** (a draft with no title): Belongs To shows the record's number.
- **No documents at all**: the empty state No Documents Yet, with Upload Document for those who may.
  **A search with no result**: No Documents Found, with Clear Filters.
- **A category archived while a person fills Upload Document**: 422 on Category (`Pick another category`).
- **An audience narrowed while a document is open**: the next read is a 404; nothing was cached.
- **A role deleted**: its `document_category_role` rows go with it (CASCADE); a `roles` category
  left with none is seen by its uploaders and document managers only, and Categories marks it.
- **Double press on Upload Document**: one request (F26); a second claim of the same staged file is
  the vault's own idempotent answer.
- **A very large PDF**: text is read to the limits of §6.7 and the rest is not searched; the record
  says nothing about it.
- **A search of one letter**: answered as typed, like every list; ⌘K's own rules for short terms apply.
- **The in-browser mock**: files never open there (`saveFile` shows a toast), so the mock's rows
  carry a picture fixture for the preview and the screen gates.

## 12 · Donor code

No donor code. The library is built on M0's vault, upload engine, search provider and export
patterns, whose donors are recorded in `docs/guides/foundation.md` §12 and
`docs/BACKEND_STRUCTURE.md`.

## 13 · Open questions

None blocks the build. Each is TB's to decide unless it names another owner.

1. **More sources.** CVs, assessment answers, interview forms, review files, scheduled reports and
   training material are left out (§6.2). Each is one `<module>.library.js` file when wanted.
2. **Policies.** A policy is written on Knowledge Hub · Policies and its PDF is made on demand and
   kept a day, so there is no file to list. Listing published policies as rows is a later change.
3. **Filing a library upload on a partner or an employee.** Not built: those uploads stay on their
   records, whose forms hold fields the library's does not (the kind, the deal).
4. **Scanned pages.** Reading the text of a picture would be an AI feature (the Image Reading job)
   and is not built.
5. **Proposals under team or own scope** (GE). A proposal's PDF follows the vault's default rule, so
   a Partnerships reader whose scope is not `all` sees the proposal on Partnerships · Proposals but
   cannot open its file, and so does not find it here. The library mirrors the vault; the fix, if
   wanted, is a `defineAccess` for `partnership_proposal`, in Partnerships.
6. **Unclaimed staged uploads** (GE). No job removes a `staged_upload` nobody claimed. The library
   never lists one; cleaning them is M0's.
7. **"15 modules" in prose.** `README.MD` §5.2, `access.catalog.js`, `rbac.js`,
   `docs/runbooks/add-a-module.md`, `BACKEND_STRUCTURE.md` and `FRONTEND_GUIDE.md` still say 15 keys.
   PR 1 corrects the ones it touches (the catalogue, README §5.2).

## 14 · Change log

- 16/11/2026 · TB · Written and agreed: the Document Centre, a new module with the `documents` key, planned from the study of the vault and TB's nine answers (§1.1), with the two-PR build plan of Appendix A.

## Appendix A · The build plan (TB, 16/11/2026)

Planned in one chat; each PR is built in a **fresh chat** from its start prompt below, and the
planning chat is asked for the next prompt when one merges (CLAUDE.md, Working conventions). "Most
capable, high" means the most capable model the team has, at high effort; no prompt or plan names a
model by its product name in the repository.

| PR | Scope | Lane, owner | Size | Model and effort | Needs merged first | Runs in parallel with |
|---|---|---|---|---|---|---|
| 0 | This guide, its index row and CODEOWNERS line, the MILESTONES §18 ratification, the build tracker `docs/handoff/document-centre.md` | Docs, TB | S | Most capable, high | nothing | nothing |
| 1 | The `documents` key and its grants; the `library` module read side: the source registry, the readable condition and its proof, the 13 sources of §6.2, list, summary, one document, filters; Document Centre · Library with the four cards, search, filters, the record with preview, View File, Download and Open Record; ⌘K's Documents group; the User Guide chapter | Full stack, TB (each module's source file reviewed by its owner) | L | Most capable, high | PR 0 | nothing |
| 2 | Company documents: categories with audiences, tags, Upload Document, Edit Details, versions, archive; Document Centre · Categories; the letterhead as PDF and Word; the files' text and search inside them; expiry reminders and Home's alert; Praxis AI's read, summary, routes and actions; staging's seed | Full stack, TB | L | Most capable, high | PR 1 | nothing |

**Merge order:** PR 0, PR 1, PR 2. They never run in parallel: PR 2 adds a source, filters and
writes to the registry, the contract file, the screen and the search provider PR 1 creates.

Every PR follows CLAUDE.md steps 1 to 5: the type stated, the reading done, contract first, the
rules never broken, `npm run ci` green on Node 20, `docs/PROGRESS.md` with its rows and a dated note
under Document Centre, this guide and every guide whose module gains a file, the User Guide chapter
with its pictures, `README.MD` matching, and `docs/handoff/document-centre.md` ticked and logged.
Branches are `m10/<short-name>` (a cloud session uses the branch it was given); titles are
Conventional Commits. **Each PR is opened, marked ready for review, driven to green on GitHub's CI
and merged by the chat that built it** (TB, 16/11/2026).

### PR 1 · The library over what exists (`m10/document-centre-library`)

- **Contract first:** `packages/contract/schemas/library.js`: `LibraryListQuery`, `LibraryRow`,
  `LibraryPage`, `LibrarySummary`, `LibraryDocument`, `LibraryFilters`, with `TABLES`;
  `npm run gen:contract`. `SECTIONS` in `packages/contract/plan.js` gains `documents: "Document
  Centre"` (without it the screen reads Coming Soon forever).
- **The key:** `documents` in `MODULE_CATALOG` (area `work`, after `mailbox`; label Document Centre);
  `seeds/reference/10590_seed_document_centre.sql` (§8, modelled on `9290`); README §5.2's count and
  table; `MODULE_TO_CATEGORY`; the counts in `tests/integration/settings.test.js` (catalogue length,
  Operations & People's modules, the Implementation role holding every key).
- **Backend:** `migrations/10500_document_centre.sql`; `src/shared/documents/library.js` (the
  registry, `librarySource`, the default rule as SQL, `readable`, `NOT_IN_LIBRARY`);
  `src/modules/library/` (routes, controller, service, repo, events, search, test; `// ai:none` with
  its reason until PR 2); the 13 `<module>.library.js` files of §6.2 (partners, agreements, proposals,
  offers, employment_contracts, queries, documents, organisation, expenses, disbursements, statutory,
  training, knowledge); `ENTITY_ROUTES` `library_item` and `SCREENS.documents`; the screen's search
  entry; the empty `documents.search.js` deleted with its README line.
- **Frontend:** the module in `app/src/shell/catalogue.ts` and `screens.tsx`; `coming-soon.ts`;
  `app/src/features/documents/` (`index.tsx`, `Library.tsx`, tests); the mock (`MODULES_ALL` in
  `mock/data/people.ts`, `mock/modules/library.ts`, fixtures); `SECTION` in `scripts/new-screen.js`
  and `SECTION_KEYS` in `scripts/check/user-guide.js`.
- **Tests:** `tests/integration/library-access.test.js` (§6.3, both directions, every system role);
  the registry's coverage test (every doc type sourced or named); list, filters, sort, summary and
  404s; the search provider; the screen's tests with axe and the copy rules; `SCREENS` in
  `scripts/check/progress.js` and the count and `LABEL_TO_MODULE` in `events-workflow.test.js`.
- **Docs:** PROGRESS: the `### Document Centre` section, row #113 Library, the summary counts (M10
  and the total, and the opening line's screen counts), a dated note; MILESTONES §18's table and
  counts as its 16/11/2026 paragraph says; this guide; a Change log line in each guide whose module
  gained a library file; `docs/manual/document-centre.md` with its pictures (`npm run guide:shots`);
  `.github/CODEOWNERS` line for `src/modules/library/`; README's map.
- Done when a person of each system role finds, previews and downloads exactly the documents they
  could open before, in the Library and in ⌘K, and `library-access.test.js` proves it.

### PR 2 · Company documents and the extras (`m10/document-centre-company`)

- **Contract first:** `CompanyDocumentCreate`, `CompanyDocumentUpdate`, `CompanyDocumentVersion`,
  `DocumentCategory`, `DocumentCategoryCreate`, `DocumentCategoryUpdate`, `CategoryListQuery`,
  `CategoryPage`, `TagListQuery`, `TagPage`, `LetterheadRequest`; `LibraryListQuery` gains
  `category_id`, `tag`, `archived`; `LibraryRow` gains `category`, `tags`, `matched_text`.
- **Backend:** `10510`, `10520`, `10591`; `documents.manage` in `CAPABILITY_CATALOG`; the
  `company_document` type, its `defineAccess` and `library.library.js`; the writes of §6.5 in
  `library.service` (transaction, `emit()`, numbering); the vault's title and expiry setter; the
  categories and tags routes; `pdf-text` limits as a parameter, the Word text reader, the
  `document-text` job, its outbox handler and the nightly sweep; the letterhead export and the Word
  writer's header, footer and picture parts; the expiry reminder, the notice and Home's alert subject
  (§6.9); `library.ai.js` (§9) with `npm run gen:ai-catalogue`; `ENTITY_ROUTES` `company_document` and
  `document_category`, `SCREENS.documents` with `categories`; the actions in `shared/search/actions.js`;
  `seeds/staging/` demonstration categories and documents.
- **Frontend:** Upload Document (`useContractForm`, `UploadField`, six fields, a modal and a phone
  sheet), Edit Details, Upload New Version, Archive Document, the Category and Tag filters, the words
  found in a file under a row's title, Download Letterhead; `Categories.tsx`; the mock's writes.
- **Tests:** the audience rule for every role, in `library-access.test.js` too; uploads, the
  duplicate refusal, versions, archive; the text job on a PDF, a Word file and a scanned page; search
  inside files with the reader's rule; the letterhead in both formats; the reminder's four days, once
  each; the AI matrix, the action tests and evaluation cases gate 23 asks for; the screens' tests.
- **Docs:** PROGRESS row #114 Categories and its counts, the note; MILESTONES §18; this guide;
  `home.md`, `praxis-ai.md` and `notifications.md` where their screens change; the User Guide chapter
  with its new sections and pictures; README's map and §5.15's jobs.
- Done when a company document is uploaded, found by a word inside it, replaced, reminded of its
  expiry and archived, each by the people §8 names and nobody else, and the letterhead downloads in
  both formats.

### Start prompts

**PR 1** (paste into a new chat on this repository, once PR 0 has merged):

> This is a full-stack change: the Document Centre, PR 1 of `docs/guides/document-centre.md`
> Appendix A, the library over what exists. Read `docs/guides/document-centre.md` in full, §1.1's
> decisions above all (they are not re-opened), then `docs/handoff/document-centre.md`, then
> `docs/guides/foundation.md` §5 and §6.7, then what CLAUDE.md step 2 asks for a full-stack task.
> Build only PR 1; contract first. If the guide is wrong or silent, change it first in the same PR.
> Finish as CLAUDE.md step 5 says and log the handoff. Then, as TB asked on 16/11/2026: open the PR,
> mark it ready for review, drive GitHub's CI to green and merge it.

**PR 2** (once PR 1 has merged):

> This is a full-stack change: the Document Centre, PR 2 of `docs/guides/document-centre.md`
> Appendix A, company documents and the extras. Read `docs/guides/document-centre.md` in full, §1.1's
> decisions above all (not re-opened), then `docs/handoff/document-centre.md`, then
> `docs/guides/praxis-ai.md` §1.2 and `docs/handoff/praxis-ai-engine.md` §7, then what CLAUDE.md step
> 2 asks for a full-stack task. Build only PR 2, on what PR 1 built; contract first. If the guide is
> wrong or silent, change it first in the same PR. Finish as CLAUDE.md step 5 says and log the
> handoff. Then, as TB asked on 16/11/2026: open the PR, mark it ready for review, drive GitHub's CI
> to green and merge it.
