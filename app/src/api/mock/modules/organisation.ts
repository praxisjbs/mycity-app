import type { LeaveRequest } from "@/api/types/leave";
import type { EmployeeRow, Employee360, ManagerRef, OrgNode, OrgSeat } from "@/api/types/organisation";
import { at, created, invalid, isoDaysAgo, isoDaysAhead, notFound, ok, paged, route, sid, fail, uuid } from "../core";
import { byId, byKey, DEPARTMENTS, managerOf, PEOPLE, ref, refKey, reportsOf, teamOf, SIGN_INS, type MockPerson } from "../data/people";

/**
 * The organisation module on the mock, in the contract's own shapes
 * (packages/contract/schemas/organisation.js): the staff register, the employee 360,
 * departments, vacant seats and the reporting tree. Laptops and CI only (F12).
 *
 * The real API is built: this mock exists so the gallery, the screen crawl and a laptop
 * without a server have people to show, and it answers exactly what the API answers.
 * Leave (M1) is still at the foot of this file, on its own INTERIM shapes.
 */

/** The contract's employee status, from the demonstration roster's richer HR states. */
const statusOf = (p: MockPerson): EmployeeRow["status"] => (p.status === "suspended" ? "suspended" : "active");
const probationDue = (p: MockPerson) => (p.status === "probation" ? isoDaysAhead(18) : null);
const confirmedOn = (p: MockPerson) => (p.status === "probation" ? null : p.start_date);

/** Who has a login on the mock: the four who sign in, and two invited but never signed in. */
const INVITED = ["damilola", "tolu"];
const loginOf = (p: MockPerson): EmployeeRow["login"] =>
  SIGN_INS[p.user_key] ? "active" : INVITED.includes(p.user_key) ? "invited" : p.status === "suspended" ? "suspended" : "none";

const DEPTS = DEPARTMENTS.map((name, i) => ({
  department_id: sid(`dept:${name}`),
  code: name.toUpperCase().replace(/[^A-Z0-9]+/g, "_"),
  name,
  parent_department_id: null,
  active: true,
  order: i,
}));
const deptOf = (name: string) => DEPTS.find((d) => d.name === name) ?? DEPTS[0];

/** A manager above someone: a person, or the one vacant seat the mock carries. */
const managerRef = (p: MockPerson): ManagerRef | null => {
  if (p.user_key === "amara") return { employee_id: null, org_seat_id: SEATS[0].org_seat_id, display_name: SEATS[0].title, job_title: SEATS[0].title, vacant: true };
  const m = managerOf(p);
  return m ? { employee_id: m.employee_id, org_seat_id: null, display_name: m.display_name, job_title: m.job_title, vacant: false } : null;
};
const dottedRef = (p: MockPerson): ManagerRef | null => {
  const key = DOTTED[p.user_key];
  const m = key ? byKey(key) : undefined;
  return m ? { employee_id: m.employee_id, org_seat_id: null, display_name: m.display_name, job_title: m.job_title, vacant: false } : null;
};

/** The dotted lines on the mock's tree: the matrix the organogram draws. */
const DOTTED: Record<string, string> = { adedotun: "tolu" };

/** Vacant seats, as the sheet's VACANT rows become them on the real API. */
const SEATS: Array<OrgSeat & { manager_key: string | null }> = [
  {
    org_seat_id: sid("seat:head-finance"),
    title: "Head of Finance",
    department_id: deptOf("Finance").department_id,
    department: "Finance",
    status: "vacant",
    line_manager: null,
    filled_by_employee_id: null,
    filled_on: null,
    reports: 1,
    created_at: at(40, "09:00"),
    manager_key: "ifeoma",
  },
];

