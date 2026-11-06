# Offers, Documentation & Onboarding · Engineering Guide

| | |
|---|---|
| Owner | AJ |
| Milestone | M5 |
| Backend modules | `offers`, `signatures`, `onboarding`, `employment_contracts` |
| Frontend paths | `app/src/features/recruitment/Offers.tsx`, `app/src/features/recruitment/Onboarding.tsx` |
| Permission key(s) | `recruitment` (offers and onboarding cases); `people` (the hire's documents on the Employee 360) |
| Capabilities | none; who approves an offer is the `recruitment.offer` flow on Settings · Approvals, not a capability |
| Screens (PROGRESS.md rows) | #42 Offers, #43 Onboarding; public #84 Sign Offer, #85 Verify Document, and a new public Upload Documents row (PR 6 registers it with `npm run new:screen`); changes to #39 Candidates (the Offer column, GE), People · Employee 360 (a Documents tab), Settings · Approvals (#72) |
| Status | Draft |
| Last changed | 06/11/2026 |

The public pages (`public-app/src/pages/SignOffer.tsx`, `Verify.tsx`) and the People 360 Documents
tab join **Frontend paths** in the PR that wires them (PR 4 and PR 7, §12 of the handoff). Until
then GE's #82 owns their screens and `foundation.md` owns `app/src/features/people/`, so adding them
here now would make every change to those files ask for this guide too.

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
| Recruitment · Offers (`offers`) | staff app | `recruitment` view; a hiring manager their vacancies (team scope) | every offer: number, candidate, role, compensation, status, expiry; the offer's letter as the candidate will read it, its approval chain and signers | New Offer (from a shortlisted application), Edit, Submit for Approval, Approve and Reject (approvers), Send Offer, Resend, Withdraw, Download PDF |
| Recruitment · Onboarding (`onboarding`) | staff app | `recruitment` view | every onboarding case: hire, role, start date, status, checklist progress; one case's checklist, contract and plan | Verify and Reject a document, Request Document, Send Reminder, Mark Step Done, Complete Onboarding; Checklist and Plans settings |
| Recruitment · Candidates (`candidates`) | staff app | as M4 | the Offer column (GE) | open the offer from the card |
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
   the Offer column once the board has one. Resend makes a fresh link and revokes the earlier one.
   The record, the signing page and every PDF read one set of values through one template and one
   Markdown renderer (`offers.render`).
4. **Sign.** The candidate opens `/sign/<token>`, reads the same text the PDF holds, receives an
   email code, types full name and title, draws or types a signature, ticks the consent, and
   presses Accept and Sign (partnerships.md §6.9 is the signing service, built here first). Decline
   the Offer takes a reason and ends the offer.
5. **Accept (one transaction).** The signature row is written with its evidence and both hashes;
   the PDF is sealed. Then:
   - `organisation.createEmployee` creates the employee **without a seat**, no login invited;
   - `candidates.hireIn(client, actor, applicationId, { employee_id })` (GE's) moves the
     application `offer → hired`, sets status `hired`, fills the vacancy's Organogram seat and
     closes the vacancy as `filled` when its hires reach its openings;
   - the onboarding case opens at `documentation`, its checklist built from the active document
     requirements;
   - the employment contract is generated from the offer, the final job description, the vacancy
     and the hire's details, and sent for its own signature;
   - `offer-signed` and `onboarding-documents` are emailed, the latter with the Upload Documents link.
6. **Documentation.** The hire uploads on `/onboard/<token>` after accepting the privacy notice.
   The checklist is MyCity's New Joiner list, entered on the Checklist settings: proof of residential
   address, a valid ID, educational and professional certificates (with NYSC), evidence of separation
   from the last employer, birth certificate, the Employee Data Form, the MyLagosApp Wallet ID (a
   typed value), a passport photograph and the bank Account Opening Form; the signed offer and the
   contract are added by the system. Each file lands on the employee (People 360 Documents tab) and
   on its item; Operations & People verify or reject each. The hire enters their BVN once (a masked
   number on the employee record, no upload) and their **two guarantors**: not related to them, one
   a previous employer and one who has known them four years or more, no serving police, military
   or other uniformed staff, each with their guarantor form. Operations & People run a reference
   check on each and record Passed or Failed.
7. **Pre-onboarding.** When every required item is verified, both guarantors have passed and the
   contract is signed, the case moves to `pre_onboarding`. Nothing before that opens onboarding.
8. **Onboarding.** On the start date the case moves to `onboarding` and the department's plan steps
   are added, each with an owner and a due date and linked to the department's SOPs. Complete
   Onboarding (every step done) closes the case and invites the hire's login.
9. **Verify.** Every signed document carries a QR on each page linking to `/verify/t/<token>`;
   a typed reference shows status and verdicts, not content (A9).

## 4 · Data

| Table | Key columns | Notes |
|---|---|---|
| `offer` | `application_id`, `number` (OFF), `status`, `job_title`, `start_date`, `expires_at`, `annual_compensation`, `terms`, `document_id` | 5000. 5010 adds the Offer Summary (`reports_to`, `role_function`, `role_scope`, `employment_type`, `work_pattern`, `office_days`, `annual_leave_days`, `incentives`), `job_description`, `working_hours`, `probation_months`, `workflow_instance_id`, `signature_request_id`, `score_snapshot`, `decision_snapshot`, `sent_at`, `withdrawn_at`, `end_reason`, a status CHECK, and one open offer per application. `annual_compensation` is twelve times the pay lines' sum; `terms` keeps `valid_days` and `benefits` |
| `offer_pay_line` | `offer_id`, `position`, `name`, `monthly_amount` | 5010. The monthly compensation, line by line |
| `signature_request` | `document_id`, `subject_type`, `subject_id`, `status`, `expires_at` | 5000. Shared with M7 (`partnership_agreement.signature_request_id`); LA reviews any change |
| `signature` | `signature_request_id`, `signer_name`, `signer_email`, `signed_at`, `evidence` | 5000. 5020 adds `content_hash`, `artifact_hash` (A12), `signer_title`, `method`, `signature_document_id`, `code_verified_at`, `viewed_at`; a signed row must carry its time, method and content hash. 5020 also adds the request's `sealed_document_id` and `end_reason` |
| `document_requirement` | `code`, `name`, `required`, `expires`, `active` | 5000. Entered by MyCity on Onboarding's Checklist settings, never seeded (A26). 5030 adds `kind` (`file`, `number`, `both`; the Wallet ID is a number) and `display_order` |
| `onboarding_case` | `application_id`, `offer_id`, `employee_id`, `status`, `starts_on` | 5000. Status `documentation → pre_onboarding → onboarding → completed`, or `cancelled` (5030, with `privacy_acknowledged_at`, `documentation_completed_at`, `cancelled_at`, `end_reason`) |
| `onboarding_checklist_item` | `onboarding_case_id`, `document_requirement_id`, `status`, `document_id` | 5000. 5030 adds `entered_value`, `uploaded_at`, `verified_by`, `verified_at`, `rejected_reason` |
| `onboarding_guarantor` | `onboarding_case_id`, `position` (1, 2), `kind` (`previous_employer`, `personal`), `full_name`, `relationship`, `phone`, `years_known`, `form_document_id`, `check_status` | 5030. The reference check: `pending`, `passed`, `failed`, with who and when |
| `employment_contract` | `onboarding_case_id`, `employee_id`, `number` (CON), `document_id`, `signature_request_id` | 5000 |
| onboarding plans | department, steps (title, owner role, due offset, SOP link) | PR 6, new tables; the plan's steps are copied onto the case |
| `employee.bvn` | eleven digits | 5040, masked under `employee.bank` (organisation's table, TB reviews) |
| `talent_pool`, `talent_pool_member` | | 5000, never used (M4's pool is `talent_pool_entry`, 4060). Dropped in 5010 |

Schema migration files: `migrations/5000_offers_onboarding.sql` (merged, never edited),
`5010_offer_terms.sql`, `5020_signature_evidence.sql`, `5030_onboarding_documentation.sql`,
`5040_employee_bvn.sql`, `5090_drop_unused_talent_pool.sql`. Reference data:
`seeds/reference/5099_seed_offers_onboarding.sql` and `5199_seed_m5_statuses.sql` (statuses);
`5299_seed_offer_flow.sql`, the `recruitment.offer` flow's version 1 and Head of Department's
`approve` on recruitment (team), set only while its grant is as 0290 left it. 5010 also gives the
offer `approved`, `outside_range`, `range_reason`, `additional_terms`, `terms_version` and
`submitted_at`. BVN is a restricted field on the
employee record (masked, never sent to an AI model).

## 5 · API

| Method and path | Contract | Permission · scope | Paged | Notes |
|---|---|---|---|---|
| `GET /api/v1/recruitment/offers` | `OfferListQuery` → `OfferPage` | `recruitment` view · all/team | yes, 25 | filters: status, vacancy, q |
| `GET /api/v1/recruitment/offers/summary` | → `OffersSummary` | `recruitment` view | | drafts, with approval, to send, with candidates, accepted this month |
| `GET /api/v1/recruitment/offers/draft` | `OfferDraftQuery` → `OfferDraft` | `recruitment` create | | what New Offer starts from |
| `POST /api/v1/recruitment/offers` | `OfferCreate` → `OfferDetail` | `recruitment` create | | application active at `shortlist` (or `offer` after one ended); department and worksite default to the vacancy's |
| `GET/PATCH /api/v1/recruitment/offers/:id` | `OfferDetail`, `OfferEdit` | `recruitment` view/edit | | edit only in draft |
| `POST /api/v1/recruitment/offers/:id/submit`, `/send`, `/resend` | `EmptyBody` → `OfferDetail` | `recruitment` edit | | |
| `POST /api/v1/recruitment/offers/:id/withdraw` | `OfferWithdraw` → `OfferDetail` | `recruitment` edit | | with its approval, approved or sent |
| `POST /api/v1/recruitment/offers/:id/sign` | `SignSubmit` → `OfferDetail` | `recruitment` view, and the signer named on its request | | the company's signature, in the hub |
| `GET /api/v1/recruitment/offers/:id/document` | PDF | `recruitment` view | | the sealed copy once there is one |
| `GET /api/v1/recruitment/offers/settings`, `PUT .../settings/signatory` | `OfferSettings`, `OfferSignatorySave` | `recruitment` edit | | the Offer Signatory (setting `recruitment.offer_signatory`) |
| `GET/PUT /api/v1/recruitment/offers/settings/letter`, `POST .../letter/restore` | `OfferLetterTemplate`, `OfferLetterTemplateSave` | `recruitment` edit | | the standard wording, a `template_version` of `offer-letter` |
| `GET /api/v1/recruitment/onboarding` | `OnboardingListQuery` → `OnboardingPage` | `recruitment` view | yes, 25 | filters: status, department |
| `GET /api/v1/recruitment/onboarding/:id` | `OnboardingDetail` | `recruitment` view | | |
| `POST /api/v1/recruitment/onboarding/:id/items/:itemId/verify`, `/reject`, `/request` | `ChecklistItemAction` | `recruitment` edit | | |
| `POST /api/v1/recruitment/onboarding/:id/steps/:stepId/done`, `/complete` | | `recruitment` edit | | |
| `GET/POST /api/v1/recruitment/onboarding/requirements`, plans | | `recruitment` edit | yes, 25 | Checklist and Plans settings |
| `GET /api/public/v1/sign/:token` | → `SigningView` | public token `signature.sign` (one a signer) | | the first opening is recorded; 404 for any bad or ended link (signatures) |
| `POST /api/public/v1/sign/:token/code` | `EmptyBody` → `SignCodeSent` | public token | | a six-digit code to the address the link was sent to; 10 minutes; another after 60 seconds (429) |
| `POST /api/public/v1/sign/:token/code/verify` | `SignCodeVerify` → `SigningView` | public token | | five wrong tries and a new code must be asked for |
| `POST /api/public/v1/sign/:token/sign` | `SignSubmit` → `SigningView` | public token | | the code entered within 30 minutes; signers in order; a second press returns the signed state |
| `POST /api/public/v1/sign/:token/decline` | `SignDecline` → `SigningView` | public token | | ends the request for every signer |
| `GET /api/public/v1/sign/:token/document` | PDF | public token | | the sealed copy once there is one |
| `GET /api/public/v1/verify/:ref` | → `VerifyResult` | public | | status, signers, the two verdicts; no content; only a sealed copy |
| `GET /api/public/v1/verify/t/:token` | → `VerifyByToken` | the sealed copy's QR key | | the record and the document |
| `GET /api/public/v1/verify/t/:token/document` | PDF | the QR key | | the sealed copy |
| `GET/POST /api/public/v1/onboard/:token` | `UploadPack`, `UploadItem` | public token `onboarding.upload` | | privacy notice first |

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
- Documentation completes when every required item is verified, both guarantors have passed their reference checks, the BVN is entered and the contract is signed. Onboarding never opens before that.
- A personal guarantor has known the hire four years or more; the two are not the same kind.
- Onboarding plan steps come from the hire's department plan; Complete Onboarding needs every step done, then the login is invited (`users.invite`).
- No AI drafts an offer or a contract: both are the template plus the offer's fields. M5 registers no AI job.

## 7 · Events, jobs and notifications

| Event / job | When | Does |
|---|---|---|
| `offer.created`, `offer.updated` | New Offer, a draft's edit | audit |
| `offer.submitted`, `offer.approved`, `offer.rejected` | the approval flow | the approvers hear through the flow; approved tells the owner and the Offer Signatory; rejected the owner |
| `offer.sent`, `offer.resent` | Send Offer, Resend | the service queues `offer-sent` after commit with a link made then |
| `offer.accepted` | the offer's signature request completes (`signature.completed`, the candidate's signature last) | tells the owner; starts onboarding (PR 5) |
| `signature.requested`, `.viewed`, `.signed`, `.declined`, `.ended` | the signing steps (signatures) | audit; the owning module reacts through its `defineSignable` hooks in the same transaction |
| `signature.completed` | the last signer signed | outbox: the sealed copy generated with the signatures, the certificate and the QR (`signatures.signed-pdf`) |
| `document.generated` (a sealed copy) | the worker rendered it | its stored bytes' hash on every signature row (`artifact_hash`); `signature.sealed` |
| `signature.sealed` | | every signer mailed the sealed copy (`signature-completed`) |
| `offer.declined`, `offer.expired`, `offer.withdrawn` | the candidate declines; the request lapses; Withdraw or Not Progressing | declined and expired tell the owner; the links stop working |
| `onboarding.opened` | after `offer.signed` | email `onboarding-documents` with the upload link |
| `onboarding.item_uploaded`, `.item_verified`, `.item_rejected` | | notify Operations & People / the hire |
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
- **Search** (`offers.search.js`, `onboarding.search.js`): offers by number (OFF-), candidate and role; onboarding cases by hire; employment contracts by number (CON-).

## 10 · On screen and mobile

### 10.1 Content tiers

| Screen | Open (tier 1) | Behind help (tier 2) | Not on screen (tier 3), lives in |
|---|---|---|---|
| Recruitment · Offers | the offers list (number, candidate, role, compensation, status, expiry); the offer's letter, approval chain and signers; New Offer, Send Offer, Withdraw | help on Score: the weighted total when the offer was made | the approval snapshot rule, the two hashes: §6 here, the manual |
| Recruitment · Onboarding | the cases list (hire, role, start date, status, items outstanding); a case's checklist with each item's state, the contract, the plan steps | help on Pre-Onboarding: every required document verified and the contract signed | why documentation comes first: §3 here |
| Public · Sign Offer | the letter, the signing steps, Accept and Sign, Decline the Offer, the outcome | help on the email code | "this document is locked and verifiable" reassurance: never shown |
| Public · Upload Documents | the privacy notice to accept, each item with its state, upload | help on BVN | how the files are stored: the manual |

### 10.2 Phone layout

| Screen | First on a phone | Left off a phone | Main action | Navigation |
|---|---|---|---|---|
| Recruitment · Offers | offer cards with a status pill; a tapped card opens the offer in a bottom sheet | the compensation column (in the sheet instead) | Send Offer, full width in the sheet | bottom bar Recruitment; tabs scroll sideways |
| Recruitment · Onboarding | case cards with items outstanding; the case opens in a sheet | the plan's due dates (in the step) | Verify, full width per item | as above |
| Public · Sign Offer | the role and expiry, then the letter, then the signature box | the steps list | Accept and Sign, full width at the foot | the public header menu |

## 11 · Edge cases

- A token opened twice: the second Accept and Sign returns the signed state, not an error.
- `/sign` with no token shows the guidance screen (Use Your Offer Email), never Not Found (GE, #82).
- The candidate declines after accepting: not possible; a signed offer is locked.
- The vacancy is closed while an offer is open: the offer stands; Not Progress All skips it.
- The hire's email bounces: the offer shows the failed send; Resend after editing the address.
- A file over the upload engine's limit: refused, with the limit named.
- No document requirements set: Send Offer is refused until the checklist has at least one required item.
- The hire leaves before the start date: Withdraw on the case ends it; the employee is archived.

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

1. **Still owed by MyCity:** a sample employment contract (the contract template follows the offer
   letter's clauses until it comes), the blank Employee Data, Guarantor and Account Opening forms,
   the full New Hire Induction deck, and the Incentive Policy (October 2026). The sample offer
   letter and the New Joiner list arrived on 06/11/2026.

## 14 · Change log

- 06/11/2026 · AJ · First draft from the Modules Review of 04/11/2026, AJ's decisions on #79 (offer approval, the contract's own signature, the employee at acceptance, BVN, department plans, the seat on hire) and GE's answers (`advanceIn`, `hireIn`, the public pages on #82).
- 06/11/2026 · AJ · The offer emails go in M4's Candidate Emails; New Offer is a chat card.
- 06/11/2026 · AJ · From MyCity's sample offer letter and New Joiner list: monthly pay lines and the Offer Summary's fields on the offer, the company signing when the offer is approved, the New Joiner checklist, two guarantors with reference checks, BVN a number only (§3, §4, §6). PR 1's migrations named.
- 06/11/2026 · AJ · PR 2, the signatures service built (§5's signing and verification routes, §7's events and the sealing): `defineSignable` for each signed record type, the company's signatory signing in the hub, the email code, the QR key that outlives a public link.
- 06/11/2026 · AJ · PR 3, the offers backend (§3 steps 1 to 4, §5, §6, §7, §9): the Offer Signatory setting, the letter generated and its request opened at approval with the wording's version kept, Send making the link after commit, expiry through `signature-reminders` (no `offer-expiry` job), Head of Department's recruitment `approve` grant for the flow's first stage, `offer.accepted` in place of `offer.signed`.
