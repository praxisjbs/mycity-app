# Brief: Home frontend (Overview, Team, Alerts, Reports) on the real API

Read-only survey of `/home/user/mycity-app` on 17/10/2026. Everything below is quoted from the
repo or marked **PROPOSAL** (a shape the frontend needs that the backend brief must agree).
Sources read in full: `docs/guides/home.md`, `docs/FRONTEND_GUIDE.md`, `docs/FRONTEND_FOUNDATION.md`
(F1 to F24), the relevant entries of `docs/COMPONENTS.md`, `app/src/features/home/*`,
`app/src/api/{client,hooks,endpoints,download,realtime}.ts`, `app/src/api/types/{home,common,identity,organisation}.ts`,
`app/src/api/mock/{index,core}.ts`, `app/src/api/mock/modules/home.ts`, `app/src/shell/{Shell,screens,access,catalogue,screen-action}.tsx|ts`,
`app/src/auth/AuthProvider.tsx`, `app/src/features/shared/*`, `app/src/features/attendance/ClockButton.tsx`,
wired exemplars `app/src/features/ess/Documents.tsx`, `app/src/features/settings/Numbering.tsx`,
`packages/ui/src/data/createApi.ts`, `packages/ui/src/form/useContractForm.ts`, `packages/ui/src/data/DataView.tsx`,
`scripts/check/{five-second,two-shells,forms,components,palette,dashes,search-coverage,pagination,mock-free,guides,a11y}.js`,
`scripts/check/lib/{copy,screens}.js`, `src/shared/search/{actions,screens}.js`, `packages/contract/schemas/{common,identity,access,workflow}.js`.

---

## 0 · State of play in one screen

- Home's four tabs are **built on the in-browser mock with INTERIM types** (`app/src/api/types/home.ts`,
  mock `app/src/api/mock/modules/home.ts`). PROGRESS rows #1, #2, #3, #86 are all `☐ ☐ ☐ Not started`
  (`docs/PROGRESS.md` line 471 to 474). UI is ticked only once the screens run on the real API.
- `packages/contract/schemas/home.js` does **not exist**; `dashboard.js`, `alerts.js`, `reports.js`,
  `kpis.js` exist but are **empty**. `contract.gen.ts` has **no** Home route.
- Real routes Home can already use: `GET /api/v1/workflow/mine` (ApprovalWaitingPage) and
  `GET /api/v1/workflow/mine/count` (`{ waiting, overdue }`, "Home's Waiting on You",
  `docs/guides/foundation.md` §4). `GET /api/v1/auth/me` (`Me`).
- `Me` has **no `capabilities`** (identity.js `Me` is `.strict()`), so decision 2 cannot be gated
  on the client until the backend adds it.
- Shell hides tabs a person cannot open and **redirects** a URL to them (Shell.tsx line 66 to 74),
  so the guide's gated state (§10.1, §11) is never reachable today.

---

## 1 · Rules that bind every line of Home UI (with the gate that enforces each)

| Rule | Source | Enforced by |
|---|---|---|
| Components only from `@mycity/ui`; a missing one is added in `packages/ui` with `npm run new:component -- --name X --group Display` (header, test, gallery page; AJ or TB approve via CODEOWNERS) | F1, F8, F11, CLAUDE.md | `scripts/check/components.js` (+ `gen/components.js --check`): no file in `app/src/components/`, no PascalCase component in `app/src` with a `@mycity/ui` component's name |
| Tokens only: token colour classes, named spacing/size scales; **no** hex, **no** arbitrary class (`w-[317px]`, `bg-[#fff]`, `[prop:val]`), **no** `style=` prop in `app/` | F4 | ESLint `mycity/no-inline-style`, `mycity/no-arbitrary-class` (regex `ARBITRARY` in `packages/ui/eslint.shared.js` line 31) and `scripts/check/palette.js` |
| Radix, Vaul, sonner, lucide-react, react-hook-form imported only inside `packages/ui`; no `zod` import / `z.object` in `app/` | FRONTEND_GUIDE §2, §3 | ESLint |
| Raw `<form> <input> <select> <textarea> <label>` only inside `packages/ui/src/form/`; no Submit/OK button; placeholder = format example of at most 3 words, never ending in `.` | gate 12 | `scripts/check/forms.js` |
| Lists: server pages of 25, send `page` (+ `q`, filters, one `sort`) only; never `limit/offset/per_page/page_size/pageSize/perPage`; never filter or sort the 25 rows on the client; the **Pager is the only place the total appears** | FRONTEND_GUIDE §4 | `scripts/check/pagination.js` (rule 4) |
| Three tiers of text; only guide §10 tier 1 open, tier 2 behind `HelpTerm`/`InfoButton`/`Details`, tier 3 never on screen; no explainer card titles (How/Why/What/When/Where/About or containing is/are) | FRONTEND_GUIDE §5 | `scripts/check/five-second.js` (gate 8) |
| Word limits (below, §9); Title Case chrome; Verb Noun buttons; no em/en dash or spaced `--` in copy | §5.3, §5.4 | gate 8, `scripts/check/dashes.js` (gate 17) |
| Two shells: phone = cards not tables, sheets, 44 px targets, ≤ 40 words of interface copy on the first phone screen, no sideways page scroll | §7 | `scripts/check/two-shells.js` (gate 11) |
| Dates: day-first via `formatDate/formatDateTime/formatWhen/formatTime`; never `toLocaleDateString()` without a locale; never `<input type="date">` | §6 | ESLint `no-date-input`, `no-bare-date-locale` |
| Money: `<Money value="1250000.00" />` (short only on KPI tiles); never parse to a float on screen | §6 | review (gate 20 `money.js` covers `src/`, `packages/`, `scripts/` only) |
| No `alert/confirm/prompt`: `useConfirm()` / `ConfirmDialog`, `toast()` | gate 16 | ESLint + `scripts/check/native-dialogs.js`; the crawl also fails a native dialog |
| Every New action (`useScreenAction({ label: "..." })`) is listed in `src/shared/search/actions.js` with the **literal** label, or the call carries `// search:none <reason>` | foundation §6.7 | `scripts/check/search-coverage.js` rule 5 |
| No mock in a release build: a feature never imports from `@/api/mock/*` | F12 | `scripts/check/mock-free.js` |
| Ported code never says where it came from (no "praxis", paths, "ported from") | CLAUDE.md step 2 | `scripts/check/provenance.js` |
| A change under `app/src/features/home/` changes `docs/guides/home.md` (+ a Change log line `- DD/MM/YYYY · XX · ...`) | CLAUDE.md step 5 | `scripts/check/guides.js` (guide header names `app/src/features/home/`) |
| New files under `app/` need no README entry (mapped in FRONTEND_GUIDE §9.1) | README §11 | `scripts/check/readme-map.js` |

---

## 2 · The current Home feature, file by file

```
app/src/features/home/index.tsx     342 loc  default export Home({ tab, id }: ModuleScreenProps); Overview, Team,
                                             Alerts (+ AlertDetail, RuleList, RuleForm), Reports (+ ReportForm)
app/src/features/home/blocks.tsx    141 loc  InfoCard, KpiRow (KpiCard grid), Block (switch on HomeBlock.type), Cell (KpiCell)
app/src/features/home/KpiDetail.tsx  54 loc  useKpiDetail(): opens modal {title: label, wide, body: <Report/>}; Report binds
                                             GET /home/kpi/:key/meta + usePaged GET /home/kpi/:key to @mycity/ui KpiDetail
app/src/api/types/home.ts           172 loc  INTERIM shapes + `declare module "@/api/endpoints"` merging 16 Home keys
app/src/api/mock/modules/home.ts    447 loc  mock routes for the 4 roles (cynthia=operations, ifeoma=ceo, ngozi=partnerships, chidera=staff)
```

Tab dispatch (index.tsx line 11 to 16):
```tsx
export default function Home({ tab, id }: ModuleScreenProps) {
  if (tab === "team") return <Team />;
  if (tab === "alerts") return <Alerts openId={id} />;
  if (tab === "reports") return <Reports />;
  return <Overview />;
}
```

INTERIM endpoint keys the screens call today (types/home.ts line 153 to 171). **Several are not in
guide §5** (marked ✗):

| Key | In guide §5? |
|---|---|
| `GET /api/v1/home/overview` → `HomeOverview {greeting, subtitle, blocks: HomeBlock[]}` | yes |
| `GET /api/v1/home/kpi/:key/meta` → `KpiDetailMeta {key,title,sub,columns[],groups[{value,label,count}]}` | ✗ |
| `GET /api/v1/home/kpi/:key` query `{page,q,group}` → `Paged<KpiRow {id, cells: Record<string,KpiCell>, link}>` | yes (guide filters: mode, status, date; INTERIM: `group`) |
| `GET /api/v1/home/team` query `{page,q,status}` → `Paged<TeamRow>` | yes (guide filters: department, status, mode) |
| `GET /api/v1/home/team/summary` → `{scope_label, kpis, attendance_bars}` | ✗ |
| `GET /api/v1/home/alerts` query `{page,q,category}` → `Paged<HomeAlert>` | yes (guide filters: category, severity, mine, age) |
| `GET /api/v1/home/alerts/summary` → `{kpis, sources, categories}` | ✗ |
| `POST /api/v1/home/alerts/:id/clear` body `{outcome: "cleared"\|"dismissed", note?}` | yes |
| `GET/POST /api/v1/home/alert-rules`, `PATCH /api/v1/home/alert-rules/:id` | yes |
| `GET /api/v1/home/reports`, `POST /api/v1/home/reports` | yes (PATCH missing in INTERIM) |
| `GET /api/v1/home/reports/summary` | ✗ |
| `POST /api/v1/home/reports/:id/run` body `{format: "pdf"\|"xlsx"}` → `ReportRun` | yes (guide returns run + `document_id`) |
| `GET /api/v1/home/report-runs` (all runs the viewer may see) | ✗ (guide has `GET /home/reports/:id/runs`) |

