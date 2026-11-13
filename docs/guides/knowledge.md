# Knowledge Hub · SOPs and Training · Engineering Guide

| | |
|---|---|
| Owner | TB |
| Milestone | M10 (14 to 18 December 2026; built ahead from 11/11/2026) |
| Backend modules | `knowledge` (SOPs), `training` (courses, enrolments, certificates) |
| Frontend paths | `app/src/features/knowledge/` (the SOPs and Training tabs; the User Guide's files there are `user-guide.md`'s), `app/src/features/ess/MyTraining.tsx` (ESS · My Training) |
| Permission key(s) | `knowledge` (view, create, edit, delete) with the capabilities below; a department's head for that department's SOPs (§6.2); none for a person's own training (`self`, own only) |
| Capabilities | `sops.manage` (write, publish and archive any department's SOPs; Knowledge Hub · SOPs) · `training.manage` (build, publish, assign and archive courses, and see everyone's progress; Knowledge Hub · Training) |
| Screens (PROGRESS.md rows) | #63 SOPs, #65 Training, #110 ESS · My Training; #64 FAQs and #66 Announcements are Dropped |
| Status | Agreed |
| Last changed | 12/11/2026 |

This guide is **M10 Knowledge Hub's single source of truth**: the rules, the data, the API, the
screens and the build plan (Appendix A). The build tracker is `docs/handoff/m10-knowledge-hub.md`.
Sources, in their order of authority (CLAUDE.md step 3): TB's eight answers of 11/11/2026 (§1.1),
which settle what the Modules Review of 4 November 2026 left open; that meeting's decisions
(its notes are not kept in this public repository; §1.2 quotes what it said); MILESTONES §15 as amended on
11/11/2026; A12 (two hashes on a signed document), A23 as amended (AI drafts, a person presses),
A26 (no business data seeded). `demo.html` is look only, and its SOPs ("How do I raise an
expense?") are exactly what this guide moves out.

Policies (#62) and the User Guide (#102) are Knowledge Hub tabs with guides of their own
(`policies.md`, `user-guide.md`); this guide does not change them.

---

## 1 · What it is for

The Knowledge Hub keeps what MyCity knows about how it works. **SOPs** are each department's own
standard operating procedures (how Marketing runs a campaign launch, how Operations onboards a
partner), written step by step by the department and kept current by its head, independent of the
system. **Training** is a small learning system: People build a course from files, videos, course
links and short lessons, assign it to whoever must take it with a due date or leave it open in the
library, and every person who completes it receives a signed MyCity certificate. Staff take their
training on ESS · My Training.

How to use the hub itself is the User Guide's job, and a question is Praxis AI's: that is why FAQs
are gone.

### 1.1 Decisions (TB, 11/11/2026, binding)

| # | Question | Answer |
|---|---|---|
| K1 | What leaves the hub | **FAQs and Announcements** (4 November). FAQs: the User Guide and Praxis AI answer questions. Announcements: Staff Community already holds them (dropped 29/10/2026). SOPs **stay** |
| K2 | What an SOP is | A **department's own procedure**, independent of the system. "How do I use screen X" content is the User Guide's and never an SOP |
| K3 | Who writes SOPs | **The department's head** writes and publishes that department's SOPs; a new **Manage SOPs** capability (`sops.manage`) may write any department's. **Every member of staff reads every published SOP** |
| K4 | An SOP's shape and life | **Structured**: Purpose, Scope (optional), Roles Involved, then numbered Steps, each with its text, who does it (optional), a screen it happens on (optional) and an attached file (optional). **Versioned**: Draft, Publish (Version N with a note), Archive; every version kept. The department is told of a new version. **No approval and no acknowledgement** (those stay Policies') |
| K5 | What a training is | A **course of items**, in order: an uploaded **file** (PDF, slides, a video), a **video link** (YouTube plays in the course), an external **course link**, or a short written **lesson**. Complete when every item is done |
| K6 | Completion and certificates | **Both**: the person marks each item done; a course may ask for **proof** at the end (a certificate link pasted or a file uploaded, for an outside course); **and** the system issues its own **MyCity certificate**, an A4 landscape PDF, automatically on completion, no approval |
| K7 | Who signs the certificate | **The publisher, once, at Publish**: whoever publishes a course signs it there (drawn or typed, as Policies sign); every certificate of that course prints that signature, with a certificate number and a QR code that opens the verification page on `go.mycityapp.io` |
| K8 | Assigning and taking | Assign to **everyone, departments, roles or named people**, with a due date; staff take courses on **ESS · My Training**; each assignment is also a **task** in My Workspace; overdue people are reminded. **And an open library**: a published course marked Library can be taken by anyone, assigned or not |
| K9 | AI | **Draft With AI** on an SOP (a department's existing procedure, pasted or a PDF, shaped into Purpose, Roles and Steps) and **Draft Lesson** on a training item (a lesson written from a pasted text or PDF), both on the **Default** job; Praxis AI reads SOPs and training |

### 1.2 What the meeting said (4 November 2026, 00:40 to 00:44)

- "SOPs we can set SOPs for each of the departments ... step-by-step procedures for each department,
  owners keep them current, linked from screens they describe."
- On the old SOP tab: "What we have here under SOP is what we have on the new system under user
  guide ... But now the SOP is the standard operating procedure for each department which is
  independent of what the system has ... we make it properly structured here."
- "We are taking off FAQs because FAQs already comes in under user guide. Then announcement as well
  has been taken off ... Staff Community."
- Training: "a very, very mini learning management system ... upload a resource ... people go
  through it and at the end they have some sort of completion ... a YouTube video or even a course,
  a certificate, you paste the link to the certificate ... set up all those who are supposed to
  take the particular training."

## 2 · Screens affected

| Screen / tab (slug) | Where | Who sees it | What it shows | What a person can do there |
|---|---|---|---|---|
| Knowledge Hub · SOPs (`sops`) | Knowledge Hub | `knowledge` view: everyone | Published SOPs grouped by department (number, title, department, version, updated); one opens as a reader: Purpose, Scope, Roles Involved, the numbered Steps with who, the screen link and the file; its versions. A writer also sees Drafts and Archived | Search, filter by department; a writer (§6.2): New SOP, Edit (the draft), Draft With AI, Save Draft, Discard Changes, Publish SOP (a note), Archive SOP, open a past version |
| Knowledge Hub · Training (`training`) | Knowledge Hub | `knowledge` view with `training.manage` | Courses (number, title, items, Library or Assigned Only, Assigned, Completed, Overdue, state); a course opens with Items, People and Settings | New Course, add and order items (Upload File, Video Link, Course Link, Lesson with Draft Lesson), Publish Course (signature), Assign Training (audience, due), Remind Overdue, Withdraw Assignment, Archive Course, Download a certificate |
| ESS · My Training (`my-training`) | Employee Self-Service | Every employee, own | To Do (assigned, due first, overdue marked), In Progress, Completed (with Download Certificate), Library | Start, open an item (lesson inline, file viewer, video player, link in a new tab), Mark Done, Add Proof, Download Certificate; Take Notes (My Notes, the person's own note on the course, floating over it, §6.13) |
| User Guide's help for the screen in view | Over any screen (`user-guide.md` §3) | As the screen | Under the screen's guide section, **Procedures**: the published SOPs whose steps name this screen | Open the SOP |
| My Workspace · Tasks | My Workspace | The person assigned | A task "Complete <course>" with the due date, linked to the course | Open the course on My Training; it closes itself on completion |
| Notifications (bell, push) | Global | The department (new SOP version); the person (assigned, reminder, certificate ready); `training.manage` (nothing by default) | As §7 | Open the SOP or the course |
| ⌘K | Global | As the screens | SOPs by number and title; courses by number and title; My Training; New SOP, New Course | Open |
| Praxis AI | Global | As the screens | Answers from SOPs (citing the version) and the reader's training; for `training.manage`, progress | Open the SOP, the course or My Training |
| Verify a Document (public, `/verify`) | `go.mycityapp.io` | Anyone with the number or the QR | A certificate's holder, course, completion date, publisher and the two verdicts | Check a certificate |

## 3 · How the screens relate

1. **A head writes an SOP** (SOPs, New SOP, for their department; `sops.manage` picks any
   department). The draft holds Title, Purpose, Scope, Roles Involved and Steps. Draft With AI takes
   a pasted procedure or a PDF and returns a structured draft beside theirs (`POST
   /knowledge/sops/draft-with-ai`); Use This Draft replaces the form, Keep Mine leaves it. Save
   Draft keeps it (`sop_version`, status `draft`); nobody is told.
2. **Publishing.** Publish SOP asks for a note (required from Version 2) and makes the draft
   `Version N` (§6.3). `sop.published` tells the department's members (bell, push as their
   Knowledge Hub preference allows). Everyone can read it from then on.
3. **Screens link back.** A step that names a screen (`module/tab` from the route map) makes the SOP
   appear under Procedures in that screen's help (`GET /knowledge/sops/for-screen`), so a person
   on People · Employees finds Operations' onboarding SOP where they work.
4. **People build a course** (Training, New Course): Title, Summary, then items in order. A file
   goes through the upload engine and the vault; a video link and a course link are URLs; a lesson
   is written in the rich text editor, and Draft Lesson writes one from a pasted text or a PDF.
   Settings: Library (anyone may take it), Proof Required (with a prompt), Issue Certificate (on by
   default).
5. **Publishing a course** takes the publisher's signature (`SignatureField`) and makes it
   available (§6.6). The signature is kept for the course and printed on every certificate.
6. **Assigning.** Assign Training opens a sheet: Everyone, or any mix of departments, roles and
   named people; Due Within (days) and Keep Assigning New Joiners. In one transaction the
   assignment is stored, every person it reaches now is enrolled with a due date, and
   `training.assigned` is emitted; the outbox sets each person's task and notice, one person at a
   time (`training.enrolled`). Someone who later joins or moves into the audience is enrolled by the
   `training.enrol_joiners` handler.
7. **Taking a course** (ESS · My Training): the person opens it, works through the items and
   presses Mark Done on each. The last one completes the course, or, with Proof Required, Add Proof
   (a link or a file) completes it.
8. **Completion** (`training.completed`) allocates the certificate number in the same transaction;
   the outbox renders the certificate PDF (doc type `training_certificate`), stores it in the vault,
   closes the task and tells the person "Certificate ready". Download Certificate on My Training,
   and on Training · People for `training.manage`.
9. **Verification.** The certificate's QR and number open Verify a Document on `go.mycityapp.io`,
   which shows the holder, the course, the completion date, the publisher and the two verdicts
   (A12, §6.10).
10. **Reminders** come from the reminder engine (§7); Remind Overdue on a course reminds everyone
    overdue on it at once.

## 4 · Data

| Table | Key columns | Notes |
|---|---|---|
| `sop` (10400) | `number` (`SOP-0001`), `department_id`, `title`, `status` (`active`, `archived`), `archived_at`, `archived_by`, `archive_reason`, `created_by`, `updated_by` | One row per SOP. The department is fixed when it is created (a move is a new SOP) |
| `sop_version` (10400) | `sop_id`, `status` (`draft`, `published`), `version` (null until published), `title`, `purpose`, `scope`, `roles` (text[], up to 10), `note`, `content_hash`, `published_at`, `published_by`, `created_by`, `updated_by` | At most one draft per SOP (partial unique index); numbers unique per SOP and never reused. A published version is never edited |
| `sop_step` (10400) | `sop_version_id`, `position` (1 to 50), `text`, `who`, `screen_key` (`module/tab`), `document_id` | A version's steps in order; copied into a new draft from the version it replaces. `screen_key` is checked against the route map's screens. Indexed on `screen_key` for §3 step 3 |
| `training_course` (10410) | `number` (`TRN-0001`), `title`, `summary`, `status` (`draft`, `published`, `archived`), `library`, `proof_required`, `proof_prompt`, `issue_certificate`, `published_at`, `published_by`, `signer_name`, `signer_title`, `signature_document_id`, `archived_at`, `archived_by`, `archive_reason`, `created_by`, `updated_by` | The publisher's signature (a PNG in the vault, or a typed one rendered to PNG) and their name and title, copied at Publish (K7) |
| `training_item` (10410) | `training_course_id`, `position` (1 to 40), `kind` (`file`, `video`, `link`, `lesson`), `title`, `url`, `document_id`, `lesson_markdown`, `minutes` | One of `url` (video, link), `document_id` (file) or `lesson_markdown` (lesson), by a CHECK on `kind` |
| `training_assignment` (10410) | `training_course_id`, `everyone`, `due_within_days` (1 to 365, null for none), `keep_assigning`, `withdrawn_at`, `withdrawn_by`, `created_by` | One per Assign Training press |
| `training_assignment_audience` (10410) | `training_assignment_id`, one of `department_id`, `role_id`, `employee_id` | Rows, because who is enrolled is found in SQL |
| `training_enrolment` (10410) | `training_course_id`, `employee_id`, `training_assignment_id` (null for a library start), `due_on`, `started_at`, `completed_at`, `proof_url`, `proof_document_id`, `certificate_number`, `certificate_document_id`, `certificate_hash`, `task_id`, `reminded_at`, `reminders_sent` | One per person and course (unique). `certificate_number` is unique |
| `training_item_progress` (10410) | `training_enrolment_id`, `training_item_id`, `done_at` | One per item done (unique); deleting an item cascades |
| `training_note` (10440) | `training_course_id`, `employee_id`, `body` (up to 20,000 characters) | My Notes (§6.13): one per person and course (unique), on the course rather than the enrolment so a Library course can be noted before Start; the person's alone |

Schema migrations: `migrations/10400_sops.sql`, `migrations/10410_training.sql`, and
`migrations/10420_training_tasks.sql` (a task's record may be a `training_enrolment`, §6.7), `10430_training_certificate_facts.sql` (§6.9) and `10440_training_notes.sql` (My Notes, §6.13). Reference data:
`seeds/reference/10490_seed_knowledge.sql`: the capabilities `sops.manage` and `training.manage`
for Operations & People and Implementation (the CEO holds every capability); the numbering schemes
`sop` (`SOP-0001`), `training_course` (`TRN-0001`) and `training_certificate` (`CERT-2026-0001`,
yearly). No SOP, course, department or person is seeded (A26).

The general article tables of `10000` (`knowledge_category`, `knowledge_article`,
`knowledge_article_version`, `knowledge_embedding`) are read and written by nothing. SOPs need a
department, drafts, structured steps and a screen index that they do not have, so this guide does
not use them; a later release drops them (MIGRATIONS §8), together with
`ai_message_citation.knowledge_article_version_id`, which Praxis AI no longer writes (10310).

## 5 · API

| Method and path | Contract | Permission · scope | Paged | Notes |
|---|---|---|---|---|
| `GET /api/v1/knowledge/sops` | `SopListQuery` (`department_id`, `state`: `published`, `draft`, `archived`; `q`, `sort`) → `SopPage` | `knowledge` view | yes, 25 | Drafts and Archived only for a writer, of the departments they may write |
| `POST /api/v1/knowledge/sops` | `SopCreate` (`department_id`, `title`) → `Sop` | `knowledge` view, a writer of that department | no | Numbered, with an empty draft |
| `GET /api/v1/knowledge/sops/:id` | → `Sop` | `knowledge` view | no | The version in force with its steps; the draft and `can_edit` for a writer |
| `PUT /api/v1/knowledge/sops/:id/draft` | `SopDraftSave` (`title`, `purpose`, `scope`, `roles`, `steps`) → `Sop` | a writer | no | Creates the draft when there is none |
| `POST /api/v1/knowledge/sops/:id/draft/discard` | `EmptyBody` → `Sop` | a writer | no | 409 `NO_DRAFT` |
| `POST /api/v1/knowledge/sops/:id/publish` | `SopPublish` (`note`) → `Sop` | a writer | no | §6.3 |
| `POST /api/v1/knowledge/sops/:id/archive` | `SopReason` (`reason`) → `Sop` | a writer with `knowledge` delete, or the head | no | |
| `GET /api/v1/knowledge/sops/:id/versions` | `PageQuery` → `SopVersionPage` | `knowledge` view | yes, 25 | Newest first |
| `GET /api/v1/knowledge/sops/versions/:id` | → `SopVersion` | `knowledge` view | no | A published version |
| `GET /api/v1/knowledge/sops/for-screen` | `SopScreenQuery` (`screen_key`) → `SopPage` | `knowledge` view | yes, 25 | Published SOPs a step of whose version in force names the screen |
| `GET /api/v1/knowledge/sops/departments` | `SopDepartmentQuery` (`writable`, `q`) → `SopDepartmentPage` | `knowledge` view | yes, 25 | The departments with an SOP the reader may read (the chips); with `writable=true`, the active departments they may write for (New SOP's Department; empty for a reader who writes for none, so the screen shows no writer's controls). Most staff hold no `people` view, so `/departments` is not theirs to read |
| `POST /api/v1/knowledge/sops/draft-with-ai` | `SopDraftWithAi` (`text` or `document_id`, `department_id`) → `SopDraftSuggestion` | a writer of that department | no | A suggestion only; nothing saved. 503 `AI_UNAVAILABLE` |
| `GET /api/v1/training/courses` | `CourseListQuery` (`state`, `q`, `sort`) → `CoursePage` | `knowledge` view, `training.manage` | yes, 25 | With Assigned (everyone on the course, a Library start included), Completed and Overdue counts |
| `POST /api/v1/training/courses` | `CourseCreate` (`title`, `summary`) → `Course` | `knowledge` create, `training.manage` | no | Numbered, `draft` |
| `GET /api/v1/training/courses/:id` | → `Course` | `knowledge` view, `training.manage` | no | Items, settings, counts |
| `PATCH /api/v1/training/courses/:id` | `CourseUpdate` (`title`, `summary`, `library`, `proof_required`, `proof_prompt`, `issue_certificate`) → `Course` | `knowledge` edit, `training.manage` | no | |
| `POST /api/v1/training/courses/:id/items` | `ItemCreate` (a lesson's text as the editor's `lesson_html`) → `Course` | `knowledge` edit, `training.manage` | no | At most 40 |
| `PATCH /api/v1/training/items/:id` | `ItemCreate` (the whole item) → `Course` | `knowledge` edit, `training.manage` | no | |
| `DELETE /api/v1/training/items/:id` | → `Course` | `knowledge` edit, `training.manage` | no | §6.6 on a published course; an archived course's items are fixed (409 `COURSE_ARCHIVED`), as are its title and settings |
| `PUT /api/v1/training/courses/:id/order` | `ItemOrder` (`item_ids`) → `Course` | `knowledge` edit, `training.manage` | no | |
| `POST /api/v1/training/lesson-with-ai` | `LessonWithAi` (`text` or `document_id`, `title`) → `LessonSuggestion` (`lesson_html`) | `knowledge` edit, `training.manage` | no | A suggestion only. 503 `AI_UNAVAILABLE` |
| `POST /api/v1/training/courses/:id/publish` | `CoursePublish` (`signature`) → `Course` | `knowledge` edit, `training.manage` | no | §6.6 |
| `POST /api/v1/training/courses/:id/archive` | `CourseReason` → `Course` | `knowledge` delete, `training.manage` | no | |
| `POST /api/v1/training/courses/:id/assignments` | `AssignmentCreate` (`everyone`, `department_ids`, `role_ids`, `employee_ids`, `due_within_days`, `keep_assigning`) → `Assignment` | `knowledge` edit, `training.manage` | no | Published courses only (409 `COURSE_NOT_PUBLISHED`) |
| `GET /api/v1/training/courses/:id/assignments` | `PageQuery` → `AssignmentPage` | `knowledge` view, `training.manage` | yes, 25 | |
| `POST /api/v1/training/assignments/:id/withdraw` | `EmptyBody` → `Assignment` | `knowledge` edit, `training.manage` | no | §6.7 |
| `GET /api/v1/training/courses/:id/people` | `EnrolmentListQuery` (`status`: `not_started`, `in_progress`, `completed`, `overdue`; `q`, `sort`) → `EnrolmentPage` | `knowledge` view, `training.manage` | yes, 25 | |
| `POST /api/v1/training/courses/:id/remind` | `EmptyBody` → `{ reminded }` | `knowledge` edit, `training.manage` | no | Everyone overdue, once a day each |
| `GET /api/v1/training/me` | `MyTrainingQuery` (`list`: `to_do`, `in_progress`, `completed`, `library`; `q`) → `MyCoursePage` | self, own | yes, 25 | `library`: published Library courses the person is not enrolled on |
| `GET /api/v1/training/me/courses/:id` | → `MyCourse` | self, own | no | A course they are enrolled on, or a Library course. `:id` is the course's, or the person's own enrolment's (the link a task and a notice carry) |
| `POST /api/v1/training/me/courses/:id/start` | `EmptyBody` → `MyCourse` | self, own | no | Library courses, or their own enrolment (sets `started_at`) |
| `POST /api/v1/training/me/items/:id/done` | `EmptyBody` → `MyCourse` | self, own | no | May complete the course (§6.8). A Library course not started: 409 `NOT_STARTED` |
| `POST /api/v1/training/me/items/:id/undone` | `EmptyBody` → `MyCourse` | self, own | no | Not after completion (409 `COURSE_COMPLETED`) |
| `POST /api/v1/training/me/courses/:id/proof` | `ProofAdd` (`url` or `document_id`) → `MyCourse` | self, own | no | Completes the course. Every item done first (409 `ITEMS_LEFT`); only where it is asked (409 `PROOF_NOT_ASKED`) |
| `GET /api/v1/training/me/courses/:id/note` | → `TrainingNote` (`body`, `updated_at`, null before the first save) | self, own | no | My Notes on a course the person may open (§6.8's rule: theirs, or a Library course); anyone else's course is a 404 |
| `PUT /api/v1/training/me/courses/:id/note` | `TrainingNoteSave` (`body`, the whole text, up to 20,000 characters) → `TrainingNote` | self, own | no | Saved as the person types (§6.13); before Start and after completion alike |
| `POST /api/v1/training/me/courses/:id/certificate` | `EmptyBody` → `ExportFile` (202) | self, own | no | The stored PDF, downloaded on the device that asked; `pending` while the worker renders it, then the screen waits on `GET /exports/:id`. 409 `NO_CERTIFICATE` without one |
| `POST /api/v1/training/enrolments/:id/certificate` | `EmptyBody` → `ExportFile` (202) | `knowledge` view, `training.manage` | no | Anyone's, as above |
| `GET /api/public/v1/verify/:ref` | → `VerifyResult` | public | no | A `CERT-` number is answered by `training.certificate.js` (§6.10): `document_type` `training_certificate` and its `certificate` facts; no auth import |

## 6 · Rules and calculations

### 6.1 FAQs and Announcements leave

- The FAQs tab, its ⌘K screen, the `faq` record type in the route map and notification categories,
  the mock and the INTERIM types are removed; the access catalogue's `knowledge` description reads
  "Policies, SOPs, training and the User Guide". ⌘K's words "faq", "questions" and "help" find the
  User Guide.
- The old SOP content ("How do I ...") is mock data only; nothing in the database holds it.

### 6.2 Who writes an SOP

- A **writer** of a department is its head at the moment of the request (`department.head_employee_id`,
  or the employee holding `department.head_seat_id`), or anyone holding `sops.manage`.
- A head needs no `knowledge` create or edit grant to write their own department's SOPs: the
  headship is the authority, checked in the service (like an approver's right to approve). A head
  who leaves the post loses it at once.
- Archiving needs `knowledge` delete with `sops.manage`, or the head.
- Everyone with `knowledge` view (every role by default) reads every published SOP.
- Every SOP route asks the `knowledge` view grant and no capability; the service decides the rest. A
  write by anyone else is 403 `NOT_SOP_WRITER` ("You may not write this department's SOPs"). A
  draft-only or archived SOP, and its versions, are a writer's alone: anyone else is answered 404.

### 6.3 An SOP's draft, versions and publishing

- One draft per SOP. Save Draft writes every field. Title 4 to 120 characters; Purpose 10 to 600;
  Scope up to 600; Roles Involved up to 10 entries of up to 60 characters; Steps 1 to 50, each text
  3 to 1,000 characters (Markdown: bold, italic, links and lists), Who up to 80, a screen key the
  route map knows (422 `UNKNOWN_SCREEN`), a file that is an uploaded `document` (A13).
- A step's file is claimed from the upload engine for the SOP when the draft is saved (doc type
  `sop_file`, `vault.claim`; only the person who uploaded it may attach it, 422
  `DOCUMENT_NOT_STAGED` otherwise) and is read by everyone with `knowledge` view. A step carried
  from the version in force keeps its file without a second claim.
- Publish SOP, under the SOP's lock: a draft (409 `NO_DRAFT`) with a purpose (422 `SOP_NO_PURPOSE`)
  and at least one step (422 `SOP_NO_STEPS`), whose screens the route map still knows (422
  `UNKNOWN_SCREEN`), that differs from the version in force (409 `NO_CHANGES`), a note of 10 to 500
  characters from Version 2 (optional on the first; 422 on `note` when missing).
  The draft becomes Version N, the next number, never reused, in force at once. `content_hash` is
  the canonical hash of what staff read.
- An archived SOP is listed only under Archived for writers and is gone from search, AI and the
  screens' Procedures; its versions are kept.

### 6.4 SOP text and AI

- Steps are drawn by the shared `RichText` reader from Markdown (`shared/documents/markdown.js`), as
  policy text is: no screen injects HTML.
- **Draft With AI** (`sop-draft`, prompt `services/ai/prompts/sop-draft.md`, the **Default** job,
  personal data: yes, never DeepSeek, chosen by TB on 11/11/2026): the pasted text (up to 20,000
  characters) or a PDF's text (`services/media/pdf-text.js`; a scanned PDF answers "No text in this
  file") is sent with the department's name; the model returns `SopDraftSuggestion` (title, purpose,
  scope, roles, steps with who), checked by the contract. It keeps the procedure's own wording and
  never invents a step; a screen key is never suggested. Shown beside the form; nothing is saved
  until the writer saves (A23 as amended). Contact details and identifiers are shielded on the way
  out and put back in the answer; every field is cut to the form's limits. A file that is not a PDF
  is 422 `NOT_A_PDF`; a PDF with no text (a scan) is 422 `NO_TEXT` and nothing is sent; with AI off,
  no provider set up or the month's limit spent, 503 `AI_UNAVAILABLE` before any call.

### 6.5 A course and its items

- Title 4 to 120 characters; Summary up to 300; 1 to 40 items.
- **File**: an upload through the upload engine (PDF, PowerPoint, Word, images, MP4 up to the
  engine's video limit); the course shows PDFs and images in the viewer, plays MP4 and offers
  anything else as a download.
- **Video link**: an `https` URL. A YouTube link (`youtube.com/watch`, `youtu.be`, `youtube.com/shorts`)
  plays in the course through `youtube-nocookie.com` (the staff app's CSP gains that `frame-src`, on
  the staff host only); nothing loads from YouTube until the person presses Play Video
  (`VideoPlayer`). Any other video link opens in a new tab. An uploaded MP4 is fetched with the
  session the same way, on Play Video.
- **Course link**: an `https` URL to an outside course; it opens in a new tab.
- **Lesson**: Markdown from the rich text editor (`RichTextField`, 20 to 20,000 characters). The
  editor sends HTML (`lesson_html`), which the server keeps as Markdown through the one converter
  (`shared/documents/markdown.js`: headings, paragraphs, lists, bold, italic and links), and gives
  back as `lesson_html` for the editor and as blocks for the reader, as Policies do; no screen
  converts text itself. **Draft Lesson** (`training-lesson-draft`, prompt `services/ai/prompts/training-lesson-draft.md`,
  the **Default** job, personal data: yes, never DeepSeek, TB 11/11/2026): from a pasted text or a
  PDF's text, a lesson of headings, short paragraphs and a Key Points list, at most 1,200 words,
  keeping the source's facts; shown beside the editor (`lesson_html`), Use Lesson replaces its text.
- **Minutes** per item (1 to 600) are optional; the course's length is their sum.
- A course's settings: **Library** (off by default), **Proof Required** with **Proof Prompt** (up to
  120 characters, "Paste your certificate link"), **Issue Certificate** (on by default).

### 6.6 Publishing and changing a course

- Publish Course: at least one item (422 `NO_ITEMS`) and the publisher's signature (drawn PNG at most
  200 KB, or typed, rendered to PNG in the signature face, as `SignatureField` does). The signer's
  name and job title are copied then. Publishing is once; a course is never unpublished, only
  archived.
- A published course stays editable (title, summary, settings, items). Adding an item does not
  reopen anyone's completion; a person in progress must also do the new item. Removing an item
  removes its progress, and anyone who has now done every remaining item (with their proof, where
  it is asked) completes in the same transaction; so does anyone who had done every item when Proof
  Required is turned off. Completed enrolments, their proof and their certificates never change.
- A file is staged through the upload engine (`POST /documents`) and claimed for the course as a
  `training_material` document (read by everyone with `knowledge` view); the signature is a
  `training_signature` document of the course; proof is a `training_proof` document, the person's
  own (`subject_employee_id`), personal.
- Archive Course (a reason): it leaves the Library and nobody can start it; open assignments are
  withdrawn (§6.7); enrolments in progress stay and may still be finished; certificates stay valid.

### 6.7 Assigning

- **Who**: everyone at work (active, started, not left) with an active login whom the audience
  reaches: everyone, or in one of its departments, or holding one of its roles, or named; counted
  when the assignment is made.
- An assignment enrols each person it reaches who has no enrolment on the course; a person with a
  Library enrolment in progress is moved onto the assignment and gains its due date; a person who
  has completed the course is left as they are.
- **Due**: `due_within_days` after the enrolment day (Lagos), or no due date.
- **Keep Assigning New Joiners** (on by default for everyone, departments and roles; ignored for
  named people): a person who later joins, or moves into a department or role it names, is enrolled
  from that day by `training.enrol_joiners` (on `employee.created`, `employee.updated` and
  `access.roles_set`, the event a login's roles change on, and the `training-joiners` job at 06:00
  Lagos as a backstop, which also sets any assigned place's task still missing). An assignment that
  names only people is stored with Keep Assigning off.
- **The task**: each assigned enrolment sets a task through `tasks.service.create`, its assignee the
  person, set by the assigner, titled "Complete <course>", due on the due date, linked to the
  enrolment (`entity_type` `training_enrolment`); it is completed by the system when the course
  completes (`tasks.service.completeForRecord`), and cancelled when the enrolment is removed. The
  worker sets the tasks after commit, one place per transaction, read 50 at a time, and emits
  `training.enrolled` for each, which tells the person; one place that fails does not hold up the
  rest, and the next sweep picks it up. A person reached twice keeps one place and one task.
- **Withdraw Assignment**: it stops enrolling joiners; enrolments from it that have not started are
  removed with their tasks (one that another open assignment of the course still reaches moves onto
  that one instead); started ones stay, without a due date.

### 6.8 Taking a course and completing it

- A person may open a course they are enrolled on, or a published Library course (Start enrols them,
  `training_assignment_id` null). Anyone else's course is a 404.
- Mark Done on an item records `training_item_progress`; the first one sets `started_at`. Items may
  be done in any order. Undone is allowed until completion. A Library course is started (Start)
  before its items are marked.
- Add Proof is taken once every item is done, and only on a course that asks for it.
- **Completion**, under the enrolment's lock: every item of the course as it stands is done, and,
  with Proof Required, proof is given (an `https` link or an uploaded file). Then `completed_at` is
  set and, with Issue Certificate on, the certificate number is allocated (`numbering.allocate`,
  `training_certificate`) and `certificate_hash` set (the `TRAINING_CERTIFICATE` canonical payload
  of `shared/documents/canonical.js`, §6.9) in the same transaction; `training.completed` is emitted.
- An archived course can still be completed by those already enrolled.

### 6.9 The certificate

- Rendered by the outbox handler `training.issue_certificate` through `documents.generate` (doc type
  `training_certificate`, personal, one A4 landscape page it draws itself with no letterhead: the
  `draw` of `training.certificate.js` over `templates/documents/training-certificate.html`, its
  variables `CertificateDocumentVars`), from the sample MyCity approved as drawn (Cynthia,
  11/11/2026; `docs/MyCity-ERP-Documents/training-samples/certificate-sample.html`). The two faces
  are embedded files, never fetched: Cormorant Garamond (`templates/documents/fonts/`, its licence
  beside it) and the proposal kit's Geist (`templates/proposals/fonts/`, one copy in the
  repository). The rosette, the seal's petals and the QR are drawn on the server: the renderer runs
  no script and refuses every request but a `data:` URL. Download Certificate issues it then if the
  worker has not yet.
- It prints the organisation's logo (Settings · Organisation, else `assets/brand/logo.png`, the pin
  and "MyCityApp"; the drawn pin and the name when neither exists), "Certificate
  of Completion", the person's full name as on their employee record, the course title, the number
  of items and the course's length (when minutes are set), the completion date (long, day first),
  the publisher's signature, name and job title, the seal (its ring the organisation's name), the
  certificate number, the issue date (the completion date) and the QR that opens
  `go.mycityapp.io/verify/<number>`: the number alone shows a certificate (§6.10), so it needs no key.
