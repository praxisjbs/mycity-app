# M4 Recruitment · Build Handoff

**Start here if you are working on M4.** Several people build this branch at once, each on a package
of their own (§5). This file is the board: what was asked, the decisions taken (do not ask them
again), the packages with who holds each, the rules for sharing one branch, and a dated log. The
design itself is `docs/guides/recruitment.md`; read it before you touch code.

| | |
|---|---|
| Branch | `m4/recruitment` (everyone pushes here; the PR targets `main`) |
| Pull request | #72, merged 06/11/2026. Follow-ups go on a new draft PR from this same branch (draft: GitHub runs no CI on a draft, so run the checks yourself, §6) |
| Owner | GE (Godwin-Okoh Elisha), full ownership from 04/11/2026; packages claimed by whoever builds them |
| Type | Full stack (CLAUDE.md step 1) |
| Started | 04/11/2026 |

---

## 0 · How to work on this branch

1. **Get the branch.** `git fetch origin m4/recruitment && git checkout m4/recruitment && git pull --rebase`.
2. **Read.** This file, then `docs/guides/recruitment.md` in full, then what CLAUDE.md step 2 asks for
   your package's type.
3. **Claim a package** in §5 whose "Needs" are all ticked: put your initials and the date in its
   Claimed column, commit only that line (`docs(recruitment): GE claims P4`), and push at once, so
   nobody else starts it. If the push is refused, pull and look again: someone may have claimed it.
4. **Stay inside your package's files** (§5, "Files"). The shared files in §5.2 are edited by anyone,
   in small hunks, by the rules there.
5. **Commit small and often, push often.** Before every push: `git pull --rebase`, then the checks
   for what you touched (§6). Never `push --force` on this branch, never rewrite pushed commits.
6. **Finish the package:** tick it in §5 with the date, add a line to §7, push. If you change the
   design, change the guide first (with a Change log line) and say so in §7.
7. **Stuck or blocked:** write it in §4 with your initials, push, and tell GE.

Never re-open §2. A decision that must change goes to GE, and the guide changes first.

---

## 1 · What was asked

The whole of MILESTONES §9, by Friday 06/11/2026 (GE's team target; the milestone's own window is 2 to
13 November): vacancies with an AI-drafted description on a public careers page, applications with a
CV and a provisional score, AI screening, timed tests and untimed briefs on the public site, blind panel interviews
with a consolidated report, the weighted scorecard, AI cleanup of interview notes, time at stage. GE
asked for it to be built bit by bit so no detail is missed, by several people on this branch at once
(04/11/2026).

On `main` before this branch: migration `4000` and seed `4099`; the staff screens
(`app/src/features/recruitment/`) and the public pages (`public-app/`) built against the in-browser mock
with INTERIM types; every backend file of the four modules empty; no contract, guide or chapter.

---

## 2 · Decisions (binding; GE, 04/11/2026)

1. A listed vacancy is reached by its slug (`/jobs/<slug>`), made once at first publish and never
   changed; Apply and Assess by single-use or expiring tokens. Recorded in MILESTONES §9.
2. M4's stages: application, screening, assessment, interview, shortlist; Not Progressing is a status
   at any of them, not a stage. Offer onwards is M5's (the M5 owner).
3. Candidates get email from five editable templates; the interview invite carries an `.ics`.
   Panelists get the staff calendar invite.
4. AI jobs: `cv-screen` Deep Reasoning; `jd-draft`, `screening-questions`, `assessment-questions`,
   `interview-notes-cleanup` Default. All personal data (never DeepSeek).
5. Panelists must hold `recruitment` view; the picker offers only them. A Head of Department sees any
   interview they sit on.
6. The AI reads a CV only on Score With AI or Screen With AI; the estimate is computed at submit.
7. No approval before publishing a vacancy.
8. Assessment questions: choice (auto, points per option), text and file (marked by hand).

From the internal Modules Review of 04/11/2026 (TB, GE, AJ) and MyCity's three documents shared that
evening (the Interview Assessment Format, the Graphics and Motion Design brief, the Head Sales &
Revenue job description; kept in `docs/MyCity-ERP-Documents/`, as the repository is private (GE, 05/11/2026)), all in the guide:

9. The Talent Pool (#44) is M4's, GE's; M5 is Offers and Onboarding, AJ.
10. The interview card is MyCity's form: ten traits rated 1 to 10 each, Others as comments, Candidate
    Details filled once, decision Select, On Hold or Reject; round score = panel mean × 10; the form
    generated as a PDF; panelists may open the CV. The traits live in Careers Settings, never a
    production seed (A26).
11. Screen With AI per role, after one to three must-meet conditions kept on the vacancy.
12. Scorecard parts switched on or off per vacancy; the board skips stages that are off.
13. Send to Candidates in bulk; untimed take-home assessments due by a day; file answers up to 25 MB
    (the system's limit, GE) or a https link. Researched assessments on staging only, carried to
    production by export and import (GE).
14. A vacancy follows MyCity's job description shape: `working_days`, About MyCityApp (Careers
    Settings), KPIs inside the description; New Vacancy is also a Praxis AI card.
15. The Recruitment screens are split by screen, as `people/` and `performance/` are: never the
    whole feature in one `index.tsx` (M3's `queries/index.tsx` is the example not to repeat; GE,
    05/11/2026). In `app/src/features/recruitment/`: one file per screen (`Vacancies.tsx`,
    `Candidates.tsx`, `Assessments.tsx`, `Interviews.tsx`, `TalentPool.tsx`, `CareersSettings.tsx`),
    its sheets, forms and wizards in files of their own (`VacancyWizard.tsx`, `CandidateSheet.tsx`,
    `MyCard.tsx`...), each screen's test beside it, what two screens share in `shared.tsx`, and
    `index.tsx` holding only the tabs and routes. The public pages follow the same rule in
    `public-app/src/pages/`.

Design choices taken while writing the guide (open to GE, not yet challenged): one interview per
round; each panelist rates every trait from 1 to 10 (one overall rating from 1 to 10 when the vacancy
has no traits) and the interview score is the panel's mean × 10; private notes never shown to anyone but their author; the weighted total renormalises over
the components that have a score; the CV's text is read with PDF.js (Word files are scored without
it); an Apply link lives 48 hours, 7 days when staff invite; `closes_at` is the end of the picked
day in Lagos; the staging seed uses `@example.test` candidates only.

---

## 3 · Design

`docs/guides/recruitment.md` §3 to §11. Not repeated here.

---

## 4 · Open points and blockers

- The psychometric and case-study question banks (Operations & People to send).
- Candidate mail volume against production's 40 an hour (mail plan upgrade, with MyCity's management
  and Operations & People).
- Data retention for candidates (NDPR): nothing is deleted in M4.
- GE (Ose), 04/11/2026: `npm run fe:typecheck` fails in `app/` since P3's contract change: `app/src/api/types/organisation.ts`
  imports `EmploymentType`, which `contract.gen.ts` no longer exports, and the INTERIM recruitment endpoints give
  `GET /api/v1/recruitment/vacancies` a page size of `number` where the contract says `25`. P9's files; P9 clears it
  when it moves the screens onto the contract. **Cleared by P9, 05/11/2026.**
- GE (Ose), 04/11/2026, from the audit of P7 and P8, for GE: Not Progressing revokes Apply and assessment links
  (guide §6.3) but leaves a scheduled interview standing, so the candidate keeps an invitation and a link.
  The `candidate-not-progressed` email no longer claims otherwise. Proposed: Not Progressing also cancels the
  application's scheduled interviews and sends the `.ics` cancel (P4 with P6).
