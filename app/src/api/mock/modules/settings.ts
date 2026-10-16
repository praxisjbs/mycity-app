import type { UserRow } from "@mycity/contract/contract.gen.ts";
import type { AccessCatalogue, FailedLogin, Hierarchy, NotificationPref, Organisation, RecordScope, Role, RoleAction, RoleBody, RoleDetail, RoleGrant, Session } from "@/api/types/settings";
import type { Status } from "@/api/types/performance";
import { at, created, fail, invalid, isoDaysAgo, noContent, notFound, ok, paged, route, sid } from "../core";
import { byId, byKey, PEOPLE, refKey, SIGN_INS } from "../data/people";
import { AUDIT, audit } from "../data/audit";
import { waysOf } from "./security";

const S = (tone: Status["tone"], text: string): Status => ({ tone, text });
const admin = (u: string) => ["operations", "ceo"].includes(SIGN_INS[u]?.view ?? "");
const who = (u: string) => byKey(u)!.display_name;

const ORG: Organisation = {
  legal_name: "MyCity App Ltd", trading_name: "MyCityApp", country: "Nigeria", currency: "Naira (NGN)", time_zone: "Africa/Lagos (UTC+1)", financial_year: "January to December",
  hosts: [["Admin, this app", "hub.mycityapp.io"], ["Public site", "go.mycityapp.io"], ["Staging, admin", "hub.staging.mycityapp.io"], ["Staging, public", "go.staging.mycityapp.io"], ["Why two hosts", "A different origin shares no cookie, no storage and no service worker with this app"]],
  about: [["Product", "MyCity App ERP"], ["Version", "1.0.0"], ["Built by", "JBS Praxis"], ["Handover", "18 December 2026"], ["Support", "Three months from handover"], ["Source", "Handed over in full, with the deployment runbook"]],
  week: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((day) => ({ day, working: day !== "Sunday", start: day === "Sunday" ? null : "09:00", end: day === "Sunday" ? null : day === "Saturday" ? "15:00" : "17:00", grace_min: day === "Sunday" ? null : 10 })),
  holidays: [["01-01", "New Year’s Day"], ["05-01", "Workers’ Day"], ["06-12", "Democracy Day"], ["10-01", "Independence Day"], ["12-25", "Christmas Day"], ["12-26", "Boxing Day"]].map(([d, name]) => ({ date: `${new Date().getUTCFullYear()}-${d}`, name })),
};
route("GET /api/v1/settings/organisation", () => ok(ORG));
route("PATCH /api/v1/settings/organisation", (req) => {
  if (!admin(req.user!)) return fail(403, "FORBIDDEN", "Operations and the CEO change organisation settings.");
  const b = req.body as Partial<Organisation>;
  if (b.week) {
    const bad = b.week.find((d) => d.working && (!/^\d{2}:\d{2}$/.test(d.start ?? "") || !/^\d{2}:\d{2}$/.test(d.end ?? "") || (d.start ?? "") >= (d.end ?? "")));
    if (bad) return invalid({ week: [`${bad.day}: the end must be after the start, as HH:MM`] });
    b.week.forEach((d, i) => {
      const o = ORG.week[i];
      if (JSON.stringify(o) !== JSON.stringify(d)) audit(who(req.user!), "Working week changed", `Organisation · ${d.day}`, o.working ? `${o.start} to ${o.end}` : "Not working", d.working ? `${d.start} to ${d.end}` : "Not working", null, "Settings");
    });
    ORG.week = b.week;
  }
  if (b.trading_name) ORG.trading_name = b.trading_name;
  return ok(ORG);
});

const ROLE_OF = (k: string) => (SIGN_INS[k]?.view === "ceo" ? "CEO" : SIGN_INS[k]?.view === "operations" ? "Operations" : ["amara", "blessing"].includes(k) ? "Finance" : PEOPLE.some((p) => p.manager === k) ? "Manager" : "Staff");