`HomeBlock` union the Overview renders (types/home.ts line 34 to 45): `kpis | statstrip | split | area |
donut | bars | need_you | activity | week | list | note`. `note` exists only to print tier 3 lines
("Your own attendance is in My Attendance.", "Your tasks and diary live in My Workspace.") and must go.

---

## 3 · Data layer: how a screen talks to the API

### 3.1 Hooks (bound once in `app/src/api/hooks.ts`)
```ts
export const { useApi, usePaged, useInfinite, useMutation, invalidate } = core;   // core = createApi<Endpoints>(…) in api/client.ts
export type { PagedResult } from "@mycity/ui";
```
Signatures (`packages/ui/src/data/createApi.ts`):
```ts
useApi<K>(key: K, opts?: { params?; query?; enabled?: boolean })
  → { data: Response | undefined; error: ApiError | null; loading: boolean; reload(): void; set(data): void }
usePaged<K extends PagedKey>(key: K, opts?: { params?; filters?: Omit<Query,"page"|"q"|"sort">; sort?: SortOf<K>; enabled?: boolean })
  → PagedResult<Row> { rows; page?: PageMeta; loading; error; pageNumber; setPage(n); q; setQ(q) /*250 ms debounce*/; sort; setSort(s); reload() }
  // changing q, a filter or sort goes back to page 1; query sent = { ...filters, page, q?, sort? }
useInfinite<K>(key, { params?, filters?, q?, enabled? }) → { rows, page, loading, error, more() }   // phone accumulate
useMutation<K>(key) → { run(opts: { params?, body?, query?, idempotencyKey? }) → Promise<Response>, pending, error, fields, reset() }
invalidate(...prefixes: string[])   // reloads every mounted read whose path starts with a prefix, and drops its cache
api.call(key, { params?, query?, body?, signal?, idempotencyKey? })   // from "@/api/client"
```
- The client keeps the last answer per request (`cache: true`), so returning to a tab paints at once.
- Errors are one `ApiError {status, code, message, fields, requestId, reference}` (import from `@/api/client`).
- `idempotencyKey` sends `Idempotency-Key` (server middleware `src/middleware/idempotency.js`).
  Real use: `api.call("POST /api/v1/community/channels/:id/messages", { params: { id }, body, idempotencyKey: crypto.randomUUID() })`.
  Use it for Clear Alert and Run Now (guide §11 "Double submit").

### 3.2 Endpoint typing and the INTERIM → contract switch
`app/src/api/endpoints.ts`:
```ts
import type { Endpoints as Contract } from "@mycity/contract/contract.gen.ts";
export interface Endpoints extends Contract {}   // INTERIM files add keys by declaration merging
```
**Pitfall (hard):** "An INTERIM key that the contract also declares is a type error" (endpoints.ts
comment). The moment a backend PR regenerates `contract.gen.ts` with `GET /api/v1/home/overview`,
`npm run fe:typecheck` fails while `types/home.ts` still declares that key with another type. So
**each Home PR must ship its contract routes and remove the matching INTERIM keys (and fix the
screens) in the same PR.** That matches decision 9 (full-stack PRs). `npm run contract:status`
(from `app/`) lists Interim / Partly / Ready to switch; `-- --all` lists every endpoint.

How a wired module imports types (exactly as `app/src/api/types/organisation.ts` does once its
module landed):
```ts
/** Home is on the contract (packages/contract/schemas/home.js) … These are the contract's types under the names the screens use. */
export type { HomeOverview, HomeKpiCard, HomeAlert, HomeAlertRule, HomeReport, HomeReportRun /* … */ } from "@mycity/contract/contract.gen.ts";
```
or straight in the screen, as `app/src/features/ess/Documents.tsx` does:
```ts
import type { DocumentRow } from "@mycity/contract/contract.gen.ts";
const list = usePaged("GET /api/v1/ess/documents");               // typed by the generated Endpoints
const summary = useApi("GET /api/v1/ess/documents/summary");
```
A form validates with the runtime schema (same rule as the API), `app/src/features/settings/Numbering.tsx`:
```tsx
import settings from "@mycity/contract/schemas/settings.js";
import { ApiError } from "@/api/client";
const save = useMutation("PUT /api/v1/settings/numbering/:doc_type");
const f = useContractForm({ prefix: scheme.prefix, padding: scheme.padding, /* … */ }, settings.NumberingSchemeSave);
const submit = async () => {
  try {
    await save.run({ params: { doc_type: scheme.doc_type }, body: v });
    invalidate("/api/v1/settings/numbering"); close(); toast(`${scheme.label} numbering saved`);
  } catch (e) {
    if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
    else toast(e instanceof ApiError ? e.message : "Something went wrong");
  }
};
return <Form onSubmit={f.submit(submit)}> … <FormFooter><Button onClick={close}>Cancel</Button>
  <Button variant="primary" type="submit" busy={save.pending}>Save Numbering</Button></FormFooter></Form>;
```
For Home: `import home from "@mycity/contract/schemas/home.js";` then `useContractForm(initial, home.HomeAlertRuleCreate)`.
Contract quirks a form must respect:
- List query schemas are `.strict()` (`listQuery(filters, sortable)` in `common.js`): every filter key the
  screen sends through `usePaged({ filters })` must be declared, or the API answers 422. `sort` is
  `"<field>"|"-<field>"` from the allow-list; `PAGE_SIZE` is 25 and `PageMeta.size` is `z.literal(25)`.
- `Paged(item)` is `.strict() {data (max 25), page}`: a list response cannot carry extra meta, which is
  why KPI-detail meta and tab summaries are separate reads (see §8).
- `home_alert_rule.threshold` is `numeric` → **a string on the wire** (sibling backend brief, pitfall 8).
  Show it as text; edit it with `NumberField`.

### 3.3 The mock (F12 to F14) and what happens to Home's
- Mode: `VITE_API_MODE=mock` for `npm run dev` and `npm run build:demo`; `live` for a release build;
  `VITE_API_MODE=live npm run dev` proxies `/api` to `localhost:3000` (app/vite.config.ts).
- `app/src/api/client.ts` loads the mock lazily: `mock: MOCK ? () => import("./mock").then((m) => m.mockTransport) : undefined`.
- A module registers mock routes by importing its file in `app/src/api/mock/index.ts`
  (`import "./modules/home";`) and calling `route("GET /api/v1/home/overview", (req) => ok(...))` from `../core`.
  Helpers: `ok, created, accepted, noContent, fail, notFound, invalid(fields), paged(rows, req, { search, filters, sort })`
  (`paged` rejects unknown query keys with 422, applies `q`, filters and sort, pages at `__CONTRACT_PAGE_SIZE__`),
  `sid(seed)` stable uuids, `at(daysBack, "09:14")`, `isoDaysAgo(n)`. `req.user` is the mock user key.