const row = (p: MockPerson): EmployeeRow => ({
  employee_id: p.employee_id,
  staff_number: p.staff_number,
  display_name: p.display_name,
  job_title: p.job_title,
  department_id: deptOf(p.department).department_id,
  department: p.department,
  line_manager: managerRef(p),
  work_pattern: p.work_pattern,
  employment_type: p.employment_type,
  status: statusOf(p),
  login: loginOf(p),
  start_date: p.start_date,
  confirmation_due_on: probationDue(p),
  confirmed_on: confirmedOn(p),
});

/** Archived records, so Archive and Restore work on a laptop too. */
const ARCHIVED = new Set<string>();
const visible = (p: MockPerson) => !ARCHIVED.has(p.employee_id);
const full = (user: string) => ["operations", "ceo"].includes(SIGN_INS[user]?.view ?? "");
const scopeOf = (user: string) => (full(user) ? PEOPLE : [byKey(user)!, ...teamOf(user)]);

/** The row, with its real status: an archived record says so. */
const listRow = (p: MockPerson): EmployeeRow => ({
  ...row(p),
  status: ARCHIVED.has(p.employee_id) ? "archived" : statusOf(p),
});

const text = (a: string | null, b: string | null) => String(a ?? "").localeCompare(String(b ?? ""));

route("GET /api/v1/employees", (req) => {
  const asked = req.query.status;
  return paged(scopeOf(req.user!).filter((p) => (asked === "archived" ? true : visible(p))).map(listRow), req, {
    search: (r) => [r.display_name, r.job_title, r.department, r.staff_number],
    filters: {
      department_id: (r, v) => r.department_id === v,
      status: (r, v) => r.status === v,
      work_pattern: (r, v) => r.work_pattern === v,
      employment_type: (r, v) => r.employment_type === v,
      line_manager_id: (r, v) => r.line_manager?.employee_id === v,
    },
    sort: {
      display_name: (a, b) => text(a.display_name, b.display_name),
      staff_number: (a, b) => text(a.staff_number, b.staff_number),
      job_title: (a, b) => text(a.job_title, b.job_title),
      department: (a, b) => text(a.department, b.department),
      start_date: (a, b) => text(a.start_date, b.start_date),
      created_at: (a, b) => text(a.staff_number, b.staff_number),
    },
  });
});

route("GET /api/v1/employees/summary", (req) => {
  const scope = scopeOf(req.user!).filter(visible);
  const counts = DEPTS.map((d) => [d.name, scope.filter((p) => p.department === d.name).length] as const).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const max = counts[0] ? counts[0][1] : 1;
  const probation = scope.filter((p) => p.status === "probation");
  const PATTERNS: Array<[MockPerson["work_pattern"], string]> = [["on_site", "On Site"], ["hybrid", "Hybrid"], ["remote", "Remote"]];
  return ok({
    kpis: [
      { key: "headcount", label: "Headcount", value: String(scope.filter((p) => statusOf(p) === "active").length) },
      { key: "confirmed", label: "Confirmed", value: String(scope.filter((p) => p.status !== "probation").length), tone: "ok" },
      { key: "probation", label: "On Probation", value: String(probation.length), tone: "warn" },
      { key: "attrition", label: "Attrition, 90 Days", value: "1" },
    ],
    arrangements: PATTERNS.map(([key, label]) => ({ label, value: `${scope.filter((p) => p.work_pattern === key).length} staff` })),
    departments: counts.map(([label, n]) => ({ label, pct: Math.round((n / max) * 100), value: String(n) })),
    decisions: [
      ...(probation.length ? [{ title: "Probation Ending", text: `${probation.length} people in the next 30 days`, action: { tone: "warn" as const, text: "Confirm or extend" }, link: "/people?tab=employees" }] : []),
      { title: "No Line Manager", text: "1 person", action: { tone: "warn" as const, text: "Set a manager" }, link: "/people?tab=organogram" },
      { title: "Open Seats", text: "1 seat with nobody in it", action: { tone: "info" as const, text: "Create vacancy" }, link: "/people?tab=organogram" },
      { title: "Not Yet Invited", text: `${PEOPLE.filter((p) => loginOf(p) === "none").length} people with no login`, action: { tone: "info" as const, text: "Send invites" }, link: "/settings?tab=users" },
    ],
  });
});