/* ── Users (Settings · Users), as packages/contract/schemas/users.js sends them ── */
/** The seeded roles (seeds/reference/0101), most senior first. */
const ACCESS_ROLES: Array<{ code: string; name: string; description: string }> = [
  { code: "implementation", name: "Implementation Team", description: "Full access for the build team until handover." },
  { code: "operations_people", name: "Operations & People", description: "People, HR and operations across every module." },
  { code: "management", name: "Management", description: "Organisation-wide oversight and approvals." },
  { code: "head_of_department", name: "Head of Department", description: "Runs a department and approves for it." },
  { code: "administrator", name: "System Administrator", description: "Settings, users and roles." },
  { code: "manager", name: "Line Manager", description: "Manages the people who report to them." },
  { code: "employee", name: "Staff", description: "Their own work and records." },
];
const ROLE_CODE: Record<string, string> = { CEO: "management", Operations: "operations_people", Finance: "management", Manager: "manager", Staff: "employee" };
const roleRef = (code: string) => {
  const r = ACCESS_ROLES.find((x) => x.code === code)!;
  return { code: r.code, name: r.name };
};
type MockUser = Omit<UserRow, "two_step"> & { role: string; mfa: boolean };
const USERS: MockUser[] = PEOPLE.slice(0, 22).map((p, i) => ({
  user_id: sid(`user:${p.user_key}`),
  employee_id: p.employee_id,
  display_name: p.display_name,
  email: p.work_email,
  job_title: p.job_title,
  department: p.department,
  roles: [roleRef(ROLE_CODE[ROLE_OF(p.user_key)])],
  is_ceo: p.user_key === "ifeoma",
  status: p.status === "suspended" ? "suspended" : "active",
  last_seen_at: p.status === "suspended" ? at(30, "10:00") : at(i % 4 === 0 ? 0 : i % 4, `${String(8 + (i % 9)).padStart(2, "0")}:${String((i * 7) % 60).padStart(2, "0")}`),
  created_at: at(40 - i, "09:00"),
  role: ROLE_OF(p.user_key),
  mfa: ["ifeoma", "cynthia", "amara"].includes(p.user_key),
}));
const out = (u: MockUser): UserRow => {
  const { role: _role, mfa, ...row } = u;
  void _role;
  // The demonstration accounts' two-step is the security mock's, which My Security changes.
  const key = u.email.split("@")[0];
  return { ...row, two_step: SIGN_INS[key] ? waysOf(key).twoStep.on : mfa };
};
const userOf = (id: string) => USERS.find((x) => x.user_id === id);
const settingsEditor = (u: string) => admin(u);

route("GET /api/v1/users/summary", () =>
  ok({
    users: USERS.length,
    active: USERS.filter((u) => u.status === "active").length,
    invited: USERS.filter((u) => u.status === "invited").length,
    suspended: USERS.filter((u) => u.status === "suspended").length,
    signed_in_now: USERS.filter((u) => u.status === "active" && u.last_seen_at && Date.now() - new Date(u.last_seen_at).getTime() < 2 * 3600000).length,
    by_role: ACCESS_ROLES.map((r) => ({ code: r.code, name: r.name, users: USERS.filter((u) => u.status === "active" && u.roles.some((x) => x.code === r.code)).length })),
  }),
);
route("GET /api/v1/users", (req) =>
  paged(
    USERS.map(out),
    req,
    { search: (u) => [u.display_name, u.email, u.job_title], filters: { status: (u, v) => u.status === v, role: (u, v) => u.roles.some((r) => r.code === v) } },
  ),
);
route("GET /api/v1/users/candidates", (req) =>
  paged(
    PEOPLE.filter((p) => !USERS.some((u) => u.employee_id === p.employee_id)).map((p) => ({ employee_id: p.employee_id, display_name: p.display_name, email: p.work_email, job_title: p.job_title, department: p.department })),
    req,
    { search: (c) => [c.display_name, c.email, c.job_title] },
  ),
);
route("GET /api/v1/users/:id", (req) => {
  const u = userOf(req.params.id);
  return u ? ok(out(u)) : notFound();
});
route("POST /api/v1/users", (req) => {
  if (!settingsEditor(req.user!)) return fail(403, "PERMISSION_DENIED", "You do not have access to this");
  const b = req.body as { employee_id?: string; role_codes?: string[] };
  const p = byId(b.employee_id);
  if (!p) return invalid({ employee_id: ["Pick the employee"] });
  if (USERS.some((u) => u.employee_id === p.employee_id)) return fail(409, "LOGIN_EXISTS", "This employee already has a login.");
  const codes = (b.role_codes ?? []).filter((c) => ACCESS_ROLES.some((r) => r.code === c));
  if (!codes.length) return invalid({ role_codes: ["Pick a role"] });
  const u: MockUser = { user_id: sid(`user:${p.user_key}`), employee_id: p.employee_id, display_name: p.display_name, email: p.work_email, job_title: p.job_title, department: p.department, roles: codes.map(roleRef), is_ceo: false, status: "invited", last_seen_at: null, created_at: new Date().toISOString(), role: "Staff", mfa: false };
  USERS.unshift(u);
  audit(who(req.user!), "Invitation sent", `User · ${p.display_name}`, null, u.roles.map((r) => r.name).join(", "), "Link valid 72 hours", "Settings");
  return created(out(u));
});
const act = (path: string, fn: (u: MockUser, body: Record<string, unknown>, actor: string) => ReturnType<typeof ok>) =>
  route(path, (req) => {
    if (!settingsEditor(req.user!)) return fail(403, "PERMISSION_DENIED", "You do not have access to this");
    const u = userOf(req.params.id);
    if (!u) return notFound();
    return fn(u, req.body, req.user!);
  });
