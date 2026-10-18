# MyCity App ERP · Frontend Foundation Playbook

**The plan, the decisions and the progress of the frontend foundation, in three pull requests.**
Read this before any work on `packages/ui/`, the app shells or a shared component. Each PR below
is built in its own session; that session follows §2, and ticks §6 when it is done.

Decided with TB on 15/10/2026, after PR #18 (AJ) put both apps on `main`. The decisions in §3 are
the single source of truth: where a document, the demo or merged code disagrees with them, they win
and the other is brought into line (FRONTEND_GUIDE, MILESTONES, `demo.html` notwithstanding).

---

## 1 · Why three PRs, and what "done" means

PR #18 built all 92 screens on a foundation of its own: hand-rolled components, a copy of the
tokens and controls in each app, interim API types and an in-browser mock. The screens stay. The
foundation under them is made one, shared, documented and gated, so that four people building in
parallel produce one product:

| PR | Name | Gives |
|---|---|---|
| 1 | **Ground** | `packages/ui` (one design system for both apps), tokens, primitives, overlays, help, toast, the whole form system, the component catalogue and its gate, the gallery, the new gates, the playbook |
| 2 | **Shell** | Both apps' shells on `packages/ui`: navigation, bottom bar and More, the floating button, sign-in and session, permissions, search, bell, realtime, PWA, the staging rules, the gallery on staging, the app as a gated crawl target, `new:screen` |
| 3 | **Build kit** | DataView, KPI card, charts, kanban, calendar, timeline, pickers, upload, rich text editor, PDF preview, voice input, maps; every remaining component of #18 moved into `packages/ui`; every screen on the token scale and the F4 exemption list deleted |

**Done**, for the foundation: every component a screen uses lives in `packages/ui`, is listed in
`docs/COMPONENTS.md`, has a test and a gallery page, and passes every gate; `app/src/components/`
and `public-app/src/components/` are empty; both apps build, typecheck, lint and test in
`npm run ci`.

**All three PRs have landed** (§6). What a feature keeps beside its screens is wiring, not
components: an endpoint bound to a shared component, the API's shapes mapped to the components', the
app's session on the upload engine.

---

## 2 · How each PR session works

1. **Read** this file, `CLAUDE.md`, `docs/FRONTEND_GUIDE.md`, `docs/COMPONENTS.md` and the
   feature guides the PR touches. Feature guides are **full-stack** guides: their API, schemas,
   events and rules (§4 to §9) matter as much as their screens (§10).
2. **Check the base.** `git fetch origin main`; branch from the newest `main`; list open PRs and the
   files they touch. Where an open PR edits the same files, edit those files last and minimally.
3. **Ask four clarifying questions** before writing code, with a recommendation each, and record the
   answers in that PR's section of §5 below. Questions are about decisions §3 leaves open, never a
   reopening of §3.
4. **Build** to §3 and the PR's checklist in §4. A component that does not exist yet is added to
   `packages/ui` with `npm run new:component` (header, test and gallery page come with it).
5. **Finish**: `npm run ci` green, the whole suite; tick the PR's checklist in §4 and its row in §6
   with a dated note; update `docs/PROGRESS.md` (M0 item) and the guides it changed.

---

## 3 · Decisions (15/10/2026, TB)

