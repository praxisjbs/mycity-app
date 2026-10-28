"use strict";
/**
 * The Performance importers on MyCity's own workbooks (docs/guides/performance.md §6.19): the real
 * migrations, MyCity's staff loaded by the roster loader, and the Q4 2026 OKR and scorecards
 * workbooks staging loads (seeds/staging/performance/: the sheets the importers read), each
 * uploaded as it is and run through the import engine: preview, commit, and a second upload that
 * changes nothing.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/performance-import
 */
const fs = require("node:fs");
const path = require("node:path");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const { atomically } = require("../../src/shared/db/tx");
const { rebuild } = require("./helpers/schema");
const outbox = require("../../src/shared/events/outbox");
const loader = require("../../scripts/db/load-staff");
const engine = require("../../src/shared/import/engine");
const goals = require("../../src/modules/goals/goals.service");
const targets = require("../../src/modules/targets/targets.service");
const { loginsOf } = require("../../seeds/lib/leave-sample");

require("../../src/modules/goals/goals.import");
require("../../src/modules/kpis/kpis.import");
require("../../src/modules/targets/targets.import");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const FIXTURES = path.join(__dirname, "..", "..", "seeds", "staging", "performance");
const q = (sql, params) => pool.query(sql, params);
const rows = async (sql, params) => (await q(sql, params)).rows;
const one = async (sql, params) => (await q(sql, params)).rows[0];

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