act("POST /api/v1/users/:id/roles", (u, body, actor) => {
  if (u.employee_id === byKey(actor)!.employee_id) return fail(422, "NOT_ON_YOURSELF", "You cannot change the roles of your own login here.");
  const codes = ((body.role_codes as string[] | undefined) ?? []).filter((c) => ACCESS_ROLES.some((r) => r.code === c));
  if (!codes.length) return invalid({ role_codes: ["Pick a role"] });
  audit(who(actor), "Roles changed", `User · ${u.display_name}`, u.roles.map((r) => r.name).join(", "), codes.map((c) => roleRef(c).name).join(", "), null, "Settings");
  u.roles = codes.map(roleRef);
  return ok(out(u));
});
act("POST /api/v1/users/:id/suspend", (u, body, actor) => {
  if (u.employee_id === byKey(actor)!.employee_id) return fail(422, "NOT_ON_YOURSELF", "You cannot suspend your own login here.");
  const reason = String(body.reason ?? "").trim();
  if (reason.length < 6) return invalid({ reason: ["At least 6 characters"] });
  audit(who(actor), "Login suspended", `User · ${u.display_name}`, "Active", "Suspended", reason, "Settings");
  u.status = "suspended";
  return ok(out(u));
});
act("POST /api/v1/users/:id/reactivate", (u, _b, actor) => {
  audit(who(actor), "Login reactivated", `User · ${u.display_name}`, "Suspended", "Active", null, "Settings");
  u.status = u.last_seen_at ? "active" : "invited";
  return ok(out(u));
});
act("POST /api/v1/users/:id/invite", (u) => (u.status === "invited" ? ok({ sent: true as const, email: u.email }) : fail(422, "ALREADY_ACTIVE", "This person has already chosen a password.")));
act("POST /api/v1/users/:id/reset-link", (u) => (u.status === "suspended" ? fail(422, "NOT_ACTIVE", "Reactivate this login before sending a link.") : ok({ sent: true as const, email: u.email })));
act("POST /api/v1/users/:id/end-sessions", () => ok({ ended: 2 }));
act("POST /api/v1/users/:id/reset-two-step", (u, _b, actor) => {
  if (u.employee_id === byKey(actor)!.employee_id) return fail(422, "NOT_ON_YOURSELF", "Use My Security for your own two-step sign-in.");
  const key = u.email.split("@")[0];
  if (!out(u).two_step) return fail(422, "TWO_STEP_OFF", "Two-step sign-in is not on for this login.");
  if (SIGN_INS[key]) Object.assign(waysOf(key).twoStep, { on: false, since: null, codesLeft: 0, trustedUntil: 0 });
  u.mfa = false;
  audit(who(actor), "Two-step reset", `User · ${u.display_name}`, "On", "Off", "Sessions ended", "Settings");
  return ok(out(u));
});
route("GET /api/v1/access/roles", (req) =>
  paged(
    ACCESS_ROLES.map((r) => ({ role_id: sid(`role:${r.code}`), code: r.code, name: r.name, description: r.description, users: USERS.filter((u) => u.status === "active" && u.roles.some((x) => x.code === r.code)).length })),
    req,
    { search: (r) => [r.name, r.code] },
  ),
);

