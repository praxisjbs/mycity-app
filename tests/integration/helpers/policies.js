"use strict";
/**
 * A rules policy's version put in force for a test, past publishing: a punch or a day is judged by
 * the Attendance policy's version in force on its date (docs/guides/policies.md §6.8), and a test
 * about lateness or a location check names only the rules it is about. Publishing itself, with its
 * hash and signature, runs through HTTP in tests/integration/policies.test.js.
 */

/**
 * The Attendance policy's next version, published, with these rules over the code's defaults.
 * @param {{query: Function}} db  the pool, or a client inside a test's transaction
 * @param {object} rules  e.g. { grace_minutes: 5 }
 * @param {string} from  its first day, YYYY-MM-DD
 * @returns {Promise<string>} the policy_version_id
 */
async function attendanceVersion(db, rules, from) {
  const c = require("@mycity/contract");
  const { rows } = await db.query(
    `INSERT INTO policy_version (policy_id, status, version, effective_from, note, title, rules,
                                 content_hash, published_at)
     SELECT p.policy_id, 'published',
            COALESCE((SELECT max(v.version) FROM policy_version v WHERE v.policy_id = p.policy_id), 0) + 1,
            $2::date, 'Set by a test', p.title, $1::jsonb, 'test', now()
       FROM policy p WHERE p.kind = 'attendance'
     RETURNING policy_version_id`,
    [JSON.stringify(c.attendance.AttendanceRules.parse(rules)), from],
  );
  return rows[0].policy_version_id;
}

module.exports = { attendanceVersion };
