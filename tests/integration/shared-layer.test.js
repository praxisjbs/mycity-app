"use strict";
/**
 * The shared layer against a real Postgres: emit, the outbox, the approval engine,
 * notifications, alerts, field masking and the resource kit, end to end.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration
 *
 * Refuses to run unless the database name ends in "_test": it drops and rebuilds the
 * public schema from the real migrations (helpers/schema.js).
 */
const { config } = require("../../src/config/env");
const schema = require("./helpers/schema");
const { pool } = require("../../src/config/db");
const { atomically } = require("../../src/shared/db/tx");
const { defineEvents } = require("../../src/shared/events/catalogue");
const { emit } = require("../../src/shared/events/emit");
const outbox = require("../../src/shared/events/outbox");
const workflow = require("../../src/shared/workflow/engine");
const definitions = require("../../src/shared/workflow/definitions");
const fanout = require("../../src/shared/notifications/fanout");
const alerts = require("../../src/shared/alerts/alerts");
const { maskForUser } = require("../../src/shared/rbac/field-mask");
const { makeRepo, makeService } = require("../../src/shared/crud/resource");

const EV = defineEvents("people", {
  "test_thing.created": { summary: "A test thing was created" },
  "test_thing.updated": { summary: "A test thing was changed" },
  "test_thing.archived": { summary: "A test thing was archived" },
  "test_thing.flaky": { summary: "Drives the outbox retry test" },
});
const SEC = defineEvents("settings", { "access.test_role_granted": { summary: "A role was granted", security: true } });

const q = (sql, params) => pool.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

/** Run every due outbox row now (backoff waits skipped). */
async function drain() {
  for (let i = 0; i < 10; i += 1) {
    await q("UPDATE event_outbox SET next_attempt_at = now() WHERE status = 'pending'");
    const r = await outbox.dispatchDue({ db: pool });
    if (r.claimed === 0) return;
  }
}

const people = {};

