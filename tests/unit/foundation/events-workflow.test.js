"use strict";
/**
 * The shared layer's pure parts: the event catalogue, emit's checks, the outbox
 * registry, approval routing, field masking, the route map, notification categories,
 * alert maths and the resource kit's configuration. The database half of each runs in
 * tests/integration/shared-layer.test.js.
 */
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const catalogue = require("../../../src/shared/events/catalogue");
const { emit, redact, changedFields, actorOf } = require("../../../src/shared/events/emit");
const outbox = require("../../../src/shared/events/outbox");
const cond = require("../../../src/shared/workflow/conditions");
const definitions = require("../../../src/shared/workflow/definitions");
const mask = require("../../../src/shared/rbac/field-mask");
const routeMap = require("../../../src/shared/route-map");
const categories = require("../../../src/shared/notifications/categories");
const fanout = require("../../../src/shared/notifications/fanout");
const alerts = require("../../../src/shared/alerts/alerts");
const { makeRepo, mountResource } = require("../../../src/shared/crud/resource");
const { DEPTH } = require("../../../src/shared/db/tx");
const { registry } = require("../../../src/http/route");
const c = require("@mycity/contract");

describe("event catalogue", () => {
  test("declares keys and returns constants", () => {
    const EV = catalogue.defineEvents("people", {
      "unit_widget.created": { summary: "A widget was created" },
      "unit_widget.reporting_line_changed": { summary: "A widget moved" },
    });
    expect(EV).toEqual({ UNIT_WIDGET_CREATED: "unit_widget.created", UNIT_WIDGET_REPORTING_LINE_CHANGED: "unit_widget.reporting_line_changed" });
    expect(catalogue.get("unit_widget.created")).toMatchObject({ module: "people", security: false });
    expect(() => EV.UNIT_WIDGET_CREATED.x).not.toThrow();
  });

  test("refuses bad keys, bad modules, em dashes and a key claimed by two modules", () => {
    expect(() => catalogue.defineEvents("people", { Created: { summary: "x" } })).toThrow(/dotted/);
    expect(() => catalogue.defineEvents("people", { "solo": { summary: "x" } })).toThrow(/dotted/);
    expect(() => catalogue.defineEvents("hr", { "a.b": { summary: "x" } })).toThrow(/not a module key/);
    expect(() => catalogue.defineEvents("people", { "a.b": { summary: "A \u2014 B" } })).toThrow(/em dash/);
    expect(() => catalogue.defineEvents("people", { "a.b": { summary: "x", notify: true } })).toThrow(/unknown option/);
    catalogue.defineEvents("people", { "unit_claim.made": { summary: "x" } });
    expect(() => catalogue.defineEvents("people", { "unit_claim.made": { summary: "again" } })).not.toThrow();
    expect(() => catalogue.defineEvents("payroll", { "unit_claim.made": { summary: "x" } })).toThrow(/already declared by module "people"/);
  });

  test("the shared layer's own keys exist", () => {
    expect(catalogue.WORKFLOW.WORKFLOW_COMPLETED).toBe("workflow.completed");
    expect(catalogue.ALERTS.HOME_ALERT_RAISED).toBe("home.alert_raised");
    expect(catalogue.require("workflow.opened").module).toBe("settings");
    expect(() => catalogue.require("nope.never")).toThrow(/not declared/);
  });
});

