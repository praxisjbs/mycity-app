import type { Goal, KpiAssignment, ReviewRow, Status, Step, Target, Trail } from "@/api/types/performance";
import { at, created, fail, invalid, notFound, ok, paged, route, sid, isoDaysAhead } from "../core";
import { byId, PEOPLE, refKey } from "../data/people";

const S = (tone: Status["tone"], text: string): Status => ({ tone, text });
const step = (label: string, state: Step["state"] = null): Step => ({ label, state });
const CEO = new Set(["ifeoma"]);

const GOALS: Goal[] = [
  ["ORG-2026-01", "organisational", "Growth", "Reach 2 million active residents", "Monthly active users", "1.1M", "CEO", null, null, S("ok", "On track")],
  ["ORG-2026-02", "organisational", "Revenue", "Partnership revenue of ₦180M", "Signed partnership value", "₦96M", "CEO", null, null, S("warn", "At risk")],
  ["ORG-2026-03", "organisational", "Expansion", "Operate in 12 Nigerian cities", "Cities live", "8", "CEO", null, null, S("ok", "On track")],
  ["ORG-2026-04", "organisational", "Technology", "Ship the operations platform", "Milestones accepted", "0 of 11", "CTO", null, null, S("ok", "On track")],
  ["ORG-2026-05", "organisational", "People", "Build a 40 person team", "Headcount", "25", "CEO", null, null, S("ok", "On track")],
  [null, "annual", null, "Operational readiness for 4 new cities", null, null, "Management", "ORG-2026-03", "Enugu and Kano live", S("ok", "On track")],
  [null, "annual", null, "Sign 12 strategic partnerships", null, null, "Management", "ORG-2026-02", "5 signed, 3 in review", S("warn", "At risk")],
  [null, "annual", null, "Platform handover complete", null, null, "Management", "ORG-2026-04", "M11 by 18/12", S("ok", "On track")],
  [null, "annual", null, "Grow the team to 40", null, null, "Management", "ORG-2026-05", "4 vacancies open", S("ok", "On track")],
].map((g, i) => ({ goal_id: sid(`goal:${i}`), code: g[0] as string | null, level: g[1] as Goal["level"], theme: g[2] as string | null, title: g[3] as string, measure: g[4] as string | null, baseline: g[5] as string | null, owner: g[6] as string, rolls_up_to: g[7] as string | null, cascade_note: g[8] as string | null, status: g[9] as Status }));

const month = () => new Date().toISOString().slice(0, 7);
const TARGETS: Target[] = [
  ["Operations", "Reduce approval turnaround to 2 days", "Operational readiness", "cynthia", "Average days", false],
  ["Marketing & Sales", "8 new prospects, 3 proposals sent", "Sign 12 partnerships", "ngozi", "Count", false],
  ["Content", "24 pieces published for Ember to Remember", "Reach 2M residents", "tolu", "Count", true],
  ["Engineering", "Ship M1 and M2 to staging", "Platform handover", "seyi", "Milestones", true],
  ["Studio", "12 shoot days across Lagos and Enugu", "Reach 2M residents", "emeka", "Days", true],
  ["Finance", "Close the month's books by the 5th", "Operational readiness", "amara", "Date", true],
].map((t, i) => ({ target_id: sid(`target:${i}`), month: month(), department: t[0] as string, title: t[1] as string, rolls_up_to: t[2] as string, set_by: refKey(t[3] as string), measure: t[4] as string, status: t[5] ? S("ok", "Approved") : S("warn", "Awaiting CEO"), can_approve: false }));

