# Policies · Engineering Guide

| | |
|---|---|
| Owner | TB |
| Milestone | M1 (Knowledge Hub · Policies brought forward from M10 by TB, 20/10/2026) |
| Backend modules | `policies` |
| Frontend paths | `app/src/features/policies/` |
| Permission key(s) | `knowledge` (view, create, edit, delete) with the capability below for Knowledge Hub · Policies; none for a person's own policies and acknowledgements (`self`, own only); an approval's own approvers for a version waiting on them (`shared/workflow`) |
| Capabilities | `policies.manage` (write, publish, withdraw and archive policies, and see who has acknowledged them; Knowledge Hub · Policies) |
| Screens (PROGRESS.md rows) | #62 Policies, #89 Policy Updates; the acknowledge sheet over any screen; #73 Settings · Attendance Policy is dropped, its worksheet is the Attendance policy here |
| Status | Built |
| Last changed | 20/10/2026 |

Sources, in their order of authority (CLAUDE.md step 3): TB's decisions of 20/10/2026 (§1.1), which
bring Knowledge Hub · Policies forward from M10 and retire Settings · Attendance Policy (MILESTONES
§18, ratified 20/10/2026); MILESTONES §15 (articles versioned and permission-filtered); A18 and A23
(AI tidies text a person then accepts, and never writes); A12 (two hashes on a signed document);
`attendance.md` §6.15, which owns the Attendance policy's rules and what the clock does with them.
`demo.html` is look only.

---

## 1 · What it is for

MyCity keeps every company policy in one place, Knowledge Hub · Policies, where Operations & People
write it, send it for approval when it needs one, sign it and publish it as a numbered version from
a first day. A policy is either a **document** (pasted or typed, tidied, printed on the letterhead)
or a **rules policy** of a type the code knows (today, **Attendance**): a worksheet of switches,
figures and choices that the system enforces, so a rule is entered, never programmed. Staff read
the policies that apply to them on ESS · Policy Updates, as clean text or plain sentences with what
changed marked, and acknowledge each new version with one tap.

### 1.1 Decisions (TB, 20/10/2026, binding)

