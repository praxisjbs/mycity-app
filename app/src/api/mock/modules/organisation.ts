import type { ApprovalWaiting, LeaveRequest, LeaveStatus, LeaveType } from "@mycity/contract/contract.gen.ts";
import type { EmployeeRow, Employee360, ManagerRef, OrgNode, OrgSeat } from "@/api/types/organisation";
import { at, created, invalid, isoDaysAgo, isoDaysAhead, noContent, notFound, ok, paged, route, sid, fail, uuid } from "../core";
import { byId, byKey, DEPARTMENTS, managerOf, PEOPLE, reportsOf, teamOf, SIGN_INS, type MockPerson } from "../data/people";
import roster from "../data/roster.json";

/**
 * The organisation module on the mock, in the contract's own shapes
 * (packages/contract/schemas/organisation.js): the staff register, the employee 360,
 * departments, vacant seats and the reporting tree. Laptops and CI only (F12).
 *
 * The real API is built: this mock exists so the gallery, the screen crawl and a laptop
 * without a server have people to show, and it answers exactly what the API answers.
 * Leave (M1) is at the foot of this file, in the leave contract's shapes.
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
 * Leave, in the contract's shapes (packages/contract/schemas/leave.js)
 * ------------------------------------------------------------------ */
type LeaveTypeCode = "annual" | "compassionate" | "sick" | "unpaid";
const LEAVE_TYPES: LeaveType[] = (
  [
    ["annual", "Annual", 20],
    ["compassionate", "Compassionate", 5],
    ["sick", "Sick", 12],
    ["unpaid", "Unpaid", null],
  ] as Array<[LeaveTypeCode, string, number | null]>
).map(([code, name, days]) => ({ leave_type_id: sid(`leave_type:${code}`), code, name, days_per_year: days, active: true }));
const typeOf = (code: string) => LEAVE_TYPES.find((t) => t.code === code)!;
const personRef = (p: MockPerson) => ({ employee_id: p.employee_id, display_name: p.display_name, job_title: p.job_title, department: p.department });

