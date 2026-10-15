# Organogram · Engineering Guide

| | |
|---|---|
| Owner | TB |
| Milestone | M1 |
| Backend modules | `organisation` |
| Frontend paths | `app/src/features/organogram/`, `app/src/features/people/` (Organogram tab), `app/src/features/ess/` (Org Chart tab) |
| Permission key(s) | `people` (builder, manage), `org_chart` (viewer, read for all staff) |
| Screens (PROGRESS.md rows) | #92 People · Organogram, #91 ESS · Org Chart (ratified 15/10/2026) |
| Status | Agreed |
| Last changed | 15/10/2026 |

This guide was written from a brainstorm with the client representative on 13/10/2026. The two
screens it describes are a **proposed addition** to the approved screen inventory (MILESTONES §18,
85 screens, "fixed"), so they are not yet numbered rows in `docs/PROGRESS.md`. Ratifying the
inventory (85 to 87) is a separate, recorded decision; this guide exists first so the shape is
agreed before any of that or any code.

---

## 1 · What it is for

MyCity needs the company reporting structure drawn clearly and beautifully, for two audiences. HR
and Operations (People) build and correct it; every member of staff reads it to see who reports to
whom and where they sit. It is not a new structure: it draws the same `line_manager_id` reporting
tree that already decides who approves whose leave, expenses and tasks, so the picture can never
drift from how the company actually runs.

## 2 · Screens affected

| Screen / tab (slug) | Where | Who sees it | What it shows | What a person can do there |
|---|---|---|---|---|
| People · Organogram (`organogram`) | staff app | HR, Operations (People), CEO and management | The whole company tree with HR-rich node cards, solid and dotted reporting lines, and vacant seats | Search, collapse and expand branches, drag a card onto a new manager to reassign, set a dotted-line manager, add or edit a vacant seat, export to PDF |
| ESS · Org Chart (`org-chart`) | staff app | every employee, HR included | The same whole company tree, read only, with the standard node card | Search, collapse and expand, zoom and pan, export to PDF. No editing, no restricted fields |
| Recruitment · Vacancies (`vacancies`) | staff app | HR, hiring managers | A "suggested vacancies" list, each built from a vacant seat (role title, department, reporting line) | Turn a suggestion into a real vacancy |
| People · Employees (`employees`) | staff app | HR, Operations | The employee edit form carries the line manager picker | Changing a line manager here is what moves the chart; the organogram reflects it |

## 3 · How the screens relate

The organogram reads one tree and nobody keeps a second copy.

- HR changes a reporting line, either by **dragging a card** on People · Organogram or by editing
  the **line manager** on People · Employees. Both go through the same write (see §5), emit
  `employee.reporting_line_changed`, and the chart re-reads. There is no separate "save the chart"
  step.
- A **vacant seat** on the organogram surfaces in **Recruitment · Vacancies** as a suggested
  vacancy. HR turns a suggestion into a real vacancy there; nothing is auto-created.
- The read-only **ESS · Org Chart** renders the same tree for every employee, through the
  `org_chart` read capability, with the standard card and no restricted fields.
- **People · Employees** also carries each employee's attendance setup (owned by the attendance
  guide, `docs/MyCity-ERP-Documents/attendance-guide.md`). A change of work arrangement applies
  from the employee's next punch; opening a registered home address, changing an arrangement and
  changing a home are each written to the audit log, and a replaced home is kept in history, never
  overwritten.

## 4 · Data

| Table | Key columns | Notes |
|---|---|---|
| `employee` | `line_manager_id` (self-FK, nullable for the CEO), `dotted_manager_id` (self-FK, nullable), `department_id` | `line_manager_id` already exists in the contract (`organisation.js`). `dotted_manager_id` is the net-new column for the matrix (full matrix in v1) |
| `department` | `id`, `name` | Department name is the node chip |
| `position` / vacant seat | role title, `department_id`, `line_manager_id` | A seat with no employee. A vacant seat can carry reports. Modelled so the line never breaks when a role is unfilled |