| # | Decision |
|---|---|
| F1 | **One design system for both apps**: the workspace package `packages/ui` (`@mycity/ui`). The public site imports it, never `app/` (A9 holds: no app imports the other app). No component, token or helper is copied between apps |
| F2 | **Today's agreements are the source of truth** over #18 where they differ. #18's screens are kept and moved onto `packages/ui`; its component and hook APIs are kept where they serve, upgraded underneath |
| F3 | **Tokens are MILESTONES §5.1 and §5.2.** Values the demo added that MILESTONES lacks (subtle ink, paper tones, status tints) stay as derived tokens, each listed with its contrast ratio. Gate 14 checks every text pair in both themes |
| F4 | **Styling is tokens only, gated.** Features compose `packages/ui` components and may use Tailwind layout and spacing utilities from the token scale. No colour outside a token class, no arbitrary value (`w-[317px]`, `bg-[#…]`), no inline `style`, no raw hex. Anything visual beyond that is a shared component |
| F5 | **Density.** Compact is the default on desktop (14 px body, 40 px table rows, 36 px controls); a person may switch to Comfortable (15 px, 48 px rows, 40 px controls), remembered per person. A phone always uses 16 px in fields and 44 px targets |
| F6 | **Motion is native.** Bottom sheets slide with a spring and close by dragging down (Vaul over Radix Dialog); toasts and popovers fade briefly; everything is instant under reduced motion. A sheet stays above the phone's keyboard with its header in view, and once it holds a text field it closes only on purpose: its close button, Cancel or Esc, never a drag or a tap on the scrim, which puts the keyboard away instead (18/10/2026) |
| F7 | **Accessible primitives.** Radix sits underneath overlays, menus, popovers, tooltips, tabs, switches and checkboxes; styling is ours. Forms are react-hook-form with `useContractForm` and the contract's Zod schemas |
| F8 | **Component catalogue, generated and gated.** Every shared component file opens with a header (`@component`, `@group`, `@summary`, `@use`, `@avoid`, `@phone`, `@a11y`, `@status`); `npm run gen:components` writes `docs/COMPONENTS.md` from the headers and the props; `check/components.js` fails a stale catalogue, a component without header, test or gallery page, and a feature that re-creates or shadows a shared component |
| F9 | **Guides lead, gates confirm.** `CLAUDE.md`, the README, FRONTEND_GUIDE §1 and this file send every builder to the catalogue and to `npm run new:component` before any code, so a gate confirms work built right rather than rejecting it at the end |
| F10 | **Gallery.** An in-repo gallery app in `packages/ui` shows every component in every state, light and dark, phone and desktop. The screen gates and the accessibility check crawl it. It is served on staging only (`hub.staging.mycityapp.io/gallery`), never on production; locally `npm run gallery` |
| F11 | **New shared components** are added in the feature PR that needs them, inside `packages/ui`, with header, test and gallery page; CODEOWNERS makes AJ (backup TB) approve that path |
| F12 | **Data.** Staging and production run the same live build on the real API. Staging shows its seeded data (`seeds/staging`, A5); production shows only live data. The in-browser mock lives only on laptops (`npm run dev`) and in CI (tests, gallery, crawl); a gate proves no release build contains it. Each mock response is checked against the contract once that module's schema exists; a module's mock is deleted when its real routes ship |
| F13 | **One dataset.** The mock's records are the source of `seeds/staging`: when a module's routes land, its owner writes the staging seed that loads the same records through the services (LA reviews), so a laptop and staging show the same people and numbers |
| F14 | **What opens where.** Production opens a screen when its PROGRESS row has API, UI and Mobile ticked; staging opens it as soon as API is ticked, so its owner can check it on seeded data; before that both show Coming Soon. The Full Design / As Delivered switch exists only in mock mode (laptops) |
| F15 | **Contract.** `scripts/gen/contract.js` and `contract.gen.ts` are GE's (#19): types, `Endpoints` and runtime `schemas`. The frontend types its client against `Endpoints` and validates forms with `schemas`; interim types retire module by module (`npm run contract:status`) |
| F16 | **Phone bottom bar**: Home, Workspace, Community, Self-Service, More. Same for everyone |
| F17 | **More** is a launcher grid in a bottom sheet (to 90% height, drag down to close): the person's row with Theme, Density and Settings; a search bar that opens full search; module tiles four to a row grouped Work, People, Business, System, each an icon in a soft brand square, one word and a count badge; only the modules the person may open; Sign Out at the foot |
| F18 | **Floating button**, phone only, bottom right above the bottom bar, never draggable. Tap fans out: the screen's own New action when it has one, Clock In or Out, Praxis AI, Help. It never hides data: every page carries bottom clearance equal to its footprint; it tucks away while scrolling down and returns on scrolling up; it hides while a sheet or the keyboard is open; its fan has Hide Here, which keeps it hidden until the person leaves that page. Desktop has none |
| F19 | **Boards on a phone**: a stage switcher (chips with counts) over a card list for that stage; moving a card is Move To in its sheet. No dragging on a phone |
| F20 | **DataView** from day one: server-side sort (a `sort` key in `listQuery`, allow-listed per list), row selection with bulk actions on the current page, one Export action that asks the server for the whole filtered list. No column chooser |
| F21 | **Maps**: Leaflet draws the map; Geoapify gives tiles, address search and clock-in address labels, all through our API so the key stays on the server. Components `MapView`, `PlaceSearch`, `LocationLabel`; the proxy routes are backend work (attendance, worksites) |
| F22 | **Heavy parts now, loaded lazily**: rich text editor, PDF preview, charts, voice input, maps. Each is its own chunk, loaded only by a screen that uses it |
| F23 | **demo.html is frozen** as a visual reference. The screen gates crawl it only when a change touches it; the gallery and the app are the gated targets |
| F24 | **Work split**: Ground, Shell, Build kit (§1). Each PR session asks four clarifying questions first (§2) |

