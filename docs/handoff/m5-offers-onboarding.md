# M5 Offers, Documentation & Onboarding · Build Handoff

**Start here if you are continuing this work.** This file is self-contained: what the 04/11/2026
Modules Review asked for, the decisions taken on #79 (do not ask them again), the nine pull requests
with their checklist, and a dated log. The design itself is `docs/guides/offers.md`; this file is
the build plan and its log.

| | |
|---|---|
| Branch | `m5/offers` |
| Pull request | #85 (draft, PR 0 to PR 4); PR 5 on opens a new one from the same branch |
| Owner | AJ (Adole Jerome); every M5 decision is AJ's (team ownership, 06/11/2026: GE M4, AJ M5 and M8, LA M7, TB M6 and M10) |
| Type | Full stack (CLAUDE.md step 1) |
| Started | 06/11/2026 |

---

## 0 · How to continue

1. `git fetch origin && git checkout m5/offers && git rebase origin/main`.
2. Read this file in full, then `docs/guides/offers.md`, then what CLAUDE.md step 2 asks for
   full-stack work, MILESTONES §10 as amended, `docs/guides/partnerships.md` §6.9 (the signing
   service) and `docs/guides/recruitment.md` §6.3 (where M4 hands over).
3. Read #79's comments from 06/11/2026: the read-in, GE's answers, AJ's decisions, the `hireIn`
   correction, GE's public-site decisions, and #82's "Left for M5".
4. Take the first unticked item in §4. Build it, run its checks, tick it here with the date, add a
   line to §6.
5. Never re-open §2.

---

## 1 · What was asked

From the Modules Review of 04/11/2026 (TB with AJ and GE; read the transcript, not only Gemini's
summary):

1. M8 first; M5 after GE's recruitment foundation (00:07:30, 01:03:11). M8 is in testing (06/11).
2. Approved candidates pass from GE's pipeline to AJ (00:57:39): "this is where yours ends".
3. The offer letter has configurable fields (salary, start date, working hours), so no AI drafts it
   (00:58:39).
4. It is sent for signature; signing is acceptance (00:59:34).
5. The employment contract is generated from the offer, the job description, the vacancy and the
   personal details; "ensure there's a place where we actually generate the contract" (01:01:39).
6. Documents are uploaded under People: the Employee 360 gets a tab for them (01:00:37).
7. The checklist: signed offer letter, the generated contract, valid ID, passport, BVN, academic
   certificates, probation policy, and whatever MyCity's list adds (01:01:39).
8. Pre-onboarding, onboarding, working through the department (01:00:37).
9. Every form works in the AI chat, and the Playwright user-guide pictures are retaken: both are
   release gates (00:31:50).
10. MyCity (Jennifer) owes a sample offer letter, a sample contract, the probation policy, the
    document checklist and onboarding packs (01:03:11).

---

## 2 · Decisions (06/11/2026, binding)

AJ's (on #79, comment of 10:55 UTC and the correction of 11:02):

1. **Offers are approved before they are sent**, through a `recruitment.offer` flow on Settings ·
   Approvals; an offer keeps the flow active when it was created (as sanctions do).
2. **The employment contract is signed by the hire too**, on its own signing link, after the offer.
3. **The employee is created when the offer is accepted and signed**, without a seat and without a
   login; the login is invited when onboarding completes. Documents attach to the employee from then.