- **Practice vs F12:** F12 says "a module's mock is deleted when its real routes ship", but every wired
  module **kept** its mock, retyped to the contract (`mock/modules/organisation.ts` header: "The real API
  is built: this mock exists so the gallery, the screen crawl and a laptop without a server have people
  to show, and it answers exactly what the API answers"). The screen gates (8, 11, a11y) crawl the
  **mock build** signed in as `cynthia@mycityapp.io` (Operations), so deleting Home's mock would leave the
  crawl on 404s. **Keep it, retype it to the contract types** (TypeScript is the only "checked against the
  contract" mechanism; there is no runtime mock-vs-schema check).
- F13: the mock's records are the source of `seeds/staging` (decision 11: tagged rows in forward tables):
  keep the mock's people, numbers and alert/report rows identical to the staging seed.
- Drop from the mock what decision 7 moves out: production starts with **no alert rules** (A26), so the
  Alerts screen must render cleanly with zero rules and zero alerts (empty states below).

### 3.4 Files and downloads
`app/src/api/download.ts`: `saveFile(url, filename): Promise<void>` (gated fetch with the session's
token, saved as a download) and `useFileUrl(url | null): string | null` (blob URL for a preview).
A report run's file: `saveFile(\`/api/v1/documents/${run.document_id}/content\`, \`${run.number}.pdf\`)`
(same call as `features/ess/Documents.tsx` line 83). Never a fake toast.

### 3.5 Realtime (optional for Home)
`useRealtime(event, handler)` from `@/api/realtime` (nothing connects on the mock). Precedent:
`useRealtime("mailbox.updated", () => invalidate("/api/v1/mailbox"))`. Home needs none for M1 (guide
§7: "Home reads the refreshed roster ... no write"); only wire one if the backend emits e.g.
`home.updated` to a user room (`src/services/realtime/emitter.js` `toUser(userId, event, payload)`).

---

## 4 · Who sees what: `useMe()`, grants, and decision 2's capabilities

`app/src/auth/AuthProvider.tsx`:
```ts
export function useMe(): Me            // throws when signed out; Me = contract identity.Me
export function useAuth(): AuthValue   // { status, me, can(module, action = "view"), justSignedIn, clearJustSignedIn, … }
const can = useCallback((module: string, action = "view") => !!me?.grants[module]?.includes(action), [me]);
```
`Me` today (`packages/contract/schemas/identity.js` line 63 to 81, `.strict()`):
`user_id, employee_id, email, display_name, first_name, job_title, department, photo_url, is_ceo,
grants: Record<ModuleKey, Action[]>, roles: {code,name}[], home_view: "operations"|"ceo"|"partnerships"|"staff", manages_people`.

Tab gating today, `app/src/shell/access.ts` line 14 to 17:
```ts
if (mod.key === "home" && t.slug === "team") return me.manages_people || me.is_ceo;
if (mod.key === "home" && (t.slug === "reports" || t.slug === "alerts")) return FULL(me) || me.manages_people;
```
mirrored server-side by `src/shared/search/screens.js` `tabVisible()` line 134 to 135 (⌘K hides the
same tabs). Alert rule management today keys on `me.grants.home?.includes("edit")` (index.tsx line 101),
which the mock gives to **every** staff account (`grantsFor` gives staff `view, create, edit`).

**Needed for decision 2 (frontend half):**
1. Backend adds `capabilities: z.array(CapabilityCode)` to `identity.Me` (and the mock identity
   `app/src/api/mock/modules/identity.ts` returns them; TypeScript forces it).
2. `AuthValue` gains `has(code: string): boolean` (`!!me?.is_ceo || me.capabilities.includes(code)`:
   the CEO passes `requireCapability`, sibling brief pitfall 6).
3. `visibleTabs()` and `tabVisible()` change **in the same PR** (they are documented as mirrors):
   Team ← `home.team`; Reports ← `home.reports`; Alerts ← `alerts.clear || <manage code>`
   (PROPOSAL; guide header says `home.alerts` "see and clear").
4. **Code naming:** `CapabilityCode` regex is `^[a-z][a-z_]*\.[a-z][a-z_]*$` (two segments).
   `home.alerts.manage` is refused by `RoleSave` unless the regex widens; keep the client constant in
   one place (`features/home/access.ts`, PROPOSAL) so a rename is one line.
5. Gated tab state (guide §10.1 last paragraph, §11): decide whether Home's gated tabs stay **visible**
   (shell keeps them, the screen renders the lock) or stay **hidden** (today). See conflicts. If visible,
   `visibleTabs` returns all four Home tabs for anyone with `home` view, and each tab renders:
```tsx
import { EmptyState, PageHeader } from "@mycity/ui";
function Gated({ title }: { title: "Team" | "Alerts" | "Reports" }) {
  return (<><PageHeader title={title} /><EmptyState illustration="Locked" title="For Managers" text="This tab is for managers and the CEO." /></>);
}
```
   (EmptyState title ≤ 4 words, text ≤ 8 words: "This tab is for managers and the CEO." is exactly 8.)
   Do not name it after a `@mycity/ui` export. There is **no** gated/locked component in the catalogue;
   `EmptyState` + the `Locked` illustration is the demo's own `gate()` (`demo.html` line 1830).

---

## 5 · Shell contracts a screen relies on

- `ModuleScreenProps { tab: string; id: string | null }` (`app/src/shell/screens.tsx`); Home is
  `home: lazy(() => import("@/features/home"))`. Other URL params: `const [params, setParams] = useSearchParams();`
  `params.get("category")`, `setParams({ id: null }, { replace: true })`.
- URLs: `hrefFor(moduleKey, tab?, extra?)` from `@/lib/router` → `/home?tab=alerts&id=…`. Tab slugs
  `overview | team | alerts | reports` never change (`shell/catalogue.ts`, `src/shared/route-map.js` line 43).
- `useRouter().navigate(href, { replace? })`; `Link`.
- F14: before a screen's PROGRESS row opens it, `ModulePage` shows `PlannedScreen` (Coming Soon).
  Production opens at API + UI + Mobile ticks, staging at API, the mock always ("Full Design").
- The phone's New action (F18) and ⌘K: `useScreenAction(cond ? { label: "New Rule", onSelect } : null)`
  from `@/shell/screen-action`; it also runs once when the screen opens with `?action=new`.
  Precedent: `useScreenAction(canAdd ? { label: "New Holiday", onSelect: newHoliday } : null);`
  (settings/Organisation.tsx line 59). The label **must** be a literal and appear in
  `src/shared/search/actions.js` (`a("new_rule", "New Rule", { screen: "home.alerts", params: { action: "new" }, need: [...] , words: [...] })`)
  or carry `// search:none <reason>`. **Note:** an action's `need` is a grant pair `[module, action]`,
  not a capability; the screen must still be `tabVisible` for the reader (actions.js comment line 19 to 21).
- `useUrlAction(word, run)` for other URL actions (`?action=dismissed` style), same file.
- Overlays: `useModal().open({ title, sub?, body: ReactNode | (close) => ReactNode, footer?, wide?, full?, side?, dirty?, onClose? })`.
  **One modal at a time: opening one replaces the last, never stacks** (ModalSpec docs). So Edit Rule from
  an alert replaces the alert dialog; New Rule from Alert Rules replaces the list.
- Clock prompt today: `Shell()` calls `useClockPrompt()` (Shell.tsx line 96), which opens the Attendance
  `ClockPanel` 700 ms after `justSignedIn` when `GET /api/v1/attendance/me/today` says `state === "not_clocked"`
  (`features/attendance/ClockButton.tsx` line 27 to 36). The crawl treats a prompt that opens by itself as
  its own view (`scripts/check/lib/screens.js` line 622 to 627).

---

## 6 · Components Home uses (props that matter, from `docs/COMPONENTS.md`)

| Component | Use on Home | Props to know |
|---|---|---|
| `PageHeader` | every tab, once | `title` (≤3 words), `subtitle`/`sub` (≤8 words, **desktop only**, hidden on phone), `help`, `actions` (≤1 primary), `children` |
| `KpiGrid` / `KpiCard` | the four cards on every tab | `KpiGrid { items?: (KpiCardProps & {key})[]; children?; cols?: 2\|3\|4 }`: 4 across, **2 to a row on a phone**, renders a list. `KpiCard { title (≤4 words), value: ReactNode, tone?, caption? (≤5 words), trend?: "up"\|"down"\|"flat", help?, helpLabel?, onOpen?, opensOn?: "all"\|"phone" }`. With `onOpen`, help becomes an ⓘ beside the number |
| `KpiDetail` | body of the modal a card opens | `{ summary? (≤20 words), groups?: {value,label,count}[], group?, onGroup?, list: DataViewList (a usePaged result), columns, rowKey, onRowClick?, noun?, nounPlural?, caption (required), empty? }`; default empty `{ title: "Nothing Behind This" }`; chips only when > 1 group |
| `DataView` / `LoadingRows` | Need You, Team Roster, Open Alerts, Recent Runs | `columns: { key, label: ReactNode, align?: "n", render, sortable?, desktop?, className? }[]`, `rowKey`, `list` **or** `rows`+`loading`+`error`+`page`+`onPage`, `caption`/`title`, `help`, `actions`/`right`, `search` (placeholder ≤3 words), `onRowClick`, `selectedKey`, `noun`, `nounPlural`, `empty {title, text?, icon?}`, `wide`, `footer`, `bare`. **Phone card:** first non-`desktop` column is the card title, the **next three** non-`desktop` columns are label/value pairs (DataView.tsx line 230 to 266) |
| `Pager` | under a list not passed as `list` | `{ page, onPage, noun?, nounPlural?, label? }` (label names the landmark; two lists on one screen each need one) |
| `Chips` | category / status filters | `{ options: (["v","Label"] \| {value,label,count?,icon?,disabled?})[], value, onChange, label }`; or toggle mode `selected`, `onSelectedChange`. Chip label ≤3 words; counts as numbers |
| `AreaChart`, `DonutChart`, `BarChart`, `Sparkline` | the role's main chart | `AreaChart { values, labels (required), title?, help?, caption? (≤8 words, desktop only), series?, format? }`; `DonutChart { middle (required), under?, slices? \| percent?, lines? (≤20 words each), title?, help?, caption? }`. Each is lazy (own chunk) |
| `Bars` | pipeline, goals, attendance by person, alert sources | `{ rows: {label, percent, value, series?}[], note? (≤8 words, desktop only) }`; map wire rows with `toBars()` from `features/shared/wire.ts` |
| `StatStrip` | Staff day strip | `items: { label, value, tone?, desktop?, onOpen? }[]`: phone shows first four unless `desktop` |
| `Timeline` | Activity Today | `items` via `toTrail(wire)` (`tone: "hi"→"now"`, `"ok"→"done"`) |
| `Tile` | report cards | `{ title (≤4 words), text? (≤20 words), children (pills, small Button), level? }` |
| `Card`, `CardHeader` | section frames | `CardHeader { title (≤4 words), help? (title becomes a HelpTerm), record?, actions?/right?, level? }`; `Card { details?, pad?, as? }` |
| `KeyValue` | alert and person sheets | `items: [label, value][]` (labels ≤4 words Title Case; value null → EmptyValue) |
| `Who` / `Avatar` | people in rows | `Who { name, role?/sub?, src?, size?, presence? }` |
| `Pill` / `StatusPill` | statuses, severity | `Pill { tone?: "ok"\|"warn"\|"err"\|"info"\|"neutral", children (1 to 3 words) }`; `StatusPill { status: {tone,text} }` |
| `Money` | amounts | `{ value: string\|null, short? (KPI tiles only), kobo?, negLabel? }` |
| `HelpTerm` / `InfoButton` / `Details` | tier 2 | `HelpTerm { children (the word), help (≤35 words), title? }`; `InfoButton { label, help }` only with no word to attach to; `Details { items?, children? }` ≤60 words, one per card |
| `EmptyState` | zero data, gated tab | `{ illustration?: "Empty"\|"Search"\|"Success"\|"Error"\|"Locked"\|"Offline"\|"FirstRun"\|…, icon?, title (≤4), text? (≤8), action?, bare? }` |
| `ErrorState` | failed read | `{ error, message?, onRetry?, page? }` |
| `Modal`/`useModal`, `Sheet`, `SidePanel` | KPI detail, alert, person, forms | Modal is a centred dialog on desktop, bottom sheet on phone; `full` = full-screen sheet |
| `Menu` | overflow actions | `{ trigger: (p) => <IconButton {...p} icon="dots" label="More Actions" />, items: { label, icon?, danger?, onSelect }[] \| "sep" }` (action sheet on a phone) |
| `ConfirmDialog` / `useConfirm` | destructive only | `if (!(await confirm({ title: "Delete Rule", destructive: true }))) return;` |
| `Form`, `FormFooter`, `FormError`, `Field`, `TextField`, `NumberField`, `SelectField`, `ChoiceField`, `CheckboxField`, `Switch`, `ToggleRow`, `TimeField`, `DateRangeField`, `Wizard`, `useContractForm`, `rules` | rule and report forms, picker | `Field { label (≤4), help?/info?, optional?, state?, message?, htmlFor? }`. Binding: `{...f.field("name")}` on the control, `{...f.status("name")}` on the Field. `ChoiceField` for 2 to 5 options, `SelectField` above 5. `ToggleRow { title, text?, checked, onChange, disabled?, changed? }`. `Wizard { steps: {title, body, check}[], finish, busy?, onFinish, onCancel?, initialStep?, onStepChange? }` |
| `PersonPicker`, `RecordPicker` (via `features/shared/pickers.tsx`) | report recipients | `EmployeePicker` needs the People grant (`GET /employees`); `ColleaguePicker` (`GET /community/people`) is open to all staff; `RolePicker` (`GET /access/roles`) |
| `ExportButton` | Overview Export | `{ onExport: () => Promise<unknown>, children? ("Export"), message? (toast ≤8 words) }` |
| `PhoneOnly` / `DesktopOnly` | per-shell pieces from §10.2 | `unmount?` for heavy parts (charts) |
| `Button`, `IconButton` | actions | `Button { variant?: "default"\|"primary"\|"ghost"\|"danger", icon?, iconRight?, size?: "md"\|"sm", block?, busy?, asChild? }`; `IconButton { icon, label (required) }` only for well-known actions (close, search, more, back, filter) |
| `toast` | confirmations | `toast("Rule created")`, `toast.success(text, { undo })`; ≤8 words, checked statically for literal strings |

Not in the catalogue (so not available without `npm run new:component`): **no gated/locked component**
(use EmptyState), **no reorder/drag list** (only `Kanban` drags, desktop only), **no cron/schedule field**,
no `InfoHint` (that is praxis-ls; here it is `HelpTerm`/`InfoButton`/`Details`). Icon names include
`lock up down edit dots grid chart download refresh filter clock` (packages/ui/src/icons/Icon.tsx).

Wiring helpers already in the app (`features/shared/`, keep using): `toBars(rows: WireBar[])`,
`toTrail(items: WireTrailItem[])`, `toTrend(dir?: "up"|"dn"|"fl")` (wire.ts), `PagedTable`, `ExportAction`
(sections.tsx; ExportAction posts to the **INTERIM, unbuilt** `POST /api/v1/exports`, see §7.1),
`useDepartmentOptions()` (sections.tsx, real `GET /api/v1/departments`), `EmployeePicker`, `ColleaguePicker`, `RolePicker`.

---

## 7 · Screen by screen: gaps against guide §10.1 / §10.2, and the target

Copy below in quotes is the guide's tier 1 wording; it is what the gates will read.

### 7.1 Overview (`overview`, PROGRESS #1)

Current: `useApi("GET /api/v1/home/overview")` → `PageHeader title={data.greeting} sub={data.subtitle}`,
actions Export (fake: `toast("Export queued. The file arrives in your Mailbox.")`) and New
(`navigate(hrefFor("workspace", "tasks", { new: "1" }))`, shown when `grants.workspace` has `create`),
then `data.blocks.map(Block)`.

Gaps:
1. **KPI cards are one per row on a phone.** `KpiRow` defaults `mobileCols = 1` → `Grid cols={4}`.
   §10.2 wants "the four KPI cards two to a row" on every tab. Use `KpiGrid` (two to a row, a list) or `Grid phoneCols={2}`.
2. **Tier 3 text from the server**: the `note` block ("Your own attendance is in My Attendance.",
   "Your tasks and diary live in My Workspace."), the donut's second sentence ("Three late arrivals by
   Bashir Lawal in 30 days, which is the threshold the rule watches."), activity texts like "Raised by
   the rule, not a manager." / "Posted automatically from her employee record.", the KPI meta sub
   "Grouped the way the rules read them." All are tier 3 in §10.1. Remove the `note` block type; donut
   `lines` carry figures only ("37 on time", "4 late", "7 absent this month").
3. **Copy drift from §10.1**: chart "Attendance, Last 14 Working Days" with "Saturdays run 09:00 to 15:00."
   → "Attendance, 14 Working Days", caption "Dips are Saturdays, a half day" (desktop); "Across the
   Organisation Today" → "Activity Today"; "Signed Value by Month, ₦M" → "Monthly Signed Value"; pipeline
   note → "4 with no contact in 30 days" (desktop only, `Bars note` already is); Staff strip "Today's Shift",
   "Clock-in", "Where", "Status" → "Shift Today", "Clock-In", "Where", "Status", **"Hours Today" missing**.
4. **Staff phone strip**: §10.2 leaves Where and Hours Today off a phone → `StatStrip` items `desktop: true`.
5. **Export on a phone**: §10.2 leaves Export off a phone → `DesktopOnly` (or omit when `useIsPhone()`).
   And Export must be real (decision 8, PR 5): `ExportButton onExport={() => api.call("POST /api/v1/home/overview/export", …)}`
   (PROPOSAL path). Do **not** use `ExportAction` (its `POST /api/v1/exports` is INTERIM and unbuilt).
6. **New is not on the phone fan**: register it with `useScreenAction` (search-coverage needs the label
   in `actions.js`). "New" alone is not Verb Noun (§5.4) and not in `actions.js`: decide its meaning
   (open question) before naming it.
7. **Subtitle is server copy** (`"${today} · ${present} of ${total} clocked in"`, mock line 87). Build it
   on the client from data so gates see it and dates are formatted once: `subtitle={formatDate(data.date) + …}`.
   Desktop only; §10.2 leaves "the date line" off a phone (PageHeader does that for free).
8. **Page title = greeting** must stay ≤3 words Title Case ("Good Morning, Cynthia"). A two-word first
   name breaks gate 8; the server should greet with `first_name` only.
9. **Donut has no `title`** (`<DonutChart percent middle under lines />`): give it a title ("On Time",
   "Org KPI") or `label` for a11y; per-department CEO figures as `lines`.
10. **No KPI card picker** (decision 5) and no surface for role defaults/locks (see §7.3).
11. **No clock-in prompt ownership** (decision 12): today the Shell triggers it on every explicit sign-in,
    wherever the person lands (see §7.4).
12. **Need You** is mock-composed; for approvals it can read the real `GET /api/v1/workflow/mine`
    (`ApprovalWaiting { workflow_instance_id, definition_name, subject_name, stage_name, overdue, opened_at, link, context }`)
    and `/workflow/mine/count`; or the server folds those into the overview's `need_you` (PROPOSAL, §8).
    Rows open `navigate(r.link)` (link nullable on the contract: guard it).
13. **Money and values preformatted by the server** ("₦9.2M", "4 of 6"): FRONTEND_GUIDE §3 says format
    at render time. PROPOSAL: KPI `value` typed (`{ kind: "count"|"money"|"pair"|"pct", value, total? }`) and
    rendered with `formatCount` / `<Money value short />` / `"22 of 25"`.
14. "A role with no function data does not see the pipeline card at all" (§11): render a section only when
    the server sends it (nullable section), never an empty card.

Target layout (both shells from one tree):
```
PageHeader title={greeting} subtitle={desktop line} actions={<>{!phone && <ExportButton …/>}<Button variant="primary" icon="plus">New …</Button></>}
[Staff only] StatStrip label="Your Day" items=[Shift Today, Clock-In, Status, Where (desktop), Hours Today (desktop)]
KpiGrid → 4 × KpiCard { title, value, caption, trend, tone, onOpen: () => openDetail(key, title) }
Grid cols="1.4/1": main chart (AreaChart | Bars | …) + side (DonutChart)     ← per role from the server
Grid cols={2}: Need You (DataView rows, empty {title:"Nothing Needs You"}) + Partnership Pipeline (Bars, note desktop)
Goals This Quarter | My Goals This Quarter (Bars) · Upcoming Leave (Staff)
Grid cols={2}: Activity Today (Timeline) + Your Week
```
Phone first screen budget (gate 11, ≤40 words of non-content text in the first 844 px): greeting (3) +
New label + four KPI titles + four captions + the chart title. Keep KPI titles ≤3 words and captions ≤3
where possible; Bars/Timeline/Pill/Who text is content and not counted.

### 7.2 KPI detail (the report model)

Current (`KpiDetail.tsx`): `modal.open({ title: label, wide: true, body: <Report …/> })`; meta from
`GET /home/kpi/:key/meta`, rows from `usePaged("GET /api/v1/home/kpi/:key", { params: { key }, filters: group === "all" ? {} : { group } })`;
columns mapped from `meta.columns` rendering `Cell` per `KpiCell.kind`
(`text | person | pill | money | date | over | bar`).

Gaps:
1. No `noun` (pager says "records"), no `empty` (falls back to "Nothing Behind This": acceptable, §11 wants an empty state).
2. Summary "22 of 25 clocked in across the organisation" (tier 1) must come from meta; mock sends tier 3 instead.
3. Groups for Clocked In Today per §10.1: On Site, Remote, Late, **No Clock-Out Yesterday**, On Leave
   (mock: "No Clock-Out", plus "Not in"; guide §3 step 3 also names "field").
4. Phone: "the list as cards (the first column as the card title, a status pill, two label and value
   pairs)", "Columns beyond two per card" left off. DataView shows up to three non-`desktop` columns after
   the title, so meta columns need a phone flag (PROPOSAL: `phone: boolean` per column, or the client sets
   `desktop: index > 3`).
5. **Deep link**: guide §9 AI routes include "a KPI's detail modal". Nothing reads a URL param today.
   PROPOSAL: `/home?tab=overview&kpi=<key>` opens it (read with `useSearchParams`, clear on close via
   `onClose: () => setParams({ kpi: null }, { replace: true })`, as Alerts does for `id`).
6. Name clash: `blocks.tsx` exports a component `KpiRow` and `types/home.ts` a type `KpiRow`. Rename on the move.
7. Rows link out with `close(); navigate(r.link)`; keep (KpiDetail closes the modal first).
8. "A card inherits rights" (guide §6): a detail for a card the viewer cannot open is the server's 403/404;
   render `ErrorState` (it hides Try Again where retrying cannot help).

### 7.3 Personal card picker and role defaults (decision 5): new UI, not in guide §10 yet

The guide §10.1 Overview row lists no picker, so **§10.1/§10.2 must gain it first** (CLAUDE.md step 2).
Donor pattern to follow (do not name it in code): server-resolved band; client owns only the draft.
```ts
// features/home/picker.ts (pure, unit-tested)
export const MAX_CARDS = 4;
export const draftAdd = (d: string[], id: string) => (d.includes(id) || d.length >= MAX_CARDS ? d : [...d, id]);
export const draftRemove = (d: string[], id: string, locked: readonly string[]) => (locked.includes(id) ? d : d.filter((x) => x !== id));
export const draftMove = (d: string[], id: string, delta: -1 | 1) => { const i = d.indexOf(id), j = i + delta;
  if (i < 0 || j < 0 || j >= d.length) return d; const n = [...d]; [n[i], n[j]] = [n[j], n[i]]; return n; };
export const draftInitial = (c: { picked: string[] | null; role_default: string[] }, current: string[]) =>
  c.picked ? [...c.picked] : c.role_default.length ? [...c.role_default] : [...current];
/** Re-stating the role default in order saves as null ("follow the role"); an empty pick is a real answer. */
export const draftToPicks = (d: string[], roleDefault: string[]) =>
  roleDefault.length && d.length === roleDefault.length && d.every((x, i) => x === roleDefault[i]) ? null : [...d];
```
UI (PROPOSAL): a Modal titled "Choose Cards" with one `ToggleRow` per eligible card (`title` = card
title, `text` = one short line, `disabled` when locked, `checked` = in draft), a one-line `FormError`
when more than 4 are on ("Pick up to 4 cards"), reorder by `IconButton icon="up"/"down"` (no drag
component exists; 44 px on a phone), footer `Cancel` / `Use Role Default` / primary `Save Cards`.
Draft then Save, never a write per toggle (a write per toggle would re-render the overview under the
person). Endpoints PROPOSAL: `GET /api/v1/home/kpi-cards` → `{ max: 4, cards: [{key,title,locked,role_default:boolean}], picked: string[]|null, role_default: string[] }`
(only cards the viewer is eligible for: never list or grey out what they cannot read) and
`PUT /api/v1/home/kpi-cards` body `{ picked: string[] | null }`, then `invalidate("/api/v1/home")`.
Where the picker is opened is an open question (an IconButton "edit" is not a well-known icon-only action
per §5.5). Role defaults and locks (`role_kpi`) need an editing surface: most naturally Settings · Roles &
Permissions (the RoleDetail already carries `home_view`), which is the settings guide's §10, not Home's.

### 7.4 Clock-in prompt trigger (decision 12)

Today: `Shell` → `useClockPrompt()` → opens Attendance's `ClockPanel` after an explicit sign-in when
today's state is `not_clocked` (on leave is `unavailable` with `unavailable_reason: "leave"`, so no prompt,
which satisfies §11). Guide §3 step 1 says "On the first sign-in of the day, **Home** opens the clock-in
prompt"; attendance.md §10.2 says "After sign-in it opens by itself for anyone not yet clocked in".
PROPOSAL for "Home owns the trigger": the server decides (`HomeOverview.prompt_clock_in: boolean`,
first Home visit of the Lagos day, not on leave, not clocked) and Overview calls the existing hook:
```tsx
const { open } = useClock();                              // features/attendance/ClockButton.tsx
useEffect(() => { if (data?.prompt_clock_in) open(); }, [data?.prompt_clock_in, open]);
```
and `useClockPrompt()` leaves `Shell.tsx` in the same PR (else two triggers). The ClockPanel stays
Attendance's (owner LA); Home only opens it. The crawl already records a self-opened prompt as its own
view, so this does not break gates 8/11/a11y.

