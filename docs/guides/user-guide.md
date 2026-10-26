# User Guide · Engineering Guide

| | |
|---|---|
| Owner | TB |
| Milestone | M0 (brought forward from M11 by JBS Praxis, 25/10/2026; written milestone by milestone as each is approved) |
| Backend modules | `user_guide` |
| Frontend paths | `app/src/features/knowledge/UserGuide.tsx`, `app/src/features/knowledge/guide/` (the way back), `packages/ui/src/documents/GuideBody.tsx`, the chip in `app/src/shell/Notices.tsx` |
| Permission key(s) | `knowledge` (view); every chapter, section, task, step and picture is filtered by the reader's own grants |
| Capabilities | none of its own; the guide reads every module's grants and capabilities to decide what each reader receives |
| Screens (PROGRESS.md rows) | #102 Knowledge Hub · User Guide |
| Status | Agreed |
| Last changed | 25/10/2026 |

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
| Knowledge Hub · User Guide (`user-guide`) | Staff app | Everyone with `knowledge` view (all seven roles by default) | Quick Start: illustrated cards by role. Full Guide: chapters and sections, filtered by the reader's grants | Switch Quick Start and Full Guide, pick a chapter and section, open a screen from a step or with Open Screen, go back to the step, enlarge a picture |
| Every screen of the hub | Staff app | Whoever arrived from a guide link | The Back to Guide chip, bottom of the screen (above the bottom bar on a phone) | Return to the exact step they left, or dismiss the chip |
| The floating button (phone) | Staff app | Everyone with `knowledge` view | Help opens the guide at the section for the screen in view | Open the guide where they are |
| The account menu (desktop) | Staff app | Everyone with `knowledge` view | User Guide, opening the section for the screen in view | Open the guide where they are |
| ⌘K Search | Everywhere | Everyone, by permission | A User Guide group: sections and tasks whose words match ("guide" or "how to" before the words narrows to it) | Open the guide at that section |

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
5. **Searching.** ⌘K's Guide group (`user_guide.search.js`) matches section and task titles and
   words, filtered exactly as the chapters are, and opens the section.
6. **Changing a screen.** A pull request that changes a screen a chapter covers must change that
   chapter, or retake its pictures, or say `User-guide-unchanged: <reason>` (§6.6). Pictures whose
   screen changed after they were taken fail the build until they are retaken.

## 4 · Data

No tables. The guide is files, shipped with each release (`scripts/deploy/release-manifest.js`
ships `docs/manual/`):

| Path | What it holds |
|---|---|
| `docs/manual/<chapter>.md` | One chapter: front matter, sections, tasks, steps, pictures and their shot specs (§6.2) |
| `docs/manual/quick-start.md` | The Quick Start cards, by role (§6.4) |
| `docs/manual/img/<chapter>/<shot>.desktop.png`, `.phone.png` | The pictures, taken by `npm run guide:shots` |
| `docs/manual/img/<chapter>/shots.json` | For each picture: the hash of its spec and of the screen's source when it was taken (§6.5) |
| `docs/manual/README.md` | How to write a chapter, for the people and agents who write them |

The parser and the filter are one copy, `packages/contract/guide.js`, used by the API, the
in-browser mock and the gate.

Schema migration file(s): none. Reference-data file(s): none.

## 5 · API