---

## 4 · The three PRs

### PR 1 · Ground

**Workspace**
- [x] `packages/ui` (`@mycity/ui`): ESM, TypeScript strict, source consumed by both apps; Vitest with jsdom; its own ESLint config, which both apps extend
- [x] Root npm workspaces `packages/*`, `app`, `public-app`; one root lockfile (the apps' own lockfiles removed)
- [x] Vite in both apps resolves `@mycity/contract` (CommonJS) to one Zod instance (F15)

**Design system**
- [x] Tokens (F3), density (F5), base styles, Geist, Tailwind 4 theme, reduced motion
- [x] `cn`, formats (day-first dates, money from strings, counts), `useIsPhone` (760 px), theme and density per person, `data-ui` slot names the gates read
- [x] Primitives: Button, IconButton, Icon (Lucide), Card, PageHeader, layout (Stack, Inline, Grid, PhoneOnly, DesktopOnly), Pill, StatusPill, Avatar, Who, CountBadge, KeyValue, Banner, EmptyState with illustrations, EmptyValue, Skeleton, Spinner, ProgressBar, Meter, Kbd, Money
- [x] Navigation primitives: Tabs, SegmentedControl, Chips
- [x] Overlays (F6, F7): Modal (centred on desktop, a bottom sheet on a phone, full-screen sheet for long forms), SidePanel, ConfirmDialog and `useConfirm`, Popover, Menu (an action sheet on a phone), Tooltip
- [x] Help: HelpTerm, InfoButton, Details (FRONTEND_GUIDE §5.2)
- [x] Toast (one API, word limit, Undo)
- [x] Form system (FRONTEND_GUIDE §8): `useContractForm`, Form, Field, TextField, PasswordField, NumberField, DateField, DateRangeField, TimeField, MoneyField, PhoneField, SelectField, ChoiceField, CheckboxField, Switch, ToggleRow, TextAreaField, SearchInput, OtpField, FormFooter, FormError, Wizard, InlineInput and InlineSelect
- [x] Data client core: one `ApiError`, the typed call, `useApi`, `usePaged`, `useInfinite`, `useMutation`, `invalidate`, shared by both apps

**Catalogue and gallery**
- [x] `npm run gen:components` → `docs/COMPONENTS.md`; `npm run new:component` scaffolder
- [x] Gallery app (`npm run gallery`), every component in every state, both themes, both densities

**Apps moved onto it**
- [x] `app/` and `public-app/` import every Ground component from `@mycity/ui`; their copies deleted
- [x] Remaining #18 components listed in §7 with the PR that moves them

**Gates**
- [x] `components` (F8), `palette` (13), `contrast` (14), native dialogs (16), upload (18), `mock-free` release build (F12), `a11y` (axe on the gallery)
- [x] Screen gates crawl the gallery; the demo only when touched (F23); `packages/ui` covered by gates 8, 12, 17
- [x] Frontend typecheck, lint, test and build in `npm run ci`; the Stop hook runs the screen gates when `packages/ui/` changes

**Documents**
- [x] This playbook; FRONTEND_GUIDE, CLAUDE.md, README, PR template, CODEOWNERS, PROGRESS brought into line

### PR 2 · Shell

- [x] Staff shell on `packages/ui`: desktop rail and top bar; phone top bar, bottom bar (F16), More sheet (F17), floating button (F18)
- [x] Sign-in, session (access token in memory, refresh cookie), sign-out, session expiry
- [x] Permission-aware navigation from `/me` grants; routes by the one URL shape (`/<module>?tab=<tab>&id=<id>`)
- [x] Command palette (⌘K) and search; notification bell; realtime (Socket.io) for the bell and presence
- [x] PWA: install, update prompt, offline shell page
- [x] Theme, density and the staging marks (the on-page bar taken off by TB, 17/10/2026); what opens where (F14)
- [x] Public site shell on `packages/ui`
- [x] Gallery served on staging only (F10): `src/http/static.js` refuses `/gallery` on production; release builds it
- [x] The app as a gated crawl target (gates 8, 11, a11y) on mock data in CI; `npm run new:screen`

### PR 3 · Build kit

- [x] DataView (F20): table on desktop, card list on a phone, the pager, server sort, selection and bulk actions, Export; `sort` in `listQuery` (one key, a leading `-` for descending, allow-listed per list) with `orderBy()` in `shared/http/paged.js`
- [x] KPI card and KPI grid, StatStrip, the KPI detail sheet (the report model: summary, group chips, search past a screenful, records paged at 25)
- [x] Charts (lazy): area, bar, donut, bands, sparkline, each its own `*.draw.tsx` chunk; both palettes from the chart tokens (MILESTONES §5.2), with every value also read out as words
- [x] Kanban (F19: stage chips and Move To on a phone, Move To as a real menu on desktop too), Calendar, Timeline, approval Chain, Accordion
- [x] Pickers: PersonPicker and RecordPicker (server search, 25 per page, nothing filtered on the client); the upload engine with a percentage per file (gate 18), one copy for both apps; SignatureField
- [x] Rich text editor (TipTap, lazy), PDF and document preview with an image viewer and Open in Tab, Paper, Reader, voice input (A18), Profile header
- [x] Maps (F21): MapView, PlaceSearch, LocationLabel on Leaflet, with the tiles, the address search and the reverse lookup all through our API
- [x] `app/src/components/` and `public-app/src/components/` deleted; §7 cleared and `LEGACY` empty
- [x] Every screen on the token scale: 804 arbitrary values converged, the 10 inline styles became shared components, and `styling-exemptions.json` is deleted with its readers

---

## 5 · Questions asked per PR

**PR 1 · Ground** (15/10/2026, TB)

1. How much styling may a feature write? Tokens only, gated (F4).
2. Desktop density? Compact by default, Comfortable by choice (F5).
3. How should a phone feel? Native, drag to dismiss (F6).
4. Where does the gallery live? Staging only (F10).

**PR 2 · Shell** (15/10/2026, TB)

1. Where do the shell's frame parts live? In `packages/ui`, a **Shell** group: the rail, top bars,
   bottom bar, More, the floating button, the command palette, the notification row, the staging
   bar, Coming Soon and the public page frame are data-free components with header, test and
   gallery page; each app keeps only its wiring (catalogue, grants, session, routes).
2. What happens when a session expires mid-work? A **sign-in sheet opens in place**, over the
   screen, which stays underneath with any half-filled form; signing in again carries on where the
   person was. Another account signing in reloads at Home.
3. What does the phone top bar hold? **The pin alone** (no word) at the left; search, the bell and
   the person's avatar at the right (the avatar opens their row: theme, density, settings, sign
   out). Under it a **title rail**: the module's name as one large line (shortened when long) over
   the tab chips. Scrolling down slides the title away and keeps the tabs; scrolling up brings it
   back.
