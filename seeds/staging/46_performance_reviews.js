"use strict";
/**
 * Staging demonstration data: Performance's October round (M2; docs/guides/performance.md §3.3,
 * §6.12, F13).
 *
 * October 2026's round of Q4 2026 (the quarter 45_performance_plan.js loads from MyCity's own
 * workbooks), opened through the reviews service with a review for every binding scorecard, and
 * walked forward as the people themselves would, so a demonstration shows a review at every stage:
 *
 *   check_in       left for the employee
 *   with_reviewer  the employee checked in: an actual and its evidence on each own line
 *   second_level   the reviewer scored (the proposed scores, an action on each missed line) and submitted
 *   with_hr        the reviewer's line manager approved
 *   closed         Operations & People closed it: score, rating, the PDF queued
 *
 * Reviews are taken in the order of their people's names and given the stages in turn; a review
 * whose people have no login stays where it got to. Home wrote a review cycle and reviews of its
 * own before M2 existed (lib/forward-rows.js); this seed takes them away first, as
 * lib/home-staging-rows.js asks, so Home reads Performance's records.
 *
 * Run only by `scripts/db/seed.js --staging` (which refuses production three ways), after
 * 45_performance_plan.js and before 60_home.js. Idempotent: once October's round is open the seed
 * leaves it, and everyone in it, alone. A part that fails is logged and the rest carry on.
 */
const path = require("node:path");
const { removeHomeStagingRows } = require("./lib/home-staging-rows");
const { loginsOf } = require("../lib/leave-sample");

const ROOT = path.resolve(__dirname, "..", "..");
const src = (p) => require(path.join(ROOT, "src", p));

/** The tables Home's forward rows filled that Performance's reviews now own. */
const REVIEW_TABLES = ["performance_review", "performance_cycle"];

const QUARTER_STARTS = "2026-10-01";
const MONTH = "2026-10-01";
/** The stages the reviews are walked to, in turn. */
const STAGES = ["check_in", "with_reviewer", "second_level", "with_hr", "closed"];
/** A corrective action's date: a fortnight into the month after. */
const ACTION_DUE = "2026-11-13";

