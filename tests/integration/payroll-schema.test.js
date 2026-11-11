"use strict";
/**
 * M6's schema and reference data (migrations 6000, 6010, 6030, seeds/reference/6099_seed_payroll.sql;
 * docs/guides/payroll.md §4) on the real migrations: the shape every table must have (a trigger, an
 * index and an ON DELETE on each foreign key, a CHECK equal to the contract's enum), the rows the
 * constraints refuse, the numbers a run and a payslip are given, the seed both ways, and the files
 * undone and applied again.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/payroll-schema
 *
 * Refuses to run unless the database name ends in "_test": it drops and rebuilds the public schema
 * from the real migrations (helpers/schema.js). A test that changes rows does it in a transaction it
 * rolls back.
 */
const { config } = require("../../src/config/env");
const schema = require("./helpers/schema");
const { pool } = require("../../src/config/db");
const { atomically } = require("../../src/shared/db/tx");
const migrate = require("../../scripts/db/migrate");
const numbering = require("../../src/shared/numbering/numbering");
const effectiveDated = require("../../src/shared/db/effective-dated");
const definitions = require("../../src/shared/workflow/definitions");
const catalog = require("../../src/shared/access/access.catalog");
const c = require("@mycity/contract");

const FILES = Object.fromEntries(migrate.listMigrations().map((f) => [f.name, f]));
const M6 = ["6000_payroll", "6010_payroll_deductions", "6030_leave_unpaid", "6099_seed_payroll"].map((n) => FILES[n]);

const TABLES = [
  "payroll_setting",
  "payroll_run",
  "payslip",
  "payslip_line",
  "payroll_adjustment",
  "payroll_deduction",
  "payroll_deduction_instalment",
];

const q = (sql, params) => pool.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];

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

/** The statement fails with this SQLSTATE, naming this constraint. */
const refused = (promise, code, constraint) => expect(promise).rejects.toMatchObject({ code, constraint });

/**
 * A refusal aborts the transaction it happens in; a savepoint taken first keeps it usable for the next.
 * `statement` is a function, so it runs after the savepoint rather than while the arguments are read.
 */
async function refusedHere(client, statement, code, constraint) {
  await client.query("SAVEPOINT refusal");
  await refused(statement(), code, constraint);
  await client.query("ROLLBACK TO SAVEPOINT refusal");
}

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