const KPIS: Array<KpiAssignment & { _m: string }> = [
  ["tolu", "24 pieces published", 40, "18 of 24", "ifeoma", "ok"],
  ["bashir", "3 MOUs signed", 35, "1 of 3", "ngozi", "err"],
  ["amara", "Close books by the 5th", 50, "In progress", "cynthia", "ok"],
  ["grace", "8 new prospects", 30, "6 of 8", "bashir", "ok"],
  ["emeka", "12 shoot days", 45, "7 of 12", "ngozi", "warn"],
  ["adedotun", "Ember to Remember assets", 40, "On track", "ngozi", "ok"],
  ["chidera", "12 pieces published", 40, "7 of 12", "tolu", "warn"],
  ["chidera", "Enugu brief", 20, "Due on the 18th", "tolu", "ok"],
  ["chidera", "Social copy", 20, "9 of 15", "tolu", "ok"],
  ["chidera", "Probation objectives", 20, "2 of 3", "cynthia", "ok"],
  ["seyi", "M1 and M2 on staging", 50, "1 of 2", "ifeoma", "ok"],
  ["kemi", "16 articles published", 50, "11 of 16", "tolu", "ok"],
  ["obinna", "Staff app screens shipped", 40, "70%", "seyi", "ok"],
  ["hauwa", "Tickets closed within a day", 50, "91%", "cynthia", "ok"],
  ["funke", "Reconcile 3 bank accounts", 40, "2 of 3", "amara", "ok"],
  ["yusuf", "8 videos delivered", 50, "3 of 8", "emeka", "warn"],
  ["damilola", "Onboard 2 starters", 40, "1 of 2", "cynthia", "ok"],
].map((k, i) => ({ kpi_id: sid(`kpi:${i}`), employee: refKey(k[0] as string), title: k[1] as string, weight_pct: k[2] as number, progress: k[3] as string, set_by: refKey(k[4] as string), status: k[5] === "ok" ? S("ok", "On track") : k[5] === "warn" ? S("warn", "At risk") : S("err", "Behind"), _m: k[0] as string }));

const REVIEWS: ReviewRow[] = [
  ["tolu", "Q3 2026", "4.2", "4.0", "Approved", "closed"],
  ["bashir", "Q3 2026", "3.6", "3.2", "Approved", "closed"],
  ["amara", "Q3 2026", "4.5", "4.4", "Approved", "closed"],
  ["adedotun", "Q3 2026", "4.1", "4.0", "Approved", "closed"],
  ["seyi", "Q3 2026", "4.0", "4.0", "Approved", "closed"],
  ["hauwa", "Q3 2026", "4.3", "4.1", "Approved", "closed"],
  ["grace", "Q4 2026", null, null, null, "opens"],
  ["emeka", "Q4 2026", null, null, null, "opens"],
  ["chidera", "Q4 2026", null, null, null, "opens"],
].map((r, i) => ({ review_id: sid(`review:${i}`), employee: refKey(r[0] as string), cycle: r[1] as string, self_rating: r[2], manager_rating: r[3], second_level: r[4], status: r[5] === "closed" ? S("ok", "Closed") : S("neutral", "Opens on the 20th") }));
let CYCLE = { cycle: "Q4 2026", opens_on: isoDaysAhead(5), last_cycle: "18 of 25", average_rating: "3.9" };

route("GET /api/v1/performance/goals/summary", () =>
  ok({
    cascade: [step("Organisational", "done"), step("Annual", "done"), step("Monthly", "done"), step("Departmental", "now"), step("Individual KPI"), step("Weekly task")],
    progress: [
      { label: "Growth, 2M residents", pct: 55, value: "1.1M of 2M" },
      { label: "Revenue, ₦180M", pct: 53, value: "₦96M of ₦180M", emphasis: "warn" },
      { label: "Expansion, 12 cities", pct: 66, value: "8 of 12" },
      { label: "Technology, 11 milestones", pct: 0, value: "0 of 11" },
      { label: "People, 40 staff", pct: 62, value: "25 of 40" },
    ],
  }),
);
route("GET /api/v1/performance/goals", (req) => paged(GOALS, req, { search: (g) => [g.title, g.code, g.theme], filters: { level: (g, v) => g.level === v } }));
route("POST /api/v1/performance/goals", (req) => {
  const b = req.body as { level?: string; title?: string; theme?: string; measure?: string; baseline?: string; rolls_up_to?: string };
  if (!b.title || String(b.title).trim().length < 4) return invalid({ title: ["Say what the goal is"] });
  if (b.level === "organisational" && !CEO.has(req.user!)) return fail(403, "FORBIDDEN", "Only the CEO sets organisational goals.");
  const parent = GOALS.find((g) => g.goal_id === b.rolls_up_to);
  if (b.level === "annual" && !parent) return invalid({ rolls_up_to: ["An annual goal rolls up to an organisational goal"] });
  const n = GOALS.filter((g) => g.level === "organisational").length + 1;
  const g: Goal = { goal_id: sid(`goal:new:${GOALS.length}`), code: b.level === "organisational" ? `ORG-2026-${String(n).padStart(2, "0")}` : null, level: b.level as Goal["level"], theme: b.theme ?? null, title: b.title, measure: b.measure ?? null, baseline: b.baseline ?? null, owner: b.level === "organisational" ? "CEO" : "Management", rolls_up_to: parent?.code ?? null, cascade_note: null, status: S("neutral", "Draft") };
  GOALS.push(g);
  return created(g);
});

