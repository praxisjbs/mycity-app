# <Feature> · Engineering Guide

| | |
|---|---|
| Owner | <initials> |
| Milestone | M<N> |
| Backend modules | `<module>`, `<module>` |
| Frontend paths | `app/src/features/<module>/` (the feature's own folders; never `packages/ui`) |
| Permission key(s) | `<key>` |
| Screens (PROGRESS.md rows) | #<n>, #<n> |
| Status | Draft · Agreed · Built · Accepted |
| Last changed | <dd/mm/yyyy> |

Copy this file to `docs/guides/<module>.md`. Delete the hints in angle brackets as you fill each
section. A section that does not apply says so in one line ("No public routes."); it is not
deleted, so a reader knows it was considered.

A guide is **full-stack**: backend, data, API, events, permissions and screens. Fill every section,
not only the ones your half of the work touches.

The header table is read by `scripts/check/guides.js`: **Backend modules** and **Frontend paths**
decide which code this guide covers. Frontend paths name the feature's own folders
(`app/src/features/<module>/`, a page in `public-app/src/pages/`). Shared components live in
`packages/ui` and are never a feature path: a component this feature needs that does not exist is
added there with `npm run new:component` (FRONTEND_GUIDE §1). A change to the covered code must
change this guide (and add a Change log line), or say `Guide-unchanged: <reason>` in the PR
description. Keep all fourteen section headings and both §10 tables, each with at least one real
row; the check requires them.

---

## 1 · What it is for

<Two or three sentences: the job this feature does for MyCity, in their words. Name the people who
use it (roles, not individuals).>

## 2 · Screens affected

Every screen, tab, modal and widget this feature appears on, including the ones in other modules.
A feature that shows up on four screens lists four rows; missing one is how a screen ends up
unbuilt.

| Screen / tab (slug) | Where | Who sees it | What it shows | What a person can do there |
|---|---|---|---|---|
| <ESS · My Attendance (`my-attendance`)> | <staff app> | <every employee, own scope> | <month view, lateness> | <filter by month, export> |

## 3 · How the screens relate

<The flows that cross screens, step by step. "An employee clocks in on Home → the punch appears in
People · Attendance register → a late punch raises a query in Queries & Sanctions → the deduction
shows in ESS · My Payslips until HR waives it." Name the event or API that carries each step.>

## 4 · Data

| Table | Key columns | Notes |
|---|---|---|
| <`attendance_punch`> | <`employee_id`, `work_date`, `clock_in_at`> | <device timestamp stored beside server time> |

Migration file(s): `<NNNN_name.sql>` (milestone block, README §6.3).

## 5 · API

| Method and path | Contract | Permission · scope | Paged | Notes |
|---|---|---|---|---|
| <`GET /api/v1/attendance`> | <`AttendanceListQuery` → `AttendancePage`> | <`people` view · all/team/own> | <yes, 25> | |

Every list is paged at 25 (BACKEND_STRUCTURE §16). Name the filters each list accepts.

## 6 · Rules and calculations

<Each rule as a sentence a test can check. "A punch more than `grace_minutes` after the day's
start is late." Where the numbers come from (settings, working week, policy) and who can change
them.>

## 7 · Events, jobs and notifications

| Event / job | When | Does |
|---|---|---|
| <`attendance.punched`> | <after a clock-in commits> | <outbox: realtime push to the register; rule evaluation> |

## 8 · Permissions and visibility by role

| Role | Sees | Can do |
|---|---|---|
| <Employee> | <own record only> | <clock in and out> |
| <HR / Operations> | <everyone> | <reconcile, waive, uphold> |

Restricted fields and who may see them.

## 9 · AI and search

- **AI reads** (`<module>.ai.js`): <read keys, what each answers, permission>. Paged at 25.
- **AI routes**: <intents that send the user to a screen, with prefill>.
- **Search** (`<module>.search.js`): <record types and the words people use for them>.

## 10 · On screen and mobile

What each screen shows open, what sits behind help, and how it is laid out on a phone
(FRONTEND_GUIDE §5, §7). **§3 and §6 are for engineers: nothing in them reaches a screen unless it
is listed here as tier 1 or tier 2.** Tier 3 (how the system works, why it was built this way,
reassurance nobody asked for) is never on a screen; say where it lives instead (this guide, the
manual, the AI assistant). Both tables are read by `scripts/check/guides.js`.

### 10.1 Content tiers

| Screen | Open (tier 1) | Behind help (tier 2) | Not on screen (tier 3), lives in |
|---|---|---|---|
| <Home · Alerts> | <the alert list: alert, trigger, who can clear, age, Over By, severity; Clear Alert, Alert Rules, New Rule> | <help term on Over By: how far past its threshold an alert has gone> | <"alerts are not notifications", escalation and audit mechanics: §3 and §6 here, the manual> |

### 10.2 Phone layout

| Screen | First on a phone | Left off a phone | Main action | Navigation |
|---|---|---|---|---|
| <Home · Alerts> | <four KPI cards two to a row, then alert cards with a severity pill> | <the Where Alerts Come From chart> | <Clear Alert, full width in the alert's sheet> | <bottom bar Home; the four tabs scroll sideways> |

## 11 · Edge cases

<Each with the decided behaviour. Offline, double submit, a person on leave, a suspended account,
a timezone or Saturday case, an empty state, a huge list.>

## 12 · Donor code

| From | File | Change on the way in |
|---|---|---|
| <pixie> | <`src/shared/attendance/repo.js`> | <drop the business column> |

## 13 · Open questions

<Anything not yet decided, who decides it, by when.>

## 14 · Change log

- <dd/mm/yyyy · initials · what changed in this guide and why>
