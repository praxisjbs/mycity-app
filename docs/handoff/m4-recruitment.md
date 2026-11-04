# M4 Recruitment · Build Handoff

**Start here if you are working on M4.** Several people build this branch at once, each on a package
of their own (§5). This file is the board: what was asked, the decisions taken (do not ask them
again), the packages with who holds each, the rules for sharing one branch, and a dated log. The
design itself is `docs/guides/recruitment.md`; read it before you touch code.

| | |
|---|---|
| Branch | `m4/recruitment` (everyone pushes here; the PR targets `main`) |
| Pull request | #72 (draft: GitHub runs no CI on a draft, so run the checks yourself, §6) |
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
CV and a provisional score, AI screening, timed assessments on the public site, blind panel interviews
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
2. M4's stages: application, screening, assessment, interview, shortlist (plus not progressed). Offer
   onwards is M5's (Victor).
3. Candidates get email from five editable templates; the interview invite carries an `.ics`.
   Panelists get the staff calendar invite.
4. AI jobs: `cv-screen` Deep Reasoning; `jd-draft`, `screening-questions`, `assessment-questions`,
   `interview-notes-cleanup` Default. All personal data (never DeepSeek).
5. Panelists must hold `recruitment` view; the picker offers only them. A Head of Department sees any
   interview they sit on.
6. The AI reads a CV only on Score With AI or Score All; the estimate is computed at submit.
7. No approval before publishing a vacancy.
8. Assessment questions: choice (auto, points per option), text and file (marked by hand).

From the internal Modules Review of 04/11/2026 (TB, GE, AJ) and MyCity's three documents shared that
evening (the Interview Assessment Format, the Graphics and Motion Design brief, the Head Sales &
Revenue job description; kept out of this public repository), all in the guide:

9. The Talent Pool (#44) is M4's, GE's; M5 is Offers and Onboarding, AJ.
10. The interview card is MyCity's form: ten traits rated 1 to 10 each, Others as comments, Candidate
    Details filled once, decision Select, On Hold or Reject; round score = panel mean × 10; the form
    generated as a PDF; panelists may open the CV. The traits live in Careers Settings, never a
    production seed (A26).
11. Screen All With AI per role, after one to three must-meet conditions kept on the vacancy.
12. Scorecard parts switched on or off per vacancy; the board skips stages that are off.
13. Send to Candidates in bulk; untimed take-home assessments due by a day; file answers up to 25 MB
    (the system's limit, GE) or a https link. Researched assessments on staging only, carried to
    production by export and import (GE).
14. A vacancy follows MyCity's job description shape: `working_days`, About MyCityApp (Careers
    Settings), KPIs inside the description; New Vacancy is also a Praxis AI card.

Design choices taken while writing the guide (open to GE, not yet challenged): one interview per
round; an overall rating out of 5 is required of every panelist and the interview score is its mean
times 20; private notes never shown to anyone but their author; the weighted total renormalises over
the components that have a score; the CV's text is read with PDF.js (Word files are scored without
it); an Apply link lives 48 hours, 7 days when staff invite; `closes_at` is the end of the picked
day in Lagos; the staging seed uses `@example.test` candidates only.

---

## 3 · Design

`docs/guides/recruitment.md` §3 to §11. Not repeated here.

---

## 4 · Open points and blockers

- The psychometric and case-study question banks (Cynthia).
- Candidate mail volume against production's 40 an hour (mail plan upgrade, Bode and Cynthia).
- Data retention for candidates (NDPR): nothing is deleted in M4.

---

## 5 · Packages

### 5.1 The board

Claim one whose **Needs** are all ticked. **P1 and P2 come first and block most others**: until they
are ticked, only P7, P8 and P14's reading can start. Tick a package only when its own checks pass (§6).

