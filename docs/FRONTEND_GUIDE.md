# MyCity App ERP · Frontend Guide

**Read this before writing any frontend code, whether you are a person or an AI.** It covers both
React apps: the staff app (`app/`, `hub.mycityapp.io`) and the public site (`public-app/`,
`go.mycityapp.io`).

Status: **the rules here are settled; the foundation sections (§9) are filled in by the frontend
foundation owner, AJ (Adole Jerome),** as the shell, tokens and shared components land. Started 13 October 2026 from
MILESTONES §1.1, §3 and §17 and the 12 October internal meeting; §5, §7 and §8 rewritten 14 October
2026 into the screen content, two shells and form conventions (below). If something here is wrong or
missing, fix the guide in the same PR as the code.

**Why this product looks the way it does.** At the first internal meeting (8 October, 00:20:59 to
00:27:55) we agreed corporate aesthetics, extreme simplicity, minimal text and illustrative icons:
"anywhere we need to even have any explanations or any longer text … hide it", "on mobile … does it
look like a mobile application … less text", and that these must be gates in CI, not wishes in a
document. On 10 October (01:36 to 01:38) the client approved exactly that interface: "very less text
… more of icons … nothing tough or complicated". A screen that reads like a manual breaks a promise
the client has already accepted.

---

## 1 · Before you write anything

1. **Find the screen** in `docs/PROGRESS.md` and read its feature guide in `docs/guides/`,
   especially **§10 On screen and mobile**: what the screen shows open, what sits behind help, and
   its phone layout. If §10 does not say, add it to the guide before you build.
2. **Look at it in `docs/MyCity-ERP-Documents/demo.html`.** The demo is the visual reference for
   layout, components and look. It is **never** a source of data, field names, rules or numbers;
   it contradicts the documents in places and that is accepted. The contract and the guides win.
   The demo is held to the same gates as the app (§10): it is shown to the client, so nothing in it
   is a "build note".
3. **Check the shared components** (§9.4) before building one. A second table, modal, pager, form
   field or date picker is a defect, and for form fields the build refuses it (§8.6).

---

## 2 · Stack

React 18 · Vite · TypeScript · Tailwind with shadcn/ui role tokens · Geist (one family) · Lucide
icons (`lucide-react`) · PWA on the staff app only. Two separate builds: the public site never
imports from the staff app (A9: a different origin shares no cookie, storage or service worker).

**From the HTML demo to React.** `demo.html` is translated into React + Vite components: one
component per real UI element, shared where the demo repeats itself. The HTML file stays in
`docs/MyCity-ERP-Documents/` as a reference and is never served or imported.

---

## 3 · Talking to the API

- **Only through the generated contract.** The API client is typed against `Endpoints` in
  `packages/contract/contract.gen.ts`:
  `api.call("GET /api/v1/employees", { query: { page: 2, q: "ada" } })`.
  A wrong path, a wrong field name or a wrong response shape is a TypeScript error.
- **No local Zod.** Forms validate with the runtime schemas exported from `@mycity/contract`, the
  same ones the API uses. ESLint forbids importing `zod` in `app/` and `public-app/`.
- **snake_case** field names, exactly as the API sends them. Do not map them to camelCase.
- Money arrives as a string (`"1250000.00"`); dates as ISO (`"2026-10-13"`). Format at render
  time only (§6).

---

## 4 · Lists: 25 per page, from the server, always

The rule from the 12 October meeting, for every table, list, card grid, picker and search result:

- **The server pages. The page size is 25 and is not configurable.** Import `PAGE_SIZE` from
  `@mycity/contract` if you need the number; never declare your own.
- Send `page` and the list's filters. Never send `limit`, `offset`, `per_page` or `page_size`.
  The API refuses unknown keys, and `scripts/check/pagination.js` fails the build if the frontend
  names one.
- Every list response is `{ data, page: { number, size, total, pages, has_next } }`. The shared
  pager reads `page`; show the true total ("312 employees"), never "showing 25". The pager is the
  only place the total appears; never a sentence explaining the page size.
