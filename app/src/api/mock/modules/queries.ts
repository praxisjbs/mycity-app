import type {
  ConsequenceStep,
  EvidenceItem,
  LetterPreview,
  LetterTemplate,
  LetterTemplateDetail,
  MyQuery,
  MySanction,
  QueryDetail,
  QueryRule,
  QueryRuleFiring,
  SanctionDetail,
} from "@mycity/contract/contract.gen.ts";
import { at, created, fail, invalid, isoDaysAgo, notFound, ok, paged, route, sid, type Req } from "../core";
import { byId, byKey, refKey } from "../data/people";
import { blocksOf } from "./policies";

/**
 * Queries & Sanctions on the mock, in the contract's shapes (packages/contract/schemas/
 * queries.js, query_rules.js, sanctions.js, templates.js; docs/guides/queries.md). The
 * visibility rule is the API's (§6.1): People with scope all (Operations, the CEO) see
 * every query; anyone else only the ones they raised; a rule's query is People's alone.
 * ESS · My Queries reads the same queries, as the person they are about.
 *
 * A proposed sanction waits for approval as it does on the API; the mock's approvals do
 * not decide it, so Sanction History shows what was issued before.
 */

const FULL = new Set(["cynthia", "ifeoma"]);
const userOf = (key: string | null) => byKey(key)?.employee_id ?? null;
/** A user id for a mock person: the contract carries ids, the mock signs in by key. */
const uid = (key: string) => sid(`user:${key}`);
const nameOf = (key: string | null) => (key ? (byKey(key)?.display_name ?? key) : null);
const now = () => new Date().toISOString();
/** A copy of `row` without `keys`: the list shape of a detail record. */
function omit<T extends object, K extends keyof T>(row: T, keys: readonly K[]): Omit<T, K> {
  const out = { ...row };
  for (const k of keys) delete out[k];
  return out;
}

/* ------------------------------------------------------------------ *
 * Letter templates
 * ------------------------------------------------------------------ */

const LETTERS: Array<LetterTemplateDetail> = (
  [
    ["query-letter", "Query Letter", "query", "active", 1],
    ["caution-letter", "Caution Letter", "sanction", "active", 1],
    ["warning-letter", "Warning Letter", "sanction", "active", 2],
    ["suspension-letter", "Suspension Letter", "sanction", "awaiting_sample", 0],
    ["suspension-without-pay-letter", "Suspension Without Pay Letter", "sanction", "awaiting_sample", 0],
    ["termination-letter", "Termination Letter", "sanction", "awaiting_sample", 0],
  ] as const
).map(([key, name, purpose, status, version], i) => ({
  letter_template_id: sid(`ltr:${key}`),
  key,
  name,
  purpose,
  status,
  version,
  used_by: [],
  updated_at: at(20 - i, "10:00"),
  title: status === "awaiting_sample" ? null : name,
  body:
    status === "awaiting_sample"
      ? null
      : purpose === "query"
        ? "Dear {{ employee.first_name }},\n\n{{ details }}\n\nPlease explain this in writing by {{ datetime response_due }}, in My Queries."
        : "Dear {{ employee.first_name }},\n\nFollowing query {{ query_number }}, this is a {{ step_name }}: {{ reason }}",
  format: status === "awaiting_sample" ? null : "markdown",
  variables: ["employee", "query_number", "subject", "details", "reason", "step_name", "raised_on", "response_due", "effective_on", "ends_on", "days", "fine_amount", "signer"],
}));

const listed = (t: LetterTemplateDetail): LetterTemplate => ({
  ...omit(t, ["title", "body", "format", "variables"] as const),
  used_by: STEPS.filter((s) => s.letter_template === t.key).map((s) => s.name),
});