Migration file(s): in the M0/M1 number block, adding `dotted_manager_id` and the vacant-seat
representation (README §6.3). The reporting-line foundation itself is M0.

## 5 · API

| Method and path | Contract | Permission · scope | Paged | Notes |
|---|---|---|---|---|
| `GET /api/v1/org-chart` | `OrgChartQuery` to `OrgChartTree` | `people` or `org_chart` · all | see note | Returns the bounded company tree (nodes, solid and dotted edges, vacant seats). Restricted fields are never in the payload for the `org_chart` read |
| `PATCH /api/v1/employees/:id` | `EmployeeReportingUpdate` | `people` · team/all | n/a | Reassigns `line_manager_id` and/or `dotted_manager_id`. This is the existing employee write path, not a new one |

A drag on the chart calls the same employee write a form would. Export is client side (no endpoint).
**Paging note:** a tree must load whole to draw, so the org-chart read is a bounded graph, not a
25-per-page list. This is in tension with the "25 everywhere" rule (CLAUDE.md step 4); confirm the
exemption, or a lazy-load-children scheme for very large orgs, with the backend owner (§13).

## 6 · Rules and calculations

- The tree is built from `line_manager_id`. The root is the single employee with no line manager
  (the CEO). Exactly one root is expected.
- A reporting line may **not** form a cycle (A reports to B who reports to A). The write rejects a
  change that would create one.
- `dotted_manager_id` is an optional second relationship. It is drawn as a dashed connector or a
  "Dotted line: <manager>" tag, never as the primary line, and it does not affect permission scope:
  approvals of leave, expenses and tasks follow the solid line only (§1).
- Departments are data (`department` rows, §4): adding or renaming one is a setting, never a code
  change.
- A **vacant seat** is a node with a role and department but no employee. It may have reports. It
  carries no person data and never shows a card field that implies one.
- The viewer shows the **whole company**. The builder shows the whole company with edit affordances.
- Restricted fields (`bank_name`, `account_number`, `gross_monthly`, per BACKEND_STRUCTURE §9.4)
  and phone are never rendered on any organogram card, in either page.

## 7 · Events, jobs and notifications

| Event / job | When | Does |
|---|---|---|
| `employee.reporting_line_changed` | after a line manager or dotted manager change commits | outbox: the chart re-reads; permission scope caches that derive from the tree are refreshed |
| `vacancy.suggested_from_seat` | when HR sends a vacant seat to Recruitment | outbox: creates a suggested-vacancy entry on Recruitment · Vacancies |

## 8 · Permissions and visibility by role

| Role | Sees | Can do |
|---|---|---|
| Employee (any non-HR) | The whole company tree, read only, standard card | Search, expand, collapse, zoom, export. No edit, no restricted fields |
| HR / Operations (People) | The whole tree, HR-rich card | Build and correct the tree: drag to reassign, set dotted lines, add and edit vacant seats, send a seat to Recruitment, export |
| CEO / management | The whole tree | Read. Edit only with the `people` capability |

Restricted fields: never on an organogram card for anyone. Salary, bank and phone live on the
employee 360 and ESS · My Profile under their own rules, not here.

## 9 · AI and search

- **AI reads** (`organisation.ai.js`): "who reports to whom", "who reports to X", "how many people
  in <department>", "which roles are vacant". Read only (A23), reading the same tree, in pages of
  25. No write.
- **AI routes**: "show me the org chart" opens ESS · Org Chart (or People · Organogram for HR),
  optionally focused on a named person.
- **Search** (`organisation.search.js`): a person by name or role reaches their node; words people
  use include "org chart", "organogram", "structure", "who is my manager", "reporting line".

## 10 · On screen and mobile

