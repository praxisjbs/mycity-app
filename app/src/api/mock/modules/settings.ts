import type { AccessCatalogue, AuditEntry, FailedSignIn, Holiday, LiveSession, NumberingScheme, Organisation, RoleDetail, RoleGrant, RoleRow, RoleSave, UserRow, WorkingDay } from "@mycity/contract/contract.gen.ts";
import { at, created, fail, invalid, isoDaysAgo, noContent, notFound, ok, paged, route, sid, type Req } from "../core";
import { exportFile } from "./shared";
import { CAPABILITIES, ROLE_CAPABILITIES } from "../data/access";
import { byId, byKey, PEOPLE, SIGN_INS } from "../data/people";
import { AUDIT, audit } from "../data/audit";
import { stale, waysOf } from "./security";
import appearanceSchemas from "@mycity/contract/schemas/appearance.js";
import { appearanceView, restorePrevious, updateAppearance } from "../data/appearance";
import { ON_UPLOAD } from "../uploads";
import { pickAnAddress, placeOf } from "./maps";

const admin = (u: string) => ["operations", "ceo"].includes(SIGN_INS[u]?.view ?? "");
const who = (u: string) => byKey(u)!.display_name;

/* ── Organisation: the profile, the working week (A22), holidays (entered on screen, A26) ── */
const PROFILE_KEYS = ["legal_name", "trading_name", "registration_number", "tax_id", "phone", "email", "website"] as const;
const ORG: Organisation = { legal_name: "MyCity App Ltd", trading_name: "MyCityApp", registration_number: null, tax_id: null, address: null, address_place: null, phone: null, email: "hello@mycityapp.io", website: "https://mycityapp.io", logo: null, logo_white: null, icon: null, currency: "NGN", time_zone: "Africa/Lagos" };
route("GET /api/v1/settings/organisation", () => ok(ORG));

/* The brand files (foundation.md §6.11): an upload lands through the mock upload engine, which tells us here. */
const BRAND_SLOTS = ["logo", "logo_white", "icon"] as const;
ON_UPLOAD.push((endpoint, doc) => {
  const slot = /\/settings\/organisation\/brand\/(logo_white|logo|icon)$/.exec(endpoint)?.[1] as (typeof BRAND_SLOTS)[number] | undefined;
  if (slot) ORG[slot] = doc;
});
route("DELETE /api/v1/settings/organisation/brand/:slot", (req) => {
  if (!admin(req.user!)) return fail(403, "PERMISSION_DENIED", "You do not have access to this");
  const slot = req.params.slot as (typeof BRAND_SLOTS)[number];
  if (!BRAND_SLOTS.includes(slot)) return invalid({ slot: ["Choose one"] });
  ORG[slot] = null;
  return ok(ORG);
});
route("PATCH /api/v1/settings/organisation", (req) => {
  if (!admin(req.user!)) return fail(403, "PERMISSION_DENIED", "You do not have access to this");
  const b = req.body as Partial<Record<(typeof PROFILE_KEYS)[number], string | null>> & { address?: unknown };
  // The address is picked, never typed (F27): a place, or null to clear it.
  const kept = b.address ? placeOf(b.address) : null;
  if (b.address && !kept) return pickAnAddress("address");
  if (b.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email)) return invalid({ email: ["Check the email"] });
  if (b.website && !/^https?:\/\//.test(b.website)) return invalid({ website: ["Not a web address"] });
  for (const k of PROFILE_KEYS) {
    if (b[k] === undefined) continue;
    const next = b[k] === "" ? null : b[k];
    if (next !== ORG[k]) audit(who(req.user!), "A setting was changed", `Organisation · ${k.replace(/_/g, " ")}`, ORG[k], next, null, "Settings");
    ORG[k] = next as never;
  }
  if (b.address !== undefined && (kept?.line ?? null) !== ORG.address) {
    audit(who(req.user!), "A setting was changed", "Organisation · address", ORG.address, kept?.line ?? null, null, "Settings");
  }
  if (b.address !== undefined) Object.assign(ORG, { address: kept?.line ?? null, address_place: kept?.view ?? null });
  return ok(ORG);
});