4. **BVN is a number only** (changed 06/11, after MyCity's New Joiner list): a restricted field on
   the employee record (masked, never sent to an AI model), entered once on the upload page; no
   upload.
5. **"Working through the department" is a per-department onboarding plan**: steps with an owner
   and a due date, linked to the department's SOPs.
6. **On hire the Organogram seat is filled and the vacancy closes as filled** when its hires reach
   its openings, through GE's `hireIn` (decision 10).
7. **No AI drafting**: the offer and the contract are the template plus the offer's fields. M5
   registers no AI job.
8. **The offer and onboarding emails are in M4's Candidate Emails** (one editor): GE adds the keys
    `offer-sent`, `offer-signed`, `onboarding-documents` to `candidates.emails` and the contract's
    `CandidateEmailKey`.
9. **New Offer is a chat card**, with a candidate picker added to the chat; the upload and BVN
    forms are `not_offered: personal`.

From MyCity's sample offer letter and New Joiner list (AJ, 06/11/2026 evening):

- **a. Pay is monthly and itemised** (Basic Salary, Internet & Recharge Allowance, Transportation
  Allowance, any other): `offer_pay_line`; `annual_compensation` is twelve times the total.
- **b. The Offer Summary's fields live on the offer**, filled from the vacancy: reports to,
  function, scope, employment type, work pattern and office days, probation, annual leave,
  incentives. Sections 1 to 14 and the Acceptance are the editable template text; Schedule A is
  the final job description.
- **c. The company signs when the offer is approved**: the last approver or the named Operations &
  People signatory, before Send Offer; the candidate signs second.
- **d. The checklist is MyCity's New Joiner list**, entered on the Checklist settings (A26): proof
  of address, valid ID, certificates with NYSC, evidence of separation, birth certificate, Employee
  Data Form, MyLagosApp Wallet ID (a typed value), passport photograph, Account Opening Form.
- **e. Two guarantors with reference checks**: entered by the hire with their form; Operations &
  People record each check Passed or Failed; both must pass before pre-onboarding.

GE's (on #79, 06/11/2026):

10. **M5 never writes M4's tables.** Sending an offer calls `candidates.advanceIn(client, actor,
   applicationId, "offer")`; acceptance calls `candidates.hireIn(client, actor, applicationId,
   { employee_id })` after `organisation.createEmployee`, in the same transaction. `hireIn` moves
   the stage `offer → hired`, sets status `hired`, writes the history, emits `application.hired`,
   and calls `vacancies.hiredIn` for the seat and the vacancy. GE builds both in an M4 PR; until it
   lands, M5 calls a stand-in of the same name. Only `offer` is a board column; the board shows
   `status=active` only, so a hire leaves it.
11. **The stage order** is `shortlist → offer → hired`. Documentation, pre-onboarding and onboarding
   live on `onboarding_case.status`, shown on the Onboarding tab.
12. **Sign Offer and Verify**: GE built the screens on #82 (`PublicPage layout="split"`, the mock,
    Verify by reference and by QR `/verify/t/<token>`). AJ builds the backend and wires them,
    adding the email code, name, title, consent tick, and the signers list and status. PROGRESS
    #84 and #85: GE's UI ticks, AJ's API and wiring.
13. **The signatures service is built here first** (`src/modules/signatures`), shared with M7; the
    sign shapes move from `agreements.js` to `signatures.js`. LA reviews that PR and 5010's
    `signature_request` changes.
14. **5000 is fixed forward** in 5010: the A12 hashes on `signature`, `offer.workflow_instance_id`,
    the final job description and working hours on `offer`, a new offer after a declined or expired
    one, CHECKs and indexes, the privacy acknowledgement and per-item verification; the dead
    `talent_pool` and `talent_pool_member` tables are dropped.
15. **The public site**: the 3-word title limit stays; `brandInCard` is gone; motion is components
    (`Reveal`, `Stagger`, `CountUp`), §6 unchanged; split pages have no footer, Verify is in the
    header; `/sign` with no token is a guidance screen.

---

## 3 · The pull requests

| PR | Contents | Needs |
|---|---|---|
| 0 · Docs | this file, `docs/guides/offers.md`, the guide index, MILESTONES §10 Decided block, README §5.8 pointer, PROGRESS note | none |
| 1 · Contract and data | schemas `offers`, `signatures`, `onboarding`, `employment_contracts`; `npm run gen:contract`; migration 5010 (decision 14); the `recruitment.offer` flow's default; DATABASE_SCHEMA | PR 0 |
| 2 · Signatures service | `signatures`: email code, draw or type, consent, evidence, the image stamped in, seal and certificate, QR, both hashes; public sign, verify by number and by token; the `OFFER_LETTER` canonical builder with a golden test; `signature-reminders` | PR 1; LA reviews |
| 3 · Offers backend | create from the shortlist with the score snapshot, edit, approval, send (`advanceIn`), resend, withdraw, decline, expiry (`offer-expiry`), token revocation on Not Progressing, one renderer for page and PDF, the offer emails, search and AI manifest | PR 2; GE's M4 PR for the real `advanceIn` |
| 4 · Offers screens | `Offers.tsx` rewritten on the contract (the old one breaks F31 and gate 8), Sign Offer and Verify wired, the User Guide sections and pictures | PR 3; #82 merged |
| 5 · Acceptance to hire | in one transaction: seal, `createEmployee`, `hireIn`, the case at documentation, the contract generated and sent for signature, the emails | PR 3; GE's `hireIn` |
| 6 · Onboarding backend | Checklist and Plans settings, the public upload with the privacy notice, BVN, verify and reject, the documentation gate, `onboarding-dispatch`, Complete Onboarding and the login invite; the Upload Documents PROGRESS row (`npm run new:screen`) | PR 5 |
| 7 · Onboarding screens | `Onboarding.tsx` rewritten, the public Upload Documents page, the Employee 360 Documents tab (with TB, `foundation.md`), User Guide and pictures | PR 6 |
| 8 · Close-out | AI cards or reasons for every form, ⌘K, every picture retaken, the guide to Built, PROGRESS, `npm run ci` | all |

The `Field.tsx` axe fix (a `Field` with `help` around a `TextField`, GE on #79) goes with PR 4 or
earlier: M5's forms use help terms.

---

## 4 · Checklist

- [x] PR 0 · Docs (06/11/2026)
- [x] PR 1 · Contract and data (06/11/2026; reviewed by AJ 07/11/2026, for LA and TB)
- [x] PR 2 · Signatures service (06/11/2026; reviewed by AJ 07/11/2026, for LA)
- [x] PR 3 · Offers backend (06/11/2026; the Head of Department grant and the board's Offer column confirmed by AJ 07/11/2026, for GE)
- [x] PR 4 · Offers screens (07/11/2026)
- [ ] PR 5 · Acceptance to hire
- [ ] PR 6 · Onboarding backend
- [ ] PR 7 · Onboarding screens
- [ ] PR 8 · Close-out

---

## 5 · Notes

- Risks from the read-in that belong to GE: Close Vacancy's Not Progress All must skip applications
  at `offer` or later; M5 revokes offer and upload tokens on `application.not_progressed`.
- The weighted scorecard total is worked out on read, so the offer stores a snapshot.
- The line manager comes from the vacancy's Organogram seat, not the free-text `reports_to`; the
  hire's address is picked (`AddressField`) at documentation, as `candidate.location` is free text.
- The `4099` seed still lists the retired `rejected` stage (GE).
- Arrived from MyCity 07/11/2026 (AJ): the blank Employee Data Form, Guarantor Form and Providus
  Salary Account Opening Form (PDF, for PR 6's checklist items and the guarantor fields), the HR
  Induction deck (27 slides, ending in Your First 30 Days: Week 1, Weeks 2 to 3, Week 4, for PR 6's
  plan steps), the Incentive Plan (October 2026: per-category rates over ₦500,000, the quarterly
  80% bonus and the team pool; the offer's Incentives text and Section 4 point to it), and a second
  sample offer letter (two pages: deductions for PAYE and pension, per-unit incentives such as
  ₦5,000 a business onboarded, annual leave after six months). The second letter is shorter than the
  standard wording of 06/11; the offer's Incentives and Benefits fields already carry its extra lines.
- Still owed by MyCity: a sample employment contract (PR 5).

---

## 6 · Log

- 07/11/2026 · AJ · The open reviews, taken by AJ (every M5 item falls to AJ): nothing in PR 1 to 3
  breaks an existing structure. 5020's CHECKs on `signature_request` and `signature` meet no other
  writer (M7's agreements do not write them yet) and no row older than 5020; 5090 drops tables no
  code reads (M4's pool is `talent_pool_entry`); `employee.bvn` never leaves the record unmasked (the
  Employee 360 copies fields by name; `field-mask`, the logger and `ai/redact` hold it back); 5299's
  `approve` for Head of Department is set only on 0290's untouched grant and opens nothing on
  recruitment but its approvals (`recruitment.offer` is its only flow); the moved sign shapes have no
  importer left in `agreements.js`. Migration round trips, drift and the whole backend suite pass.
- 07/11/2026 · AJ · PR 4, the failed send (guide §11): the offer shows when the mail server refused
  the candidate's address after it was sent (`send_refused_at`, from `mail_refusal`), and Change
  Email (`POST /offers/:id/recipient`) corrects it on the candidate (`candidates.correctEmailIn`, new
  in M4's service, event `application.email_corrected`) and on their signature
  (`signatures.setSignerEmailIn`), then mails a fresh link. The mock's Not Progressing withdraws the
  candidate's open offer, as the API does.
- 07/11/2026 · AJ · PR 4 built: Recruitment · Offers rewritten on the contract (`Offers.tsx`, with
  `OfferForm.tsx`, `OfferSign.tsx` and `OfferSettings.tsx`), its INTERIM types and mock gone; the mock
  is `app/src/api/mock/modules/offers.ts` (every status; the approval answered through the workflow
  routes, so My Approvals lists it too). The record: summary and Score, Monthly Pay against the
  vacancy's range, Approval with Approve Offer and Reject Offer for whom it waits on (decided on #85:
  on the offer as well as My Approvals), Signers, History from the offer's dates (the contract has no
  history list; its dates say it), the letter on paper (content, not counted by the word limits;
  decided on #85) and Download PDF. New and Edit Offer are a four-step wizard. The board's Offer
  column opens with this screen: Open Offer and Make Offer on the candidate's sheet, through a new
  `OfferListQuery.application_id` (contract first; decided on #85). Sign Offer and Verify Document
  wired to the signatures routes, the public INTERIM types gone: the email code, name, title, draw or
  type, consent, Signers; Verify lists every signer and the status. The signing code's field messages
  are four words now (Ask for another code). `Field` with a help term passes axe (the #79 note; a test
  added). User Guide: Offers in `recruitment.md`, Sign Offer and Verify a Document in
  `public-site.md`. PROGRESS: #42 UI and Mobile; #84 and #85 API, UI and Mobile. The failed send and
  the mock's Not Progressing came after (the entries above).
- 07/11/2026 · AJ · Merged `main` (GE's hand-over to M5, #88): Send now moves the card to Offer;
  declined, expired and withdrawn offers move it back to Shortlist with `candidates.offerEndedIn`;
  `offer-sent` is Candidate Emails' template with `candidates.OfferSentEmailVars`. Open for PR 5:
  `offer-signed` (GE's key) would reach the candidate beside the signatures service's own
  `signature-completed` mail, which already attaches the sealed copy; PR 5 decides which one the
  candidate gets.
- 06/11/2026 · AJ · PR 3 built: `src/modules/offers` (service, repo, render, events, routes,
  controller, ai, search, test), the `offer-letter` standard wording from MyCity's sample letter
  (Markdown, edited on the Offers settings, its version kept on the offer at approval) and the
  `offer-sent` mail, `recruitment.offer` (seed 5299 and DEFAULTS), the canonical `OFFER_LETTER`, the
  letterhead's appendix and sealing blocks, `documents.generate`'s `template_version`, and
  signatures' `setExpiryIn` and `signersOf`. `tests/integration/offers.test.js` walks New Offer to
  accepted, rejected, declined, withdrawn and Not Progressing on the real migrations. Changed on the
  way: no `offer-expiry` job (the signature request's lapse expires the offer; the stubs are
  deleted, and `.public.routes` with them); `offer.accepted` replaces `offer.signed`; Submit needs
  a department and the Offer Signatory; a withdrawal while the offer is with its approval follows
  the engine's rule (its submitter or the CEO). For GE: seed 5299 gives Head of Department
  `approve` on recruitment (team), without which the flow's first stage refuses them; and
  `advanceIn(..., "offer")` is a no-op until the board has an Offer column. For PR 5: Send Offer is
  not yet refused when no document requirement is set (guide §11).
- 06/11/2026 · AJ · PR 2 built: `src/modules/signatures` (service with `defineSignable`, code,
  repo, events, certificate, signed-pdf, verify, public routes on `/sign` and `/verify`), the
  `signature-reminders` scheduler, the `signature-code` and `signature-completed` mails, 5020's code
  and verification columns. `tests/integration/signatures.test.js` walks it end to end on the real
  migrations (order, code, sign, seal, both verdicts and their failures, decline, withdraw, lapse).
  No signable is declared yet: offers (PR 3) and contracts (PR 5) declare theirs. The offer letter's
  template prints the signatures, certificate and QR the seal step hands it.
- 06/11/2026 · AJ · PR 1 built: the four contract files (the sign shapes moved from `agreements.js`
  to `signatures.js`, its test following), migrations 5010 to 5090 and seed 5199, DATABASE_SCHEMA.
  Migration gates, contract columns and the UP, DOWN, UP round trip pass on PostgreSQL 16; the
  checks group passes. Decisions a to e from MyCity's offer letter and New Joiner list.
- 06/11/2026 · AJ · Read-in of `m4/recruitment` (backend, contract and data, staff screens, public
  site, docs) against the meeting; findings and questions on #79. GE answered (pipeline, public
  pages, signatures); AJ took decisions 1 to 9. PR 0 written: this file, the guide, MILESTONES §10.

---

## 7 · Prompts for the remaining PRs

Each PR: read §0, then build the row of §3 to `docs/guides/offers.md`, contract first, with tests,
the guide's Change log, the User Guide where a screen changes, PROGRESS, and `npm run ci` green
before it is marked ready.
