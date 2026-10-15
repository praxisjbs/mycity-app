import { fail, invalid, mockSession, ok, noContent, paged, route, at } from "../core";
import { byKey, grantsFor, PEOPLE, SIGN_INS, teamOf } from "../data/people";
import { SEARCH_INDEX } from "../data/search";

function me(key: string) {
  const p = byKey(key)!;
  return {
    user_id: p.employee_id.replace(/^.{4}/, "u5e7"),
    employee_id: p.employee_id,
    email: p.work_email,
    display_name: p.display_name,
    job_title: p.job_title,
    department: p.department,
    photo_url: null,
    is_ceo: key === "ifeoma",
    grants: grantsFor(key),
    home_view: SIGN_INS[key]?.view ?? "staff",
    manages_people: teamOf(key).length > 0,
  };
}

const session = (key: string) => ({ access_token: `mock.${key}.${Date.now().toString(36)}`, expires_in: 900, user: me(key) });

route(
  "POST /api/v1/auth/login",
  (req) => {
    const email = String(req.body.email ?? "").trim().toLowerCase();
    const password = String(req.body.password ?? "");
    const fields: Record<string, string[]> = {};
    if (!email) fields.email = ["Enter your work email"];
    if (password.length < 8) fields.password = ["At least 8 characters"];
    if (Object.keys(fields).length) return invalid(fields);
    const key = email.split("@")[0];
    const person = byKey(key);
    if (!person || !email.endsWith("@mycityapp.io")) return fail(401, "INVALID_CREDENTIALS", "That email and password do not match an account.");
    if (person.status === "suspended") {
      return fail(403, "ACCOUNT_SUSPENDED", "Access to MyCity App, direct pages and attendance actions is disabled. Contact People or your line manager.");
    }
    mockSession.set(key);
    return ok(session(key));
  },
  { anonymous: true },
);

route(
  "POST /api/v1/auth/refresh",
  () => {
    const key = mockSession.get();
    return key ? ok(session(key)) : fail(401, "UNAUTHENTICATED", "Sign in to continue.");
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

route("GET /api/v1/auth/splash", () => ok({ staff: PEOPLE.length, cities: 8, partnerships: 23 }), { anonymous: true });

route("GET /api/v1/auth/me", (req) => ok(me(req.user!)));

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