describe("emit", () => {
  const EV = catalogue.defineEvents("people", { "unit_emit.done": { summary: "x" } });
  const inTx = () => {
    const calls = [];
    const client = { [DEPTH]: 1, query: async (sql, params) => (calls.push({ sql, params }), { rows: [{ event_id: "e1", occurred_at: new Date() }] }) };
    return { client, calls };
  };

  test("refuses a missing or undeclared key, a bad entity, and no transaction", async () => {
    const { client } = inTx();
    await expect(emit(client, { entity: { type: "x", id: 1 } })).rejects.toThrow(/key is required/);
    await expect(emit(client, { key: "never.declared", entity: { type: "x", id: 1 } })).rejects.toThrow(/not declared/);
    await expect(emit(client, { key: EV.UNIT_EMIT_DONE, entity: { type: "Bad Type", id: 1 } })).rejects.toThrow(/snake_case/);
    await expect(emit(client, { key: EV.UNIT_EMIT_DONE, entity: { type: "x", id: 1 }, payload: [] })).rejects.toThrow(/payload is an object/);
    await expect(emit({ query: jest.fn() }, { key: EV.UNIT_EMIT_DONE, entity: { type: "x", id: 1 } })).rejects.toThrow(/atomically/);
  });

  test("one statement, three tables; credentials redacted; payload kept small", async () => {
    const { client, calls } = inTx();
    await emit(client, {
      key: EV.UNIT_EMIT_DONE,
      entity: { type: "thing", id: 7 },
      actor: { user_id: "u1", display_name: "Ada Obi", email: "ada@mycity.io", ip: "1.2.3.4" },
      before: { a: 1, mfa_secret_enc: "zzz" },
      after: { a: 2, mfa_secret_enc: "yyy" },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toMatch(/INSERT INTO event_log[\s\S]*INSERT INTO audit_ledger[\s\S]*INSERT INTO event_outbox/);
    const p = calls[0].params;
    expect(p[3]).toBe("7");
    expect(JSON.parse(p[11]).mfa_secret_enc).toBe("<redacted>");
    expect(p[13]).toEqual(["a", "mfa_secret_enc"]);
    await expect(emit(client, { key: EV.UNIT_EMIT_DONE, entity: { type: "x", id: 1 }, payload: { blob: "x".repeat(20000) } })).rejects.toThrow(/carry ids/);
  });

  test("redact, changedFields and actorOf", () => {
    expect(redact({ password: "p", nested: [{ refresh_token: "t", name: "n" }], token_hash: null })).toEqual({
      password: "<redacted>",
      nested: [{ refresh_token: "<redacted>", name: "n" }],
      token_hash: null,
    });
    expect(changedFields({ a: 1, b: 2 }, { a: 1, b: 3, c: 4 })).toEqual(["b", "c"]);
    expect(changedFields(null, { a: 1 })).toBeNull();
    expect(actorOf(null)).toEqual({ user_id: null, name: null, email: null, ip: null });
    expect(actorOf("u9").user_id).toBe("u9");
  });
});

describe("outbox registry", () => {
  beforeEach(() => outbox.__reset());
  afterEach(() => outbox.__reset());

  test("named handlers per key, then the * handlers", () => {
    const fn = async () => {};
    outbox.register("thing.created", "things.index", fn);
    outbox.register("thing.created", "things.index", fn);
    outbox.register("*", "notify.all", fn);
    expect(outbox.handlersFor("thing.created").map((h) => h.name)).toEqual(["things.index", "notify.all"]);
    expect(() => outbox.register("thing.created", "things.index", async () => {})).toThrow(/already registered/);
    expect(() => outbox.register("thing.created", "Bad Name", fn)).toThrow(/<module>\.<what>/);
    expect(() => outbox.register("thing", "a.b", fn)).toThrow(/not an event key/);
  });

  test("a dispatcher refuses to run before every handler is loaded", async () => {
    await expect(outbox.dispatchDue({ db: { query: jest.fn() } })).rejects.toThrow(/markReady/);
  });

  test("backoff doubles from ten seconds to an hour", () => {
    expect([1, 2, 3, 4].map(outbox.backoffSeconds)).toEqual([10, 20, 40, 80]);
    expect(outbox.backoffSeconds(30)).toBe(3600);
  });
});

describe("approval routing", () => {
  const def = definitions.getDefault("test.threshold");
  const keys = (stages) => stages.map((s) => s.key);

  test("test.threshold: one stage below ₦500,000.00, two from it", () => {
    expect(keys(cond.applicableStages(def, { amount: "499999.99" }))).toEqual(["manager"]);
    expect(keys(cond.applicableStages(def, { amount: "500000.00" }))).toEqual(["manager", "ceo"]);
    expect(keys(cond.applicableStages(def, { amount: "500000.01" }))).toEqual(["manager", "ceo"]);
    expect(cond.nextApplicableStage(def, { amount: "10.00" }, "manager")).toBeNull();
    expect(cond.nextApplicableStage(def, { amount: "900000.00" }, "manager").key).toBe("ceo");
  });

  test("money compares exactly, never as a float", () => {
    const d = { context: { amount: "money" }, stages: [{ key: "a", approver: { type: "ceo" }, condition: { field: "amount", op: "=", value: "0.30" } }] };
    expect(cond.requiresApproval(d, { amount: "0.30" })).toBe(true);
    expect(cond.requiresApproval(d, { amount: "0.3" })).toBe(true);
    expect(cond.requiresApproval(d, { amount: "0.31" })).toBe(false);
  });

  test("in, dates, and a list of conditions that must all hold", () => {
    const d = {
      context: { category: "text", on: "date", days: "number" },
      stages: [
        { key: "a", approver: { type: "ceo" }, condition: [{ field: "category", op: "in", value: ["travel", "training"] }, { field: "days", op: ">", value: 3 }] },
        { key: "b", approver: { type: "ceo" }, condition: { field: "on", op: "<", value: "2026-12-01" } },
      ],
    };
    expect(keys(cond.applicableStages(d, { category: "travel", on: "2026-11-30", days: 4 }))).toEqual(["a", "b"]);
    expect(keys(cond.applicableStages(d, { category: "office", on: "2026-12-01", days: 4 }))).toEqual([]);
  });

  test("a missing context field is refused, not read as zero", () => {
    expect(() => cond.applicableStages(def, {})).toThrow(/missing "amount"/);
    expect(cond.contextProblems(def, { amount: 12.5 })).toEqual(['context "amount" is not a money']);
    expect(cond.contextProblems(def, { amount: "1.00", extra: 1 })).toEqual(['context "extra" is not declared by the definition']);
  });

  test("validateDefinition names every problem", () => {
    const problems = cond.validateDefinition({
      key: "Bad",
      name: "",
      context: { amount: "money", note: "text" },
      stages: [
        { key: "a", approvers: [], on_timeout: "auto_approve" },
        { key: "a", approver: { type: "user", value: "not-a-uuid" }, condition: { field: "note", op: ">", value: "x" } },
        { key: "c", approver: { type: "role" }, condition: { field: "missing", op: "~", value: 1 }, sla_hours: 0 },
      ],
    });
    const text = problems.join("\n");
    for (const expected of [
      "key is dotted",
      "name is required",
      "name at least one approver",
      "never approves itself",
      "key is used twice",
      "value is a user id",
      "needs a money, number or date field",
      "needs a value",
      "not declared in context",
      "op must be one of",
      "sla_hours",
    ]) {
      expect(text).toContain(expected);
    }
  });

  test("every shipped definition is valid", () => {
    for (const d of Object.values(definitions.DEFAULTS)) expect(definitions.problemsOf(d)).toEqual([]);
  });

  test("normalise fills the defaults", () => {
    expect(cond.normaliseStage({ key: "x", approver: { type: "ceo" } })).toEqual({
      key: "x",
      name: "x",
      approvers: [{ type: "ceo" }],
      condition: null,
      sla_hours: 48,
      on_timeout: "escalate",
      on_approve: "next",
      on_reject: "reject",
    });
  });
});

describe("field masking", () => {
  test("nulls the governed properties at any depth, keeps the shape", () => {
    const data = { data: [{ name: "A", base_salary: "1.00", bank: { account_number: "0123456789" } }], page: { number: 1 } };
    expect(mask.maskData(data, ["employee.salary", "employee.bank"])).toEqual({
      data: [{ name: "A", base_salary: null, bank: { account_number: null } }],
      page: { number: 1 },
    });
  });

  test("no keys or unknown keys change nothing; prototype keys are dropped", () => {
    const data = { base_salary: "1.00" };
    expect(mask.maskData(data, [])).toBe(data);
    expect(mask.maskData(data, ["nope.key"])).toBe(data);
    const hostile = JSON.parse('{"__proto__": {"polluted": true}, "base_salary": "1"}');
    const out = mask.maskData(hostile, ["employee.salary"]);
    expect(out.base_salary).toBeNull();
    expect({}.polluted).toBeUndefined();
  });

  test("the CEO is never masked, without a database read", async () => {
    const client = { query: jest.fn() };
    const data = { base_salary: "1.00" };
    expect(await mask.maskForUser(client, { user_id: "u", is_ceo: true }, data)).toBe(data);
    expect(client.query).not.toHaveBeenCalled();
  });

  test("field keys are listed for the Roles & Permissions screen", () => {
    expect(mask.FIELD_KEYS.map((f) => f.key)).toEqual(["employee.salary", "employee.bank", "employee.personal", "employee.statutory"]);
  });
});

describe("route map", () => {
  test("links derive from type and id; self opens the owner's view", () => {
    expect(routeMap.linkFor("query", "q1")).toEqual({ module: "queries", tab: "queries", id: "q1", path: "/queries?tab=queries&id=q1" });
    expect(routeMap.linkFor("payslip", "p1", { self: true }).path).toBe("/ess?tab=my-payslips&id=p1");
    expect(routeMap.linkFor("payslip", "p1").path).toBe("/payroll?tab=payslips&id=p1");
    expect(routeMap.linkFor("ai_conversation", "a1").path).toBe("/praxis-ai?tab=history&id=a1");
    expect(routeMap.linkFor("unknown_type", "x")).toBeNull();
    expect(routeMap.linkFor("query", "")).toBeNull();
  });

  test("screenPath refuses a screen that does not exist", () => {
    expect(routeMap.screenPath("workspace", "tasks", { params: { prefill_title: "Call Ada" } })).toBe("/workspace?tab=tasks&prefill_title=Call+Ada");
    expect(() => routeMap.screenPath("workspace", "nope")).toThrow(/not a screen/);
    expect(() => routeMap.screenPath("workspace", "tasks", { params: { tab: "x" } })).toThrow(/set by screenPath/);
  });

  test("SCREENS matches every staff-app screen in docs/PROGRESS.md", () => {
    const md = fs.readFileSync(path.join(__dirname, "..", "..", "..", "docs", "PROGRESS.md"), "utf8");
    const LABEL_TO_MODULE = {
      Home: "home", "My Workspace": "workspace", "Employee Self-Service": "ess", "Staff Community": "community",
      Mailbox: "mailbox", People: "people", Performance: "performance", "Queries & Sanctions": "queries",
      Recruitment: "recruitment", Payroll: "payroll", Partnerships: "partnerships", Expenses: "expenses",
      "Knowledge Hub": "knowledge", "Praxis AI": "praxis_ai", Settings: "settings",
    };
    const found = {};
    let module = null;
    for (const line of md.split(/\r?\n/)) {
      const h = line.match(/^### (.+)$/);
      if (h) module = LABEL_TO_MODULE[h[1].trim()] || null;
      const row = module && line.match(/^\| \d+ \| [^|]+\| `([a-z0-9-]+)` \|/);
      if (row) (found[module] = found[module] || []).push(row[1]);
    }
    expect(found).toEqual(routeMap.SCREENS);
    expect(Object.values(routeMap.SCREENS).flat()).toHaveLength(89);
  });
});

describe("notification categories", () => {
  test("by first segment, then by module, then system", () => {
    expect(categories.categoryFor("workflow.opened")).toBe("approvals");
    expect(categories.categoryFor("payslip.published")).toBe("payroll");
    expect(categories.categoryFor("thing.created", "expenses")).toBe("expenses");
    expect(categories.categoryFor("thing.created")).toBe("system");
  });

  test("defaults, stored preferences, and the locked category", () => {
    expect(categories.isOn("approvals", "email")).toBe(true);
    expect(categories.isOn("approvals", "email", false)).toBe(false);
    expect(categories.isOn("knowledge", "push")).toBe(false);
    expect(categories.isOn("knowledge", "push", true)).toBe(true);
    expect(categories.isOn("security", "in_app", false)).toBe(true);
    expect(categories.isOn("security", "email", false)).toBe(true);
  });
});

describe("notification declarations", () => {
  const EV = catalogue.defineEvents("people", { "unit_notice.sent": { summary: "x" } });

  test("refuses an undeclared event, a bad audience and an em dash", () => {
    expect(() => fanout.defineNotification("never.declared", { to: [{ ceo: true }], title: "x" })).toThrow(/defineEvents/);
    expect(() => fanout.defineNotification(EV.UNIT_NOTICE_SENT, { to: [{ everyone: true }], title: "x" })).toThrow(/each audience/);
    expect(() => fanout.defineNotification(EV.UNIT_NOTICE_SENT, { to: [{ permission: ["hr", "view"] }], title: "x" })).toThrow(/permission is/);
    expect(() => fanout.defineNotification(EV.UNIT_NOTICE_SENT, { to: [{ ceo: true }], title: "A \u2014 B" })).toThrow(/em dash/);
  });

  test("an event nobody declared and that is not security writes nothing", async () => {
    const db = { query: jest.fn() };
    const out = await fanout.handle({ key: "unit_widget.created", entity: { type: "x", id: "1" }, payload: {} }, {}, { db });
    expect(out).toEqual({ recipients: 0, inserted: 0, handed_over: 0 });
    expect(db.query).not.toHaveBeenCalled();
  });

  test("the shared layer declares its own", () => {
    for (const key of ["workflow.opened", "workflow.advanced", "workflow.completed", "workflow.escalated", "home.alert_raised"]) {
      expect(fanout.SPECS.has(key)).toBe(true);
    }
  });
});

describe("alerts", () => {
  test("permission keys are module.action from the catalogue", () => {
    expect(alerts.parsePermission("people.approve")).toEqual(["people", "approve"]);
    expect(() => alerts.parsePermission("home.alerts")).toThrow(/module>\.<action/);
    expect(() => alerts.parsePermission("people.approve.extra")).toThrow();
  });

  test("evaluate and age", () => {
    expect(alerts.evaluate({ threshold: "3" }, 4)).toEqual({ breached: true, over_by: 1 });
    expect(alerts.evaluate({ threshold: "3.00" }, 3)).toEqual({ breached: true, over_by: 0 });
    expect(alerts.evaluate({ threshold: 80 }, "79.5")).toEqual({ breached: false, over_by: -0.5 });
    expect(alerts.ageDays({ raised_at: "2026-10-01T09:00:00Z" }, new Date("2026-10-15T08:59:00Z"))).toBe(13);
  });

  test("a deadline breaches at its days left or fewer; over_by holds the days left, 0 on the day, below 0 once passed", () => {
    expect(alerts.evaluate({ threshold: "30" }, 31, "deadline")).toEqual({ breached: false, over_by: 31 });
    expect(alerts.evaluate({ threshold: "30" }, 30, "deadline")).toEqual({ breached: true, over_by: 30 });
    expect(alerts.evaluate({ threshold: "30" }, 12, "deadline")).toEqual({ breached: true, over_by: 12 });
    expect(alerts.evaluate({ threshold: "30" }, 0, "deadline")).toEqual({ breached: true, over_by: 0 });
    expect(alerts.evaluate({ threshold: "30" }, -1, "deadline")).toEqual({ breached: true, over_by: -1 });
    expect(alerts.evaluate({ threshold: "30" }, -5, "deadline")).toEqual({ breached: true, over_by: -5 });
    expect(alerts.evaluate({ threshold: "3" }, 4, "count")).toEqual({ breached: true, over_by: 1 });
    expect(() => alerts.evaluate({ threshold: "3" }, 4, "ratio")).toThrow(/count or deadline/);
    expect(alerts.KINDS).toEqual(["count", "deadline"]);
  });
});

describe("resource kit", () => {
  const base = { table: "thing", pk: "thing_id", columns: "thing_id, name, owner_id", writable: ["name"] };

  test("refuses a configuration that could become unsafe SQL", () => {
    expect(() => makeRepo({ ...base, columns: "thing_id; drop table x" })).toThrow(/columns/);
    expect(() => makeRepo({ ...base, columns: "name" })).toThrow(/primary key/);
    expect(() => makeRepo({ ...base, writable: undefined })).toThrow(/writable/);
    expect(() => makeRepo({ ...base, sort: { evil: "name; drop" } })).toThrow(/sort/);
    expect(() => makeRepo({ ...base, sort: { a: "name" }, defaultSort: "b" })).toThrow(/defaultSort/);
    expect(() => makeRepo({ ...base, archive: { nope: 1 } })).toThrow(/archive/);
  });

  test("a list is one paged query with filters, search, scope and a unique order", async () => {
    const repo = makeRepo({
      ...base,
      search: ["name"],
      filters: { status: "status" },
      sort: { name: "name", newest: "created_at DESC" },
      scope: { column: "owner_id" },
      archive: { column: "archived_at" },
    });
    const client = { query: jest.fn(async () => ({ rows: [] })) };
    await repo.list(client, { q: "ada", status: "open", sort: "newest", page: 2 }, { scope: "team", scope_ids: ["e1", "e2"] });
    const [sql, params] = client.query.mock.calls[0];
    expect(sql).toContain('t."archived_at" IS NULL');
    expect(sql).toContain('t."status" = $1');
    expect(sql).toContain("search_fold($2)");
    expect(sql).toContain('t."owner_id" = ANY($3::uuid[])');
    expect(sql).toMatch(/ORDER BY t\.created_at DESC, t\."thing_id"\nLIMIT \$4 OFFSET \$5$/);
    expect(params).toEqual(["open", "ada", ["e1", "e2"], 25, 25]);
  });

  test("mountResource defines only the verbs the contract names, each with a permission", () => {
    const router = express.Router();
    const h = async () => {};
    mountResource(router, {
      controller: { list: h, get: h },
      module: "settings",
      contract: { list: { query: c.common.EmptyBody, response: c.common.EmptyBody }, get: { response: c.common.EmptyBody } },
    });
    const mine = registry().filter((r) => r.router === router);
    expect(mine.map((r) => [r.method, r.path, r.permission.action])).toEqual([
      ["GET", "/", "view"],
      ["GET", "/:id", "view"],
    ]);
    expect(() => mountResource(express.Router(), { controller: {}, module: "settings", contract: { remove: {} } })).toThrow(/unknown verb/);
  });
});