/** The 360, masked exactly as the API masks it: restricted fields are null for a viewer without the grant. */
function record(p: MockPerson, viewer: string): Employee360 {
  const canSee = full(viewer) || viewer === p.user_key;
  const [first, ...rest] = p.display_name.split(" ");
  return {
    employee_id: p.employee_id,
    staff_number: p.staff_number,
    display_name: p.display_name,
    first_name: first,
    middle_name: null,
    last_name: rest.join(" ") || first,
    preferred_name: null,
    job_title: p.job_title,
    department_id: deptOf(p.department).department_id,
    department: p.department,
    worksite_id: null,
    status: ARCHIVED.has(p.employee_id) ? "archived" : statusOf(p),
    employment_type: p.employment_type,
    work_pattern: p.work_pattern,
    start_date: p.start_date,
    contract_ends_on: p.employment_type === "contractor" ? isoDaysAhead(120) : null,
    confirmation_due_on: probationDue(p),
    confirmed_on: confirmedOn(p),
    left_on: null,
    archived_at: ARCHIVED.has(p.employee_id) ? at(0, "09:00") : null,
    archive_reason: ARCHIVED.has(p.employee_id) ? "Archived on this laptop" : null,
    work_email: p.work_email,
    phone: p.phone,
    gender: null,
    line_manager: managerRef(p),
    dotted_manager: dottedRef(p),
    direct_reports: reportsOf(p.user_key).length,
    login: {
      user_id: loginOf(p) === "none" ? null : sid(`user:${p.user_key}`),
      email: loginOf(p) === "none" ? null : p.work_email,
      state: loginOf(p),
      roles: SIGN_INS[p.user_key] ? [{ code: SIGN_INS[p.user_key].view === "ceo" ? "management" : "operations_people", name: SIGN_INS[p.user_key].role }] : loginOf(p) === "none" ? [] : [{ code: "employee", name: "Staff" }],
      last_sign_in_at: SIGN_INS[p.user_key] ? at(0, "08:40") : null,
    },
    date_of_birth: canSee ? p.date_of_birth : null,
    home_address: canSee ? `${12 + PEOPLE.indexOf(p)} Bourdillon Road, Ikoyi, Lagos` : null,
    personal_email: canSee ? `${p.user_key}@gmail.com` : null,
    next_of_kin_name: canSee ? p.next_of_kin : null,
    next_of_kin_phone: canSee ? p.phone : null,
    next_of_kin_relationship: canSee ? "Sibling" : null,
    bank_name: canSee ? p.bank_name : null,
    account_number: canSee ? `00000${p.account_last4}` : null,
    gross_monthly: canSee ? p.gross_monthly : null,
    created_at: at(200, "09:00"),
  };
}

const mine = (req: { user: string | null; params: Record<string, string> }) => {
  const p = byId(req.params.id);
  if (!p) return null;
  if (!full(req.user!) && p.user_key !== req.user && !teamOf(req.user!).includes(p)) return null;
  return p;
};

route("GET /api/v1/employees/:id", (req) => {
  const p = mine(req);
  return p ? ok(record(p, req.user!)) : notFound();
});

route("GET /api/v1/employees/:id/history", (req) => {
  const p = mine(req);
  if (!p) return notFound();
  const entries = [
    { event_id: uuid(), occurred_at: at(2, "11:20"), action: "employee.updated", actor_name: "Cynthia Osakunih", changed_fields: ["job_title"], summary: "Record changed: job_title" },
    { event_id: uuid(), occurred_at: at(40, "09:05"), action: "employee.reporting_line_changed", actor_name: "Cynthia Osakunih", changed_fields: ["line_manager_id"], summary: "Reporting line changed" },
    { event_id: uuid(), occurred_at: at(200, "09:00"), action: "employee.created", actor_name: "System", changed_fields: [], summary: "Record created" },
  ];
  return paged(entries, req);
});