function preview(t: LetterTemplateDetail): LetterPreview {
  const run = (text: string, filled = false) => ({ text, filled });
  return {
    reference: "LTR-0000",
    title: t.purpose === "query" ? "Query QRY-0000" : t.name.replace(/ Letter$/, ""),
    date_line: new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Lagos" }).format(new Date()),
    paragraphs:
      t.purpose === "query"
        ? [
            [run("Dear "), run("Ada", true), run(",")],
            [run("You clocked in late on three working days this month.", true)],
            [run("Please explain this in writing by "), run("21/10/2026 17:00", true), run(", in My Queries.")],
          ]
        : [
            [run("Dear "), run("Ada", true), run(",")],
            [run("Following query "), run("QRY-0000", true), run(", this is a "), run(t.name.replace(/ Letter$/, ""), true), run(": "), run("The explanation given was not accepted.", true)],
          ],
  };
}

route("GET /api/v1/letter-templates/summary", () =>
  ok({
    templates: LETTERS.length,
    active: LETTERS.filter((t) => t.status === "active").length,
    awaiting_sample: LETTERS.filter((t) => t.status === "awaiting_sample").length,
    sent_90d: 14,
  }),
);
route("GET /api/v1/letter-templates", (req) =>
  paged(LETTERS.map(listed), req, {
    search: (t) => [t.name, t.key],
    filters: { purpose: (t, v) => t.purpose === v, status: (t, v) => t.status === v },
    sort: { name: (a, b) => a.name.localeCompare(b.name), updated_at: (a, b) => a.updated_at.localeCompare(b.updated_at) },
  }),
);
const letterOf = (id: string) => LETTERS.find((t) => t.letter_template_id === id);
route("GET /api/v1/letter-templates/:id", (req) => {
  const t = letterOf(req.params.id);
  return t ? ok({ ...t, used_by: listed(t).used_by }) : notFound();
});
route("GET /api/v1/letter-templates/:id/preview", (req) => {
  const t = letterOf(req.params.id);
  if (!t) return notFound();
  return t.body ? ok(preview(t)) : fail(409, "TEMPLATE_AWAITING_SAMPLE", "This letter has no wording yet");
});
const configure = (req: Req) => (FULL.has(req.user!) ? null : fail(403, "CAPABILITY_REQUIRED", "You cannot change this"));
route("POST /api/v1/letter-templates", (req) => {
  const refused = configure(req);
  if (refused) return refused;
  const b = req.body as { name?: string; purpose?: "query" | "sanction"; title?: string; body?: string };
  const f: Record<string, string[]> = {};
  if (!b.name?.trim()) f.name = ["Required"];
  if (!b.purpose) f.purpose = ["Choose one"];
  if (!b.body || b.body.trim().length < 40) f.body = ["Write the letter"];
  if (Object.keys(f).length) return invalid(f);
  const key = `${b.name!.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-?letter$/, "")}-letter`;
  const t: LetterTemplateDetail = { letter_template_id: sid(`ltr:${key}:${LETTERS.length}`), key, name: b.name!.trim(), purpose: b.purpose!, status: "draft", version: 1, used_by: [], updated_at: now(), title: b.title ?? null, body: b.body!, format: "markdown", variables: LETTERS[0].variables };
  LETTERS.push(t);
  return created(t);
});
route("PUT /api/v1/letter-templates/:id/body", (req) => {
  const refused = configure(req);
  if (refused) return refused;
  const t = letterOf(req.params.id);
  if (!t) return notFound();
  const b = req.body as { title?: string; body?: string };
  if (!b.body || b.body.trim().length < 40) return invalid({ body: ["Write the letter"] });
  Object.assign(t, { body: b.body, title: b.title ?? t.title, format: "markdown", version: t.version + 1, updated_at: now(), status: t.status === "awaiting_sample" ? "draft" : t.status });
  return ok(t);
});
route("POST /api/v1/letter-templates/:id/activate", (req) => {
  const refused = configure(req);
  if (refused) return refused;
  const t = letterOf(req.params.id);
  if (!t) return notFound();
  if (!t.body) return fail(409, "TEMPLATE_AWAITING_SAMPLE", "Write the letter before it is used");
  t.status = "active";
  return ok(t);
});

/* ------------------------------------------------------------------ *
 * The chain
 * ------------------------------------------------------------------ */