What each screen shows open, what sits behind help, and how it is laid out on a phone
(FRONTEND_GUIDE §5, §7). **§3 and §6 are for engineers: nothing in them reaches a screen unless it
is listed here as tier 1 or tier 2.** Tier 3 (how the system works, why it was built this way,
reassurance nobody asked for) is never on a screen; say where it lives instead (this guide, the
manual, the AI assistant). Both tables are read by `scripts/check/guides.js`.

### 10.1 Content tiers

| Screen | Open (tier 1) | Behind help (tier 2) | Not on screen (tier 3), lives in |
|---|---|---|---|
| People · Organogram (`organogram`) | Organogram; the seat count on desktop (12 seats · 11 filled · 1 open); Search, Expand All, Download PDF, Add Role; the legend (Reporting Line, Dotted Line, CEO, Vacant Seat); the whole tree. Each node card carries initials, name, title, the department chip, the since and arrangement line, a dotted-line tag where set, and Create Vacancy on a vacant seat. Node text is data | Help term on the legend's Reporting Line: "Drag a card onto a new manager to change its reporting line." Help term on Dotted Line: "A second manager for matrix work. It does not change who approves leave, expenses or tasks." | That a drag is the same employee write as the form and is audited: §3, §5. That a vacant seat becomes a suggested vacancy in Recruitment: §3. That salary, bank details and phone never show on a card: §6, §8. The subtitle "The live reporting structure … drag a card to reassign" and the footnote paragraph under the tree are removed |
| ESS · Org Chart (`org-chart`) | Org Chart; the seat count on desktop; Search, Download PDF; the legend; the whole tree with the standard node card (no since and arrangement line; "Open role" on a vacant seat) | Help term on the legend's Dotted Line, the same text as the builder | "Read only", "Every employee sees the whole company here" and the restricted fields never shown: §6, §8. "On a phone this becomes a focus view": §10.2. The subtitle "Who reports to whom across MyCity · read only" and the footnote paragraph are removed |
| Recruitment · Vacancies (`vacancies`) | Not in the demo yet. The suggested vacancies list: role title, department, reporting line; Create Vacancy | None | That nothing is auto-created from a seat, and the hand-off event: §3, §7 |
| People · Employees (`employees`) | Employees; 25 staff · 6 departments on desktop; Import, Add Employee; Headcount, Confirmed, On Probation, Attrition, 90 Days; the count per work arrangement; All Employees (employee, department, Line Manager, arrangement, Attendance Today, Employment Status, View Details) with 9 of 25; Headcount by Department; Needs a Decision. A row opens the employee modal: Employment, Attendance and Location; Close, Edit Home, Change Arrangement, Open Full Record. The 360 behind Open Full Record | On the 360, help term on KPIs This Month: "Weighted to 100%. Progress counts from the tasks linked to each KPI." In Edit Home Geofence, help term on Radius: "Fixed at 100 m for registered and temporary homes. It cannot be changed." | "Select a row for details and actions": the rows carry View Details. "Sensitive home addresses appear only in the authorised details modal": attendance guide §1. "A department is a setting, not a code change": §6. The audit banner in the employee modal, "the change applies from the next punch and is written to the audit log", "the old home is kept in history": §3, attendance guide §3 |

### 10.2 Phone layout