| # | Question | Answer |
|---|---|---|
| P1 | Where policies live | Knowledge Hub · Policies, for every policy. Settings · Attendance Policy (#73) is retired; the Attendance policy is a rules policy here |
| P2 | Who reads, who writes | **ESS for staff, the Hub for HR.** Staff read and acknowledge on ESS · Policy Updates; Knowledge Hub · Policies is Operations & People's workspace (the `policies.manage` capability) |
| P3 | Acknowledging | A sheet after the person clocks in shows what changed, with Acknowledge and Later. Later works until a due date HR sets (default 7 days); after it the sheet returns at every sign-in. It never blocks the clock. The record keeps the version, the time and the device |
| P4 | Who a policy is for | **Applies To**: everyone, or any mix of departments, work patterns and named people. Only they are asked; someone who joins and fits is asked from their first day. An IT policy never reaches Marketing |
| P5 | Who publishes | Operations & People (and the CEO). No approval unless the policy asks for one (P6) |
| P6 | Approval and signing | **One route, a switch per policy.** Settings · Approvals holds the Policy Approval route (its stages are People's to set: the Program Manager, the CEO, either or both). A policy with Needs Approval on is submitted, and each approver approves and signs before it can start; with it off, HR publishes and signs alone. The PDF carries every signature with name, title and date |
| P7 | A written policy | Pasted raw or typed raw; **Tidy With AI** offers a clean version (headings, numbered clauses, lists) that HR compares and accepts. Printed on the letterhead with the publisher's signature (and the approvers'). No uploaded file stands in for the text |
| P8 | Rules policies | A type the code knows opens a worksheet instead of an editor: switches, figures and choices, each with a suggested value HR may change. The system enforces what is set. Attendance is the first type |

## 2 · Screens affected

| Screen / tab (slug) | Where | Who sees it | What it shows | What a person can do there |
|---|---|---|---|---|
| Knowledge Hub · Policies (`policies`) | Knowledge Hub | `knowledge` view with `policies.manage` (Operations & People, Implementation, the CEO) | Every policy: number, title, type (Document, Attendance), Applies To, the version in force, its state (Draft, Awaiting Approval, Starts on a date, In Force, Archived) and how many of those asked have acknowledged it. A policy opens with its draft (the editor or the worksheet), its versions and, for a version, who has acknowledged it | New Policy (a document); open the Attendance policy (always listed); Save Draft, Discard Changes, Tidy With AI, Submit for Approval or Publish Policy (first day, note, signature), Recall Submission, Withdraw Version before its first day, Download PDF, Archive Policy (documents only); set Applies To, Needs Acknowledgement, Acknowledge Within and Needs Approval |
| ESS · Policy Updates (`policy-updates`) | Employee Self-Service | Every employee, the policies that apply to them; an approver, the versions waiting on them | To Acknowledge first (title, version, due date), then every policy that applies to them; a policy opens as clean text or sentences with what changed marked, its version, first day and signatures; its earlier versions; Waiting On You for an approver | Acknowledge, Read Policy, Download PDF; an approver: Approve Policy (with their signature) or Reject Policy (with a reason) |
| Acknowledge sheet | Over any screen, after the clock (§6.7) | A person with a version to acknowledge | One policy at a time: title, New Policy or Version N, What Changed, the due date | Acknowledge, Read Full Policy, Later (until the due date) |
| Settings · Approvals (`approvals`, foundation.md §6.5) | Settings | `settings` edit (Operations & People) | The Policy Approval route among the others | Change its stages (who approves, in what order) |
| Notifications (bell, push) | Global | The people asked; the approvers; the submitter | A new policy or version, a reminder to acknowledge, a version waiting for approval, approved or rejected, withdrawn | Open the policy |
| ⌘K | Global | As the screens | Policies by number and title | Open the policy |
| Praxis AI | Global | As the screens | Answers from the policies that apply to the reader, citing the version | Open Policy Updates or the policy |

## 3 · How the screens relate

1. **HR writes a policy** (Knowledge Hub · Policies, New Policy): a title, Applies To, whether it
   needs acknowledgement (and within how many days) and whether it needs approval. The body is
   pasted or typed into the editor; Tidy With AI sends it to `POST /policies/tidy` and shows the
   clean version beside the original; Use Tidied Text replaces the body, Keep Mine leaves it. Save
   Draft keeps it (`policy_version`, status `draft`); nobody is told.
2. **The Attendance policy** is always in the list. Opening it shows the worksheet of
   `attendance.md` §6.15: the rules in force, a draft when there is one, each rule a switch, figure
   or choice with its suggested value. Save Draft keeps every rule; a rule the draft changes is
   tagged Changed.
3. **Publishing.** Publish Policy (no approval) asks for the first day, a note on what changed and
   the publisher's signature; the draft becomes `Version N` (§6.3) and `policy.published` tells
   everyone it applies to. Submit for Approval (approval on) asks for the same, opens the
   `policy.approval` workflow in the same transaction (status `submitted`) and tells its first
   approver.
4. **Approving.** The approver opens the notice on ESS · Policy Updates (`?version=`): the version
   as staff will read it, the note, the publisher's signature. Approve Policy takes their signature
   and moves the approval on; the last approval publishes the version (§6.4). Reject Policy needs a
   reason; the version returns to the draft and the submitter is told.
5. **After commit** the outbox notifies the people asked (bell, push as their Knowledge Hub
   preference allows). Download PDF makes the version's PDF on the letterhead with every signature
   when it is pressed (`documents.generate`, doc type `policy_pdf`, an export downloaded on the
   device that asked, foundation.md §6.12).
6. **Staff acknowledge.** After the person's clock-in (or, on a day they do not clock in, once the
   sign-in prompt is answered) the shell opens the acknowledge sheet for each version they owe,
   oldest due first. Acknowledge records it; Later closes it for the day until the due date, after
   which it returns at every sign-in. ESS · Policy Updates lists the same, and every policy that
   applies to them.
7. **Reminders.** The reminder engine reminds once, 3 days after publication, everyone asked who
   has not acknowledged (`policy_unacknowledged`, notifications.md §7.1).
8. **Rules take effect.** A rules policy's version in force on a date is what its module reads for
   that date (`policies.rulesFor(client, kind, date)`, §6.8). The Attendance policy's version in
   force judges each punch and each day; Home's alerts and the query rules read their thresholds
   from it (`attendance.md` §6.15, `home.md` §6).

## 4 · Data

