"use strict";
/**
 * Home's schema (migrations/1150_home_foundation.sql) and reference data
 * (seeds/reference/1199_seed_home.sql) on the real migrations: the columns Home's modules write,
 * the constraints that refuse a bad row, report run numbers, the capabilities each system role is
 * given, and 1099's alert thresholds moved out under A26, both ways.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/home-schema
 *
 * Refuses to run unless the database name ends in "_test": it drops and rebuilds the public
 * schema from the real migrations (helpers/schema.js). A test that runs a seed section, or
 * changes rows the seed judges, does it in a transaction it rolls back.
 */
const { config } = require("../../src/config/env");
const schema = require("./helpers/schema");
const { pool } = require("../../src/config/db");
const { atomically } = require("../../src/shared/db/tx");
const migrate = require("../../scripts/db/migrate");
const numbering = require("../../src/shared/numbering/numbering");
const alerts = require("../../src/shared/alerts/alerts");
const catalog = require("../../src/shared/access/access.catalog");

const SEED = migrate.listMigrations().find((f) => f.name === "1199_seed_home");

/** The three thresholds 1099 seeded: key, metric, threshold, window_days, severity, permission_key. */
const SEEDED_RULES = [
  ["attendance.absence", "absence_count", 1, 1, "high", "people.view"],
  ["attendance.lateness", "late_count", 3, 30, "medium", "people.view"],
  ["leave.pending", "pending_days", 2, null, "medium", "people.approve"],
];
const SEEDED_KEYS = SEEDED_RULES.map(([key]) => key);
const HOME_CAPABILITIES = ["alerts.manage", "home.reports", "home.team"];

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

