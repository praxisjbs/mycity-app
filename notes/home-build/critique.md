# Home build · Completeness critique of the eight briefs

Critic's pass over `architecture.md`, `backend-infra.md`, `exemplar.md`, `frontend.md`, `gates.md`,
`donor.md`, `schema.md`, `guides.md` (all in this folder), checked against `docs/guides/home.md`
(read in full), the owner decisions 1 to 12, and the code at `/home/user/mycity-app` on 17/10/2026.
Nothing in the repo was changed. Every "Code says" below was read, not inferred; file:line where it
matters. Use this file as the tie-breaker: where a brief and this file disagree, this file read the
code last.

---

## 0 · Read this first (the twelve things that change what you build)

1. **Three backend modules, three contract files.** `dashboard`, `alerts`, `reports` (stubs, README
   §5.2/§5.4, CODEOWNERS lines 123-138, route-map markers). `frontend.md` §3.2 and §8 say
   `packages/contract/schemas/home.js` / `c.home`: **wrong for this repo**. Use
   `c.dashboard.*`, `c.alerts.*`, `c.reports.*`; frontend imports from `contract.gen.ts` by type
   name, so only the runtime import in forms changes (`import alerts from "@mycity/contract/schemas/alerts.js"`).
2. **All three routers mount at `basePath: "/home"`** (not `/home/reports`, as `backend-infra.md` §1
   suggests): the screens already call `GET /api/v1/home/report-runs` and `/api/v1/home/alert-rules`
   (`app/src/api/types/home.ts:163,170`).
3. **A new numbering type touches settings, not just `schemes.js`.** No brief caught this:
   `packages/contract/schemas/settings.js:146` `DOC_TYPES` enum, `src/modules/settings/settings.service.js:217`
   `DOC_LABELS`, and `src/modules/settings/settings.test.js:105-108` (asserts both lists equal and
   every type labelled). That pulls `foundation.md` into PR 1/PR 5 (settings module is covered by it).
4. **`home.alerts.manage` cannot be saved on Settings · Roles** (`access.js:28` two-segment regex).
   Owner must pick: rename (recommend `home.alert_rules`) or widen the regex. Unresolved, it blocks PR 1.
5. **`alerts.clear` capability vs `mayClear()`**: decision 2 puts `requireCapability("alerts.clear")`
   on the route; `alerts.js:207` authorises by the rule's grant; the capability is seeded only to
   implementation, operations_people, management (0449). Line managers and Heads of Department,
   whom home.md §8 says clear their own alerts, are locked out unless the PR 1 seed grants them
   `alerts.clear`. Owner decision needed (recommendation in §3, C5).
6. **Switching a rule off cannot use `alerts.clear()`**: it calls `mayClear(actor)` (alerts.js:253);
   a rule manager who does not hold the rule's `permission_key` gets a 403 and the rule cannot be
   disabled. The shared engine needs a system closure (§2, G2).
7. **Handlers cannot find rules by metric.** The engine only has `ruleByKey(key)`; rules created on
   screen are many-per-metric. Home's repo needs `enabledRulesForMetric(client, metric)` and a key
   generator for screen-created rules (§2, G3).
8. **On-demand "Run Now" cannot return a `document_id` synchronously** without breaking the
   one-write-path rule (rendering and workbook building are outbox work). Contract: `document_id`
   nullable, status `pending`; UI handles 409 `DOCUMENT_RENDERING` (§2, G7). Guide §5 must change.
9. **Clock-in trigger (decision 12) depends on attendance endpoints that do not exist.**
   `GET /api/v1/attendance/me/today` and `POST /api/v1/attendance/punches` are INTERIM only
   (`app/src/api/types/attendance.ts:254-255`; nothing in `contract.gen.ts`). The trigger can ship;
   the prompt it opens cannot work on staging until LA ships the punch API.
10. **`Me.capabilities` must be declared in `identity.js`, not with `access.CapabilityCode`**:
    `access.js:16` requires `./identity`, so identity requiring access is circular (`frontend.md` §4
    proposes `z.array(CapabilityCode)`: wrong). Move the code regex to `identity.js` (or `common.js`)
    and have `access.js` import it.
11. **Backend-infra's AI manifest example fails gate 19**: `params: { action: "clear" }`
    (`backend-infra.md` §20) matches `ai-no-writes.js:29`. Use `params: { new: "1" }` style or none.
12. **Demo is Monday 19/10/2026 (MILESTONES §6 line 424); today is Saturday 17/10.** The five-PR plan
   cannot all merge before the demo under the review rules. Plan what the demo shows (§4).

---

## 1 · Contradictions between briefs, resolved by reading the code