4. How is installing the app offered? An **Install App** action in More and the desktop account
   menu, and a **one-time banner** from a person's second signed-in visit, on a phone and on
   desktop, with Install App and Not Now (Not Now holds for 30 days on that device). Neither shows
   once the app is installed (opened as an installed app, or the browser reports it installed). On
   an iPhone, Install App opens a sheet with the Add to Home Screen steps.

**PR 3 · Build kit** (16/10/2026, TB)

1. How does a list ask the server to sort? **One `sort` key in `listQuery`**, the field name with a
   leading `-` for descending (`?sort=-created_at`). Each list passes its own allow-list
   (`listQuery(filters, ["display_name", "created_at"])`); a field that is not on it is a 422 that
   names the key, like any other bad filter. `DataView` sends one value and a column header cycles
   ascending, descending, none.
2. How far does this PR take F4? **Both styling-exemption lists are emptied and the file deleted.**
   All 58 files (49 in the staff app, 9 on the public site) move onto the token scale and
   `@mycity/ui` components in this PR, and `styling-exemptions.json` goes with its readers in both
   apps' ESLint configs and `check/palette.js`. F4 is then whole, with no list to shrink later.
3. What draws the rich text editor? **TipTap (ProseMirror), in its own lazy chunk** (F22). Selection,
   paste sanitising, lists and undo are the parts that are not worth hand-rolling, and the composer
   and announcements both take pasted mail. The toolbar and every style are ours, on tokens.
