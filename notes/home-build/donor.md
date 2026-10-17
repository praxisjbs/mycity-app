# Brief: the KPI catalogue, role KPI config and personal picker (code to port, and its MyCity shape)

Audience: whoever writes PR 1 (foundation) and PR 2 (overview) of Home. Read-only research; nothing in
either repo was changed. Reference repo checked out at `/home/user/praxis-ls` (called "the reference"
below). Target repo `/home/user/mycity-app`.

Sources read in full: reference `src/modules/dashboard/kpi_catalog/{index,shared,guards,eligibility,resolve,human_capital}.js`
(skimmed `money.js`, `operations.js`), `src/modules/dashboard/dashboard/{dashboard.service,dashboard.repo,dashboard.controller,dashboard.routes,dashboard.ai}.js`,
`src/modules/security/role_kpi/*`, `migrations/tenant/13800_role_kpi_config.sql`, `migrations/seeds/9023_seed_role_kpi_defaults.sql`,
`9024_seed_role_kpi_hr.sql`, `src/modules/preference/preference.{service,validator}.js`, `src/modules/security/permission/permission.service.js`
(prune hook), `client/src/features/dashboard/{kpi-model.ts,drilldowns.ts,components/kpi-picker.tsx,components/kpi-strip.tsx}`,
`doc/KPI_BAND_ENGINEERING_GUIDE.md` §2 to §11. MyCity: `docs/guides/home.md`, REUSE_MAP §2.1/§3.2, MILESTONES §6.1 and A23/A26,
`src/shared/access/access.catalog.js`, `src/middleware/rbac.js`, `src/shared/rbac/{grants-cache,field-mask,scope}.js`,
`src/modules/identity/identity.{service,repo}.js` (`me()`), `src/modules/access/access.{service,events}.js`,
`seeds/reference/{0290,0449,1099,2099,4099,5099,7099,8099}_*.sql`, migrations `0020 0040 0050 0070 0110 0300 0350 0400 0410 1000 1100 2000 4000 5000 7000 8000 9090`,
`app/src/api/mock/modules/home.ts`, `app/src/api/types/home.ts`, `app/src/features/home/*`, `docs/COMPONENTS.md` (KpiCard, KpiDetail, KpiGrid, Modal, Sheet),
`docs/MIGRATIONS.md` §6, §7, §9, `scripts/check/{provenance,pagination,money,schema-drift,contract-columns}.js`, `scripts/check/lib/copy.js`.

---

## 0 · The provenance gate, first

`scripts/check/provenance.js` scans `src/ scripts/ tests/ packages/ migrations/ seeds/ templates/ ops/ .github/ .claude/ app/ public-app/`
and root config files, line by line, and fails on:

```js
const PATTERNS = [
  [/pixie/i, "names another project"],
  [/praxis[-_ ]?ls\b/i, "names another project"],
  [/\bdonor\b/i, "refers to donor code"],
  [/\bported\s+from\b|\bport(ed)?\s+of\b/i, "says where code was ported from"],
  // "praxis" alone, except the product's own names
  [/(?<!jbs\s)\bpraxis\b(?![\s_-]*ai\b)/i, "names another project"],
];
```

Allowed: "Praxis AI", `praxis_ai`, "JBS Praxis". Not scanned: `docs/`, `README.MD`, `CLAUDE.md`.

Beyond the gate, strip every reference-only idea from comments and names, because each one is wrong here
(not gate-enforced, but a reviewer will catch it and it misleads the next reader):

| Strip | Why |
|---|---|
| "Control Tower", "tower", "band" as a product noun, "tile" in user copy | MyCity calls them KPI cards on Home (guide §2, COMPONENTS `KpiCard`). Code may keep `tile`/`band` internally, but say "card" on screen |
| "tenant", "LIVE / TEST", "sandbox", `identityDb` / `tenantDb`, `to_regclass` "module installed in this schema" | Single tenant, one database, one schema. No env pinning |
| `MOD-00A`, `MOD-02`, `MOD-14` … | Module keys are the 15 lower-case keys in `access.catalog.js` |
| `can_read` | MyCity column is `permission.can_view` |
| "D1…D12", "PR-1…PR-4", "guide §6.4", `doc/KPI_BAND_ENGINEERING_GUIDE.md`, `0110_rbac.sql`, `13800`, `9023` | Reference planning artefacts |
| `XAF`, `Africa/Douala`, `hr.timezone`, `hr.weekend_days`, OHADA | Naira only (`shared/money`), Africa/Lagos (`shared/time/lagos.js`), working week is the `working_week` table |
| `labelKey` / `hintKey` / `dash.*` i18n keys | MyCity has no i18n; labels are English strings governed by `scripts/check/lib/copy.js` |
| `@silent:guard` taxonomy markers | Not a MyCity convention |
| emoji (`🔒`) in UI | Lucide icons and a `Pill` only |

---

## 1 · What the reference does (the parts to port)

### 1.1 `kpi_catalog/shared.js`: vocabulary + per-entry validation

```js
const MAX_BAND_TILES = 4;
const DOMAINS = Object.freeze(["money","operations","fleet_warehouse","sales_procurement","human_capital"]); // = picker group order
const UNITS = Object.freeze(["money", "count", "pct", "pair", "days"]);
const TONES = Object.freeze(["orange", "ok", "warn", "bad", "blue", "mute"]);
const STATUSES = Object.freeze(["live", "hidden"]);
function assertEntry(entry) { /* throws `kpi_catalog: bad entry:` listing every problem */ return entry; }
```

`assertEntry` checks: `id` matches `/^[a-z0-9][a-z0-9_]{1,39}$/`; `domain ∈ DOMAINS`; `unit ∈ UNITS`; `module` matches `/^MOD-[0-9A-Z]+$/`;
`status ∈ STATUSES`; `tone ∈ TONES`; `labelKey` starts `dash.`; `sourceRelation` present; `sensitive_field` null or `/^[a-z_.]+$/`;
`drillTo` null or string. Units: `pct` and `pair` resolve as `{ value, denominator }`; the rest as a scalar.

### 1.2 `kpi_catalog/guards.js`: the three query guards (the zero policy lives here)

```js
/** count → integer, null when the relation/query is missing. */
async function count(client, sql) {
  try { const { rows } = await client.query(sql); return Number(rows[0].n); } catch { return null; }
}
/** scalar → number, SQL NULL preserved as null. */
async function num(client, sql) { /* rows[0].n === null → null, else Number() */ }
/** two columns → { value, denominator }; null only when the query itself fails. */
async function ratio(client, sql) {
  try {
    const { rows } = await client.query(sql);
    if (!rows[0]) return null;
    const value = rows[0].value;
    return { value: value === null || value === undefined ? 0 : Number(value), denominator: Number(rows[0].denominator) || 0 };
  } catch { return null; }
}
```

Contract: **a number (including 0) renders; `null` means unavailable and the card is dropped and counted as hidden.**
Ratios keep their denominator so "0 % over 30" and "0 % over nothing" are different (`measurable = denominator > 0`).
Note the guards take bare SQL with no params; MyCity needs params (scope, today), see §3.3.

### 1.3 `kpi_catalog/index.js`: assembly, self-checks, values

Exports `{ MAX_BAND_TILES, DOMAINS, UNITS, TONES, STATUSES, CATALOG, BY_ID, LIVE_IDS, assertCatalogSane, checkValueCoverage, availableRelations, publicMeta, valuesFor }`.

```js
const DOMAINS_BY_NAME = { money: require("./money"), /* … */ human_capital: require("./human_capital") };
const CATALOG = Object.freeze(DOMAINS.flatMap((name) => DOMAINS_BY_NAME[name].ENTRIES).map(assertEntry));
const BY_ID = new Map(CATALOG.map((e) => [e.id, e]));
const LIVE_IDS = Object.freeze(CATALOG.filter((e) => e.status === "live").map((e) => e.id));
// … last line of the file, a require-time side effect:
assertCatalogSane();
```