const NG_PHONE = /^(\+?234|0)\d{10}$/;

route("POST /api/v1/employees", (req) => {
  const b = req.body as Record<string, string>;
  const f: Record<string, string[]> = {};
  const need = ["first_name", "last_name", "work_email", "phone", "job_title", "start_date", "employment_type", "work_pattern", "department_id"];
  for (const k of need) if (!b[k] || !String(b[k]).trim()) f[k] = ["Required"];
  if (b.work_email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(b.work_email)) f.work_email = ["Check the spelling"];
  if (b.work_email && PEOPLE.some((p) => p.work_email === b.work_email.toLowerCase())) f.work_email = ["Already in use"];
  if (b.phone && !NG_PHONE.test(b.phone.replace(/[\s\-().]/g, ""))) f.phone = ["must be a Nigerian phone number"];
  if (b.account_number && !/^\d{10}$/.test(b.account_number)) f.account_number = ["must be a 10-digit NUBAN"];
  if (b.gross_monthly && !/^\d{1,16}\.\d{2}$/.test(b.gross_monthly)) f.gross_monthly = ["must be an amount like 1250000.00"];
  if (Object.keys(f).length) return invalid(f);
  const key = b.work_email.split("@")[0];
  const dept = DEPTS.find((d) => d.department_id === b.department_id) ?? deptOf("Operations & People");
  const p: MockPerson = {
    employee_id: sid(`employee:${key}`),
    user_key: key,
    staff_number: String(PEOPLE.length + 1).padStart(5, "0"),
    first_name: b.first_name,
    last_name: b.last_name,
    display_name: `${b.first_name} ${b.last_name}`,
    job_title: b.job_title,
    department: dept.name,
    grade: "G1 · Associate",
    manager: byId(b.line_manager_id)?.user_key ?? null,
    work_email: b.work_email.toLowerCase(),
    phone: b.phone,
    start_date: b.start_date,
    date_of_birth: b.date_of_birth || "1998-01-01",
    employment_type: b.employment_type as MockPerson["employment_type"],
    work_pattern: b.work_pattern as MockPerson["work_pattern"],
    status: b.confirmed_on ? "confirmed" : "probation",
    worksite: "MTN Head Office, Ikoyi",
    gross_monthly: b.gross_monthly || "0.00",
    bank_name: b.bank_name || "",
    account_last4: (b.account_number || "0000").slice(-4),
    next_of_kin: b.next_of_kin_name || "",
  };
  PEOPLE.push(p);
  return created(record(p, req.user!));
});

route("PATCH /api/v1/employees/:id", (req) => {
  const p = mine(req);
  if (!p) return notFound();
  const b = req.body as Record<string, string>;
  if (!Object.keys(b).length) return invalid({ first_name: ["Change at least one field"] });
  if (b.work_email && PEOPLE.some((x) => x !== p && x.work_email === b.work_email.toLowerCase())) return invalid({ work_email: ["Already in use"] });
  if (b.first_name) p.first_name = b.first_name;
  if (b.last_name) p.last_name = b.last_name;
  if (b.first_name || b.last_name) p.display_name = `${p.first_name} ${p.last_name}`;
  if (b.job_title) p.job_title = b.job_title;
  if (b.work_email) p.work_email = b.work_email.toLowerCase();
  if (b.phone) p.phone = b.phone;
  if (b.work_pattern) p.work_pattern = b.work_pattern as MockPerson["work_pattern"];
  if (b.employment_type) p.employment_type = b.employment_type as MockPerson["employment_type"];
  if (b.department_id) p.department = (DEPTS.find((d) => d.department_id === b.department_id) ?? deptOf(p.department)).name;
  if (b.gross_monthly) p.gross_monthly = b.gross_monthly;
  if (b.bank_name) p.bank_name = b.bank_name;
  if (b.confirmed_on) p.status = "confirmed";
  return ok(record(p, req.user!));
});