/* ── Roles: module → action → record scope → field (MILESTONES §14; no entity layer, A2) ── */
const ALL_ACTS: RoleAction[] = ["view", "create", "edit", "delete", "approve", "export"];
const CATALOGUE: AccessCatalogue = {
  modules: [
    ["home", "Home", ["view", "export"], true], ["workspace", "My Workspace", ["view", "create", "edit", "delete"], true], ["ess", "Employee Self-Service", ["view", "create", "edit"], true],
    ["community", "Staff Community", ["view", "create", "edit", "delete"], false], ["mailbox", "Mailbox", ["view", "create", "delete"], true], ["people", "People", ALL_ACTS, true],
    ["performance", "Performance", ALL_ACTS, true], ["queries", "Queries & Sanctions", ALL_ACTS, true], ["recruitment", "Recruitment", ALL_ACTS, true], ["payroll", "Payroll", ALL_ACTS, true],
    ["partnerships", "Partnerships", ALL_ACTS, true], ["expenses", "Expenses", ALL_ACTS, true], ["knowledge", "Knowledge Hub", ["view", "create", "edit", "delete", "approve"], false],
    ["praxis_ai", "Praxis AI", ["view"], false], ["settings", "Settings", ["view", "edit", "export"], false],
  ].map(([key, label, actions, scoped]) => ({ key: key as string, label: label as string, actions: actions as RoleAction[], scoped: scoped as boolean })),
  fields: [
    { key: "salary", label: "Salary and Pay", help: "Gross, net, allowances and payslips of other people" },
    { key: "bank", label: "Bank Details", help: "Account numbers and bank names" },
    { key: "query_history", label: "Query History", help: "Queries, cautions and sanctions on a person's record" },
  ],
};
const g = (module: string, actions: RoleAction[], scope: RecordScope = "all"): RoleGrant => ({ module, actions, scope });
const every = (scope: RecordScope = "all") => CATALOGUE.modules.map((m) => g(m.key, m.actions, m.scoped ? scope : "all"));
const BASE = (scope: RecordScope): RoleGrant[] => [g("home", ["view"], scope), g("workspace", ["view", "create", "edit"], "own"), g("ess", ["view", "create", "edit"], "own"), g("community", ["view", "create"]), g("mailbox", ["view", "create", "delete"], "own"), g("knowledge", ["view"]), g("praxis_ai", ["view"])];
type Def = Omit<RoleDetail, "users">;
const def = (name: string, description: string, grants: RoleGrant[], visible_fields: string[], locked = false): Def => ({ role_id: sid(`role:${name}`), name, description, system: true, locked, grants, visible_fields });
const ROLE_DEFS: Def[] = [
  def("CEO", "Everything, everywhere. Final approver.", every(), ["salary", "bank", "query_history"], true),
  def("Operations", "Runs the company day to day: people, payroll, expenses and settings.", every(), ["salary", "bank", "query_history"]),
  def("Finance", "Payroll, expenses and budgets across the company.", [...BASE("own"), g("people", ["view"]), g("payroll", ["view", "edit", "approve", "export"]), g("expenses", ["view", "approve", "export"])], ["salary", "bank"]),
  def("Manager", "Their own team: attendance, leave, KPIs and expense approvals.", [...BASE("team"), g("people", ["view"], "team"), g("performance", ["view", "create", "edit", "approve"], "team"), g("queries", ["view", "create"], "team"), g("expenses", ["view", "create", "approve"], "team"), g("recruitment", ["view"], "own")], []),
  def("Staff", "Their own record, their own work.", [...BASE("own"), g("performance", ["view"], "own"), g("expenses", ["view", "create"], "own")], []),
];
const usersOf = (name: string) => USERS.filter((u) => u.role === name).length;
const detail = (d: Def): RoleDetail => ({ ...d, users: usersOf(d.name) });
const row = (d: Def): Role => {
  const scopes = [...new Set(d.grants.filter((x) => CATALOGUE.modules.find((m) => m.key === x.module)?.scoped).map((x) => x.scope))];
  const scope = scopes.length === 1 ? (({ all: "All", team: "Team", own: "Own" }) as const)[scopes[0]] : "Mixed";
  const n = d.visible_fields.length;
  return { role_id: d.role_id, name: d.name, users: usersOf(d.name), modules: d.grants.filter((x) => x.actions.includes("view")).length, scope, sensitive: n === 0 ? "Masked" : n === CATALOGUE.fields.length ? "Visible" : "Partly", system: d.system };
};
const ACT_LABEL: Record<RoleAction, string> = { view: "View", create: "create", edit: "edit", delete: "delete", approve: "approve", export: "export" };
const describe = (d: Def) => d.grants.map((x) => `${x.module}:${x.actions.join("/")}@${x.scope}`).join(" ") + ` fields:${d.visible_fields.join("/") || "none"}`;

