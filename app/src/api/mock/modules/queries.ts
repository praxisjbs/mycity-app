import type { Firing, LetterPreview, LetterTemplate, QueryDetail, Rule, SanctionRow } from "@/api/types/queries";
import type { Status } from "@/api/types/shared";
import { at, created, fail, invalid, isoDaysAgo, notFound, ok, paged, route, sid } from "../core";
import { byId, byKey, refKey } from "../data/people";

const S = (tone: Status["tone"], text: string): Status => ({ tone, text });
const FULL = new Set(["cynthia", "ifeoma"]);
const nameOf = (k: string) => byKey(k)?.display_name ?? k;

type Q = QueryDetail & { _by: string | null };
const mk = (n: number, emp: string, subject: string, by: string | null, days: number, hm: string, response: string | null, status: Status, instances: string[] = [], respond?: string): Q => ({
  query_id: sid(`qry:${n}`), number: `QRY-${String(n).padStart(4, "0")}`, employee: refKey(emp), subject, raised_by: by ? nameOf(by) : "System rule", raised_on: isoDaysAgo(days), raised_at: at(days, hm),
  respond_by: respond ?? null, instances, letter: "Query letter, sent by email and in app", response: response, response_text: response ? "I was held up at the Third Mainland Bridge closure on each of those mornings. I have since moved my start time earlier." : null,
  status, can_decide: false, can_remind: false, _by: by,
});
const QUERIES: Q[] = [
  mk(14, "bashir", "3 late arrivals in 30 days", null, 7, "09:41", null, S("warn", "Awaiting response"), ["Late 31 minutes", "Late 22 minutes", "Late 41 minutes"], at(5, "09:41")),
  mk(15, "emeka", "Missing clock-out yesterday", "cynthia", 1, "06:00", null, S("warn", "Awaiting response"), ["Clock-in 08:52, no clock-out"], at(-1, "06:00")),
  mk(12, "seyi", "Punch from unenrolled device", null, 12, "08:12", "Submitted the next day", S("ok", "Closed, no action"), ["Punch from a new phone"]),
  mk(11, "chidera", "Deadline missed, Enugu brief", "tolu", 16, "17:30", "Submitted the next day", S("neutral", "Closed, caution")),
  mk(10, "tobi", "Absence without notice", null, 21, "09:00", "Submitted in 2 days", S("err", "Escalated to warning")),
  mk(9, "hauwa", "Missing Clock-Out", null, 25, "06:00", "Submitted the same day", S("ok", "Closed, no action")),
  mk(8, "yusuf", "2 late arrivals and one absence", "emeka", 33, "10:15", "Submitted the next day", S("ok", "Closed, no action")),
];
const view = (q: Q, user: string): QueryDetail => {
  const { _by, ...rest } = q;
  void _by;
  const open = q.status.tone === "warn";
  return { ...rest, can_decide: open && (FULL.has(user) || q._by === user), can_remind: open && !q.response };
};
const visible = (user: string) => QUERIES.filter((q) => FULL.has(user) || q._by === user);

