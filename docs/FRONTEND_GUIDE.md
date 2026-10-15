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

The staff app lives in `app/` (React 18, Vite 7, TypeScript, Tailwind 4, `vite-plugin-pwa`). It is
not a workspace of the root package; run its scripts from `app/` (`npm ci`, `npm run dev`,
`npm run build`, `npm run build:demo`, `npm run typecheck`, `npm run lint`).

Two folders are fixed because gates read them: `app/src/components/form/` is the only home of raw
form elements (`<form>`, `<input>`, `<select>`, `<textarea>`, `<label>`; §8.6, gate 12), and
`app/src/components/ui/` holds the shared components (§9.4). The same holds in `public-app/`. Once
features have folders, each feature guide's **Frontend paths** row names them, so
`scripts/check/guides.js` holds frontend changes to their guide too.

```
app/
  index.html                  theme set before first paint (localStorage mc-theme)
  vite.config.ts              page size from the contract, API mode, PWA manifest, /api proxy
  eslint.config.js            the app's own lint (bans zod, alert/confirm/prompt, type="date", raw file inputs)
  public/                     favicon, PWA icons
  scripts/contract-status.mjs which modules still run on INTERIM types, and which are ready for the contract
  src/
    main.tsx  App.tsx         entry; providers (auth, router, modal, toasts)
    styles/index.css          the only place colours exist: tokens, light and dark, keyframes, utilities
    lib/                      cn, format (dates, money, counts), media (useIsMobile), theme, router, routes (screen URLs)
    api/
      client.ts               fetch, bearer token in memory, one refresh retry, ApiError
      endpoints.ts  hooks.ts  typed endpoint map; useApi, usePaged, useInfinite, useMutation, invalidate
      types/<module>.ts       INTERIM wire shapes, one file per module, until contract.gen.ts lands
      mock/                   the in-browser mock API (mode mock only): core, data/, modules/<module>.ts
    auth/                     AuthProvider (useAuth, useMe), Login
    shell/                    catalogue (modules and tab slugs), access, screens (lazy per module),
                              Shell (desktop rail and mobile bar), Nav, CommandPalette, Bell, UpdatePrompt
    components/form/          the form system: useContractForm, every field, FormFooter, Wizard (§8.6, §9.4)
    components/ui/            shared components (§9.4)
    features/<module>/        one folder per module: home, workspace, ess, community, mailbox, people,
                              performance, queries, recruitment, payroll, partnerships, expenses,
                              knowledge, assistant (Praxis AI), settings; plus attendance and organogram,
                              shared by People, ESS and Settings, and shared/ (sections, KPI tiles, letters)
```

A module's screens are `features/<module>/index.tsx`, whose default export renders the tab it is
given (`<Module tab="employees" id="…" />`). Its guide's **Frontend paths** row names the folder.

The public site lives in `public-app/` (`go.mycityapp.io`, A9): the same stack without the PWA, and
the same scripts, run from `public-app/`. It imports nothing from `app/`; what both need (tokens,
`cn`, `format`, `theme`, the icon set, the button and field look) is copied, so a change to a
token or a shared control is made in both.

```
public-app/
  index.html                  theme before first paint (localStorage mc-public-theme)
  vite.config.ts              page size from the contract, API mode, /api/public proxy; no PWA, no service worker
  eslint.config.js            the same gates as app/ (bans zod, native dialogs, type="date", raw file inputs)
  src/
    main.tsx  App.tsx         entry; the six routes and a not-found page
    styles/index.css          the staff app's tokens, light and dark
    lib/                      cn, format, theme (a toggle; the device setting until a visitor picks), router
    api/
      client.ts               fetch to /api/public/v1 only; no session, no cookie, no auth header
      hooks.ts  endpoints.ts  useApi, usePaged; the typed endpoint map
      types/public.ts         INTERIM shapes for every public route (TB for M4 pages, LA for M5)
      mock/                   the in-browser mock (mode mock only); demo-links.ts lists sample addresses
    components/               Layout (Page, Brand, Message, demo strip), ui (Button, Pill, Notice,
                              Loading), form/ (Form, Field, Input, Textarea, Upload: the only file
                              input), SignaturePad (canvas, paper-coloured in both themes), Icon
    pages/                    Careers, Vacancy, Apply, Assessment, SignOffer, Verify, LinkProblem
```

Addresses are `/jobs`, `/jobs/<slug>`, `/apply/<token>`, `/assess/<token>`, `/sign/<token>` and
`/verify/<number>` (MILESTONES §6). Only the careers list and an open vacancy may be indexed; every
other page sets `noindex`. In mock mode a "Demo links" strip at the foot of each page opens every
state (a used or expired link, a paused or filled role, each verify outcome); the mock keeps its
state in memory, so a reload starts it again.