- When the PDF is stored (`document.generated`), `training.certificate_ready` tells the person
  "Certificate ready"; `certificate_ready` on My Training and Training · People means its PDF is
  made. The certificate and the proof are the person's and `training.manage`'s only: the vault's
  read rule for a `training_enrolment`'s files (`training.events.js`); the CEO holds every capability.
- `certificate_hash` is the canonical hash of what it states (name, course number and title,
  completion date, publisher, number; `TRAINING_CERTIFICATE`); the artifact hash is the vault's over
  the PDF. The PDF is stored once and never re-rendered; a renamed person or course keeps the
  certificate as issued: the holder's name and the course title it states are kept on the enrolment
  at completion (`certificate_holder_name`, `certificate_course_title`, migration `10430`).
- On staging every certificate carries the STAGING mark, as every document does.

### 6.10 Verification

- `GET /api/public/v1/verify/:ref` (which the QR opens, as `/verify/<number>` on the site) answers a
  `CERT-` number, in any case, from `training.certificate.js`: the holder's name, the course, the
  completion date, the publisher and their title, and the two verdicts (the content hash recomputed
  from the facts kept on the enrolment, the artifact hash from the stored bytes). A certificate
  states nothing private beyond what it prints, so the number alone shows it; nothing else about the
  person is shown. An unknown number, or one whose PDF is not made yet, is the same 404 as for any
  document. Verify a Document shows Awarded To, Course, Completed and Published By.