### 7.5 Team (`team`, PROGRESS #86)

Current: `useApi("GET /api/v1/home/team/summary")` (scope_label, kpis, attendance_bars) +
`usePaged("GET /api/v1/home/team", { filters: status === "all" ? {} : { status } })`, `PageHeader title="Team"
sub={"Who is in and where · " + scope_label}`, `KpiRow`, `Chips` (Everyone, Late, Remote, On Leave,
No Clock-Out), `DataView title="Team Roster" right={<Pill>{total} people</Pill>}` with columns Employee
(`Who name sub=job_title`), Department (desktop), Today (Pill), "Clock-in", KPI (desktop), Open Tasks
(desktop); row → `navigate(hrefFor("people", "employees", { id }))`; then `InfoCard "Attendance by Person"`
with `Bars` of 6 people.

Gaps:
1. Subtitle: §10.1 tier 1 is only "The scope (The whole organisation, or the lead's departments)";
   "Who is in and where" goes. §10.2 leaves the scope line off a phone (subtitle does that).
2. KPI cards one per row on a phone → two to a row (same fix as 7.1).
3. `right={<Pill>{n} people</Pill>}` repeats the total: the Pager is the only place for it (FRONTEND_GUIDE §4).
4. Phone card (§10.2): "avatar, name and department, a status pill, Clock-In and KPI". Today: `Who sub=job_title`
   (should be department), KPI is `desktop: true` (must show on phone). Department and Open Tasks columns
   are `desktop: true` (correct). Header label "Clock-in" → "Clock-In".
