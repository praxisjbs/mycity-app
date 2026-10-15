# MyCity App ERP · Frontend Guide

**Read this before writing any frontend code, whether you are a person or an AI.** It covers both
React apps: the staff app (`app/`, `hub.mycityapp.io`) and the public site (`public-app/`,
`go.mycityapp.io`).

Status: **the rules here are settled; the foundation sections (§9) are filled in by the frontend
foundation owner, AJ (Adole Jerome),** as the shell, tokens and shared components land. Started 13 October 2026 from
MILESTONES §1.1, §3 and §17 and the 12 October internal meeting. If something here is wrong or
missing, fix the guide in the same PR as the code.

---

## 1 · Before you write anything

1. **Find the screen** in `docs/PROGRESS.md` and read its feature guide in `docs/guides/`.
2. **Look at it in `docs/MyCity-ERP-Documents/demo.html`.** The demo is the visual reference for
   layout, components and look. It is **never** a source of data, field names, rules or numbers;
   it contradicts the documents in places and that is accepted. The contract and the guides win.
3. **Check the shared components** (§9) before building one. A second table, modal, pager or date
   picker is a defect.

---

## 2 · Stack

React 18 · Vite · TypeScript · Tailwind with shadcn/ui role tokens · Geist (one family) · PWA on
the staff app only. Two separate builds: the public site never imports from the staff app
(A9: a different origin shares no cookie, storage or service worker).

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
  pager reads `page`; show the true total ("312 employees"), never "showing 25".