/** Run `fn` on one connection inside a transaction that is always rolled back. */
async function rolledBack(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    return await fn(client);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

/** The statement fails with this SQLSTATE, naming this constraint (or column, for NOT NULL). */
const refused = (promise, code, name) =>
  expect(promise).rejects.toMatchObject(code === "23502" ? { code, column: name } : { code, constraint: name });

/** The three rules as 1099 left them on a database that 1150 then gave names to. */
async function restoreSeededRules(client) {
  for (const [key, metric, threshold, windowDays, severity, permissionKey] of SEEDED_RULES) {
    await client.query(
      `INSERT INTO home_alert_rule (key, name, metric, threshold, window_days, severity, permission_key, enabled)
       VALUES ($1::text, $1::text, $2, $3, $4, $5, $6, true)`,
      [key, metric, threshold, windowDays, severity, permissionKey],
    );
  }
}

async function seededKeysLeft(client) {
  const { rows } = await client.query(
    "SELECT key::text AS key FROM home_alert_rule WHERE key = ANY($1::citext[]) ORDER BY key",
    [SEEDED_KEYS],
  );
  return rows.map((r) => r.key);
}

async function columnsOf(table) {
  const { rows } = await q(
    `SELECT column_name, is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
    [table],
  );
  return rows;
}

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

describeDb("Home schema and reference data against the real migrations", () => {
  const people = {};
  let seq = 0;
  const nextNumber = () => {
    seq += 1;
    return `TEST-${seq}`;
  };

  /** A saved report owned by Ada, with nothing scheduled. */
  const report = async (name) =>
    (
      await one(
        `INSERT INTO saved_report (owner_user_id, name, report_key, definition)
         VALUES ($1, $2, 'daily_attendance', '{}'::jsonb) RETURNING saved_report_id`,
        [people.ada.user_id, name],
      )
    ).saved_report_id;

  /** A schedule for `reportId`; `extra` names further columns and their values. */
  const schedule = (reportId, extra = {}) => {
    const cols = ["saved_report_id", "recurrence", "recipients", "starts_on", ...Object.keys(extra)];
    const recurrence = { freq: "daily", interval: 1, working_days_only: true };
    const vals = [reportId, recurrence, ["ada@mycity.test"], "2026-10-19", ...Object.values(extra)];
    return q(
      `INSERT INTO report_schedule (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})
       RETURNING report_schedule_id, run_time, formats, recipient_user_ids`,
      vals,
    );
  };

  /** A run of `reportId` for Ada in PDF, on demand unless `extra` says otherwise. */
  const run = (reportId, extra = {}) => {
    const fields = { number: nextNumber(), saved_report_id: reportId, recipient_user_id: people.ada.user_id, format: "pdf", ...extra };
    const cols = Object.keys(fields);
    return q(
      `INSERT INTO home_report_run (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})
       RETURNING home_report_run_id, number, status, report_schedule_id, scheduled_for, document_id`,
      Object.values(fields),
    );
  };

  beforeAll(async () => {
    await schema.rebuild(pool, config.DB_NAME);
    for (const [key, first, last] of [["ada", "Ada", "Obi"], ["bola", "Bola", "Ade"]]) {
      const employeeId = (await one(schema.sql.employee, [first, last, null])).employee_id;
      const { user_id: userId } = await one(schema.sql.userPlain, [employeeId, `${key}@mycity.test`]);
      people[key] = { employee_id: employeeId, user_id: userId };
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  describe("tables and columns", () => {
    test("the new tables have the columns the Home modules write", async () => {
      expect((await columnsOf("home_report_run")).map((c) => c.column_name)).toEqual([
        "home_report_run_id",
        "number",
        "saved_report_id",
        "report_schedule_id",
        "scheduled_for",
        "recipient_user_id",
        "requested_by",
        "format",
        "status",
        "document_id",
        "emailed_at",
        "error",
        "run_at",
        "finished_at",
        "created_at",
        "updated_at",
      ]);
      expect((await columnsOf("role_kpi")).map((c) => c.column_name)).toEqual([
        "role_kpi_id",
        "role_id",
        "default_ids",
        "locked_ids",
        "updated_by",
        "created_at",
        "updated_at",
      ]);
      expect((await columnsOf("home_kpi_pick")).map((c) => c.column_name)).toEqual([
        "home_kpi_pick_id",
        "user_id",
        "kpi_ids",
        "created_at",
        "updated_at",
      ]);
    });

    test("the tables 1000 built gain what Home needs, required where every writer supplies it", async () => {
      const shape = async (table, names) =>
        (await columnsOf(table)).filter((c) => names.includes(c.column_name)).map((c) => [c.column_name, c.is_nullable]);
      expect(await shape("home_alert_rule", ["name", "created_by", "updated_by"])).toEqual([
        ["name", "NO"],
        ["created_by", "YES"],
        ["updated_by", "YES"],
      ]);
      expect(await shape("home_alert", ["subject_employee_id"])).toEqual([["subject_employee_id", "YES"]]);
      expect(await shape("saved_report", ["archived_at"])).toEqual([["archived_at", "YES"]]);
      expect(await shape("report_schedule", ["starts_on", "run_time", "formats", "recipient_user_ids"])).toEqual([
        ["starts_on", "NO"],
        ["run_time", "NO"],
        ["formats", "NO"],
        ["recipient_user_ids", "NO"],
      ]);
    });

    test("each new table keeps updated_at with its own trigger", async () => {
      for (const table of ["home_report_run", "role_kpi", "home_kpi_pick"]) {
        const { rows } = await q("SELECT tgname FROM pg_trigger WHERE tgrelid = $1::regclass AND NOT tgisinternal", [table]);
        expect(rows.map((r) => r.tgname)).toContain(`${table}_set_updated_at`);
      }
    });

    test("every foreign key on Home's tables has an index that leads with it", async () => {
      const { rows } = await q(
        `SELECT c.conrelid::regclass::text AS table_name, a.attname AS column_name
           FROM pg_constraint c
           JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
          WHERE c.contype = 'f'
            AND c.conrelid = ANY($1::regclass[])
            AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid AND i.indkey[0] = c.conkey[1])
          ORDER BY 1, 2`,
        [["home_alert_rule", "home_alert", "saved_report", "report_schedule", "home_report_run", "role_kpi", "home_kpi_pick"]],
      );
      expect(rows).toEqual([]);
    });

    test("Activity Today reads the day's events through an index; the roster reads a day through the attendance module's", async () => {
      const { rows } = await q("SELECT tablename, indexdef FROM pg_indexes WHERE indexname = ANY($1) ORDER BY tablename, indexname", [
        ["attendance_event_occurred_idx", "event_log_occurred_idx", "attendance_day_date_status_idx", "attendance_event_one_active_slot_uq"],
      ]);
      // The day's clock-in is read through attendance's one-active index, which leads with the person, the
      // day and the type; since 1380 it holds one punch a slot, so a punch People rejected frees its place.
      expect(rows.map((r) => [r.tablename, r.indexdef.replace(/^.* USING btree /, "")])).toEqual([
        ["attendance_day", "(attendance_date, status)"],
        ["attendance_event", "(employee_id, work_date, event_type, slot) WHERE ((validation_state = ANY (ARRAY['accepted'::text, 'review'::text])) AND (source <> 'system'::text))"],
        ["event_log", "(occurred_at DESC)"],
      ]);
    });
  });

  describe("report run numbers", () => {
    test("the report_run scheme is seeded, and numbers RPT-0001 then RPT-0002, never reset", async () => {
      expect(
        await one("SELECT prefix, padding, separator, reset, include_period FROM numbering_scheme WHERE doc_type = 'report_run'"),
      ).toEqual({ prefix: "RPT", padding: 4, separator: "-", reset: "never", include_period: false });
      const first = await tx((c) => numbering.allocate(c, "report_run"));
      const second = await tx((c) => numbering.allocate(c, "report_run"));
      expect([first.number, second.number]).toEqual(["RPT-0001", "RPT-0002"]);
    });
  });

  describe("alert rules and alerts", () => {
    test("a rule needs a name; who made it and who changed it are users", async () => {
      await refused(
        q(`INSERT INTO home_alert_rule (key, metric, threshold, severity, permission_key)
           VALUES ('approval_ageing.nameless', 'approval_ageing', 3, 'low', 'people.view')`),
        "23502",
        "name",
      );
      await refused(
        q(`INSERT INTO home_alert_rule (key, name, metric, threshold, severity, permission_key, created_by)
           VALUES ('approval_ageing.orphan', 'Orphan', 'approval_ageing', 3, 'low', 'people.view', gen_random_uuid())`),
        "23503",
        "home_alert_rule_created_by_fkey",
      );
    });

    test("Home's own attendance rules stay off (1445): the Attendance policy raises attendance's alerts", async () => {
      for (const metric of ["late_arrivals", "missing_clock_out"])
        await refused(
          q(
            `INSERT INTO home_alert_rule (key, name, metric, threshold, window_days, severity, permission_key)
             VALUES ($1, 'Kept From Before', $2, 3, 30, 'low', 'people.view')`,
            [`${metric}.again`, metric],
          ),
          "23514",
          "home_alert_rule_attendance_retired_check",
        );
      // Switched off, a rule from before is kept with its alerts.
      await q(
        `INSERT INTO home_alert_rule (key, name, metric, threshold, window_days, severity, permission_key, enabled)
         VALUES ('late_arrivals.kept', 'Kept From Before', 'late_arrivals', 3, 30, 'low', 'people.view', false)`,
      );
      await refused(q("UPDATE home_alert_rule SET enabled = true WHERE key = 'late_arrivals.kept'"), "23514", "home_alert_rule_attendance_retired_check");
    });

    test("alerts.raise still raises, and the alert keeps the employee it is about", async () => {
      await q(
        `INSERT INTO home_alert_rule (key, name, metric, threshold, window_days, severity, permission_key, created_by)
         VALUES ('approval_ageing.schema', 'Waiting Approvals', 'approval_ageing', 3, NULL, 'high', 'people.approve', $1)`,
        [people.ada.user_id],
      );
      const rule = await tx((c) => alerts.ruleByKey(c, "approval_ageing.schema"));
      const out = await tx((c) =>
        alerts.raise(c, {
          rule,
          subject: { type: "employee", id: people.bola.employee_id },
          value: 4,
          title: "Bola Ade: waiting 4 days",
          subject_employee_id: people.bola.employee_id,
        }),
      );
      expect(out).toMatchObject({ raised: true, created: true });
      expect(await one("SELECT subject_employee_id FROM home_alert WHERE home_alert_id = $1", [out.alert.home_alert_id])).toEqual({
        subject_employee_id: people.bola.employee_id,
      });
      await refused(
        q("UPDATE home_alert SET subject_employee_id = gen_random_uuid() WHERE home_alert_id = $1", [out.alert.home_alert_id]),
        "23503",
        "home_alert_subject_employee_id_fkey",
      );
    });
  });

  describe("report schedules", () => {
    test("a schedule runs at 18:00 in PDF until told otherwise, and needs its start day", async () => {
      const { rows } = await schedule(await report("Defaults"));
      expect(rows[0]).toEqual(expect.objectContaining({ run_time: "18:00:00", formats: ["pdf"], recipient_user_ids: [] }));
      await refused(
        q(
          `INSERT INTO report_schedule (saved_report_id, recurrence, recipients) VALUES ($1, '{"freq":"daily","interval":1}', '{}')`,
          [await report("No Start")],
        ),
        "23502",
        "starts_on",
      );
    });

    test("formats are PDF, XLSX or both, never none and never anything else", async () => {
      const both = await schedule(await report("Both Formats"), { formats: ["pdf", "xlsx"], recipient_user_ids: [people.ada.user_id] });
      expect(both.rows[0]).toEqual(expect.objectContaining({ formats: ["pdf", "xlsx"], recipient_user_ids: [people.ada.user_id] }));
      for (const formats of [[], ["csv"], ["pdf", null]]) {
        await refused(schedule(await report(`Formats ${JSON.stringify(formats)}`), { formats }), "23514", "report_schedule_formats_check");
      }
    });

    test("a report has one schedule", async () => {
      const id = await report("One Schedule");
      await schedule(id);
      await refused(schedule(id), "23505", "report_schedule_report_uq");
    });
  });

  describe("report runs", () => {
    test("a run starts pending with no file; format and status are the contract's", async () => {
      const id = await report("Run Basics");
      const [first] = (await run(id)).rows;
      expect(first).toEqual(expect.objectContaining({ status: "pending", document_id: null, report_schedule_id: null }));
      await refused(run(id, { format: "csv" }), "23514", "home_report_run_format_check");
      await refused(run(id, { status: "running" }), "23514", "home_report_run_status_check");
      for (const status of ["done", "failed", "skipped"]) expect((await run(id, { status })).rows[0].status).toBe(status);
      await refused(run(id, { number: first.number }), "23505", "home_report_run_number_key");
    });

    test("a slot is generated once per recipient and format; a run on demand may repeat", async () => {
      const id = await report("Slots");
      const { report_schedule_id: scheduleId } = (await schedule(id, { formats: ["pdf", "xlsx"] })).rows[0];
      const slot = { report_schedule_id: scheduleId, scheduled_for: "2026-10-19T17:00:00Z" };
      await run(id, slot);
      await refused(run(id, slot), "23505", "home_report_run_slot_uq");
      await run(id, { ...slot, format: "xlsx" });
      await run(id, { ...slot, recipient_user_id: people.bola.user_id });
      await run(id, { ...slot, scheduled_for: "2026-10-20T17:00:00Z" });
      await refused(run(id, { report_schedule_id: scheduleId }), "23514", "home_report_run_slot_check");
      await run(id);
      await run(id);
      expect((await one("SELECT count(*)::int AS n FROM home_report_run WHERE saved_report_id = $1", [id])).n).toBe(6);
    });

    test("a report with runs is archived, not deleted; a deleted schedule leaves its runs", async () => {
      const id = await report("Kept");
      const { report_schedule_id: scheduleId } = (await schedule(id)).rows[0];
      const slot = { report_schedule_id: scheduleId, scheduled_for: "2026-10-19T17:00:00Z" };
      const { home_report_run_id: runId } = (await run(id, slot)).rows[0];
      await refused(q("DELETE FROM saved_report WHERE saved_report_id = $1", [id]), "23503", "home_report_run_saved_report_id_fkey");
      await q("UPDATE saved_report SET archived_at = now() WHERE saved_report_id = $1", [id]);
      await q("DELETE FROM report_schedule WHERE report_schedule_id = $1", [scheduleId]);
      const kept = await one(
        "SELECT report_schedule_id, scheduled_for IS NOT NULL AS has_slot FROM home_report_run WHERE home_report_run_id = $1",
        [runId],
      );
      expect(kept).toEqual({ report_schedule_id: null, has_slot: true });
    });
  });

  describe("KPI cards", () => {
    test("a role has at most four default cards, and locks only cards among them", async () => {
      const roleId = (await one(schema.sql.role, ["kpi_lead"])).role_id;
      const save = (defaults, locked) =>
        q("INSERT INTO role_kpi (role_id, default_ids, locked_ids) VALUES ($1, $2, $3)", [roleId, defaults, locked]);
      await refused(save(["a", "b", "c", "d", "e"], []), "23514", "role_kpi_default_ids_check");
      await refused(save(["headcount"], ["attendance_today"]), "23514", "role_kpi_locked_ids_check");
      await save(["headcount", "attendance_today", "tasks_overdue", "expenses_pending"], ["headcount", "tasks_overdue"]);
      await refused(save([], []), "23505", "role_kpi_role_id_key");
      await q("DELETE FROM role WHERE role_id = $1", [roleId]);
      expect((await one("SELECT count(*)::int AS n FROM role_kpi WHERE role_id = $1", [roleId])).n).toBe(0);
    });

    test("a person picks at most four cards, or none, once", async () => {
      const pick = (userId, ids) => q("INSERT INTO home_kpi_pick (user_id, kpi_ids) VALUES ($1, $2)", [userId, ids]);
      await refused(pick(people.ada.user_id, ["a", "b", "c", "d", "e"]), "23514", "home_kpi_pick_kpi_ids_check");
      await pick(people.ada.user_id, ["headcount", "attendance_today", "tasks_overdue", "expenses_pending"]);
      await pick(people.bola.user_id, []);
      await refused(pick(people.ada.user_id, []), "23505", "home_kpi_pick_user_id_key");
    });
  });

  describe("capabilities", () => {
    test("each system role holds the capabilities 0449 and 1199 give it", async () => {
      const { rows } = await q(
        `SELECT r.code::text AS role,
                COALESCE(array_agg(c.code::text ORDER BY c.code::text) FILTER (WHERE c.code IS NOT NULL), '{}') AS codes
           FROM role r
           LEFT JOIN role_capability rc ON rc.role_id = r.role_id
           LEFT JOIN capability c ON c.capability_id = rc.capability_id
          WHERE r.code = ANY($1::citext[])
          GROUP BY r.code`,
        [["implementation", "operations_people", "management", "head_of_department", "administrator", "manager", "employee"]],
      );
      const all = ["alerts.clear", "alerts.manage", "announcements.post", "home.reports", "home.team"];
      const managers = ["alerts.clear", "home.reports", "home.team"];
      // 1129 (Mailbox) adds Configure Signature to System Administrator and Implementation; 1396
      // (policies) Manage Policies to Operations & People and Implementation; 2190 (Performance) the
      // goals and performance capabilities (performance.md §8).
      const goals = ["goals.company", "goals.confirm", "goals.function", "goals.organisation"];
      const sorted = (codes) => [...codes].sort();
      expect(Object.fromEntries(rows.map((r) => [r.role, r.codes]))).toEqual({
        implementation: sorted([...all, ...goals, "mailbox.signature", "performance.manage", "policies.manage"]),
        operations_people: sorted([...all, "goals.function", "performance.manage", "policies.manage"]),
        management: sorted([...all, "goals.company", "goals.function"]),
        head_of_department: sorted([...managers, "goals.function"]),
        manager: managers,
        administrator: ["mailbox.signature"],
        employee: [],
      });
    });

    test("each capability is seeded with the name and description the catalogue declares", async () => {
      const { rows } = await q(
        "SELECT code::text AS code, name, description FROM capability WHERE code = ANY($1::citext[]) ORDER BY code::text",
        [HOME_CAPABILITIES],
      );
      const declared = catalog.CAPABILITY_CATALOG.filter((c) => HOME_CAPABILITIES.includes(c.code))
        .map((c) => ({ code: c.code, name: c.label, description: c.description }))
        .sort((a, b) => a.code.localeCompare(b.code));
      expect(rows).toEqual(declared);
    });
  });

  describe("1099's alert thresholds move out (A26)", () => {
    test("a database built from the migrations has none of them", async () => {
      expect(await seededKeysLeft(pool)).toEqual([]);
    });

    test.each([
      ["its threshold changed", "UPDATE home_alert_rule SET threshold = 5 WHERE key = $1"],
      ["its window changed", "UPDATE home_alert_rule SET window_days = 14 WHERE key = $1"],
      ["its severity changed", "UPDATE home_alert_rule SET severity = 'high' WHERE key = $1"],
      ["it was renamed", "UPDATE home_alert_rule SET name = 'Lateness' WHERE key = $1"],
      ["it was switched off", "UPDATE home_alert_rule SET enabled = false WHERE key = $1"],
      [
        "someone saved it on Home unchanged",
        "UPDATE home_alert_rule SET updated_by = (SELECT user_id FROM app_user WHERE email = 'ada@mycity.test') WHERE key = $1",
      ],
    ])("a rule stays when %s; the untouched ones go", async (_why, edit) => {
      await rolledBack(async (c) => {
        await restoreSeededRules(c);
        await c.query(edit, ["attendance.lateness"]);
        await c.query(SEED.up);
        expect(await seededKeysLeft(c)).toEqual(["attendance.lateness"]);
      });
    });

    test("a rule an alert points at stays", async () => {
      await rolledBack(async (c) => {
        await restoreSeededRules(c);
        await c.query(
          `INSERT INTO home_alert (home_alert_rule_id, subject_type, subject_id, title, severity)
           SELECT home_alert_rule_id, 'leave_request', 'a-request', 'Leave waiting 3 days', 'medium'
             FROM home_alert_rule WHERE key = 'leave.pending'`,
        );
        await c.query(SEED.up);
        expect(await seededKeysLeft(c)).toEqual(["leave.pending"]);
      });
    });
  });

  describe("undoing 1199", () => {
    test("gives the thresholds back and takes back only the grants and capabilities it gave", async () => {
      await rolledBack(async (c) => {
        // Someone gave home.team to a role of their own on Settings: it is theirs now.
        const studio = (await c.query(schema.sql.role, ["studio_lead"])).rows[0].role_id;
        await c.query(
          "INSERT INTO role_capability (role_id, capability_id) SELECT $1, capability_id FROM capability WHERE code = 'home.team'",
          [studio],
        );
        await c.query(SEED.down);

        const codes = await c.query("SELECT code::text AS code FROM capability ORDER BY code::text");
        // 1129's capability is Mailbox's, 1396's the policies' and 2190's Performance's, untouched by
        // undoing Home's seed.
        expect(codes.rows.map((r) => r.code)).toEqual([
          "alerts.clear",
          "announcements.post",
          "goals.company",
          "goals.confirm",
          "goals.function",
          "goals.organisation",
          "home.team",
          "mailbox.signature",
          "performance.manage",
          "policies.manage",
        ]);
        const heldBy = async (role) =>
          (
            await c.query(
              `SELECT c.code::text AS code FROM role_capability rc
                 JOIN role r ON r.role_id = rc.role_id JOIN capability c ON c.capability_id = rc.capability_id
                WHERE r.code = $1 ORDER BY c.code::text`,
              [role],
            )
          ).rows.map((r) => r.code);
        expect(await heldBy("operations_people")).toEqual(["alerts.clear", "announcements.post", "goals.function", "performance.manage", "policies.manage"]);
        expect(await heldBy("manager")).toEqual([]);
        expect(await heldBy("studio_lead")).toEqual(["home.team"]);
        expect(await seededKeysLeft(c)).toEqual([...SEEDED_KEYS].sort());
      });
    });

    test("keeps an alerts.clear grant made on Settings before 1199 ran", async () => {
      await rolledBack(async (c) => {
        // Settings records who granted a row; the seed never does. A manager given alerts.clear on
        // screen keeps it when 1199 is rolled back.
        await c.query(
          `DELETE FROM role_capability rc USING role r, capability c
            WHERE rc.role_id = r.role_id AND rc.capability_id = c.capability_id
              AND r.code = 'manager' AND c.code = 'alerts.clear'`,
        );
        await c.query(
          `INSERT INTO role_capability (role_id, capability_id, granted_by)
           SELECT r.role_id, c.capability_id, $1 FROM role r, capability c
            WHERE r.code = 'manager' AND c.code = 'alerts.clear'`,
          [people.ada.user_id],
        );
        await c.query(SEED.down);
        const held = await c.query(
          `SELECT c.code::text AS code FROM role_capability rc
             JOIN role r ON r.role_id = rc.role_id JOIN capability c ON c.capability_id = rc.capability_id
            WHERE r.code = 'manager' ORDER BY c.code::text`,
        );
        expect(held.rows.map((r) => r.code)).toEqual(["alerts.clear"]);
      });
    });

    test("keeps the report_run scheme once a number was issued, and removes it before", async () => {
      await rolledBack(async (c) => {
        await c.query(
          `INSERT INTO numbering_counter (doc_type, period, last_value) VALUES ('report_run', '', 1)
           ON CONFLICT (doc_type, period) DO NOTHING`,
        );
        await c.query(SEED.down);
        expect((await c.query("SELECT count(*)::int AS n FROM numbering_scheme WHERE doc_type = 'report_run'")).rows[0].n).toBe(1);
      });
      await rolledBack(async (c) => {
        await c.query("DELETE FROM numbering_counter WHERE doc_type = 'report_run'");
        await c.query(SEED.down);
        expect((await c.query("SELECT count(*)::int AS n FROM numbering_scheme WHERE doc_type = 'report_run'")).rows[0].n).toBe(0);
      });
    });
  });
});