| # | Topic | Briefs disagree | Code says | Resolution |
|---|---|---|---|---|
| X1 | Contract file(s) | `frontend.md` §3.2, §8: `schemas/home.js`, `c.home`. `architecture`, `backend-infra`, `exemplar`, `gates`, `schema`: `dashboard.js`, `alerts.js`, `reports.js` | `packages/contract/schemas/{dashboard,alerts,reports}.js` exist (0 bytes); no `home.js`; readme-map allows `schemas/<m>.js` only when `src/modules/<m>` exists; CODEOWNERS 124/132/138 own the three | Three files. Names must stay unique across all contract files (generator prefixes duplicates in BOTH domains): never export `Tone`, `PersonRef`, `Me`, `*Summary` names already used (`AuditSummary`, `DocumentSummary`, `SecuritySummary`, `EmployeesSummary`, `NumberingSummary`, `UsersSummary`, `ApprovalsSummary` exist in `contract.gen.ts`). Prefix Home's: `HomeAlertSummary`, `HomeReportSummary`, `HomeTeamSummary` |
| X2 | Reports basePath | `backend-infra.md` §1: `/home/reports`. `architecture.md` §0.2: `/home`. `gates.md` §10: `/home`, `/home/alerts`, `/home/reports` all fine | INTERIM keys `GET /api/v1/home/report-runs`, `/home/alert-rules` sit outside `/home/reports` and `/home/alerts` | All three `basePath: "/home"`. Paths inside each router start with their noun (`/alerts…`, `/alert-rules…`, `/reports…`, `/report-runs`). No `/:id` at a router root. Literal sub-paths (`/summary`, `/meta`) before `/:id` (`uuidParams` 404s a non-UUID `:id`) |
| X3 | Numbering type name and scheme | `architecture` §11.3 and `schema` B4: `report_run`, RPT-0001, reset never. `backend-infra` §10 and `gates` §4.7: `home_report_run`, yearly with period, RPT-2026-0001 | Mock numbers `RPT-0214` (`app/src/api/mock/modules/home.ts:334,441`); no period. Existing types are named for the thing, not the table (`expense`, `query`, `payroll_run`) | `report_run: { prefix: "RPT", padding: 4, separator: "-", reset: "never", include_period: false } // M1`, literal `numbering.allocate(client, "report_run")`. Plus seed row, `settings.js` `DOC_TYPES`, `DOC_LABELS.report_run = "Report Run"` (G1). `defineDocType(..., { numbering: null })` so the PDF does not burn a second number |
| X4 | Personal picks table | `donor.md` §3.6: `user_kpi(user_kpi_id, user_id UNIQUE, kpi_ids text[])`. `schema.md` B5: `home_kpi_pick(home_kpi_pick_id, user_id UNIQUE, kpi_ids)` | Nothing exists; MIGRATIONS §6 asks singular snake_case named for the thing | Either works; pick **`home_kpi_pick`** (Home owns it, mirrors `home_alert*`, avoids a `user_*` name that reads as identity's). Contract body key `kpi_ids` so `TABLES: { HomeKpiPicks: { table: "home_kpi_pick" } }` passes gate 6 |
| X5 | `role_kpi.scope_ids` | `donor.md` §3.6 omits it (open question). `schema.md` B5 includes it with CHECK `default_ids <@ scope_ids` | Decision 5 names "per-role defaults and locks" only | Omit `scope_ids` in M1 (YAGNI; nothing in §10 offers a "what members may pick" control). Note in home.md §13 |
| X6 | Several roles: how role configs merge | `donor.md` §1.5/§3.5: port `selectBand` byte for byte: concatenate every role's defaults in role order, dedupe, cap 4; locks = union. `schema.md` B5: use the highest-rank role's row only | `identity.repo.rolesOf` orders `r.rank DESC, r.name`; `/me.home_view` uses the first role with a view | Port the donor rule (decision 5 says "ported pattern") with MyCity ordering `rank DESC, name`; it degenerates to "highest rank first" anyway. Pass effective role ids (`rolesOf` filters `effective_from/to`; `getAuthUser.role_ids` does not) |
| X7 | Picker endpoints | `frontend.md` §7.3: `GET/PUT /home/kpi-cards` with `{ picked: string[] \| null }`. `donor.md` §3.7: `GET /home/kpi-picker`, `PUT /home/kpi-picks { kpi_ids }`, `DELETE /home/kpi-picks`. `architecture.md` §2.4: `GET/PUT /kpi-picks` | `PUT` body key must be a column for `TABLES { table }` (or a virtual with reason); `DELETE` may be `no_content` (idempotent anyway) | Donor's three routes. `null` ("follow the role") is the DELETE, not a PUT body. Client `draftToPicks()` returning `null` calls DELETE |
| X8 | KPI card on the wire | `frontend.md` §8: `value: { kind, value, total }`. `donor.md` §3.7: flat `{ key, label, unit, value: int\|null, amount: money\|null, denominator, measurable, caption, tone, opens }` | `KpiCard` prop is `title` (COMPONENTS); money must be `common.money` strings (gate 20); `Paged`/strict objects favour flat keys | Donor's flat shape, `label` renamed `title` to match the component; `TABLES { table: null, reason: "computed from the KPI catalogue" }` |
| X9 | Overview payload | Current INTERIM: `blocks: HomeBlock[]` incl. a `note` type. `frontend.md` §8 recommends typed nullable sections. `donor.md` §3.7 keeps blocks | Gate 8 statically reads only literal copy in `app/src`; server copy is crawled only for the Operations mock account | Typed nullable sections (frontend's §8 list). A section the role has no data for is `null` and not drawn (home.md §11). Drop `note` (tier 3). Chart choice per `home_view` in code (G14) |
| X10 | Report schedule input | `frontend.md` §7.7/§14.10: structured cadence, "server writes the cron". home.md §4: `schedule (cron)`. `architecture` §11.2, `backend-infra` §15.5, `schema` B3: `report_schedule.recurrence jsonb` + `src/shared/time/recurrence.js` | `recurrence.js` header: "scheduled reports" is a named consumer; "Deliberately not RRULE"; "the time of day … is stored next to the rule". No cron anywhere | Structured form → `recurrence` rule (`{ freq, interval, by_weekday?, by_month_day?, working_days_only? }`), plus new columns for time of day and anchor date (G8). No cron string anywhere; fix home.md §4 |
| X11 | Report run table shape | `schema.md` B4 recommends `home_report_run` + `home_report_delivery` (two tables). `architecture.md` §8.2 / `backend-infra` §12: one run, record `document_id`, idempotent by natural key | Decision 1: "add `home_report_run` and missing columns" (one new table). home.md §4: `home_report_run(number, report_id, run_at, status, document_id, format, recipients)`: one file per row | **One table**, one row per (slot or request, recipient, format) = one file, one number. Columns in G8. A second table is an owner question, not a default (C14) |
| X12 | Report file read access | `architecture` §11.6: `sensitivity: "personal"`, avoid `restricted`, consider `defineAccess`. `schema` B4: `sensitivity: "restricted"` or serve through Home's own endpoint | `vault.js:426-431`: a `defineAccess(entityType, fn)` rule **decides alone** (before CEO, subject, uploader, module grant) | Register `vault.defineAccess("home_report_run", fn)` in `reports.events.js` (loaded by the API through routes → controller → service → events, and by the worker). Rule: CEO, or `run.recipient_user_id === user.user_id`, or report owner. Sensitivity is then irrelevant to reading; use `personal`. Download stays `GET /api/v1/documents/:id/content` |
| X13 | `defineDocType` vs `defineDocumentType` | `architecture` uses `defineDocType` (generate.js); `schema` and `exemplar` say `defineDocumentType` (types.js) | `generate.js:71-106`: `defineDocType` validates the template and **also** calls `docTypes.defineDocumentType` | One `defineDocType("home_report", { template: "report", numbering: null, module: "home", sensitivity: "personal", landscape: true, title: (d) => d.report_name, label: "Report" })`. The XLSX `vault.store` reuses `doc_type: "home_report"` (registered by that same call) |
| X14 | Signal event declarations | `architecture` §7.3: declare forward signal keys in Home's adapter under the owner's module key to pin spelling. `backend-infra` §6.1: decide who declares. home.md §3: the owning module | `catalogue.js:84-103`: a key may be re-declared by the same module; first declaration's summary wins (load order). `outbox.register` checks only the key's shape | Do **not** declare other modules' keys from Home (a summary written by Home becomes the owner's audit label if loaded first). Register handlers on the agreed spellings and pin them in one constant list in `alerts.events.js` with a unit test that fails when `catalogue.has(key)` is true for a key Home spelled differently. Time-based metrics use Home's sweep (decision 6) and need no event |
| X15 | Who may see the Alerts tab and list | `architecture` §2.4: `/alerts*` behind `alerts.clear`. `frontend.md` §4: tab = `alerts.clear` OR the manage code. home.md header: `home.alerts` (see and clear) | `rbac.js:278-287`: no `requireAnyCapability` | Tab visible on either code (client and `screens.js`); routes: lists and clear behind `alerts.clear`, rule CRUD behind the manage code; a manager-only user sees Alert Rules but not the list unless also granted `alerts.clear`. If "either" is wanted on a route, add `requireAnyCapability([...])` to `middleware/rbac.js` (shared change, test) |
| X16 | Me.capabilities type | `frontend.md` §4: `z.array(CapabilityCode)`. `exemplar.md` §11: `z.array(z.string())` in identity.js (circular otherwise) | `access.js:16` `require("./identity")` | Exemplar is right. Put `CAPABILITY_CODE_RE` in `identity.js`; `access.js` imports it. CEO: all codes from `capability` (new `identity.repo.allCapabilityCodes`) so the client `has()` agrees with `requireCapability` |
| X17 | Picker reorder controls | `frontend.md` §7.3: `IconButton icon="up"/"down"` in a Modal. `donor.md` §3.9: new `packages/ui` component via `npm run new:component` | FRONTEND_GUIDE §5.5 line 250: icon alone "only for well known actions (close, search, more, back, filter)"; review rule, not a gate | Either a new `packages/ui` component (AJ/TB approve) or worded buttons/Menu items ("Move Up", "Move Down"). Not bare up/down icons |
| X18 | Source adapters location | `architecture`: `dashboard/sources/*.js`. `donor`, `schema`: `dashboard/sources/<owner>.source.js`. `gates` §3.3: `dashboard/kpi-catalog/sources/tasks.js` | readme-map auto-allows only `src/modules/<m>/<m>.<x>.js`; any subfolder file must be named in README | `src/modules/dashboard/sources/<owner>.source.js` (one per owning module), each listed in README §5.4 `dashboard` row. alerts and reports require them (same owners, same CODEOWNERS); comment says why, never where from |
| X19 | Report run event | `backend-infra` §6.1: `home.report_run`. `architecture` §7.2: `home.report_run_requested` | home.md §7 names `home.report_run` (on demand) and `home.report_scheduled` (worker cron, not an event) | One key **`home.report_run`** emitted when a run row is created, for both on demand and schedule; one outbox handler `reports.generate` does the work. `dedup_key: "report_run:<run id>"`. No `home.report_scheduled` event (a scheduler tick is not a write) |
| X20 | Seed numbers | `schema` A2: `1140_home_foundation.sql` + `1199_seed_home.sql`. `gates` §4.1: `1140_home_*`, seed `1149_seed_home.sql` or `1199` | Taken: 1000, 1099, 1100, 1110, 1120, 1130; unique across both folders; LA and AJ also owe M1 files | Claim **1140** (all Home schema, one file) and **1199** (Home reference seed, after 1099 so its DELETE sees 1099's rows) in the PR 1 description; tell LA/AJ |
| X21 | Overview "Need You" source | `frontend.md` §7.1/§8: server folds `need_you: { rows, total }` or client reads workflow. `schema` F1: `workflow.repo.waiting` | `GET /api/v1/workflow/mine` (`self: true`, paged, `ApprovalWaitingPage` with `link`) and `/workflow/mine/count` are built; there is no My Approvals screen in `SCREENS.ess` | Need You = `usePaged("GET /api/v1/workflow/mine")` on the client (its own paged endpoint; satisfies "links to its full paged endpoint"), plus the Alerts "Needs You" count. Overview does not embed it. Forward items (tasks M2, quiet partners M7) join when those modules ship |
| X22 | Gated tabs | `frontend.md` §4.5/§14.1: make tabs visible + lock. Everyone else: hide (today) | `Shell.tsx` redirects a URL to a hidden tab; FRONTEND_GUIDE line 628 "An unknown module or tab lands on the first allowed screen"; home.md §10.1 and §11 require the lock state | Owner decision (C11). Default if unanswered: keep the shell behaviour (no change to FRONTEND_GUIDE), update home.md §10.1/§11 to say the tab is hidden |

Smaller agreed-but-worth-pinning facts (all verified):

- `route()` needs a handler carrying `.permission`; `requireCapability` sets none and no `req.scope`:
  always `requirePermission("home", "view"), requireCapability("<code>"), controller.x`. Writes
  gated by capability still use `requirePermission("home", "view")` (manager holds `home` view
  only, 0290), and `req.scope` from the `home` grant is the Team scope.
- `access.service.updateRole` emits `permission.changed`, `field_visibility.changed`,
  `capability.changed` with `payload: { role_id, code }` (`access.service.js:299-354`); `role.deleted`
  also exists. The role_kpi prune handler keys on those (donor §3.8 is right); `role_kpi` rows go by
  `ON DELETE CASCADE` on `role.deleted`.
- `tests/integration/settings.test.js:171,188,201-202` assert the exact capability lists
  `["alerts.clear","announcements.post"]` for the catalogue and the ops role; `:191` asserts staff
  `[]`. Any seeded capability changes those lines in the same PR.

---

## 2 · Gaps no brief covered (covered here from the code)

### G1 · A new numbering type is six edits, not four

```
src/shared/numbering/schemes.js            SCHEMES.report_run = { prefix: "RPT", padding: 4, separator: "-", reset: "never", include_period: false }, // M1 Home report runs
seeds/reference/1199_seed_home.sql         INSERT INTO numbering_scheme (doc_type, prefix, padding, separator, reset, include_period)
                                           VALUES ('report_run','RPT',4,'-','never',false) ON CONFLICT (doc_type) DO NOTHING;
                                           -- DOWN: DELETE FROM numbering_scheme WHERE doc_type = 'report_run'
                                           --   AND NOT EXISTS (SELECT 1 FROM numbering_counter c WHERE c.doc_type = 'report_run');
                                           -- (numbering_counter.doc_type REFERENCES numbering_scheme with no ON DELETE, 0055:15:
                                           --  an unguarded DOWN fails once a number was issued; never delete issued counters)
packages/contract/schemas/settings.js:146  DOC_TYPES gains "report_run"            (contract → npm run gen:contract)
src/modules/settings/settings.service.js:217  DOC_LABELS.report_run = "Report Run"  (Title Case, chrome)
src/modules/settings/settings.test.js:105  passes once both lists agree
docs/guides/foundation.md                  Change log line (settings module and settings contract are covered there)
```
`/api/health/ready` reports a `SCHEMES` type with no row (deploy gate stops); `numbering-schemes.js`
refuses a computed type. `tests/unit/foundation/domain.test.js:51` validates the new scheme.

### G2 · Closing a rule's open alerts needs an engine function

`alerts.clear()` (alerts.js:224-270) checks `mayClear(client, actor, rule)` and writes
`cleared_by = actor.user_id`. A rule manager without the rule's grant gets 403; a system actor
(`user_id: null`) returns `false` from `mayClear`. Add to `src/shared/alerts/alerts.js` (and
BACKEND_STRUCTURE §11.1):

```js
/** Close every open alert of a rule that was switched off, as the rule change itself (no clearing right needed). */
async function closeForRule(client, { rule_id, actor, note = "Rule switched off" }) {
  if (!inTransaction(client)) throw new Error("alerts.closeForRule must run inside atomically()");
  const { rows } = await client.query(
    `UPDATE home_alert SET cleared_at = now(), cleared_by = $2, outcome = 'dismissed', note = $3
      WHERE home_alert_rule_id = $1 AND cleared_at IS NULL
      RETURNING ${ALERT_COLUMNS}`,
    [rule_id, actor && actor.user_id ? actor.user_id : null, note],
  );
  for (const a of rows) await emit(client, { key: ALERTS.HOME_ALERT_CLEARED, entity: { type: "home_alert", id: a.home_alert_id },
    actor, after: a, payload: { outcome: "dismissed", rule_off: true } });
  return rows.length;
}
```
The rules service calls it in the same `atomically()` as the `enabled = false` update. Decide (and
write in §6) whether "Cleared This Week" counts these (recommend: count `outcome = 'cleared'` only).
Test in `tests/integration/shared-layer.test.js` beside the existing alerts block (lines ~449-489).

### G3 · Rules by metric, rule keys, and the metric registry

- `ruleByKey(client, key)` returns one enabled rule. Screen-created rules are many per metric
  (3 late in 30 days medium; 5 late in 30 days high). Home's `alerts.repo.js` needs
  `enabledRulesForMetric(client, metric)` (`SELECT … FROM home_alert_rule WHERE metric = $1 AND enabled
  ORDER BY key, home_alert_rule_id`, small set: a `completeQuery` with
  `// pagination:complete the rules of one metric, a handful of rows`). Handlers loop rules and call
  `alerts.raise` per rule.
- `home_alert_rule.key citext NOT NULL UNIQUE` has no default: the create service must generate it
  (`<metric>.<slug of name>` with a numeric suffix on conflict, retried inside the tx) and the
  contract must not ask the person for it.
- No brief defined the metric catalogue. Put it in `src/modules/alerts/alerts.metrics.js`
  (auto-allowed name), one entry per metric, and make the contract enum `AlertMetric` equal its keys
  (a unit test holds them equal, like `settings.test.js` does for doc types):

```js
const METRICS = Object.freeze({
  late_arrivals:      { category: "attendance", kind: "sweep", window: true,  subject: "employee", source: "attendance", owner: "LA M1" },
  missing_clock_out:  { category: "attendance", kind: "sweep", window: false, subject: "employee", source: "attendance", owner: "LA M1" },
  approval_ageing:    { category: "approval",   kind: "sweep", window: false, subject: "workflow_instance", source: "workflow", owner: "built M0" },
  document_expiry:    { category: "document",   kind: "sweep", window: false, subject: "document", source: "documents", owner: "built M0", deadline: true },
  confirmation_due:   { category: "people",     kind: "sweep", window: false, subject: "employee", source: "organisation", owner: "built M0", deadline: true },
  contract_ending:    { category: "people",     kind: "sweep", window: false, subject: "employee", source: "organisation", owner: "built M0", deadline: true },
  partner_inactivity: { category: "partnership", kind: "sweep", window: false, subject: "partner", source: "partners", owner: "GE M7" },
  budget_threshold:   { category: "budget",     kind: "sweep", window: false, subject: "budget", source: "budgets", owner: "AJ M8" },
  recruitment_sla:    { category: "recruitment", kind: "sweep", window: false, subject: "application", source: "recruitment", owner: "TB M4" },
});
```
  `category` is then **derived** (contract `virtual`), not a new column (schema B1 proposes a column;
  a derived value cannot drift). `permission_key` default per metric is a form default, still stored
  per rule.
- Only the four M0-backed metrics produce real alerts in M1 (G18).

### G4 · Deadline metrics do not fit `evaluate()`

`evaluate(rule, value)` breaches on `value >= threshold` and `over_by = value - threshold`
(alerts.js:91-98). "Document expiring within D days" breaches on `days_left <= D` and §10.1 says the
Over By cell "shows the days left instead". Options (owner-neutral, pick in PR 4): (a) add
`direction` to the metric registry (G3), compute `breached` and `over_by` in the handler, and give
`raise()` an optional `over_by` override (shared change, test); or (b) pass `value = D - days_left`
and render "N days left" on the client from `metric.deadline` + `threshold - over_by`. (a) keeps the
stored `over_by` honest; (b) needs no shared change. Neither brief chose.

### G5 · Capability gate variants the middleware lacks

`rbac.js` exports one-code `requireCapability` only. If any route must pass on either of two codes
(X15), add:
```js
function requireAnyCapability(codes) {            // same shape as requireCapability; CEO passes
  return async function anyCapabilityCheck(req, _res, next) { requireUser(req); if (req.user.is_ceo === true) return next();
    const held = await grantsCache.getCapabilities(pool, req.user.user_id);
    if (!codes.some((c) => held.includes(c))) throw new AppError("CAPABILITY_REQUIRED", "This needs an authority you do not hold", 403);
    return next(); };
}
```
Also: capability codes are not validated at boot (`requireCapability` accepts any string; a typo
silently denies everyone but the CEO). Keep the codes in one exported constant (e.g.
`src/modules/dashboard/dashboard.capabilities.js` or in `access.catalog`) used by routes, the seed
test, `/me`, `screens.js` and the app, and unit-test that each is seeded in 1199/0449.

### G6 · Capability holders, as seeded, vs the real roster

0449 gives `alerts.clear` to implementation, operations_people, management. Decision 2 needs the
1199 seed to say who gets `home.team`, `home.reports`, the manage code. Real people
(`seeds/staff/roles.json`, guides §2.3): Chinyere (head_of_department), Oladotun (manager) manage
people; Cynthia (operations_people) manages nobody. Today's tab rule (`manages_people`) shows Team to
Chinyere and Oladotun and hides it from Cynthia; a capability rule seeded to
`implementation, operations_people, management, head_of_department, manager` flips Cynthia to
visible and keeps the other two. Anyone who manages people while holding only `employee` loses Team
under capabilities (none on the current roster). Recommended 1199 grants (owner to confirm):

| Code | implementation | operations_people | management | head_of_department | manager |
|---|---|---|---|---|---|
| `home.team` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `home.reports` | ✓ | ✓ | ✓ | ✓ | ✓ |
| manage rules | ✓ | ✓ | ✓ | | |
| `alerts.clear` (0449 adds the first three) | (0449) | (0449) | (0449) | add | add |

### G7 · "Run Now" response, render latency and the UI

- The request may create the run row (number allocated in the tx, `emit("home.report_run")`), but
  gathering every page, rendering the PDF (Chromium, worker `pdf-render`) and building the XLSX are
  outbox work (BACKEND_GUIDE §2 table: service never "renders PDFs … inside the transaction"). So the
  response is `HomeReportRun { …, status: "pending", document_id: null }` and the contract must make
  `document_id` nullable. home.md §5 ("returns the run and its `document_id`") must change.
- For a PDF the handler calls `documents.generate()` (row now, render later); `document.generated`
  then fires the email handler; `serve()` answers 409 `DOCUMENT_RENDERING` until done, 410
  `DOCUMENT_RENDER_FAILED` after. The Recent Runs row must show Pending/Failed and not offer download
  until `status = 'done'`. `saveFile()` (`app/src/api/download.ts`) must not be called on a pending run.
- Run status is updated by handlers listening to `document.generated` / `document.render_failed`
  filtered by `payload.doc_type === "home_report"` (PDF) and directly after `vault.store` (XLSX).
- Idempotency: the HTTP layer replays a pressed key (POST must answer 2xx JSON, not 204); the
  service also dedups a second press within the same minute by `(saved_report_id,
  recipient_user_id, format, requested window)` or by storing the `Idempotency-Key` on the run.
- CI cannot render PDFs (no Chromium on the runner path `chromium.resolvePath()` checks): PDF tests
  must skip with the `hasChromium` pattern (`tests/integration/documents-api.test.js:56`); staging
  needs Chromium installed or every PDF run fails after five attempts.

### G8 · Report schedule columns the briefs did not list

`recurrence.nextAfter(rule, start, after, …)` needs a **start date** (anchor for `interval > 1`,
`count`), and the header says the time of day is stored next to the rule. `report_schedule` has
neither. Full fix-forward list for 1140 (consolidating schema B3/B4 and this gap):

```sql
ALTER TABLE saved_report    ADD COLUMN IF NOT EXISTS archived_at timestamptz;              -- runs keep their parent
ALTER TABLE report_schedule ADD COLUMN IF NOT EXISTS starts_on date NOT NULL DEFAULT CURRENT_DATE;  -- writer always sends lagos.today(); default only backfills
ALTER TABLE report_schedule ADD COLUMN IF NOT EXISTS run_time time NOT NULL DEFAULT '18:00';
ALTER TABLE report_schedule ADD COLUMN IF NOT EXISTS formats text[] NOT NULL DEFAULT '{pdf}';
ALTER TABLE report_schedule ADD COLUMN IF NOT EXISTS recipient_user_ids uuid[] NOT NULL DEFAULT '{}';  -- or keep emails (C15)
-- CHECK formats <@ ARRAY['pdf','xlsx'] AND cardinality(formats) > 0, inside DO $$ … pg_constraint … $$
CREATE INDEX IF NOT EXISTS report_schedule_saved_report_idx ON report_schedule (saved_report_id);
CREATE INDEX IF NOT EXISTS report_schedule_due_idx ON report_schedule (next_run_at) WHERE active;
CREATE INDEX IF NOT EXISTS saved_report_report_key_idx ON saved_report (report_key);

CREATE TABLE IF NOT EXISTS home_report_run (
  home_report_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number citext NOT NULL UNIQUE,                                         -- numbering.allocate(client, "report_run")
  saved_report_id uuid NOT NULL REFERENCES saved_report(saved_report_id) ON DELETE RESTRICT,
  report_schedule_id uuid REFERENCES report_schedule(report_schedule_id) ON DELETE SET NULL,
  scheduled_for timestamptz,                                             -- the slot; NULL on demand
  recipient_user_id uuid NOT NULL REFERENCES app_user(user_id) ON DELETE RESTRICT,
  requested_by uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  format text NOT NULL CHECK (format IN ('pdf','xlsx')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','failed','skipped')),
  document_id uuid REFERENCES document(document_id) ON DELETE SET NULL,
  emailed_at timestamptz, error text, run_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS home_report_run_slot_uq
  ON home_report_run (report_schedule_id, scheduled_for, recipient_user_id, format) WHERE report_schedule_id IS NOT NULL;
-- + indexes on every FK and on run_at; CREATE OR REPLACE TRIGGER home_report_run_set_updated_at …
```
`skipped` = recipient no longer active or no longer holds the source's grant (generation as the
recipient, `architecture` §11.8). One schedule per report is what the UI shows; enforce it in the
service (or a unique index on `report_schedule(saved_report_id)`; a new constraint on an existing
table needs the `DO $$` guard and a DOWN that drops it).

### G9 · Clock-in prompt (decision 12): what Home can own today

- Server flag on the overview, stateless and exact: prompt when **all** hold for the caller:
  `employee.status = 'active'`; `isWorkingDay(lagos.today(), cal)`; no approved `leave_request`
  covering today; no `attendance_event` `clock_in` today (Lagos bounds, `validation_state <>
  'rejected'`); and the current session is the first issued today:
  ```sql
  SELECT count(*)::int AS n FROM user_session s
   WHERE s.user_id = $1 AND s.issued_at >= $2 AND s.issued_at < $3   -- lagos.startOfDay/endOfDayExclusive(today)
  ```
  `n === 1` and `req.user.session_id` is that row (`auth.js:151` sets `session_id`). This is the
  meetings' "first login of each day" (module demos 00:58:30), skippable, and does not fire again
  after a dismiss (no dismissal table needed).
- Client: Overview opens `useClock().open()` once when `prompt_clock_in` is true; delete
  `useClockPrompt()` from `app/src/shell/Shell.tsx:96` in the same PR (else two triggers). Touching
  `app/src/features/attendance/ClockButton.tsx` needs an attendance.md Change log line.
- The prompt's own data (`GET /attendance/me/today`) and the punch (`POST /attendance/punches`) are
  INTERIM only. Until LA ships them the prompt works on the mock and 404s on staging. PR 2 must not
  claim decision 12 done on staging; say so in PROGRESS.

### G10 · Need You

Built and sufficient for M1: `GET /api/v1/workflow/mine` (paged, `self: true`, rows carry `link`)
and `/workflow/mine/count` (`{ waiting, overdue }`, foundation §4 "Home's Waiting on You"). Note
`waitingWhere` limits to modules where the person holds `approve` (`leave.approval` is module
`people`), so a person with no `people` approve never sees leave approvals there (schema J16). Staff
(employee role) hold `approve` nowhere: their Need You is empty in M1 (alerts they can clear: none,
tasks: M2). home.md §6 "Need You is present for every role": render it with its empty state.

### G11 · Search and AI surface (guide §9) concretely

Route-map changes (all in `src/shared/route-map.js`, shared, not guide-covered):
```js
home_alert:      screen("home", "alerts"),    // provider in alerts.search.js (remove the marker in PR 4)
home_alert_rule: screen("home", "alerts"),    // NEW: guide §9 "alert rules … searchable"
home_report:     screen("home", "reports"),   // provider in reports.search.js (PR 5)
home_report_run: screen("home", "reports"),   // provider in reports.search.js (PR 5)
home_kpi:        screen("home", "overview"),  // NEW: guide §9 "and KPI cards"; id = catalogue key, Overview opens the detail for ?id=
```
Providers must filter per person, which `recordProvider` cannot (the search service checks only the
module `view` grant, and every login holds `home` view):
- `alerts.search.js`: custom providers (shape of `workflow.search.js` `waiting`) for `home_alert`
  (only rules the reader may clear, subject in scope) and `home_alert_rule` (manage code holders).
- `reports.search.js`: custom provider for `home_report` (owner or `shared` and the reader holds the
  source module's `view`); `recordProvider` with `owner: { column: "r.recipient_user_id" }` works for
  `home_report_run`.
- `dashboard.search.js`: custom provider for `home_kpi` over the catalogue (code, not SQL):
  `eligible(user)` ∩ label match, paged with `envelope()`.
- Each provider runs under a 2 s statement timeout in a savepoint; a throw loses only its group.
- `actions.js`: `a("new_rule", "New Rule", { screen: "home.alerts", params: { action: "new" }, … })`,
  `a("new_report", "New Report", { screen: "home.reports", … })` (actions.js is not a manifest, so
  `action:` is legal there).

AI manifests (reads only, `permission: ["home", "view"]`, capability and rule checks inside `run`):

| File | Read key | params | run |
|---|---|---|---|
| `alerts.ai.js` | `alerts.mine` | `c.alerts.HomeAlertQuery` (list) | `service.list(client, { ...params, mine: true }, actor)`; returns empty page unless `alerts.clear` (CEO passes) |
| `dashboard.ai.js` | `team.today` | `c.dashboard.HomeTeamQuery` (list) | `home.team` checked in run; roster page in `actor.scope` |
| `dashboard.ai.js` | `cards.mine` | `c.common.EmptyBody` (one record) | the caller's resolved cards (eligibility needs the user: `actor` carries it) |
| `reports.ai.js` | `reports.mine` | `c.reports.HomeReportQuery` (list) | reports the caller receives |

Routes: `{ intent: "see open alerts", screen: "home.alerts", params: { category: "attendance" } }`,
`{ intent: "open a report", screen: "home.reports" }`, `{ intent: "see who is in", screen: "people.attendance" }`.
Never a key named `action(s)`, `write(s)`, `creates`, … anywhere in the file, strings included
(`ai-no-writes.js:29` keeps strings: a description containing "actions:" fails).

### G12 · Alerts list: filtering by "rules I may clear" efficiently

`mayClear` is per rule. For the paged list and the counts: load the rules once
(`// pagination:complete the alert rules, tens of rows`), compute the visible rule ids in JS with one
`grantsCache.getGrants` per distinct module (cached 30 s; CEO: all), then
`WHERE a.home_alert_rule_id = ANY($n::uuid[])` plus, once `subject_employee_id` is stored (schema B2),
`scopeClause(scope, { column: "a.subject_employee_id" })` with `scope = scopeFor(user, module, action)`
per rule's module (or the widest, documented). Expose `can_clear` per row (frontend §8). Without the
new column, a team-scoped holder can see and clear alerts about anyone (alerts.js `mayClear` ignores
scope): record that if the column slips.

### G13 · Main chart and side donut per role

`role_kpi` (decision 5) configures cards only. The main chart and donut (§10.1: Operations
Attendance 14 Working Days + on-time donut; CEO goals + org KPI; Partnerships pipeline + monthly
signed value; Staff day strip) are chosen by `me.home_view` in code
(`src/modules/dashboard/dashboard.layout.js`, auto-allowed name), with eligibility applied (a chart
whose module the viewer cannot read is `null`). CEO and Partnerships charts read M2/M7 tables: empty
on production until those land.

### G14 · Overview Export has no backend design

`frontend.md` proposes `POST /api/v1/home/overview/export` but nothing designs it, and
`features/shared/sections.tsx` `ExportAction` posts to INTERIM `POST /api/v1/exports` (unbuilt).
Simplest consistent option: treat it as a fixed report source `overview` in the reports engine
(`REPORTS.overview`), so Export = an on-demand run as the caller (numbered, vaulted, emailed),
response 202-style pending run, toast "Export queued". That places Export in PR 5 (decision 9 lists
it there). Owner may prefer a non-numbered mailbox export like `POST /audit/exports`.

### G15 · Staging seed mechanics (decision 11)

- `uuid` is only a transitive dependency (present in `node_modules`, absent from `package.json`
  dependencies). For deterministic UUID v5 tags write a 10-line helper on `node:crypto`
  (`createHash("sha1")` over namespace bytes + name, set version 5 and variant bits) in
  `seeds/staging/lib/` rather than importing an undeclared package.
- `scripts/db/seed.js` ACTOR is `{ user_id: null, source: "script:seed" }`; `scopeFor` returns `null`
  for no `user_id` (`rbac.js:260`), so Home services that check rights refuse it. Use a real
  system user only where a service needs one, or call repos/engine functions inside `atomically()`
  for Home's own tables, and direct SQL for forward tables (no services exist).
- `schema-drift` does not scan `seeds/staging/`: add an integration test that runs the seed function
  directly against the rebuilt test DB (twice, to prove idempotency).
- `attendance_event` rows for the roster on staging are also "forward" in effect (LA's punch service
  does not exist): write them directly, tagged.
- Real people only (foundation §6.1/§6.2): find staff by `work_email`/`job_title`, never mock names.
  File name sorts after `10_staff.js` (e.g. `60_home.js`).

### G16 · `organisation` counts through the service

`headcount`, `attrition_90d`, `confirmations_due` should read the same definition People ·
Employees uses: `organisation.repo.counts(db, scope)` is exported by the repo only; the service
exposes `summary(client, scope)` (`organisation.service.js:353`), which also runs three other
queries. Add `counts` to `organisation.service` exports (organisation module ⇒ foundation.md and
organogram.md Change log lines) rather than requiring the repo from dashboard. Note `counts` uses
`current_date` (DB session zone) while Home uses `lagos.today()`.

### G17 · M1-demonstrable alert sources

Real (built M0 tables, have writers): approval ageing (`workflow_instance`), document expiry
(`document.expires_on`), confirmation due and contract ending (`employee`). Attendance metrics read
`attendance_day` (no writer: LA's day-close job is a stub) or `attendance_event` (no writer: punch API
INTERIM): they produce nothing on production until LA ships. Forward metrics (partners, budgets,
recruitment) produce nothing on production until M4/M7/M8 and only staging-seeded data on staging.

### G18 · Decision numbering

The relayed decisions jump from 9 to 11 (no decision 10). If a decision 10 exists it did not reach
any brief; confirm with the owner.

---

## 3 · Consolidated doc-vs-code conflicts the owner must know about

Each line: what disagrees, the evidence, and the action (R = recommended default if the owner
says nothing).

| # | Conflict | Evidence | Owner action |
|---|---|---|---|
| C1 | home.md header `Backend modules \| home`, §5 `schemas/home.js`, §9 `home.ai.js`/`home.search.js` | README §5.2/§5.4, CODEOWNERS 123-138, stubs, route-map markers say `dashboard`, `alerts`, `reports`; guides gate keys on the header | R: header becomes `` `dashboard`, `alerts`, `reports` `` (add `attendance` only if home.md should also cover the roster file) in PR 1 |
| C2 | home.md header/§5/§8 list `home.team`, `home.alerts`, `home.alerts.manage`, `home.reports` as permission keys | `access.catalog.js` has module keys only; `alerts.parsePermission("home.alerts")` throws (pinned in `events-workflow.test.js`); decision 2 makes them capabilities; there is no `home.alerts` code (existing one is `alerts.clear`) | R: rewrite as "capabilities" and replace `home.alerts` with `alerts.clear` |
| C3 | Decision 2 code `home.alerts.manage` | `CapabilityCode` `/^[a-z][a-z_]*\.[a-z][a-z_]*$/` (`access.js:28`); `RoleSave.capabilities` refuses it, so no one can grant it on screen | Pick: rename (R: `home.alert_rules`) or widen the regex to 2-3 segments (touches identity/foundation guides and access tests). Also the "convention every module owner applies" needs a written shape (`<module>.<area>` with underscores) |
| C4 | Clearing gate: `requireCapability("alerts.clear")` (decision 2) vs `mayClear` (rule grant, any scope) | `alerts.js:207-216`; 0449 grants `alerts.clear` to 3 roles; `home.alert_raised` notifies grant holders (`fanout.js` ~470), so a notified manager can be refused; home.md §8 says line managers and function leads clear their alerts | R: both checks (capability = "may clear alerts at all", rule grant = "may clear this one"), and grant `alerts.clear` to head_of_department and manager in 1199. Or drop the capability on clear and keep only `mayClear` |
| C5 | home.md §6 "switching a rule off clears its open alerts" | Engine never closes alerts; `clear()` requires the actor's clearing right | R: new `alerts.closeForRule` (G2), outcome `dismissed` |
| C6 | home.md §4 `home_report(id, key, source, filters, schedule cron, formats, recipients, reporting_line, permission_key, enabled, created_by)` and `home_report_run(id, …, recipients)` | 1000 built `saved_report` + `report_schedule` (decision 1 keeps them); PK naming `<table>_id` (MIGRATIONS §6); `recurrence jsonb` not cron | R: rewrite §4 to the merged tables + G8 columns; `report_key` is both key and source; `definition` holds filters; `active=false` is Paused |
| C7 | home.md §5 `GET /home/reports/:id/runs`; no `/summary`, `/meta`, `/report-runs`, `PATCH /reports/:id`, `GET /alerts/:id`, picker, role-card or export routes | INTERIM `app/src/api/types/home.ts:155-170` uses `/kpi/:key/meta`, `/team/summary`, `/alerts/summary`, `/reports/summary`, `/report-runs`; frontend needs `GET /alerts/:id` for `?id=` deep links | R: §5 lists what ships: all INTERIM paths + `PATCH /reports/:id`, `GET /alerts/:id`, `GET /kpi-picker`, `PUT/DELETE /kpi-picks`, `GET/PUT/DELETE /roles/:role_id/kpis`; `/report-runs?saved_report_id=` replaces `/reports/:id/runs` |
| C8 | home.md §5 "`POST /reports/:id/run` returns the run and its `document_id`" | Rendering/building is outbox work (BACKEND_GUIDE §2; CLAUDE.md "Follow-on work is an outbox handler") | R: returns the pending run, `document_id` null (G7) |
| C9 | home.md §4 `home_alert_rule.scope`, `created_by`; UI needs `name` | 1000 has none of the three; DATABASE_SCHEMA owes "alert scope", undefined anywhere | R: add `name text NOT NULL` (backfill `key` first), `created_by`, `updated_by`; drop `scope` from §4 unless the owner defines it; add `home_alert.subject_employee_id` (schema B2) for scoped lists |
| C10 | REUSE_MAP §3.2 (M2, Performance) and MILESTONES §7 line 631 place `security/role_kpi/` in M2 | Decision 5 and home.md §4/§12 put `role_kpi` in Home M1; CLAUDE.md step 3: REUSE_MAP wins over MILESTONES | Owner confirms the decision overrides REUSE_MAP; update REUSE_MAP §3.2 (and §1.4 deliberate changes) in PR 1 |
| C11 | home.md §10.1 last paragraph and §11 "a gated tab shows a lock, For Managers" | `Shell.tsx` hides and redirects; FRONTEND_GUIDE line 628; `screens.js:134-135` mirrors hiding; F-decisions outrank FRONTEND_GUIDE but neither speaks to Home | Pick visible+lock (frontend R) or hidden (R here: less change). Either way home.md §10.1/§11 and the two mirrors change together |
| C12 | Tab gating mirrors use `manages_people`/settings grant | `app/src/shell/access.ts:16-17`, `src/shared/search/screens.js:134-135`, `search.service.readerOf` (no capabilities); `Me` strict without capabilities | Decision 2 ⇒ `Me.capabilities` (identity contract, identity.md), all three mirrors, mock identity, in one PR |
| C13 | home.md §3 step 1, §2, §10 "Clock-in prompt owned by Attendance"; attendance.md §10.2 "after sign-in it opens by itself" | Decision 12 moves the trigger to Home; code fires after every explicit sign-in (`ClockButton.tsx useClockPrompt`); punch API INTERIM | R: G9 definition; both guides updated in PR 2; LA informed (CODEOWNERS on attendance) |
| C14 | Report runs: one table (decision 1) vs per-recipient/per-format files | Generation "as the recipient" in PDF and XLSX makes N×M files per firing; schema brief proposes `home_report_delivery` | R: one `home_report_run` row per file (G8); numbers grow N×M per firing. Owner may accept a second table instead |
| C15 | Recipients: `report_schedule.recipients citext[]` (emails, NOT NULL, no default) vs generation as a user | `scopeFor`/`getAuthUser` need a `user_id`; an email with no login cannot be served | R: add `recipient_user_ids uuid[]` (G8) and write `recipients` as the users' emails for display; or validate emails to active `app_user` on save. Define `reporting_line` (home.md §4) or drop it: no schema, no meaning yet |
| C16 | home.md §13 / §8 "Team … for their department" (function leads) | `team` scope = recursive solid line (`grants-cache.getTeamEmployeeIds`); no department scope exists; Chinyere's 7 dotted reports sit under a vacant seat and are in nobody's team | Owner decides; R: M1 = reporting tree only, documented in §8 |
| C17 | `role.home_view = 'partnerships'` for every head_of_department (0290) | Only HoD today is Head PR, Marketing & Brand Strategy; a non-partnership HoD would get the partnerships Overview; home.md §11 says no pipeline card for roles without function data | Owner: per-role defaults via `role_kpi` (decision 5) can fix cards, but the chart follows `home_view` (G13) |
| C18 | Kickoff 01:18:00: the CTO's Home is "the health of the whole application" | CTO = management + administrator ⇒ `home_view = operations` | Owner: not modelled in M1 (R), note in §13 |
| C19 | home.md §6 "Need You is present for every role" | demo Staff overview has none; staff hold `approve` nowhere so it is empty in M1 | R: render with empty state for staff |
| C20 | home.md §3 step 3 lists "field" among Clocked In Today groups; §10.1 lists On Site, Remote, Late, No Clock-Out Yesterday, On Leave | No table or pattern gives "field" (`work_pattern` on_site/hybrid/remote; no assignment table); 1099 statuses present/late/absent/leave; mock adds "Not In" | Owner + LA agree one status vocabulary for the roster (decision 4); R: drop "field" from M1, add when LA's assignments land |
| C21 | attendance.md §4 tables (`attendance_session`, `attendance_case`, …) and permission key `attendance` | 1000 built `attendance_event/day/exception`; catalogue has no `attendance` key (it is `people`) | LA's guide; the roster is written against what exists |
| C22 | home.md §7 signal events `attendance.rule_breached`, `partnership.inactive`, `approval.aged`, `document.expiring`, `recruitment.sla_missed`, `budget.threshold` | Declared nowhere; attendance.md §7 has no rule-breach event; `document.*` keys belong to module `settings` (vault) | R: time-based metrics are Home sweeps (decision 6, G3); push only for `attendance.punched` when LA declares it; rewrite §3 step 4 and §7 |
| C23 | README §5.15 assigns `approval-ageing`, `budget-threshold` (M8), `partner-inactivity` (M7) schedulers | Decision 6 gives Home the daily sweeps | R: one Home scheduler `home-alert-sweeps` (daily, Lagos) calling each metric's sweep; README §5.15 says the M7/M8 stubs are replaced by it or feed it; leave their files untouched |
| C24 | A26 vs 1099's three alert rules | Decision 7 moves them out | R: new 1199 file, guarded DELETE (`IS NOT DISTINCT FROM` for `window_days` NULL; `NOT EXISTS home_alert`), `-- DESTRUCTIVE:` marker; staging seed recreates rules through the service. 1099's `Standard` attendance policy and 8099's `expense_category` rows are the same A26 problem for LA/AJ |
| C25 | A26 vs per-role KPI defaults | Presentation defaults are a business choice | R: no `role_kpi` seed; code defaults by `home_view` (donor §3.5); `role_kpi` rows only from the editor |
| C26 | F12 "a module's mock is deleted when its real routes ship" | Screen gates 8, 11, a11y crawl the mock build; every shipped module kept its mock; F12 outranks FRONTEND_GUIDE | Owner/AJ: amend F12 or accept keeping Home's mock retyped to the contract (R) |
| C27 | foundation §6.2 / F13 staging rows "through each module's service" | Forward modules have no services; decision 11 needs rows in their tables | R: direct, tagged SQL for forward tables, recorded in home.md and each adapter header |
| C28 | HANDOFF "Migrations are LA's … do not touch `src/modules/*` … ask first" | Decisions 1, 4, 7 have TB writing M1 migrations and a file in LA's attendance module | Owner tells LA; LA reviews 1140/1199 and `attendance.roster.js` (CODEOWNERS 143 lists LA, GE, TB) |
| C29 | MILESTONES §6.2 per-day `grace_minutes`; client meeting 13/10 "5-minute grace" | `working_week` has no grace; `attendance_policy.grace_minutes` default 0 ('Standard' in 1099) | LA's; roster reads policy grace; until set, lateness = any minute after start |
| C30 | MILESTONES §6.1 ports `shared.js`, `resolve.js`; home.md §12 omits them and adds `role_kpi`, `party-360` | both lists are partial | R: home.md §12 lists all (`kpi-catalog/shared.js`, `resolve.js` new files ⇒ README §5.4) |
| C31 | Gate docs stale: README §8 / FRONTEND_GUIDE §10 say `date-format` not built (it is); `progress.js` header says 85 screens, README 86, code 93; BACKEND_GUIDE §3.6 manifest example `params: { action: "new" }` fails gate 19 | gates brief §12 | Docs only; not Home's to fix but do not copy the BACKEND_GUIDE example |
| C32 | PR template comment contains literal `Progress-unchanged:` / `Guide-unchanged:` lines; the trailer regex does not skip HTML comments | gates brief §1.3 | Delete those lines from every Home PR body |

---

## 4 · Risks to the five-PR plan

### 4.1 Calendar

- **Demo Monday 19/10** ("Management dashboard renders with role-locked tiles and no sales
  anywhere", MILESTONES §6 DoD). Two days, a weekend, one approving reviewer who is not the author
  (GE for TB's PRs), migration PRs "not merged the hour it is opened" (MIGRATIONS §12). Realistic:
  PR 1 + PR 2 on staging by Monday is already tight; Team, Alerts, Reports are post-demo. Mitigation:
  the demo can run on the staging build with the mock-free real API only where PR 2 has landed; the
  other tabs stay "Coming Soon" (F14: a tab opens on staging only when its API tick is set).
- LA's attendance API (punch, `me/today`) and day-close writer are not built: the Clocked In Today
  card, Team roster and attendance alerts show zero on staging unless the staging seed writes
  `attendance_event`/`attendance_day` directly (G15). "An employee clocks in on a phone" in the same
  DoD is LA's and blocks decision 12's visible effect.

### 4.2 Dependencies between PRs (as split by decision 9)

| PR | Needs from earlier PRs | Blocks |
|---|---|---|
| 1 foundation | owner answers C3, C4, C10, C11, C14, C15 | everything |
| 2 overview | catalogue, adapters, roster, picks tables, `Me.capabilities` | PR 3 (Team cards open `/home/kpi/:key`), PR 5 Export (if G14) |
| 3 team | roster (PR 1), KPI detail route (PR 2) | |
| 4 alerts | `subject_employee_id` column and engine changes (G2, G4) in PR 1 or PR 4; capabilities seed (PR 1) | Overview `alerts_high_open` card counts (works at zero before) |
| 5 reports | `home_report_run`, schedule columns, `report_run` scheme + settings lists (G1), adapters, roster | close-out of all stubs |

Recommendation: put **all** Home schema (1140) and the reference seed (1199) in PR 1 so LA/GE review
migrations once; contract-columns only needs a table to exist when a schema names it, so later PRs'
contract additions are then free of migration churn.

### 4.3 Typecheck trap (every frontend-touching PR)

A route mounted in PR N regenerates `contract.gen.ts` with its `Endpoints` key; the same key still
declared INTERIM in `app/src/api/types/home.ts` is a TypeScript error (`endpoints.ts` comment). So
each PR that mounts a route deletes its INTERIM line and moves the screen to the contract shape in
the same PR (frontend §11 table). PR 1 must **not** mount INTERIM-declared routes (schemas only),
unless it also switches the screens.

### 4.4 Cross-guide and shared-file churn

PR 1 alone touches: identity contract + service (identity.md), access contract regex if widened
(identity.md, foundation.md), settings contract + service for numbering (foundation.md), organisation
service export (foundation.md, organogram.md), attendance roster (attendance.md, LA review),
`src/shared/alerts/alerts.js` + BACKEND_STRUCTURE §11.1 (engine changes), `route-map.js`,
`screens.js`, `search.service.js`, `app/src/shell/access.ts`, mock identity, README §5.4/§5.15,
DATABASE_SCHEMA, REUSE_MAP, PROGRESS (Summary counts recomputed after every rebase while LA/AJ/GE
move M1 rows), CODEOWNERS (only if new folders). `contract.gen.ts`, PROGRESS, README and route-map
are the files every parallel M1 PR conflicts on: regenerate `contract.gen.ts` after each rebase,
never hand-merge. `Guide-unchanged:` exempts every guide at once: avoid it.

### 4.5 Gates that will bite and how to pre-empt

- Pinned lists: `tests/unit/foundation/worker-jobs.test.js:33-58` (JOBS, SCHEDULERS) when adding
  `scheduled-report`, `scheduled-reports`, `home-alert-sweeps`; `tests/integration/settings.test.js`
  capability lists; `src/modules/settings/settings.test.js` doc types/labels.
- Search coverage: the moment `alerts.controller.js` and `alerts.repo.js` both have content, the
  route-map `home_alert` marker fails; same for reports. Dashboard needs `dashboard.search.js` or
  `// search:none <reason>` once its controller and repo have content (and `home_kpi` if added).
- AI coverage: each of the three folders with a filled controller needs a non-empty `.ai.js` or
  `// ai:none <reason>` (≥ 8 letters).
- Schema drift: adapters may name only migrated columns; never `payroll_run` (no M6 migration).
  Hidden catalogue entries carry no SQL.
- Pagination: no `LIMIT n` anywhere but `LIMIT 1` and marked worker batches; a JSDoc line
  `* at most limit 25` fails too (only `//` comments are stripped).
- Money: `budget_threshold` percentages and any money sum through `shared/money` or SQL, never
  `Number()`/`+` on a money-named identifier.
- Provenance: no "donor", "ported", "praxis" (except Praxis AI / JBS Praxis), "pixie" in code, tests,
  seeds or SQL comments; the catalogue port is where this slips.
- Screen gates locally: Chromium download from the Playwright CDN is blocked (gates brief §2.4) and
  pgvector is not installed locally: the Stop hook's `five-second`/`two-shells` fail on any app/
  change until a Chrome for Testing build is wired via `MYCITY_CHROMIUM`. Budget time for it or
  rely on CI and say so in the PR.
- Response check under `APP_ENV=test`: strict response schemas throw inside integration tests on any
  extra key (e.g. returning `_total`, a raw `scope` or `rule_key` from the engine).

### 4.6 Correctness risks inside the design

- Field masks: KPI detail rows and reports must go through `maskForUser`/`maskedKeysFor` for the
  reader; MyCity masks only when **every** mentioning role masks (grants-cache), not the donor's
  "most restrictive wins"; the CEO is never masked.
- Staff cards must gate on `ess` (always own), not `people`: employee and administrator roles hold no
  `people` grant (0290), so `people`-gated attendance cards vanish for every plain member of staff.
- Dates: every "today" is `lagos.today()` with `startOfDay/endOfDayExclusive` bounds; never
  `CURRENT_DATE`/`now()::date` (DB session zone). Saturday is a working day 09:00 to 15:00.
- Currency: every forward money table carries `currency char(3)`; `shared/money` is Naira only.
  Filter `currency = 'NGN'` or group by currency; owner open question.
- Activity Today from `event_log` must allow-list keys and never show `mail_*` events of others or
  `audit_ledger` before/after values.
- Outbox handlers run at least once: generation, email and sweeps idempotent by run id, slot unique
  index, `dedup_key`, deterministic `jobId`s.

---

## 5 · Decided defaults sheet (use unless the owner overrides)

| Item | Default |
|---|---|
| Modules | `dashboard` (overview, KPI catalogue, detail, team, picks, role cards, adapters, layout), `alerts` (rules, alerts, metrics, sweeps), `reports` (definitions, schedules, runs, generation); all `basePath: "/home"` |
| Contract | `schemas/dashboard.js`, `alerts.js`, `reports.js`; unique `Home*` names; `TABLES` for every object schema |
| Capabilities | `home.team`, `home.reports`, `home.alert_rules` (C3), existing `alerts.clear`; grants per G6 table; one exported constant list |
| Route guard shape | `requirePermission("home", "view")` then `requireCapability(code)`; scope from `req.scope` |
| Migrations | `1140_home_foundation.sql` (all schema incl. G8, role_kpi, home_kpi_pick, alert columns, indexes), `1199_seed_home.sql` (capabilities, `report_run` scheme, decision 7 removal) |
| Numbering | `report_run`, RPT-0001, never resets (+ settings DOC_TYPES/DOC_LABELS) |
| Picks | `home_kpi_pick`; `GET /home/kpi-picker`, `PUT /home/kpi-picks { kpi_ids }`, `DELETE /home/kpi-picks` |
| Role cards | `role_kpi(default_ids, locked_ids)`, no `scope_ids`; editor routes under `/home/roles/:role_id/kpis` gated `settings` view/edit; UI on Settings · Roles (foundation.md) |
| Card resolution | donor `selectBand` (concatenate roles by rank, locks lead, cap 4, shrink never pad), fallback `HOME_VIEW_DEFAULTS[home_view]` in code |
| Sources | `src/modules/dashboard/sources/<owner>.source.js`, each exporting `{ module, milestone, owner, tables: {table: [columns]}, owes, available }`, unit-tested against `scripts/check/lib/catalogue.js` `buildCatalogue()` |
| Roster | `src/modules/attendance/attendance.roster.js` exporting `page(client, { date, filters }, scope, query)` and `summary(client, { date }, scope)`; status vocabulary agreed with LA |
| Alerts | metric registry `alerts.metrics.js`; `enabledRulesForMetric`; `closeForRule`; `subject_employee_id` stored; one `home-alert-sweeps` scheduler (daily, Lagos) |
| Reports | one `home_report_run` row per file; `home.report_run` event + `reports.generate` handler; PDF via `defineDocType("home_report")`, XLSX via `vault.store`; `vault.defineAccess("home_report_run")`; email after `document.generated`; `scheduled-reports` scheduler (every 5 min, due scan on `next_run_at`) + `scheduled-report` handler |
| Clock-in | server `prompt_clock_in` (G9); Overview opens it; `useClockPrompt` leaves the Shell |
| Need You | client reads `GET /api/v1/workflow/mine` |
| Gated tabs | hidden (C11), guide updated, unless owner picks the lock state |
| Mock | kept, retyped to the contract (C26) |