- `assertCatalogSane()` (sync, at require): duplicate id; domain with no module file; a `live` entry whose domain has no `values()`. Throws
  `kpi_catalog:\n  <problems>` so a broken catalogue fails the boot.
- `checkValueCoverage()` (async, called by the test): runs every domain's `values()` against a client whose `query` always rejects
  (`{ query: () => Promise.reject(new Error("self-check")) }`). Because guards swallow, every key a domain writes still appears. Fails on:
  `values()` threw, an id answered by two domains, an answered id that is not live, a live id with no answer.
- `availableRelations(client)`: one `SELECT to_regclass($1::text) IS NOT NULL AS r0, …` over every distinct `sourceRelation`; on probe error
  returns all relations (never empties the band).
- `publicMeta(entry)`: `{ id, domain, unit, module, status, tone, icon, labelKey, hintKey, badgeKey, drillTo }` (no SQL, no sensitive field).
- `valuesFor(client, ids)`: keeps only live, known ids; calls each domain's `values(client, guards)` **once per domain that has a wanted id**
  (so asking for one tile runs every query in that domain); normalises numbers/ratios; any wanted id not answered becomes `null`.

### 1.4 `kpi_catalog/eligibility.js`: two reads, shared by the user path and the role editor

```js
const MODULES = [...new Set(CATALOG.map((e) => e.module))];
const FIELD_KEYS = [...new Set(CATALOG.map((e) => e.sensitive_field).filter(Boolean))];
async function readableModules(client, roleIds)   // SELECT DISTINCT module_key FROM permission WHERE role_id = ANY($1) AND can_read AND module_key = ANY($2)
async function maskedFields(client, roleIds)      // any role with visibility <> 'visible' masks (most RESTRICTIVE wins)
function eligibleIds(readable, masked, { isCeo = false } = {})  // live ∩ (isCeo || readable.has(module)) ∩ !(sensitive_field && masked.has(it))
async function resolveEligibility(client, { roleIds, isCeo = false }) // → { readable, masked, liveIds }
```

Rule in one line: `eligible(tile) = live AND (CEO OR any role can read tile.module) AND NOT masked(tile.sensitive_field)`.
Availability is deliberately **not** part of eligibility (a role being edited has no "current schema").
`roleIds: []` is "no grants", never a wildcard.

### 1.5 `kpi_catalog/resolve.js`: pure precedence, painting and the picker model

```js
const SYSTEM_DEFAULT_IDS = Object.freeze(["revenue","receivables_overdue","sla_on_time","fleet_utilisation"]);
function keepEligible(ids, eligible /* Set */)      // drops non-strings, dupes, non-live, ineligible; keeps order
function selectBand({ pins, roleConfigs = [], eligible }) // → { source: "user"|"role"|"default", ids }
function paintBand(selection, values)              // → { source, slots, hidden }
function pickerModel({ eligible, available = null, locked = [], defaultIds = [], currentIds }) // → picker payload
```

`selectBand` is the heart; copy its logic exactly:

```js
function selectBand({ pins, roleConfigs = [], eligible }) {
  const locked = keepEligible([...new Set(roleConfigs.flatMap((c) => c.lockedIds || []))], eligible);
  const putFirst = (ids) => [...locked, ...(ids || []).filter((id) => !locked.includes(id))];
  if (Array.isArray(pins)) {
    return { source: "user", ids: putFirst(keepEligible(pins, eligible)).slice(0, MAX_BAND_TILES) };
  }
  const merged = keepEligible(roleConfigs.map((c) => (c && c.defaultIds) || []).flat(), eligible);
  if (merged.length) return { source: "role", ids: putFirst(merged).slice(0, MAX_BAND_TILES) };
  const fallback = keepEligible(SYSTEM_DEFAULT_IDS, eligible);
  return { source: "default", ids: putFirst(fallback).slice(0, MAX_BAND_TILES) };
}
```

Rules encoded there (all have tests to port, §6):
1. Precedence: user pick > role defaults (merged) > system default. **`null` pins = never chosen; `[]` pins = chose empty** (empty band is honoured).
2. Locked ids lead the band whatever the base, including against the user's own pins and an empty pick.
3. Multi-role merge = concatenate each role's defaults in role order, dedupe, take 4 (no "per-slot winner").
4. Eligibility filters every source (pins, defaults, fallback). Nothing is substituted: a lost tile shrinks the band ("shrink, never pad").

`paintBand`: a `null`/`undefined` value → id goes to `hidden`, slot dropped; an object value → `{ value, denominator, measurable: denominator > 0 }`;
slots carry `publicMeta` so the payload is self-describing.

`pickerModel` returns `{ maxTiles, tiles /* offerable metas */, lockedIds, roleDefaultIds, currentIds /* null or filtered to offerable */, hiddenTileCount, totalLive }`.
`hiddenTileCount` = eligible-but-not-offerable count; never an enumeration of what the caller lacks.

### 1.6 `kpi_catalog/human_capital.js`: the six tiles

Entry shape (one shown; the other five differ only in the fields tabulated in §4.2):

```js
{ id: "headcount", domain: "human_capital", unit: "count", module: "MOD-02", sourceRelation: "employee", status: "live",
  labelKey: "dash.headcount", hintKey: "dash.headcountHint", badgeKey: null, tone: "blue", icon: "people",
  drillTo: "/hr/employees", sensitive_field: null }
```

`values(client, { count, ratio })` writes all six keys:

```js
out.headcount        = await count(client, "SELECT count(*) n FROM employee WHERE is_active");
out.attendance_today = await ratio(client, ATTENDANCE_TODAY_SQL);   // expected set: active, working day (employee work_days else weekend setting),
                                                                     // minus APPROVED/TAKEN leave covering today, minus public_holiday (incl. recurring);
                                                                     // value = expected with a clock_in in [today 00:00, tomorrow 00:00) in the org zone
out.leave_pending    = await count(client, "SELECT count(*) n FROM leave_request WHERE status = 'REQUESTED' AND COALESCE(kind, 'leave') <> 'salary_advance'");
out.vacancies_open   = await count(client, "SELECT count(*) n FROM vacancy WHERE status = 'OPEN'");
out.payroll_run_state= await count(client, "SELECT count(*) n FROM payroll_run WHERE status NOT IN ('DISBURSED','REJECTED')"); // sensitive_field employee.salary
out.attrition_90d    = await count(client, "SELECT count(*) n FROM event_log WHERE event_type_key = 'employee.deactivated' AND created_at >= now() - interval '90 days'");
```