const STEPS: ConsequenceStep[] = (
  [
    ["Caution", "caution-letter", "none", null, 365],
    ["Warning", "warning-letter", "none", null, 365],
    ["Second Warning", "warning-letter", "none", null, 365],
    ["Suspension", "suspension-letter", "unpaid_days", 3, null],
    ["Suspension Without Pay", "suspension-without-pay-letter", "unpaid_days", 5, null],
    ["Dismissal or Termination", "termination-letter", "ends_employment", null, null],
  ] as const
).map(([name, letter, effect, days, valid], i) => ({
  consequence_step_id: sid(`step:${i}`),
  code: name.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
  name,
  position: i + 1,
  letter_template: letter,
  letter_ready: false,
  financial_effect: effect,
  default_days: days,
  valid_days: valid,
  evidence_required: effect !== "none",
  active: true,
  created_at: at(30, "09:00"),
  updated_at: at(30, "09:00"),
}));
const stepView = (s: ConsequenceStep): ConsequenceStep => ({ ...s, letter_ready: LETTERS.some((t) => t.key === s.letter_template && t.status === "active") });
const ordered = () => [...STEPS].sort((a, b) => a.position - b.position);
const renumber = (list: ConsequenceStep[]) => list.forEach((s, i) => ((s.position = i + 1), (s.updated_at = now())));

route("GET /api/v1/sanctions/chain", (req) =>
  paged(ordered().map(stepView), req, { filters: { active: (s, v) => String(s.active) === v }, sort: { position: (a, b) => a.position - b.position } }),
);
route("POST /api/v1/sanctions/chain", (req) => {
  const refused = configure(req);
  if (refused) return refused;
  const b = req.body as Partial<ConsequenceStep> & { name?: string };
  if (!b.name?.trim()) return invalid({ name: ["Required"] });
  const list = ordered();
  const at_ = Math.min(b.position ?? list.length + 1, list.length + 1);
  const s: ConsequenceStep = {
    consequence_step_id: sid(`step:new:${STEPS.length}`), code: b.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_"), name: b.name.trim(), position: at_,
    letter_template: b.letter_template ?? null, letter_ready: false, financial_effect: b.financial_effect ?? "none", default_days: b.default_days ?? null,
    valid_days: b.valid_days ?? null, evidence_required: b.evidence_required ?? false, active: true, created_at: now(), updated_at: now(),
  };
  list.splice(at_ - 1, 0, s);
  STEPS.push(s);
  renumber(list);
  return created(stepView(s));
});
route("PATCH /api/v1/sanctions/chain/:id", (req) => {
  const refused = configure(req);
  if (refused) return refused;
  const s = STEPS.find((x) => x.consequence_step_id === req.params.id);
  if (!s) return notFound();
  const { position, ...rest } = req.body as Partial<ConsequenceStep>;
  Object.assign(s, rest, { updated_at: now() });
  if (position && position !== s.position) {
    const list = ordered().filter((x) => x !== s);
    list.splice(Math.min(position, list.length + 1) - 1, 0, s);
    renumber(list);
  }
  return ok(stepView(s));
});

/* ------------------------------------------------------------------ *
 * Queries
 * ------------------------------------------------------------------ */

type Row = QueryDetail & { _by: string | null };
const RULE_NAME = "Repeated Lateness";

