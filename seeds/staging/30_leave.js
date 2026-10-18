"use strict";
/**
 * Staging demonstration data: leave (docs/guides/foundation.md §6.2, F13; docs/guides/ess.md).
 *
 * The mock's twelve sample requests (leave-sample.json: the same rows as the mock's
 * app/src/api/mock/data/roster.json, which tests/unit/mock-data-seed.test.js keeps equal) put
 * on MyCity's real staff, so People · Leave, My Leave, the leave calendar, Also Away and the
 * approvals have something to show. They load through the leave service
 * (seeds/lib/leave-sample.js, the same code as the laptop seed): approved leave recorded by
 * Operations & People, waiting requests asked by the person, which open the real approval, one
 * rejected by the line manager and one cancelled.
 *
 * Nobody is named here, as roles.json names nobody: the rows go to active staff in staff-number
 * order who have a login and whose line manager has one, leaving out the CEO and the Operations &
 * People login that records them; with fewer such people than rows, they take a second row in turn.
 *
 * Run only by `scripts/db/seed.js --staging` (which refuses production three ways), after
 * 10_staff.js. Idempotent: nothing is added while any of these people has leave.
 */
const fs = require("node:fs");
const path = require("node:path");
const { applyLeaveSample, loginsOf } = require("../lib/leave-sample");

const ROOT = path.resolve(__dirname, "..", "..");
const SAMPLE = path.join(__dirname, "leave-sample.json");

/** The Operations & People login that records approved leave: the earliest active one. */
async function recorderOf(pool) {
  const { rows } = await pool.query(
    `SELECT u.employee_id
       FROM app_user u
       JOIN user_role ur ON ur.user_id = u.user_id
       JOIN role r ON r.role_id = ur.role_id
       JOIN employee e ON e.employee_id = u.employee_id
      WHERE r.code = 'operations_people' AND e.status = 'active'
      ORDER BY u.created_at, u.user_id`,
  );
  return rows[0] ? rows[0].employee_id : null;
}

/** Who the rows go to: active staff with a login and a line manager with one, in staff-number order. */
async function candidates(pool, exclude) {
  const { rows } = await pool.query(
    `SELECT e.employee_id, e.line_manager_id
       FROM employee e
       JOIN app_user u ON u.employee_id = e.employee_id
       JOIN employee m ON m.employee_id = e.line_manager_id AND m.status = 'active'
       JOIN app_user mu ON mu.employee_id = m.employee_id
      WHERE e.status = 'active' AND NOT u.is_ceo AND e.employee_id <> ALL($1::uuid[])
      ORDER BY e.staff_number, e.employee_id`,
    [exclude],
  );
  return rows;
}

module.exports = async function seed({ pool, log }) {
  const rows = JSON.parse(fs.readFileSync(SAMPLE, "utf8"));
  const lagos = require(path.join(ROOT, "src/shared/time/lagos"));

  const recorderId = await recorderOf(pool);
  if (!recorderId) {
    log("leave: no Operations & People login yet (10_staff.js gives one), so no leave is added");
    return;
  }
  const keys = [...new Set(rows.map((r) => r.key))];
  const found = await candidates(pool, [recorderId]);
  // Fewer people than rows: they take a second row each, in turn (the rows' dates do not overlap).
  const staff = keys.map((_, i) => found[i % Math.max(found.length, 1)]).filter(Boolean);
  if (staff.length === 0) {
    log("leave: nobody with a login and a line manager with one, so no leave is added");
    return;
  }
  const logins = await loginsOf(pool, [recorderId, ...staff.flatMap((s) => [s.employee_id, s.line_manager_id])]);
  const people = new Map(
    staff.map((s, i) => [
      keys[i],
      { employee_id: s.employee_id, user: logins.get(s.employee_id) || null, manager: logins.get(s.line_manager_id) || null },
    ]),
  );
  const result = await applyLeaveSample({
    pool,
    log,
    rows: rows.filter((r) => people.has(r.key)),
    people,
    recorder: logins.get(recorderId) || null,
    today: lagos.today(),
  });
  log(
    result.already
      ? `leave: already there (${result.already} requests), none added`
      : `leave: ${result.added} sample requests added on ${new Set(staff.map((s) => s.employee_id)).size} staff, ${result.skipped} skipped`,
  );
};