describeDb("performance importers on MyCity's workbooks", () => {
  let ceo;
  let periodId;

  /** Upload a workbook to an importer, preview it, and commit its good rows. */
  async function upload(key, file) {
    const buffer = fs.readFileSync(path.join(FIXTURES, file));
    const batch = await tx((c) => engine.createBatch(c, { importer_key: key, file: { buffer, originalname: file }, actor: ceo }));
    expect(batch.status).toBe("mapped");
    const previewed = await engine.preview(batch.import_batch_id, { actor: ceo, db: pool });
    const committed = await engine.commit(batch.import_batch_id, { actor: ceo, db: pool, valid_only: true });
    const problems = await rows(
      "SELECT values->>'line_key' AS line, values->>'code' AS code, problems FROM import_row WHERE import_batch_id = $1 AND status = 'error' ORDER BY row_number",
      [batch.import_batch_id],
    );
    return { batch, previewed: previewed.stats, committed: committed.stats, problems };
  }

  beforeAll(async () => {
    await rebuild(pool, config.DB_NAME);
    outbox.markReady();
    await loader.loadStaff({ db: pool, log: () => {} });
    const ceoRow = await one(
      "SELECT e.employee_id FROM employee e WHERE e.job_title = 'Chief Executive Officer' AND e.status = 'active'",
    );
    ceo = (await loginsOf(pool, [ceoRow.employee_id])).get(ceoRow.employee_id) || {
      user_id: null,
      employee_id: ceoRow.employee_id,
      role_ids: [],
      is_ceo: true,
    };
    ceo.is_ceo = true;
    const period = await goals.createPeriod(ceo, { starts_on: "2026-10-01", live_from: "2026-10-22" });
    periodId = period.performance_period_id;
    await q("UPDATE performance_period SET status = 'active' WHERE performance_period_id = $1", [periodId]);
  }, 180000);

  afterAll(() => pool.end());

  test("the OKR workbook: every key result, its function, owner, links and former IDs; plans binding", async () => {
    const run = await upload("okr_workbook", "q4-2026-okrs.xlsx");
    expect(run.previewed.rows).toBe(51);
    expect(run.problems).toEqual([]);
    expect(run.committed).toMatchObject({ create: 51, error: 0 });

    const objectives = await rows("SELECT code::text AS code FROM okr_objective WHERE performance_period_id = $1 ORDER BY code", [periodId]);
    expect(objectives.map((o) => o.code)).toEqual(expect.arrayContaining(["CO-O1", "CO-O6", "TBO-O3", "BM-O4", "PG-O3", "PC-O2"]));
    const plans = await rows(
      "SELECT d.name, pl.status FROM performance_plan pl LEFT JOIN department d ON d.department_id = pl.department_id WHERE pl.performance_period_id = $1",
      [periodId],
    );
    expect(plans).toHaveLength(5);
    expect(plans.every((p) => p.status === "binding")).toBe(true);

    const kr = (code) =>
      one(
        `SELECT kr.*, o.department_id, e.first_name, e.last_name FROM okr_key_result kr
           JOIN okr_objective o ON o.okr_objective_id = kr.okr_objective_id
           LEFT JOIN employee e ON e.employee_id = kr.accountable_employee_id
          WHERE o.performance_period_id = $1 AND kr.code = $2`,
        [periodId, code],
      );
    const bm11 = await kr("BM-KR1.1");
    expect(bm11).toMatchObject({ kr_type: "outcome", measure: "numeric", first_name: "Chinyere" });
    const co11 = await kr("CO-KR1.1");
    expect(co11).toMatchObject({ kr_type: "diagnostic_gate", measure: "dated", department_id: null });
    expect(co11.accountable_employee_id).toBe(ceo.employee_id);
    // A function as owner is its head: Technology & Back-office Ops is the CTO.
    const co12 = await kr("CO-KR1.2");
    expect(co12.first_name).toBe("Bode");
    // Scored From names a function key result further down the file: linked in the second pass.
    expect(co12.scored_from_key_result_id).toBe((await kr("TBO-KR2.3")).okr_key_result_id);
    // Two owners: the first owns it, the second co-owns it.
    const co32 = await kr("CO-KR3.2");
    expect(co32.accountable_employee_id).toBeTruthy();
    expect(co32.co_accountable_employee_id).toBeTruthy();
    // A function key result links to the company key results it feeds.
    const links = await rows(
      `SELECT c.code::text AS code FROM okr_key_result_link l JOIN okr_key_result c ON c.okr_key_result_id = l.company_key_result_id
        WHERE l.okr_key_result_id = $1 ORDER BY c.code`,
      [(await kr("TBO-KR1.1")).okr_key_result_id],
    );
    expect(links.map((l) => l.code)).toEqual(["CO-KR2.1", "CO-KR5.2"]);
    // Former IDs from the change map find the new key result.
    const alias = await one("SELECT okr_key_result_id FROM okr_code_alias WHERE performance_period_id = $1 AND alias_code = 'OP-KR2.2'", [periodId]);
    expect(alias.okr_key_result_id).toBe((await kr("TBO-KR3.3")).okr_key_result_id);
    // The latest report lands in its month.
    const month = await one(
      "SELECT status FROM okr_key_result_month WHERE okr_key_result_id = $1 AND month = '2026-10-01'",
      [(await kr("TBO-KR1.1")).okr_key_result_id],
    );
    expect(month.status).toBe("on_track");
    // Dated initiatives became tasks for the owner.
    const tasks = await rows("SELECT title, due_at FROM task WHERE entity_type = 'key_result' AND entity_id = $1", [bm11.okr_key_result_id]);
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.every((t) => t.due_at)).toBe(true);

    // A month reported in the app, and confirmed, keeps what the workbook does not state when the
    // workbook goes in again: TBO-KR2.1's October row gives an actual and an update but no status.
    const kr21 = (await kr("TBO-KR2.1")).okr_key_result_id;
    await q(
      "UPDATE okr_key_result_month SET status = 'at_risk', proposed_score = 0.5, confirmed_score = 0.5, confirmed_at = now() WHERE okr_key_result_id = $1 AND month = '2026-10-01'",
      [kr21],
    );
    const again = await upload("okr_workbook", "q4-2026-okrs.xlsx");
    expect(again.committed).toMatchObject({ create: 0, update: 0, error: 0 });
    expect(
      await one(
        "SELECT status, trim_scale(confirmed_score)::text AS confirmed FROM okr_key_result_month WHERE okr_key_result_id = $1 AND month = '2026-10-01'",
        [kr21],
      ),
    ).toEqual({ status: "at_risk", confirmed: "0.5" });
  }, 180000);

  test("the KPIs: each function's table, its direction, target and frequency, former IDs kept", async () => {
    const run = await upload("okr_kpis", "q4-2026-okrs.xlsx");
    expect(run.problems).toEqual([]);
    expect(run.committed).toMatchObject({ create: 45, error: 0 });
    const k = await one("SELECT direction, target_text, trim_scale(target_value)::text AS target_value, frequency FROM kpi_definition WHERE code = 'BM-K06'");
    expect(k).toEqual({ direction: "lower", target_text: "≤0%", target_value: "0", frequency: "monthly" });
    expect(await one("SELECT frequency FROM kpi_definition WHERE code = 'BM-K01'")).toEqual({ frequency: "weekly" });
    const alias = await one("SELECT k.code::text AS code FROM okr_code_alias a JOIN kpi_definition k ON k.kpi_definition_id = a.kpi_definition_id WHERE a.alias_code = 'OP-K01'");
    expect(alias.code).toBe("TBO-K08");
    const again = await upload("okr_kpis", "q4-2026-okrs.xlsx");
    expect(again.committed).toMatchObject({ create: 0, update: 0, error: 0 });
  }, 180000);

  test("the scorecards: people and reviewers by name, codes through aliases, agreed; who is missing is named", async () => {
    const run = await upload("scorecards", "q4-2026-scorecards.xlsx");
    const missing = [...new Set(run.problems.map((p) => p.line.replace(/ #\d+$/, "")))];
    // People the staff list does not hold, and codes the change map lacks, are errors to skip.
    for (const p of run.problems) expect(p.problems[0].message).toMatch(/is not on the staff list|is not a key result or KPI/);
    expect(run.committed.create).toBeGreaterThan(100);
    // Abubakar Mohammed and Emmanuel Aneke are not on the staff list; Bode's TECH-K lines name KPIs
    // the change map lacks. "Precious Iyersehen" is Precious Iyeserhen, two letters out.
    expect(missing.sort()).toEqual(["Abubakar Mohammed", "Bode Oluwasanmi", "Emmanuel Aneke"]);

    const card = await one(
      `SELECT s.*, r.first_name AS reviewer FROM scorecard s
         JOIN employee e ON e.employee_id = s.employee_id
         LEFT JOIN employee r ON r.employee_id = s.reviewer_employee_id
        WHERE s.performance_period_id = $1 AND e.first_name = 'Tobiloba'`,
      [periodId],
    );
    expect(card).toMatchObject({ status: "agreed", reviewer: "Oladotun" });
    expect(card.employee_agreed_at).toBeTruthy();
    const lines = await rows(
      `SELECT t.position, t.section, t.measure, t.source, trim_scale(t.weight)::text AS weight, kr.code::text AS kr, k.code::text AS kpi
         FROM employee_target t
         LEFT JOIN okr_key_result kr ON kr.okr_key_result_id = t.okr_key_result_id
         LEFT JOIN kpi_definition k ON k.kpi_definition_id = t.kpi_definition_id
        WHERE t.scorecard_id = $1 ORDER BY t.position`,
      [card.scorecard_id],
    );
    expect(lines).toHaveLength(9);
    expect(lines.reduce((n, l) => n + Number(l.weight), 0)).toBe(100);
    // OP-KR2.2 is TBO-KR3.3 now; a dated Results line is a milestone.
    expect(lines[1]).toMatchObject({ section: "results", source: "key_result", kr: "TBO-KR3.3", measure: "milestone" });
    // OP-K01 is TBO-K08 now.
    expect(lines[4]).toMatchObject({ section: "kpis", source: "function_kpi", kpi: "TBO-K08", measure: "standard" });
    expect(lines[7]).toMatchObject({ section: "accountability", source: "commitments" });
    expect(lines[8]).toMatchObject({ section: "accountability", source: "update_on_time", measure: "binary" });

    const again = await upload("scorecards", "q4-2026-scorecards.xlsx");
    expect(again.committed).toMatchObject({ create: 0, update: 0 });
  }, 180000);

  test("reverting: refused once anything rests on what an import wrote; a reverted KPI goes and comes back with its next import", async () => {
    const { revert } = require("../../src/shared/import/revert");
    const batchOf = async (key) =>
      (
        await one(
          "SELECT import_batch_id FROM import_batch WHERE importer_key = $1 AND status = 'committed' AND (stats->>'create')::int > 0 ORDER BY committed_at LIMIT 1",
          [key],
        )
      ).import_batch_id;
    const refused = async (key) => {
      const err = await revert(await batchOf(key), { actor: ceo, db: pool }).catch((e) => e);
      expect(err.code).toBe("IMPORT_REVERT_BLOCKED");
      return err;
    };
    // Scorecard lines use the key results and the KPIs.
    expect((await refused("okr_workbook")).message).toMatch(/is now used elsewhere/);
    await refused("okr_kpis");

    // Nothing has touched the scorecards since: their import reverts, then the KPIs' does.
    const cards = await revert(await batchOf("scorecards"), { actor: ceo, db: pool });
    expect(cards.archived).toBeGreaterThan(100);
    expect((await one("SELECT count(*)::int AS n FROM scorecard WHERE performance_period_id = $1", [periodId])).n).toBe(0);
    const kpis = await revert(await batchOf("okr_kpis"), { actor: ceo, db: pool });
    expect(kpis.archived).toBe(45);
    expect(await one("SELECT count(*)::int AS n FROM kpi_definition WHERE code = 'BM-K01'")).toEqual({ n: 0 });
    expect(await one("SELECT count(*)::int AS n FROM okr_code_alias WHERE alias_code = 'OP-K01'")).toEqual({ n: 0 });

    // The next import brings the KPIs back, and the scorecards after them.
    const back = await upload("okr_kpis", "q4-2026-okrs.xlsx");
    expect(back.committed).toMatchObject({ create: 45, update: 0, error: 0 });
    expect(await one("SELECT active FROM kpi_definition WHERE code = 'BM-K01'")).toEqual({ active: true });
    const again = await upload("scorecards", "q4-2026-scorecards.xlsx");
    expect(again.committed.create).toBeGreaterThan(100);

    // A scorecard given a new reviewer since its import keeps its import.
    const card = await one(
      "SELECT s.scorecard_id FROM scorecard s JOIN employee e ON e.employee_id = s.employee_id WHERE s.performance_period_id = $1 AND e.first_name = 'Tobiloba'",
      [periodId],
    );
    await targets.update(ceo, { scope: "all", scope_ids: null }, card.scorecard_id, { reviewer_employee_id: ceo.employee_id, reviewer_reason: "Covering the review" });
    await refused("scorecards");
  }, 300000);
});
