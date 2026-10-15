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
| 3 | **Build kit** | DataView, KPI card, charts, kanban, calendar, timeline, pickers, upload, rich text editor, PDF preview, voice input, maps; every remaining component of #18 moved into `packages/ui` |

**Done**, for the foundation: every component a screen uses lives in `packages/ui`, is listed in
`docs/COMPONENTS.md`, has a test and a gallery page, and passes every gate; `app/src/components/`
and `public-app/src/components/` are empty; both apps build, typecheck, lint and test in
`npm run ci`.

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
| F6 | **Motion is native.** Bottom sheets slide with a spring and close by dragging down (Vaul over Radix Dialog); toasts and popovers fade briefly; everything is instant under reduced motion |
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
- [ ] `packages/ui` (`@mycity/ui`): ESM, TypeScript strict, source consumed by both apps; Vitest with jsdom; its own ESLint config, which both apps extend
- [ ] Root npm workspaces `packages/*`, `app`, `public-app`; one root lockfile (the apps' own lockfiles removed)
- [ ] Vite in both apps resolves `@mycity/contract` (CommonJS) to one Zod instance (F15)

**Design system**
- [ ] Tokens (F3), density (F5), base styles, Geist, Tailwind 4 theme, reduced motion
- [ ] `cn`, formats (day-first dates, money from strings, counts), `useIsPhone` (760 px), theme and density per person, `data-ui` slot names the gates read
- [ ] Primitives: Button, IconButton, Icon (Lucide), Card, PageHeader, layout (Stack, Inline, Grid, PhoneOnly, DesktopOnly), Pill, StatusPill, Avatar, Who, CountBadge, KeyValue, Banner, EmptyState with illustrations, EmptyValue, Skeleton, Spinner, ProgressBar, Meter, Kbd, Money
- [ ] Navigation primitives: Tabs, SegmentedControl, Chips
- [ ] Overlays (F6, F7): Modal (centred on desktop, a bottom sheet on a phone, full-screen sheet for long forms), SidePanel, ConfirmDialog and `useConfirm`, Popover, Menu (an action sheet on a phone), Tooltip
- [ ] Help: HelpTerm, InfoButton, Details (FRONTEND_GUIDE §5.2)
- [ ] Toast (one API, word limit, Undo)
- [ ] Form system (FRONTEND_GUIDE §8): `useContractForm`, Form, Field, TextField, PasswordField, NumberField, DateField, DateRangeField, TimeField, MoneyField, PhoneField, SelectField, ChoiceField, CheckboxField, SwitchField, Switch, TextAreaField, SearchInput, OtpField, FormFooter, FormError, Wizard, InlineInput and InlineSelect
- [ ] Data client core: one `ApiError`, the typed call, `useApi`, `usePaged`, `useInfinite`, `useMutation`, `invalidate`, shared by both apps

**Catalogue and gallery**
- [ ] `npm run gen:components` → `docs/COMPONENTS.md`; `npm run new:component` scaffolder
- [ ] Gallery app (`npm run gallery`), every component in every state, both themes, both densities

**Apps moved onto it**
- [ ] `app/` and `public-app/` import every Ground component from `@mycity/ui`; their copies deleted
- [ ] Remaining #18 components listed in §7 with the PR that moves them

**Gates**
- [ ] `components` (F8), `palette` (13), `contrast` (14), native dialogs (16), upload (18), `mock-free` release build (F12), `a11y` (axe on the gallery)
- [ ] Screen gates crawl the gallery; the demo only when touched (F23); `packages/ui` covered by gates 8, 12, 17
- [ ] Frontend typecheck, lint, test and build in `npm run ci`; the Stop hook runs the screen gates when `packages/ui/` changes

**Documents**
- [ ] This playbook; FRONTEND_GUIDE, CLAUDE.md, README, PR template, CODEOWNERS, PROGRESS brought into line

### PR 2 · Shell

- [ ] Staff shell on `packages/ui`: desktop rail and top bar; phone top bar, bottom bar (F16), More sheet (F17), floating button (F18)
- [ ] Sign-in, session (access token in memory, refresh cookie), sign-out, session expiry
- [ ] Permission-aware navigation from `/me` grants; routes by the one URL shape (`/<module>?tab=<tab>&id=<id>`)
- [ ] Command palette (⌘K) and search; notification bell; realtime (Socket.io) for the bell and presence
- [ ] PWA: install, update prompt, offline shell page
- [ ] Theme, density and staging bar; what opens where (F14)
- [ ] Public site shell on `packages/ui`
- [ ] Gallery served on staging only (F10): `src/http/static.js` refuses `/gallery` on production; release builds it
- [ ] The app as a gated crawl target (gates 8, 11, a11y) on mock data in CI; `npm run new:screen`

### PR 3 · Build kit

- [ ] DataView (F20): table on desktop, card list on a phone, the pager, server sort, selection and bulk actions, Export; `sort` in `listQuery` (contract, with GE)
- [ ] KPI card and KPI grid, StatStrip, the KPI detail sheet
- [ ] Charts (lazy): area, bar, donut, bands, sparkline; two palettes (MILESTONES §5.2), legible in both themes
- [ ] Kanban (F19), Calendar, Timeline, approval Chain, Accordion
- [ ] Pickers: PersonPicker, RecordPicker (server search, 25 per page); upload engine with progress (gate 18); SignatureField
- [ ] Rich text editor, PDF and document preview, Reader, voice input (A18), Profile header
- [ ] Maps (F21): MapView, PlaceSearch, LocationLabel
- [ ] `app/src/components/` and `public-app/src/components/` empty; §7 cleared

---

## 5 · Questions asked per PR

**PR 1 · Ground** (15/10/2026, TB)

1. How much styling may a feature write? Tokens only, gated (F4).
2. Desktop density? Compact by default, Comfortable by choice (F5).
3. How should a phone feel? Native, drag to dismiss (F6).
4. Where does the gallery live? Staging only (F10).

**PR 2 · Shell**: _asked at the start of its session._

**PR 3 · Build kit**: _asked at the start of its session._

---

## 6 · Progress

| PR | Status | Branch · PR | Updated |
|---|---|---|---|
| 1 Ground | In progress | `claude/nifty-ptolemy-4fb7gz` | 15/10/2026 |
| 2 Shell | Not started | | |
| 3 Build kit | Not started | | |

**Notes** (newest first; date · initials · what was done · what is left)

- 15/10/2026 · TB · Playbook written; decisions F1 to F24 agreed; PR 1 started.

---

## 7 · Components still in the apps, and where they go

Each #18 file below stays where it is until the PR named beside it moves its components into
`packages/ui`; nothing new may be added beside them (`check/components.js` refuses a new file in
`app/src/components/` or `public-app/src/components/`). PR 1 moved the form system, overlays,
feedback, help, layout and the basic display parts; what is left moves in PR 2 and PR 3.

| File | Holds | Moves in |
|---|---|---|
| `app/src/components/ui/StagingBar.tsx` | staging bar | PR 2 (shell) |
| `public-app/src/components/Layout.tsx` | Page, Brand, Message, demo strip | PR 2 (public shell) |
| `public-app/src/components/Planned.tsx` | Coming Soon page | PR 2 (public shell) |
| `public-app/src/components/StagingBar.tsx` | staging bar | PR 2 (shell) |
| `app/src/components/form/index.ts` | the barrel for PersonPicker and Upload | PR 3 (pickers, upload engine) |
| `app/src/components/form/PersonPicker.tsx` | PersonPicker | PR 3 (pickers) |
| `app/src/components/form/Upload.tsx` | Upload | PR 3 (upload engine) |
| `app/src/components/ui/Board.tsx` | Board | PR 3 (kanban) |
| `app/src/components/ui/Calendar.tsx` | Calendar | PR 3 (calendar) |
| `app/src/components/ui/charts.tsx` | AreaChart, Donut, Bands | PR 3 (charts) |
| `app/src/components/ui/data.tsx` | Kpi, StatStrip, Timeline, Bars, Chain, Accordion, TapList | PR 3 (display) |
| `app/src/components/ui/layout.tsx` | Sub | PR 3 (display) |
| `app/src/components/ui/Paper.tsx` | documents | PR 3 (PDF and document preview) |
| `app/src/components/ui/Profile.tsx` | 360 header | PR 3 (profile header) |
| `app/src/components/ui/Reader.tsx` | articles | PR 3 (reader) |
| `app/src/components/ui/Table.tsx` | Table, Pager, Toolbar, LoadingRows | PR 3 (DataView) |
| `public-app/src/components/form/index.ts` | the barrel for Upload | PR 3 (upload engine) |
| `public-app/src/components/form/Upload.tsx` | Upload | PR 3 (upload engine) |
| `public-app/src/components/SignaturePad.tsx` | SignaturePad | PR 3 (signature field) |
| `public-app/src/components/ui.tsx` | Sub | PR 3 (display) |

`app/src/features/shared/sections.tsx` (`PagedTable`, `ExportButton`) is not in a components folder,
but its table pieces move with `Table.tsx` in PR 3 (DataView).

The authoritative list is `LEGACY` in `scripts/check/components.js`. This table mirrors it row for
row, and `check/components.js` fails when the two differ.
