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