function mk(n: number, who: string, subject: string, by: string | null, daysAgo: number, opts: { status?: QueryDetail["status"]; outcome?: QueryDetail["outcome"]; response?: string; evidence?: EvidenceItem[] } = {}): Row {
  const raised = at(daysAgo, by ? "11:20" : "06:00");
  const status = opts.status ?? "awaiting_response";
  return {
    employee_query_id: sid(`qry:${n}`),
    number: `QRY-${String(n).padStart(4, "0")}`,
    employee: refKey(who),
    subject,
    raised_by: by ? uid(by) : null,
    raised_by_name: nameOf(by),
    query_rule_id: by ? null : sid("rule:0"),
    rule_name: by ? null : RULE_NAME,
    status,
    outcome: opts.outcome ?? null,
    escalated: false,
    response_due_at: new Date(new Date(raised).getTime() + 48 * 3600 * 1000).toISOString(),
    responded_at: opts.response ? at(daysAgo - 1, "08:30") : null,
    created_at: raised,
    details: by ? "There is no clock-out for the shift at the Yaba site." : "Late arrival on three working days (3 in 30 days). Please explain.",
    evidence: opts.evidence ?? [],
    response: opts.response ? { body: opts.response, blocks: blocksOf(`<p>${opts.response}</p>`), submitted_at: at(daysAgo - 1, "08:30") } : null,
    letter_document_id: sid(`ltrdoc:${n}`),
    reminded_at: null,
    reviewed_by_name: status === "resolved" ? "Cynthia Osakunih" : null,
    reviewed_at: status === "resolved" ? at(daysAgo - 2, "15:00") : null,
    workflow_instance_id: null,
    sanction: null,
    next_step: null,
    can_decide: false,
    can_remind: false,
    _by: by,
  };
}
const late = (d: number, m: number): EvidenceItem => ({ label: `Late arrival, ${m} minutes`, date: isoDaysAgo(d) });
const QUERIES: Row[] = [
  mk(14, "bashir", RULE_NAME, null, 2, { evidence: [late(20, 31), late(9, 22), late(2, 41)] }),
  mk(15, "chidera", "Missing clock-out on Thursday", "emeka", 1),
  mk(13, "tobi", RULE_NAME, null, 6, { status: "under_review", response: "The bridge was closed on each of those mornings.", evidence: [late(25, 12), late(14, 18), late(6, 9)] }),
  mk(12, "seyi", "Punch from an unregistered phone", "cynthia", 12, { status: "resolved", outcome: "no_action", response: "My phone was replaced; the new one is now registered." }),
  mk(11, "chidera", "Deadline missed on the Enugu brief", "tolu", 16, { status: "resolved", outcome: "sanctioned", response: "The client changed the brief on the day." }),
];

const SANCTIONS: SanctionDetail[] = [];
function issue(q: Row, stepName: string, daysAgo: number, fine: string | null): SanctionDetail {
  const step = STEPS.find((s) => s.name === stepName)!;
  const s: SanctionDetail = {
    sanction_id: sid(`san:${q.number}`), number: `SAN-${String(SANCTIONS.length + 1).padStart(4, "0")}`, employee: q.employee,
    employee_query_id: q.employee_query_id, query_number: q.number, consequence_step_id: step.consequence_step_id, sanction_type: step.code,
    step_name: step.name, reason: "The explanation was not accepted.", decided_by: uid("cynthia"), decided_by_name: "Cynthia Osakunih",
    effective_on: isoDaysAgo(daysAgo), ends_on: null, status: "issued",
    fine: fine ? { amount_ngn: fine, settlement_status: "pending", settled_at: null } : null, created_at: at(daysAgo, "15:00"),
    evidence: [], letter_document_id: sid(`sanltr:${q.number}`), workflow_instance_id: null, waiting_on: null,
  };
  SANCTIONS.unshift(s);
  q.sanction = { sanction_id: s.sanction_id, number: s.number, step_name: s.step_name, status: s.status };
  return s;
}
issue(QUERIES[4], "Caution", 14, "12500.00");

const raisedBy = (q: Row) => q._by;
const canSee = (user: string, q: { _by?: string | null }) => FULL.has(user) || (!!q._by && q._by === user);
const visible = (user: string) => QUERIES.filter((q) => canSee(user, q));
const findQ = (user: string, id: string) => visible(user).find((q) => q.employee_query_id === id);

/** The rung after the highest one the person holds (guide §6.5). */
function nextStepOf(employeeId: string) {
  const held = SANCTIONS.filter((s) => s.employee.employee_id === employeeId && s.status === "issued")
    .map((s) => STEPS.find((x) => x.consequence_step_id === s.consequence_step_id)?.position ?? 0);
  const top = held.length ? Math.max(...held) : 0;
  const next = ordered().find((s) => s.active && s.position > top);
  return next ? { consequence_step_id: next.consequence_step_id, name: next.name, position: next.position } : null;
}