let WEEK: WorkingDay[] = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, is_working_day: weekday < 7, starts_at: weekday < 7 ? "09:00" : null, ends_at: weekday === 7 ? null : weekday === 6 ? "15:00" : "17:00" }));
route("GET /api/v1/settings/working-week", () => ok({ days: WEEK }));
route("PUT /api/v1/settings/working-week", (req) => {
  if (!admin(req.user!)) return fail(403, "PERMISSION_DENIED", "You do not have access to this");
  const days = (req.body.days as WorkingDay[] | undefined) ?? [];
  if (days.length !== 7) return invalid({ days: ["Each day once"] });
  const bad = days.find((d) => d.is_working_day && (!d.starts_at || !d.ends_at || d.ends_at <= d.starts_at));
  if (bad) return invalid({ days: ["After the start"] });
  if (!days.some((d) => d.is_working_day)) return invalid({ days: ["Work at least one day"] });
  audit(who(req.user!), "A setting was changed", "Working week · Week", null, "Changed", null, "Settings");
  WEEK = days.map((d) => ({ ...d, starts_at: d.is_working_day ? d.starts_at : null, ends_at: d.is_working_day ? d.ends_at : null }));
  return ok({ days: WEEK });
});

const YEAR = new Date().getUTCFullYear();
/** Nigeria's holidays as seeds/reference/0448 seeds them: the moon-dated and weekend ones expected until confirmed. */
const HOLIDAYS: Holiday[] = (
  [
    ["01-01", "New Year's Day", false],
    ["03-20", "Eid-el-Fitr", true],
    ["03-23", "Eid-el-Fitr Holiday", true],
    ["04-03", "Good Friday", false],
    ["04-06", "Easter Monday", false],
    ["05-01", "Workers' Day", false],
    ["05-27", "Eid-el-Kabir", true],
    ["05-28", "Eid-el-Kabir Holiday", true],
    ["06-12", "Democracy Day", false],
    ["08-25", "Eid-el-Maulud", true],
    ["10-01", "Independence Day", false],
    ["12-25", "Christmas Day", false],
    ["12-26", "Boxing Day", false],
    ["12-28", "Boxing Day Holiday", true],
  ] as const
).map(([d, name, expected]) => ({ public_holiday_id: sid(`holiday:${d}`), holiday_date: `${YEAR}-${d}`, name, expected, created_at: at(30, "09:00") }));
const byDate = (a: Holiday, b: Holiday) => a.holiday_date.localeCompare(b.holiday_date);
route("GET /api/v1/settings/holidays", (req) => paged([...HOLIDAYS].sort(byDate), req, { search: (h) => [h.name], filters: { year: (h, v) => h.holiday_date.startsWith(v), sort: () => true } }));
const holidayBody = (req: Req) => {
  const date = String(req.body.holiday_date ?? "");
  const name = String(req.body.name ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: invalid({ holiday_date: ["Not a real date"] }) };
  if (!name) return { error: invalid({ name: ["Required"] }) };
  return { date, name };
};
route("POST /api/v1/settings/holidays", (req) => {
  if (!admin(req.user!)) return fail(403, "PERMISSION_DENIED", "You do not have access to this");
  const b = holidayBody(req);
  if (b.error) return b.error;
  if (HOLIDAYS.some((h) => h.holiday_date === b.date)) return fail(409, "HOLIDAY_EXISTS", "There is already a holiday on that date.", { holiday_date: ["Already a holiday"] });
  const h: Holiday = { public_holiday_id: sid(`holiday:${b.date}:${Date.now()}`), holiday_date: b.date!, name: b.name!, expected: false, created_at: new Date().toISOString() };
  HOLIDAYS.push(h);
  audit(who(req.user!), "A setting was changed", `Public holiday · ${h.name}`, null, h.holiday_date, null, "Settings");
  return created(h);
});
route("PATCH /api/v1/settings/holidays/:id", (req) => {
  if (!admin(req.user!)) return fail(403, "PERMISSION_DENIED", "You do not have access to this");
  const h = HOLIDAYS.find((x) => x.public_holiday_id === req.params.id);
  if (!h) return notFound();
  const b = holidayBody(req);
  if (b.error) return b.error;
  if (HOLIDAYS.some((x) => x !== h && x.holiday_date === b.date)) return fail(409, "HOLIDAY_EXISTS", "There is already a holiday on that date.", { holiday_date: ["Already a holiday"] });
  Object.assign(h, { holiday_date: b.date, name: b.name, expected: false });
  return ok(h);
});
route("DELETE /api/v1/settings/holidays/:id", (req) => {
  if (!admin(req.user!)) return fail(403, "PERMISSION_DENIED", "You do not have access to this");
  const i = HOLIDAYS.findIndex((x) => x.public_holiday_id === req.params.id);
  if (i < 0) return notFound();
  audit(who(req.user!), "A setting was changed", `Public holiday · ${HOLIDAYS[i].name}`, HOLIDAYS[i].holiday_date, null, null, "Settings");
  HOLIDAYS.splice(i, 1);
  return noContent();
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
type MockUser = Omit<UserRow, "two_step" | "photo_url"> & { role: string; mfa: boolean };
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
  return { ...row, two_step: SIGN_INS[key] ? waysOf(key).twoStep.on : mfa, photo_url: null };
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

/* ── Roles: module → action → record scope → field, and capabilities (MILESTONES §14; no entity layer, A2) ── */
type Action = RoleGrant["actions"][number];
type Scope = RoleGrant["scope"];
const ALL: Action[] = ["view", "create", "edit", "delete", "approve", "export"];
const MODULE_LIST: Array<[string, string, string, string]> = [
  ["home", "Home", "top", "Overview, team, alerts and reports"], ["workspace", "My Workspace", "top", "Today, tasks, calendar and analytics"], ["ess", "Employee Self-Service", "top", "Your own record, attendance, pay, leave and documents"],
  ["community", "Staff Community", "work", "Channels, direct messages and announcements"], ["mailbox", "Mailbox", "work", "Your work email"], ["people", "People", "people", "Employees, attendance, leave, devices and worksites"],
  ["performance", "Performance", "people", "Goals, targets, KPIs and reviews"], ["queries", "Queries & Sanctions", "people", "Queries, rules, sanctions and letter templates"], ["recruitment", "Recruitment", "people", "Vacancies through to onboarding"],
  ["payroll", "Payroll", "people", "Payroll runs, payslips, salary structure and statutory"], ["partnerships", "Partnerships", "business", "Pipeline, partners, leads, proposals and contracts"], ["expenses", "Expenses", "business", "Requests, approvals, requisitions, disbursements and budgets"],
  ["knowledge", "Knowledge Hub", "system", "Policies, SOPs, FAQs, training and announcements"], ["praxis_ai", "Praxis AI", "system", "The assistant, and AI controls"], ["settings", "Settings", "system", "Organisation, users, roles, approvals and system settings"],
];
const FIELDS = [["employee.salary", "Salary and pay"], ["employee.bank", "Bank details"], ["employee.personal", "Personal details"], ["employee.statutory", "Tax and pension numbers"]] as const;
const CATALOGUE: AccessCatalogue = {
  modules: MODULE_LIST.map(([key, label, area, description]) => ({ key, label, area, description, own_only: key === "ess" })),
  actions: ALL,
  scopes: ["all", "team", "own"],
  fields: FIELDS.map(([key, label]) => ({ key, label })),
  capabilities: CAPABILITIES,
};
const g = (module_key: string, actions: Action[], scope: Scope = "all"): RoleGrant => ({ module_key, actions, scope: module_key === "ess" ? "own" : scope });
const everything = (scope: Scope = "all") => MODULE_LIST.map(([k]) => g(k, ALL, k === "mailbox" ? "own" : scope));
const own = (mods: string[], acts: Action[] = ["view", "create", "edit"]) => mods.map((m) => g(m, acts, "own"));
const SENSITIVE = FIELDS.map(([k]) => k);
type MockRole = Omit<RoleDetail, "users" | "role_id">;
const role = (code: string, name: string, description: string, rank: number, home: RoleDetail["home_view"], grants: RoleGrant[], visible: string[]): MockRole => ({ code, name, description, rank, home_view: home, is_system: true, two_step_required: false, grants, visible_fields: visible as RoleDetail["visible_fields"], capabilities: [...(ROLE_CAPABILITIES[code] ?? [])] });
const CAPS = CAPABILITIES.map((c) => c.code);
const ROLES = new Map<string, MockRole>(
  [
    role("implementation", "Implementation Team", "Full access for the build team until handover.", 100, "operations", everything(), SENSITIVE),
    role("operations_people", "Operations & People", "People, HR and operations across every module.", 90, "operations", everything(), SENSITIVE),
    role("management", "Management", "Organisation-wide oversight and approvals.", 80, "operations", everything().map((x) => (x.module_key === "settings" ? g("settings", ["view", "export"]) : x)), SENSITIVE),
    role("head_of_department", "Head of Department", "Runs a department and approves for it.", 60, "partnerships", [...own(["ess", "community", "mailbox"]), g("home", ["view", "approve"], "team"), g("people", ["view", "approve"], "team"), g("partnerships", ["view", "create", "edit", "approve"], "team"), g("knowledge", ["view"])], []),
    role("administrator", "System Administrator", "Settings, users and roles.", 50, "staff", [...own(["home", "workspace", "ess", "community", "mailbox"]), g("knowledge", ["view"]), g("settings", ALL)], []),
    role("manager", "Line Manager", "Manages the people who report to them.", 40, "staff", [...own(["ess", "community", "mailbox"]), g("home", ["view"], "team"), g("people", ["view", "approve"], "team"), g("performance", ["view", "create", "edit", "approve"], "team"), g("knowledge", ["view"])], []),
    role("employee", "Staff", "Their own work and records.", 10, "staff", [...own(["home", "workspace", "ess", "community", "mailbox", "performance", "expenses"]), g("knowledge", ["view"])], []),
  ].map((r) => [sid(`role:${r.code}`), r]),
);
const holders = (code: string) => USERS.filter((u) => u.status === "active" && u.roles.some((r) => r.code === code)).length;
const detail = (id: string, r: MockRole): RoleDetail => ({ role_id: id, users: holders(r.code), ...r });
const rowOf = (id: string, r: MockRole): RoleRow => {
  const viewed = r.grants.filter((x) => x.actions.includes("view") && x.module_key !== "ess");
  const counts = { all: 0, team: 0, own: 0 };
  for (const x of viewed) counts[x.scope] += 1;
  const scope = viewed.length ? (["all", "team", "own"] as const).reduce((best, s) => (counts[s] > counts[best] ? s : best), "all" as Scope) : "none";
  return { role_id: id, code: r.code, name: r.name, description: r.description, is_system: r.is_system, two_step_required: r.two_step_required, users: holders(r.code), modules: r.grants.filter((x) => x.actions.includes("view")).length, scope, fields_visible: r.visible_fields.length };
};
const ordered = () => [...ROLES.entries()].sort(([, a], [, b]) => b.rank - a.rank || a.name.localeCompare(b.name));
const describe = (r: MockRole) => r.grants.map((x) => `${x.module_key} ${x.actions.join(", ")} · ${x.scope}`).join("; ");

function checkRole(b: RoleSave, self: MockRole | null): RawProblem | null {
  const name = String(b.name ?? "").trim();
  if (name.length < 2 || name.length > 40) return { status: 422, fields: { name: ["At least 2 characters"] } };
  if (ordered().some(([, r]) => r !== self && r.name.toLowerCase() === name.toLowerCase())) return { status: 409, fields: { name: ["Name already used"] } };
  if (self?.is_system && name !== self.name) return { status: 422, fields: { name: ["Built-in name stays"] } };
  const grants = (b.grants ?? []).filter((x) => x.actions.length);
  if (grants.some((x) => !x.actions.includes("view"))) return { status: 422, fields: { grants: ["Every action needs View"] } };
  if (!grants.length) return { status: 422, fields: { grants: ["Grant a module"] } };
  return null;
}
type RawProblem = { status: number; fields: Record<string, string[]> };
const refuse = (p: RawProblem) => (p.status === 409 ? fail(409, "ROLE_NAME_TAKEN", "Another role has this name.", p.fields) : invalid(p.fields));
const saved = (b: RoleSave, base: Pick<MockRole, "code" | "rank" | "is_system" | "two_step_required">): MockRole => ({
  ...base,
  name: b.name.trim(),
  description: b.description?.trim() || null,
  home_view: b.home_view ?? "staff",
  grants: b.grants.filter((x) => x.actions.length).map((x) => g(x.module_key, ALL.filter((a) => x.actions.includes(a)), x.scope)),
  visible_fields: SENSITIVE.filter((k) => b.visible_fields.includes(k as never)) as RoleDetail["visible_fields"],
  capabilities: CAPS.filter((c) => b.capabilities.includes(c)),
});

route("GET /api/v1/settings/roles", (req) => paged(ordered().map(([id, r]) => rowOf(id, r)), req, { search: (r) => [r.name, r.code], filters: { sort: () => true } }));
route("GET /api/v1/settings/roles/catalogue", () => ok(CATALOGUE));
route("GET /api/v1/settings/roles/matrix", () => {
  const roles = ordered();
  return ok({
    roles: roles.map(([id, r]) => ({ role_id: id, code: r.code, name: r.name, is_system: r.is_system })),
    rows: MODULE_LIST.map(([key, label]) => ({
      module_key: key,
      label,
      cells: roles.map(([id, r]) => {
        const x = r.grants.find((y) => y.module_key === key);
        return x ? { role_id: id, actions: x.actions, scope: x.scope } : { role_id: id, actions: [], scope: null };
      }),
    })),
  });
});
route("GET /api/v1/settings/roles/:id", (req) => {
  const r = ROLES.get(req.params.id);
  return r ? ok(detail(req.params.id, r)) : notFound();
});
route("POST /api/v1/settings/roles", (req) => {
  if (!admin(req.user!)) return fail(403, "PERMISSION_DENIED", "You do not have access to this");
  const b = req.body as unknown as RoleSave;
  const bad = checkRole(b, null);
  if (bad) return refuse(bad);
  const base = b.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "role";
  let code = base;
  for (let n = 2; [...ROLES.values()].some((r) => r.code === code); n += 1) code = `${base}_${n}`;
  const id = sid(`role:${code}:${Date.now()}`);
  const r = saved(b, { code, rank: 0, is_system: false, two_step_required: false });
  ROLES.set(id, r);
  audit(who(req.user!), "A role was created", `Role · ${r.name}`, null, describe(r), null, "Settings");
  return created(detail(id, r));
});
route("PUT /api/v1/settings/roles/:id", (req) => {
  if (!admin(req.user!)) return fail(403, "PERMISSION_DENIED", "You do not have access to this");
  const r = ROLES.get(req.params.id);
  if (!r) return notFound();
  const b = req.body as unknown as RoleSave;
  const bad = checkRole(b, r);
  if (bad) return refuse(bad);
  const next = saved(b, r);
  if (describe(next) !== describe(r)) audit(who(req.user!), "What a role grants was changed", `Role · ${r.name}`, describe(r), describe(next), null, "Settings");
  ROLES.set(req.params.id, next);
  return ok(detail(req.params.id, next));
});
route("DELETE /api/v1/settings/roles/:id", (req) => {
  if (!admin(req.user!)) return fail(403, "PERMISSION_DENIED", "You do not have access to this");
  const r = ROLES.get(req.params.id);
  if (!r) return notFound();
  if (r.is_system) return fail(409, "SYSTEM_ROLE", "A built-in role cannot be deleted.");
  const n = holders(r.code);
  if (n) return fail(409, "ROLE_IN_USE", `${n} ${n === 1 ? "person holds" : "people hold"} this role. Give them another role first.`);
  ROLES.delete(req.params.id);
  audit(who(req.user!), "A role was deleted", `Role · ${r.name}`, describe(r), null, null, "Settings");
  return noContent();
});

/* ── Appearance (foundation.md §6.15): the palette derived by the contract, as on the server ── */
route("GET /api/v1/settings/appearance", () => ok(appearanceView()));
route("PATCH /api/v1/settings/appearance", (req) => {
  if (!admin(req.user!)) return fail(403, "PERMISSION_DENIED", "You do not have access to this");
  const refused = stale(req.user!);
  if (refused) return refused;
  const parsed = appearanceSchemas.AppearancePatch.safeParse(req.body);
  if (!parsed.success) return invalid(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), [i.message]])));
  const before = appearanceView();
  const changed = updateAppearance(parsed.data, who(req.user!));
  if (changed.length) audit(who(req.user!), "Appearance changed", "Appearance", changed.map((k) => `${k}: ${JSON.stringify(k === "dark" ? before.dark.seeds : before[k as "fonts"])}`).join("; "), changed.join(", "), null, "Settings");
  return ok(appearanceView());
});
route("POST /api/v1/settings/appearance/restore", (req) => {
  if (!admin(req.user!)) return fail(403, "PERMISSION_DENIED", "You do not have access to this");
  const refused = stale(req.user!);
  if (refused) return refused;
  if (!restorePrevious(who(req.user!))) return fail(409, "NOTHING_TO_RESTORE", "There is no earlier palette");
  audit(who(req.user!), "Appearance changed", "Appearance", "Previous palette", "Restored", null, "Settings");
  return ok(appearanceView());
});