**Moving a module from INTERIM to the contract.** `npm run contract:status` (from `app/`) lists every
INTERIM file in both apps against `packages/contract/contract.gen.ts`: how many of the endpoints the
screens call are in the contract, and whether the module is Interim, Partly or Ready to switch. With
`-- --all` it lists each endpoint, including ones the contract has that no screen calls (often a
rename). When a module is Ready to switch: point its imports at `contract.gen.ts`, delete its INTERIM
file, run `npm run typecheck` and fix every screen it flags, move its forms to the contract's runtime
schemas, then run it on the live API and tick its rows in `docs/PROGRESS.md`.

### 9.2 Routing, shell and permission filtering

No router library (React Router 7+ needs React 19). `lib/router.tsx` owns one URL shape,
`/<module>?tab=<tab>&id=<id>`, module key with `_` as `-`, exactly as `src/shared/route-map.js`
builds it. `hrefFor`, `useRouter`, `useSearchParams` and `Link` are all there is. `id` opens a
record (a 360, a query, an expense) in place.

Tab slugs are the URL values in `docs/PROGRESS.md` and do not change when a label does.

**The route list the screen gates read.** `shell/catalogue.ts` exports `MODULES` (each module's key,
label and tab slugs) and `lib/routes.ts` builds each screen's URL. At build time `vite.config.ts`
writes them into the build as `dist/screens.json` (every module and tab, its labels and its path).
`scripts/check/lib/screens.js` builds the demo version of the app when its build is missing or
older than `app/src` (it needs `npm ci` in `app/` once; CI does that), serves it, signs in with the
mock Operations account and opens every screen at phone and desktop size for gates 8 and 11. It
reads the copy from the shared components' `data-ui` slots (§9.4) and skips anything marked
`data-copy="content"` or `data-ui-ignore` (the prototype view switch, which never ships to
production). `MYCITY_SCREEN_TARGETS=app node scripts/check/two-shells.js` crawls the app alone, for
a quicker loop while fixing a screen.

`shell/catalogue.ts` lists the fifteen modules and their tab slugs in the order of MILESTONES §18
and `src/shared/route-map.js`; `shell/access.ts` filters modules by the `view` grant and tabs by
role. Hiding is a courtesy: the API refuses what a grant does not allow. An unknown module or tab
lands on the first allowed screen.

Two shells (gate 11), chosen by `useIsMobile()` (760 px and below): the desktop rail (collapsible
to 66 px, remembered in `mc-rail`) with a top bar and tab strip, and the mobile shell with a bottom
bar (Home, Work, Chat, People, Praxis AI) and a drawer for the rest. A screen may also render a
different layout per shell; it never shrinks the desktop one. Chat and Mailbox are "fit" pages
(`useFitPage`): only their panes scroll, and scrolling past a pane's end slides the page header away.

**Staging is marked, in both apps** (MILESTONES §6, A4). The same build runs on staging and
production, so `lib/environment.ts` decides at runtime: a `staging.` host name (also set before first
paint in `index.html`) or `X-Mycity-Environment: staging` on any API response sets `data-env="staging"`
on `<html>`. `StagingBar` then shows a fixed, non-dismissible amber bar, and `--env-bar` (its height)
moves everything else down: `#root`, and every full-screen layer (sign-in, modal, command palette,
the phone menu, the chat and mail readers) starts at `top-(--env-bar)`. A new full-screen layer must
do the same. On the public site the bar is sticky. Staging also swaps the tab icon for
`public/favicon-staging.svg` and sets `theme-color` to the `--warning` amber. `?env=staging` shows
all of it in development.

**What opens, by the delivery plan, in both apps** (`lib/plan.ts`). At build time `vite.config.ts`
reads each screen's milestone and its API, UI and Mobile ticks from `docs/PROGRESS.md`, and each
milestone's name and demo date from the table in MILESTONES §4, into `__DELIVERY_PLAN__`.

- **Production:** a screen opens only when its PROGRESS row has all three ticks; until then it
  shows Coming Soon (`shell/Planned.tsx`, `components/Planned.tsx` on the public site). Staff see
  the milestone and date; a stranger on the public site sees neither.
- **Everywhere else** (development, the demo build, staging): the demo's "Prototype View" switch
  above every screen: "Full Design" (the default) opens everything; "As Delivered at Mn" shows
  Coming Soon for every screen planned after Mn. Mn is the current milestone, the earliest one not
  yet done, where done means its demo day has passed or all its screens are ticked; it is worked
  out from today's date, so it moves on by itself. The choice is kept per browser.