4. How is a document previewed? **The browser's own viewer**: a PDF streams from the vault into an
   `<object>`, and anything that refuses it inline gets a Download card instead. An **image viewer**
   sits beside it for pictures, and **both carry Open in Tab**, so a preview opens full size.
   Our own generated documents keep rendering through `Paper`.

---

## 6 · Progress

| PR | Status | Branch · PR | Updated |
|---|---|---|---|
| 1 Ground | Done | `claude/nifty-ptolemy-4fb7gz` | 15/10/2026 |
| 2 Shell | Done | `m0/frontend-shell` | 15/10/2026 |
| 3 Build kit | Done | `m0/frontend-build-kit` | 16/10/2026 |

**Notes** (newest first; date · initials · what was done · what is left)

- 16/10/2026 · TB · PR 3 (Build kit) done, and with it the frontend foundation. `packages/ui` holds
  157 components: a **Data** group (DataView, Pager, Toolbar, ExportButton, Kanban, Calendar), a
  **Charts** group (five charts, each a boundary around its own lazy chunk), a **Documents** group
  (DocumentPreview, ImageViewer, Paper, Reader), a **Maps** group (MapView, PlaceSearch,
  LocationLabel on Leaflet with Geoapify proxied), the KPI pieces and the record display parts in
  Display, and the pickers, the upload engine, SignatureField, RichTextField, VoiceField and Tick in
  Forms. The contract gained one `sort` key per list, allow-listed, with `orderBy()` building the
  ORDER BY from the repo's own map. Both apps' `components/` folders are deleted, `LEGACY` and §7 are
  empty, and the F4 exemption list is gone: 804 arbitrary values converged onto the named scales and
  the last 10 inline styles became shared components (SplitPanes, Confetti, Waveform, Swatch,
  ShareBar), because an app may not write `style` at all. The mailbox composer is on the shared
  editor instead of its own `contentEditable` on the deprecated `execCommand`. The celebration card,
  the rich text body, the timeline rail and the disclosure marker moved from the staff app's
  stylesheet into the package's base.css, which cut it from 90 lines to 54. The screen gates closed
  the last of it: the map's drawing holds no focus at all now (Leaflet's keyboard panning, focusable
  markers, zoom control and Leaflet link are off and the zoom buttons are ours, outside the hidden
  part), a list's pages are a landmark named after that list, a board's stages are a screen's second
  level, and the file input sits out of the reading order behind the words a person presses. 663
  tests green in the package; the whole `npm run ci` green.
  Left: the Geoapify proxy routes are backend work (attendance, worksites), so the maps run against
  the paths `maps/geoapify.ts` names; voice input needs the M2 transcription route; and screens
  adopt server sort as their modules' contracts name their sortable fields.