route("GET /api/v1/queries/summary", (req) => {
  const list = visible(req.user!);
  return ok({
    open: list.filter((q) => q.status.tone === "warn").length, awaiting_response: list.filter((q) => q.status.text === "Awaiting response").length,
    closed_this_month: list.filter((q) => q.status.text.startsWith("Closed")).length, escalated: list.filter((q) => q.status.tone === "err").length,
    by_reason: [{ label: "Lateness", pct: 100, value: "9" }, { label: "Missing Clock-Out", pct: 55, value: "5" }, { label: "Unenrolled Device", pct: 33, value: "3" }, { label: "Deadline Missed", pct: 22, value: "2", emphasis: "warn" }, { label: "Absence Without Notice", pct: 11, value: "1" }],
    by_reason_note: "Seventeen of twenty queries were raised by a rule rather than a person. That is the point of the rules.",
    focus_id: list.find((q) => q.status.tone === "warn")?.query_id ?? null,
  });
});
route("GET /api/v1/queries", (req) => {
  const user = req.user!;
  const rows = (req.query.scope === "mine" ? QUERIES.filter((q) => q._by === user) : visible(user)).map((q) => view(q, user));
  return paged(rows, { ...req, query: Object.fromEntries(Object.entries(req.query).filter(([k]) => k !== "scope")) }, { search: (q) => [q.number, q.employee.display_name, q.subject], filters: { status: (q, v) => (v === "open" ? q.status.tone === "warn" : q.status.tone !== "warn") } });
});
const findQ = (user: string, id: string) => visible(user).find((q) => q.query_id === id);
route("POST /api/v1/queries", (req) => {
  const b = req.body as { employee_id?: string; subject?: string; details?: string };
  const p = byId(b.employee_id);
  const f: Record<string, string[]> = {};
  if (!p) f.employee_id = ["Pick the employee"];
  if (!b.subject || b.subject.trim().length < 4) f.subject = ["Say what the query is about"];
  if (!b.details || b.details.trim().length < 20) f.details = ["Give the facts: dates, times, what happened (20 characters or more)"];
  if (Object.keys(f).length) return invalid(f);
  if (p!.user_key === req.user) return fail(422, "SELF_QUERY", "You cannot raise a query on yourself.");
  const n = Math.max(...QUERIES.map((q) => Number(q.number.slice(4)))) + 1;
  const q = mk(n, p!.user_key, b.subject!.trim(), req.user!, 0, new Date().toISOString().slice(11, 16), null, S("warn", "Awaiting response"), [b.details!.trim()], new Date(Date.now() + 48 * 3600000).toISOString());
  q.raised_at = new Date().toISOString();
  QUERIES.unshift(q);
  return created(view(q, req.user!));
});
route("POST /api/v1/queries/:id/remind", (req) => {
  const q = findQ(req.user!, req.params.id);
  return q ? ok(view(q, req.user!)) : notFound();
});
const OUTCOME: Record<string, Status> = { no_action: S("ok", "Closed, no action"), caution: S("neutral", "Closed, caution"), warning: S("err", "Escalated to warning"), suspension: S("err", "Suspension"), suspension_without_pay: S("err", "Suspension without pay"), dismissal: S("err", "Dismissal") };
route("POST /api/v1/queries/:id/decision", (req) => {
  const q = findQ(req.user!, req.params.id);
  if (!q) return notFound();
  const b = req.body as { outcome?: string; note?: string; fine_amount?: string };
  if (!b.outcome || !OUTCOME[b.outcome]) return invalid({ outcome: ["Pick the outcome"] });
  if (!b.note || b.note.trim().length < 10) return invalid({ note: ["Record the reason (10 characters or more)"] });
  if (b.outcome !== "no_action" && !q.response && q.respond_by && new Date(q.respond_by).getTime() > Date.now()) return fail(409, "RESPONSE_WINDOW_OPEN", "The response window is still open. A sanction waits until the employee has answered or the 48 hours have passed.");
  q.status = OUTCOME[b.outcome];
  if (b.outcome !== "no_action") SANCTIONS.unshift({ sanction_id: sid(`sanc:${q.query_id}`), employee: q.employee, kind: b.outcome[0].toUpperCase() + b.outcome.slice(1).replace(/_/g, " "), reason: q.subject, issued_by: nameOf(req.user!), date: isoDaysAgo(0), amount: b.fine_amount ?? null, status: S("neutral", "Active") });
  return ok(view(q, req.user!));
});
route("GET /api/v1/queries/:id/letter", (req) => {
  const q = findQ(req.user!, req.params.id);
  return q ? ok(letter(q.number, q.employee.display_name.split(" ")[0])) : notFound();
});

function letter(ref: string, first: string): LetterPreview {
  const d = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "long", year: "numeric", timeZone: "Africa/Lagos" });
  return {
    reference: ref, title: "Query: Punctuality", date_line: `Private and confidential · ${d.format(new Date(Date.now() - 7 * 86400000))}`,
    paragraphs: [
      [{ text: "Dear " }, { text: first, filled: true }, { text: "," }],
      [{ text: "Our attendance records show " }, { text: "three late arrivals", filled: true }, { text: " within the last thirty days. Our working hours are " }, { text: "09:00 to 17:00 Monday to Friday and 09:00 to 15:00 on Saturday", filled: true }, { text: ", with a grace window of " }, { text: "fifteen minutes", filled: true }, { text: "." }],
      [{ text: "You are asked to respond in writing within forty-eight hours of this letter, setting out any explanation you wish to be considered. Your response will be read before any decision is taken." }],
      [{ text: "Yours sincerely," }],
    ],
    signer: "C. Osakunih", signer_role: "Cynthia Osakunih · Operations and People Lead", fields_note: "Fields filled from the record: name, dates, hours, grace window",
  };
}

