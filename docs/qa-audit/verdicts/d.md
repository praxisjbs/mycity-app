ID: F71
Title: Candidates move between stages freely, without passing gates
Verdict: BY_DESIGN
Severity: Low
Module: Recruitment (Candidates)
Evidence: src/modules/candidates/candidates.pipeline.js:53-63 (nextStages: any stage ahead or one back, so Application to Shortlist is offered) and :66-77 (assertCanMove refuses only closed roles, M5 stages, unused columns and moves of more than one back). No check reads the screening score, a sitting or an interview card. Offer still needs Shortlist (offers.service.js create, offers.test.js "An application not yet at Shortlist takes no offer"). Code reading; the rule is stated plainly in the guide, so no reproduction was needed.
Scope ref: docs/guides/recruitment.md §6.3 ("A card moves to any stage ahead of it or one back"), §6.4 ("Neither score moves, rejects or filters anyone"), §3 step 6 ("The score never moves anyone: a person drags the card"); MILESTONES §9 (scores are advisory and flagged Provisional so nobody is rejected on an unread score; M4 decided 04/11/2026, a role may skip parts).
Fix: None required. If MyCity wants it, a cheap optional step: ask for a reason (the move already takes an optional `reason`) when a card leaves a stage with an unfinished sitting, no submitted interview card or a screening score under a threshold, shown in Stage History. That is a policy change for MyCity to request.
Effort: S
For MyCity: Free movement between stages was agreed for M4: scores and tests inform the recruiter but never move or block anyone, and a person always makes the call. If you want the system to ask for a reason when someone skips an unfinished step, tell us and we will add it as a small change.

ID: F31
Title: Staging seed files every vacancy under Implementation
Verdict: SEED_DATA
Severity: Low
Module: Recruitment (staging seed)
Evidence: seeds/staging/55_recruitment.js:123,144,160,173,186,198 name the departments "Marketing & Sales", "Studio", "Content", "Support", "Engineering"; line 447 looks each up by name and, when not found, falls back to the hiring manager's department, and the hiring managers are the Implementation Team's accounts (line 61, 421). MyCity's departments are General Management, Technology & Back-office Ops, Branding & Marketing, Partnership & Growth, People & Culture (seeds/staff/nomenclature.json; staff-list.xlsx Team column), so every seeded role lands in Implementation. Creating a vacancy by hand already needs a department (auditor confirmed; recruitment.md §6.1 Publish needs a department).
Scope ref: CLAUDE.md "Production is never seeded with demonstration data" (A5, A26); docs/guides/recruitment.md §11 Staging; §6.1.
Fix: In seeds/staging/55_recruitment.js map each role to a real MyCity department (Head, Sales & Revenue and Partnerships Associate to Partnership & Growth, Graphics and Motion Designer and Content Producer to Branding & Marketing, Backend Engineer to Technology & Back-office Ops, Customer Support Lead to Technology & Back-office Ops or People & Culture), and correct the six rows already on staging (Edit Vacancy on screen, since the seed leaves existing roles alone).
Effort: S
For MyCity: This is demonstration data we loaded on staging, not something the product does: the sample roles named departments that do not exist in your structure and fell back to our team's. New vacancies must have a department. We will correct the sample roles; nothing of this reaches production.