| Screen | First on a phone | Left off a phone | Main action | Navigation |
|---|---|---|---|---|
| People · Organogram (`organogram`) | A focus view, not the tree shrunk: Search and Add Role; Reports To with the focused person's manager as a card; the focused person's card, larger and outlined; Direct Reports with a count, one card each showing its own report count. It starts on the CEO | The whole tree, the legend and its help terms, the seat count, Expand All, Download PDF, the since and arrangement line, and dragging to reassign (desktop only) | Tap a card to move the focus to that person; Show CEO returns to the top; on a focused vacant seat, Create Vacancy full width | Bottom bar People; the People tabs along the top |
| ESS · Org Chart (`org-chart`) | The same focus view, starting on the signed-in employee: their manager, them, their direct reports | The whole tree, the legend, the seat count, Download PDF | Tap a card to move the focus; Show Me returns to the employee | Bottom bar; the ESS tabs along the top |
| Recruitment · Vacancies (`vacancies`) | Not in the demo yet: suggested vacancies as cards (role title, department, a status pill) | The reporting line, shown in the card's sheet | Create Vacancy, full width at the foot of the sheet | Bottom bar; the Recruitment tabs along the top |
| People · Employees (`employees`) | Import and Add Employee; the four KPI cards two to a row; the count per work arrangement; All Employees as person cards (name and department, Employment Status pill, Department, Line Manager) | The page subtitle; the Arrangement, Attendance Today and View Details columns (they show in the employee sheet) | Tap a person card: the employee modal as a bottom sheet, its buttons full width | Bottom bar People; the People tabs along the top |

## 11 · Edge cases

- **No CEO / multiple roots:** more than one employee without a line manager. The chart shows each
  root and flags it; HR resolves it on the builder.
- **Cycle:** a reassignment that would close a loop is rejected at the write with a clear message.
- **Vacant seat with reports:** drawn as a dashed node; its reports hang from it; it offers the
  Recruitment hand-off.
- **Dotted line to a vacant seat:** allowed; the dashed tag names the vacant role.
- **Deactivated or departed employee:** drops out of the tree; their former reports surface as
  needing a new line manager on the builder.
- **Very wide span** (one manager, many reports): the branch collapses by default past a threshold
  with a "+N more" affordance.
- **Very large org:** if the whole-tree read becomes heavy, children lazy-load on expand (§5, §13).
- **Empty state:** before the first import, the builder shows the import call to action.

## 12 · Donor code

| From | File | Change on the way in |
|---|---|---|
| pixie | `src/shared/org_workflow/` (1,336 lines, per MILESTONES M2 notes) | Reporting lines. Take our table names, drop the brand schema. It already backs permission scope; the organogram is a read over it |
| MyCity | the staff list spreadsheet | Seed the initial tree. Resolve the free-text Line Manager to ids, reconcile department names, flag column-shifted rows for a human rather than guessing (see §13) |

### 12.1 Seed structure from the staff list (2026)

Recorded here so the real senior structure is not lost before the import is built. Names, titles and
reporting lines only, no contact details, pay or bank. Lines marked "(assumed)" were reconstructed
where the sheet was ambiguous and a human should confirm them (see §13). Twenty seats, eighteen
filled and two vacant.

- Ifeoma Mbonu · Chief Executive Officer · General Management (root, no line manager)
  - Bode Oluwasanmi · Chief Technology Officer · Technology
    - Oladotun Shola-Adido · Back-end Manager · Backend Operations
      - Tobiloba Iyanuoluwa Dada · Content & Listing Associate
      - Bassey Ekpe · Content & Listing Associate
  - Etudor Edidiong · Program Manager · General Management
    - Cynthia Osasere Osakunih · Operations & People Lead · HR & Operations (assumed: her row was column-shifted and the manager cell read "Program Manager")
    - Chinyere Elechi · Head PR, Marketing & Brand Strategy · Sales & Marketing
      - Precious Iyeserhen · Graphics Designer
      - Aaron Agama · Social Media Manager
      - Similoluwa Michael · Graphics Design Associate
    - [Vacant] Head Sales & Revenue · Sales & Marketing (assumed parent: Program Manager; the sheet does not say)
      - Tochukwu Ifeanyi · Marketing Lead, Abuja (dotted line to Head PR)
      - John Ojelola · Marketing Lead, South West (dotted line to Head PR)
      - David Idowu-Agida · PR & Marketing Lead, MyLagosApp (dotted line to Head PR)
      - Gideon Fidelis Ekom · Marketing & Growth Officer, Enugu (dotted line to Head PR)
      - Adaeze Chike · Marketing & Growth Officer, Abia (dotted line to Head PR)
      - Victor Esuk · Marketing & Growth Officer, Imo (dotted line to Head PR)
      - Rabi'a Zawiya · Marketing & Growth Officer, Kano (dotted line to Head PR)
  - [Vacant] Technical Assistant · General Management (assumed parent: CEO)