### 6.11 Reminders

- From the reminder engine (`training_due`): 3 days before the due date, on the due date, then once
  a week while overdue, at most three times after the due date; 08:00 to 18:00 Lagos; never to
  someone who has completed or left. Each step is an occurrence of its own (the due date and the
  step), found once from 08:00 Lagos on its day, and dropped when the due date moves; a step from
  before the person was assigned is never sent. The notice reads "Training due" or "Training
  overdue", with the course and the due date.
- Remind Overdue on a course reminds everyone overdue on it now, skipping anyone reminded that day.

### 6.12 The staging seed

`seeds/staging/90_knowledge.js` fills staging through the services (F13; never production), so the
hub opens with real content (TB, 11/11/2026):

- **SOPs**: two for each of MyCity's five departments (`seeds/staging/knowledge/sops.js`): Monthly
  Management Review and Company-Wide Announcement (General Management), New Listing Publication and
  App Incident Response (Technology & Back-office Ops), Social Media Post Approval and Campaign Launch
  (Branding & Marketing), Lead Outreach and Partner Onboarding (Partnership & Growth), New Employee
  Onboarding and Leave Request Handling (People & Culture, published twice so Versions has history).
  Each is written by the department's head when they have a login, else by Operations & People, else
  the CEO. Their steps link the screens they happen on, so they list under Procedures. They are
  published quietly (`publish(..., { quiet: true })`, which no route passes): staging sends real mail,
  and MyCity's staff are never the audience of demonstration data (TB, 27/10/2026).