/* ── Numbering: a scheme per numbered document type (shared/numbering/schemes.js) ── */
const LABELS: Array<[NumberingScheme["doc_type"], string, string, number, string, NumberingScheme["reset"], number]> = [
  ["employee", "Staff Number", "", 5, "", "never", 18], ["document", "Document", "DOC", 4, "-", "never", 240], ["import_batch", "Import", "IMP", 4, "-", "never", 3],
  ["location_request", "Work Location Request", "WLR", 4, "-", "never", 5],
  ["field_assignment", "Field Assignment", "FA", 4, "-", "never", 3],
  ["query", "Query", "QRY", 4, "-", "never", 15], ["sanction", "Sanction", "SAN", 4, "-", "never", 4], ["letter", "Letter", "LTR", 4, "-", "never", 9],
  ["vacancy", "Vacancy", "VAC", 4, "-", "never", 6], ["offer", "Offer Letter", "OFF", 4, "-", "never", 19], ["contract", "Employment Contract", "CON", 4, "-", "never", 16],
  ["payroll_run", "Payroll Run", "PAY", 0, "-", "monthly", 1], ["payslip", "Payslip", "PAY", 4, "-", "monthly", 18], ["proposal", "Proposal", "PRO", 4, "-", "never", 30],
  ["mou", "MOU", "MOU", 4, "-", "never", 11], ["expense", "Expense Request", "EXP", 4, "-", "never", 122], ["requisition", "Requisition", "REQ", 4, "-", "never", 42], ["disbursement", "Disbursement", "DSB", 4, "-", "never", 37],
];
const period = (reset: NumberingScheme["reset"]) => {
  const d = isoDaysAgo(0);
  return reset === "never" ? "" : reset === "yearly" ? d.slice(0, 4) : d.slice(0, 7);
};
const nextOf = (s: Omit<NumberingScheme, "next">) => {
  const parts = [s.prefix];
  const p = period(s.reset);
  if (s.include_period && p) parts.push(p.replace("-", s.separator || "-"));
  if (s.padding > 0) parts.push(String(s.issued + 1).padStart(s.padding, "0"));
  return parts.filter((x, i) => x !== "" || i > 0).join(s.separator);
};
const SCHEMES: NumberingScheme[] = LABELS.map(([doc_type, label, prefix, padding, separator, reset, issued]) => {
  const base = { doc_type, label, prefix, padding, separator, reset, include_period: reset !== "never", issued, updated_at: at(20, "09:00") };
  return { ...base, next: nextOf(base) };
});
route("GET /api/v1/settings/numbering/summary", () => ok({ types: SCHEMES.length, issued: SCHEMES.reduce((a, x) => a + x.issued, 0), resetting: SCHEMES.filter((x) => x.reset !== "never").length }));
route("GET /api/v1/settings/numbering", (req) => paged(SCHEMES, req, { search: (n) => [n.label, n.prefix, n.doc_type], filters: { sort: () => true } }));
route("PUT /api/v1/settings/numbering/:doc_type", (req) => {
  if (!admin(req.user!)) return fail(403, "PERMISSION_DENIED", "You do not have access to this");
  const s = SCHEMES.find((x) => x.doc_type === req.params.doc_type);
  if (!s) return notFound();
  const b = req.body as Pick<NumberingScheme, "prefix" | "padding" | "separator" | "reset" | "include_period">;
  const prefix = String(b.prefix ?? "").toUpperCase();
  if (!/^[A-Z0-9]{0,8}$/.test(prefix)) return invalid({ prefix: ["Up to 8 letters"] });
  if (b.reset !== "never" && !b.include_period) return invalid({ include_period: ["Needed when it resets"] });
  if (!prefix && !(b.padding > 0)) return invalid({ padding: ["Add sequence digits"] });
  if (b.padding === 0 && !(b.include_period && b.reset !== "never")) return invalid({ padding: ["Add digits or period"] });
  const before = s.next;
  Object.assign(s, { prefix, padding: b.padding, separator: b.separator, reset: b.reset, include_period: b.include_period, updated_at: new Date().toISOString() });
  s.next = nextOf(s);
  audit(who(req.user!), "A setting was changed", `Numbering · ${s.label}`, before, s.next, null, "Settings");
  return ok(s);
});