route("POST /api/v1/employees/:id/archive", (req) => {
  const p = mine(req);
  if (!p) return notFound();
  if (!(req.body as { archive_reason?: string }).archive_reason) return invalid({ archive_reason: ["Say why"] });
  if (ARCHIVED.has(p.employee_id)) return fail(422, "ALREADY_ARCHIVED", "This record is already archived.");
  if (p.user_key === "ifeoma") return fail(422, "CEO_PROTECTED", "The CEO's record cannot be archived.");
  ARCHIVED.add(p.employee_id);
  return ok(record(p, req.user!));
});

route("POST /api/v1/employees/:id/restore", (req) => {
  const p = mine(req);
  if (!p) return notFound();
  if (!ARCHIVED.has(p.employee_id)) return fail(422, "NOT_ARCHIVED", "This record is not archived.");
  ARCHIVED.delete(p.employee_id);
  return ok(record(p, req.user!));
});

route("PATCH /api/v1/employees/:id/line-manager", (req) => {
  const p = mine(req);
  if (!p) return notFound();
  const b = req.body as { line_manager_id?: string | null; line_manager_seat_id?: string | null; dotted_manager_id?: string | null; dotted_manager_seat_id?: string | null };
  if ("line_manager_id" in b) {
    const m = b.line_manager_id ? byId(b.line_manager_id) : null;
    if (b.line_manager_id && !m) return invalid({ line_manager_id: ["Not an employee"] });
    if (m === p) return fail(422, "REPORTS_TO_SELF", "Nobody reports to themselves.");
    if (m && teamOf(p.user_key).includes(m)) return fail(422, "REPORTING_LOOP", "That would make a loop in the reporting line.");
    p.manager = m ? m.user_key : null;
  }
  if ("dotted_manager_id" in b) {
    const d = b.dotted_manager_id ? byId(b.dotted_manager_id) : null;
    if (d) DOTTED[p.user_key] = d.user_key;
    else delete DOTTED[p.user_key];
  }
  return ok(record(p, req.user!));
});

route("GET /api/v1/departments", (req) =>
  paged(
    DEPTS.map((d) => ({
      department_id: d.department_id,
      code: d.code,
      name: d.name,
      parent_department_id: d.parent_department_id,
      active: d.active,
      headcount: PEOPLE.filter((p) => p.department === d.name && visible(p)).length,
    })),
    req,
    { search: (r) => [r.name], filters: { active: (r, v) => String(r.active) === v } },
  ),
);

route("POST /api/v1/departments", (req) => {
  const name = String((req.body as { name?: string }).name ?? "").trim();
  if (!name) return invalid({ name: ["Name the department"] });
  if (DEPTS.some((d) => d.name.toLowerCase() === name.toLowerCase())) return fail(409, "DEPARTMENT_EXISTS", "There is already a department with this name.", { name: ["Already in use"] });
  const d = { department_id: uuid(), code: name.toUpperCase().replace(/[^A-Z0-9]+/g, "_"), name, parent_department_id: null, active: true, order: DEPTS.length };
  DEPTS.push(d);
  DEPARTMENTS.push(name);
  return created({ ...d, headcount: 0, order: undefined, department_id: d.department_id, code: d.code, name, parent_department_id: null, active: true });
});

route("PATCH /api/v1/departments/:id", (req) => {
  const d = DEPTS.find((x) => x.department_id === req.params.id);
  if (!d) return notFound();
  const b = req.body as { name?: string; active?: boolean };
  if (b.name) d.name = b.name;
  if (typeof b.active === "boolean") d.active = b.active;
  return ok({ department_id: d.department_id, code: d.code, name: d.name, parent_department_id: null, active: d.active, headcount: PEOPLE.filter((p) => p.department === d.name).length });
});

