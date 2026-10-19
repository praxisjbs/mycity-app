# MyCity App ERP · Frontend Guide

**Read this before writing any frontend code, whether you are a person or an AI.** It covers both
React apps: the staff app (`app/`, `hub.mycityapp.io`) and the public site (`public-app/`,
`go.mycityapp.io`).

Status: **the rules here are settled. The foundation (§9) is one design system for both apps,
`packages/ui` (`@mycity/ui`), owned by AJ (Adole Jerome), backup TB.** It is built in three PRs
planned in `docs/FRONTEND_FOUNDATION.md`, whose decisions F1 to F26 are binding: where this guide
and that file differ, that file wins and this one is fixed. Started 13 October 2026 from
MILESTONES §1.1, §3 and §17 and the 12 October internal meeting; §5, §7 and §8 rewritten 14 October
2026 into the screen content, two shells and form conventions; §1 to §3, §6, §9, §10 and §11
rewritten 15 October 2026 for `packages/ui` (PR 1, Ground), and §5, §7 and §8 brought into line;
§1, §7, §9 and §10 brought up to the built shells the same day (PR 2, Shell); §8.8 and gate 21
(nothing the browser styles itself, F25) added 18 October 2026, and one press, one request (F26:
§8.4, §9.4, the `no-void-press` lint) the same day.
If something here is wrong or missing, fix the guide in the same PR as the code.

**Feature guides are full-stack guides.** A guide in `docs/guides/` covers the backend modules,
schemas, API, events, permissions and screens of one feature. Its §10 is what reaches a screen, but
§4 to §9 decide what the screen calls and who may see it. Read the whole guide before a screen.

**Why this product looks the way it does.** At the first internal meeting (8 October, 00:20:59 to
00:27:55) we agreed corporate aesthetics, extreme simplicity, minimal text and illustrative icons:
"anywhere we need to even have any explanations or any longer text … hide it", "on mobile … does it
look like a mobile application … less text", and that these must be gates in CI, not wishes in a
document. On 10 October (01:36 to 01:38) the client approved exactly that interface: "very less text
… more of icons … nothing tough or complicated". A screen that reads like a manual breaks a promise
the client has already accepted.

---

## 1 · Before you write anything

Guides lead, gates confirm (F9). Every builder, person or AI, starts here, so the gates in §10
confirm work that was built right instead of rejecting it at the end.

1. **Read `docs/FRONTEND_FOUNDATION.md`**: the decisions F1 to F26 and where each foundation PR
   stands. Then **read `docs/COMPONENTS.md`**, the catalogue of every shared component: what it is
   for, when not to use it, its props and how it behaves on a phone. It is generated from the code
   (`npm run gen:components`), so it is never out of date.
2. **Open the gallery**: `npm run gallery`. Every component in every state, light and dark, phone
   and desktop, Compact and Comfortable. Find the piece you need there before you write anything.
3. **Find the screen** in `docs/PROGRESS.md` and read its feature guide in `docs/guides/`, all of
   it (guides are full-stack), and especially **§10 On screen and mobile**: what the screen shows
   open, what sits behind help, and its phone layout. If §10 does not say, add it to the guide
   before you build.
4. **Look at it in `docs/MyCity-ERP-Documents/demo.html`** for layout and look only. The demo is
   frozen (F23). It is **never** a source of data, field names, rules or numbers; it contradicts
   the documents in places and that is accepted. The contract, the guides and the catalogue win.
5. **If a component you need is missing, add it to `packages/ui`, never to a feature:**
   `npm run new:component -- --name StatusPill --group Display`. That writes the component with
   its header, a test and a gallery page, exports it from `@mycity/ui` and regenerates the
   catalogue. Fill the header, build it, test it (`npm -w @mycity/ui test`), see it in the gallery.
   It ships in the feature PR that needs it, approved by AJ (backup TB) through CODEOWNERS (F11).
   A second table, modal, pager, field or date picker is a defect, and `check/components.js`
   refuses a new file in `app/src/components/` or `public-app/src/components/` and a feature that
   declares a component with a shared name.
6. **A new screen (a tab) is added with `npm run new:screen`**, never by hand:
   `npm run new:screen -- --module people --tab "Work Patterns" --m M1 --owner LA`. It writes the
   tab into the shell's catalogue, the slug into `src/shared/route-map.js`, the screen file and its
   case in the module, its Coming Soon entry, and its PROGRESS row, note and counts, so the shell,
   the backend's links, the delivery plan and the screen gates agree from the next build. A new
   screen changes the approved inventory (MILESTONES §18): agree it first.

---

## 2 · Stack

**One design system for both apps** (F1): the workspace package `packages/ui`, imported as
`@mycity/ui`. Both apps import it; neither imports the other (A9: a different origin shares no
cookie, storage or service worker). No component, token or helper is copied between apps.

React 18.3 · Vite 7 · TypeScript, strict · Tailwind 4 on the shadcn/ui role tokens · Geist (one
family) · Radix underneath overlays, menus, popovers, tooltips, tabs, switches and checkboxes, with
our own styling (F7) · Vaul for bottom sheets (F6) · sonner for toasts · react-hook-form with the
contract's Zod schemas (F7) · Lucide icons · Vitest with Testing Library and axe · PWA on the staff
app only.

Radix, Vaul, sonner, `lucide-react` and `react-hook-form` are imported **only inside
`packages/ui`**. A feature imports `@mycity/ui`; ESLint refuses the rest. The three workspaces
(`packages/ui`, `app`, `public-app`) sit in the root npm workspaces with one root lockfile.

**From the HTML demo to React.** `demo.html` was translated into React components: one component
per real UI element, shared where the demo repeats itself. The HTML file stays in
`docs/MyCity-ERP-Documents/` as a frozen reference and is never served or imported.

---

## 3 · Talking to the API

- **Only through the generated contract** (F15). `scripts/gen/contract.js` (GE) writes
  `packages/contract/contract.gen.ts`: the types, an `Endpoints` map and the runtime `schemas`.
  The API client is typed against `Endpoints`:
  `api.call("GET /api/v1/employees", { query: { page: 2, q: "ada" } })`.
  A wrong path, a wrong field name or a wrong response shape is a TypeScript error. Never edit
  `contract.gen.ts`.
- **Interim types retire module by module.** Until a module's schemas exist, its screens run on
  INTERIM types (`app/src/api/types/<module>.ts`, `public-app/src/api/types/public.ts`).
  `npm run contract:status` (from `app/`) says which modules are Interim, Partly or Ready to
  switch; §9.5 says how to switch one.
- **One data client, shared by both apps**, in `@mycity/ui`: `ApiError`, `createApiClient`,
  `useApi`, `usePaged`, `useInfinite`, `useMutation` and `invalidate`. Each app makes its client
  from it (its base path, and the session for the staff app); no app writes its own fetch wrapper.
- **No local Zod.** Forms validate with the runtime `schemas` from `@mycity/contract`, the same
  ones the API uses. ESLint forbids importing `zod` or writing `z.object` in `app/` and
  `public-app/`; `packages/ui` may import Zod's types only, never Zod at runtime.