| Method and path | Contract | Permission · scope | Paged | Notes |
|---|---|---|---|---|
| `GET /api/v1/user-guide` | → `GuideContents` | `knowledge` view | no: one document's outline (§6.7) | The chapters, each with its sections' titles, slugs and screens, and the Quick Start cards' titles, all cut to the reader |
| `GET /api/v1/user-guide/chapters/:slug` | → `GuideChapter` | `knowledge` view | no: one chapter | 404 when the chapter does not exist or nothing in it is the reader's |
| `GET /api/v1/user-guide/quick-start` | → `GuideChapter` (kind `quick-start`) | `knowledge` view | no: one document | The cards the reader may follow, each with its steps; none at all is an empty Quick Start |
| `GET /api/v1/user-guide/images/:chapter/:file` | file (`no_content` in the contract) | `knowledge` view | no | `file` is `<shot>.<desktop or phone>.png`; 404 unless a part the reader may read shows it on that device |

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
- A need is `<module> <action>`, `cap <code>`, `manager`, `ceo`, or `team`: whoever sets work for
  others, as My Workspace decides (the CEO, or anyone whose `workspace` create reaches another active
  employee). `<one> or <another>` is held when either is, for a task two kinds of reader take, such
  as a scorecard drafted by a manager or by Operations and People.
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
sees on staging. Nothing in a picture is a real person's private data. The pictures run on a fixed
clock, 25/10/2026 at 12:00 in Lagos, so a date in them, and the prompts that open at a shift's start,
are the same on every run; a prompt that opens on arrival is closed before the `do` steps. A menu, or
a select's list that floats outside its dialog, is searched before the dialog while it is open, so a
step can pick an option (`click: role option "Marketing & Sales"`).

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

## 7 · Events, jobs and notifications

| Event / job | When | Does |
|---|---|---|
| None | | The guide is read only; the files change with a release |

The API parses `docs/manual/` once, at the first request after boot, and keeps it in memory.

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

- **AI reads**: none yet (`// ai:none` in `user_guide.controller.js`): the assistant answers how-to
  questions from the guide in M10 (`docs/guides/praxis-ai.md`).
- **AI routes**: none.
- **Search** (`user_guide.search.js`): type `guide_section`, the sections and tasks a reader may read,
  by title, the chapter's title and the section's words; opens the guide at the section.

## 10 · On screen and mobile

### 10.1 Content tiers

| Screen | Open (tier 1) | Behind help (tier 2) | Not on screen (tier 3), lives in |
|---|---|---|---|
| Knowledge Hub · User Guide | Quick Start and Full Guide switch; the contents (chapters and sections); the section's chapter, title and Open Screen; its text, tasks, steps, pictures and their numbered legends; the screen links in steps | None | How the guide is filtered, written and checked: this guide §6 |
| Back to Guide chip | Back to Guide · Step N, and a close button | None | Where the return is kept: this guide §3 |

The guide's own text is content a person reads (`data-copy="content"`), not interface copy: gate 8's
word limits do not count it, as they do not count an article.

### 10.2 Phone layout

| Screen | First on a phone | Left off a phone | Main action | Navigation |
|---|---|---|---|---|
| Knowledge Hub · User Guide | The Quick Start and Full Guide switch, then the role groups' cards (Quick Start) or the chapter chips over the section (Full Guide) | The side contents list (the chips replace it) | Open on a step, full width under it | Bottom bar More, Knowledge; the tabs scroll sideways |
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

## 12 · Donor code

| From | File | Change on the way in |
|---|---|---|
| None | | Written new. The A4 performance training guide (`docs/manual/performance-guide/`) stays as it is: a printed document for trainers |

## 13 · Open questions

- Who signs off each milestone's chapters before the next PR starts (TB proposed as reviewer).

## 14 · Change log

- 26/10/2026 · JP · Every chapter checked against its screens, string by string (a sweep of each
  screen's buttons, fields, columns, messages, server refusals and schema marks, then a reader per
  chapter giving each a verdict), and every gap closed in one PR: the steps a screen asks for, each
  message it can show with what to do, success messages, what differs on a phone, and the grant each
  step needs. Getting Started gains Confirm It's You (one task, linked from ESS and Settings), Sign
  out, saving a download, and When a Screen Cannot Open (offline, a new version, Coming Soon, errors,
  a link you cannot open, unsaved changes). §6.3: the needs `team` and `<one> or <another>`. §6.5:
  the fixed clock and the floating list. 199 pictures.

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
