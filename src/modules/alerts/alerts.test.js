"use strict";
/**
 * Home · Alerts without a database (docs/guides/home.md §5, §6 Alerts, §7, §9): the metric
 * registry against the contract, what each metric reads and how its breaches read on the
 * screen, a rule's key, Who Can Clear, the Attendance policy's kept rules, the routes and their
 * checks, the events and the jobs.
 * The reads, the writes and the sweep run against the real migrations in
 * tests/integration/home-alerts.test.js.
 */
const c = require("@mycity/contract");
const catalogue = require("../../shared/events/catalogue");
const outbox = require("../../shared/events/outbox");
const { checkStatement } = require("../../../scripts/check/schema-drift");
const { buildCatalogue } = require("../../../scripts/check/lib/catalogue");
const metrics = require("./alerts.metrics");
const service = require("./alerts.service");
const { EVENTS } = require("./alerts.events");

const { alerts: contract } = c;
const ID = "8a6e0804-2bd0-4672-b79d-d97027f9071a";
const OTHER = "1d2b9f3c-6a4e-4f0b-9a51-7c2d8e0f3a14";
const TODAY = "2026-10-14";

afterEach(() => jest.restoreAllMocks());

/** A client that records each statement and answers with `rows`. */
function recording(rows = []) {
  const statements = [];
  return {
    statements,
    query: async (sql, params) => {
      statements.push({ sql, params });
      return { rows };
    },
  };
}

const rule = (over = {}) => ({
  home_alert_rule_id: ID,
  key: "approval_ageing.three_days",
  threshold: "3",
  window_days: null,
  severity: "medium",
  permission_key: "people.view",
  enabled: true,
  ...over,
});

/* ------------------------------------------------------------------ *
 * The registry
 * ------------------------------------------------------------------ */

describe("the metric registry", () => {
  test("is the contract's list: the same keys in the same order, each with the contract's facts", () => {
    expect(Object.keys(metrics.METRICS)).toEqual(Object.keys(contract.HOME_ALERT_METRICS));
    expect(Object.keys(metrics.METRICS)).toEqual(contract.HomeAlertMetric.options);
    for (const [key, shared] of Object.entries(contract.HOME_ALERT_METRICS))
      expect([key, metrics.METRICS[key]]).toEqual([key, expect.objectContaining({ key, ...shared })]);
  });

  test("each names its subject, the module, milestone and owner of its tables, and reads", () => {
    const owners = new Set(["GE", "TB", "LA", "AJ"]);
    for (const m of Object.values(metrics.METRICS)) {
      expect([m.key, typeof m.evaluate]).toEqual([m.key, "function"]);
      expect([m.key, typeof m.subject, m.owner.milestone]).toEqual([m.key, "string", expect.stringMatching(/^M\d+$/)]);
      expect([m.key, owners.has(m.owner.by)]).toEqual([m.key, true]);
      expect(contract.HOME_ALERT_CATEGORIES).toContain(m.category);
    }
    expect(metrics.METRICS.partner_inactivity.owner).toEqual({ module: "partners", milestone: "M7", by: "GE" });
    expect(metrics.METRICS.budget_threshold.owner).toEqual({ module: "budgets", milestone: "M8", by: "AJ" });
    expect(metrics.METRICS.recruitment_sla.owner).toEqual({ module: "vacancies", milestone: "M4", by: "TB" });
  });

  test("attendance's metrics are gone: none reads one person, none counts over days (T1)", () => {
    expect(Object.keys(metrics.METRICS)).not.toContain("late_arrivals");
    expect(Object.keys(metrics.METRICS)).not.toContain("missing_clock_out");
    expect(Object.values(metrics.METRICS).filter((m) => m.per_person)).toEqual([]);
    expect(Object.values(metrics.METRICS).filter((m) => m.window)).toEqual([]);
    const deadlines = Object.values(metrics.METRICS).filter((m) => m.kind === "deadline").map((m) => m.key);
    expect(deadlines).toEqual(["document_expiry", "confirmation_due", "contract_ending"]);
  });

  test("a metric is found by key, a rule's from before the list is not, and a category names its metrics", () => {
    expect(metrics.metricOf("approval_ageing").key).toBe("approval_ageing");
    expect(metrics.metricOf("late_arrivals")).toBeNull();
    expect(metrics.metricOf("toString")).toBeNull();
    expect(metrics.metricsIn("people")).toEqual(["confirmation_due", "contract_ending"]);
    // Attendance's alerts are the policy's, on the rules the system keeps for it.
    expect(metrics.metricsIn("attendance")).toEqual(["attendance_policy"]);
    expect(metrics.categoryOf("attendance_policy")).toBe("attendance");
    expect(metrics.categoryOf("late_arrivals")).toBeNull();
    expect(metrics.isPolicy("attendance_policy")).toBe(true);
  });

  test("the policy's kept rules: one per consequence rule, named as the policy names it, one breach one alert", () => {
    expect(metrics.POLICY).toMatchObject({
      metric: contract.HOME_ALERT_POLICY_METRIC,
      rules: contract.HOME_ALERT_POLICY_RULES,
      threshold: "1",
      severity: "medium",
      permission_key: "people.approve",
    });
    expect(Object.keys(metrics.POLICY.names)).toEqual([...contract.HOME_ALERT_POLICY_RULES]);
    expect(Object.keys(contract.HOME_ALERT_METRICS)).not.toContain(contract.HOME_ALERT_POLICY_METRIC);
  });
});