function view(q: Row, user: string): QueryDetail {
  const rest = omit(q, ["_by"] as const);
  const overdue = new Date(q.response_due_at!).getTime() <= Date.now();
  const decides = FULL.has(user) || user === "emeka";
  return {
    ...rest,
    next_step: q.status === "resolved" ? null : nextStepOf(q.employee.employee_id),
    can_decide: decides && q.status !== "resolved" && !q.escalated && (!!q.response || overdue) && byKey(user)?.employee_id !== q.employee.employee_id,
    can_remind: q.status === "awaiting_response" && !q.response && !q.reminded_at,
  };
}
const listRow = (q: QueryDetail) =>
  omit(q, ["details", "evidence", "response", "letter_document_id", "reminded_at", "reviewed_by_name", "reviewed_at", "workflow_instance_id", "sanction", "next_step", "can_decide", "can_remind"] as const);

route("GET /api/v1/queries/summary", (req) => {
  const list = visible(req.user!);
  const month = new Date().toISOString().slice(0, 7);
  return ok({
    open: list.filter((q) => q.status !== "resolved").length,
    awaiting_response: list.filter((q) => q.status === "awaiting_response").length,
    closed_this_month: list.filter((q) => q.status === "resolved" && (q.reviewed_at ?? "").startsWith(month)).length,
    escalated: list.filter((q) => q.escalated).length,
    by_reason: [
      { label: RULE_NAME, count: list.filter((q) => q.rule_name).length },
      { label: "Raised by a Person", count: list.filter((q) => !q.rule_name).length },
    ].filter((r) => r.count > 0),
  });
});
route("GET /api/v1/queries", (req) => {
  const user = req.user!;
  return paged(visible(user).map((q) => listRow(view(q, user))), req, {
    search: (q) => [q.number, q.employee.display_name, q.subject],
    filters: {
      status: (q, v) => q.status === v,
      employee_id: (q, v) => q.employee.employee_id === v,
      raised: (q, v) => (v === "mine" ? q.raised_by === uid(user) : !!q.query_rule_id),
    },
    sort: {
      created_at: (a, b) => b.created_at.localeCompare(a.created_at),
      number: (a, b) => a.number.localeCompare(b.number),
      response_due_at: (a, b) => String(a.response_due_at).localeCompare(String(b.response_due_at)),
    },
  });
});
route("GET /api/v1/queries/:id", (req) => {
  const q = findQ(req.user!, req.params.id);
  return q ? ok(view(q, req.user!)) : notFound();
});
route("POST /api/v1/queries", (req) => {
  const b = req.body as { employee_id?: string; subject?: string; details?: string };
  const p = byId(b.employee_id);
  const f: Record<string, string[]> = {};
  if (!p) f.employee_id = ["Required"];
  if (!b.subject || b.subject.trim().length < 4) f.subject = ["Name the subject"];
  if (!b.details || b.details.trim().length < 20) f.details = ["Give the facts"];
  if (Object.keys(f).length) return invalid(f);
  if (p!.user_key === req.user) return invalid({ employee_id: ["Not yourself"] });
  const n = Math.max(...QUERIES.map((q) => Number(q.number.slice(4)))) + 1;
  const q = mk(n, p!.user_key, b.subject!.trim(), req.user!, 0);
  Object.assign(q, { details: b.details!.trim(), created_at: now(), response_due_at: new Date(Date.now() + 48 * 3600 * 1000).toISOString() });
  QUERIES.unshift(q);
  return created(view(q, req.user!));
});
route("POST /api/v1/queries/:id/remind", (req) => {
  const q = findQ(req.user!, req.params.id);
  if (!q) return notFound();
  if (q.status !== "awaiting_response" || q.reminded_at) return fail(409, "QUERY_NOT_REMINDABLE", "A reminder cannot be sent now");
  q.reminded_at = now();
  return ok(view(q, req.user!));
});
route("POST /api/v1/queries/:id/decision", (req) => {
  const user = req.user!;
  const q = findQ(user, req.params.id);
  if (!q) return notFound();
  if (!view(q, user).can_decide) return fail(409, "QUERY_NOT_DECIDABLE", "Wait for the response or the deadline");
  const b = req.body as { outcome?: string; reason?: string; consequence_step_id?: string; fine_amount?: string; effective_on?: string; ends_on?: string };
  if (!b.reason || b.reason.trim().length < 10) return invalid({ reason: ["Record the reason"] });
  if (b.outcome === "no_action") {
    Object.assign(q, { status: "resolved", outcome: "no_action", reviewed_at: now(), reviewed_by_name: nameOf(user) });
    return ok(view(q, user));
  }
  const step = STEPS.find((s) => s.consequence_step_id === b.consequence_step_id && s.active);
  if (!step) return invalid({ consequence_step_id: ["Pick the sanction"] });
  if (!stepView(step).letter_ready) return fail(422, "LETTER_NOT_READY", "This sanction's letter is not ready", { consequence_step_id: ["Letter not ready"] });
  const s = issue(q, step.name, 0, b.fine_amount || null);
  Object.assign(s, { number: null, status: "pending_approval", reason: b.reason.trim(), decided_by: uid(user), decided_by_name: nameOf(user), letter_document_id: null, waiting_on: "Operations & People", workflow_instance_id: sid(`wf:${s.sanction_id}`) });
  q.sanction = { sanction_id: s.sanction_id, number: null, step_name: s.step_name, status: "pending_approval" };
  Object.assign(q, { status: "under_review", escalated: true, workflow_instance_id: s.workflow_instance_id });
  return ok(view(q, user));
});