The CTO (Bode Oluwasanmi) heads the technology line under the CEO, with the back-end team beneath
him. The two vacant seats (Head Sales & Revenue, Technical Assistant) seed as vacant seats and can
be sent to Recruitment (§3). The marketing and growth officers report to the vacant Head Sales &
Revenue with a dotted line to Chinyere Elechi (Head PR), the matrix case the v1 full matrix draws.

## 13 · Open questions

- **Inventory ratification.** Adding Organogram and Org Chart takes the fixed inventory from 85 to
  87 (MILESTONES §18). Needs a recorded decision, then rows in PROGRESS, the summary counts, the
  `SCREENS` constant in `scripts/check/progress.js`, the ⌘K and permission registry. Who signs off,
  by when.
- **Paging exemption.** Is the org-chart read exempt from the 25-per-page rule as a bounded tree,
  or do large orgs lazy-load children? Backend owner to confirm (§5).
- **Permission keys.** Confirm `org_chart` as the all-staff read capability, separate from `people`.
- **Owner and milestone.** The builder rides on People · Employees (GE, M0) and the viewer on ESS
  (AJ, M1); the feature is being driven by TB. Confirm the real owner and milestone with the team.
- **Avatars.** Initials chips to start (the spreadsheet has no photos); real photo upload via the
  upload engine and vault is a later pass. Confirm.
- **Data cleanup on import.** The spreadsheet's Line Manager is free text and mixes names with
  roles; a few rows are column-shifted. Agree the cleanup pass before seeding.
- **Seed reporting-line gaps (§12.1).** The sheet does not state who the vacant Head Sales & Revenue
  reports to, and Cynthia Osakunih's line manager is inferred from a column-shifted row. Confirm both
  with People before import.

## 14 · Change log

- 14/10/2026 · TB · §10 rewritten as On screen and mobile with the content tiers and phone layout
  tables, from the demo as built: the builder and viewer footnotes removed (tier 3, now pointing to
  §3, §5, §6 and §8), the drag instruction and the dotted-line meaning moved to help terms on the
  legend, and the phone focus view (manager, person, direct reports, tap to refocus) recorded.
  Added to §3 the People · Employees attendance setup facts and to §6 that a dotted line never
  changes approvals and that departments are data, so the removed screen text has a home.
- 13/10/2026 · TB · Recorded the real seed reporting structure in §12.1 after a review note that
  the CTO (Bode Oluwasanmi) was missing from the preview: CEO over CTO over the back-end line, the
  Program Manager branch, and the two vacant seats with the marketing dotted-line matrix. Flagged
  the inferred lines in §13.
- 13/10/2026 · TB · Guide created from the organogram brainstorm. Agreed: one live source (the
  `line_manager_id` tree), two pages (People · Organogram builder with HR-rich cards and in-place
  editing; ESS · Org Chart read-only viewer with the standard card for every employee), full matrix
  (solid plus dotted lines) in v1, vacant seats shown and sent to Recruitment as suggested
  vacancies, whole-company visibility for all staff, desktop tree with a distinct mobile focus view,
  seed from the staff spreadsheet, PDF and PNG export, internal only.
- 15/10/2026 · AJ · Ratified as #92 and #91. Frontend built on mocks in `app/` (builder with drag to reassign, viewer, levels below two collapsed at start); not wired to the API yet.
- 15/10/2026 · AJ · Screens brought to §10 and the screen conventions: the ⓘ note under the chart is gone, the subtitle is shortened, and the chart is marked as content for gate 8.
