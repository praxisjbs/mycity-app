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
| M4 Recruitment, part 1: Vacancies and Candidates (9:07, 12 chapters) | `m4-recruitment-1.js` | Made 10/11/2026, sent to TB; to upload (§5) | |
| M4 Recruitment, part 2: Assessments and Interviews (6:54, 11 chapters) | `m4-recruitment-2.js` | Made 10/11/2026, sent to TB; to upload (§5) | |
| M5 Offers and Onboarding, part 1: Offers (7:08, 10 chapters) | `m5-offers-1.js` | Made and uploaded 12/11/2026 | [Part 1](https://drive.google.com/file/d/1U9ybR4Xb1KTsRBtn5YNeI_3ZLZvLYTcp/view?usp=drivesdk) |
| M5 Offers and Onboarding, part 2: Documentation and Onboarding (6:41, 11 chapters) | `m5-onboarding-2.js` | Made and uploaded 12/11/2026 | [Part 2](https://drive.google.com/file/d/1QehhMb7Q3N4-sDeIteZroX3u8YeTy_q5/view?usp=drivesdk) |
| M6 Payroll, part 1: Payroll Runs and Payslips (about 7 min) | `m6-payroll-1.js`, to write | Planned 13/11/2026 (§8) | |
| M6 Payroll, part 2: Deductions, Configurations and My Payslips (about 6 min) | `m6-payroll-2.js`, to write | Planned 13/11/2026 (§8) | |
| M10 Knowledge Hub, part 1: Policies, SOPs and Training (8:34, 11 chapters) | `m10-knowledge-hub.js` | Made 12/11/2026, sent to TB; to upload (§5) | |
| M10 Praxis AI, part 2: Praxis AI and AI Control (7:00, 10 chapters) | `m10-praxis-ai.js` | Made 12/11/2026, sent to TB; to upload (§5) | |

---

## 1 · What a session needs

1. **The repository and Node 20** (`npm ci`), **ffmpeg** and **Chromium** (`MYCITY_CHROMIUM`, in a
   cloud session `/opt/pw-browsers/chromium`).
2. **Python 3.12 for the voice** (spaCy, which Kokoro needs, does not build on 3.13):
   ```bash
   uv venv -p 3.12 ~/.video-venv && . ~/.video-venv/bin/activate && uv pip install -r scripts/video/requirements.txt
   ```
   Point `VIDEO_PYTHON` at `~/.video-venv/bin/python`. With no GPU, install torch's CPU build first
   (`uv pip install torch --index-url https://download.pytorch.org/whl/cpu`): the default pulls
   several gigabytes of CUDA. Narrate with the venv active (`. ~/.video-venv/bin/activate`): Kokoro
   installs spaCy's English model with `uv` the first time, and fails outside a venv.
3. **Network.** Kokoro downloads its model from `huggingface.co` the first time; a cloud environment
   on limited network access refuses it (`CONNECT tunnel failed, response 403`). Allow
   `huggingface.co` and `cdn-lfs.huggingface.co` in the environment's network settings, or use full
   access while filming.
4. **AI, when a video shows it** (§6.4). The app's AI is Gemini. Where the session has the key as
   an environment variable (`GEMINI_API_KEY`, M4's videos), copy it into the filming `.env` without
   printing it; calls that attach a CV then work too. Otherwise add a network secret for
   `generativelanguage.googleapis.com` (Token, header `Authorization`, prefix `Bearer`) and set the
   `.env` key to a placeholder. Never paste a key into a chat. Then do what IT does on Settings ·
   Integrations, as the JBS Praxis Team: **Test** the Gemini connection (`integrations.test("gemini")`),
   which records the models the key may use, and read which job runs on which model (§6.6).
5. **A virus scanner.** A CV opens, and AI reads it, only once clamd has scanned it clean. Where
   ClamAV's signatures cannot be downloaded (`database.clamav.net` refused), install `clamav-daemon`
   and give it the EICAR test signature alone (`<md5 of the EICAR string>:68:Eicar-Test-Signature` in
   `/var/lib/clamav/eicar.hdb`), with `TCPSocket 3310`: a real scan that passes a clean file and
   catches the test virus. Start it before the seed, so the seed's CVs are scanned as they arrive.
6. **Address search, when a video picks an address** (M5 part 2: the hire's home address and both
   guarantors'). Every address is picked (F27), and with no Geoapify key the field says "Address
   search is unavailable". Geoapify takes its key in the address, so a network secret cannot carry
   it: the environment needs `GEOAPIFY_API_KEY` as a variable, which a new session picks up. Copy it
   into the filming `.env` without printing it.
7. **pgvector.** Where the image's PostgreSQL lacks it (`pg_available_extensions` has no `vector`),
   `apt-get install postgresql-16-pgvector` before `CREATE EXTENSION vector`.

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

**Snapshots.** A chapter changes the database, so a retake needs the state before it. After the seed,
and before each chapter that writes, stop the API and the worker and copy the database:
`CREATE DATABASE snap_c05 TEMPLATE mycity_video` (and the `MEDIA_ROOT` folder beside it); to retake,
drop `mycity_video` and create it again from the snapshot. Leave Redis as it is: the mail a scene
reads its links from is there (§4.5), and the links' tokens are in the database the snapshot holds.

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
`pick(label, option)`, `scroll(dy)`, `drag(from, to)` (a card to a column),
`go(path)`, `wait(seconds)`, `settle()`, and `s.page` for anything else. `pick` takes a select's
label or its Locator (a dialog's field whose label the page also uses), and an option by its name
with or without a number after ` · `. `setup` runs before the camera rolls. `say` is the caption; what Emma reads is `say`
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

### 4.5 · Mail on screen

Filming has no mail server, so nothing leaves the machine, but each message the app sends is still
its `email-send` job. `scripts/video/mail.js` finds the newest one to an address (`message(email,
template, { match })`) and renders it with the app's own template: a phone shot shows it with
`s.page.setContent(html)`, and a link in it (an assessment's `assess_url`) is opened as the candidate
would. Never type or invent a link.

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
6. **A model the key may not use.** Gemini lists `gemini-2.5-pro` to a new key but refuses to run it
   ("no longer available to new users"), so Deep Reasoning and Top Tier, which take the newest Pro,
   failed every CV read with "The AI service is not set up correctly". On the filming database their
   chains were set to `gemini-3.1-pro-preview`, then `gemini-3.8-flash`, as AI Control does. Check
   production's key the same way before the videos are shown (§7).
7. **The camera on a page that scrolls itself.** A screenshot's clip is read in the document's
   coordinates: on the careers site, which scrolls the document, a clip at 0, 0 showed the wrong place
   and blank frames. `film.js` starts the clip where the page is scrolled to.
8. **What covers a button.** A toast sits over a pane's last buttons until it goes, and a list that
   closes as the pointer travels moves its target: wait for the toast, and the pointer measures its
   target again before it presses. A confirmation is an `alertdialog`, not a `dialog`.
9. **Sheets waiting at sign-in.** A policy waiting to be acknowledged opens a Policy Update sheet, one
   a policy; filming answers **Later** to each, never **Acknowledge**.
10. **The gates after filming.** Move the filming `.env` aside and run `npm run ci` with
    `GEMINI_API_KEY` unset (`env -u GEMINI_API_KEY npm run ci`): with a key in the environment, the
    backend's "no provider set up" tests find one and fail.

11. **YouTube in a cloud session.** Filming's Chromium uses the session's `HTTPS_PROXY` (bypassing
    MyCity's two hosts, `film.js`), so a course's YouTube item loads its poster; but YouTube refuses
    playback to the cloud machine ("Video unavailable", whatever the page). Film the item with
    **Play Video** shown, not pressed, and say what it does; on a person's own network it plays.
12. **AI answers differ from take to take.** The model words each answer itself: a button under one
    answer (**Open Approvals**) or a **From** chip may not be there next time. Point at such things
    softly (`soft()` in `m10-praxis-ai.js`: glide there if it shows within a few seconds), and wait
    for an answer by its **Helpful**, a question's choices or a card's button, never by time.
13. **A snapshot before each chapter that writes**, and a restore before its retake: a failed take
    leaves half a record (a policy started, a course created) that the retake would meet twice.
    `snap_ready` (seeded, Gemini tested), then one after each writing chapter; probes that ask the
    AI leave conversations in a person's History, so restore before filming History.
14. **Find a screen's real roles before scripting it.** Chips are pressed-state buttons, not radios;
    a course's sections are radios named with their counts ("People 5"); Add Item is a menu;
    Assign Training's Departments is a list of options. A probe that signs in, takes steps and prints
    the page's ARIA tree (Playwright's `ariaSnapshot()`) saves a failed take each.
15. **The signature.** `sign()` (`scripts/video/sign.js`, shared since M5) draws joined loops and an
    underline with the pointer; a sine wave reads as a scribble. Policies, courses, offers and
    contracts all take it, the company's in a dialog and the candidate's on their phone.
16. **A help term's popup is a dialog.** Hovering **Score** or **Pre-Onboarding** opens a popup with the
    dialog role, so "the dialog on top" is then the popup, not the record: address a record's window by
    its name (`getByRole("dialog", { name: "Offer" })`, M5's `record()` and `kase()`).
17. **A tab's name carries its count.** Once a case waits, the Onboarding tab reads "Onboarding 1":
    match a tab by its start (`{ name: /^Onboarding/ }`), never exactly.
18. **The public pages' write limit.** go.mycityapp.io allows 20 writes a minute from one address
    (`RATE_LIMIT_PUBLIC_WRITES_PER_MIN`). Upload Documents no longer counts against it: its writes have a
    limit of their own, 60 a minute a link (AJ, 12/11/2026), so `freshMinute()` in `m5-onboarding-2.js`
    is no longer needed for it. The signing page's code still waits a minute between sends.
19. **One real day.** A record's dates are stamped by the server, so a scene never runs a job "as"
    another day: the steps would read Done today under a start date weeks away. M5's hire starts on
    the filming day, and the morning's dispatch is run by hand that day (`morningRun()`); film both
    parts on one database, the same day, or film both again.
20. **Read a field's kind before typing into it.** Office Days is a number of days a week: words typed
    into it vanish, and the shot shows an empty field under a line that says otherwise.
21. **A signing code by its arrival.** `mail.message()` answers the newest mail of a kind, which before
    the new one arrives is the last one sent: read the code before pressing Send Code and wait for a
    different one (`codeAfter()` in `m5-onboarding-2.js`).

## 7 · Bugs found while filming

Each is fixed on the video's branch, in the screen's own code, its guide and chapter with it, and
listed here and in `docs/PROGRESS.md`.

| Date | Screen | What filming showed | Fix |
|---|---|---|---|
| 10/11/2026 | Recruitment · New Vacancy (#38) | A salary typed as people write it (`350,000`, or `350000`) was refused as "Check the format", so the salary question could not be passed: the band went to the contract as typed, not with two places | Fixed the same day: the questions, the draft request and the editor send it through `toMoneyString`; a test types `350,000` through to a saved draft |
| 10/11/2026 | Recruitment · Candidates (#39) | A candidate opened in a dialog at every desktop width, where F31 and the User Guide put them beside the board | Fixed: beside the board on a wide desktop, the board keeping its full width until a card is pressed (`ListDetail` `fillUntilPicked`, new); forms return to the candidate in place; headings one level down, the two score cards stacked |
| 10/11/2026 | Recruitment · Assessments (#40), Talent Pool (#44) | An assessment, a sitting and a person in the pool opened in a dialog on desktop, as candidates did | Fixed the same way, the first record shown until another is pressed; a long assessment name leads its card, under the title Assessment (four words a card title) |
| 10/11/2026 | AI · Deep Reasoning, Top Tier | The newest Pro model, which these jobs take, is listed to a new key but refused (§6.6) | Not code: set on the filming database. Production's key to be checked on AI Control |
| 12/11/2026 | Knowledge Hub · Training (#65), Notification Settings | The Library and Proof Required switches, and Sound in App and Quiet Hours, were named "Switch" to a screen reader: a `ToggleRow` whose title carries a help term named its switch "Switch" | Fixed the same day: `ToggleRow` takes `label`, the four rows pass it; a test in `Switch.test.tsx` |
| 12/11/2026 | ESS · My Training (#110) | TB asked for notes while taking a course | Built first: My Notes (`knowledge.md` §6.13), praxisjbs/mycity-app#132, merged before filming |
| 12/11/2026 | Training certificate | The publisher's drawn signature prints on a white box over the certificate's cream paper: the pad saves an opaque PNG | Not fixed: for TB (the pad, or the certificate's template, makes white transparent; policies use the same pad) |
| 12/11/2026 | Praxis AI · partnerships | "Which partnerships have gone inactive?" answered with a table whose Health read the raw code `on_track`, where the User Guide says a status reads in words | Not fixed: for TB (the answer's table comes from the model; the engine's post-processing should word codes) |
| 12/11/2026 | AI Control · Actions | Deep Reasoning and Top Tier show Gemini 2.5 Pro as Ready while the key is refused it (§6.6): Ready means set up, not tested | Not code: set on camera to Gemini 3.1 Pro Preview then 3.8 Flash. Production's key to be checked the same way |
| 12/11/2026 | Praxis AI, MILESTONES §15 | "A user without expense permission" does not exist among MyCity's staff: every role but System Administrator may view expenses (their own) | Not code: the video shows a staff member asking about expenses (answered from his own only) and refused company payroll |
| 12/11/2026 | Every Markdown email (offer, contract, documents, assessment, interview, apply, payslip, proposal) | On a phone the message was wider than the screen and cut off on the right: the "copy this address into your browser" line ends in the link in full, one unbroken word the body cell would not break | Fixed the same day: the layout's body cell breaks a long word (`templates/email/layout.html`); a test in `email-templates.test.js` |
| 12/11/2026 | Recruitment · Offers (#42) | An accepted offer read **Expired On** beside its expiry day, as did a declined or withdrawn one: every offer but one with its candidate took that label | Fixed the same day: **Expires** while it is with the candidate, **Expired On** once it has expired, nothing otherwise; `Offers.test.tsx` |
| 12/11/2026 | People · Employee 360, Documents; Recruitment · Onboarding (#43) | A hire's documents read by their file's name ("guarantor-id-2.pdf", on a phone "IMG_2041.jpg") and stayed **Awaiting Check** after Operations & People had verified every one on the case: Verified 0 of 14 | Fixed the same day: named on its item, a file is titled by its requirement or guarantor (`vault.setTitle`, new); Verify on the case, and a guarantor's pass, verify the document on the record (`documents.verifiedIn`, new, which People's Verify Document uses too); `onboarding.test.js` (integration) |
| 12/11/2026 | Upload Documents (#112), Recruitment · Onboarding (#43) | A previous employer's **Years Known**, which their form never asks, was saved as 0 and shown as "Years Known 0": `blank(z.coerce.number())` reads "" as 0 | Fixed the same day: `GuarantorInput.years_known` is `optionalWhole` (as Assessments and Interviews); `onboarding.test.js` (unit) |
| 12/11/2026 | People · Employee 360, Documents | A file the hire sent that Operations & People rejected on the case (the first passport photograph) stays on their record as **Awaiting Check** beside the one that replaced it, under the same title | Fixed 12/11/2026 (AJ's decision): a file sent again becomes the next version of the one before (`vault.follow`), so the record shows one entry and keeps the rejected file in its versions; the hire is now also mailed `onboarding-document-rejected` with a fresh link. `onboarding.test.js` (integration) |
| 12/11/2026 | Upload Documents (#112) | The page shares the public write limit, 20 a minute from one address, and spends two writes a document: a hire sending the New Joiner list briskly is told "Too many requests" within the minute | Fixed 12/11/2026 (AJ's decision): the page's writes have a limit of their own, 60 a minute a link (`onboardLimiter`; `offers.md` §13, SYSTEM_ARCHITECTURE §3). `rate-limit.test.js` |
| 10/11/2026 | Recruitment · Vacancies (#38) | A vacancy opened in a dialog at every desktop width (`modal.open`), not beside the list as F31 and the User Guide say; once beside it, its section headings skipped a level and its two small cards broke words | Fixed the same day: `ListDetail` on a wide desktop (the first role shown until another is pressed), its forms return to it in place; the dialog stays on a phone and where two columns do not fit; headings `h3`; the cards stack in the pane. Tests and the User Guide's pictures follow |

## 8 · Where the work stands

**13/11/2026 · JP (with Claude). The Milestone 6 plan**, written once the screens were final (`docs/guides/payroll.md`
Appendix A, PR 8). Nothing filmed yet. Two videos, as M4, M5 and M10. The chapter list follows the guide's demo
(Appendix B) and the User Guide's Payroll chapter, whose bold names are the screens' own words.

Cast: Cynthia Osakunih (Operations & People) runs the payroll; Ifeoma Mbonu, the CEO, approves on her phone from the
bell's link. The people paid are the staging seed's invented ones (`seeds/staging/58_payroll.js`, `@example.test`), never
MyCity's staff, whom the seed leaves out of every run: Adaeze Okonkwo (an advance over two months), Chiamaka Nwosu (a
joiner, prorated) and Segun Alabi (a joiner with No Salary Set). The seed gives them no login, so My Payslips is filmed as
Adaeze after People invite her on the filming database and `people.js` gives her the filming password. The seed's only
fine is the queries seed's, on an Implementation Team account; Deductions' chapter needs two more waiting, raised through
Queries & Sanctions before filming, or the chapter shows one. No AI chapter: M6 registers no AI job of its own.

Part 1, Payroll Runs and Payslips (`m6-payroll-1.js`, about 7 minutes):

1. Welcome: the card, the four tabs, who sees what, invented people only.
2. A Month's Run: the seed's computed run, its figures, the chain, Run History; New Run on the next month in one line.
3. Problems: the problem line, Run Problems, No Salary Set; Segun's pay set on People · Employees; Compute Run again.
4. Adjustments and Left Out: Add Adjustment (an earning with its reason), Exclude Person, Include.
5. To the CEO: Submit for Approval, Waiting On; the CEO's notice on her phone, Approve and Approve Run; Send Back
   in one line.
6. Payslips: the Month select, Preview then Published, a payslip in the modal, Download PDF.
7. Email and Download All: Email All Payslips (only once mail reaches the invented people's new addresses, the guide's
   Appendix B item 9; until then shown as pressed and left), Download All.
8. Mark Paid: Paid On, Payment Reference; Home's Payroll In Progress card counts one fewer.

Part 2, Deductions, Configurations and My Payslips (`m6-payroll-2.js`, about 6 minutes):

1. Deductions: the four figures, the chips and the source switch; an attendance deduction opening People · Attendance.
2. Fines: Accept This Month, Spread Over Months with Spread Fine, Waive with Waive Fine; Release in one line.
3. An Advance: Record Advance (Employee, Amount, Paid On, Months, Start Month, Reason); its share on the run.
4. Configurations: Pay Day and Set Pay Day with Last Day of Month; Bank Details Required.
5. Statutory Items and PAYE Bands: each item Not Set, the Source fields and No Legal Source, Remove Change for a change
   still to come. Advanced Payroll stays off: no figure is entered without its source (§13.1 item 38).
6. My Payslips on a phone (Adaeze): the year, the months, a payslip, Download PDF, Email a Copy, Salary Deductions with
   the advance, Download All.

- [x] Plan both M6 videos (13/11/2026).
- [ ] Write and film both once PR 8 is merged and staging's mail is resumed (Appendix B item 9).

**12/11/2026 · GE (with Claude).** Both Milestone 5 videos written, filmed and assembled on one
development database, the same day, with the staging seed: part 1, Offers (7:08, 10 chapters,
-16.3 LUFS) and part 2, Documentation and Onboarding (6:41, 11 chapters, -16.4 LUFS). Two parts, as
M2, M4 and M10. Kunle Afolabi, the seed's invented candidate at Shortlist for Head, Sales & Revenue, is
followed from the board's Make Offer to his login. Cynthia Osakunih names herself Offer Signatory,
makes, submits, signs and sends the offer, links the default plan's HR Induction step to SOP-0009, signs
the contract, checks his documents and guarantors and completes onboarding; the JBS Praxis Team, the
hiring manager, set as head of Implementation (every seeded vacancy's department) so the approval shows
both stages, approves first and works through the plan on its phone; Ifeoma Mbonu approves on her
phone. Kunle signs the offer and the contract, sends the New Joiner list (sample documents printed at
filming, marked SAMPLE), two guarantors with picked addresses, his home address and his BVN on his
phone. He starts on the filming day, so the morning's dispatch is run by hand that day (§6.19). No AI:
M5 registers none. Six findings (§7): four fixed on this branch, two for AJ. The tooling learnt §1.6,
§1.7 and §6.16 to §6.21; `sign()` moved to `scripts/video/sign.js`; `SAID` reads OFF-, CON-, BVN, NYSC,
MyLagosApp and "&".

- [x] Write, film and check both M5 videos (12/11/2026).
- [x] Upload both to Drive (§5) and add their links to the table at the top (12/11/2026).
- [ ] AJ: the §7 findings of 12/11/2026 left open (Upload Documents' write limit; a rejected file's state on the record).

**12/11/2026 · TB (with Claude).** Both Milestone 10 videos written, filmed and assembled on a
development database with the staging seed and Gemini's key: part 1, Knowledge Hub (8:34, 11
chapters) and part 2, Praxis AI and AI Control (7:00, 10 chapters), both -16.4 LUFS. Decided by TB:
two videos; Policies a full chapter; MyCity's own people do the work (an internal guide, as real as
it can be): Cynthia Osakunih writes a policy and builds the course, Chinyere Elechi writes Branding &
Marketing's SOP with Draft With AI, Aaron Agama acknowledges the policy and takes the course on his
phone with My Notes (built for the video, praxisjbs/mycity-app#132), Ifeoma Mbonu asks the six target
questions, Bassey Ekpe is refused company payroll, the JBS Praxis Team as IT fixes Deep Reasoning's
chain and shows where the Anthropic key goes. A new short course, Spotting Phishing Messages (a lesson
from Draft Lesson, CISA's YouTube video, a one-page PDF printed at filming), is taken to a certificate
verified on go.mycityapp.io. One screen fixed on the way and four findings for TB (§7); the
tooling learnt §6.11 to §6.15.

- [x] Write, film and check both M10 videos (12/11/2026).
- [ ] Upload both to Drive (§5) and add their links to the table at the top.
- [ ] TB: the §7 findings of 12/11/2026 (the certificate's signature box, the partnerships answer's raw code).

**11/11/2026 · GE.** Recruitment's desktop was put back as GE left it (Vacancies, Candidates and
Assessments open a record in the wide dialog; Suggested From Organogram behind View Empty Seats; the
funnel and Screening Scores on a new Analytics tab). The two M4 videos were filmed on the side-by-side
layout of 10/11, so their shots of those tabs no longer match the hub. GE decided not to refilm
(the videos were already with the client).

**10/11/2026, later · TB (with Claude).** Both M4 videos written, filmed and assembled on a
development database: part 1 9:07 in 12 chapters, part 2 6:54 in 11 (shorter than planned: what it
shows takes less telling). Bisi Adewale, an invented candidate, applies on camera in part 1 and is
followed through part 2; the Copywriter role is written with AI on camera. Four screens fixed on the
way (§7), and the tooling learnt the lessons in §1, §4.1, §4.5 and §6.

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
- [x] Write the rest of `m4-recruitment-1.js` (chapter list in §8 above), film it, look at every shot (10/11/2026).
- [x] Write and film `m4-recruitment-2.js` (10/11/2026).
- [x] Film the AI chapters with the key (§1.4): Write With AI's questions and draft, Suggest With AI twice, Screen With AI and Score With AI, Tidy With AI (10/11/2026).
- [x] Assemble both and check them (§4.4): -16.4 LUFS, every chapter, the captions, MyCity's hosts only. Sent to TB (10/11/2026).
- [ ] Upload both to Drive (§5) and add their links to the table at the top.
- [ ] Check production's AI key against Deep Reasoning's model (§6.6) before the videos are shown.
