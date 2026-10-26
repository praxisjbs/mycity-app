# User Guide · Engineering Guide

| | |
|---|---|
| Owner | TB |
| Milestone | M0 (brought forward from M11 by JBS Praxis, 25/10/2026; written milestone by milestone as each is approved) |
| Backend modules | `user_guide` (and its search: `user_guide.meaning.js`, `user_guide.repo.js`, `user_guide.ai.js`; the shared engine `packages/contract/guide-search.js`) |
| Frontend paths | `app/src/features/knowledge/UserGuide.tsx`, `app/src/features/knowledge/guide/` (the way back, the search), `packages/ui/src/documents/GuideBody.tsx`, `packages/ui/src/documents/GuideResults.tsx`, the chip in `app/src/shell/Notices.tsx` |
| Permission key(s) | `knowledge` (view); every chapter, section, task, step and picture is filtered by the reader's own grants |
| Capabilities | none of its own; the guide reads every module's grants and capabilities to decide what each reader receives |
| Screens (PROGRESS.md rows) | #102 Knowledge Hub · User Guide |
| Status | Agreed |
| Last changed | 26/10/2026 |

Sources: MILESTONES §16 (M11: "a user manual written per module against the screens as shipped",
"the manual covers every module with screenshots from the shipped build"), FRONTEND_GUIDE §5.1 (tier 3
text lives in the manual, never on a screen), and JBS Praxis's eight decisions of 25/10/2026 (§6.1).

---

## 1 · What it is for

The User Guide teaches a person who is not technical to use the whole hub without help: where each
screen is, what every button and field does, what each message means, and what to do next. It is
one tab in the Knowledge Hub, written in plain words with pictures of the real screens, and every
instruction that names a screen is a link that opens it. Each reader sees only the parts of the
guide for what they may open: a member of staff never reads how to change Roles & Permissions.

Everyone uses it: new staff on their first day, line managers, Operations & People, administrators
and the CEO. Trainers use the Quick Start in the M11 sessions.

A person who cannot find the right page describes what they want, in their own words, and the
guide's search finds it: by its words, forgiving typing slips and other words for the same thing,
and by its meaning ("I can't get into my account" finds Forgot your password). It can write a short
answer from what it found, and it hears a spoken search (§6.8 to §6.10).

### 1.1 Written milestone by milestone

The guide grows with the product. A milestone's chapters are written once that milestone is
delivered and approved, in its own pull request:

| Pull request | Covers |
|---|---|
| PR 1 (this one) | The feature itself, the gate, the conventions, and the chapters for M0 and the Settings screens already built (M9): signing in, the hub, search, notifications, People · Employees (adding an employee and giving them a login), Settings |
| PR 2 | Milestone 1's screens |
| PR 3 | Milestone 2's screens |
| Later | One per milestone, M3 to M10, after each is approved |

PR 2 and PR 3 run at the same time in separate sessions. They never edit the same file: each
chapter is its own file with its own pictures folder (§4), and a milestone joins the coverage check
by naming itself in its own chapters' front matter, not in a shared list.

## 2 · Screens affected

| Screen / tab (slug) | Where | Who sees it | What it shows | What a person can do there |
|---|---|---|---|---|
| Knowledge Hub · User Guide (`user-guide`) | Staff app | Everyone with `knowledge` view (all seven roles by default) | Quick Start: illustrated cards by role. Full Guide: chapters and sections, filtered by the reader's grants. The search box over both: results as the words are typed, each with the line that answers marked; an answer once asked, with its sources | Switch Quick Start and Full Guide, pick a chapter and section, open a screen from a step or with Open Screen, go back to the step, enlarge a picture; search, Get Answer (or Enter), speak a search, open a result or a source at its step |
| Every screen of the hub | Staff app | Whoever arrived from a guide link | The Back to Guide chip, bottom of the screen (above the bottom bar on a phone) | Return to the exact step they left, or dismiss the chip |
| The floating button (phone) | Staff app | Everyone with `knowledge` view | Help opens the guide at the section for the screen in view | Open the guide where they are |
| The account menu (desktop) | Staff app | Everyone with `knowledge` view | User Guide, opening the section for the screen in view | Open the guide where they are |
| ⌘K Search | Everywhere | Everyone, by permission | A User Guide group: the sections and tasks the guide's own search finds (§6.8; by meaning too for three words or more), "guide" or "how to" before the words narrowing to it | Open the guide at that section, at the step that answers |
| Praxis AI · Ask | Staff app | `praxis_ai` view | A how-to question answered from the guide, citing its sections (§9) | Open a cited section |