function checkRole(b: Partial<RoleBody>, self: Def | null): Record<string, string[]> | null {
  const e: Record<string, string[]> = {};
  const name = String(b.name ?? "").trim();
  if (name.length < 2 || name.length > 40) e.name = ["Between 2 and 40 characters"];
  else if (ROLE_DEFS.some((r) => r !== self && r.name.toLowerCase() === name.toLowerCase())) e.name = ["Another role already has this name"];
  else if (self?.system && name !== self.name) e.name = ["A built-in role keeps its name"];
  const grants = Array.isArray(b.grants) ? b.grants : [];
  for (const x of grants) {
    const m = CATALOGUE.modules.find((c) => c.key === x.module);
    if (!m) { e.grants = [`Unknown module ${x.module}`]; break; }
    if (x.actions.some((a) => !m.actions.includes(a))) { e.grants = [`${m.label} does not offer that action`]; break; }
    if (x.actions.length && !x.actions.includes("view")) { e.grants = [`${m.label}: every other action needs View`]; break; }
    if (!["all", "team", "own"].includes(x.scope)) { e.grants = [`${m.label}: pick a record scope`]; break; }
  }
  if (!e.grants && !grants.some((x) => x.actions.includes("view"))) e.grants = ["Grant at least one module"];
  if ((b.visible_fields ?? []).some((f) => !CATALOGUE.fields.some((c) => c.key === f))) e.visible_fields = ["Unknown field"];
  return Object.keys(e).length ? e : null;
}
const clean = (b: RoleBody): Pick<Def, "name" | "description" | "grants" | "visible_fields"> => ({
  name: b.name.trim(),
  description: String(b.description ?? "").trim(),
  grants: b.grants.filter((x) => x.actions.length).map((x) => ({ module: x.module, actions: ALL_ACTS.filter((a) => x.actions.includes(a)), scope: CATALOGUE.modules.find((m) => m.key === x.module)!.scoped ? x.scope : "all" })),
  visible_fields: CATALOGUE.fields.map((f) => f.key).filter((k) => (b.visible_fields ?? []).includes(k)),
});

route("GET /api/v1/settings/roles", (req) => paged(ROLE_DEFS.map(row), req, { search: (r) => [r.name] }));
route("GET /api/v1/settings/roles/catalogue", () => ok(CATALOGUE));
route("GET /api/v1/settings/roles/matrix", () =>
  ok({
    roles: ROLE_DEFS.map((r) => r.name),
    rows: CATALOGUE.modules.map((m) => ({
      module: m.label,
      cells: ROLE_DEFS.map((r) => {
        const x = r.grants.find((y) => y.module === m.key);
        if (!x?.actions.length) return "None";
        const acts = x.actions.map((a, i) => (i === 0 ? ACT_LABEL[a][0].toUpperCase() + ACT_LABEL[a].slice(1) : ACT_LABEL[a])).join(", ");
        return m.scoped && x.scope !== "all" ? `${acts} · ${x.scope === "team" ? "Team" : "Own"}` : acts;
      }),
    })),
  }),
);
route("GET /api/v1/settings/roles/:id", (req) => {
  const d = ROLE_DEFS.find((r) => r.role_id === req.params.id);
  return d ? ok(detail(d)) : notFound();
});
route("POST /api/v1/settings/roles", (req) => {
  if (!admin(req.user!)) return fail(403, "FORBIDDEN", "Operations and the CEO manage roles.");
  const b = req.body as unknown as RoleBody;
  const bad = checkRole(b, null);
  if (bad) return invalid(bad);
  const d: Def = { role_id: sid(`role:${b.name.trim()}:${Date.now()}`), system: false, locked: false, ...clean(b) };
  ROLE_DEFS.push(d);
  audit(who(req.user!), "Role created", `Role · ${d.name}`, null, describe(d), null, "Settings");
  return created(detail(d));
});
route("PUT /api/v1/settings/roles/:id", (req) => {
  if (!admin(req.user!)) return fail(403, "FORBIDDEN", "Operations and the CEO manage roles.");
  const d = ROLE_DEFS.find((r) => r.role_id === req.params.id);
  if (!d) return notFound();
  if (d.locked) return fail(409, "LOCKED", "The CEO role holds every permission and cannot be changed.");
  const b = req.body as unknown as RoleBody;
  const bad = checkRole(b, d);
  if (bad) return invalid(bad);
  const before = describe(d);
  const next = clean(b);
  if (next.name !== d.name) USERS.filter((u) => u.role === d.name).forEach((u) => (u.role = next.name));
  Object.assign(d, next);
  audit(who(req.user!), "Role changed", `Role · ${d.name}`, before, describe(d), null, "Settings");
  return ok(detail(d));
});
route("DELETE /api/v1/settings/roles/:id", (req) => {
  if (!admin(req.user!)) return fail(403, "FORBIDDEN", "Operations and the CEO manage roles.");
  const i = ROLE_DEFS.findIndex((r) => r.role_id === req.params.id);
  if (i < 0) return notFound();
  const d = ROLE_DEFS[i];
  if (d.system) return fail(409, "SYSTEM_ROLE", "A built-in role cannot be deleted.");
  const n = usersOf(d.name);
  if (n) return fail(409, "ROLE_IN_USE", `${n} ${n === 1 ? "user holds" : "users hold"} this role. Move them to another role first.`);
  ROLE_DEFS.splice(i, 1);
  audit(who(req.user!), "Role deleted", `Role · ${d.name}`, describe(d), null, null, "Settings");
  return noContent();
});

