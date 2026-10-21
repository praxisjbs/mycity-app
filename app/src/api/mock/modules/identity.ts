import type { Me, SignIn } from "@mycity/contract/contract.gen.ts";
import { at, fail, invalid, mockSession, ok, noContent, paged, route } from "../core";
import { capabilitiesOf } from "../data/access";
import { appearanceApplied } from "../data/appearance";
import { byKey, grantsFor, PEOPLE, SIGN_INS, teamOf } from "../data/people";
import { searchResult } from "../data/search";
import { codeGiven, codeOk, markFresh, needsCode, passkeyOwner, waysOf } from "./security";

/**
 * Identity, as packages/contract/schemas/identity.js describes it. The four
 * demonstration accounts sign in with any password of eight characters or more
 * (the sign-in screen offers them in mock mode); a suspended one is refused.
 * Two-step sign-in, the PIN and passkeys follow the security mock
 * (./security.ts). Sessions here last as long as the browser tab, not two hours.
 */

const ROLE: Record<string, { code: string; name: string }> = {
  Operations: { code: "operations_people", name: "Operations & People" },
  CEO: { code: "management", name: "Management" },
  Partnerships: { code: "head_of_department", name: "Head of Department" },
  Staff: { code: "employee", name: "Staff" },
};

/** The /me answer for a demonstration account; Home's mock reads it to decide which cards each may see. */
export function me(key: string): Me {
  const p = byKey(key)!;
  const role = ROLE[SIGN_INS[key]?.role ?? "Staff"] ?? ROLE.Staff;
  const isCeo = key === "ifeoma";
  return {
    user_id: p.employee_id.replace(/^.{4}/, "u5e7"),
    employee_id: p.employee_id,
    email: p.work_email,
    display_name: p.display_name,
    first_name: p.first_name,
    job_title: p.job_title,
    department: p.department,
    photo_url: null,
    is_ceo: isCeo,
    grants: grantsFor(key) as Me["grants"],
    capabilities: capabilitiesOf([role.code], isCeo),
    roles: [role],
    home_view: SIGN_INS[key]?.view ?? "staff",
    manages_people: teamOf(key).length > 0,
    appearance: appearanceApplied(),
  };
}

const clock = { expires_in: 900, session_expires_in: 7200, session_max_age: 7200, session_idle_limit: 1800 };
const token = (key: string) => `mock.${key}.${Date.now().toString(36)}`;
let lastOnThisBrowser: string | null = null;

/** A session opens: on this browser, inside the window for changing a way in. */
function begin(key: string) {
  mockSession.set(key);
  lastOnThisBrowser = key;
  markFresh(key);
  return ok({ access_token: token(key), ...clock, user: me(key) });
}

/** The first step passed: the code step when two-step asks for one, else the session. */
const afterFirstStep = (key: string, via: "password" | "pin") =>
  needsCode(key) ? ok({ step: "code" as const, challenge_token: `mock-code.${via}.${key}`, expires_in: 300 }) : begin(key);

route(
  "POST /api/v1/auth/login",
  (req) => {
    const email = String(req.body.email ?? "").trim().toLowerCase();
    const password = String(req.body.password ?? "");
    const fields: Record<string, string[]> = {};
    if (!email) fields.email = ["Enter your email"];
    if (!password) fields.password = ["Enter your password"];
    if (Object.keys(fields).length) return invalid(fields);
    const key = email.split("@")[0];
    const person = byKey(key);
    if (!person || !email.endsWith("@mycityapp.io") || password.length < 8) return fail(401, "INVALID_CREDENTIALS", "That email and password do not match.");
    if (person.status === "suspended") return fail(403, "ACCOUNT_SUSPENDED", "This account is suspended. Contact People.");
    return afterFirstStep(key, "password");
  },
  { anonymous: true },
);

route(
  "POST /api/v1/auth/two-step",
  (req) => {
    const [kind, , key] = String(req.body.challenge_token ?? "").split(".");
    if (kind !== "mock-code" || !key || !byKey(key)) return fail(400, "CHALLENGE_EXPIRED", "This request has expired. Start again.");
    if (!codeOk(key, String(req.body.code ?? ""))) return fail(401, "INVALID_CODE", "That code is not right.", { code: ["Not the right code"] });
    codeGiven(key);
    return begin(key);
  },
  { anonymous: true },
);