| Table | Key columns | Notes |
|---|---|---|
| `policy` (1400) | `number` (`POL-0001`), `kind` (`document`, `attendance`), `title`, `status` (`active`, `archived`), `archived_at`, `archived_by`, `archive_reason`, `created_by`, `updated_by` | One row per policy. One `attendance` policy at most (partial unique index), created by `1405` with no version so it is always listed; its rules are MyCity's, entered on the worksheet (A26) |
| `policy_version` (1400) | `policy_id`, `status` (`draft`, `submitted`, `published`, `withdrawn`), `version` (null until published), `effective_from`, `note`, `title`, `body_markdown` (documents), `rules` (jsonb, rules types), `applies_to_everyone`, `needs_acknowledgement`, `acknowledge_within_days`, `needs_approval`, `content_hash`, `workflow_instance_id`, `document_id` (the PDF), `submitted_at`, `submitted_by`, `published_at`, `published_by`, `withdrawn_at`, `withdrawn_by`, `withdraw_reason`, `created_by`, `updated_by` | At most one draft and one submitted version per policy; version numbers unique per policy and never reused. A published version is never edited. `rules` is checked by the type's contract on every write and read with the type's defaults, so a rule added later reads as its default (off) on older versions; it is read whole, never filtered, so jsonb. The text is Markdown, the one renderer's (§6.6) |
| `policy_audience` (1400) | `policy_version_id`, one of `department_id`, `work_pattern`, `employee_id` | Applies To beyond everyone; rows, because who is asked is filtered in SQL |
| `policy_signature` (1400) | `policy_version_id`, `role` (`publisher`, `approver`), `stage_key`, `user_id`, `employee_id`, `signer_name`, `signer_title`, `signed_at`, `signature_document_id`, `content_hash` | One per signer per version. The drawn signature is a PNG in the vault, kept only for this version (COMPONENTS, SignatureField); name and title are copied at signing |
| `policy_acknowledgement` (1400) | `policy_version_id`, `employee_id`, `acknowledged_at`, `reminded_at`, `deferred_on`, `content_hash`, `known_device_id` | One per person and version (unique). `deferred_on` is the day Later was last pressed |

Schema migrations: `migrations/1400_policies.sql` (the four tables) and
`migrations/1405_policies_from_attendance.sql` (the Attendance policy's versions and acknowledgements
moved from `attendance_policy` and `attendance_policy_acknowledgement`, keeping their ids, and
`attendance_event.policy_version_id` for punches from then on; an older punch keeps the same id in
`attendance_policy_id`, since the table is append-only). Reference data:
`seeds/reference/1396_seed_policies.sql` (the `policy` numbering scheme, `POL-0001`, and version 1
of the `policy.approval` workflow: one stage, the CEO; People change it on Settings · Approvals, and
the `policies.manage` capability for Operations & People and Implementation). Nothing about a
person, a policy or its text is seeded (A26). The M1 block for this work is 1400 to 1419
(`attendance.md` §1.2 lists the blocks of the four PRs).

`attendance_policy` and `attendance_policy_acknowledgement` stay, read by nothing, until a later
release drops them (MIGRATIONS §8). Knowledge Hub's article tables (`10000`) are M10's, for SOPs,
FAQs and training; policies do not use them.

## 5 · API