/* ------------------------------------------------------------------ *
 * What each metric reads
 * ------------------------------------------------------------------ */

describe("what each metric reads", () => {
  const schema = buildCatalogue();

  test.each(Object.keys(contract.HOME_ALERT_METRICS))("%s reads migrated columns, in batches", async (key) => {
    const client = recording();
    const r = rule({ window_days: null, threshold: "30" });
    expect(await metrics.METRICS[key].evaluate(client, r, { today: TODAY, after: null })).toEqual({
      readings: [],
      next: null,
    });
    expect(client.statements).toHaveLength(1);
    const [{ sql, params }] = client.statements;
    expect([key, checkStatement(sql, schema).map((f) => f.ref)]).toEqual([key, []]);
    expect(sql).toMatch(/LIMIT \$\d+ -- pagination:batch /);
    expect(params).toContain(metrics.BATCH);
  });

  test("a full batch hands back the cursor for the next; a short one ends it", async () => {
    const rows = Array.from({ length: metrics.BATCH }, (_, i) => ({
      workflow_instance_id: i === metrics.BATCH - 1 ? OTHER : ID,
      entity_type: "leave_request",
      entity_id: ID,
      subject_employee_id: ID,
      current_stage: "manager",
      stage_entered_at: new Date("2026-10-09T16:00:00Z"),
      definition_name: "Leave Request",
      stages: [{ key: "manager", name: "Line Manager" }],
      first_name: "A",
      last_name: "B",
    }));
    const full = await metrics.METRICS.approval_ageing.evaluate(recording(rows), rule(), { today: TODAY });
    expect(full.next).toBe(OTHER);
    const short = await metrics.METRICS.approval_ageing.evaluate(recording(rows.slice(0, 3)), rule(), { today: TODAY });
    expect(short.next).toBeNull();
  });

  test("an approval's age is whole Lagos days at its stage, about the record waiting", async () => {
    const entered = new Date("2026-10-09T16:00:00Z");
    const client = recording([
      {
        workflow_instance_id: OTHER,
        entity_type: "leave_request",
        entity_id: ID,
        subject_employee_id: ID,
        current_stage: "manager",
        stage_entered_at: entered,
        definition_name: "Leave Request",
        stages: [{ key: "manager", name: "Line Manager" }],
        first_name: "Ada",
        last_name: "Obi",
      },
    ]);
    const { readings } = await metrics.METRICS.approval_ageing.evaluate(client, rule({ threshold: "2.5" }), {
      today: TODAY,
    });
    // Waiting since the 9th: reached two and a half days on the 12th, so the cutoff is the 11th's end.
    expect(client.statements[0].params[0]).toEqual(new Date("2026-10-11T23:00:00Z"));
    expect(readings).toEqual([
      {
        subject: { type: "leave_request", id: ID },
        subject_employee_id: ID,
        value: 5,
        title: "Leave Request for Ada Obi: waiting 5 days",
        trigger: "At Line Manager since 09/10/2026",
        since: entered,
      },
    ]);
  });

  test("a deadline reads the days left, and a passed date reads as passed", async () => {
    const r = rule({ threshold: "30", window_days: null });
    const client = recording([
      { employee_id: ID, first_name: "Ada", last_name: "Obi", due_on: "2026-11-02" },
      { employee_id: OTHER, first_name: "Musa", last_name: "Bello", due_on: "2026-10-01" },
    ]);
    const { readings } = await metrics.METRICS.contract_ending.evaluate(client, r, { today: TODAY });
    expect(client.statements[0].params[0]).toBe("2026-11-13");
    expect(readings.map(({ value, title, trigger, since }) => ({ value, title, trigger, since }))).toEqual([
      {
        value: 19,
        title: "Ada Obi: contract ending",
        trigger: "Ends on 02/11/2026",
        since: new Date("2026-10-02T23:00:00Z"),
      },
      {
        value: -13,
        title: "Musa Bello: contract ending",
        trigger: "Ended on 01/10/2026",
        since: new Date("2026-08-31T23:00:00Z"),
      },
    ]);
  });

  test("a document is about its person when it has one, and reads its title", async () => {
    const client = recording([
      { document_id: ID, title: "Passport", expires_on: "2026-10-20", subject_employee_id: OTHER, first_name: "Ada", last_name: "Obi" },
      { document_id: OTHER, title: "Lease", expires_on: "2026-10-20", subject_employee_id: null, first_name: null, last_name: null },
    ]);
    const { readings } = await metrics.METRICS.document_expiry.evaluate(client, rule({ threshold: "30" }), {
      today: TODAY,
    });
    expect(readings.map((x) => [x.subject, x.subject_employee_id, x.title, x.trigger, x.value])).toEqual([
      [{ type: "document", id: ID }, OTHER, "Ada Obi: Passport", "Expires on 20/10/2026", 6],
      [{ type: "document", id: OTHER }, null, "Lease", "Expires on 20/10/2026", 6],
    ]);
  });

  test("the later milestones read through Home's source adapters, about no one in particular", async () => {
    const partner = recording([
      { partner_id: ID, name: "Kano Trade Council", last_contact_at: new Date("2026-08-31T10:00:00Z") },
    ]);
    const quiet = await metrics.METRICS.partner_inactivity.evaluate(partner, rule({ threshold: "30" }), { today: TODAY });
    expect(quiet.readings[0]).toMatchObject({
      subject: { type: "partner", id: ID },
      subject_employee_id: null,
      value: 44,
      title: "Kano Trade Council: no contact in 44 days",
      trigger: "Last contact on 31/08/2026",
    });

    const budget = recording([
      { budget_id: ID, name: "Field Operations", starts_on: "2026-10-01", allocated: "1000000.00", spent: "855000.00", used: "85.50" },
    ]);
    const spent = await metrics.METRICS.budget_threshold.evaluate(budget, rule({ threshold: "80" }), { today: TODAY });
    expect(spent.readings[0]).toMatchObject({
      subject: { type: "budget", id: ID },
      subject_employee_id: null,
      value: "85.50",
      title: "Field Operations: 85.5% spent",
      since: new Date("2026-09-30T23:00:00Z"),
    });
    expect(spent.readings[0].trigger).toMatch(/855,000\.00 of .*1,000,000\.00$/);
    expect(budget.statements[0].params.slice(0, 2)).toEqual([TODAY, "80"]);

    const applications = recording([
      {
        application_id: ID,
        first_name: "Zainab",
        last_name: "Lawal",
        vacancy: "Field Officer",
        stage: "Interview",
        current_stage_entered_at: new Date("2026-10-01T09:00:00Z"),
      },
    ]);
    const stalled = await metrics.METRICS.recruitment_sla.evaluate(applications, rule({ threshold: "7" }), {
      today: TODAY,
    });
    expect(stalled.readings[0]).toMatchObject({
      subject: { type: "application", id: ID },
      subject_employee_id: null,
      value: 13,
      title: "Zainab Lawal, Field Officer: 13 days at Interview",
      trigger: "At Interview since 01/10/2026",
    });
  });
});

