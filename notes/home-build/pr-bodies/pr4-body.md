## What this changes

Home PR 4 of 5, stacked on PR 3 (base `m1/home-team`): **Home · Alerts (#2) on the real API, desktop and phone**, with the metric registry, the daily sweep, the attendance signals, clearing with both checks, and the alert rules. Built to `docs/guides/home.md` §3 steps 5 and 6, §4, §5 Alerts, §6 Alerts, §7, §8, §9 and §10.

**Backend** (`src/modules/alerts`, `src/shared/alerts/alerts.js`, under `/home`)
- **Metric registry** (`alerts.metrics.js`, keys equal to the contract's `HomeAlertMetric`, each with its owning module, milestone and default Who Can Clear):
  - `late_arrivals` and `missing_clock_out`: attendance, counted over a window of days.
  - `approval_ageing`: days a pending request has waited at its stage.
  - `document_expiry`, `confirmation_due` and `contract_ending`: deadlines in whole days.
  - `partner_inactivity`, `budget_threshold` and `recruitment_sla`: these read their milestones' tables through the source adapters and find nothing until those milestones use them.
  - Each breach is read in SQL, a batch at a time.
- **The sweep** (`alerts.sweeps.js`, scheduler `home-alert-sweeps`, daily 06:00 Lagos):
  - For each switched-on rule, it raises, refreshes or leaves an alert per subject, each in its own transaction.
  - A rule it cannot read is logged and the others still run.
  - A breach a person cleared or dismissed is not raised again for the same evidence; newer evidence raises a new alert.
- **Signals:** `attendance.punched` (a clock-in) re-reads that person's late arrivals, and `attendance.day_closed` re-reads their late arrivals and missing clock-outs (outbox handler `alerts.person-signal`).
- **Who sees an alert:**
  - It is one condition in `alerts.repo.js`: the rule's `permission_key` held, and its scope over `subject_employee_id`.
  - An alert about no one in particular is seen only with `all` scope; the CEO sees all.
  - The list, one alert, the counts, the Overview's alerts beside Need You, the Open High Alerts card and its records, ⌘K and the assistant all read it.
- **Clearing** (`POST /home/alerts/:id/clear`):
  - Needs `alerts.clear` on the route and the rule's grant reaching the subject (`mayClear`).
  - An alert the reader may not see is a 404.
  - Clearing a closed alert answers it as it is, with no second audit entry.
- **Rules** (`/home/alert-rules`, `alerts.manage`):
  - Create and edit (any field but the metric, held to its metric's kind). The key is made by the server as `<metric>.<slug>`, with a number on the end when taken.
  - Switching a rule off dismisses its open alerts in the same transaction.
  - Saving a rule unchanged records nothing.
- **Lists and counts:**
  - `GET /home/alerts`, paged at 25. Filters: category, severity, state, mine, overdue, rule, `q`.
  - `/summary`: Open, Needs You, Overdue 7 Days +, Cleared This Week (since Monday, Lagos, `cleared` only), the category chips, Alert Sources over 30 days.
- **AI and search:**
  - `alerts.ai.js` reads only, with a route per category.
  - `alerts.search.js` covers alerts and rules; route-map types `home_alert` and `home_alert_rule`.
  - New Rule is a ⌘K action for `alerts.manage` holders.
- **Superseded:** the M7 and M8 stub schedulers for partner inactivity, budget threshold and approval ageing (README §5.15 says so; their files are untouched).

**Frontend** (`app/src/features/home/Alerts.tsx`, `AlertRules.tsx`)
- **Alerts tab:**
  - The four counts and the category chips.
  - The Open Alerts list with Who Can Clear and Over By ("+1", "12 days left", Expired). Over By carries the tab's one help term.
  - Alert Sources, 30 Days.
  - View Dismissed and View Open.
- **An alert opened:** Clear Alert and Dismiss Alert with a note, offered only where `can_clear` says it will work. Edit Rule for `alerts.manage`.
- **Alert Rules:**
  - Each rule's switch, with the Switch Off Rule confirmation.
  - New Rule and Edit Rule through the form system. Window Days appears only for a metric counted over days.
- **Deep links:** `?id=`, `?category=`, `?rule=` and `?action=new`.
- **Mock** retyped to the contract.

## Screens and items

#2 Home · Alerts: API, UI and Mobile ticked, Built.

## Checklist

- [x] `npm run ci` is green locally, the whole run (Node 20, `CI_STRICT=1`, `RUN_DB_TESTS=1` on Postgres 16 with pgvector and Redis 7): 44 of 44
- [x] `docs/PROGRESS.md`: rows ticked, Status and Updated set, a dated note added under the module
- [x] Feature guide in `docs/guides/` matches what was built, with a Change log line
- [x] New files are on the README map (README §11)
- [x] Every list pages at 25 through `shared/http/paged.js`
- [x] Contract changed first; `npm run gen:contract` run; `contract.gen.ts` not edited by hand
- [x] Desktop and mobile both done (frontend changes)
- [x] Screen text in three tiers: nothing explaining how the system works, help only through help terms or a Details row, word limits met (gate 8, FRONTEND_GUIDE §5)
- [x] The feature guide's §10 lists what each screen shows open, behind help and on a phone
- [x] Forms only from the form system in `@mycity/ui` (`packages/ui/src/form/`), validated as filled (gate 12, FRONTEND_GUIDE §8)
- [x] Shared components only from `@mycity/ui`; nothing new in `app/src/components/`
- [x] Styling tokens only: no hex, no arbitrary value, no inline `style` (F4, FRONTEND_GUIDE §9.3)

## Native app feel (frontend changes)

- **Phone:**
  - View Dismissed, Alert Rules and New Rule at the top, then the four counts two to a row and the category chips.
  - Alerts are cards with a severity pill, Who Can Clear and Over By; Over By's help term opens as a sheet on a tap.
  - An alert opens a bottom sheet with Trigger and Age, and Clear Alert full width at its foot.
  - A rule card shows its name, threshold, switch and Edit Rule. The rule form is a sheet, and New Rule is also in the floating button's fan.
  - Alert Sources, 30 Days stays on desktop.
- **Desktop:**
  - The four counts in a row, the chips, then the Open Alerts table (Alert, Trigger, Who Can Clear, Age, Over By with its help term on the header, Severity).
  - Alert Sources, 30 Days beside the list. An alert, Alert Rules and the rule form open as modals.

## For reviewers

- **LA:** Home listens to `attendance.punched` (clock-ins) and `attendance.day_closed`. The two attendance metrics read `attendance_day` and `attendance_exception` as Attendance writes them.
- **GE and AJ:** partner inactivity (M7), budget threshold (M8) and recruitment SLA (M4) read through `partners.source.js`, `budgets.source.js` and `vacancies.source.js`. The milestone that builds those tables updates the adapter in the same PR (home.md §4.1).
- **Reviewed before opening:** REVIEW_LINE

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01GSPctB6tk9PFSR1aH3jrJE