- **Search and filters go to the server** (`q` and the list's filter params). Never filter or sort
  the 25 rows you have and present the result as the whole list: that is the praxis-ls bug where a
  search said "no results" for records on page 4.
- Infinite scroll on mobile is the same API: fetch `page + 1` when `has_next`.
- Never fetch "all" of anything to build a dropdown. Pickers search the server and show the first
  page.

---

## 5 · What the screen carries (gate 8, the five-second rule)

A person who opens a screen should know what it is for and what to do within five seconds. A page
carries what a person needs to **act**. Everything else is one hover or one tap away, or not on
the screen at all.

### 5.1 Three tiers

Every piece of text on a screen belongs to exactly one tier. Decide it in the feature guide's §10
before you build; the reviewer checks the screen against that table.

| Tier | What it is | Where it goes | Examples |
|---|---|---|---|
| **1 · Operational** | Data, status, numbers, the actions a person takes, and the labels that name them | **Open** on the screen | KPI cards, the roster, Over By, Clear Alert, Clock In |
| **2 · Support** | Help a person needs, occasionally, to act correctly: what a number means, what a rule counts, a policy line that changes what they do | **Collapsed**, closed by default: a help term (§5.2) for one or two sentences, a Details row for a section | What "Over By" measures; the grace period on a shift |
| **3 · System** | How the product is built or why we designed it that way: architecture, permissions mechanics, data sources, audit plumbing, reassurance about things the person did not ask | **Never on a screen.** It belongs in the feature guide, the user manual (`docs/manual/`, M11) or the AI assistant | "Alerts are not notifications", "How a report is built", "How the team view reads", "Location is read only for this action and is not continuously tracked", "One time and location reading will be recorded", "Lists page at 25" |

Rules that follow from the tiers:

- **A feature guide's §3 and §6 are for engineers.** A sentence there never becomes a card, a
  caption or a footnote on its own. Only what the guide's §10 lists as tier 1 or tier 2 reaches a
  screen.
- **No explainer cards.** A card whose title starts with How, Why, What, When, Where or About, or
  that states a fact about the system ("A user is not an employee", "Built and handed over empty"),
  is tier 3. Delete it. If a piece of it is genuinely tier 2, move that piece to a help term or a
  Details row on the card it explains.
- **No footnotes.** A screen or a card ends with its content, not with a sentence about it.
- **No reassurance lines.** Privacy, audit and "this will be recorded" statements belong in the
  privacy notice and the manual. A modal footer carries buttons only.
- **No obvious statements.** If the person already knows it ("leave is approved by your line
  manager", module demos 12/10, 00:39), it is not written anywhere.
- **Gated and empty screens say less, not more.** An illustration, a title, one short line, one
  action at most.

### 5.2 Help: the help term and the Details row

Tier 2 has exactly two shapes, both from `app/src/components/ui/` (§9.4). Nothing else hides or
reveals help.

**Help term (`HelpTerm`), for one or two sentences.** Help attaches to the word it explains (a
field label, a KPI title, a column header, a card title), not to a separate icon, so the screen is
not covered in ⓘ marks (decided 14/10/2026).

- The term carries a light dotted underline. That is the only visible marker.
- **Desktop:** hovering the term, or reaching it with Tab, opens a small popover after about 300 ms.
  The popover stays while the pointer is over the term or the popover, and Esc closes it (WCAG
  1.4.13: dismissible, hoverable, persistent).
- **Phone:** there is no hover. Tapping the term opens the text in a bottom sheet.
- The text stays in the DOM in a visually hidden node, linked with `aria-describedby`. It is never
  inside a `<label>` or heading, so it never joins the accessible name of what it explains.
- An ⓘ icon button is used only where there is no word to attach to (a chart, an icon-only
  control), and it opens the same popover or sheet.
- At most **35 words**. More than that is tier 3: it goes to the manual.

**Details row (`Details`), for a section.** One row at the foot of the card it belongs to, with a
chevron and the word Details, **closed on every visit** (the open state is never remembered). On
desktop it expands inline; on a phone it opens a bottom sheet. At most **60 words**, short
label and value pairs rather than prose. One Details row per card at most.

### 5.3 Word limits

The limits are numbers, not judgement, and `scripts/check/five-second.js` refuses a screen that
breaks one. The numbers live in one place, `scripts/check/lib/copy.js` (`LIMITS`); this table
mirrors it. Words are counted as tokens that contain a letter, so numbers, dates and money are
free.

| Element | Limit |
|---|---|
| Page title | 3 words |
| Page subtitle | 8 words, desktop only (hidden on a phone) |
| Card, section, modal and KPI title | 4 words, a noun phrase; never How, Why, What, When, Where or About; never a sentence with "is" or "are" |
| KPI caption (the line under the number) | 5 words |
| Button, tab, filter chip | 3 words |
| Field label | 4 words |
| Placeholder | 3 words, a format example only (`DD/MM/YYYY`) |
| Field error | 4 words |
| Toast | 8 words |
| Empty state | an illustration, a title, 8 words, one action |
| Chart caption | 8 words, desktop only |
| Help term text | 35 words |
| Details row | 60 words |
| Any sentence anywhere on a screen | 20 words |
| Modal footer | buttons only, no text |
| First phone screen | 40 words of interface copy (§7) |

Content a person wrote or received (a message, an email, an article, a document preview, a task
title, a comment) is data, not interface copy, and is not counted. The shared components that show
it mark it (`data-copy="content"`) so the gate can tell.

### 5.4 Copy style

- **Title Case for chrome**: page and card titles, tabs, navigation, buttons, field labels, column
  headers, KPI titles, modal titles. Small words (a, an, and, as, at, but, by, for, from, in, into,
  nor, of, on, or, per, the, to, vs, via, with) may stay lower case unless they open the phrase.
  Sentences (help text, toasts, errors) use sentence case.
- **Buttons are Verb Noun**: Create Rule, Clear Alert, Clock In, Export. Never Submit, OK, Yes,
  No or Click Here. The primary button repeats the form's purpose (New Rule opens a form whose
  button is Create Rule).
- **No em dashes or double dashes** in anything a person reads (gate 17). The only dash on a screen
  is the empty-value marker the shared table and detail components draw for a value that is not
  set; it is never typed into copy.
- **Plain words.** Home, not Command Centre (MILESTONES §18.1). A number and a pill say more than a
  sentence about the number.

### 5.5 Icons and illustrations

- **One icon set: Lucide** (`lucide-react`, the shadcn/ui default and the same line style as the
  demo). Stroke icons on a 24 px grid, shown at 16, 20 or 24 px, in `currentColor`. No second icon
  library, no emoji as icons, no icon fonts.
- **Icon with a word** on the mobile bottom bar, on primary actions and on KPI cards. **Icon alone**
  only for well known actions (close, search, more, back, filter); an icon-only button always has
  an `aria-label` and, on desktop, a tooltip with the same words.
- **Illustrations** come from one small set in the brand tokens (`app/src/assets/illustrations/`,
  §9.4): empty states, first run, success, an error the person can recover from, and the clock-in
  and clock-out prompts. They replace explanatory text, never add to it. A data screen with data on
  it carries no illustration.
- **Prefer a picture to a paragraph.** A status pill, a progress ring, an icon card or a chart says
  it faster than a sentence. On a phone, prefer icon cards that open a sheet to stacked sections
  (module demos 12/10, 00:08).

---

## 6 · Formats

| What | Rule |
|---|---|
| Dates | Day-first wherever a person reads one: `13/10/2026`. Never `<input type="date">`; never `toLocaleDateString()` without a locale (gate 15) |
| Money | `₦1,250,000.00`, right-aligned, tabular figures; `₦1.3M` only on KPI tiles. Negative: minus sign, colour **and** label, never colour alone |
| Colour | Only the brand tokens (MILESTONES §5.1, §5.2). No raw hex (gate 13). AA contrast in both themes (gate 14) |
| Empty value | The shared marker, muted, from the table and detail components (§5.4). Never "N/A", never "null", never a typed dash |

---

## 7 · Two shells: desktop and mobile (gate 11)

Mobile is a native-feeling app, not the desktop squeezed. Desktop is desktop software. A route
that ships one layout scaled fails the gate. The test agreed on 8 October (00:23:26): **on a phone,
does it look like a mobile application, with less text?** On desktop, is it full desktop software?

**The phone shell (up to 760 px wide):**

- **Bottom bar navigation**: at most five icons with one short word each, thumb reachable. Never
  the desktop sidebar; the full module list opens from the avatar or the menu as a sheet.
- **Cards, not tables.** A list is a card list (the primary value as the title, two or three
  label and value pairs, a status pill). The shared data view (§9.4) draws the table on desktop
  and the card list on a phone from the same rows. No visible `<table>` on a phone.
- **Sheets, not centred modals.** The shared modal becomes a bottom sheet; a long form becomes a
  full screen sheet.
- **The main action within thumb reach**: at the bottom of the screen or the sheet, full width.
- **Tap targets at least 44 × 44 px.** Inline help terms inside a sentence or heading are the only
  exception.
- **No sideways scrolling of the page**, ever. A wide chart scrolls inside its own card.
- **Less text**: no page subtitles, no chart captions, KPI cards two to a row, icons with one
  word. The first phone screen carries at most **40 words of interface copy** (§5.3); data is not
  counted.
- **No hover.** Anything that appears on hover on desktop appears on tap on a phone.
- **What is left off a phone is decided per screen** in the feature guide's §10 (an extra KPI
  card, a secondary column, a chart), never ad hoc.