- **Search and filters go to the server** (`q` and the list's filter params). Never filter or sort
  the 25 rows you have and present the result as the whole list: that is the praxis-ls bug where a
  search said "no results" for records on page 4.
- Infinite scroll on mobile is the same API: fetch `page + 1` when `has_next`.
- Never fetch "all" of anything to build a dropdown. Pickers search the server and show the first
  page.

---

## 5 · What the screen carries (gate 8, the five-second rule)

A page carries what a person needs to act. Everything else is one tap away.

- **Long text goes behind an icon button.** Explanations, help, policy wording and long
  descriptions sit behind an ⓘ (or similar icon button) and open **inline, below**, as on
  praxis-ls. Never a paragraph of prose on the page.
- The ⓘ is a **sibling** of what it explains, never a child of its `<label>` or heading, and the
  text stays in the DOM, visually hidden, linked with `aria-describedby`.
- Chrome is Title Case. No em dashes or double dashes in copy (gate 17).
- Guidance notes in the demo (blocks that explain what a button will do) are build notes for us.
  They do not ship.

---

## 6 · Formats

| What | Rule |
|---|---|
| Dates | Day-first wherever a person reads one: `13/10/2026`. Never `<input type="date">`; never `toLocaleDateString()` without a locale (gate 15) |
| Money | `₦1,250,000.00`, right-aligned, tabular figures; `₦1.3M` only on KPI tiles. Negative: minus sign, colour **and** label, never colour alone |
| Colour | Only the brand tokens (MILESTONES §5.1, §5.2). No raw hex (gate 13). AA contrast in both themes (gate 14) |

---

## 7 · Two shells: desktop and mobile (gate 11)

Mobile is a native-feeling app, not the desktop squeezed. Desktop is desktop software. A route
that ships one layout scaled fails the gate.

- **Mobile navigation is icons along the bottom**, not the desktop sidebar. Thumb-reachable,
  icon-first, short labels.
- **Less text on mobile.** Icons over words wherever an icon is clear. The screen is small; text
  that is fine on desktop becomes a wall on a phone.
- Desktop: dense tables, keyboard navigation, multi-pane where it helps.
- Some desktop-only detail (an extra KPI card, a secondary column) may be left off mobile. Decide
  it per screen in the feature guide, not ad hoc.
- A dedicated mobile design is being prepared for the prototype; until it lands, follow these
  rules and the demo's mobile breakpoints.

---

## 8 · Behaviour

- **No native dialogs** (`alert`, `confirm`, `prompt`; gate 16). Use the shared modal or sheet.
- **One modal component** (and one sheet for mobile), used everywhere. A "new" or "edit" action
  opens it.
- **Inline validation** as a field is filled (gate 12): a mark on the field, never a sentence
  under it on submit, never a dialog.
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
    lib/                      cn, format (dates, money, counts), media (useIsMobile), theme, router
    api/
      client.ts               fetch, bearer token in memory, one refresh retry, ApiError
      endpoints.ts  hooks.ts  typed endpoint map; useApi, usePaged, useInfinite, useMutation, invalidate
      types/<module>.ts       INTERIM wire shapes, one file per module, until contract.gen.ts lands
      mock/                   the in-browser mock API (mode mock only): core, data/, modules/<module>.ts
    auth/                     AuthProvider (useAuth, useMe), Login
    shell/                    catalogue (modules and tab slugs), access, screens (lazy per module),
                              Shell (desktop rail and mobile bar), Nav, CommandPalette, Bell, UpdatePrompt
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
    components/               Layout (Page, Brand, Message, demo strip), ui (Button, Field, Input,
                              Textarea, Pill, Notice, Loading), Upload (the only file input),
                              SignaturePad (canvas, paper-coloured in both themes), Icon
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

All in `components/ui/`, Tailwind only, no component library:

| File | Gives |
|---|---|
| `Button.tsx` | `Button`, `IconButton`, `BigButton` |
| `layout.tsx` | `Card`, `CardHeader`, `PageHead`, `Grid`, `MobileOnly`, `DesktopOnly` |
| `data.tsx` | `Pill`, `Avatar`, `Who`, `Kpi`, `KV`, `StatStrip`, `Timeline`, `Bars`, `Mini`, `Chain`, `Accordion`, `Banner`, `EmptyState`, `TapList` and others |
| `Table.tsx` | `Table`, `Pager`, `SearchBox`, `FilterSelect`, `Toolbar`, `Chips`, `LoadingRows`, `ErrorBlock` |
| `Modal.tsx` | the one modal (`useModal`); a bottom sheet on a phone, full screen with `full` |
| `form.tsx` | `useForm` (inline validation, server 422 fields), `Field`, `Input`, `Textarea`, `Select`, `Seg`, `Switch`, `ToggleRow` |
| `DateField.tsx` | day-first date entry with a picker; never `type="date"` |
| `Money.tsx` | `Money` (₦ with kobo, from the string), `AmountInput` |
| `Upload.tsx` | the only file input: progress per file; `trigger` for a composer button |
| `Info.tsx` | the ⓘ toggle and its text |
| `Menu.tsx`, `Toast.tsx`, `PersonPicker.tsx`, `Board.tsx` (drag between columns), `Calendar.tsx`, `charts.tsx` (`AreaChart`, `Donut`, `Bands`), `Paper.tsx` (documents), `Profile.tsx` (360 header), `Reader.tsx` (articles) | |

`features/shared/sections.tsx` adds the screen-level blocks: `PagedTable` (server page, search,
pager), `KvCard`, `ChainCard`, `BarsCard`, `TrailCard`, `StatusPill`, `ExportButton`, `ModalFoot`.

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

## 11 · Done means

- [ ] Built against the real API through the contract; no mock data left in components
- [ ] Every list uses the shared pager, sends `page` only, shows the true total
- [ ] Desktop and mobile shells both built
- [ ] Long text behind ⓘ; no prose walls; Title Case; no dashes
- [ ] Day-first dates, formatted money, brand tokens only
- [ ] No native dialogs; inline validation; upload engine
- [ ] `npm run ci` green, the whole suite, before pushing
- [ ] Pushed as a branch, PR opened with the template filled in; CI green on the PR
- [ ] `docs/PROGRESS.md` row ticked (UI, Mobile) and a note left
- [ ] The feature guide in `docs/guides/` matches what was built

Engineered by JBS Praxis.