async function seed() {
  const emp = async (first, last, manager = null) =>
    (await one(schema.sql.employee, [first, last, manager])).employee_id;
  const user = async (key, employeeId, isCeo = false) => {
    const u = await one(schema.sql.user, [employeeId, `${key}@mycity.test`, isCeo]);
    people[key] = { user_id: u.user_id, employee_id: employeeId, is_ceo: isCeo, role_ids: [], display_name: key, email: `${key}@mycity.test` };
  };
  const role = async (code, perms) => {
    const r = await one(schema.sql.role, [code]);
    for (const [module, scope, actions] of perms) {
      await q(
        `INSERT INTO permission (role_id, module_key, scope, can_view, can_create, can_edit, can_delete, can_approve, can_export)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [r.role_id, module, scope, ...["view", "create", "edit", "delete", "approve", "export"].map((a) => actions.includes(a))],
      );
    }
    return r.role_id;
  };
  const grant = async (key, roleId) => {
    await q("INSERT INTO user_role (user_id, role_id) VALUES ($1, $2)", [people[key].user_id, roleId]);
    people[key].role_ids.push(roleId);
  };

  const ada = await emp("Ada", "Obi");
  const bola = await emp("Bola", "Ade", ada);
  const chidi = await emp("Chidi", "Eze", bola);
  const dayo = await emp("Dayo", "Ola", ada);
  const eze = await emp("Eze", "Uche", ada);
  await user("ada", ada, true);
  await user("bola", bola);
  await user("chidi", chidi);
  await user("dayo", dayo);
  await user("eze", eze);

  const lineManager = await role("line_manager", [["people", "team", ["view", "approve"]]]);
  const staff = await role("staff", [["people", "own", ["view"]]]);
  const hr = await role("hr_manager", [["people", "all", ["view", "approve"]], ["settings", "all", ["view", "edit"]]]);
  const clerk = await role("clerk", [["people", "all", ["view"]]]);
  await q("INSERT INTO field_visibility (role_id, field_key, visibility) VALUES ($1, 'employee.salary', 'masked')", [clerk]);
  await grant("bola", lineManager);
  await grant("chidi", staff);
  await grant("dayo", hr);
  await grant("eze", clerk);
  await q("INSERT INTO numbering_scheme (doc_type, prefix, padding) VALUES ('query', 'QRY', 4) ON CONFLICT (doc_type) DO UPDATE SET prefix = EXCLUDED.prefix, padding = EXCLUDED.padding");
}

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

describeDb("shared layer against Postgres", () => {
  const ran = [];
  let flakyFailures = 1;

  beforeAll(async () => {
    await schema.rebuild(pool, config.DB_NAME);
    await seed();
    outbox.register(EV.TEST_THING_CREATED, "test.record", async (event) => {
      ran.push(event.entity.id);
    });
    outbox.register(EV.TEST_THING_FLAKY, "test.steady", async () => {
      ran.push("steady");
    });
    outbox.register(EV.TEST_THING_FLAKY, "test.flaky", async () => {
      if (flakyFailures > 0) {
        flakyFailures -= 1;
        throw new Error("flaky once");
      }
      ran.push("flaky");
    });
    outbox.markReady();
  });

  afterAll(async () => {
    // A failing outbox handler is reported; write those reports now, while the pool is
    // open, rather than on the reporter's timer after the test environment is gone.
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  describe("error reporter", () => {
    test("an error reported with no extra detail is recorded, not lost", async () => {
      const reporter = require("../../src/shared/observability/error-reporter");
      reporter.report(new Error("integration probe without extra"), { origin: "server", severity: "warning" });
      await reporter.flush();
      expect(await one("SELECT extra FROM error_event WHERE message = 'integration probe without extra'")).toEqual({ extra: null });
    });
  });

  describe("emit", () => {
    test("writes event, audit and outbox together, and nothing on rollback", async () => {
      const id = "11111111-1111-4111-8111-111111111111";
      await expect(
        tx(async (c) => {
          await emit(c, { key: EV.TEST_THING_CREATED, entity: { type: "test_thing", id }, actor: people.dayo, after: { name: "x" } });
          throw new Error("roll back");
        }),
      ).rejects.toThrow("roll back");
      for (const t of ["event_log", "audit_ledger", "event_outbox"]) {
        expect((await one(`SELECT count(*)::int AS n FROM ${t}`)).n).toBe(0);
      }

      const out = await tx((c) =>
        emit(c, {
          key: EV.TEST_THING_UPDATED,
          entity: { type: "test_thing", id },
          actor: { ...people.dayo, ip: "10.0.0.9" },
          before: { name: "x", password_hash: "abc" },
          after: { name: "y", password_hash: "def" },
          payload: { employee_id: people.chidi.employee_id },
        }),
      );
      expect(out.event_id).toBeTruthy();
      const audit = await one("SELECT * FROM audit_ledger WHERE event_id = $1", [out.event_id]);
      expect(audit.actor_user_id).toBe(people.dayo.user_id);
      expect(audit.actor_ip).toBe("10.0.0.9");
      expect(audit.module_key).toBe("people");
      expect(audit.before.password_hash).toBe("<redacted>");
      expect(audit.changed_fields).toEqual(["name", "password_hash"]);
      expect((await one("SELECT count(*)::int AS n FROM event_outbox WHERE event_id = $1", [out.event_id])).n).toBe(1);
    });

    test("a dedup key keeps one outbox row", async () => {
      const id = "22222222-2222-4222-8222-222222222222";
      for (let i = 0; i < 2; i += 1) {
        await tx((c) => emit(c, { key: EV.TEST_THING_UPDATED, entity: { type: "test_thing", id }, actor: null, dedup_key: "thing-2-once" }));
      }
      expect((await one("SELECT count(*)::int AS n FROM event_outbox WHERE dedup_key = 'thing-2-once'")).n).toBe(1);
      expect((await one("SELECT count(*)::int AS n FROM event_log WHERE entity_id = $1", [id])).n).toBe(2);
    });

    test("refuses to run outside a transaction", async () => {
      await expect(emit(pool, { key: EV.TEST_THING_UPDATED, entity: { type: "test_thing", id: "x" } })).rejects.toThrow(/atomically/);
    });
  });

  describe("outbox", () => {
    test("runs handlers after commit; a retry runs only the handler that failed", async () => {
      await drain();
      ran.length = 0;
      await tx((c) => emit(c, { key: EV.TEST_THING_FLAKY, entity: { type: "test_thing", id: "flaky-1" }, actor: null }));
      const first = await outbox.dispatchDue({ db: pool });
      expect(first.retry).toBe(1);
      expect(ran).toEqual(["steady"]);
      const row = await one("SELECT status, attempts, completed_handlers, last_error FROM event_outbox WHERE event_key = $1", [EV.TEST_THING_FLAKY]);
      expect(row.status).toBe("pending");
      expect(row.completed_handlers).toEqual(expect.arrayContaining(["test.steady", "notifications.fanout"]));
      expect(row.last_error).toMatch("flaky once");
      await drain();
      expect(ran).toEqual(["steady", "flaky"]);
      expect((await one("SELECT status FROM event_outbox WHERE event_key = $1", [EV.TEST_THING_FLAKY])).status).toBe("done");
    });

    test("a row out of attempts is failed and reported on health", async () => {
      flakyFailures = 5;
      await tx((c) => emit(c, { key: EV.TEST_THING_FLAKY, entity: { type: "test_thing", id: "flaky-2" }, actor: null }));
      await q("UPDATE event_outbox SET max_attempts = 1 WHERE status = 'pending'");
      await outbox.dispatchDue({ db: pool });
      expect((await outbox.health(pool)).failed).toBe(1);
      flakyFailures = 0;
      expect(await outbox.retryFailed(pool)).toBe(1);
      await drain();
      expect((await outbox.health(pool)).failed).toBe(0);
    });
  });

  describe("approvals (test.threshold)", () => {
    const open = (amount, opener = people.chidi, entityId = `exp-${Math.random()}`) =>
      tx((c) =>
        workflow.openInstance(c, {
          definition_key: "test.threshold",
          entity: { type: "expense", id: entityId },
          subject_employee_id: people.chidi.employee_id,
          context: { amount },
          actor: opener,
        }),
      );
    const act = (id, actor, decision, reason) => tx((c) => workflow.act(c, { instance_id: id, actor, decision, reason }));

    test("below the threshold: one stage, the line manager", async () => {
      const inst = await open("499999.99");
      expect(inst.state).toBe("pending");
      expect(inst.current_stage).toBe("manager");
      expect(inst.stage_approvers).toEqual([{ type: "employee", value: people.bola.employee_id, via: "manager_of_subject" }]);
      const done = await act(inst.workflow_instance_id, people.bola, "approve");
      expect(done.state).toBe("approved");
    });

    test("at the threshold: manager, then the CEO", async () => {
      const inst = await open("500000.00");
      const mid = await act(inst.workflow_instance_id, people.bola, "approve");
      expect(mid.state).toBe("pending");
      expect(mid.current_stage).toBe("ceo");
      await expect(act(inst.workflow_instance_id, people.dayo, "approve")).rejects.toMatchObject({ status: 403 });
      const done = await act(inst.workflow_instance_id, people.ada, "approve");
      expect(done.state).toBe("approved");
      const full = await workflow.getInstance(pool, inst.workflow_instance_id);
      expect(full.decisions.map((d) => [d.stage_key, d.decision])).toEqual([["manager", "approve"], ["ceo", "approve"]]);
    });

    test("nobody approves their own request; the CEO may", async () => {
      const inst = await open("1000.00", people.bola);
      await expect(act(inst.workflow_instance_id, people.bola, "approve")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
      expect((await act(inst.workflow_instance_id, people.ada, "approve")).state).toBe("approved");
    });

    test("reject and request changes need a reason; changes go back to the first stage", async () => {
      const inst = await open("600000.00");
      await act(inst.workflow_instance_id, people.bola, "approve");
      await expect(act(inst.workflow_instance_id, people.ada, "request_changes", " ")).rejects.toMatchObject({ code: "REASON_REQUIRED" });
      const back = await act(inst.workflow_instance_id, people.ada, "request_changes", "Attach the receipt");
      expect(back.current_stage).toBe("manager");
      const rejected = await act(inst.workflow_instance_id, people.bola, "reject", "Not budgeted");
      expect(rejected.state).toBe("rejected");
      await expect(act(inst.workflow_instance_id, people.bola, "approve")).rejects.toMatchObject({ code: "WORKFLOW_CLOSED" });
    });

    test("one open approval per record; the context must be complete", async () => {
      await open("10.00", people.chidi, "exp-dup");
      await expect(open("10.00", people.chidi, "exp-dup")).rejects.toMatchObject({ code: "WORKFLOW_ALREADY_OPEN" });
      await expect(
        tx((c) => workflow.openInstance(c, { definition_key: "test.threshold", entity: { type: "expense", id: "e-x" }, context: {}, actor: null })),
      ).rejects.toThrow(/missing "amount"/);
    });

    test("nothing applies: approved on opening, one completion path", async () => {
      await tx((c) =>
        definitions.saveVersion(c, {
          key: "test.optional",
          module: "people",
          name: "Optional",
          context: { days: "number" },
          stages: [{ key: "hr", approver: { type: "role", value: "hr_manager" }, condition: { field: "days", op: ">", value: 5 } }],
        }),
      );
      const inst = await tx((c) =>
        workflow.openInstance(c, { definition_key: "test.optional", entity: { type: "leave_request", id: "lr-1" }, context: { days: 2 }, actor: people.chidi }),
      );
      expect(inst.state).toBe("approved");
      const ev = await one("SELECT payload FROM event_log WHERE event_key = 'workflow.completed' AND entity_id = 'lr-1'");
      expect(ev.payload.auto).toBe(true);
      const hr = await tx((c) =>
        workflow.openInstance(c, { definition_key: "test.optional", entity: { type: "leave_request", id: "lr-2" }, context: { days: 9 }, actor: people.chidi }),
      );
      expect(hr.stage_approvers).toEqual([{ type: "role", value: "hr_manager" }]);
      expect((await act(hr.workflow_instance_id, people.dayo, "approve")).state).toBe("approved");
    });

    test("time limits: escalate re-arms, auto_reject closes", async () => {
      const inst = await open("20.00");
      await q("UPDATE workflow_instance SET stage_due_at = now() - interval '1 minute' WHERE workflow_instance_id = $1", [inst.workflow_instance_id]);
      const swept = await workflow.sweepTimeouts({ db: pool });
      expect(swept.resolved).toBeGreaterThanOrEqual(1);
      const after = await one("SELECT state, stage_due_at > now() AS rearmed FROM workflow_instance WHERE workflow_instance_id = $1", [inst.workflow_instance_id]);
      expect(after).toEqual({ state: "pending", rearmed: true });

      await tx((c) =>
        definitions.saveVersion(c, {
          key: "test.lapse",
          module: "people",
          name: "Lapse",
          context: {},
          stages: [{ key: "hr", approver: { type: "role", value: "hr_manager" }, sla_hours: 1, on_timeout: "auto_reject" }],
        }),
      );
      const lapse = await tx((c) => workflow.openInstance(c, { definition_key: "test.lapse", entity: { type: "offer", id: "of-1" }, context: {}, actor: people.chidi }));
      await q("UPDATE workflow_instance SET stage_due_at = now() - interval '1 minute' WHERE workflow_instance_id = $1", [lapse.workflow_instance_id]);
      await workflow.sweepTimeouts({ db: pool });
      expect((await one("SELECT state FROM workflow_instance WHERE workflow_instance_id = $1", [lapse.workflow_instance_id])).state).toBe("timeout_rejected");
    });

    test("money never approves itself on timeout", async () => {
      await expect(
        tx((c) =>
          definitions.saveVersion(c, {
            key: "test.bad",
            module: "expenses",
            name: "Bad",
            context: { amount: "money" },
            stages: [{ key: "x", approver: { type: "ceo" }, on_timeout: "auto_approve" }],
          }),
        ),
      ).rejects.toMatchObject({ code: "WORKFLOW_DEFINITION_INVALID" });
    });

    test("My Approvals lists what waits on me, paged", async () => {
      const page = await workflow.waitingOn(pool, people.bola, {});
      expect(page.page.size).toBe(25);
      expect(page.data.length).toBeGreaterThan(0);
      expect(page.data.every((r) => r.current_stage === "manager")).toBe(true);
      const none = await workflow.waitingOn(pool, people.eze, {});
      expect(none.data).toEqual([]);
    });

    test("the requester can withdraw; others cannot", async () => {
      const inst = await open("30.00");
      await expect(tx((c) => workflow.cancel(c, { instance_id: inst.workflow_instance_id, actor: people.bola }))).rejects.toMatchObject({ status: 403 });
      const closed = await tx((c) => workflow.cancel(c, { instance_id: inst.workflow_instance_id, actor: people.chidi, reason: "Wrong amount" }));
      expect(closed.state).toBe("cancelled");
    });
  });

  describe("notifications", () => {
    beforeAll(() => {
      fanout.defineNotification(EV.TEST_THING_CREATED, {
        to: [{ permission: ["people", "view"] }],
        title: "A thing was created",
      });
    });

    test("approval stages tell their approvers; the bell row has no stored link", async () => {
      await q("DELETE FROM notification");
      const inst = await tx((c) =>
        workflow.openInstance(c, {
          definition_key: "test.threshold",
          entity: { type: "expense", id: "exp-notify" },
          subject_employee_id: people.chidi.employee_id,
          context: { amount: "100.00" },
          actor: people.chidi,
        }),
      );
      await drain();
      const rows = (await q("SELECT user_id, title, category, channels, entity_type, entity_id FROM notification WHERE entity_id = 'exp-notify'")).rows;
      expect(rows).toEqual([
        { user_id: people.bola.user_id, title: "Approval needed: Threshold Test", category: "approvals", channels: ["in_app", "email", "push"], entity_type: "expense", entity_id: "exp-notify" },
      ]);
      await tx((c) => workflow.act(c, { instance_id: inst.workflow_instance_id, actor: people.bola, decision: "approve" }));
      await drain();
      const told = await one("SELECT title FROM notification WHERE user_id = $1 AND entity_id = 'exp-notify'", [people.chidi.user_id]);
      expect(told.title).toBe("Threshold Test: Approved");
    });

    test("a permission audience follows scope and leaves the actor out", async () => {
      await tx((c) =>
        emit(c, {
          key: EV.TEST_THING_CREATED,
          entity: { type: "test_thing", id: "t-scope" },
          actor: people.dayo,
          payload: { employee_id: people.chidi.employee_id },
        }),
      );
      await drain();
      const got = (await q("SELECT user_id FROM notification WHERE entity_id = 't-scope' ORDER BY user_id")).rows.map((r) => r.user_id);
      const expected = [people.bola, people.chidi, people.eze].map((p) => p.user_id).sort();
      expect(got).toEqual(expected);
    });

    test("preferences pick channels; a person with everything off gets no row", async () => {
      await q("INSERT INTO notification_preference (user_id, category, channel, enabled) VALUES ($1, 'people', 'push', false)", [people.eze.user_id]);
      for (const ch of ["in_app", "email", "push"]) {
        await q("INSERT INTO notification_preference (user_id, category, channel, enabled) VALUES ($1, 'people', $2, false)", [people.bola.user_id, ch]);
      }
      await tx((c) => emit(c, { key: EV.TEST_THING_CREATED, entity: { type: "test_thing", id: "t-pref" }, actor: people.dayo, payload: { employee_id: people.chidi.employee_id } }));
      await drain();
      const rows = (await q("SELECT user_id, channels FROM notification WHERE entity_id = 't-pref'")).rows;
      expect(rows.find((r) => r.user_id === people.bola.user_id)).toBeUndefined();
      expect(rows.find((r) => r.user_id === people.eze.user_id).channels).toEqual(["in_app"]);
    });

    test("security events reach the watchers whatever their preferences", async () => {
      for (const ch of ["in_app", "email", "push"]) {
        await q("INSERT INTO notification_preference (user_id, category, channel, enabled) VALUES ($1, 'security', $2, false)", [people.ada.user_id, ch]);
      }
      await tx((c) => emit(c, { key: SEC.ACCESS_TEST_ROLE_GRANTED, entity: { type: "role", id: "r-1" }, actor: people.dayo }));
      await drain();
      const rows = (await q("SELECT user_id, category, priority, channels, body FROM notification WHERE entity_id = 'r-1'")).rows;
      expect(rows).toEqual([
        { user_id: people.ada.user_id, category: "security", priority: "high", channels: ["in_app", "email", "push"], body: "A role was granted by Dayo Ola." },
      ]);
      const audit = await one("SELECT is_sensitive FROM audit_ledger WHERE entity_id = 'r-1'");
      expect(audit.is_sensitive).toBe(true);
    });

    test("delivery is handed over once, and retried when it fails", async () => {
      const seen = [];
      let fail = true;
      fanout.onDelivery(async (rows) => {
        if (fail) {
          fail = false;
          throw new Error("smtp down");
        }
        seen.push(...rows.map((r) => r.user_id));
      });
      await tx((c) => emit(c, { key: EV.TEST_THING_CREATED, entity: { type: "test_thing", id: "t-deliver" }, actor: people.dayo, payload: { employee_id: people.chidi.employee_id } }));
      await drain();
      expect(seen.sort()).toEqual([people.chidi.user_id, people.eze.user_id].sort());
      const pending = await one("SELECT count(*)::int AS n FROM notification WHERE entity_id = 't-deliver' AND delivery_queued_at IS NULL");
      expect(pending.n).toBe(0);
    });
  });

  describe("alerts", () => {
    let rule;
    beforeAll(async () => {
      await q(
        `INSERT INTO home_alert_rule (key, name, metric, threshold, window_days, severity, permission_key)
         VALUES ('approval_ageing.engine', 'Waiting Approvals', 'approval_ageing', 3, NULL, 'high', 'people.approve')`,
      );
      rule = await tx((c) => alerts.ruleByKey(c, "approval_ageing.engine"));
    });
    const raise = (value) =>
      tx((c) =>
        alerts.raise(c, {
          rule,
          subject: { type: "employee", id: people.chidi.employee_id },
          value,
          title: "Chidi Eze: late arrivals",
          subject_employee_id: people.chidi.employee_id,
        }),
      );

    test("one open alert per rule and subject; below the threshold nothing", async () => {
      expect((await raise(2)).raised).toBe(false);
      const first = await raise(4);
      expect(first).toMatchObject({ raised: true, created: true });
      expect(first.alert.over_by).toBe("1.00");
      const again = await raise(5);
      expect(again).toMatchObject({ raised: true, created: false });
      expect(again.alert.over_by).toBe("2.00");
      expect((await one("SELECT count(*)::int AS n FROM home_alert")).n).toBe(1);
      expect((await one("SELECT count(*)::int AS n FROM event_log WHERE event_key = 'home.alert_raised'")).n).toBe(1);
    });

    test("clearing needs the rule's permission, is idempotent, and a new breach raises anew", async () => {
      const { home_alert_id: id } = await one("SELECT home_alert_id FROM home_alert WHERE cleared_at IS NULL");
      await expect(tx((c) => alerts.clear(c, { alert_id: id, actor: people.chidi }))).rejects.toMatchObject({ status: 403 });
      const cleared = await tx((c) => alerts.clear(c, { alert_id: id, actor: people.bola, note: "Spoke to Chidi" }));
      expect(cleared.outcome).toBe("cleared");
      const twice = await tx((c) => alerts.clear(c, { alert_id: id, actor: people.bola }));
      expect(twice.cleared_by).toBe(people.bola.user_id);
      expect((await raise(4)).created).toBe(true);
    });

    test("a high alert open 14 days escalates once", async () => {
      await q("UPDATE home_alert SET raised_at = now() - interval '15 days' WHERE cleared_at IS NULL");
      expect((await alerts.escalateAged({ db: pool })).escalated).toBe(1);
      expect((await alerts.escalateAged({ db: pool })).escalated).toBe(0);
      await drain();
      const n = await one("SELECT title, priority FROM notification WHERE event_key = 'home.alert_escalated' AND user_id = $1", [people.ada.user_id]);
      expect(n).toEqual({ title: "Escalated alert: Chidi Eze: late arrivals", priority: "high" });
    });

    test("clearing needs the grant's scope to reach the person the alert is about", async () => {
      const about = (who) => (who ? people[who].employee_id : null);
      await tx((c) =>
        alerts.raise(c, {
          rule,
          subject: { type: "employee", id: people.eze.employee_id },
          value: 3,
          title: "Eze Uche: late arrivals",
          subject_employee_id: people.eze.employee_id,
        }),
      );
      const may = (who, subject) => tx((c) => alerts.mayClear(c, people[who], rule, subject));
      expect(await may("bola", about("chidi"))).toBe(true);
      expect(await may("bola", about("eze"))).toBe(false);
      expect(await may("bola", null)).toBe(false);
      expect(await may("bola", undefined)).toBe(true);
      expect(await may("dayo", about("eze"))).toBe(true);
      expect(await may("dayo", null)).toBe(true);
      expect(await may("eze", about("eze"))).toBe(false);
      expect(await may("ada", null)).toBe(true);
      // Nobody but the CEO clears an alert about themselves, whatever their scope reaches.
      expect(await may("bola", about("bola"))).toBe(false);
      expect(await may("dayo", about("dayo"))).toBe(false);
      expect(await may("ada", about("ada"))).toBe(true);

      const { home_alert_id: id } = await one(
        "SELECT home_alert_id FROM home_alert WHERE subject_id = $1 AND cleared_at IS NULL",
        [people.eze.employee_id],
      );
      await expect(tx((c) => alerts.clear(c, { alert_id: id, actor: people.bola }))).rejects.toMatchObject({ status: 403 });
      expect((await tx((c) => alerts.clear(c, { alert_id: id, actor: people.dayo, outcome: "dismissed" }))).outcome).toBe(
        "dismissed",
      );
    });

    test("a breach a person already closed is not raised again for the same evidence; newer evidence raises it", async () => {
      const subject = { type: "employee", id: people.dayo.employee_id };
      const seen = (since) =>
        tx((c) =>
          alerts.raise(c, { rule, subject, value: 4, title: "Dayo Ola: late arrivals", subject_employee_id: subject.id, since }),
        );
      const evidence = new Date(Date.now() - 3_600_000);
      expect((await seen(evidence)).created).toBe(true);
      expect(await seen(evidence)).toMatchObject({ raised: true, created: false });
      const { home_alert_id: id } = await one("SELECT home_alert_id FROM home_alert WHERE subject_id = $1 AND cleared_at IS NULL", [
        subject.id,
      ]);
      await expect(tx((c) => alerts.clear(c, { alert_id: id, actor: people.dayo }))).rejects.toMatchObject({ status: 403 });
      await tx((c) => alerts.clear(c, { alert_id: id, actor: people.ada }));
      expect(await seen(evidence)).toEqual({ raised: false, created: false, alert: null });
      expect((await one("SELECT count(*)::int AS n FROM home_alert WHERE subject_id = $1", [subject.id])).n).toBe(1);
      expect((await seen(new Date(Date.now() + 1000))).created).toBe(true);
      expect((await one("SELECT count(*)::int AS n FROM home_alert WHERE subject_id = $1", [subject.id])).n).toBe(2);
    });

    test("a deadline breaches at its days left or fewer and keeps the days left: 0 on the day, below 0 once passed", async () => {
      await q(
        `INSERT INTO home_alert_rule (key, name, metric, threshold, severity, permission_key)
         VALUES ('document_expiry.engine', 'Documents Expiring', 'document_expiry', 30, 'medium', 'people.edit')`,
      );
      const deadline = await tx((c) => alerts.ruleByKey(c, "document_expiry.engine"));
      const days = (value) =>
        tx((c) =>
          alerts.raise(c, {
            rule: deadline,
            subject: { type: "document", id: "passport-chidi" },
            value,
            kind: "deadline",
            title: "Chidi Eze: Passport",
            subject_employee_id: people.chidi.employee_id,
          }),
        );
      expect((await days(31)).raised).toBe(false);
      expect((await days(12)).alert.over_by).toBe("12.00");
      expect((await days(0)).alert.over_by).toBe("0.00");
      expect((await days(-4)).alert).toMatchObject({ over_by: "-4.00", subject_employee_id: people.chidi.employee_id });
      expect((await one("SELECT count(*)::int AS n FROM home_alert WHERE subject_id = 'passport-chidi'")).n).toBe(1);
    });

    test("switching a rule off dismisses its open alerts as the rule change, once, needing no clearing right", async () => {
      const { home_alert_rule_id: ruleId } = await one(
        `INSERT INTO home_alert_rule (key, name, metric, threshold, window_days, severity, permission_key)
         VALUES ('approval_ageing.engine_off', 'Waiting Approvals Off', 'approval_ageing', 2, NULL, 'low', 'people.approve')
         RETURNING home_alert_rule_id`,
      );
      const off = await tx((c) => alerts.ruleByKey(c, "approval_ageing.engine_off"));
      for (const who of ["chidi", "eze", "dayo"])
        await tx((c) =>
          alerts.raise(c, {
            rule: off,
            subject: { type: "employee", id: people[who].employee_id },
            value: 2,
            title: `${who}: missing clock-outs`,
            subject_employee_id: people[who].employee_id,
          }),
        );
      const { home_alert_id: done } = await one(
        "SELECT home_alert_id FROM home_alert WHERE home_alert_rule_id = $1 AND subject_id = $2",
        [ruleId, people.dayo.employee_id],
      );
      await tx((c) => alerts.clear(c, { alert_id: done, actor: people.ada }));

      await expect(alerts.closeForRule(pool, { rule_id: ruleId, actor: people.eze })).rejects.toThrow(/atomically/);
      expect(await tx((c) => alerts.closeForRule(c, { rule_id: ruleId, actor: people.eze }))).toBe(2);
      expect(await tx((c) => alerts.closeForRule(c, { rule_id: ruleId, actor: people.eze }))).toBe(0);
      const { rows } = await q(
        "SELECT outcome, note, cleared_by FROM home_alert WHERE home_alert_rule_id = $1 ORDER BY outcome, note NULLS FIRST",
        [ruleId],
      );
      expect(rows).toEqual([
        { outcome: "cleared", note: null, cleared_by: people.ada.user_id },
        { outcome: "dismissed", note: "Rule switched off", cleared_by: null },
        { outcome: "dismissed", note: "Rule switched off", cleared_by: null },
      ]);
      const audited = await q(
        `SELECT payload->>'outcome' AS outcome, payload->>'rule_off' AS rule_off, actor_user_id FROM event_log
          WHERE event_key = 'home.alert_cleared' AND payload->>'rule_key' = 'approval_ageing.engine_off'
          ORDER BY occurred_at`,
      );
      expect(audited.rows).toEqual([
        { outcome: "cleared", rule_off: null, actor_user_id: people.ada.user_id },
        { outcome: "dismissed", rule_off: "true", actor_user_id: people.eze.user_id },
        { outcome: "dismissed", rule_off: "true", actor_user_id: people.eze.user_id },
      ]);

      // Switched back on, what still breaches is raised again; what a person cleared is not.
      const again = (who) =>
        tx((c) =>
          alerts.raise(c, {
            rule: off,
            subject: { type: "employee", id: people[who].employee_id },
            value: 2,
            title: `${who}: missing clock-outs`,
            subject_employee_id: people[who].employee_id,
            since: new Date(Date.now() - 86_400_000),
          }),
        );
      expect((await again("chidi")).created).toBe(true);
      expect((await again("dayo")).raised).toBe(false);
    });

    test("a raise reads its rule again: a switch-off saved first wins over the rule a sweep loaded before it", async () => {
      const { home_alert_rule_id: ruleId } = await one(
        `INSERT INTO home_alert_rule (key, name, metric, threshold, window_days, severity, permission_key)
         VALUES ('approval_ageing.stale', 'Waiting Approvals Stale', 'approval_ageing', 3, NULL, 'medium', 'people.approve')
         RETURNING home_alert_rule_id`,
      );
      // The rule as a sweep loaded it, switched on.
      const stale = await tx((c) => alerts.ruleByKey(c, "approval_ageing.stale"));
      const raiseStale = () =>
        tx((c) =>
          alerts.raise(c, {
            rule: stale,
            subject: { type: "employee", id: people.eze.employee_id },
            value: 4,
            title: "Eze Uche: late arrivals",
            subject_employee_id: people.eze.employee_id,
          }),
        );
      // Switching it off, held as Home's rule change holds it: the raise waits, then reads it off.
      const off = await pool.connect();
      try {
        await off.query("BEGIN");
        await off.query("SELECT 1 FROM home_alert_rule WHERE home_alert_rule_id = $1 FOR UPDATE", [ruleId]);
        await off.query("UPDATE home_alert_rule SET enabled = false WHERE home_alert_rule_id = $1", [ruleId]);
        const raising = raiseStale();
        await off.query("COMMIT");
        expect(await raising).toEqual({ raised: false, created: false, alert: null });
      } finally {
        off.release();
      }
      expect(await raiseStale()).toEqual({ raised: false, created: false, alert: null });
      expect((await one("SELECT count(*)::int AS n FROM home_alert WHERE home_alert_rule_id = $1", [ruleId])).n).toBe(0);
    });

    test("a deadline a person cleared is dealt with for its date only", async () => {
      const deadline = await tx((c) => alerts.ruleByKey(c, "document_expiry.engine"));
      const subject = { type: "document", id: "contract-dayo" };
      const due = (dueOn) =>
        tx((c) =>
          alerts.raise(c, {
            rule: deadline,
            subject,
            value: 10,
            kind: "deadline",
            title: "Dayo Ola: Contract",
            subject_employee_id: people.dayo.employee_id,
            since: new Date(Date.now() - 86_400_000),
            due_on: dueOn,
          }),
        );
      const first = await due("2026-12-01");
      expect(first.alert.due_on).toBeTruthy();
      await tx((c) => alerts.clear(c, { alert_id: first.alert.home_alert_id, actor: people.ada }));
      expect((await due("2026-12-01")).raised).toBe(false);
      expect((await due("2026-11-20")).created).toBe(true);
    });

    test("a date that moves away and back is new evidence, though a person cleared it before", async () => {
      const deadline = await tx((c) => alerts.ruleByKey(c, "document_expiry.engine"));
      const subject = { type: "document", id: "licence-dayo" };
      const due = (dueOn) =>
        tx((c) =>
          alerts.raise(c, {
            rule: deadline,
            subject,
            value: 10,
            kind: "deadline",
            title: "Dayo Ola: Licence",
            subject_employee_id: people.dayo.employee_id,
            since: new Date(Date.now() - 86_400_000),
            due_on: dueOn,
          }),
        );
      const clear = (raised) => tx((c) => alerts.clear(c, { alert_id: raised.alert.home_alert_id, actor: people.ada }));
      // A, cleared; then B, cleared; then back to A: the date changed, so it is raised again.
      await clear(await due("2026-12-01"));
      await clear(await due("2026-11-20"));
      const back = await due("2026-12-01");
      expect(back).toMatchObject({ raised: true, created: true });
      expect(back.alert.due_on).toBeTruthy();
      // Cleared again, the same date is the same evidence.
      await clear(back);
      expect(await due("2026-12-01")).toEqual({ raised: false, created: false, alert: null });
      expect((await one("SELECT count(*)::int AS n FROM home_alert WHERE subject_id = 'licence-dayo'")).n).toBe(3);
    });
  });

  describe("field masking", () => {
    test("masks for the role, never for the CEO", async () => {
      const data = { name: "Chidi", base_salary: "450000.00", nested: [{ net_pay: "400000.00" }] };
      expect(await maskForUser(pool, people.eze, data)).toEqual({ name: "Chidi", base_salary: null, nested: [{ net_pay: null }] });
      expect(await maskForUser(pool, people.ada, data)).toBe(data);
      expect(await maskForUser(pool, people.dayo, data)).toBe(data);
    });
  });

  describe("resource kit", () => {
    const repo = makeRepo({
      table: "test_thing",
      pk: "test_thing_id",
      columns: "test_thing_id, number, name, owner_employee_id, archived_at, created_at, updated_at",
      writable: ["name", "owner_employee_id"],
      search: ["name"],
      sort: { name: "name", newest: "created_at DESC" },
      scope: { column: "owner_employee_id" },
      archive: { column: "archived_at" },
      touch: "updated_at",
    });
    const service = makeService({
      repo,
      entity: "test_thing",
      events: { created: EV.TEST_THING_CREATED, updated: EV.TEST_THING_UPDATED, archived: EV.TEST_THING_ARCHIVED },
      numbering: { docType: "query" },
      db: pool,
    });
    const own = (p) => ({ scope: "own", scope_ids: [p.employee_id] });
    const all = { scope: "all", scope_ids: null };

    test("create numbers, emits and refuses unknown fields", async () => {
      const row = await service.create({ name: "Été report", owner_employee_id: people.chidi.employee_id }, people.dayo);
      expect(row.number).toBe("QRY-0001");
      expect((await one("SELECT count(*)::int AS n FROM event_log WHERE entity_id = $1", [row.test_thing_id])).n).toBe(1);
      await expect(service.create({ name: "x", number: "QRY-9999" }, people.dayo)).rejects.toMatchObject({ code: "FIELD_NOT_WRITABLE" });
      expect((await one("SELECT last_value::int AS last_value FROM numbering_counter WHERE doc_type = 'query'")).last_value).toBe(1);
      await service.create({ name: "Other", owner_employee_id: people.bola.employee_id }, people.dayo);
    });

    test("lists page at 25, search folds accents, scope applies", async () => {
      const mine = await service.list({ q: "ete" }, own(people.chidi));
      expect(mine.data.map((r) => r.name)).toEqual(["Été report"]);
      expect((await service.list({}, own(people.chidi))).page.total).toBe(1);
      expect((await service.list({}, all)).page.total).toBe(2);
      await expect(service.list({ sort: "evil" }, all)).rejects.toMatchObject({ code: "INVALID_SORT" });
    });

    test("outside scope is a 404; update and archive are audited", async () => {
      const other = (await service.list({ q: "other" }, all)).data[0];
      await expect(service.get(other.test_thing_id, own(people.chidi))).rejects.toMatchObject({ status: 404 });
      await expect(service.update(other.test_thing_id, { name: "Hijack" }, people.chidi, own(people.chidi))).rejects.toMatchObject({ status: 404 });
      const updated = await service.update(other.test_thing_id, { name: "Other, renamed" }, people.dayo, all);
      expect(updated.name).toBe("Other, renamed");
      const audit = await one("SELECT changed_fields FROM audit_ledger WHERE action = 'test_thing.updated' AND entity_id = $1", [other.test_thing_id]);
      expect(audit.changed_fields).toEqual(["name", "updated_at"]);
      const archived = await service.archive(other.test_thing_id, people.dayo, all);
      expect(archived.archived_at).toBeTruthy();
      expect((await service.list({}, all)).page.total).toBe(1);
    });
  });
});