describeDb("M6 payroll schema and reference data against the real migrations", () => {
  let ada;
  let bola;
  let adaUser;
  let seq = 0;
  const next = (prefix) => {
    seq += 1;
    return `${prefix}-T${seq}`;
  };

  const run = async (cl, period, columns = {}) => {
    const names = ["number", "period", ...Object.keys(columns)];
    const values = [next("PAY"), period, ...Object.values(columns)];
    const marks = names.map((_, i) => `$${i + 1}`).join(", ");
    return (await cl.query(`INSERT INTO payroll_run (${names.join(", ")}) VALUES (${marks}) RETURNING payroll_run_id`, values)).rows[0].payroll_run_id;
  };
  const slip = async (cl, runId, employeeId, columns = {}) => {
    const names = ["number", "payroll_run_id", "employee_id", ...Object.keys(columns)];
    const values = [next("SLIP"), runId, employeeId, ...Object.values(columns)];
    const marks = names.map((_, i) => `$${i + 1}`).join(", ");
    return (await cl.query(`INSERT INTO payslip (${names.join(", ")}) VALUES (${marks}) RETURNING payslip_id`, values)).rows[0].payslip_id;
  };
  const line = (cl, payslipId, columns = {}) => {
    const row = { payslip_id: payslipId, position: 1, kind: "earning", code: "monthly_pay", label: "Monthly Pay", amount: "450000.00", ...columns };
    const names = Object.keys(row);
    return cl.query(`INSERT INTO payslip_line (${names.join(", ")}) VALUES (${names.map((_, i) => `$${i + 1}`).join(", ")})`, Object.values(row));
  };
  /** A fine: a query, a sanction and its fine, for `employeeId`. */
  const fine = async (cl, employeeId) => {
    const query = (await cl.query("INSERT INTO employee_query (number, employee_id, subject, details) VALUES ($1, $2, 'Late', 'Late again') RETURNING employee_query_id", [next("QRY"), employeeId])).rows[0].employee_query_id;
    const sanction = (
      await cl.query(
        `INSERT INTO sanction (employee_query_id, employee_id, sanction_type, reason, decided_by, effective_on)
         VALUES ($1, $2, 'fine', 'Late again', $3, DATE '2026-10-01') RETURNING sanction_id`,
        [query, employeeId, adaUser],
      )
    ).rows[0].sanction_id;
    return (await cl.query("INSERT INTO sanction_fine (sanction_id, amount_ngn) VALUES ($1, 45000) RETURNING sanction_fine_id", [sanction])).rows[0].sanction_fine_id;
  };
  const deduction = async (cl, columns = {}) => {
    const row = { employee_id: ada, source: "salary_advance", reason: "Advance", total_amount: "75000.00", instalments: 3, start_period: "2026-10-01", ...columns };
    const names = Object.keys(row);
    return (await cl.query(`INSERT INTO payroll_deduction (${names.join(", ")}) VALUES (${names.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING payroll_deduction_id`, Object.values(row))).rows[0].payroll_deduction_id;
  };
  const instalment = (cl, deductionId, period, columns = {}) => {
    const row = { payroll_deduction_id: deductionId, period, amount: "25000.00", ...columns };
    const names = Object.keys(row);
    return cl.query(`INSERT INTO payroll_deduction_instalment (${names.join(", ")}) VALUES (${names.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING payroll_deduction_instalment_id`, Object.values(row));
  };

  beforeAll(async () => {
    await schema.rebuild(pool, config.DB_NAME);
    ada = (await one(schema.sql.employee, ["Ada", "Obi", null])).employee_id;
    bola = (await one(schema.sql.employee, ["Bola", "Ade", null])).employee_id;
    adaUser = (await one(schema.sql.userPlain, [ada, "ada.obi@staff.mycity.test"])).user_id;
  });

  afterAll(() => pool.end());

  describe("the shape of every table", () => {
    test("each has its own updated_at trigger, named after it (9095 adds the plain one beside it on a fresh database)", async () => {
      const rows = (
        await q(
          `SELECT c.relname AS tbl, array_agg(t.tgname::text ORDER BY t.tgname::text) AS triggers
             FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
            WHERE NOT t.tgisinternal AND c.relname = ANY($1) GROUP BY c.relname`,
          [TABLES],
        )
      ).rows;
      const triggers = Object.fromEntries(rows.map((r) => [r.tbl, r.triggers]));
      expect(Object.keys(triggers).sort()).toEqual([...TABLES].sort());
      for (const t of TABLES) expect({ table: t, triggers: triggers[t] }).toEqual({ table: t, triggers: expect.arrayContaining([`${t}_set_updated_at`]) });
    });

    test("every foreign key says ON DELETE and is the first column of an index", async () => {
      const keys = (
        await q(
          `SELECT c.conrelid::regclass::text AS tbl, c.conname, c.confdeltype AS on_delete,
                  EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid AND i.indkey[0] = c.conkey[1]) AS indexed
             FROM pg_constraint c
            WHERE c.contype = 'f' AND c.conrelid::regclass::text = ANY($1)`,
          [[...TABLES, "attendance_pay_item"]],
        )
      ).rows.filter((k) => k.tbl !== "attendance_pay_item" || k.conname === "attendance_pay_item_payroll_run_fk");
      // setting 1, run 4, payslip 3, line 1, adjustment 3, deduction 3, instalment 2, and the pay item's own.
      expect(keys).toHaveLength(18);
      // 'a' is NO ACTION, what Postgres does when no ON DELETE is written.
      expect(keys.filter((k) => k.on_delete === "a").map((k) => k.conname)).toEqual([]);
      expect(keys.filter((k) => !k.indexed).map((k) => k.conname)).toEqual([]);
    });

    test("a status or type CHECK holds exactly the contract's values", async () => {
      const checks = [
        ["payroll_run", "status", c.payroll.RunStatus.options],
        ["payroll_setting", "paye_basis", c.payroll.PayeBasis.options],
        ["payslip", "status", c.payslips.PayslipStatus.options],
        ["payslip_line", "kind", c.payslips.PayslipLineKind.options],
        ["payslip_line", "code", c.payslips.PayslipLineCode.options],
        ["payroll_adjustment", "kind", c.payroll.AdjustmentKind.options],
        ["payroll_deduction", "status", c.deductions.DeductionState.options],
        ["payroll_deduction", "source", ["sanction_fine", "salary_advance"]],
        ["payroll_deduction_instalment", "status", c.deductions.InstalmentStatus.options],
      ];
      for (const [table, column, values] of checks) {
        const defs = (await q("SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = $1::regclass AND contype = 'c'", [table])).rows.map((r) => r.def);
        const def = defs.find((d) => d.startsWith(`CHECK ((${column} = ANY`) || d.startsWith(`CHECK (${column} = ANY`));
        expect({ table, column, found: Boolean(def) }).toEqual({ table, column, found: true });
        const listed = [...def.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]);
        expect({ table, column, values: listed.sort() }).toEqual({ table, column, values: [...values].sort() });
      }
    });
  });

  describe("the setting", () => {
    test("a pay day is 1 to 31, its scope is the organisation, and a version ends after it starts", async () => {
      await rolledBack(async (cl) => {
        const insert = (columns) => {
          const names = Object.keys(columns);
          return cl.query(`INSERT INTO payroll_setting (${names.join(", ")}) VALUES (${names.map((_, i) => `$${i + 1}`).join(", ")})`, Object.values(columns));
        };
        await insert({ effective_from: "2026-11-01", pay_day: 31 });
        await refusedHere(cl, () => insert({ effective_from: "2026-01-01", effective_to: "2026-02-01", pay_day: 0 }), "23514", "payroll_setting_pay_day_check");
        await refusedHere(cl, () => insert({ effective_from: "2026-01-01", effective_to: "2026-02-01", pay_day: 32 }), "23514", "payroll_setting_pay_day_check");
        await refusedHere(cl, () => insert({ effective_from: "2026-01-01", effective_to: "2026-02-01", scope: "branch" }), "23514", "payroll_setting_scope_check");
        await refusedHere(cl, () => insert({ effective_from: "2026-02-01", effective_to: "2026-02-01" }), "23514", "payroll_setting_span_check");
        await refusedHere(cl, () => insert({ effective_from: "2026-01-01", effective_to: "2026-02-01", paye_basis: "weekly" }), "23514", "payroll_setting_paye_basis_check");
      });
    });

    test("two versions never overlap, and a new version closes the one before it (addVersion)", async () => {
      await rolledBack(async (cl) => {
        const key = { scope: "organisation" };
        const writable = ["advanced_enabled", "pay_day", "require_bank_details"];
        await effectiveDated.addVersion(cl, { table: "payroll_setting", key, from: "2026-11-01", data: { pay_day: 28 }, writable });
        await effectiveDated.addVersion(cl, { table: "payroll_setting", key, from: "2026-12-01", data: { advanced_enabled: true, pay_day: 30 }, writable });
        const versions = (await cl.query("SELECT effective_from::text AS from, effective_to::text AS to, pay_day, advanced_enabled FROM payroll_setting ORDER BY effective_from")).rows;
        expect(versions).toEqual([
          { from: "2026-11-01", to: "2026-12-01", pay_day: 28, advanced_enabled: false },
          { from: "2026-12-01", to: null, pay_day: 30, advanced_enabled: true },
        ]);
        expect((await effectiveDated.versionOn(cl, { table: "payroll_setting", key, on: "2026-11-15" })).pay_day).toBe(28);
        expect((await effectiveDated.versionOn(cl, { table: "payroll_setting", key, on: "2026-12-01" })).advanced_enabled).toBe(true);
        expect(await effectiveDated.versionOn(cl, { table: "payroll_setting", key, on: "2026-10-31" })).toBeNull();
        // A hand-written overlap is refused by the table itself, not only by addVersion.
        await refusedHere(cl, () => cl.query("INSERT INTO payroll_setting (effective_from, effective_to) VALUES ('2026-11-15', '2026-11-20')"), "23P01", "payroll_setting_no_overlap");
      });
    });
  });

  describe("the run, its payslips and their lines", () => {
    test("a run is one month's first day, once, and starts as a draft with nothing in it", async () => {
      await rolledBack(async (cl) => {
        const id = await run(cl, "2026-10-01");
        expect(
          (await cl.query("SELECT status, advanced, headcount, net_total::text AS net, config_snapshot FROM payroll_run WHERE payroll_run_id = $1", [id])).rows[0],
        ).toEqual({ status: "draft", advanced: false, headcount: 0, net: "0.00", config_snapshot: {} });
        await refusedHere(cl, () => run(cl, "2026-10-01"), "23505", "payroll_run_period_key");
        await refusedHere(cl, () => run(cl, "2026-11-15"), "23514", "payroll_run_period_check");
        await refusedHere(cl, () => run(cl, "2026-11-01", { status: "locked" }), "23514", "payroll_run_status_check");
      });
    });

    test("a person has one payslip in a run, and an excluded one has its reason (and only an excluded one)", async () => {
      await rolledBack(async (cl) => {
        const id = await run(cl, "2026-10-01");
        await slip(cl, id, ada);
        await refusedHere(cl, () => slip(cl, id, ada), "23505", "payslip_run_employee_uq");
        await slip(cl, id, bola, { status: "excluded", excluded_reason: "Paid elsewhere" });
        await refusedHere(cl, () => slip(cl, id, bola), "23505", "payslip_run_employee_uq");
        const other = await run(cl, "2026-11-01");
        await refusedHere(cl, () => slip(cl, other, bola, { status: "excluded" }), "23514", "payslip_excluded_reason_check");
        await refusedHere(cl, () => slip(cl, other, bola, { excluded_reason: "Paid elsewhere" }), "23514", "payslip_excluded_reason_check");
        await refusedHere(cl, () => slip(cl, other, bola, { status: "locked" }), "23514", "payslip_status_check");
      });
    });

    test("a line is a known code and kind, and never negative", async () => {
      await rolledBack(async (cl) => {
        const slipId = await slip(cl, await run(cl, "2026-10-01"), ada);
        await line(cl, slipId);
        await line(cl, slipId, { position: 2, kind: "deduction", code: "lateness", label: "Lateness", amount: "0.00" });
        await refusedHere(cl, () => line(cl, slipId, { amount: "-1.00" }), "23514", "payslip_line_amount_check");
        await refusedHere(cl, () => line(cl, slipId, { code: "bonus" }), "23514", "payslip_line_code_check");
        await refusedHere(cl, () => line(cl, slipId, { kind: "tax" }), "23514", "payslip_line_kind_check");
      });
    });

    test("an adjustment is above zero and its label at most 60 characters", async () => {
      await rolledBack(async (cl) => {
        const id = await run(cl, "2026-10-01");
        const add = (columns) => {
          const row = { payroll_run_id: id, employee_id: ada, kind: "earning", label: "Bonus", amount: "5000.00", reason: "October bonus", ...columns };
          const names = Object.keys(row);
          return cl.query(`INSERT INTO payroll_adjustment (${names.join(", ")}) VALUES (${names.map((_, i) => `$${i + 1}`).join(", ")})`, Object.values(row));
        };
        await add({});
        await add({ label: "x".repeat(60) });
        await refusedHere(cl, () => add({ label: "x".repeat(61) }), "23514", "payroll_adjustment_label_check");
        await refusedHere(cl, () => add({ amount: "0.00" }), "23514", "payroll_adjustment_amount_check");
        await refusedHere(cl, () => add({ kind: "bonus" }), "23514", "payroll_adjustment_kind_check");
      });
    });

    test("deleting a run takes its payslips, lines and adjustments; a person with a payslip cannot be deleted", async () => {
      await rolledBack(async (cl) => {
        const id = await run(cl, "2026-10-01");
        const slipId = await slip(cl, id, bola);
        await line(cl, slipId);
        await cl.query("INSERT INTO payroll_adjustment (payroll_run_id, employee_id, kind, label, amount, reason) VALUES ($1, $2, 'earning', 'Bonus', 5000, 'October bonus')", [id, bola]);
        await refusedHere(cl, () => cl.query("DELETE FROM employee WHERE employee_id = $1", [bola]), "23503", "payslip_employee_id_fkey");
        await cl.query("DELETE FROM payroll_run WHERE payroll_run_id = $1", [id]);
        for (const table of ["payslip", "payslip_line", "payroll_adjustment"]) {
          expect({ table, rows: (await cl.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n }).toEqual({ table, rows: 0 });
        }
      });
    });
  });

  describe("deductions and their instalments", () => {
    test("a fine names its fine and an advance does not; months, amount and first month are held", async () => {
      await rolledBack(async (cl) => {
        const fineId = await fine(cl, ada);
        await deduction(cl, { source: "sanction_fine", sanction_fine_id: fineId, total_amount: "45000.00" });
        await deduction(cl);
        await refusedHere(cl, () => deduction(cl, { source: "sanction_fine" }), "23514", "payroll_deduction_fine_check");
        await refusedHere(cl, () => deduction(cl, { sanction_fine_id: fineId }), "23514", "payroll_deduction_fine_check");
        await refusedHere(cl, () => deduction(cl, { instalments: 0 }), "23514", "payroll_deduction_instalments_check");
        await refusedHere(cl, () => deduction(cl, { instalments: 13 }), "23514", "payroll_deduction_instalments_check");
        await refusedHere(cl, () => deduction(cl, { total_amount: "0.00" }), "23514", "payroll_deduction_total_amount_check");
        await refusedHere(cl, () => deduction(cl, { start_period: "2026-10-15" }), "23514", "payroll_deduction_start_check");
        await refusedHere(cl, () => deduction(cl, { status: "paused" }), "23514", "payroll_deduction_status_check");
        await refusedHere(cl, () => deduction(cl, { source: "loan" }), "23514", "payroll_deduction_source_check");
      });
    });

    test("one live deduction a fine: released and cancelled, it can be accepted again", async () => {
      await rolledBack(async (cl) => {
        const fineId = await fine(cl, ada);
        const first = await deduction(cl, { source: "sanction_fine", sanction_fine_id: fineId, total_amount: "45000.00" });
        await refusedHere(cl, () => deduction(cl, { source: "sanction_fine", sanction_fine_id: fineId, total_amount: "45000.00" }), "23505", "payroll_deduction_live_fine_uq");
        await cl.query("UPDATE payroll_deduction SET status = 'cancelled', cancelled_at = now() WHERE payroll_deduction_id = $1", [first]);
        await deduction(cl, { source: "sanction_fine", sanction_fine_id: fineId, total_amount: "45000.00", instalments: 3 });
        // The fine cannot be deleted while a deduction (cancelled or not) names it.
        await refusedHere(cl, () => cl.query("DELETE FROM sanction_fine WHERE sanction_fine_id = $1", [fineId]), "23503", "payroll_deduction_sanction_fine_id_fkey");
      });
    });

    test("an instalment is a month's first day, once a deduction, above zero; the run is a nullable link", async () => {
      await rolledBack(async (cl) => {
        const id = await deduction(cl);
        const runId = await run(cl, "2026-10-01");
        const first = (await instalment(cl, id, "2026-10-01", { payroll_run_id: runId, status: "in_run" })).rows[0].payroll_deduction_instalment_id;
        await instalment(cl, id, "2026-11-01");
        await refusedHere(cl, () => instalment(cl, id, "2026-10-01"), "23505", "payroll_deduction_instalment_month_uq");
        await refusedHere(cl, () => instalment(cl, id, "2026-12-15"), "23514", "payroll_deduction_instalment_period_check");
        await refusedHere(cl, () => instalment(cl, id, "2026-12-01", { amount: "0.00" }), "23514", "payroll_deduction_instalment_amount_check");
        await refusedHere(cl, () => instalment(cl, id, "2026-12-01", { status: "paid" }), "23514", "payroll_deduction_instalment_status_check");
        await cl.query("DELETE FROM payroll_run WHERE payroll_run_id = $1", [runId]);
        expect((await cl.query("SELECT payroll_run_id FROM payroll_deduction_instalment WHERE payroll_deduction_instalment_id = $1", [first])).rows[0]).toEqual({ payroll_run_id: null });
        await cl.query("DELETE FROM payroll_deduction WHERE payroll_deduction_id = $1", [id]);
        expect((await cl.query("SELECT count(*)::int AS n FROM payroll_deduction_instalment")).rows[0].n).toBe(0);
      });
    });

    test("an attendance pay item keeps its run through a foreign key that frees it when the run goes", async () => {
      await rolledBack(async (cl) => {
        const runId = await run(cl, "2026-10-01");
        const item = (
          await cl.query(
            `INSERT INTO attendance_pay_item (employee_id, work_date, kind, minutes, method, amount, status, payroll_run_id)
             VALUES ($1, DATE '2026-10-05', 'late', 20, 'pro_rata', 1622.60, 'in_run', $2) RETURNING attendance_pay_item_id`,
            [ada, runId],
          )
        ).rows[0].attendance_pay_item_id;
        await refusedHere(
          cl,
          () => cl.query(
            "INSERT INTO attendance_pay_item (employee_id, work_date, kind, minutes, method, payroll_run_id) VALUES ($1, DATE '2026-10-06', 'late', 5, 'pro_rata', gen_random_uuid())",
            [ada],
          ),
          "23503",
          "attendance_pay_item_payroll_run_fk",
        );
        await cl.query("DELETE FROM payroll_run WHERE payroll_run_id = $1", [runId]);
        expect((await cl.query("SELECT payroll_run_id, status FROM attendance_pay_item WHERE attendance_pay_item_id = $1", [item])).rows[0]).toEqual({ payroll_run_id: null, status: "in_run" });
      });
    });
  });

  describe("numbers", () => {
    test("a run is numbered by its month and a payslip by its month and a count, as the guide says", async () => {
      const client = await pool.connect();
      try {
        const issued = [];
        await atomically(client, async () => {
          for (const [type, date] of [["payroll_run", "2026-10-01"], ["payroll_run", "2026-11-01"], ["payslip", "2026-10-01"], ["payslip", "2026-10-01"], ["payslip", "2026-11-01"]]) {
            issued.push((await numbering.allocate(client, type, { date })).number);
          }
          throw new Error("rolled back");
        }).catch((err) => {
          if (err.message !== "rolled back") throw err;
        });
        expect(issued).toEqual(["PAY-2026-10", "PAY-2026-11", "PAY-2026-10-0001", "PAY-2026-10-0002", "PAY-2026-11-0001"]);
      } finally {
        client.release();
      }
    });
  });

  describe("6099 and 6030", () => {
    test("seeds the payroll.run approval as DEFAULTS declares it, and it validates and carries money", async () => {
      const row = await one("SELECT module_key, name, description, context_types, stages, active FROM workflow_definition WHERE key = 'payroll.run' AND version = 1");
      const def = definitions.DEFAULTS["payroll.run"];
      expect(row).toEqual({ module_key: def.module, name: def.name, description: def.description, context_types: def.context, stages: def.stages, active: true });
      expect(definitions.problemsOf(def)).toEqual([]);
      expect(def.stages).toEqual([{ key: "ceo", name: "CEO", approver: { type: "ceo" }, sla_hours: 72 }]);
      // The context carries money, so a stage that approves itself on a timeout is refused.
      expect(definitions.problemsOf({ ...def, stages: [{ ...def.stages[0], on_timeout: "auto_approve" }] }).join(" ")).toMatch(/never approves itself/);
    });

    test("gives payroll.configure, named as the catalogue names it, to Operations & People and the Implementation Team", async () => {
      const held = (
        await q(
          `SELECT c.code::text AS code, c.name, c.description, array_agg(r.code::text ORDER BY r.code::text) AS roles
             FROM capability c JOIN role_capability rc USING (capability_id) JOIN role r USING (role_id)
            WHERE c.code::text LIKE 'payroll.%' GROUP BY 1, 2, 3`,
        )
      ).rows;
      const declared = catalog.CAPABILITY_CATALOG.find((x) => x.code === "payroll.configure");
      expect(held).toEqual([{ code: "payroll.configure", name: declared.label, description: declared.description, roles: ["implementation", "operations_people"] }]);
      expect(declared.module).toBe("payroll");
    });

    test("flags the seeded Unpaid leave type and no other, and seeds no setting, run, payslip or deduction (A26)", async () => {
      const types = (await q("SELECT code::text AS code, unpaid FROM leave_type ORDER BY code::text")).rows;
      expect(types).toEqual([
        { code: "annual", unpaid: false },
        { code: "compassionate", unpaid: false },
        { code: "sick", unpaid: false },
        { code: "unpaid", unpaid: true },
      ]);
      for (const table of TABLES) {
        expect({ table, rows: (await one(`SELECT count(*)::int AS n FROM ${table}`)).n }).toEqual({ table, rows: 0 });
      }
    });

    test("undoes only what it gave, and runs again without changing anything", async () => {
      await rolledBack(async (cl) => {
        const seed = FILES["6099_seed_payroll"];
        const state = async () => ({
          definition: (await cl.query("SELECT count(*)::int AS n FROM workflow_definition WHERE key = 'payroll.run'")).rows[0].n,
          capability: (await cl.query("SELECT count(*)::int AS n FROM capability WHERE code = 'payroll.configure'")).rows[0].n,
          grants: (await cl.query("SELECT count(*)::int AS n FROM role_capability rc JOIN capability c USING (capability_id) WHERE c.code = 'payroll.configure'")).rows[0].n,
          unpaid: (await cl.query("SELECT unpaid FROM leave_type WHERE code = 'unpaid'")).rows[0].unpaid,
        });
        const seeded = await state();
        expect(seeded).toEqual({ definition: 1, capability: 1, grants: 2, unpaid: true });
        await cl.query(seed.up);
        expect(await state()).toEqual(seeded);
        await cl.query(seed.down);
        expect(await state()).toEqual({ definition: 0, capability: 0, grants: 0, unpaid: false });
        await cl.query(seed.up);
        expect(await state()).toEqual(seeded);
      });
    });

    test("keeps a capability someone has since given to a person when it is undone", async () => {
      await rolledBack(async (cl) => {
        await cl.query("INSERT INTO user_capability (user_id, capability_id) SELECT $1, capability_id FROM capability WHERE code = 'payroll.configure'", [adaUser]);
        await cl.query(FILES["6099_seed_payroll"].down);
        expect((await cl.query("SELECT count(*)::int AS n FROM capability WHERE code = 'payroll.configure'")).rows[0].n).toBe(1);
      });
    });
  });

  describe("6040, the legal source of a statutory version (PR 10)", () => {
    const SOURCE = "'TEST SOURCE, not a law', 'Test section 1', '2026-11-01'";
    const insertRate = (cl, { item = "nhf", kind = "employee", base = "basic", position = null, bandFrom = null, from, to = null, source = true }) =>
      cl.query(
        `INSERT INTO statutory_rate (item, kind, base, rate, position, band_from, effective_from, effective_to, ${
          source ? "source_title, source_section, source_checked_on" : "no_legal_source, no_source_reason"
        }) VALUES ($1, $2, $3, 1, $4, $5, $6, $7, ${source ? SOURCE : "true, 'Test rate, not a law'"})`,
        [item, kind, base, position, bandFrom, from, to],
      );

    test("a row is held to a source or to No Legal Source with its reason, never both, never neither", async () => {
      await rolledBack(async (cl) => {
        await insertRate(cl, { from: "2026-12-01" });
        await insertRate(cl, { item: "itf", kind: "employer", base: "annual_payroll", from: "2026-12-01", source: false });
        const bare = () => cl.query(`INSERT INTO statutory_rate (item, kind, base, rate, effective_from) VALUES ('nsitf', 'employer', 'annual_payroll', 1, '2026-12-01')`);
        await refusedHere(cl, bare, "23514", "statutory_rate_source_check");
        const both = () =>
          cl.query(`INSERT INTO statutory_rate (item, kind, base, rate, effective_from, source_title, source_section, source_checked_on, no_legal_source, no_source_reason)
                    VALUES ('nsitf', 'employer', 'annual_payroll', 1, '2026-12-01', 'A', 'B', '2026-11-01', true, 'A reason here')`);
        await refusedHere(cl, both, "23514", "statutory_rate_source_check");
        const noSection = () =>
          cl.query(`INSERT INTO statutory_rate (item, kind, base, rate, effective_from, source_title, source_checked_on) VALUES ('nsitf', 'employer', 'annual_payroll', 1, '2026-12-01', 'A', '2026-11-01')`);
        await refusedHere(cl, noSection, "23514", "statutory_rate_source_check");
      });
    });

    test("rows saved before it are marked No Legal Source on the way up, and it comes off and goes back", async () => {
      await rolledBack(async (cl) => {
        const file = FILES["6040_statutory_sources"];
        await cl.query(file.down);
        expect((await cl.query("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'statutory_rate' AND column_name LIKE '%source%'")).rows[0].n).toBe(0);
        // A test PAYE band saved before sources were required, as staging held one.
        await cl.query(`INSERT INTO statutory_rate (item, kind, base, rate, position, band_from, effective_from) VALUES ('paye', 'employee', 'taxable', 7, 1, 0, '2026-12-01')`);
        await cl.query(file.up);
        await cl.query(file.up); // idempotent
        expect((await cl.query("SELECT no_legal_source, no_source_reason, source_title FROM statutory_rate")).rows).toEqual([
          { no_legal_source: true, no_source_reason: "Entered before sources were required", source_title: null },
        ]);
        expect((await cl.query("SELECT count(*)::int AS n FROM pg_constraint WHERE conname = 'statutory_rate_source_check'")).rows[0].n).toBe(1);
        expect((await cl.query("SELECT count(*)::int AS n FROM pg_indexes WHERE indexname = 'statutory_rate_source_document_fk_idx'")).rows[0].n).toBe(1);
      });
    });

    test("removeVersion takes a whole version out and the version before runs on, on the real table", async () => {
      await rolledBack(async (cl) => {
        const band = (position, bandFrom, from, to) => insertRate(cl, { item: "paye", base: "taxable", position, bandFrom, from, to });
        await band(1, 0, "2026-12-01", "2027-02-01");
        await band(2, 1000, "2026-12-01", "2027-02-01");
        await band(1, 0, "2027-02-01", "2027-03-01");
        await band(2, 500, "2027-02-01", "2027-03-01");
        await band(3, 2000, "2027-02-01", "2027-03-01");
        await band(1, 0, "2027-03-01", null);
        const versions = async () =>
          (await cl.query("SELECT position, effective_from::text AS f, effective_to::text AS t FROM statutory_rate WHERE item = 'paye' ORDER BY effective_from, position")).rows;

        const r = await effectiveDated.removeVersion(cl, { table: "statutory_rate", key: { item: "paye" }, from: "2027-02-01", today: "2026-12-15" });
        expect([r.removed.length, r.reopened.length]).toEqual([3, 2]);
        expect(await versions()).toEqual([
          { position: 1, f: "2026-12-01", t: "2027-03-01" },
          { position: 2, f: "2026-12-01", t: "2027-03-01" },
          { position: 1, f: "2027-03-01", t: null },
        ]);
        await effectiveDated.removeVersion(cl, { table: "statutory_rate", key: { item: "paye" }, from: "2027-03-01", today: "2026-12-15" });
        expect(await versions()).toEqual([
          { position: 1, f: "2026-12-01", t: null },
          { position: 2, f: "2026-12-01", t: null },
        ]);
        await expect(effectiveDated.removeVersion(cl, { table: "statutory_rate", key: { item: "paye" }, from: "2026-12-01", today: "2026-12-15" })).rejects.toMatchObject({
          code: "VERSION_IN_FORCE",
        });
      });
    });
  });

  describe("undone and applied again", () => {
    test("6099, 6030, 6010 and 6000 come off in that order and go back, leaving the database as it was", async () => {
      await rolledBack(async (cl) => {
        const shape = async () => ({
          tables: (await cl.query("SELECT relname FROM pg_class WHERE relname = ANY($1) AND relkind = 'r' ORDER BY relname", [TABLES])).rows.map((r) => r.relname),
          unpaid: (await cl.query("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'leave_type' AND column_name = 'unpaid'")).rows[0].n,
          fk: (await cl.query("SELECT count(*)::int AS n FROM pg_constraint WHERE conname = 'attendance_pay_item_payroll_run_fk'")).rows[0].n,
          indexes: (await cl.query("SELECT indexname FROM pg_indexes WHERE tablename = ANY($1) OR indexname LIKE 'attendance_pay_item_payroll_run%' ORDER BY indexname", [[...TABLES, "attendance_pay_item"]])).rows.map((r) => r.indexname),
        });
        const before = await shape();
        expect(before.tables).toEqual([...TABLES].sort());
        expect(before.unpaid).toBe(1);
        expect(before.fk).toBe(1);

        for (const file of [...M6].reverse()) await cl.query(file.down);
        expect(await shape()).toEqual({ tables: [], unpaid: 0, fk: 0, indexes: expect.not.arrayContaining(["attendance_pay_item_payroll_run_fk_idx"]) });

        for (const file of M6) await cl.query(file.up);
        expect(await shape()).toEqual(before);
        expect((await cl.query("SELECT unpaid FROM leave_type WHERE code = 'unpaid'")).rows[0].unpaid).toBe(true);
      });
    });
  });
});