## 3 · How the screens relate

1. **Reading.** A person opens Knowledge Hub · User Guide. `GET /api/v1/user-guide` returns the
   contents they may read; `GET /api/v1/user-guide/chapters/:slug` returns one chapter, already cut
   to their grants. Pictures come from `GET /api/v1/user-guide/images/:chapter/:file`, refused
   unless a part of the guide the reader may read shows that picture on that device.
2. **Doing.** A step's link (`/people?tab=employees`) opens the real screen. Before it navigates,
   the guide records where the reader was (`sessionStorage`, `mc-guide-return`: the section, the
   step, its label). The shell shows **Back to Guide · Step 4** on every screen until the person
   presses it, dismisses it or returns to the guide another way.
3. **Returning.** Back to Guide (or the browser's Back) opens
   `/knowledge?tab=user-guide&id=<section>&step=<n>`; the guide scrolls to that step and marks it.
4. **Help where you are.** The floating button's Help (phone) and User Guide in the account menu
   (desktop) open `/knowledge?tab=user-guide&screen=<module>/<tab>`; the guide opens the section
   whose `screen` matches, or the contents when there is none.
5. **Searching.** The box over the guide sends what is typed, a pause after the last key, as
   `POST /api/v1/user-guide/search` (the body, never the address). The service cuts the guide's
   passages to the reader, ranks them by their words and, when the meaning index is there, by how
   near each is to the search's vector (§6.8), and answers a page of 25 sections and tasks, each with
   the line that answers marked and its step as the reader numbers it. A result opens
   `/knowledge?tab=user-guide&view=full&id=<section or task>&step=<n>`, and the words stay in the
   box. ⌘K's Guide group (`user_guide.search.js`) ranks with the same search.
6. **Answering.** Get Answer (or Enter) sends `POST /api/v1/user-guide/answer`. The best six results
   the reader may read go to the Guide Answer action (Fast job), which answers in up to three
   sentences, each citing those results by number; the card shows them with their sources, each
   opening the guide at its step (§6.9). Nothing is kept.
7. **Speaking.** The microphone records; `POST /api/v1/user-guide/transcribe` turns it to words on
   the Guide Voice Search action (Transcription job) and removes the recording; the words land in
   the box and search (§6.10).
8. **Indexing.** The worker's `user-guide-index` schedule, every 15 minutes and at boot, embeds every
   passage that has no vector on the Guide Search model and drops the vectors nothing says any
   more (§6.8, §7). A tick with nothing new spends nothing.
9. **Changing a screen.** A pull request that changes a screen a chapter covers must change that
   chapter, or retake its pictures, or say `User-guide-unchanged: <reason>` (§6.6). Pictures whose
   screen changed after they were taken fail the build until they are retaken.

## 4 · Data

The guide is files, shipped with each release (`scripts/deploy/release-manifest.js` ships
`docs/manual/`). Its search keeps one table, the meaning index, derived entirely from those files:

| Table | Key columns | Notes |
|---|---|---|
| `user_guide_passage` (0510) | `text_hash` (sha256 of what was embedded), `model`, `embedding vector(1536)`, unique on both | One vector per distinct passage on the Guide Search model, HNSW cosine index. No words, no slugs, nothing a person typed: a passage is found by hashing the chapters again. Written only by the index (`user_guide.meaning.js sync`), read by a search |

And the files:

| Path | What it holds |
|---|---|
| `docs/manual/<chapter>.md` | One chapter: front matter, sections, tasks, steps, pictures and their shot specs (§6.2) |
| `docs/manual/quick-start.md` | The Quick Start cards, by role (§6.4) |
| `docs/manual/img/<chapter>/<shot>.desktop.png`, `.phone.png` | The pictures, taken by `npm run guide:shots` |
| `docs/manual/img/<chapter>/shots.json` | For each picture: the hash of its spec and of the screen's source when it was taken (§6.5) |
| `docs/manual/README.md` | How to write a chapter, for the people and agents who write them |

The parser, the filter and the passages are one copy, `packages/contract/guide.js`, and the words
half of the search one more, `packages/contract/guide-search.js`, each used by the API, the
in-browser mock and (the parser) the gate.

Schema migration file(s): `migrations/0510_user_guide_passage.sql`; the ledger's `embedding` step
kind is `migrations/10320_ai_run_step_embedding.sql` (AI Control's). Reference-data file(s): none.

## 5 · API

| Method and path | Contract | Permission · scope | Paged | Notes |
|---|---|---|---|---|
| `GET /api/v1/user-guide` | → `GuideContents` | `knowledge` view | no: one document's outline (§6.7) | The chapters, each with its sections' titles, slugs and screens, and the Quick Start cards' titles, all cut to the reader |
| `GET /api/v1/user-guide/chapters/:slug` | → `GuideChapter` | `knowledge` view | no: one chapter | 404 when the chapter does not exist or nothing in it is the reader's |
| `GET /api/v1/user-guide/quick-start` | → `GuideChapter` (kind `quick-start`) | `knowledge` view | no: one document | The cards the reader may follow, each with its steps; none at all is an empty Quick Start |
| `GET /api/v1/user-guide/images/:chapter/:file` | file (`no_content` in the contract) | `knowledge` view | no | `file` is `<shot>.<desktop or phone>.png`; 404 unless a part the reader may read shows it on that device |
| `POST /api/v1/user-guide/search` | `GuideSearchBody` → `GuideSearchPage` | `knowledge` view · the reader's own cut | yes, 25 | A POST so the words never sit in an address the access log keeps; writes nothing. Under two letters, an empty page. `guideSearchLimiter`, 120 a minute a person |
| `POST /api/v1/user-guide/answer` | `GuideAnswerBody` → `GuideAnswer` | `knowledge` view · the reader's own cut | no: up to 3 sentences, 6 sources | `found: false` with the sources when AI is off or the passages do not answer it, never an error; `guideAnswerLimiter`, 20 a minute |
| `POST /api/v1/user-guide/transcribe` | `DocumentUpload` → `assistant.AiTranscript` | `knowledge` view | no | The recording through the upload engine, removed whatever happens; `draft: true` is a placeholder the screen drops |

`GET /api/v1/user-guide` also says whether an answer (`answers`) and a spoken search (`voice`) can be
had now (AI on for the Knowledge Hub, a Ready model on the action's chain), so the screen offers Get
Answer and the microphone only then.

## 6 · Rules and calculations

### 6.1 Decisions (JBS Praxis, 25/10/2026)

1. The guide is a Knowledge Hub tab, User Guide (`user-guide`), open to all seven roles, findable from
   ⌘K, and reachable from the floating button's Help and the desktop account menu at the screen in view.
2. Every step that names a screen links to it; a **Back to Guide · Step N** chip returns to the step.
3. Pictures are taken by a script from the hub's in-browser demo, on desktop and on a phone, with
   numbered markers matching the steps.
4. Two versions: **Quick Start** (illustrated summaries by role) and **Full Guide** (every screen,
   button, field and message). No PDF.
5. Permission aware, filtered on the server down to the step: a reader never receives text for a
   screen or an action their grants do not allow.
6. A strict gate (§6.6) with one exemption line, `User-guide-unchanged: <reason>`, written into the
   conventions (CLAUDE.md, README, BACKEND_GUIDE, FRONTEND_GUIDE, the PR template).
7. PR 1 covers the foundation, M0 and the Settings screens built early; PR 2 Milestone 1; PR 3
   Milestone 2; later milestones as each is approved.
8. Employee creation was audited and fixed in PR 1 (`docs/guides/foundation.md` §6.16), and its
   chapter written against the fixed screens.

The search (JBS Praxis, 25/10/2026, asked before it was built):

9. **By words and by meaning.** Every section, task and step is found by its words, forgiving slips,
   half typed words and other words for the same thing, and by its meaning, on the Embeddings job
   (OpenAI's small model at 1,536); the two rankings are put together. With AI off or no OpenAI key
   the words answer alone.
10. **A short answer, on the Fast job.** Asked for (Get Answer, Enter), up to three sentences written
    only from the results the reader may read, each citing them. JBS Praxis chose Fast over the
    recommended Default (cheaper and quicker; AI Control §6.2 keeps Fast for short work), and it is
    registered as theirs (`guide-answer`, `chosen_by: JP`).
11. **Everywhere a person looks for help.** The guide's own box (desktop and phone), ⌘K's Guide
    group on the same search, Praxis AI answering how-to questions from it (`guide.search`), and a
    spoken search (Transcription job, `guide-voice`).
12. **Nothing anyone types is kept.** No log of searches or misses ("not now"): a search and a
    question travel in a POST body, never an address the access log keeps; the screen keeps them in
    its own memory only; the ledger records a run's tokens, never its words. A recording is removed
    as soon as its words are read. (Praxis AI keeps a question in the asker's own History, as it
    keeps every question: praxis-ai.md decision 7.)

### 6.2 A chapter file

~~~md
---
title: People
module: people
milestones: M0
summary: The staff register, records and logins.
---

## Employees {#people-employees screen=people/employees}

The staff register: everyone who works for MyCity.

![The Employees screen](shot:people-employees)

### Add an employee {#people-add-employee needs="people create"}

1. Open [People · Employees](/people?tab=employees).
2. Press **Add Employee**. ![The first step](shot:people-add-step-1)
3. {needs="people view"} ...

```shot people-employees
open: /people?tab=employees
as: operations
marks:
  1: button "Add Employee" | Add a person
  2: searchbox | Find anyone by name or number
```
~~~

- **Front matter**: `title` (required), `module` (a catalogue key; orders the chapter as the rail
  does), `order` (for a chapter with no module: Getting Started is 0), `milestones` (the milestones
  whose screens this chapter is responsible for, §6.6), `summary` (one line), `covers` (extra code
  paths whose change must touch this chapter; the screens' feature folders are always covered).
- **Section**: `## Title {#slug ...}`. `screen=<module>/<tab>` ties it to a tab; `needs="..."` adds
  grants. A section with a screen is shown only to a reader the shell shows that tab to (the same
  `tabVisible` ⌘K uses), so its permission always matches its screen.
- **Task**: `### Title {#slug needs="..."}` inside a section: one job, its steps.
- **Steps**: a numbered list. A step may start with `{needs="..."}`. A picture on a step's line or
  indented under it belongs to the step.
- **Bold** names a thing on screen exactly as it reads (**Add Employee**). Italics are for emphasis
  and sample data. `Code` is something to type. Bold is never emphasis: the gate looks every bold name
  up in the app's source.
- **Links**: `/module?tab=x` opens a screen (the gate checks it exists); `#slug` opens another
  section of the guide; `https://` opens a page outside. Write the screen's name as the link text.
- **Notes**: `> **Tip:**`, `> **Important:**` or a plain `>` line.
- **Tables**: pipe tables, for a form's fields (Field, What to Enter, Needed).
- **Pictures**: `![What it shows](shot:<id>)` and, anywhere in the file, a fenced `shot <id>` block:
  `open` (the address), `as` (the demo account: operations, ceo, manager, staff, admin), `device`
  (`both`, `desktop` or `phone`; both unless set), `do` (steps before the picture: `click`, `fill`,
  `press`, `wait`), `marks` (number: target `|` what it is), `crop` (`page`, `modal`, `viewport`
  or a selector), `sources` (extra code paths the picture depends on).

`needs` reads `"<module> <action>"`, a comma between several, `cap <code>` for a capability,
`manager` for someone with people reporting to them, and `ceo`. Every key, action and capability is
checked against `src/shared/access/access.catalog.js`.

### 6.3 What a reader receives

A chapter is filtered on the server before it is sent, by the reader `shared/search` builds for ⌘K
(grants, capabilities, CEO, manages people):

- A section with a `screen` is kept when `tabVisible(screen, reader)` holds, and its `needs` too.
- A task, step, paragraph, picture, note or table row with `needs` is kept only when the reader holds
  every one. A step that goes leaves the numbering whole: steps are renumbered after filtering.
- A link to a screen the reader may not open becomes plain text; so does a link to a section they
  may not read.
- A chapter with nothing left is not listed, and `GET /chapters/:slug` answers 404.
- A picture is served only when a kept block shows it.

The CEO receives everything. The filter is in `packages/contract/guide.js` (`filterChapter`), so the
mock filters as the API does.

### 6.4 Quick Start

`docs/manual/quick-start.md` holds cards: `## Title {#qs-slug role="Everyone" needs="..."}` with
one picture and three to six steps, each step linking to the screen and to the Full Guide section
that explains it. The roles are Everyone, Line Managers, People & HR and Administrators; a card's
role only groups it, its `needs` decide who receives it.

### 6.5 Pictures

`npm run guide:shots` (`scripts/guide/shoot.js`) builds the hub's demo build, signs in as each
shot's account, opens its address, runs its `do` steps, draws the numbered markers over the
targets and saves `<shot>.desktop.png` (1440 × 900) and `<shot>.phone.png` (390 × 844). It writes
`shots.json` beside them: the hash of the spec and the hash of the source the picture depends on (the
screen's feature folder, plus `sources`). `-- --chapter people` retakes one chapter, `-- --shot
<id>` one picture, `-- --stale` only the ones the gate calls stale.

A picture shows the screen and nothing that comes and goes by itself: toasts, the urgent bar, the
shell's notices (`data-shell-notice`) and a tooltip left by focus are hidden, and a panel a step
opened (the bell's) is closed before the next picture. With a dialog or sheet open, a target is
looked for inside it first, since the screen behind may hold one of the same name. The marked
targets are brought into view together, centred in the box that scrolls them, and measured only
after the last scroll; a mark whose target is not on screen with the others fails the picture, so
the spec drops the mark or splits the picture. A picture of the guide itself opens a section with
no picture, or it would show an older copy of itself.

When a screen is reached differently on a phone (the account menu on a computer, More on a phone),
the section takes two pictures, one for each device, each beside the sentence about its device.
When only the way in differs and the picture shows the same thing (a form the phone opens from More
Actions or Quick Actions, a cog where the computer has a labelled button), one spec serves both: a
step that starts `phone ` or `desktop ` runs on that device only. A `lock:` step shows the lock screen as another tab would tell
it (the session's channel), and the next picture starts signed in afresh.

The demo's data is the staging seed's (F13), so the pictures show the people and figures a trainee
sees on staging. Nothing in a picture is a real person's private data.

### 6.6 The gate (`scripts/check/user-guide.js`, in `npm run ci`)

Every run:

1. Every chapter parses: front matter, unique slugs, known attributes, no stray syntax.
2. Every screen link and section `screen` is a tab in `src/shared/route-map.js`.
3. Every `#slug` link names a section or task that exists.
4. Every `needs` names a real module, action or capability.
5. A task or step that names an action from ⌘K's actions (**Add Employee**, **Invite User**)
   declares that action's grant, or sits in a section that does.
6. Every bold name is found in the app's source (`app/src`, `packages/ui/src`).
7. Every `shot:` picture has its spec, both files it declares, and a `shots.json` entry whose hashes
   equal today's: a picture whose screen changed after it was taken is stale. Every picture file has a
   spec (no orphans).
8. For every milestone a chapter names in `milestones`, every screen of that milestone in
   `docs/PROGRESS.md` (Dropped aside) has a section with its `screen`.
9. A file in `docs/manual/` that is neither a chapter (front matter) nor empty waits for its
   milestone's guide pull request and is named, with why, in the gate's `WAITING` list (empty
   since Milestone 1's chapters); an entry whose file became a chapter is stale. Icons are the hub's own (`Icon.tsx`).

On a change (the files the branch changed):

10. A change to code a chapter covers (its screens' feature folders, its `covers`, its pictures'
   `sources`; tests aside) must change the chapter or its pictures. Escape hatch, in the PR
   description or a commit message: `User-guide-unchanged: <reason>`. Pictures still must not be
   stale.

Bold names are looked up in the app, `packages/ui`, `src/` (the API's messages), the contract's
schemas and the reference seeds, with whitespace folded, so a label broken over two JSX lines is
found. A name the screen builds from data ("New Department") is written as the screen shows it if
the words are in the source, or not in bold.

The Stop hook runs it with progress, guides and the README map.

### 6.7 Why the contents are not paged

The contents (`GET /user-guide`) is one document's outline: at most one chapter per module (16),
each naming its sections. It is returned whole, as a record's tabs are; nothing in it grows with use.
⌘K's Guide group pages at 25 like every search group.
The search pages its fused results at 25 the same way (`pageOf`, `envelope`): every candidate is
ranked, then the page is cut.

### 6.8 Search

**Passages** (`guide.js passagesOf`). Each section's and task's title, each paragraph, note, bullet,
table row (as `Field: value; What to Enter: value`) and picture (its words and its marks' words), and
each step (its picture's words read but not shown). Each carries what a reader needs to receive it,
the same needs `filterChapter` cuts by, so `passageFor` answers whether this reader receives it and,
for a step, its number as they read it. One more passage stands for the whole of each section and
task (its title and every part with no `needs` of its own): only the meaning index reads it. The
Quick Start is left out; its cards say again what the chapters say.

**The words half** (`guide-search.js`). Words are folded (case, accents, apostrophes), stemmed
(Porter's algorithm: approve, approved, approval are one) and scored by BM25, a title more than a
line (1.8), the words of the section or task a passage sits in a little (0.3) and of its chapter
less (0.15). For each word typed:

- other words for the same thing count a little less (0.65 for a group's first, 0.55 for the rest):
  `SYNONYMS`, MyCity's words among them (off day, resumption, query letter). **A writer who sees a
  search miss adds the reader's word to its group**;
- a word the guide never uses finds the guide's words one slip away (two from eight letters), at
  0.75 or 0.5;
- the last word, still being typed, finds the guide's words it starts (0.7);
- words that say nothing (how, do, my, can't) are left out, and words that only help (take, see,
  someone) count when found but are not needed.

A search of one or two words needs every word found; a longer one, half of them. When no passage
holds every word of a short search, it is searched again for half ("apply for leave" finds Request
leave). A word the guide never uses, nor anything a slip or a prefix away, is never needed. Words
found in order, as typed, count 1.4 times.

**The meaning half** (`user_guide.meaning.js`). Each passage's `context`, text and picture words are
embedded once, on the Guide Search action (`guide-search`, Embeddings job), and kept by the hash of
what was embedded (§4). A search is embedded the same way (4 s, no retry; kept nowhere), and the
database answers how near each passage the reader may read is (cosine), leaving out every one below
`MEANING_FLOOR` (0.32); the engine keeps those within `MEANING_BAND` (0.1) of the nearest.

**Together.** Each section or task takes its best passage; the two rankings are fused by reciprocal
rank (`RRF_K` 20), meaning counting fully for a search of three words or more and 0.6 below that; a
title typed in full comes first. A result's line is its best passage by its words, else by its
meaning, cut to 200 characters around the first word found, the words found marked; its step is
set only when that line is a step that answered.

**The index** (`sync`, the `user-guide-index` schedule and worker boot). Hashes the chapters,
embeds what has no vector on the model in batches of 96, outside any transaction, then in one
transaction keeps the new vectors and drops those of passages gone and of any other model, with one
`user_guide.indexed` event naming counts only. A new model on AI Control is a new index, built by
the next tick; until then the words answer alone. The guide's vectors never lock the Embeddings
chain (ai-control.md §6.6): they are rebuilt from the files.

**⌘K.** The Guide group searches the same way. A term of three words or more is embedded in the
provider's `prepare`, before ⌘K's transaction opens, given 1.5 s; shorter terms by their words
alone, since ⌘K is typed into all day.

### 6.9 The answer

The best six results the reader may read, each with its lines (steps numbered as they read them, at
most 40 lines), go to the Guide Answer action (`guide-answer`, Fast job, personal data, so never
DeepSeek; `prompts/guide-answer.md`), 15 s at most. It answers `GuideAnswerOutput`: whether the
passages answer it, and up to three sentences of at most 30 words, each citing at least one passage
by number; a number outside the six is refused and asked again once. The answer is written only
from those passages and names screens and buttons as they do. AI off, a model that fails, the stub,
or passages that do not answer it: `found: false`, and the results stand alone. Nothing is kept.

### 6.10 A spoken search

The microphone (`VoiceField`, at most 30 s) uploads the recording; the service stores it in the vault
as `guide_voice_search` (transient, readable only by its speaker), transcribes it on the Guide Voice
Search action (`guide-voice`, Transcription job, personal data) and removes it whatever happens. The
words land in the box and are searched. A placeholder (no provider answered) is dropped. The
microphone shows only while a model is Ready on the chain (`GuideContents.voice`).

## 7 · Events, jobs and notifications

| Event / job | When | Does |
|---|---|---|
| `user_guide.indexed` | The index kept new vectors or dropped old ones | Audit only, counts and the model; never a passage's words or anyone's search |
| `user-guide-index` schedule | Every 15 minutes, and once at worker boot (under its cron lock) | `sync` (§6.8): nothing to do spends nothing; AI off or no OpenAI key does nothing |

The API parses `docs/manual/` once, at the first request after boot, and keeps it in memory, with its
words index.

## 8 · Permissions and visibility by role

| Role | Sees | Can do |
|---|---|---|
| Staff | Getting Started, their own screens (ESS, Workspace, Community, Mailbox, Home's Overview) | Read, open screens from steps |
| Line Manager | The above, plus what a manager may open (Team, approvals) | The same |
| Operations & People | People, Settings they hold, and every screen they may open | The same |
| System Administrator | Settings, Users, Roles & Permissions, Integrations | The same |
| Management, Implementation, the CEO | Everything their grants reach (the CEO: everything) | The same |

No restricted field appears in the guide's text or pictures (the demo's data only).

## 9 · AI and search

- **AI reads** (`user_guide.ai.js`): `guide.search`, the sections and tasks the asker may read that
  answer a how-to question, a page of 25, each row its title, chapter, section, screen, step and its
  lines (400 characters), citing `guide_section` (which opens the guide at it). Praxis AI's Data
  Answers chooses it for questions about using the hub.
- **AI routes**: "read how to use a screen in the User Guide" → `knowledge.user-guide`.
- **AI actions** (`services/ai/actions.js`, chosen by JBS Praxis on 25/10/2026): Guide Search
  (`guide-search`, Embeddings), Guide Answer (`guide-answer`, Fast), Guide Voice Search
  (`guide-voice`, Transcription), all under the `knowledge` module's switch, all personal data.
- **Search** (`user_guide.search.js`): type `guide_section`, ranked by the guide's search (§6.8);
  opens the guide at the section or task, at the step that answers.

## 10 · On screen and mobile

### 10.1 Content tiers

| Screen | Open (tier 1) | Behind help (tier 2) | Not on screen (tier 3), lives in |
|---|---|---|---|
| Knowledge Hub · User Guide | Quick Start and Full Guide switch; the search box and the microphone; the contents (chapters and sections); the section's chapter, title and Open Screen; its text, tasks, steps, pictures and their numbered legends; the screen links in steps | None | How the guide is filtered, written and checked: this guide §6 |
| The search's results | Get Answer; the Answer card (its sentences, their source numbers, the sources); each result's title, where it sits, its Step pill and its line with the words found marked; the pager; No Matches | None | How results are ranked and answers written: §6.8, §6.9 |
| Back to Guide chip | Back to Guide · Step N, and a close button | None | Where the return is kept: this guide §3 |

The guide's own text is content a person reads (`data-copy="content"`), not interface copy: gate 8's
word limits do not count it, as they do not count an article.

### 10.2 Phone layout

| Screen | First on a phone | Left off a phone | Main action | Navigation |
|---|---|---|---|---|
| Knowledge Hub · User Guide | The Quick Start and Full Guide switch, the search box with the microphone, then the role groups' cards (Quick Start) or the chapter chips over the section (Full Guide) | The side contents list (the chips replace it) | Open on a step, full width under it | Bottom bar More, Knowledge; the tabs scroll sideways |
| The search's results | Get Answer, the Answer card, then the results as full width rows | A source's chapter and section (its title stays) | Open a result | Opening one shows the guide at it; changing the words brings the results back |
| Back to Guide chip | A pill above the bottom bar and left of the floating button | Nothing | Back to Guide | Pressing it returns to the step |

## 11 · Edge cases

- **A step's screen is closed to the reader**: the step is not sent (it carries the screen's
  `needs`), or its link is plain text when only the link is closed.
- **A reader whose grants change**: the next load reads the new grants; nothing is cached per person.
- **The chip on the guide itself**: hidden while the guide is on screen; cleared on Sign Out.
- **Two tabs**: the chip belongs to the browser tab (`sessionStorage`), so another tab is untouched.
- **A deep link to a section the reader may not read**: the guide opens its contents.
- **A picture missing on the server**: the step shows its text without the picture; the gate makes
  this impossible in a release.
- **A phone reading a desktop-only picture**: the desktop picture is shown, fitted to the width.
- **AI off, the Knowledge Hub's AI off, the cap reached, or no OpenAI key**: the search is its words
  alone, Get Answer and the microphone are not offered, and the index's tick does nothing.
- **A chapter changed by a release**: its new passages are found by their words until the next tick
  embeds them; a passage's old vector is never used for new text (the hash differs).
- **The embedding model changed on AI Control**: no vector matches the new model, so the words
  answer alone until the next tick rebuilds the index.
- **A reader whose grants change**: the passages and the answer's sources are cut afresh on every
  search; a vector is the same for every reader, so nothing is cached per person.
- **A question that names someone**: it goes only to the models the action's chain allows for
  personal data, and is kept nowhere.

## 12 · Donor code

| From | File | Change on the way in |
|---|---|---|
| None | | Written new. The A4 performance training guide (`docs/manual/performance-guide/`) stays as it is: a printed document for trainers |

## 13 · Open questions

- Who signs off each milestone's chapters before the next PR starts (TB proposed as reviewer).

## 14 · Change log

- 26/10/2026 · JP · The guide's search, from JBS Praxis's decisions of 25/10/2026 (§6.1 decisions 9 to
  12): passages (`guide.js passagesOf`, `passageFor`), the words half and the fusion
  (`packages/contract/guide-search.js`), the meaning index (`user_guide_passage`, migration 0510,
  the `user-guide-index` schedule, `ai.embed()` on Guide Search), `POST /user-guide/search`, an answer
  on the Fast job (`POST /user-guide/answer`, Guide Answer), a spoken search
  (`POST /user-guide/transcribe`, Guide Voice Search), ⌘K's Guide group on the same search (and
  `prepare` in shared/search), Praxis AI's `guide.search` read, and the box, results and Answer card
  on the screen (`GuideResults`, `GuideAnswerCard`). §2, §3, §4, §5, §6.8 to §6.10, §7, §9 to §11.

- 25/10/2026 · JP · Praxis AI and AI Control get their chapters (`praxis-ai.md`, `ai-control.md`), live screens brought forward from M10, without naming M10; the Quick Start gains Ask Praxis AI and Watch AI Spend. §6.5: a `lock:` step, a step for one device (`phone click: ...`) where only the way in differs, and two pictures where a phone reaches a screen another way. Phone pictures for the 38 that had a desktop one only, and pictures for the five sections that had none (the lock screen, the display, help, importing staff, a login's actions); 147 pictures.
- 25/10/2026 · JP · Written: the User Guide tab, its API filtered to the step, the pictures, the Back
  to Guide chip and the gate, from JBS Praxis's decisions of 25/10/2026 (§6.1).
- 25/10/2026 · JP · §6.5: what a picture hides, targets looked for in the open dialog first, marks
  measured after the last scroll and refused when off screen. The M0 chapters and their 31 pictures
  written; `tests/integration/user-guide.test.js` reads them as staff, Operations and an
  administrator.
- 25/10/2026 · JP · Milestone 1's chapters: Home, Employee Self-Service, Mailbox and Staff Community
  (both rewritten from their drafts), Knowledge Hub, and People's Organogram, Attendance, Leave,
  Devices and Worksites; eight Quick Start cards; 95 pictures in all. §6.6 point 9: `WAITING` is
  empty.
- 25/10/2026 · JP · PR 3, Milestone 2: the My Workspace and Performance chapters
  (`docs/manual/my-workspace.md`, `docs/manual/performance.md`, both `milestones: M2`), every M2
  screen of `docs/PROGRESS.md` with its section, ESS · My Performance a section of the Performance
  chapter (`screen=ess/my-performance`); 23 pictures, and eleven Quick Start cards after Check the
  System, cut by grant and by the Performance capabilities. Two screen fixes found on the way
  (`docs/guides/performance.md` §14). No picture is taken as `manager`: the demo's line manager
  opens on a Policy Update prompt (`dismissible: false`) that the script's Escape does not close.