| Method and path | Contract | Permission · scope | Paged | Notes |
|---|---|---|---|---|
| `GET /api/v1/policies` | `PolicyListQuery` (`kind`, `state`, `q`, `sort`) → `PolicyPage` | `knowledge` view, `policies.manage` | yes, 25 | The Attendance policy is listed even before it has a row (`policy_id` null, Default Rules) |
| `POST /api/v1/policies` | `PolicyCreate` (`title`, `applies_to`, `needs_acknowledgement`, `acknowledge_within_days`, `needs_approval`) → `Policy` | `knowledge` create, `policies.manage` | no | A document policy with an empty draft; numbered |
| `GET /api/v1/policies/:id` | → `Policy` | `knowledge` view, `policies.manage` | no | The policy, its version in force, a version waiting, the draft with what it changes, the submission in flight, `can_edit`. The Attendance policy always has a row (1405); a link that names `attendance` (`?policy=attendance`) is resolved by the screen from the list filtered to that type |
| `PUT /api/v1/policies/:id/draft` | `PolicyDraftSave` (`title`, `applies_to`, the switches, and `body_html` or `rules`) → `Policy` | `knowledge` edit, `policies.manage` | no | Creates the draft when there is none; `body_html` is sanitised (§6.6); `rules` checked by the type |
| `POST /api/v1/policies/:id/draft/discard` | `EmptyBody` → `Policy` | `knowledge` edit, `policies.manage` | no | 409 `NO_DRAFT` |
| `POST /api/v1/policies/tidy` | `PolicyTidy` (`body_html`) → `PolicyTidyResult` (`body_html`) | `knowledge` edit, `policies.manage` | no | A suggestion only; nothing is saved (§6.6). 503 `AI_UNAVAILABLE` with no AI connection |
| `POST /api/v1/policies/:id/publish` | `PolicyPublish` (`effective_from`, `note`, `signature`) → `Policy` | `knowledge` edit, `policies.manage` | no | Needs Approval off; the checks of §6.3 |
| `POST /api/v1/policies/:id/submit` | `PolicyPublish` → `Policy` | `knowledge` edit, `policies.manage` | no | Needs Approval on; opens `policy.approval` |
| `POST /api/v1/policies/:id/recall` | `PolicyReason` (`reason`) → `Policy` | `knowledge` edit, `policies.manage` | no | A submission still waiting goes back to the draft; the approval is cancelled |
| `POST /api/v1/policies/versions/:id/withdraw` | `PolicyReason` → `Policy` | `knowledge` edit, `policies.manage` | no | A version waiting to start only (409 `POLICY_NOT_WAITING`) |
| `POST /api/v1/policies/:id/archive` | `PolicyReason` → `Policy` | `knowledge` delete, `policies.manage` | no | Documents only (422 `CANNOT_ARCHIVE` for a rules policy) |
| `GET /api/v1/policies/:id/versions` | `PolicyVersionListQuery` → `PolicyVersionPage` | `knowledge` view, `policies.manage` | yes, 25 | Newest first, with acknowledgement counts |
| `GET /api/v1/policies/versions/:id` | → `PolicyVersion` | `knowledge` view, `policies.manage` | no | Its text or sections, what changed, signatures |
| `GET /api/v1/policies/versions/:id/acknowledgements` | `PolicyAckListQuery` (`status`, `q`, `sort`) → `PolicyAckPage` | `knowledge` view, `policies.manage` | yes, 25 | Everyone asked, acknowledged, pending or overdue |
| `POST /api/v1/policies/versions/:id/pdf` | `EmptyBody` → `ExportFile` (202) | `knowledge` view, `policies.manage` | no | The version's PDF, downloaded on the device that asked (foundation.md §6.12) |
| `GET /api/v1/policies/me` | `MyPolicyListQuery` (`state`: `to_acknowledge`, `all`, `waiting_on_me`) → `MyPolicyPage` | self, own | yes, 25 | The policies that apply to the person, To Acknowledge first; `waiting_on_me` the versions an approval waits on them for |
| `GET /api/v1/policies/me/due` | → `MyPolicyDue` | self, own | no | What the acknowledge sheet shows now (§6.7): the versions owed, the oldest due first, and whether Later is still allowed |
| `GET /api/v1/policies/me/versions/:id` | → `MyPolicyVersion` | self, own | no | A version that applies to them, or one waiting on them as approver; anyone else's is a 404 |
| `POST /api/v1/policies/me/versions/:id/acknowledge` | `EmptyBody` → `MyPolicyVersion` | self, own | no | The newest published version of a policy that applies to them (409 `POLICY_NOT_LATEST`); again is a no-op |
| `POST /api/v1/policies/me/versions/:id/later` | `EmptyBody` → `MyPolicyDue` | self, own | no | Until the due date (409 `ACKNOWLEDGEMENT_OVERDUE` after) |
| `POST /api/v1/policies/me/versions/:id/pdf` | `EmptyBody` → `ExportFile` (202) | self, own | no | |
| `POST /api/v1/policies/me/versions/:id/approve` | `PolicyApprove` (`signature`) → 204 | the stage's approvers | no | Signs and approves the stage through the engine (`shared/workflow` `act`); 403 when it does not wait on them |
| `POST /api/v1/policies/me/versions/:id/reject` | `PolicyReason` → 204 | the stage's approvers | no | The version returns to the draft |

The attendance module's policy routes (`/attendance/policy...`, `/attendance/me/policy...`) are
removed with Settings · Attendance Policy; what the clock reads is unchanged (§6.8).

