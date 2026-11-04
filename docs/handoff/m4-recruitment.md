# M4 Recruitment · Build Handoff

**Start here if you are continuing this work.** This file is self-contained: what was asked, the
decisions taken (do not ask them again), the build plan as a checklist with its status, and a dated
log. The design itself is `docs/guides/recruitment.md`; this file is the build plan and its log.

| | |
|---|---|
| Branch | `m4/recruitment` (push only here; the PR targets `main`) |
| Pull request | not opened yet |
| Owner | GE (Godwin-Okoh Elisha), full ownership from 04/11/2026 |
| Type | Full stack (CLAUDE.md step 1) |
| Started | 04/11/2026 |

---

## 0 · How to continue

1. `git fetch origin m4/recruitment && git checkout m4/recruitment && git pull`.
2. Read this file in full, then `docs/guides/recruitment.md`, then what CLAUDE.md step 2 asks for
   full-stack work (BACKEND_GUIDE, MIGRATIONS, FRONTEND_GUIDE, FRONTEND_FOUNDATION, COMPONENTS).
3. Take the first unticked step in §5. Build it, run its checks, tick it here with the date, add a line
   to §7, commit. Push and open the draft PR only when GE asks.
4. Never re-open §2. Run the suite locally as §6 says.

---

## 1 · What was asked

The whole of MILESTONES §9, by Friday 06/11/2026 (GE's team target; the milestone's own window is 2 to
13 November): vacancies with an AI-drafted description on a public careers page, applications with a
CV and a provisional score, AI screening, timed assessments on the public site, blind panel interviews
with a consolidated report, the weighted scorecard, AI cleanup of interview notes, time at stage. GE
asked for it to be built bit by bit so no detail is missed (04/11/2026).

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

## 4 · Open points

- The psychometric and case-study question banks (Cynthia).
- Candidate mail volume against production's 40 an hour (mail plan upgrade, Bode and Cynthia).
- Data retention for candidates (NDPR): nothing is deleted in M4.

---

## 5 · Checklist

The build, in order. One commit at least per step.

- [x] 04/11/2026 · Environment (Node 20, `npm ci`, Postgres 16 with pgvector, Redis), branch
- [x] 04/11/2026 · Guide `docs/guides/recruitment.md`, this handoff, MILESTONES §9 note
- [ ] Contract `packages/contract/schemas/vacancies.js`, `candidates.js`, `assessments.js`,
      `interviews.js`, the public shapes; `npm run gen:contract`
- [ ] Migrations 4010 to 4040 and seed 4199 (numbering); round trip on a throwaway database
- [ ] `vacancies`: repo, service (lifecycle, slug, questions, scorecard), routes, events, Write With AI
      (`jd-draft`, `screening-questions`), suggested seats; public `/jobs`; tests
- [ ] Home adapter (`vacancies.source.js`) moved onto the module's reads, `owes` cleared; Home's
      staging vacancy rows removed (`removeHomeStagingRows`)
- [ ] `candidates`: public Apply (token, CV quarantine, write-only), pipeline moves with history,
      estimate, `cv-screen` on press and Score All, scorecard, SLA, Invite to Apply, Not Progressing,
      candidate emails and their editor; tests
- [ ] `assessments`: definitions and questions (encrypted points), Suggest With AI, sittings, public
      delivery (start, autosave, file answer, submit), the timer, `assessment-expire`, marking; tests
- [ ] `interviews`: schedule (calendar and `.ics`), reschedule, cancel, blind feedback, the reminder,
      close, report, Tidy With AI; tests
- [ ] Search providers, AI manifests (reads, summaries, routes, `not_offered`), `gen:ai-catalogue`
- [ ] Staff screens on the contract: Vacancies, Candidates, Assessments, Interviews (desktop and phone),
      the mock answering every route
- [ ] Public pages on the contract: Careers, Vacancy, Apply, Assessment
- [ ] Staging seed `seeds/staging/NN_recruitment.js` with its test
- [ ] User Guide chapter `docs/manual/recruitment.md` and its pictures
- [ ] PROGRESS rows #38 to #41 and #80 to #83, README map, DATABASE_SCHEMA M4, CODEOWNERS
- [ ] `npm run ci` green on the whole suite

---

## 6 · Notes

- Run as CI does: Node 20 (`/opt/node20/bin` first on `PATH` in a cloud session), and for the
  integration suite `RUN_DB_TESTS=1 DATABASE_URL=postgres://mycity:mycity@127.0.0.1:5432/mycity_test
  REDIS_URL=redis://127.0.0.1:6379/15`. Jest needs `NODE_OPTIONS=--max-old-space-size=4096` locally.
- The browser gates need `MYCITY_CHROMIUM=/opt/pw-browsers/chromium` in a cloud session.
- The repository is public: no real candidate, CV or name in seeds, tests or docs.

---

## 7 · Log

- 04/11/2026 · GE · Read the whole of `docs/` for M4 (four readers and the M4 planning documents);
  eight decisions taken with GE; guide, handoff and MILESTONES §9 note written.