5. Row action: §10.2 "Tap a person card or a KPI card: a bottom sheet" (open tasks live in the person's
   sheet). Today a row navigates to People · Employees, which a line manager without the `people` grant
   cannot open (Shell redirects). PROPOSAL: a row opens a person Modal (sheet on phone) with `KeyValue`
   (Department, Today, Clock-In, KPI, Open Tasks) and, when `can("people")`, buttons "Open Profile" and
   "View Attendance" (deep link to People · Attendance, guide §2).
6. Chips filter is not listed in §10.1 Team (API filters are department, status, mode). Either add it to
   §10.1 or drop it; if kept, chip labels ≤3 words and counts via `{ value, label, count }`.
7. "Attendance This Month" (by person) is the §10.1 title; today "Attendance by Person" with the first 6
   rows (`l.slice(0, 6)`), not paged. Decide: a bounded top list (state the bound in the contract) or a paged list.
8. Team KPI cards open their detail (`tm_present`, `tm_onsite`, `tm_remote`, `tm_flags` in the mock).
9. Figures must equal My Attendance (decision 4, `attendance.roster`): the UI must not recompute anything.

### 7.6 Alerts (`alerts`, PROGRESS #2)

Current: `summary = useApi("GET /api/v1/home/alerts/summary")`, `list = usePaged("GET /api/v1/home/alerts", { filters: cat === "all" ? {} : { category: cat } })`,
header `sub="Thresholds crossed and not yet cleared"`, actions (only when `grants.home` has `edit`):
"Alert Rules" (modal `RuleList`: `ToggleRow` per rule, `PATCH { enabled }`), "New Rule" (modal titled
"New Alert Rule" with `RuleForm`). `DataView title="Open Alerts" right={<Pill tone="warn">{n} open</Pill>}`
columns Alert, Trigger (desktop), Who Can Clear (desktop), Age, Over By (hand-made warning span), Severity;
row → `setParams({ id })` + `AlertDetail` modal; `InfoCard "Alerts by Source"` with `Bars`.
`AlertDetail`: h3 title, pills, `KeyValue [Trigger, "Who can clear", Raised, "Over threshold"]`, footer
"Open Record", Dismiss, "Clear This Alert" → `POST …/clear { outcome }`, `toast("Alert cleared, logged against you.")`.

Gaps:
1. Page subtitle must go (§10.1: "The page subtitle … are removed").
2. Gate: actions keyed on `grants.home.edit` → `has(<alerts manage capability>)` (decision 2).
3. Phone order (§10.2): "View Dismissed, Alert Rules, New Rule; the four KPI cards two to a row; the
   category chips; alert cards with a severity pill, Who Can Clear and Over By". Columns must be:
   `Alert` | `Trigger` (desktop) | `Who Can Clear` (**not** desktop) | `Age` (**desktop**) | `Over By` | `Severity`.
   Then a phone card is title + Who Can Clear + Over By + Severity (exactly three pairs).