const RULES: Rule[] = [
  ["Repeated lateness", "Raises a query on the third late arrival in a rolling 30 days. Not the first.", "3 in 30 days", true],
  ["Missing Clock-Out", "Raises a query the morning after a punch with no matching clock-out.", null, true],
  ["Unenrolled device", "Raises a query when someone punches from a device that is not enrolled.", null, true],
  ["Absence without notice", "Raises a query after one full day absent with no approved leave.", null, true],
  ["Overdue task", "Raises a query when a task is 5 working days past its date.", "5 working days", false],
  ["Missed monthly KPI", "Raises a query when an individual KPI closes below 50%.", "Below 50%", false],
].map((r, i) => ({ rule_id: sid(`rule:${i}`), name: r[0] as string, description: r[1] as string, threshold: r[2] as string | null, status: r[3] ? S("ok", "Active") : S("neutral", "Draft") }));
const FIRINGS: Firing[] = [
  ["Repeated lateness", 7, "09:41", "bashir", S("warn", "Query raised")],
  ["Missing Clock-Out", 1, "06:00", "emeka", S("warn", "Query raised")],
  ["Unenrolled device", 1, "08:58", "seyi", S("neutral", "Warned, no query")],
  ["Repeated lateness", 3, "09:18", "cynthia", S("neutral", "Below threshold")],
  ["Unenrolled device", 12, "08:12", "seyi", S("ok", "Closed, no action")],
].map((f, i) => ({ firing_id: sid(`fire:${i}`), rule: f[0] as string, fired_at: at(f[1] as number, f[2] as string), employee: refKey(f[3] as string), outcome: f[4] as Status }));
route("GET /api/v1/queries/rules/summary", () => ok({ active: RULES.filter((r) => r.status.text === "Active").length, draft: RULES.filter((r) => r.status.text === "Draft").length, fired_this_month: 11, queries_raised: 6 }));
route("GET /api/v1/queries/rules", (req) => paged(RULES, req, { search: (r) => [r.name, r.description] }));
route("GET /api/v1/queries/rules/firings", (req) => paged(FIRINGS, req, { search: (f) => [f.rule, f.employee.display_name] }));
const TRIGGER: Record<string, string> = { lateness: "late arrival", missing_clock_out: "missing clock-out", unenrolled_device: "punch from an unenrolled device", absence: "day absent without notice", overdue_task: "overdue task", missed_kpi: "KPI closed below 50%" };
route("POST /api/v1/queries/rules", (req) => {
  if (!FULL.has(req.user!)) return fail(403, "FORBIDDEN", "Only People and the CEO configure rules.");
  const b = req.body as { name?: string; trigger?: string; count?: number; window_days?: number; template_id?: string };
  const f: Record<string, string[]> = {};
  if (!b.name || b.name.trim().length < 3) f.name = ["Name the rule"];
  if (!b.trigger || !TRIGGER[b.trigger]) f.trigger = ["Pick what sets it off"];
  if (!b.count || b.count < 1) f.count = ["At least 1"];
  if (!b.window_days || b.window_days < 1) f.window_days = ["At least 1 day"];
  if (!b.template_id) f.template_id = ["Pick the letter it sends"];
  if (Object.keys(f).length) return invalid(f);
  const r: Rule = { rule_id: sid(`rule:new:${RULES.length}`), name: b.name!.trim(), description: `Raises a query on the ${b.count === 1 ? "first" : `${b.count}${b.count === 2 ? "nd" : b.count === 3 ? "rd" : "th"}`} ${TRIGGER[b.trigger!]} in a rolling ${b.window_days} days.`, threshold: `${b.count} in ${b.window_days} days`, status: S("neutral", "Draft") };
  RULES.push(r);
  return created(r);
});
route("POST /api/v1/queries/rules/:id/activate", (req) => {
  if (!FULL.has(req.user!)) return fail(403, "FORBIDDEN", "Only People and the CEO configure rules.");
  const r = RULES.find((x) => x.rule_id === req.params.id);
  if (!r) return notFound();
  r.status = S("ok", "Active");
  return ok(r);
});

