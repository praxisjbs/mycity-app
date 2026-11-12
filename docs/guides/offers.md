# Offers, Documentation & Onboarding · Engineering Guide

| | |
|---|---|
| Owner | AJ |
| Milestone | M5 |
| Backend modules | `offers`, `signatures`, `onboarding`, `employment_contracts` |
| Frontend paths | `app/src/features/recruitment/Offers.tsx` (with `OfferForm.tsx`, `OfferSign.tsx`, `OfferSettings.tsx`), `app/src/features/recruitment/Onboarding.tsx` (with `OnboardingCase.tsx`, `OnboardingSettings.tsx`), `app/src/features/people/EmployeeDocuments.tsx`, `public-app/src/pages/SignOffer.tsx`, `public-app/src/pages/Verify.tsx`, `public-app/src/pages/UploadDocuments.tsx` |
| Permission key(s) | `recruitment` (offers and onboarding cases); `people` (the hire's documents on the Employee 360) |
| Capabilities | none; who approves an offer is the `recruitment.offer` flow on Settings · Approvals, not a capability |
| Screens (PROGRESS.md rows) | #42 Offers, #43 Onboarding; public #84 Sign Offer, #85 Verify Document, #112 Upload Documents (added with PR 6a; `new:screen` makes staff-app tabs only); changes to #39 Candidates (the Offer column, GE), People · Employee 360 (a Documents tab), Settings · Approvals (#72) |
| Status | Built |
| Last changed | 12/11/2026 |

The public pages (`public-app/src/pages/SignOffer.tsx`, `Verify.tsx`) joined **Frontend paths** with
PR 4, which wired them; Upload Documents with PR 7. The People 360 Documents tab joined with PR 7 as
its own file, `EmployeeDocuments.tsx`, so a change to the rest of `app/src/features/people/` still
asks only for `foundation.md`, which owns that folder (the tab is on `documents`' routes, track B).

---

## 1 · What it is for

Turns a shortlisted candidate into an employee. Operations & People make an offer from a template,
it is approved and sent, the candidate reads it and signs it on a phone, the employment contract is
generated and signed, the candidate's documents are collected and checked, and the department's
onboarding plan is worked through. The candidate and every hire's documents end up on the
employee's record. Used by Operations & People, hiring managers, the approvers of the offer flow,
the candidate (on `go.mycityapp.io`) and anyone verifying a document.

## 2 · Screens affected

| Screen / tab (slug) | Where | Who sees it | What it shows | What a person can do there |
|---|---|---|---|---|
| Recruitment · Offers (`offers`) | staff app | `recruitment` view; a hiring manager their vacancies (team scope) | every offer: number, candidate, role, compensation, status, expiry; the offer's letter as the candidate will read it, its approval chain and signers | New Offer (from a shortlisted application), Edit, Submit for Approval, Approve and Reject (approvers), Send Offer, Resend, Withdraw, View Letter (the letter in a dialog of its own, with Open in Tab and Download PDF) |
| Recruitment · Onboarding (`onboarding`) | staff app | `recruitment` view | every onboarding case: hire, role, start date, status, checklist progress; one case's checklist, guarantors, contract and plan | Operations & People (`recruitment` edit, scope all): Verify and Reject a document, Record Check, Send Reminder, Resend Contract and Reissue Contract, Complete Onboarding, Withdraw; Checklist, Plans and Contract settings. The case's owner (team scope): Mark Step Done. The company's signer: Sign for Company |
| Recruitment · Candidates (`candidates`) | staff app | as M4 | the Offer column (GE) | Open Offer on the sheet of a card at Offer or after (Offers opened by `?application=`); Make Offer on a shortlisted one (`?new=1&application=`) |
| Public · Sign Offer (`/sign/<token>`) | go.mycityapp.io | the candidate holding the link | the letter, the signing steps, the outcome | Send Code, sign (draw or type), Accept and Sign, Decline the Offer |
| Public · Verify Document (`/verify/<number>`, `/verify/t/<token>`) | go.mycityapp.io | anyone | status, signers, the two verdicts; by QR token the document too | look up a reference |
| Public · Upload Documents (`/onboard/<token>`) | go.mycityapp.io | the new hire holding the link | the checklist: required, uploaded, outstanding, each item's verification | accept the privacy notice, upload each document, enter two guarantors as MyCity's Guarantor Form asks, pick their home address, enter and correct their BVN |
| People · Employee 360, Documents tab | staff app | `people` view | the employee's documents, from the hire on | view, verify, upload, request |
| Settings · Approvals (`approvals`) | staff app | `settings` | the `recruitment.offer` flow | Edit Stages |
| Recruitment · Vacancies, Candidate Emails | staff app | as M4 | the offer and onboarding emails beside M4's five | edit and restore a template |

## 3 · How the screens relate

1. **Offer.** On Offers, New Offer picks an application at `shortlist`. The form starts from the
   vacancy and follows MyCity's offer letter: the Offer Summary (position, function, scope, reports
   to, location and work pattern with office days, start date, employment type, probation, annual
   leave, incentives), the monthly pay lines (Basic Salary, Internet & Recharge Allowance,
   Transportation Allowance, and any other; their total within the vacancy's range), working hours,
   the final job description for Schedule A (copied from the vacancy's, editable), expiry (15 days
   by default). The weighted scorecard total and the interview decision are copied onto the
   offer when it is created (they are worked out on read in M4 and would otherwise drift).
2. **Approval.** Submit for Approval starts the `recruitment.offer` flow from Settings · Approvals.
   The offer keeps the flow active when it was created (the rule sanctions follow). Approvers act
   on the offer's card and in My Approvals. Rejected returns it to draft with the reason. Submit
   needs a department on the offer and the **Offer Signatory** named on the Offers settings (the
   Operations & People Lead on MyCity's letter), with a login. **The company signs here**: when the
   flow approves it, the letter is generated with the standard wording then in force (its version
   kept as `terms_version`, so a later edit never changes it), the signature request is opened with
   the Offer Signatory first and the candidate second, and the signatory is told; they press Sign
   for the company on the offer, already signed in, with no email code.
3. **Send.** Once the company has signed, Send Offer starts the expiry (`valid_days`, 15 by
   default), makes the candidate's link (`signatures.issueLinks`) and emails `offer-sent` with it
   after commit: the link is never stored and never sits in the outbox. In the same transaction it
   calls `candidates.advanceIn(client, actor, applicationId, "offer")` (GE's), so the card moves to
   the Offer column. `offer-sent` is worded on Candidate Emails with M4's other mails; its variables
   are `candidates.OfferSentEmailVars` (the role, the offer's number, the link, the expiry). Send is
   refused for a candidate whose address is an active employee's work or personal email
   (`CANDIDATE_IS_EMPLOYEE`): acceptance creates an employee, and someone already on the staff moves
   through People; a record archived or left (a rehire, a hire withdrawn before) does not count. An offer
   that ends unsigned after it was sent (declined, expired, withdrawn) puts the card back at
   Shortlist through `candidates.offerEndedIn`, with the reason. Resend makes a fresh link and revokes the earlier one.
   The record, the signing page and every PDF read one set of values through one template and one
   Markdown renderer (`offers.render`).
4. **Sign.** The candidate opens `/sign/<token>`, reads the same text the PDF holds, receives an
   email code, types full name and title, draws or types a signature, ticks the consent, and
   presses Accept and Sign (partnerships.md §6.9 is the signing service, built here first). Decline
   the Offer takes a reason and ends the offer.
5. **Accept (one transaction).** The candidate's signature is the offer's last, so the signatures
   service calls the offer's `onCompleted` hook (`offers.acceptedIn`) inside the transaction that
   writes it. There, all or nothing:
   - the offer becomes `accepted`;
   - `organisation.createEmployee` creates the employee **without a seat and without a login**,
     from the offer: names, job title, department, worksite, employment type, work pattern, start
     date, probation (the confirmation date, by the calendar: `lagos.addMonths`), phone; the
     candidate's email as the personal email, where every mail to the hire goes, and as the work email
     a placeholder of the offer's own, `<offer number>@hire.invalid` (a reserved domain that takes no
     mail), until Complete Onboarding sets the company address (AJ, 12/11/2026, the audit of #122:
     work emails are unique, and an internal candidate, a rehire or a hire withdrawn before keeps the
     candidate's address on another record); the employment type is the employee's own spelling
     (5070: a vacancy's `contract` and `internship` become `contractor` and `intern` when New Offer
     starts from it);
   - `candidates.advanceIn(client, actor, applicationId, "documentation")` moves the card from
     Offer to Documentation (GE's pipeline, recruitment.md §6.3); a false answer refuses the whole
     acceptance, so the candidate is told to try again rather than half-hired;
   - the onboarding case opens at `documentation` with the employee, its checklist one item for
     each active document requirement;
   - the employment contract is numbered (CON), generated from the standard contract wording in
     force (its version kept on the document), the offer's terms, the final job description and the
     hire's staff number, and its signature request opened with **the company first and the hire
     second** (AJ, 11/11/2026): the Offer Signatory named on the Offers settings, or whoever signed the
     offer for the company when none is named now. The signatory is told it waits for them. The
     contract keeps the hire's name it was made with (`hire_name`, 5080), so what the signatures cover
     never changes when the record is renamed.
   Any refusal inside the acceptance (a record, a stage, a signatory) is logged for the staff and
   reaches the candidate only as "We could not take your signature. Try again." (`NOT_ACCEPTED`),
   never another person's details.
   The sealed offer then reaches the candidate as `offer-signed` (Candidate Emails), with the sealed
   copy attached, in place of the signatures service's own `signature-completed`; the company's
   signatory still receives that one (AJ, 11/11/2026). `onboarding-documents` and its Upload
   Documents link come with the upload page (PR 6). The application moves on with the case: to
   Pre-Onboarding at the documentation gate (step 7) and Onboarding on the start date (step 8); it
   reaches Hired only when Complete Onboarding calls `candidates.hireIn` (step 8), not here.
5a. **The contract.** The Offer Signatory presses Sign for Company on the hire's case, signed in
   with no email code. The hire's link is then made and emailed as `contract-sent` (Candidate
   Emails) after commit; Resend Contract makes a fresh one and revokes the earlier. The hire signs on
   `/sign/<token>` as for the offer. Their signature, the last, marks the contract `signed`, and the
   sealed copy is mailed to both. The hire has 15 days to sign from when their link is made (Sign for
   Company, and again from each Resend Contract), so a contract left unsigned lapses through
   `signature-reminders` like an offer. Declined or lapsed, the contract is `cancelled` and the case's
   owner told; while the case is at documentation, **Reissue Contract** (Operations & People) makes a
   new contract for the case from the accepted offer, with the wording in force now and the Offer
   Signatory named now (else whoever signed the earlier one for the company), waiting for the
   company's signature as the first did. The cancelled one stays as it was; the case shows the newest.
6. **Documentation.** The Upload Documents link is mailed as `onboarding-documents` (Candidate
   Emails) when the case opens, from the outbox after the acceptance commits, and again on Send
   Reminder, which stops every earlier link; a link lives a month, and at least a week past the start
   date. The hire uploads on `/onboard/<token>` after accepting the privacy notice.
   The checklist is MyCity's New Joiner list, entered on the Checklist settings: proof of residential
   address, a valid ID, educational and professional certificates (with NYSC), evidence of separation
   from the last employer, birth certificate, the Employee Data Form, the MyLagosApp Wallet ID (a
   typed value), a passport photograph and the bank Account Opening Form; the signed offer and the
   contract are added by the system. Each file lands on the employee (People 360 Documents tab, the
   `employee_document` type) the moment it is sent, quarantined and scanned as any stranger's upload,
   and is then named on its item: from then it is titled by its requirement ("Valid ID"), a
   guarantor's form and ID copy by the guarantor ("Guarantor Form, Adaobi Nwosu", "ID Copy, ...";
   `vault.setTitle`), so the Documents tab never shows a file's own name. Operations & People verify
   each once its scan is clean, which verifies the same document on the hire's record
   (`documents.verifiedIn`, as People's Verify Document), or reject it with a reason the hire reads
   beside the item and in the mail that tells them (`onboarding-document-rejected`, with a fresh link;
   a failed guarantor check is mailed the same way, without its note), and send it again. A file sent
   again on an item, or as a guarantor's form or ID, becomes the next version of the one before it
   (`vault.follow`): the Documents tab keeps one entry for it, the earlier file in its versions (AJ,
   12/11/2026). The hire enters their BVN (a masked
   number on the employee record, no upload; they may correct it until documentation completes, AJ
   12/11/2026, since nobody else ever sees it to catch a slip), picks their **home address**
   (`AddressField`, kept as the employee record's home address) and enters their **two guarantors**:
   not related to them, one a previous employer and one who has known them four years or more, no
   serving police, military or other uniformed staff. Each as MyCity's Guarantor Form asks: date of
   birth, contact and residential addresses (both picked, F27), whether they have been convicted of
   a criminal offence (and what happened) and whether they recommend the hire, the signed Guarantor
   Form and a copy of their ID. Operations & People run a reference check on each and record Passed
   or Failed; a guarantor passes only with the signed form and the ID copy in (`FORM_REQUIRED`), and
   a pass verifies both on the hire's record. A failed guarantor is corrected by the hire, which
   starts its check again; a guarantor who has passed stays as they are. Years Known is asked of the
   personal guarantor only; left empty it is not given (never 0).
7. **Pre-onboarding.** When every required item is verified, both guarantors have passed, the BVN
   and the home address are entered and the contract is signed, the case moves to `pre_onboarding` and the application to
   Pre-Onboarding (`candidates.advanceIn`) in the same transaction. The gate is asked after each of
   those (a verification, a reference check, the BVN, the home address, the hire's signature on the contract), so
   whichever comes last opens it. The case shows what it still waits on (`waiting_on`). Nothing
   before that opens onboarding, and from then the upload page takes nothing more.
8. **Onboarding.** `onboarding-dispatch` runs every morning (06:43 Lagos). A case at
   `pre_onboarding` whose start date has come moves to `onboarding`, the application to Onboarding
   (`candidates.advanceIn`), and its plan's steps are copied onto the case (`onboarding_case_step`):
   the department's active plan, else the company's default. Each step's owner is the person who
   holds its role then: `case_owner` the case's owner (the vacancy's hiring manager), `line_manager`
   the hire's line manager (their record names none until `hireIn` fills their seat, so it is read from
   the vacancy's Organogram seat: whom the seat reports to, or the holder of the seat it reports to,
   through any vacant seats between), `head_of_department` the department's head, `hire` the employee;
   the case's owner when nobody holds it. A case whose application is no longer active is not started. Each is due on the start date plus its offset and keeps its
   SOP. The owners are told. The same run reminds the owner of each step past its due day, once a
   step (`reminded_at`): their login, else the case's owner's (a hire has none yet). Run twice, it
   changes nothing more. Mark Step Done marks a pending step done.
   **Complete Onboarding** (every step done) asks for the hire's company email and, in one
   transaction, makes it their work email (`organisation.updateEmployee`, which refuses an address
   another person or login holds; it was their candidate address since acceptance), invites their
   login on it with the Staff role (`users.inviteIn`, the invitation mailed from the outbox), calls
   `candidates.hireIn` (the application to Hired, the Organogram seat filled, the vacancy closed as
   filled when its openings are) and closes the case `completed`.
   **Withdraw** (the hire is not joining) is open until the case completes: in one transaction the
   contract is cancelled while unsigned (`employment_contracts.cancelIn`; a signed one stays as the
   record of what was signed), the Upload Documents links stop, the employee made at acceptance is
   archived, the application is withdrawn (`candidates.withdrawnIn`: status `withdrawn`, its links
   stopped, no mail to the hire) and the case is `cancelled` with the reason.
9. **Verify.** Every signed document carries a QR on each page linking to `/verify/t/<token>`;
   a typed reference shows status and verdicts, not content (A9).

## 4 · Data

| Table | Key columns | Notes |
|---|---|---|
| `offer` | `application_id`, `number` (OFF), `status`, `job_title`, `start_date`, `expires_at`, `annual_compensation`, `terms`, `document_id` | 5000. 5010 adds the Offer Summary (`reports_to`, `role_function`, `role_scope`, `employment_type`, `work_pattern`, `office_days`, `annual_leave_days`, `incentives`), `job_description`, `working_hours`, `probation_months`, `workflow_instance_id`, `signature_request_id`, `score_snapshot`, `decision_snapshot`, `sent_at`, `withdrawn_at`, `end_reason`, a status CHECK, and one open offer per application. `annual_compensation` is twelve times the pay lines' sum; `terms` keeps `valid_days` and `benefits` |
| `offer_pay_line` | `offer_id`, `position`, `name`, `monthly_amount` | 5010. The monthly compensation, line by line |
| `signature_request` | `document_id`, `subject_type`, `subject_id`, `status`, `expires_at` | 5000. Shared with M7 (`partnership_agreement.signature_request_id`); LA reviews any change |
| `signature` | `signature_request_id`, `signer_name`, `signer_email`, `signed_at`, `evidence` | 5000. 5020 adds `content_hash`, `artifact_hash` (A12), `signer_title`, `method`, `signature_document_id`, `code_verified_at`, `viewed_at`; a signed row must carry its time, method and content hash. 5020 also adds the request's `sealed_document_id` and `end_reason` |
| `document_requirement` | `code`, `name`, `required`, `expires`, `active` | 5000. MyCity's New Joiner list, seeded once by 5399 (`ON CONFLICT DO NOTHING`) and kept on Onboarding's Checklist settings: an exception to A26 because Send Offer refuses an empty checklist (AJ, 11/11/2026; MILESTONES §10). 5030 adds `kind` (`file`, `number`, `both`; the Wallet ID is a number) and `display_order` |
| `onboarding_case` | `application_id`, `offer_id`, `employee_id`, `status`, `starts_on` | 5000. Status `documentation → pre_onboarding → onboarding → completed`, or `cancelled` (5030, with `privacy_acknowledged_at`, `documentation_completed_at`, `cancelled_at`, `end_reason`) |
| `onboarding_checklist_item` | `onboarding_case_id`, `document_requirement_id`, `status`, `document_id` | 5000. 5030 adds `entered_value`, `uploaded_at`, `verified_by`, `verified_at`, `rejected_reason` |
| `onboarding_guarantor` | `onboarding_case_id`, `position` (1, 2), `kind` (`previous_employer`, `personal`), `full_name`, `relationship`, `phone`, `years_known`, `form_document_id`, `check_status` | 5030. The reference check: `pending`, `passed`, `failed`, with who and when. 5100 adds the rest of MyCity's Guarantor Form: `date_of_birth`, `contact_address` and `residential_address` (each address's line; the places are kept by `places.save()` under the owners `onboarding_guarantor.contact_address` and `.residential_address`, personal), `convicted`, `conviction_details`, `recommends`, `id_document_id` (the ID copy) |
| `employment_contract` | `onboarding_case_id`, `employee_id`, `number` (CON), `document_id`, `signature_request_id` | 5000. 5080 adds `hire_name`, the hire's name as the contract was made with it (what its content hash covers). A case has one contract, and another only when Reissue Contract replaced a cancelled one; the case reads its newest |
| `onboarding_plan` | `department_id` (null for the company's default), `name`, `active` | 5050. One plan a department and one default (partial unique indexes). The default, Your First 30 Days from the HR Induction deck, is seeded by 5399 with its four steps |
| `onboarding_plan_step` | `onboarding_plan_id`, `position`, `title`, `owner_role`, `due_offset_days`, `sop_id` | 5050. The owner is a role (`case_owner`, `line_manager`, `head_of_department`, `hire`), named as a person when the steps are copied onto a case; the due day counts from the start date. `sop_id` has no foreign key: `sop` is M10's (10400, after this block), so the service takes only an SOP in force |
| `onboarding_case_step` | `onboarding_case_id`, `position`, `title`, `owner_role`, `owner_id`, `due_on`, `sop_id`, `status` (`pending`, `done`), `done_by`, `done_at`, `reminded_at` | 5050. The plan's steps copied onto the case when it reaches onboarding (PR 6b), so a plan changed later never changes a hire's steps. 5060 adds `reminded_at`: an overdue step's owner is reminded once |
| `employee.bvn` | eleven digits | 5040, masked under `employee.bank` (organisation's table, TB reviews) |
| `talent_pool`, `talent_pool_member` | | 5000, never used (M4's pool is `talent_pool_entry`, 4060). Dropped in 5010 |

Schema migration files: `migrations/5000_offers_onboarding.sql` (merged, never edited),
`5010_offer_terms.sql`, `5020_signature_evidence.sql`, `5030_onboarding_documentation.sql`,
`5040_employee_bvn.sql`, `5050_onboarding_plans.sql`, `5060_onboarding_step_reminders.sql`,
`5070_offer_employment_type.sql` (the offer's employment type CHECK in the employee's spellings,
`contractor`, `consultant`, `intern`, in place of 5010's vacancy spellings, and the rows converted),
`5080_contract_hire_name.sql`, `5090_drop_unused_talent_pool.sql`, `5100_onboarding_guarantor_form.sql`. Reference data:
`seeds/reference/5099_seed_offers_onboarding.sql` and `5199_seed_m5_statuses.sql` (statuses);
`5399_seed_new_joiner_list.sql`, the New Joiner list and the default plan;
`5299_seed_offer_flow.sql`, the `recruitment.offer` flow's version 1 and Head of Department's
`approve` on recruitment (team), set only while its grant is as 0290 left it. 5010 also gives the
offer `approved`, `outside_range`, `range_reason`, `additional_terms`, `terms_version` and
`submitted_at`. BVN is a restricted field on the
employee record (masked, never sent to an AI model).

## 5 · API

| Method and path | Contract | Permission · scope | Paged | Notes |
|---|---|---|---|---|
| `GET /api/v1/recruitment/offers` | `OfferListQuery` → `OfferPage` | `recruitment` view · all/team | yes, 25 | filters: status, vacancy, application (the board's Open Offer), q |
| `GET /api/v1/recruitment/offers/summary` | → `OffersSummary` | `recruitment` view | | drafts, with approval, to send, with candidates, accepted this month; `can_configure`, the reader's scope is all (Offer Settings) |
| `GET /api/v1/recruitment/offers/draft` | `OfferDraftQuery` → `OfferDraft` | `recruitment` create | | what New Offer starts from |
| `POST /api/v1/recruitment/offers` | `OfferCreate` → `OfferDetail` | `recruitment` create | | application active at `shortlist` (or `offer` after one ended); department and worksite default to the vacancy's |
| `GET/PATCH /api/v1/recruitment/offers/:id` | `OfferDetail`, `OfferEdit` | `recruitment` view/edit | | edit only in draft |
| `POST /api/v1/recruitment/offers/:id/submit`, `/send`, `/resend` | `EmptyBody` → `OfferDetail` | `recruitment` edit | | |
| `POST /api/v1/recruitment/offers/:id/recipient` | `OfferRecipient` → `OfferDetail` | `recruitment` edit | | Change Email on a sent offer: the address on the candidate (`candidates.correctEmailIn`) and on their signature, then a fresh link mailed to it, every earlier one revoked |
| `POST /api/v1/recruitment/offers/:id/withdraw` | `OfferWithdraw` → `OfferDetail` | `recruitment` edit | | with its approval, approved or sent |
| `POST /api/v1/recruitment/offers/:id/sign` | `SignSubmit` → `OfferDetail` | `recruitment` view, and the signer named on its request | | the company's signature, in the hub |
| `GET /api/v1/recruitment/offers/:id/document` | PDF | `recruitment` view | | the sealed copy once there is one |
| `GET /api/v1/recruitment/offers/settings`, `PUT .../settings/signatory` | `OfferSettings`, `OfferSignatorySave` | `recruitment` edit, scope all | | the Offer Signatory (setting `recruitment.offer_signatory`) |
| `GET/PUT /api/v1/recruitment/offers/settings/letter`, `POST .../letter/restore` | `OfferLetterTemplate`, `OfferLetterTemplateSave` | `recruitment` edit, scope all | | the standard wording, a `template_version` of `offer-letter` |
| `GET /api/v1/recruitment/onboarding` | `OnboardingListQuery` → `OnboardingPage` | `recruitment` view · all/team (the case's owner) | yes, 25 | filters: status, department, q (the hire or the role) |
| `GET /api/v1/recruitment/onboarding/summary` | → `OnboardingSummary` | `recruitment` view · all/team (the case's owner) | | the figures above the list: cases at documentation with the items sent and waiting for a check, at pre-onboarding, at onboarding with the steps past their due day, and completed this month (Lagos); `can_configure`, the reader's scope is all (Onboarding Settings) |
| `GET /api/v1/recruitment/onboarding/:id` | → `OnboardingDetail` | `recruitment` view | | the checklist, guarantors, `bvn_entered` (never the number), the contract, `waiting_on`, the plan's `steps` (owner, due day, `overdue`, SOP), `can_complete`, `can_withdraw` |
| `POST /api/v1/recruitment/onboarding/:id/items/:item_id/verify` | `EmptyBody` → `OnboardingDetail` | `recruitment` edit, scope all | | an item sent and, for a file, scanned clean (409 `SCAN_PENDING`, `FILE_INFECTED`); then the gate |
| `POST /api/v1/recruitment/onboarding/:id/items/:item_id/reject` | `ChecklistItemReject` → `OnboardingDetail` | `recruitment` edit, scope all | | back to the hire with the reason |
| `POST /api/v1/recruitment/onboarding/:id/guarantors/:guarantor_id/check` | `ReferenceCheckRecord` → `OnboardingDetail` | `recruitment` edit, scope all | | Passed or Failed with a note; then the gate; Passed needs the signed form and the ID copy (409 `FORM_REQUIRED`) |
| `POST /api/v1/recruitment/onboarding/:id/remind` | `EmptyBody` → `OnboardingDetail` | `recruitment` edit, scope all | | Send Reminder: a fresh link mailed, every earlier one stopped |
| `POST /api/v1/recruitment/onboarding/:id/steps/:step_id/done` | `EmptyBody` → `OnboardingDetail` | `recruitment` edit, in scope (the case's owner too) | | Mark Step Done: a pending step of a case at onboarding (409 `NOT_IN_ONBOARDING`, `STEP_DONE`) |
| `POST /api/v1/recruitment/onboarding/:id/complete` | `OnboardingComplete` → `OnboardingDetail` | `recruitment` edit, scope all | | the company email; every step done (409 `NOT_IN_ONBOARDING`, `STEPS_OPEN`; 409 `EMPLOYEE_EXISTS` or `LOGIN_EMAIL_TAKEN` for an address held); one transaction (§3 step 8) |
| `POST /api/v1/recruitment/onboarding/:id/withdraw` | `OnboardingCancel` → `OnboardingDetail` | `recruitment` edit, scope all | | the reason; any case not completed or cancelled (409 `CASE_ENDED`); one transaction (§3 step 8); an application still active that cannot be withdrawn keeps the case open (409 `NOT_WITHDRAWN`) |
| `GET/POST /api/v1/recruitment/onboarding/requirements`, `PATCH .../requirements/:id` | `DocumentRequirementListQuery` → `DocumentRequirementPage`; `DocumentRequirementCreate`, `DocumentRequirementEdit` → `DocumentRequirement` | `recruitment` edit, scope all | yes, 25 | the Checklist settings; a code is kept once made (409 `CODE_TAKEN`) |
| `GET/POST /api/v1/recruitment/onboarding/plans`, `GET/PUT .../plans/:id` | `OnboardingPlanListQuery` → `OnboardingPlanPage`; `OnboardingPlanSave` → `OnboardingPlan` | `recruitment` edit, scope all | yes, 25 | the Plans settings; a plan saved whole (409 `PLAN_EXISTS`, 422 `SOP_NOT_FOUND`); a department's plan links only its own department's SOPs (422 `SOP_OTHER_DEPARTMENT`), the default any |
| `GET /api/public/v1/sign/:token` | → `SigningView` | public token `signature.sign` (one a signer) | | the first opening is recorded; 404 for any bad or ended link (signatures) |
| `POST /api/public/v1/sign/:token/code` | `EmptyBody` → `SignCodeSent` | public token | | a six-digit code to the address the link was sent to; 10 minutes; another after 60 seconds (429) |
| `POST /api/public/v1/sign/:token/code/verify` | `SignCodeVerify` → `SigningView` | public token | | five wrong tries and a new code must be asked for |
| `POST /api/public/v1/sign/:token/sign` | `SignSubmit` → `SigningView` | public token | | the code entered within 30 minutes; signers in order; a second press returns the signed state |
| `POST /api/public/v1/sign/:token/decline` | `SignDecline` → `SigningView` | public token | | ends the request for every signer |
| `GET /api/public/v1/sign/:token/document` | PDF | public token | | the sealed copy once there is one |
| `GET /api/public/v1/verify/:ref` | → `VerifyResult` | public | | status, signers, the two verdicts; no content; only a sealed copy. A `CERT-` number is a training certificate, answered by the training module (`knowledge.md` §6.10); a signed document's `certificate` is null |
| `GET /api/public/v1/verify/t/:token` | → `VerifyByToken` | the sealed copy's QR key | | the record and the document |
| `GET /api/public/v1/verify/t/:token/document` | PDF | the QR key | | the sealed copy |
| `POST /api/v1/recruitment/contracts/:id/sign` | `SignSubmit` → `EmploymentContractView` | `recruitment` view, and the signer named on its request | | the company's signature, in the hub; the hire's link is then made and mailed (`contract-sent`) |
| `POST /api/v1/recruitment/contracts/:id/resend` | `EmptyBody` → `EmploymentContractView` | `recruitment` edit, scope all | | a fresh link to the hire, every earlier one revoked; once the company has signed; the hire's 15 days to sign start again |
| `POST /api/v1/recruitment/contracts/:id/reissue` | `EmptyBody` → `EmploymentContractView` | `recruitment` edit, scope all | | Reissue Contract: a new contract for the case in place of a cancelled one (declined or lapsed), while the case is at documentation (409 `NOT_CANCELLED`, `CASE_ENDED`, `REISSUED`) |
| `GET /api/v1/recruitment/contracts/:id/document` | PDF | `recruitment` view | | the sealed copy once there is one, else the copy generated at acceptance |
| `GET/PUT /api/v1/recruitment/contracts/settings/template`, `POST .../template/restore` | `ContractTemplate`, `ContractTemplateSave` | `recruitment` edit, scope all | | the standard contract wording, a `template_version` of `employment-contract` |
| `GET /api/public/v1/onboard/:token` | → `UploadPack` | public token `onboarding.upload` (the case its subject) | | the checklist as the hire sees it, the privacy notice's sentences; a guarantor's check note is left out |
| `POST /api/public/v1/onboard/:token/privacy` | `PrivacyAcknowledge` → `UploadPack` | public token | | first; every write below is 409 `PRIVACY_FIRST` before it |
| `POST /api/public/v1/onboard/:token/files` | multipart `file` (`UploadFile`) → `DocumentRef` | public token | | at most 15 MB (purpose `document`); stored on the hire's employee record, quarantined and scanned. The page's writes have a limit of their own, 60 a minute a link (`onboardLimiter`), not the public write limit per address (AJ, 12/11/2026) |
| `POST /api/public/v1/onboard/:token/items/:item_id` | `UploadItem` → `UploadPack` | public token | | the file sent on this link, the typed value, or both, as the requirement's kind asks |
| `POST /api/public/v1/onboard/:token/guarantors` | `GuarantorInput` → `UploadPack` | public token | | by position (1, 2); two of different kinds (422 `SAME_KIND`); a passed one stays (409 `ALREADY_CHECKED`); MyCity's Guarantor Form: date of birth, the two addresses (`PlaceInput`), the conviction and recommendation answers (what happened, when convicted), the signed form and the ID copy (each a file sent on this link) |
| `POST /api/public/v1/onboard/:token/bvn` | `BvnEnter` → `UploadPack` | public token | | eleven digits, correctable until documentation completes, kept on `employee.bvn`; then the gate. After documentation every write is 409 `DOCUMENTATION_DONE` |
| `POST /api/public/v1/onboard/:token/address` | `HireAddressEnter` → `UploadPack` | public token | | the hire's home address, a `PlaceInput` (F27), kept as the employee record's home address (`organisation.updateEmployee`); then the gate |
| `GET /api/public/v1/onboard/:token/places/search`, `/places/pin` | `UploadPlaceSearchQuery`, `UploadPinQuery` → `PlaceMatches`, `Place` | public token | | the page's address search and a pinned point's name, signed as the staff app's (maps' own handlers, level address) |

## 6 · Rules and calculations

- An offer is made only for an active application at `shortlist`, or at `offer` when its last offer ended; one open offer an application.
- Pay is monthly, line by line; the monthly total times twelve is `annual_compensation`, and the total must sit within the vacancy's `salary_min` to `salary_max` unless the approver overrides it with a reason. Money through `shared/money`.
- The company signs an offer when it is approved, before it is sent; the candidate signs second.
- An offer is approved before it is sent; the flow is the one active when the offer was submitted (the instance keeps its definition).
- Withdrawing an offer still with its approval withdraws the approval too, which only its submitter or the CEO may do (the approval engine's rule); Not Progressing withdraws it as its submitter.
- An unsigned offer lapses at `expires_at`: `signature-reminders` ends its signature request and the offer becomes `expired`; the link stops working. Default expiry 15 days; a link lives at most 90 days. There is no offer job of its own.
- Declined, expired or withdrawn ends the offer; a new offer may be made for the same application.
- Not Progressing (M4) or Close Vacancy revokes every open `offer.sign` and `onboarding.upload` token of that application (an outbox handler on `application.not_progressed`); Not Progress All never touches an application at `offer` or later (GE).
- Every signature row holds `content_hash` (over the canonical payload, recomputable) and `artifact_hash` (over the stored bytes the vault returns). The verify page reports both verdicts (A12).
- A signed document is locked; edits make a new offer.
- Submit for Approval needs the start date, the department, the employment type and the work
  pattern, every field the employee is created from, so an approved offer can always be accepted.
- Send Offer is refused until the onboarding checklist has at least one active required item, and for a candidate whose address is an active employee's work or personal email (`CANDIDATE_IS_EMPLOYEE`; an archived or left record does not count).
- An offer's employment type is the employee's spelling (`full_time`, `part_time`, `contractor`, `consultant`, `intern`; 5070); New Offer maps a vacancy's `contract` and `internship` to `contractor` and `intern`.
- New Offer from the chat card states the reason when its basic salary sits outside the vacancy's range, as the form does (`OfferCard.range_reason`); there is no stock reason.
- With its approval, an offer is withdrawn only by its submitter or the CEO, and Withdraw shows only to them (`can_withdraw`).
- An offer approved while its signatory had no login has no signature request yet: the Offer Signatory named later opens it by signing (`can_sign`, `ensureRequestIn`).
- A write that holds an offer or a contract holds its signature request first, as the signing page does, so Withdraw or Resend and a signature never wait on each other.
- Acceptance is one transaction (§3 step 5): if any part refuses, the candidate's signature is not
  kept and they are asked to try again.
- The contract is signed by the company first, then the hire; the hire's link exists only after the
  company's signature. Its wording is the version in force at acceptance, kept on its document, so a
  later edit never changes a contract already generated.
- Until Complete Onboarding, the hire's work email is the placeholder `<offer number>@hire.invalid` and their candidate email is their personal email, where every mail to the hire goes (the Upload Documents link, the contract); Complete Onboarding sets the company address.
- An acceptance refused for any reason reaches the candidate only as "We could not take your signature. Try again." (`NOT_ACCEPTED`); the refusal is logged for the staff.
- A signer reads `void` on the signing and verification pages (and on a record's signers) once their signature sits on a request that ended unsigned: another signer declined, it lapsed or it was withdrawn (M7 PR 6, partnerships.md §13.2). Signing views also carry the document's `blocks` where its type gives them (an agreement's headings, clauses and tables) and each signer's `method`.
- A sealed copy prints its QR in the letterhead's header, so on every page (partnerships.md §6.9 step 7).
- Documentation completes when every required item is verified, both guarantors have passed their reference checks, the BVN and the home address are entered and the contract is signed. Onboarding never opens before that.
- A guarantor passes only with the signed Guarantor Form and an ID copy in. Both their addresses are picked (F27).
- A document checked on the case is checked on the hire's record: Verify on an item, and a guarantor's
  pass for their form and ID copy, mark the document verified there too (`documents.verifiedIn`). Each
  file the hire names is titled by what it is, never left as its file's name.
- The BVN may be corrected by the hire until documentation completes (AJ, 12/11/2026); after that the page takes nothing.
- The hire has 15 days to sign their contract from each link made for it; declined or lapsed, Reissue Contract makes a new one while the case is at documentation.
- The settings (Offer Signatory, the offer and contract wording, the Checklist, the Plans) and Operations & People's case actions (Verify, Reject, Record Check, Send Reminder, Resend and Reissue Contract, Complete Onboarding, Withdraw) need `recruitment` edit at scope all; a Head of Department's team grant reads their hires' cases and marks their steps done (AJ, 12/11/2026).
- A department's plan steps link only that department's SOPs; the company's default plan any.
- The hire accepts the privacy notice before sending anything. A file they send is theirs to name only on their own link (on their employee record, sent from no signed-in user); a file is verified only once its virus scan is clean.
- An optional item never holds the gate; whether an item is required is read from its requirement as it stands. A requirement switched off stays on the cases already open.
- The BVN is never returned by any route (only `bvn_entered`), never written into an audit row, and never sent to a model.
- The Upload Documents link is never kept or put in the outbox: only its hash is stored, and the mail is queued with it straight after its own transaction. Not Progressing stops it.
- A personal guarantor has known the hire four years or more; the two are not the same kind.
- Onboarding plan steps come from the hire's department plan (its default when it has none active), copied onto the case on the start date with each owner resolved from the step's role (the case's owner when nobody holds it) and due on the start date plus the step's offset. A case reaches onboarding only from pre-onboarding, on or after its start date; a case still at documentation on its start date starts the morning after its gate opens.
- An overdue step is a pending one whose due day has passed; its owner (or the case's owner, when the owner has no login) is reminded once.
- Complete Onboarding needs the case at onboarding and every step done. The company email becomes the hire's work email and their login's (role Staff), and `hireIn` runs, all in one transaction: a refusal of any part keeps nothing.
- Not Progressing (M4) on an application at Documentation or after ends its open case as Withdraw does, with the application's reason; the application is M4's (`not_progressed`).
- Withdraw ends a case before completion. An unsigned contract is cancelled; a signed one stays signed. The employee is archived and the application withdrawn; the hire is not mailed. An application still active that cannot be withdrawn keeps the case open (`NOT_WITHDRAWN`); one already ended in Recruitment ends with it.
- Reopen (M4) is refused for an application not progressed at Documentation or after: its case, contract and employee ended with it, so a new application starts again.
- No AI drafts an offer or a contract: both are the template plus the offer's fields. M5 registers no AI job.

## 7 · Events, jobs and notifications

| Event / job | When | Does |
|---|---|---|
| `offer.created`, `offer.updated` | New Offer, a draft's edit | audit |
| `offer.submitted`, `offer.approved`, `offer.rejected` | the approval flow | the approvers hear through the flow; approved tells the owner and the Offer Signatory; rejected the owner |
| `offer.sent`, `offer.resent` | Send Offer, Resend | the service queues `offer-sent` after commit with a link made then |
| `offer.accepted` | the offer's signature request completes (`signature.completed`, the candidate's signature last) | tells the owner; in the same transaction the employee, the move to Documentation, the case and the contract (§3 step 5) |
| `contract.generated` | at acceptance, and on Reissue Contract (`reissued_from` names the cancelled one) | tells the company's signatory the contract waits for them |
| `contract.company_signed`, `contract.resent` | Sign for Company, Resend Contract | the service queues `contract-sent` after commit with a link made then |
| `contract.signed` | the hire signed, the last signature | tells the case's owner; the sealed copy goes to both |
| `contract.cancelled` | the hire declined, or the request lapsed | tells the case's owner |
| `signature.requested`, `.viewed`, `.signed`, `.declined`, `.ended` | the signing steps (signatures) | audit; the owning module reacts through its `defineSignable` hooks in the same transaction |
| `signature.completed` | the last signer signed | outbox: the sealed copy generated with the signatures, the certificate and the QR (`signatures.signed-pdf`) |
| `document.generated` (a sealed copy) | the worker rendered it | its stored bytes' hash on every signature row (`artifact_hash`); `signature.sealed` |
| `signature.sealed` | | every signer mailed the sealed copy (`signature-completed`), except where the signed record's module words its own: the candidate of an offer gets `offer-signed` with the copy |
| `offer.declined`, `offer.expired`, `offer.withdrawn` | the candidate declines; the request lapses; Withdraw or Not Progressing | declined and expired tell the owner; the links stop working |
| `onboarding.opened` | at acceptance, in the signing transaction | tells the owner; the outbox makes the Upload Documents link and mails `onboarding-documents` |
| `onboarding.link_sent` | Send Reminder | audit (the link is made and mailed by the same step) |
| `onboarding.privacy_acknowledged`, `.bvn_entered`, `.address_entered` | the hire on their page | audit (never the number or the address) |
| `onboarding.item_uploaded` | the hire sent an item | tells the owner |
| `onboarding.item_verified`, `.item_rejected` | Operations & People | audit; a rejection: the outbox mails the hire `onboarding-document-rejected` with the item, the reason and a link of its own, earlier links still working (`onboarding.mail_rejected`), nothing when they have sent it again by then; they also read the reason on their page |
| `onboarding.guarantor_saved` | the hire entered or corrected a guarantor | tells the owner |
| `onboarding.guarantor_checked` | a reference check recorded | audit; Failed: the outbox mails the hire `onboarding-document-rejected` naming the guarantor (never the note) with a fresh link (`onboarding.mail_guarantor_failed`) |
| `onboarding.documentation_completed` | the gate, in the transaction of whatever came last | tells the owner; the application at Pre-Onboarding |
| `onboarding.requirement_saved`, `.plan_saved` | the Checklist and Plans settings | audit |
| `application.not_progressed` (M4) | Not Progressing | its open case ends as Withdraw ends it: the contract while unsigned, the links, the employee archived, the case `cancelled` with the application's reason (`onboarding.end_for_application`); an ended case only has its links stopped again |
| `onboarding.started` | the start date (`onboarding-dispatch`) | tells the case's owner and every step owner with a login |
| `onboarding.step_done` | Mark Step Done | audit |
| `onboarding.step_overdue` | a step past its due day (`onboarding-dispatch`), once a step | tells its owner, or the case's owner when the owner has no login |
| `onboarding.completed` | Complete Onboarding | tells the case's owner; the login's invitation is mailed by identity's own outbox step in the same transaction (`users.inviteIn`), and `application.hired` and the vacancy's events follow from `hireIn` |
| `onboarding.cancelled` | Withdraw | tells the case's owner; `contract.cancelled` (when unsigned), `employee.archived` and `application.withdrawn` in the same transaction |
| `signature-reminders` job | daily, 06:17 Lagos | ends requests past their end; their links stop working |
| `onboarding-dispatch` job | daily, 06:43 Lagos (`jobs/schedulers/onboarding-dispatch.js`) | move cases to `onboarding` on their start date with their plan's steps; remind owners of overdue steps, once a step. Each case its own transaction; at most 200 cases and 500 reminders a run, the rest the next |

## 8 · Permissions and visibility by role

| Role | Sees | Can do |
|---|---|---|
| Operations & People, Implementation | every offer and case | everything on Offers and Onboarding |
| Management | every offer and case | as above, no delete |
| Head of Department | offers and cases for their vacancies | view, create and edit drafts; Mark Step Done on their hires' cases. Never the settings or Operations & People's case actions (scope all, AJ 12/11/2026) |
| Approvers of `recruitment.offer` | the offers waiting for them | Approve, Reject |
| The candidate / hire | their own offer and upload pack, by token | sign, decline, upload |

Restricted fields: compensation (offer viewers only), BVN (masked; Operations & People only), the
signer evidence (IP, device) on the offer's detail only. No capability is needed.

## 9 · AI and search

- **AI reads** (`offers.ai.js`, `onboarding.ai.js`): offers by status and expiring soon; cases by status with outstanding items. Paged at 25. No personal data to DeepSeek.
- **AI routes**: "make an offer to <candidate>" opens New Offer with the application; "who still owes documents" opens Onboarding filtered.
- **AI cards**: New Offer is a card (`offers.create`, `OfferCard`: the candidate picked from the shortlist through `candidates.list`, the start date, the monthly basic salary, and the reason when it sits outside the vacancy's range; the rest starts from the vacancy and the draft is finished on Offers); the document upload and BVN forms are `not_offered: personal`. Approving, signing, sending and withdrawing stay on the screen.
- **Search** (`offers.search.js`, `onboarding.search.js`): offers by number (OFF-), candidate and role; onboarding cases by the hire's name or the role (built in PR 6a, opening the case by `?case=` as a contract does); employment contracts by number (CON-).
- `onboarding.ai.js` (PR 6a, a route added in PR 6b): the read `onboarding.list` and four routes (the fourth, cases at onboarding); Mark Step Done, Complete Onboarding and Withdraw stay on the screen (confirmed by AJ closing M5, 12/11/2026: both are one-way, hiring or archiving a person, so neither becomes a chat card); the Checklist and Plans settings' forms are `not_offered` (`design:`). The hire's upload, guarantor and BVN forms are not staff-app create or edit forms, so gate 23 asks no reason of them; they never reach the chat.

## 10 · On screen and mobile

### 10.1 Content tiers

| Screen | Open (tier 1) | Behind help (tier 2) | Not on screen (tier 3), lives in |
|---|---|---|---|
| Recruitment · Offers | the figures (With Approval with the drafts, To Send, With Candidates, Accepted This Month); the offers list across the page (number, candidate, role, start date, annual compensation with Outside Range, status, sent, expiry); a pressed row opens the offer in a wide dialog (F31 as amended 08/11/2026): the offer's summary with Signers under its details in the same card, beside Monthly Pay with Approval under the pay in the same card, then History across it, and Close at its foot; the offer's summary, Monthly Pay with Outside Range and its reason, Approval (stages, moves, Approve Offer and Reject Offer for whom it waits on), Signers, History (from the offer's dates); the expiry, as Expires while the offer is with the candidate and Expired On once it lapsed (an offer accepted, declined or withdrawn shows none); View Letter beside Withdraw Offer, which opens the letter in a dialog of its own: the PDF with Open in Tab and Download PDF once it is made (as a query's letter, M3), the wording on paper before; New Offer, Edit Offer, Submit for Approval, Sign for Company, Send Offer, Resend Offer, Withdraw Offer, Offer Settings | help on Score: the weighted total when the offer was made; help on Vacancy Range; help on Additional Terms and Schedule A in the form; help on Wording in the letter editor | the approval snapshot rule, the two hashes: §6 here, the manual |
| Recruitment · Onboarding | the figures (Documentation with the documents to verify, Pre-Onboarding, Onboarding with the steps overdue, Hired This Month); the cases list across the page (hire, role, department, start date, outstanding, status); a pressed row opens the case in the wide dialog (F31 as amended 11/11/2026): the case (role, department, start date, Pre-Onboarding with what it waits on, BVN and Home Address entered or not, the privacy notice, Send Reminder, Withdraw Hire, Complete Onboarding), Documents (each item's state, View File, Verify, Reject with the reason), Guarantors (each one's check, date of birth, both addresses, Convicted, Recommends, View Form, View ID, Record Check), Contract (the signers, Download PDF, Sign for Company, Resend Contract, Reissue Contract) two by two, then Onboarding Plan across it (owner, due day, SOP, Overdue, Mark Step Done); Onboarding Settings (Checklist, Onboarding Plans, Standard Contract), shown to whom `can_configure` names. Verify, Reject, Record Check, Send Reminder, Complete Onboarding and Withdraw Hire show only for `can_check`, `can_complete` and `can_withdraw` | help on Pre-Onboarding: what the gate needs; help on BVN: where it is entered and that it is never shown | why documentation comes first: §3 here |
| Public · Sign Offer | the letter, Signers, the three steps (Read the Letter, Confirm Your Email, Sign Below), Send Code, the code, full name, title, Draw or Type, Agree to Sign Electronically, Accept and Sign, Decline the Offer, the outcome | help on Email Code | "this document is locked and verifiable" reassurance: never shown |
| Public · Upload Documents | the role and start date with how many documents are sent; the privacy notice to accept first; then Your Documents (each item with its state, a rejection's reason, Choose a File or the value), Your Guarantors (two, each with its check: name, relationship, phone, date of birth, Contact Address and Residential Address picked, Ever Convicted with What Happened, Recommends You, the Guarantor Form and the ID Copy), Your Address (Home Address, picked; Change Address), Your BVN (Change BVN); Documents Complete once documentation is done | help on BVN; help on Guarantor Form; help on ID Copy | how the files are stored: the manual |

### 10.2 Phone layout

| Screen | First on a phone | Left off a phone | Main action | Navigation |
|---|---|---|---|---|
| Recruitment · Offers | the four figures two to a row, then offer cards with a status pill; a tapped card opens the offer in a full bottom sheet | the role, compensation and expiry columns (in the sheet instead); the page subtitle | the record's next step (Submit for Approval, Sign for Company or Send Offer), full width in the sheet; New Offer in Quick Actions | bottom bar Recruitment; tabs scroll sideways |
| Recruitment · Onboarding | the four figures two to a row, then case cards with the start date and status; a tapped card opens the case in a full bottom sheet, its cards one under another | the role, department and outstanding columns; a step's due day and SOP (in the step's card) | Verify per item, Complete Onboarding full width | as above |
| Public · Upload Documents | the role and start date, then the privacy notice or the checklist | the steps list | each item's upload, Save Guarantor and Save BVN, full width | the public header menu |
| Public · Sign Offer | the role and expiry, then the letter, then the signature box | the steps list | Accept and Sign, full width at the foot | the public header menu |

## 11 · Edge cases

- A token opened twice: the second Accept and Sign returns the signed state, not an error.
- `/sign` with no token shows the guidance screen (Use Your Offer Email), never Not Found (GE, #82).
- The candidate declines after accepting: not possible; a signed offer is locked.
- The vacancy is closed while an offer is open: the offer stands; Not Progress All skips it.
- The hire's email bounces: when the mail server refuses the candidate's address for good after the
  offer was sent, the offer shows it (`send_refused_at`, read from the System Sender's Refused
  Addresses, `mail_refusal`; mail accepted for the address later clears it). Change Email corrects
  the address on the candidate and their signature and sends a fresh link; an address another
  candidate holds is refused. A bounce that comes back later as a mail of its own is not seen.
- A file over the upload engine's limit: refused, with the limit named.
- A file still being scanned cannot be verified (Wait for the virus scan to finish); one that failed it is rejected, and the hire sends another.
- The hire's link has lapsed or was lost: Send Reminder makes a fresh one and stops the rest.
- Several items rejected one after another: one mail each, each with a link of its own. Earlier links
  keep working, since the hire may have the page open sending the rest; Send Reminder still stops them
  all. An item the hire sent again before its mail went gets none.
- A guarantor replaced by another person at the same position: the new person's form and ID become the
  next versions of the old ones, under the new name.
- A department with no active plan of its own: its hires follow the company's default plan.
- No document requirements set: Send Offer is refused until the checklist has at least one required item.
- The hire leaves before the start date: Withdraw on the case ends it; the employee is archived and
  the application withdrawn (no mail). Withdraw stays open while the case is at onboarding, until it
  completes.
- The start date passes while the hire is still at documentation: the case waits; the morning after
  the gate opens, `onboarding-dispatch` starts it, its steps due from the start date (so some may be
  overdue at once, and are reminded).
- The step's role is held by nobody (no line manager on the record or above the vacancy's seat, a
  department with no head): the step goes to the case's owner.
- Not Progressing at Documentation or after: the case ends as on Withdraw (no half-onboarded hire), and
  the start date never moves it.
- The company email is another employee's or login's: Complete Onboarding is refused and nothing of
  it is kept.
- No Offer Signatory named when the offer is accepted: the contract's company signer is whoever
  signed the offer for the company.
- The hire declines the contract or lets it lapse (15 days from their link): the contract is
  `cancelled` and the owner told; the case stays at documentation, and Reissue Contract makes a new
  one for it, signed company then hire as the first.
- An internal candidate (someone on the staff): Send Offer is refused; the move goes through People.
- A rehire, or a hire withdrawn before and offered again: their archived record keeps the candidate's
  address; the new acceptance makes a new record with the placeholder work email, so nothing collides.
- The signatory has no login when the approval completes: the offer is approved with no request; the
  Offer Signatory named later sees Sign for Company and opens it by signing.

## 12 · Donor code

| From | File | Change on the way in |
|---|---|---|
| pixie | `src/shared/documents/documents.esign.service.js`, `esign.repo.js`, `esign.certificate.js`, `esign.signed-pdf.js` | becomes `signatures`; two hashes per row; email code only |
| pixie | `src/modules/recruitment/recruitment.render.js` | one Markdown renderer for page and PDF; the image stamped into the execution block |
| praxis-ls | `src/modules/vault/document_verification/`, `services/signatures/` (`canonical`, `certificate`, `qr`, `verify-link`, `tokens`) | leave `qes`, `qes_public`, `signature_wet`, `compliance_flag` |
| praxis-ls | `src/modules/hr/onboarding/` (with `onboarding.rules.js`), `sop_onboarding/`, `hr_contract/` | onboarding cases, plans, the contract |

## 13 · Open questions

Decided 06/11/2026 (AJ):

- **Offer and onboarding emails** go in M4's Candidate Emails store and editor: GE adds the keys
  `offer-sent`, `offer-signed` and `onboarding-documents`, one editor for every candidate mail.
- **New Offer is a chat card** (a candidate picker joins the chat's pickers); forms that carry the
  hire's personal documents stay `not_offered: personal`.

Open:

1. **Still owed by MyCity:** a sample employment contract. Until it comes the shipped wording
   (`templates/documents/employment-contract.html`) is a placeholder built from the offer letter's
   terms, which Operations & People replace on the contract settings without a code change. The
   sample offer letter and the New Joiner list arrived on 06/11/2026; the Employee Data, Guarantor
   and Account Opening forms, the HR Induction deck and the Incentive Plan on 07/11/2026, redacted in
   `docs/MyCity-ERP-Documents/onboarding-samples/`.

Decided 11/11/2026 (AJ), for PR 5:

- The candidate gets `offer-signed` with the sealed copy, not `signature-completed` as well.
- The contract is signed by the company first, then the hire; its invitation is `contract-sent`, a
  ninth Candidate Email beside GE's eight.
- The hire's work email is their candidate email until Complete Onboarding asks for the company one.
- The application is not hired at acceptance: it moves to Pre-Onboarding at the gate and Onboarding
  on the start date, and Complete Onboarding calls `hireIn` (GE's pipeline, #88), which supersedes
  the 06/11 plan of `hireIn` at acceptance (amended 12/11/2026: it had read "stays at Documentation").

Decided 11/11/2026 (AJ), for PR 6:

- **The New Joiner list and the default plan are seeded** (5399), an exception to A26 recorded in
  MILESTONES §10: Send Offer refuses an empty checklist, so the code cannot run without one. Seeded
  once, never written over; MyCity edits both on the settings.
- **A plan step's owner is a role**, named as a person when the steps reach a case (the case's owner
  when nobody holds the role).
- **PR 6 is built in two**, split at the documentation gate: 6a up to "documentation completes", 6b
  the start date, the plan's steps, Complete Onboarding with the company email, the login invite and
  `hireIn`.
- Request Document is Reject (with the reason the hire reads) and Send Reminder (a fresh link); no
  third action. (Employee 360's Documents tab keeps its own Request Document on `documents`' routes;
  the onboarding case has none.)

Decided 12/11/2026 (AJ), the audit of #122:

- **The hire's work email at acceptance** is a placeholder of the offer's own (`<offer number>@hire.invalid`)
  and the candidate's address their personal email, where every mail to the hire goes; Send Offer
  refuses a candidate who is an active employee. An acceptance refused for any reason reaches the
  candidate only as a plain retry.
- **Scope all** for the settings and Operations & People's case actions; a Head of Department marks
  their hires' steps done.
- **The BVN is correctable** by the hire until documentation completes.
- **The chat card asks for the reason** when the basic salary is outside the vacancy's range.
- **Reopen is refused** for an application not progressed at Documentation or after (M4's
  `candidates.reopen`, changed on this branch with AJ's decision that every fix lands here).
- **The hire's home address** is picked at documentation and is a gate condition; MyCity's Guarantor
  Form's fields are on each guarantor, and the signed form and ID copy are needed to pass.

Decided 11/11/2026 (AJ), for PR 6b:

- **Withdraw also withdraws the application**: `candidates.withdrawnIn`, new in M4's service (status
  `withdrawn`, its links stopped, `application.withdrawn`; no mail, as the hire is the one leaving),
  for GE to review. Not Progressing would have mailed the hire a rejection.
- **Withdraw is open until the case completes**, onboarding included.
- The login is invited in Complete Onboarding's own transaction through `users.inviteIn`, new in
  users' service, so the email, the login and `hireIn` stand or fall together.
- An overdue step is reminded once, kept on `onboarding_case_step.reminded_at` (migration 5060).
- Closing PR 6 (AJ, 12/11/2026): Not Progressing at Documentation or after ends the case as Withdraw
  does; a `line_manager` step's owner is read from the vacancy's Organogram seat while the hire's
  record names no line manager.

Open, for MyCity: the privacy notice's wording (`onboarding.upload.privacyNotice`) is written from
what the system does; Operations & People to confirm it before go-live.

Decided 12/11/2026 (AJ), found filming the Milestone 5 video:

- **Upload Documents has a write limit of its own**, 60 a minute a link (`onboardLimiter`, keyed by
  the token's hash), as staff uploads are counted per person; its writes no longer spend the public
  write limit of 20 a minute an address, which the page (two writes a document, 30 or more in all)
  met within the minute. The address's limit for every public request (120 a minute) still holds.
  SYSTEM_ARCHITECTURE §3 records it.
- **A file sent again replaces the one before it** as its next version (`vault.follow`), on an item
  and on a guarantor's form and ID: Employee 360's Documents tab shows one entry, the rejected file
  kept in its versions. Rejected does not become a state of a person's document.
- **The hire is mailed when something is to be sent again**: an item rejected (its title and the
  reason) or a guarantor whose check failed (their name, never the note), with a fresh link, as
  `onboarding-document-rejected`, a tenth Candidate Email beside the rest. The mail adds a link of its
  own and stops none: the hire may have the page open, sending the rest.

## 14 · Change log

- 12/11/2026 · AJ · The two questions left from filming (§3 step 6, §5, §7, §11, §13): Upload
  Documents' writes counted per link, 60 a minute (`onboardLimiter`); a file sent again becomes the
  next version of the one before (`vault.follow`, new), so a rejected file no longer stays on the
  Documents tab as Awaiting Check; the hire mailed `onboarding-document-rejected` (new, a Candidate
  Email) with a fresh link when an item is rejected or a guarantor's check fails.

- 12/11/2026 · GE · Found filming the Milestone 5 videos (`docs/runbooks/training-videos.md` §7), fixed (§3 step 6, §6, §10): a hire's files read on their Documents tab by their file's name and as Awaiting Check after Operations & People had verified them on the case; now each is titled by its requirement or guarantor when named (`vault.setTitle`, new) and verified on the record with the item or the guarantor's pass (`documents.verifiedIn`, new, which People's Verify Document now uses too). A previous employer's Years Known, never asked, was saved as 0 (`blank(z.coerce.number())` reads "" as 0); `GuarantorInput.years_known` is `optionalWhole`. The offer's details read Expired On for an accepted, declined or withdrawn offer; now Expires while it is with the candidate and Expired On only once it lapsed. Every Markdown email's written-out link now wraps on a phone (the email layout).

- 12/11/2026 · AJ · The audit of #122 (§2 to §8, §10, §11, §13): the offer's employment type in the employee's spellings (5070, the vacancy's mapped in New Offer); the hire's work email a placeholder until Complete Onboarding, their candidate address the personal email every mail goes to, Send refused for an active employee, and an acceptance refusal reaching the candidate as a plain retry; scope all for the settings and Operations & People's case actions (`can_check`, `can_configure`), Mark Step Done for the case's owner; the chat card's range reason; Reissue Contract, and 15 days for the hire to sign; Reopen refused past Offer; MyCity's Guarantor Form on each guarantor (5100, both addresses picked) and the form and ID copy needed to pass; the hire's home address picked and a gate condition; the BVN correctable until the gate; the contract's hire name frozen (5080); the confirmation date by `lagos.addMonths`; Withdraw shown with an approval only to its submitter or the CEO; offers and contracts locked request first; a signatory named after approval opens the request by signing; Withdraw honours `withdrawnIn`'s answer; a department's plan links only its own SOPs; the access log and metrics write a public link's token as `:token`. Employee 360's Documents tab opens a document beside the list (F31).

- 12/11/2026 · AJ · PR 8, close-out (§9, §14): the guide to Built. Every M5 form has a chat card or its reason (New Offer the only card; Complete Onboarding and Withdraw stay on the screen, decided); ⌘K reaches offers, cases and contracts; every picture of the Recruitment, People and public-site chapters retaken. The empty stubs deleted (`jobs/handlers/signature-reminder.js`, `signatures.controller.js`, `signatures.routes.js`); `employment_contracts.test.js` holds the module's unit tests (its statuses, its values, what a signature covers, its routes). MyCity's sample contract has still not arrived (§13).

- 12/11/2026 · AJ · PR 7, the onboarding screens (§1, §2, §5, §10): Recruitment · Onboarding rewritten on the contract (`Onboarding.tsx`, `OnboardingCase.tsx`, `OnboardingSettings.tsx`; its mock `app/src/api/mock/modules/onboarding.ts`), the INTERIM types and mock removed; `GET /recruitment/onboarding/summary` (`OnboardingSummary`, contract first; AJ chose figures over none); the public Upload Documents page (`/onboard/<token>`); the Employee 360 Documents tab on `documents`' routes (`EmployeeDocuments.tsx`, AJ); Sign for the Company shared by the offer and the contract (`CompanySignForm`).

- 12/11/2026 · AJ · Closing PR 6 (§3 step 8, §6, §7, §11, §13): Not Progressing on an application at Documentation or after ends its open case as Withdraw does (`onboarding.end_for_application` in place of `onboarding.stop_links`); a `line_manager` step's owner comes from the vacancy's Organogram seat until `hireIn` fills it.
- 11/11/2026 · AJ · PR 6b, onboarding to hired (§3 step 8, §4 to §7, §9, §11, §13): `onboarding-dispatch` (the start date, the plan's steps copied with their owners and due days, overdue steps reminded once; 5060), Mark Step Done, Complete Onboarding (the company email, the login invited, `hireIn`, one transaction), Withdraw (the contract, links, employee and application ended with the case); `OnboardingDetail.steps`, `can_complete`, `can_withdraw`.
- 11/11/2026 · AJ · PR 6a, onboarding to the documentation gate (§3 steps 6 and 7, §4 to §7, §9, §11, §13): the Checklist and Plans settings, the New Joiner list and Your First 30 Days seeded (5399), plans and the case's steps (5050), the Upload Documents link and page API with the privacy notice, files on the employee and scanned, two guarantors with their checks, the BVN, verify and reject, the gate (asked after each of its conditions, the contract's signature included), `waiting_on`, ⌘K and the assistant's read. Fixed from PR 5: the contract's company name on a database without a company profile, and its signature request's creator at acceptance.
- 11/11/2026 · GE · The letter left the offer's dialog, which it made long: View Letter, beside Withdraw Offer, opens it in a dialog of its own, the PDF with Open in Tab and Download PDF once made (`DocumentPreview`, as a query's letter in M3), the wording on paper before (§10). Download PDF moved there from the offer's buttons.
- 11/11/2026 · TB · M10 PR 4 (`knowledge.md` §6.10): Verify a Document also checks a training certificate by its number. `VerifyResult.document_type` is `VerifiedDocumentType` (the signed types and `training_certificate`; the signing page keeps `SignedDocumentType`), and the result gains `certificate` (holder, course, completion date), null for every signed document. The page shows a certificate's Awarded To, Course, Completed and Published By; offers and agreements read as before.
- 06/11/2026 · AJ · First draft from the Modules Review of 04/11/2026, AJ's decisions on #79 (offer approval, the contract's own signature, the employee at acceptance, BVN, department plans, the seat on hire) and GE's answers (`advanceIn`, `hireIn`, the public pages on #82).
- 06/11/2026 · AJ · The offer emails go in M4's Candidate Emails; New Offer is a chat card.
- 06/11/2026 · AJ · From MyCity's sample offer letter and New Joiner list: monthly pay lines and the Offer Summary's fields on the offer, the company signing when the offer is approved, the New Joiner checklist, two guarantors with reference checks, BVN a number only (§3, §4, §6). PR 1's migrations named.
- 06/11/2026 · AJ · PR 2, the signatures service built (§5's signing and verification routes, §7's events and the sealing): `defineSignable` for each signed record type, the company's signatory signing in the hub, the email code, the QR key that outlives a public link.
- 06/11/2026 · AJ · PR 3, the offers backend (§3 steps 1 to 4, §5, §6, §7, §9): the Offer Signatory setting, the letter generated and its request opened at approval with the wording's version kept, Send making the link after commit, expiry through `signature-reminders` (no `offer-expiry` job), Head of Department's recruitment `approve` grant for the flow's first stage, `offer.accepted` in place of `offer.signed`.
- 07/11/2026 · AJ · Merged with `main` after GE's hand-over (#88): `offer-sent` uses Candidate Emails' wording and `candidates.OfferSentEmailVars` (the offers contract's own copy removed); Send moves the card to Offer, and an offer ending unsigned moves it back to Shortlist (`offerEndedIn`).
- 07/11/2026 · AJ · PR 4, the screens (§2, §5, §10): Recruitment · Offers on the contract (the figures, the list beside the offer, Monthly Pay against the vacancy's range, the approval with Approve and Reject through the workflow routes for whom it waits on, Signers, History from the offer's dates, the letter on paper, the actions per `can_*`; New and Edit Offer as a four-step wizard; Sign for the Company; Offer Settings), opened by `?id=`, `?new=1`, `?application=`, `?status=` and `?panel=settings`; `OfferListQuery.application_id` for the board's Open Offer (Make Offer on a shortlisted card); Sign Offer and Verify Document on the signatures routes (the email code, name, title, draw or type, the consent, the signers; every signer and the status on Verify). The code's field messages are four words (Ask for another code).
- 07/11/2026 · AJ · PR 4: the failed send (§5, §11): `OfferDetail.candidate_email`, `send_refused_at` and `can_change_email`; Change Email (`POST /:id/recipient`, `OfferRecipient`) through `candidates.correctEmailIn` and `signatures.setSignerEmailIn`.
- 11/11/2026 · AJ · PR 5, acceptance to hire (§3 steps 5, 5a and 8, §5, §6, §7, §11, §13): the acceptance transaction (employee, Documentation, case, contract), the contract signed company then hire with its routes and wording settings, `offer-signed` with the sealed copy for the candidate, `contract-sent`, Submit needing employment type and work pattern, Send refused without a required checklist item. `hireIn` moves to Complete Onboarding, as GE's pipeline (#88) has it.
- 08/11/2026 · TB · M7 PR 6 on the shared signatures service (`docs/guides/partnerships.md` §13.2, In PR 6): `void` signers and `SignerView.method`; a signable's optional `blocks` and `sealedTo` (the owner's sealed copy); `recordPaperIn` for a copy signed on paper (migration `7100`: no email only then), verified by reference only; `stopLinksFor` when a record is sent again; `progressOf` for a record's signers; the sealed copy's QR on every page. Offers' behaviour is unchanged (§6).
- 08/11/2026 · GE · (Ose) Offers on desktop (GE's ask, F31 as amended 08/11/2026): the list takes the page's width (number, candidate, role, start date, annual with Outside Range, status, sent, expires) and a row opens the offer in a wide dialog (ListDetail `modal` size `xl`): the offer, Monthly Pay, Approval and Signers two by two, then History and the letter across it. Nothing opens unasked; the phone is unchanged (§10).
- 08/11/2026 · GE · (Ose) In the dialog, Approval sits under Monthly Pay in the same card and Signers under the offer's details in its card (each its own card in a phone's sheet), and the dialog has Close at its foot (ListDetail `closeButton`, desktop only).