/* ------------------------------------------------------------------ *
 * Keys and labels
 * ------------------------------------------------------------------ */

describe("a rule's key and Who Can Clear", () => {
  test("the key is the metric and the name, folded to lower snake case", () => {
    expect(service.slugOf("Late Arrivals: 3 in 30!")).toBe("late_arrivals_3_in_30");
    expect(service.slugOf("Ọ̀rọ̀ Àgbà")).toBe("oro_agba");
    expect(service.slugOf("!!!")).toBe("rule");
    expect(service.slugOf("x".repeat(60))).toHaveLength(40);
    expect(service.keyFor("late_arrivals", "Late Arrivals", [])).toBe("late_arrivals.late_arrivals");
  });

  test("a taken key gets the next number on the end", () => {
    const taken = ["late_arrivals.late_arrivals", "late_arrivals.late_arrivals_2", "late_arrivals.late_arrivals_4"];
    expect(service.keyFor("late_arrivals", "Late Arrivals", taken)).toBe("late_arrivals.late_arrivals_3");
    expect(service.keyFor("late_arrivals", "Late arrivals", ["late_arrivals.late_arrivals"])).toBe(
      "late_arrivals.late_arrivals_2",
    );
  });

  test("Who Can Clear reads the grant from the access catalogue", () => {
    expect(service.whoCanClear("people.approve")).toBe("People Approvers");
    expect(service.whoCanClear("partnerships.edit")).toBe("Partnerships Editors");
    expect(service.whoCanClear("expenses.approve")).toBe("Expenses Approvers");
    expect(service.whoCanClear("people.view")).toBe("People Viewers");
    expect(service.whoCanClear("nowhere.view")).toBe("nowhere.view");
  });
});