const HIER: Hierarchy[] = [
  ["Expense Request", "Every request, whatever the amount.", ["Requester", "Line manager", "Operations", "Requisition", "CEO", "Disbursed"], "Any expense request", S("ok", "Active")],
  ["Leave request", "Requester, line manager. One step.", ["Requester", "Line manager"], "Any leave request", S("ok", "Active")],
  ["Monthly targets", "Managers, COO, Operations, CEO. Binding on CEO approval.", ["Managers set", "COO review", "Operations review", "CEO approval"], "A departmental target is submitted", S("ok", "Active")],
  ["Payroll run", "Operations, then the CEO. One step.", ["Operations", "CEO"], "A run is submitted", S("warn", "Approver to confirm")],
  ["Work location request", "Line manager recommends, People decides.", ["Employee", "Line manager", "People"], "A temporary home or exception is requested", S("ok", "Active")],
  ["Consequence chain", "Query, caution, warning, suspension, suspension without pay, dismissal.", ["Query", "Caution", "Warning", "Suspension", "Suspension without pay", "Dismissal"], "A query is decided", S("ok", "Active")],
].map((h, i) => ({ hierarchy_id: sid(`hier:${i}`), name: h[0] as string, description: h[1] as string, steps: h[2] as string[], trigger: h[3] as string, deputies: "Each step can name a deputy for leave", ageing: "An alert at 3 days, escalation at 7", status: h[4] as Status }));
route("GET /api/v1/settings/approvals/summary", () => ok({ hierarchies: HIER.length, active: HIER.filter((h) => h.status.tone === "ok").length, awaiting: HIER.filter((h) => h.status.tone !== "ok").length, longest: Math.max(...HIER.map((h) => h.steps.length - 1)) }));
route("GET /api/v1/settings/approvals", (req) => paged(HIER, req, { search: (h) => [h.name, h.description] }));
route("PUT /api/v1/settings/approvals/:id/steps", (req) => {
  if (!admin(req.user!)) return fail(403, "FORBIDDEN", "Operations and the CEO change hierarchies.");
  const h = HIER.find((x) => x.hierarchy_id === req.params.id);
  if (!h) return notFound();
  const steps = ((req.body.steps as string[]) ?? []).map((s) => String(s).trim()).filter(Boolean);
  if (steps.length < 2) return invalid({ steps: ["A hierarchy needs at least two steps"] });
  if (new Set(steps).size !== steps.length) return invalid({ steps: ["Each step appears once"] });
  audit(who(req.user!), "Hierarchy changed", `Approvals · ${h.name}`, h.steps.join(" → "), steps.join(" → "), "In-flight requests keep their chain", "Settings");
  h.steps = steps;
  return ok(h);
});