/* ------------------------------------------------------------------ *
 * Rules
 * ------------------------------------------------------------------ */

const RULES: QueryRule[] = (
  [
    [RULE_NAME, "lateness", "count", 3, 30, "active"],
    ["Late Hours", "lateness", "minutes", 300, 31, "draft"],
    ["Missing Clock-Out", "missing_clock_out", "count", 2, 30, "active"],
    ["Absence Without Notice", "absence", "count", 1, 30, "paused"],
    ["Overdue Tasks", "overdue_task", "count", 3, 14, "draft"],
  ] as const
).map(([name, source, measure, threshold, window, state], i) => ({
  query_rule_id: sid(`rule:${i}`), code: name.toLowerCase().replace(/[^a-z0-9]+/g, "_"), name, source_event: source, measure, threshold,
  window_days: window, letter_template: null, state, active: state === "active", activated_at: state === "draft" ? null : at(40, "09:00"),
  fired_this_month: i === 0 ? 2 : 0, created_at: at(41, "09:00"), updated_at: at(40, "09:00"),
}));
const COUNTED = new Set(["lateness", "absence", "missing_clock_out", "unenrolled_device"]);

route("GET /api/v1/query-rules/summary", () =>
  ok({
    active: RULES.filter((r) => r.state === "active").length,
    draft: RULES.filter((r) => r.state === "draft").length,
    fired_this_month: RULES.reduce((n, r) => n + r.fired_this_month, 0),
    queries_raised: QUERIES.filter((q) => q.query_rule_id).length,
  }),
);
route("GET /api/v1/query-rules", (req) =>
  paged(RULES, req, {
    search: (r) => [r.name, r.code],
    filters: { state: (r, v) => r.state === v, source_event: (r, v) => r.source_event === v },
    sort: { name: (a, b) => a.name.localeCompare(b.name), created_at: (a, b) => a.created_at.localeCompare(b.created_at) },
  }),
);
route("GET /api/v1/query-rules/firings", (req) => {
  const firings: QueryRuleFiring[] = QUERIES.filter((q) => q.query_rule_id && canSee(req.user!, q)).map((q) => ({
    employee_query_id: q.employee_query_id, number: q.number, query_rule_id: q.query_rule_id!, rule_name: q.rule_name!, employee: q.employee, status: q.status, created_at: q.created_at,
  }));
  return paged(firings, req, { filters: { query_rule_id: (f, v) => f.query_rule_id === v }, sort: { created_at: (a, b) => b.created_at.localeCompare(a.created_at) } });
});
route("POST /api/v1/query-rules", (req) => {
  const refused = configure(req);
  if (refused) return refused;
  const b = req.body as Partial<QueryRule>;
  const f: Record<string, string[]> = {};
  if (!b.name?.trim()) f.name = ["Required"];
  if (!b.source_event) f.source_event = ["Choose one"];
  if (!(Number(b.threshold) >= 1)) f.threshold = ["At least 1"];
  if (!(Number(b.window_days) >= 1)) f.window_days = ["At least 1 day"];
  if (b.measure === "minutes" && b.source_event !== "lateness") f.measure = ["Lateness only"];
  if (Object.keys(f).length) return invalid(f);
  const r: QueryRule = {
    query_rule_id: sid(`rule:new:${RULES.length}`), code: b.name!.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_"), name: b.name!.trim(), source_event: b.source_event!,
    measure: b.measure ?? "count", threshold: Number(b.threshold), window_days: Number(b.window_days), letter_template: b.letter_template ?? null, state: "draft",
    active: false, activated_at: null, fired_this_month: 0, created_at: now(), updated_at: now(),
  };
  RULES.push(r);
  return created(r);
});
const ruleOf = (id: string) => RULES.find((r) => r.query_rule_id === id);
route("PATCH /api/v1/query-rules/:id", (req) => {
  const refused = configure(req);
  if (refused) return refused;
  const r = ruleOf(req.params.id);
  if (!r) return notFound();
  Object.assign(r, req.body, { updated_at: now() });
  return ok(r);
});
route("POST /api/v1/query-rules/:id/activate", (req) => {
  const refused = configure(req);
  if (refused) return refused;
  const r = ruleOf(req.params.id);
  if (!r) return notFound();
  if (!COUNTED.has(r.source_event)) return fail(409, "TRIGGER_NOT_AVAILABLE", "This trigger is not counted yet", { source_event: ["Comes with M2"] });
  Object.assign(r, { state: "active", active: true, activated_at: r.activated_at ?? now() });
  return ok(r);
});
route("POST /api/v1/query-rules/:id/pause", (req) => {
  const refused = configure(req);
  if (refused) return refused;
  const r = ruleOf(req.params.id);
  if (!r) return notFound();
  Object.assign(r, { state: "paused", active: false });
  return ok(r);
});

