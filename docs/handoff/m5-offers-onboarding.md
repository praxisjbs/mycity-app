# M5 Offers, Documentation & Onboarding · Build Handoff

**Start here if you are continuing this work.** This file is self-contained: what the 04/11/2026
Modules Review asked for, the decisions taken on #79 (do not ask them again), the nine pull requests
with their checklist, and a dated log. The design itself is `docs/guides/offers.md`; this file is
the build plan and its log.

| | |
|---|---|
| Branch | `m5/offers` |
| Pull request | #85 (merged, PR 0 to PR 4); #122 (draft, PR 5 to PR 8 and the fixes from its audit of 12/11/2026), from the same branch |
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
   *Amended 11/11/2026 (PR 5) on GE's pipeline (#88): acceptance calls `advanceIn(..., "documentation")`,
   and `hireIn` runs at Complete Onboarding, not at acceptance. M5 also calls `candidates.withdrawnIn`
   (PR 6b), and Reopen is refused past Offer (the audit of #122, changed on this branch, AJ).*
11. **The stage order** is `shortlist → offer → hired`. Documentation, pre-onboarding and onboarding
   live on `onboarding_case.status`, shown on the Onboarding tab.
   *Amended 11/11/2026 (PR 5): GE's pipeline (#88) has `offer → documentation → pre_onboarding →
   onboarding → hired`; the application moves with the case (guide §3 steps 5 to 8).*
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
| 6a · Onboarding to the gate | Checklist and Plans settings (the New Joiner list and the default plan seeded), the Upload Documents link and the public page's API with the privacy notice, files, guarantors and their checks, BVN, verify and reject, the documentation gate, ⌘K and the AI read; the Upload Documents PROGRESS row (#112) | PR 5 |
| 6b · Onboarding to hired | `onboarding-dispatch` (the start date, the plan's steps copied onto the case with owners resolved, overdue reminders), Mark Step Done, Withdraw on the case, Complete Onboarding with the company email (`work_email` changed before `users.invite`), the login invite and `candidates.hireIn` | PR 6a |
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
- [x] PR 5 · Acceptance to hire (11/11/2026)
- [x] PR 6a · Onboarding to the documentation gate (11/11/2026)
- [x] PR 6b · Onboarding to hired (11/11/2026)
- [x] PR 7 · Onboarding screens (12/11/2026)
- [x] PR 8 · Close-out (12/11/2026; no further review, AJ)

---

## 5 · Notes

- Risks from the read-in that belong to GE: Close Vacancy's Not Progress All must skip applications
  at `offer` or later; M5 revokes offer and upload tokens on `application.not_progressed`.
- The weighted scorecard total is worked out on read, so the offer stores a snapshot.
- The line manager comes from the vacancy's Organogram seat, not the free-text `reports_to`; the
  hire's address is picked (`AddressField`) at documentation, as `candidate.location` is free text
  (not built in PR 6 to 8; built with the audit of #122, 12/11/2026: Your Address on the upload page,
  a gate condition).
- The `4099` seed still lists the retired `rejected` stage (GE).
- Arrived from MyCity 07/11/2026 (AJ): the blank Employee Data Form, Guarantor Form and Providus
  Salary Account Opening Form (PDF, for PR 6's checklist items and the guarantor fields), the HR
  Induction deck (27 slides, ending in Your First 30 Days: Week 1, Weeks 2 to 3, Week 4, for PR 6's
  plan steps), the Incentive Plan (October 2026: per-category rates over ₦500,000, the quarterly
  80% bonus and the team pool; the offer's Incentives text and Section 4 point to it), and a second
  sample offer letter (two pages: deductions for PAYE and pension, per-unit incentives such as
  ₦5,000 a business onboarded, annual leave after six months). The second letter is shorter than the
  standard wording of 06/11; the offer's Incentives and Benefits fields already carry its extra lines.
- Still owed by MyCity: a sample employment contract (PR 5); a check of the upload page's privacy
  notice (PR 6a, guide §13).
- Filed 11/11/2026 (AJ): the documents of 07/11 redacted into
  `docs/MyCity-ERP-Documents/onboarding-samples/` (names to placeholders or roles; the bank's terms
  not copied). PR 5 ships a placeholder standard contract from the offer's terms until MyCity's
  sample contract arrives (AJ, 11/11).

---

## 6 · Log

- 12/11/2026 · AJ · The audit of #122 (12/11/2026, 22 items), fixed on `m5/offers`; guide §2 to §8,
  §10, §11, §13, §14. Each fix has a test that fails on `d79e8f23` and passes now (22 tests, run on a
  clean checkout of that commit).
  - Blockers: the offer's employment type CHECK in the employee's spellings (5070, rows converted;
    New Offer maps a vacancy's `contract` and `internship`); the hire's work email a placeholder
    (`<offer number>@hire.invalid`) until Complete Onboarding, every mail to the hire to their personal
    email, Send refused for an active employee (`CANDIDATE_IS_EMPLOYEE`), an acceptance refusal shown
    to the candidate as a plain retry (`NOT_ACCEPTED`). Found by the new test: the contract's signer
    took the placeholder; it reads the offer's candidate address now.
  - Should fix: `requireAllScope()` (new in `middleware/rbac.js`) on the settings and Operations &
    People's case actions, `can_check` and `can_configure` for the screens, Mark Step Done in scope;
    `OfferCard.range_reason`; Reissue Contract (`POST /recruitment/contracts/:id/reissue`) and 15 days
    to sign on each contract link; Reopen refused past Offer (`candidates.reopen` and the board's
    sheet and mock); MyCity's Guarantor Form on each guarantor (5100; both addresses picked through
    `/onboard/:token/places/*`, new owners `onboarding_guarantor.*`), the signed form and ID copy
    needed to pass; the screens (Employee 360 Documents on `ListDetail`, its upload and the page's
    item value on `useContractForm`, the plan editor's steps keyed for life with SOP labels by id,
    View File handing back its download), with tests for Onboarding Settings and Employee Documents.
  - Minor: the contract's `hire_name` (5080) in what its signatures cover; `lagos.addMonths` for the
    confirmation date; Withdraw with an approval only for its submitter or the CEO; the request held
    before the offer or contract in every write (`signatures.holdRequestIn`); the long messages cut;
    Sign for Company shown to a signatory named after approval; the contract row through
    `repo.insert`; Withdraw honours `withdrawnIn`; the BVN audit test reads the ledger and fails when
    it should; a department's plan links only its own SOPs (`SOP_OTHER_DEPARTMENT`).
  - Decided with AJ: the placeholder and the Send check; scope all with the Head of Department's
    Mark Step Done; the BVN correctable until the gate; the card asks for the reason; Reopen refused
    past Offer, fixed here ("everything is fixed here, nothing goes to GE"); the hire's address built
    now. So items 21 and 22 are done here too: `candidates`' `withdrawnIn`, `application.withdrawn`
    and `contract-sent` are recorded in this log and the guide, and the access log and metrics write
    a public link's token as `:token`.

- 12/11/2026 · AJ · PR 8, close-out (guide §9, §14; Status Built). Checked rather than redone: every M5
  create or edit form has a chat card or its reason (gate 23 green; New Offer the one card); ⌘K finds
  offers, cases and contracts (gate 10 green).
  - Decided here, with AJ: Complete Onboarding and Withdraw stay on the screen, no chat card (both
    one-way: they hire or archive a person); the reason is in `onboarding.ai.js`'s header.
  - The empty stubs deleted: `jobs/handlers/signature-reminder.js` (the scheduler
    `signature-reminders` is the job; README §5.15's M5 handler cell emptied), `signatures.controller.js`
    and `signatures.routes.js` (signatures has only public routes). `employment_contracts.test.js` now
    holds the module's unit tests (8): its statuses and moves, its values from the accepted offer,
    what a signature covers (the appendix's headings, never their bodies), its routes' grants.
  - Every picture the gate called stale retaken (`npm run guide:shots -- --stale`): Recruitment,
    People, Quick Start and the public site, with the five new ones of PR 7.
  - No further review before the draft goes ready (AJ, 12/11/2026): the reviews asked of GE
    (`candidates.withdrawnIn`, `application.withdrawn`, PR 6b) and TB (`organisation.setBvnIn`, PR 6a;
    the Employee 360 Documents tab, PR 7) are waived; AJ owns every M5 decision. MyCity's sample
    employment contract has not arrived: the shipped wording stays the placeholder, replaced on the
    Standard Contract settings when it comes.
  - Verified in a Linux workspace on Node 20 with PostgreSQL 16, pgvector and Redis: `npm run ci`, every
    gate, the screen gates and a11y included. The whole jest suite (4,118 tests: 4,115 passed and the
    one it failed, the public Help's section list, passes after it learned of Upload Documents); the
    frontend tests of ui, app and public-app. Three tests that pinned the old state were brought up to
    date: the onboarding routes list (`/summary`), the delivery plan (Onboarding now delivered on
    staging and production) and the public Help's sections (`public-onboard`). The fixes were re-run
    file by file, not with a second whole-suite run. The PR needs the line `User-guide-unchanged:` for
    the Queries & Sanctions chapter, whose steps on a record's tabs did not change.
- 12/11/2026 · AJ · PR 7, the onboarding screens (guide §1, §2, §5, §10, §14; PROGRESS #43 and #112 UI
  and Mobile, Built).
  - Decided here, with AJ: the screen shows figures, on a new `GET /recruitment/onboarding/summary`
    (`OnboardingSummary`, contract first, in the reader's scope: documentation with the items waiting
    for a check, pre-onboarding, onboarding with the steps overdue, completed this month); the Employee
    360 Documents tab is built here on track B's existing `documents` routes (no backend change); no
    further review (AJ).
  - Recruitment · Onboarding (`Onboarding.tsx`, `OnboardingCase.tsx`, `OnboardingSettings.tsx`): the
    figures, the cases across the page, a case in the wide dialog (F31 as amended 11/11/2026): the case
    (what it waits on, BVN entered, the privacy notice; Send Reminder, Withdraw Hire, Complete Onboarding
    with the company email), Documents (View File, Verify, Reject with the reason), Guarantors (View
    Form, Record Check), Contract (the signers, Download PDF, Sign for Company, Resend Contract), then
    Onboarding Plan (Mark Step Done). Onboarding Settings: Checklist, Onboarding Plans (steps with owner,
    due day and SOP), Standard Contract. Opened by `?case=` (⌘K, a contract), `?status=`,
    `?panel=settings`. Sign for the Company is one form for the offer and the contract
    (`CompanySignForm` in `OfferSign.tsx`). The INTERIM types (`app/src/api/types/recruitment.ts`) and
    the old mock block are gone; the mock is `app/src/api/mock/modules/onboarding.ts` (six cases, every
    status).
  - Public · Upload Documents (`public-app/src/pages/UploadDocuments.tsx`, `/onboard/<token>`): the
    privacy notice first, each item (a file, a value or both, a rejection's reason), two guarantors
    with their forms and checks, the BVN once, Documents Complete after the gate; its mock
    `public-app/src/api/mock/onboard.ts` and three demo links. `packages/contract/guide.js` takes
    `/onboard/<token>` as a public picture's address.
  - Employee 360 · Documents (`app/src/features/people/EmployeeDocuments.tsx`): the counts, the list,
    View File and Download, Verify Document, Request Document, Upload Document; the mock's routes in
    `ess.ts`. `foundation.md` §2 and §14.
  - User Guide: Onboarding in `recruitment.md` (eight tasks, three pictures), Upload Documents in
    `public-site.md`, Someone's documents in `people.md`.
  - Verified in a Linux workspace on Node 20 with PostgreSQL 16, pgvector and Redis: see the PR 8 entry
    above for the whole `npm run ci`.

- 12/11/2026 · AJ · Closing PR 6, two gaps found in its review (guide §3 step 8, §6, §7, §11, §13).
  Nothing of M5 merges before PR 8 (AJ): PR 6a and 6b stay on `m5/offers`.
  - Not Progressing (M4) on an application at Documentation or after left its case open, its unsigned
    contract signable and its employee active, and the start date would still move the case (and
    Complete then failed on `hireIn`). Now `onboarding.end_for_application` (in place of
    `onboarding.stop_links`; `upload.stopLinks` removed) ends an open case as Withdraw does, through
    one `endIn`: the contract while unsigned, the links, the employee archived, the case `cancelled`
    with the application's reason. The application stays M4's `not_progressed`. An ended case only has
    its links stopped again; the outbox delivering it twice changes nothing. `startIn` also skips a
    case whose application is not active.
  - A `line_manager` step went to the case's owner, the hire's record naming no line manager before
    `hireIn` fills their seat. Now `repo.roleHolders` reads it from the vacancy's Organogram seat:
    whom the seat reports to, or the holder of the seat it reports to, climbing vacant seats as
    `employee_effective_manager` (1160) does; the case's owner only when that finds nobody.
  - Tests: the Not Progressing case ends with its contract and employee; the plan's line-manager step
    goes to whom the vacancy's seat reports to, and is reminded to them. Onboarding's integration file
    (6) and unit tests (11) green, and the whole jest suite green on PostgreSQL 16 with pgvector and
    Redis, Node 20 (12/11/2026), with PR 6b's four corrected files; the checks and document gates too.
    Not run: the frontend and screen gates (no screen changed).

- 11/11/2026 · AJ · PR 6b, onboarding to hired (guide §3 step 8, §4 to §7, §9, §11, §13). `onboarding-dispatch`
  is a scheduler now (`jobs/schedulers/onboarding-dispatch.js`, 06:43 Lagos, in `registry.js` SCHEDULERS;
  the empty `jobs/handlers/onboarding-dispatch.js` deleted and taken off README): on a case's start date,
  `pre_onboarding → onboarding`, the application to Onboarding (`candidates.advanceIn`), the plan's steps
  copied onto `onboarding_case_step` (`repo.planFor`: the department's active plan, else the default),
  each owner resolved from its role as decided (the case's owner when nobody holds it), `due_on` the start
  date plus its offset, its SOP kept; then each overdue step's owner reminded once. Each case its own
  transaction; run twice, nothing more happens. `onboarding.service`: `startIn`, `dispatch`,
  `markStepDone`, `complete`, `withdraw`; routes `POST /:id/steps/:step_id/done`, `/complete`
  (`OnboardingComplete`, the company email), `/withdraw` (`OnboardingCancel`). `OnboardingDetail` gains
  `steps` (`OnboardingStep`, with the SOP as `StepSop`), `can_complete`, `can_withdraw`.
  - Complete Onboarding, one transaction: every step done; `organisation.updateEmployee` changes
    `work_email` to the company address (its `assertWorkEmailFree` refuses one held); `users.inviteIn`
    (new in users' service: the invite inside the caller's transaction) makes the login on it, role
    `employee`; `candidates.hireIn`; the case `completed`; `onboarding.completed`. Identity's
    follow-the-work-email step meets a login already on the new address and does nothing.
  - Withdraw, one transaction, from documentation, pre-onboarding or onboarding: `employment_contracts.cancelIn`
    (an unsigned contract cancelled; a signed one stays signed, the record of what was signed), the
    Upload Documents links revoked, the employee archived (`organisation.archiveEmployee`, reason "Did not
    join: onboarding withdrawn", no last day), the application withdrawn, the case `cancelled` with the
    reason.
  - Decided here, with AJ: Withdraw withdraws the application through a new `candidates.withdrawnIn`
    (status `withdrawn`, `withdrawn_at`, its links revoked, `application.withdrawn`, no candidate mail;
    GE to review, M4's service and repo); Withdraw is open until completion, onboarding included.
  - Decided while building: an overdue step is reminded once, kept on `onboarding_case_step.reminded_at`
    (new migration 5060 rather than an edit to 5050, which developers' databases have already run); the
    reminder goes to the step owner's login, else the case's owner's (a hire has no login before
    Complete). The `line_manager` step's owner: see the closing entry of 12/11 above.
  - Verified here, in a Linux workspace with PostgreSQL 16, pgvector and Redis, on Node 20:
    `tests/integration/onboarding.test.js` (6: the two new ones walk pre-onboarding to hired and a
    withdrawal), the module's unit tests (11), the recruitment, offers, signatures and agreements
    integration files (93 tests); gates lint, migration numbers, reversibility (UP, DOWN, UP),
    idempotency, schema drift, contract columns, route contracts, AI manifest coverage, AI no-writes, AI
    awareness, AI engine boundary, search coverage, contract, module catalogue, public surface,
    schedulers, pagination, provenance, money, dates, dashes, upload, progress, guides, readme-map,
    user-guide, codeowners; `gen:contract` and `gen:ai-catalogue` run. The whole jest suite (4,110
    tests): 238 of 242 files green at once; the other four had pinned what this PR changes and pass
    after it: the scheduler lists (`worker-jobs`, `worker`) gain `onboarding-dispatch`, and the delivery
    plan's tests (`delivery-plan`, `workflow`'s Need You) used Onboarding as the screen without an API.
    It was the last one, so they now read the docs' plan with Onboarding's API taken back. Not run: the
    frontend and screen gates (no screen changed).
  - For PR 7: with #43's API ticked, staging would open Recruitment · Onboarding, still the INTERIM
    screen, which asks for `GET /recruitment/onboarding/summary` (not built). Nothing of M5 merges
    before PR 8 (AJ, 12/11/2026), so staging never shows it; PR 7 rewrites the screen on the contract
    and decides whether it needs a summary route.

- 11/11/2026 · AJ · PR 6a, onboarding to the documentation gate (guide §3 steps 6 and 7, §4 to §7, §9,
  §11, §13). Built in `src/modules/onboarding/`: `.checklist` (the gate's rules, `waitingOn`, and the
  Checklist settings), `.plans` and `.sop` (the Plans settings; an SOP must be in force), `.upload`
  (the hire's page and the link), `.service` (cases, verify and reject, reference checks, Send
  Reminder, `checkGateIn`), `.repo`, `.events`, `.routes`, `.public.routes`, `.controller`, `.ai`,
  `.search`; `organisation.setBvnIn` and `hasBvn` (the number kept out of the audit row: TB to
  review, organisation's table). Migration 5050 (plans, their steps, and the case's steps for 6b);
  seed 5399 (the New Joiner list, nine items, and Your First 30 Days, four steps). The gate is asked
  after a verification, a reference check, the BVN and the hire's contract signature
  (`employment_contracts.signedIn` calls `onboarding.contractSignedIn`), and moves the application to
  Pre-Onboarding with the case.
  - Decided here, with AJ: the New Joiner list and the default plan are seeded (A26 exception, as
    the code cannot run without a checklist; MILESTONES §10 records it); a step's owner is a role
    resolved when the steps reach a case; PR 6 split at the gate into 6a and 6b.
  - Decided while building: every file the hire sends lands on their employee record at once
    (`employee_document`, quarantined, scanned) and is verified only once clean; Request Document is
    Reject plus Send Reminder; a guarantor who passed cannot be changed by the hire; the link lives a
    month and at least a week past the start date; the privacy notice is six plain sentences from
    what the system does, for Operations & People to confirm (guide §13).
  - The upload, guarantor and BVN forms are not in `not_offered`: gate 23 accepts only create and
    edit schemas there, so their reason lives in the manifest's header (decisions 4 and 9).
  - Found and fixed from PR 5, first run of its suite: the contract read the company's name straight
    from the profile and got null on a database without one (now `profile.displayName`, as the offer
    letter does); the contract's signature request had no creator at acceptance (opened now as the
    company's signatory); the offers test cleared `work_pattern` through Edit Offer, which cannot
    clear it, and read the sealed copy's mails before the copy was rendered.
  - Verified here, in a Linux workspace with PostgreSQL 16, pgvector and Redis (Node 20):
    `tests/integration/onboarding.test.js` (4), offers (10), signatures (5), partnerships-agreements
    and recruitment-hire (9), the module's unit tests (10); gates lint, the migration gates with the
    UP, DOWN, UP round trip, schema drift, contract columns, route contracts, pagination, search
    coverage, AI manifest coverage and awareness, public surface, module catalogue, schedulers,
    dashes, upload, provenance; `gen:contract` and `gen:ai-catalogue` run; the backend group, the
    whole jest suite included (4,107 tests), green after two stale counts were brought up to date
    (Candidate Emails' nine keys since PR 5's `contract-sent`; `new:screen`'s next row, now #113).
    Not run: the frontend and screen gates (no screen changed).
- 11/11/2026 · AJ · PR 5, acceptance to hire (guide §3 steps 5 and 5a, §5 to §7, §11). The candidate's
  signature runs one transaction in `offers.acceptedIn`: the offer accepted, `organisation.createEmployee`
  (no seat, no login, the candidate's address as both emails), `candidates.advanceIn(..., "documentation")`
  whose false answer refuses the whole acceptance, `onboarding.openCaseIn` (the case at documentation,
  its checklist one item an active requirement), then `employment_contracts.generateIn`: a CON number,
  the wording in force kept on the document, and the request opened with the company first and the hire
  second, no link issued. Sign for Company makes and mails the hire's link (`contract-sent`); Resend
  revokes the earlier. `src/modules/employment_contracts/` is built; `src/modules/onboarding/` holds
  only the case opening, the rest is PR 6.
  - Decided here, with AJ: the candidate gets `offer-signed` with the sealed copy in place of
    `signature-completed`, through a new optional `sealedMailFor(db, {request, signer})` on
    `defineSignable`; the company's signatory still gets `signature-completed`.
  - `hireIn` is **not** called at acceptance. GE's `candidates.pipeline.js` (#88) has
    `offer → documentation → pre_onboarding → onboarding → hired`, so the application stays at
    Documentation and Complete Onboarding calls `hireIn` (PR 6). This supersedes decisions 10 and 11
    of 06/11, written before that pipeline landed; nothing else in them changes.
  - Submit for Approval now also needs the employment type and the work pattern (the employee record
    has both NOT NULL), and Send Offer is refused while the checklist has no required item (the §11
    leftover from PR 3).
  - The line manager is left empty at creation: the Organogram seat settles it when `hireIn` fills it
    at Complete Onboarding, so no reporting line is guessed from the offer's free-text reports-to.
  - Fixed on the way past: `offers.render.EMPLOYMENT` held the vacancy's spellings
    (`contract`, `internship`), so an offer to a contractor, consultant or intern printed no
    employment type. It now holds the employee's own five.
  - Not verified here: `npm run ci` has not run. The workspace's `node_modules` holds Windows builds
    (`sharp`) and its `@mycity/*` links do not resolve from this session's Linux shell, so the suite
    and `npm run gen:contract` must be run on the machine itself. Every file changed passes
    `node --check`.
- 08/11/2026 · GE · (Ose) Offers on desktop, at GE's ask (F31 amended 08/11/2026): the list takes the page's width
  (number, start date, Outside Range and sent added) and a row opens the offer in a wide dialog (ListDetail `modal`,
  size `xl`), the offer, Monthly Pay, Approval and Signers two by two, History and the letter across it. Phone
  unchanged. `docs/guides/offers.md` §10 and the Recruitment chapter follow.
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