describe("Over By in words, for the Open High Alerts card", () => {
  test("reads as the Alerts tab's list: +N past a count, the days left, Due Today, Expired", () => {
    expect(service.overByText("1.00", "over")).toBe("+1");
    expect(service.overByText("0.00", "over")).toBe("+0");
    expect(service.overByText("2.50", "over")).toBe("+2.5");
    expect(service.overByText("1250.00", "over")).toBe("+1,250");
    expect(service.overByText("12.00", "days_left")).toBe("12 days left");
    expect(service.overByText("1.00", "days_left")).toBe("1 day left");
    expect(service.overByText("0.00", "days_left")).toBe("Due Today");
    expect(service.overByText("-2.00", "days_left")).toBe("Expired");
    // A metric no longer listed has no kind: its figure alone. No figure, no words.
    expect(service.overByText("4.00", null)).toBe("4");
    expect(service.overByText(null, "days_left")).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * The routes
 * ------------------------------------------------------------------ */

describe("the routes", () => {
  const { routesOf } = require("../../http/route");
  const routes = routesOf(require("./alerts.routes").router);
  const find = (method, path) => routes.find((r) => r.method === method && r.path === path);

  test("mount at /home, each the contract's, literal paths before /:id", () => {
    expect(require("./alerts.routes").basePath).toBe("/home");
    expect(routes.map((r) => `${r.method} ${r.path}`)).toEqual([
      "GET /alerts",
      "GET /alerts/summary",
      "GET /alerts/:id",
      "POST /alerts/:id/clear",
      "GET /alert-rules",
      "GET /alert-rules/policy",
      "GET /alert-rules/:id",
      "POST /alert-rules",
      "PATCH /alert-rules/:id",
    ]);
    expect(find("GET", "/alerts").contract).toMatchObject({ query: contract.HomeAlertQuery, response: contract.HomeAlertPage });
    expect(find("GET", "/alerts/summary").contract.response).toBe(contract.HomeAlertSummary);
    expect(find("GET", "/alerts/:id").contract).toMatchObject({ params: c.common.IdParams, response: contract.HomeAlert });
    expect(find("POST", "/alerts/:id/clear").contract).toMatchObject({ body: contract.HomeAlertClear, response: contract.HomeAlert });
    expect(find("GET", "/alert-rules").contract).toMatchObject({
      query: contract.HomeAlertRuleQuery,
      response: contract.HomeAlertRulePage,
    });
    expect(find("GET", "/alert-rules/policy").contract.response).toBe(contract.HomeAlertPolicyRules);
    expect(find("POST", "/alert-rules").contract.body).toBe(contract.HomeAlertRuleCreate);
    expect(find("PATCH", "/alert-rules/:id").contract.body).toBe(contract.HomeAlertRuleUpdate);
  });

  test("every one behind `home` view; the tab's reads behind either capability, clearing and rules behind their own", () => {
    for (const r of routes) {
      expect([r.method, r.path, r.permission]).toEqual([r.method, r.path, { key: "home", action: "view" }]);
      const expected = r.path.startsWith("/alert-rules")
        ? { capability: "alerts.manage", capabilities: null }
        : r.method === "POST"
          ? { capability: "alerts.clear", capabilities: null }
          : { capability: null, capabilities: ["alerts.clear", "alerts.manage"] };
      expect([r.method, r.path, { capability: r.capability, capabilities: r.capabilities }]).toEqual([
        r.method,
        r.path,
        expected,
      ]);
    }
  });

  test("the lists page at 25 through the contract's controls and sort only as they allow", () => {
    for (const schema of [contract.HomeAlertQuery, contract.HomeAlertRuleQuery]) {
      expect(Object.keys(schema.shape)).toEqual(expect.arrayContaining(["page", "q", "sort"]));
      expect(schema.safeParse({ limit: "100" }).success).toBe(false);
    }
    expect(contract.HomeAlertQuery.safeParse({ sort: "-severity", state: "dismissed" }).success).toBe(true);
    expect(contract.HomeAlertQuery.safeParse({ sort: "title" }).success).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * Events, signals and jobs
 * ------------------------------------------------------------------ */

describe("events and signals", () => {
  test("the rules' events are Home's", () => {
    expect(EVENTS).toEqual({
      HOME_ALERT_RULE_CREATED: "home.alert_rule_created",
      HOME_ALERT_RULE_UPDATED: "home.alert_rule_updated",
    });
    for (const key of Object.values(EVENTS)) expect(catalogue.get(key).module).toBe("home");
  });

  test("Home reads no attendance event: the policy's breaches raise attendance's alerts (T1)", () => {
    require("../attendance/attendance.events");
    for (const key of ["attendance.punched", "attendance.day_closed"])
      expect(outbox.handlersFor(key).map((h) => h.name)).not.toContain("alerts.person-signal");
    expect(outbox.handlersFor("attendance.rule_breached").map((h) => h.name)).toContain("attendance.raise_breach_alert");
  });

  test("a policy rule's figures read in words, and Off is none", () => {
    expect(service.figuresOf("late_rule", { on: true, count: 3, period: "month", hours: 5, alert: true, query: true })).toBe(
      "3 late arrivals in a month or 5 hours",
    );
    expect(service.figuresOf("absence_rule", { on: true, count: 1, period: "week", alert: true, query: false })).toBe("1 absence in a week");
    expect(service.figuresOf("early_rule", { on: true, count: 2, period: "days_30", hours: 1.5 })).toBe(
      "2 early departures in 30 days or 1.5 hours",
    );
    expect(service.figuresOf("forgotten_rule", { on: false, count: 3, period: "month" })).toBeNull();
  });

  test("the morning sweep is one scheduler at 06:00 Lagos, and its queue refuses a date it cannot read", async () => {
    const schedule = require("../../jobs/schedulers/home-alert-sweeps");
    expect(schedule).toMatchObject({ name: "home-alert-sweeps", pattern: "0 6 * * *", tz: "Africa/Lagos" });
    const handler = require("../../jobs/handlers/home-alert-sweeps");
    await expect(handler({ data: { date: "14/10/2026" } })).rejects.toMatchObject({ name: "UnrecoverableError" });
  });
});

/* ------------------------------------------------------------------ *
 * The assistant and ⌘K
 * ------------------------------------------------------------------ */

describe("the assistant and ⌘K", () => {
  const manifest = require("./alerts.ai");

  test("one read, never a write, and routes to the tab on each category", () => {
    expect(manifest.reads.map((r) => [r.key, r.permission, r.params])).toEqual([
      ["alerts.mine", ["home", "view"], contract.HomeAlertQuery],
    ]);
    expect(manifest.routes.map((r) => r.path)).toEqual(
      expect.arrayContaining(["/home?tab=alerts", "/home?tab=alerts&category=attendance", "/home?tab=alerts&category=budget"]),
    );
    expect(manifest.routes.filter((r) => r.params && r.params.category)).toHaveLength(contract.HOME_ALERT_CATEGORIES.length);
  });

  test("a result opens the alert's sheet, and a rule its Edit Rule", () => {
    const routeMap = require("../../shared/route-map");
    expect(routeMap.linkFor("home_alert", ID).path).toBe(`/home?tab=alerts&id=${ID}`);
    expect(routeMap.linkFor("home_alert_rule", ID).path).toBe(`/home?tab=alerts&rule=${ID}`);
    const providers = require("./alerts.search");
    expect(providers.map((p) => [p.type, p.module])).toEqual([
      ["home_alert", "home"],
      ["home_alert_rule", "home"],
    ]);
  });

  test("New Rule is a ⌘K action for the holders of `alerts.manage`", () => {
    const { ACTIONS, linkOf } = require("../../shared/search/actions");
    const action = ACTIONS.find((a) => a.label === "New Rule");
    expect(action).toMatchObject({ need: ["home", "view"], capability: "alerts.manage" });
    expect(linkOf(action)).toBe("/home?tab=alerts&action=new");
  });
});