const PREFS = new Map<string, NotificationPref[]>();
const prefsOf = (u: string) => {
  let p = PREFS.get(u);
  if (!p) {
    p = [["approvals", "Approvals pending", "When something is waiting on you", true, true, false], ["query", "Query raised against you", "You are always told. There is no setting for it", true, true, true], ["payslip", "Payslip ready", "When a run is locked", true, true, false], ["task", "Task assigned to you", "", true, false, false], ["community", "Community messages", "Keep these in app only", true, false, false], ["announcement", "Announcements", "", true, true, false], ["recognition", "Recognition received", "", true, false, false], ["celebration", "Birthday and anniversary", "", true, false, false], ["alert_cleared", "Alert cleared", "", false, false, false]].map(([key, label, help, in_app, email, locked]) => ({ key: key as string, label: label as string, help: help as string, in_app: in_app as boolean, email: email as boolean, locked: locked as boolean }));
    PREFS.set(u, p);
  }
  return p;
};
route("GET /api/v1/settings/notifications", (req) => ok(prefsOf(req.user!)));
route("PATCH /api/v1/settings/notifications", (req) => {
  const p = prefsOf(req.user!);
  for (const [k, v] of Object.entries(req.body as Record<string, { in_app: boolean; email: boolean }>)) {
    const x = p.find((y) => y.key === k);
    if (!x) return invalid({ [k]: ["Not a notification category"] });
    if (x.locked && (!v.in_app || !v.email)) return fail(409, "LOCKED", `${x.label} cannot be switched off.`);
    x.in_app = !!v.in_app;
    x.email = !!v.email;
  }
  return ok(p);
});

let THEME: "system" | "light" | "dark" = "system";
const APPEAR = () => ({ theme_default: THEME, palette: [["Primary Yellow", "--primary"], ["Yellow Tint", "--accent"], ["City Green", "--secondary"], ["Deep Green", "--sidebar"]].map(([name, token]) => ({ name, token })), dark: [["Background", "--background", "Deep Green, darkened"], ["Card", "--card", "Deep Green exactly"], ["Text", "--foreground", "Clears AA against the background"], ["Muted text", "--muted-foreground", "Clears AA"], ["Primary", "--primary", "The brand yellow, unchanged"]].map(([name, token, note]) => ({ name, token, note })), typeface: "Geist" });
route("GET /api/v1/settings/appearance", () => ok(APPEAR()));
route("PATCH /api/v1/settings/appearance", (req) => {
  if (!admin(req.user!)) return fail(403, "FORBIDDEN", "Operations and the CEO set the default theme.");
  const t = String(req.body.theme_default);
  if (!["system", "light", "dark"].includes(t)) return invalid({ theme_default: ["Light, dark or follow the device"] });
  audit(who(req.user!), "Default theme changed", "Appearance", THEME, t, null, "Settings");
  THEME = t as typeof THEME;
  return ok(APPEAR());
});

const NUM = [["Expense Request", "EXP", "0123"], ["Requisition", "REQ", "0043"], ["Offer letter", "OFF", "0020"], ["Employment contract", "CON", "0017"], ["Proposal", "PRO", "0031"], ["MOU", "MOU", "0012"], ["Query", "QRY", "0016"]].map(([document, prefix, next]) => ({ key: prefix, document, prefix, format: `${prefix}-0000`, next }));
route("GET /api/v1/settings/numbering/summary", () => ok({ types: NUM.length, templates: 9, issued_this_year: 118, signed: 32 }));
route("GET /api/v1/settings/numbering", (req) => paged(NUM, req, { search: (n) => [n.document, n.prefix] }));

route("GET /api/v1/settings/integrations", () =>
  ok({
    items: [["smtp", "SMTP, mycityapp.io", "Outbound mail for notifications and offer letters.", S("ok", "Connected")], ["imap", "IMAP mailbox", "Staff mailboxes on the MyCity domain. No Google, no Microsoft.", S("ok", "Connected")], ["model", "Gemini", "The model behind Praxis AI. Spend capped monthly.", S("ok", "Connected")], ["careers", "Careers page", "Vacancies publish to go.mycityapp.io.", S("ok", "Connected")], ["sheets", "Google Sheets import", "Download as xlsx and import. No API connection needed.", S("neutral", "Manual")], ["payments", "Payment gateway", "Not in scope. Disbursement is logged, not executed.", S("neutral", "Not connected")]].map(([key, name, text, status]) => ({ key: key as string, name: name as string, text: text as string, status: status as Status })),
    health: [["SMTP", "09:14", 284], ["IMAP", "09:21", 1842], ["Gemini", "09:12", 84], ["Careers page", "08:02", 612]].map(([service, t, volume]) => ({ service: service as string, last_call: at(0, t as string), volume_7d: volume as number, failures: 0, status: S("ok", "Healthy") })),
  }),
);