4. **Over By help term** (the only tier 2 on Home), on the header and on each phone card's label:
```tsx
const OVER_BY = "How far the alert is past its rule: +1 over 3 is one more than the 3 allowed. A deadline alert shows the days left instead.";
{ key: "over_by", label: <HelpTerm help={OVER_BY}>Over By</HelpTerm>, render: (r) => <Pill tone="warn">{r.over_by}</Pill> }
```
   Do **not** make this column `sortable` (the header would become a sort button with a HelpTerm button
   inside it). On phone cards the label sits in a `pointer-events-none` span but `[&_button]:pointer-events-auto`
   keeps the term tappable (DataView.tsx line 260). Replace the hand-made `bg-warning-soft` span with `Pill tone="warn"`.
5. "View Dismissed" missing entirely (needs an API filter, e.g. `state=dismissed`, and a way back).
6. "Alert Sources, 30 Days" (desktop only): today "Alerts by Source", shown on phone. Wrap in `DesktopOnly`.
7. Alert dialog per §10.1/demo: title "Alert"; content `KeyValue` [Trigger, Who Can Clear, Age, Over By,
   Severity] ("Who can clear" / "Over threshold" fail Title Case); footer **Close, Edit Rule, Clear Alert**
   (today "Clear This Alert", "Dismiss", "Open Record"). Dismiss is not in §10.1 even though the API has
   `outcome: "dismissed"` and View Dismissed exists: open question. Phone: Clear Alert full width at the
   foot of the sheet (FormFooter does it). Toast "Alert cleared" (the guide keeps the audit fact tier 3, so
   "logged against you" goes).
8. Deep link `?tab=alerts&id=<id>` only works when the alert is on the current page (`list.rows.find`).
   Needs `GET /api/v1/home/alerts/:id` (not in §5) or the id filter. AI route "Home · Alerts filtered to a
   category" needs `?category=` read on mount.
9. Category chips: use counts as data, `{ value, label, count }`, instead of `"All 12"` string concat.
10. Two lists' totals: remove the `"{n} open"` pill (Pager only).
11. New Rule form vs §10.1 "Rule Name, Metric, Threshold, Window, Days, Severity; Cancel, Create Rule"
    (demo field label is "Window, Days", one field). Today: Severity is a `SelectField` with `info="High
    severity escalates to the CEO after 14 days."` (tier 3: escalation is listed tier 3) → `ChoiceField`
    Low/Medium/High (≤5 options) with no help. Metric from the server's metric list (`SelectField`, 6
    metrics). Threshold and Window as `NumberField`. Modal title "New Rule" (FRONTEND_GUIDE §5.4 example:
    "New Rule opens a form whose button is Create Rule"). Toast "Rule created" (today "Alert rule created.
    It runs next cycle." carries tier 3). Swap INTERIM rules for the contract schema. Who clears
    (`permission_key`) is in the API (§5 "who clears") but not in §10.1's field list: open question.
12. Edit Rule (from the alert dialog and from Alert Rules) → same form, title "Edit Rule", `PATCH`, button "Save Rule".
13. Switching a rule off: toast "Rule disabled, its alerts stop" today; guide §6 "switching a rule off clears
    its open alerts" (consequence at the point of commit: keep it short, it is not tier 3 because it changes
    what the person does).
14. Zero state (decision 7: production ships no rules): Open Alerts `empty={{ title: "No Open Alerts" }}`
    and Alert Rules list `EmptyState title="No Rules Yet" action={<Button variant="primary">New Rule</Button>}`.
15. Mock "Overdue 7 Days +" counts High severity (`alerts_high`): server must count age > 7 days.
16. Register `useScreenAction(canManage ? { label: "New Rule", onSelect: openNewRule } : null)` and add
    `new_rule` to `src/shared/search/actions.js`.

### 7.7 Reports (`reports`, PROGRESS #3)

Current: `summary`, `reports = usePaged("GET /api/v1/home/reports")`, `runs = usePaged("GET /api/v1/home/report-runs")`,
`PageHeader title="Reports" sub="Scheduled and on demand · Managers and the CEO"` + "New Report" (modal
`ReportForm`: Report Name, Source (with tier 3 `info`), Schedule (4 free-text strings), Recipients (free text)
→ "Schedule Report"); `Grid cols={3}` of `Tile title=name text=cadence` + status Pill + audience Pill +
"Run Now" (always PDF); `Pager`; `DataView "Recent Runs"` columns Report, Last Run, Recipients (desktop),
Format; row → `toast("… downloading")` (fake).

Gaps:
1. Page subtitle goes (§10.1).
2. KPI titles per §10.1: Scheduled, Paused, **Runs This Month** (mock "Run This Month"), Recipients; two to a row on phone.
3. Recent Runs phone (§10.2): run cards (report, last run, recipients), Format left off → Recipients **not**
   desktop, Format `desktop: true` (inverse of today). Row → real download (`saveFile`, §3.4) of the run's
   `document_id` (PDF or XLSX per format). Recent Runs is "for those reports only" (generated as recipient).
4. `Grid cols={2}` wrapping one DataView renders it half width; drop the wrapper.
5. Report builder (decision 8): definitions with `source` (from a server list of report sources),
   `filters`, schedule (cron on the table), `formats` (PDF, XLSX), `recipients` + `reporting_line`.
   That is more than 6 fields across topics → `Wizard` (FRONTEND_GUIDE §8.1), e.g. steps What (name,
   source, filters), When (cadence, time, day), Who (recipients via `ColleaguePicker`/`RolePicker`, formats),
   `finish="Create Report"`. No cron field exists: PROPOSAL the contract takes a structured schedule
   (`{ cadence: "daily"|"weekdays"|"weekly"|"monthly"|"on_demand", time: "18:00", weekday?, day? }`, `TimeField`
   for time) and the server writes the cron. Free-text recipients go.
6. Report card actions: Run Now (choose format if both), Pause/Resume, Edit, Download last: not listed in
   §10.1 (only "a card per report … (name, schedule and contents, status, audience)") though §2 lists
   "run it now, download PDF or XLSX". Add to §10.1. Run Now uses `idempotencyKey` and toasts the run
   number ("RPT-0215 ready"), then `invalidate("/api/v1/home/report")` (covers reports and runs if paths share
   the prefix; with `/home/reports/:id/runs` use `invalidate("/api/v1/home/reports")`).
7. Status pill text "On demand" → Title Case "On Demand" (Pill text is content, but keep chrome casing).
8. `useScreenAction` "New Report" + `actions.js` entry.

### 7.8 Every tab: loading, error, zero

- Loading: `LoadingRows` (screen) / DataView's own loading; never a blank modal.
- Error: `<ErrorState error={x.error} onRetry={x.reload} />`.
- Zero (production starts empty, guide §11): every figure renders 0, every list its `empty`, sections the
  server omits are not drawn. Test the Overview with an empty overview payload.

---

## 8 · Contract shapes the screens need (PROPOSAL, to agree with the backend brief)

All `snake_case`, in `packages/contract/schemas/home.js` (owner TB); `contract.gen.ts` generated by
`npm run gen:contract`, never edited. Minimum the UI above needs:

```
HomeOverview {
  greeting: string; date: IsoDate; clocked_in: { present: number; total: number } | null;
  prompt_clock_in: boolean;                                     // decision 12
  cards: HomeKpiCard[];                                         // ≤ 4, resolved: picks → role_kpi → catalogue default, eligibility applied
  chart: HomeChart | null; side: HomeChart | null;              // role's main chart and its donut
  day: { shift: string; clock_in: IsoDateTime|null; where: string; status: {tone,text}; hours: string } | null;   // Staff
  need_you: { rows: HomeNeedYouRow[]; total: number };          // capped at 25, links to its paged endpoint
  pipeline: WireBar[] | null; pipeline_note: string | null;     // null = role has no function data → no card
  goals: WireBar[] | null; my_goals: WireBar[] | null; upcoming_leave: …[] | null;
  activity: { title; when: IsoDateTime; text?; tone? }[] | null;
  week: { from: IsoDate; to: IsoDate; days: { date: IsoDate; text; kind: "diary"|"task"|"note" }[] };
}
HomeKpiCard { key; title (≤4 words); value: { kind: "count"|"money"|"pair"|"pct"; value: string|number; total?: number };
              tone?; caption? (≤5 words); trend?: "up"|"down"|"flat"; detail: boolean }
HomeKpiDetailMeta { key; title; summary: string|null; columns: { key; label; align?: "n"; phone: boolean }[]; groups: { value; label; count }[] }
HomeKpiQuery = listQuery({ group?, … })   → Paged(HomeKpiRow { id; cells: Record<string, KpiCell>; link: string|null })
HomeTeamSummary { scope: string; cards: HomeKpiCard[]; attendance_month: WireBar[] }
HomeTeamQuery = listQuery({ department?, status?, mode? }, [sortable…]) → Paged(HomeTeamRow { employee: PersonRef; today: {tone,text}; mode; clock_in: IsoDateTime|null; kpi_pct; open_tasks })
HomeAlertSummary { cards; sources: WireBar[]; categories: { value; label; count }[] }
HomeAlertQuery = listQuery({ category?, severity?, mine?, state?: "open"|"dismissed" }) → Paged(HomeAlert { home_alert_id; title; trigger; category; who_clears; raised_at; age_days; over_by: string; severity; link; home_alert_rule_id; can_clear: boolean })
HomeAlertClear { outcome: "cleared"|"dismissed"; note? } → HomeAlert
HomeAlertRule { home_alert_rule_id; key; name; metric; threshold: string; window_days: number|null; severity; permission_key; enabled }
HomeKpiCards (picker) as §7.3
HomeReport { home_report_id; name; source; schedule: {…structured} | null; formats: ("pdf"|"xlsx")[]; status: "scheduled"|"paused"|"on_demand"; audience: string; next_run_at: IsoDateTime|null }
HomeReportRun { home_report_run_id; number; report: string; run_at; status; format; recipients: string; document_id: Uuid|null }
```
Rules that fall out: a figure's title/caption/summary strings are **copy** the crawl checks (gate 8:
Title Case, word limits) but only for the Operations account on the mock; keep server labels short
and Title Case in the catalogue itself, and unit-test the catalogue's labels against `scripts/check/lib/copy.js`
(`LIMITS.title`, `LIMITS.kpiCaption`, `titleCaseViolation`). `can_clear` per alert lets the UI hide Clear
Alert for a viewer who can see but not clear (hiding is a courtesy, the API enforces).