Keep the **intent** of the comments, not the SQL (rewrites in §4.2): attendance denominator is the expected set, not headcount ("a Sunday that
reads 0 / 25 asserts 25 absences nobody was expected to commit"); "today" is the organisation's zone, never `clock_in_at::date` on the server
clock; payroll is "runs not in a terminal state" (a stuck old run counts); the tile and its hub must count the same queue.

### 1.7 `dashboard/dashboard.service.js`: band assembly (the parts that matter)

```js
async function bandIdentity(client, user)   // → { pins, roleConfigs:[{roleCode, scopeIds, defaultIds, lockedIds}], eligible:Set, isCeo }
function scopeFilter(ctx)                    // null when any role config has scope null (dynamic) or there are no configs; else Set(union of scopeIds)
async function kpiBand(bizClient, ctx)       // pins ∩ scope → selectBand → valuesFor → paintBand; hidden = dropped pins ∪ painted.hidden
async function kpiCatalogPayload(bizClient, ctx) // offerable = eligible ∩ available(sourceRelation) ∩ scope; locked/defaults via keepEligible;
                                                 // + source (same selectBand) + roleNames
```

`bandIdentity` reads pins from `preferenceService.getShell(client, user.user_id).kpiPins`, role configs from `roleKpi.getConfigs(client, roleIds)`,
eligibility from `resolveEligibility`. `kpiBand` also returns legacy flat keys; MyCity has no legacy, drop that. Routes:
`GET /dashboard/kpis` (band) and `GET /dashboard/kpi-catalog` (picker), both `requirePermission(MODULE, "view")`.
The controller's two-client sequencing (`req.identityDb` then `req.tenantDb`) is a multi-schema artefact: **do not port it**.

### 1.8 `security/role_kpi/`: per-role defaults, locks, scope

Table (reference `13800`):

```sql
CREATE TABLE IF NOT EXISTS role_kpi_config (
  role_id     uuid PRIMARY KEY REFERENCES role(role_id) ON DELETE CASCADE,
  scope_ids   text[],                       -- NULL = everything the role can read (dynamic)
  default_ids text[] NOT NULL DEFAULT '{}',
  locked_ids  text[] NOT NULL DEFAULT '{}',
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (scope_ids IS NULL OR default_ids <@ scope_ids),
  CHECK (locked_ids <@ default_ids),
  CHECK (array_length(default_ids, 1) IS NULL OR array_length(default_ids, 1) <= 4)
);
```

Ids are bare text, no FK (the catalogue is code); unknown ids fail closed at read time.

`role_kpi.repo.js`: `get(client, roleId)`, `getForRoles(client, roleIds)` (JOIN role, `ORDER BY r.created_at ASC` = merge order), `upsert`, `clear`, `replaceArrays`.

`role_kpi.service.js`:
- `put(client, { roleId, config, actor })`: `config === null` deletes the row (back to default). Validation order and error codes:
  `ROLE_NOT_FOUND` 404; `UNKNOWN_KPI_ID` 422 (not in catalogue); `TOO_MANY_TILES` 422 (> 4 defaults); `DUP_TILE` 422;
  `LOCKED_NOT_DEFAULT` 422 (locked ⊄ default); `KPI_NOT_LIVE` 422 (hidden id); `KPI_NOT_READABLE` 422 (explicit scope names a tile the role
  cannot read, message names the module grant needed); `DEFAULT_OUT_OF_SCOPE` 422. Then upsert and audit `role.kpi_changed` with before/after arrays.
- `getForRole(client, roleId)` → `{ config|null, eligibleIds, liveIds, tiles: publicMeta[] of live∩eligible-for-the-role }`. Labels for the editor come
  from here so an admin can configure a role whose modules the admin cannot read.
- `pruneUnreadable(client, roleId)`: filter all three arrays to the role's current eligibility; if defaults and scope both empty, delete the row.
- `eligibleForRole(client, roleId, roleCode)`: `readableModules([roleId])`, `maskedFields([roleId])`, `isCeo = code === "CEO"`.

Prune trigger (reference `permission.service.js`): after any grant write that leaves a role without read on a module,
`pruneRoleKpiBestEffort` calls `roleKpi.pruneUnreadable` **outside** the grant transaction, logs and swallows failures ("revoking access is the
security act; tidying a display row is not"; the read-time filter makes a missed prune harmless).

Validator (`role_kpi.validator.js`): body `{ config: null | { scopeIds?: id[]≤64 | null, defaultIds: id[]≤4 = [], lockedIds: id[]≤4 = [] } }`,
`config` key required. Routes: `GET /roles/:id/kpi` (view), `PUT /roles/:id/kpi` (edit), both on the roles module.

Seeds `9023`/`9024`: curated defaults per role code, intersected with the role's real read grants at seed time, `scope_ids NULL`, `locked '{}'`,
`ON CONFLICT (role_id) DO NOTHING`. HR's curated four: `headcount, attendance_today, leave_pending, vacancies_open`.

### 1.9 The user's pick (reference `preference` module)

`user_preference` rows, section `shell`, key `kpi_pins`. Validator: `kpiPins: z.array(z.string().regex(/^[a-z0-9][a-z0-9_]{1,39}$/)).max(4).nullable().optional()`.
Doctrine: absent key untouched; `null` deletes the row (= never chosen); `[]` is stored (= chose empty). Shape only is validated on write;
the resolver drops unknown/ineligible ids at read. Not audited in the reference (personal preference). MyCity has **no** `user_preference`
table; see §3.6.

### 1.10 Client: `kpi-model.ts`, `kpi-picker.tsx`, `kpi-strip.tsx`, `drilldowns.ts`

`kpi-model.ts` (port the pure functions, drop the types tied to i18n keys):

```ts
export function draftAdd(draft: string[], id: string): string[]            // no-op if present or full (total, never throws)
export function draftRemove(draft: string[], id: string, locked: readonly string[]): string[] // refuses locked ids
export function draftMove(draft: string[], id: string, delta: -1 | 1): string[]               // reorder always allowed, even locked
export function draftInitial(catalog: { currentIds: string[]|null; roleDefaultIds: string[] }, bandSlots: readonly string[]): string[]
  // currentIds ?? roleDefaultIds (if any) ?? what the band paints now
export function draftDirty(draft: readonly string[], stored: readonly string[]): boolean
export function draftToPins(draft: readonly string[], roleDefaultIds: readonly string[]): string[] | null
  // a draft equal (same order) to a non-empty role default saves as NULL (keep following the role); otherwise the array, [] included
export function formatBandValue(slot, currency, t) // money → millions + "M <cur>"; pct → "n" + "%"; pair → "n" + "/ d <noun>"; days; count
```

`kpi-picker.tsx` behaviour worth keeping: draft-then-apply (Cancel writes nothing); re-seed the draft only when the dialog opens or the catalogue
identity arrives, never mid-edit; four slots with move-left/right and remove (remove disabled for locked); grouped, searchable candidate list,
picked rows `aria-pressed`, unpicked rows disabled when full; footer "Restore role default" (sets the draft to role defaults) and "Clear my choice"
(saves `null`); after save invalidate queries so the server re-resolves. Copy to drop (fails MyCity tiers/word limits): dialog description,
the per-tile hint line, the "Showing 12 of 31 — the rest belong to modules you don't have" footer, the 🔒 glyph, raw colour classes.

`kpi-strip.tsx`: cards are real `<button>`s with `aria-haspopup="dialog"`; grid shrinks honestly 4→3→…; an empty band shows one row with the
edit door; a footer "N hidden" count. In MyCity this is `KpiGrid` + `KpiCard` from `@mycity/ui` (both exist).

`drilldowns.ts` structure only: one pure builder per tile id returning
`{ title, badge, meta[], columns[], rows[], note?, cta:{label,to}, empty:{title,hint} }`, built client-side from module list endpoints capped
at 200, plus a `KPI_ROUTE: Record<id, route>` table ("one name for a tile from catalogue to drill to route"). MyCity replaces all of it with the
server-paged report model (`GET /api/v1/home/kpi/:key` + `/meta`, `KpiDetail` component); keep only the per-tile **choice of columns and groups**
(e.g. headcount: Employee, Department, Job Title; attendance: Employee, Department, Clock In, Clock Out, grouped by status).

### 1.11 Guide rules (§4 to §9) to carry over, restated for MyCity

- A card inherits rights, never grants them. Not dimmed, not "no permission": an ineligible card does not exist for that person, in the overview
  or in the picker. The candidate list is computed server-side; a client filter is a hint, not security.
- The role editor cannot pick a card the role cannot read; save errors name the grant needed. A revocation prunes the role config.
- A masked sensitive field hides the card entirely (never shows 0).
- Fixed four, ordered, left to right. Shrink, never pad.
- Zeros assert (0 renders); unavailability hides. Ratios carry their denominator.
- The precedence is computed once, server-side, so the picker preview and the painted cards cannot disagree; `source` is in the payload.
- Drill-downs respect field visibility per row, not only at the card.
- A 403 on a drill says "no access", never "all clear".

---

## 2 · Reference → MyCity deltas (what changes on the way in)

| Topic | Reference | MyCity |
|---|---|---|
| Where | `src/modules/dashboard/kpi_catalog/` + `security/role_kpi/` + `preference` | `src/modules/dashboard/kpi-catalog/{index,eligibility,guards}.js` and `kpi-catalog/tiles/{people,work,business,finance}.js` (README §5.4, stubs exist, all 0 bytes). Role config and picks live in the `dashboard` module (Home owns them). Guide header says module `home`; README says `dashboard`/`alerts`/`reports` (see conflicts) |
| Domains | 5 logistics domains | 4 files already stubbed: `people`, `work`, `business`, `finance`. `DOMAINS = ["people","work","business","finance"]` = picker group order |
| Module key | `MOD-xx`, regex `/^MOD-/` | one of `access.catalog.MODULES` (15 lower-case keys); validate with `catalog.isModule(key)` |
| Read grant | `permission.can_read` | `permission.can_view`; use `rbac.scopeFor(user, key, "view")` (cached, CEO-aware, also gives the scope) |
| Scope | none ("scope-aware rollups out of v1") | **required**: values and details are own/team/all by the card's module grant (guide §5 "`the card's own permission · own/team/all`"); SQL through `shared/rbac/scope.js` `scopeClause` |
| Field masking | any role masked ⇒ masked (most restrictive) | `grants-cache.getMaskedFieldKeys`: masked only when **every** role that mentions the field masks it (most permissive). CEO never masked. Use `fieldMask.maskedKeysFor(client, user)` for users |
| CEO | role code `CEO`; grants bypassed, masks applied | `app_user.is_ceo === true` (a flag, not a role; `0290` header). Every grant, every capability, no masks. A role being edited is never the CEO |
| Capabilities | none | Decision 2: an entry may also require a capability (`alerts.clear`, `home.team`, `home.reports`, `home.alerts.manage`) via `grantsCache.getCapabilities(client, user_id)`; role subject reads `role_capability` |
| Availability | `to_regclass` per relation per request | One database, schema fixed by migrations. Replace with decision 3's source adapters that **declare columns**, checked in a unit test against `scripts/check/lib/catalogue.js` `buildCatalogue()` (the same reading of `migrations/` gate 6 uses). A card over a table no migration creates stays `hidden` with **no SQL at all** (gate 6 rule 4 fails a read of an unknown table) |
| Values call | per domain, every tile in the domain, no params | per entry `value(client, g, ctx)` so only requested cards run; params allowed; `ctx = { user, today, scope(moduleKey) }` |
| Money | `Number()` sums, `millions()` client-side | Gate 20 forbids `Number()`, `+`, `toFixed` on money. A money guard returns the wire string (`numeric(18,2)` from pg is already a string; `money.toWire`). Client renders `<Money value short />` |
| Labels | i18n keys | `label` (Title Case, ≤ 4 words, `copy.js LIMITS.title`), `help` (≤ 35 words, tier 2), optional `caption` builder (≤ 5 words, `LIMITS.kpiCaption`). No em dash (`check:dashes`) |
| Role config table | `role_kpi_config`, PK `role_id`, with `scope_ids` | `role_kpi` (decision 5), PK `role_kpi_id`, `role_id UNIQUE`, `default_ids`, `locked_ids`; MIGRATIONS §6 PK and trigger rules. Scope column: open question (§7) |
| User pick | `user_preference.shell.kpi_pins` | new table (name proposal `user_kpi`), one row per user; no row = never chosen; `'{}'` = chose empty |
| Seeded role defaults | `90xx` tenant seeds | **No SQL seed** (A26: presentation choices are business choices; code runs without them). Code-level defaults per `role.home_view` (§3.5); `role_kpi` rows only from the Settings screen |
| Prune | direct call from `permission.service`, best effort | outbox handler in `dashboard.events.js` on `permission.changed`, `field_visibility.changed`, `capability.changed` (emitted by `access.service.updateRole`; keys from `access.events.js`) |
| Writes | picks not audited | One write path (CLAUDE step 4): picks and role config go through the dashboard service, in a transaction, with `emit()` |
| Drill-downs | client builders over module lists, cap 200 | `GET /api/v1/home/kpi/:key` paged at 25 by `pageQuery`; meta at `/meta`; eligibility re-checked server-side per key; `maskForUser` at the controller |
| Attendance today | its own SQL | Decision 4: read from the shared roster `attendance.roster` (Home writes it, My Attendance reuses it); the card never has its own SQL |
| Headcount, attrition | own SQL, attrition from `event_log` | one definition: `organisation.repo.counts(db, scope)` (`headcount`, `attrition` via `employee.left_on`, `probation_due`) already powers People · Employees; read it through the organisation service |

---

## 3 · MyCity target design

### 3.1 Files

```
src/modules/dashboard/
  kpi-catalog/index.js          CATALOG, BY_ID, LIVE_IDS, PICKABLE_IDS, assertCatalogSane(), valuesFor(), publicMeta()
  kpi-catalog/shared.js         (new file: add to README §5.4 row) MAX_CARDS, DOMAINS, UNITS, TONES, STATUSES, SURFACES, assertEntry()
                                 or fold these into index.js to avoid a README change
  kpi-catalog/guards.js         count, num, ratio, money (§3.3)
  kpi-catalog/eligibility.js    forUser(client, user), forRole(client, roleId), eligibleIds(subject)
  kpi-catalog/resolve.js        (new file) keepEligible, selectCards, paintCards, pickerModel, HOME_VIEW_DEFAULTS
  kpi-catalog/tiles/people.js   ENTRIES (each with value() and detail)
  kpi-catalog/tiles/work.js
  kpi-catalog/tiles/business.js
  kpi-catalog/tiles/finance.js
  sources/<module>.source.js    (decision 3; new dir, add to README) one adapter per forward module: DEPENDS_ON + query functions
  dashboard.repo.js             role_kpi and user_kpi SQL only
  dashboard.service.js          overviewCards(), pickerFor(), savePicks(), resetPicks(), roleCards(), saveRoleCards(), resetRoleCards(), pruneRole(), kpiMeta(), kpiPage()
  dashboard.events.js           EVENTS + outbox handler for the prune
  dashboard.controller.js       req/res only, maskForUser on detail rows
  dashboard.routes.js           { basePath: "/home", surface: "staff", router }
packages/contract/schemas/dashboard.js   (README name; guide says home.js) every shape, with TABLES
```

Every new file goes into `README.MD` (readme-map gate, CLAUDE step 5).

### 3.2 Entry shape (MyCity)

```js
{
  id: "attendance_today",            // /^[a-z0-9][a-z0-9_]{1,39}$/, stable forever (stored in role_kpi / user_kpi)
  domain: "people",                  // people | work | business | finance
  label: "Clocked In Today",         // Title Case, ≤ 4 words
  help: "People clocked in out of those expected today. Leave and holidays are not expected.", // ≤ 35 words, tier 2
  unit: "pair",                      // count | money | pct | pair | days
  module: "people",                  // access.catalog key whose `view` grant gates it and sets its scope
  capability: null,                  // optional capability code also required (decision 2)
  sensitive_field: null,             // a field-mask.js FIELDS key ("employee.salary") or null
  status: "live",                    // live | hidden (hidden = declared, never offered, no SQL)
  pickable: true,                    // false for tab cards (Team, Alerts) that only open details
  tone: null,                        // StatusTone when the figure is itself news ("warn" for overdue)
  source: "attendance",              // the adapter / owning module it reads through (decision 3)
  value: async (client, g, ctx) => g.ratio(client, sql, params), // live only
  caption: (v) => `${v.late} late`,  // optional, ≤ 5 words
  detail: {                          // what GET /home/kpi/:key serves
    title: "Clocked In Today",
    columns: [{ key: "employee", label: "Employee" }, { key: "mode", label: "Mode" }, { key: "clock_in", label: "Clock-In" }, { key: "status", label: "Status" }],
    groups: [{ value: "on_site", label: "On Site" }, /* … */],
    list: (client, query, ctx) => attendanceRoster.page(client, { date: ctx.today, group: query.group }, ctx.scope("people"), query),
  },
}
```

`assertEntry` additionally checks: `catalog.isModule(module)`; `capability` null or a code the capability seed creates; `sensitive_field` null or
`fieldMask.isFieldKey()`; `label`/`help` within `copy.js` LIMITS and contain no em dash; `status === "live"` ⇔ `typeof value === "function"`;
`detail.list` present for live entries. That moves the reference's async `checkValueCoverage` into the synchronous require-time check.

### 3.3 Guards (port `guards.js`, add params and money)

```js
async function count(client, sql, params = []) {
  try { const { rows } = await client.query(sql, params); return Number(rows[0].n); } catch (err) { logger.warn({ err }, "kpi guard"); return null; }
}
async function ratio(client, sql, params = []) { /* { value, denominator } as the reference */ }
async function money(client, sql, params = []) {
  try { const { rows } = await client.query(sql, params); return rows[0] && rows[0].n !== null ? m.toWire(rows[0].n) : m.toWire("0"); }
  catch (err) { logger.warn({ err }, "kpi guard"); return null; }
}
```

- SQL must cast counts `::int` (node-pg returns `bigint` as a string; MIGRATIONS §6).
- `money` SQL returns `COALESCE(sum(x), 0)::numeric(18,2) AS n`; never cast money to float (gate 20 `sql-float`).
- Log on failure: in MyCity every table exists, so a failing guard is a bug, not "module not installed". Still return `null` so one broken query
  costs one card.
- Every SQL takes the scope through `scopeClause(ctx.scope(module), { column: "<owner col>" }, params)` and "today" as a parameter from
  `shared/time/lagos.js` `today()` (never `CURRENT_DATE`, never `now()::date`: the DB session zone is not Lagos).

### 3.4 Eligibility (port `eligibility.js`)

```js
// user subject: everything comes from the cached rbac reads
async function forUser(client, user) {
  if (user.is_ceo === true) return new Set(LIVE_IDS);                         // every grant, every capability, never masked
  const modules = [...new Set(CATALOG.map((e) => e.module))];
  const viewable = new Set();
  for (const k of modules) if (await rbac.scopeFor(user, k, "view")) viewable.add(k); // grants-cache, 30 s
  const masked = new Set(await fieldMask.maskedKeysFor(client, user));
  const caps = new Set(await grantsCache.getCapabilities(client, user.user_id));
  return eligibleIds({ viewable, masked, caps });
}
// role subject (Settings role editor and the prune): read the role's own rows
async function forRole(client, roleId) {
  // SELECT module_key FROM permission WHERE role_id = $1 AND can_view
  // SELECT field_key FROM field_visibility WHERE role_id = $1 AND visibility = 'masked'
  // SELECT c.code::text FROM role_capability rc JOIN capability c USING (capability_id) WHERE rc.role_id = $1
  return eligibleIds({ viewable, masked, caps });
}
function eligibleIds({ viewable, masked, caps }) {
  return new Set(CATALOG.filter((e) => e.status === "live"
    && viewable.has(e.module)
    && (!e.capability || caps.has(e.capability))
    && !(e.sensitive_field && masked.has(e.sensitive_field))).map((e) => e.id));
}
```

`req.user` (from `grants-cache.getAuthUser`) is `{ user_id, employee_id, email, status, is_ceo, display_name, role_ids }`; `rbac.scopeFor` needs
`{ user_id, employee_id, role_ids, is_ceo }` and returns `{ scope, scope_ids, employee_id } | null`. Keep the `scopeFor` result per module in
`ctx.scope(module)` and reuse it for values and details (one decision for eligibility and scope).

Who sees what with the seeded matrix (`0290`): `employee` holds `home, workspace, ess, community, mailbox, performance, queries, partnerships, expenses, knowledge, praxis_ai`
(own); no `people`, `recruitment`, `payroll`. `manager` adds `people`/`partnerships`/`expenses` (team). `head_of_department` team on most, no
`payroll`. `operations_people` and `management` all. `administrator` home own + settings all. Salary is masked for every role except
`implementation`, `operations_people`, `management` (`0449`).

### 3.5 Resolution (port `resolve.js`)

Precedence, MyCity form:

```
cards = user_kpi row (null = no row)  >  role_kpi rows of the user's active roles, ORDER BY rank DESC, name (identity.repo.rolesOf order)
        >  HOME_VIEW_DEFAULTS[me.home_view]  >  []
locked ids (union of the roles' locked_ids) lead whichever base wins
everything ∩ eligible(user), deduped, first 4
```

`HOME_VIEW_DEFAULTS` replaces `SYSTEM_DEFAULT_IDS` and the reference's 90xx seeds. It is code keyed by `role.home_view`
(`'operations' | 'ceo' | 'partnerships' | 'staff'`, `0200` CHECK; `me()` resolves `ceo` for `is_ceo`, else the first role with a `home_view`,
else `staff`). Proposed from the mock's four cards per view (§5):

```js
const HOME_VIEW_DEFAULTS = Object.freeze({
  operations:   ["attendance_today", "tasks_overdue", "expenses_pending", "partnerships_active"],
  ceo:          ["goals_on_track", "approvals_awaiting_you", "partnerships_signed_value", "alerts_high_open"],
  partnerships: ["partnerships_active", "partnerships_signed_value", "partnerships_quiet_30d", "proposals_out"],
  staff:        ["my_targets_on_track", "my_tasks_overdue", "my_reviews_due", "my_attendance_30d"],
});
```

`source` in the payload becomes `"user" | "role" | "view"` (say which: the screen never shows "Tower default").
Keep `keepEligible`, the `null`-versus-`[]` rule, locks-lead, concatenating merge and the cap of 4 byte-for-byte (§1.5).

### 3.6 Tables (one fix-forward migration in the M1 block; pick the next free number after `1130`, coordinate with the reports migration)

```sql
-- M1 Home cards: the cards each role opens on, and the cards a person chose for themselves.
-- Card ids are the KPI catalogue's (src/modules/dashboard/kpi-catalog); the catalogue is code,
-- so there is no foreign key and an id the catalogue no longer has is ignored when read.
-- UP
CREATE TABLE IF NOT EXISTS role_kpi (
  role_kpi_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id uuid NOT NULL UNIQUE REFERENCES role(role_id) ON DELETE CASCADE,
  default_ids text[] NOT NULL DEFAULT '{}',
  locked_ids text[] NOT NULL DEFAULT '{}',
  updated_by uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (cardinality(default_ids) <= 4),
  CHECK (locked_ids <@ default_ids)
);
CREATE INDEX IF NOT EXISTS role_kpi_updated_by_fk_idx ON role_kpi (updated_by);
CREATE OR REPLACE TRIGGER role_kpi_set_updated_at BEFORE UPDATE ON role_kpi
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS user_kpi (
  user_kpi_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES app_user(user_id) ON DELETE CASCADE,
  kpi_ids text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (cardinality(kpi_ids) <= 4)
);
CREATE OR REPLACE TRIGGER user_kpi_set_updated_at BEFORE UPDATE ON user_kpi
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- DOWN
DROP TRIGGER IF EXISTS user_kpi_set_updated_at ON user_kpi;
DROP TABLE IF EXISTS user_kpi;
DROP INDEX IF EXISTS role_kpi_updated_by_fk_idx;
DROP TRIGGER IF EXISTS role_kpi_set_updated_at ON role_kpi;
DROP TABLE IF EXISTS role_kpi;
```

MIGRATIONS §7 rule 2: the repo always passes arrays (never `NULL`) into `default_ids`, `locked_ids`, `kpi_ids`. "No pick" is the absence of the
`user_kpi` row, deleted by the reset endpoint. Capabilities `home.team`, `home.reports`, `home.alerts.manage` (decision 2) are a reference seed in
the M1 block (codes the code switches on; `0449` is the precedent, `ON CONFLICT (code) DO NOTHING`); which roles hold them follows the `0449`
pattern (`role_capability ... ON CONFLICT DO NOTHING`).

Repo SQL (port of `role_kpi.repo.getForRoles`, MyCity order):

```sql
SELECT rk.role_id, rk.default_ids, rk.locked_ids, r.code::text AS code, r.name
  FROM role_kpi rk JOIN role r ON r.role_id = rk.role_id
 WHERE rk.role_id = ANY($1::uuid[]) AND r.active
 ORDER BY r.rank DESC, r.name
```

Pass the user's **effective** role ids (`identity.repo.rolesOf` filters `effective_from/effective_to`; `getAuthUser.role_ids` does not).

### 3.7 Endpoints and contract (Zod in `packages/contract/schemas/<dashboard|home>.js`, snake_case)

| Method and path | Guard | Body / response | Notes |
|---|---|---|---|
| `GET /api/v1/home/overview` | `requirePermission("home","view")` | `HomeOverview` (blocks; the `kpis` block items are painted cards) | cards resolved server-side; `source` and `hidden` count travel with it |
| `GET /api/v1/home/kpi-picker` | `home` view | `HomeKpiPicker` `{ max, tiles: HomeKpiMeta[], locked_ids, role_default_ids, current_ids: string[]\|null, withheld: int, source }` | offerable = live ∩ pickable ∩ eligible(user) |
| `PUT /api/v1/home/kpi-picks` | `home` view, own row only | `HomeKpiPicks { kpi_ids: KpiId[] max 4 }` → `HomeKpiPicker` | validate ids against catalogue + caller eligibility (422 names the field); `[]` stored |
| `DELETE /api/v1/home/kpi-picks` | `home` view | no content | deletes the row: back to role/view default |
| `GET /api/v1/home/kpi/:key/meta` | `home` view + card eligible for caller else 404 | `KpiDetailMeta` | 404, not 403, so an ineligible key looks absent (`scope.assertInScope` semantics) |
| `GET /api/v1/home/kpi/:key` | as above | `HomeKpiPage` via `pageQuery`/`sendPaged`, filter `group`, `q` | rows masked with `maskForUser` at the controller |
| `GET /api/v1/home/roles/:role_id/kpis` | `requirePermission("settings","view")` | `{ default_ids, locked_ids, tiles: HomeKpiMeta[] /* eligible for the ROLE */ }` | labels come from here (the admin may not hold the role's modules) |
| `PUT /api/v1/home/roles/:role_id/kpis` | `settings` edit | `RoleKpiSave { default_ids ≤4, locked_ids ≤4 }` | errors as §1.8 (`UNKNOWN_KPI_ID`, `TOO_MANY_TILES`, `DUP_TILE`, `LOCKED_NOT_DEFAULT`, `KPI_NOT_LIVE`, `KPI_NOT_READABLE`); messages are field marks ≤ 4 words |
| `DELETE /api/v1/home/roles/:role_id/kpis` | `settings` edit | no content | replaces the reference's `config: null` |

Contract-columns gate (gate 6): every exported object schema needs a `TABLES` entry. `HomeKpiPicks` → `{ table: "user_kpi" }` (its one key
`kpi_ids` is a column, which is why the body is not `{ pins }`); `RoleKpiSave` → `{ table: "role_kpi" }`; meta, card, picker, detail →
`{ table: null, reason: "computed from the KPI catalogue" }`. Never edit `contract.gen.ts`.

Painted card on the wire (proposal; replaces the mock's preformatted `value: string`):

```js
const HomeKpiCard = z.object({
  key: KpiId, label: z.string(), unit: z.enum(["count","money","pct","pair","days"]),
  value: z.number().int().nullable(),            // count / pct / pair numerator / days
  amount: money.nullable(),                      // money unit only, wire string "1250000.00"
  denominator: z.number().int().nullable(),      // pct / pair
  measurable: z.boolean(),
  caption: z.string().nullable(), tone: StatusTone.nullable(), opens: z.boolean(),
}).strict();
```

The client renders `pair` as "22 of 25" (KpiCard doc example), money as `<Money value={amount} short />`, pct as "87%".

### 3.8 Writes, events, prune

- `savePicks(user, { kpi_ids }, actor)`: `atomically` → upsert `user_kpi` → `emit({ key: "home.kpi_picks_changed", entity: { type: "app_user", id }, actor, before, after })`.
  The reference did not audit picks; MyCity's one-write-path rule (CLAUDE step 4) wins. Not `security: true`.
- `saveRoleCards(roleId, body, actor)`: validate with `forRole()` eligibility, upsert, `emit("home.role_kpis_changed")` with before/after arrays.
- Prune (port `pruneUnreadable`): in `dashboard.events.js`

```js
const outbox = require("../../shared/events/outbox");
for (const key of ["permission.changed", "field_visibility.changed", "capability.changed"]) {
  outbox.register(key, "dashboard.prune-role-kpis", async (event) => service.pruneRole(event.payload.role_id));
}
```

`access.service.updateRole` emits those keys with `payload: { role_id, code }`. Handler names must match `/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_-]*)+$/`;
handlers run at least once, so `pruneRole` is idempotent (filter arrays to `forRole()`; delete the row when `default_ids` ends empty; write and
emit only when something changed). User picks are not pruned: the read-time filter drops them, as in the reference.

### 3.9 Frontend

- Overview cards: `KpiGrid` of `KpiCard` (`@mycity/ui`); `onOpen` opens `useKpiDetail()` (already in `app/src/features/home/KpiDetail.tsx`).
- The picker: no component in `@mycity/ui` does slot reorder/remove. Add one with `npm run new:component` in `packages/ui` (header, test, gallery;
  never in `app/src/components/`). Host it in `Modal` (bottom sheet on a phone). Title ≤ 4 words ("Choose Cards"); buttons Verb Noun ≤ 3 words
  ("Save Cards", "Restore Default", "Cancel"); a `Pill` "Locked" on locked slots; a plain count ("12 of 15") at most, no explanatory footer;
  44 px targets; the door is a header action button beside Export/New.
- Port the pure draft functions (§1.10) into `app/src/features/home/` (feature logic, not a component) with their tests; rename `draftToPins` →
  `draftToPicks`. After save, `invalidate` the overview and picker queries; the server re-resolves.
- The frontend declares no Zod and takes types from the generated contract.

---

## 4 · The MyCity catalogue

### 4.1 Status in M1

`live` = SQL runs against tables that exist in `migrations/` today (empty on production until the owning module ships; zero is asserted).
`hidden` = declared id, no SQL, no offer; flips live in the milestone named. Forward tables are read only through `sources/<module>.source.js`
(decision 3) whose header says which milestone owns the table and must update the adapter.

### 4.2 The six ported tiles, rewritten

| id | domain | module | label | unit | status | MyCity source |
|---|---|---|---|---|---|---|
| `headcount` | people | `people` | Headcount | count | live | `organisation` counts (`headcount`) |
| `attendance_today` | people | `people` | Clocked In Today | pair | live | `attendance.roster` summary (decision 4) |
| `leave_pending` | people | `people` | Leave Awaiting Decision | count | live | `leave_request` |
| `vacancies_open` | people | `recruitment` | Open Vacancies | count | live | `sources/vacancies.source.js` |
| `payroll_run_state` | finance | `payroll` | Payroll In Progress | count | **hidden** until M6 creates `payroll_run` | `sources/payroll.source.js` (`sensitive_field: "employee.salary"`) |
| `attrition_90d` | people | `people` | Attrition, 90 Days | count | live | `organisation` counts (`attrition`) |

SQL (owner column for scope in brackets):

```sql
-- headcount, attrition_90d, confirmations_due: do not restate; read organisation.repo.counts(db, scope) through the
-- organisation service (one definition with People · Employees):
--   headcount  = count(*) FILTER (WHERE e.status = 'active')
--   attrition  = count(*) FILTER (WHERE e.left_on IS NOT NULL AND e.left_on >= current_date - 90)
--   probation_due = active, confirmed_on IS NULL, confirmation_due_on <= current_date + 30
-- [e.employee_id]. Note those three use current_date (session zone): see conflicts.

-- leave_pending [lr.employee_id]; statuses from 1099: draft | submitted | approved | rejected
SELECT count(*)::int AS n FROM leave_request lr WHERE lr.status = 'submitted' ${s.and}

-- vacancies_open [v.hiring_manager_id]; 4099: draft | open | paused | closed
SELECT count(*)::int AS n FROM vacancy v WHERE v.status = 'open' ${s.and}
```

`attendance_today` reads the roster, not SQL of its own. What the roster must give the card and its detail, porting the reference's
expected-set rule onto MyCity tables:

- the day: `lagos.today()`; if `!workingWeek.isWorkingDay(today, await workingWeek.loadCalendar(client))` the expected set is empty
  (`working_week` weekday is ISO 1 = Monday … 7; the reference used `DOW` 0 = Sunday; there is no per-employee `work_days` column here;
  `loadCalendar` counts `public_holiday` rows including `expected = true` ones as holidays);
- expected = `employee.status = 'active'` minus anyone with `leave_request.status = 'approved' AND starts_on <= $today AND ends_on >= $today`;
- present = expected with an `attendance_event` `event_type = 'clock_in'` (or `attendance_day.first_clock_in_at`) on `$today`, using
  `lagos.startOfDay`/`endOfDayExclusive` bounds on `occurred_at`;
- groups for the detail and the Team tab: on site, remote, field, late, no clock-out, on leave, not in (`attendance_day.status`
  reference values `present | late | absent | leave`; `attendance_exception.exception_type = 'missing_clock_out'`);
- card value `{ value: present, denominator: expected }`; caption `"<n> late"`.

### 4.3 Net-new tiles (MILESTONES §6.1 and the Home mock)

| id | domain | module (+capability) | label | unit | status | source and rule |
|---|---|---|---|---|---|---|
| `confirmations_due` | people | `people` | Confirmations Due | count | live | organisation counts `probation_due` (30 days) [e.employee_id] |
| `reviews_due` | people | `performance` | Reviews Due | count | live | `sources/reviews.source.js`: `performance_review pr JOIN performance_cycle pc` where `pr.submitted_at IS NULL AND pc.closes_at < $today + 30` [pr.employee_id] |
| `documentation_pending` | people | `people` | Documents Requested | count | live | `document_request` (`0350`, built): `fulfilled_at IS NULL AND cancelled_at IS NULL` [dr.employee_id]; M5 onboarding docs: open question |
| `tasks_overdue` | work | `workspace` | Overdue Tasks | count | live | `sources/tasks.source.js`: `task t WHERE t.archived_at IS NULL AND t.completed_at IS NULL AND t.due_at < now()` [t.primary_assignee_id] |
| `goals_on_track` | work | `performance` | Goals On Track | pair | **hidden** until M2 defines on-track progress | `sources/goals.source.js` (`organisational_goal`, `employee_target`) |
| `approvals_awaiting_you` | work | `home` | Awaiting Your Approval | count | live | `workflow.service.mineCount(user)` (the My Approvals count; detail = `workflow.service.mine(user, query)`) |
| `alerts_high_open` | work | `home` + `alerts.clear` | Open High Alerts | count | live | `home_alert` `cleared_at IS NULL AND severity = 'high'`, filtered to rules the viewer may clear (`shared/alerts/alerts.js` `mayClear`/`parsePermission`) |
| `expenses_pending` | finance | `expenses` | Awaiting Approval | money (+ count caption) | live | `sources/expenses.source.js`: `expense_request er WHERE er.status = 'submitted'`, `COALESCE(sum(er.amount),0)::numeric(18,2)` and `count(*)::int` [er.employee_id]; 8099: draft, submitted, approved, rejected, paid, cancelled |
| `budget_vs_actual` | finance | `expenses` | Budget Used | pct | live | `sources/budgets.source.js`: `budget b JOIN budget_line bl`, `b.approved_at IS NOT NULL AND $today BETWEEN b.starts_on AND b.ends_on`; value `round(100 * sum(bl.spent_amount) / NULLIF(sum(bl.amount),0))::int`, denominator `count(DISTINCT b.budget_id)::int` [b.owner_id]. Percentage computed in SQL so no JS arithmetic on money |
| `partnership_pipeline` | business | `partnerships` | Open Opportunities | count | live | `sources/partners.source.js`: `partnership_opportunity po WHERE po.status = 'open'` [po.owner_id] |
| `partnerships_active` | business | `partnerships` | Active Partnerships | count | live (rule open) | `partner p WHERE p.status = 'active'` [p.owner_id]; vocabulary unconfirmed |
| `partnerships_signed_value` | business | `partnerships` | Signed Value | money | live (rule open) | `partnership_agreement pa`, signed this year, `currency = 'NGN'`, `COALESCE(sum(pa.value),0)::numeric(18,2)` [pa.owner_id] |
| `partnerships_quiet_30d` | business | `partnerships` | No Contact 30 Days | count | live | active partners whose `max(partner_interaction.occurred_at) < now() - interval '30 days'` or none [p.owner_id] |
| `proposals_out` | business | `partnerships` | Proposals Out | count | live (rule open) | `partnership_proposal pp WHERE pp.sent_at IS NOT NULL AND pp.accepted_at IS NULL` joined to its opportunity owner |
| `my_attendance_30d` | people | `ess` | My Attendance | pair | live | own `attendance_day` last 30 days: on time / days expected (ess is always own scope) |
| `my_tasks_overdue` | work | `ess` | My Overdue Tasks | count | live | as `tasks_overdue` with `t.primary_assignee_id = $me` |
| `my_reviews_due` | people | `ess` | My Reviews Due | count | live | `performance_review` where `reviewer_employee_id = $me AND submitted_at IS NULL` |
| `my_targets_on_track` | work | `ess` | My Targets | pair | hidden until M2 | `employee_target` of `$me`, on-track rule from M2 |

Team tab cards (decision 2: `capability: "home.team"`, `pickable: false`, module `people`, scope from the people grant), all from the roster:
`team_present` (Present Today, pair), `team_on_site` (On Site), `team_remote` (Remote), `team_flags` (Flags = late + no clock-out).
Alerts and Reports tab figures are counts their own services compute; give them catalogue entries only if they open `/home/kpi/:key`.

### 4.4 Mock key → catalogue id (the frontend and mock change with PR 2)

| mock key (`app/src/api/mock/modules/home.ts`) | id |
|---|---|
| `clockedin` | `attendance_today` |
| `overdue` | `tasks_overdue` |
| `approval` | `expenses_pending` |
| `approval_ceo` | `approvals_awaiting_you` |
| `partnerships` | `partnerships_active` |
| `signed` | `partnerships_signed_value` |
| `stale` | `partnerships_quiet_30d` |
| `proposals` | `proposals_out` |
| `goals` | `goals_on_track` |
| `alerts_high` | `alerts_high_open` |
| `sk_attendance` | `my_attendance_30d` |
| `sk_reviews` | `my_reviews_due` |
| `sk_pieces`, `sk_growth` | per-target cards; not catalogue ids (see open questions) |
| `tm_present`, `tm_onsite`, `tm_remote`, `tm_flags` | `team_present`, `team_on_site`, `team_remote`, `team_flags` |

---

## 5 · Default bands by Home view (from the mock), and who can actually see them

| home_view | defaults | who lands here (`0290`) | eligibility notes |
|---|---|---|---|
| operations | attendance_today, tasks_overdue, expenses_pending, partnerships_active | implementation, operations_people, management | all four eligible (all grants) |
| ceo | goals_on_track, approvals_awaiting_you, partnerships_signed_value, alerts_high_open | `is_ceo` only | CEO is eligible for every live card; `goals_on_track` hidden in M1 so the band shrinks to three unless a fifth default is listed |
| partnerships | partnerships_active, partnerships_signed_value, partnerships_quiet_30d, proposals_out | **head_of_department** (every HoD, not only Partnerships) | HoD holds partnerships team; a Head of Content gets a partnerships band (conflict) |
| staff | my_targets_on_track, my_tasks_overdue, my_reviews_due, my_attendance_30d | administrator, manager, employee | `ess` own; `my_targets_on_track` hidden in M1 |

Because defaults are filtered by eligibility, listing a fifth fallback id per view (for example `headcount` for operations) is how to avoid a
three-card band while a hidden card waits; the cap of 4 still applies.

---

## 6 · Tests to port (reference `tests/unit/kpi-catalog.test.js`, `kpi-band-resolve.test.js`)

Put them beside the code (`src/modules/dashboard/dashboard.test.js` exists as a stub; any new test file goes in README). Cases:

- Catalogue: ids unique and `BY_ID` agrees; every entry has the fields the resolver reads; `assertCatalogSane` passes and fails on a duplicate;
  every `sensitive_field` is a `fieldMask.FIELDS` key; every `module` is in `access.catalog.MODULES`; every `capability` is seeded;
  live ⇔ has `value` and `detail.list`; labels Title Case ≤ 4 words and help ≤ 35 words using `scripts/check/lib/copy.js`; no em dash.
- Adapters: every `DEPENDS_ON` table.column exists in `buildCatalogue()` from `scripts/check/lib/catalogue.js`; a live entry's adapter has no
  missing column.
- Guards: a rejecting client answers `null` (unavailable, not zero); an empty table answers `0`; money answers `"0.00"`; hidden and unknown ids
  are never answered.
- `keepEligible`: drops unknown, hidden, ineligible, non-strings; keeps order; dedupes; total over garbage.
- `selectCards`: no picks and no role rows → view defaults in order; picks beat role defaults; `[]` is a choice; multi-role concatenation by rank,
  dedupe, cap 4; locks lead against user picks; never more than 4; a revoked grant drops a pick and the next survives; eligibility filters defaults;
  nothing eligible → `[]`.
- `paintCards`: 0 paints; null drops and is counted; ratios keep denominator and `measurable`.
- `pickerModel`: offers only live ∩ pickable ∩ eligible; current picks that lost eligibility are filtered.
- Eligibility: a module grant admits exactly its cards; CEO admits all live; no grants admit none; a masked field removes the card (does not
  zero it); a capability card needs the capability; MyCity's mask rule (masked only when every mentioning role masks) is honoured for users.
- Role config: the six 422 codes; reset deletes; prune removes ids whose module lost `can_view` and deletes an emptied row; prune is idempotent.
- Empty production fixture: picked cards render as zeros; unpicked absent.

---

## 7 · Pitfalls

1. Provenance gate (§0). Also no "donor" in test names or fixtures.
2. Gate 6 schema drift: any SQL naming `payroll_run` (no migration) fails CI even inside a guard. Hidden entries carry no SQL.
3. Gate 20 money: no `Number()` on amounts (the reference `normalize()` does `Number(v.value)`); money tiles are strings end to end.
4. Pagination gate: no `LIMIT`/`OFFSET` in tile or detail SQL (except `LIMIT 1`); details page through `pageQuery` with `TOTAL_COL`.
   The reference's 200-row client caps and "the table lists the 200 most recent" notes disappear.
5. Dates: pass `lagos.today()`; never `CURRENT_DATE`/`now()::date`; ISO weekday, not DOW.
6. Scope is not optional: a manager's `tasks_overdue` is their team's, an employee's partnership cards are their own (`employee` holds
   `partnerships` own). Use `scopeClause`; a NULL owner column is invisible under team/own by design.
7. Partner stages are business choices (A26; `7099` seeds them but MILESTONES A26 says they move out). Do not hard-code stage codes in SQL;
   use the `status` columns and timestamps, and record the dependency in the adapter.
8. Mixed currency: `partnership_*` and `budget`/`expense_request` carry `currency char(3)`; `shared/money` is Naira only. Filter `currency = 'NGN'`
   or decide (open question).
9. No reference seed for `role_kpi` (A26). Code defaults by `home_view` instead. A seed would also be the wrong mechanism: the same file must
   give the same schema on an empty and a full database (MIGRATIONS §11).
10. The role editor's eligibility is the role's own rows, not the admin's; the admin must see labels for cards they cannot open themselves.
11. `requireCapability` reads `grantsCache.getCapabilities` (user and role capabilities, 30 s cache); `access.service.updateRole` already calls
    `invalidateGrants()`, which also clears `caps`.
12. `GET /home/kpi/:key` must re-check eligibility for the caller and return 404 for an ineligible key, else the detail endpoint leaks what the
    card hides.
13. Copy: the reference picker's description, hint lines and "the rest belong to modules you don't have" footer are tier 3 and fail
    `five-second`/`dashes`; KPI captions ≤ 5 words, toasts ≤ 8.
14. AI (A23): `dashboard` AI manifest declares reads only; `run(client, params, actor)` gets `actor.scope` but eligibility needs the user, so an
    AI read of "my cards" needs the actor's user, not only the scope. The reference manifest left the band out for this reason.
15. Don't confuse with the Performance `kpis` module (`kpi_definition`, weights): Home cards are not Performance KPIs; keep them out of
    `src/modules/kpis/`.

---

## 8 · Conflicts found

- Module and file names: guide header "Backend modules `home`", §5 `packages/contract/schemas/home.js`, §9 `home.ai.js`/`home.search.js`;
  README §5.2/§5.4 and the stubs say modules `dashboard`, `alerts`, `reports` with contract stubs `dashboard.js`, `alerts.js`, `reports.js`.
- Guide §4 table names `home_report`/`home_report_run`; migration `1000` built `saved_report`/`report_schedule` (decision 1 keeps those).
- Field masking rule: reference masks when any role masks; MyCity `grants-cache.getMaskedFieldKeys` masks only when every mentioning role masks.
  Port the MyCity rule; the reference comment "most restrictive role wins" must not come across.
- CEO: reference applies field masks to the CEO; MyCity `field-mask.js` never masks the CEO.
- `0290` gives `home_view = 'partnerships'` to every Head of Department, so a non-partnership HoD gets the partnerships layout; guide §11 says a
  role with no function data should not see the pipeline card at all.
- `organisation.repo.counts` uses `current_date` (database session zone), while the rest of MyCity uses `lagos.today()`; headcount/attrition/
  confirmations near midnight can disagree with Lagos-dated cards.
- Attendance guide §4 models `attendance_session`/`attendance_location`/`attendance_case`; migration `1000` built `attendance_event`/
  `attendance_day`/`attendance_exception`. The roster must be written against what exists; the guide needs reconciling.
- `access.catalog.js` has only `home`; the guide's permission column lists `home.team`, `home.alerts`, `home.alerts.manage`, `home.reports`
  as keys. Decision 2 makes them capabilities, so the guide's table needs that wording.
- MILESTONES A26 says partner stages are a business choice that moves out of reference seeds, yet `7099` still seeds `partnership_stage`.
- `Me` contract has no `capabilities`; the frontend can only hide Team/Alerts/Reports by capability if `me()` returns them (PR 1 item).

## 9 · Open questions

- `role_kpi.scope_ids`: decision 5 names defaults and locks only. Keep a nullable scope column (reference parity, "what members may pick") or not?
- Table name for personal picks: `user_kpi` proposed.
- "Goals on track" and "my targets on track": the M2 definition (progress vs time elapsed, weighting) does not exist yet; hidden until then.
- "Pending documentation": People's `document_request` (built, M0) or M5 onboarding checklist items with a `document_requirement`? Possibly both.
- Partnership vocabularies (`partner.status`, `partnership_agreement.status`, `partnership_proposal.status`) and what "active" and "signed" mean.
- Currency for partnership value, budgets and expenses: NGN only, or convert?
- Staff band: the mock shows each person's own target cards (Pieces Published, Channel Growth). Dynamic per-target cards are not catalogue
  entries; confirm the staff four.
- Do Alerts and Reports tab figures need catalogue entries (only if they open a detail)?
- Where the role editor's card step lives: Settings · Roles & Permissions (M0/M9 screen, owner AJ/GE) calling Home's endpoints.