- GE (Ose), 04/11/2026, for P3: Suggest With AI makes every Apply question `text`, so a suggested yes or no
  check never counts in the estimate (§6.4), and it does not tell the model how many of the 20 traits are left.
- GE (Ose), 04/11/2026, for P3 and GE: three tests fail on the branch before P7's fixes too, so `npm run ci` is
  red for everyone: `src/modules/maps/maps.test.js` expects the address registry without `vacancy.location`
  (P3 added it), `src/modules/alerts/alerts.test.js` expects the Recruitment SLA metric by TB (the audit made it
  GE), and `packages/ui/src/illustrations/CityShowcase.test.tsx` fails on its city clocks (not recruitment).

---

## 5 · Packages

### 5.1 The board

Claim one whose **Needs** are all ticked. P1, P2, P2b and P3 are done, so P4 to P6b, P9 to P11 and the
packages that need none can start. Tick a package only when its own checks pass (§6).

| Pkg | What | Files (yours alone while you hold it) | Needs | Claimed | Done |
|---|---|---|---|---|---|
| P1 | **Contract**: every request and response shape of guide §5, `TABLES` for gate 6, the public shapes; `npm run gen:contract` | `packages/contract/schemas/{vacancies,candidates,assessments,interviews}.js` (the index exports each file by itself) | none | GE · 04/11/2026 | ☑ 04/11/2026 |
| P2 | **Migrations** 4010 to 4040 and seed 4199 (application numbering): guide §4 columns, CHECKs equal to P1's enums, FK indexes, triggers, Home's indexes; drop `application_stage_history`; round trip | `migrations/4010..4040_*.sql`, `seeds/reference/4199_*.sql`, `src/shared/numbering/schemes.js` (one entry) | P1 | GE · 04/11/2026 | ☑ 04/11/2026 |
| P2b | **The review's schema**: the review's changes folded into 4010 to 4040 (interview card 1 to 10, Candidate Details, decision, form document, conditions, working days, parts on or off, untimed sittings, source `pool`) and 4060 (`talent_pool_entry`; 5000's pool tables stay unused, as 4060 runs before them), and the contract changes for them and for the Talent Pool | `migrations/4010..4040_*.sql`, `migrations/4060_*.sql`, `packages/contract/schemas/{vacancies,candidates,assessments,interviews,talent_pool}.js` | P1, P2 | GE · 04/11/2026 | ☑ 04/11/2026 |
| P3 | **Vacancies backend**: repo, service (lifecycle, slug, questions and traits, scorecard parts on or off, suggested seats, Careers Settings), routes, events, `.lifecycle`, `.slug`, `.questions`, Write With AI (`jd-draft`, `screening-questions`); public `/jobs`, `/jobs/:slug`, `POST /jobs/:slug/apply` (the token mint calls P4's service); the place owner `vacancy.location`; Home's adapter moved onto these tables with `owes` cleared; unit and integration tests | `src/modules/vacancies/*`, `src/modules/dashboard/sources/vacancies.source.js`, `tests/integration/recruitment-vacancies.test.js` | P1, P2, P2b | GE · 04/11/2026 | ☑ 04/11/2026 |
| P4 | **Candidates backend**: public Apply (`GET/POST /apply/:token`, CV upload, purpose `cv`, write-only), the pipeline machine and moves, Not Progressing and Reopen, the estimate, `cv-screen` on press and Screen With AI with conditions (outbox), the scorecard and SLA, Invite to Apply, the candidate emails and their editor; tests | `src/modules/candidates/*`, `tests/integration/recruitment-candidates.test.js` | P1, P2, P2b | GE · 04/11/2026 | ☑ 05/11/2026 |
| P5 | **Assessments backend**: definitions and questions (points in `answer_key_enc`), Suggest With AI (`assessment-questions`), sittings (send, Send to Candidates in bulk, mark, cancel; timed and untimed), export and import of an assessment, public delivery (`/assess/:token`: start, answers, file answer up to 25 MB or a link, submit), `.timer`, `.scoring`, the `assessment-expiry` scheduler; tests | `src/modules/assessments/*`, `src/jobs/...assessment-expire*`, `tests/integration/recruitment-assessments.test.js` | P1, P2, P2b | GE · 05/11/2026 | ☑ 05/11/2026 |
| P6 | **Interviews backend**: schedule, reschedule, cancel (calendar entry and invites; candidate `.ics` mail), Candidate Details, the blind card (ten traits 1 to 10, decision; the predicate of guide §6.6), the CV for the panel, submit and the closing rule, Close Round, the report and the Interview Assessment Form PDF, Tidy With AI (`interview-notes-cleanup`), the `interview-reminders` job; tests | `src/modules/interviews/*`, `templates/documents/interview-assessment-form.html`, `tests/integration/recruitment-interviews.test.js` | P1, P2, P2b | GE · 05/11/2026 | ☑ 05/11/2026 |
| P6b | **Talent Pool backend**: Add to Pool, list and summary, Invite to Apply (source `pool`), Remove, Export, the `talent-pool-purge` scheduler (24 months); tests | `src/modules/talent_pool/*`, `src/jobs/...talent-pool-purge*`, `tests/integration/recruitment-pool.test.js` | P1, P2, P2b | GE · 05/11/2026 | ☑ 05/11/2026 |
| P7 | **Words**: the five candidate emails (`templates/email/application-received.html`, `apply-invite.html`, `assessment-invite.html`, `interview-invite.html`, `candidate-not-progressed.html`) and the three prompts left (`src/services/ai/prompts/{cv-screen,assessment-questions,interview-notes-cleanup}.md`; `jd-draft` and `screening-questions` came with P3). Plain words for strangers; no dashes; Lagos dates. The variables each email may use are fixed with P4 to P6 | the eight files named | none (variables agreed with P4 to P6) | GE (Ose) · 04/11/2026 | ☑ 04/11/2026 |
| P8 | **Components**: `RatingField` (1 to 10 stars, 44 px on a phone, keyboard and touch, Forms group) and anything else the screens lack, through `npm run new:component` with header, test and gallery page; `npm run gen:components` | `packages/ui/src/...` (the new components only), `docs/COMPONENTS.md` | none | GE (Ose) · 04/11/2026 | ☑ 04/11/2026 |
| P9 | **Staff screens** on the contract: Vacancies (wizard, sheet, questions, scorecard, suggested seats, Candidate Emails), Candidates (board, sheet, scores with Provisional, scorecard, stage history), Assessments (definitions, questions editor, sittings, Mark Answers), Interviews (list, sheet, Candidate Details, My Card with ten-star traits, Close Round, report, Download Form), Talent Pool (list, sheet, Invite to Apply), Careers Settings. Desktop and phone (guide §10). INTERIM types in `app/src/api/types/recruitment.ts` replaced by the contract's; M5's tabs (Offers, Onboarding) left as they are. One file per screen, never one `index.tsx` (decision 15) | `app/src/features/recruitment/*`, `app/src/api/types/recruitment.ts` | P1 (P8 for feedback) | GE · 05/11/2026 | ☑ |
| P10 | **Staff mock**: `app/src/api/mock/modules/recruitment.ts` answering every M4 route in the contract's shapes, with the grants and data the pictures need | `app/src/api/mock/modules/recruitment.ts` | P1 | GE · 05/11/2026 | ☑ |
| P11 | **Public pages** on the contract: Careers, Vacancy (paused and closed states), Apply (the vacancy's questions, the privacy tick, `cover_letter`), Assessment (file answers); the public mock. One file per screen, never one `index.tsx` (decision 15) | `public-app/src/pages/{Careers,Vacancy,Apply,Assessment}.tsx`, `public-app/src/api/types/public.ts` (the M4 half), `public-app/src/api/mock/public.ts` (the M4 half) | P1 | GE (Ose) · 05/11/2026 | ☑ |
| P12 | **Search and AI**: `.search.js` and `.ai.js` for candidates, assessments, interviews and talent_pool (vacancies' came with P3, with the New Vacancy and Save Vacancy cards), the route map's record types, ⌘K actions; manifests (reads, routes, `not_offered`); `npm run gen:ai-catalogue`; eval cases; the matrix probes | `src/modules/*/*.search.js`, `src/modules/*/*.ai.js` (the four left), `src/shared/search/actions.js` (M4 lines) | P3 to P6 | GE · 05/11/2026 | ☑ 05/11/2026 |
| P13 | **Staging seed** `seeds/staging/55_recruitment.js` through the services: Careers Settings with MyCity's ten traits and About MyCityApp, vacancies (one shaped on the Head Sales & Revenue description), applications from `@example.test` candidates, the researched assessments and a take-home brief, sittings, a closed and an open round, pool members; its test; Home's staging vacancy rows removed | `seeds/staging/55_recruitment.js`, its test, `seeds/staging/60_home.js` and `lib/forward-rows.js` (the vacancy rows only) | P3 to P6 | GE · 05/11/2026 | ☑ 05/11/2026 |
| P14 | **User Guide** `docs/manual/recruitment.md` and `docs/manual/public-site.md` (the M4 pages), front matter `milestones: M4`, a section per screen, pictures via `npm run guide:shots -- --chapter recruitment` | `docs/manual/recruitment.md`, `docs/manual/public-site.md`, `docs/manual/img/recruitment/` | P9 to P11 (reading can start now) | GE (Ose) · 05/11/2026 | ☑ |
| P15 | **Close-out** (GE (auditor), a separate session, with a system-wide audit of M4; reports back here when done): PROGRESS #38 to #41, #44 and #80 to #83, README map, DATABASE_SCHEMA M4, guide Status, the whole `npm run ci`. GE (this session) then marks PR #72 ready for review | `docs/PROGRESS.md`, `README.MD`, `docs/DATABASE_SCHEMA.md` | all | GE (auditor) · 05/11/2026 | ☑ 05/11/2026 |
| P16 | **Owners** (GE, 05/11/2026): every milestone's owner as the team now stands, M4 GE, M5 and M8 AJ, M6 and M10 TB, M7 LA, in `MILESTONES.md` (§10 and each milestone's Owner line), `README.MD` (each module section's owner), `docs/PROGRESS.md` (the Owner column), the guides' owner lines, `.github/CODEOWNERS` and the source adapters' `OWNED BY` lines (`src/modules/dashboard/sources/*`). Owners only: no scope, decision or code changes. Kept off the M4 path so it does not slow it | the files named | none | GE · 05/11/2026 | ☑ 05/11/2026 |

### 5.2 Shared files: anyone edits, by these rules

| File | Rule |
|---|---|
| `packages/contract/contract.gen.ts` (and the app's generated copy) | Never edited, never hand-merged. After any pull that conflicts on it, take either side and run `npm run gen:contract` |
| `src/services/ai/actions.js` | One entry per AI feature, added by the package that builds it (P3 to P6), with `chosen_by: "GE"`, `chosen_at: "2026-11-04"` |
| `src/shared/route-map.js`, `src/shared/search/screens.js`, `src/shared/search/actions.js` | Only the recruitment lines; P12 owns the final state |
| `src/shared/places/owners.js` | P3 adds `vacancy.location` |
| `src/shared/documents/types.js`, `body-limits.js`, `mime-policy.js`, `packages/contract/schemas/documents.js` `UploadPurpose` | P4 adds `cv`, P5 adds `assessment_answer` |
| `README.MD` | Add your new files to the map in the same commit (README §11); `npm run check:readme-map` |
| `docs/guides/recruitment.md` | Anyone, design changes first, with a Change log line |
| `docs/PROGRESS.md` | A note under Recruitment, one line per package done. The package that builds a screen's API ticks its API column (and UI or Mobile for P9 and P11); Status, the summary counts and the final check are P15's |
| this file | Your own row in §5, your lines in §4 and §7 |

---

## 6 · Checks and environment

- Node 20 (`.nvmrc`; in a cloud session put `/opt/node20/bin` first on `PATH`). Integration tests:
  `RUN_DB_TESTS=1 DATABASE_URL=postgres://mycity:mycity@127.0.0.1:5432/mycity_test
  REDIS_URL=redis://127.0.0.1:6379/15`, with `NODE_OPTIONS=--max-old-space-size=4096`.
- Run your package's group while you work: `npm run ci -- --group=backend` (P1 to P6, P12, P13),
  `--group=frontend` and `--group=screens` (P8 to P11; screens need
  `MYCITY_CHROMIUM=/opt/pw-browsers/chromium` in a cloud session), `--group=checks` for everything.
  Or one gate: `npm run ci -- --only=<ids>` (`node scripts/ci-local.js --list`).
- Contract changes: `npm run gen:contract` and commit what it writes.
- The draft runs no CI on GitHub; the whole `npm run ci` is P15's, once, before the PR is marked ready.
- The repository is public: no real candidate, CV or name in seeds, tests, docs or pictures.
- **Do not merge #72 before P9 and P11.** A screen opens on staging once its PROGRESS row has API
  ticked (the delivery plan, F14): #38, #80 and #81 are ticked from P3, and their screens still speak
  the mock's INTERIM shapes until P9 and P11 switch them to the contract.

---

## 7 · Log

- 04/11/2026 · GE · Read the whole of `docs/` for M4 (four readers and the M4 planning documents);
  eight decisions taken with GE; guide, handoff and MILESTONES §9 note written; draft PR #72 opened.
- 04/11/2026 · GE · The handoff turned into a board of fifteen packages so several people can build
  the branch at once; P1 and P2 claimed by GE.
- 04/11/2026 · GE · P1 and P2 done. Contract: `vacancies.js` (incl. the public jobs shapes and
  `optionalWhole`, an optional whole number that reads "" as not given, never 0), `candidates.js`
  (applications, the board, scores, candidate emails, the public Apply shapes), `assessments.js`
  (definitions, sittings, marking, the public session), `interviews.js` (rounds, blind panel seats,
  feedback, report). Migrations 4010 to 4040 and seed 4199 (APP numbering; stage `rejected` retired);
  gates 3 to 6 pass, the round trip passes, migrate runs twice clean. Also: `application` in
  `schemes.js`, settings `DOC_TYPES` and labels, the demo's numbering list, `settings.test.js` counts
  25 types; `foundation.md` notes the scheme. P3 to P6 and P9 to P11 can be claimed.
- 04/11/2026 · GE · The internal Modules Review of 04/11/2026 and MyCity's three documents read in
  full (decisions 9 to 14). Guide, MILESTONES §9 and §18, PROGRESS (#44 to M4, GE; M4 9 screens, M5 4),
  README's jobs and CODEOWNERS updated. New packages P2b (GE, the review's schema and contract) and
  P6b (Talent Pool backend). P3 to P6 now need P2b too.
- 04/11/2026 · GE · P2b done (4050, since folded into 4010 to 4040): the card rated 1 to 10 with `decision` on both the card and the
  round (4040's round `recommendation` dropped, never written), Candidate Details and
  `form_document_id` on the round, `screening_conditions` and `working_days` on the vacancy, `active`
  on each scorecard part, `due_days` for untimed sittings, source `pool`. 4060: `talent_pool_entry`, a
  new table, since 4060 runs before 5000 and cannot alter 5000's `talent_pool_member` (gate 3 keeps
  this branch's files in 4000 to 4999). Contract: the same in vacancies (Careers Settings, parts on or
  off, board stages), candidates (conditions, parts), assessments (untimed, Send to Candidates,
  export and import), interviews (the card), and the new `talent_pool.js`. Round trip and migrate twice
  pass; gates 3 to 6 pass. P3 to P6 and P6b can be claimed.
- 04/11/2026 · GE · P3 done: `src/modules/vacancies` (repo, service, lifecycle, slug, questions,
  careers, draft, controller, routes, public routes, events, search, AI manifest), the place owner
  `vacancy.location`, Home's adapter owing nothing (owner GE), unit tests (15) and
  `tests/integration/recruitment-vacancies.test.js` (10). Taken from other packages because the gates
  ask for them once the module has code: P7's two prompts `jd-draft.md` and `screening-questions.md`
  (P7 still writes the other three and the emails), P12's `vacancies.search.js` and
  `vacancies.ai.js` (P12 still does the other modules' and the matrix probes). Two eval cases added.
  Found while testing: `numbering.allocate` answers `{ number, seq, period }`; a bad slug was a 422.
  Integration suites run green: recruitment-vacancies, home-*, search, ai-search, ai-matrix,
  ai-attacks, ai-cards, ai-summaries, assistant, server-boot, worker. For P4: start an application
  from the token `startApplication` mints (scope `application.apply`, subject the vacancy), and
  `vacancies.service.keepScreeningConditions(client, scope, id, conditions)` for Screen With AI.
- 04/11/2026 · GE · Audit of P1 to P3. **The M4 migrations were rewritten before merge: rebuild your
  local database** (drop and recreate it, then `npm run db:migrate`). 4050 is gone, its changes folded
  into 4010 to 4040 (round `decision`, no round `recommendation`; ratings 1 to 10; `due_days`; source
  never null, default `careers`; a draft closes without a slug); 4060 gains an `invited_at` index.
  Contract: `clearable` (an edit's empty field clears it) for VacancyEdit, VacancyChange, AssessmentEdit
  and RoundDetailsSave; at most 20 traits; VacancyDetail lists only questions in use; weights, points
  and marks are numbers; `ScoreAll.screening_conditions` optional (the kept ones reused); the invite
  mail's `duration_minutes` nullable with `due_days`; enums in CandidateSitting and CandidateInterview.
  Vacancies: remote drops the place, pay checked against what is kept, slug under a lock, one live
  vacancy a seat, suggestions and AI cards in scope, Careers Settings saved with scope all, a reworded
  answered question retired, About MyCityApp passed to the prompts; `boardStages` and `howWeHire` in
  `vacancies.lifecycle.js`. Home's adapter owes the application lifecycle again until P4. For P4:
  `keepScreeningConditions` now answers `{ row, conditions }`.
- 04/11/2026 · GE · (Ose) P7 and P8 done. Emails: the five candidate templates, rendered by
  `tests/unit/recruitment-emails.test.js` with the contract's variables (timed and untimed, in person, video,
  phone, moved, cancelled). `AssessmentInviteEmailVars` takes `duration_minutes` or `due_days`, one of the two (the audit
  made the same change; P7 adds their bounds), and `InterviewInviteEmailVars` `rescheduled`; guide change log. P4 to P6: declare each with
  `defineVariables("email", <key>, c.<module>.<Name>EmailVars)` in your events file, and pass `recipient` with the
  candidate's `first_name`. Prompts: `jd-draft` and `screening-questions` version 2 (P3's inputs with the audit's `company`);
  new, with the input each module passes to `ai.complete`:
  `cv-screen` (P4): `role` {title, department, description, requirements, nice_to_have, min_experience_years},
  `conditions` (strings), `candidate` {years_experience, cover_letter, answers: [{question, answer}]},
  `cv_text` (null when unreadable), output `CvScreenOutput`;
  `assessment-questions` (P5): `assessment_type`, `instruction`, `count`, `role` {title, description,
  requirements} or null, output `AssessmentDraftOutput`;
  `interview-notes-cleanup` (P6): `text`, output `NotesTidyOutput`. All through `redact.shield`.
  Components: `RatingField` (Forms) and `Countdown` (Display) in `packages/ui`, with tests and gallery pages;
  `docs/COMPONENTS.md` regenerated. Their actions in `src/services/ai/actions.js` are still P4 to P6's to add.
- 04/11/2026 · GE · (Ose) P7 and P8 audited by three independent reviewers and fixed. Design first, in the
  guide: an assessment link lives until `due_at` once started (§6.7); the candidate emails ship as Markdown
  (`format: markdown` in the front matter) so an edit and Restore Default keep their words and links (§6.8);
  ten stars sit in two rows of five on a phone (§10.2). Shared code: a subject is plain text ("Sales & Revenue",
  not `&amp;`); a Markdown template escapes each value once and holds its Markdown signs, so a name a stranger
  typed never becomes a link (`renderMarkdown`, in mail, documents and the Settings preview); the plain-text
  part has no layout indentation; the AI's no-gap check reads nested lists (`drafts.textsOf`); a `+` figure
  is masked as a phone only with nine digits or more ("+1500%" now reaches the CV reader). Emails: the
  interview invite says where from `in_person`, `by_video`, `by_phone` (replacing `interview_type`) with
  `place_address`; `rescheduled` reads "changed"; `duration_minutes` 5 to 240; nothing prints when an
  assessment has neither minutes nor days; not-progressed links the careers page (`careers_url`). Prompts:
  `cv-screen` 2 (no cap for a CV without text, a condition about a protected trait is not applied, `company`),
  `assessment-questions` 2 (psychometric 0 to 4, technical choice 2 points with hand-marked about a third, a
  case study's questions each stand alone, `company` and `duration_minutes`), `interview-notes-cleanup` 2
  (the writer's order kept, unclear marks kept), `jd-draft` and `screening-questions` 3; one list of
  protected traits in all five; KEPT tokens are contact details and numbers, not names. `NotesTidyOutput`
  at most 5000. Components: `Countdown` counts from when the answer arrived (a remount keeps the time), says
  the time really left, calls `onEnd` again every `retryEvery` seconds while ended, draws nothing for
  `endsAt` null, shows 00:00 on time; `RatingField` takes `disabled` and `decimals`, Home, End, Up and Down,
  is named by its Field when read only, holds values to the scale, and follows the density on desktop.
  What P4 to P6 now pass: P4, `cv-screen` gets `company` too, `cv_text` cut to a sensible length (the PDF
  text reader is still to build), `careers_url` in the not-progressed vars, a must-meet condition may be
  refused at the API when it names a protected trait; P5, `assessment-questions` gets `company` and
  `duration_minutes`, a suggestion's `null` options and max score are omitted before `AssessmentQuestionsSave`,
  `vacancy_id` is scope-checked before its role is read, Start extends the link to `due_at`; P6, the invite's
  three flags and `place_address`, no candidate email for a change of panel alone, the tidy not held to the
  no-gap check (a panelist's "[inaudible]" is theirs). The three actions still to register in `actions.js`:
  `cv-screen` Deep Reasoning, `assessment-questions` and `interview-notes-cleanup` Default.
- 05/11/2026 · GE · Decision 15: the Recruitment screens are one file per screen, as `people/` and
  `performance/` are, never the whole feature in one `index.tsx` (P9, P11). P4 claimed.
- 05/11/2026 · GE · P4 done. Apply (`candidates.apply.js`, no staff auth): the CV is stored against the link
  (entity `apply_link`) and given to the application in the same transaction (`vault.adopt`, new); the
  source is careers, or invited, or pool when the person was invited back from the pool. The board is ranked
  by the scorecard in SQL (`candidates.repo.js PART_SCORES`). `cv-screen` is registered (Deep Reasoning) and
  reads the CV's text through `services/media/pdf-text.js` (10 pages, 20,000 characters, its own process).
  Answers to Ose's notes: a condition naming a protected trait is refused with 422 (`vacancies.service
  protectedConditions`); Suggest With AI may suggest a `yes_no` Apply question and is told `traits_left`
  (`screening-questions` 4); `maps.test.js` and `alerts.test.js` follow the branch; the two `assets/`
  placeholders P7's commit removed are back (CODEOWNERS names `/assets/`). For P5: `candidates.events.js`
  declares the variables of all five candidate emails, so do not declare `assessment-invite` again; issue a
  sitting's link with `subject_type: "application_assessment"` and the sitting's id, which Not Progressing
  revokes. For P6: do not declare `interview-invite` again; register an outbox handler on
  `application.not_progressed` that cancels the application's scheduled interviews and sends the `.ics`
  cancel (guide §6.3).
- 05/11/2026 · GE · P16 added: bring every owner line in step with the team as it now stands (GE M4, AJ M5
  and M8, TB M6 and M10, LA M7). The repository goes private at the end of the week. P5 claimed.
- 05/11/2026 · GE · P5 done. The library in `assessments.authoring.js`, sittings in `.service`, the public page in
  `.delivery` (no staff auth), the clock and how a sitting ends in `.timer` (`finish()`, used by Submit, Cancel and
  `jobs/schedulers/assessment-expiry`). The assessment link is made after commit by `assessments.mail.js`, subject
  `application_assessment`, so Not Progressing stops it. `public-token.extend()` is new (shared): Start moves the
  link's end to `due_at`. For P9: a suggestion's null `options` and `max_score` are left out before
  `AssessmentQuestionsSave` (the form's job); the export answers a JSON file (`Content-Disposition`).
- 05/11/2026 · GE · P6 claimed.
- 05/11/2026 · GE · P6 done. Files: `.schedule` (with the calendar's new `createIn`, `editIn`, `cancelIn`), `.panel`,
  `.consolidate`, `.notes`, `.reminders`, `.service`, the BLIND predicate in `.repo`; the form template
  `templates/documents/interview-assessment-form.html` and `InterviewAssessmentFormVars`. Not Progressing
  cancels interviews through an outbox handler here, as P4's note asked. `candidates.service.advanceIn` is
  new: another module's step moves a candidate forward only. Next: the re-audit of P4 to P6.
- 05/11/2026 · GE · Re-audit of P4 to P6 done (three independent reviewers; their findings checked and fixed, guide
  §14 lists them). Shared changes: `public-token.resolve({ spent })` and `requirePublicToken(scope, { spent })`
  for a second press; Calendar refuses to change an entry another module keeps (`EVENT_OWNED_BY_RECORD`), and
  `cancelIn` with `asOwner` is a no-op on one already called off. Left on purpose: a candidate not progressed,
  reopened and not progressed again before the worker runs may get two emails (each a real event).
- 05/11/2026 · GE · P6b claimed.
- 05/11/2026 · GE · P6b done. Every M4 backend package is built (P3 to P6b), so every M4 screen's API column is ticked
  in PROGRESS. Invite to Apply from the pool reuses `candidates.service.inviteIn` (new; Candidates' own invite calls
  it too). Export uses the shared export engine (`talent_pool_export`, personal, built in the worker). Next on the
  board: the screens (P9, P11) and the staff mock (P10), the seed (P13), the manual (P14), close-out (P15), owners (P16).
- 05/11/2026 · GE · P6b audited and fixed (guide §14). Migration 4060 gained `talent_pool_invite`: **rebuild your
  local database** again (drop, recreate, `npm run db:migrate`). `candidates.repo invitedFromPool` now reads it.
- 05/11/2026 · GE · P12 claimed. The search providers, manifests and route map types came with P4 to P6b; left: the ⌘K actions, the eval cases and the matrix probes.
- 05/11/2026 · GE · P12 done (guide §14). For P9, the addresses the screens must answer: ⌘K opens
  `?action=new` (Vacancies, Assessments, Interviews), `?action=invite` and `?action=screen` (Candidates); the
  assistant's routes open `?new=1` (Vacancies, Assessments, Interviews), `?invite=1` (Candidates),
  `?panel=settings` and `?panel=emails` (Vacancies), `?marking=true` (Assessments, Sittings), `?mine=true`
  (Interviews). Every screen's New action is in `shared/search/actions.js`, so its `useScreenAction` label must
  read exactly: New Vacancy, Invite to Apply, Screen With AI, New Assessment, Schedule Interview.
- 05/11/2026 · GE · P9 and P10 claimed: the staff screens on the contract, one file per screen (decision 15), and the staff mock, shaped on MyCity's job description, Interview Assessment Format and assessment brief (`docs/MyCity-ERP-Documents/`).
- 05/11/2026 · GE · (Ose) P11 and P14 claimed. For GE's P9: the P14 chapter (`docs/manual/recruitment.md`, drafted)
  names these staff buttons and labels in bold, so the screens must read them exactly, or tell Ose to change the
  chapter: New Vacancy's steps **Role**, **Details**, **Pay and Publish**, with **Save Draft** and **Publish Vacancy**;
  the fields **Required Experience and Qualifications** and **What We Are Looking For** (guide §6.1); **Copy Link**,
  **See Candidates**, **Careers Page**, **Past Closing Date**, **Closing Date Passed**; **To Screen**, **Weighted
  Total**, **Send Assessment**, **Awaiting Marking**; **View CV**, **Private Notes**, **Submit Card**, **Write
  Report**, **Download Form**; **Export** and **Import** on Assessments; **Remove** on the Talent Pool; and **Quick
  Actions** for the phone's New action. Its pictures need P10 to answer `?action=new`, `?action=screen`,
  `?action=invite`, `?panel=emails`, `?panel=settings`, `?marking=true`, `?mine=true`, with Cynthia on a panel, a
  sitting awaiting marking and a card marked Provisional. P11 changes P3's `PublicJob`: its four Markdown texts
  now arrive as blocks (guide §6.1, change log).
- 05/11/2026 · GE · (Ose) P11 done: Careers, Vacancy, Apply and Assessment on the contract, the M4 mock in its shapes,
  18 page tests (PROGRESS #80 to #83: UI and Mobile ticked; Status is P15's). For everyone: `ApplicationSubmit`'s name
  message is now **First and last name** (four words, the field-error limit); `@mycity/ui` gains `SkylineHero`,
  PublicPage `layout="open"` and Wizard `level` (2 under a page's h1; 3, the default, in a modal). Apply and
  Assessment load as their own chunks: the contract schema brings Zod, which the careers pages no longer carry.
  The privacy notice's wording on Apply is mine and wants GE's or TB's eye before production.
- 05/11/2026 · GE · (Ose) P11 re-audit after the P9 and P10 merge. Fixed: a file answer's upload answered
  `AnswerSaved`, which the one upload engine reads as a failure (no `document_id`); it now answers `AnswerFileSaved`, the
  document and `saved_at` (contract, route, `answerFile`, an integration step). The public mock follows the staff mock
  (`app/src/api/mock/data/recruitment.ts`): its six vacancies with their slugs, states and places, its candidates and
  assessments. For GE's P10: the staff mock's About MyCityApp, the Head, Sales & Revenue description and the Graphics and
  Motion Design Brief are its own words, not MyCity's documents (`docs/MyCity-ERP-Documents`), which the public mock now
  uses; worth aligning. The merge commit had reformatted this file, PROGRESS and the guide (padded tables, joined lines,
  `<Stage></stage>`): rebuilt from a clean three-way merge, word for word the same content. Keep format-on-save off for
  Markdown here.
- 05/11/2026 · GE · (Ose) P14 done: both chapters checked against the P9 screens and the 18 recruitment pictures
  taken (desktop and phone). Corrected to the screens: Careers Settings' **Default Trait** fields, **Add Trait**,
  **Remove**, **Save Settings**; a sitting opens with its marks, **Mark Answers** saves them, **To Mark** filters.
  The public chapter has no pictures: `guide:shots` opens only the hub. Left on the board: P13 (staging seed), P15
  (close-out), P16 (owners).
- 05/11/2026 · GE · (Ose) The picture script has a public-app target (`site: public` in a shot spec, taken signed out
  on the public demo build); `public-site.md` has its eight pictures. Their first run caught two P11 faults, fixed:
  the upload's size said twice, and long assessment prompts set all in bold.
- 05/11/2026 · GE · P9 and P10 done. One file per tab in `app/src/features/recruitment/` (`index.tsx` routes only): `Vacancies` (with `VacancyForm`, the New Vacancy wizard; `VacancyQuestions`, Questions and Scorecard; `CareersSettings`; `CandidateEmails`), `Candidates` and `CandidateSheet`, `Assessments` and `AssessmentQuestions`, `Interviews`, `MyCard` and `ScheduleInterview`, `TalentPool`; `shared.tsx`; M5's `Offers` and `Onboarding` moved out unchanged (AJ's). My Card follows the donor's scorecard flow (each star saved as tapped and put back with the error on a failure; a second tap clears it; the panelist's own score as they go). The app holds one dialog at a time, so a form opened from a sheet returns to the sheet when it closes. The mock answers every M4 route of guide §5 in the contract's shapes, its bodies checked by the contract's own schemas; fixtures in `mock/data/recruitment.ts` from MyCity's three documents, every candidate invented (@example.test). The INTERIM M4 types are gone (`app/src/api/types/recruitment.ts` keeps only M5's), which clears the typecheck point in §4. Every address of P12 is answered and the screen actions read as ⌘K names them. Tests: five screen tests beside their tabs (15 cases); app suite, typecheck, lint and the screen gates pass. PROGRESS: UI and Mobile ticked on #38 to #41 and #44; Status left for P15. Next: P11 (public pages), P13 (seed), P14 (manual and pictures).
- 05/11/2026 · GE · For Ose's P14, the screens against the chapter's words: New Vacancy's steps now read **Role**, **Details** and **Pay and Publish**, ending **Save Draft** or **Publish Vacancy** (Publish Now on the last step chooses); **Required Experience and Qualifications** is the field's label; **What We Are Looking For** cannot be, as a field label is at most 4 words (copy rules), so the field reads **Nice to Have**: please use that in the chapter. A vacancy past its date shows **Closing Date Passed**; the figure reads **Past Closing Date**. Assessments has **Export** on an assessment's sheet; **Import** is not on screen (it needs a local file read, which the upload engine does not do): drop it from the chapter or tell me and I add it with a picker in `packages/ui`. **Quick Actions** is the shell's, not Recruitment's. Every other word on the list reads as written, and the mock answers every address the pictures need (Cynthia sits on Tobi's, Halima's and Uche's panels; Ngozi Eze's brief awaits marking; Chinedu Okafor's score is Provisional).
- 05/11/2026 · GE · P9 and P10 re-audited (three reviewers) and fixed; guide §14 lists each fix. API additions for the screens: `Candidate.next_stages`, `CareersSettings.can_edit`, `CandidateEmail.can_edit`, `VacanciesSummary.careers_url`, `GET /recruitment/pool/:id`, route map `application_assessment` → `?sitting=`, `can_close` after the start, a vault rule so the panel and the hiring manager open the Interview Assessment Form; `Kanban` cards take `moves` (packages/ui, tested). For Ose's P14, a correction to my earlier note: the field is **What We Look For** (not Nice to Have), with help naming the careers page's heading; the public page keeps **What We Are Looking For** from MyCity's job description. The chapter's step **Use Draft** is not on screen: Write With AI puts the draft straight into the form, where nothing is kept until the vacancy is saved. Please drop **Use Draft**, or tell me and I add a preview with it. **Import** stays off screen.
- 05/11/2026 · GE · **For GE (auditor), who takes P15 and the system-wide audit** (assigned by GE, 05/11/2026). Where things stand on `m4/recruitment`:
  - **Done:** P1 to P12. P9 and P10 were re-audited and fixed today (guide §14, the entry above). The backend Recruitment suites
    (82), the backend unit suite, the app's Recruitment tests (18) and the static gates pass on this commit; the frontend group
    takes over ten minutes, so run it in the background.
  - **Open on the board:** P13 (staging seed, not claimed), P14 (Ose: the chapters are in; `user-guide` fails on 18 Recruitment
    pictures not yet taken, `npm run guide:shots -- --chapter recruitment`, and two chapter words that are not on screen,
    **Use Draft** and **Import**, plus **What We Are Looking For** for the field now reading **What We Look For**), P16 (owners).
  - **Yours in P15:** Status and the summary counts in PROGRESS (UI, Mobile and API are ticked on #38 to #41, #44 and #80 to #83;
    Status left at In progress on purpose), DATABASE_SCHEMA's M4 section, the guide's Status, the README map, the whole `npm run ci`.
  - **Worth your audit's eye:** the merge of P11 re-padded every table in the guide and the handoff and turned `<Stage>` into an
    HTML tag; both are fixed, and `guides` now passes, but look for the same in any file a merge touched. Decisions kept on purpose:
    a record opens in a sheet on desktop too (as Queries, Sanctions and Performance, 29/10/2026); Import of an assessment is not on
    screen; the mock reads every role for its two recruiters (no scope narrowing); a reschedule resends the unchanged panel.
  - **Environment:** rebuild your local database since migration 4060 (`talent_pool_invite`); Postgres may need
    `pg_ctlcluster 16 main start`, Redis `redis-server --daemonize yes`; §6 has the rest.
  - When you are done, say so here and in the session; GE marks #72 ready for review.
- 05/11/2026 · GE · P13 and P16 claimed (GE asked). Once P13, P14 and P16 are in, GE nudges GE (auditor) to start P15.
- 05/11/2026 · GE · P13 done: `seeds/staging/55_recruitment.js` and `tests/integration/recruitment-staging-seed.test.js` (8 cases: the states, the traits, who is who, Apply with a CV, sittings, rounds, the pool, a second run adds nothing). Through the services and the candidate's own paths (Apply, the assessment link, Start, Submit), the links issued by the shared token service as the mail handlers do. Operations & People is the recruiter; the hiring managers and panelists are the Implementation Team's accounts only, so no recruitment notification or calendar invitation reaches MyCity's staff from staging data. Home's staging vacancies are removed by `removeHomeStagingRows` and gone from `lib/forward-rows.js` (with the open seats it read for them); their ids stay in `HOME_STAGING_ROWS`; Home's guide §11 and its seed tests follow. Run on staging with the next `scripts/db/seed.js --staging`.
- 05/11/2026 · GE · P16 done. Owners as the team now stands: M4 GE, M5 AJ (was LA), M6 TB (was LA), M7 LA (was GE); M8 AJ and M10 TB unchanged. Changed: MILESTONES (§4's table and the M5, M6 and M7 Owner lines, each saying who it was first planned as), README (§5.8 to §5.10 and §12 Team), CLAUDE.md's team line, PROGRESS's Owner column (M5, M6 and M7 rows; My Payslips stays AJ's, an ESS tab), DATABASE_SCHEMA's milestone headings (M4 read TB, now GE), CODEOWNERS (each module of M5 to M7 moved to its owner's block, its new owner first; M4's lines into GE's block), the dashboard sources' OWNED BY (payroll, partners), the attendance and Home guides, and the payroll types' note. Logs and change logs keep the owners of their day. `demo.html` and `demo (5).html` checked: they name no owner for M4 to M7 (only ESS, AJ, and attendance, LA, both unchanged). GitHub handles are the ones CODEOWNERS already lists.
- 05/11/2026 · GE · Import is on screen after all (GE chose it): **Import** on Assessments takes the exported `.json` through the upload engine (new purpose `assessment_import`: `sniff`, `mime-policy`, `body-limits`, the contract's `UploadPurpose`) and `POST /recruitment/assessments/import/file` makes it switched off. Ose: your chapter's Import steps now match the screen; keep them. This supersedes my two notes that Import stays off screen.
- 05/11/2026 · GE · P16, one more (GE): M9 Settings & Governance is TB's, who built it (first planned as GE). MILESTONES, README, CLAUDE.md, PROGRESS (its 12 screens; Attendance Policy stays LA's), DATABASE_SCHEMA, the System Health guide and the guides index, and CODEOWNERS (users, security, integrations, settings and system_health into TB's block) follow.
- 05/11/2026 · GE · (auditor) **P15 done: M4 is Built.** Five independent reviewers (vacancies, candidates and the pool;
  assessments and interviews; the screens; the flow; the documents) and a walk through the whole flow on a live stack
  (API, worker, hub and go on their own database with the staging seed): publish a role, apply on the careers page
  with a CV, the mail, the board, an assessment taken on a phone, marking, a two-person blind panel (each card hidden
  from the hiring manager until the round closed; private notes never), the report and its form PDF, shortlist, not
  progressing, the pool and Invite to Apply. Everything works now; two things did not:
  - **Apply was broken live**: the upload engine sends `purpose` beside the file and the CV and file-answer routes took
    an empty body, so no CV could be sent and no application made (tests posted without it; the pages ran on the mock).
    Fixed with `CvUpload` and `AnswerFileUpload`; the integration tests now upload as the page does.
  - **A spent Apply link said whether an email had applied** (any email sent on it got that person's reference): a
    second press is answered only for the application holding the CV it sends (guide §11).
  Also fixed (guide §14): `npm run ci` was red on the branch (AI Control's test did not know M4's five actions; the
  alerts test kept M7 as GE's after P16); Not Progressing called off an interview already held; a card with no score
  counted 0; a Head of Department could not open a file answer to mark it (vault rule, staff side); the hiring
  manager is told when a round closes; Home's SLA alert skips closed roles; Screen With AI audits its conditions; a
  part on weighs at least 1; the pool export's scope; ⌘K past 24 months; an interview's calendar entry is not
  editable on the calendar; Invite to Apply's audit link; five CVs a link under a lock; an export with a BOM imports;
  Organogram's Create Vacancy keeps the seat and needs `recruitment` create; New Vacancy, Questions and Scorecard had
  unlabelled toggles (now checkboxes); My Card, New Vacancy and Write Report ask before losing words; Schedule
  Interview searches candidates on the server; a sheet's refusal says the field's words; one filled Move To; Lagos
  dates; the funnel's scale; the form PDF's headings stay with their sections; `assessment-questions` is personal
  data (decision 4). PROGRESS (Built, counts, notes newest first), DATABASE_SCHEMA M4, the guide (Built, corrected to
  the code), README (M5's mails), the Organogram guide, and 21 User Guide pictures retaken (My Card's spec opens Tobi
  Adeyemi by name: row 1 of My Panels is a closed round, so that picture could no longer be taken). §4's points on
  Not Progressing and interviews, Suggest With AI, and the failing tests are all resolved.
  **For GE to decide** (not changed): (1) MyCity's three PDFs and `demo (5).html` are committed in
  `docs/MyCity-ERP-Documents/`, while guide §13, §2 here and the seed say the repository is public and keeps none
  (README says private); (2) closing a role with active candidates leaves them unmovable and never told
  (`VACANCY_CLOSED`): allow Not Progressing on a closed role, or have Close offer it; (3) a duplicate application
  answers the first one's reference, a gapless number that can hint someone applied before (§6.2 taken literally);
  (4) a hiring manager without `recruitment` gets notices they cannot open: require the grant, as for a panelist;
  (5) Apply's receipt promises "within five working days" (the email does not); (6) Send Assessment does not move
  the candidate to Assessment, while Schedule Interview moves them to Interview; (7) Write With AI replaces typed
  text with no undo; (8) CVs left on an Apply link are kept forever (no sweep of expired links; NDPR, disk).
  **Follow-ups** (minor, not done): the panel picker offers every employee (a panelists route; the refusal names
  nobody); the staff vacancy sheet prints raw Markdown (send blocks, draw `RichText`); Create Vacancy from the
  Organogram leaves the department to pick (no seat lookup); the last Submit Card before the interview starts closes
  the round (Close Round refuses that); a Reschedule dropping the only waiting panelist leaves a full round open;
  `TIME_UP` is unreachable (the link ends at `due_at`; extend it a day); protected phrasings such as "Ladies only",
  "Must be under 30", "Igbo only" pass; pool rows name an invited or hired vacancy outside the reader's scope; Tidy
  With AI hidden from view-only panelists; My Card's star rollback race; View CV saves a Word CV as `.pdf`; Suggested
  From Organogram shows 25 seats; Import runs unbusy; Candidate Emails and Invite's Cancel close too much; three-way
  choices as selects; the Applicants KPI (active) against the column (all); a description opening `## Role Overview`
  shows the heading twice on the careers page; an export whose first 2 KB hold `<script` is refused as markup; the
  seed finds a role by title only; staging mail to `@example.test` bounces; an old commit's
  `User-guide-unchanged: the Recruitment chapter is P14 and not written yet` trailer still prints (drop it from #72's
  body). **For Ose, the chapter against the screens:** Use Draft is not a step (Write With AI fills the form, on
  Details); the wizard's fields per step (Employment on Role, Closes On on Details, Show Salary on Careers and Publish
  Now on Pay and Publish); Score With AI cannot read a scored candidate again; Send to Candidates is on an
  assessment's sheet with Vacancy, Stage, Start Within Days and Days to Finish; Suggest With AI on an assessment asks
  nothing; Candidate Details opens with **Edit**; only stars and the decision save as tapped (words on **Save Draft**);
  Remove asks no reason; and the labels **Close Vacancy**, **Cancel Interview**, **Applied**, **View CV**, **Screen
  Applications**, **Time Up**, **My Panels**, **Edit Report**, **Pass Mark**, **Make Assessment**. "The hiring manager is
  told it has closed" is true now. `npm run ci`: see the line below.
- 05/11/2026 · GE · (auditor) `npm run ci` on eb6bb4c, `main` merged in (M3 #73, M8 #74, the M7 guide #76): **51 of 51 gates pass,** none not built, 14 min (backend suite against Postgres and Redis, frontend tests, screens with Chromium, checks). The first full run had failed one test only, `dark-theme-samples.html` stale after the public site's canvas tokens; regenerated. P14 accepted (its pictures are in, and 21 were retaken after P15's screen fixes). Over to GE: #72 can be marked ready for review; drop the old `User-guide-unchanged` line from its body.
- 05/11/2026 · GE · **The eight P15 decisions, done** (GE chose each, 05/11/2026): (1) the repository is private,
  so MyCity's three documents and `demo (5).html` stay in `docs/MyCity-ERP-Documents/` (guide §13, §2 here, the
  seed's header); (2) Close Vacancy offers **Not Progress All** while anyone is in progress (`VacancyClose.not_progress`,
  each through `candidates.notProgressIn`, so each gets the email), and Not Progressing works on a closed role
  (`CandidateDetail.can_not_progress`; moves, Reopen and Score With AI still need it open); (3) a second application
  by the same email keeps answering the reference and nothing more (guide §6.2, no change in code); (4) a hiring
  manager holds `recruitment` view through an active login ("No Recruitment access"); (5) Apply's receipt and its
  Coming Soon line promise no reply time; (6) Send Assessment and Send to Candidates move a candidate before
  Assessment to it (`candidates.advanceIn`); (7) Write With AI asks before replacing typed words (Replace Your Text);
  (8) `apply-cv-purge` (nightly, 02:47 Lagos, `candidates.retention`) removes a CV left on an Apply link a day after
  the link ended without an application. Mock, guide (§3, §5, §6.1 to §6.3, §7, §13, §14), README and the chapter's
  steps for Close, Write With AI, Not Progressing and Send Assessment follow; tests added.
- 05/11/2026 · GE · **For Ose: the Recruitment chapter against the screens** (from GE (auditor)'s P15 walk; still
  open unless marked). Steps: Use Draft is not a step, Write With AI fills the form on Details (**done** with
  decision 7 above, with **What We Look For**); the wizard's fields per step: **Employment** on Role, **Closes On**
  on Details, **Show Salary on Careers** and **Publish Now** on Pay and Publish; Score With AI cannot read a scored
  candidate again; **Send to Candidates** is on an assessment's sheet, with Vacancy, Stage, Start Within Days and
  Days to Finish; Suggest With AI on an assessment asks nothing first; Candidate Details opens with **Edit**; on My
  Card only the stars and the decision save as tapped, the words on **Save Draft**; Remove (Talent Pool) asks no
  reason; the field is **What We Look For** wherever the chapter names it (a field label is four words at most; the
  careers page keeps What We Are Looking For). Labels exactly as the screens read: **Close Vacancy**, **Cancel
  Interview**, **Applied**, **View CV**, **Screen Applications**, **Time Up**, **My Panels**, **Edit Report**, **Pass
  Mark**, **Make Assessment**. Public pages: a description that opens with `## Role Overview` shows the heading twice
  on the careers page. Retake any picture these touch (`npm run guide:shots -- --stale`).
- 05/11/2026 · GE · **Follow-ups, by owner** (minor, none blocking #72). **Ose**: the chapter list above, and the
  doubled Role Overview heading. **GE**: the panel picker offers every employee and its refusal names nobody (a
  panelists route); the staff vacancy sheet prints raw Markdown (send blocks, draw `RichText`); Create Vacancy from
  the Organogram leaves the department to pick; the last Submit Card before the start closes the round; a Reschedule
  dropping the only waiting panelist leaves a full round open; `TIME_UP` is unreachable (extend the link a day);
  protected phrasings ("Ladies only", "Must be under 30", "Igbo only") pass; pool rows name a vacancy outside the
  reader's scope; Tidy With AI is hidden from view-only panelists; My Card's star rollback race; View CV saves a Word
  CV as `.pdf`; Suggested From Organogram shows 25 seats; Import runs unbusy; Candidate Emails' and Invite's Cancel
  close too much; three-way choices are selects; the Applicants KPI (active) against the column (all); an export
  whose first 2 KB hold `<script` is refused as markup; the seed finds a role by title only; staging mail to
  `@example.test` bounces; #72's body still carries the old `User-guide-unchanged` line (dropped when it is marked
  ready).
- 05/11/2026 · GE · (Ose) **Ose's follow-ups, done.** The Recruitment chapter against the screens, every item of the
  auditor's list: the wizard's fields per step (Employment and Positions on Role; Closes On, Target Start and Write
  With AI on Details; Years of Experience, Show Salary on Careers and Publish Now on Pay and Publish), Use Draft gone,
  **What We Look For**, Score With AI reads a candidate once (*None waiting to be read*), Screen With AI's **Vacancy**,
  **Must Meet** and **Screen Applications**, Send to Candidates from an assessment's sheet with its fields, Suggest
  With AI adds five without asking, the sittings' states as the screen names them (**To Mark**, **Time Up**),
  **My Panels**, Candidate Details opens with **Edit**, My Card's **Save Draft** (only stars and the decision save by
  themselves), **Cancel Interview**, **Edit Report**, **Make Assessment**, **Pass Mark**, **View CV**, **Applied**,
  Remove asks no reason; and the fields of every form named as they read. The doubled heading: Vacancy drops a
  description's first line when it is the heading the page gives it (`TextSection`), with a test and the public
  mock's Graphics role written that way; `public-vacancy` retaken. Guide §10.1 and §14, PROGRESS note.
- 06/11/2026 · GE · **The P15 follow-ups, closed** (GE's list of 20; three agents, by area). Interviews: panelists
  route and a named refusal (`NOT_PANELISTS`); a round closes by itself only once full and started (`closeIfDone`, the
  daily `interview-reminders` run closes one full before its start); Reschedule closes a full started round; Tidy With
  AI for any panelist with a card to write; My Card's rollback per trait. Vacancies: the sheet's texts as blocks
  (`*_blocks`); Create Vacancy from a seat fills department, reports to and hiring manager; `traitsNamed` refuses
  protected phrasings; Suggested From Organogram pages; Applicants is every application. Candidates, assessments and
  pool: the take link lives a day past `due_at` (Time Up reachable; a timed-out sitting reads `timed_out`); the pool
  nulls an out-of-scope vacancy; downloads keep the server's file name (a Word CV stays `.docx`); Import Assessment is
  a footer press; Cancel on Invite and Candidate Emails goes back one step; short fixed choices are `ChoiceField`
  (filters stay `FilterSelect`); a parsing JSON file is never refused as markup. Mail: reserved domains are never
  sent. Seed: roles found by its own `vacancy.created` events. Guide (§2, §3, §5, §6.1, §6.4, §6.6, §6.7, §6.9, §10,
  §11, §14), chapter steps, the Organogram and Integrations guides follow; 18 pictures retaken. Ose's chapter list is done
  (his entry above). Left: #72's old `User-guide-unchanged` line (dropped when it is marked ready).
- 06/11/2026 · GE · `npm run ci` on 8b2ce41 (the decisions and the follow-ups, Ose's chapter in): 50 of 51 gates pass;
  the 51st, frontend tests, failed one Settings · Approvals case on a timeout under the run's load (untouched by M4);
  it passes alone twice and the whole app suite passes again (696 of 696). Every P15 decision, follow-up and chapter
  correction is closed. #72 waits only on GE's word to mark it ready (its old `User-guide-unchanged` line goes then).
- 06/11/2026 · GE · **#72 merged** (squashed as 3e7b5ed): M4 Recruitment is on `main`, and so on staging. `main` is
  merged back into this branch (no change of tree) for what comes next, on a new draft PR: GE's own findings from
  testing on staging, logged here as they come, and the hand-over to M5. AJ takes M5 (Offers and Onboarding, guide
  §2) and we talk with him in that PR's comments: what M4 gives M5 is the shortlist (stage `shortlist`, the last
  column until M5 adds Offer), the Talent Pool's Invite to Apply, and the candidate emails' store (`candidates.emails`).