const seatRow = (s: (typeof SEATS)[number]): OrgSeat => {
  const m = s.manager_key ? byKey(s.manager_key) : undefined;
  return {
    org_seat_id: s.org_seat_id,
    title: s.title,
    department_id: s.department_id,
    department: s.department,
    status: s.status,
    line_manager: m ? { employee_id: m.employee_id, org_seat_id: null, display_name: m.display_name, job_title: m.job_title, vacant: false } : null,
    filled_by_employee_id: null,
    filled_on: null,
    reports: PEOPLE.filter((p) => p.user_key === "amara").length,
    created_at: s.created_at,
  };
};

route("GET /api/v1/org-seats", (req) => paged(SEATS.map(seatRow), req, { search: (r) => [r.title], filters: { status: (r, v) => r.status === v } }));

route("POST /api/v1/org-seats", (req) => {
  const b = req.body as { title?: string; department_id?: string; line_manager_id?: string };
  if (!b.title) return invalid({ title: ["Name the role"] });
  if (!b.department_id) return invalid({ department_id: ["Pick a department"] });
  const dept = DEPTS.find((d) => d.department_id === b.department_id) ?? DEPTS[0];
  const seat = {
    org_seat_id: uuid(),
    title: b.title,
    department_id: dept.department_id,
    department: dept.name,
    status: "vacant" as const,
    line_manager: null,
    filled_by_employee_id: null,
    filled_on: null,
    reports: 0,
    created_at: at(0, "09:00"),
    manager_key: byId(b.line_manager_id ?? "")?.user_key ?? null,
  };
  SEATS.push(seat);
  return created(seatRow(seat));
});

route("PATCH /api/v1/org-seats/:id", (req) => {
  const seat = SEATS.find((s) => s.org_seat_id === req.params.id);
  if (!seat) return notFound();
  const b = req.body as { title?: string; status?: "vacant" | "closed"; line_manager_id?: string | null };
  if (b.title) seat.title = b.title;
  if (b.status) seat.status = b.status;
  if ("line_manager_id" in b) seat.manager_key = b.line_manager_id ? (byId(b.line_manager_id)?.user_key ?? null) : null;
  return ok(seatRow(seat));
});

/* The reporting tree. A complete set by design: a tree with a missing branch is wrong. */
route("GET /api/v1/org-chart", (req) => {
  const builder = req.query.view === "builder" && full(req.user!);
  const PATTERNS: Record<string, string> = { on_site: "On Site", hybrid: "Hybrid", remote: "Remote" };
  const nodes: OrgNode[] = [
    ...PEOPLE.filter((p) => statusOf(p) === "active" && visible(p)).map((p) => {
      const manager = managerRef(p);
      const dotted = dottedRef(p);
      return {
        node_id: p.employee_id,
        node_kind: "employee" as const,
        employee_id: p.employee_id,
        org_seat_id: null,
        display_name: p.display_name,
        job_title: p.job_title,
        department: p.department,
        manager_node_id: manager ? (manager.employee_id ?? manager.org_seat_id) : null,
        dotted_manager_node_id: dotted ? dotted.employee_id : null,
        dotted_line_to: dotted ? dotted.display_name : null,
        is_ceo: p.user_key === "ifeoma",
        vacant: false,
        meta: builder ? [`Since ${p.start_date.slice(0, 4)}`, PATTERNS[p.work_pattern]].join(" · ") : null,
      };
    }),
    ...SEATS.filter((s) => s.status === "vacant").map((s) => ({
      node_id: s.org_seat_id,
      node_kind: "seat" as const,
      employee_id: null,
      org_seat_id: s.org_seat_id,
      display_name: s.title,
      job_title: s.title,
      department: s.department,
      manager_node_id: s.manager_key ? (byKey(s.manager_key)?.employee_id ?? null) : null,
      dotted_manager_node_id: null,
      dotted_line_to: null,
      is_ceo: false,
      vacant: true,
      meta: null,
    })),
  ];
  return ok({
    nodes,
    seats: nodes.length,
    filled: nodes.filter((n) => !n.vacant).length,
    open: nodes.filter((n) => n.vacant).length,
    roots: nodes.filter((n) => !n.manager_node_id).length,
  });
});

