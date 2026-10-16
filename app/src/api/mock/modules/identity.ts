import type { Me, SignIn } from "@mycity/contract/contract.gen.ts";
import { at, fail, invalid, mockSession, ok, noContent, paged, route } from "../core";
import { byKey, grantsFor, PEOPLE, SIGN_INS, teamOf } from "../data/people";
import { SEARCH_INDEX } from "../data/search";
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

function me(key: string): Me {
  const p = byKey(key)!;
  return {
    user_id: p.employee_id.replace(/^.{4}/, "u5e7"),
    employee_id: p.employee_id,
    email: p.work_email,
    display_name: p.display_name,
    first_name: p.first_name,
    job_title: p.job_title,
    department: p.department,
    photo_url: null,
    is_ceo: key === "ifeoma",
    grants: grantsFor(key) as Me["grants"],
    roles: [ROLE[SIGN_INS[key]?.role ?? "Staff"] ?? ROLE.Staff],
    home_view: SIGN_INS[key]?.view ?? "staff",
    manages_people: teamOf(key).length > 0,
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

route("GET /api/v1/notifications/badges", (req) => {
  const full = req.user === "cynthia" || req.user === "ifeoma";
  return ok({ workspace: 4, community: 3, mailbox: 12, ...(full ? { queries: 2, recruitment: 12, expenses: 5 } : { expenses: 1 }) });
});

const NOTES = [
  ["approvals", "Expense request waiting on you", "Bashir Lawal · Lagos activation transport, ₦185,000.00", 0, "08:41", "warn", "/expenses?tab=approvals"],
  ["attendance", "3 late arrivals in 30 days", "A query was raised automatically for Bashir Lawal.", 0, "09:44", "err", "/queries?tab=queries"],
  ["recruitment", "New application", "Adaeze Okonkwo applied for Content Producer.", 0, "07:20", "info", "/recruitment?tab=candidates"],
  ["community", "You were recognised", "Ifeoma Chukwu: \"Kept the Enugu shoot on schedule.\"", 1, "16:12", "ok", "/community?tab=channels"],
  ["leave", "Leave request", "Tobi Ojo requested 5 days from 20/10.", 1, "11:03", "info", "/people?tab=leave"],
  ["partnerships", "Eko Hotels has gone quiet", "34 days since the last contact.", 2, "09:00", "warn", "/partnerships?tab=partners"],
  ["payroll", "Payroll preview ready", "October run, 25 employees.", 3, "10:30", "info", "/payroll?tab=payroll-runs"],
] as const;

route("GET /api/v1/notifications", (req) =>
  paged(
    NOTES.map((n, i) => ({
      notification_id: `n-${i}`,
      category: n[0],
      title: n[1],
      body: n[2],
      created_at: at(n[3], n[4]),
      read_at: i > 2 ? at(n[3], n[4]) : null,
      tone: n[5],
      link: { path: n[6] },
    })),
    req,
    { filters: { unread: (r, v) => (v === "true" ? r.read_at === null : true) } },
  ),
);
route("POST /api/v1/notifications/read-all", () => noContent());

route("GET /api/v1/search", (req) =>
  paged(SEARCH_INDEX(PEOPLE), req, { search: (r) => [r.title, r.subtitle, r.group] }),
);