## 6 · Rules and calculations

### 6.1 Types

- A policy's `kind` is fixed when it is created. `document` policies hold `body_markdown`; a rules
  type holds `rules`. The types are a registry in code (`policies.types.js`): each names its contract
  schema (checked on save), its defaults and suggestions, its sections and the sentence for each
  rule, and the module that enforces it. `attendance` is registered by the attendance module
  (`attendance.policy-type.js`), which owns its rules (`attendance.md` §6.15).
- The sentences staff read are the server's (the type's `sentences(rules)`), so the screen, the PDF,
  the search index and Praxis AI read the same words. A changed value changes its sentence. They
  replace `app/src/features/attendance/policy-text.ts`.
- One `attendance` policy (one organisation policy, `attendance.md` §6.1). It cannot be archived.

### 6.2 The draft

- One draft per policy at a time. Save Draft writes every field; the first save creates it. A
  document's text is turned into Markdown (§6.6) and must hold some text to publish; a rules draft is checked by the
  type's draft schema (stricter than its read schema: the Attendance home radius is at least 150 m
  on a new version, though older versions keep theirs).
- `changed` lists what the draft changes against the version it would replace (the newest
  published one, waiting or in force): each rule that differs, or for a document the sections whose
  text differs, and Applies To.
- Discard Changes deletes it. Neither tells anyone; both are audited with before and after.
- While a version is submitted, the draft cannot be saved (409 `POLICY_SUBMITTED`): recall it first.

### 6.3 Publishing without approval

- Under the policy's lock: a draft (409 `NO_DRAFT`) that changes something once a version exists
  (409 `NO_CHANGES`); a first day from today in Lagos (422 `POLICY_IN_THE_PAST`) to 90 days ahead
  (422 `POLICY_TOO_FAR`), after any version still waiting (422 `POLICY_BEFORE_WAITING`); a note of
  10 to 500 characters; the publisher's signature (a PNG from `SignatureField`, at most 200 KB).
- The draft becomes `Version N`: the next number for that policy, never reused. `content_hash` is
  the canonical hash of what staff read (the sanitised body or the rules, with the title and Applies
  To; `shared/documents/canonical`). The signature is stored with that hash.
- `policy.published` is emitted in the same transaction; the PDF and the notices are outbox work.

### 6.4 Publishing with approval

- Submit for Approval runs the checks of §6.3, stores the signature, and opens `policy.approval`
  with the version as its subject; status `submitted`. The definition's stages are People's, on
  Settings · Approvals; by default one stage, the CEO. Approver types are the engine's: a role, a
  named person (the Program Manager is a job title, so a named person), the line manager of the
  submitter, or the CEO.
- An approver approves with their signature (stored as `approver`, with the stage) or rejects with
  a reason of 10 to 500 characters. Nobody approves their own submission (the engine).
- When the last stage approves, the version publishes as in §6.3, from the later of its first day
  and the day it was approved (Lagos), so an approval that comes late never starts a policy in the
  past. A rejection or a recall returns it to `draft` with its fields; the trail stays on the
  approval.
- An approval that times out follows its definition (escalate by default).

### 6.5 Versions and states

- States, worked out on the day in Lagos: `draft`, `submitted` (Awaiting Approval), `waiting`
  (published, first day after today), `in_force` (the latest published version whose first day is
  today or earlier), `past`, `withdrawn`. A policy is `archived` when archived, whatever its
  versions.
- Withdraw Version: a waiting version only, with a reason; it never applies and everyone it was
  sent to is told. When there is no draft its content becomes the draft.
- Archive Policy (documents only): it stops applying from that moment; staff no longer see it on
  Policy Updates; its versions and acknowledgements are kept.

### 6.6 A written policy's text