/* ------------------------------------------------------------------ *
 * Leave
 * ------------------------------------------------------------------ */
type L = [string, string, number, number, number, string, string | null];
const L_ROWS: L[] = [
  ["hauwa", "Annual", -2, 1, 3, "Approved", "Family visit"], ["amara", "Annual", 6, 10, 5, "Pending", "Trip to Enugu"], ["chidera", "Compassionate", 0, 0, 1, "Pending", "Family emergency"],
  ["tolu", "Annual", 69, 78, 7, "Approved", "End of year break"], ["tobi", "Annual", -3, 2, 5, "Approved", null], ["kemi", "Sick", -12, -11, 2, "Approved", "Flu"],
  ["seyi", "Study", 20, 21, 2, "Approved", "AWS exam"], ["grace", "Annual", 30, 34, 5, "Rejected", "Clashes with Ember to Remember"], ["bashir", "Annual", 45, 49, 5, "Pending", "Wedding"],
  ["cynthia", "Annual", 72, 80, 6, "Approved", "Christmas"], ["obinna", "Paternity", -40, -27, 10, "Approved", null], ["blessing", "Annual", 14, 15, 2, "Cancelled", null],
];
const iso = (n: number) => (n >= 0 ? isoDaysAhead(n) : isoDaysAgo(-n));
const LEAVE = L_ROWS.map((l, i) => ({
  leave_id: sid(`leave:${i}`), number: `LV-${String(88 - i).padStart(4, "0")}`, employee: refKey(l[0]), key: l[0], type: l[1] as LeaveRequest["type"], from: iso(l[2]), to: iso(l[3]), days: l[4],
  reason: l[6], status: l[5] as LeaveRequest["status"], approver: l[5] === "Pending" ? null : "Cynthia Osakunih", submitted_at: at(5 + i, "10:00"),
}));
const leaveScope = (user: string, scope?: string) =>
  scope === "own" ? LEAVE.filter((l) => l.key === user) : scope === "team" || !full(user) ? LEAVE.filter((l) => teamOf(user).some((p) => p.user_key === l.key)) : LEAVE;