**The desktop shell:** the sidebar, dense tables with the shared pager, keyboard navigation, side
panels and multi-pane layouts where they help, hover help (§5.2). The mobile bottom bar never
shows.

**How it is checked.** `scripts/check/two-shells.js` opens every screen at phone size (390 × 844)
and desktop size (1440 × 900) in Chromium and fails on: sideways page scrolling, the desktop
sidebar on a phone, the bottom bar on desktop, a visible table on a phone, a tap target under
44 px, more than 40 words of interface copy on the first phone screen, and any script error. The
feature guide's §10 carries a per-screen phone table, and the pull request body states the steps
taken for the native app feel (the PR template asks). No screenshots are required.

---

## 8 · Forms (gate 12) and behaviour

One form system for the whole product. Nobody builds their own: the build refuses a raw form
element outside the form components (§8.6).

### 8.1 Where a form opens

| The job | It opens in |
|---|---|
| Create or edit with up to 6 fields | The shared modal (a bottom sheet on a phone) |
| More than 6 fields, or more than one topic | A wizard: one topic per step, a step indicator, Back and Next, the last step's button names the result (Publish Vacancy) |
| Edit a record you are looking at, on desktop | A side panel over the record |
| Anything on a phone | A sheet; a wizard or a long form is a full screen sheet |
| A setting that applies at once | No form: a switch that saves on change, with a toast |

