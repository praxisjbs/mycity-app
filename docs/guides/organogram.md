# Organogram · Engineering Guide

| | |
|---|---|
| Owner | TB |
| Milestone | M1 |
| Backend modules | `organisation` |
| Frontend paths | `app/src/features/organogram/`, `app/src/features/people/` (Organogram tab), `app/src/features/ess/` (Org Chart tab), `app/src/features/shared/ReportingForm.tsx` (Change Manager, shared with the employee record) |
| Permission key(s) | `people` (builder, manage), `org_chart` (viewer, read for all staff) |
| Capabilities | none; the builder is the `people` grant and the viewer every member of staff |
| Screens (PROGRESS.md rows) | #92 People · Organogram, #91 ESS · Org Chart (ratified 15/10/2026) |
| Status | Built |
| Last changed | 26/10/2026 |

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
| People · Organogram (`organogram`) | staff app | HR, Operations (People), CEO and management | The whole company tree with HR-rich node cards, solid and dotted reporting lines, and vacant seats | Search, collapse and expand branches, drag a card onto a new manager to reassign (desktop), open a person's sheet and Change Manager from it (both shells), set a dotted-line manager, add or edit a vacant seat, Download PDF (emailed) |
| ESS · Org Chart (`org-chart`) | staff app | every employee, HR included | The same whole company tree, read only, with the standard node card | Search, collapse and expand, open a person's sheet and Send Message from it, Download PDF (downloaded on the device). No editing, no restricted fields |
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
- A card opens the **person's sheet** on both pages. Send Message opens a direct message with them
  in **Community** (`/community?tab=direct-messages&to=<employee_id>`); Open Record opens their
  record on **People · Employees**, for those who may open it; Change Manager is the same reporting
  line form the record uses, and the same write as a drag (§5). On your own card, My Profile opens
  **ESS · My Profile**.
- **Download PDF** lays the whole chart out and queues it for the pdf-render job, which draws it
  as a PDF; the screen waits for it and saves it on the device that pressed (§5, §7). Nothing is
  emailed (`docs/guides/foundation.md` §6.12).
- **People · Employees** also carries each employee's attendance setup (owned by the attendance
  guide, `docs/MyCity-ERP-Documents/attendance-guide.md`). A change of work arrangement applies
  from the employee's next punch; opening a registered home address, changing an arrangement and
  changing a home are each written to the audit log, and a replaced home is kept in history, never
  overwritten.

## 4 · Data

| Table | Key columns | Notes |
|---|---|---|
| `employee` | `line_manager_id` (self-FK, nullable for the CEO), `dotted_manager_id` (self-FK, nullable), `department_id` | `line_manager_id` already exists in the contract (`organisation.js`). `dotted_manager_id` is the net-new column for the matrix (full matrix in v1) |
| `department` | `id`, `name`, `code`, `head_employee_id` or `head_seat_id` (2100) | Department name is the node chip. A department's head is a person or a vacant seat, never both; while the seat is vacant the person above it acts (`organisation.headOf()`, `docs/guides/performance.md` §6.20). MyCity's five departments, their codes and heads are kept true by the staff loader (`seeds/staff/nomenclature.json`, `docs/guides/foundation.md` §6.1) |
| `org_seat` (vacant seat) | `title`, `department_id`, `line_manager_id` or `line_manager_seat_id`, `status` (vacant, filled, closed), `filled_by_employee_id` | A seat with no employee. A vacant seat can carry reports: an employee whose manager's post is empty points at it through `employee.line_manager_seat_id` (or `dotted_manager_seat_id` for a dotted line), never at both a person and a seat. Modelled so the line never breaks when a role is unfilled |

Migration file: `migrations/0110_employee_profile.sql` (M0) adds `dotted_manager_id`, the two seat
links and `org_seat`. The reporting-line foundation itself is M0; `migrations/0300_employee_register.sql`
adds archiving, so a record that leaves the tree keeps its history.