- The editor is `RichTextField` (TipTap): headings (h2, h3), paragraphs, bold, italic, bullet and
  numbered lists, quotes and links. Text pasted from Word or Google Docs keeps those and drops fonts,
  colours and tables (a table's cells become paragraphs).
- The server keeps the text as **Markdown**, the one renderer's grammar (`shared/documents/markdown.js`):
  `htmlToMarkdown` turns the editor's HTML into it keeping only headings, paragraphs, lists, bold,
  italic and links with a safe target (nothing pasted reaches the output as markup), and
  `markdownToBlocks` gives the reader its blocks (`RichTextBlock`), drawn by the shared `RichText`
  component, so no screen injects HTML. The editor loads `markdownToHtml`'s output.
- **Tidy With AI** (`POST /policies/tidy`) sends the body to `services/ai/llm.service.complete`
  (purpose `policy-tidy`, prompt `services/ai/prompts/policy-tidy.md`) on the person's press, never
  inside a transaction. It may add headings, number clauses, turn runs of lines into lists and fix
  spacing and capitals; it never changes, adds or drops wording. What comes back is sanitised and
  shown beside the original; nothing is saved until HR saves the draft (A18's pattern; A23 holds:
  the AI writes no record). The model is chosen under the AI area convention (§13).
- On paper (`documents.generate`, doc type `policy_pdf`, made on Download PDF): the letterhead, the title, number,
  version, first day and Applies To, the body (or the rules' sections and sentences), then a
  signature block per signer (signature, name, title, date) and the content hash.

### 6.7 Who is asked, and acknowledging

- **Asked**: everyone at work (active, started, not left) with an active login whom the version's
  Applies To reaches (everyone; or in one of its departments, or of one of its work patterns, or
  named), counted when read. Someone who joins and fits is asked from their first day.
- **Due**: `acknowledge_within_days` (1 to 30, default 7) after the later of the publication and
  the person's first day.
- **Acknowledge** (`POST .../acknowledge`): the newest published version (waiting or in force) of a
  policy that applies to them (409 `POLICY_NOT_LATEST`), by someone at work (422 `NOT_EMPLOYED`);
  again changes nothing. It stores the time, the session's device and the version's `content_hash`,
  and reads the person's notices about that version.
- **The sheet** (`GET /policies/me/due`): the shell asks once the clock has been answered: after a
  clock-in, or, on a day the person does not clock in, once the sign-in prompt is closed or there was
  none. Before the due date, Later (`POST .../later`) closes it until the next day; after the due
  date Later is gone and the sheet returns at every sign-in, until acknowledged. It never opens over
  the clock panel or a dialog, and never stops the person clocking in or out.
- Acknowledging is a record, never a gate on the clock or on any rule: a rules policy applies to
  everyone it covers from its first day either way.
- **The reminder** (`policy_unacknowledged`, the reminder engine): from 3 days after a version is
  published, once per person and version, between 08:00 and 18:00 Lagos, while it is still the
  newest and still owed. It replaces attendance's `attendance_policy_unacknowledged`.

### 6.8 Rules policies and the modules that enforce them

- `policies.rulesFor(client, kind, date)` gives the rules of the version in force on that date (the
  latest published version whose first day is on or before it), parsed with the type's defaults,
  with the version's id; before any version, the type's defaults and no id. It is the only way a
  module reads its policy.
- A module records the version it applied (`attendance_event.policy_version_id`); a new version
  never re-judges what an older one judged.
- A type's suggestions fill a first draft when no version exists; they are the code's, not seeded,
  and HR changes any of them before publishing (A26).

## 7 · Events, jobs and notifications

| Event / job | When | Does |
|---|---|---|
| `policy.created` | HR creates a document policy | Audit |
| `policy.draft_saved`, `policy.draft_discarded` | Save Draft, Discard Changes | Audit with before and after; nobody is told |
| `policy.submitted` | Submit for Approval | Audit; the approval tells its first approver ("Policy waiting for approval") |
| `policy.recalled` | HR recalls a submission | Audit; the approval is cancelled |
| `policy.rejected` | An approver rejects | Audit; notifies the submitter with the reason |
| `policy.published` | A version is published (directly or on the last approval) | Audit; outbox `policies.notify_published` (everyone asked: "New policy" or "Policy updated", its title, version and first day; push as their Knowledge Hub preference allows); a rules type's own handler (attendance reloads its rules) |
| `policy.withdrawn` | A waiting version is withdrawn | Audit; notifies the same people that it will not apply |
| `policy.archived` | A document policy is archived | Audit |
| `policy.acknowledged` | Someone acknowledges | Audit; their notices about it are read |
| `policy.reminder_due` | The reminder engine fires `policy_unacknowledged` | Notifies the person once per version |
| Reminder `policy_unacknowledged` | Every 5 minutes, 08:00 to 18:00 Lagos | Finds who is owed a reminder (§6.7) |

## 8 · Permissions and visibility by role

| Role | Sees | Can do |
|---|---|---|
| Employee (and everyone) | The policies that apply to them, every published version of them, their own acknowledgements | Acknowledge, Later, Download PDF |
| An approver of a version (whoever the Policy Approval route names) | That version as staff will read it, its note and signatures | Approve Policy with their signature, Reject Policy |
| `policies.manage` (Operations & People, Implementation by default; the CEO holds every capability) | Knowledge Hub · Policies: every policy, draft, version and who has acknowledged it | Write, tidy, submit, publish, recall, withdraw, archive |
| Settings · Approvals (`settings` edit) | The Policy Approval route | Change its stages |

Management, Heads, Line Managers and the System Administrator do not write policies unless given
`policies.manage` on Settings · Roles & Permissions. The acknowledgement report is the capability's:
nobody else sees who has or has not acknowledged.

## 9 · AI and search

- **AI reads** (`policies.ai.js`): `policies.mine` (the policies that apply to the reader, with
  state and due date, own), `policies.read` (one policy's version in force as text or sentences, for
  anyone it applies to; cites the version), `policies.list` (`policies.manage`: every policy with
  its acknowledgement counts). Paged at 25.
- **AI routes**: read or acknowledge a policy → ESS · Policy Updates; write, publish or change a
  policy → Knowledge Hub · Policies; change the attendance rules → Knowledge Hub · Policies
  (`?policy=attendance`). The AI never writes, publishes or acknowledges (A23).
- **Tidy With AI** is the AI action `policy-tidy` (prompt `services/ai/prompts/policy-tidy.md`) on the
  **Default** job (`ai-control.md` §6.2), and it carries personal data, so DeepSeek is never in its
  chain: chosen by TB, 20/10/2026. It joins AI Control's action registry when that is built
  (`ai-control.md` decision 24).
- **Search** (`policies.search.js`): HR find policies by number or title (`policy`, opening
  Knowledge Hub · Policies `?policy=`); everyone finds the published policies that apply to them by
  title (`policy_version`, opening ESS · Policy Updates `?version=`). ⌘K's New Policy opens the form
  for `policies.manage`.

## 10 · On screen and mobile

### 10.1 Content tiers

| Screen | Open (tier 1) | Behind help (tier 2) | Not on screen (tier 3), lives in |
|---|---|---|---|
| Knowledge Hub · Policies | The list (Policy, Type, Applies To, In Force, State, Acknowledged), New Policy; a policy: its title and number, the state, a banner for a version waiting (Starts, Withdraw Version) and one for a submission (Awaiting Approval, the stage, Recall Submission); the draft: the editor with Tidy With AI, or the worksheet (`attendance.md` §10); Policy Settings (Title, Applies To, Needs Acknowledgement, Acknowledge Within, Needs Approval); Save Draft, Discard Changes, Publish Policy or Submit for Approval (a sheet: the changes, First Day, Note, Your Signature); Versions (version, first day, state, published by, acknowledged); a version: its text, signatures, Download PDF, Acknowledgements (Everyone, Acknowledged, Pending, Overdue) | Applies To: who is asked to acknowledge; Needs Approval: the Policy Approval route on Settings; Tidy With AI's result: headings and lists only, the words unchanged | How versions, approvals and the reminder work, what is hashed: §6 here |
| ESS · Policy Updates | To Acknowledge (title, version, due date, Acknowledge), All Policies, Waiting On You (approvers); a policy: title, version, first day, What Changed tags, the text or sentences by section, signatures, Download PDF, earlier versions; Approve Policy (signature) and Reject Policy (reason) for an approver | Due: when Later stops being offered | Why acknowledgement never blocks the clock: §6.7 |
| Acknowledge sheet | Title, New Policy or Version N, up to five What Changed lines, the due date, Acknowledge, Read Full Policy, Later (before the due date) | Nothing | Everything else: Policy Updates |

### 10.2 Phone layout

| Screen | First on a phone | Left off a phone | Main action | Navigation |
|---|---|---|---|---|
| Knowledge Hub · Policies | Policy cards (title, type, state, acknowledged); a policy opens full screen: banners, then the editor or the worksheet's cards, Save Draft at the foot | Subtitle; the Published By column (in the version's sheet) | New Policy in the floating button; Publish Policy or Submit for Approval in the draft's banner opens a full sheet with the signature pad full width | More, then Knowledge Hub |
| ESS · Policy Updates | To Acknowledge cards with Acknowledge full width, then policy cards | Subtitle | Acknowledge, full width; an approver's Approve Policy at the foot of the version's sheet, the pad full width | ESS tabs |
| Acknowledge sheet | A bottom sheet that does not drag away: title, What Changed, Acknowledge full width, Later as a text button | Nothing | Acknowledge | Opens by itself (§6.7) |

Built as follows (20/10/2026). Applies To is Everyone or Some People: departments and work patterns
as chips, named people through the employee picker. The Attendance policy applies to everyone, so its
title and Applies To are fixed on its worksheet. Tidy With AI opens Yours beside Tidied, with Keep Mine
and Use Tidied Text. A row's Acknowledge on Policy Updates acknowledges without opening the policy.

## 11 · Edge cases

- No version of the Attendance policy yet: it is listed as Default Rules (the code's defaults, which
  the clock applies); opening it starts a draft from the type's suggestions.
- A version submitted, then the policy's draft edited: refused while it is submitted; recall it.
- Approved after the first day it was given: it starts on the approval day (Lagos), never in the
  past; the notice says so.
- The last approver is the submitter: the engine refuses their own approval; the route needs
  another approver (People change it on Settings · Approvals).
- Applies To narrowed in a new version: people no longer covered are no longer asked; their earlier
  acknowledgements stay. Widened: the new people are asked from that version.
- Someone moves department: asked for what reaches their new department from the day they move;
  earlier acknowledgements stay.
- Someone who left: no longer asked; their acknowledgements stay.
- Later after the due date: 409 `ACKNOWLEDGEMENT_OVERDUE`; the sheet returns at the next sign-in.
- Two people saving a draft at once: the last save wins; publishing and submitting take the
  policy's lock.
- Tidy With AI with no AI connection, or the vendor failing: the button says it is unavailable; the
  draft is untouched.
- Pasted text with images or tables: images are dropped, a table's cells become paragraphs; the
  editor shows the result before it is saved.
- A rules version waiting when another is submitted: the new one must start after it.
- A signature pad left empty: Publish Policy and Approve Policy refuse it on the field.
- The PDF not yet rendered: Download PDF waits for it (`ExportFile` pending), as every export does.

## 12 · Donor code

| From | File | Change on the way in |
|---|---|---|
| praxis-ls | `client/src/features/hr/house-rules.tsx` (REUSE_MAP §11) | The idea only: a list of policies with their text. Versions, Applies To, approval, signatures and acknowledgement are this guide's; rules policies are new |
| pixie | `src/modules/help_center/` | Not used for policies: its articles serve SOPs and FAQs in M10 |

## 13 · Open questions

- Further rules types (Leave, Expenses) are added the same way when their modules want them; none is
  decided.
- A public verification page for a signed policy (A12, the PDF's hash) waits for M5's Verify
  Document.

## 14 · Change log

- 20/10/2026 · TB · Tidy With AI's job chosen under the AI convention merged from main (#101): Default, carrying personal data, never DeepSeek (§9); the open question on its model is closed.
- 20/10/2026 · TB · Built (PR 1): migrations 1400 and 1405, seed 1396, the `policies` module and its contract; Knowledge Hub · Policies (`PoliciesHub.tsx`: the list, a policy opened with `?policy=`, its draft in `PolicyDraft.tsx` with the editor and Tidy With AI or the Attendance worksheet, the publish, submit and reason sheets in `PolicyForms.tsx`, its versions and acknowledgements), ESS · Policy Updates (`PolicyUpdates.tsx`) and the acknowledge sheet (`AcknowledgeSheet.tsx`, mounted by the shell beside the clock prompts); `RichText` added to `packages/ui`. The draft carries the people Applies To names (`applies_to_people`) and a rules policy its type's suggestions (`suggested_rules`). Left: nothing in PR 1.
- 20/10/2026 · TB · Written from TB's decisions of 20/10/2026: Knowledge Hub · Policies brought forward from M10 as the one place for every policy, documents and rules policies (Attendance first), versions from a first day, Applies To, an optional approval route with signatures, Tidy With AI, the letterhead PDF, and acknowledgement on ESS · Policy Updates with a sheet after the clock. Settings · Attendance Policy (#73) is retired into it.