### 8.2 Fields

- **One column.** The label sits above the field, in Title Case, at most 4 words. Fields are as
  wide as what they hold (a date field is not full width on desktop).
- **Optional fields carry an "Optional" tag** after the label. No asterisks; a field with no tag
  is required. Ask for fewer optional fields.
- **No hint sentence under a field.** The field shows its own format: the date field shows
  `DD/MM/YYYY`, the money field shows ₦, the phone field shows its country code. If a field truly
  needs explaining, its label is a help term (§5.2).
- **Placeholders** are a format example of at most 3 words, never an instruction and never the
  label.
- **Choices**: up to 5 options as a segmented control or radio cards; more than 5 as a searchable
  select; yes or no as a checkbox inside a form, or a switch for a setting that applies at once.
- **Typed fields, never plain text**: dates through the date field (day-first, gate 15), money
  through the money field (`shared/money`, gate 20), files through the upload engine (gate 18),
  people and records through the server-searching picker (§4).
- **Long text** is a text area; where the feature guide says so it carries the shared voice input,
  whose transcript an AI tidies without changing its meaning (10 October, recruitment and reviews).

### 8.3 Validation (gate 12)

- **The rules come from the contract.** `useContractForm(schema)` validates with the same Zod
  schema the API uses (§3); the frontend writes no rules of its own.
