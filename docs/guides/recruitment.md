# Recruitment · Engineering Guide

| | |
|---|---|
| Owner | GE |
| Milestone | M4 |
| Backend modules | `vacancies`, `candidates`, `assessments`, `interviews`, `talent_pool` |
| Frontend paths | `app/src/features/recruitment/`, `public-app/src/pages/Careers.tsx`, `public-app/src/pages/Vacancy.tsx`, `public-app/src/pages/Apply.tsx`, `public-app/src/pages/Assessment.tsx` |
| Permission key(s) | `recruitment` |
| Capabilities | none |
| Screens (PROGRESS.md rows) | #38 Vacancies, #39 Candidates, #40 Assessments, #41 Interviews, #44 Talent Pool; public #80 Careers, #81 Vacancy, #82 Apply, #83 Assessment |
| Status | Draft |
| Last changed | 04/11/2026 |

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
| Recruitment · Vacancies (`vacancies`) | staff app | `recruitment` view, scope by hiring manager | Open, paused, draft and closed vacancies with applicants, days open and the closing date; the funnel by stage; Suggested From Organogram (vacant seats with no vacancy) | New Vacancy (Write With AI for the description), Edit, Publish, Pause, Resume, Close, Copy Link, Questions, Scorecard, Candidate Emails, Careers Settings (About MyCityApp and the Default Traits; saved only with `recruitment` edit over every vacancy), See Candidates |
| Recruitment · Candidates (`candidates`) | staff app | `recruitment` view, scope by the vacancy's hiring manager | The board: Application, Screening, Assessment, Interview, Shortlist; each card with the screening score and its Provisional flag; a candidate's sheet: details, CV, answers, scores, scorecard, assessments, interviews, time at each stage | Move between stages, Not Progressing (with a reason), Reopen, Add to Pool, Score With AI, Screen With AI (with must-meet conditions), Send Assessment, Schedule Interview, Invite to Apply, open the CV |
| Recruitment · Assessments (`assessments`) | staff app | `recruitment` view | Assessment definitions (name, type, minutes, questions, sent, average); Sittings (who took what, state, score) with Awaiting Marking | New Assessment, Edit, Questions (with Suggest With AI), Activate or Deactivate, Send to Candidates (every candidate of a role at a stage), Mark Answers |
| Recruitment · Interviews (`interviews`) | staff app | `recruitment` view, scope by hiring manager or a seat on the panel | Upcoming and recent interviews; one interview's panel (submitted or waiting, scores hidden while the round is open), the candidate's details card filled before the interview, the traits and averages after it closes, the consolidated report and its PDF | Schedule Interview, Reschedule, Cancel, Candidate Details, My Card (each trait 1 to 10, decision, comments, private notes, Tidy With AI, the candidate's CV), Submit Card, Close Round, Write Report, Download Form |
| Recruitment · Talent Pool (`talent-pool`) | staff app | `recruitment` view, scope by the hiring manager of the vacancy they applied for | Candidates kept for later: applied for, score, added, reason, invited, until when kept | Add to Pool (from a candidate), Invite to Apply (to an open vacancy), Remove, Export |
| Careers (`/jobs`) | public site | anyone | Open roles: title, department, area, arrangement; search over 8 roles | Open a role |
| Vacancy (`/jobs/<slug>`) | public site | anyone | One role: what it is, must have, nice to have, how we hire, salary when shown, arrangement and probation; a paused or closed role says so | Apply for This Role (mints the Apply link) |
| Apply (`/apply/<token>`) | public site | the holder of the link | The form: name, email, phone, years of experience, CV, the vacancy's own questions, why this role, the privacy notice | Submit Application; the receipt with its reference |
| Assessment (`/assess/<token>`) | public site | the holder of the link | Intro (type, minutes, questions); the running test with a server timer and autosave; submitted or time up | Start the Assessment, answer, upload a file answer (up to 25 MB) or paste a link to a larger one, Back, Next Question, Finish and Submit Assessment |
| Home · Overview, Open Vacancies card | staff app | as `home.md` §6 | Open vacancies in scope | Open a vacancy |
| Home · Alerts, Recruitment SLA | staff app | as `home.md` §6 | Applications at one stage longer than the rule's days | Open the candidate |
| People · Organogram, Create Vacancy | staff app | `people` edit | On a vacant seat | Opens New Vacancy here with the seat's title and department filled in |
| My Workspace · Calendar | staff app | each panelist | The interview as a calendar entry with its `.ics` invite | Open it |

## 3 · How the screens relate

1. **A seat falls empty.** A vacant `org_seat` with no live vacancy shows on Vacancies under Suggested
   From Organogram. Create Vacancy (there, or on the Organogram) opens New Vacancy with the seat's
   title, department and reporting line filled in; the vacancy keeps `org_seat_id`. Nothing is created
   until someone saves (`organogram.md` §3).
2. **The vacancy is written.** New Vacancy is a three-step wizard (Role, Details, Pay and Publish). Write
   With AI drafts the description and the must have and nice to have from what is filled so far
   (`POST /recruitment/vacancies/assist`, prompt `jd-draft`); the person reads it and presses Use
   Draft. Save keeps a draft (`VAC-0001`); Publish Vacancy makes it `open`, stamps `published_at`, and
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
   token (`assessment-invite` mail). Send to Candidates (Assessments) does the same at once for every
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
   and private notes. They save as they go and press Submit Card. While the round is open, a
   person reads only their own feedback, the hiring manager and the CEO included (§6.6). Panelists who
   have not submitted are reminded once a day from the interview's end (`interview-reminders`).
10. **The round closes** when the last panelist submits, or when someone with `recruitment` edit presses
    Close Round. Then everyone who may see the interview sees every panelist's ratings, comments and
    decision (never another's private notes), each trait's average across the panel, and the round's
    score (§6.6), which is the interview part of the scorecard. The hiring manager (or `recruitment`
    edit) writes the consolidated report and decides Select, On Hold or Reject
    (`interview_round.report`, `decision`); saving it generates the Interview Assessment Form, a PDF of
    the whole card with every panelist's ratings, filed in the vault (`form_document_id`).
11. **The scorecard ranks.** Each application's weighted total is computed from the components it has
    (§6.5) and shown on its card and sheet; Candidates sorts by it.
12. **Shortlist and hand-off.** A candidate the panel selected moves to Shortlist. M5 (Offers, AJ) picks
    up from there; until it ships, Shortlist is the board's last column. Not Progressing at any stage
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
| `recruitment_scorecard_criterion` | `vacancy_id`, `code` (screening, psychometric, technical, case_study, interview), `weight`, `active` | 4000; created with the vacancy at the default weights, `code` and `active` added by 4010. A part switched off has weight 0 |
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
| `GET /recruitment/vacancies/summary` | `VacanciesSummary` | `recruitment` view · all/team | no | Open, applicants, in interview, past closing date; funnel by stage |
| `GET /recruitment/vacancies` | `VacancyListQuery` → `VacancyPage` | `recruitment` view · all/team | yes | Filters `status`, `department_id`, `q`; sort `closes_at`, `title`, `created_at`, `published_at` |
| `GET /recruitment/vacancies/suggested` | `SeatSuggestionListQuery` → `SeatSuggestionPage` | `recruitment` view · all/team | yes | Vacant seats with no draft, open or paused vacancy; a team reader sees the seats whose line manager is in their scope |
| `GET /recruitment/vacancies/:id` | `VacancyDetail` | `recruitment` view · all/team | no | With its questions in use (a retired one is left out) and scorecard weights |
| `POST /recruitment/vacancies` | `VacancyCreate` → `VacancyDetail` | `recruitment` create | no | `publish: true` publishes in the same transaction. A seat holds one live vacancy (422 on `org_seat_id`) |
| `PATCH /recruitment/vacancies/:id` | `VacancyEdit` → `VacancyDetail` | `recruitment` edit · all/team | no | A closed vacancy is not edited. An optional field sent empty ("" or null) is cleared; one left out stays. Switching to remote removes the place. The pay band is checked against what is kept |
| `POST /recruitment/vacancies/:id/publish`, `/pause`, `/resume` | `EmptyBody` → `VacancyDetail` | `recruitment` edit · all/team | no | §6.1 |
| `POST /recruitment/vacancies/:id/close` | `VacancyClose` → `VacancyDetail` | `recruitment` edit · all/team | no | Reason: filled, cancelled, on hold |
| `PUT /recruitment/vacancies/:id/questions` | `VacancyQuestionsSave` → `VacancyDetail` | `recruitment` edit · all/team | no | Replaces both lists; a question already answered or rated is kept and only retired from the form |
| `PUT /recruitment/vacancies/:id/scorecard` | `ScorecardSave` → `VacancyDetail` | `recruitment` edit · all/team | no | Each part on or off; the weights of the parts on sum to 100 |
| `GET /recruitment/vacancies/settings`, `PUT` | `CareersSettings`, `CareersSettingsSave` | view; edit · all | no | Careers Settings: About MyCityApp and the Default Traits New Vacancy starts its interview card from |
| `GET /recruitment/vacancies/assist` | `AiAvailability` | `recruitment` edit | no | Whether Write With AI answers now |
| `POST /recruitment/vacancies/assist` | `JdDraftRequest` → `JdDraft` | `recruitment` edit | no | `jd-draft`; nothing kept |
| `POST /recruitment/vacancies/:id/assist/questions` | `EmptyBody` → `QuestionsDraft` | `recruitment` edit · all/team | no | `screening-questions`; nothing kept |
| `GET /recruitment/candidates/summary` | `CandidateSummaryQuery` → `CandidatesSummary` | `recruitment` view · all/team | no | Filter `vacancy_id` |
| `GET /recruitment/candidates` | `CandidateListQuery` → `CandidatePage` | `recruitment` view · all/team | yes | Filters `stage`, `vacancy_id`, `status`, `q`; sort `weighted_total`, `score`, `applied_at`, `current_stage_entered_at` |
| `GET /recruitment/candidates/:id` | `CandidateDetail` | `recruitment` view · all/team | no | `:id` is the application |
| `GET /recruitment/candidates/:id/cv` | file | `recruitment` view · all/team | no | Streamed by the vault; 409 while the scan is pending, never once infected |
| `POST /recruitment/candidates/:id/move` | `CandidateMove` → `CandidateDetail` | `recruitment` edit · all/team | no | §6.3 |
| `POST /recruitment/candidates/:id/not-progressed` | `CandidateNotProgressed` → `CandidateDetail` | `recruitment` edit · all/team | no | Reason required |
| `POST /recruitment/candidates/:id/reopen` | `EmptyBody` → `CandidateDetail` | `recruitment` edit · all/team | no | Back to active, at the stage it left |
| `POST /recruitment/candidates/:id/score` | `EmptyBody` → `CandidateDetail` | `recruitment` edit · all/team | no | `cv-screen`, Deep Reasoning |
| `POST /recruitment/candidates/score-all` | `ScoreAll` → `ScoreAllQueued` | `recruitment` edit · all/team | no | Screen With AI: the one to three must-meet conditions are kept on the vacancy (left out, the kept ones are used again), then every active, unscored application of it is read through the outbox |
| `POST /recruitment/candidates/invitations` | `ApplyInvite` → `ApplyInviteSent` | `recruitment` create | no | Emails an Apply link |
| `GET /recruitment/candidates/emails` | `CandidateEmailListQuery` → `CandidateEmailPage` | `recruitment` view | yes | The five candidate emails, each with its current version |
| `GET /recruitment/candidates/emails/:key`, `PUT .../:key` | `CandidateEmailParams`; `CandidateEmail`, `CandidateEmailSave` | view; edit · all | no | Subject and Markdown body saved as the next version, checked against the email's variables. Saved only with edit over every vacancy (scope all), as each goes to every candidate |
| `POST /recruitment/candidates/emails/:key/restore` | `EmptyBody` → `CandidateEmail` | `recruitment` edit · all | no | Restore Default: the shipped wording saved as the next version |
| `GET /recruitment/assessments/summary` | `AssessmentsSummary` | `recruitment` view | no | |
| `GET /recruitment/assessments` | `AssessmentListQuery` → `AssessmentPage` | `recruitment` view | yes | Filters `type`, `active`, `q` |
| `GET /recruitment/assessments/:id` | `AssessmentDetail` | `recruitment` view | no | Questions with their points |
| `POST /recruitment/assessments`, `PATCH /:id` | `AssessmentCreate`, `AssessmentEdit` → `AssessmentDetail` | create; edit | no | |
| `PUT /recruitment/assessments/:id/questions` | `AssessmentQuestionsSave` → `AssessmentDetail` | `recruitment` edit | no | Refused once it has been sent (409 `ASSESSMENT_IN_USE`) |
| `POST /recruitment/assessments/:id/activate`, `/deactivate` | `EmptyBody` → `AssessmentDetail` | `recruitment` edit | no | Activate needs at least one question |
| `POST /recruitment/assessments/assist` | `AssessmentDraftRequest` → `AssessmentDraft` | `recruitment` edit | no | `assessment-questions`; nothing kept |
| `GET /recruitment/assessments/:id/export` | `AssessmentExport` | `recruitment` export | no | One assessment and its questions with points, as a file |
| `POST /recruitment/assessments/import` | `AssessmentExport` → `AssessmentDetail` | `recruitment` create | no | A new, inactive assessment from such a file |
| `GET /recruitment/assessments/sittings` | `SittingListQuery` → `SittingPage` | `recruitment` view · all/team | yes | Filters `status`, `application_id`, `marking` |
| `GET /recruitment/assessments/sittings/:id` | `SittingDetail` | `recruitment` view · all/team | no | Answers, with points |
| `POST /recruitment/assessments/sittings` | `SittingSend` → `SittingDetail` | `recruitment` edit · all/team | no | §6.7 |
| `POST /recruitment/assessments/sittings/bulk` | `SittingSendBulk` → `SittingSendBulkResult` | `recruitment` edit · all/team | no | Send to Candidates: every active candidate of one vacancy at one stage with no live sitting of it |
| `PUT /recruitment/assessments/sittings/:id/marks` | `SittingMarks` → `SittingDetail` | `recruitment` edit · all/team | no | Written and file answers |
| `POST /recruitment/assessments/sittings/:id/cancel` | `EmptyBody` → `SittingDetail` | `recruitment` edit · all/team | no | Before it is submitted |
| `GET /recruitment/interviews` | `InterviewListQuery` → `InterviewPage` | `recruitment` view · all/team/panel | yes | Filters `when` (upcoming, past), `status`, `mine`, `application_id`, `q` |
| `GET /recruitment/interviews/:id` | `InterviewDetail` | `recruitment` view · all/team/panel | no | Blind while open (§6.6) |
| `POST /recruitment/interviews` | `InterviewSchedule` → `InterviewDetail` | `recruitment` edit · all/team | no | |
| `PATCH /recruitment/interviews/:id` | `InterviewReschedule` → `InterviewDetail` | `recruitment` edit · all/team | no | New time, place or panel; invites resent |
| `POST /recruitment/interviews/:id/cancel` | `InterviewCancel` → `InterviewDetail` | `recruitment` edit · all/team | no | |
| `PUT /recruitment/interviews/:id/feedback` | `FeedbackSave` → `InterviewDetail` | `recruitment` view · panel | no | The caller's own draft |
| `POST /recruitment/interviews/:id/feedback/submit` | `EmptyBody` → `InterviewDetail` | `recruitment` view · panel | no | Locks it; the last one closes the round |
| `POST /recruitment/interviews/:id/close` | `EmptyBody` → `InterviewDetail` | `recruitment` edit · all/team | no | |
| `PUT /recruitment/interviews/:id/details` | `RoundDetailsSave` → `InterviewDetail` | `recruitment` edit · all/team | no | Candidate Details on the card, before or during the round; a field sent empty is cleared |
| `PUT /recruitment/interviews/:id/report` | `RoundReport` → `InterviewDetail` | `recruitment` edit · all/team, or the hiring manager | no | Closed rounds only; generates the form PDF |
| `GET /recruitment/interviews/:id/cv` | file | `recruitment` view · panel or scope | no | The candidate's CV, for the panel |
| `GET /recruitment/pool/summary` | `PoolSummary` | `recruitment` view · all/team | no | In the pool, invited back, hired from the pool, average score |
| `GET /recruitment/pool` | `PoolListQuery` → `PoolPage` | `recruitment` view · all/team | yes | Filters `q`, `invited`; sort `created_at`, `score`, `expires_at` |
| `POST /recruitment/pool` | `PoolAdd` → `PoolEntry` | `recruitment` create · all/team | no | From an application, with a reason |
| `POST /recruitment/pool/:id/invite` | `PoolInvite` → `PoolEntry` | `recruitment` edit · all/team | no | An Apply link to an open vacancy |
| `POST /recruitment/pool/:id/remove` | `PoolRemove` → `PoolEntry` | `recruitment` delete · all/team | no | Taken off the pool before their time |
| `POST /recruitment/pool/exports` | `PoolExportRequest` → `ExportFile` (202) | `recruitment` export · all/team | no | The whole filtered pool as a workbook, made in the worker, downloaded on the device that pressed Export |
| `POST /recruitment/interviews/assist` | `NotesTidyRequest` → `NotesTidy` | `recruitment` view | no | `interview-notes-cleanup`; nothing kept |
| `GET /api/public/v1/jobs` | `PublicJobListQuery` → `PublicJobPage` | public | yes | `open` and not past its closing time |
| `GET /api/public/v1/jobs/:slug` | `PublicJob` | public | no | Draft is 404; paused and closed say so; an open role past its closing time reads closed. Names how many have applied (`applicants`) |
| `POST /api/public/v1/jobs/:slug/apply` | `EmptyBody` → `ApplyStarted` | public, rate limited | no | Mints the Apply token |
| `GET /api/public/v1/apply/:token` | `ApplyLink` | `application.apply` token | no | The role, its questions, when the link lapses |
| `POST /api/public/v1/apply/:token/cv` | multipart → `DocumentRef` | `application.apply` token | no | Purpose `cv` (PDF or Word, 10 MB), quarantined and kept against the link until the application is made (`vault.adopt`) |
| `POST /api/public/v1/apply/:token` | `ApplicationSubmit` → `ApplicationReceipt` | `application.apply` token, spent | no | Write only |
| `GET /api/public/v1/assess/:token` | `AssessmentSession` | `assessment.take` token | no | `ends_at` and `server_now` for the timer |
| `POST /api/public/v1/assess/:token/start` | `EmptyBody` → `AssessmentSession` | `assessment.take` token | no | |
| `PUT /api/public/v1/assess/:token/answers/:question_id` | `AnswerSave` → `AnswerSaved` | `assessment.take` token | no | 409 `TIME_UP` after `due_at` |
| `POST /api/public/v1/assess/:token/answers/:question_id/file` | multipart → `AnswerSaved` | `assessment.take` token | no | Purpose `assessment_answer`, at most 25 MB, quarantined; a larger file is a link given as the answer |
| `POST /api/public/v1/assess/:token/submit` | `EmptyBody` → `AssessmentSession` | `assessment.take` token | no | |

## 6 · Rules and calculations

### 6.1 Vacancies

- The lifecycle is draft → open ⇄ paused → closed; draft and paused may also close. Publish needs a
  title, department, hiring manager, location (unless remote), description of at least 80 characters,
  requirements of at least 20 and a closing time in the future. Resuming a paused vacancy whose closing
  day has passed is refused on Closes On ("Its closing day has passed"): pick a new day, then resume.
- A remote vacancy has no place: switching one to remote removes it. The hiring manager must be an
  active employee in the writer's scope; a vacant seat holds one live (draft, open or paused) vacancy.
- The slug is made once, at first publish, from the title and the location's city
  (`content-producer-lagos`), with `-2`, `-3` on a clash, made while holding a lock on that base so two
  roles published at once cannot take the same one. It never changes: pausing, resuming and
  editing keep the same link (MILESTONES §9; GE 04/11/2026, the slug replaces the token for listed
  roles). A draft has a slug only once published.
- `/jobs` lists vacancies that are `open` and whose `closes_at` is later than now. `/jobs/<slug>` answers
  an open, paused or closed vacancy with its `state`; a draft, or a slug that never existed, is the same
  404. A closed vacancy says it is closed; one closed as filled says it was filled; an open one past its
  closing time reads closed.
- `closes_at` is picked as a day and stored as the end of that day in Lagos (23:59:59). Past it, the
  vacancy stays `open` on the staff screens with a Closing Date Passed chip and takes no new applications.
- The salary band is shown publicly only when `salary_visible`; otherwise the public shape omits both
  numbers (an omission, not a null).
- A vacancy follows MyCity's job description (Head, Sales & Revenue, shared 04/11/2026): department,
  reports to, location, employment type with its arrangement ("Hybrid, 2 days in office, 3 from
  home": `work_pattern` with `work_pattern_note`), working days (`working_days`, "Monday to
  Saturday"), About MyCityApp (the company paragraph from Careers Settings, the same on every role),
  then the role's own description in Markdown: role overview, key responsibilities as numbered
  sections, how the role is measured (its KPIs); then Required Experience and Qualifications
  (`requirements`) and What We Are Looking For (`nice_to_have`). `min_experience_years` is the "8+
  years" of the requirements. Write With AI (`jd-draft`) drafts in that shape from the About MyCityApp
  text it is given (never a description of the company of its own), and the public page
  renders the Markdown through the one safe renderer (`shared/documents/markdown`).
- A new vacancy gets the five scorecard rows at 15, 15, 25, 20, 25, all on, and its interview traits
  from the Default Traits. Each part is switched on or off for the role (TB, 04/11/2026); a part switched
  off has weight 0, and the weights of the parts on are whole numbers summing to 100. At least
  screening or interview is on. Weights are whole numbers sent as numbers; an empty weight is refused,
  never read as 0.
- Careers Settings shape every vacancy, so saving them needs `recruitment` edit over every vacancy
  (scope all); a hiring manager reads them.

### 6.2 Applying

- The Apply token is single use, lives 48 hours (7 days when staff invite), and is spent in the same
  transaction as the application. `POST /jobs/:slug/apply` is refused (the same 404) unless the vacancy
  takes applications now. It is held to the public surface's write limit per address.
- The CV is a PDF or Word file of at most 10 MB, sent by the stranger and so quarantined until ClamAV
  passes it. It belongs to the token's vacancy; a CV uploaded on another token is refused.
- The candidate is found by email (case-insensitive) or created. Their name and phone are updated
  from the newest application. A second application by the same email to the same vacancy does not
  create anything: it answers the first application's reference and changes nothing, so the form
  cannot be used to learn whether someone applied.
- The answer is an acknowledgement and a reference (`APP-0001`), never the row: no score, no stage.
- The privacy notice must be accepted (`consented_at`); an application without it is refused.

### 6.3 The pipeline

- Stages in M4: `application`, `screening`, `assessment`, `interview`, `shortlist`. A card moves to any
  stage ahead of it or one back. The board leaves out Assessment when none of the vacancy's three
  assessment parts is on, and Interview when the interview part is off. Offer and the stages after it are M5's; until M5 ships, Shortlist is
  the last column and Move to Offer is not offered (GE, 04/11/2026).
- Not Progressing sets `status` `not_progressed` with a reason of at least 10 characters, records the
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
  picker, and the API refuses anyone else (422 on `panel_employee_ids`).
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
- Panelists may open the candidate's CV from the card (the vault's check passes for a seat on the
  panel).
- The round closes when its last panelist submits, or on Close Round (`recruitment` edit). A closed round
  does not reopen; a card cannot be changed after Submit.
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
  lives until the start-by day (1 to 14 days, default 3) at 23:59 Lagos; once started it lives until the
  sitting ends at `due_at`, so a test started at 23:30 on its start-by day, or a brief due days later,
  keeps its link (GE · (Ose), 04/11/2026). Ending the sitting spends it. Marks and option points are numbers; an empty
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
  session returns `ends_at` and `server_now`, and an answer after `due_at` is refused with `TIME_UP`.
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
`candidate-not-progressed`. They go through system mail from the outbox, paced like all system mail;
while mail is paused they wait. Staging sends real mail marked `[STAGING]` (A4); its seed applies only
with test addresses.

### 6.9 The Talent Pool

- Add to Pool takes an application (any status) and a reason of at least 5 characters. A candidate is in
  the pool once at a time; adding them again updates the reason and the 24 months.
- A member is kept until `expires_at`, 24 months from when they were added; `talent-pool-purge` (daily)
  sets `removed_at` on those past it. Remove does the same early. Removed members are not listed.
- Invite to Apply sends an `apply-invite` for an open vacancy and stamps `invited_at` and the vacancy; the
  application it leads to has source `pool`. Hired From the Pool counts members with a later application
  of source `pool` at stage hired.
- The score shown is the screening score of the application they were added from, with Provisional when
  it is the estimate.

## 7 · Events, jobs and notifications

| Event / job | When | Does |
|---|---|---|
| `vacancy.created`, `vacancy.updated` | after save | audit |
| `vacancy.published`, `vacancy.paused`, `vacancy.resumed`, `vacancy.closed` | after the move | audit; Home's card refreshes |
| `vacancy.questions_saved`, `vacancy.scorecard_saved` | after Questions or Scorecard is saved | audit |
| `recruitment.careers_settings_saved` | after Careers Settings is saved | audit |
| `application.received` | after an application commits | outbox: `application-received` to the candidate; notice to the hiring manager (`recruitment.application_received`) |
| `application.invited` | after Invite to Apply | outbox: `apply-invite` |
| `application.moved` | after a move | audit; the card refreshes |
| `application.not_progressed` | after Not Progressing | outbox: `candidate-not-progressed` |
| `application.score_requested` | Screen With AI, one per application | outbox: the AI read (§6.4), one at a time |
| `application.scored` | after an AI read is kept | audit |
| `application.reopened` | after Reopen | audit; the card refreshes |
| `recruitment.candidate_email_saved` | a candidate email reworded, or its default restored | audit |
| `assessment.sent` | after Send | outbox: `assessment-invite` |
| `assessment.submitted`, `assessment.timed_out` | at the end of a sitting | auto-scoring: scored at once when nothing waits for a mark (an unanswered question counts zero) |
| `assessment.to_mark` | a finished sitting has written or file answers to mark | notice to the vacancy's hiring manager, by application number, never the candidate's name |
| `assessment.created`, `.updated`, `.questions_saved`, `.activated`, `.deactivated`, `.imported`, `.started`, `.expired`, `.cancelled`, `.marked` | after the write | audit |
| `assessment.scored` | when the last mark is given | audit; scorecard refreshes |
| `interview.scheduled`, `interview.rescheduled`, `interview.cancelled` | after save | outbox: the calendar entry and its invites to panelists; `interview-invite` with `.ics` to the candidate (a cancel sends the `.ics` cancel; a change of panel alone sends the candidate nothing); reminders scheduled or cancelled |
| `interview.feedback_submitted` | after Submit Card | audit |
| `interview.round_closed` | the last submit, or Close Round | notice to the hiring manager (`recruitment.round_closed`) |
| `interview.reported` | after the report is saved | outbox: the Interview Assessment Form PDF (`documents.generate`) |
| `talent_pool.added`, `talent_pool.invited`, `talent_pool.removed` | after the write | audit; `apply-invite` on invite |
| `talent-pool-purge` (scheduler, daily) | always | removes members past their 24 months |
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
  - `jd-draft`, Write With AI on New Vacancy: Default.
  - `screening-questions`, Suggest With AI on a vacancy's questions: Default.
  - `cv-screen`, Score With AI: Deep Reasoning (`ai-control.md` §6.2 names this case).
  - `assessment-questions`, Suggest With AI on an assessment's questions: Default.
  - `interview-notes-cleanup`, Tidy With AI on a panelist's comments: Default.
  All personal data, all shown as a draft the person accepts; AI Is Off and AI Limit Reached hide the
  button and say why behind help.
- **AI reads** (`<module>.ai.js`, paged at 25, `recruitment` view, the same scope as the screens):
  `vacancies.list` (open roles, applicants, closing dates), `candidates.list` (by vacancy and stage,
  weighted total, provisional flag), `interviews.list` (upcoming, awaiting feedback, blind as §6.6),
  `assessments.sittings` (awaiting marking); `vacancies.get` (one vacancy with its questions and
  scorecard). No summary is declared. A card or a read never names a vacancy outside the asker's scope,
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

## 10 · On screen and mobile

### 10.1 Content tiers

| Screen | Open (tier 1) | Behind help (tier 2) | Not on screen (tier 3), lives in |
|---|---|---|---|
| Recruitment · Vacancies (`vacancies`) | Four KPIs (Open Vacancies, Applicants, In Interview, Past Closing Date); the list: role, department, location, applicants, closes, status; Suggested From Organogram (title, department, Create Vacancy); the funnel; New Vacancy, Careers Page, Candidate Emails, Careers Settings. A vacancy's sheet: details, public link with Copy Link, Edit, Publish or Pause or Resume, Close, Questions, Scorecard, See Candidates | Help term on Scorecard: "Switch off a part this role skips. The parts left on add up to 100." Help on Paused: "Takes no applications. The link keeps working." | The slug rule, the lifecycle, why a paused role keeps its link: §6.1 here, the manual |
| Recruitment · Candidates (`candidates`) | Four KPIs (Candidates, To Screen, In Interview, Shortlisted); vacancy filter; the board's five columns, each card: name, role, screening score with Provisional, days at stage; the sheet: details, CV, answers, Screening (score, Provisional, the AI summary), Scorecard (parts, weighted total, "n of m parts"), assessments, interviews, Stage History; Score With AI, Send Assessment, Schedule Interview, Not Progressing, Reopen, Add to Pool, Move to <Stage>, Invite to Apply, Screen With AI (asks one to three must-meet conditions) | Help term on Provisional: "Worked out from the form only. Press Score With AI to read the CV." Help on Weighted Total: "From the parts scored so far, with this role's weights." | The two-tier scoring design and why a score never moves anyone: §6.4 here |
| Recruitment · Assessments (`assessments`) | Four KPIs (Active, Sent, Awaiting Marking, Average Score); Assessments list: name, type, minutes, questions, sent, average, status; Sittings: candidate, assessment, state, score; New Assessment; an assessment's sheet with its questions and points, Edit, Questions, Activate or Deactivate; Send to Candidates; a sitting's sheet with each answer (a file to open, or the link given) and Mark Answers | Help on Points: "What each option scores." | How the timer and resume work: §6.7, the manual |
| Recruitment · Interviews (`interviews`) | Upcoming and Past; each row: candidate, role, when, panel submitted out of total, round state; the interview's sheet: when, where or link, Candidate Details, panel with Submitted or Waiting, traits with each rating and the average only once closed, total, report and decision, Download Form; My Card (traits as ten stars, decision, comments, private notes, View CV), Submit Card, Close Round, Write Report, Schedule Interview, Reschedule, Cancel | Help on Waiting: "Ratings show when every panelist has submitted or the round is closed." Help on Private Notes: "Only you ever see these." | The blind predicate and its reasons: §6.6 here |
| Recruitment · Talent Pool (`talent-pool`) | Four KPIs (In the Pool, Invited Back, Hired From the Pool, Average Score); the list: candidate, applied for, score with Provisional, added, reason, kept until, Invite to Apply or Invited; Export | Help on Kept Until: "Removed from the pool on this date." | The 24 month rule and the purge job: §6.9 |
| Careers (`/jobs`) | Work With Us; open roles with department, area and arrangement; search above 8 roles | None | Indexing, slugs: §6.1 |
| Vacancy (`/jobs/<slug>`) | Title; department, area, arrangement, salary when shown; employment type, probation, reports to; summary, Must Have, Nice to Have, How We Hire; Apply for This Role; a paused or closed banner | None | Why a paused link still works: §6.1 |
| Apply (`/apply/<token>`) | The form and its fields; the vacancy's own questions; the privacy notice with its tick; Submit Application; the receipt with the reference | None | Write-only, no score: §6.2 |
| Assessment (`/assess/<token>`) | Intro: type, minutes, questions, instructions, Start the Assessment; running: question n of m, the timer, the answer (for a file question: Upload a File, up to 25 MB, or Paste a Link), Saved, Back, Next Question, Finish, then Submit Assessment to confirm; submitted or time up | The resume note under the timer (open the same link again to continue where you were); help on Paste a Link: "For anything over 25 MB: a Google Drive, video or portfolio link anyone can open." | Server clock, autosave mechanics: §6.7 |

### 10.2 Phone layout

| Screen | First on a phone | Left off a phone | Main action | Navigation |
|---|---|---|---|---|
| Recruitment · Vacancies (`vacancies`) | Two KPI cards a row, then vacancy cards (role, status pill, applicants, closes) | The funnel chart; Department and Published columns | New Vacancy in the floating button; a vacancy opens in a sheet with its actions full width at the foot | Bottom bar; the Recruitment tabs along the top |
| Recruitment · Candidates (`candidates`) | Vacancy filter, then one stage at a time as a segmented control with the stage's cards | Drag between columns (Move To in the sheet instead); the score distribution | A tapped card opens its sheet; Move to <Stage> full width at its foot | Bottom bar; the Recruitment tabs |
| Recruitment · Assessments (`assessments`) | Assessments and Sittings as a segmented control; cards | The average-by-assessment chart | New Assessment in the floating button; Mark Answers in a sitting's sheet | Bottom bar; the Recruitment tabs |
| Recruitment · Interviews (`interviews`) | Upcoming first as cards (candidate, when, panel n of m) | Past behind the segmented control; the activity trail | A tapped interview opens its sheet; My Card full width, opening as its own full sheet, one trait a row with ten 44 px stars, in two rows of five (ten do not fit 390 px) | Bottom bar; the Recruitment tabs |
| Recruitment · Talent Pool (`talent-pool`) | Two KPI cards a row, then pool cards (name, applied for, score, kept until) | Added and Reason columns (in the sheet) | A tapped card opens its sheet with Invite to Apply full width | Bottom bar; the Recruitment tabs |
| Careers, Vacancy, Apply, Assessment | One column, full width buttons, 44 px targets | Nothing | Apply, Submit, Next Question | The public site's own header |

## 11 · Edge cases

- **A double press on Submit Application**: the token is locked and spent in one transaction; the second
  press finds it spent and gets the same receipt by reference lookup on the candidate's email.
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
  shown, with a help term saying why; everything else works.
- **Staging**: real mail is marked `[STAGING]`; the staging seed uses `@example.test` candidates only.

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
  on staging only (§6.7). MyCity's documents are not kept in this repository, which is public: the ten
  traits (§3) and the job description shape (§6.1) named here are MyCity's generic forms, with no
  person or candidate in them.
- Candidate mail volume against the 40 an hour pace on production: the mail plan upgrade is with MyCity's
  management and Operations & People (meeting of 21/10/2026).
- Whether the careers page is linked from mycityapp.io (10/10/2026, open with MyCity).
- How long candidates' data is kept after a decision (NDPR): not discussed; nothing is deleted in M4.

## 14 · Change log

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
