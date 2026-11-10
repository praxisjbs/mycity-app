# Training and handover videos

**Start here when asked for a training or handover video of a milestone** ("make the training video
for Milestone 6"). Every video MyCity receives looks and sounds like the Milestone 3 one: the same
cards, the same caption bar, the same phone frame, the same voice at the same pace. This file is how
any session makes one, in order, and what has been learnt so far. Read all of it before filming.

The tooling is `scripts/video/` (README §4). The scenes, one file a video, are
`scripts/video/scenes/<id>.js`; each is the video's script and its choreography together.

| Video | Scene | Status | Drive |
|---|---|---|---|
| M2 My Workspace (8 min), M2 Performance (15 min) | made before this tooling | Delivered 04/11/2026 | My City App H/O and Training Videos |
| M3 Queries and Sanctions (8:56) | made before this tooling; the reference (§2) | Delivered 04/11/2026 | same folder |
| M4 Recruitment, part 1: Vacancies and Candidates | `m4-recruitment-1.js` | Pipeline proven on its first chapters (§8) | |
| M4 Recruitment, part 2: Assessments and Interviews | `m4-recruitment-2.js` | Script to write (§8) | |

---

## 1 · What a session needs

1. **The repository and Node 20** (`npm ci`), **ffmpeg** and **Chromium** (`MYCITY_CHROMIUM`, in a
   cloud session `/opt/pw-browsers/chromium`).
2. **Python 3.12 for the voice** (spaCy, which Kokoro needs, does not build on 3.13):
   ```bash
   uv venv -p 3.12 ~/.video-venv && . ~/.video-venv/bin/activate && uv pip install -r scripts/video/requirements.txt
   ```
   Point `VIDEO_PYTHON` at `~/.video-venv/bin/python`.
3. **Network.** Kokoro downloads its model from `huggingface.co` the first time; a cloud environment
   on limited network access refuses it (`CONNECT tunnel failed, response 403`). Allow
   `huggingface.co` and `cdn-lfs.huggingface.co` in the environment's network settings, or use full
   access while filming.
4. **AI, when a video shows it** (§6.4). The app's AI is Gemini. In a cloud session, add a network
   secret for `generativelanguage.googleapis.com` (Token, header `Authorization`, prefix `Bearer`)
   in the environment's settings; a new session picks it up. Set `GEMINI_API_KEY` in the local
   `.env` to any placeholder: the app then calls Gemini and the proxy puts the real key in. Never
   paste a key into a chat. Delete the secret when the video is done.

## 2 · The pattern (measured from the Milestone 3 video, 04/11/2026)

The M3 file (MyCity-M3-Queries-and-Sanctions-Walkthrough.mp4, 8:56, 39 MB) was taken apart frame by
frame and its narration transcribed; `scripts/video/style.js` holds what was measured. Do not change
these without a new decision from JBS Praxis.

**The file.** 1920 × 1080, 30 fps, H.264; AAC mono 48 kHz at about 150 kb/s; loudness -16 LUFS
(LRA about 3). MP4 tags: `title` "MyCity App · <Module> (Milestone N)", `artist` "JBS Praxis".
Chapters in the file, one per chapter of the script. Hard cuts, no fades or transitions.

**The frame.** The picture, 1920 × 960, above a caption bar, 1920 × 120: Deep Green `#00201d` with a
2 px yellow rule on top; on the left "CHAPTER N OF M" in yellow capitals and the chapter's name in
white bold; the line being spoken centred, white, Inter 27 px. A caption shows from when its line is
spoken until the next line starts. A long sentence shows in two halves (split at `|`, else at the
comma nearest its middle).

**The cards.** The opening: a Deep Green ground with a teal glow top right and an olive one bottom
left; the pin and "MyCity App"; an eyebrow in yellow capitals ("MILESTONE 3 HANDOVER"); the module's
name in Inter 700 at 140 px; a one-line subtitle; a short yellow rule; "A walkthrough of every screen
and action" on the left and "Engineered by **JBS Praxis**" on the right. The closing card is the same
with "Thank You", "Every step is written up in the User Guide, in the Knowledge Hub" and
`hub.mycityapp.io`. Narration starts on the opening card at once and ends on the closing one.

**Desktop.** The staff app at 1536 × 768 CSS pixels, device scale 1.25, so it fills the picture
exactly (the sidebar is 310 px wide). A drawn arrow pointer glides to what is pressed. Real records,
real clicks, nothing faked.

**Phone.** The app at 390 × 860 inside a dark phone body (outer 430 × 905 at 1050, 22; screen
394 × 869 at 1068, 40), on the card's ground, with a label on the left: an eyebrow in yellow
capitals ("ON THE EMPLOYEE'S PHONE"), a title ("Employee Self-Service") and a subtitle ("My Queries,
as JBS Praxis sees it on a phone"). No pointer: taps.

**The voice.** Kokoro, voice `bf_emma`, speed 1.0, British English (`lang_code b`). Matched against
M3 by timbre (0.99 against 0.78 to 0.90 for the other British voices) and pitch (183 Hz against 177).
155 words a minute overall; 0.74 s between sentences, 0.31 s at a comma; longer pauses (2 to 5.6 s)
only while something happens on screen. "MyCity" is said "My City" (`SAID` in `make.js`).

**The script.** Present tense, plain words, one fact a sentence, 20 words at most. It follows named
people doing real work ("Bode Oluwasanmi, the Chief Technology Officer, manages the JBS Praxis
account. He presses Raise a Query."). Buttons, tabs and fields are named exactly as the screen reads
them, as the User Guide does. It says who may do what and the rules a person meets (who approves,
what can never change). It never explains how the system is built. Chapter 1 is Welcome: what the
module is, where it is in the menu, its tabs, who sees what, and who the walkthrough follows. The last
is Wrapping Up: "That's <module>, from <first thing> to <last thing>. Every step is also written up
in the User Guide, in the Knowledge Hub. Thank you for watching." M3 had 12 chapters in 9 minutes,
about 1,400 words. A milestone too big for that is split, as M2 was (decided by TB, 10/11/2026).

## 3 · Writing the script

1. Read the milestone's section of `MILESTONES.md`, its feature guide's §10 and its User Guide
   chapter (`docs/manual/`). The chapter's bold names are the screen's own words: use them.
2. Pick the people from the staging seed's cast (`seeds/staging/lib/staff.js` finds them by post):
   Operations & People is Cynthia Osakunih, the CEO Ifeoma Mbonu, the CTO Bode Oluwasanmi; the
   Implementation Team's account ("JBS Praxis Team") stands in for an employee or a hiring manager,
   so no member of MyCity's staff is the subject of a demonstration. Candidates and other outsiders
   are the seed's invented `@example.test` people.
3. Write the scene (§4.3), then `node scripts/video/make.js <scene> script` prints it with its word
   count and length. Read it aloud once. Aim for the chapter list of the M3 shape.

## 4 · Filming

### 4.1 · A database to film on

Never staging or production: filming creates records and signs people in. On a development
database, in this order:

```bash
createdb mycity_video   # owner as in .env; then CREATE EXTENSION vector, pgcrypto, citext
npm run db:migrate
node scripts/db/create-admin.js --build-account --env=development   # the JBS Praxis Team login
node scripts/db/load-staff.js        # MyCity's real staff, as each deploy loads them
node scripts/db/seed.js --staging    # the demonstration records every screen needs
npm run fe:build                     # the release build: no mock (F12)
```

`.env` for filming: `STAFF_ORIGIN=http://hub.mycityapp.io` and `PUBLIC_ORIGIN=http://go.mycityapp.io`,
`PASSWORD_BREACH_CHECK=false`, `SEED_PASSWORD` (the filming password), no SMTP (nothing is mailed).
Filming's Chromium sends those two hosts to the local server (`film.js`, `browserFor`), so every
address and link on screen reads as MyCity's, never localhost. To reach the app outside filming,
send the host: `curl -H "Host: hub.mycityapp.io" http://127.0.0.1:8080/`. The session's own
`DATABASE_URL` (the test database) wins over `.env` (dotenv never overrides): export `.env`'s values
first. Then `npm start` and `npm run worker`.

### 4.2 · The people

`scripts/video/people.js` gives each person a scene films as the filming password, the way an
invitation is accepted (`identity.resetPassword`), and reads the notices already waiting for them,
so the red "Access change" bar the roster load leaves is not in every shot. Filming also answers
**Not Now** to the offer to turn on notifications. It refuses any database but a development one.

### 4.3 · A scene

```js
module.exports = {
  id, file, meta: { title, artist },             // file: the MP4's name
  opening: { eyebrow, title, subtitle, left },   // the cards (§2)
  closing: { eyebrow, title: "Thank You", subtitle, left: "hub.mycityapp.io" },
  people: {
    cynthia: (staff) => staff.operations.work_email,
    team: (staff) => staff.everyone.find((p) => p.job_title === "Implementation Partner").work_email,
  },
  chapters: [{ name, shots: [
    { kind: "card", card: "opening", lines: ["...", "..."] },
    { kind: "desktop", as: "cynthia", start: "/recruitment?tab=vacancies", setup, lines: [
      "A line said over the screen as it is.",
      { say: "A line with an action.|Its second half.", do: (s) => s.click("New Vacancy") },
    ] },
    { kind: "phone", site: "go", start: "/jobs", label: { eyebrow, title, subtitle }, lines },
  ] }],
};
```

A line's `do` starts as its narration starts; the next line waits for both. `before` runs first and
`after` once the line is said; `hold` adds seconds after it. The hands (`s`): `click(name or
Locator)` (a button, link, tab, menu item or option by its exact name), `hover`, `type(label, text)`,
`pick(label, option)`, `scroll(dy)`, `go(path)`, `wait(seconds)`, `settle()`, and `s.page` for
anything else. `setup` runs before the camera rolls. `say` is the caption; what Emma reads is `say`
through `SAID`, or `speech` when given.

### 4.4 · The commands

```bash
export MYCITY_CHROMIUM=/opt/pw-browsers/chromium VIDEO_PYTHON=~/.video-venv/bin/python VIDEO_OUT=/tmp/video/<scene>
node scripts/video/make.js <scene> script      # read it
node scripts/video/make.js <scene> narrate     # cached by text: only changed lines are spoken again
node scripts/video/make.js <scene> film        # or --only=c03s01,c04s02 to refilm some shots
node scripts/video/make.js <scene> assemble    # the MP4 in VIDEO_OUT
```

Shots are named `cCCsSS` (chapter, shot). Look at every shot before assembling: a contact sheet of
the MP4 (`ffmpeg -i x.mp4 -vf "fps=1/3,scale=480:270,tile=4x4" sheet%02d.jpg`) shows it in a few
images. Check the loudness (`-af ebur128`, about -16 LUFS) and the chapters (`ffprobe -show_chapters`).

## 5 · Delivering

The MP4 goes to the Drive folder **My City App H/O and Training Videos**, shared as anyone with the
link can view, named `MyCity-M<N>-<Module>-Walkthrough.mp4` (a part: `...-Part-1-<Topic>.mp4`). A chat
upload is capped at 30 MB; Drive is not. Add the row to the table at the top of this file.

## 6 · Pitfalls already met

1. **Chromium's screencast ignores the device scale**: frames come at CSS size and the text is soft
   once scaled up. `film.js` takes full-resolution captures back to back instead (about 19 a second
   on desktop), each with its time.
2. **M3 was filmed at 1536 × 768 at 1.25**, not 1280 × 640 at 1.5: measured from the sidebar's
   width. At 1.5 everything is a fifth too large.
3. **Inter's optical-size cut** is narrower at large sizes than the standard cut M3 used: the cards
   load `inter-latin-wght-normal.woff2`.
4. **AI in a cloud session.** A network secret for Gemini covers only `Authorization: Bearer`, and
   only one secret is allowed per host. The app's calls that attach a file (a CV read by Score With
   AI or Screen With AI) send `x-goog-api-key` instead (`src/services/ai/vendors/gemini.js`,
   `completeNative`) and are refused. Film those with the key in `.env` on a machine you control, or
   show the screening of candidates whose CV is text the main path reads.
5. **Playwright's own Chromium** is not the image's: always set `MYCITY_CHROMIUM`.

## 7 · Bugs found while filming

Each is fixed on the video's branch, in the screen's own code, its guide and chapter with it, and
listed here and in `docs/PROGRESS.md`.

| Date | Screen | What filming showed | Fix |
|---|---|---|---|
| 10/11/2026 | Recruitment · Vacancies (#38) | A vacancy opened in a dialog at every desktop width (`modal.open`), not beside the list as F31 and the User Guide say; once beside it, its section headings skipped a level and its two small cards broke words | Fixed the same day: `ListDetail` on a wide desktop (the first role shown until another is pressed), its forms return to it in place; the dialog stays on a phone and where two columns do not fit; headings `h3`; the cards stack in the pane. Tests and the User Guide's pictures follow |

## 8 · Where the work stands

**10/11/2026 · TB (with Claude).** The M3 video taken apart (§2); `scripts/video/` built and proven
end to end on M4 part 1's first chapters: cards, a desktop shot, a phone shot of the careers page,
captions, chapters and sound, on a development database with the staging seed.

Decided by TB for M4: two videos, as M2 was. Part 1: Vacancies, the careers page, Apply on a phone,
the candidates board, Talent Pool. Part 2: Assessments (the library, sending, a candidate taking one
on a phone, marking), Interviews (scheduling, the blind panel, My Card, closing the round, the report
and form), the shortlist, and a short hand-off to Make Offer, which the M5 video covers. AI is shown
working (Write With AI, Screen With AI, Score With AI, Suggest With AI, Tidy With AI), with a key for
the filming session only (§1.4).

**The chapters (TB's split; each line is what the chapter must show, the User Guide's words).**
Cast: Cynthia Osakunih (Operations & People) is the recruiter; the JBS Praxis Team account is every
role's hiring manager and a panelist; candidates are the seed's invented people (Head, Sales &
Revenue has one at every stage: Chinedu Okafor applied, Funke Bakare screening, Emeka Obi
assessment, Tobi Adeyemi and Halima Yusuf interview, Kunle Afolabi shortlist, Femi Lawal not
progressing). AI chapters are marked AI (§1.4).

Part 1, Vacancies and Candidates (`m4-recruitment-1.js`, about 8 minutes):

1. Welcome (written, filmed): the card, the menu, the tabs, who sees what, invented candidates.
2. Reading Vacancies (written, filmed): tiles, the list, the funnel, a role beside the list, Copy
   Link, See Candidates, Careers Page. Refilm: the role now sits beside the list.
3. Writing a Vacancy (AI): New Vacancy's questions one card at a time (Question n of 10), Skip, the
   two follow-ups the hub asks, Draft Vacancy, the three steps, Closes On, Publish Now, Publish
   Vacancy. Create Vacancy from Suggested From Organogram in one line.
4. Questions, Scorecard and Emails: Apply questions and interview traits (Suggest With AI, AI),
   the scorecard's parts and weights adding to 100, Candidate Emails and Restore Default, Careers
   Settings and its default traits.
5. Pause, Resume and Close: Pause keeps the link, Resume, Close Vacancy with Not Progress All.
6. The Careers Page (phone, written, filmed): open roles, a role's page, How We Hire.
7. Applying on a Phone (phone): Apply for This Role, About You, Choose Your CV (an invented CV made
   as a PDF), the role's questions, Why This Role, the privacy tick, Submit Application, the
   reference; the email a candidate gets.
8. The Candidates Board: tiles, the vacancy filter, the five columns, a card's score and
   Provisional, days at stage; a candidate beside the board: details, View CV, Weighted Total,
   Stage History.
9. Screening With AI (AI): Screen With AI, a Must Meet condition, Screen Applications, scores
   replacing Provisional, the summary; Score With AI on one; a condition about age refused.
10. Moving and Stopping: drag to a column, Move to, Not Progressing with its reason, Reopen.
11. Talent Pool: Add to Pool with Why Keep Them, the pool's tiles, Invite to Apply from the pool and
    from the board, Remove, Export.
12. Wrapping Up: "That's Recruitment's first half, from a new vacancy to the Talent Pool."

Part 2, Assessments and Interviews (`m4-recruitment-2.js`, about 8 minutes):

1. Welcome: the second of two; who it follows.
2. The Assessment Library: tiles, Assessments and Sittings, an assessment's questions and Points.
3. Making an Assessment: New Assessment (Name, Type, Minutes or a take-home brief, Pass Mark,
   Instructions), Questions (choice with Points, written, file or link), Suggest With AI (AI),
   Activate; Export and Import in one line.
4. Sending It: Send Assessment from a candidate (Start Within Days, Days to Finish), Send to
   Candidates for a whole stage.
5. Taking It on a Phone (phone): the email's link, Start the Assessment, the clock, Saved, a file
   or a link answer, Submit Assessment. The link is the one the worker mailed: read it from the
   outbox on the filming database, never invent it.
6. Marking: Sittings, To Mark, Mark Answers, the score reaching the candidate.
7. Scheduling an Interview: Schedule Interview, the candidate, How, Day, Starts, Ends, Panel; the
   calendar invite; Candidate Details.
8. The Blind Panel: Blind Panel's Submitted and Waiting, Hidden; My Card on a phone as the JBS
   Praxis Team (ten stars a trait, Your score, Decision, Comments, Tidy With AI (AI), Private Notes,
   Submit Card); nobody reads another card until the round closes.
9. Closing the Round: Close Round, the results (each rating, the averages, the total out of 100),
   Write Report, Download Form (the Interview Assessment Form).
10. Shortlist and Offer: the selected candidate to Shortlist; Make Offer opens Offers, covered in
    the Milestone 5 video. About 20 seconds.
11. Wrapping Up: "That's Recruitment, from a new vacancy to the shortlist."

Next, in order:

- [x] Fix the Vacancies bug in §7 (10/11/2026).
- [ ] Write the rest of `m4-recruitment-1.js` (chapter list in §8 above), film it, look at every shot.
- [ ] Write and film `m4-recruitment-2.js`.
- [ ] Film the AI chapters in a session with the Gemini secret (§1.4, §6.4).
- [ ] Assemble both, check them (§4.4), upload them (§5), and remove the AI secret.