route("GET /api/v1/leave/requests", (req) =>
  paged(leaveScope(req.user!, req.query.scope), { ...req, query: Object.fromEntries(Object.entries(req.query).filter(([k]) => k !== "scope")) }, {
    search: (r) => [r.employee.display_name, r.type, r.number, r.reason],
    filters: { status: (r, v) => r.status === v, type: (r, v) => r.type === v },
  }),
);
route("GET /api/v1/leave/summary", (req) => {
  const l = leaveScope(req.user!, req.query.scope);
  const today = isoDaysAgo(0);
  return ok({ kpis: [
    { key: "today", label: "On Leave Today", value: String(l.filter((x) => x.status === "Approved" && x.from <= today && x.to >= today).length) },
    { key: "pending", label: "Pending Approval", value: String(l.filter((x) => x.status === "Pending").length), tone: "warn" },
    { key: "month", label: "Approved This Month", value: String(l.filter((x) => x.status === "Approved" && x.from.slice(0, 7) === today.slice(0, 7)).length) },
    { key: "clash", label: "Clashes", value: "0", tone: "ok" },
  ] });
});
route("GET /api/v1/leave/balances", (req) => {
  const mine = LEAVE.filter((l) => l.key === req.user);
  const taken = (t: string) => mine.filter((l) => l.type === t && l.status === "Approved" && l.to < isoDaysAgo(0)).reduce((a, l) => a + l.days, 0);
  const booked = (t: string) => mine.filter((l) => l.type === t && (l.status === "Approved" || l.status === "Pending") && l.to >= isoDaysAgo(0)).reduce((a, l) => a + l.days, 0);
  return ok({ year: new Date().getFullYear(), balances: [["Annual", 21], ["Sick", 10], ["Compassionate", 5], ["Study", 5]].map(([t, e]) => ({ type: t as "Annual", entitled: e as number, taken: taken(t as string) + (t === "Annual" ? 6 : 0), booked: booked(t as string), left: (e as number) - taken(t as string) - booked(t as string) - (t === "Annual" ? 6 : 0) })) });
});
route("POST /api/v1/leave/requests", (req) => {
  const b = req.body as { type: string; from: string; to: string; reason: string; employee_id?: string };
  const f: Record<string, string[]> = {};
  if (!b.from) f.from = ["Pick the first day"];
  if (!b.to) f.to = ["Pick the last day"];
  if (b.from && b.to && b.to < b.from) f.to = ["Ends before it starts"];
  if (b.type !== "Sick" && b.from && b.from < isoDaysAgo(0)) f.from = ["Starts in the past"];
  if (!b.reason || b.reason.trim().length < 3) f.reason = ["Give a short reason"];
  if (Object.keys(f).length) return invalid(f);
  const who = b.employee_id ? byId(b.employee_id)! : byKey(req.user)!;
  const days = Math.round((Date.parse(b.to) - Date.parse(b.from)) / 86400000) + 1;
  const l = { leave_id: sid(`leave:${Date.now()}`), number: `LV-${String(89 + LEAVE.length).padStart(4, "0")}`, employee: ref(who)!, key: who.user_key, type: b.type as LeaveRequest["type"], from: b.from, to: b.to, days, reason: b.reason, status: (b.employee_id ? "Approved" : "Pending") as LeaveRequest["status"], approver: b.employee_id ? byKey(req.user)!.display_name : null, submitted_at: new Date().toISOString() };
  LEAVE.unshift(l);
  return created(l);
});
route("POST /api/v1/leave/requests/:id/decision", (req) => {
  const l = LEAVE.find((x) => x.leave_id === req.params.id);
  if (!l) return notFound();
  if (l.key === req.user) return fail(403, "SELF_APPROVAL", "You cannot approve your own leave.");
  l.status = req.body.approve ? "Approved" : "Rejected";
  l.approver = byKey(req.user)!.display_name;
  return ok(l);
});
route("POST /api/v1/leave/requests/:id/cancel", (req) => {
  const l = LEAVE.find((x) => x.leave_id === req.params.id);
  if (!l) return notFound();
  l.status = "Cancelled";
  return ok(l);
});
route("GET /api/v1/leave/requests/:id/cover", (req) => {
  const l = LEAVE.find((x) => x.leave_id === req.params.id);
  if (!l) return notFound();
  const p = byKey(l.key)!;
  const peers = PEOPLE.filter((x) => x.department === p.department && x !== p);
  return ok({
    title: `Cover Check, ${l.from.split("-").reverse().join("/")} to ${l.to.split("-").reverse().join("/")}`,
    text: `${p.display_name} has requested ${l.days} day${l.days === 1 ? "" : "s"}. This is what is open in that window.`,
    rows: [
      { title: `${p.department} cover`, text: peers.length ? `${peers[0].display_name} is in that week` : `Nobody else in ${p.department}`, tone: peers.length ? "ok" : "err", result: peers.length ? "Clear" : "Conflict" },
      { title: "Tasks due in the window", text: "2 tasks, both can move", tone: "warn", result: "Needs agreement" },
      { title: "Others on leave", text: `${LEAVE.filter((x) => x !== l && x.status === "Approved" && x.from <= l.to && x.to >= l.from && byKey(x.key)!.department === p.department).length} in the same department`, tone: "ok", result: "Clear" },
      { title: "Payroll run", text: "Not in the window", tone: "ok", result: "Clear" },
    ],
  });
});

export const _reports = reportsOf;