---

## 9 · The screen gates, exactly

`scripts/check/lib/copy.js` `LIMITS` (FRONTEND_GUIDE §5.3 mirrors it; words = tokens containing a letter,
so numbers, dates and money are free):
```js
pageTitle: 3, pageSubtitle: 8, title: 4 /* card, section, modal, KPI */, kpiCaption: 5,
button: 3 /* buttons, tabs, filter chips */, fieldLabel: 4, placeholder: 3, fieldError: 4,
toast: 8, emptyText: 8, chartCaption: 8, help: 35, details: 60, sentence: 20, phoneFirstScreen: 40
```
- Title Case (`titleCaseViolation`): first word and every non-minor word capitalised, each hyphen part too
  (minor words: `a an and as at but by for from in into nor of on onto or per the to vs via with`);
  tokens with a digit, `.`, `@` or `/`, ALL CAPS (KPI, CEO, PDF) and mixed case (iOS) are skipped.
  "Clock-in" passes (minor part), "Who can clear" fails.
- Explainer titles: `/^(how|why|what|when|where|about)\b/i` or `/\b(is|are|isn't|aren't)\b/i` in any title slot.
- Banned buttons: `submit ok okay yes no "click here"`.
- Dashes: `/[—–]|(^|\s)--(\s|$)/` anywhere in copy, except a value that is only the empty-value marker.
- **Gate 8 (`five-second.js`)** crawls slots `[data-ui=page-title|page-subtitle|title|kpi-caption|button|chart-caption|empty-text|help|details|modal-footer|nav-label]`,
  `th` (column headers: Title Case), and `p, dd, li` prose (longest sentence ≤20) inside `[data-ui=page]`/`[data-ui=modal]`,
  skipping `[data-copy=content]`, `td` and `[data-ui-ignore]`. Fails: a subtitle or chart caption visible on a phone;
  help or details open on load; **any text in a modal footer** (buttons only). Statically it also reads literal
  `toast("…")` strings (≤8 words) and literal copy props of `PageHeader title/subtitle/sub`, `Card/CardHeader/Modal/SidePanel/ConfirmDialog/EmptyState/KpiCard/Sheet title`,
  `HelpTerm/InfoButton/CardHeader text|help`, `EmptyState text|sub`, `Card/Details details` anywhere in app source.
  A hand-written heading in a feature must carry `data-ui="title"` or `data-copy="content"` (the alert dialog's `<h3 data-copy="content">` does).
- **Gate 11 (`two-shells.js`)** at 390×844 (touch) and 1440×900: page or scroller sideways scroll; desktop
  rail on a phone / no bottom bar; bottom bar on desktop; **any visible `<table>` on a phone** outside content;
  any interactive element under 44×44 on a phone (help terms exempt); >40 words of interface copy in the first
  phone screen (every visible non-content text node in `[data-ui=page]` above 844 px); any script/console error
  or native dialog.
- **Crawl coverage:** the app target signs in as `cynthia@mycityapp.io` / `demo1234` (Operations) and opens each
  tab once (`app/dist/screens.json`); it does **not** open modals in the app, and never sees the CEO, Partnerships
  or Staff Overview, nor a gated tab. FRONTEND_GUIDE §9.4: "a screen only Staff or the CEO see is held to the same
  rules by review until the crawl signs in as them too". Cover those in Vitest (§10).
- **Gate 12 (`forms.js`)**: raw form elements / react-hook-form outside `packages/ui/src/form/`; native date
  input; placeholder >3 words or ending in `.`; Submit/OK. Field errors ≤4 words (INTERIM rule messages and
  `shortMessage()` for schema issues: "Required", "Too short", "Choose one", "Check the format", …).
- **Components (`components.js`)**: no `app/src/components/*`; no feature component named like a `@mycity/ui`
  export (e.g. do not declare `KpiDetail`, `Tile`, `Bars`, `Chips` in `features/home`).
- **Palette (`palette.js`)**: no hex, no arbitrary class, no `style=` in `app/src`. Existing `[.grid_&]:mb-0`
  in blocks.tsx is an arbitrary **variant** the regex does not catch; do not add more.
- **a11y (`a11y.js`)**: axe, every rule on (contrast included), on every app screen at both sizes as Operations,
  plus the self-opened prompt. Heading order matters (CardHeader is h2 under the page h1; Tile is h2 unless `level`).

Run: `npm run ci` (whole suite, CLAUDE.md step 5); quicker loops `npm run fe:typecheck`, `npm run fe:lint`,
`npm run fe:test`, `MYCITY_SCREEN_TARGETS=app node scripts/check/five-second.js --screen=Home`,
`MYCITY_SCREEN_TARGETS=app node scripts/check/two-shells.js --screen=Home`, `MYCITY_A11Y_TARGETS=app node scripts/check/a11y.js`
(Chromium: `npx playwright install chromium` once). The crawl rebuilds `app/dist` (`npm run build:demo`) when
older than `app/src`.

---

## 10 · Tests

- Vitest 4 in each workspace (`npm -w @mycity/app test` = `vitest run --passWithNoTests`; `npm run fe:test`
  runs all three). The app has **no `test` block** in `app/vite.config.ts`: default environment is node,
  a component test opts in with a first-line comment `// @vitest-environment jsdom`. Tests live **beside the
  source** (`app/src/shell/nav.test.ts`, `app/src/shell/screen-action.test.tsx`, `app/src/features/people/status.test.ts`).
- Helpers: `@testing-library/react` (`render`, `renderHook`, `cleanup`), `@testing-library/user-event`,
  and `@mycity/ui/testing`: `axe(container)` (contrast and `region` off in jsdom), `axeMatchers`,
  `installMatchMedia`, `setViewport` (phone vs desktop). Pattern from `packages/ui/src/display/KpiDetail.test.tsx`.
- Wrappers a Home component test needs: `RouterProvider` (`@/lib/router`), `ScreenActionProvider`
  (`@/shell/screen-action`), `ModalProvider` (`@mycity/ui`), and an `AuthProvider` or a mocked `useMe`.
  Stub data by mocking `@/api/hooks` (`vi.mock`) rather than the in-browser mock (keeps tests fast and
  the mock out of the graph).
- What to test for Home (the crawl cannot):
  1. `features/home/access.ts`: tab gating per capability set (staff, line manager, function lead, CEO), and
     that it agrees with `src/shared/search/screens.js` `tabVisible` (a backend jest test can import the same table).
  2. Gated state renders the title, the Locked empty state, and no request is made.
  3. Each role's Overview payload renders with no section the server nulls, two KPI cards per row on a phone
     (`setViewport`), no `<table>` on a phone, and no copy over the limits (import `scripts/check/lib/copy.js`
     LIMITS in a test to assert server-provided titles/captions in fixtures).
  4. Picker draft functions (§7.3) as pure unit tests.
  5. Alerts columns: on a phone the card shows Who Can Clear, Over By (as a help term), Severity; Trigger and Age not.
  6. Clock prompt opens once when `prompt_clock_in` is true and not again on re-render.

---

## 11 · Frontend work per PR (decision 9)

| PR | Frontend scope | Removes from `types/home.ts` | Ticks (PROGRESS) |
|---|---|---|---|
| 1 foundation | `Me.capabilities` consumed: `AuthValue.has()`, `visibleTabs` + `tabVisible` on capabilities, gated state component in `features/home`, mock identity returns capabilities, `features/home/access.ts` + tests; guide §10 updated for gated tabs, picker, clock trigger | nothing yet (unless foundation lands KPI catalogue routes) | M0/M1 notes only |
| 2 overview | Overview on contract (cards, sections, chart), KPI detail on contract (+ `?kpi=` deep link), picker modal + draft model, clock-in trigger moved from Shell to Overview, New action + `actions.js` entry, two-to-a-row cards on phone, all tier 3 strings gone | overview, kpi meta, kpi rows | #1 API (staging opens), UI, Mobile |
| 3 team | Team on contract (summary, roster with filters), person sheet, phone card columns, Attendance This Month | team, team summary | #86 |
| 4 alerts | Alerts on contract, capability gating for rule management, Over By HelpTerm, alert dialog footer, Edit Rule, View Dismissed, rule form on schema with ChoiceField severity, zero states, `?id=` / `?category=` deep links, New Rule action | alerts, summary, clear, alert-rules | #2 |
| 5 reports | Reports on contract, report Wizard, card actions (Run Now with idempotency key, Pause/Resume, Edit), runs list with real download, Overview Export on a real route, New Report action | reports, summary, run, runs | #3 |

Each PR: retype `mock/modules/home.ts` to the contract types for what moved (keep it for the crawl), keep the
staging seed and mock in step (F13), update `docs/guides/home.md` (§10 tables + Change log line), PROGRESS
row ticks with a day-first date and a note, PR body "Native app feel" section (phone and desktop measures).

---

## 12 · Pitfalls (each one costs a CI round)

1. Contract key + INTERIM key for the same route = TypeScript error. Switch in the same PR.
2. A filter not in the contract's `listQuery` = 422 at runtime (the mock also 422s unknown keys).
3. `usePaged` filters object identity: build it inline from state (`filters: cat === "all" ? {} : { category: cat }`);
   the hook serialises it, so a new object each render is fine, but never put `page`/`q`/`sort` in it.
4. Opening a modal replaces the open one; closing the alert dialog must also clear `?id` (`onClose`).
5. A HelpTerm inside a sortable header nests buttons (axe failure). Keep Over By unsortable.
6. `PageHeader title` from server data (greeting) is still checked for ≤3 words and Title Case.
7. Server-composed strings (KPI captions, summaries, activity text, report cadence) are copy: no em dashes,
   ≤ limits, Title Case for titles. The dashes gate scans `src/` string literals too.
8. Do not import the mock or its data (`@/api/mock/data/*`) from a feature: the release build would carry it.
9. `toLocaleDateString`/`toLocaleTimeString` need an explicit locale (the mock uses `"en-GB"` with
   `timeZone: "Africa/Lagos"`); prefer `formatDate`, `formatTime`, `formatWhen` from `@mycity/ui`.
10. Pills are content (`data-copy`), not chrome, but the KPI title/caption, card titles, chip labels and
    column headers are chrome and are crawled.
11. `IconButton` only for close, search, more, back, filter (§5.5); anything else needs a word.
12. `EmployeePicker` needs the People grant; a manager building a report may not have it (use
    `ColleaguePicker` or `RolePicker`).
13. Capability codes are two segments in the contract regex; the CEO passes every capability check, so test with a non-CEO.
14. The crawl only sees Operations on the mock: CEO, Partnerships, Staff layouts and gated tabs ship untested
    by gates 8, 11 and a11y unless Vitest covers them.
15. A "New" in `useScreenAction` whose label is a variable fails search-coverage ("a label that is not written out is refused").
16. Keep `Grid`'s 12 px bottom space in mind when stacking (`flush` drops it); never add margins with arbitrary values.

---

## 13 · Conflicts found (docs vs code vs decisions)

1. **Gated tab state is unreachable.** home.md §10.1 and §11 say a staff member opening Team, Alerts or
   Reports sees a lock, "For Managers", "This tab is for managers and the CEO."; `shell/access.ts`
   `visibleTabs` hides those tabs and `Shell.tsx` redirects a URL to them ("An unknown module or tab, or one
   the person may not open, lands on the first allowed screen", FRONTEND_GUIDE §9.2 says the same), and
   `src/shared/search/screens.js` `tabVisible` mirrors the hiding.
2. **Decision 2 vs the contract.** `identity.Me` (strict) has no `capabilities`; `CapabilityCode` allows two
   segments only, so `home.alerts.manage` is invalid for `RoleSave`; home.md header still lists permission
   keys `home.team`, `home.alerts`, `home.alerts.manage`, `home.reports` as permission keys, and the current
   UI gates rule management on `grants.home.edit` and tabs on `manages_people`/`settings` grants.
3. **Endpoints in code but not in guide §5:** `/home/kpi/:key/meta`, `/home/team/summary`,
   `/home/alerts/summary`, `/home/reports/summary`, `/home/report-runs`; guide §5 has
   `/home/reports/:id/runs` instead, and no `PATCH /home/reports/:id`, `GET /home/alerts/:id`, picker or
   export route. KPI filters: guide "mode, status, date" vs INTERIM `group`; Team filters guide
   "department, status, mode" vs INTERIM `status`; Alerts guide "category, severity, mine, age" vs INTERIM `category`.
4. **F12 vs practice:** F12 and FRONTEND_GUIDE §9.5 say a module's mock is deleted when its real routes ship
   (identity the only exception); organisation, settings, ess, security, community, mailbox mocks were kept
   and retyped, and the screen gates crawl the mock build, so deleting Home's mock breaks gates 8, 11 and a11y.
   "Each mock response is checked against the contract" has no runtime check, only TypeScript.
5. **Clock-in prompt trigger:** home.md §3 step 1 "On the first sign-in of the day, Home opens the clock-in
   prompt"; attendance.md §10.2 "After sign-in it opens by itself for anyone not yet clocked in"; code: the
   Shell opens it after every explicit sign-in (`justSignedIn`), not once a day, and not from Home.
6. **Naming:** home.md "Need You"; foundation.md §4 "Home's Waiting on You card"; FRONTEND_GUIDE §8.7
   "Needs you"; Alerts KPI "Needs You".
7. **KPI detail groups:** home.md §3 step 3 lists on site, remote, **field**, late, no clock-out, on leave;
   §10.1 lists On Site, Remote, Late, **No Clock-Out Yesterday**, On Leave; the mock adds "Not in".
8. **Server-formatted values vs FRONTEND_GUIDE §3** ("Format at render time only"): INTERIM KPI values,
   subtitles, `when` and `day` strings, money as "₦9.2M" all arrive preformatted.
9. **Report detail in §10.1 vs §2:** §2 says build, filters, recipients, schedule, run now, download PDF or
   XLSX; §10.1 tier 1 lists only cards (name, schedule and contents, status, audience), Recent Runs and New
   Report: no Run Now, Pause, Edit, Download.
10. **Alerts dismiss:** API and §4 have `outcome: dismissed` and §10.1 has View Dismissed, but the alert
    dialog in §10.1 has only Close, Edit Rule, Clear Alert (current code has Dismiss).
11. **Rule form vs API:** §5/§2 "create or edit rules (threshold, window, severity, who clears)"; §10.1 form
    has no "who clears" field.
12. **Team chips** (Everyone, Late, Remote, On Leave, No Clock-Out) are in the code but not in §10.1 Team.
13. **Totals:** Team and Alerts print `"{n} people"` / `"{n} open"` beside the list while FRONTEND_GUIDE §4
    says the Pager is the only place the total appears.
14. **Tier 3 in current UI copy:** Field `info` "High severity escalates to the CEO after 14 days." and
    "The query the report runs: the same one its screen uses…" are tier 3 per §10.1; so are the overview's
    `note` blocks, the donut's rule sentence, the KPI meta sub "Grouped the way the rules read them." and
    toasts "logged against you" / "It runs next cycle".
15. **Personal picker and role_kpi (decision 5)** have no §10 rows; CLAUDE.md requires the guide to change first.

## 14 · Open questions (each with a recommendation)

1. Gated tabs: keep Home's four tabs visible to everyone with `home` view and render the lock (guide), or
   keep hiding them (shell)? **Recommend visible + lock** for Home only, with `tabVisible` in ⌘K still hiding
   them (search should not offer a screen that only shows a lock).
2. Alerts tab gate: `alerts.clear` OR the manage capability? **Recommend** yes, and rename the manage code to a
   two-segment one (e.g. `alerts.manage`) rather than widening the regex.
3. Overview "New": what does it create? **Recommend** a `Menu` of the person's create actions taken from the
   same list as ⌘K's actions (`GET /search` actions the reader may run), labelled "New" on the button and
   Verb Noun per item, registered with `useScreenAction({ label: "New Task" … })` only if it is one action.
4. Where the KPI picker opens. **Recommend** a ghost Button "Choose Cards" beside Export on desktop and an item
   in the phone's page Menu (⋮), added to §10.1/§10.2 first.
5. Where role defaults and locks (`role_kpi`) are edited. **Recommend** Settings · Roles & Permissions, a
   "Home Cards" section on the role (owner of settings guide to agree).
6. Overview payload: server-driven `blocks[]` (today) or typed nullable sections (§8 PROPOSAL)?
   **Recommend** typed sections: the client owns layout per §10.2, gates can read static copy, zero-data is
   explicit.
7. KPI values typed vs preformatted strings. **Recommend** typed (`kind`, `value`, `total`), formatted with
   `formatCount`/`<Money short>`.
8. Team row action: person sheet (guide §10.2) or People 360 (today)? **Recommend** the sheet on both shells,
   with Open Profile / View Attendance when `can("people")`.
9. Attendance This Month: bounded top-N or paged? **Recommend** a paged read (`/home/team/attendance`) or the
   roster's own KPI column, since §11 says the Team roster pages at 25.
10. Report schedule input: free cron, or structured cadence the server turns into cron? **Recommend**
    structured (`cadence`, `time`, `weekday`, `day`) with `ChoiceField` + `TimeField`; no new component.
11. Overview Export: a report run (vault, numbered) or a mailbox export (202)? **Recommend** a Home route that
    queues it like `POST /audit/exports` and toasts "Export queued, check your Mailbox".
12. Clock-in trigger: server flag on the overview (once per Lagos day) or keep the client `justSignedIn` rule?
    **Recommend** the server flag and remove `useClockPrompt()` from the Shell in the overview PR.
13. Deep links: `?kpi=<key>` (KPI modal), `?category=` and `?id=` (Alerts) need `GET /home/alerts/:id` and the
    `kpi` param read on mount. **Recommend** adding both to §5 and §9.