const SANCTIONS: SanctionRow[] = [
  ["chidera", "Caution", "Deadline missed, Enugu brief", "tolu", 15, null, S("neutral", "Active")],
  ["tobi", "Warning", "Absence without notice", "cynthia", 19, null, S("neutral", "Active")],
  ["bashir", "Warning", "Repeated lateness, August", "cynthia", 46, "12500.00", S("neutral", "Served")],
  ["seyi", "Fine", "Damage to studio monitor", "cynthia", 92, "45000.00", S("ok", "Recovered")],
].map((s, i) => ({ sanction_id: sid(`sanc:${i}`), employee: refKey(s[0] as string), kind: s[1] as string, reason: s[2] as string, issued_by: nameOf(s[3] as string), date: isoDaysAgo(s[4] as number), amount: s[5] as string | null, status: s[6] as Status }));
route("GET /api/v1/queries/sanctions/summary", () =>
  ok({
    active: SANCTIONS.filter((s) => s.status.text === "Active").length, served: SANCTIONS.filter((s) => s.status.text !== "Active").length + 2, financial_this_year: "57500.00", recovered: "45000.00",
    focus: { title: "Bashir Lawal · 3 late arrivals in 30 days", status: S("warn", "In progress"), chain: [{ label: "Query Raised", state: "done" }, { label: "Awaiting Response", state: "now" }, ...["Caution", "Warning", "Suspension", "Suspension without pay", "Dismissal"].map((label) => ({ label, state: null }))] },
    activity: [
      { title: "Query letter sent to Bashir Lawal", when: at(7, "09:41"), text: "By email and in app. Response due in 48 hours.", tone: "hi" },
      { title: "Caution issued to Chidera Nwosu", when: at(15, "11:00"), text: "Response read first. Caution stands.", tone: null },
      { title: "Warning served on Bashir Lawal", when: at(46, "15:20"), text: "₦12,500 accepted into the August run.", tone: null },
      { title: "Fine fully recovered from Seyi Balogun", when: at(45, "10:00"), text: "₦45,000 across July and August.", tone: "ok" },
    ],
  }),
);
route("GET /api/v1/queries/sanctions", (req) => paged(SANCTIONS, req, { search: (s) => [s.employee.display_name, s.kind, s.reason] }));
route("POST /api/v1/queries/sanctions", (req) => {
  if (!FULL.has(req.user!)) return fail(403, "FORBIDDEN", "Only People and the CEO issue sanctions.");
  const b = req.body as { employee_id?: string; kind?: string; reason?: string; amount?: string };
  const p = byId(b.employee_id);
  const f: Record<string, string[]> = {};
  if (!p) f.employee_id = ["Pick the employee"];
  if (!b.kind) f.kind = ["Pick the sanction"];
  if (!b.reason || b.reason.trim().length < 6) f.reason = ["Give the reason"];
  if (b.kind === "fine" && !(Number(b.amount) > 0)) f.amount = ["A fine needs an amount"];
  if (Object.keys(f).length) return invalid(f);
  const s: SanctionRow = { sanction_id: sid(`sanc:new:${SANCTIONS.length}`), employee: refKey(p!.user_key), kind: b.kind![0].toUpperCase() + b.kind!.slice(1).replace(/_/g, " "), reason: b.reason!.trim(), issued_by: nameOf(req.user!), date: isoDaysAgo(0), amount: b.amount ?? null, status: b.kind === "fine" ? S("warn", "Pending acceptance") : S("neutral", "Active") };
  SANCTIONS.unshift(s);
  return created(s);
});

const TEMPLATES: LetterTemplate[] = [
  ["Query letter", "Any query raised", true], ["Caution letter", "Caution stage", true], ["Warning letter", "Warning stage", true],
  ["Suspension letter", "Suspension", false], ["Suspension without pay", "Suspension without pay", false], ["Termination letter", "Dismissal or termination", false],
].map((t, i) => ({ template_id: sid(`tpl:${i}`), name: t[0] as string, used_for: t[1] as string, status: t[2] ? S("ok", "Active") : S("warn", "Awaiting sample") }));
route("GET /api/v1/queries/templates/summary", () => ok({ templates: TEMPLATES.length, active: TEMPLATES.filter((t) => t.status.tone === "ok").length, awaiting: TEMPLATES.filter((t) => t.status.tone === "warn").length, sent_90d: 14, languages: "English" }));
route("GET /api/v1/queries/templates", (req) => paged(TEMPLATES, req, { search: (t) => [t.name, t.used_for] }));
route("GET /api/v1/queries/templates/:id/preview", (req) => {
  const t = TEMPLATES.find((x) => x.template_id === req.params.id);
  if (!t) return notFound();
  if (t.status.tone === "warn") return fail(409, "AWAITING_SAMPLE", "This template is waiting on a sample letter from MyCity, so there is nothing to preview yet.");
  const l = letter("QRY-0014", "Bashir");
  return ok(t.name === "Query letter" ? l : { ...l, title: t.name.replace(" letter", ""), paragraphs: [l.paragraphs[0], [{ text: `This letter records the ${t.used_for.toLowerCase()} following ` }, { text: "query QRY-0014", filled: true }, { text: " and your response, which was read before this decision." }], l.paragraphs[3]] });
});
route("POST /api/v1/queries/templates", (req) => {
  const b = req.body as { name?: string; used_for?: string; body?: string };
  const f: Record<string, string[]> = {};
  if (!b.name || b.name.trim().length < 3) f.name = ["Name the template"];
  if (!b.used_for) f.used_for = ["Say when it is sent"];
  if (!b.body || b.body.trim().length < 40) f.body = ["Write the letter (40 characters or more)"];
  if (Object.keys(f).length) return invalid(f);
  const t: LetterTemplate = { template_id: sid(`tpl:new:${TEMPLATES.length}`), name: b.name!.trim(), used_for: b.used_for!, status: S("neutral", "Draft") };
  TEMPLATES.push(t);
  return created(t);
});

/* Last: "/queries/:id" would otherwise answer for /queries/rules, /sanctions and /templates. */
route("GET /api/v1/queries/:id", (req) => {
  const q = findQ(req.user!, req.params.id);
  return q ? ok(view(q, req.user!)) : notFound();
});