- 15/10/2026 · TB · PR 2 (Shell) done. A Shell group in `packages/ui` (15 components: Brand,
  StagingBar, ComingSoon, PublicPage and PageMessage, DesktopShell, PhoneShell, Rail, TopBar and
  SearchButton, PhoneHeader, BottomBar, MoreSheet, FloatingButton, CommandPalette, NotificationRow,
  ShellNotice) and the environment and delivery plan as one copy in `lib/`. The staff app's shell is
  rebuilt on it and leaves the F4 exemptions: the rail and top bar; the phone top bar (the pin;
  search, bell, avatar) over a title rail that slides away; the bottom bar (F16), More (F17) and the
  floating button (F18, `useScreenAction`, Hide Here, a scrim behind the fan); ⌘K search; the bell
  on realtime; sign-in, sign-out and the in-place session sheet; the PWA's update notice, Install
  App and the second-visit banner, and the offline page. Both apps open screens by F14 (production
  at all three ticks, staging at API, the switch only on the mock). The public site runs on
  PublicPage, PageMessage, ComingSoon and the sticky StagingBar. `/gallery/` is served on the staff
  host everywhere but production. The a11y gate crawls every app screen too; the screens' own axe
  findings (heading order, contrast on selected rows, scroll regions, a nested button, table
  headers, ARIA attributes) are fixed. `npm run new:screen` adds a screen everywhere it is listed.
  Left: screens adopt `useScreenAction` for the fan's New action as their PRs touch them; presence
  waits for M1 chat on the server; the release pipeline (GE) must carry `packages/ui/dist-gallery`.
- 15/10/2026 · TB · PR 1 (Ground) done. `packages/ui` holds 87 components with headers, tests and
  gallery pages; `docs/COMPONENTS.md` is generated; both apps import every Ground part from
  `@mycity/ui` and their copies are gone. Merged with #20 (screen conventions): its screens and copy
  stay, and `@mycity/ui` takes its API where the screens use it (one `useContractForm(initial,
  rules or schema)`, `Button busy`, `Wizard` steps `{title, body, check}`, `CardHeader help` and
  `record`, `PageHeader help`). Gates 8 and 11 crawl the gallery and all 86 app screens; `npm run ci`
  green bar the guides line, which the PR body carries. Left for PR 2 and PR 3: the §7 files.
- 15/10/2026 · TB · Playbook written; decisions F1 to F24 agreed; PR 1 started.

---

## 7 · Components still in the apps, and where they go

**None. Both folders are gone.**

PR 3 moved the last of #18's own components into `packages/ui` and deleted
`app/src/components/` and `public-app/src/components/`. Every shared component
a screen uses now comes from `@mycity/ui`, is listed in `docs/COMPONENTS.md`,
and has its header, test and gallery page.

`LEGACY` in `scripts/check/components.js` is an empty list, and the check
around it stays: a file that appears in either folder again fails the build,
and so does a feature that declares a component with a shared name. A missing
component is added to `packages/ui` with `npm run new:component` (F11).

| File | Holds | Moves in |
|---|---|---|
| _(none)_ | | |

What moved, and what it became (the new name first, so the §7 check above sees
an empty table and not this history):

| Now in `@mycity/ui` | Came from |
|---|---|
| `DataView` (F20), `Pager`, `Toolbar`, `LoadingRows` | `ui/Table.tsx` |
| `KpiCard`, `StatStrip`, `Timeline`, `Bars`, `Chain`, `Accordion`, `TapList`, `Tile`, `Result` | `ui/data.tsx` |
| `AreaChart`, `DonutChart`, `BandChart` (with `BarChart` and `Sparkline`, new) | `ui/charts.tsx` |
| `Kanban` (F19) | `ui/Board.tsx` |
| `Calendar` | `ui/Calendar.tsx` |
| `Paper`, `PaperLogo`, `PaperTitle`, `PaperTable`, `PaperFoot`, `Signature` | `ui/Paper.tsx` |
| `ProfileHeader`, `BackButton` | `ui/Profile.tsx` |
| `Reader`, `ArticleBody` | `ui/Reader.tsx` |
| `Sub` | `ui/layout.tsx` and the public site's `ui.tsx` |
| `PersonPicker` on `RecordPicker` | `form/PersonPicker.tsx`, with the app's own `EmployeePicker` wiring |
| `UploadField` on `lib/upload.ts` | both apps' `form/Upload.tsx`, with each app's own `upload` |
| `SignatureField` | the public site's `SignaturePad.tsx` |

`Soon` and `TextLink` were not moved: PR 2's `ComingSoon` replaced `Soon`, and
nothing used `TextLink`.

`app/src/features/shared/sections.tsx` keeps `PagedTable` and `ExportButton` as
thin wrappers that bind `DataView` and `@mycity/ui`'s `ExportButton` to this
app's endpoints; the table itself is no longer its own.