| Pkg | What | Files (yours alone while you hold it) | Needs | Claimed | Done |
|---|---|---|---|---|---|
| P1 | **Contract**: every request and response shape of guide §5, `TABLES` for gate 6, the public shapes; `npm run gen:contract` | `packages/contract/schemas/{vacancies,candidates,assessments,interviews}.js` (the index exports each file by itself) | none | GE · 04/11/2026 | ☑ 04/11/2026 |
| P2 | **Migrations** 4010 to 4040 and seed 4199 (application numbering): guide §4 columns, CHECKs equal to P1's enums, FK indexes, triggers, Home's indexes; drop `application_stage_history`; round trip | `migrations/4010..4040_*.sql`, `seeds/reference/4199_*.sql`, `src/shared/numbering/schemes.js` (one entry) | P1 | GE · 04/11/2026 | ☑ 04/11/2026 |
| P2b | **The review's schema**: migrations 4050 (interview card 1 to 10, Candidate Details, decision, form document, conditions, working days, parts on or off, untimed sittings, source `pool`) and 4060 (talent pool member columns), and the contract changes for them and for the Talent Pool | `migrations/4050_*.sql`, `migrations/4060_*.sql`, `packages/contract/schemas/{vacancies,candidates,assessments,interviews,talent_pool}.js` | P1, P2 | GE · 04/11/2026 | ☐ |
| P3 | **Vacancies backend**: repo, service (lifecycle, slug, questions and traits, scorecard parts on or off, suggested seats, Careers Settings), routes, events, `.lifecycle`, `.slug`, `.questions`, Write With AI (`jd-draft`, `screening-questions`); public `/jobs`, `/jobs/:slug`, `POST /jobs/:slug/apply` (the token mint calls P4's service); the place owner `vacancy.location`; Home's adapter moved onto these tables with `owes` cleared; unit and integration tests | `src/modules/vacancies/*`, `src/modules/dashboard/sources/vacancies.source.js`, `tests/integration/recruitment-vacancies.test.js` | P1, P2, P2b | | ☐ |
| P4 | **Candidates backend**: public Apply (`GET/POST /apply/:token`, CV upload, purpose `cv`, write-only), the pipeline machine and moves, Not Progressing and Reopen, the estimate, `cv-screen` on press and Screen All With AI with conditions (outbox), the scorecard and SLA, Invite to Apply, the candidate emails and their editor; tests | `src/modules/candidates/*`, `tests/integration/recruitment-candidates.test.js` | P1, P2, P2b | | ☐ |
| P5 | **Assessments backend**: definitions and questions (points in `answer_key_enc`), Suggest With AI (`assessment-questions`), sittings (send, Send to Candidates in bulk, mark, cancel; timed and untimed), export and import of an assessment, public delivery (`/assess/:token`: start, answers, file answer up to 25 MB or a link, submit), `.timer`, `.scoring`, the `assessment-expire` scheduler; tests | `src/modules/assessments/*`, `src/jobs/...assessment-expire*`, `tests/integration/recruitment-assessments.test.js` | P1, P2, P2b | | ☐ |
| P6 | **Interviews backend**: schedule, reschedule, cancel (calendar entry and invites; candidate `.ics` mail), Candidate Details, the blind card (ten traits 1 to 10, decision; the predicate of guide §6.6), the CV for the panel, submit and the closing rule, Close Round, the report and the Interview Assessment Form PDF, Tidy With AI (`interview-notes-cleanup`), the `interview-feedback-reminder`; tests | `src/modules/interviews/*`, `templates/documents/interview-assessment-form.html`, `tests/integration/recruitment-interviews.test.js` | P1, P2, P2b |
| P6b | **Talent Pool backend**: Add to Pool, list and summary, Invite to Apply (source `pool`), Remove, Export, the `talent-pool-purge` scheduler (24 months); tests | `src/modules/talent_pool/*`, `src/jobs/...talent-pool-purge*`, `tests/integration/recruitment-pool.test.js` | P1, P2, P2b | | ☐ | | ☐ |
| P7 | **Words**: the five candidate emails (`templates/email/application-received.html`, `apply-invite.html`, `assessment-invite.html`, `interview-invite.html`, `candidate-not-progressed.html`) and the five prompts (`src/services/ai/prompts/{jd-draft,cv-screen,screening-questions,assessment-questions,interview-notes-cleanup}.md`). Plain words for strangers; no dashes; Lagos dates. The variables each email may use are fixed with P4 to P6 | the ten files named | none (variables agreed with P4 to P6) | | ☐ |
| P8 | **Components**: `RatingField` (1 to 10 stars, 44 px on a phone, keyboard and touch, Forms group) and anything else the screens lack, through `npm run new:component` with header, test and gallery page; `npm run gen:components` | `packages/ui/src/...` (the new components only), `docs/COMPONENTS.md` | none | | ☐ |
| P9 | **Staff screens** on the contract: Vacancies (wizard, sheet, questions, scorecard, suggested seats, Candidate Emails), Candidates (board, sheet, scores with Provisional, scorecard, stage history), Assessments (definitions, questions editor, sittings, Mark Answers), Interviews (list, sheet, Candidate Details, My Card with ten-star traits, Close Round, report, Download Form), Talent Pool (list, sheet, Invite to Apply), Careers Settings. Desktop and phone (guide §10). INTERIM types in `app/src/api/types/recruitment.ts` replaced by the contract's; M5's tabs (Offers, Onboarding) left as they are | `app/src/features/recruitment/*`, `app/src/api/types/recruitment.ts` | P1 (P8 for feedback) | | ☐ |
| P10 | **Staff mock**: `app/src/api/mock/modules/recruitment.ts` answering every M4 route in the contract's shapes, with the grants and data the pictures need | `app/src/api/mock/modules/recruitment.ts` | P1 | | ☐ |
| P11 | **Public pages** on the contract: Careers, Vacancy (paused and closed states), Apply (the vacancy's questions, the privacy tick, `cover_letter`), Assessment (file answers); the public mock | `public-app/src/pages/{Careers,Vacancy,Apply,Assessment}.tsx`, `public-app/src/api/types/public.ts` (the M4 half), `public-app/src/api/mock/public.ts` (the M4 half) | P1 | | ☐ |
| P12 | **Search and AI**: `.search.js` for the five modules, New Vacancy as a Praxis AI card, the route map's record types, ⌘K actions; `.ai.js` manifests (reads, summary, routes, `not_offered`); `npm run gen:ai-catalogue`; eval cases | `src/modules/*/*.search.js`, `src/modules/*/*.ai.js` (the four), `src/shared/search/actions.js` (M4 lines) | P3 to P6 | | ☐ |
| P13 | **Staging seed** `seeds/staging/55_recruitment.js` through the services: Careers Settings with MyCity's ten traits and About MyCityApp, vacancies (one shaped on the Head Sales & Revenue description), applications from `@example.test` candidates, the researched assessments and a take-home brief, sittings, a closed and an open round, pool members; its test; Home's staging vacancy rows removed | `seeds/staging/55_recruitment.js`, its test, `seeds/staging/60_home.js` and `lib/forward-rows.js` (the vacancy rows only) | P3 to P6 | | ☐ |
| P14 | **User Guide** `docs/manual/recruitment.md` and `docs/manual/public-site.md` (the M4 pages), front matter `milestones: M4`, a section per screen, pictures via `npm run guide:shots -- --chapter recruitment` | `docs/manual/recruitment.md`, `docs/manual/public-site.md`, `docs/manual/img/recruitment/` | P9 to P11 (reading can start now) | | ☐ |
| P15 | **Close-out** (GE): PROGRESS #38 to #41 and #80 to #83, README map, DATABASE_SCHEMA M4, guide Status, the whole `npm run ci`, PR ready for review | `docs/PROGRESS.md`, `README.MD`, `docs/DATABASE_SCHEMA.md` | all | | ☐ |

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
| `docs/PROGRESS.md` | Notes only, under Recruitment, one line per package done; ticks are P15's |
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