const trail: Trail[] = [
  { title: "Operations target submitted", when: at(1, "11:20"), text: "Cynthia Osakunih. With the CEO.", tone: "hi" },
  { title: "Marketing target submitted", when: at(2, "16:40"), text: "Ngozi Eze. With the CEO.", tone: "hi" },
  { title: "Content target approved", when: at(1, "16:40"), text: "Ifeoma Chukwu. Dispatched to 5 staff.", tone: "ok" },
  { title: "Engineering target approved", when: at(1, "16:38"), text: "Ifeoma Chukwu.", tone: "ok" },
  { title: "Studio and Finance approved", when: at(2, "09:12"), text: "Ifeoma Chukwu.", tone: "ok" },
];
route("GET /api/v1/performance/targets/summary", () => {
  const approved = TARGETS.filter((t) => t.status.text === "Approved").length;
  return ok({
    month: month(), departments: TARGETS.length, approved, awaiting: TARGETS.length - approved,
    chain: [step("Managers set", "done"), step("COO review", "done"), step("Operations review", approved < TARGETS.length ? "now" : "done"), step("CEO approval", approved === TARGETS.length ? "done" : null), step("Binding", approved === TARGETS.length ? "now" : null)],
    last_month: [
      { label: "Content", pct: 104, value: "104% of target", emphasis: "brand" }, { label: "Engineering", pct: 96, value: "96%" }, { label: "Finance", pct: 100, value: "100%" },
      { label: "Operations", pct: 88, value: "88%" }, { label: "Studio", pct: 75, value: "75%" }, { label: "Marketing & Sales", pct: 62, value: "62%", emphasis: "warn" },
    ],
    trail,
  });
});
route("GET /api/v1/performance/targets", (req) => paged(TARGETS.map((t) => ({ ...t, can_approve: CEO.has(req.user!) && t.status.text !== "Approved" })), req, { search: (t) => [t.department, t.title], filters: { month: (t, v) => t.month === v } }));
route("POST /api/v1/performance/targets", (req) => {
  const b = req.body as { department?: string; title?: string; measure?: string; rolls_up_to?: string; month?: string };
  const fields: Record<string, string[]> = {};
  if (!b.department) fields.department = ["Pick the department"];
  if (!b.title || b.title.trim().length < 4) fields.title = ["Say what the target is"];
  if (!b.measure) fields.measure = ["How is it measured"];
  const parent = GOALS.find((g) => g.goal_id === b.rolls_up_to);
  if (!parent) fields.rolls_up_to = ["Every target names the goal above it"];
  if (Object.keys(fields).length) return invalid(fields);
  const p = PEOPLE.find((x) => x.user_key === req.user)!;
  const t: Target = { target_id: sid(`target:new:${TARGETS.length}`), month: b.month ?? month(), department: b.department!, title: b.title!, rolls_up_to: parent!.title, set_by: refKey(p.user_key), measure: b.measure!, status: S("warn", "Awaiting CEO"), can_approve: false };
  TARGETS.push(t);
  trail.unshift({ title: `${t.department} target submitted`, when: new Date().toISOString(), text: `${p.display_name}. With the CEO.`, tone: "hi" });
  return created(t);
});
route("POST /api/v1/performance/targets/:id/approve", (req) => {
  if (!CEO.has(req.user!)) return fail(403, "FORBIDDEN", "Only the CEO approves targets.");
  const t = TARGETS.find((x) => x.target_id === req.params.id);
  if (!t) return notFound();
  t.status = S("ok", "Approved");
  trail.unshift({ title: `${t.department} target approved`, when: new Date().toISOString(), text: "Ifeoma Chukwu. Dispatched to the department.", tone: "ok" });
  return ok(t);
});

