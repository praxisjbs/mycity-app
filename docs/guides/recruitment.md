# Recruitment · Engineering Guide

| | |
|---|---|
| Owner | GE |
| Milestone | M4 |
| Backend modules | `vacancies`, `candidates`, `assessments`, `interviews`, `talent_pool` |
| Frontend paths | `app/src/features/recruitment/`, `public-app/src/pages/Home.tsx`, `public-app/src/pages/Careers.tsx`, `public-app/src/pages/Vacancy.tsx`, `public-app/src/pages/Apply.tsx`, `public-app/src/pages/Assessment.tsx`, `public-app/src/pages/shared.tsx`, `public-app/src/pages/Guidance.tsx`, `public-app/src/lib/router.tsx`, `public-app/src/shell/Page.tsx` |
| Permission key(s) | `recruitment` |
| Capabilities | none |
| Screens (PROGRESS.md rows) | #38 Vacancies, #39 Candidates, #40 Assessments, #41 Interviews, #44 Talent Pool, #111 Analytics; public #107 Home, #80 Careers, #81 Vacancy, #82 Apply, #83 Assessment |
| Status | Built |
| Last changed | 11/11/2026 |

Sources: MILESTONES §9 (scope, A9, A10, definition of done) and §1 (A23 as amended 01/11/2026);
REUSE_MAP §5; MILESTONE_QUESTIONS Q4, Q9, Q10; DATABASE_SCHEMA M4; the discovery call of
02/09/2026 and the review of 10/10/2026 (what Operations & People asked for); `home.md` §4.1 and §6 (the Open
Vacancies card and the Recruitment SLA alert read these tables); `organogram.md` §2, §3 and §10 (a
vacant seat becomes a suggested vacancy); `workspace.md` §6 (calendar invites); `ai-control.md` §6.2
(jobs); `addresses.md` §2 and §6.9 (the vacancy's location); the internal Modules Review of 04/11/2026
(TB, GE, AJ): the Talent Pool is M4's, the interview card is MyCity's own Interview Assessment Format
rated 1 to 10, Screen With AI asks must-meet conditions, each vacancy picks its active stages.
Offers, documentation and onboarding are M5 (`offers`, `onboarding`, `employment_contracts`, AJ); this
guide stops where a candidate the panel selected is handed to them.

## 1 · What it is for

MyCity hires about one person at a time, and every hire today runs through email, a spreadsheet and
memory. Recruitment is the path from an open seat to a shortlist: Operations & People write a
vacancy (the AI drafts the description), publish it to a careers page anyone can open, and share the
link. Strangers apply with a CV. Each application gets an instant, free estimate, and on a recruiter's
press an AI read of the CV against the role. Candidates take timed tests or untimed take-home briefs on the public site.
A panel interviews them and each panelist scores alone, unable to see the others until the round
closes, on MyCity's own interview card (traits rated 1 to 10); the hiring manager then writes one
consolidated report and decides Select, On Hold or Reject. A weighted scorecard ranks everyone, and time
at each stage is visible. Good candidates who are not hired this time go into the Talent Pool for 24
months and can be invited back to a later role.

Who uses it: Operations & People run it end to end; hiring managers and Heads of
Department follow their own vacancies; panelists (people who hold Recruitment) score interviews;
Management and the CEO see everything. Candidates use only the public site, `go.mycityapp.io`, and
never sign in.

## 2 · Screens affected

| Screen / tab (slug) | Where | Who sees it | What it shows | What a person can do there |
|---|---|---|---|---|
| Recruitment · Vacancies (`vacancies`) | staff app | `recruitment` view, scope by hiring manager | Open, paused, draft and closed vacancies with applicants, days open and the closing date; View Empty Seats (vacant seats with no vacancy, in a dialog) | New Vacancy (Write With AI for the description), Edit, Publish, Pause, Resume, Close, Copy Link, Questions, Scorecard, Candidate Emails, Careers Settings (About MyCityApp and the Default Traits; saved only with `recruitment` edit over every vacancy), See Candidates |
| Recruitment · Candidates (`candidates`) | staff app | `recruitment` view, scope by the vacancy's hiring manager | The board: Application, Screening, Assessment, Interview, Shortlist, and Offer once M5's Offers screen opens (the candidates M5 sent an offer; never moved by hand); each card with the screening score and its Provisional flag; a candidate's sheet: details, CV, answers, scores, scorecard, assessments, interviews, time at each stage | Move between stages, Not Progressing (with a reason), Reopen, Add to Pool, Score With AI, Screen With AI (with must-meet conditions), Send Assessment, Schedule Interview, Invite to Apply, open the CV |
| Recruitment · Assessments (`assessments`) | staff app | `recruitment` view | Assessment definitions (name, type, minutes, questions, sent, average); Sittings (who took what, state, score) with Awaiting Marking | New Assessment, Edit, Questions (with Suggest With AI), Activate or Deactivate, Send to Candidates (every candidate of a role at a stage), Mark Answers |
| Recruitment · Interviews (`interviews`) | staff app | `recruitment` view, scope by hiring manager or a seat on the panel | Upcoming and recent interviews across the page, the one picked in a wide dialog; its Blind Panel (submitted or waiting, scores hidden while the round is open), the candidate's Weighted Scorecard (in scope), the candidate's details card filled before the interview, the traits and averages after it closes, the consolidated report and its PDF, Round Activity | Schedule Interview, Reschedule, Cancel, Candidate Details, My Card (each trait 1 to 10, decision, comments, private notes, Tidy With AI, the candidate's CV), Submit Card, Close Round, Write Report, Download Form |
| Recruitment · Talent Pool (`talent-pool`) | staff app | `recruitment` view, scope by the hiring manager of the vacancy they applied for | Candidates kept for later: applied for, score, added, reason, invited, until when kept | Add to Pool (from a candidate), Invite to Apply (to an open vacancy), Remove, Export |
| Recruitment · Analytics (`analytics`) | staff app | `recruitment` view, within the reader's scope | Funnel, All Roles (candidates at each stage now, across every role; `GET /vacancies/summary`); Screening Scores (candidates by screening score band; `GET /candidates/summary`) | Read only |
| Home (`/`, the public index) | public site | anyone | Open roles, departments hiring and cities (`/jobs/summary`); About MyCityApp from Careers Settings; the three roles closing soonest; How We Hire | Search Roles (opens Careers with `q`), open a role, See All Roles, Copy Careers Link, Verify a Document |
| Careers (`/jobs`) | public site | anyone | Open roles, closing soonest first: department, title, area, arrangement with its note, employment type, closing date; the departments hiring with their counts | Search, pick one department, open a role |
| Vacancy (`/jobs/<slug>`) | public site | anyone | One role: what it is, how it is measured, must have, nice to have, how we hire, salary when shown, arrangement and probation; a paused or closed role says so; more roles of its department | Apply for This Role (mints the Apply link), Share Role, Copy Role Link |
| Apply (`/apply/<token>`) | public site | the holder of the link | The form: name, email, phone, years of experience, CV, the vacancy's own questions, why this role, the privacy notice | Submit Application; the receipt with its reference |
| Assessment (`/assess/<token>`) | public site | the holder of the link | Intro (type, minutes, questions); the running test with a server timer and autosave; submitted or time up | Start the Assessment, answer, upload a file answer (up to 25 MB) or paste a link to a larger one, Back, Next, the question map, Submit Assessment |
| Home · Overview, Open Vacancies card | staff app | as `home.md` §6 | Open vacancies in scope | Open a vacancy |
| Home · Alerts, Recruitment SLA | staff app | as `home.md` §6 | Applications at one stage longer than the rule's days | Open the candidate |
| People · Organogram, Create Vacancy | staff app | `people` edit and `recruitment` create | On a vacant seat | Opens New Vacancy here with what the seat knows filled in (looked up by `org_seat_id` on `/suggested`), keeping the seat |
| My Workspace · Calendar | staff app | each panelist | The interview as a calendar entry with its `.ics` invite | Open it |

## 3 · How the screens relate

1. **A seat falls empty.** A vacant `org_seat` with no live vacancy shows on Vacancies under Suggested
   From Organogram, 25 a page. Create Vacancy (there, or on the Organogram) opens New Vacancy with the
   seat's title, department and reporting line filled in, and its line manager as the hiring manager when
   they may be one (§6.1; otherwise Hiring Manager is left to pick), so
   its interview starts with the role and the department answered; from the Organogram the form first
   looks the seat up (`/suggested?org_seat_id=`). The vacancy keeps
   `org_seat_id`. Nothing is created until someone saves (`organogram.md` §3).
2. **The vacancy is written.** New Vacancy is an interview of ten questions, one card at a time, each
   card's hint behind its help term and the count ("Question 3 of 10") sized for the whole interview
   from the first card (GE, 06/11/2026): (1) the role (Job Title, the one answer required); (2) the
   Department and Hiring Manager; (3) Positions and Employment; (4) how they work: Arrangement,
   Arrangement Note, Working Days; (5) where: the Location, picked (F27), passed over for a remote role
   (the count drops by one); (6) the pay: Salary From, Salary To, Show Salary on Careers; (7) the
   must-haves and key responsibilities in their own words, and Years of Experience; (8) anything else:
   Reports To, and in their own words what would set someone apart, the perks, the team; then (9, 10)
   two questions the AI writes about this role from those answers (`POST
   /recruitment/vacancies/assist/follow-ups`, `vacancy-follow-ups`), never about age, sex, family,
   origin, nationality, religion, disability, health or appearance (a question naming one is dropped
   by the server, with the protected list of §6.4's conditions). Every card but the first has Skip;
   **Use Blank Form**, on every card, opens the editor at once with what was answered. **Draft Vacancy**
   on the last card sends the answers to `jd-draft` (`POST /recruitment/vacancies/assist` with
   `interview`), which writes the description, must have and nice to have in MyCity's shape (§6.1);
   when the AI is off, over its limit or fails, the interview has eight questions and the server writes
   a plain draft from the answers instead (the role overview from the answers, Key Responsibilities from
   the must-haves and follow-ups, never an error). The draft opens in the editor, the three-step wizard
   (Role, Details, Pay and Publish) that Edit Vacancy also is, to check and publish; nothing is kept
   until it is saved, and closing the editor or the interview with answers asks first. On the editor,
   Write With AI drafts the description and the must have and nice to have from what is filled so far
   (`POST /recruitment/vacancies/assist`, prompt `jd-draft`); the draft goes straight into the form for
   the person to read and edit, and nothing is kept until it is saved. Save Draft (Publish Now off) keeps
   a draft (`VAC-0001`); Publish Vacancy makes it `open`, stamps `published_at`, and
   it appears on `/jobs` at `/jobs/<slug>` (`vacancy.published`). No approval (GE, 04/11/2026).
3. **Questions and scorecard.** A vacancy carries its own Apply questions (shown on the Apply form) and
   interview questions (rated by each panelist), both in `vacancy_question` by `purpose`. Suggest With
   AI proposes both from the description (`screening-questions`). The interview questions are the
   traits of MyCity's Interview Assessment Format (shared 04/11/2026): Appearance and Grooming, Level of
   Confidence, Oral Communication Skills, Clarity of Thought and Expression, Accuracy in Language, Job
   Knowledge and Experience, Experience in Sales and Marketing, Stability Level in Career, Suitability
   for Target Assignment, Future Growth Potential in Career. New Vacancy fills them from the Default Traits
   kept on Vacancies · Careers Settings (`setting` `recruitment.default_traits`); being MyCity's own
   business list it is entered there once on each environment, and only the staging seed holds it
   (A26). A role may drop a trait that does not fit it (Experience in Sales and Marketing for an
   engineer) or add its own, at most 20 traits. A question that has been answered or rated is never
   rewritten: reworded, it is retired and the new wording saved as a new question. Its scorecard is
   the five A10 parts, each switched on or off for this role, with the default weights 15, 15, 25, 20,
   25 over the parts switched on, editable, summing to 100 (§6.5). A role may run screening then
   interview and nothing between (TB, 04/11/2026).
4. **Someone applies.** On `/jobs/<slug>`, Apply for This Role calls `POST /api/public/v1/jobs/:slug/apply`,
   which mints a single-use `application.apply` token (48 hours) and opens `/apply/<token>`. The CV
   uploads first (`POST /apply/:token/cv`): it lands in quarantine and is scanned by ClamAV
   (`media-scan`). Submit (`POST /apply/:token`) finds or creates the `candidate` by email, creates
   the `application` (`APP-0001`) at stage `application`, records the answers, computes the free
   estimate (`provisional_score`, §6.4), spends the token, and answers only a reference
   (`application.received`). The candidate is emailed `application-received`; the hiring manager is
   notified.
5. **Staff can invite.** Invite to Apply (Candidates) emails a person an Apply link for one vacancy
   (`apply-invite`, the same token, 7 days). They apply exactly as a stranger does.
6. **Screening.** A recruiter picks the role on Candidates and presses Screen With AI: it first asks
   one to three must-meet conditions ("A degree in finance", "Lives in Lagos"), kept on the vacancy
   (`screening_conditions`), then reads every active, unscored application of that role in the
   background (`cv-screen`, Deep Reasoning, §6.4): CV, cover letter and answers against the description
   and the conditions. Score With AI on one card does the same for one. Each writes `screening_score`,
   its summary and `screening_ai_run_id`. Until then the card shows the estimate with **Provisional**.
   The score never moves anyone: a person drags the card (`POST /candidates/:id/move`), each move a row
   in `entity_state_history` and `current_stage_entered_at` reset.
7. **Assessment.** Send Assessment (from the candidate's sheet) picks an active assessment and how many
   days the candidate has to start it: an `application_assessment` sitting and an `assessment.take`
   token (`assessment-invite` mail), and moves a candidate before Assessment to it, as Schedule
   Interview moves them to Interview (only forward, only on a board with Assessment; GE, 05/11/2026).
   Send to Candidates (Assessments) does the same at once for every
   active candidate of one role at one stage who has no live sitting of it (TB, 04/11/2026). On `/assess/<token>` the candidate presses Start; the server sets
   `started_at` and `due_at` (start plus the minutes); every answer saves as it is given, a file answer
   uploaded (up to 25 MB) or given as a link to a larger one (a video, a portfolio); Submit, or
   the clock, ends it (`assessment-expiry`). Choice answers score themselves; written and file answers
   wait on Assessments · Sittings for Mark Answers. Once every answer has a mark the sitting is
   `scored` and its percentage lands on the candidate (`assessment.scored`).
8. **Interview.** Schedule Interview (Interviews, or the candidate's sheet) names the time, in person
   at a worksite or by video with a link, and the panel (people who hold Recruitment). It creates an
   `interview_round` (open) with one `interview` and its `interview_panelist` rows, a calendar entry
   with each panelist as attendee (their invite through `calendar.invitations`), and mails the
   candidate `interview-invite` with an `.ics` file. The candidate moves to Interview. Before the
   interview, Operations & People fill the card's Candidate Details once for the whole panel: current
   employer, academics (Outstanding, Very Good, Good, Average, Poor), total experience and experience
   relevant to MyCity, in months.
9. **Blind feedback.** Each panelist opens My Card on their own phone or laptop, during the interview
   or after: the candidate's details and CV, a rating from 1 to 10 for each trait (a tap on the tenth
   star), their decision (Select, On Hold or Reject), comments (Tidy With AI, `interview-notes-cleanup`)
   and private notes. The stars and the decision save as they are tapped; the comments and notes on Save
   Draft or Submit Card, and closing the card with words not yet saved asks first. While the round is open, a
   person reads only their own feedback, the hiring manager and the CEO included (§6.6): the interview's
   Blind Panel shows who has submitted, with Hidden for the score. Panelists who have not submitted are
   reminded once a day from the interview's end (`interview-reminders`); each reminder shows in the
   interview's Round Activity.
10. **The round closes** when the last panelist submits, or when someone with `recruitment` edit presses
    Close Round. Then everyone who may see the interview sees every panelist's ratings, comments and
    decision (never another's private notes), each trait's average across the panel, and the round's
    score (§6.6), which is the interview part of the scorecard. The hiring manager (or `recruitment`
    edit) writes the consolidated report and decides Select, On Hold or Reject
    (`interview_round.report`, `decision`); saving it generates the Interview Assessment Form, a PDF of
    the whole card with every panelist's ratings, filed in the vault (`form_document_id`).
11. **The scorecard ranks.** Each application's weighted total is computed from the components it has
    (§6.5) and shown on its card and sheet; Candidates sorts by it.
12. **Shortlist and hand-off.** A candidate the panel selected moves to Shortlist. M5 (Offers and
    Onboarding, AJ) picks up from there, and only M5's own steps move the card on, through this
    module's `candidates.advanceIn` and `hireIn` in M5's transaction (§6.3; #79, 06/11/2026): an offer
    sent moves it to Offer, a column of the board; acceptance to Documentation, the checklist done to
    Pre-Onboarding, the start date to Onboarding (the Onboarding screen's, not the board's); an offer
    ended unsigned back to Shortlist (`offerEndedIn`). When onboarding completes, `hireIn` marks the
    application hired, so it leaves the board, and the vacancy hears of it (`vacancies.hiredIn`): its
    Organogram seat is filled by the new employee and it closes as filled once every opening is. Not Progressing at any stage
    records a reason, revokes the candidate's live links and emails `candidate-not-progressed`.
13. **The Talent Pool.** Add to Pool (a candidate's sheet, usually after Not Progressing or On Hold)
    keeps the person with a reason for 24 months (`talent_pool_entry`). Invite to Apply from the pool
    sends them an Apply link to an open vacancy (`apply-invite`, source `pool`). The `talent-pool-purge`
    job takes a member off the pool when their 24 months end.
14. **Home reads it.** The Open Vacancies card counts `open` vacancies in scope; the Recruitment SLA
    alert reads `application.current_stage_entered_at` (`dashboard/sources/vacancies.source.js`, which
    this milestone now owns in step with its tables).

## 4 · Data

| Table | Key columns | Notes |
|---|---|---|
| `vacancy` | `number` (VAC-0001), `title`, `slug`, `status` (draft, open, paused, closed), `department_id`, `hiring_manager_id`, `org_seat_id`, `positions`, `employment_type`, `work_pattern`, `work_pattern_note`, `location` (the line), `probation_months`, `reports_to`, `min_experience_years`, `salary_min`, `salary_max`, `salary_visible`, `description`, `requirements` (must have), `nice_to_have`, `target_start_on`, `closes_at`, `published_at`, `paused_at`, `closed_at`, `close_reason`, `screening_conditions` (at most three), `working_days` | 4000, widened by 4010. `description_ai_run_id` stays unused: Write With AI keeps nothing. `slug` is set at first publish, so a draft (never published) may be closed without one. Location is a picked place at level area: owner `vacancy.location` (`addresses.md` §6.9) |
| `vacancy_question` | `vacancy_id`, `purpose` (application, interview), `question_type` (text, yes_no, choice for Apply; rating for a trait), `prompt`, `options`, `required`, `display_order`, `active` | 4000, `purpose` and `active` added by 4010. An interview question is a trait of the card, rated 1 to 10 |
| `recruitment_scorecard_criterion` | `vacancy_id`, `code` (screening, psychometric, technical, case_study, interview), `weight`, `active` | 4000; created with the vacancy at the default weights, `code` from 4000, its CHECK and `active` added by 4010. A part switched off has weight 0; a part on weighs at least 1 |
| `candidate` | `first_name`, `last_name`, `email` (unique), `phone`, `consented_at` | One row a person, found by email at each application. `location` and `profile` stay unused |
| `application` | `number` (APP-0001), `vacancy_id`, `candidate_id`, `source` (careers, invited, pool; default careers, never null), `stage`, `status` (active, not_progressed, withdrawn, hired), `current_stage_entered_at`, `years_experience`, `cover_letter`, `cv_document_id`, `answers`, `provisional_score`, `screening_score`, `screening_summary`, `screening_ai_run_id`, `screened_at`, `rejection_reason`, `consented_at` | One per candidate per vacancy. `answers` keyed by `vacancy_question_id` (open-ended extras, allowed in jsonb). `provisional_ai_run_id` from 4000 stays unused: the estimate is arithmetic and has no run |
| `entity_state_history` | `entity_type` `application`, `from_state`, `to_state`, `actor_id`, `reason`, `changed_at` | 0070, shared. Time at each stage. 4000's `application_stage_history` was never written and is dropped by 4020: a move is an `entity_state_history` row |
| `assessment_definition` | `code`, `name`, `assessment_type` (psychometric, technical, case_study, practical), `instructions`, `duration_minutes`, `pass_score`, `active`, `created_by` | 4000; `created_by` added by 4030. `scoring_method` is derived and kept (auto, manual, mixed; `manual` until it has questions). `active` defaults to false: a new assessment is off until it has questions |
| `assessment_question` | `question_type` (choice, text, file), `prompt`, `options` (id, text), `answer_key_enc`, `max_score`, `display_order` | Each option's points are in `answer_key_enc` (encrypted, `aad` the question id), never in `options`, so no read can send them to the public site |
| `application_assessment` | `application_id`, `assessment_definition_id`, `public_token_id`, `status` (sent, in_progress, submitted, timed_out, scored, expired, cancelled), `start_by`, `started_at`, `due_at`, `submitted_at`, `scored_at`, `score`, `current_question`, `sent_by`, `due_days` | A sitting (4030). `started_at`, `start_by`, `current_question`, `sent_by` and `due_days` (an untimed sitting: due this many days after Start, 1 to 14; null for a timed one) added; 4000's `starts_at` stays unused. One live sitting of an assessment per application (cancelled and expired ones do not count) |
| `assessment_response` | `assessment_question_id`, `response` (choice id or text), `document_id` (a file answer), `awarded_score`, `reviewer_comment`, `marked_by`, `marked_at` | Unique per sitting and question |
| `interview_round` | `application_id`, `round_number`, `title`, `status` (open, closed), `closed_at`, `closed_by`, `report`, `decision` (select, on_hold, reject), `reported_by`, `reported_at`, `interview_score`, `current_employer`, `academics` (outstanding, very_good, good, average, poor), `total_experience_months`, `relevant_experience_months`, `form_document_id` | 4040. Round membership is its interview's panel. `interview_score` is the panel's mean score × 10 |
| `interview` | `interview_round_id`, `interview_type` (in_person, video, phone), `scheduled_start`, `scheduled_end`, `worksite_id`, `meeting_url`, `status` (scheduled, done, cancelled), `calendar_event_id`, `created_by` | One a round in M4. `location` text stays unused: in person means a worksite, never a typed address |
| `interview_panelist` | `interview_id`, `employee_id`, `submitted_at` | Unique per interview and person |
| `interview_feedback` | `interview_panelist_id` (unique), `overall_rating` (1 to 10, only when the vacancy has no traits), `decision` (select, on_hold, reject), `comments`, `private_notes`, `cleaned_notes`, `ai_run_id`, `submitted_at` | 4040. `submitted_at` null while a draft; a submitted card has a decision. 4000's `recommendation` column is kept but unused (`decision` is the call), and so is its `scorecard` jsonb |
| `interview_rating` | `interview_feedback_id`, `vacancy_question_id`, `rating` (1 to 10), unique per feedback and question | New in 4040: one rating per panelist per trait (A10 step 1) |
| `talent_pool_entry` | `candidate_id`, `application_id` (the application they came from), `reason`, `added_by`, `expires_at` (24 months on), `invited_at`, `invited_vacancy_id`, `removed_at`, `removed_reason` | New in 4060; one live entry a candidate. 5000 (M5) made `talent_pool` and `talent_pool_member` for named pools; M4 numbers below 5000 and cannot build on them, so they stay unused |
| `talent_pool_invite` | `talent_pool_entry_id`, `vacancy_id`, `invited_by` | New in 4060: each Invite to Apply from the pool, once a pair; Apply reads it to give an application source `pool`, so a member invited to two roles, or removed while their link works, keeps it |
| `setting` | `recruitment.default_traits`: the traits New Vacancy starts from, as a list; `recruitment.about_company`: the About MyCityApp paragraph every public vacancy opens with | Entered on Vacancies · Careers Settings; never seeded on production (A26) |

Schema migration files (4010 to 4060 built 04/11/2026; the review's changes are folded into 4010 to
4040, as none was merged): `migrations/4000_recruitment.sql` (merged), `migrations/4010_recruitment_vacancies.sql`,
`migrations/4020_recruitment_applications.sql`, `migrations/4030_recruitment_assessments.sql`,
`migrations/4040_recruitment_interviews.sql` and `migrations/4060_recruitment_talent_pool.sql`. Reference data: `seeds/reference/4099_seed_recruitment.sql`
(merged: the code lists) and `seeds/reference/4199_seed_recruitment_numbering.sql` (the `application`
numbering scheme, and the stage code `rejected` retired: a candidate not progressed keeps their stage). 4010 to 4060 also add every CHECK the contract's enums need, an index on every foreign
key and every sorted column, `ON DELETE` on each new foreign key, the `updated_at` triggers 4000 left out,
and the two indexes Home asked for (`vacancy (status)`, `application (status, current_stage_entered_at)`).

## 5 · API

Staff routes are `/api/v1/recruitment/...`, public routes `/api/public/v1/...`. Every list pages at 25.
Scope (§8) is the vacancy's `hiring_manager_id`; Interviews add the caller's seat on the panel.

| Method and path | Contract | Permission · scope | Paged | Notes |
|---|---|---|---|---|
| `GET /recruitment/vacancies/summary` | `VacanciesSummary` | `recruitment` view · all/team | no | Open, applicants (every application to an open or paused role, whatever became of it: the list's Applicants summed over those roles), in interview, past closing date; funnel by stage (active applications only); `site_url`, this environment's public site, its index (Careers Page) |
| `GET /recruitment/vacancies` | `VacancyListQuery` → `VacancyPage` | `recruitment` view · all/team | yes | Filters `status`, `department_id`, `q`; sort `closes_at`, `title`, `created_at`, `published_at` |
| `GET /recruitment/vacancies/suggested` | `SeatSuggestionListQuery` → `SeatSuggestionPage` | `recruitment` view · all/team | yes | Vacant seats with no draft, open or paused vacancy, each with its line manager (`line_manager`, null unless they may be a hiring manager, §6.1); `org_seat_id` finds one (the Organogram's Create Vacancy); a team reader sees the seats whose line manager is in their scope |
| `GET /recruitment/vacancies/hiring-managers` | `HiringManagerListQuery` → `HiringManagerPage` | `recruitment` view · all/team | yes | Who may be a vacancy's hiring manager, searched by name: the save's rule (§6.1), the panel's predicate (`interviews.repo` `maySit`) within the reader's scope. New Vacancy's and Edit Vacancy's Hiring Manager picker, and the New Vacancy card's question and Edit |
| `GET /recruitment/vacancies/:id` | `VacancyDetail` | `recruitment` view · all/team | no | With its questions in use (a retired one is left out) and scorecard weights; the description, must have and nice to have both as written (Markdown, for Edit) and as blocks (`*_blocks`, for the sheet) |
| `POST /recruitment/vacancies` | `VacancyCreate` → `VacancyDetail` | `recruitment` create | no | `publish: true` publishes in the same transaction. A seat holds one live vacancy (422 on `org_seat_id`) |
| `PATCH /recruitment/vacancies/:id` | `VacancyEdit` → `VacancyDetail` | `recruitment` edit · all/team | no | A closed vacancy is not edited. An optional field sent empty ("" or null) is cleared; one left out stays. Switching to remote removes the place. The pay band is checked against what is kept |
| `POST /recruitment/vacancies/:id/publish`, `/pause`, `/resume` | `EmptyBody` → `VacancyDetail` | `recruitment` edit · all/team | no | §6.1 |
| `POST /recruitment/vacancies/:id/close` | `VacancyClose` → `VacancyDetail` | `recruitment` edit · all/team | no | Reason: filled, cancelled, on hold; `not_progress` marks everyone still in progress Not Progressing in the same step |
| `PUT /recruitment/vacancies/:id/questions` | `VacancyQuestionsSave` → `VacancyDetail` | `recruitment` edit · all/team | no | Replaces both lists; a question already answered or rated is kept and only retired from the form |
| `PUT /recruitment/vacancies/:id/scorecard` | `ScorecardSave` → `VacancyDetail` | `recruitment` edit · all/team | no | Each part on or off; the weights of the parts on sum to 100 |
| `GET /recruitment/vacancies/settings`, `PUT` | `CareersSettings`, `CareersSettingsSave` | view; edit · all | no | Careers Settings: About MyCityApp and the Default Traits New Vacancy starts its interview card from; `can_edit` says whether the reader may save them (edit · all) |
| `GET /recruitment/vacancies/assist` | `AiAvailability` | `recruitment` edit | no | Whether Write With AI answers now |
| `POST /recruitment/vacancies/assist` | `JdDraftRequest` → `JdDraft` | `recruitment` edit | no | `jd-draft`; nothing kept. With `interview` (New Vacancy's answers, `VacancyInterviewAnswers`) and no `instruction`; then, when the AI cannot write it, the plain draft from the answers with `available: false` (§3 step 2) |
| `POST /recruitment/vacancies/assist/follow-ups` | `FollowUpsRequest` → `FollowUps` | `recruitment` edit | no | `vacancy-follow-ups`: up to two questions about the role with a hint each; none (`available: false`) when the AI is off or fails, never an error; nothing kept |
| `POST /recruitment/vacancies/:id/assist/questions` | `EmptyBody` → `QuestionsDraft` | `recruitment` edit · all/team | no | `screening-questions`; nothing kept |
| `GET /recruitment/candidates/summary` | `CandidateSummaryQuery` → `CandidatesSummary` | `recruitment` view · all/team | no | Filter `vacancy_id` |
| `GET /recruitment/candidates` | `CandidateListQuery` → `CandidatePage` | `recruitment` view · all/team | yes | Filters `stage`, `vacancy_id`, `status`, `q`; sort `weighted_total`, `score`, `applied_at`, `current_stage_entered_at` |
| `GET /recruitment/candidates/:id` | `CandidateDetail` | `recruitment` view · all/team | no | `:id` is the application |
| `GET /recruitment/candidates/:id/cv` | file | `recruitment` view · all/team | no | Streamed by the vault as its own type and name (a Word CV stays `.docx`, also when a screen saves it under a name of its own); 409 while the scan is pending, never once infected |
| `POST /recruitment/candidates/:id/move` | `CandidateMove` → `CandidateDetail` | `recruitment` edit · all/team | no | §6.3 |
| `POST /recruitment/candidates/:id/not-progressed` | `CandidateNotProgressed` → `CandidateDetail` | `recruitment` edit · all/team | no | Reason required; on a closed role too |
| `POST /recruitment/candidates/:id/reopen` | `EmptyBody` → `CandidateDetail` | `recruitment` edit · all/team | no | Back to active, at the stage it left |
| `POST /recruitment/candidates/:id/score` | `EmptyBody` → `CandidateDetail` | `recruitment` edit · all/team | no | `cv-screen`, Deep Reasoning |
| `POST /recruitment/candidates/score-all` | `ScoreAll` → `ScoreAllQueued` | `recruitment` edit · all/team | no | Screen With AI: the one to three must-meet conditions are kept on the vacancy (left out, the kept ones are used again), then every active, unscored application of it is read through the outbox |
| `POST /recruitment/candidates/invitations` | `ApplyInvite` → `ApplyInviteSent` | `recruitment` create | no | Emails an Apply link |
| `GET /recruitment/candidates/emails` | `CandidateEmailListQuery` → `CandidateEmailPage` | `recruitment` view | yes | The eight candidate emails (M4's five, M5's three), each with its current version and `can_edit` (edit · all) |
| `GET /recruitment/candidates/emails/:key`, `PUT .../:key` | `CandidateEmailParams`; `CandidateEmail`, `CandidateEmailSave` | view; edit · all | no | Subject and Markdown body saved as the next version, checked against the email's variables. Saved only with edit over every vacancy (scope all), as each goes to every candidate |
| `POST /recruitment/candidates/emails/:key/restore` | `EmptyBody` → `CandidateEmail` | `recruitment` edit · all | no | Restore Default: the shipped wording saved as the next version |
| `GET /recruitment/assessments/summary` | `AssessmentsSummary` | `recruitment` view · all/team | no | |
| `GET /recruitment/assessments` | `AssessmentListQuery` → `AssessmentPage` | `recruitment` view | yes | Filters `type`, `active`, `q` |
| `GET /recruitment/assessments/:id` | `AssessmentDetail` | `recruitment` view | no | Questions with their points |
| `POST /recruitment/assessments`, `PATCH /:id` | `AssessmentCreate`, `AssessmentEdit` → `AssessmentDetail` | create; edit | no | |
| `PUT /recruitment/assessments/:id/questions` | `AssessmentQuestionsSave` → `AssessmentDetail` | `recruitment` edit | no | Refused once it has been sent (409 `ASSESSMENT_IN_USE`) |
| `POST /recruitment/assessments/:id/activate`, `/deactivate` | `EmptyBody` → `AssessmentDetail` | `recruitment` edit | no | Activate needs at least one question |
| `POST /recruitment/assessments/assist` | `AssessmentDraftRequest` → `AssessmentDraft` | `recruitment` edit | no | `assessment-questions`; nothing kept |
| `GET /recruitment/assessments/:id/export` | `AssessmentExport` | `recruitment` export | no | One assessment and its questions with points, as a file |
| `POST /recruitment/assessments/import` | `AssessmentExport` → `AssessmentDetail` | `recruitment` create | no | A new, inactive assessment from such a file |
| `POST /recruitment/assessments/import/file` | `AssessmentImportFile` → `AssessmentDetail` | `recruitment` create | no | Import on screen: the export file uploaded first (`POST /documents`, purpose `assessment_import`, JSON up to 1 MB; a file that parses as JSON is never refused as markup for words such as `<script` in a question), read back from the vault by who uploaded it and checked as `AssessmentExport`. Sent by **Import Assessment** once the file has arrived, one press one request |
| `GET /recruitment/assessments/sittings` | `SittingListQuery` → `SittingPage` | `recruitment` view · all/team | yes | Filters `status`, `application_id`, `marking` |
| `GET /recruitment/assessments/sittings/:id` | `SittingDetail` | `recruitment` view · all/team | no | Answers, with points |
| `POST /recruitment/assessments/sittings` | `SittingSend` → `SittingDetail` | `recruitment` edit · all/team | no | §6.7 |
| `POST /recruitment/assessments/sittings/bulk` | `SittingSendBulk` → `SittingSendBulkResult` | `recruitment` edit · all/team | no | Send to Candidates: every active candidate of one vacancy at one stage with no live sitting of it |
| `PUT /recruitment/assessments/sittings/:id/marks` | `SittingMarks` → `SittingDetail` | `recruitment` edit · all/team | no | Written and file answers |
| `POST /recruitment/assessments/sittings/:id/cancel` | `EmptyBody` → `SittingDetail` | `recruitment` edit · all/team | no | Before it is submitted |
| `GET /recruitment/interviews` | `InterviewListQuery` → `InterviewPage` | `recruitment` view · all/team/panel | yes | Filters `when` (upcoming, past), `status`, `mine`, `application_id`, `q`; with no `sort`, those still to end first (soonest first), then those past (latest first) |
| `GET /recruitment/interviews/:id` | `InterviewDetail` | `recruitment` view · all/team/panel | no | Blind while open (§6.6); the candidate's `scorecard` and `weighted_total` for a reader whose scope holds the vacancy (null for a seat alone); `activity`, the interview's events newest first, the latest 25 |
| `POST /recruitment/interviews` | `InterviewSchedule` → `InterviewDetail` | `recruitment` edit · all/team | no | |
| `PATCH /recruitment/interviews/:id` | `InterviewReschedule` → `InterviewDetail` | `recruitment` edit · all/team | no | New time, place or panel; invites resent; a panel left with only submitted seats closes the round as the last card would (§6.6) |
| `POST /recruitment/interviews/:id/cancel` | `InterviewCancel` → `InterviewDetail` | `recruitment` edit · all/team | no | |
| `PUT /recruitment/interviews/:id/feedback` | `FeedbackSave` → `InterviewDetail` | `recruitment` view · panel | no | The caller's own draft |
| `POST /recruitment/interviews/:id/feedback/submit` | `EmptyBody` → `InterviewDetail` | `recruitment` view · panel | no | Locks it; the last one closes the round once the interview has started (§6.6) |
| `POST /recruitment/interviews/:id/close` | `EmptyBody` → `InterviewDetail` | `recruitment` edit · all/team | no | |
| `PUT /recruitment/interviews/:id/details` | `RoundDetailsSave` → `InterviewDetail` | `recruitment` edit · all/team | no | Candidate Details on the card, before or during the round; a field sent empty is cleared |
| `PUT /recruitment/interviews/:id/report` | `RoundReport` → `InterviewDetail` | `recruitment` edit · all/team, or the hiring manager | no | Closed rounds only; generates the form PDF |
| `GET /recruitment/interviews/:id/cv` | file | `recruitment` view · panel or scope | no | The candidate's CV, for the panel |
| `GET /recruitment/interviews/panelists` | `PanelistListQuery` → `PanelistPage` | `recruitment` edit | yes | Who may sit on a panel (§6.6), searched by name (`q`); the panel picker |
| `GET /recruitment/interviews/assist` | `AiAvailability` | `recruitment` view | no | Whether Tidy With AI may answer now; read by My Card |
| `POST /recruitment/interviews/assist` | `NotesTidyRequest` → `NotesTidy` | `recruitment` view · a panelist with a card still to write | no | `interview-notes-cleanup`; nothing kept; anyone else 403 `NOT_PANELIST` |
| `GET /recruitment/pool/summary` | `PoolSummary` | `recruitment` view · all/team | no | In the pool, invited back, hired from the pool, average score |
| `GET /recruitment/pool` | `PoolListQuery` → `PoolPage` | `recruitment` view · all/team | yes | Filters `q`, `invited`; sort `created_at`, `score`, `expires_at` |
| `GET /recruitment/pool/:id` | `IdParams` → `PoolEntry` | `recruitment` view · all/team | no | One person, for a link to someone past the list's first page |
| `POST /recruitment/pool` | `PoolAdd` → `PoolEntry` | `recruitment` create · all/team | no | From an application, with a reason |
| `POST /recruitment/pool/:id/invite` | `PoolInvite` → `PoolEntry` | `recruitment` edit · all/team | no | An Apply link to an open vacancy |
| `POST /recruitment/pool/:id/remove` | `PoolRemove` → `PoolEntry` | `recruitment` delete · all/team | no | Taken off the pool before their time |
| `POST /recruitment/pool/exports` | `PoolExportRequest` → `ExportFile` (202) | `recruitment` export · all/team | no | The whole filtered pool as a workbook, made in the worker, downloaded on the device that pressed Export |
| `GET /api/public/v1/jobs` | `PublicJobListQuery` → `PublicJobPage` | public | yes | `open` and not past its closing time; closing soonest first; filters `q`, `department` (a department's code) (§6.1) |
| `GET /api/public/v1/jobs/summary` | `PublicJobsSummary` | public | no | The index's figures: open, departments hiring, cities, the three closing soonest, About MyCityApp (§6.1) |
| `GET /api/public/v1/jobs/:slug` | `PublicJob` | public | no | Draft is 404; paused and closed say so; an open role past its closing time reads closed. Names how many have applied (`applicants`). No About MyCityApp: that is the index's (`/jobs/summary`) |
| `POST /api/public/v1/jobs/:slug/apply` | `EmptyBody` → `ApplyStarted` | public, rate limited | no | Mints the Apply token |
| `GET /api/public/v1/apply/:token` | `ApplyLink` | `application.apply` token | no | The role (title, department, place), its questions, when the link lapses |
| `POST /api/public/v1/apply/:token/cv` | multipart → `DocumentRef` | `application.apply` token | no | Purpose `cv` (PDF or Word, 10 MB), quarantined and kept against the link until the application is made (`vault.adopt`) |
| `POST /api/public/v1/apply/:token` | `ApplicationSubmit` → `ApplicationReceipt` | `application.apply` token, spent | no | Write only |
| `GET /api/public/v1/assess/:token` | `AssessmentSession` | `assessment.take` token | no | `ends_at` and `server_now` for the timer |
| `POST /api/public/v1/assess/:token/start` | `EmptyBody` → `AssessmentSession` | `assessment.take` token | no | |
| `PUT /api/public/v1/assess/:token/answers/:question_id` | `AnswerSave` → `AnswerSaved` | `assessment.take` token | no | 409 `TIME_UP` after `due_at` |
| `POST /api/public/v1/assess/:token/answers/:question_id/file` | multipart → `AnswerFileSaved` (the stored file, as a CV upload answers, and `saved_at`) | `assessment.take` token | no | Purpose `assessment_answer`, at most 25 MB, quarantined; a larger file is a link given as the answer |
| `POST /api/public/v1/assess/:token/submit` | `EmptyBody` → `AssessmentSession` | `assessment.take` token | no | |

## 6 · Rules and calculations

### 6.1 Vacancies

- The lifecycle is draft → open ⇄ paused → closed; draft and paused may also close. Publish needs a
  title, department, hiring manager, location (unless remote), description of at least 80 characters,
  requirements of at least 20 and a closing time in the future. Resuming a paused vacancy whose closing
  day has passed is refused on Closes On ("Its closing day has passed"): pick a new day, then resume.
- Close Vacancy takes a reason (filled, cancelled, on hold) and, while anyone is still in progress,
  offers to mark them all Not Progressing in the same step (`not_progress`), each sent
  `candidate-not-progressed` (GE, 05/11/2026). In progress means active at an M4 stage: someone at
  Offer or after is M5's (an offer out, a hire on its way), is not counted in `in_progress` and is left
  as they stand (GE, 06/11/2026).
- A hire (`vacancies.hiredIn`, called by `candidates.hireIn` when M5's onboarding completes; #79,
  06/11/2026, Q-TB8): the vacancy's Organogram seat (`org_seat_id`), when it has one still open, is
  filled by the new employee through `organisation.fillSeat` (`organogram.md` §6), so a vacancy for
  several openings fills its one seat with its first hire. Once as many applications are hired as it
  has openings (`positions`), the vacancy closes as filled through its own lifecycle move
  (`vacancy.closed`, close reason filled, a history row "Every opening is filled"). Anyone still in
  progress stays on the board, as Close Vacancy left unticked leaves them. Left unticked, they stay on the board and can still be
  marked Not Progressing one by one (§6.3).
- A remote vacancy has no place: switching one to remote removes it. The hiring manager must be an
  active employee in the writer's scope who holds `recruitment` view through an active login (or is
  the CEO), as a panelist must (decision 5): their notices open Recruitment's screens ("No Recruitment
  access" otherwise; GE, 05/11/2026). The Hiring Manager picker offers only those people
  (`GET /vacancies/hiring-managers`), and a seat's line manager is filled in only when they are one,
  so the save's refusal is met only by a call that bypasses the screen (fault #3 of the 11/11 brief). A vacant seat holds one live (draft, open or paused) vacancy.
- The slug is made once, at first publish, from the title and the location's city
  (`content-producer-lagos`), with `-2`, `-3` on a clash, made while holding a lock on that base so two
  roles published at once cannot take the same one. It never changes: pausing, resuming and
  editing keep the same link (MILESTONES §9; GE 04/11/2026, the slug replaces the token for listed
  roles). A draft has a slug only once published.
- `/jobs` lists vacancies that are `open` and whose `closes_at` is later than now, closing soonest
  first (`closes_at` ascending, a role with no closing date after every dated one, then the newest
  published), 25 a page. `q` searches the title, department and place; `department` (a department's
  `code`, as the summary and each card give it) narrows to one department, with `q` or without; an
  unknown code is an empty page, never a 422. Each card carries what the list shows: department and its
  code, title, place, arrangement with its note, employment type and closing time (GE, 06/11/2026, the
  approved public site design). `/jobs/<slug>` answers
  an open, paused or closed vacancy with its `state`; a draft, or a slug that never existed, is the same
  404. A closed vacancy says it is closed; one closed as filled says it was filled; an open one past its
  closing time reads closed.
- `/jobs/summary` holds the public index's figures over the same roles `/jobs` lists: how many are open,
  the departments hiring (code, name, how many each, by name), the cities (the city of each role's
  picked place, most roles first; a remote role has none), the three roles first on `/jobs` (closing
  soonest) and About MyCityApp as blocks. It is a summary, not a list: the departments and cities are the
  organisation's few, read whole and grouped in SQL, and the three are the head of the careers list's
  first page, so nothing pages and no size is asked (GE, 06/11/2026). The slug `summary` is never made:
  a role that would take it is `summary-role`.
- `closes_at` is picked as a day and stored as the end of that day in Lagos (23:59:59). Past it, the
  vacancy stays `open` on the staff screens with a Closing Date Passed chip and takes no new applications.
- The salary band is shown publicly only when `salary_visible`; otherwise the public shape omits both
  numbers (an omission, not a null).
- A vacancy follows MyCity's job description (Head, Sales & Revenue, shared 04/11/2026): department,
  reports to, location, employment type with its arrangement ("Hybrid, 2 days in office, 3 from
  home": `work_pattern` with `work_pattern_note`), working days (`working_days`, "Monday to
  Saturday"), About MyCityApp (the company paragraph from Careers Settings, the same on every role),
  then the role's own description in Markdown: role overview, key responsibilities as numbered
  sections, how the role is measured (`## Key Performance Indicators (KPIs)`); then Required Experience and Qualifications
  (`requirements`) and What We Are Looking For (`nice_to_have`). `min_experience_years` is the "8+
  years" of the requirements. Write With AI (`jd-draft`) drafts in that shape from the About MyCityApp
  text it is given (never a description of the company of its own); with words already typed in the
  description, requirements or nice to have, it asks before replacing them (Replace Your Text; GE,
  05/11/2026), and the public page
  draws it from blocks: the server turns each Markdown text (About MyCityApp, the description, must have,
  nice to have) into blocks with the one safe renderer (`shared/documents/markdown`, `markdownToBlocks`),
  as a policy's text is, and the page draws them with `RichText` (GE · (Ose), 05/11/2026). About MyCityApp reaches the
  public site only on the index, through `/jobs/summary`; `PublicJob` no longer carries it (the approved design,
  06/11/2026). On Vacancy a description's `## Key Performance Indicators (KPIs)` heading starts a part of its own,
  its list drawn as tiles, and What We Are Looking For opens on its first sentence, large. The staff
  sheet draws the same blocks (`VacancyDetail.description_blocks`, `requirements_blocks`,
  `nice_to_have_blocks`), never the raw Markdown; the Markdown itself still comes for Edit (GE, 06/11/2026).
- New Vacancy's interview (§3 step 2) keeps nothing: its answers live in the browser until the editor
  saves. Only the role is required; an answer given is checked as it is filled (VacancyEdit's rules),
  one skipped is not, and the editor then asks for what Publish needs (department, hiring manager,
  location unless remote, description and requirements). The answers that are not a field of the
  vacancy (the must-haves, anything else, the follow-ups and theirs, and the location's name as
  `area`) go only to the model, and the plain draft is built from them: the must-haves also open the
  editor's requirements and the anything else its nice to have when there is no draft (Use Blank Form).
  A seat starts the interview with its title, department, hiring manager and reports to answered.
- **Applicants** is one count everywhere: every application to a role, whatever became of it. The list's
  column counts a role's; the Applicants tile sums it over the open and paused roles. The funnel and a
  role's Candidates by Stage count only those still in progress (GE, 06/11/2026).
- A new vacancy gets the five scorecard rows at 15, 15, 25, 20, 25, all on, and its interview traits
  from the Default Traits. Each part is switched on or off for the role (TB, 04/11/2026); a part switched
  off has weight 0, and the weights of the parts on are whole numbers summing to 100. At least
  screening or interview is on. Weights are whole numbers sent as numbers; an empty weight is refused,
  never read as 0.
- Careers Settings shape every vacancy, so saving them needs `recruitment` edit over every vacancy
  (scope all); a hiring manager reads them.

### 6.2 Applying

- The Apply token is single use, lives 48 hours (7 days when staff invite), and is spent in the same
  transaction as the application. The link names the role as the form's pane shows it: title,
  department and place (`ApplyLink`). `POST /jobs/:slug/apply` is refused (the same 404) unless the vacancy
  takes applications now. It is held to the public surface's write limit per address.
- The CV is a PDF or Word file of at most 10 MB, sent by the stranger and so quarantined until ClamAV
  passes it. It belongs to the token's vacancy; a CV uploaded on another token is refused.
- The candidate is found by email (case-insensitive) or created. A stranger's form never renames a
  person already known; it only fills a missing phone. A second application by the same email to the same vacancy does not
  create anything: it spends the link and answers the first application's reference and date with
  `already_applied`, and Apply says You Have Already Applied instead of Application Sent (GE,
  08/11/2026: the applicant needs to know rather than see a second success; it replaces 05/11/2026's
  answer that looked like any other). Anyone typing that email learns only that it has applied for
  this role: no stage, no score.
- A CV sent on an Apply link that ends without an application (it lapsed, was revoked, or a second
  application from the same email spent it) is removed a day later by `apply-cv-purge` (§7; GE,
  05/11/2026): nothing a stranger sends is kept without an application.
- The answer is an acknowledgement and a reference (`APP-0001`), never the row: no score, no stage.
- The privacy notice must be accepted (`consented_at`); an application without it is refused.

### 6.3 The pipeline

- Stages in M4: `application`, `screening`, `assessment`, `interview`, `shortlist`. A card moves to any
  stage ahead of it or one back. The board leaves out Assessment when none of the vacancy's three
  assessment parts is on, and Interview when the interview part is off.
- Offer and the stages after it are M5's (#79, 06/11/2026): `offer` (an offer sent), `documentation`
  (accepted), `pre_onboarding` (the checklist done), `onboarding` (the start date), `hired` (onboarding
  complete; status `hired` too). Nobody moves a card into or out of them by hand: the move route takes
  only the M4 stages, and a card at Offer or after has no `next_stages`. M5 moves them inside its own
  transaction through this module's service, so the stage, its history row and `application.moved`
  stay here (one write path):
  - `advanceIn(client, actor, id, stage)`: forward only, an active application only; among the M4
    stages into a column of its board (Send Assessment, Schedule Interview), and from Shortlist on the
    next stage only (Shortlist to Offer, Offer to Documentation, and so on). Anything else leaves it
    where it is and answers false, so M5 checks the answer. It never sets Hired.
  - `offerEndedIn(client, actor, id, reason)`: an offer declined, lapsed or withdrawn takes the card
    from Offer back to Shortlist with the reason, so another offer can be made.
  - `correctEmailIn(client, actor, id, email)`: M5's Change Email on a sent offer whose mail was
    refused: the person's address on every application of theirs, recorded as
    `application.email_corrected`; an address another candidate holds is a 409 (`EMAIL_TAKEN`).
  - `hireIn(client, actor, id, { employee_id })`: from Onboarding only (409 otherwise), the stage and
    status `hired`, `application.hired`, then `vacancies.hiredIn` (§6.1). The employee is the one M5
    created at acceptance; the application does not keep it (M5's `onboarding_case` does).
- The board's columns (`VacancyDetail.board_stages`) are the hand-moved stages and then Offer. The
  staff app shows Offer once M5's Offers screen opens in its build (the delivery plan, F14), so it is
  never an empty column before M5. Documentation to Onboarding are the Onboarding screen's. A hired
  application leaves the board: the board asks for one status at a time, In Progress (`active`) first.
- Not Progressing works from any stage before Hired, and Reopen returns the card to where it stopped.
- Not Progressing works at any stage and on a closed role too, so the people left in a closed role can
  be told (`can_not_progress` on the sheet; GE, 05/11/2026); moves, Reopen and Score With AI still need
  the role not closed. It sets `status` `not_progressed` with a reason of at least 10 characters, records the
  move in history (the stage stays where it was), revokes the links made for the application and its
  sittings (an Apply link belongs to a vacancy, and to nobody until it is used) and emails
  `candidate-not-progressed`. The interviews module cancels the application's scheduled interviews
  from the same event (`application.not_progressed`), sending each panelist and the candidate the
  `.ics` cancel (P6). It is undone with Reopen, back to the stage it left.
- Every move writes one `entity_state_history` row (`shared/state/state-history`) and sets
  `current_stage_entered_at`. Days at stage is whole days since then, in Lagos.

### 6.4 Screening, two tiers (REUSE_MAP §5.1)

- **The estimate** is arithmetic, free and immediate, computed at submit and stored as
  `provisional_score` (0 to 100): the mean of the parts that had something to say, a part with nothing
  to say being left out, never scored as zero:
  - experience: years against the vacancy's minimum, capped at 100, proportional below it; no minimum
    means 100 for any experience;
  - completeness: a third each for a CV, a portfolio or link answer, and a "why this role" of more
    than 40 characters;
  - required answers: the share of the vacancy's required yes or no questions answered yes.
- **The AI read** (`cv-screen`, Deep Reasoning, CV and role, personal data so never DeepSeek) runs only
  when a person presses Score With AI or Screen With AI (GE, 04/11/2026; "a good model, not a very
  high one", TB). It reads the CV's text (PDF text through PDF.js; a Word file or a scan without text is
  scored without it, and the summary says so), the cover letter, the role, the must haves, the
  candidate's answers and the vacancy's must-meet conditions (one to three, each at most 200
  characters, set when Screen With AI is pressed and kept for later reads; pressed again with none
  given, the kept ones are used; a condition that names a protected trait, such as an age, a sex, a
  marital status, a religion, a tribe or a state of origin, is refused with 422 before it is kept, and
  one that slips past is not applied by the model), and returns a score
  from 0 to 100 and a summary that says which conditions are met and what it could not verify. Contact details are shielded before the call (`redact.shield`).
  It writes `screening_score`, `screening_summary`, `screening_ai_run_id` and `screened_at`.
- **The fairness check** on a must-meet condition (`vacancies.service` `traitsNamed`) reads it folded
  (case, accents, dashes, dots) for sex ("Ladies only", "Male candidates"), age ("Must be under 30",
  "25-35", "Young"; a number of years of experience is not an age), ethnicity or tribe ("Igbo only", "a
  native Yoruba speaker"; a language as a skill, "Speaks Yoruba", "Fluent in English", passes),
  religion, marriage, children and pregnancy, disability and health (genotype), state or LGA of origin
  ("Indigene of Lagos State"; where someone lives, "Lives in Lagos", passes), nationality and
  appearance. Each refused condition is named on its own line: "Not a fair condition" (GE, 06/11/2026).
- The screening score shown is `screening_score` when there is one, otherwise `provisional_score`
  with `screening_provisional: true`. **Every surface that shows a screening score shows Provisional
  beside it while it is the estimate.**
- Neither score moves, rejects or filters anyone.

### 6.5 The weighted scorecard (A10)

- Components and their scores, each 0 to 100:
  - screening: the screening score above (the estimate counts, flagged);
  - psychometric, technical, case study: the latest scored sitting of that assessment type for the
    application; a `practical` assessment counts as technical;
  - interview: the mean of the closed rounds' `interview_score` (§6.6).
- Only the parts switched on for the vacancy count. Weighted total = Σ(weight × score) ÷ Σ(weight of
  the parts on that have a score), rounded to one decimal; null when none has a score. The card shows
  "n of m parts" beside it, m the parts on.
- Weights are the vacancy's. Changing them changes every total at once; nothing is stored per
  application, so the ranking is always the current weights.

### 6.6 Blind panels (A10, MILESTONES §9)

- A panelist is an employee who holds `recruitment` view. Only those people are offered on the panel
  picker (`GET /interviews/panelists`, one predicate with the check on a save, `interviews.repo.js`
  `MAY_SIT`), and the API refuses anyone else: 422 `NOT_PANELISTS`, "Not all hold Recruitment" on
  `panel_employee_ids`, and a message naming who ("Tunde Ade does not hold Recruitment"; past three
  names, "and n others") that the form shows on its error line.
- **While the round is open, a feedback row is readable only by the person who wrote it.** The hiring
  manager, Operations & People and the CEO included. Everyone else sees who has submitted and who has
  not, never a rating. This is one predicate on the read (`f.submitted_at IS NOT NULL AND r.status =
  'closed'` or the author), applied in the repo, in the AI read and in search alike.
- Private notes are readable only by their author, always, even after the round closes.
- **The card** is MyCity's Interview Assessment Format (TB, 04/11/2026; the form itself shared the same
  day). Each panelist rates every active trait of the vacancy from 1 to 10 and gives a decision
  (Select, On Hold, Reject); comments are the form's item 11, Others, and optional. Date, name, position
  applied for and function (the vacancy's department) come from the records; the interviewer's name
  and signature on the form is the panelist who submitted the card. A vacancy with no traits asks for one overall rating from 1 to 10 instead. Submit needs
  every trait rated and a decision.
- A panelist's score is the mean of their trait ratings (or their overall rating). The round's
  `interview_score` = the mean of its submitted panelists' scores × 10, one decimal, set when it closes.
  Each trait's average across the panel is shown beside it once closed.
- Candidate Details (current employer, academics, total and relevant experience in months) are filled
  once by `recruitment` edit, not by each panelist, and are not blind.
- Round Activity is the interview's own events (`event_log`, newest first, the latest 25): scheduled,
  changed, cancelled, Candidate Details saved, each card submitted (who, never what), each reminder (to
  whom; a run twice in a day logs it twice but sends it once, so the first is shown), the close and the
  report. The candidate's Weighted Scorecard (§6.5) shows beside the panel only to a reader whose scope
  holds the vacancy; a seat alone shows the card, the CV and the Candidate Details, not the candidate's
  other scores.
- Panelists may open the candidate's CV from the card (the vault's check passes for a seat on the
  panel).
- The round closes by itself once every seat on the panel has submitted **and the interview has
  started**, the same line Close Round holds (`NOT_STARTED` before the start): at the last Submit Card,
  at a Reschedule that takes off the only seats still waiting, or, for a panel complete before the
  start, at the daily sweep after it (`interview-reminders`, `consolidate.closeStarted`). Before the
  start a full round stays open. Close Round (`recruitment` edit) closes it with the cards that are in.
  A closed round does not reopen; a card cannot be changed after Submit.
- Tidy With AI is any panelist's with a card still to write, whatever their grant (`recruitment` view,
  as for the card); an edit grant alone does not reach it.
- The consolidated report (at least 40 characters, with the decision) is written once the round is
  closed, by the hiring manager or someone with `recruitment` edit, and can be edited by them. Each save
  regenerates the Interview Assessment Form (`interview-assessment-form`, `documents.generate`): the
  candidate details, every trait with each panelist's rating and the average, each decision, the total
  and the report.
- A panelist does not sit on a panel about themselves, and the candidate cannot be an employee on the
  panel (an internal applicant's email matches an employee's work email).

### 6.7 Assessments

- Question types: choice (scored by the points of the option picked; options may each carry points,
  which covers right or wrong and psychometric scales), text (marked by hand) and file (a spreadsheet,
  PDF, Word file, image or short video uploaded up to 25 MB, the system's limit, or a https link to
  anything larger, such as a Google Drive file or a portfolio; marked by hand; GE, 04/11/2026). A question's `max_score` is the most any answer can
  get; for a choice, its highest option. (GE, 04/11/2026.)
- An assessment needs at least one question to be activated and to be sent. Its questions cannot be
  changed once it has been sent to anyone; deactivate it and make another.
- Send: the candidate gets one sitting of an assessment per application. Before Start the link
  lives until the start-by day (1 to 14 days, default 3) at 23:59 Lagos; once started it lives until a
  day past the sitting's `due_at`, so a test started at 23:30 on its start-by day, or a brief due days later,
  keeps its link (GE · (Ose), 04/11/2026), and a save or a visit after the time ran out reaches the
  sitting and reads Time Up (`TIME_UP`) rather than a dead link (GE, 05/11/2026). Cancelling or
  expiring the sitting spends it. Marks and option points are numbers; an empty
  one is refused, never read as 0. Send to Candidates sends one assessment to
  every active candidate of a vacancy at a stage (default Assessment) without a live sitting of it, and
  says how many were sent and how many already had one.
- Assessments researched by JBS Praxis for MyCity to approve are loaded on staging only. One MyCity
  approves reaches production by Export on staging and Import on production (one JSON file,
  `AssessmentExport`, checked against the contract on the way in), so production is never seeded (A26;
  GE, 04/11/2026).
- An assessment is **timed** (a test, `duration_minutes` 5 to 240) or **untimed** (a take-home brief with
  no minutes: MyCity's Graphics and Motion Design assessment, two deliverables and a short note, shared
  04/11/2026; Edit clears the minutes to make one untimed). An untimed sitting is due at 23:59 Lagos on a day staff pick when sending (1 to 14 days
  after Start, default 5; `due_days`), shows that day instead of a clock, and is ended by Submit or by that day.
- Start sets `started_at` = now and `due_at` = now + `duration_minutes` (or the due day for an untimed one). The clock is the server's: the
  session returns `ends_at` and `server_now`, and an answer after `due_at` is refused with `TIME_UP`,
  also once the sitting has already been ended by its clock. A sitting that ended at or after `due_at`
  reads `timed_out` on its page, though it was scored at once.
  Reopening the link resumes at `current_question` with the time left.
- Submit, or `assessment-expiry` within a minute of `due_at`, ends the sitting (`submitted` or
  `timed_out`); answers saved stand. A sitting never started by its start-by day becomes `expired`.
- Score = Σ awarded ÷ Σ `max_score` × 100, one decimal, once every answer has a mark; an unanswered
  question scores zero. All choice questions: scored at submit. Otherwise the sitting waits for Mark
  Answers.
- The candidate never sees a score, a key or an option's points.

### 6.8 Mail to candidates

Five candidate emails, each a shipped default in `templates/email/` that Operations & People can edit
on Vacancies · Candidate Emails (saved as versions in `template_version`, Markdown only). The shipped
defaults are themselves Markdown (front matter `format: markdown`), so an edit starts from the exact
shipped words and Restore Default saves them back unchanged; a link is a Markdown link, never a styled
button (GE · (Ose), 04/11/2026). The emails:
`application-received`, `apply-invite`, `assessment-invite`, `interview-invite` (with the `.ics`), and
`candidate-not-progressed`. M5's three are kept in the same store, so the one screen words all eight
(#79, 06/11/2026): `offer-sent` (the offer's number, its signing link and when it lapses),
`offer-signed` (the number, the Verify link, the first day when set) and `onboarding-documents` (the
documents link and the day they are due by, when set). This module ships their wording and declares
their variables (`OfferSentEmailVars`, `OfferSignedEmailVars`, `OnboardingDocumentsEmailVars`); M5 sends
them. They go through system mail from the outbox, paced like all system mail;
while mail is paused they wait. Staging sends real mail marked `[STAGING]` (A4); its seed applies only
with test addresses.

### 6.9 The Talent Pool

- Add to Pool takes an application (any status) and a reason of at least 5 characters. A candidate is in
  the pool once at a time; adding them again updates the reason and the 24 months.
- A member is kept until `expires_at`, 24 months from when they were added; `talent-pool-purge` (daily)
  sets `removed_at` on those past it. Remove does the same early. Removed members are not listed.
- Invite to Apply sends an `apply-invite` for an open vacancy and stamps `invited_at` and the vacancy; the
  application it leads to has source `pool`. Hired From the Pool counts members still in the pool with a later
  application of source `pool` at stage hired; someone removed or past their 24 months leaves the figure
  with them.
- The score shown is the screening score of the application they were added from, with Provisional when
  it is the estimate.
- A vacancy outside the reader's scope is never named: `invited_vacancy` (and `applied_for`) is null when
  its hiring manager is outside it, in the list, one person's sheet and the export (the row still shows
  Invited and when). A reader with `all` sees every title (GE, 05/11/2026).

## 7 · Events, jobs and notifications

| Event / job | When | Does |
|---|---|---|
| `vacancy.created`, `vacancy.updated` | after save | audit |
| `vacancy.published`, `vacancy.paused`, `vacancy.resumed`, `vacancy.closed` | after the move | audit; Home's card refreshes |
| `vacancy.questions_saved`, `vacancy.scorecard_saved` | after Questions or Scorecard is saved | audit |
| `recruitment.careers_settings_saved` | after Careers Settings is saved | audit |
| `application.received` | after an application commits | outbox: `application-received` to the candidate; notice to the hiring manager (New Application) |
| `application.invited` | after Invite to Apply | outbox: `apply-invite` |
| `application.moved` | after a move | audit; the card refreshes |
| `application.not_progressed` | after Not Progressing | outbox: `candidate-not-progressed`; the interviews module calls off the application's interviews still to come, with the `.ics` cancel (one that has taken place is left for its panel) |
| `application.score_requested` | Screen With AI, one per application | outbox: the AI read (§6.4), one at a time |
| `application.scored` | after an AI read is kept | audit |
| `application.reopened` | after Reopen | audit; the card refreshes |
| `application.hired` | `candidates.hireIn`, when M5's onboarding completes | audit; the vacancy's seat is filled and the vacancy closes as filled in the same transaction (§6.1), with `org_seat.filled` (`organogram.md` §7) and `vacancy.closed` |
| `application.email_corrected` | `candidates.correctEmailIn`, an offer's Change Email (M5) | audit |
| `recruitment.candidate_email_saved` | a candidate email reworded, or its default restored | audit |
| `assessment.sent` | after Send | outbox: `assessment-invite` |
| `assessment.submitted`, `assessment.timed_out` | at the end of a sitting | auto-scoring: scored at once when nothing waits for a mark (an unanswered question counts zero) |
| `assessment.to_mark` | a finished sitting has written or file answers to mark | notice to the vacancy's hiring manager, by application number, never the candidate's name |
| `assessment.created`, `.updated`, `.questions_saved`, `.activated`, `.deactivated`, `.imported`, `.started`, `.expired`, `.cancelled`, `.marked` | after the write | audit |
| `assessment.scored` | when the last mark is given | audit; scorecard refreshes |
| `interview.scheduled`, `interview.rescheduled`, `interview.cancelled` | after save | outbox: the calendar entry and its invites to panelists; `interview-invite` with `.ics` to the candidate (a cancel sends the `.ics` cancel; a change of panel alone sends the candidate nothing); reminders scheduled or cancelled |
| `interview.feedback_submitted` | after Submit Card | audit |
| `interview.round_closed` | the last submit, or Close Round | notice to the vacancy's hiring manager (Round Closed, by application number, never the candidate's name; nobody is told of their own close) |
| `interview.details_saved` | after Candidate Details are saved | audit; a closed round's form is made again |
| `interview.reported` | after the report is saved | audit; the Interview Assessment Form PDF is made in the same save (`documents.generate`) |
| `talent_pool.added`, `talent_pool.renewed`, `talent_pool.invited`, `talent_pool.removed`, `talent_pool.expired`, `talent_pool.export_requested` | after the write | audit; `apply-invite` on invite; the workbook made in the worker on export |
| `talent-pool-purge` (scheduler, daily) | always | removes members past their 24 months |
| `apply-cv-purge` (scheduler, nightly at 02:47 Lagos) | a day after an Apply link ended without an application | removes the CV still held by the link (vault row with `document.removed`, then the file; GE, 05/11/2026) |
| `assessment-expiry` (scheduler, every minute) | always | ends sittings past `due_at`; expires unstarted sittings past `start_by` |
| `interview-reminders` (scheduler, daily at 09:17 Lagos) | from the interview's end | reminds each panelist who has not submitted, once a day, until the round closes (`interview.feedback_due`, naming the application and role, never the candidate) |

## 8 · Permissions and visibility by role

| Role | Sees | Can do |
|---|---|---|
| Operations & People | every vacancy, candidate, sitting and interview (`all`) | everything here, including Close Round, the report and Candidate Emails |
| Management | everything (`all`) | everything except delete (their grant has no delete) |
| CEO | everything | everything |
| Head of Department | vacancies whose hiring manager is in their team, those vacancies' candidates, sittings and interviews, and any interview they sit on (`team` plus panel) | create and edit vacancies and candidates in their scope, sit on panels |
| Implementation | everything (`all`) | everything |
| Staff without `recruitment` | nothing in Recruitment | cannot be put on a panel (§6.6) |
| A panelist | the interviews they sit on, even outside their scope, with the candidate's CV and details; their own card and private notes; others' cards only once the round closes | save and submit their own card |
| A candidate (public site) | the role, their Apply form, their assessment | apply once per role, take the assessment once |

No restricted fields: candidates' details are personal data, kept to people with `recruitment` view,
and sent to the AI only through `redact.shield` and never to DeepSeek. Capabilities: none.

## 9 · AI and search

- **Feature AI** (`src/services/ai/actions.js`, chosen by GE 04/11/2026):
  - `jd-draft`, Write With AI on New Vacancy, and its draft at the end of the interview: Default.
  - `vacancy-follow-ups`, New Vacancy's two follow-up questions about the role: Default, as `jd-draft`
    (GE, 06/11/2026). A question naming a protected trait or a person's health is dropped before it
    is shown (`vacancies.draft.js` `fairQuestion`).
  - `screening-questions`, Suggest With AI on a vacancy's questions: Default.
  - `cv-screen`, Score With AI: Deep Reasoning (`ai-control.md` §6.2 names this case).
  - `assessment-questions`, Suggest With AI on an assessment's questions: Default.
  - `interview-notes-cleanup`, Tidy With AI on a panelist's comments: Default.
  All personal data, all shown as a draft the person accepts; AI Is Off and AI Limit Reached hide the
  button.
- **AI reads** (`<module>.ai.js`, paged at 25, `recruitment` view, the same scope as the screens):
  `vacancies.list` (open roles, applicants, closing dates), `candidates.list` (by vacancy and stage,
  weighted total, provisional flag), `interviews.list` (upcoming, awaiting feedback, blind as §6.6),
  `assessments.list` (the library), `assessments.sittings` (awaiting marking), `talent_pool.list` (the
  pool), `vacancies.hiring_managers` (who may be a hiring manager, §6.1); `vacancies.get` (one vacancy with its questions and scorecard), `candidates.get` (one
  application). No summary is declared. A card or a read never names a vacancy outside the asker's scope,
  by id, number or title.
- **AI actions and routes**: routes to New Vacancy (prefill title, department), to a candidate, to
  Schedule Interview. The create and edit forms are accounted for in each manifest's `not_offered`:
  candidate and feedback forms are `personal`, files are `file`, Write With AI is `ai`. Vacancies:
  `VacancyCreate` and `VacancyEdit` are reached through the cards (`via vacancies.create`, `via
  vacancies.edit`); `VacancyQuestionsSave`, `ScorecardSave` and `CareersSettingsSave` are `design`
  (each designed whole on its own screen, which the assistant opens).
- **Search** (`<module>.search.js`): vacancies by number and title ("job", "role", "opening");
  candidates by name, email and application number ("applicant", "CV"); assessments by name and code
  ("test"); interviews by the candidate's name ("panel"); pool members by name ("talent pool"). Each
  opens its record on its tab with `?focus=<id>`. ⌘K actions: New Vacancy, Invite to Apply, New
  Assessment, Schedule Interview, Screen With AI.
- **New Vacancy as a Praxis AI card** (TB, 04/11/2026): the assistant asks each required field in turn
  (about ten questions) and drafts the vacancy as a card the person confirms; it is the action
  `vacancies.create` of `vacancies.ai.js` with `VacancyAdd` as its input (the place as its token), and
  Save Vacancy is `vacancies.edit` with `VacancyChange`. Each runs the screen's own service function.
  "Who is the hiring manager?" offers and matches only `vacancies.hiring_managers`, and Edit picks the
  hiring manager from the same list (`picks: hiring_manager`), so a card never holds someone the save
  refuses.

## 10 · On screen and mobile

### 10.1 Content tiers

| Screen | Open (tier 1) | Behind help (tier 2) | Not on screen (tier 3), lives in |
|---|---|---|---|
| Recruitment · Vacancies (`vacancies`) | Four KPIs (Open Vacancies, Applicants, In Interview, Past Closing Date); the list: role, department, openings, location, applicants, closes, status; View Empty Seats beside the status filter (a dialog titled Suggested From Organogram: seat, department, Create Vacancy; 25 a page with its pager); New Vacancy, Careers Page, Candidate Emails, Careers Settings. New Vacancy's interview: Question n of 10 (8 with the AI off) as a bar, the question as the card's heading, its fields, Use Blank Form, Back (Cancel on the first), Next or Skip, Draft Vacancy on the last; the editor after it (Role, Details, Pay and Publish). Nothing open until a vacancy is pressed, which opens it in the wide dialog (F31 as amended 11/11/2026): details, public link with Copy Link, Edit, Publish or Pause or Resume, Close, Questions, Scorecard, See Candidates; the Description, Required Experience and Nice to Have drawn as formatted text (headings, lists) | Help term on Scorecard: "Switch off a part this role skips. The parts left on add up to 100." Help on Paused: "Takes no applications. The link keeps working." Help on the Applicants tile: "Everyone who applied to an open or paused role, whatever became of them." Each interview card's hint on its main field: Hiring Manager "Needed before the role is published. They follow its candidates and decide after interviews."; Arrangement Note "Say which days are in the office, and the hours if they are fixed."; Location "Pick the area. Needed before an on site or hybrid role is published."; Salary From "Leave the band empty if it is not settled yet."; the must-haves "The three to five things that matter most: the skills and experience it needs, and its main responsibilities."; anything else "What would set someone apart, the perks, and the team they join."; a follow-up's own hint, from the AI | Why it asks one question a card, the follow-ups' guard and the plain draft: §3 step 2, §9 here. The slug rule, the lifecycle, why a paused role keeps its link: §6.1 here, the manual |
| Recruitment · Candidates (`candidates`) | Four KPIs (Candidates, To Screen, In Interview, Shortlisted); vacancy filter; the board's five columns, and Offer once M5's Offers screen opens (its cards have no Move To), each card: name, role, screening score with Provisional, days at stage; nothing open until a card is pressed, which opens the candidate in the wide dialog (F31 as amended 11/11/2026), the board keeping the page's width and scrolling sideways when its columns do not fit; the sheet: details, CV, answers, Screening (score, Provisional, the AI summary), Scorecard (parts, weighted total, "n of m parts"), assessments, interviews, Stage History; Score With AI, Send Assessment, Schedule Interview, Not Progressing, Reopen, Add to Pool, `Move to <Stage>`, Invite to Apply, Screen With AI (asks one to three must-meet conditions); once Offers opens, Make Offer at Shortlist and Open Offer at Offer and after (M5) | Help term on Provisional: "Worked out from the form only. Press Score With AI to read the CV." Help on Weighted Total: "From the parts scored so far, with this role's weights." | The two-tier scoring design and why a score never moves anyone: §6.4 here |
| Recruitment · Assessments (`assessments`) | Four KPIs (Active, Sent, Awaiting Marking, Average Score); Assessments list: name, type, minutes, questions, sent, average, status; Sittings: candidate, assessment, state, score; New Assessment and Import; nothing open until an assessment or a sitting is pressed, which opens it in the wide dialog (F31 as amended 11/11/2026); an assessment's sheet with its questions and points, Edit, Questions, Activate or Deactivate, Export; Send to Candidates; a sitting's sheet with each answer (a file to open, or the link given) and Mark Answers | Help on Points: "What each option scores." | How the timer and resume work: §6.7, the manual |
| Recruitment · Interviews (`interviews`) | All Interviews and My Panels; Upcoming and Recent (still to end first, then past), each row: candidate, role, date, when it ends, how it is held, panel size with Your Card, round state (Scheduled, n of m Submitted, Closed, Cancelled); nothing open until a row is pressed, which opens the interview in the wide dialog on desktop (F31 as amended 08/11/2026; a sheet on a phone): the interview, its Blind Panel, the Weighted Scorecard and Candidate Details two by two, then Round Activity across the dialog, then the round's traits and result, and Close at its foot: when, how, where or link, View CV, Download Form, Reschedule, Cancel Interview, Close Round, Write or Edit Report, My Card; Blind Panel (each panelist, Submitted or Waiting, the score once closed, Hidden before, a dash while waiting; the decision once closed); Weighted Scorecard (each part on, its weight and the candidate's score, the total; for a reader whose scope holds the role); Candidate Details with Edit; traits with each rating and the average only once closed, total, report and decision; Round Activity (scheduled, changed, cancelled, details saved, cards submitted, reminders, closed, report, each with who and when); My Card (traits as ten stars, decision, comments, Tidy With AI for every panelist while the AI is available, private notes, View CV; a star that fails to save goes back to the last rating the server kept, unless a later tap of that trait is on its way), Submit Card, Close Round, Write Report, Schedule Interview (its panel picker offers only who holds Recruitment; a refusal names who cannot sit), Reschedule, Cancel | Help on Hidden: "Each score shows once the round closes. Private notes never show." Help on Weighted Scorecard: "The candidate's score at each part, with the part's weight in the total." Help on Private Notes: "Only you ever see these." | The blind predicate and its reasons: §6.6 here |
| Recruitment · Talent Pool (`talent-pool`) | Four KPIs (In the Pool, Invited Back, Hired From the Pool, Average Score); the list: candidate, applied for, score with Provisional, added, reason, kept until, Invite to Apply or Invited; on a wide desktop the person beside the list (F31; the first until another is pressed), in a dialog where two columns do not fit; Export | Help on Kept Until: "Removed from the pool on this date." | The 24 month rule and the purge job: §6.9 |
| Recruitment · Analytics (`analytics`) | Funnel, All Roles and Screening Scores, side by side, each a card of bars with its count | Help on Funnel, All Roles: "The candidates at each stage now, across every role." Help on Screening Scores: "Each candidate's screening score: the AI read of the CV when there is one, otherwise the estimate from the form." | Why the charts have their own tab (the working tabs hold their lists alone; GE, 11/11/2026): §14 |
| Home (`/`) | Work With Us with Search Roles; the pill naming the cities hiring; three figures counting up: Open Roles, Teams Hiring, Cities; What We Build (One App, Every City; About MyCityApp from Careers Settings with Visit MyCityApp; four tiles, fixed copy); Closing Soon, the three roles closing soonest (team, title, place, closing date) with See All Roles; How We Hire's four steps; Know Someone Great? with Copy Careers Link (Link Copied for a moment); Verify a Document | None | Where the figures come from: §6.1 |
| Careers (`/jobs`, the header's Vacancy; `/vacancy` and `/jobs/` put back to `/jobs`) | Open Roles with its line (roles, teams, cities) and the search; Teams, All Teams first, each with its count, one picked at a time; Know someone for one of these? Recommend them (to Home's Know Someone Great?); Showing n of m and Closing soonest first; each role a row: team, title, place, arrangement with its note, employment type, Closes and its date; the pager | None | Indexing, slugs, the order: §6.1 |
| Vacancy (`/jobs/<slug>`) | The hero: All Roles, the team, the title, chips for the place, arrangement, employment type, salary when shown and Closes; Apply for This Role and Share Role; how many have applied. Then Role Overview (the description; one that opens with its own `## Role Overview` shows the heading once), the KPIs as tiles, Required Experience and Qualifications, What We Are Looking For (its first sentence large), How We Hire as numbered tiles; The Role card (Employment, Working Days, Experience, Reports To, Probation; Closes; Apply for This Role; how many have applied) and Know Someone for This? with Copy Role Link; More Roles, up to three others of its team; a paused, closed or filled banner. About MyCityApp is Home's, not each role's | None | Why a paused link still works: §6.1 |
| Apply (`/apply/<token>`) | The aside: the role's title, team and place; Apply; Your application, in three steps; the day the link ends; the three steps, the one in hand in yellow. The Panel: Step n of m over the step's title; About You (Full Name, Email, Phone, Years of Experience with its minus and plus); CV and Questions (Choose Your CV, then the file with Replace; the role's own questions); Why This Role and the privacy tick; Back and Next, Submit Application; then Application Sent with Your Reference and See Other Roles, or You Have Already Applied (the first application's reference, the email and the day it applied) for an email that had applied for the role | Help on Privacy Notice: "We use what you send only to consider you for roles at MyCityApp. Ask us at any time to delete it." | Write-only, no score: §6.2 |
| Assessment (`/assess/<token>`) | The aside: the role, Your assessment for this role, the assessment's name; before it starts the greeting and the day to start by, while it runs the clock as a ring (timed) or the due day (take-home) and the question map. The Panel: The Assessment (Type, Time, Questions, the instructions, Start the Assessment); Question n of m with Saved, the question, the answer (for a file question: Upload a File, up to 25 MB, or Paste a Link), Back, Next, and Submit Assessment, confirmed in a dialog; Assessment Submitted or The Time Is Up | Help on Paste a Link: "For anything over 25 MB: a Google Drive, video or portfolio link anyone can open." | Server clock, autosave mechanics: §6.7 |
| Without a link (`/apply`, `/assess`; `/sign` is M5's) | The page's name, one line, one heading and one button: Start From a Role or Use Your Email Link, each with See Open Roles; Use Your Offer Email with Verify a Document | None | Why these pages need a link: §6.2, §6.7 |

### 10.2 Phone layout

| Screen | First on a phone | Left off a phone | Main action | Navigation |
|---|---|---|---|---|
| Recruitment · Vacancies (`vacancies`) | Two KPI cards a row, then vacancy cards (role, status pill, applicants, closes); New Vacancy's interview as a full sheet, one question a card, its buttons full width at the foot | Department, Openings and Location columns | New Vacancy in the floating button; a vacancy opens in a sheet with its actions full width at the foot | Bottom bar; the Recruitment tabs along the top |
| Recruitment · Candidates (`candidates`) | Vacancy filter, then one stage at a time as a segmented control with the stage's cards (on desktop the stages sit on one row, scrolling sideways when they do not fit) | Drag between columns (Move To in the sheet instead) | A tapped card opens its sheet; `Move to <Stage>` full width at its foot | Bottom bar; the Recruitment tabs |
| Recruitment · Assessments (`assessments`) | Assessments and Sittings as a segmented control; cards | The average-by-assessment chart | New Assessment in the floating button; Mark Answers in a sitting's sheet | Bottom bar; the Recruitment tabs |
| Recruitment · Interviews (`interviews`) | Upcoming and Recent as cards (candidate, date, panel, round state), upcoming first; nothing open until a card is tapped | Role, end time and how on the card; the wide dialog (it opens in a sheet instead, its cards one under another) | A tapped interview opens its sheet, its actions at the top full width; My Card full width, opening as its own full sheet, one trait a row with ten 44 px stars, in two rows of five (ten do not fit 390 px) | Bottom bar; the Recruitment tabs |
| Recruitment · Talent Pool (`talent-pool`) | Two KPI cards a row, then pool cards (name, applied for, score, kept until) | Added and Reason columns (in the sheet) | A tapped card opens its sheet with Invite to Apply full width | Bottom bar; the Recruitment tabs |
| Recruitment · Analytics (`analytics`) | The two cards one under the other, Funnel, All Roles first | Nothing | None: it is read only | Bottom bar; the Recruitment tabs |
| Home, Careers, Vacancy, Apply, Assessment | One column, full width buttons, 44 px targets; Home's hero still the first screen, its search button under the box; on Careers the teams as a row of pills above the roles; on Vacancy The Role card above the text; on Apply and Assessment the aside as a band above the Panel | The hero's line and The Role card's Apply (the bar carries it), Share Role and Know Someone for This?; the aside's steps, skyline and credit | Search Roles; Apply in a bar fixed at the foot of a vacancy; Next, Submit Application, Submit Assessment | The public site's three navigation links in the menu |

## 11 · Edge cases

- **A double press on Submit Application**: the token is locked and spent in one transaction; the second
  press finds it spent and gets the same receipt when it is the same form, the application it finds
  holding the very CV it sends. Any other email sent on a spent link gets the same 404, whether that
  person applied or not (§6.2).
- **The CV scan is down** (clamd stopped): the CV stays pending, the application can still be submitted;
  staff see "Being checked" and cannot open it until it is clean. An infected CV is never served and the
  sheet says so.
- **The same person applies to two roles**: one candidate, two applications, each with its own score.
- **A vacancy is closed with candidates in progress**: nothing moves; their links still work until they
  lapse; Careers drops it.
- **The browser closes during an assessment**: reopening the link resumes with the server's time left;
  answers saved stand. A phone with a wrong clock does not change the time left.
- **Time runs out mid-answer**: the last saved answer stands; the text still on screen and not yet
  saved is lost, and the page says the time is up.
- **A panelist leaves MyCity or loses the grant**: the round can still close with Close Round; their
  unsent draft is not counted.
- **Nobody is on the panel any more** (all removed by Reschedule): refused, a panel needs at least one.
- **Weights changed after interviews**: every total recomputes at once (§6.5).
- **A vacancy with no traits**: each panelist gives one overall rating from 1 to 10.
- **A trait added after cards were submitted**: the submitted cards stand; the trait's average covers the cards that rated it.
- **A file over 25 MB**: refused with the limit in words; the page offers Paste a Link.
- **Screen With AI with nobody unscored**: says none were queued and changes nothing.
- **An empty Careers page**: "No open roles right now".
- **Mail paused or paced**: the candidate's mail waits; nothing is lost and nothing is sent twice.
- **AI off or over its limit**: Write With AI, Suggest With AI, Score With AI and Tidy With AI are not
  shown; New Vacancy's interview asks its eight fixed questions and Draft Vacancy writes the plain draft
  from the answers (§3 step 2); everything else works.
- **Staging**: real mail is marked `[STAGING]`; the staging seed uses `@example.test` candidates only,
  and system mail never hands an `@example.test` address to the mail server (logged as not sent,
  `integrations.md` §6.16), so nothing bounces. The seed finds the roles it made by its own record of
  making them (the `vacancy.created` its run emitted), so a role renamed on staging, or a person's role
  with a seeded title, is never mistaken for one.

## 12 · Donor code

| From | File | Change on the way in |
|---|---|---|
| praxis | `src/modules/hr/vacancy/vacancy.scoring.js` | `estimate()` kept in shape (crude and legible, blanks left out); dimensions changed to what our form asks (§6.4); `assess()` goes through `llm.complete` with the `cv-screen` prompt and our PDF text reader, no vision call |
| praxis | `src/modules/hr/careers/careers.service.js` | The allow-list public shape and the write-only application kept, as `vacancies.careers.js` (it loads no staff auth: the public-surface gate follows a public routes file's local requires); reached by slug for listed roles and by our `public_token` for Apply (decision above); no tenant lookup |
| praxis | `src/modules/hr/vacancy/vacancy.service.js` | The lifecycle, with PAUSED keeping the link; the onboarding requires dropped (M5) |
| praxis | `src/modules/hr/vacancy/vacancy.draft.js`, `vacancy.questions.js` | Prompts rewritten as `jd-draft.md` and `screening-questions.md` |
| pixie | `src/modules/recruitment/recruitment.careers.*` | Not taken; the praxis surface is the model |

## 13 · Open questions

- The psychometric and case-study question banks: Operations & People to send. MyCity's Graphics and
  Motion Design assessment (shared 04/11/2026) is entered on the screen; JBS Praxis's researched ones go
  on staging only (§6.7). The repository is private (GE, 05/11/2026), so MyCity's three documents and
  its demo stay in `docs/MyCity-ERP-Documents/`; seeds, tests, pictures and this guide still name no real
  candidate or person (every candidate is invented, @example.test). The ten traits (§3) and the job
  description shape (§6.1) named here are MyCity's generic forms.
- Candidate mail volume against the 40 an hour pace on production: the mail plan upgrade is with MyCity's
  management and Operations & People (meeting of 21/10/2026).
- Whether the careers page is linked from mycityapp.io (10/10/2026, open with MyCity).
- How long candidates' data is kept after a decision (NDPR): not discussed; nothing is deleted in M4.

## 14 · Change log

- 11/11/2026 · GE · Recruitment's desktop layout put back as GE left it: Vacancies, Candidates and Assessments (the library and Sittings) open a record in the wide dialog again, the list or board keeping the page's width (`ListDetail` `layout="modal"` `size="wide"`, F31 amended 11/11/2026; #109 and #110 had put them beside the list). Vacancies' Suggested From Organogram is behind View Empty Seats beside the status filter, in a dialog. The charts moved to a new tab, Analytics (#111): Funnel, All Roles from Vacancies and Screening Scores from Candidates, read from the summaries they already used; no API changed. `ListDetail` `fillUntilPicked`, used only by the board, is gone. Talent Pool, Interviews and Offers are unchanged.
- 11/11/2026 · JP · Fault #3 of the 11/11 staging brief (`VALIDATION_FAILED: hiring_manager_id` at `POST /recruitment/vacancies`): New Vacancy's Hiring Manager offered every active employee, and a seat filled in its line manager unchecked, while the save takes only someone in the writer's scope who holds Recruitment. `GET /vacancies/hiring-managers` (§5) lists exactly them with the panel's own predicate; New Vacancy's interview, Edit Vacancy and the New Vacancy card (its question, its matching and its Edit) pick from it; a seat's line manager is filled in only when eligible (§3 step 1, §6.1, §9). Fault #4 (`vacancy_id` at Invite to Apply) was already fixed by #79.
- 10/11/2026 · TB · Found while filming the M4 videos and fixed: Candidates, Assessments (the library and
  Sittings) and Talent Pool open a record beside the list on a wide desktop (F31), as Vacancies does; the
  board keeps its full width until a card is pressed. New Vacancy's questions and the vacancy form send a
  salary typed as people write it (`350,000`) with two places; it had been refused as "Check the
  format". Left: nothing.
- 10/11/2026 · TB · Vacancies on a wide desktop: a role sits beside the list (F31), the first until another is pressed,
  as the User Guide already said; it had opened in a dialog. Found while filming the M4 video. Left: nothing.
- 09/11/2026 · AI · Hide Apply, Assessment and Sign Offer from the public header because they are
  private-link pages. Their token routes and functionality remain unchanged; left: nothing.
- 08/11/2026 · GE · (Ose) The Interviews dialog has Close at its foot (ListDetail `closeButton`, desktop only).
- 08/11/2026 · GE · (Ose) Interviews on desktop: the list takes the page's width (with when it ends and how it is held)
  and a row opens the interview in a wide dialog, the interview, Blind Panel, Weighted Scorecard and Candidate Details
  two by two and Round Activity across it (F31 as amended 08/11/2026, ListDetail `modal` size `xl`). The phone is
  unchanged (§10).
- 08/11/2026 · GE · (Ose) The site's header gains **Help** after Verify Document (`/help`, #108): the public chapter of
  the User Guide, moved out of the hub (`docs/guides/user-guide.md` §6.11).
- 08/11/2026 · GE · A repeat application (same email, same role) is told so: `ApplicationReceipt.already_applied`
  with the first application's reference and date, and Apply shows You Have Already Applied (§6.2). Vacancies'
  Careers Page opens the public site's index (`VacanciesSummary.site_url`, was `careers_url` to `/jobs`).
- 07/11/2026 · AJ · M5: `candidates.correctEmailIn` and the `application.email_corrected` event, for an
  offer's Change Email (§6.3); the mock's Not Progressing withdraws the candidate's open offer, as the
  API's handler does.
- 07/11/2026 · AJ · M5 PR 4 (`docs/guides/offers.md`): once Offers opens, a candidate's sheet offers
  Open Offer at Offer and after (Offers opened by the application) and Make Offer at Shortlist (New
  Offer with the candidate picked) (§10). The mock's applications gain M5's Offer and Documentation
  stages, and M5's offers live in `app/src/api/mock/modules/offers.ts`.
- 06/11/2026 · GE · The hand-over to M5 (#79's agreement with AJ): Offer and after in the pipeline, set
  only through `candidates.advanceIn`, `offerEndedIn` and `hireIn` (§3 step 12, §6.3); the board's Offer
  column, shown once M5's Offers screen opens; `vacancies.hiredIn` fills the vacancy's seat
  (`organisation.fillSeat`) and closes it as filled once every opening is (§6.1); `in_progress` and
  Close Vacancy's Not Progress All count only the M4 stages; Candidate Emails gains M5's three
  (`offer-sent`, `offer-signed`, `onboarding-documents`) with their wording and variables (§6.8);
  `application.hired` (§7).
- 06/11/2026 · GE · Interviews on desktop evened out: beside the list, the interview and its Blind Panel; below
  it, in full width and the same split, Weighted Scorecard beside Candidate Details, then Round Activity and
  the round's result. The list and the record take the list-wider split. A phone's sheet is unchanged (§10).

- 06/11/2026 · GE · (Ose) Vacancy and Careers are one link: the header's **Vacancy** opens the open roles at
  `/jobs` and stays marked on a role's page; `/vacancy` and `/jobs/` open the list and put the address back to
  `/jobs`; the Choose a Role guidance is gone. The site's hero and footer take the page's theme: a deeper glass
  teal with a light skyline in light, Deep Green in dark (tokens.css `--site-*`), and the footer shows the
  skyline faint behind it. In light no surface is pure white (cards, fields, menus, the search box and the
  letter take a faded glass teal); in dark the cards carry a faint sheen. The theme toggle is kept on reload:
  `public-app/public/boot.js` applies it before first paint (the inline script was refused by the security
  policy, `script-src 'self'`).
- 06/11/2026 · GE · From testing on staging, round 1 (three parts): the candidate board stays on one row and
  scrolls sideways (the shared Kanban, for every board), its cards compact with Move beside the title; Vacancies
  lists Openings, and on a phone a list's status is a pill on the card; Interviews is Upcoming and Recent beside
  the selected interview's Blind Panel, Weighted Scorecard (only for a reader whose scope covers the role) and
  Round Activity (§5, §6.6, §10); New Vacancy is a ten-question interview, two of them written by the AI
  (`vacancy-follow-ups`, Default, chosen by GE), that drafts into the editor, and runs eight questions with a
  plain draft when the AI is off (§3, §5, §6.1, §9, §10, §11).

- 06/11/2026 · GE · From testing on staging: Invite to Apply said "Check this value" when the person had
  already applied for the role (the field's message was six words; it is now "Applied for this role", and
  the role they came from is no longer offered). The staging seed picks hiring managers and panelists only
  from Implementation accounts that hold Recruitment: one teammate without it had every role it managed and
  every panel refused, so staging had no interviews and no Design role.
- 06/11/2026 · GE · (Ose) The approved public site design on the pages (`public-site-demo.html`). Home (#107) at `/`
  (it no longer opens Careers); Careers with its teams list; Vacancy with the role's hero, its text part by part (the
  KPIs as tiles, What We Are Looking For as a statement), The Role card, Know Someone for This? and More Roles; Apply
  and Assessment on PublicPage's split layout (the steps, the ring clock and the question map in the aside); one
  header with six links on every page, and a guidance screen at `/vacancy` (or `/jobs/`), `/apply` and `/assess` for a
  visitor with no link. `PublicJob.about_company` dropped: About MyCityApp is Home's alone. The running assessment's
  buttons read Next and Submit Assessment (still confirmed), the Resume Later note is gone (the greeting says every
  answer saves). §2, §5, §6.1, §10.
- 06/11/2026 · GE · (Ose) The data for the approved public site design (`public-site-demo.html`). `GET
  /api/public/v1/jobs/summary` (`PublicJobsSummary`): open, the departments hiring, the cities, the three
  closing soonest and About MyCityApp, for the new public index. `/jobs` lists closing soonest first (no
  closing date last, then the newest) and takes `department`, a department's code, one at a time beside
  `q`; each card carries the department's code, the arrangement's note, the employment type and the
  closing time. `ApplyLink` names the role's department and place for the form's pane. The slug `summary`
  is never made. `PublicJob.about_company` stays (the page stops drawing it; dropping it from the
  contract waits on the page). §2, §5, §6.1, §6.2, §10.
- 06/11/2026 · GE · The P15 follow-ups, closed. Interviews: the panel picker lists only who may sit
  (`GET /recruitment/interviews/panelists`) and a refusal names who cannot; a round closes by itself
  only once every seat has submitted and the interview has started (after Submit Card, after a
  Reschedule that drops the last waiting panelist, or at the daily reminder run); Tidy With AI is for
  any panelist with a card to write (`GET /recruitment/interviews/assist`); My Card puts a star back
  only to what the server last kept. Vacancies: the staff sheet draws its texts as blocks; Create
  Vacancy from a seat fills in the department, reports to and hiring manager; the screening check
  refuses protected phrasings (sex, age, origin, religion, marriage, disability and more); Suggested
  From Organogram pages; Applicants is every application, on the tile and the column. Candidates and
  the rest: an assessment link lives a day past its due time, so Time Up is reachable; the pool never
  names a vacancy outside the reader's scope; a Word CV saves with its own name; Import Assessment is
  one press; Cancel goes back one step; short fixed choices are radio groups; a JSON export that
  mentions `<script` imports; mail to reserved domains (`@example.test`) is never handed to the mail
  server; the staging seed finds its roles by its own creation events.
- 05/11/2026 · GE · (Ose) The careers page shows a part's heading once: a description that opens with its own
  `## Role Overview` (as staff paste MyCity's job descriptions) loses that first line on Vacancy (§10.1). The
  Recruitment chapter follows the screens (the auditor's list in the handoff).

- 05/11/2026 · GE · The eight decisions from the P15 audit: (1) the repository is private, so MyCity's
  documents stay (§13); (2) Close Vacancy offers to mark everyone still in progress Not Progressing, with
  their emails, and Not Progressing works on a closed role (§6.1, §6.3); (3) a second application by the
  same email answers the reference and nothing more (§6.2); (4) a hiring manager holds `recruitment`
  view (§6.1); (5) Apply's receipt promises no reply time; (6) Send Assessment moves the candidate to
  Assessment (§3 step 7); (7) Write With AI asks before replacing typed words (§6.1); (8)
  `apply-cv-purge` removes CVs left on Apply links that ended without an application (§6.2, §7).

- 05/11/2026 · GE · (auditor) P15, the close-out audit (five independent reviewers and a walk through the whole flow
  on a live stack: publish, apply with a CV, assessment on a phone, marking, a two-person blind panel, the report
  and its form, shortlist, not progressing, the pool and its invite). Fixed: the CV upload on Apply and a file
  answer refused the upload engine's `purpose` (no application could be made; `CvUpload`, `AnswerFileUpload`); a
  spent Apply link told anyone whether an email had applied (§11); Not Progressing called off an interview already
  held; a card with no score counted as 0; a Head of Department could not open a file answer to mark it (vault
  rule); the round's close now tells the hiring manager (§7); Home's SLA alert leaves out a closed role; a part on
  weighs at least 1; the pool export's scope; search past 24 months; an interview's calendar entry not editable
  on the calendar; Organogram's Create Vacancy keeps the seat (§2); unlabelled toggles in New Vacancy, Questions
  and Scorecard are checkboxes; unsaved words ask before closing; Schedule Interview searches candidates on the
  server; a sheet's refusal names the field; one filled Move To; Lagos dates; the funnel's scale. This guide now
  says what is built: Write With AI fills the form (§3 step 2), the card's words save on Save Draft (§3 step 9),
  a known person is never renamed (§6.2), §4's `talent_pool_invite`, §5's scopes, §7's events and notices, §9's
  reads. Open for GE: `docs/handoff/m4-recruitment.md` §7, the P15 entry.

- 05/11/2026 · GE · Import is on screen (GE's choice): Assessments · **Import** takes the file Export made through the upload engine (`POST /documents`, the new purpose `assessment_import`, a `.json` file up to 1 MB; `sniff` knows JSON by its name and its first character), then `POST /recruitment/assessments/import/file` reads it back from the vault, only for who uploaded it, checks it as `AssessmentExport` and makes the assessment switched off. This replaces the earlier note that Import stays off screen.

- 05/11/2026 · GE · P13: the staging seed (`seeds/staging/55_recruitment.js`): Careers Settings with MyCity's ten traits, six roles one per state (the Head, Sales & Revenue role shaped on MyCity's job description), eleven invented candidates through Apply, the researched case study and work style profile and a take-home brief shaped on MyCity's assessment, sittings at every stage, a closed round with its report and form, an open round and one to come, and a candidate kept in the pool. Hiring managers and panelists are the Implementation Team's accounts, so staging mail stays with the team. It removes Home's staging vacancies.
- 05/11/2026 · GE · (Ose) Public site redesign (presentation only; no route, contract, mock or behaviour changed): every
  public page on a faint City Green ground with a Deep Green footer under a Lagos skyline edge and the time in
  Lagos. Apply and Assessment stand a Deep Green context pane (SkylineHero `pane`) at the left of their card on
  desktop, carrying the h1: the role and the link's expiry with the steps (Apply); the assessment, its figures and
  greeting (intro); the question count, clock, Resume Later and progress (running). On a phone the pane is a band
  above the card. Vacancy's text and The Role card are `StickyColumns`. One staggered arrival per page; the wizard's
  steps slide in from the side they came from; Saved rises in.

- 05/11/2026 · GE · Re-audit of P9 and P10 (three independent reviewers; each finding checked against the code, then fixed):
  - API: the board's rows carry `next_stages` (the role's own board, empty on a closed role), and the board's Move To offers only those (`Kanban` cards take `moves`); Careers Settings and each Candidate Email carry `can_edit` (edit · all), so Save is offered only to who may save; the summary carries `careers_url`, so Careers Page opens this environment's careers page; `GET /recruitment/pool/:id` opens a person from a link; a sitting's link carries `?sitting=` (route map `param`); `can_close` is true only once the interview has started; the Interview Assessment Form opens for whoever may read the interview (vault rule on `interview`), not only a reader of every vacancy.
  - Screens: a vacancy made from a seat keeps the seat; a missing hiring manager is caught on Role; an edit sends the closing date only when changed; the Nice to Have field reads What We Look For (MyCity's heading, What We Are Looking For, is one word over a field label's four, and stays on the careers page); My Card saves its stars in the order tapped, a failed save goes back to what was last kept, its errors clear as they are fixed, and Submit Card says what is left before asking to confirm; Cancel Sitting shows on a sitting not yet finished; Export, Add to Pool and Remove follow their own grants; Reopen shows only while the role is open; refusals land on their own row (Screen With AI's conditions, Default Traits, an assessment option); `?marking=true` and a link to the same record work while already on the tab; error text uses the real tokens.
  - The mock now agrees with the API: the weighted total counts a provisional screening score and the latest sitting (a practical as technical); a round's score is the mean of unrounded cards, kept at close; the form comes with the report; Cancel closes the round; Upcoming and Past go by the end time; a panel change keeps submitted cards (eight at most); the API's refusals and the score bands.
  - Kept as is: a record opens in a sheet on desktop too, as Queries, Sanctions and Performance do (29/10/2026); Import of an assessment stays off screen (it needs a local file read).

- 05/11/2026 · GE · (Ose) P11: the public vacancy's four Markdown texts arrive as blocks for `RichText`
  (`PublicJob`, as Policies does; §6.1), and the Vacancy and Apply rows of §10.1 say what the pages show:
  working days and the closing date on the role, How We Hire as its steps, Apply as three steps.
  `ApplicationSubmit`'s name message is **First and last name** (a field error is at most 4 words). The
  pages are built: Careers and Vacancy on `SkylineHero` in PublicPage's open layout, Apply a Wizard over
  the contract's schema, Assessment with `Countdown` and autosave; Apply and Assessment load on their own.
  The description's heading is **Role Overview**, and the public mock's role and take-home brief are MyCity's own
  (`docs/MyCity-ERP-Documents`: the Head, Sales & Revenue job description; the Motion and Graphics brief).
  Write With AI (`jd-draft`, version 4) heads a drafted role's measures **Key Performance Indicators (KPIs)**,
  as MyCity's own job description does (it said How You Will Be Measured).
- 05/11/2026 · GE · (Ose) P11 re-audit: a file answer's upload answers `AnswerFileSaved` (the document, as an Apply
  CV does, and `saved_at`): the one upload engine reads a `document_id`, so the old `AnswerSaved` showed a saved file as
  failed. The public mock now holds the staff mock's six vacancies (VAC-0005, a draft, never public) and assessments.
- 05/11/2026 · GE · P9 and P10: the staff screens on the contract, one file per tab (`app/src/features/recruitment/`, §10), and the staff mock in the contract's shapes. As built: New Vacancy is a wizard of three steps (Role, Details with Write With AI, Pay and Publish; Publish Vacancy or Save Draft); a vacancy's sheet shows Scorecard Weights, Candidates by Stage, the traits numbered and the Apply questions; Questions edits both lists (Use Defaults puts Careers Settings' traits back; Suggest With AI adds); the board narrows to a role's own columns when filtered; a candidate's sheet holds `Move to <Stage>`, Send Assessment, Schedule Interview, Not Progressing, Add to Pool and Reopen; Interviews has Upcoming, Past and My Panels; My Card opens full height from the interview's sheet; a form opened from a sheet returns to the sheet when it closes. An assessment's sheet has Export; Import is not on screen (it needs a local file read the upload engine does not do; the API's stays).

- 05/11/2026 · GE · My Card takes the donor's scorecard flow (REUSE_MAP §5.3, praxis-ls applicant-drawer):
  the same numbered traits for every candidate of the role; each star saved as the panelist taps it, put
  back with the error when the save fails; a tap on the star already chosen takes it back to not rated
  (`RatingField onClear`; `FeedbackSave.ratings[].rating` may be null on a draft); and the panelist's own
  score, the mean of what they have rated, shown as they go. Unlike the donor: 1 to 10, one card per
  panelist, blind until the round closes, locked once submitted.

- 05/11/2026 · GE · P12. ⌘K actions: New Vacancy, Invite to Apply, Screen With AI, New Assessment, Schedule
  Interview (`shared/search/actions.js`, each opening its tab with `?action=`). Six graded questions for the
  assistant, one a member of staff who must never read candidates. The access matrix probes the reads of
  vacancies, candidates, sittings and the pool: the asker's own role is listed, the outsider's never
  (`vacancies.matrix.js`). Interviews has no probe: a panelist sees an interview whatever its role, and the
  matrix's outsider holds no Recruitment to sit on one; its scope is tested in `recruitment-interviews`.
  A sitting is cited as itself (`application_assessment`), not its assessment.

- 05/11/2026 · GE · Audit of P6b, fixed:
  - two Add to Pool presses at once make one entry, renewed;
  - a person in the pool from another manager's role is "Already in the pool" to someone whose scope
    does not reach it;
  - every Invite to Apply from the pool is kept (`talent_pool_invite`, migration 4060), so an application
    keeps source pool when the person was invited to two roles or left the pool while their link worked;
  - the export is restricted and opens only for the person who asked (and the CEO);
  - a person past their 24 months leaves the list and cannot be invited before the purge runs;
  - the purge goes on batch after batch until it has caught up, within five minutes.

- 05/11/2026 · GE · P6b built. Add to Pool keeps a person for 24 months with why, and adding them again
  renews the reason and the 24 months, never a second entry. Invite to Apply goes through the candidates
  module's own invite (`inviteIn`), so the link, the email and the refusals are those of Candidates, and
  the application has source pool. Remove and the daily `talent-pool-purge` (05:23 Lagos) take a person off
  without deleting anything. Export makes the filtered pool a workbook in the asker's scope.

- 05/11/2026 · GE · Re-audit of P4 to P6 (three independent reviewers), fixed:
  - **Apply:**
    - the CV and the answers are checked before anything else, for everyone;
    - an email that has applied is answered as any submission is, now;
    - a second press of Submit gets the first receipt, not a 404;
    - two people sending one new email at once meet the same answer;
    - a stranger's form never renames a known person, it only fills a missing phone;
    - one link holds at most five CVs.
  - **Candidates:**
    - the sheet's weighted total is the board's;
    - Not Progressing and Score With AI are refused on a closed role;
    - Screen With AI skips an application read meanwhile;
    - Not Progressing cancels the candidate's unfinished sittings, so a Reopen can send them again.
  - **Protected conditions:** a condition naming an age, a sex or the like is refused by phrase, and
    "over 10 years in sales" passes.
  - **Assessments:**
    - a submitted or timed-out sitting keeps its link until it lapses, so the page can say it is
      over; cancel and expire still stop it;
    - moving on from a file question keeps the answer given;
    - the minutes are fixed once sent;
    - the link is always locked before the sitting;
    - Send to Candidates skips a pair sent a moment ago;
    - an assessment with no questions does not export.
  - **Interviews:**
    - the report needs `recruitment` edit over the role, or to be its hiring manager;
    - an interview's calendar entry changes only from the interview;
    - removing a panelist removes their draft, and a submitted card stays;
    - only the traits in use count in a card's score;
    - an ended role does not seat a panelist;
    - Close Round waits until the interview has started;
    - Candidate Details saved after the report remake the form;
    - a cancel's reason is kept on its audit row.

- 05/11/2026 · GE · P6 built. One round, one interview: Schedule makes the round, its panel and a
  calendar entry in one save (the calendar's `createIn`; the panelists hear as attendees), moves the
  candidate forward to Interview, and mails the candidate `interview-invite` with the .ics after commit; a
  change of panel alone is not sent to them. The blind rule is one SQL predicate (`interviews.repo.js`
  BLIND). The last card closes the round; Close Round scores what is in, and a draft stays its author's.
  The report, by edit in scope or the vacancy's hiring manager, makes a new Interview Assessment Form at
  each save. Cancel, and Not Progressing (from its event), cancel the entry and close the round with no
  score. The reminder job is `interview-reminders` (daily, once per seat a day).

- 05/11/2026 · GE · P5 built. An assessment's code is ASM-0001, made under a lock (no numbering scheme:
  it is a library, not a document). Each option's points are sealed in `answer_key_enc` with the
  question's id as its record, and read back only by staff reads and scoring. The assessment link is
  made in the mail handler after Send commits (the token never sits in the outbox), opens again to
  resume, lives until the start-by day and is moved to `due_at` by Start; ending the sitting stops it.
  A sitting that ends with nothing to mark is scored at once. Suggest With AI takes `duration_minutes`,
  and checks a named vacancy's scope before reading its role. File answers use upload purpose
  `assessment_answer` (25 MB). The clock's job is `assessment-expiry`, as its file is named.

- 05/11/2026 · GE · P4 built: Apply (the link, the CV kept against it until the application is made,
  the estimate, a second application answering the first's reference), the board ranked by the
  weighted scorecard in SQL, moves, Not Progressing and Reopen, Score With AI and Screen With AI from
  the outbox (`cv-screen`, Deep Reasoning; the CV's text read by `services/media/pdf-text.js`), a
  condition naming a protected trait refused, Invite to Apply (the link made after commit), Candidate
  Emails (scope all). Suggest With AI may suggest a yes or no Apply question and is told how many
  traits are left. Not Progressing leaves the cancelling of interviews to P6, from its event.

- 04/11/2026 · GE · (Ose) From the audit of P7 and P8: an assessment link lives until `due_at` once the
  sitting has started (§6.7); the five candidate emails ship as Markdown so Restore Default and edits
  keep their words and links (§6.8); a panelist's ten stars sit in two rows of five on a phone (§10.2).
  The interview invite's variables carry the interview's type as three flags with the place's address, and
  a change of panel alone is not sent to the candidate (§7); not-progressed links the careers page.
- 04/11/2026 · GE · (Ose) P7 and P8. The `assessment-invite` email carries an untimed sitting: the contract's
  `AssessmentInviteEmailVars` takes `duration_minutes` for a timed test or `due_days` for a take-home
  brief, one of the two (§6.7). `interview-invite` takes `rescheduled`, so a moved interview says so in
  its subject and opening (§3 step 8, §7). The interview card's ten stars are `RatingField` and the
  assessment's clock is `Countdown`, both from `@mycity/ui` (§10).
- 04/11/2026 · GE · Audit of P1 to P3. Migrations: 4050 removed, its changes folded into 4010 to 4040
  (none was merged); a draft can be closed (the slug check needs one only once published); the
  application's source never null; the indexes the lists sort by. Contract: Edit clears a field sent
  empty; at most 20 traits; a vacancy lists only its questions in use; weights, points and marks are
  numbers; Screen With AI reuses the kept conditions. Vacancies: a remote role drops its place, pay
  checked against what is kept, the slug made under a lock, one live vacancy a seat, Suggested From
  Organogram and the cards in the reader's scope, Careers Settings saved only with scope all, an
  answered question retired when reworded, About MyCityApp given to Write With AI. Left: P4 onwards.
- 04/11/2026 · GE · P3 built (`vacancies`): the lifecycle with its history in `entity_state_history`,
  the slug at first publish, questions and traits saved whole (a used one retired), scorecard parts,
  Careers Settings, Suggested From Organogram, Write With AI (`jd-draft`, `screening-questions`), the
  careers page in `vacancies.careers.js`, and the New Vacancy and Save Vacancy cards (`VacancyAdd`,
  `VacancyChange`, as every card picks its place). A malformed `/jobs/<slug>` answers the same 404 as
  an unknown one (the contract no longer refuses it with a 422). Apply is held to the public surface's
  write limit, not a second limiter.
- 04/11/2026 · GE · From the internal Modules Review of 04/11/2026: the Talent Pool moves to M4 (#44,
  `talent_pool`, §6.9); the interview card is MyCity's Interview Assessment Format, traits rated 1 to
  10 from Default Traits, Candidate Details filled once, decision Select, On Hold or Reject, the form
  as a PDF, panelists see the CV (§3, §6.6); Screen With AI asks must-meet conditions (§6.4); each
  vacancy switches scorecard parts on or off and the board skips them (§6.1, §6.3, §6.5); Send to
  Candidates in bulk; file answers up to 25 MB or a link (§6.7); researched assessments on staging only,
  carried to production by export and import; New Vacancy as a Praxis AI card (§9). Then from the
  three documents MyCity shared the same evening: the card's ten traits and its Others (§3, §6.6);
  MyCity's job description shape, with working days and an About MyCityApp kept on Careers Settings
  (§6.1); untimed take-home assessments due by a day (§6.7).
- 04/11/2026 · GE · P1 and P2 built: the contract (`vacancies.js`, `candidates.js`, `assessments.js`,
  `interviews.js`) and migrations 4010 to 4040 with seed 4199. §4 and §5 follow them: a sitting keeps
  4000's `starts_at` unused beside the new `started_at`; Reopen and Restore Default have routes; one live
  sitting per assessment and application.
- 04/11/2026 · GE · First draft, from MILESTONES §9 and the decisions of 04/11/2026: listed roles by
  slug, Apply and Assess by token; M4 stages end at Shortlist; candidates mailed with an `.ics` from
  editable templates; AI jobs (CV read Deep Reasoning, the rest Default); panelists hold Recruitment;
  the AI reads a CV only on press; no vacancy approval; choice, written and file questions.