**On the wire** the two kinds of node are one shape (`OrgNode`): `node_id` with `node_kind`
("employee" or "seat"), the name and post, the department, `manager_node_id`,
`dotted_manager_node_id` and `dotted_line_to` (the dotted manager's name, ready to draw). A manager
who is no longer an active node (archived, or left) is dropped from the line, so their former
reports show as roots the builder flags rather than vanishing (§11).

**Who heads a department** (TB, 22/10/2026). `GET /api/v1/departments` gives each department its
`head` (a person, the person in a filled head seat, or the vacant seat, as a `ManagerRef`) and its
`acting_head` (the person who acts: the head, or the first person above a vacant head seat, through
any vacant seats between). `PATCH /api/v1/departments/:id` sets `head_employee_id` or `head_seat_id`;
naming one clears the other. There is no department form on screen in M2: the staff loader sets the
heads, and a later screen may edit them.

**Who answers for an empty seat** (TB, 19/10/2026). The view `employee_effective_manager`
(`migrations/1160_employee_effective_manager.sql`) gives every employee the person they answer to:
their line manager, or, when they report to a vacant seat, the first person above that seat,
through any vacant seats between. Approvals, team scope and the notifications that follow team
scope read it (§6); the chart still draws the seat, because the seat is the true line.

## 5 · API

| Method and path | Contract | Permission · scope | Paged | Notes |
|---|---|---|---|---|
| `GET /api/v1/org-chart?view=builder\|viewer` | `OrgChartQuery` to `OrgChartTree` | `ess` view (every member of staff) | no, bounded | The whole company: a node is a person or a vacant seat (`node_id`, `node_kind`), the solid line above it is `manager_node_id` and the dotted one `dotted_manager_node_id`. `view=builder` adds the since and arrangement line; nothing restricted is in the payload for anybody |
| `PATCH /api/v1/employees/:id/line-manager` | `EmployeeReportingUpdate` | `people` edit · team/all | n/a | Sets `line_manager_id` **or** `line_manager_seat_id`, and the dotted one beside it. A loop (through people or vacant seats), reporting to oneself, and naming both a person and a seat are each refused |
| `GET /api/v1/org-seats`, `POST /api/v1/org-seats`, `PATCH /api/v1/org-seats/:id` | `OrgSeat*` | `people` view, create, edit | list at 25 | The seats themselves: Add Role on the builder, and the seat a sheet's VACANT row becomes. A seat placed under one of its own reports is refused as a loop |
| `POST /api/v1/org-chart/exports` | `OrgChartExportRequest` to `ExportFile` (documents) | `ess` view (every member of staff) | n/a | Download PDF: reads and lays out the whole chart, in the view asked for, queues it through `documents.generate` and answers 202 with the file pending. The pdf-render job draws it; the screen waits on `GET /exports/:id` and downloads it (§6, §7). It takes `view`, as the read does, because the file holds nothing the read does not |

A drag on the chart and Change Manager in a person's sheet call the same employee write a form
would. Download PDF is drawn on the server, never in the browser: the request queues it through
`documents.generate` and the pdf-render job draws it with the shared PDF service, as every generated
document is (BACKEND_STRUCTURE §5.5).
**Paging:** a tree must load whole to draw, so the org-chart read is the one bounded read in the
module: `completeQuery()` with a ceiling of **2,000 nodes** and the `// pagination:complete` marker
(BACKEND_STRUCTURE §16.3, `docs/guides/foundation.md` §6.6). Past the ceiling it fails loudly rather
than drawing part of a tree as if it were whole. Settled 17/10/2026; the lazy-load-children scheme
stays off the table until MyCity is near that size.

## 6 · Rules and calculations

- The tree is built from `line_manager_id`. The root is the single employee with no line manager
  (the CEO). Exactly one root is expected. The CEO is always the top: the chart draws the CEO's
  tree first and opens centred on it, and a phone starts there.
- A reporting line may **not** form a cycle (A reports to B who reports to A), directly or through
  a vacant seat. The write rejects a change that would create one, on a person and on a seat.
- `dotted_manager_id` is an optional second relationship. It is drawn as a dashed connector or a
  "Dotted line: <manager>" tag, never as the primary line, and it does not affect permission scope:
  approvals of leave, expenses and tasks follow the solid line only (§1).
- Departments are data (`department` rows, §4): adding or renaming one is a setting, never a code
  change.
- A **vacant seat** is a node with a role and department but no employee. It may have reports. It
  carries no person data and never shows a card field that implies one. While it is empty, the
  first person above it answers for its reports: their leave, expenses and tasks go to that person
  for approval, and they are in that person's team scope. Only a seat with nobody above it leaves
  them to the CEO (TB, 19/10/2026; `employee_effective_manager`, §4).
- The viewer shows the **whole company**. The builder shows the whole company with edit affordances.
- Restricted fields (`bank_name`, `account_number`, `gross_monthly`, per BACKEND_STRUCTURE §9.4)
  and phone are never rendered on any organogram card, in either page, in a person's sheet or in
  the PDF.
- **Team size.** A card with reports says how many report to it directly and in all, every place
  below it counted, people and open roles alike, as the tree draws them: "3 direct · 13 in all", or
  "7 direct" when nobody is further down.
- **The PDF** (Download PDF) is the whole tree as the person asking may read it, laid out from the
  same read when they ask, in the view they asked for: the same cards (initials, name, title, department
  chip, the since and arrangement line on the builder's, a dotted-line tag) and the same solid
  lines as the desktop tree, the CEO's tree first, then any other card at the top. One change keeps
  it near A3 proportions: a manager with five or more reports, none of whom has reports of their
  own, has them in two columns down a line from their card instead of in one wide row. It is one
  page sized to the chart, so it stays sharp when a phone zooms in and a printer fits it to the
  sheet; a chart wider or taller than 4,900 mm is drawn smaller to stay inside a PDF page. Under the
  letterhead it carries the seat count and the legend. It is a file for the person asking, opened by
  them and the CEO alone, kept in the vault a day and never locked (an export,
  `docs/guides/foundation.md` §6.12); it carries no number.

## 7 · Events, jobs and notifications

| Event / job | When | Does |
|---|---|---|
| `employee.reporting_line_changed` | after a line manager or dotted manager change commits | outbox: the chart re-reads; permission scope caches that derive from the tree are refreshed |
| `vacancy.suggested_from_seat` | when HR sends a vacant seat to Recruitment | outbox: creates a suggested-vacancy entry on Recruitment · Vacancies |
| `org_chart.export_requested` | Download PDF | the audit line, written with the PDF's document in the request: the tree read and laid out (§6) and queued through `documents.generate` as doc type `org_chart` (template `templates/documents/org-chart.html`, no number); `document.render_requested` sends it to the pdf-render job |
| `document.generated`, `document.render_failed`, doc type `org_chart` | the PDF is drawn, or the render job gave up | no handler: the screen waiting on `GET /exports/:id` reads it done and downloads it, or reads it failed and says so; nothing is emailed and nobody is notified |
| `export-cleanup` (scheduler, hourly) | a PDF is a day old | removed from the vault (`docs/guides/foundation.md` §6.12) |

## 8 · Permissions and visibility by role

| Role | Sees | Can do |
|---|---|---|
| Employee (any non-HR) | The whole company tree, read only, standard card | Search, expand, collapse, zoom, export. No edit, no restricted fields |
| HR / Operations (People) | The whole tree, HR-rich card | Build and correct the tree: drag to reassign, set dotted lines, add and edit vacant seats, send a seat to Recruitment, export |
| CEO / management | The whole tree | Read. Edit only with the `people` capability |

Restricted fields: never on an organogram card for anyone. Salary, bank and phone live on the
employee 360 and ESS · My Profile under their own rules, not here.

**A person's sheet** follows the grants, never a role's name, on both pages: Send Message for
everyone (not on your own card, which has My Profile instead); Open Record for whoever may open
People · Employees (`people` view with the Employees tab: People, management, the admins, the
Implementation Team and the CEO); Change Manager for `people` edit, never on the CEO's card. Every
member of staff may Download PDF (`ess` view, as the read).

**The Implementation Team** (the build account) holds every module and action over everything,
every capability and every field until handover, and training runs from it (TB, 19/10/2026;
`docs/guides/identity.md` §8). So it sees and does everything on both pages.

## 9 · AI and search

- **AI reads** (`organisation.ai.js`): "who reports to whom", "who reports to X", "how many people
  in <department>", "which roles are vacant". Read only (A23), reading the same tree, in pages of
  25. No write.
- **AI routes**: "show me the org chart" opens ESS · Org Chart (or People · Organogram for HR),
  optionally focused on a named person; "add an employee" opens People · Employees on
  `new=1` (`useNewLink`), Add Employee filled with the names and the job the person gave
  (`organisation.EmployeePrefill`: names, job title, department, start date, employment type,
  work pattern, contract end; never the phone, email, pay, bank or personal details, since an
  address is kept in the browser's history; `docs/guides/praxis-ai.md` §6.4).
- **Search** (`organisation.search.js`): a person by name, role, staff number, work email or work
  phone reaches their record; the phone is matched however it is typed (0803 123 4567, +234 803...,
  the last four digits) or the name they go by. An open seat is found by its title or department and
  opens the Organogram focused on it (`?id=` the seat: the phone focuses it, the desktop tree marks it).
  Words people use include "org chart", "organogram", "structure", "who is my manager", "reporting line".

## 10 · On screen and mobile

What each screen shows open, what sits behind help, and how it is laid out on a phone
(FRONTEND_GUIDE §5, §7). **§3 and §6 are for engineers: nothing in them reaches a screen unless it
is listed here as tier 1 or tier 2.** Tier 3 (how the system works, why it was built this way,
reassurance nobody asked for) is never on a screen; say where it lives instead (this guide, the
manual, the AI assistant). Both tables are read by `scripts/check/guides.js`.

### 10.1 Content tiers

| Screen | Open (tier 1) | Behind help (tier 2) | Not on screen (tier 3), lives in |
|---|---|---|---|
| People · Organogram (`organogram`) | Organogram; the seat count on desktop (12 seats · 11 filled · 1 open); Search, Expand All, Download PDF, Add Role; a line above the tree when more than one person or role sits at the top; the legend (Reporting Line, Dotted Line, CEO, Vacant Seat); the whole tree. Each node card carries initials, name, title, the department chip, the since and arrangement line, a dotted-line tag where set, and Create Vacancy and Edit Role on a vacant seat (Edit Role is the role's title, department and who it reports to, which is how a seat the sheet left at the top gets its line). Node text is data. A person's card opens their sheet (Profile): initials, name and title; Department, Reports To, Dotted Line and Team; Send Message, Open Record and Change Manager as §8 allows. Download PDF is busy while the PDF is drawn, then saves it on this device: "PDF downloaded" | Help term on the legend's Reporting Line: "Drag a card onto a new manager to change its reporting line." Help term on Dotted Line: "A second manager for matrix work. It does not change who approves leave, expenses or tasks." The sheet's Dotted Line label carries the same help term | That a drag is the same employee write as the form and is audited: §3, §5. That a vacant seat becomes a suggested vacancy in Recruitment: §3. That salary, bank details and phone never show on a card: §6, §8. The subtitle "The live reporting structure … drag a card to reassign" and the footnote paragraph under the tree are removed |
| ESS · Org Chart (`org-chart`) | Org Chart; the seat count on desktop; Search, Download PDF; the legend; the whole tree with the standard node card (no since and arrangement line; "Open role" on a vacant seat). A person's card opens their sheet (Profile): initials, name and title; Department, Reports To, Dotted Line and Team; Send Message, or My Profile on your own card; Open Record (`people` view with Employees) and Change Manager (`people` edit) for those who hold them, as §8 says | Help term on the legend's Dotted Line, the same text as the builder, and on the sheet's Dotted Line label | "Read only", "Every employee sees the whole company here" and the restricted fields never shown: §6, §8. "On a phone this becomes a focus view": §10.2. That the PDF is drawn on the server and emailed: §5, §7. The subtitle "Who reports to whom across MyCity · read only" and the footnote paragraph are removed |
| Recruitment · Vacancies (`vacancies`) | Not in the demo yet. The suggested vacancies list: role title, department, reporting line; Create Vacancy | None | That nothing is auto-created from a seat, and the hand-off event: §3, §7 |
| People · Employees (`employees`) | Employees; the staff and department count on desktop; Import Staff, Add Employee; Headcount, Confirmed, On Probation, Attrition 90 Days; the count per work pattern; All Employees (employee and job title, number, department, Line Manager, Work Pattern, Status, Login, View Record), 25 a page, sorted by the server; Headcount by Department; Needs a Decision (Probation Ending opens the probation reviews on Performance · Reviews, `?kind=probation`, where each is confirmed or extended; Contracts Ending opens the list on Contract, Ending in 30 Days, `?contract=ending`); the Contract filter (Any Contract, Ending in 30 Days). A row opens the record: Profile, Job, Work Schedule, Reporting Line, Login, History, with Edit Record, Archive Record, Send Invite and Change Manager (`docs/guides/foundation.md` §10) | Help term on Invited: what an invited login is. On the record, a masked field shows Restricted behind a help term naming who may see it, and Dotted line carries the matrix help term | "Select a row for details and actions": the rows carry View Record. "A department is a setting, not a code change": §6. Attendance Today, the attendance and location modal and the home-address banner: they return with the attendance routes (attendance guide §1, §3) |

### 10.2 Phone layout

| Screen | First on a phone | Left off a phone | Main action | Navigation |
|---|---|---|---|---|
| People · Organogram (`organogram`) | Not the tree shrunk: Search, Download PDF and a Focus or Everyone switch (TB, 19/10/2026), opening on Everyone. **Everyone** is the whole company as one indented list, the CEO first: a row per person or open role (initials, name, title and department, its direct count), open to the third level and folding below it; a tap opens Focus on that row. **Focus** is one card and what is around it: the path from the top as chips (a tap moves there); Reports To with the manager's card; the focused card, larger and outlined, with its team ("3 direct · 13 in all", §6); Direct Reports; Dotted Line, the people with a dotted line to them; Same Manager, their colleagues, or at the top Also At The Top, so each card at the top can be reached and given a line. Every card carries title and department, its team and a dotted-line tag where set. A search lists the people and roles that match as cards; a tap focuses one | The drawn tree, the legend and its help terms, the seat count, Expand All, the since and arrangement line, and dragging to reassign (desktop only) | Tap a card to focus it; tap the focused person for their sheet (Send Message, Open Record, Change Manager, full width at the foot); on a focused vacant seat, Create Vacancy and Edit Role full width; Add Role in the floating button; Show Top returns to the top | Bottom bar People; the People tabs along the top |
| ESS · Org Chart (`org-chart`) | The same two views, opening on Focus at the signed-in employee (their path, their manager, them, their reports and colleagues); at the top, the CEO, for someone who is not on the chart. Everyone opens the path down to them and marks their row You. Search, Also At The Top and Download PDF work as on the builder | The drawn tree, the legend, the seat count, every edit | Tap a card to focus it; tap the focused person for their sheet (Send Message; My Profile on your own); Show Me returns to the employee | Bottom bar; the ESS tabs along the top |
| Recruitment · Vacancies (`vacancies`) | Not in the demo yet: suggested vacancies as cards (role title, department, a status pill) | The reporting line, shown in the card's sheet | Create Vacancy, full width at the foot of the sheet | Bottom bar; the Recruitment tabs along the top |
| People · Employees (`employees`) | Import and Add Employee; the four KPI cards two to a row; the count per work arrangement; All Employees as person cards (name and department, Employment Status pill, Department, Line Manager) | The page subtitle; the Arrangement, Attendance Today and View Details columns (they show in the employee sheet) | Tap a person card: the employee modal as a bottom sheet, its buttons full width | Bottom bar People; the People tabs along the top |

## 11 · Edge cases

- **No CEO / multiple roots:** more than one employee without a line manager. The chart shows each
  root and flags it; HR resolves it on the builder. The CEO's tree comes first; on a phone the other
  roots are listed under Also At The Top.
- **Cycle:** a reassignment that would close a loop is rejected at the write with a clear message,
  including a loop through a vacant seat (a seat placed under one of its own reports).
- **Vacant seat with reports:** drawn as a dashed node; its reports hang from it; it offers the
  Recruitment hand-off. Their approvals and team scope pass to the first person above the seat (§6).
- **A seat the sheet gives a line manager:** the importer gives the seat that line. The roster
  fills it only while the seat has none, so a line set on screen (Edit Role) stays.
- **Dotted line to a vacant seat:** allowed; the dashed tag names the vacant role.
- **Deactivated or departed employee:** drops out of the tree; their former reports surface as
  needing a new line manager on the builder.
- **Very wide span** (one manager, many reports): the branch collapses by default past a threshold
  with a "+N more" affordance.
- **Very large org:** if the whole-tree read becomes heavy, children lazy-load on expand (§5, §13).
- **Empty state:** before the first import, the builder shows the import call to action.
- **Open Record for someone who may not open records:** not offered. It used to be, and sent most
  staff to Home and line managers back to the Organogram; the sheet shows what the chart already
  holds instead (§8).
- **Send Message to someone without a login:** Community refuses it with its own message; the
  sheet does not guess who has one.
- **Your own card:** My Profile instead of Send Message. **The CEO's card:** no Change Manager.
- **Download PDF on a login with no email:** downloads as for anyone; nothing is emailed.
- **A PDF the render job gives up on:** the screen waiting on it says so and they press again;
  pressed twice, two PDFs are drawn, each downloaded where it was asked for.
- **The person who asked leaves the screen while it is drawn:** it still downloads wherever they are
  in the app; closed, the app gets nothing and the PDF leaves the vault a day later.
- **A very wide or tall chart:** the page grows with it; past 4,900 mm it is drawn smaller (§6).

## 12 · Donor code

| From | File | Change on the way in |
|---|---|---|
| pixie | `src/shared/org_workflow/` (1,336 lines, per MILESTONES M2 notes) | Reporting lines. Take our table names, drop the brand schema. It already backs permission scope; the organogram is a read over it |
| MyCity | the staff list spreadsheet | Seed the initial tree. Resolve the free-text Line Manager to ids, reconcile department names, flag column-shifted rows for a human rather than guessing (see §13) |

### 12.1 Seed structure from the staff list (2026)

Recorded here so the real senior structure is not lost before the import is built. Names, titles and
reporting lines only, no contact details, pay or bank. Lines marked "(assumed)" were reconstructed
where the sheet was ambiguous and a human should confirm them (see §13). Twenty seats from the
sheet, eighteen filled and two vacant; with the build account the chart holds twenty-one.

- Ifeoma Mbonu · Chief Executive Officer · General Management (root, no line manager)
  - Bode Oluwasanmi · Chief Technology Officer · Technology
    - Oladotun Shola-Adido · Back-end Manager · Backend Operations
      - Tobiloba Iyanuoluwa Dada · Content & Listing Associate
      - Bassey Ekpe · Content & Listing Associate
    - JBS Praxis Team · Implementation Partner · Implementation (the build account: not in the
      sheet; `roles.json` puts the post under the CTO, TB 19/10/2026)
  - Etudor Edidiong · Program Manager · General Management
    - Cynthia Osasere Osakunih · Operations & People Lead · HR & Operations (assumed: her row was column-shifted and the manager cell read "Program Manager")
    - Chinyere Elechi · Head PR, Marketing & Brand Strategy · Sales & Marketing
      - Precious Iyeserhen · Graphics Designer
      - Aaron Agama · Social Media Manager
      - Similoluwa Michael · Graphics Design Associate
    - [Vacant] Head Sales & Revenue · Sales & Marketing (under the Program Manager: the sheet's VACANT row says so since TB confirmed it, 19/10/2026)
      - Tochukwu Ifeanyi · Marketing Lead, Abuja (dotted line to Head PR)
      - John Ojelola · Marketing Lead, South West (dotted line to Head PR)
      - David Idowu-Agida · PR & Marketing Lead, MyLagosApp (dotted line to Head PR)
      - Gideon Fidelis Ekom · Marketing & Growth Officer, Enugu (dotted line to Head PR)
      - Adaeze Chike · Marketing & Growth Officer, Abia (dotted line to Head PR)
      - Victor Esuk · Marketing & Growth Officer, Imo (dotted line to Head PR)
      - Rabi'a Zawiya · Marketing & Growth Officer, Kano (dotted line to Head PR)
  - [Vacant] Technical Assistant · General Management (under the CEO, TB 19/10/2026)

The CTO (Bode Oluwasanmi) heads the technology line under the CEO, with the back-end team beneath
him. The two vacant seats (Head Sales & Revenue, Technical Assistant) seed as vacant seats and can
be sent to Recruitment (§3). The marketing and growth officers report to the vacant Head Sales &
Revenue with a dotted line to Chinyere Elechi (Head PR), the matrix case the v1 full matrix draws;
while the seat is empty, Etudor Edidiong (Program Manager) answers for them (§6).

## 13 · Open questions

- **Inventory ratification.** Adding Organogram and Org Chart takes the fixed inventory from 85 to
  87 (MILESTONES §18). Needs a recorded decision, then rows in PROGRESS, the summary counts, the
  `SCREENS` constant in `scripts/check/progress.js`, the ⌘K and permission registry. Who signs off,
  by when.
- ~~**Paging exemption.**~~ Settled 17/10/2026: the tree is one bounded read, `completeQuery()` with
  a ceiling of 2,000 nodes (§5).
- ~~**Permission keys.**~~ Settled 17/10/2026: the read takes `ess` view, which every member of
  staff holds, rather than a key of its own; nothing restricted is in the payload for anybody. A
  separate `org_chart` key would be a migration against a grant nobody needs (§5, §8).
- **Owner and milestone.** The builder rides on People · Employees (GE, M0) and the viewer on ESS
  (AJ, M1); the feature is being driven by TB. Confirm the real owner and milestone with the team.
- **Avatars.** Initials chips to start (the spreadsheet has no photos); real photo upload via the
  upload engine and vault is a later pass. Confirm.
- ~~**Data cleanup on import.**~~ Settled 17/10/2026: the Line Manager cell is read by
  `src/modules/organisation/manager-text.js` (a name, a name with a post, a post, or a post with a
  dotted line beside it), resolved to a person or to the seat holding that post, and a cell that
  matches nothing is a problem on that row, never a guess. The sheet's own DOB and Phone columns are
  not imported at all (`docs/guides/foundation.md` §6.1).
- **Seed reporting-line gaps (§12.1).** ~~Who the vacant Head Sales & Revenue reports to.~~ Settled
  19/10/2026 (TB): the Program Manager, and the Technical Assistant seat the CEO, both written into
  the sheet's VACANT rows. Still open: Cynthia Osakunih's line manager is inferred from a
  column-shifted row. Confirm it with People.

## 14 · Change log

- 26/10/2026 · JP · Nothing on the Organogram or Org Chart changed. People · Leave, whose code this guide's map also covers, now shows on its chips the unread notices about the requests under each status (ess.md, notifications.md §6).
- 26/10/2026 · JP · Nothing on the Organogram or Org Chart changed. Beside them, from the QA bug register: ESS · My Leave and People · Leave name the real approver and mark a request past the allowance with its days and balance (`docs/guides/ess.md`), and Add Employee refuses a negative Gross Monthly (`docs/guides/foundation.md` §6).
- 26/10/2026 · JP · From the User Guide audit's screen defects: Add Role (and ⌘K's) needs `people` create, as `POST /org-seats` does; a refused drag or open role says the server's reason ("That would make a loop in the reporting line."), not the last call's; the open role's Department is the shared picker of departments in use, searched on the server; Change Reporting Line asks for an open role when An Open Role is chosen ("Pick an open role"). Create Vacancy stays, opening Recruitment's Coming Soon (the owner, 26/10/2026).
- 26/10/2026 · JP · From the User Guide audit's screen defects: the "sit at the top" banner shows only on People · Organogram to those who may move people; a desktop search opens the folded branches holding its matches; §10.1's ESS · Org Chart row names Open Record and Change Manager by grant, as §8 does.
- 25/10/2026 · JP · Nothing on the Organogram or Org Chart changed. Beside them, People · Leave and ESS · My Payslips open a record in a sheet on a phone, never below the list (FRONTEND_FOUNDATION F31, `docs/guides/ess.md` §10).
- 25/10/2026 · JP · A line or dotted manager must work here now: Change Reporting Line and Add Employee refuse someone archived, left or suspended (`MANAGER_NOT_FOUND`, on the field), and Add Employee's picker offers only active staff, so nobody reports to a person the tree no longer shows (`docs/guides/foundation.md` §6.16).

- 22/10/2026 · TB · Nothing on the Org Chart changed. Beside it in `app/src/features/ess/`, My Performance opens My Scorecard from the person's own scorecard link (`docs/guides/ess.md`, `docs/guides/performance.md` §14).
- 22/10/2026 · GE · §9: Praxis AI's "add an employee" opens Add Employee on `?new=1`, which the screen now reads (`useNewLink`; it never opened the form before), filled from `organisation.EmployeePrefill` (`praxis-ai.md` §6.4).
- 22/10/2026 · TB · Nothing on the Org Chart changed. Beside it in `app/src/features/ess/`, My Performance gains My Commitments (Performance PR 4, `docs/guides/ess.md`).
- 21/10/2026 · TB · Nothing on the Organogram or Org Chart changed. Beside them, the employee record's Attendance tab becomes Work Schedule, after Job (`Employee360.tsx`, attendance's PR 3, `docs/guides/attendance.md` §6.13, §10); Reporting Line and Change Manager are untouched.
- 19/10/2026 · TB · No change to the Org Chart: My Documents, in the ESS folder this guide shares, opens a PDF or a photo in the file viewer and draws a PDF's preview in the app (`docs/guides/ess.md` §10).
- 19/10/2026 · TB · Download PDF downloads on the device that pressed, never by email (`docs/guides/foundation.md` §6.12, TB's decision; §3, §5 to §7, §11): the request reads and lays out the chart and queues it through `documents.generate`, answers 202 with the file pending (`ExportFile`), and the screen waits on `GET /exports/:id` and saves it. `org-chart.export.js`, the `org-chart-export` email, the three outbox handlers and the "Your organogram PDF failed" notice are gone; the `org_chart` type is an export, kept a day and never locked. A login with no email is no longer refused.
- 19/10/2026 · AJ · The employee record (`Employee360`) carries `photo_url` at 384 px, and its header shows the face (`ProfileHeader` `photo`), initials when there is none. TB to review.
- 19/10/2026 · AJ · Every node carries `photo_url` (`OrgNode`, from `shared/db/person.js` at 192 px; null for a vacant seat): the desktop chart, the phone's tiles and a person's sheet show the face through `Avatar`, initials when there is none. The Download PDF keeps initials. TB to review.
- 19/10/2026 · AJ · `employee` gained `photo_document_id` (1170): the person's photo, a vault document of type
  `employee_photo` that every signed-in colleague may read. `organisation.photo.js` sets and clears it
  (`employee.photo_updated`); ESS · My Profile is where a person changes their own (`docs/guides/ess.md`
  §3 step 1). The register, the 360 and the organogram cards do not show it yet: their rows gain
  `photo_url` next. TB to review.
- 19/10/2026 · TB · The phone and the person's sheet, from TB's four decisions of 19/10/2026 (§2,
  §3, §5 to §8, §10, §11). A phone has Focus and Everyone: Everyone is the whole company as one
  folding, indented list (People opens on it), and Focus gains the path from the top, each card's
  team in all (§6), Dotted Line (who has a dotted line to the person) and Same Manager (their
  colleagues); cards carry their department again. A card opens the person's sheet on both pages,
  with Send Message for everyone and Open Record and Change Manager by grant, replacing Open
  Record, which sent everyone outside People and the admins elsewhere. Change Manager is the
  record's reporting line form, so a phone can move a line without dragging. Download PDF is real:
  `POST /org-chart/exports`, drawn in the worker as the person asking and emailed (§5 to §7); it
  was a toast that made nothing. The Implementation Team keeps every grant until handover, so
  training runs from the build account (§8). On a phone, Add Role is in the floating button alone.
- 19/10/2026 · TB · The structure the deploy loaded drew four tops (the CEO, both open seats and the
  build account), and the seven marketing officers hung from a seat a phone could not reach. TB's
  four decisions of 19/10/2026 fix it. The sheet's VACANT rows name the seats' lines (Head Sales &
  Revenue under the Program Manager, Technical Assistant under the CEO), and the importer now applies
  a seat's line, which it used to drop without a word. `roles.json` puts the Implementation Partner
  (the build account) under the CTO. While a seat is empty, its reports' approvals, team scope and
  team notifications go to the first person above it (`employee_effective_manager`, `1160`, §4,
  §6), and a loop through a seat is refused. Screens: the CEO is the top on both pages; on a phone a
  search lists the matching cards to tap, the other cards at the top are listed under Also At The
  Top, and Org Chart starts at the top for someone not on the chart; the desktop tree opens centred
  on the CEO (§10.2, §11).
- 17/10/2026 · TB · Header gains the Capabilities row every guide now carries (README §5.2): none. In the
  `organisation` module this guide covers, the register's counts now take the Lagos date they count
  from (`organisation.repo.counts(db, scope, today)`, from `lagos.today()`) instead of the database's
  `current_date`, and the service exposes `counts(client, scope, { today })` (headcount, attrition
  over 90 days, confirmations due in 30) so Home's cards read the register's definition. The
  Organogram and Org Chart are unchanged.
- 17/10/2026 · TB · §9: open seats are searchable and the Organogram opens focused on one (`?id=`);
  people are also found by preferred and middle name.
- 17/10/2026 · TB · §9: a person is also found by their work phone, typed any way. The work phone is
  not a masked field; personal and next-of-kin numbers are, and search never reads them.
- 17/10/2026 · TB · Built (#92 and #91). §4 and §5 are the API as built: one `OrgNode` shape for a
  person and a seat (`node_id`, `node_kind`, `manager_node_id`, `dotted_manager_node_id`), the
  employee write that moves a line to a person or a seat, and the three `org-seats` routes behind Add
  Role. The whole-tree read is settled as one bounded `completeQuery()` of 2,000 nodes, and the
  all-staff read takes `ess` view rather than a key of its own, so §13's paging and permission
  questions are closed, as is the cleanup pass (the Line Manager cell is read by `manager-text.js`).
  §10.1 records People · Employees as built, with Attendance Today waiting on LA's attendance
  routes, and the builder's Edit Role beside Create Vacancy on a vacant seat (§2's "add or edit a
  vacant seat"), which is how one of the sheet's two open seats is given the line the sheet does not
  state (§13). The phone focus view of §10.2 is built for both screens, and the legend's two help terms
  with it. §12.1 is now what the deploy actually loads: the CEO over the CTO and the Program
  Manager, the back-end line, the PR branch, and the seven marketing people under the vacant Head
  Sales & Revenue with their dotted line to the Head of PR.
- 16/10/2026 · GE · §4 names the built tables: `org_seat` for vacant seats, and on `employee` the
  `dotted_manager_id`, `line_manager_seat_id` and `dotted_manager_seat_id` columns
  (`migrations/0110_employee_profile.sql`). A person reports to a person or to a seat, never both.
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
- 16/10/2026 · TB · Frontend foundation PR 3 (Build kit): the screens around the org chart moved onto `@mycity/ui` (`DataView`, `KpiCard`, `ProfileHeader`, `Timeline`). The chart itself is unchanged: its connector lines are still the app's own CSS, since the tree is one screen's drawing rather than a shared component.
- 16/10/2026 · TB · The `organisation` module gained its first service code, for sign-in only: find and create a department (with a generated code) and an employee (number from `numbering.allocate("employee")`, extra fields in `profile`), used by `create-admin` and the Users invitation. No routes yet; the tree and the employee screens still run on the mock. The employee 360 has Send Invite (`docs/guides/identity.md`).
- 16/10/2026 · TB · `employee` gained `home_address` (masked as personal details) and `contract_ends_on` for consultants and contractors (`0210`), in the contract and the organisation insert; `create-admin --build-account` writes both.
- 16/10/2026 · TB · `EmployeeCreate` and the organisation insert also take `middle_name`, `preferred_name`, `personal_email` (masked as personal details), `confirmation_due_on` and `confirmed_on`, columns since `0040`; the build account fills them all.
- 19/10/2026 · LA · ESS's tab switch (`app/src/features/ess/index.tsx`) takes Work Location Requests from its own file (`docs/guides/attendance.md` §10); Org Chart is unchanged.
- 19/10/2026 · LA · Nothing on the Organogram or Org Chart changed. Beside them in `app/src/features/people/` the employee record gains an Attendance tab (`Employee360.tsx`, `docs/guides/attendance.md` §6.13, foundation.md §10) and the INTERIM `EmployeeDetails.tsx` is deleted; in `app/src/features/ess/` My Profile's week shows each day's place (ess.md). Change Manager and `ReportingForm.tsx` are untouched.
- 19/10/2026 · TB · Nothing on the Organogram or Org Chart changed. Beside them, My Profile's Home Address (`app/src/features/ess/Profile.tsx`) suggests addresses as it is typed (`docs/guides/foundation.md` §6.13, `docs/guides/ess.md`).
- 20/10/2026 · GE · Nothing on the Organogram or Org Chart changed. The organisation module gains `setBirthday` (service and repo), which records a birthday known only as a day and month (`employee.birth_day`, `birth_month`, migration `1180`) for the staff loader; it emits `employee.updated` with the two fields before and after (foundation guide §6.1, community guide §3 step 3).
- 20/10/2026 · TB · Nothing on the Organogram or Org Chart changed. An employee's home address is a picked place (F27, `docs/guides/addresses.md`): `EmployeeCreate` and `EmployeeUpdate.home_address` take a `PlaceInput` (left out, it stays), the organisation service keeps it through `shared/places` (owner `employee.home_address`) and registers how its line is rewritten in `organisation.events.js`. No People form asks for it; `create-admin` no longer types one.
- 20/10/2026 · TB · Nothing on the Organogram or Org Chart changed. Beside them, the employee record (`app/src/features/people/Employee360.tsx`) names its place on the hub's trail with the person's name (`useTrailTitle`, FRONTEND_FOUNDATION F29; `docs/guides/foundation.md` §14).
- 22/10/2026 · TB · Performance PR 1: a department carries its code and its head, a person or a vacant seat (`head_employee_id`, `head_seat_id`, migration 2100), with `head` and `acting_head` on `Department` and `organisation.headOf()`; MyCity's five departments, the chart's titles and seven vacant seats are kept true by the staff loader (`seeds/staff/nomenclature.json`).
- 22/10/2026 · TB · Nothing on the Organogram or Org Chart changed. Beside them in `app/src/features/ess/`, My Performance (`Performance.tsx`) is built on the real API by Performance PR 3 (`docs/guides/ess.md`, `docs/guides/performance.md` §10).
- 25/10/2026 · JP · The builder's Add Role, an open role's Edit Role and Create Vacancy, and dragging a card follow People's edit grant, as Change Manager already did: a reader who may only view People (a line manager) reads the tree without offers the server refuses (`OrgTree.test.tsx`). History names the fields a change touched in words (`docs/guides/foundation.md` §6.16). Found while writing the M1 User Guide.