route(
  "POST /api/v1/auth/pin",
  (req) => {
    const key = String(req.body.email ?? "").trim().toLowerCase().split("@")[0];
    const pin = waysOf(key).pin.value;
    if (!byKey(key) || key !== lastOnThisBrowser || !pin) return fail(401, "PIN_UNAVAILABLE", "Use your password to sign in on this device.");
    if (String(req.body.pin ?? "") !== pin) return fail(401, "INVALID_PIN", "That PIN is not right.", { pin: ["Not the right PIN"] });
    return afterFirstStep(key, "pin");
  },
  { anonymous: true },
);

route(
  "POST /api/v1/auth/passkey/options",
  (req) => {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const challenge = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const email = String(req.body.email ?? "").toLowerCase();
    return ok({ challenge_token: `mock-passkey.${email}`, options: { challenge, rpId: location.hostname, timeout: 90000, userVerification: "required", allowCredentials: [] } });
  },
  { anonymous: true },
);

route(
  "POST /api/v1/auth/passkey",
  (req) => {
    const found = passkeyOwner(String((req.body.credential as { id?: string } | undefined)?.id ?? ""));
    if (!found) return fail(401, "PASSKEY_UNKNOWN", "This passkey is not on any account here. Use your password.");
    const email = String(req.body.challenge_token ?? "").replace(/^mock-passkey\./, "");
    if (email && byKey(found.key)!.work_email.toLowerCase() !== email) return fail(401, "PASSKEY_NOT_YOURS", "That passkey belongs to someone else.");
    found.passkey.last_used_at = new Date().toISOString();
    return begin(found.key);
  },
  { anonymous: true },
);

route(
  "POST /api/v1/auth/refresh",
  () => {
    const key = mockSession.get();
    return key ? ok({ access_token: token(key), ...clock }) : fail(401, "SESSION_ENDED", "This session has ended. Sign in again.");
  },
  { anonymous: true },
);

route(
  "POST /api/v1/auth/logout",
  () => {
    mockSession.set(null);
    return noContent();
  },
  { anonymous: true },
);

route(
  "GET /api/v1/auth/device",
  () => {
    const p = lastOnThisBrowser ? byKey(lastOnThisBrowser) : null;
    const w = lastOnThisBrowser ? waysOf(lastOnThisBrowser) : null;
    return ok({
      account: p && w ? { email: p.work_email, display_name: p.display_name, first_name: p.first_name, has_pin: !!w.pin.value, has_passkey: w.passkeys.length > 0 } : null,
    });
  },
  { anonymous: true },
);

route("POST /api/v1/auth/forgot", () => ok({ ok: true as const }), { anonymous: true });

/** A link token of the right shape; one that starts with "x" has expired, one that starts with "i" is an invitation. */
route(
  "POST /api/v1/auth/link",
  (req) => {
    const t = String(req.body.token ?? "");
    if (!/^[A-Za-z0-9_-]{43}$/.test(t) || t.startsWith("x")) return fail(404, "LINK_INVALID", "This link has expired or was already used.");
    const p = byKey("chidera")!;
    return ok({ purpose: t.startsWith("i") ? ("invite" as const) : ("reset" as const), email: p.work_email, first_name: p.first_name, expires_at: new Date(Date.now() + 30 * 60000).toISOString() });
  },
  { anonymous: true },
);

route(
  "POST /api/v1/auth/reset",
  (req) => {
    const t = String(req.body.token ?? "");
    if (!/^[A-Za-z0-9_-]{43}$/.test(t) || t.startsWith("x")) return fail(404, "LINK_INVALID", "This link has expired or was already used.");
    return ok({ email: byKey("chidera")!.work_email });
  },
  { anonymous: true },
);

route("GET /api/v1/auth/me", (req) => ok(me(req.user!)));

route("GET /api/v1/auth/security", () =>
  ok({ password_changed_at: at(61, "09:12"), active_sessions: 2, session_max_age: 7200, session_idle_limit: 1800 }),
);

