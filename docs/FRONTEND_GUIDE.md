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
_To be written._ Once features have folders, each feature guide's **Frontend paths** row names
them, so `scripts/check/guides.js` holds frontend changes to their guide too. New files under
`app/` and `public-app/` are mapped here rather than in the README.

### 9.2 Routing, shell and permission filtering
_To be written._ Tab slugs are the URL values in `docs/PROGRESS.md` and do not change when a label
does. The one URL shape the backend produces for a screen or a record (notification bell, task
panel, Home alerts, search, AI links) is `/<module>?tab=<tab>&id=<id>`, module key with `_` as `-`
(`src/shared/route-map.js`); the router must honour it, and `id` opens that record.

### 9.3 Design tokens and theming (light, dark)
_To be written._

### 9.4 Shared components
_To be written._ At least: app shell (desktop sidebar, mobile bottom bar), table with pager, card
list with infinite scroll, modal, sheet, ⓘ inline help, form fields with inline validation, date
field (day-first), money display, upload, empty state, toast.

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