- What each screen will do, on its card, is in `shell/coming-soon.ts` (and in `components/Planned.tsx`
  for the public pages): add a line there when a tab is added. Re-planning a screen is a change to
  the M column in PROGRESS, nothing in code. A build fails if the plan cannot be read.

### 9.3 Design tokens and theming (light, dark)

`styles/index.css` holds every colour as a token under shadcn role names, with the demo's values:
`background`, `card`, `muted`, `foreground`, `muted-foreground`, `subtle-foreground`, `border`,
`input`, `primary` (brand yellow), `secondary` (city green), `accent`, `ring`, `sidebar*`,
`success`, `warning`, `destructive`, `info` (each with a `-soft` tint), `chart-1` to `chart-4`, and
`paper-*` for documents. Dark mode is `[data-theme=dark]`, or the device setting when no choice is
stored. No raw hex anywhere else (gate 13). Typeface Geist (`@fontsource-variable/geist`).

### 9.4 Shared components

Tailwind only, no component library. Fields live in `components/form/` (§8.6), imported from
`@/components/form`; everything else in `components/ui/`.

| `components/form/` | Gives |
|---|---|
| `useContractForm.ts` | `useContractForm(initial, schema)` on `react-hook-form`: checked when a field is left or after a 600 ms pause, then on every keystroke; `check(keys?)` marks every problem, focuses the first and returns whether it is clean; `setServerErrors` puts a 422's `fields` on the same marks. Pass the module's contract schema (anything with `safeParse`); until its schemas land, pass INTERIM rules (one function per field, an error of at most 4 words) |
| `Form.tsx` | `Form`: the one `<form>`; Enter submits, browser bubbles off |
| `fields.tsx` | `Field` (label above, `Optional` tag from `optional` or a label ending "(Optional)", `info` makes the label a help term), `TextField`, `TextAreaField`, `SelectField`, `ChoiceField` (up to five options), `SwitchField` (a setting that saves at once), `CheckboxField` (yes or no in a form), `PhoneField` (+234), `SegBar`, `ToggleRow`, `rules` |
| `DateField.tsx` | day-first date entry with a picker; never `type="date"` |
| `MoneyField.tsx` | `MoneyField` (₦, kept as typed), `toMoneyString` (the wire string) |
| `Upload.tsx` | `UploadField`: the only file input, progress per file; `trigger` for a composer button |
| `PersonPicker.tsx` | search and pick one or more people |
| `Search.tsx` | `SearchBox` (sent as `q`), `FilterSelect` |
| `Footer.tsx` | `FormFooter`: buttons only; Cancel left and the primary right on desktop, the primary full width at the bottom on a phone. Put the primary last |
| `Wizard.tsx` | `Wizard`: a form of more than six fields or more than one topic; one topic per step, a step indicator, Back and Next, the last step's button names the result. A step does not advance until its `check` passes |
| `LoginField.tsx` | the sign-in screen's larger field |
| `Inline.tsx` | `InlineInput`, `InlineSelect`, `InlineLabel`: unstyled controls for a field built into a larger widget (chat message box, command palette, mail composer rows, a number cell in a settings list). No validation; each needs a label or an `aria-label`. A field in a form uses `fields.tsx` |

**Submit is never disabled** (§8.3). `Button`'s `busy` ignores clicks while a request is in
flight but keeps the button enabled and reachable; a form shows what is wrong on its fields when
Submit is pressed, never by disabling it. A choice that is not a field (pick at least one row) says
so in one line above the footer.

