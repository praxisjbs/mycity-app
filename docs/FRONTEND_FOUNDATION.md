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

## 3 · Decisions (15/10/2026, TB; F25 and F26 added 18/10/2026; F27 to F29 added 20/10/2026; F30 added 21/10/2026; F31 added 25/10/2026; F32 added 28/10/2026)

| # | Decision |
|---|---|
| F1 | **One design system for both apps**: the workspace package `packages/ui` (`@mycity/ui`). The public site imports it, never `app/` (A9 holds: no app imports the other app). No component, token or helper is copied between apps |
| F2 | **Today's agreements are the source of truth** over #18 where they differ. #18's screens are kept and moved onto `packages/ui`; its component and hook APIs are kept where they serve, upgraded underneath |
| F3 | **Tokens are MILESTONES §5.1 and §5.2.** Values the demo added that MILESTONES lacks (subtle ink, paper tones, status tints) stay as derived tokens, each listed with its contrast ratio. Gate 14 checks every text pair in both themes. Since F30 (21/10/2026) the dark block is the contract's `deriveDark()` of §5.2's four colours, and a palette saved on Settings · Appearance replaces it at run time, held to the same pairs as it is saved |
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
| F25 | **Nothing the browser styles itself** (added 18/10/2026). No native select or phone picker, no browser date, number, checkbox or radio input, no `title` tooltip, no validation bubble, no toast styled by a library: every control, list, tooltip and message is a `packages/ui` component in the brand's tokens, on both shells. A select is `SelectMenu` (a Radix listbox on desktop, a bottom sheet on a phone); a hover label is `Tooltip`; `base.css` resets what the browser would still draw. Gate 21 (`check/native-ui.js`) holds it in source and on every rendered screen, `packages/ui` included, with no exemptions (FRONTEND_GUIDE §8.8) |
| F27 | **Addresses are picked, never typed** (added 20/10/2026, TB). Every address or location a person enters, in both apps, on production and staging, is an `AddressField` (a `PlacesField` for a list of cities), with no free-text mode: suggestions from the second character, about 100 ms after the last key, held on the device so retyping is instant; a pick, a pin on the map, or, while address search is down, the device's current location. The API accepts only a place our search or pin signed (`PlaceInput`); the Details line (house number, flat, directions) is the only free text. Gate 22 (`check/addresses.js`) holds the screens and the contract to it (`docs/guides/addresses.md`, FRONTEND_GUIDE §8.9) |
| F26 | **One press, one request** (added 18/10/2026). A button answers the moment it is pressed. Its handler hands back the work (a promise), and the button is busy until that settles: its own colour and label, softened, with a spinner where its icon was (centred over the label when it has none, so its size never changes), and a second press refused at once, before the screen redraws. The buttons beside it wait with it (a modal, a form, a form footer, a card or page header, a shell notice, or an `ActionGroup`), and a modal cannot be dismissed mid-save. Busy stays focusable and named (`aria-busy`, `aria-disabled`), never `disabled`. A `Form` refuses a second submit while its save runs. The lint rule `mycity/no-void-press` refuses a handler that throws its work away (`() => void save()`) on `Button`, `IconButton`, `BigButton`, `Form`, `Wizard`, `ConfirmDialog` and `ExportButton` (FRONTEND_GUIDE §8.4, §9.4) |
| F28 | **Refresh in place, reload on purpose** (added 20/10/2026, TB; the hub only). Refresh asks every read on the screen again where it is: scroll, filters, the open record and anything typed stay, nothing turns back into a skeleton, and it ends when the last read lands (the data client's `refresh`). **Phone:** pull down at the top of the page, the Pin Drop. The pin drops in a disc under the header while a yellow ring fills; at 64 px the ring closes and the pin lands (a tick on Android), and letting go refreshes, the ring spinning until the reads are in. Pulled on past 136 px the disc turns Deep Green with the reload mark, and letting go restarts the app on the same screen (two depths). The pull only listens and never holds up scrolling: it starts only when the page and every list under the finger are at their top, after a clear move down, never on a fit page (Chat, Mailbox) or over anything marked `data-pull="off"` (a map, the signature pad, a document), and the hub turns the browser's own pull off. **Desktop:** the refresh button at the start of the top bar, the Hold Ring: a click refreshes, its arrow turning until the reads are in; held, a yellow ring closes around it in 0.6 s and the app reloads; Shift and Enter reload from the keyboard. Refresh shows in a browser tab as well as in the installed app. A reload hands over to a waiting new version; F5 and Ctrl R keep the browser's own full reload. ⌘K offers Refresh Screen and Reload App (FRONTEND_GUIDE §7, §9.5) |
| F29 | **Back and forward, one history** (added 20/10/2026, TB; the hub only). The window's own history is the only record of where a person has been, so Android's Back, the iPhone's edge swipe, a mouse's side buttons, Alt and an arrow key, and the hub's own controls always agree. A new screen, tab or opened record (`id`) is a step; filters, search, sort and the page change that step in place, so Back returns to a list as it was left. On a phone an open sheet, page, menu, search or viewer takes a step of its own, so Back closes it first; one holding unsaved work asks, as Esc does. Each device keeps its own trail, never sent to the server or shared with the person's other devices: the installed app reopens where they were, Back still working, when they left it within the last 12 hours, and Sign Out wipes it. **Desktop, installed app only:** back and forward join the refresh button in one capsule at the start of the top bar; hovering an arrow names where it goes; holding an arrow, right clicking it or holding the pin opens the trail, the last 8 places and the 1 ahead, to jump straight to one. **Phone:** no back button. Android's Back and the iPhone's edge swipe go back, and in the installed app holding the pin opens the trail as a sheet. A browser tab keeps the browser's own back and forward (FRONTEND_GUIDE §7, §9.2) |
| F30 | **Appearance is configurable, in the hub, within AA** (added 21/10/2026, TB, after the Milestone 1 handover). Settings · Appearance sets the hub's dark palette from four pasted colours (Background, Card, Brand Green, Primary Yellow); every other dark token is worked out by fixed maths in the contract (`packages/contract/schemas/appearance.js` `deriveDark`), never by a model, each ink lightened and tint darkened until every pair keeps 4.5:1, and a colour no nudge can save refused on its field. Presets: Deep Green (§5.2, shipped), Charcoal, Black, Dark Grey. Two fonts (heading, body) from a vetted self-hosted list; the theme and density a person starts on. Each person's Text Size (Small to Largest) on their device. Saved by `settings` edit after a fresh sign-in, audited, with Restore Previous; a live preview first. The light theme, corner radius, the public site, documents and email do not change. Raw hex stays out of source (gate 13): a palette is data, applied by `lib/appearance.ts` (`docs/guides/foundation.md` §6.15) |
| F31 | **A record opens in a sheet, never below its list** (added 25/10/2026, JBS Praxis, from a phone screenshot of People · Leave with the request's card under the list). **Phone:** a list fills the page and a tapped row opens its record in a bottom sheet (the shared `Modal`, `full` for a payslip, a letter or a document), which drags down, Esc and Back close; nothing opens until a row is tapped, so a screen's first pick never shows unasked, and a record never sits in the page under, over or beside its list. **Desktop:** the list and the record stay side by side; where two columns do not fit (761 to 1180 px) the record opens in the centred dialog. A record the desktop layout places elsewhere (under the list beside a chart, above it) stays there on desktop and is a sheet on a phone. Enforced three ways: `ListDetail` and `DetailPane` in `packages/ui` are the only way a screen pairs a list with the record it opens (`useSideBySide` says when a first pick may show); gate 11 (`check/two-shells.js`) taps each phone screen's first two rows and fails one whose record lands in the page, with no exemption; and this rule in FRONTEND_GUIDE §7 and CLAUDE.md. A record with its own screen (an `id` route) and a reader that fills the screen (SplitPanes: the mailbox, chat, Roles) are not affected |
| F32 | **A select's server list loads as it scrolls** (added 28/10/2026, JBS Praxis, from Performance · Goals, whose Function select read one page of departments and so could never offer a 26th). A select whose options come from a server list (departments, quarters, functions, seats, roles, letters, KPIs, partners, categories, vacancies, candidates and the rest) reads them 25 at a time with `useInfinite` and passes `SelectMenu` `more` and `onMore`, through `SelectField`, `FilterSelect` or `InlineSelect` (`paging(list)` in the hub's `features/shared/wire.ts`). The next page loads as the menu nears its end, whether scrolled or moved through with the keys, and at once when it opens too short to scroll, on both shells; a spinner row ends the list while more wait, hidden from assistive technology. It looks as it did: no search box, no new control. A saved value on a page not loaded yet reads as itself (`valueLabel`). Never one page cut short, never every page fetched before the menu opens (FRONTEND_GUIDE §4). The pickers keep their server search and first 25 matches |

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
4. How is a document previewed? **PDF.js, in its own chunk** (changed 19/10/2026, TB): every page
   of a PDF is drawn in the app, the same on Android, an iPhone and desktop, by `PdfViewer`, whose
   PDF.js part loads only when a PDF is first opened (F22). Until then the answer was the browser's
   own viewer, a PDF in an `<object>`; Android's browser cannot draw a PDF inside a page, and the
   app's security policy (`object-src 'none'`) blocked the `<object>` on staging and production for
   every browser. An **image viewer** sits beside it for pictures; `DocumentPreview` draws both,
   with Open in Tab, and `MediaViewer` opens photos, videos and PDFs full screen with Download and,
   on a phone, Share. Every screen that opens an uploaded file uses them (TB, 19/10/2026): a photo,
   a video or a PDF opens in `MediaViewer` (the staff app binds it to its session in
   `features/shared/files.tsx`) and anything else downloads. Our own generated documents keep
   rendering through `Paper`.

**F26 · One press, one request** (18/10/2026, TB)

1. How does a working button look? **Its own colour and label, softened, with a spinner where its
   icon was**, so the brand yellow stays yellow and the button keeps its size. Grey was turned down:
   it drops the brand colour and looks the same as a disabled button.
2. What else waits while it works? **Its group**: the buttons beside it in the same modal, form
   footer, card or page header or shell notice, and the modal's own close button, Esc, scrim and
   drag. The rest of the app stays usable. Not only the pressed button (Approve could race Reject,
   Cancel could close a dialog mid-save), and not the whole screen (one slow request would freeze it).
3. How does it stay true as screens are added? **Automatically, with a lint gate**: the button
   watches the promise its handler hands back, the 91 handlers that threw it away were converted, and
   `mycity/no-void-press` refuses the pattern from now on, inline or in the local function a button
   names.

**F30 · Appearance** (21/10/2026, TB). Twelve questions after the Milestone 1 handover, where Edidiong
Etudor and Cynthia Osakunih asked for the dark theme off its green background, with samples first.

1. What does a Daily Attendance report do about Absent, when the day closes at 01:30? **A Day
   choice**: Today So Far (Not In, never Absent) or Last Working Day (closed, so Absent is real). Not In
   counted as Absent after the shift, and always the last closed day, were turned down.
2. One status or several? **Several**, ticked; none is everyone.
3. What ships, given samples were asked for? **Samples in an HTML file, and the palette configurable**,
   so the one MyCity accepts is pasted on Settings · Appearance.
4. Which colours are pasted? **The dark theme's only, everything else derived; the light theme stays**.
5. Derived how? **Code, no AI**: the same answer every time, contrast proven on every save.
6. Which four? **Background, Card, Brand Green, Primary Yellow**.
7. A pasted colour that fails contrast? **The derived shades are nudged and listed**; a pasted one that
   cannot be saved is refused on its field.
8. Record it against A8, §5.2 and F3? **Yes**, as TB's decision of 21/10/2026.
9. Who changes it? **`settings` edit, audited**, after a fresh sign-in, with Restore Previous; no
   approval chain.
10. How is it seen first? **A live preview, then Save**.
11. What do the samples show? **Home in four presets**: Deep Green, Charcoal, Black, Dark Grey, each
    with its four codes.
12. Where does it apply? **The hub only**. Then, asked for: fonts from a **vetted self-hosted list for
    everyone** (heading and body); **the organisation's default theme and density, and each person's
    Text Size**; corner radius **kept fixed**; **one dark palette for everybody**.

**F31 · A record opens in a sheet** (25/10/2026, JBS Praxis). Four questions, from a phone screenshot
of People · Leave, where tapping a request put its card under the list.

1. What shape does a record take on a phone? **A bottom sheet**: the shared Modal's phone form, which
   slides over the list, drags down to close and grows to full height for a long record. A full-screen
   page with a back arrow, and a centred dialog, were turned down.
2. What happens on desktop? **The list and the record stay side by side**; only the phone changes. A
   first pick may still show beside the list on desktop, never on a phone. A modal everywhere and a
   slide-over panel were turned down.
3. How is it enforced? **A shared component, a screen gate and a written rule**: `ListDetail` (with
   `DetailPane`) in `packages/ui`, gate 11 tapping rows at phone size, and F31 here, in FRONTEND_GUIDE
   §7 and in CLAUDE.md. Banning rows that expand in place was not asked for.
4. How far does it go? **Every screen now**, in one pull request, so the gate passes from its first
   day: People · Leave, ESS · My Payslips, Payroll · Payslips, Partnerships · Proposals, Queries and
   Letter Templates, Recruitment · Candidates, Interviews, Offers and Onboarding, and Expenses · My
   Requests, Approvals and Requisitions.

**F32 · A select's server list loads as it scrolls** (28/10/2026, JBS Praxis). Asked from Performance ·
Goals: is the Function select fed by People · Departments, and does a new department appear there by
itself? It is, and it does, but only within the first page of 25, retired departments counted.

1. How far does it go? **Every select filled from a server list**, about thirty across Performance,
   People, Home, Queries, Settings, Recruitment, Partnerships, Expenses and the Knowledge Hub. Goals
   and KPIs alone, and the department selects alone, were turned down.
2. How does a person reach the 26th? **The menu loads the next 25 as it nears its end**, looking as it
   does today. A search box in the menu (always, or past 25 options) and a new popover were asked
   about and set aside; loading every page before the menu opens was turned down, since FRONTEND_GUIDE
   §4 forbids it, and so was leaving it until the count nears 25.
3. Do the pickers change? **No**: PersonPicker and RecordPicker keep their search and their first 25
   matches.

**F28 and F29 · Refresh and history** (20/10/2026, TB). Eight questions, each asked with a live design
board of the options (pull them, hold them), for the hub only, production and staging alike.

1. What does a pull do on a phone? **Two depths**: a short pull refreshes in place; pulled on past a
   second notch, the pin turns to Reload and letting go restarts the app on that screen. Refresh in
   place with Reload App kept in More, and a pull that always reloads, were turned down.
2. How does the pull look? **Pin Drop**: the pin drops in a disc and a yellow ring fills, it lands
   with a bounce at the release point and the ring spins while loading; the page stays still. A
   sliding page, the Android disc and a line under the tabs were turned down.
3. How does the desktop refresh button work? **Hold Ring**: a click refreshes, a hold closes a
   yellow ring in 0.6 s and reloads. A split button with a menu, a freshness pill and a plain arrow
   with Shift click were turned down.
4. Where do the controls show? **Back and forward only in the installed app**, where the window has
   none; refresh in a browser tab too, since it keeps the person's place where the browser's reload
   does not.
5. Where do they sit on desktop? **At the start of the top bar**, beside the menu toggle and before
   search. The window's title bar, the rail and the tab strip were turned down.
6. How do back and forward look on desktop? **One capsule** with refresh. Holding an arrow, or the
   pin, drops down the last 5 to 8 places to jump straight back to one (built as the last 8, with
   the 1 ahead).
7. How does a person go back on a phone? **Gestures only**: Android's Back and the iPhone's edge
   swipe, and holding the pin opens the trail. A chevron beside the pin, the pin turning into one,
   and a chevron on iPhones only were turned down.
8. What is one step? **A screen, a tab or an opened record**; filters, search, sort and the page
   change in place; on a phone an open sheet is a step, so Back closes it first.

---

## 6 · Progress

| PR | Status | Branch · PR | Updated |
|---|---|---|---|
| 1 Ground | Done | `claude/nifty-ptolemy-4fb7gz` | 15/10/2026 |
| 2 Shell | Done | `m0/frontend-shell` | 15/10/2026 |
| 3 Build kit | Done | `m0/frontend-build-kit` | 16/10/2026 |

**Notes** (newest first; date · initials · what was done · what is left)

- 28/10/2026 · JP · F32, a select's server list loads as it scrolls (§5's three answers; `docs/guides/foundation.md` §6.18). `SelectMenu` takes `more`, `onMore` and `valueLabel`, and `SelectField`, `FilterSelect` and `InlineSelect` pass them on: the next page is asked once per length of the list, when whatever scrolls it (the listbox, the searchable panel, the phone's sheet) nears its end or as it opens too short to scroll, and a spinner row ends it while more wait. `useInfinite` takes an optional `sort`. The hub's `paging(list)` (`features/shared/wire.ts`) binds a read to a select; every select fed by a server list moved onto it, Goals' and KPIs' Function filters now asking the server for active departments. Tests: `SelectField.test.tsx` (desktop, phone, once per length, the saved label, axe open), `createApi.test.tsx` (sort); the Server List state in the gallery. Left: Staff Community's and Policies' department chips still show one page (chips, not selects), and `GET /performance/functions` decides `may_set` row by row, so a reader whose only function sits past the first page sees None you may set until it loads (`docs/guides/performance.md` §14).
- 25/10/2026 · JP · F31, a record opens in a sheet on a phone (§5's four answers). New in the Layout group: `ListDetail` (the list beside the record from 1181 px; below that the list alone and the picked record in the shared Modal, a bottom sheet on a phone) with `DetailPane` (the record where the desktop layout puts it, a sheet on a phone) and `useSideBySide`. DataView's phone cards, TapList's rows and Kanban's cards mark the button that opens a row (`data-row-open`), and gate 11 (`lib/screens.js` `rowOpens`) taps each phone screen's first two and fails one whose record lands in the page. Thirteen views moved onto it (§5 question 4). Found on the way: Recruitment · Candidates' cards and My Payslips' phone months opened nothing (a prop the components do not take), and Also Away's status pill never showed. Left: nothing.
- 21/10/2026 · TB · F30, Appearance in the hub (§5's twelve answers; `docs/guides/foundation.md` §6.15). The
  pair table and the contrast maths moved from `tokens.test.ts` into the contract, where the dark palette is
  derived; tokens.css's dark block is now that derivation of MILESTONES §5.2's four colours, and the test
  holds them equal (popover, accent, the muted and subtle inks, the lines and the soft tints moved by a shade;
  the rail takes the card's colour in dark). New: `ColorField` (Forms), `ThemePreview` (Display), the
  `textsize` glyph, `lib/fonts.ts`, `lib/appearance.ts`, Text Size in `lib/preferences.ts` and
  `applyDefaults`, `--face-body`, `--face-heading`, `--face-paper` and `--text-scale` in tokens.css.
  `app/index.html`'s inline first-paint script was refused by the security policy on every server, so it is
  `app/public/boot.js` now. Left: other people's hubs repaint at their next sign-in or reload.
- 20/10/2026 · TB · F28 and F29, refresh and history in the hub (the eight answers in §5). The data
  client's `refresh` (quiet: data stays, `loading` stays false; settles when the last read lands) is what
  the pull, the refresh button and ⌘K's Refresh Screen run. New in the Shell group: `PullIndicator` (the
  Pin Drop, fed by `shell/pull.ts`, which only listens and starts at the top after a clear move down),
  `NavCapsule` (back, forward and the Hold Ring) and `TrailMenu` (the trail, a sheet on a phone).
  `PhoneShell` and `PhonePage` pull to refresh (the bell's pane lost its own pull); `PhoneHeader` and
  `Rail` open the trail on a held pin. New helpers: `lib/history.ts` (the window's history with one owner:
  keyed steps, `useBackClose` in `Sheet`, `PhonePage`, `CommandPalette`, `FloatingButton` and
  `MediaViewer`, whose own pushState it replaces), `lib/hold.ts` (press and hold), `useInstalled`, and the
  glyphs `rotate` and `history`. The hub's router follows the step rule, `lib/trail.ts` keeps the device's
  trail and reopens the installed app where the person was, and Sign Out wipes it. Left: real devices
  (an installed Android, an iPhone home-screen app, a Windows window) before the next demo.
- 19/10/2026 · TB · PR 3 question 4 changed (§5): PDFs are drawn by PDF.js (`PdfViewer`, its
  drawing in its own chunk, with the font and code files served from `/pdfjs/`), because the
  browser's own viewer could not draw a PDF on Android and the security policy blocked it
  everywhere else. `DocumentPreview` draws a PDF through it; `MediaViewer` (photos, videos and
  PDFs full screen, Download and Share), `MediaTile`, `FileCard`, `LinkCard` and `LinkText` join
  the kit for Staff Community's media and links (`docs/guides/community.md` §3 steps 17 and 18).
- 18/10/2026 · TB · F26, one press, one request. Reload on "A new version is ready" looked dead: no
  sign of work while the new version took over, and after a hard refresh nothing at all, because the
  PWA plugin reloads only a page a service worker controlled when it loaded. Now every press answers
  at once. `Button`, `IconButton` and `BigButton` watch the promise their handler returns (new
  `actions/press.ts`): busy from the press until it settles, a second press refused through a ref
  before React draws, the spinner where the icon was (centred over the label when there is none, so
  nothing moves), the colour kept and softened, `aria-busy` and `aria-disabled` but never `disabled`.
  New `ActionGroup` holds the buttons beside a busy one; every Modal (its own group, so a
  confirmation opened by a busy button stays answerable), Form, FormFooter, ModalFooter, CardHeader
  and PageHeader actions, ShellNotice and DataView's bulk bar is one, and a Modal refuses Esc, the
  scrim, a drag and its close button mid-save. `Form` refuses a second submit (Enter twice) while its
  save runs and spins the button that submitted it, even one outside it with `form=`; `Wizard` spins
  its last button on `onFinish`'s promise; `ConfirmDialog` uses the shared busy instead of its own.
  Reload asks the waiting version to take over and reloads on `controllerchange`, on that worker
  reaching activated (the hard-refresh case) or after 4 s, and comes back if the browser's unsaved
  work prompt keeps the page. Lint `mycity/no-void-press` (with a RuleTester test) refuses a press
  handler that throws its work away; 91 handlers in both apps were converted, and six buttons that
  disabled themselves with a busy flag of their own and swapped their label (Accept and Sign,
  Confirm Decline, Submit Application, Start the Assessment, Apply for This Role, Email All) use the
  shared busy instead; Assessment's Back and Next, and Keep Going and Submit, are groups. Left: six hand-drawn
  `<button>`s in features are not `@mycity/ui` buttons and keep their own guards (the chat composer's
  controls and the assistant's suggested questions disable or swap themselves while they send); a
  mail attachment chip can still start its download twice.
- 18/10/2026 · TB · F25 and gate 21, nothing the browser styles itself. A phone showed its own grey
  picker over the branded Create Rule sheet: `SelectField`, `FilterSelect` and `InlineSelect` were
  native `<select>`s. All three now draw `SelectMenu` (new, in Forms): a Radix listbox in our tokens
  under the button on desktop (`@radix-ui/react-select` 2.3.7, on the Radix versions already
  installed), a bottom sheet of 44 px rows with a tick on the chosen one on a phone, titled by the
  field's label (`useFieldLabelId`). Every `title` tooltip became `Tooltip`, which now passes a ref
  and props through so it can sit inside a Menu or Dialog trigger; `IconButton` draws one from its
  label; the collapsed rail names its links with it; a map marker's label is Leaflet's tooltip in our
  tokens (`map-tip`). `base.css` resets the rest (appearance, spinners, search clear, picker and
  autofill buttons, autofill tint, invalid glow, tap flash, selection, accent and caret colours); the
  Toaster styles sonner's warning, loading, description, cancel and close too. `check/native-ui.js`
  scans source and the crawl of every gallery page and app screen (402 views) with no exemptions;
  all green. Left: nothing.
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