const RULES = [["mfa_privileged", "Require MFA for CEO, Operations and Finance", true], ["remember_devices", "Remember devices for 30 days", true], ["idle_8h", "Sign out after 8 hours idle", true], ["new_countries", "Allow sign in from new countries", false]].map(([key, label, on]) => ({ key: key as string, label: label as string, on: on as boolean }));
const SESSIONS: Session[] = [["cynthia", "MacBook · Chrome", "07:58"], ["tolu", "iPhone · Safari", "07:52"], ["seyi", "Pixel 7 · Chrome", "08:58"], ["ngozi", "Windows · Edge", "08:31"], ["ifeoma", "iPad · Safari", "07:15"]].map(([u, device, t]) => ({ session_id: sid(`sess:${u}`), person: refKey(u), device, started_at: at(0, t) }));
const FAILED: FailedLogin[] = [[1, "22:41", "bashir@mycityapp.io", "Lagos, Nigeria", "Wrong password"], [1, "22:40", "bashir@mycityapp.io", "Lagos, Nigeria", "Wrong password"], [3, "11:02", "unknown@example.com", "Unknown", "No such user"], [5, "08:14", "emeka@mycityapp.io", "Lagos, Nigeria", "Wrong password"]].map((f, i) => ({ attempt_id: sid(`fail:${i}`), at: at(f[0] as number, f[1] as string), email: f[2] as string, place: f[3] as string, outcome: S("err", f[4] as string) }));
const sec = () => ({ active_sessions: SESSIONS.length + 14, mfa_enrolled: USERS.filter((u) => u.mfa).length, users: USERS.length, failed_7d: FAILED.length, devices: 31, rules: RULES });
route("GET /api/v1/settings/security", () => ok(sec()));
route("PATCH /api/v1/settings/security", (req) => {
  if (!admin(req.user!)) return fail(403, "FORBIDDEN", "Operations and the CEO set security policy.");
  for (const [k, v] of Object.entries(req.body as Record<string, boolean>)) {
    const r = RULES.find((x) => x.key === k);
    if (!r) return invalid({ [k]: ["Not a security setting"] });
    audit(who(req.user!), "Security setting changed", r.label, r.on ? "On" : "Off", v ? "On" : "Off", null, "Settings");
    r.on = !!v;
  }
  return ok(sec());
});
route("GET /api/v1/settings/security/sessions", (req) => paged(SESSIONS, req, { search: (s) => [s.person.display_name, s.device] }));
route("POST /api/v1/settings/security/sessions/:id/end", (req) => {
  const i = SESSIONS.findIndex((s) => s.session_id === req.params.id);
  if (i < 0) return notFound();
  audit(who(req.user!), "Session ended", `Session · ${SESSIONS[i].person.display_name}`, SESSIONS[i].device, null, "Takes effect on the next request", "Settings");
  SESSIONS.splice(i, 1);
  return noContent();
});
route("GET /api/v1/settings/security/failed-logins", (req) => paged(FAILED, req, { search: (f) => [f.email, f.place] }));

route("GET /api/v1/audit/summary", () => {
  const mods = [...new Set(AUDIT.map((a) => a.module))];
  const month = [["People and attendance", 1840], ["Expenses", 882], ["Performance", 571], ["Queries & Sanctions", 404], ["Partnerships", 349], ["Payroll", 202], ["Settings", 74]] as const;
  return ok({ today: 184 + AUDIT.filter((a) => a.at.slice(0, 10) === isoDaysAgo(0)).length, this_month: 4912, modules: mods, by_module: month.map(([label, n], i) => ({ label, pct: Math.round((n * 100) / 1840), value: n.toLocaleString("en-NG"), ...(i === month.length - 1 ? { emphasis: "brand" as const } : {}) })), retention: "7 years" });
});
route("GET /api/v1/audit", (req) => (admin(req.user!) ? paged(AUDIT, req, { search: (a) => [a.actor, a.action, a.entity, a.reason], filters: { module: (a, v) => a.module === v } }) : fail(403, "FORBIDDEN", "The audit log is for Operations and the CEO.")));