/* ------------------------------------------------------------------ *
 * Sanctions
 * ------------------------------------------------------------------ */

const raiserOfSanction = (s: SanctionDetail) => raisedBy(QUERIES.find((q) => q.employee_query_id === s.employee_query_id)!);
const visibleSanctions = (user: string) => SANCTIONS.filter((s) => FULL.has(user) || raiserOfSanction(s) === user);
const sanctionRow = (s: SanctionDetail) => omit(s, ["evidence", "letter_document_id", "workflow_instance_id", "waiting_on"] as const);

route("GET /api/v1/sanctions/summary", (req) => {
  const list = visibleSanctions(req.user!);
  const sum = (rows: SanctionDetail[]) => rows.reduce((n, s) => n + Number(s.fine?.amount_ngn ?? 0), 0).toFixed(2);
  return ok({
    active: list.filter((s) => s.status === "issued").length,
    pending_approval: list.filter((s) => s.status === "pending_approval").length,
    fines_this_year: sum(list.filter((s) => s.status === "issued")),
    fines_recovered: sum(list.filter((s) => s.fine?.settlement_status === "settled")),
  });
});
route("GET /api/v1/sanctions/standing", (req) => {
  if (!FULL.has(req.user!)) return notFound();
  const who = req.query.employee_id;
  const held = SANCTIONS.filter((s) => s.employee.employee_id === who && s.status === "issued");
  return ok({
    employee_id: who,
    in_force: held.map((s) => ({ sanction_id: s.sanction_id, number: s.number!, step_name: s.step_name, position: STEPS.find((x) => x.consequence_step_id === s.consequence_step_id)?.position ?? 1, effective_on: s.effective_on, in_force_until: null })),
    next_step: nextStepOf(who),
  });
});
route("GET /api/v1/sanctions", (req) =>
  paged(visibleSanctions(req.user!).map(sanctionRow), req, {
    search: (s) => [s.number, s.query_number, s.employee.display_name, s.step_name, s.reason],
    filters: { status: (s, v) => s.status === v, employee_id: (s, v) => s.employee.employee_id === v, consequence_step_id: (s, v) => s.consequence_step_id === v },
    sort: { effective_on: (a, b) => b.effective_on.localeCompare(a.effective_on), created_at: (a, b) => b.created_at.localeCompare(a.created_at) },
  }),
);
route("GET /api/v1/sanctions/:id", (req) => {
  const s = visibleSanctions(req.user!).find((x) => x.sanction_id === req.params.id);
  return s ? ok(s) : notFound();
});

