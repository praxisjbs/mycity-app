"use strict";
/**
 * Staging demonstration data: Performance's quarter plan (M2; docs/guides/performance.md §6.19, F13).
 *
 * MyCity's own Q4 2026 plan, from the workbooks the client keeps (performance/), loaded the way a
 * person would load it, as the CEO:
 *
 *   quarter      Q4 2026 set up and made active, with the workbook's lock date (7 November)
 *   goals        the year's organisational goals: the 2026 references the workbook phases
 *                (Read Me & Decisions: ₦2 billion plan-year revenue, 400,000 monthly active users,
 *                2,000 ticketed events) and on-time delivery, the company's sixth objective
 *   imports      the OKR workbook, its KPIs and the scorecards workbook, each uploaded through the
 *                import engine and committed, so codes, aliases, initiatives, events and audit are
 *                the real ones. People the staff list does not hold, and codes the change map
 *                lacks, are left out, as a person skipping them in the preview would
 *
 * Home wrote rows of its own into organisational_goal and employee_target before M2 existed
 * (lib/forward-rows.js); this seed takes them away first, as lib/home-staging-rows.js asks, so
 * Home reads Performance's records.
 *
 * Run only by `scripts/db/seed.js --staging` (which refuses production three ways), after
 * 10_staff.js and before 60_home.js. Idempotent: the quarter, each goal and each import with a row
 * that went in are left alone once there, and the imports run only while Q4 2026 is the quarter
 * imports write into. A part that fails is logged and the rest carry on (an import that fails holds
 * back the imports after it), so a demonstration gap never stops a deploy.
 */
const fs = require("node:fs");
const path = require("node:path");
const { realStaff } = require("./lib/staff");
const { removeHomeStagingRows } = require("./lib/home-staging-rows");
const { loginsOf } = require("../lib/leave-sample");

const ROOT = path.resolve(__dirname, "..", "..");
const src = (p) => require(path.join(ROOT, "src", p));
const BOOKS = path.join(__dirname, "performance");

/** The tables Home's forward rows filled that Performance's plan now owns. */
const PLAN_TABLES = ["employee_target", "organisational_goal"];

const QUARTER = { starts_on: "2026-10-01", targets_lock_on: "2026-11-07", live_from: "2026-10-22" };

/** The year's organisational goals (A16: the CEO records them). */
const GOALS = [
  {
    code: "ORG-2026-01",
    strategic_theme: "Revenue",
    title: "Earn ₦2 billion plan-year revenue across every stream",
    success_measure: "Revenue earned from Q4 2026 to Q3 2027",
    reference_target: "₦2,000,000,000",
  },
  {
    code: "ORG-2026-02",
    strategic_theme: "Users",
    title: "Reach 400,000 monthly active users across both apps",
    success_measure: "Verified monthly active users",
    reference_target: "400,000",
  },
  {
    code: "ORG-2026-03",
    strategic_theme: "Events",
    title: "Sell tickets to 2,000 events through the apps",
    success_measure: "Ticketed events and paid-ticket value",
    reference_target: "2,000 events and ₦500 million",
  },
  {
    code: "ORG-2026-04",
    strategic_theme: "Delivery",
    title: "Make on-time delivery of commitments the norm",
    success_measure: "Approved monthly commitments delivered by the original date",
    reference_target: "80% in every function",
  },
];

/** Each workbook and the importer that reads it, in the order they depend on each other. */
const IMPORTS = [
  ["okr_workbook", "q4-2026-okrs.xlsx"],
  ["okr_kpis", "q4-2026-okrs.xlsx"],
  ["scorecards", "q4-2026-scorecards.xlsx"],
];

/** Run one part, logging rather than throwing: true when it ran through. */
async function part(log, name, fn) {
  try {
    await fn();
    return true;
  } catch (err) {
    log(`performance ${name}: skipped (${err.code || err.name}: ${err.message})`);
    return false;
  }
}

module.exports = async function seed({ pool, log = () => {} }) {
  const { atomically } = src("shared/db/tx");
  const goals = src("modules/goals/goals.service");
  const engine = src("shared/import/engine");
  for (const importer of ["goals/goals.import", "kpis/kpis.import", "targets/targets.import"]) src(`modules/${importer}`);
  const inTx = async (fn) => {
    const client = await pool.connect();
    try {
      return await atomically(client, () => fn(client));
    } finally {
      client.release();
    }
  };

  await inTx((client) => removeHomeStagingRows(client, PLAN_TABLES));

  const staff = await realStaff(pool);
  const ceo = staff.ceo && (await loginsOf(pool, [staff.ceo.employee_id])).get(staff.ceo.employee_id);
  if (!ceo) {
    log("performance: no CEO login yet (10_staff.js gives one), nothing added");
    return;
  }
  const actor = { ...ceo, is_ceo: true };

  let quarterId = null;
  await part(log, "quarter", async () => {
    const { rows } = await pool.query("SELECT performance_period_id, status FROM performance_period WHERE starts_on = $1", [QUARTER.starts_on]);
    const id = rows[0] ? rows[0].performance_period_id : (await goals.createPeriod(actor, QUARTER)).performance_period_id;
    if (!rows[0] || rows[0].status === "planning") await goals.updatePeriod(actor, id, { status: "active" });
    quarterId = id;
  });

  await part(log, "goals", async () => {
    for (const g of GOALS) {
      const { rows } = await pool.query("SELECT 1 FROM organisational_goal WHERE code = $1", [g.code]);
      if (!rows.length) await goals.createGoal(actor, { ...g, plan_year_starts_on: "2026-01-01" });
    }
  });

  // The workbooks are Q4 2026's: they go in only while that is the quarter imports write into.
  const into = await src("modules/goals/goals.repo").importPeriodId(pool);
  if (!quarterId || into !== quarterId) {
    log("performance imports: skipped (Q4 2026 is not the quarter being run)");
    return;
  }
  for (const [key, file] of IMPORTS) {
    const done = await part(log, key, async () => {
      // Done once a committed import of it wrote or found its rows; one whose every row failed runs again.
      const { rows } = await pool.query(
        `SELECT 1 FROM import_batch WHERE importer_key = $1 AND status = 'committed'
            AND COALESCE((stats->>'rows')::int, 0) > COALESCE((stats->>'error')::int, 0) LIMIT 1`,
        [key],
      );
      if (rows.length) return;
      const buffer = fs.readFileSync(path.join(BOOKS, file));
      const batch = await inTx((client) => engine.createBatch(client, { importer_key: key, file: { buffer, originalname: file }, actor }));
      await engine.preview(batch.import_batch_id, { actor, db: pool });
      const { stats } = await engine.commit(batch.import_batch_id, { actor, db: pool, valid_only: true });
      log(`performance ${key}: ${stats.create} created, ${stats.error} left out`);
    });
    // Each workbook names what the one before it wrote (KPIs the key results, scorecards both):
    // after a failure the rest wait for the next deploy rather than land half linked.
    if (!done) break;
  }
};

module.exports.PLAN_TABLES = PLAN_TABLES;