/* ── Security: rules within the .env floor, two-step by role, failed sign-ins, live sessions ── */
const FLOOR = { session_max_age_min: 120, idle_lock_min: 30, password_min_length: 8 };
const RULES = { ...FLOOR };
const LIVE: LiveSession[] = (
  [["cynthia", "MacBook · Chrome", "07:58", "password_totp"], ["tolu", "iPhone · Safari", "07:52", "passkey"], ["seyi", "Pixel 7 · Chrome", "08:58", "pin"], ["ngozi", "Windows · Edge", "08:31", "password"], ["ifeoma", "iPad · Safari", "07:15", "passkey"]] as const
).map(([u, device_label, t, method]) => {
  const p = byKey(u)!;
  return { session_id: sid(`sess:${u}`), user_id: sid(`user:${u}`), display_name: p.display_name, email: p.work_email, device_label, ip_address: "102.89.0.14", method, issued_at: at(0, t), last_seen_at: at(0, "09:10"), current: false };
});
const FAILED: FailedSignIn[] = (
  [[1, "22:41", "bashir@mycityapp.io", "Bashir Lawal", "bad_password"], [1, "22:40", "bashir@mycityapp.io", "Bashir Lawal", "bad_password"], [3, "11:02", "unknown@example.com", null, "no_such_account"], [5, "08:14", "emeka@mycityapp.io", "Emeka Obi", "bad_code"]] as const
).map(([d, t, email, display_name, reason], i) => ({ audit_ledger_id: sid(`fail:${i}`), occurred_at: at(d, t), email, display_name, ip_address: "102.89.0.21", reason }));
const twoStepRoles = () => ordered().map(([id, r]) => {
  const people = USERS.filter((u) => u.status === "active" && u.roles.some((x) => x.code === r.code));
  return { role_id: id, code: r.code, name: r.name, two_step_required: r.two_step_required, holders: people.length, enrolled: people.filter((u) => out(u).two_step).length };
});
const policy = () => ({
  session_max_age_min: RULES.session_max_age_min, session_max_age_floor: FLOOR.session_max_age_min,
  idle_lock_min: RULES.idle_lock_min, idle_lock_floor: FLOOR.idle_lock_min,
  password_min_length: RULES.password_min_length, password_min_floor: FLOOR.password_min_length,
  two_step_roles: twoStepRoles(),
  active_sessions: LIVE.length + 14, users: USERS.filter((u) => u.status === "active").length, two_step_on: USERS.filter((u) => out(u).two_step).length, failed_7d: FAILED.length,
});
route("GET /api/v1/settings/security", () => ok(policy()));
route("PATCH /api/v1/settings/security", (req) => {
  if (!admin(req.user!)) return fail(403, "PERMISSION_DENIED", "You do not have access to this");
  const b = req.body as Partial<typeof RULES> & { two_step_roles?: string[] };
  const fields: Record<string, string[]> = {};
  if (b.session_max_age_min !== undefined && b.session_max_age_min > FLOOR.session_max_age_min) fields.session_max_age_min = [`At most ${FLOOR.session_max_age_min} minutes`];
  if (b.idle_lock_min !== undefined && b.idle_lock_min > FLOOR.idle_lock_min) fields.idle_lock_min = [`At most ${FLOOR.idle_lock_min} minutes`];
  if (b.password_min_length !== undefined && b.password_min_length < FLOOR.password_min_length) fields.password_min_length = [`At least ${FLOOR.password_min_length}`];
  const session = b.session_max_age_min ?? RULES.session_max_age_min;
  if (!fields.idle_lock_min && (b.idle_lock_min ?? RULES.idle_lock_min) > session) fields.idle_lock_min = ["Within the session length"];
  if (Object.keys(fields).length) return fail(422, "RULE_BELOW_FLOOR", "A rule would be looser than the server allows.", fields);
  const before = JSON.stringify(RULES);
  Object.assign(RULES, { session_max_age_min: b.session_max_age_min ?? RULES.session_max_age_min, idle_lock_min: b.idle_lock_min ?? RULES.idle_lock_min, password_min_length: b.password_min_length ?? RULES.password_min_length });
  if (b.two_step_roles) for (const [, r] of ROLES) r.two_step_required = b.two_step_roles.includes(r.code);
  audit(who(req.user!), "The security rules were changed", "Setting · Security", before, JSON.stringify(RULES), null, "Settings");
  return ok(policy());
});
route("GET /api/v1/settings/security/sessions", (req) => paged(LIVE.map((x) => ({ ...x, current: x.user_id === sid(`user:${req.user}`) })), req, { search: (x) => [x.display_name, x.email, x.device_label], filters: { sort: () => true } }));
route("POST /api/v1/settings/security/sessions/:id/end", (req) => {
  if (!admin(req.user!)) return fail(403, "PERMISSION_DENIED", "You do not have access to this");
  const i = LIVE.findIndex((x) => x.session_id === req.params.id);
  if (i < 0) return fail(404, "NOT_FOUND", "That session has already ended.");
  if (LIVE[i].user_id === sid(`user:${req.user}`)) return fail(422, "CURRENT_SESSION", "Use Sign Out to end your own session.");
  audit(who(req.user!), "A session was ended", `Account · ${LIVE[i].display_name}`, LIVE[i].device_label, null, "Ended by an administrator", "Settings");
  LIVE.splice(i, 1);
  return noContent();
});
route("GET /api/v1/settings/security/failed-logins", (req) => paged(FAILED, req, { search: (f) => [f.email, f.display_name], filters: { days: () => true, sort: () => true } }));