- **Training**: two real courses (`seeds/staging/knowledge/courses.js`), built and signed by
  Operations & People. *NDPA Data Protection Essentials*: the NDPC's own video, two Nigerian news
  explainers (HumAngle, Channels Television), CISA's phishing short, two lessons on the Act in our
  own words with its section numbers, our one-page PDF *NDPA at a Glance*, and the Act's official
  text on ndpc.gov.ng. *Partner Outreach*: four videos (GoDaddy, HubSpot, Y Combinator, Splash), two
  lessons, our *Partner Outreach Checklist* PDF and HubSpot Academy's free Inbound Sales
  certification, whose certificate is the proof. Both are in the Library; NDPA is assigned to the
  Implementation department only, due in 14 days, so its tasks and notices reach our own team.
  Videos play through YouTube's own player and outside courses are links: nothing is re-hosted. Each
  video was checked on 11/11/2026 (YouTube's oEmbed answered, so its owner allows embedding); a video
  later removed by its owner shows YouTube's own message, and the course is changed on Training.
- The two PDFs are printed by the PDF service from `seeds/staging/knowledge/*.html` with the logo
  every PDF carries, and uploaded through the upload engine as a builder's would be. A PDF that
  cannot be printed leaves its item out, and the seed carries on; the next run gives the course
  the items it lacks, each in its place (an item is found by its kind and title).
- Idempotent: an SOP is found by its department and title, a course by its title. Staging's
  demonstration data is loaded by hand on the server (`docs/runbooks/deploy.md`); running the
  staging seeds again after a release adds only this file's records.

### 6.13 My Notes

Added 12/11/2026 at TB's request (the Milestone 10 video's brief): a learner takes notes while they
work through a course, without leaving it.