route("GET /api/v1/performance/kpis/summary", () => {
  const staff = new Set(KPIS.map((k) => k._m));
  return ok({
    with_kpis: staff.size, staff: PEOPLE.length, weights_valid: true, on_track: KPIS.filter((k) => k.status.tone === "ok").length, behind: KPIS.filter((k) => k.status.tone !== "ok").length,
    sources: [{ label: "Tasks linked to the KPI and closed", count: 42 }, { label: "A figure entered by the manager", count: 11 }, { label: "A date met or missed", count: 6 }, { label: "Nothing linked yet", count: 4 }],
  });
});
route("GET /api/v1/performance/kpis", (req) => paged(KPIS.map(({ _m, ...k }) => (void _m, k)), req, { search: (k) => [k.employee.display_name, k.title], filters: { department: (k, v) => k.employee.department === v } }));
const empKpis = (id: string) => {
  const p = byId(id);
  if (!p) return null;
  const items = KPIS.filter((k) => k._m === p.user_key).map((k) => ({ kpi_id: k.kpi_id, title: k.title, weight_pct: k.weight_pct }));
  return { employee: refKey(p.user_key), items, total_pct: items.reduce((s, k) => s + k.weight_pct, 0) };
};
route("GET /api/v1/performance/kpis/employees/:id", (req) => {
  const e = empKpis(req.params.id);
  return e ? ok(e) : notFound();
});
route("POST /api/v1/performance/kpis/assign", (req) => {
  const b = req.body as { employee_id?: string; items?: Array<{ title: string; weight_pct: number }> };
  const p = byId(b.employee_id);
  if (!p) return invalid({ employee_id: ["Pick the employee"] });
  const items = (b.items ?? []).filter((x) => x.title?.trim());
  if (!items.length) return invalid({ items: ["Add at least one KPI"] });
  const total = items.reduce((s, x) => s + Number(x.weight_pct || 0), 0);
  if (total !== 100) return invalid({ items: [`Weights total ${total}%. They must total 100%`] });
  for (let i = KPIS.length - 1; i >= 0; i--) if (KPIS[i]._m === p.user_key) KPIS.splice(i, 1);
  items.forEach((x, i) => KPIS.push({ kpi_id: sid(`kpi:${p.user_key}:${Date.now()}:${i}`), employee: refKey(p.user_key), title: x.title, weight_pct: Number(x.weight_pct), progress: "Not started", set_by: refKey(req.user!), status: S("ok", "On track"), _m: p.user_key }));
  return created(empKpis(p.employee_id));
});

route("GET /api/v1/performance/reviews/summary", () => ok({ ...CYCLE, chain: [step("Employee self rating", "now"), step("Manager approval"), step("Second level"), step("People")] }));
route("GET /api/v1/performance/reviews", (req) => paged(REVIEWS, req, { search: (r) => [r.employee.display_name], filters: { cycle: (r, v) => r.cycle === v } }));
route("POST /api/v1/performance/reviews/cycles", (req) => {
  const b = req.body as { name?: string; opens_on?: string };
  if (!b.name || !b.opens_on) return invalid({ ...(b.name ? {} : { name: ["Name the cycle"] }), ...(b.opens_on ? {} : { opens_on: ["Pick the day it opens"] }) });
  CYCLE = { ...CYCLE, cycle: b.name, opens_on: b.opens_on };
  return created({ ...CYCLE, chain: [step("Employee self rating", "now"), step("Manager approval"), step("Second level"), step("People")] });
});

route("GET /api/v1/performance/analytics", () =>
  ok({
    goals_on_track: "11 of 14", reviews_completed: "18 of 25", average_self: "4.1", average_manager: "3.9",
    completion: { labels: ["May", "Jun", "Jul", "Aug", "Sep", "Oct"], values: [52, 58, 61, 67, 71, 78] },
    by_department: [
      { label: "Content", pct: 88, value: "88%" }, { label: "Engineering", pct: 81, value: "81%" }, { label: "Operations", pct: 76, value: "76%" },
      { label: "Finance", pct: 72, value: "72%" }, { label: "Marketing & Sales", pct: 58, value: "58%", emphasis: "warn" }, { label: "Studio", pct: 66, value: "66%" },
    ],
    gap: [["Content", "4.3", "4.0", "-0.3"], ["Finance", "4.5", "4.4", "-0.1"], ["Engineering", "4.0", "4.0", "0.0"], ["Operations", "4.1", "3.9", "-0.2"], ["Marketing & Sales", "4.0", "3.6", "-0.4"], ["Studio", "3.8", "3.7", "-0.1"]].map(([department, self, manager, gap]) => ({ department, self, manager, gap })),
    gap_cycle: "Q3 2026",
  }),
);