/* ── Audit Log: Settings view over everything, and the CEO ── */
const auditRows = (req: Req) => (req.query.sort === "occurred_at" ? [...AUDIT].reverse() : AUDIT);
const day = (e: AuditEntry) => e.occurred_at.slice(0, 10);
route("GET /api/v1/audit/summary", (req) => {
  if (!admin(req.user!)) return fail(403, "PERMISSION_DENIED", "You do not have access to this");
  const today = isoDaysAgo(0);
  const month = AUDIT.filter((a) => a.occurred_at.slice(0, 7) === today.slice(0, 7));
  const counts = new Map<string, number>();
  for (const a of month) counts.set(a.module_key, (counts.get(a.module_key) ?? 0) + 1);
  return ok({
    today: AUDIT.filter((a) => day(a) === today).length,
    this_week: AUDIT.filter((a) => day(a) >= isoDaysAgo(6)).length,
    this_month: month.length,
    sensitive_this_month: month.filter((a) => a.is_sensitive).length,
    by_module: [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([module_key, entries]) => ({ module_key, label: MODULE_LIST.find(([k]) => k === module_key)?.[1] ?? module_key, entries })),
    modules: MODULE_LIST.map(([key, label]) => ({ key, label })),
  });
});
route("GET /api/v1/audit", (req) =>
  admin(req.user!)
    ? paged(auditRows(req), req, {
        search: (a) => [a.actor_name, a.actor_email, a.summary, a.action, a.entity_type, a.entity_id],
        filters: { module: (a, v) => a.module_key === v, action: (a, v) => a.action === v, actor_user_id: (a, v) => a.actor_user_id === v, entity_type: (a, v) => a.entity_type === v, entity_id: (a, v) => a.entity_id === v, from: (a, v) => day(a) >= v, to: (a, v) => day(a) <= v, sort: () => true },
      })
    : fail(403, "PERMISSION_DENIED", "You do not have access to this"),
);
route("POST /api/v1/audit/exports", (req) => (admin(req.user!) ? exportFile(req.user!, "audit-log") : fail(403, "PERMISSION_DENIED", "You do not have access to this")));