const ended = new Set<string>();
const SIGN_INS_OF = (key: string): SignIn[] => {
  const base = byKey(key)!.employee_id.slice(0, 8);
  const rows: Array<[string, string, number, string, boolean]> = [
    ["Chrome on Windows", "102.89.34.17", 0, "08:04", true],
    ["Safari on iPhone", "102.89.40.2", 0, "07:41", true],
    ["Chrome on Android", "197.210.53.9", 1, "17:22", false],
    ["Edge on Windows", "102.89.34.17", 2, "08:15", false],
  ];
  return rows.map(([device, ip, day, time, live], i) => {
    const id = `${base}-0000-4000-8000-00000000000${i}`;
    const active = live && !ended.has(id);
    return {
      session_id: id,
      device_label: device,
      ip_address: ip,
      method: (["password_totp", "passkey", "pin", "password"] as const)[i],
      issued_at: at(day, time),
      last_seen_at: at(day, time),
      status: active ? ("active" as const) : ("ended" as const),
      end_reason: active ? null : ended.has(id) ? ("ended_by_user" as const) : ("session_max_age" as const),
      current: i === 0,
    };
  });
};

route("GET /api/v1/auth/sessions", (req) =>
  paged(SIGN_INS_OF(req.user!), req, { filters: { status: (s, v) => s.status === v }, search: (s) => [s.device_label] }),
);
route("POST /api/v1/auth/sessions/:id/end", (req) => {
  const s = SIGN_INS_OF(req.user!).find((x) => x.session_id === req.params.id);
  if (!s) return fail(404, "NOT_FOUND", "That session has already ended.");
  if (s.current) return fail(422, "CURRENT_SESSION", "Use Sign Out to end this session.");
  ended.add(s.session_id);
  return noContent();
});
route("POST /api/v1/auth/sessions/end-others", (req) => {
  const others = SIGN_INS_OF(req.user!).filter((s) => !s.current && s.status === "active");
  others.forEach((s) => ended.add(s.session_id));
  return ok({ ended: others.length });
});

route("POST /api/v1/auth/password", (req) => {
  const f: Record<string, string[]> = {};
  const next = String(req.body.new_password ?? "");
  if (String(req.body.current_password ?? "").length < 8) f.current_password = ["Not your password"];
  if (next.length < 8) f.new_password = ["At least 8 characters"];
  else if (!/[A-Z]/.test(next) || !/[a-z]/.test(next) || !/\d/.test(next) || !/[^A-Za-z0-9]/.test(next)) f.new_password = ["Mix cases, number, symbol"];
  if (Object.keys(f).length) return invalid(f);
  return ok({ sessions_signed_out: 1 });
});

/** The bell's rows: [category, title, line, days ago, time, priority, module, tab, entity type, urgency]. */
const NOTES = [
  ["approvals", "Expense request waiting on you", "Bashir Lawal · Lagos activation transport, ₦185,000.00", 0, "08:41", "high", "expenses", "approvals", "expense", "normal"],
  ["comms", "Fire drill at 11", "Urgent. Acknowledge it in #announcements.", 0, "09:30", "high", "community", "channels", "announcement", "urgent"],
  ["queries", "3 late arrivals in 30 days", "A query was raised automatically for Bashir Lawal.", 0, "09:44", "high", "queries", "queries", "query", "normal"],
  ["recruitment", "New application", "Adaeze Okonkwo applied for Content Producer.", 0, "07:20", "normal", "recruitment", "candidates", "candidate", "normal"],
  ["comms", "You were recognised", "Ifeoma Chukwu: \"Kept the Enugu shoot on schedule.\"", 1, "16:12", "normal", "community", "channels", "recognition", "normal"],
  ["people", "Leave request", "Tobi Ojo requested 5 days from 20/10.", 1, "11:03", "normal", "people", "leave", "leave_request", "normal"],
  ["partnerships", "Eko Hotels has gone quiet", "34 days since the last contact.", 2, "09:00", "high", "partnerships", "partners", "partner", "important"],
  ["payroll", "Payroll preview ready", "October run, 25 employees.", 3, "10:30", "normal", "payroll", "payroll-runs", "payroll_run", "normal"],
] as const;