module.exports = async function seed({ pool, log = () => {} }) {
  const { atomically } = src("shared/db/tx");
  const workflow = src("shared/workflow/engine");
  const cycle = src("modules/reviews/reviews.cycle");
  const service = src("modules/reviews/reviews.service");
  const repo = src("modules/reviews/reviews.repo");
  const inTx = async (fn) => {
    const client = await pool.connect();
    try {
      return await atomically(client, () => fn(client));
    } finally {
      client.release();
    }
  };

  await inTx((client) => removeHomeStagingRows(client, REVIEW_TABLES));

  const { rows: periods } = await pool.query(
    "SELECT performance_period_id, name, starts_on, ends_on, live_from, status, rules FROM performance_period WHERE starts_on = $1",
    [QUARTER_STARTS],
  );
  const period = periods[0];
  if (!period || period.status === "planning") {
    log("performance reviews: Q4 2026 is not being run yet (45_performance_plan.js), nothing added");
    return;
  }
  if (await repo.roundOf(pool, period.performance_period_id, MONTH)) return;
  // The plans were bound when the seed ran, which from November on is after October ended, and a
  // round takes only scorecards bound before its month ended (reviews.repo bindingScorecards): the
  // binding is dated to the quarter's live day, as it would be on a staging server seeded in October.
  const boundAt = `${period.live_from}T12:00:00+01:00`;
  await pool.query("UPDATE performance_plan SET binding_at = LEAST(binding_at, $2::timestamptz) WHERE performance_period_id = $1 AND binding_at IS NOT NULL", [period.performance_period_id, boundAt]);
  await pool.query("UPDATE scorecard SET created_at = LEAST(created_at, $2::timestamptz) WHERE performance_period_id = $1", [period.performance_period_id, boundAt]);
  await pool.query(
    `UPDATE workflow_instance wi SET completed_at = LEAST(wi.completed_at, $2::timestamptz)
       FROM scorecard s
      WHERE wi.entity_type = 'scorecard' AND wi.entity_id = s.scorecard_id::text AND wi.definition_key = 'performance.plan'
        AND s.performance_period_id = $1 AND wi.completed_at IS NOT NULL`,
    [period.performance_period_id, boundAt],
  );
  const ceo = (await pool.query("SELECT user_id, employee_id FROM app_user WHERE is_ceo AND status = 'active' LIMIT 1")).rows[0];
  const opened = await inTx((client) => cycle.openRound(client, ceo ? { ...ceo, is_ceo: true } : null, period, MONTH));
  log(`performance reviews: October 2026 opened with ${opened.reviews} reviews`);

  const { rows: reviews } = await pool.query(
    `SELECT pr.performance_review_id, pr.employee_id, pr.reviewer_employee_id
       FROM performance_review pr JOIN employee e ON e.employee_id = pr.employee_id
      WHERE pr.performance_cycle_id = $1 AND pr.review_type <> 'self'
      ORDER BY e.first_name, e.last_name, pr.performance_review_id`,
    [opened.performance_cycle_id],
  );
  const hr = (await pool.query(
    `SELECT DISTINCT u.employee_id FROM app_user u JOIN user_role ur ON ur.user_id = u.user_id JOIN role r ON r.role_id = ur.role_id
      WHERE r.code = 'operations_people' AND u.status = 'active' AND u.employee_id IS NOT NULL ORDER BY u.employee_id`,
  )).rows.map((r) => r.employee_id);
  const ids = [...new Set(reviews.flatMap((r) => [r.employee_id, r.reviewer_employee_id]).concat(hr))];
  const logins = await loginsOf(pool, ids);
  const scopeAll = { scope: "all", scope_ids: null };

  let walked = 0;
  for (const [n, r] of reviews.entries()) {
    const target = n % STAGES.length;
    if (target < 1) continue;
    const employee = logins.get(r.employee_id);
    const reviewer = logins.get(r.reviewer_employee_id);
    try {
      // The employee checks in: each own line's figure and where it came from.
      if (!employee) continue;
      const open = await service.myCheckIn(employee);
      if (open.performance_review_id !== r.performance_review_id) continue;
      const items = open.items
        .filter((i) => i.line && i.line.source === "own")
        .map((i) => ({
          performance_review_item_id: i.performance_review_item_id,
          ...(i.line.measure === "milestone"
            ? { achieved_on: "2026-10-20", actual_text: "Delivered" }
            : { actual_value: i.line.target_value ? String(Math.round(Number(i.line.target_value) * 0.4 * 100) / 100) : "1" }),
          evidence_kind: "note",
          evidence_note: "October monthly report",
          action_text: "On track for the quarter; the rest lands in November",
        }));
      await service.saveCheckIn(employee, { items });
      await service.submitCheckIn(employee);
      if (target < 2 || !reviewer) continue;

      // The reviewer scores as proposed, with an action on each missed line, and submits.
      const review = await service.get(reviewer, scopeAll, r.performance_review_id);
      const scores = review.items.map((i) => ({
        performance_review_item_id: i.performance_review_item_id,
        score: i.proposed_score,
        override_reason: null,
        comment: null,
      }));
      const held = await repo.items(pool, r.performance_review_id);
      const actions = held
        .filter((i) => i.employee_target_id && i.proposed_score !== null && Number(i.proposed_score) < 1 && i.measure !== "numeric")
        .map((i) => ({
          performance_review_item_id: i.performance_review_item_id,
          title: `Recover: ${i.line.title}`.slice(0, 300),
          owner_employee_id: r.employee_id,
          due_on: ACTION_DUE,
        }));
      await service.saveScores(reviewer, scopeAll, r.performance_review_id, { items: scores, actions });
      await service.submit(reviewer, scopeAll, r.performance_review_id);

      // The chain: the second level (when there is one), then Operations & People, up to its stage.
      for (;;) {
        const now = await repo.get(pool, r.performance_review_id);
        if (STAGES.indexOf(now.status) >= target) break;
        const instance = now.workflow_instance_id ? await workflow.getInstance(pool, now.workflow_instance_id) : null;
        if (!instance || instance.state !== "pending") break;
        const deciderId =
          instance.current_stage === "second_level"
            ? now.second_level_employee_id
            : hr.find((e) => e !== now.employee_id) || (ceo && ceo.employee_id);
        const decider = deciderId ? logins.get(deciderId) || (ceo && deciderId === ceo.employee_id ? { ...ceo, is_ceo: true } : null) : null;
        if (!decider) break;
        const before = instance.current_stage;
        const after = await inTx((client) => workflow.act(client, { instance_id: instance.workflow_instance_id, actor: decider, decision: "approve" }));
        // What the worker's outbox would do next, done here so the round reads right at once; both are safe to run again.
        if (after.state === "approved") await service.settle(r.performance_review_id, { state: "approved" });
        else if (before === "second_level") await service.stageMoved(r.performance_review_id, after.current_stage);
      }
      walked += 1;
    } catch (err) {
      log(`performance reviews: ${r.performance_review_id} stopped (${err.code || err.name}: ${err.message})`);
    }
  }
  log(`performance reviews: ${walked} reviews walked past their check-in`);
};

module.exports.REVIEW_TABLES = REVIEW_TABLES;