- **One running note per person and course** (`training_note`), saved to their account, so it follows
  them from a laptop to a phone and stays after completion. Up to 20,000 characters of plain text.
- **The person's alone.** Only the `/training/me` routes read or write it, as its owner; no manager,
  `training.manage` holder or the CEO has a route to it, Praxis AI reads none (`training.ai.js`
  `not_offered`, `personal:`), search finds none, and nobody is told. `training.note_saved` is audit
  only and carries the note's length, never its text.
- **Any course the person may open** (§6.8): their own, or a published Library course before Start.
- **On screen** Take Notes (on the course's card) opens `NoteTaker` from `@mycity/ui` over the course:
  a small panel that never blocks the page behind it. On desktop it floats bottom right, is moved by
  its bar (or Move Notes and the arrow keys) and stays inside the window; on a phone it docks full
  width at the foot of the course's sheet, and Move to Top swaps it to the top (no dragging on a
  phone, F19). Minimise Notes keeps its bar; Close Notes closes it. It saves 0.8 s after typing
  pauses, on Close Notes and when the course closes or another opens; the bar reads Saving, Saved
  or Not saved (with Try Again).

## 7 · Events, jobs and notifications

| Event / job | When | Does |
|---|---|---|
| `sop.created`, `sop.draft_saved`, `sop.draft_discarded`, `sop.archived` | As named | Audit with before and after; nobody is told |
| `sop.published` | Publish SOP | Audit; outbox `knowledge.notify_sop` tells the department's members ("New SOP" or "SOP updated", its title and version; push as their Knowledge Hub preference allows), nobody when the staging seed published it quietly (§6.12); search index |
| `training_course.created`, `.updated`, `.item_changed`, `.archived` | As named | Audit |
| `training_course.published` | Publish Course | Audit; search index |
| `training.assigned` | Assign Training | Audit; outbox `training.notify_assigned`: each new place's task, then `training.enrolled` |
| `training.enrolled` | The worker set a place's task | Audit; tells the person ("Training assigned", the course, the due date) |
| `training.assignment_withdrawn` | Withdraw Assignment | Audit; tasks of removed enrolments cancelled in the same transaction |
| `training.enrol_joiners` | `employee.created`, `employee.updated`, `access.roles_set`; the `training-joiners` job daily at 06:00 Lagos | Enrols new matches of open assignments, sets their tasks and notices |
| `training.close_leaver` | `employee.archived` | A leaver's open enrolments removed (`training.enrolment_closed`) and their tasks cancelled; completed ones stay |
| `training.started`, `training.item_done`, `training.item_undone`, `training.proof_added` | As named | Audit (progress is not notified) |
| `training.completed` | Completion | Audit; outbox `training.close_task` and `training.issue_certificate` (the certificate generated; the worker renders and stores its PDF) |
| `training.certificate_ready` | Its PDF stored (`document.generated`) | Tells the person ("Certificate ready", the course and the number) |
| `training.note_saved` | Saving My Notes (§6.13) | Audit only: the course, the person and the note's length, never its text |
| `training.reminder_due` | Reminder `training_due`, every 5 minutes, 08:00 to 18:00 Lagos (§6.11); Remind Overdue | Tells the person ("Training due" or "Training overdue") |