| `components/ui/` | Gives |
|---|---|
| `Button.tsx` | `Button` (`busy` while saving), `IconButton`, `BigButton` |
| `layout.tsx` | `Card`, `CardHeader` (`help` makes the title a help term; `record` marks a title that is a record's own name as content), `PageHead` (`help`; the subtitle is desktop only), `Grid`, `MobileOnly`, `DesktopOnly` |
| `Help.tsx` | `HelpTerm` (§5.2: the dotted word; hover or Tab on desktop, a bottom sheet on a phone; text hidden in the DOM for `aria-describedby`), `HelpIcon` (only where there is no word), `Details` (one closed row at a card's foot) |
| `data.tsx` | `Pill`, `Avatar`, `Who`, `Kpi`, `KV`, `StatStrip` (four at most on a phone), `Timeline`, `Bars`, `Mini`, `Chain`, `Accordion`, `Banner`, `EmptyState`, `EmptyValue` (the empty-value marker), `TapList` and others |
| `Table.tsx` | `Table`: the data view, a table on desktop and a card list on a phone from the same rows and columns (§7: never a visible table on a phone); `Pager`, `Toolbar`, `Chips`, `LoadingRows`, `ErrorBlock`. A cell with no value shows the empty-value marker |
| `Modal.tsx` | the one modal (`useModal`); a bottom sheet on a phone, full screen with `full` |
| `Money.tsx` | `Money` (₦ with kobo, from the string) |
| `Menu.tsx`, `Toast.tsx`, `Board.tsx` (drag between columns), `Calendar.tsx`, `charts.tsx` (`AreaChart`, `Donut`, `Bands`), `Paper.tsx` (documents), `Profile.tsx` (360 header), `Reader.tsx` (articles) | |

`features/shared/sections.tsx` adds the screen-level blocks: `PagedTable` (server page, search,
pager), `KvCard`, `ChainCard`, `BarsCard`, `TrailCard`, `StatusPill`, `ExportButton`.

**What the screen gates read** (gates 8 and 11, §9.2). The shared components carry the copy slots
as `data-ui` attributes: `page-title`, `page-subtitle`, `title` (card, section, modal and KPI
titles), `kpi-caption`, `button` (buttons, tabs, filter chips), `chart-caption`, `empty-text`,
`help`, `details`, `modal-footer`, `nav-label`; the shell marks `page`, `scroller`, `desktop-nav`,
`phone-nav` and `modal`, and a help term is `help-term`. Anything a person wrote or received is
marked `data-copy="content"` and is not counted: messages and chat lists, mail rows, announcements,
articles and documents, timelines, chains, bars, pills, people and record names (`CardHeader
record`), the org chart and the phone card list. A heading written by hand in a feature carries
`data-ui="title"` or `data-copy="content"`, so the gate sees it. On a phone, every button, chip,
tab, input and switch is at least 44 × 44 px.

**Still to build** (§5.5): the one icon set (Lucide, `lucide-react`; the app still draws the demo's
icon sprite) and the illustration set in `app/src/assets/illustrations/` for empty states, first
run and success. The screen gates crawl as the Operations account; a screen only Staff or the CEO
see is held to the same rules by review until the crawl signs in as them too.

### 9.5 Data fetching, caching and the API client

`api/client.ts` sends `Authorization: Bearer <access token>` (held in memory only) and
`credentials: "include"` for the refresh cookie; on a 401 it calls `/api/v1/auth/refresh` once and
retries. Errors arrive as `ApiError` with `code`, `message` and `fields`. Writes that must not
repeat pass `idempotencyKey` (sent as `Idempotency-Key`).

Every call is typed by its key, `api.call("GET /api/v1/employees/:id", { params, query, body })`,
from the `Endpoints` map that each `api/types/<module>.ts` extends. These files are INTERIM: when a
module's schemas land, its file is replaced by the generated `packages/contract/contract.gen.ts`
types and TypeScript shows every screen that disagrees.

`api/hooks.ts`: `useApi` (one read), `usePaged` (server pages: `page`, `q` debounced 250 ms,
filters; changing either goes to page 1), `useInfinite` (phones), `useMutation` (with `fields`
after a 422) and `invalidate(prefix)`, which reloads every mounted read under that path. There is
no client cache beyond the mounted reads; the page size is the contract's (`__CONTRACT_PAGE_SIZE__`,
read from `packages/contract/schemas/common.js` at build), never a constant in the app.

API mode is set in `vite.config.ts`: `mock` for `npm run dev` and `npm run build:demo`, `live` for a
production build (override with `VITE_API_MODE=live npm run dev`, which proxies `/api` to
`localhost:3000`). The mock (`api/mock/`) answers with the backend's exact envelopes, applies
search and filters itself, rejects unknown query keys with a 422, and is never in a live bundle.

### 9.6 Realtime (Socket.io) and notifications

Not built yet. The bell (`shell/Bell.tsx`) reads `GET /api/v1/notifications` and badge counts from
`GET /api/v1/notifications/badges` (INTERIM), refreshed on open. Socket.io push replaces the
polling when the notification engine lands in M6.

### 9.7 PWA (staff app only)

`vite-plugin-pwa` in `generateSW` mode with `registerType: "prompt"`: a new version shows the
update prompt (`shell/UpdatePrompt.tsx`) rather than reloading under someone. The shell and assets
are precached; `/api/` is `NetworkOnly`, so every number on screen is live and nothing personal is
cached. The manifest is in `vite.config.ts` (standalone, brand colours, 192, 512 and maskable icons).

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