ID: F73a
Title: One offer letter for every employment type, written for employees
Verdict: IMPROVEMENT
Severity: Medium
Module: Offers
Evidence: templates/documents/offer-letter.html is a single standard wording (clauses 1.1 "You are employed as", 1.3 to 1.4 full-time exclusivity, 3.2 PAYE and pension, 6.3 NYSC, 7.1 leave) built from MyCity's own sample letter (docs/MyCity-ERP-Documents/onboarding-samples/offer-letter-short.md, an employee letter). The offer carries employment_type (full_time, part_time, contractor, consultant, intern; offers.render.js:26-32), but the template engine has only truthy {{#if}} (src/shared/documents/render.js:18, no equality helper) and the letter vars carry the type only as a label, so Operations & People cannot write contractor-only wording in Offer Settings today.
Scope ref: MILESTONES §10 decided 06/11/2026 ("The offer letter is the template plus the offer's fields"); docs/handoff/m5-offers-onboarding.md §2 decision b (Sections 1 to 14 are the editable template text); docs/guides/offers.md §5 (`GET/PUT .../settings/letter`, one `offer-letter` template).
Fix: Add flags to OfferLetterVars in src/modules/offers/offers.render.js (for example is_employee, is_contractor, is_consultant, is_intern) and declare them in packages/contract/schemas/offers.js, so the standard wording in Offer Settings can branch per type with {{#if}}; ship default contractor and intern clauses only once MyCity supplies the wording. A full template per type would be a Change Report.
Effort: S
For MyCity: The letter is your standard offer letter, which was written for employees, and one letter for all offers is what was agreed. We can let the wording change with the employment type so contractor and intern offers drop employee clauses; you would need to give us (or type into Offer Settings) the contractor, consultant and intern wording.

ID: F73b
Title: Letter falls back to Monday to Friday hours when the field is blank
Verdict: CLIENT_ACTION
Severity: Low
Module: Offers
Evidence: templates/documents/offer-letter.html clause 2.2: "Working hours are {{ working_hours }}" else the fixed text "Monday to Friday, 9:00 a.m. to 5:00 p.m.", which is MyCity's own sample letter wording (onboarding-samples/offer-letter-short.md line 32). New Offer has an optional Working Hours field (app/src/features/recruitment/OfferForm.tsx:327-328) that is not prefilled; the draft (offers.service.js draft, around line 320-337) does not read Settings · Working Week. The staff list itself gives "Mon - Fri 09:00 AM - 05:00PM, Sat 09:00AM - 03:00PM" (seeds/staff/staff-list.xlsx Work Hours).
Scope ref: docs/handoff/m5-offers-onboarding.md §1 item 3 (working hours a configurable field of the offer); docs/guides/offers.md §3 step 1.
Fix: Client side: fill Working Hours on each offer, or change the fallback sentence in Offer Settings · letter wording to the company week. Optional improvement (S): prefill working_hours in the New Offer draft from the working week (src/shared/time/working-week.js loadCalendar) in offers.service.js draft.
Effort: S
For MyCity: The hours come from the offer's Working Hours field; when it is left empty the letter uses the sentence from your own sample letter. Type the hours on the offer or change that sentence in Offer Settings. We can also prefill the field from Settings · Working Week as a small improvement.

ID: F81a
Title: Provisional score shown before the AI read
Verdict: BY_DESIGN
Severity: Low
Module: Recruitment (Candidates)
Evidence: src/modules/candidates/candidates.screening.js:26-42: the estimate is the mean of experience (1 year against a 2 year minimum = 50), completeness (CV and a cover letter over 40 characters = 66.7) and required yes/no answers; (50 + 66.7) / 2 = 58.3, shown as 58, which matches the auditor's figure. Every surface shows Provisional beside it (screening.js shown(), help "Worked out from the form only").
Scope ref: MILESTONES §9 Reuse ("estimate() is arithmetic ... marked PROVISIONAL. Every surface that renders a score must render that flag"); docs/guides/recruitment.md §6.4.
Fix: None.
Effort: S
For MyCity: The 58 is the free estimate from the form, worked out exactly as agreed and always labelled Provisional. It is replaced once the AI reads the CV.

ID: F81b
Title: Score With AI says "CV read" while the read is only queued
Verdict: BUG
Severity: Low
Module: Recruitment (Candidates)
Evidence: The route only queues the read: candidates.service.js:503-517 requestScore emits application.score_requested and returns the unchanged record; the worker scores it later (candidates.events.js:89-93, candidates.score.js). The sheet then toasts "CV read" at once (app/src/features/recruitment/CandidateSheet.tsx:115 via act(), lines 83-91), reloads once before the score exists, and nothing refreshes it afterwards (no realtime or polling in app/src/features/recruitment). Nothing runs the AI on Move to Screening: no handler is registered on application.moved (candidates.events.js, only received, invited, not_progressed, score_requested). The auditor's "screening ran on Move to Screening" was the queued read showing once the move reloaded the sheet.
Scope ref: docs/guides/recruitment.md §3 step 6 ("Score With AI on one card does the same for one"), §6.4 (AI read runs when a person presses).
Fix: In CandidateSheet.tsx say "Reading the CV" (as Screen With AI says "n applications being read") and refetch the candidate a few times or until screened_at is set; optionally show "Being read" on the Screening card while a read is queued.
Effort: S
For MyCity: Score With AI does work, but in the background: the screen said "CV read" before the reading had finished and did not refresh when the score arrived, which made it look as if nothing happened. We will change the message and refresh the score when it lands.

ID: F81c
Title: Apply link lasts 48 hours, not until the closing date
Verdict: BY_DESIGN
Severity: Low
Module: Recruitment (public Apply)
Evidence: The Apply link is minted each time someone presses Apply for This Role on /jobs/<slug> and is single use; a lapsed one is replaced by pressing Apply again. Guide states 48 hours (7 days when staff invite).
Scope ref: docs/guides/recruitment.md §6.2 ("The Apply token is single use, lives 48 hours (7 days when staff invite)"), §3 step 4; MILESTONES §9 decided 04/11/2026 (Apply stays token-only).
Fix: None.
Effort: S
For MyCity: The link on the application form is a personal, single-use link that lasts two days; the job page itself stays open until the closing date and gives a fresh link each time Apply is pressed.

ID: F81d
Title: Apply step promises questions a role may not have
Verdict: IMPROVEMENT
Severity: Low
Module: Recruitment (public Apply)
Evidence: public-app/src/pages/Apply.tsx:40 STEPS has "CV and Questions" always, and line 104 says "Your CV, a few questions and why this role." whatever the vacancy holds; the seeded Content Producer has no Apply questions (seeds/staging/55_recruitment.js:158-170, no `asks`).
Scope ref: docs/guides/recruitment.md §10.1 Apply row.
Fix: In Apply.tsx title step 2 "Your CV" and drop "a few questions" from the aside when the vacancy has no questions; update the guide's §10.1 line.
Effort: S
For MyCity: When a role has no extra questions the form still mentioned them. We will make the wording follow the role.

ID: F81e
Title: CV picker offers .doc files the server then refuses
Verdict: BUG
Severity: Low
Module: Recruitment (public Apply)
Evidence: public-app/src/pages/Apply.tsx:294-295 accept=".pdf,.doc,.docx" and kinds "PDF or Word"; the server allows only PDF and DOCX for purpose cv (src/shared/files/mime-policy.js:54-55) and refuses old .doc (lines 91-99, or "Accepted: PDF, DOCX" at 107 when the file is not recognised as old Office).
Scope ref: docs/guides/recruitment.md §6.2 ("The CV is a PDF or Word file of at most 10 MB").
Fix: Remove .doc from accept in Apply.tsx and say "PDF or Word (.docx)"; keep the server rule.
Effort: S
For MyCity: The CV box let people pick old .doc files that are then refused. We will stop offering .doc and say which Word format is accepted.

ID: F72a
Title: An offer at ₦0 pay is accepted and sent for approval
Verdict: BUG
Severity: High
Module: Offers
Evidence: Throwaway integration test (tests/integration/zz-audit-d-offers.test.js, deleted) against mycity_auditd_test: on a vacancy with no pay range, GET /offers/draft started Basic Salary at 0.00; POST /recruitment/offers with every pay line 0.00 returned 201 (monthly_total 0.00, annual 0.00, outside_range false); the letter read "Total monthly compensation · ₦0.00"; Submit for Approval returned 200 (status approval). A negative line was refused only by the database CHECK (422 INVALID_VALUE "A value is not allowed here", migrations/5010_offer_terms.sql:34), not by the contract. Cause: OfferPayLineInput.monthly_amount is `money`, which allows 0.00 and negatives (packages/contract/schemas/offers.js:56-62; common.js:95), payOf checks only the range when the vacancy has one (src/modules/offers/offers.service.js:345-357), and submit checks no pay (lines 475-490). The draft's 0.00 default is at offers.service.js:335.
Scope ref: docs/guides/offers.md §3 step 1 and §6 ("Pay is monthly, line by line ... Money through shared/money"); MILESTONES §10 decided 06/11/2026 ("Pay is monthly, line by line"). common.js positiveMoney exists for "a form that takes money in".
Fix: Refuse an offer whose monthly total is not above zero, and a negative line, at create, edit and Submit (offers.service.js payOf and submit; contract: no negative monthly_amount, a field error "Enter an amount" on the Basic Salary line); start the draft's Basic Salary empty rather than 0.00. An allowance line of 0.00 can stay allowed.
Effort: S
For MyCity: Confirmed: an offer could be made and approved at ₦0 when the vacancy had no pay range. We will refuse an offer with no pay, so it cannot reach an approver or a candidate.

ID: F72b
Title: Vacancies may be published without a pay range
Verdict: BY_DESIGN
Severity: Low
Module: Recruitment (Vacancies)
Evidence: Publish needs title, department, hiring manager, location, description, requirements and a closing date, not a salary band (docs/guides/recruitment.md §6.1); the vacancy form's hint says "Leave the band empty if it is not settled yet" (§10.1). When a band exists the offer is checked against it and an offer outside it needs a reason the approvers see (offers.service.js:345-357; outside_range passed into the approval context at :496-497; Outside Range shown on the list, offers.md §10.1).
Scope ref: docs/guides/recruitment.md §6.1 and §10.1; docs/guides/offers.md §6 (range check "unless the approver overrides it with a reason").
Fix: None. A minimum wage floor on offers would be a small improvement, reading the minimum wage MyCity enters in Payroll · Statutory (src/modules/statutory): only once MyCity has entered that figure with its source.
Effort: S
For MyCity: A band is optional on purpose, since some roles are advertised before pay is settled; when a band is set, offers outside it are flagged to the approver. With the ₦0 fix above, every offer will need real pay. If you want offers checked against the national minimum wage, enter it in Payroll · Statutory and we can add that check.

ID: F74a
Title: An offer is verifiable only once everyone has signed
Verdict: BY_DESIGN
Severity: Low
Module: Offers / Signatures (public verify)
Evidence: Throwaway test (deleted): an offer approved, signed for the company and sent (request status pending, sealed_at null) returned 404 "No signed document has this reference" on GET /api/public/v1/verify/OFF-0002. src/modules/signatures/signatures.verify.js:12-13 ("Only a sealed copy is verifiable; anything else is the same 404 as an unknown reference") and signatures.repo.js:60-70 (status = 'completed' only). Existing tests/integration/signatures.test.js:216-262 assert a completed request verifies and a declined one is 404. OFF-0001, OFF-0002 and AGR-2026-0004 were not yet signed by the candidate or partner, so 404 is the rule working.
Scope ref: docs/guides/offers.md §5 (GET /verify/:ref: "only a sealed copy"), §3 step 9; partnerships.md §13.2 line 1408 ("Verification by reference shows no content; only the QR's token shows the document"); MILESTONES §10 (A12, the verification page reports two verdicts on a signed document).
Fix: None to the rule (references are sequential, so answering "exists, awaiting signature" would let anyone list offers and agreements).
Effort: S
For MyCity: A document becomes checkable on the public page once every party has signed it and the sealed copy exists; an offer the candidate has not yet signed is not yet a signed document. This is deliberate, so nobody can look up offers by guessing numbers.

ID: F74b
Title: Verify page wording makes an unsigned genuine letter look forged
Verdict: IMPROVEMENT
Severity: Low
Module: Public site (Verify)
Evidence: The API says "No signed document has this reference", but the page shows "Not Found. No document has this reference." (public-app/src/pages/Verify.tsx:106), dropping "signed" and giving no hint that signing may still be under way.
Scope ref: docs/guides/offers.md §3 step 9 and §10.1; FRONTEND_GUIDE word limits (help 35, sentence 20).
Fix: In Verify.tsx:106 say "No signed document has this reference." with the note "A document can be checked once everyone has signed it. Check the reference and try again." Same for the QR card at line 118 if wanted. Retake the User Guide picture for the verify screen.
Effort: S
For MyCity: We will reword the result so it says no signed document matches and that a document can be checked once everyone has signed, instead of a bare Not Found.

ID: F32a
Title: Send Offer accepts a start date that has already passed
Verdict: BUG
Severity: Medium
Module: Offers
Evidence: Throwaway test (deleted): an offer created with a start date 3 days ahead, approved, its start date then moved to yesterday (as if approval took longer), signed for the company and sent: Send returned 200 with start_date 2026-11-23 (yesterday) and expires_at 09/12/2026. create and edit refuse a past start date (src/modules/offers/offers.service.js:381-382 START_PAST) but submit (:475-490) and send (:620-645) do not check it again.
Scope ref: docs/guides/offers.md §6 (Submit for Approval needs the start date; "An unsigned offer lapses at expires_at"); the service's own START_PAST rule.
Fix: In offers.service.js send (and submit) refuse a start date before today with START_PAST, so the offer is edited back through draft or withdrawn and remade; show the reason on the Send button's error line.
Effort: S
For MyCity: An offer could be sent with a start date that had already gone by. We will stop that at Send, so the start date is corrected first.

ID: F32b
Title: Start date may fall before the offer expires
Verdict: IMPROVEMENT
Severity: Low
Module: Offers
Evidence: Same test: an offer starting in 2 days was sent with expiry 15 days later (200, start 26/11, expires 09/12). No rule ties the start date to the expiry; the guide handles a start date passing during documentation (offers.md §11 "The start date passes while the hire is still at documentation: the case waits").
Scope ref: docs/guides/offers.md §6 and §11.
Fix: At Send, warn (or refuse, MyCity to choose) when the start date is earlier than the expiry, suggesting a shorter Valid For or a later start (offers.service.js send; OfferForm.tsx Valid For).
Effort: S
For MyCity: The system does not stop a start date that falls before the reply deadline. We suggest a warning at Send; tell us if you would rather it be refused.

ID: F32c
Title: Interviews can still be scheduled after an offer is sent
Verdict: IMPROVEMENT
Severity: Low
Module: Recruitment (Interviews)
Evidence: Same test: POST /recruitment/interviews for a candidate already at Offer returned 201 and the stage stayed offer; src/modules/interviews/interviews.schedule.js:91-96 checks only that the application is active. Several rounds per candidate are allowed by design (interview_round), and in the auditor's case the 17/11 interview may have been booked before the offer.
Scope ref: docs/guides/recruitment.md §3 step 8, §6.6.
Fix: Warn on Schedule Interview when the candidate has an open offer (ScheduleInterview.tsx, from the application's stage), without refusing it.
Effort: S
For MyCity: A further interview can be booked for a candidate who already has an offer, which can be legitimate (a final meeting). We suggest a warning so it is a conscious choice.

ID: F77a
Title: Reviewer submits with lines that carry no evidence left unscored
Verdict: BY_DESIGN
Severity: Low
Module: Performance (Reviews)
Evidence: Throwaway integration test (tests/integration/zz-audit-d-review-coverage.test.js, built on performance-reviews.test.js setup, run on audit_d_test, then deleted). Musa checked in with evidence and his reviewer scored only the automatic lines: Submit Review refused, 422 SCORES_MISSING "Score every line first" on the own line. Ada checked in a figure with no evidence: her Results line (weight 60) read Not Assessable, and Submit Review with only the automatic lines scored passed (200, second_level). Rule in src/modules/reviews/reviews.service.js:655-662: an assessable line needs a score; a Not Assessable line needs none (and a reason if scored). Lines are Not Assessable when no evidence was given (src/modules/targets/targets.progress.js:61) or the review was scored without a check-in (reviews.service.js:359). So a review with all eight own lines blank had no evidence or no check-in behind them; one with assessable lines blank cannot be submitted.
Scope ref: docs/guides/performance.md §1.1 P16 (TB, 22/10/2026: "No evidence reads Not Assessable, never zero"), §6.14, §11 "No check-in by the due date"; MILESTONES §7 (amended 22/10/2026, the guide wins for the review).
Fix: None to the rule. A mandatory "not applicable with a reason" per line would reverse P16 and is a policy change for MyCity to request.
Effort: S
For MyCity: The system refuses a review with any assessable line unscored; it lets through only lines with no evidence (or no check-in), which by the rules agreed on 22/10/2026 count neither for nor against the person. The reviewer can still score such a line, with a reason.

ID: F77b
Title: Rating rests on scored lines only, so one line can read Exceeds
Verdict: IMPROVEMENT
Severity: Medium
Module: Performance (Reviews)
Evidence: Same throwaway test: Ada's review closed with her 60-weight Results line Not Assessable and only the KPI (25) and Monthly Update On Time (7.5) lines scored 1; closed with score_month 1, score_to_date 1, rating "exceeds", items [null, "1", null, "1"]. That is 32.5 of 100 weight behind an Exceeds rating, exactly the auditor's pattern (one automatic line, Team Scorecards and Reviews, scored 1 gives 1.00 Exceeds; nothing scored gives no score). Formula in reviews.service.js scoresOf (around line 894) through scoring.scoreToDate, as the guide states it.
Scope ref: docs/guides/performance.md §6.9 ("Score to date = Σ(weight × score) ÷ Σ(weight of the lines that have a score)"), §6.14 (Not Assessable leaves the denominator), §6.15 bands; decision P16 (TB, 22/10/2026). Working as specified; the weakness is that nothing shows how little of the scorecard a rating rests on.
Fix: Show coverage (weight scored ÷ total weight, for example "32.5 of 100 scored") beside Score and Rating on the review, the scorecard, My Performance and the review PDF (src/modules/reviews/reviews.service.js, targets read model, ReviewPage.tsx, Scorecards.tsx, templates/documents/review-summary.html, contract schemas/reviews and targets). Optionally hold the rating back as "Not Rated" below a minimum coverage that Operations & People set in the quarter's rules (rules.lines), once MyCity chooses the figure.
Effort: M
For MyCity: The rating counts only the lines that could be scored, as agreed, so a review where most lines had no evidence can still read Exceeds. We recommend showing how much of the scorecard was scored next to every rating, and, if you choose a minimum (for example half the weight), withholding the rating below it.

ID: F29a
Title: Company Score shows while most key results await their report
Verdict: BY_DESIGN
Severity: Low
Module: Performance (Goals)
Evidence: Code reading. The Company Score is the mean of the company objectives' scores, each the mean of its key results scored that month; blank when nothing is scored (docs/guides/performance.md §6.8 Roll-up). KPIs never feed it: they are scored on scorecard lines, not at function level (§6.5, §10 Kpis row). The Goals header already shows Awaiting Report beside the score (app/src/features/performance/Goals.tsx:114-118), so the auditor's 41 Awaiting Report sits next to the 0.72. The 47 KPIs Awaiting Actual are a different list and do not affect the figure.
Scope ref: docs/guides/performance.md §6.8 (mean of what is reported, MyCity's own OKR workbook rule, P1, P6), §6.5.
Fix: None required. Optional (S): a help line on Company Score naming how many key results it rests on ("From 9 of 50 key results").
Effort: S
For MyCity: The score is the average of the key results reported so far, as your OKR workbook works it out, and the number still awaiting a report is shown beside it. KPIs do not feed the company score.

ID: F29b
Title: Targets still read [TBC] and "approved ceiling" in the Q4 plan
Verdict: CLIENT_ACTION
Severity: Medium
Module: Performance (Goals, KPIs)
Evidence: The wording is MyCity's own Q4 OKR workbook, loaded on staging as it stands: seeds/staging/performance/q4-2026-okrs.xlsx, sheet Company OKRs row 3 ("[TBC] marks a provisional target, locked by 7 November from the verified baseline"), rows 16, 19, 20, 24, 25; Branding & Marketing rows 30 (BM-K07 "≤ approved ceiling"), 34, 35, 39; Partnership & Growth rows 8, 11, 13, 14, 16, 17. The import keeps the words and sets no figure from a [TBC] (src/modules/kpis/kpis.import.js:28-31). Key results take their final target by Change Target to the CEO (guide §6.7, P9). A KPI's wording is changed on Edit KPI, but the Edit KPI form offers no Target figure (app/src/features/performance/Kpis.tsx:254-282), although the API's KpiEdit accepts target_value (checked with node on packages/contract/schemas/kpis.js).
Scope ref: docs/guides/performance.md P1 (the workbooks are the source of truth), P9 and §6.7 (target changes), §6.5 (KPI fields; guide change log 27/10/2026: "Edit KPI still cannot change the figure").
Fix: Client: the function heads replace each [TBC] (Change Target on the key result, approved by the CEO; Edit KPI for a KPI's wording). Ours, optional (S): add Target (Optional) to Edit KPI in app/src/features/performance/Kpis.tsx, which the contract already allows, so a KPI can gain its figure on screen.
Effort: S
For MyCity: These are the provisional targets from your own Q4 workbook, which planned to lock them by 7 November. Your heads should set the final figures with Change Target (the CEO approves); we can add the figure to Edit KPI so KPIs can be completed on screen too.

ID: F29c
Title: Marketing consent violations target reads 1, not 0
Verdict: NOT_REPRODUCED
Severity: Low
Module: Performance (KPIs)
Evidence: The source row is BM-K08 in seeds/staging/performance/q4-2026-okrs.xlsx, sheet Branding & Marketing row 31, Target "0"; the import writes target_text "0" and target_value "0" (src/modules/kpis/kpis.import.js:28-31, 79-80). The scorecard line linked to it (q4-2026-scorecards.xlsx, sheet "00019 Chinyere Elechi" row 23) also starts with a target of "0", then its description. The KPI list shows the wording (app/src/features/performance/shared.tsx:249-250), so it reads 0 as loaded. A 1 on staging would have been typed in since (every KPI edit is recorded as performance.kpi.saved on Settings · Audit Log, src/modules/kpis/kpis.events.js:10).
Scope ref: docs/guides/performance.md §6.5, §6.19.
Fix: None in code. If staging shows 1, set it back to 0 on Edit KPI.
Effort: S
For MyCity: Your workbook and our load both give this KPI a target of 0. If it reads 1 on staging it was edited there; please set it back to 0.

ID: F29d
Title: New KPI accepted with [TBC] wording and no figure
Verdict: BY_DESIGN
Severity: Low
Module: Performance (KPIs)
Evidence: src/modules/kpis/kpis.test.js:17-35 (Target Wording required, the figure optional; "Approved ceiling" with no figure is valid). A KPI with no figure is scored from its monthly Met or Not Met alone.
Scope ref: docs/guides/performance.md §6.5 "What a KPI must say, and what it may leave out" (JBS Praxis, 27/10/2026): wording required, Target figure optional, "[TBC] ... stays valid".
Fix: None. If MyCity wants a figure required on new KPIs, it is a small change to KpiCreate in packages/contract/schemas/kpis.js, but it would refuse targets like "Approved ceiling" that their own workbook uses.
Effort: S
For MyCity: A KPI needs its target in words and may leave the number out, as agreed on 27/10/2026, because several of your own KPIs have no single number. Such a KPI is judged Met or Not Met each month.

ID: F33a
Title: Repeat Cautions are allowed; the ladder suggests, a person decides
Verdict: BY_DESIGN
Severity: Low
Module: Queries & Sanctions
Evidence: Existing integration tests: tests/integration/queries.test.js:722-755 (a second offence offers Warning as next_step, standing then offers Second Warning) and :865-878 (a manager's card counts only sanctions on queries they raised, so it offers Caution; Operations & People see the whole standing). Record Decision preselects the next rung and marks it (Next) (app/src/features/queries/index.tsx:322, 362); the proposer may pick another. Only issued sanctions inside valid_days count (src/modules/sanctions/sanctions.repo.js:266-284, status = 'issued'), so a Caution still awaiting approval does not move the next one up. Four Cautions in a week therefore come from proposers choosing Caution, from managers who cannot see each other's sanctions, or from Cautions proposed while the earlier ones were still pending. Not from our seed: seeds/staging/50_queries.js:21-24, 247 proposes at most two Cautions.
Scope ref: docs/guides/queries.md §6.5 ("Next rung ... This is what a second offence offers without code. People may choose a different rung; the choice and reason are recorded"; "a manager's card counts only those on queries they raised"); MILESTONES §8 definition of done ("A second offence escalates to second warning without code").
Fix: None to the rule.
Effort: S
For MyCity: The system already works out and preselects the next step on the ladder; as agreed, the person deciding may choose a lighter one and gives a reason. The four Cautions were chosen on staging, not forced by the system.

ID: F33b
Title: Approver is not warned when a sanction sits below the next rung
Verdict: IMPROVEMENT
Severity: Medium
Module: Queries & Sanctions
Evidence: Code reading. Operations & People, who approve every sanction and see the whole standing (guide §6.4, §6.5), get no sign on the query's card that the proposed rung is at or below one already in force: the card renders no standing (no use of in_force or standing in app/src/features/queries/index.tsx), although GET /sanctions/standing returns it (src/modules/sanctions/sanctions.service.js:77-90). A manager who proposes sees only their own queries' sanctions, so their Next can legitimately read Caution.
Scope ref: docs/guides/queries.md §6.4 (Operations & People approve every rung), §6.5; MILESTONES §8.
Fix: On the query's card for an approver with scope all, show the person's sanctions in force and the next rung, and mark a proposal at or below a rung in force ("Below next step: Warning") from the standing the API already returns; optionally require the proposer's reason to say why when they pick other than Next (src/modules/queries/queries.service.js decide, QueryDecision in packages/contract/schemas/queries.js, app/src/features/queries/index.tsx). Update docs/manual chapter for Queries.
Effort: S
For MyCity: Each manager sees only their own queries, so the final check sits with Operations & People. We will show them the person's current sanctions and flag any proposal lighter than the next step, so a repeat Caution is always a conscious choice.

ID: F40
Title: Rule-raised queries show the rule's bare name under Raised By
Verdict: IMPROVEMENT
Severity: Low
Module: Queries & Sanctions
Evidence: app/src/features/queries/index.tsx:125 (list) and :175 (card) render raised_by_name, else rule_name, else "Rule", so a rule-raised query reads "Unregistered Device" in the Raised By column with nothing saying it is a rule.
Scope ref: docs/guides/queries.md §10.1 (Queries row: "raised by or the rule"; card "raised by (a person, the rule, or Attendance Policy)"). Showing the rule is specified; how it is labelled is not.
Fix: Render a rule as "Rule: Unregistered Device" (and "Rule: Attendance Policy") in both places in app/src/features/queries/index.tsx, update the Queries chapter in docs/manual and retake its pictures.
Effort: S
For MyCity: Showing the rule that raised a query is intended, but the label should make clear it is a rule and not a person. We will prefix it with "Rule:".

ID: F80a
Title: Every role rates the same ten interview traits
Verdict: CLIENT_ACTION
Severity: Low
Module: Recruitment (Interviews)
Evidence: The ten traits are MyCity's own Interview Assessment Format, the Default Traits a new vacancy starts from (seeds/staging/55_recruitment.js:71-83, saved as default_traits at :433). Each vacancy's traits are already editable: Vacancies · Questions edits the interview traits per role (app/src/features/recruitment/VacancyQuestions.tsx:39, 58, up to 20), shown on the vacancy as Interview Traits (Vacancies.tsx:276); Careers Settings edits the defaults (CareersSettings.tsx:64). The card rates whatever traits the vacancy holds (src/modules/interviews/interviews.panel.js:36-38).
Scope ref: docs/guides/recruitment.md §3 step 3 (lines 101-108: "A role may drop a trait that does not fit it (Experience in Sales and Marketing for an engineer) or add its own, at most 20 traits"), §6.6; decision TB, 04/11/2026.
Fix: Client: on each vacancy, open Questions and drop or replace the traits that do not fit (for the Content Producer, Experience in Sales and Marketing), before its interviews are rated (a rated trait is retired, not rewritten). Optionally change the Default Traits on Careers Settings.
Effort: S
For MyCity: Each vacancy can already have its own traits; they start from your standard ten. Your recruiters should trim or add traits per role on the vacancy's Questions before interviews begin.

ID: F80b
Title: Card submitted before the interview appears not to submit
Verdict: NOT_REPRODUCED
Severity: Low
Module: Recruitment (Interviews)
Evidence: Ran the existing integration test tests/integration/recruitment-interviews.test.js "every card in before the start" on audit_d_test: passed. A complete card submitted before the interview starts is accepted (submitted_count 1, round_status open, status scheduled) and locked; the round then waits for the start and the daily sweep closes it (:320-345). Server: no time check in submit (src/modules/interviews/interviews.panel.js:75-101), which sets submitted_at on both the card and the seat (interviews.repo.js:357-360); the detail returns it as my_feedback.submitted_at (interviews.service.js:134-141). Screen: Submit Card toasts "Card submitted" and closes (app/src/features/recruitment/MyCard.tsx:147-161). What stays open before the start is the round, not the card, by design.
Scope ref: docs/guides/recruitment.md §6.6 (lines 538-542: "The round closes by itself once every seat ... has submitted and the interview has started ... Before the start a full round stays open").
Fix: None found. If MyCity can send the interview's link, we will look at that record, since a card that kept submitted_at empty would mean the submit was never sent (for example the confirm was dismissed).
Effort: S
For MyCity: In our tests a card submitted before the interview is accepted and locked straight away; only the interview round stays open until the interview time. If you saw otherwise, please send us the interview's link so we can check that record.

ID: F82a
Title: Key result reported Done while its score reads 0.45
Verdict: BY_DESIGN
Severity: Low
Module: Performance (Goals)
Evidence: Code reading. A month's status is what the head reports on Report Month (not_started, on_track, at_risk, off_track, done, missed; packages/contract/schemas/goals.js:329), while the score is worked out from the actual against the target (guide §6.8), as in MyCity's workbook, which keeps Status and the monthly scores in separate columns (q4-2026-okrs.xlsx, Technology & Back-office Ops row 5 headers). CO-KR2.2 is Scored From TBO-KR1.2 and the workbook gives it "On track" and no score (Company OKRs row 11), so "Done" with 0.45 was reported on staging. The Goals help already separates them ("the On Track pill is a reported status", guide §10.1 Goals row).
Scope ref: docs/guides/performance.md P1, §6.8 (status of the month last reported; score from the actual; Scored From).
Fix: None required. Optional (S): on Report Month, ask to confirm when Done is chosen with a score under the Good band.
Effort: S
For MyCity: The status is what the owner reports and the score is calculated from the figures, as in your workbook, so they can differ (work finished but short of target). We can add a prompt when someone marks Done below target.

ID: F82b
Title: CTO's scorecard sits under Technology while his record says General Management
Verdict: CLIENT_ACTION
Severity: Low
Module: Performance (Scorecards) / People
Evidence: Our data puts Bode Oluwasanmi in Technology & Back-office Ops: seeds/staff/staff-list.xlsx row 11 (Team "Technology & Back-office Ops") and seeds/staff/nomenclature.json:5-10 (head post Chief Technology Officer). A scorecard keeps the function of the quarter plan it was approved in (scorecard.department_id, src/modules/targets/targets.repo.js:17, 31; guide §4 scorecard row), so his Q4 scorecard is in the TBO plan. A General Management record was therefore set on staging after the plan bound; a move does not move a bound scorecard (guide §11 "Someone moves department" changes what the person reads, not their plan).
Scope ref: docs/guides/performance.md P4 (one nomenclature), §6.25 (General Management is derived from the department and gives whole-plan access), §11.
Fix: Client: decide where the CTO belongs. If Technology & Back-office Ops (as the staff list and org chart have it), set his department back on People; if General Management, his next quarter's scorecard follows the move. No code change.
Effort: S
For MyCity: Your staff list places the CTO in Technology & Back-office Ops, and his Q4 scorecard belongs to that plan. His record was changed to General Management on staging afterwards; please confirm which is right and we will make the records agree.

ID: F82c
Title: CEO's scorecard is Agreed with no reviewer
Verdict: BY_DESIGN
Severity: Low
Module: Performance (Scorecards)
Evidence: Code reading of the decision. The CEO has no reviewer in the system; the scorecard is self-assessed and marked for the Board.
Scope ref: docs/guides/performance.md §1.1 P12 ("the CEO's scorecard is self-assessed and marked for the Board"), §6.13 ("The CEO has no reviewer in the system (the Board)").
Fix: None.
Effort: S
For MyCity: As agreed, the CEO is reviewed by the Board outside the system, so the CEO's scorecard has no reviewer.

ID: F82d
Title: Praxis AI calls a person on probation Active
Verdict: BUG
Severity: Low
Module: People (Praxis AI)
Evidence: Code reading. The People screens draw "On Probation" from the probation dates (app/src/features/people/status.ts:17-23: status active with confirmation_due_on and no confirmed_on reads On Probation), but the AI's employees.list read returns the raw rows (src/modules/organisation/organisation.ai.js:274-283, repo.list), whose status is the stored employment status, active, with no probation value. So the assistant answers Active for someone the record shows On Probation.
Scope ref: docs/guides/foundation.md §10.1 (status pills drawn from the record's facts); docs/guides/praxis-ai.md (reads answer from the module's own data).
Fix: Give the read the same label the screen shows: add a derived employment_status (Active, On Probation, Suspended, Left, Archived) to the rows employees.list returns to the AI, worked out on the server as status.ts does, and say so in the read's description (src/modules/organisation/organisation.ai.js, organisation.repo.js; regenerate the AI catalogue snapshot, gate 23).
Effort: S
For MyCity: The assistant read the stored employment status, while the People screen shows probation from the probation dates. We will give the assistant the same status the screen shows.

ID: F82e
Title: Test goals "test run" and "another test" on staging
Verdict: CLIENT_ACTION
Severity: Low
Module: Performance (Goals)
Evidence: Not in our seeds: no match for "test run" or "another test" in seeds/ or in the two workbooks it loads (seeds/staging/performance/*.xlsx), nor in git history of seeds/. They were typed on staging by hand. Production is never seeded with demonstration data (A5, CLAUDE.md), so staging entries do not reach go-live.
Scope ref: MILESTONES §1 A5; docs/guides/performance.md §10.1 Goals row (Delete Goal for the CEO and goals.organisation; Delete Objective and Delete Key Result while a plan is not binding).
Fix: Whoever created them deletes them on staging (Delete Goal on the goal's sheet, or Delete Objective / Delete Key Result while the plan is not binding). We will remove them if they were ours.
Effort: S
For MyCity: These entries were typed into staging during testing, not loaded by us, and production starts without any test data. They can be deleted on the goal's sheet; tell us if you would like us to do it.