Notification category: `knowledge` (as Policies), so a person's Knowledge Hub preference governs
push. Record types: `sop`, `training_course`, `training_enrolment` (route map, `categories.js`).

## 8 · Permissions and visibility by role

| Role | Sees | Can do |
|---|---|---|
| Everyone (`knowledge` view) | Every published SOP and its versions; ESS · My Training: their own enrolments and the Library | Read SOPs; take courses, Mark Done, Add Proof, Download Certificate |
| A department's head | That department's drafts and archived SOPs | Write, publish and archive that department's SOPs (§6.2) |
| `sops.manage` (Operations & People, Implementation; the CEO holds every capability) | Every department's drafts and archived SOPs | Write, publish and archive any SOP |
| `training.manage` (Operations & People, Implementation; the CEO) | Knowledge Hub · Training: every course, assignment, enrolment, proof and certificate | Build, publish, assign, withdraw, remind, archive; download anyone's certificate |
| Anyone with the number or QR | The certificate's verification | Verify |

Proof files and certificates are the person's and `training.manage`'s only. Line managers see no one
else's training in M10 (§13).

## 9 · AI and search

- **AI reads** (`knowledge.ai.js`): `sops.list` (published SOPs by department and words), `sops.read`
  (one SOP's version in force with its steps; cites the version). (`training.ai.js`):
  `training.mine` (the reader's enrolments with status and due date), `training.library` (Library
  courses), `training.progress` (`training.manage`: courses with assigned, completed, overdue),
  `training.overdue` (`training.manage`: people overdue, paged). Paged at 25.
- **My Notes** are never read by Praxis AI (§6.13).
- **AI actions**: none in M10. Assigning and publishing need a signature or reach many people and
  stay on the screen; the module's `.ai.js` says so with `design:` (gate 19).
- **AI routes**: write or change an SOP → Knowledge Hub · SOPs; build or assign a course →
  Knowledge Hub · Training; take a course, see my certificates → ESS · My Training.
- **AI jobs** (`ai-control.md` §6.2): `sop-draft` and `training-lesson-draft` on **Default**,
  registered in `services/ai/actions.js` with "chosen by TB, 11/11/2026", personal data, never
  DeepSeek.
- **Search** (`knowledge.search.js`, `training.search.js`): SOPs by number and title (`sop`, opening
  Knowledge Hub · SOPs `?id=`), for everyone; courses by number and title for `training.manage`
  (`training_course`), and the person's own courses and Library courses (`training_enrolment`,
  opening ESS · My Training `?id=`, which takes the course's id or the person's enrolment's). A
  writer also finds their departments' SOPs still being drafted; an archived SOP is found by nobody.
  ⌘K's New SOP (writers: `sops.manage`, or anyone heading a department, an action's `orHead`) and
  New Course (`training.manage`, with the Training tab's screen in PR 5, as is the tab's
  `training.manage` rule in both mirrors, BACKEND_GUIDE §5). The
  screens: SOPs (sop, procedures, process, how we work), Training (courses, learning, lessons), My
  Training (my training, courses, certificate, learning).

## 10 · On screen and mobile

### 10.1 Content tiers

| Screen | Open (tier 1) | Behind help (tier 2) | Not on screen (tier 3), lives in |
|---|---|---|---|
| Knowledge Hub · SOPs | Department chips, Search SOPs, the list (SOP, Department, Version, Updated); an SOP: title, number, department, version, updated, Purpose, Scope, Roles Involved, numbered Steps (text, Who, Open Screen, the file); Versions; a writer: New SOP (Department, Title, Start SOP), Edit SOP (Title, Purpose, Scope, Roles Involved, each step's Step, Who, Screen and File; Add Step; Move Up, Move Down, Remove Step), Save Draft, the draft's bar (Draft saved, not published; Discard Changes, Publish SOP), Draft With AI (From: Pasted Text or PDF File; Yours beside Drafted, Keep Mine, Use This Draft), Publish SOP (Note), Archive SOP (Reason), the State chips (Published, Draft, Archived) | Screen: the screen this step happens on, where the SOP is listed under Procedures; Draft With AI's Procedure: wording kept, steps found; Roles Involved: one role a line; Note: what changed | Why SOPs are not the User Guide, the writer rule, versions: §1.1, §6 here |
| Knowledge Hub · Training | State chips (All, Draft, Published, Archived), the list (Course, State, Items, Library, Assigned, Completed, Overdue); a course beside it: its facts (Number, Items, Length, Published, Completed), Items (each: kind, title, minutes; Add Item with Upload File, Video Link, Course Link, Lesson; Draft Lesson beside the editor, Yours beside Drafted, Keep Mine, Use Lesson; each item's menu: Edit Item, Remove Item, Move Up, Move Down; drag to order), People (Status chips: Everyone, Not Started, In Progress, Completed, Overdue; Employee, Status, Department, Due, Progress, Completed, Certificate; Remind Overdue), Assignments (Audience, State, Due Within, New Joiners, Assigned, Assigned On, Withdraw), Settings (Library, Proof Required, Issue Certificate as switches; Course Details: Title, Summary, Proof Prompt, Save Course); Publish Course (Your Signature), Assign Training (Who Takes It: Everyone or Pick Who with Departments, Roles, People; Due Within (Days); Keep Assigning New Joiners), Archive Course (Reason) | Library: anyone may take it; New Joiners: enrols those who join later; Proof Required: asked at the end; Your Signature: printed on every certificate; Due: the date it was set for; Link: a YouTube link plays in the course | How enrolment, tasks and reminders work: §6.7, §6.11 |
| ESS · My Training | List chips (To Do, In Progress, Completed, Library); To Do and In Progress (course, status, Due, Progress), Completed (date, certificate number, Download Certificate), Library (course, Length); a course beside the list: its facts (Due, Length, Progress), Start Course for a Library course, its items with Done marks; an item opens in place (All Items, at its top and its foot): the lesson as text, a PDF (grown to its pages) or a picture in the viewer, an MP4 or a YouTube video behind Play Video, Open Link for any other link, Download File for anything else; Mark Done, Mark Not Done (until completion), Next Item; Proof with the course's prompt and Add Proof (Link or File); Completed with the certificate number, the proof and Download Certificate; Take Notes, and My Notes over the course (the course's title, the note, Saving, Saved or Not saved with Try Again; Move Notes, Minimise Notes, Open Notes, Close Notes; Move to Top or Move to Bottom on a phone) | Due: the date it was set for | How certificates are signed and verified: §6.9, the manual |
| User Guide's help for a screen | Procedures: SOP titles with their department | Nothing | How the link is made: §3 step 3 |

### 10.2 Phone layout

| Screen | First on a phone | Left off a phone | Main action | Navigation |
|---|---|---|---|---|
| Knowledge Hub · SOPs | Department chips scrolling sideways, then SOP cards (title, department, version); an SOP opens in a bottom sheet (F31) with its steps as a numbered list | Updated column; Versions behind a row in the sheet | New SOP in the floating button (writers); Edit SOP a full-screen sheet; Publish SOP in the draft's bar | More, then Knowledge Hub |
| Knowledge Hub · Training | Course cards (title, state pill, completed of assigned, overdue pill); a course opens in a full bottom sheet with Items, People, Assignments and Settings as a segmented control | Items, Library, Assigned and Department columns; Assignments' table (a list of cards instead); the drag handle (Move Up and Move Down in each item's menu) | New Course in the floating button; Assign Training or Publish Course, and Archive Course, full width at the sheet's foot | More, then Knowledge Hub |
| ESS · My Training | To Do cards first (title, status pill, due, a progress bar), then In Progress, Completed, Library as chips; a course opens in a full bottom sheet | Library's summaries (title and length only); the subtitle; dragging My Notes | Mark Done full width at the foot of the open item in the course's sheet, Next Item and All Items under it; Start Course, Take Notes and Add Proof full width; My Notes docked at the sheet's foot (Move to Top) | ESS tabs |