- **Reward early, punish late.** A field is checked when the person leaves it, or after they pause
  typing for about 600 ms. Once a field is marked, it is re-checked on every keystroke, so the mark
  clears the moment it is fixed. A field with a format shows a tick when it is right.
- **The signal is on the field**: a red ring and a ! mark, with an error of at most 4 words beside
  it ("Not a real date"). Never a sentence under the form, never a dialog, never a toast.
- **Submit is never disabled.** Pressing it checks everything, marks every problem and moves focus
  to the first one. A wizard step does not advance until its fields are right.
- **Server errors land on fields.** An `AppError` with `fields` marks those fields the same way; a
  general error is one line above the footer.

### 8.4 Footers and buttons

- **A footer carries buttons only.** Desktop: Cancel on the left, the primary on the right. Phone:
  the primary is full width at the bottom, the others above it.
- **The primary is Verb Noun** (§5.4) and is the only filled button in the footer.
- **Destructive actions** are red and confirm in the shared modal, naming the thing ("Delete
  Rule"), never `confirm()`.
- Enter submits a single-line form. Esc closes a form with no changes; with changes it asks once
  whether to discard.

### 8.5 After saving

The form closes, the list or record updates in place, and a toast of at most 8 words confirms it
("Rule created"). Where the action can be undone, the toast carries Undo. Long forms and wizards
keep a draft so a person who leaves can come back.

### 8.6 One way to build a form

`app/src/components/form/` (and `public-app/src/components/form/`) is the **only** place a raw
`<form>`, `<input>`, `<select>`, `<textarea>` or `<label>` may appear, and the only place that
imports `react-hook-form`. Features compose its parts: `Form`, `Field`, `TextField`, `DateField`,
`MoneyField`, `PhoneField`, `SelectField`, `ChoiceField`, `CheckboxField`, `SwitchField`,
`TextAreaField`, `UploadField`, `PersonPicker`, `FormFooter`, `Wizard`, and the hook
`useContractForm(schema)`. `scripts/check/forms.js` fails the build when a feature writes a raw
element, imports `react-hook-form` directly, uses an instruction as a placeholder, or labels a
button Submit or OK.

Need a field the set does not have? Add it to `components/form/` in its own PR, reviewed by the
frontend foundation owner (AJ), and list it in §9.4. Never build it inside a feature.

### 8.7 Behaviour

- **No native dialogs** (`alert`, `confirm`, `prompt`; gate 16). Use the shared modal or sheet.
- **One modal component** (and one sheet for mobile), used everywhere. A "new" or "edit" action
  opens it.
- **Uploads** through the upload engine with a percentage; never a raw `<input type="file">`
  (gate 18).
- **Permissions**: the shell shows only the modules and actions the user's grants allow. Hiding is
  a courtesy; the API enforces. Never assume a hidden button means a forbidden action is safe.
- **Home is role-sensitive.** Each role sees its own KPIs and main chart; "Needs you" is the same
  for everyone. Tiles come from the API's KPI catalogue, never a hard-coded list per role.
- **Nothing is hard-coded data.** Every number, name and list on a screen comes from the API. The
  staging database is seeded with demonstration data; production starts empty. The same build must
  look right on both.
- **AI deep links.** The assistant answers with links to screens ("Create Task"). Every screen
  that a write can be routed to accepts its prefill from the URL.

---

## 9 · Foundation (to be completed by AJ, frontend foundation owner)

Fill each section as it lands, so the next person builds on it instead of beside it.

### 9.1 Folder structure
_To be written._ Once features have folders, each feature guide's **Frontend paths** row names
them, so `scripts/check/guides.js` holds frontend changes to their guide too. New files under
`app/` and `public-app/` are mapped here rather than in the README. Two folders are fixed already
because gates read them: `app/src/components/form/` (the only home of raw form elements, §8.6) and
`app/src/components/ui/` (the shared components below).

### 9.2 Routing, shell and permission filtering
_To be written._ Tab slugs are the URL values in `docs/PROGRESS.md` and do not change when a label
does. The one URL shape the backend produces for a screen or a record (notification bell, task
panel, Home alerts, search, AI links) is `/<module>?tab=<tab>&id=<id>`, module key with `_` as `-`
(`src/shared/route-map.js`); the router must honour it, and `id` opens that record. The route list
is what `scripts/check/two-shells.js` walks, so it must be exportable.

### 9.3 Design tokens and theming (light, dark)
_To be written._

### 9.4 Shared components
_To be written._ At least: app shell (desktop sidebar, mobile bottom bar), page header (title and
desktop-only subtitle), card, KPI card, data view (table on desktop, card list on a phone, with the
pager), modal, sheet, `HelpTerm` and `Details` (§5.2), the form components (§8.6), date field
(day-first), money display, upload, empty state with illustration, empty-value marker, toast. Each
component that shows content a person wrote (messages, mail, articles, document previews) marks it
`data-copy="content"` (§5.3).

### 9.5 Data fetching, caching and the API client
_To be written._

### 9.6 Realtime (Socket.io) and notifications
_To be written._

### 9.7 PWA (staff app only)
_To be written._

---

## 10 · Branches, pull requests and CI

The same as the backend: nobody pushes to `main`; branch, push, pull request, CI green, a code
owner's approval, merge. How to open a branch, keep it up to date, and what makes CI fail are in
`BACKEND_GUIDE.md` §8.

The gates that hold the frontend to this guide run in `npm run ci`, on the app and on `demo.html`:

| Gate | Script | Refuses |
|---|---|---|
| 8 Five-second rule | `scripts/check/five-second.js` | A word limit broken (§5.3), an explainer title, chrome not in Title Case, help visible on load, a subtitle or chart caption on a phone, text in a modal footer |
| 11 Two shells | `scripts/check/two-shells.js` | Sideways scrolling, the wrong navigation for the width, a table on a phone, a tap target under 44 px, a wordy first phone screen, a script error (§7) |
| 12 Inline validation and the form system | `scripts/check/forms.js` | A raw form element or `react-hook-form` outside `components/form/`, a hand-made label, an asterisk, an instruction as a placeholder, a long field error, a Submit or OK button (§8) |
| 17 No dashes | `scripts/check/dashes.js` | An em dash, an en dash or a double hyphen in copy a person reads (§5.4) |

The screen gates need Chromium. CI installs it; locally, `npx playwright install chromium` once.

## 11 · Done means

- [ ] Built against the real API through the contract; no mock data left in components
- [ ] Every list uses the shared pager, sends `page` only, shows the true total
- [ ] The feature guide's §10 lists what is open (tier 1), what is collapsed (tier 2) and the phone
  layout of every screen you touched, and the screen matches it
- [ ] No tier 3 text on the screen; word limits met; Title Case; no dashes (gates 8, 17)
- [ ] Help only through `HelpTerm` and `Details`, closed by default
- [ ] Icons from Lucide; empty states carry the shared illustration
- [ ] Desktop and mobile shells both built; the PR body states the native app feel measures (gate 11)
- [ ] Forms only from `components/form/`, validated as filled from the contract schema (gate 12)
- [ ] Day-first dates, formatted money, brand tokens only
- [ ] No native dialogs; upload engine
- [ ] `npm run ci` green, the whole suite, before pushing
- [ ] Pushed as a branch, PR opened with the template filled in; CI green on the PR
- [ ] `docs/PROGRESS.md` row ticked (UI, Mobile) and a note left
- [ ] The feature guide in `docs/guides/` matches what was built

Engineered by JBS Praxis.
