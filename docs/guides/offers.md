# Offers, Documentation & Onboarding · Engineering Guide

| | |
|---|---|
| Owner | AJ |
| Milestone | M5 |
| Backend modules | `offers`, `signatures`, `onboarding`, `employment_contracts` |
| Frontend paths | `app/src/features/recruitment/Offers.tsx` (with `OfferForm.tsx`, `OfferSign.tsx`, `OfferSettings.tsx`), `app/src/features/recruitment/Onboarding.tsx`, `public-app/src/pages/SignOffer.tsx`, `public-app/src/pages/Verify.tsx` |
| Permission key(s) | `recruitment` (offers and onboarding cases); `people` (the hire's documents on the Employee 360) |
| Capabilities | none; who approves an offer is the `recruitment.offer` flow on Settings · Approvals, not a capability |
| Screens (PROGRESS.md rows) | #42 Offers, #43 Onboarding; public #84 Sign Offer, #85 Verify Document, #112 Upload Documents (added with PR 6a; `new:screen` makes staff-app tabs only); changes to #39 Candidates (the Offer column, GE), People · Employee 360 (a Documents tab), Settings · Approvals (#72) |
| Status | Draft |
| Last changed | 11/11/2026 |

The public pages (`public-app/src/pages/SignOffer.tsx`, `Verify.tsx`) joined **Frontend paths** with
PR 4, which wired them. The People 360 Documents tab joins with PR 7; until then `foundation.md` owns
`app/src/features/people/`, so adding it here now would make every change there ask for this guide too.

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
| Recruitment · Onboarding (`onboarding`) | staff app | `recruitment` view | every onboarding case: hire, role, start date, status, checklist progress; one case's checklist, contract and plan | Verify and Reject a document, Request Document, Send Reminder, Sign for Company and Resend Contract on the contract, Mark Step Done, Complete Onboarding; Checklist, Plans and Contract settings |
| Recruitment · Candidates (`candidates`) | staff app | as M4 | the Offer column (GE) | Open Offer on the sheet of a card at Offer or after (Offers opened by `?application=`); Make Offer on a shortlisted one (`?new=1&application=`) |
| Public · Sign Offer (`/sign/<token>`) | go.mycityapp.io | the candidate holding the link | the letter, the signing steps, the outcome | Send Code, sign (draw or type), Accept and Sign, Decline the Offer |
| Public · Verify Document (`/verify/<number>`, `/verify/t/<token>`) | go.mycityapp.io | anyone | status, signers, the two verdicts; by QR token the document too | look up a reference |
| Public · Upload Documents (`/onboard/<token>`) | go.mycityapp.io | the new hire holding the link | the checklist: required, uploaded, outstanding, each item's verification | accept the privacy notice, upload each document, enter BVN |
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
   are `candidates.OfferSentEmailVars` (the role, the offer's number, the link, the expiry). An offer
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
     date, probation (the confirmation date), phone, and the candidate's email as both the work and
     the personal email until Complete Onboarding takes the company address (AJ, 11/11/2026);
   - `candidates.advanceIn(client, actor, applicationId, "documentation")` moves the card from
     Offer to Documentation (GE's pipeline, recruitment.md §6.3); a false answer refuses the whole
     acceptance, so the candidate is told to try again rather than half-hired;
   - the onboarding case opens at `documentation` with the employee, its checklist one item for
     each active document requirement;
   - the employment contract is numbered (CON), generated from the standard contract wording in
     force (its version kept on the document), the offer's terms, the final job description and the
     hire's staff number, and its signature request opened with **the company first and the hire
     second** (AJ, 11/11/2026): the Offer Signatory named on the Offers settings, or whoever signed the
     offer for the company when none is named now. The signatory is told it waits for them.
   The sealed offer then reaches the candidate as `offer-signed` (Candidate Emails), with the sealed
   copy attached, in place of the signatures service's own `signature-completed`; the company's
   signatory still receives that one (AJ, 11/11/2026). `onboarding-documents` and its Upload
   Documents link come with the upload page (PR 6). The application stays at Documentation until
   onboarding completes: `candidates.hireIn` is called by Complete Onboarding (step 8), not here.
5a. **The contract.** The Offer Signatory presses Sign for Company on the hire's case, signed in
   with no email code. The hire's link is then made and emailed as `contract-sent` (Candidate
   Emails) after commit; Resend Contract makes a fresh one and revokes the earlier. The hire signs on
   `/sign/<token>` as for the offer. Their signature, the last, marks the contract `signed`, and the
   sealed copy is mailed to both. Declined or lapsed, the contract is `cancelled` and the case's
   owner told.
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
   and is then named on its item; Operations & People verify each once its scan is clean, or reject
   it with a reason the hire reads beside the item and send it again. The hire enters their BVN once (a masked
   number on the employee record, no upload) and their **two guarantors**: not related to them, one
   a previous employer and one who has known them four years or more, no serving police, military
   or other uniformed staff, each with their guarantor form. Operations & People run a reference
   check on each and record Passed or Failed. A failed guarantor is corrected by the hire, which
   starts its check again; a guarantor who has passed stays as they are.
7. **Pre-onboarding.** When every required item is verified, both guarantors have passed, the BVN
   is entered and the contract is signed, the case moves to `pre_onboarding` and the application to
   Pre-Onboarding (`candidates.advanceIn`) in the same transaction. The gate is asked after each of
   those (a verification, a reference check, the BVN, the hire's signature on the contract), so
   whichever comes last opens it. The case shows what it still waits on (`waiting_on`). Nothing
   before that opens onboarding, and from then the upload page takes nothing more.
8. **Onboarding.** On the start date the case moves to `onboarding` and the department's plan steps
   are added, each with an owner and a due date and linked to the department's SOPs. Complete
   Onboarding (every step done) asks for the hire's company email, closes the case, calls
   `candidates.hireIn` (the application to Hired, the Organogram seat filled, the vacancy closed as
   filled when its openings are) and invites the hire's login to the company email.
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
| `onboarding_guarantor` | `onboarding_case_id`, `position` (1, 2), `kind` (`previous_employer`, `personal`), `full_name`, `relationship`, `phone`, `years_known`, `form_document_id`, `check_status` | 5030. The reference check: `pending`, `passed`, `failed`, with who and when |
| `employment_contract` | `onboarding_case_id`, `employee_id`, `number` (CON), `document_id`, `signature_request_id` | 5000 |
| `onboarding_plan` | `department_id` (null for the company's default), `name`, `active` | 5050. One plan a department and one default (partial unique indexes). The default, Your First 30 Days from the HR Induction deck, is seeded by 5399 with its four steps |
| `onboarding_plan_step` | `onboarding_plan_id`, `position`, `title`, `owner_role`, `due_offset_days`, `sop_id` | 5050. The owner is a role (`case_owner`, `line_manager`, `head_of_department`, `hire`), named as a person when the steps are copied onto a case; the due day counts from the start date. `sop_id` has no foreign key: `sop` is M10's (10400, after this block), so the service takes only an SOP in force |
| `onboarding_case_step` | `onboarding_case_id`, `position`, `title`, `owner_role`, `owner_id`, `due_on`, `sop_id`, `status` (`pending`, `done`), `done_by`, `done_at` | 5050. The plan's steps copied onto the case when it reaches onboarding (PR 6b), so a plan changed later never changes a hire's steps |
| `employee.bvn` | eleven digits | 5040, masked under `employee.bank` (organisation's table, TB reviews) |
| `talent_pool`, `talent_pool_member` | | 5000, never used (M4's pool is `talent_pool_entry`, 4060). Dropped in 5010 |

Schema migration files: `migrations/5000_offers_onboarding.sql` (merged, never edited),
`5010_offer_terms.sql`, `5020_signature_evidence.sql`, `5030_onboarding_documentation.sql`,
`5040_employee_bvn.sql`, `5050_onboarding_plans.sql`, `5090_drop_unused_talent_pool.sql`. Reference data:
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
| `GET /api/v1/recruitment/offers/summary` | → `OffersSummary` | `recruitment` view | | drafts, with approval, to send, with candidates, accepted this month |
| `GET /api/v1/recruitment/offers/draft` | `OfferDraftQuery` → `OfferDraft` | `recruitment` create | | what New Offer starts from |
| `POST /api/v1/recruitment/offers` | `OfferCreate` → `OfferDetail` | `recruitment` create | | application active at `shortlist` (or `offer` after one ended); department and worksite default to the vacancy's |
| `GET/PATCH /api/v1/recruitment/offers/:id` | `OfferDetail`, `OfferEdit` | `recruitment` view/edit | | edit only in draft |
| `POST /api/v1/recruitment/offers/:id/submit`, `/send`, `/resend` | `EmptyBody` → `OfferDetail` | `recruitment` edit | | |
| `POST /api/v1/recruitment/offers/:id/recipient` | `OfferRecipient` → `OfferDetail` | `recruitment` edit | | Change Email on a sent offer: the address on the candidate (`candidates.correctEmailIn`) and on their signature, then a fresh link mailed to it, every earlier one revoked |
| `POST /api/v1/recruitment/offers/:id/withdraw` | `OfferWithdraw` → `OfferDetail` | `recruitment` edit | | with its approval, approved or sent |
| `POST /api/v1/recruitment/offers/:id/sign` | `SignSubmit` → `OfferDetail` | `recruitment` view, and the signer named on its request | | the company's signature, in the hub |
| `GET /api/v1/recruitment/offers/:id/document` | PDF | `recruitment` view | | the sealed copy once there is one |
| `GET /api/v1/recruitment/offers/settings`, `PUT .../settings/signatory` | `OfferSettings`, `OfferSignatorySave` | `recruitment` edit | | the Offer Signatory (setting `recruitment.offer_signatory`) |
| `GET/PUT /api/v1/recruitment/offers/settings/letter`, `POST .../letter/restore` | `OfferLetterTemplate`, `OfferLetterTemplateSave` | `recruitment` edit | | the standard wording, a `template_version` of `offer-letter` |
| `GET /api/v1/recruitment/onboarding` | `OnboardingListQuery` → `OnboardingPage` | `recruitment` view · all/team (the case's owner) | yes, 25 | filters: status, department, q (the hire or the role) |
| `GET /api/v1/recruitment/onboarding/:id` | → `OnboardingDetail` | `recruitment` view | | the checklist, guarantors, `bvn_entered` (never the number), the contract, `waiting_on` |
| `POST /api/v1/recruitment/onboarding/:id/items/:item_id/verify` | `EmptyBody` → `OnboardingDetail` | `recruitment` edit | | an item sent and, for a file, scanned clean (409 `SCAN_PENDING`, `FILE_INFECTED`); then the gate |
| `POST /api/v1/recruitment/onboarding/:id/items/:item_id/reject` | `ChecklistItemReject` → `OnboardingDetail` | `recruitment` edit | | back to the hire with the reason |
| `POST /api/v1/recruitment/onboarding/:id/guarantors/:guarantor_id/check` | `ReferenceCheckRecord` → `OnboardingDetail` | `recruitment` edit | | Passed or Failed with a note; then the gate |
| `POST /api/v1/recruitment/onboarding/:id/remind` | `EmptyBody` → `OnboardingDetail` | `recruitment` edit | | Send Reminder: a fresh link mailed, every earlier one stopped |
| `POST /api/v1/recruitment/onboarding/:id/steps/:stepId/done`, `/complete` | | `recruitment` edit | | PR 6b |
| `GET/POST /api/v1/recruitment/onboarding/requirements`, `PATCH .../requirements/:id` | `DocumentRequirementListQuery` → `DocumentRequirementPage`; `DocumentRequirementCreate`, `DocumentRequirementEdit` → `DocumentRequirement` | `recruitment` edit | yes, 25 | the Checklist settings; a code is kept once made (409 `CODE_TAKEN`) |
| `GET/POST /api/v1/recruitment/onboarding/plans`, `GET/PUT .../plans/:id` | `OnboardingPlanListQuery` → `OnboardingPlanPage`; `OnboardingPlanSave` → `OnboardingPlan` | `recruitment` edit | yes, 25 | the Plans settings; a plan saved whole (409 `PLAN_EXISTS`, 422 `SOP_NOT_FOUND`) |
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
| `POST /api/v1/recruitment/contracts/:id/resend` | `EmptyBody` → `EmploymentContractView` | `recruitment` edit | | a fresh link to the hire, every earlier one revoked; once the company has signed |
| `GET /api/v1/recruitment/contracts/:id/document` | PDF | `recruitment` view | | the sealed copy once there is one, else the copy generated at acceptance |
| `GET/PUT /api/v1/recruitment/contracts/settings/template`, `POST .../template/restore` | `ContractTemplate`, `ContractTemplateSave` | `recruitment` edit | | the standard contract wording, a `template_version` of `employment-contract` |
| `GET /api/public/v1/onboard/:token` | → `UploadPack` | public token `onboarding.upload` (the case its subject) | | the checklist as the hire sees it, the privacy notice's sentences; a guarantor's check note is left out |
| `POST /api/public/v1/onboard/:token/privacy` | `PrivacyAcknowledge` → `UploadPack` | public token | | first; every write below is 409 `PRIVACY_FIRST` before it |
| `POST /api/public/v1/onboard/:token/files` | multipart `file` (`UploadFile`) → `DocumentRef` | public token | | at most 15 MB (purpose `document`); stored on the hire's employee record, quarantined and scanned |
| `POST /api/public/v1/onboard/:token/items/:item_id` | `UploadItem` → `UploadPack` | public token | | the file sent on this link, the typed value, or both, as the requirement's kind asks |
| `POST /api/public/v1/onboard/:token/guarantors` | `GuarantorInput` → `UploadPack` | public token | | by position (1, 2); two of different kinds (422 `SAME_KIND`); a passed one stays (409 `ALREADY_CHECKED`) |
| `POST /api/public/v1/onboard/:token/bvn` | `BvnEnter` → `UploadPack` | public token | | eleven digits, kept on `employee.bvn`; then the gate. After documentation every write is 409 `DOCUMENTATION_DONE` |

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
- Send Offer is refused until the onboarding checklist has at least one active required item.
- Acceptance is one transaction (§3 step 5): if any part refuses, the candidate's signature is not
  kept and they are asked to try again.
- The contract is signed by the company first, then the hire; the hire's link exists only after the
  company's signature. Its wording is the version in force at acceptance, kept on its document, so a
  later edit never changes a contract already generated.
- Until Complete Onboarding, the hire's work email is their candidate email.
- A signer reads `void` on the signing and verification pages (and on a record's signers) once their signature sits on a request that ended unsigned: another signer declined, it lapsed or it was withdrawn (M7 PR 6, partnerships.md §13.2). Signing views also carry the document's `blocks` where its type gives them (an agreement's headings, clauses and tables) and each signer's `method`.
- A sealed copy prints its QR in the letterhead's header, so on every page (partnerships.md §6.9 step 7).
- Documentation completes when every required item is verified, both guarantors have passed their reference checks, the BVN is entered and the contract is signed. Onboarding never opens before that.
- The hire accepts the privacy notice before sending anything. A file they send is theirs to name only on their own link (on their employee record, sent from no signed-in user); a file is verified only once its virus scan is clean.
- An optional item never holds the gate; whether an item is required is read from its requirement as it stands. A requirement switched off stays on the cases already open.
- The BVN is never returned by any route (only `bvn_entered`), never written into an audit row, and never sent to a model.
- The Upload Documents link is never kept or put in the outbox: only its hash is stored, and the mail is queued with it straight after its own transaction. Not Progressing stops it.
- A personal guarantor has known the hire four years or more; the two are not the same kind.
- Onboarding plan steps come from the hire's department plan; Complete Onboarding needs every step done, then the login is invited (`users.invite`).
- No AI drafts an offer or a contract: both are the template plus the offer's fields. M5 registers no AI job.

## 7 · Events, jobs and notifications

| Event / job | When | Does |
|---|---|---|
| `offer.created`, `offer.updated` | New Offer, a draft's edit | audit |
| `offer.submitted`, `offer.approved`, `offer.rejected` | the approval flow | the approvers hear through the flow; approved tells the owner and the Offer Signatory; rejected the owner |
| `offer.sent`, `offer.resent` | Send Offer, Resend | the service queues `offer-sent` after commit with a link made then |
| `offer.accepted` | the offer's signature request completes (`signature.completed`, the candidate's signature last) | tells the owner; in the same transaction the employee, the move to Documentation, the case and the contract (§3 step 5) |
| `contract.generated` | at acceptance | tells the company's signatory the contract waits for them |
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
| `onboarding.privacy_acknowledged`, `.bvn_entered` | the hire on their page | audit (never the number) |
| `onboarding.item_uploaded` | the hire sent an item | tells the owner |
| `onboarding.item_verified`, `.item_rejected` | Operations & People | audit; the hire reads a rejection's reason on their page |
| `onboarding.guarantor_saved` | the hire entered or corrected a guarantor | tells the owner |
| `onboarding.guarantor_checked` | a reference check recorded | audit |
| `onboarding.documentation_completed` | the gate, in the transaction of whatever came last | tells the owner; the application at Pre-Onboarding |
| `onboarding.requirement_saved`, `.plan_saved` | the Checklist and Plans settings | audit |
| `application.not_progressed` (M4) | Not Progressing | the case's Upload Documents links stop (`onboarding.stop_links`) |
| `onboarding.completed` | Complete Onboarding | invite the hire's login |
| `signature-reminders` job | daily, 06:17 Lagos | ends requests past their end; their links stop working |
| `onboarding-dispatch` job | daily | move cases to `onboarding` on their start date; remind owners of overdue steps |

## 8 · Permissions and visibility by role

| Role | Sees | Can do |
|---|---|---|
| Operations & People, Implementation | every offer and case | everything on Offers and Onboarding |
| Management | every offer and case | as above, no delete |
| Head of Department | offers and cases for their vacancies | view, create and edit drafts |
| Approvers of `recruitment.offer` | the offers waiting for them | Approve, Reject |
| The candidate / hire | their own offer and upload pack, by token | sign, decline, upload |

Restricted fields: compensation (offer viewers only), BVN (masked; Operations & People only), the
signer evidence (IP, device) on the offer's detail only. No capability is needed.

## 9 · AI and search

- **AI reads** (`offers.ai.js`, `onboarding.ai.js`): offers by status and expiring soon; cases by status with outstanding items. Paged at 25. No personal data to DeepSeek.
- **AI routes**: "make an offer to <candidate>" opens New Offer with the application; "who still owes documents" opens Onboarding filtered.
- **AI cards**: New Offer is a card (`offers.create`, `OfferCard`: the candidate picked from the shortlist through `candidates.list`, the start date, the monthly basic salary; the rest starts from the vacancy and the draft is finished on Offers); the document upload and BVN forms are `not_offered: personal`. Approving, signing, sending and withdrawing stay on the screen.
- **Search** (`offers.search.js`, `onboarding.search.js`): offers by number (OFF-), candidate and role; onboarding cases by the hire's name or the role (built in PR 6a, opening the case by `?case=` as a contract does); employment contracts by number (CON-).
- `onboarding.ai.js` (PR 6a): the read `onboarding.list` and three routes; the Checklist and Plans settings' forms are `not_offered` (`design:`). The hire's upload, guarantor and BVN forms are not staff-app create or edit forms, so gate 23 asks no reason of them; they never reach the chat.

## 10 · On screen and mobile

### 10.1 Content tiers

| Screen | Open (tier 1) | Behind help (tier 2) | Not on screen (tier 3), lives in |
|---|---|---|---|
| Recruitment · Offers | the figures (With Approval with the drafts, To Send, With Candidates, Accepted This Month); the offers list across the page (number, candidate, role, start date, annual compensation with Outside Range, status, sent, expiry); a pressed row opens the offer in a wide dialog (F31 as amended 08/11/2026): the offer's summary with Signers under its details in the same card, beside Monthly Pay with Approval under the pay in the same card, then History across it, and Close at its foot; the offer's summary, Monthly Pay with Outside Range and its reason, Approval (stages, moves, Approve Offer and Reject Offer for whom it waits on), Signers, History (from the offer's dates); View Letter beside Withdraw Offer, which opens the letter in a dialog of its own: the PDF with Open in Tab and Download PDF once it is made (as a query's letter, M3), the wording on paper before; New Offer, Edit Offer, Submit for Approval, Sign for Company, Send Offer, Resend Offer, Withdraw Offer, Offer Settings | help on Score: the weighted total when the offer was made; help on Vacancy Range; help on Additional Terms and Schedule A in the form; help on Wording in the letter editor | the approval snapshot rule, the two hashes: §6 here, the manual |
| Recruitment · Onboarding | the cases list (hire, role, start date, status, items outstanding); a case's checklist with each item's state, the contract, the plan steps | help on Pre-Onboarding: every required document verified and the contract signed | why documentation comes first: §3 here |
| Public · Sign Offer | the letter, Signers, the three steps (Read the Letter, Confirm Your Email, Sign Below), Send Code, the code, full name, title, Draw or Type, Agree to Sign Electronically, Accept and Sign, Decline the Offer, the outcome | help on Email Code | "this document is locked and verifiable" reassurance: never shown |
| Public · Upload Documents | the privacy notice to accept, each item with its state, upload | help on BVN | how the files are stored: the manual |

### 10.2 Phone layout

| Screen | First on a phone | Left off a phone | Main action | Navigation |
|---|---|---|---|---|
| Recruitment · Offers | the four figures two to a row, then offer cards with a status pill; a tapped card opens the offer in a full bottom sheet | the role, compensation and expiry columns (in the sheet instead); the page subtitle | the record's next step (Submit for Approval, Sign for Company or Send Offer), full width in the sheet; New Offer in Quick Actions | bottom bar Recruitment; tabs scroll sideways |
| Recruitment · Onboarding | case cards with items outstanding; the case opens in a sheet | the plan's due dates (in the step) | Verify, full width per item | as above |
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
- A department with no active plan of its own: its hires follow the company's default plan.
- No document requirements set: Send Offer is refused until the checklist has at least one required item.
- The hire leaves before the start date: Withdraw on the case ends it; the employee is archived.
- No Offer Signatory named when the offer is accepted: the contract's company signer is whoever
  signed the offer for the company.
- The hire declines the contract or lets it lapse: the contract is `cancelled` and the owner told;
  the case stays at documentation.

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
- The application stays at Documentation until Complete Onboarding calls `hireIn` (GE's pipeline,
  #88), which supersedes the 06/11 plan of `hireIn` at acceptance.

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
  third action.

Open, for MyCity: the privacy notice's wording (`onboarding.upload.privacyNotice`) is written from
what the system does; Operations & People to confirm it before go-live.

## 14 · Change log

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