## 11 · Edge cases

- A department with no head and nobody holding `sops.manage`: its SOPs are read-only until one is
  set (the CEO holds every capability).
- A head moves to another department: they lose the first and gain the second at once; their drafts
  stay with the SOP.
- Two writers saving one draft: the last save wins; Publish takes the SOP's lock.
- A step's screen is removed from the route map in a later release: the step keeps its text and the
  link is dropped from the reader (the key no longer resolves); `UNKNOWN_SCREEN` on the next save.
- An item deleted from a published course while someone is on it: their progress on it goes; if
  every remaining item is done (and no proof is required, or it is given), the deletion completes
  them through §6.8 in its own transaction.
- A course with Proof Required: the last Mark Done does not complete it; Add Proof does.
- An assigned person leaves: their open enrolment and task are closed when their record is archived
  (`employee.archived`, `training.close_leaver`); a certificate already issued stays valid.
- Assigned twice (two assignments reach one person): one enrolment, the earlier due date.
- A Library starter who is then assigned: moved onto the assignment with its due date (§6.7).
- The certificate PDF fails to render: the outbox retries; Download Certificate waits for it
  (`ExportFile` pending); the completion stands.
- A YouTube video made private or removed: the player shows YouTube's message; Mark Done still works.
- Draft With AI or Draft Lesson with no AI connection: the button says it is unavailable; nothing
  changes.
- A scanned PDF to Draft With AI: "No text in this file"; nothing is sent.
- A huge audience (everyone, 300 people): one transaction enrols them (three statements, whatever
  the size); tasks and notices are outbox work, a place per transaction, read 50 at a time.

## 12 · Donor code

| From | File | Change on the way in |
|---|---|---|
| praxis-ls | `src/modules/hr/sop_onboarding/` (REUSE_MAP §11) | The idea of a department's procedure as steps with an owner. Versions, the head's authority, screen links and Draft With AI are this guide's |
| pixie | `src/modules/help_center/` (REUSE_MAP §11) | Not used: its articles served FAQs, which are gone (K1) |
| this repository | `policies` (versions, signatures, letterhead PDF), `signatures.verify` (verification), `documents.generate` | Reused in place, not copied: shared helpers are called, never duplicated |

## 13 · Open questions

1. MyCity's SOPs: TB collects each department's current procedures (Marketing first) for staging's
   demonstration and for the heads to enter in production. Not a build question.
2. Renewal (an annual refresher that falls due again a year after completion) is not in M10; asked
   of MyCity at the demo.