/** The sample requests, in days from today; shared with the local seed (roster.json). */
type L = { key: string; type: LeaveTypeCode; from: number; to: number; days: number; status: LeaveStatus; reason: string | null };
const L_ROWS = roster.leave as L[];
const iso = (n: number) => (n >= 0 ? isoDaysAhead(n) : isoDaysAgo(-n));
type MockLeave = LeaveRequest & { key: string };
const LEAVE: MockLeave[] = L_ROWS.map((l, i) => ({
  leave_request_id: sid(`leave:${i}`),
  employee: personRef(byKey(l.key)!),
  key: l.key,
  leave_type_id: typeOf(l.type).leave_type_id,
  leave_type_name: typeOf(l.type).name,
  starts_on: iso(l.from),
  ends_on: iso(l.to),
  days: l.days,
  reason: l.reason,
  status: l.status,
  workflow_instance_id: l.status === "submitted" ? sid(`leave-flow:${i}`) : null,
  waiting_on: l.status === "submitted" ? (l.days > 5 ? "Operations & People" : "Line Manager") : null,
  recorded: false,
  submitted_at: at(5 + i, "10:00"),
  decided_at: l.status === "submitted" ? null : at(4 + i, "12:00"),
  created_at: at(5 + i, "10:00"),
}));
const out = ({ key: _k, ...r }: MockLeave): LeaveRequest => r;
/** People's scope over leave: everyone for Operations & People and the CEO, else the reader's team. */
const peopleScope = (user: string) => (full(user) ? LEAVE : LEAVE.filter((l) => teamOf(user).some((p) => p.user_key === l.key)));
const workingDays = (from: string, to: string) => {
  let n = 0;
  for (let d = new Date(`${from}T12:00:00Z`); d <= new Date(`${to}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) if (d.getUTCDay() !== 0) n += 1;
  return n;
};
const LIST_FILTERS = {
  status: (r: MockLeave, v: string) => r.status === v,
  leave_type_id: (r: MockLeave, v: string) => r.leave_type_id === v,
  employee_id: (r: MockLeave, v: string) => r.employee.employee_id === v,
  from: (r: MockLeave, v: string) => r.ends_on >= v,
  to: (r: MockLeave, v: string) => r.starts_on <= v,
};
const LIST_SORT = {
  starts_on: (a: MockLeave, b: MockLeave) => a.starts_on.localeCompare(b.starts_on),
  submitted_at: (a: MockLeave, b: MockLeave) => (a.submitted_at ?? "").localeCompare(b.submitted_at ?? ""),
  created_at: (a: MockLeave, b: MockLeave) => a.created_at.localeCompare(b.created_at),
};
const asPage = (res: ReturnType<typeof paged>) => {
  const body = res.body as { data?: MockLeave[] } | undefined;
  if (body && Array.isArray(body.data)) body.data = body.data.map(out) as MockLeave[];
  return res;
};

route("GET /api/v1/leave/types", (req) =>
  paged(LEAVE_TYPES, req, { search: (t) => [t.name, t.code], filters: { active: (t, v) => String(t.active) === v }, sort: { name: (a, b) => a.name.localeCompare(b.name) } }),
);
route("POST /api/v1/leave/types", (req) => {
  if (!full(req.user!)) return fail(403, "PERMISSION_DENIED", "You need people create to add leave types.");
  const b = req.body as { code: string; name: string; days_per_year?: number | null };
  if (LEAVE_TYPES.some((t) => t.code === b.code)) return fail(409, "LEAVE_TYPE_EXISTS", "A leave type already has this code", { code: ["Already in use"] });
  const t = { leave_type_id: uuid(), code: b.code, name: b.name, days_per_year: b.days_per_year ?? null, active: true };
  LEAVE_TYPES.push(t);
  return created(t);
});
route("PATCH /api/v1/leave/types/:id", (req) => {
  const t = LEAVE_TYPES.find((x) => x.leave_type_id === req.params.id);
  if (!t) return notFound();
  Object.assign(t, req.body);
  return ok(t);
});

route("DELETE /api/v1/leave/types/:id", (req) => {
  if (!full(req.user!)) return fail(403, "PERMISSION_DENIED", "You need people delete to remove leave types.");
  const i = LEAVE_TYPES.findIndex((x) => x.leave_type_id === req.params.id);
  if (i < 0) return notFound();
  if (LEAVE.some((l) => l.leave_type_id === req.params.id) || [...ALLOWANCES.keys()].some((k) => k.includes(req.params.id)))
    return fail(409, "LEAVE_TYPE_IN_USE", "This type has leave on record. Retire it instead.");
  LEAVE_TYPES.splice(i, 1);
  return noContent();
});

/* One person's year. People's own figure for a type and year, when set, replaces the type's. */
const ALLOWANCES = new Map<string, number>();
const yearOf = (key: string, year: number) => {
  const p = byKey(key)!;
  const today = isoDaysAgo(0);
  const rows = LEAVE.filter((l) => l.key === key && l.starts_on.slice(0, 4) === String(year));
  const sum = (t: LeaveType, test: (l: MockLeave) => boolean) => rows.filter((l) => l.leave_type_id === t.leave_type_id && test(l)).reduce((a, l) => a + l.days, 0);
  return {
    year,
    balances: LEAVE_TYPES.filter((t) => t.active).map((t) => {
      const taken = sum(t, (l) => l.status === "approved" && l.starts_on <= today);
      const booked = sum(t, (l) => l.status === "approved" && l.starts_on > today);
      const pending = sum(t, (l) => l.status === "submitted");
      const own = ALLOWANCES.get(`${p.employee_id}|${t.leave_type_id}|${year}`);
      const entitled = own ?? t.days_per_year;
      return { leave_type_id: t.leave_type_id, code: t.code, name: t.name, entitled, taken, booked, pending, remaining: entitled === null ? null : entitled - taken - booked - pending };
    }),
  };
};
route("GET /api/v1/leave/balances", (req) => {
  const who = byId(req.query.employee_id);
  if (!who) return notFound();
  if (!full(req.user!) && !teamOf(req.user!).some((p) => p.employee_id === who.employee_id)) return notFound();
  return ok(yearOf(who.user_key, Number(req.query.year || isoDaysAgo(0).slice(0, 4))));
});
route("PUT /api/v1/leave/balances", (req) => {
  if (!full(req.user!)) return fail(403, "PERMISSION_DENIED", "You need people edit to set allowances.");
  const b = req.body as { employee_id: string; leave_type_id: string; year: number; days: number | null };
  const who = byId(b.employee_id);
  if (!who) return notFound();
  const k = `${b.employee_id}|${b.leave_type_id}|${b.year}`;
  if (b.days === null) ALLOWANCES.delete(k);
  else ALLOWANCES.set(k, b.days);
  return ok(yearOf(who.user_key, b.year));
});

route("GET /api/v1/leave/requests", (req) =>
  asPage(paged(peopleScope(req.user!), req, { search: (r) => [r.employee.display_name, r.leave_type_name, r.reason], filters: LIST_FILTERS, sort: LIST_SORT })),
);
route("GET /api/v1/leave/summary", (req) => {
  const l = peopleScope(req.user!);
  const today = isoDaysAgo(0);
  const soon = isoDaysAhead(14);
  return ok({
    pending: l.filter((x) => x.status === "submitted").length,
    on_leave_today: l.filter((x) => x.status === "approved" && x.starts_on <= today && x.ends_on >= today).length,
    starting_soon: l.filter((x) => x.status === "approved" && x.starts_on > today && x.starts_on <= soon).length,
    approved_this_year: l.filter((x) => x.status === "approved" && x.starts_on.slice(0, 4) === today.slice(0, 4)).length,
  });
});
route("GET /api/v1/leave/requests/:id", (req) => {
  const l = peopleScope(req.user!).find((x) => x.leave_request_id === req.params.id);
  return l ? ok(out(l)) : notFound();
});
route("GET /api/v1/leave/requests/:id/clashes", (req) => {
  const l = peopleScope(req.user!).find((x) => x.leave_request_id === req.params.id);
  if (!l) return notFound();
  const others = peopleScope(req.user!).filter(
    (x) => x !== l && x.employee.department === l.employee.department && x.key !== l.key && ["submitted", "approved"].includes(x.status) && x.starts_on <= l.ends_on && x.ends_on >= l.starts_on,
  );
  return asPage(paged(others, req, { sort: { starts_on: LIST_SORT.starts_on } }));
});
route("POST /api/v1/leave/requests", (req) => {
  if (!full(req.user!)) return fail(403, "PERMISSION_DENIED", "You need people create to record leave.");
  const b = req.body as { employee_id: string; leave_type_id: string; starts_on: string; ends_on: string; reason?: string };
  const who = byId(b.employee_id);
  const t = LEAVE_TYPES.find((x) => x.leave_type_id === b.leave_type_id);
  if (!who || !t) return invalid({ ...(who ? {} : { employee_id: ["Pick someone"] }), ...(t ? {} : { leave_type_id: ["Pick a type"] }) });
  const l: MockLeave = {
    leave_request_id: uuid(), employee: personRef(who), key: who.user_key, leave_type_id: t.leave_type_id, leave_type_name: t.name, starts_on: b.starts_on, ends_on: b.ends_on,
    days: workingDays(b.starts_on, b.ends_on), reason: b.reason ?? null, status: "approved", workflow_instance_id: null, waiting_on: null, recorded: true,
    submitted_at: new Date().toISOString(), decided_at: new Date().toISOString(), created_at: new Date().toISOString(),
  };
  LEAVE.unshift(l);
  return created(out(l));
});
route("POST /api/v1/leave/requests/:id/cancel", (req) => {
  const l = peopleScope(req.user!).find((x) => x.leave_request_id === req.params.id);
  if (!l) return notFound();
  if (l.status === "submitted") return fail(409, "LEAVE_AWAITING_APPROVAL", "Decide this request in My Approvals instead");
  if (l.status !== "approved") return fail(409, "LEAVE_NOT_CANCELLABLE", "This leave can no longer be cancelled");
  l.status = "cancelled";
  return ok(out(l));
});

/* The decision on a waiting request: the approval's own routes, for the mock's leave flows only. */
const decide = (req: { params: Record<string, string>; user: string | null }, approve: boolean) => {
  const l = LEAVE.find((x) => x.workflow_instance_id === req.params.id);
  if (!l || l.status !== "submitted") return notFound();
  if (l.key === req.user) return fail(403, "PERMISSION_DENIED", "You are not an approver for this stage");
  if (approve && l.days > 5 && l.waiting_on === "Line Manager") {
    l.waiting_on = "Operations & People";
    return ok({ workflow_instance_id: l.workflow_instance_id, state: "pending", stage_name: l.waiting_on });
  }
  l.status = approve ? "approved" : "rejected";
  l.waiting_on = null;
  l.decided_at = new Date().toISOString();
  return ok({ workflow_instance_id: l.workflow_instance_id, state: l.status, stage_name: null });
};
route("POST /api/v1/workflow/instances/:id/approve", (req) => decide(req, true));
route("POST /api/v1/workflow/instances/:id/reject", (req) => decide(req, false));

/*
 * The requests waiting on the caller (GET /workflow/mine), Home's Need You. A leave request
 * waits on the requester's line manager, and one of more than 5 days on Operations & People,
 * as the leave flow's stages read; each stage has 48 hours before it is overdue. Oldest first.
 */
const STAGE_HOURS = 48;
export function waitingOn(user: string): ApprovalWaiting[] {
  return LEAVE.filter((l) => l.status === "submitted" && l.workflow_instance_id && (l.days > 5 ? full(user) : byKey(l.key)?.manager === user))
    .map((l) => {
      const operations = l.days > 5;
      const entered = l.submitted_at ?? l.created_at;
      const due = new Date(Date.parse(entered) + STAGE_HOURS * 3600000).toISOString();
      return {
        workflow_instance_id: l.workflow_instance_id!,
        definition_key: "leave.approval",
        definition_name: "Leave Request",
        module_key: "people",
        entity_type: "leave_request",
        entity_id: l.leave_request_id,
        subject_employee_id: l.employee.employee_id,
        subject_name: l.employee.display_name,
        current_stage: operations ? "operations_people" : "line_manager",
        stage_name: operations ? "Operations & People" : "Line Manager",
        context: { days: l.days },
        stage_entered_at: entered,
        stage_due_at: due,
        overdue: Date.parse(due) < Date.now(),
        opened_by: null,
        opened_by_name: l.employee.display_name,
        opened_at: entered,
        link: `/people?tab=leave&id=${l.leave_request_id}`,
      };
    })
    .sort((a, b) => a.stage_entered_at.localeCompare(b.stage_entered_at));
}
route("GET /api/v1/workflow/mine", (req) => paged(waitingOn(req.user!), req, { filters: { module_key: (r, v) => r.module_key === v } }));
route("GET /api/v1/workflow/mine/count", (req) => {
  const waiting = waitingOn(req.user!);
  return ok({ waiting: waiting.length, overdue: waiting.filter((r) => r.overdue).length });
});

/* My Leave: the caller's own. */
const myLeave = (user: string) => LEAVE.filter((l) => l.key === user);
route("GET /api/v1/ess/leave", (req) =>
  asPage(paged(myLeave(req.user!), req, { filters: { status: LIST_FILTERS.status, year: (r, v) => r.starts_on.slice(0, 4) === v }, sort: { starts_on: LIST_SORT.starts_on, submitted_at: LIST_SORT.submitted_at } })),
);
/** My Leave's calendar: everyone for Operations & People and the CEO, else mine and everyone under me. */
route("GET /api/v1/ess/leave/calendar", (req) => {
  const month = String(req.query.month || isoDaysAgo(0).slice(0, 7));
  const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const user = req.user!;
  const mine = new Set([user, ...teamOf(user).map((p) => p.user_key)]);
  const rows = LEAVE.filter((l) => (full(user) || mine.has(l.key)) && (l.status === "approved" || l.status === "submitted") && l.ends_on >= `${month}-01` && l.starts_on <= last);
  const { month: _m, ...query } = req.query;
  return asPage(paged(rows, { ...req, query }, { sort: { starts_on: LIST_SORT.starts_on } }));
});
route("GET /api/v1/ess/leave/balances", (req) => ok(yearOf(req.user!, Number(req.query.year || isoDaysAgo(0).slice(0, 4)))));
route("GET /api/v1/ess/leave/:id", (req) => {
  const l = myLeave(req.user!).find((x) => x.leave_request_id === req.params.id);
  return l ? ok(out(l)) : notFound();
});
route("POST /api/v1/ess/leave", (req) => {
  const b = req.body as { leave_type_id: string; starts_on: string; ends_on: string; reason?: string };
  const t = LEAVE_TYPES.find((x) => x.leave_type_id === b.leave_type_id);
  const f: Record<string, string[]> = {};
  if (!t) f.leave_type_id = ["Pick a type"];
  if (b.starts_on && b.starts_on < isoDaysAgo(0)) f.starts_on = ["Already past"];
  if (b.starts_on && b.ends_on && b.ends_on < b.starts_on) f.ends_on = ["Ends before it starts"];
  if (Object.keys(f).length) return invalid(f);
  const me = byKey(req.user)!;
  if (myLeave(req.user!).some((x) => ["submitted", "approved"].includes(x.status) && x.starts_on <= b.ends_on && x.ends_on >= b.starts_on))
    return fail(409, "LEAVE_OVERLAP", "You already have leave on some of those days", { starts_on: ["Overlaps other leave"] });
  const days = workingDays(b.starts_on, b.ends_on);
  const l: MockLeave = {
    leave_request_id: uuid(), employee: personRef(me), key: me.user_key, leave_type_id: t!.leave_type_id, leave_type_name: t!.name, starts_on: b.starts_on, ends_on: b.ends_on,
    days, reason: b.reason ?? null, status: "submitted", workflow_instance_id: uuid(), waiting_on: "Line Manager", recorded: false,
    submitted_at: new Date().toISOString(), decided_at: null, created_at: new Date().toISOString(),
  };
  LEAVE.unshift(l);
  return created(out(l));
});
route("POST /api/v1/ess/leave/:id/cancel", (req) => {
  const l = myLeave(req.user!).find((x) => x.leave_request_id === req.params.id);
  if (!l) return notFound();
  if (!(l.status === "submitted" || (l.status === "approved" && l.starts_on > isoDaysAgo(0)))) return fail(409, "LEAVE_NOT_CANCELLABLE", "This leave can no longer be cancelled");
  l.status = "cancelled";
  l.waiting_on = null;
  return ok(out(l));
});

/** For Home's mock: every leave request, with the key of the person it is for. */
export const leaveRequests = (): ReadonlyArray<LeaveRequest & { key: string }> => LEAVE;
/** For Home's mock: a person's leave year, as My Leave reads it. */
export const leaveYear = yearOf;

export const _reports = reportsOf;