/* ------------------------------------------------------------------ *
 * ESS · My Queries: the same queries, as the person they are about
 * ------------------------------------------------------------------ */

const mine = (user: string) => QUERIES.filter((q) => q.employee.employee_id === userOf(user));
const mySanctions = (user: string) => SANCTIONS.filter((s) => s.employee.employee_id === userOf(user) && s.status === "issued");
const myQuery = (q: Row): MyQuery => ({
  employee_query_id: q.employee_query_id, number: q.number, subject: q.subject, details: q.details, status: q.status, outcome: q.outcome,
  response_due_at: q.response_due_at, response: q.response, letter_document_id: q.letter_document_id, sanction: q.sanction,
  can_respond: q.status === "awaiting_response" && !q.response, created_at: q.created_at,
});

route("GET /api/v1/ess/queries/summary", (req) => {
  const list = mine(req.user!);
  const sanctions = mySanctions(req.user!);
  return ok({
    open: list.filter((q) => q.status !== "resolved").length,
    archived: list.filter((q) => q.status === "resolved").length,
    sanctions: sanctions.length,
    last_sanction: sanctions[0]?.effective_on ?? null,
  });
});
route("GET /api/v1/ess/queries", (req) =>
  // Open ones first, then newest first, as the API orders them.
  paged([...mine(req.user!)].sort((a, b) => Number(a.status === "resolved") - Number(b.status === "resolved") || b.created_at.localeCompare(a.created_at)).map(myQuery), req, { filters: { status: (q, v) => (v === "open" ? q.status !== "resolved" : q.status === "resolved") } }),
);
route("POST /api/v1/ess/queries/:id/response", (req) => {
  const q = mine(req.user!).find((x) => x.employee_query_id === req.params.id);
  if (!q) return notFound();
  if (q.status !== "awaiting_response" || q.response) return fail(409, "QUERY_ALREADY_ANSWERED", "You have already responded");
  const blocks = blocksOf(String(req.body.body_html ?? ""));
  const words = blocks.flatMap((b) => (b.kind === "bullets" || b.kind === "numbered" ? b.items.flat() : b.spans)).map((s) => s.text).join(" ").trim();
  if (words.length < 20) return invalid({ body_html: ["Write your response"] });
  Object.assign(q, { response: { body: words, blocks, submitted_at: now() }, responded_at: now(), status: "under_review" });
  return ok(myQuery(q));
});
route("GET /api/v1/ess/sanctions", (req) =>
  paged(
    mySanctions(req.user!).map(
      (s): MySanction => ({ sanction_id: s.sanction_id, number: s.number!, step_name: s.step_name, reason: s.reason, query_number: s.query_number, effective_on: s.effective_on, ends_on: s.ends_on, fine: s.fine, letter_document_id: s.letter_document_id }),
    ),
    req,
  ),
);