3. Line managers seeing their team's training: not in M10 unless MyCity asks at the demo.
4. ~~MyCity signs off the certificate sample~~ Answered 11/11/2026: Cynthia approved the sample as
   drawn: the wording ("Certificate of Completion", "This is to certify that", "has successfully
   completed the training", "Published this training"), "Learning & Development" under the wordmark,
   the seal's ring "MyCity App Ltd · Certified Training", and one signature, the publisher's.

## Appendix A · Build plan

Each PR is full stack where it says so, contract first, and leaves `npm run ci` green on Node 20.

| PR | Branch | Holds | After |
|---|---|---|---|
| 0 | `m10/knowledge-guide` (built on `claude/great-lovelace-c21qmp`) | This guide, the tracker, MILESTONES §15 and §18 amended, the certificate sample, index rows, CODEOWNERS, DATABASE_SCHEMA M10 pointer; FAQs removed from the code (§6.1: the tab, its mock and INTERIM types, the route map, ⌘K, Coming Soon, the `faq` record type and category, the catalogue's description) and ESS · My Training added with `npm run new:screen` (an empty screen); PROGRESS #64 Dropped, #110 added | |
| 1 | `m10/knowledge-data` | Contracts `knowledge.js` (SOPs) and `training.js`; migrations `10400`, `10410`; seed `10490`; the capabilities in `access.catalog.js`; numbering schemes; the `training` module's folder and CODEOWNERS line; the record types `sop`, `training_course`, `training_enrolment`; `gen:contract` | 0 |
| 2 | `m10/sops` | The SOPs backend (repo, service, controller, routes, events, search, AI reads, `sop-draft`), `for-screen`; the SOPs tab and the Procedures list in the User Guide's help, on the contract, desktop and phone, its mock in the contract's shapes; tests | 1 |
| 3 | `m10/training` | The training backend (courses, items, publish with signature, assignments, enrolments, tasks, progress, proof, completion, reminders, `training-lesson-draft`, search, AI reads); tests including 300 people assigned at once | 1 |
| 4 | `m10/certificates` | `training-certificate.html` from the signed-off sample, the embedded fonts, `training.issue_certificate`, verification on `go.mycityapp.io`; tests that render real PDFs | 3 |
| 5 | `m10/training-screens` | Knowledge Hub · Training and ESS · My Training on the contract, desktop and phone (YouTube player, viewer, proof), the CSP's `frame-src`, the mock in the contract's shapes, the INTERIM types deleted | 3, 4 for Download Certificate |
| 6 | `m10/knowledge-release` | Staging seed through the services (two SOPs for each of MyCity's five departments, two real courses, NDPA assigned to Implementation; §6.12), the User Guide chapter's SOPs and Training sections and the ESS chapter's My Training with pictures, empty stubs deleted, PROGRESS Status, Appendix B ticked on staging | 2, 5 |

## Appendix B · Demo checklist (18 December 2026)

- [ ] Marketing's head writes an SOP with Draft With AI from a pasted procedure, links a step to a
      screen and publishes it; the department is told; it shows under Procedures on that screen.
- [ ] Someone without the headship or `sops.manage` reads it and cannot edit it.
- [ ] People build a course with a PDF, a YouTube video, an outside course link and a lesson drafted
      with Draft Lesson, require proof, publish it with a signature and assign it to a department
      with a due date.
- [ ] A member of that department sees the task and the notice, takes the course on a phone, adds
      proof and downloads the certificate; the task closes.
- [ ] The certificate's QR opens Verify a Document with both verdicts matching.
- [ ] A Library course is taken by someone not assigned.
- [ ] Remind Overdue reminds the overdue; Praxis AI answers "which training am I overdue on?" and,
      for People, "who has not finished NDPA training?".
- [ ] ⌘K finds an SOP, a course and My Training; FAQs are nowhere.

## 14 · Change log

- 13/11/2026 · TB · My Notes on desktop (§6.13): Minimise Notes, Open Notes, Close Notes and Try Again did nothing on desktop. A press anywhere on the bar took the pointer for dragging, so the button's click went to the bar. `NoteTaker` now starts a drag only from the bar itself or Move Notes; a test presses each button with the pointer. The phone was not affected.
- 12/11/2026 · TB · Training · Settings: the Library and Proof Required switches are named by their words again (a screen reader heard "Switch", since their titles carry a help term); `ToggleRow` takes a `label` for its switch. Found while filming the Milestone 10 video (`docs/runbooks/training-videos.md` §7).
- 12/11/2026 · TB · My Notes (§6.13), at TB's request for the Milestone 10 video: one running note per person and course, saved as they type and theirs alone (`training_note`, migration `10440`; `GET` and `PUT /training/me/courses/:id/note`; `training.note_saved`, audit only, its length never its text). Take Notes on My Training's course opens `NoteTaker` (new in `packages/ui`): it floats over the course without blocking it, moves by its bar or the arrow keys on desktop, docks top or bottom on a phone, minimises to its bar and closes. Praxis AI reads no note (`personal:`).

- 11/11/2026 · TB · The staging seed's first run on staging left both PDFs out: Chromium, started from the command line as `mycity-stg`, could not write that user's HOME. The PDF service now gives it the temp folder then, as the services do, and the seed gives an existing course the items it lacks, in their place (§6.12), so a second run adds them.
- 11/11/2026 · TB · PR 6 built: the staging seed (§6.12: ten SOPs across MyCity's five departments, published quietly; NDPA Data Protection Essentials and Partner Outreach, real courses of checked YouTube videos, our lessons and PDFs and free outside courses; NDPA assigned to Implementation), the User Guide's Training section (Knowledge Hub chapter, which now names M10) and My Training (Employee Self-Service chapter), with pictures. Decided on the way: Publish SOP takes `quiet` from the seed only, so MyCity's staff are not told of demonstration SOPs (§7); the empty `knowledge-embed` job stub is deleted, since the hub's AI reads are queries, not vectors (`praxis-ai.md` §1 item 6).
- 11/11/2026 · TB · Two fixes after PR 5, from TB's walk of staging. The certificate (and every PDF made before Settings · Organisation holds a Logo) prints MyCity's lockup, the pin and "MyCityApp" in City Green, from `assets/brand/logo.png`; the certificate's last resort is the drawn pin and the name, not a square (§6.9). On My Training a PDF grows to its pages instead of scrolling inside a frame, so the pane beside the list, or the sheet on a phone, scrolls through it to the item's actions and back; All Items sits at the foot as well as the top, and opening an item or going back starts at the course's top (§10). A certificate already issued keeps its PDF.
- 11/11/2026 · TB · PR 2 built: the `knowledge` module (§5 to §9), Knowledge Hub · SOPs on the contract, desktop and phone, and Procedures under a screen's section of the User Guide. Decided on the way: `GET /knowledge/sops/departments` added (§5), because most staff hold no `people` view and so cannot read `/departments` for the chips, and a head's New SOP needs the departments they write for; a draft's Purpose, when given, is 10 characters or more at Save Draft too (the contract), and Publish asks for a purpose and a step (§6.3); a step's file is claimed for the SOP as `sop_file` and read by every `knowledge` viewer; the content hash is a new canonical payload, `SOP_VERSION` (`shared/documents/canonical.js`, pinned in its test); ⌘K's New SOP shows for heads too (`orHead`, `shared/search/actions.js`), and a writer finds their departments' drafts in ⌘K (§9). `knowledge.embeddings.js`, empty and unused, is deleted.
- 11/11/2026 · TB · PR 5 built: Knowledge Hub · Training and ESS · My Training on the contract,
  desktop and phone (§10), walked on the live API (a course built with a lesson, a YouTube link and
  a PDF, reordered, published with a drawn signature, assigned to everyone; taken on a phone to its
  certificate number). The Training tab follows `training.manage` in both mirrors; ⌘K's New Course;
  the staff host's CSP frames `youtube-nocookie.com`. Decided on the way: a lesson crosses the wire as
  the editor's HTML (`lesson_html` in `ItemCreate`, `TrainingItem` and `LessonSuggestion`), kept as
  Markdown by the server's one converter, as Policies' text is, because `RichTextField` speaks HTML
  and no screen converts text itself (§5, §6.5); nothing loads from YouTube, and no uploaded video is
  fetched, until Play Video (`VideoPlayer`, new in `packages/ui`); a course's items are kept in order
  with `OrderList` (new: drag on desktop, Move Up and Move Down in each item's menu everywhere); an
  item opens in place in the course (All Items, Next Item), so a phone never stacks a sheet on a
  sheet; Undone reads Mark Not Done (a button is Verb Noun); a course's title and summary are changed
  in Settings' Course Details. Download Certificate on My Training (the Completed list and the
  completed course) and on Training · People, on PR 4's two routes, walked on the live API to the
  PDF.
- 11/11/2026 · TB · PR 4 built: the certificate (§6.9, §6.10). Cynthia approved the sample as drawn
  (§13 item 4). Decided on the way: the certificate draws its own page (`draw`, no letterhead) from
  the template; the QR opens `/verify/<number>`, as the number alone shows a certificate; the holder's
  name and course title it states are kept at completion (migration `10430`), so the content verdict
  holds after a rename; a certificate is verifiable once its PDF exists; Download Certificate waits on
  `GET /exports/:id`, which now answers for a generated document the caller may read (foundation.md
  §6.12); "Certificate ready" on `document.generated`; the facts read "items", as §6.9 says, where
  the sample read "lessons"; Verify a Document's `document_type` gains `training_certificate` and its
  result a `certificate` part (offers.md).
- 11/11/2026 · TB · PR 3 built: the `training` module (§5's routes for `/training` but Download
  Certificate's two, which come with the certificate in PR 4), Draft Lesson, the reminder, joiners
  and leavers, ⌘K and the AI reads. Decided on the way: a place's task and notice are set by the
  worker one place per transaction (`training.enrolled` tells the person); roles change on
  `access.roles_set`, not `user.roles_changed`, and a leaver is closed on `employee.archived`; an
  item removed (or Proof Required turned off) completes, in the same transaction, anyone now done; a
  task may name a `training_enrolment` (migration `10420`); the certificate's hash is the canonical
  payload `TRAINING_CERTIFICATE`; My Training opens a course by its id or the person's enrolment's;
  an assignment naming only people keeps Keep Assigning off; Assigned counts everyone on the course;
  ⌘K's two course groups take the words course, courses, learning (and certificate), never "training",
  which would turn a search for "Training Week" into a search of My Training.
- 11/11/2026 · TB · PR 1 built: the contracts, migrations `10400` and `10410`, seed `10490`, the capabilities and schemes (§4, §8). Decided on the way: a published SOP version's CHECK spells out `version IS NOT NULL` (a CHECK lets NULL through); `training_item`'s position is unique at commit, so a reorder can swap two; a change to an item sends the whole item (`ItemCreate`, no second schema); My Training's lists are one query, `list` (`to_do`, `in_progress`, `completed`, `library`). Settings · Documents & Numbering lists the three new schemes (SOP, Training Course, Training Certificate).
- 11/11/2026 · TB · Written from TB's eight answers of 11/11/2026 and the Modules Review of 4
  November 2026: FAQs leave the hub (Announcements left on 29/10/2026); SOPs are each department's
  own structured, versioned procedures written by its head or `sops.manage`, read by everyone,
  linked from the screens their steps name; Training is a course of files, video links, course
  links and lessons, assigned to everyone, departments, roles or people with a due date and a task,
  or open in the Library; completion by Mark Done with optional proof, and a signed MyCity
  certificate issued automatically with the publisher's signature, a number and a QR verified on
  `go.mycityapp.io`; Draft With AI and Draft Lesson on the Default job. The certificate sample drawn
  (`docs/MyCity-ERP-Documents/training-samples/`). In code: FAQs removed (§6.1; ⌘K's "faq" and
  "questions" now find the User Guide) and ESS · My Training added as an empty screen with
  `npm run new:screen`.