const noteId = (i: number) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`;
/** Read marks, kept for the session: the first four arrive unread. Acknowledgements likewise. */
const READ = new Set(NOTES.map((_, i) => noteId(i)).slice(4));
const ACKED = new Set<string>();

const notes = () =>
  NOTES.map((n, i) => {
    const id = noteId(i);
    const entityId = `${n[8]}-${i + 1}`;
    const ack = n[9] === "urgent" && n[8] === "announcement";
    return {
      notification_id: id,
      category: n[0],
      priority: n[5],
      urgency: n[9],
      acknowledge_required: ack,
      acknowledged_at: ack && ACKED.has(id) ? at(n[3], n[4]) : null,
      repeat_count: 0,
      title: n[1],
      body: n[2],
      entity_type: n[8],
      entity_id: entityId,
      link: { module: n[6], tab: n[7], path: `/${n[6]}?tab=${n[7]}&id=${entityId}` },
      read_at: READ.has(id) ? at(n[3], n[4]) : null,
      created_at: at(n[3], n[4]),
    };
  });

route("GET /api/v1/notifications", (req) =>
  paged(notes(), req, { filters: { status: (r, v) => (v === "unread" ? r.read_at === null : r.read_at !== null) } }),
);
route("GET /api/v1/notifications/urgent", (req) =>
  paged(
    notes().filter((n) => n.urgency === "urgent" && (n.acknowledge_required ? n.acknowledged_at === null : n.read_at === null)),
    req,
  ),
);
route("POST /api/v1/notifications/:id/acknowledge", (req) => {
  const n = notes().find((x) => x.notification_id === req.params.id);
  if (!n) return fail(404, "NOT_FOUND", "There is no such notification.");
  if (!n.acknowledge_required) return fail(422, "NOT_ACKNOWLEDGEABLE", "This notice needs no acknowledgement.");
  ACKED.add(n.notification_id);
  READ.add(n.notification_id);
  return ok(notes().find((x) => x.notification_id === req.params.id));
});
route("GET /api/v1/notifications/unread-count", () => ok({ unread: notes().filter((n) => n.read_at === null).length }));
route("GET /api/v1/notifications/badges", () => {
  const out: Record<string, number> = {};
  for (const n of notes()) if (n.read_at === null) out[n.link.module] = (out[n.link.module] ?? 0) + 1;
  return ok(out);
});
route("POST /api/v1/notifications/:id/read", (req) => {
  if (!NOTES.some((_, i) => noteId(i) === req.params.id)) return fail(404, "NOT_FOUND", "There is no such notification.");
  READ.add(req.params.id);
  return noContent();
});
route("POST /api/v1/notifications/read-all", () => {
  NOTES.forEach((_, i) => READ.add(noteId(i)));
  return noContent();
});
route("GET /api/v1/notifications/read-state", (req) =>
  ok({ read: String(req.query.ids ?? "").split(",").filter((id) => READ.has(id)) }),
);

/** The categories and their defaults (src/shared/notifications/categories.js): key, label, locked, email, push. */
const CATEGORIES: Array<[string, string, boolean, boolean, boolean]> = [
  ["security", "Security", true, true, true],
  ["approvals", "Approvals", false, true, true],
  ["tasks", "Tasks", false, true, true],
  ["alerts", "Alerts", false, true, false],
  ["comms", "Messages and Mail", false, false, true],
  ["people", "Attendance and Leave", false, false, true],
  ["performance", "Performance", false, false, false],
  ["queries", "Queries and Sanctions", false, true, true],
  ["recruitment", "Recruitment", false, false, false],
  ["payroll", "Payroll", false, true, false],
  ["partnerships", "Partnerships", false, false, false],
  ["expenses", "Expenses", false, false, true],
  ["knowledge", "Knowledge Hub", false, false, false],
  ["system", "System", false, false, false],
];
const PREFS = new Map<string, boolean>();
/** The person's quiet hours and digest switch (notification_setting), and the company's digest. */
const SETTING = { quiet_enabled: false, quiet_from: "21:00", quiet_to: "07:00", digest: true };
/** The company's reminders (Settings · Notifications), defaults applied. */
const REMINDERS = {
  approvals: { enabled: true, every_hours: 24 },
  probation: { enabled: true, days_ahead: 14 },
  digest: { enabled: true, at_time: "07:30" },
};
const prefsBody = () => ({
  categories: CATEGORIES.map(([category, label, locked, email, push]) => {
    const defaults = { in_app: true, email, push };
    const on = (ch: "in_app" | "email" | "push") => (locked && defaults[ch]) || (PREFS.get(`${category}:${ch}`) ?? defaults[ch]);
    return { category, label, locked, channels: { in_app: on("in_app"), email: on("email"), push: on("push") }, defaults };
  }),
  settings: { ...SETTING, digest_offered: REMINDERS.digest.enabled, digest_at: REMINDERS.digest.at_time },
});
route("GET /api/v1/notifications/preferences", () => ok(prefsBody()));
route("PUT /api/v1/notifications/preferences", (req) => {
  const { category, channel, enabled } = req.body as { category: string; channel: "in_app" | "email" | "push"; enabled: boolean };
  const c = CATEGORIES.find(([key]) => key === category);
  if (!c) return fail(404, "NOT_FOUND", "There is no such category.");
  if (c[2] && !enabled) return fail(422, "CATEGORY_LOCKED", "Security notices stay on.");
  PREFS.set(`${category}:${channel}`, enabled);
  return ok(prefsBody());
});

route("PUT /api/v1/notifications/preferences/quiet-hours", (req) => {
  const body = req.body as { quiet_enabled: boolean; quiet_from: string; quiet_to: string };
  if (body.quiet_from === body.quiet_to) return invalid({ quiet_to: ["Pick two different times"] });
  Object.assign(SETTING, body);
  return ok(prefsBody());
});
route("PUT /api/v1/notifications/preferences/digest", (req) => {
  SETTING.digest = Boolean((req.body as { digest: boolean }).digest);
  return ok(prefsBody());
});

/*
 * Settings · Notifications. A handful of the notices the code declares (shared/notifications/
 * fanout.notices() on the API), with the company's rule applied as the API applies it.
 */
type Urgency = "normal" | "important" | "urgent";
type Notice = { event_key: string; name: string; category: string; who: string[]; locked: boolean; copies: boolean; urgency_default: Urgency | null };
const NOTICES: Notice[] = [
  { event_key: "role.created", name: "A role was created", category: "security", who: ["CEO", "Settings editors"], locked: true, copies: false, urgency_default: "urgent" },
  { event_key: "auth.password_changed", name: "A password was changed", category: "security", who: ["The account holder"], locked: true, copies: false, urgency_default: "normal" },
  { event_key: "workflow.opened", name: "An approval was started", category: "approvals", who: ["Approvers"], locked: false, copies: true, urgency_default: "normal" },
  { event_key: "workflow.escalated", name: "An approval passed its time limit and was escalated", category: "approvals", who: ["CEO", "Approvers"], locked: false, copies: true, urgency_default: "urgent" },
  { event_key: "workflow.reminded", name: "An approval still waiting was brought back to its approvers", category: "approvals", who: ["Approvers"], locked: false, copies: true, urgency_default: "important" },
  { event_key: "home.alert_raised", name: "An alert was raised", category: "alerts", who: ["Those who can clear it"], locked: false, copies: true, urgency_default: "normal" },
  { event_key: "announcement.published", name: "An announcement went out to its audience", category: "comms", who: ["Its audience"], locked: false, copies: false, urgency_default: null },
  { event_key: "direct_message.sent", name: "A direct message was sent", category: "comms", who: ["The conversation's other members"], locked: false, copies: false, urgency_default: "normal" },
  { event_key: "attendance.home_requested", name: "A remote employee asked for a home location", category: "people", who: ["People · Approve"], locked: false, copies: true, urgency_default: "normal" },
  { event_key: "employee.bank_details_changed", name: "An employee changed their own bank details", category: "people", who: ["People · Edit"], locked: false, copies: true, urgency_default: "normal" },
  { event_key: "employee.probation_ending", name: "A probation is about to end", category: "people", who: ["People · Approve"], locked: false, copies: true, urgency_default: "normal" },
  { event_key: "import.committed", name: "An import was committed", category: "system", who: ["Who ran it"], locked: false, copies: false, urgency_default: "normal" },
];
type Rule = { enabled: boolean; urgency: Urgency | null; in_app: boolean | null; email: boolean | null; push: boolean | null; roles: Array<{ code: string; name: string }>; employee_ids: string[]; updated_at: string };
const RULES = new Map<string, Rule>();
const categoryOf = (key: string) => CATEGORIES.find(([k]) => k === key)!;
const defaultsOf = (category: string) => {
  const [, , , email, push] = categoryOf(category);
  return { in_app: true, email, push };
};
const ruleView = (n: Notice) => {
  const rule = RULES.get(n.event_key) ?? null;
  const defaults = defaultsOf(n.category);
  const channel = (ch: "in_app" | "email" | "push") => (n.locked && defaults[ch]) || (rule?.[ch] ?? defaults[ch]);
  return {
    event_key: n.event_key,
    name: n.name,
    category: n.category,
    category_label: categoryOf(n.category)[1],
    who: n.who,
    locked: n.locked,
    copies: n.copies,
    enabled: n.locked || !rule ? true : rule.enabled,
    urgency: n.urgency_default === null ? null : (!n.locked && rule?.urgency) || n.urgency_default,
    urgency_default: n.urgency_default,
    channels: { in_app: channel("in_app"), email: channel("email"), push: channel("push") },
    defaults,
    roles: rule?.roles ?? [],
    people: PEOPLE.filter((p) => rule?.employee_ids.includes(p.employee_id)).map((p) => ({ employee_id: p.employee_id, display_name: p.display_name, job_title: p.job_title, department: p.department, photo_url: null })),
    changed: Boolean(rule),
    updated_at: rule?.updated_at ?? null,
  };
};
route("GET /api/v1/notifications/rules", (req) =>
  paged(NOTICES.map(ruleView), req, {
    search: (n) => [n.name],
    filters: { category: (n, v) => n.category === v },
  }),
);
route("PUT /api/v1/notifications/rules/:key", (req) => {
  const n = NOTICES.find((x) => x.event_key === req.params.key);
  if (!n) return fail(404, "NOT_FOUND", "There is no such notice.");
  const b = req.body as { enabled: boolean; urgency: Urgency | null; in_app: boolean; email: boolean; push: boolean; role_codes: string[]; employee_ids: string[] };
  if (n.locked && (!b.enabled || (b.urgency !== null && b.urgency !== n.urgency_default))) return fail(422, "NOTICE_LOCKED", "Security notices stay on, as they are.");
  if (n.urgency_default === null && b.urgency !== null) return fail(422, "URGENCY_SET_BY_POSTER", "Its poster chooses the level.");
  if (!n.copies && (b.role_codes.length || b.employee_ids.length)) return fail(422, "NOTICE_TAKES_NO_COPIES", "This notice is for one person and takes no copies.");
  const defaults = defaultsOf(n.category);
  RULES.set(n.event_key, {
    enabled: b.enabled,
    urgency: b.urgency === n.urgency_default ? null : b.urgency,
    in_app: b.in_app === defaults.in_app ? null : b.in_app,
    email: b.email === defaults.email ? null : b.email,
    push: b.push === defaults.push ? null : b.push,
    roles: b.role_codes.map((code) => ({ code, name: code.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) })),
    employee_ids: b.employee_ids,
    updated_at: new Date().toISOString(),
  });
  return ok(ruleView(n));
});
route("POST /api/v1/notifications/rules/:key/reset", (req) => {
  const n = NOTICES.find((x) => x.event_key === req.params.key);
  if (!n) return fail(404, "NOT_FOUND", "There is no such notice.");
  RULES.delete(n.event_key);
  return ok(ruleView(n));
});
route("GET /api/v1/notifications/reminders", () => ok(REMINDERS));
route("PUT /api/v1/notifications/reminders", (req) => {
  Object.assign(REMINDERS, req.body as typeof REMINDERS);
  return ok(REMINDERS);
});

// The mock has no push service: the device reads Not Available, and the calls answer as the API would.
route("GET /api/v1/notifications/push/config", () => ok({ enabled: false, public_key: null, key_id: null }));
route("POST /api/v1/notifications/push/subscriptions", () => fail(422, "PUSH_UNAVAILABLE", "Push is not available here."));
route("GET /api/v1/notifications/push/devices", (req) => paged([], req));
route("POST /api/v1/notifications/push/devices/:id/remove", () => noContent());
route("POST /api/v1/notifications/push/test", () => fail(422, "NO_DEVICE", "Turn on notifications on this device first."));
route("POST /api/v1/notifications/push/renew", () => noContent(), { anonymous: true });
route("POST /api/v1/notifications/push/read", () => noContent(), { anonymous: true });

route("GET /api/v1/search", (req) => {
  for (const k of Object.keys(req.query)) if (!["q", "page", "type"].includes(k)) return invalid({ [k]: ["is not a filter on this list"] });
  const page = Math.max(1, Number.parseInt(req.query.page ?? "1", 10) || 1);
  return ok(searchResult(PEOPLE, grantsFor(req.user!), req.query.q ?? "", req.query.type ?? null, page));
});