- **snake_case** field names, exactly as the API sends them. Do not map them to camelCase.
- Money arrives as a string (`"1250000.00"`); dates as ISO (`"2026-10-13"`). Format at render
  time only, with the helpers in `@mycity/ui` (§6).

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
- **Search, filters and sort go to the server** (`q`, the list's filter params, and one `sort`).
  Never filter or sort the 25 rows you have and present the result as the whole list: that is the
  praxis-ls bug where a search said "no results" for records on page 4.
- **Sort is one key** (F20): the field name, with a leading `-` for descending (`?sort=-due_on`).
  The list's contract schema allow-lists the fields, so a field it does not name is a 422. `DataView`
  sends it for you: a sortable column's header cycles ascending, descending, none, and changing it
  goes back to page 1.
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

Tier 2 has exactly two shapes, `HelpTerm` and `Details`, with `InfoButton` for the rare case
below. All three come from `@mycity/ui` (the Help group in `docs/COMPONENTS.md`). Nothing else
hides or reveals help. They replace the merged ⓘ toggle (`app/src/components/ui/Info.tsx`), which
leaves the app in PR 1.

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
- An ⓘ icon button (`InfoButton`) is used only where there is no word to attach to (a chart, an
  icon-only control), and it opens the same popover or sheet.
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

- **One icon set: Lucide**, drawn through `Icon` from `@mycity/ui` (`<Icon name="clock" />`).
  Stroke icons on a 24 px grid, shown at 16, 20 or 24 px (`size` s, m, l), in `currentColor`. Only
  `packages/ui` imports `lucide-react`; a feature names a glyph by its short name, and a glyph the
  set lacks is added to `Icon`. No second icon library, no emoji as icons, no icon fonts.
- **Icon with a word** on the mobile bottom bar, on primary actions and on KPI cards. **Icon alone**
  only for well known actions (close, search, more, back, filter), through `IconButton`, whose
  required `label` is its accessible name and, on desktop, its tooltip.
- **Illustrations** come from one small set in the brand tokens (`Illustration` from
  `@mycity/ui`, in `packages/ui/src/illustrations/`): empty states, first run, success, an error
  the person can recover from, and the clock-in and clock-out prompts. The empty state carries one
  by itself. They replace explanatory text, never add to it. A data screen with data on it carries
  no illustration.
- **Prefer a picture to a paragraph.** A status pill, a progress ring, an icon card or a chart says
  it faster than a sentence. On a phone, prefer icon cards that open a sheet to stacked sections
  (module demos 12/10, 00:08).

---

## 6 · Formats

Every format comes from the helpers in `@mycity/ui` (`formatDate`, `formatMoney`, `formatCount`
and the rest; the Helpers table in `docs/COMPONENTS.md`). Never write your own.

| What | Rule |
|---|---|
| Dates | Day-first wherever a person reads one: `13/10/2026`. Never `<input type="date">`; never `toLocaleDateString()` without a locale (gate 15) |
| Money | `₦1,250,000.00`, right-aligned, tabular figures; `₦1.3M` only on KPI tiles. Negative: minus sign, colour **and** label, never colour alone |
| Colour | Only the brand tokens (MILESTONES §5.1, §5.2, and the derived tokens, §9.3). No raw hex (gate 13). AA contrast in both themes (gate 14) |
| Styling | Tokens only (F4). A feature composes `@mycity/ui` components and may use Tailwind layout and spacing utilities from the token scale. No colour outside a token class, no arbitrary value (`w-[317px]`, `bg-[#…]`), no inline `style`, no raw hex. Anything visual beyond that is a shared component |
| Density | Compact by default on desktop: 14 px body, 40 px table rows, 36 px controls. A person may switch to Comfortable (15 px, 48 px rows, 40 px controls), remembered per person. A phone always uses 16 px in fields and 44 px targets. Components size themselves from the density tokens; a feature never sets a control or row height (F5) |
| Motion | Native and brief (F6). Bottom sheets slide with a spring and close by dragging down (a sheet holding a text field closes only from its close button, Cancel or Esc); toasts and popovers fade in 120 to 200 ms. Everything is instant under reduced motion. Motion comes with the components; a feature adds none |
| Empty value | The shared marker (`EmptyValue`), muted, also drawn by the table and detail components (§5.4). Never "N/A", never "null", never a typed dash |

---

## 7 · Two shells: desktop and mobile (gate 11)

Mobile is a native-feeling app, not the desktop squeezed. Desktop is desktop software. A route
that ships one layout scaled fails the gate. The test agreed on 8 October (00:23:26): **on a phone,
does it look like a mobile application, with less text?** On desktop, is it full desktop software?

**The phone shell (up to 760 px wide).** The top bar, the bottom bar, More and the floating button
are built (PR 2, the Shell group in `docs/COMPONENTS.md`), and so is the build kit the screens are
drawn with (PR 3: `DataView`, `Kanban`, the charts, the pickers, the editor, the previews, the maps).
Build every screen for them: the page keeps clear space under its content by itself, give the screen one New
action (`useScreenAction`, below), and never rely on dragging on a phone.

- **Top bar and title rail** (PR 2 question 3): the pin alone at the left, which goes Home; search,
  the bell and the person's avatar at the right (the avatar opens More). Under it the title rail:
  the module's name as one large line, shortened when long, over the module's tabs. Scrolling down
  slides the name away and keeps the tabs; scrolling up brings it back. A screen keeps its own
  `PageHeader` for its h1.

- **Bottom bar** (F16): **Home, Workspace, Community, Self-Service, More**, the same five for
  everyone, each an icon with one word, thumb reachable. Never the desktop sidebar.
- **More** (F17): a launcher grid in a bottom sheet, up to 90% of the height, closed by dragging
  down. At the top the person's row with Theme, Density and Settings; then a search bar that opens
  full search; then module tiles four to a row, grouped Work, People, Business and System, each an
  icon in a soft brand square, one word and a count badge, showing only the modules the person may
  open; Sign Out at the foot.
- **Floating button** (F18), phone only, bottom right above the bottom bar, never draggable. A tap
  fans out over a dimmed page: the screen's own New action when it has one, Clock In or Out, Praxis
  AI, Help (the Knowledge Hub's FAQs). It never hides data: every page carries bottom clearance
  equal to its footprint; it tucks away while the page scrolls down and returns on scrolling up; it
  hides while a sheet or the keyboard is open, and on a fit page (a chat, the mailbox); its fan has
  Hide Here, which keeps it hidden until the person leaves that page. Desktop has none. A screen
  offers its New action with `useScreenAction({ label: "New Task", onSelect })` from
  `app/src/shell/screen-action.tsx`; on desktop the same action stays in its page header.
- **Boards** (F19): `Kanban` from `@mycity/ui`. On a phone it is a stage switcher (chips with
  counts) over that stage's cards, and a card moves by Move To, never by dragging; Move To is a real
  menu on desktop too, so a keyboard and a screen reader can move a card.
- **Cards, not tables.** A list is a card list (the primary value as the title, two or three
  label and value pairs, a status pill). `DataView` (F20) draws the table on desktop and the card
  list on a phone from the same columns, with the pager, server sort, selection, bulk actions and
  Export; where a phone has no table header, sort moves into an action sheet. No visible `<table>`
  on a phone.
- **Sheets, not centred modals.** The shared `Modal` becomes a bottom sheet that slides with a
  spring and closes by dragging down (F6); a long form becomes a full screen sheet. `Menu` becomes
  an action sheet. A sheet stays above the keyboard; once it holds a text field, a drag or a scrim
  tap never closes it, so typing is never lost to a stray swipe.
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
panels and multi-pane layouts where they help, hover help (§5.2). The mobile bottom bar and the
floating button never show.

**How it is checked.** `scripts/check/two-shells.js` opens every target at phone size (390 × 844)
and desktop size (1440 × 900) in Chromium: the gallery, every app screen (the mock build, signed
in), and `demo.html` only when a change touches it (F23). It fails on: sideways page scrolling, the desktop
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
- **Choices**: up to 5 options as a segmented control or radio cards; more than 5 as `SelectField`
  (our branded list: a listbox under the button on desktop, a bottom sheet of 44 px rows on a phone,
  never the browser's or the phone's own picker, §8.8); yes or no as a checkbox inside a form, or a
  switch for a setting that applies at once.
- **Typed fields, never plain text**: dates through the date field (day-first, gate 15), money
  through the money field (`shared/money`, gate 20), files through the upload engine (gate 18),
  people and records through the server-searching picker (§4).
- **Long text** is a text area; where the feature guide says so it carries the shared voice input,
  whose transcript an AI tidies without changing its meaning (10 October, recruitment and reviews).

### 8.3 Validation (gate 12)

- **The rules come from the contract.** `useContractForm(initial, schema)` validates with the same
  Zod schema the API uses (§3); the frontend writes no rules of its own. Until a module's schema
  exists it takes INTERIM rules (one function per field, from `rules`), and swapping them for the
  schema changes nothing else in the form.
- **Reward early, punish late.** A field is checked when the person leaves it, or after they pause
  typing for about 600 ms. Once a field is marked, it is re-checked on every keystroke, so the mark
  clears the moment it is fixed. A field with a format shows a tick when it is right.
- **The signal is on the field**: a red ring and a ! mark, with an error of at most 4 words beside
  it ("Not a real date"). Never a sentence under the form, never a dialog, never a toast.
- **Submit is never disabled.** Pressing it checks everything, marks every problem and moves focus
  to the first one. A wizard step does not advance until its fields are right. While the save runs
  the button is busy, not disabled (§8.4).
- **Server errors land on fields.** An `AppError` with `fields` marks those fields the same way; a
  general error is one line above the footer.

### 8.4 Footers and buttons

- **A footer carries buttons only.** Desktop: Cancel on the left, the primary on the right. Phone:
  the primary is full width at the bottom, the others above it.
- **The primary is Verb Noun** (§5.4) and is the only filled button in the footer.
- **Destructive actions** are red and confirm in the shared modal, naming the thing ("Delete
  Rule"), never `confirm()`.
- **One press, one request** (F26). A button answers the moment it is pressed. Its handler hands
  back the work (`onClick={save}`, `onClick={() => save()}`, or an async handler), and the button is
  busy until that settles: its own colour and label, softened, a spinner where its icon was (centred
  over the label when it has none, so its size never changes), and a second press refused at once.
  The buttons beside it wait with it (a modal, a form, a form footer, a card or page header, a shell
  notice, or an `ActionGroup` around a row's Approve and Reject), and a modal cannot be dismissed
  mid-save. A `Form` whose `onSubmit` returns its save refuses Enter twice and spins the button that
  submitted it. Never `onClick={() => void save()}`: the button cannot see the work, and the lint
  refuses it (`mycity/no-void-press`). Never `disabled={busy}` either: busy stays focusable.
- Enter submits a single-line form. Esc closes a form with no changes; with changes it asks once
  whether to discard.

### 8.5 After saving

The form closes, the list or record updates in place, and a toast of at most 8 words confirms it
("Rule created"). Where the action can be undone, the toast carries Undo. Long forms and wizards
keep a draft so a person who leaves can come back.

### 8.6 One way to build a form

The form system lives in **`packages/ui/src/form/`**, for both apps. It is the **only** place a raw
`<form>`, `<input>`, `<select>`, `<textarea>` or `<label>` may appear, and the only place that
imports `react-hook-form`. Features import its parts from `@mycity/ui`: `Form`, `Field`,
`TextField`, `PasswordField`, `NumberField`, `DateField`, `DateRangeField`, `TimeField`,
`MoneyField`, `PhoneField`, `SelectField`, `ChoiceField`, `SelectMenu`, `CheckboxField`, `Switch`, `ToggleRow`,
`TextAreaField`, `SearchInput`, `FilterSelect`, `LoginField`, `OtpField`, `FormFooter`, `FormError`,
`Wizard`, `InlineInput`, `InlineSelect`, `InlineLabel`, and the hook `useContractForm(initial, rules)`. PR 3 added `UploadField` (the
only file input in the product), `PersonPicker` and `RecordPicker` (both searching the server, 25 at a
time), `SignatureField`, `RichTextField` (TipTap in its own chunk), `VoiceField` (A18) and `Tick` (a
list row's own checkbox). `docs/COMPONENTS.md` (Forms) has the props of each.

**One hook, one field binding.** `useContractForm(initial, rules)` is react-hook-form checked by the
module's contract schema (anything with `safeParse`) or, until it exists, by INTERIM rules (§8.3).
Every field takes the same binding (`{...f.field("name")}`: value, onChange, onBlur, name, state,
message), and `Field` takes the mark (`{...f.status("name")}`, or the same `f.field`). `f.check(keys?)`
marks every problem (or one wizard step's), focuses the first and returns whether it is clean;
`f.submit(save)` does the same for a `<Form>`; `f.setServerErrors(error.fields)` puts a 422 on the
fields. When `npm run contract:status` says a module is Ready to switch, its forms pass the schema
in place of the rules.

`scripts/check/forms.js` fails the build when a feature writes a raw element, imports
`react-hook-form` directly, uses an instruction as a placeholder, or labels a button Submit or OK.

Need a field the set does not have? `npm run new:component -- --name <Name>Field --group Forms`,
in `packages/ui`, approved by AJ (backup TB). Never build it inside a feature.

### 8.7 Behaviour

- **No native dialogs** (`alert`, `confirm`, `prompt`; gate 16). Ask with `useConfirm` or
  `ConfirmDialog`; tell with a `toast`.
- **One modal component** (`Modal`, a bottom sheet on a phone), used everywhere. A "new" or "edit"
  action opens it; editing a record you are looking at on desktop opens a `SidePanel`.
- **Uploads** through `UploadField` with a percentage per file; never a raw `<input type="file">`
  (gate 18). The engine is one copy in `packages/ui` (`lib/upload.ts` sends it, because `fetch`
  cannot report how far a request body has travelled); each app passes its own `upload`, which adds
  its session (`app/src/api/upload.ts`, `public-app/src/api/upload.ts`). A record stores the
  answer's `document_id`, never a name or a path.
- **Permissions**: the shell shows only the modules and actions the user's grants allow. Hiding is
  a courtesy; the API enforces. Never assume a hidden button means a forbidden action is safe.
- **Home is role-sensitive.** Each role sees its own KPIs and main chart; "Needs you" is the same
  for everyone. Tiles come from the API's KPI catalogue, never a hard-coded list per role.
- **Nothing is hard-coded data.** Every number, name and list on a screen comes from the API. The
  staging database is seeded with demonstration data; production starts empty. The same build must
  look right on both. The in-browser mock exists only on laptops and in CI (F12, §9.5).
- **AI deep links.** The assistant answers with links to screens ("Create Task"). Every screen
  that a write can be routed to accepts its prefill from the URL.

### 8.8 Nothing the browser styles itself (gate 21)

The brand holds everywhere, on both shells: **no part of a screen is drawn by the browser or the
phone in its own style** (FRONTEND_FOUNDATION F25). A grey native picker opening over a branded
sheet, a yellow autofill box, a browser tooltip or a validation bubble is a defect, never a detail.
There are no exemptions, `packages/ui` included.

| Never | Always |
|---|---|
| `<select>`, `<option>`, `<datalist>`, the phone's own picker | `SelectField`, `FilterSelect`, `InlineSelect` (all `SelectMenu`: a Radix listbox on desktop, a bottom sheet on a phone); `ChoiceField` for 2 to 5 options; `PersonPicker`, `RecordPicker` for server lists |
| `<input type>` date, time, month, week, number, range, color, checkbox, radio | `DateField`, `DateRangeField`, `TimeField`, `NumberField`, `MoneyField`, `CheckboxField`, `Switch`, `ChoiceField`, `Tick` |
| `<progress>`, `<meter>`, `<dialog>` | `ProgressBar`, `LevelMeter`, `Modal`, `Sheet`, `ConfirmDialog` |
| A `title` attribute (the browser's tooltip), a Leaflet marker's `title` | `Tooltip` (`IconButton` draws one from its `label`); a marker's `bindTooltip` with the `map-tip` class |
| A `<form>` without `noValidate`, the browser's "Please fill in this field" | `Form` (`noValidate`, errors on the field, §8.3) |
| `alert`, `confirm`, `prompt` (gate 16) | `useConfirm`, `ConfirmDialog`, `toast` |
| `sonner` imported in a feature, a toast styled by the library | `toast` and `Toaster` from `@mycity/ui` (unstyled sonner, our classes and icons) |

What the browser would still draw on our own controls is reset once, in
`packages/ui/src/styles/base.css`: control `appearance`, number spinners, the search clear button,
the date picker icon, the password reveal and autofill key buttons, the autofill tint, Firefox's
invalid glow, the tap flash on a phone, the text selection colour, `accent-color` and
`caret-color` (all from tokens). Scrollbars were already thin and tinted there.

`scripts/check/native-ui.js` refuses each "Never" in the source of `packages/ui`, `app` and
`public-app`, and crawls every gallery page and every app screen at phone and desktop size
(`lib/screens.js`) for a visible native element, a `title`, a form without `novalidate`, a control
whose computed `appearance` is not `none`, and a toast sonner styled. A control the set lacks is
added in `packages/ui` with `npm run new:component`, drawn in tokens, never left to the browser.

---

## 9 · Foundation: `packages/ui` and the two apps

Owner AJ, backup TB (CODEOWNERS). Built in three PRs (FRONTEND_FOUNDATION §1, §4), **all three
landed**: **PR 1 Ground** gave the package, the tokens, the primitives, overlays, help, toast, the
form system, the data client, the catalogue, the gallery and the gates; **PR 2 Shell** put both
apps' shells on it; **PR 3 Build kit** added the heavy components (DataView, the KPI pieces, the
charts, the board, the calendar, the pickers, the upload engine, the editor, the previews, voice
input and the maps), emptied both apps' component folders and converged every screen onto the token
scales. The foundation is done: every component a screen uses lives in `packages/ui`.

### 9.1 Folder structure

Three npm workspaces from the root: `packages/ui` (`@mycity/ui`), `app` (`@mycity/app`) and
`public-app` (`@mycity/public-app`), with one root lockfile. Run `npm ci` once at the root, then:

```
npm run gallery                                     the gallery: every component in every state
npm run new:component -- --name X --group Display   a new shared component (§1)
npm run gen:components                              rewrite docs/COMPONENTS.md
npm run fe:typecheck   fe:lint   fe:test   fe:build all three workspaces at once (all in npm run ci)
npm -w @mycity/ui test                              the package's tests alone
npm -w @mycity/app run dev                          the staff app on the mock (@mycity/public-app: the public site)
```

```
packages/ui/
  package.json                @mycity/ui: source only, compiled by each app; exports ".", "./styles/*",
                              "./eslint", "./vite", "./testing"
  eslint.shared.js            the lint rules the package and both apps share (F4, F7, gates 13, 15, 16, 18)
  vite.shared.js              the Vite settings both apps share: the contract as CommonJS, one Zod, one React;
                              and the build-time readers: contractPageSize, apiMode, deliveryPlan
  vitest.config.ts            jsdom, Testing Library, the axe matcher
  gallery/                    the gallery app (npm run gallery; served on staging only, F10)
  src/
    index.ts                  THE public barrel: everything a feature may import, and nothing else
    styles/                   tokens.css (the only file with a hex value), theme.css (the Tailwind 4
                              theme and variants), base.css (element defaults, focus ring, reduced motion)
    lib/                      cn, format, media (useIsPhone), preferences (theme, density), slots, ids,
                              environment (the staging marks), plan (what opens where, F14)
    icons/                    Icon (Lucide underneath)
    actions/                  Button, IconButton, BigButton, ActionGroup; press.ts, the busy state they,
                              Form and Modal share (F26)
    layout/                   Card, PageHeader, Grid, Stack, Inline, PhoneOnly, DesktopOnly
    display/                  Pill, StatusPill, Avatar, Who, CountBadge, KeyValue, Banner, EmptyState,
                              EmptyValue, Skeleton, Spinner, ProgressBar, Meter, Kbd, Money
    navigation/               Tabs, SegmentedControl, Chips
    overlay/                  Modal, SidePanel, ConfirmDialog (useConfirm), Popover, Menu, Tooltip,
                              PhonePage (a full-screen page from the right on a phone)
    help/                     HelpTerm, InfoButton, Details (§5.2)
    feedback/                 toast and Toaster, NotificationBanner (notify(), the banner at the top),
                              ErrorBoundary, ErrorState
    form/                     the form system: the only home of raw form elements (§8.6)
    data/                     ApiError, createApiClient, useApi, usePaged, useInfinite, useMutation, invalidate,
                              DataView (F20), Pager, Toolbar, ExportButton, Kanban (F19), Calendar
    charts/                   AreaChart, BarChart, DonutChart, BandChart, Sparkline; each a boundary
                              around its own *.draw.tsx chunk (F22)
    documents/                DocumentPreview, ImageViewer, Paper, Reader
    maps/                     MapView, PlaceSearch, LocationLabel on Leaflet, with Geoapify proxied (F21)
    illustrations/            Illustration, in token colours; CityShowcase, the sign-in screen's photographs
    shell/                    the frame both apps' shells are built from (PR 2): Brand, ComingSoon,
                              PublicPage, DesktopShell, PhoneShell, Rail, TopBar, PhoneHeader, BottomBar,
                              MoreSheet, FloatingButton, CommandPalette, NotificationCenter (the bell's
                              pane), NotificationRow, ShellNotice
    testing/                  test setup, render helpers, gallery types (not exported from "."), and
                              eslint-rules.test.ts, the shared lint rules' own test
```

Beside every component file `X.tsx` sit `X.test.tsx` and `X.gallery.tsx`. One component, or a
tight family, per file, opening with the header the catalogue reads (`@component`, `@group`,
`@summary`, `@use`, `@avoid`, `@phone`, `@a11y`, `@status`). The tree above is the shape; the
catalogue, `docs/COMPONENTS.md`, is the list.

```
app/
  index.html                  theme and density set before first paint (localStorage mc-theme, mc-density)
  vite.config.ts              the shared Vite settings, page size from the contract, API mode, PWA manifest, /api proxy
  eslint.config.js            extends @mycity/ui/eslint
  public/                     favicon, PWA icons, badge-96.png (the pin in a phone's status bar)
  tsconfig.sw.json            types src/sw.ts against the WebWorker library (§9.7)
  scripts/contract-status.mjs which modules still run on INTERIM types, and which are ready for the contract
  src/
    main.tsx  App.tsx         entry; providers (auth, router, modal, toasts)
    sw.ts                     the service worker: precache, offline, update, web push (§9.7)
    styles/index.css          Tailwind and the @mycity/ui styles; the staging offset; no colour of its own
    lib/                      plan (the delivery plan bound to this app), router, routes (screen URLs)
    api/
      client.ts               the staff app's client, made with createApiClient (session, refresh)
      endpoints.ts  hooks.ts  the typed endpoint map; the shared hooks bound to this client
      realtime.ts             Socket.io for the bell, presence and the in-front heartbeat (§9.6); nothing
                              on the mock
      types/<module>.ts       INTERIM wire shapes, one file per module, until contract.gen.ts covers it
      upload.ts               this app's session on the one upload engine (@mycity/ui lib/upload)
      download.ts             the other way: a gated file fetched with the session's token, as a
                              download (saveFile) or a blob URL a preview can draw (useFileUrl); a
                              download lands on this device: Downloads, or the share sheet on an
                              iPhone app opened from the home screen
      exports.ts              every Export and Download button's file: asked for, waited on while the
                              worker makes it, then saved on this device (saveExport, saveRun); never
                              emailed (docs/guides/foundation.md §6.12)
      mock/                   the in-browser mock, laptops and CI only (§9.5): core, data/, modules/<module>.ts
    auth/                     AuthProvider (useAuth, useMe; the session clock and the locked state; every way in),
                              Login (with the code step and the PIN), LockSheet, passkey (the browser's WebAuthn
                              calls), FreshSignIn (useFreshSignIn: Confirm It's You before a change)
    shell/                    Shell (DesktopShell or PhoneShell from @mycity/ui), catalogue (modules, tab
                              slugs, one-word names), access (grants, capabilities), nav (rail, bottom
                              bar, More), screens (lazy per module), More, Fab, screen-action
                              (useScreenAction), Search (⌘K), Bell, Notices, pwa (update, install),
                              offline, Planned (Coming Soon, the Prototype View switch), coming-soon,
                              layout-context
    features/shared/          wiring, never components (§9.4): sections (PagedTable, ExportAction),
                              pickers (EmployeePicker), wire (the API's shapes to the components'),
                              KpiTiles, Letter
    features/<module>/        one folder per module: home, workspace, ess, community, mailbox, people,
                              performance, queries, recruitment, payroll, partnerships, expenses,
                              knowledge, assistant (Praxis AI), settings; plus attendance and organogram,
                              shared by People, ESS and Settings; notifications (the bell's pane, the banner,
                              push on the device, Notification Settings, §9.6); and shared/ (sections, KPI
                              tiles, letters)
```

A module's screens are `features/<module>/index.tsx`, whose default export renders the tab it is
given (`<Module tab="employees" id="…" />`). Its guide's **Frontend paths** row names the feature
folder, so `scripts/check/guides.js` holds frontend changes to their guide too. Shared components
are never a feature path: they live in `packages/ui`.

The public site lives in `public-app/` (`go.mycityapp.io`, A9): the same stack without the PWA. It
imports nothing from `app/`; what both need comes from `@mycity/ui`.

```
public-app/
  index.html                  theme before first paint (localStorage mc-public-theme)
  vite.config.ts              the shared Vite settings, page size from the contract, API mode,
                              /api/public proxy; no PWA, no service worker
  eslint.config.js            extends @mycity/ui/eslint
  src/
    main.tsx  App.tsx         entry; the six routes and a not-found page
    styles/index.css          Tailwind and the @mycity/ui styles
    lib/                      plan (the delivery plan bound to this site), router
    api/
      client.ts               fetch to /api/public/v1 only, made with createApiClient; no session, no cookie
      hooks.ts  endpoints.ts  the shared hooks bound to this client; the typed endpoint map
      types/public.ts         INTERIM shapes for every public route (TB for M4 pages, LA for M5)
      mock/                   the in-browser mock, laptops and CI only; demo-links.ts lists sample addresses
    shell/                    Page (PublicPage with the site's links and noindex), Planned (Coming Soon, the
                              Prototype View switch), DemoLinks (mock only)
    pages/                    Careers, Vacancy, Apply, Assessment, SignOffer, Verify, LinkProblem
```

Addresses are `/jobs`, `/jobs/<slug>`, `/apply/<token>`, `/assess/<token>`, `/sign/<token>` and
`/verify/<number>` (MILESTONES §6). Only the careers list and an open vacancy may be indexed; every
other page sets `noindex`. In mock mode a Demo Links menu at the foot of each page opens every
state (a used or expired link, a paused or filled role, each verify outcome); the mock keeps its
state in memory, so a reload starts it again.

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

`shell/catalogue.ts` lists the fifteen modules, their one-word names (the More tiles and the bottom
bar) and their tab slugs in the order of MILESTONES §18 and `src/shared/route-map.js`;
`shell/access.ts` filters modules by the `view` grant from `/me` and tabs by role, and `shell/nav.ts`
builds the rail, the bottom bar and More from what is left. A tab that belongs to fewer people than
its module's grant reaches follows a **capability** (README §5.2): `/me.capabilities` lists the codes
the person holds, `hasCapability(me, code)` in `shell/access.ts` answers for them (the CEO holds
every one), and Home's Team, Alerts and Reports are gated that way. `src/shared/search/screens.js`
mirrors the tab rules for ⌘K; change both together. Home's three are the one exception that shows:
every Home viewer sees the tab and, without the capability, its locked state (`features/home/Gated`),
while ⌘K still hides it (home.md §10.1). A screen hides a button the same way
(`hasCapability(useMe(), code)`), never by a role's code or `manages_people`. Hiding is a courtesy:
the API refuses what a grant or a capability does not allow. An unknown module or tab lands on the
first allowed screen.
`npm run new:screen` adds a tab everywhere it is listed (§1).

Two shells (gate 11), chosen by `useIsPhone()` from `@mycity/ui` (760 px and below; the merged
screens still call it `useIsMobile`, the same hook), both from the Shell group of `@mycity/ui`:

- **Desktop** (`DesktopShell`): the `Rail` (collapsible to 66 px, remembered in `mc-rail`; the
  person's menu at its foot: My Profile, My Security, Theme, Density, Install App, Sign Out), the
  `TopBar` (rail toggle, `SearchButton`, Clock In or Out, the bell), the module's `Tabs`, the page.
  When the window is too narrow for every tab, `Tabs` shows the ones that fit (the active one
  always among them) and folds the rest into More Tabs, a ⋯ menu at the end of the strip; it never
  scrolls sideways on desktop.
- **Phone** (`PhoneShell`): `PhoneHeader` (§7: the pin; search, the bell, the avatar; the title rail
  over the tabs, which scroll sideways), the page, the `FloatingButton` and the `BottomBar` with `MoreSheet` (F16 to F18).

A screen may also render a different layout per shell; it never shrinks the desktop one. Chat and
Mailbox are "fit" pages (`useFitPage`): only their panes scroll, and scrolling past a pane's end
slides the page header away; the floating button stays off them.

**Sign-in and the session** (`docs/guides/identity.md`). `auth/Login.tsx` is the sign-in screen:
on desktop the four cities fill the screen (`CityShowcase`) with the card over them; on a phone a
short band of the city and the form under it. The same card holds Forgot Password, and the page a
reset or invitation link opens (`/reset`, `/welcome`). The access token is held in memory only and
the refresh cookie restores the session on load (§9.5). The session locks at its two-hour ceiling,
after the idle limit with no activity in any tab, or when the refresh cookie is refused; every open
tab locks at once (a BroadcastChannel), the shell stays with the person's screen and any half-filled
form, and `auth/LockSheet.tsx` (`LockScreen`) covers it: their PIN, a passkey or their password
carries on and reloads what failed; Sign Out leaves. When two-step sign-in asks for a code, the
sign-in card and the lock screen show the code step. Use Passkey and Use PIN show on a browser the
person has signed in on before. A change to a way in that the API refuses with 403
`REAUTH_REQUIRED` goes through `useFreshSignIn` (`auth/FreshSignIn.tsx`), which asks Confirm It's
You and runs it again. While the person is active the access token is renewed a minute before it
expires. Sign Out is in the account menu and at the foot of More.

**Search** (`shell/Search.tsx` on `CommandPalette`): ⌘K or Ctrl K anywhere, the top bar's search
button, the phone's search icon and More's search bar. Screens and records from
`GET /api/v1/search`, first page only (25), filtered by grant on the server; arrows move, Enter
opens. **The bell** (`shell/Bell.tsx` on `NotificationRow`): `GET /api/v1/notifications`, the
shared pager, a dot while anything is unread, refreshed over realtime (§9.6).

**Staging is marked, in both apps** (MILESTONES §6, A4). The same build runs on staging and
production, so `lib/environment.ts` in `@mycity/ui` decides at runtime: a `staging.` host name (also
set before first paint in `index.html`) or `X-Mycity-Environment: staging` on any API response sets
`data-env="staging"` on `<html>`. That opens screens by the staging rule (F14, below), swaps the tab
icon for `public/favicon-staging.svg` and sets `theme-color` to the `--warning` amber. No bar is
drawn on the page: the address already says staging (TB, 17/10/2026), so every full-screen layer
starts at the top of the screen. `?env=staging` shows the marks in development.

**What opens where, in both apps** (F14; `lib/plan.ts` in `@mycity/ui`, bound in each app's
`lib/plan.ts`). At build time `deliveryPlan()` in `vite.shared.js` reads each screen's milestone and
its API, UI and Mobile ticks from `docs/PROGRESS.md`, and each milestone's name and demo date from
the table in MILESTONES §4, into `__DELIVERY_PLAN__`. The rule comes from where the build runs:

- **Production** (a live build on a production host): a screen opens when its PROGRESS row has API,
  UI and Mobile ticked.
- **Staging** (a live build on a staging host, or a laptop on the live API): a screen opens as soon
  as its API is ticked, so its owner can check it on the seeded data.
- **Mock** (the in-browser mock: laptops and CI, never released): the Prototype View switch above
  every screen, "Full Design" (the default) or "As Delivered" at the current milestone, the earliest
  one neither past its demo day nor fully ticked, worked out from today's date. The choice is kept
  per browser. A live build does not contain the switch.
- Before its rule opens it, a screen shows Coming Soon (`ComingSoon` from `@mycity/ui`, through
  `shell/Planned.tsx`; `shell/Planned.tsx` on the public site). Staff and staging visitors see the
  milestone and date; a stranger on the public site's production sees neither. What each screen
  will do, on its card, is in `shell/coming-soon.ts` (and in the public site's `shell/Planned.tsx`).
  Re-planning a screen is a change to the M column in PROGRESS, nothing in code. A build fails if the
  plan cannot be read.

### 9.3 Tokens, type, styling and density

**Tokens.** `packages/ui/src/styles/tokens.css` holds every colour, density and motion value, and
is **the only file with a hex value** (gate 13). Names are shadcn/ui's roles: `background`,
`foreground`, `card`, `popover`, `primary` (brand yellow, a fill only), `secondary` (City Green),
`muted`, `muted-foreground`, `subtle-foreground`, `accent`, `border`, `input`, `ring`, `sidebar*`,
`success`, `warning`, `destructive`, `info` (each with a `-soft` tint), `eyebrow`, `scrim`,
`chart-1` to `chart-6`, and `paper-*` for documents. Values are MILESTONES §5.1 (light) and §5.2
(dark) exactly where given. Values the demo added that MILESTONES lacks (the subtle ink, the muted
surface, the status tints, the paper tones) are **derived tokens**, each listed in `tokens.css` with
its computed contrast ratio (F3). `#FFCD05` and `#004F70` are never used. Gate 14 checks every text
pair in both themes.

**Themes.** Light is `:root`; dark is `[data-theme=dark]` on `<html>`, or the device setting when no
choice is stored. The choice is kept per person (`mc-theme`; `mc-public-theme` on the public site)
and set before first paint. `useTheme` and `setTheme` from `@mycity/ui` read and change it.

**The Tailwind theme** (`theme.css`) turns each token into a utility (`bg-card`,
`text-muted-foreground`, `border-input`) and gives the named scales:

| Scale | Names |
|---|---|
| Type | `text-2xs` 11 · `text-xs` 12 · `text-sm` 13 · `text-base` 14 · `text-md` 15 · `text-lg` 16 · `text-xl` 18 · `text-2xl` 20 · `text-3xl` 24 · `text-4xl` 30 px; `text-body` and `text-field` follow the density |
| Spacing | Tailwind's 4 px scale (`p-1` is 4 px, `gap-3` is 12 px), plus `h-control`, `h-row`, `size-tap`, `min-h-tap` from the density |
| Radius | `rounded-ctl` 9 · `rounded-box` 10 · `rounded-card` 14 · `rounded-sheet` 16 px |
| Variants | `phone:` (760 px and below, the phone shell) · `desk:` (761 px and above) · `dark:` |

Typeface Geist (`@fontsource-variable/geist`), one family.

**Styling (F4).** Inside `packages/ui`: Tailwind utilities on token classes; a `style` prop may set
a CSS **variable** that a class reads (`w-(--fill)`), which is how every measured bar, pane and
swatch carries its one runtime value; no hex outside `tokens.css`. In `app/` and `public-app/`:
token classes and layout and spacing utilities from the named scales only. No arbitrary value
(`w-[317px]`), no `style=` prop at all, no hex. ESLint refuses each (`eslint.shared.js`), **with no
exemptions**: PR 3 converged every screen #18 wrote onto the scales and deleted the list.
Anything visual beyond that is a shared component.

**Density (F5).** `--control-h`, `--row-h`, `--text-body`, `--text-field` and `--tap`: Compact by
default (36, 40, 14, 14 and 36 px), `[data-density=comfortable]` (40, 48, 15, 15 and 40 px). At
760 px and below fields are always 16 px and controls, rows and targets at least 44 px. The choice
is kept per person (`useDensity`, `mc-density`).

**Motion (F6).** `--ease-out`, `--ease-spring`, `--dur-fast` (120 ms) and `--dur` (200 ms); all
durations are 0 under `prefers-reduced-motion`.

### 9.4 Shared components

**The list is `docs/COMPONENTS.md`**, generated from the headers and props in `packages/ui/src`
(`npm run gen:components`; never edited by hand). Each entry says what the component is for, when
not to use it, how it behaves on a phone, what it guarantees for accessibility, and its props. **The
gallery** (`npm run gallery`) shows every one in every state, light and dark, phone and desktop,
Compact and Comfortable; the screen gates and the accessibility check crawl it. `check/components.js`
fails a stale catalogue, a component without its header, test or gallery page, a new file in an
app's `components/` folder, and a feature that declares a component with a shared name.

**Slots.** Shared components mark their text with `data-ui` slots (`page-title`, `title`, `button`,
`help`, `details`, `modal-footer` and the rest, `lib/slots.ts`) so gates 8 and 11 know a page title
from a button without guessing from markup. Content a person wrote or received is marked
`data-copy="content"` (`content()`) and is not counted as interface copy (§5.3).

**LEGACY is empty.** PR 3 moved the last of #18's own components into `packages/ui` and deleted
`app/src/components/` and `public-app/src/components/`. `LEGACY` in `scripts/check/components.js` is
an empty list and FRONTEND_FOUNDATION §7 an empty table, and the check around them stays: a file in
either folder fails the build, and so does a feature that declares a component with a shared name. A
missing component is added to `packages/ui` with `npm run new:component` (F11).

What a feature may still keep beside its screens is **wiring**, not components:
`features/shared/sections.tsx` binds `DataView` and `ExportButton` to this app's endpoints
(`PagedTable`, `ExportAction`), `features/shared/pickers.tsx` binds `PersonPicker` to the employees
endpoint (`EmployeePicker`), `features/shared/wire.ts` maps what the API sends to what the
components take, and `api/upload.ts` gives the upload engine this app's session.

**Submit is never disabled** (§8.3). `Button`, `IconButton` and `BigButton` are busy while the work
their handler returns runs (F26, §8.4), or while `busy` says so (a mutation's pending that the press
does not hand back); either way they ignore presses but stay enabled and reachable (`aria-busy`,
`aria-disabled`), and the buttons in their `ActionGroup` wait. `actions/press.ts` holds the one copy
of that state, which `Form` and `Modal` share. A form shows what is wrong on its fields when Submit
is pressed, never by disabling it. A choice that is not a field (pick at least one row) says so in
one line above the footer.

**What the screen gates read** (gates 8 and 11, §9.2). The shared components carry the copy slots
as `data-ui` attributes: `page-title`, `page-subtitle`, `title` (card, section, modal and KPI
titles), `kpi-caption`, `button` (buttons, tabs, filter chips), `chart-caption`, `empty-text`,
`help`, `details`, `modal-footer`, `nav-label`; the shell marks `page`, `scroller`, `desktop-nav`,
`phone-nav`, and a modal or sheet is `modal`; a help term carries `data-help-term`. Anything a
person wrote or received is marked `data-copy="content"` and is not counted: messages and chat
lists, mail rows, announcements, articles and documents, timelines, chains, bars, pills, people and
record names (`CardHeader record`), the org chart and the phone card list. A heading written by hand
in a feature carries `data-ui="title"` or `data-copy="content"`, so the gate sees it. On a phone,
every button, chip, tab, input and switch is at least 44 × 44 px. The gates crawl the gallery and
every app screen (the mock build, as the Operations account); a screen only Staff or the CEO see is
held to the same rules by review until the crawl signs in as them too.

### 9.5 Data: the client, the mock, the seed and what opens where

**The client** is `packages/ui/src/data`, shared by both apps. `createApiClient` makes each app's
client: the staff app's sends `Authorization: Bearer <access token>` (held in memory only) and
`credentials: "include"` for the refresh cookie, and on a 401 calls `/api/v1/auth/refresh` once and
retries (one tab at a time, through the Web Locks API, because the refresh token rotates and a
rotated one ends the session; `session.onEnded` receives the server's reason); the public site's calls `/api/public/v1` with no session. Errors arrive as one `ApiError`
with `code`, `message` and `fields`. Writes that must not repeat pass `idempotencyKey` (sent as
`Idempotency-Key`). The hooks: `useApi` (one read), `usePaged` (server pages: `page`, `q` debounced
250 ms, filters; changing either goes to page 1), `useInfinite` (phones), `useMutation` (with
`fields` after a 422) and `invalidate(prefix)`, which reloads every mounted read under that path.
There is no client cache beyond the mounted reads. The page size is the contract's
(`__CONTRACT_PAGE_SIZE__`, read from `packages/contract/schemas/common.js` at build), never a
constant in an app.

**Types.** Every call is typed by its key, `api.call("GET /api/v1/employees/:id", { params, query,
body })`, from the `Endpoints` map. `app/src/api/endpoints.ts` starts from the generated `Endpoints`
in `packages/contract/contract.gen.ts` (F15; `tsconfig.app.json` has `allowJs` so the schemas' types
resolve), and each `api/types/<module>.ts` still on INTERIM shapes adds its routes by declaration
merging until the module lands. A form may use a contract schema directly
(`import identity from "@mycity/contract/schemas/identity.js"`) for its field rules.

**Moving a module from INTERIM to the contract.** `npm run contract:status` (from `app/`) lists
every INTERIM file in both apps against `contract.gen.ts`: how many of the endpoints the screens call
are in the contract, and whether the module is Interim, Partly or Ready to switch. With `-- --all`
it lists each endpoint, including ones the contract has that no screen calls (often a rename). When
a module is Ready to switch: point its imports at the generated `Endpoints`, delete its INTERIM
file, run `npm run fe:typecheck` and fix every screen it flags, give each form's `useContractForm`
the module's schema in place of its INTERIM rules (§8.6), then run it on the live API and tick its
rows in `docs/PROGRESS.md`.

**The mock (F12).** Staging and production run the same live build on the real API. Staging shows
its seeded data (`seeds/staging`, A5); production shows only live data. The in-browser mock
(`app/src/api/mock/`, `public-app/src/api/mock/`) lives only on laptops (`npm run dev`) and in CI
(tests, the gallery, the crawl), and the `mock-free` gate proves no release build contains it. It
answers with the backend's exact envelopes, applies search and filters itself and rejects unknown
query keys with a 422. Each mock response is checked against the contract once that module's schema
exists, and a module's mock is deleted when its real routes ship. The identity mock is the exception:
it stays, in the contract's shapes, because the gallery, the crawl and a laptop all need to sign in. API mode is set in
`vite.config.ts`: `mock` for `npm run dev` and `npm run build:demo`, `live` for a production build;
`VITE_API_MODE=live npm run dev` (or `npm run dev:live` in `app/`, which sets it on any shell) proxies `/api` to `localhost:3000`.

**One dataset (F13).** The mock's records are the source of `seeds/staging`. When a module's routes
land, its owner writes the staging seed that loads the same records through the services (LA
reviews), so a laptop and staging show the same people and numbers.

**What opens where (F14).** Production opens a screen when its PROGRESS row has API, UI and Mobile
ticked. Staging opens it as soon as API is ticked, so its owner can check it on seeded data. Before
that both show Coming Soon. The Full Design and As Delivered switch exists only in mock mode, on a
laptop or in CI (§9.2).

### 9.6 Realtime (Socket.io) and notifications

`api/realtime.ts`: one Socket.io connection to the API (`src/realtime/socket.js`) while a person is
signed in, with the access token from memory in the handshake. The server joins the socket to the
person's own rooms and closes it when the token expires; the client then refreshes the session once
and reconnects. A refused refresh leaves it closed and the session sheet takes over (§9.2).
`useRealtime(event, handler)` hands an event to the components listening while they are mounted;
`usePresence(userId)` keeps who is online from `presence` events. While the tab is on screen and was
touched in the last 5 minutes the socket says `presence:active` every 30 seconds, and
`presence:idle` when that stops: the server holds a push to the person's devices for a minute while
they are looking at the app. Realtime is best effort: everything also arrives over HTTP, so a
dropped socket only means the bell refreshes when it is opened. The in-browser mock has no server, so
nothing connects in mock mode; it answers every notification route in the contract's shapes.

Notifications are designed in `docs/guides/notifications.md` (web push and personal preferences
brought forward from M6 by TB, 19/10/2026). In the staff app:

- **The bell** (`shell/Bell.tsx`) is the pane, `NotificationCenter`: a `PhonePage` from the right on
  a phone and a 420 px panel under the bell on desktop, All and Unread, Today, Yesterday and
  Earlier, pages of 25 through `useInfinite` as the list nears its end, pull to refresh, swipe left
  (phone) or the hover tick (desktop) to mark read, Mark All Read, and the gear for Notification
  Settings (`features/notifications/Settings.tsx`: a `PhonePage` over the pane on a phone, a
  `Modal` on desktop). It reloads its dot, its list and the badge counts
  (`GET /api/v1/notifications/unread-count`, `GET /api/v1/notifications`,
  `GET /api/v1/notifications/badges`) on `notification` (a new one) and `notification_read` (a read
  mark made in another tab or on another device). Open marks a notice read before it navigates.
  Whether the pane and Notification Settings are open is one store (`features/notifications/state.ts`),
  so the bell, ⌘K and a `pane=notifications` link open the same ones.
- **Arrivals** (`features/notifications/arrivals.ts`, `useArrivals`): a notice reaching a window on
  screen, over the socket or from the service worker, shows the banner (`notify()` from
  `@mycity/ui`, on the second, top `Toaster`, for 3 seconds) and chimes or vibrates (`sound.ts`):
  once per notice whichever way it came, never for the record already on screen. A window in the
  background only reloads its bell; the device's own notification sounds. A link from a notification
  carries `n=<ids>` (marked read, then dropped from the address) or `pane=notifications`. When the
  app comes to the front it closes the notifications in the shade whose notices are read, and the
  app icon's count follows the unread count (`setAppBadge`, where the platform has one).
- **Push** (`features/notifications/push.ts`): the device's state (unsupported, needs-install, ask,
  blocked, off, on, unavailable); `syncPush()` on every signed-in start, which never asks;
  `enablePush()`, only from a press; `disablePush()`, remembered on that device; `sendTestPush()`.
  The device's id, token and key id live in IndexedDB (`device-store.ts`, database `mycity-push`),
  where the service worker reads them. The one-time Turn On offer is a `ShellNotice`
  (`shell/Notices.tsx`); the browser's own prompt never shows unasked.
- **⌘K** runs Notification Settings, Turn On Notifications, Send Test Notification and Mark All Read
  in the app itself (`shell/Search.tsx`, `src/shared/search/actions.js`).

### 9.7 PWA (staff app only)

`vite-plugin-pwa` in `injectManifest` mode with `registerType: "prompt"`: the service worker is the
app's own, `src/sw.ts` (typed by `tsconfig.sw.json`, the WebWorker library, and built as
`dist/sw.js`); the plugin injects the precache list. `shell/pwa.ts` holds what the shell shows
(`startPwa()` at start, `usePwa()` in the shell):

- **Update**: a new version shows a `ShellNotice` with Reload rather than reloading under someone;
  Reload sends the waiting worker `SKIP_WAITING`.
- **Install** (PR 2 question 4): an Install App action in More and in the desktop account menu, and
  a one-time banner (`ShellNotice`: Install App, Not Now) from a person's second signed-in visit on
  that device, on a phone and on desktop; Not Now holds it for 30 days. Neither shows once the app
  is installed (opened standalone, or the browser reports `appinstalled`). Where the browser offers
  its own prompt (`beforeinstallprompt`) Install App uses it; on an iPhone or iPad it shows the Add
  to Home Screen steps.
- **Offline**: the shell and assets are precached, so the installed app opens without a connection;
  the worker answers no `/api/` request, so every number on screen is live and nothing personal is
  cached. With no connection the page area shows the offline page (`shell/offline.tsx`: No
  Connection, Try Again) and the shell stays; when the connection returns every mounted read
  reloads.
- **Push** (`src/sw.ts`, `docs/guides/notifications.md` §3, §6): `push` asks each visible window of
  the app on a `MessageChannel` (`mycity:push`, 1.5 seconds) and shows a notification unless one
  answers `{ ok: true }`; Safari, iPhones and iPads, and a test always show one, because WebKit stops
  a subscription whose pushes show nothing. One notification per conversation (its tag): mail and
  direct messages alert again, channel posts update quietly. Each carries the sender's initials
  (drawn on an `OffscreenCanvas` in the brand colours read from `tokens.css`), the monochrome pin
  `public/badge-96.png`, Mark Read and the unread count on the app icon. `notificationclick` focuses
  a window and sends it to the record (`mycity:open`) or opens one on the record's address with
  `n=<ids>`; sign-in keeps the address, so the record opens once signed in. Mark Read and
  `pushsubscriptionchange` call the API with the device token, without a session.

The manifest is in `vite.config.ts` (standalone, brand colours, 192, 512 and maskable icons). The
service worker never answers `/api/` or `/gallery/` with the app shell, and the API serves `sw.js`
with `Cache-Control: no-cache`, so a new worker is found at the next start.

---

## 10 · Branches, pull requests and CI

The same as the backend: nobody pushes to `main`; branch, push, pull request, CI green, a code
owner's approval, merge. How to open a branch, keep it up to date, and what makes CI fail are in
`BACKEND_GUIDE.md` §8. A change under `packages/ui/` needs AJ or TB (CODEOWNERS, F11).

The gates that hold the frontend to this guide run in `npm run ci`; `npm run ci -- --list` shows
what runs today. The screen gates crawl the gallery, every app screen, and `demo.html` only
when a change touches it (F23). Several gates are lint rules in
`packages/ui/eslint.shared.js`, run by `fe:lint` in the package and both apps.

| Gate | Where | Refuses |
|---|---|---|
| 8 Five-second rule | `scripts/check/five-second.js` | A word limit broken (§5.3), an explainer title, chrome not in Title Case, help visible on load, a subtitle or chart caption on a phone, text in a modal footer |
| 11 Two shells | `scripts/check/two-shells.js` | Sideways scrolling, the wrong navigation for the width, a table on a phone, a tap target under 44 px, a wordy first phone screen, a script error (§7) |
| 12 Inline validation and the form system | `scripts/check/forms.js` | A raw form element or `react-hook-form` outside `packages/ui/src/form/`, a hand-made label, an asterisk, an instruction as a placeholder, a long field error, a Submit or OK button (§8) |
| 13 Palette | lint `no-hex`; `scripts/check/palette.js` | A raw hex outside `tokens.css`; `#FFCD05` or `#004F70` anywhere; a colour, an arbitrary value or a `style` prop in an app (F4), with no exemptions |
| 14 Contrast | `scripts/check/contrast.js` | A text pair in `tokens.css` below AA (4.5:1) in either theme, chart series included (§9.3) |
| 15 Day-first dates | lint `no-date-input`, `no-bare-date-locale`; `scripts/check/date-format.js` is still empty (NOT BUILT in `npm run ci`) | `<input type="date">`, `toLocaleDateString()` with no locale (§6) |
| 16 No native dialogs | lint; `scripts/check/native-dialogs.js` | `alert`, `confirm`, `prompt` and `window.` forms of them (§8.7) |
| 17 No dashes | `scripts/check/dashes.js` | An em dash, an en dash or a double hyphen in copy a person reads (§5.4) |
| 18 Upload engine | lint `no-file-input`; `scripts/check/upload.js` | A raw `<input type="file">` outside `packages/ui/src/form/` (§8.7) |
| 21 Nothing the browser styles itself | `scripts/check/native-ui.js` (source, and every gallery page and app screen in Chromium) | A native select, option, datalist, progress, meter or dialog; a browser-drawn input type; a `title` tooltip; a form without `noValidate`; a control the `base.css` reset missed; sonner outside the `Toaster`. No exemptions, `packages/ui` included (§8.8, F25) |
| F26 One press, one request | lint `no-void-press` (`packages/ui/eslint.shared.js`, tested in `packages/ui/src/testing/eslint-rules.test.ts`) | A press handler on `Button`, `IconButton`, `BigButton`, `Form`, `Wizard`, `ConfirmDialog` or `ExportButton` that throws its work away (`() => void save()`, or a local function it names that does), so the button cannot stay busy (§8.4) |
| Components (F8) | `scripts/gen/components.js --check`, `scripts/check/components.js` | A stale `docs/COMPONENTS.md`; a component without its header, test or gallery page; ANY file in an app's `components/` (both folders are gone); a feature shadowing a shared component (§9.4) |
| Mock-free (F12) | `scripts/check/mock-free.js` | A release build that contains the in-browser mock (§9.5) |
| Accessibility | `scripts/check/a11y.js` | An axe violation on any gallery state, in either theme, or on any app screen (shell and page together) at phone and desktop size |
| Frontend typecheck, lint, test, build | `npm run fe:typecheck`, `fe:lint`, `fe:test`, `fe:build` | A type error, a lint error (the rules above, F4, F7, no local Zod), a failing Vitest test (each component's render, behaviour and axe check), a build that does not complete, in `packages/ui`, `app` or `public-app` |

The screen gates (8, 11 and 21) need Chromium. CI installs it; locally, `npx playwright install chromium` once.
The Stop hook runs them when a change touches `packages/ui/`, `app/`, `public-app/` or `demo.html`.

## 11 · Done means

- [ ] Read `docs/FRONTEND_FOUNDATION.md`, `docs/COMPONENTS.md` and the whole feature guide first
- [ ] Every component from `@mycity/ui`; nothing shared built inside a feature
- [ ] A missing component added to `packages/ui` with `npm run new:component`: header, test and
  gallery page filled, `docs/COMPONENTS.md` regenerated (`npm run gen:components`)
- [ ] Styling tokens only (F4): no hex, no arbitrary value, no inline `style`
- [ ] Looks right in light and dark, Compact and Comfortable
- [ ] Built against the real API through the contract; no mock data left in components; the mock
  never in a release build (F12)
- [ ] Every list uses the shared pager, sends `page` only, shows the true total
- [ ] The feature guide's §10 lists what is open (tier 1), what is collapsed (tier 2) and the phone
  layout of every screen you touched, and the screen matches it
- [ ] No tier 3 text on the screen; word limits met; Title Case; no dashes (gates 8, 17)
- [ ] Help only through `HelpTerm`, `InfoButton` and `Details`, closed by default
- [ ] Icons through `Icon`; empty states carry the shared illustration
- [ ] Desktop and mobile shells both built; the PR body states the native app feel measures (gate 11)
- [ ] Forms only from the form system in `@mycity/ui` (`packages/ui/src/form/`), validated as filled
  by `useContractForm` from the contract schema, or INTERIM rules until it exists (gate 12)
- [ ] Day-first dates, formatted money, through the `@mycity/ui` helpers
- [ ] No native dialogs; upload engine
- [ ] Every press hands back its work: the button busy until it settles, its group waiting, no
  `() => void save()` and no `disabled={busy}` (F26, §8.4)
- [ ] Nothing the browser draws in its own style: no native select or picker, no browser input
  type, no `title` tooltip, no validation bubble, no unbranded toast, on phone or desktop (gate 21, §8.8)
- [ ] `npm run ci` green, the whole suite, before pushing
- [ ] Pushed as a branch, PR opened with the template filled in; CI green on the PR
- [ ] `docs/PROGRESS.md` row ticked (UI, Mobile) and a note left
- [ ] The feature guide in `docs/guides/` matches what was built

Engineered by JBS Praxis.
