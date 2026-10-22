"use strict";
/**
 * Calendar: the SQL. Reads a person's month (events, their tasks' deadlines, their
 * approved leave, their performance dates) and writes only calendar_event and
 * calendar_event_attendee. Never emits (BACKEND_GUIDE §2).
 *
 * Who sees an event: its owner, its attendees, and everyone when its visibility is
 * `everyone` (docs/guides/workspace.md §6). A month is always the reader's own, so
 * scope does not widen it: a manager reads their team's work on Tasks, not here.
 */
const { pageQuery, orderBy, TOTAL_COL } = require("../../shared/http/paged");
const { personJson } = require("../../shared/db/person");

const SEES = (me) => `(ce.owner_employee_id = ${me} OR ce.visibility = 'everyone'
  OR EXISTS (SELECT 1 FROM calendar_event_attendee x
              WHERE x.calendar_event_id = ce.calendar_event_id AND x.employee_id = ${me}))`;

/** A business date as the instant its Lagos day starts, and the next day's. */
const DAY_START = (d) => `((${d})::timestamp AT TIME ZONE 'Africa/Lagos')`;
const DAY_END = (d) => `(((${d}) + 1)::timestamp AT TIME ZONE 'Africa/Lagos')`;

/**
 * The reader's performance dates (docs/guides/performance.md §6.18), all day: their check-in due
 * (a head's on the 3rd business day), the reviews they must write, the key results they are
 * accountable for finishing in a binding plan, and the review dates of open PIPs that are theirs
 * or whose review they wrote. $1 the reader, $4 and $5 the month's first and last day.
 */
const PERFORMANCE_DATES = `
         SELECT 'performance', r.performance_review_id, 'Check-In: ' || c.name,
                ${DAY_START("x.due")}, ${DAY_END("x.due")}, true, NULL, NULL, NULL, 'review', true, 'check_in_due'
           FROM performance_review r
           JOIN performance_cycle c ON c.performance_cycle_id = r.performance_cycle_id
           CROSS JOIN LATERAL (
             SELECT CASE WHEN EXISTS (SELECT 1 FROM department hd LEFT JOIN org_seat hs ON hs.org_seat_id = hd.head_seat_id
                                       WHERE hd.head_employee_id = $1 OR (hs.status = 'filled' AND hs.filled_by_employee_id = $1))
                         THEN COALESCE(c.head_check_in_due_on, c.check_in_due_on) ELSE c.check_in_due_on END AS due
           ) x
          WHERE r.employee_id = $1 AND r.review_kind = 'monthly' AND r.status = 'check_in'
            AND x.due BETWEEN $4::date AND $5::date
         UNION ALL
         SELECT 'performance', r.performance_review_id, 'Review: ' || re.first_name || ' ' || re.last_name,
                ${DAY_START("c.review_due_on")}, ${DAY_END("c.review_due_on")}, true, NULL, NULL, NULL, 'review', false, 'review_due'
           FROM performance_review r
           JOIN performance_cycle c ON c.performance_cycle_id = r.performance_cycle_id
           JOIN employee re ON re.employee_id = r.employee_id
          WHERE r.reviewer_employee_id = $1 AND r.status IN ('with_reviewer', 'returned')
            AND c.review_due_on BETWEEN $4::date AND $5::date
         UNION ALL
         SELECT 'performance', kr.okr_key_result_id, kr.code || ' ' || kr.statement,
                ${DAY_START("kr.finishes_on")}, ${DAY_END("kr.finishes_on")}, true, NULL, NULL, NULL, 'key_result', false, 'key_result_due'
           FROM okr_key_result kr
           JOIN okr_objective o ON o.okr_objective_id = kr.okr_objective_id
           JOIN performance_plan pl ON pl.performance_plan_id = o.performance_plan_id
          WHERE kr.accountable_employee_id = $1 AND pl.status = 'binding'
            AND kr.finishes_on BETWEEN $4::date AND $5::date
         UNION ALL
         SELECT 'performance', ip.improvement_plan_id,
                CASE WHEN ip.employee_id = $1 THEN 'PIP Review' ELSE 'PIP Review: ' || pe.first_name || ' ' || pe.last_name END,
                ${DAY_START("ip.review_on")}, ${DAY_END("ip.review_on")}, true, NULL, NULL, NULL, 'improvement_plan',
                ip.employee_id = $1, 'pip_review'
           FROM improvement_plan ip
           JOIN employee pe ON pe.employee_id = ip.employee_id
          WHERE ip.status = 'open' AND ip.review_on BETWEEN $4::date AND $5::date
            AND (ip.employee_id = $1
                 OR EXISTS (SELECT 1 FROM performance_review pr
                             WHERE pr.performance_review_id = ip.performance_review_id AND pr.reviewer_employee_id = $1))`;

/**
 * One page of a month: the reader's events, the deadlines of their open tasks, the days of
 * their approved leave and their performance dates, by start.
 * @param {{query: Function}} db
 * @param {{employee_id: string, from: Date, to: Date, fromDay: string, toDay: string}} at
 * @param {{item_kind?: string, q?: string, sort?: object, page?: number}} query
 */
function month(db, at, query) {
  const params = [at.employee_id, at.from, at.to, at.fromDay, at.toDay, query.item_kind || null, query.q || null];
  return pageQuery(
    db,
    `SELECT v.item_kind, v.item_id, v.title, v.starts_at, v.ends_at, v.all_day, v.event_type,
            v.location, v.my_response, v.link_type, v.link_self, v.performance_kind, ${TOTAL_COL}
       FROM (
         SELECT 'event' AS item_kind, ce.calendar_event_id AS item_id, ce.title, ce.starts_at,
                ce.ends_at, ce.all_day, ce.event_type, ce.location,
                (SELECT a.response FROM calendar_event_attendee a
                  WHERE a.calendar_event_id = ce.calendar_event_id AND a.employee_id = $1) AS my_response,
                'calendar_event' AS link_type, false AS link_self, NULL::text AS performance_kind
           FROM calendar_event ce
          WHERE ce.cancelled_at IS NULL AND ce.starts_at < $3 AND ce.ends_at > $2 AND ${SEES("$1")}
         UNION ALL
         SELECT 'task', t.task_id, t.title, t.due_at, t.due_at + interval '1 minute', false, 'deadline',
                NULL, NULL, 'task', false, NULL
           FROM task t
          WHERE t.primary_assignee_id = $1 AND t.archived_at IS NULL
            AND t.status NOT IN ('done', 'cancelled') AND t.due_at >= $2 AND t.due_at < $3
         UNION ALL
         SELECT 'leave', lr.leave_request_id, lt.name, (lr.starts_on::timestamp AT TIME ZONE 'Africa/Lagos'),
                ((lr.ends_on + 1)::timestamp AT TIME ZONE 'Africa/Lagos'), true, NULL, NULL, NULL, 'leave_request', false, NULL
           FROM leave_request lr
           JOIN leave_type lt ON lt.leave_type_id = lr.leave_type_id
          WHERE lr.employee_id = $1 AND lr.status = 'approved'
            AND lr.starts_on <= $5::date AND lr.ends_on >= $4::date
         UNION ALL
         ${PERFORMANCE_DATES}
       ) v
      WHERE ($6::text IS NULL OR v.item_kind = $6)
        AND ($7::text IS NULL OR search_fold(v.title) LIKE '%' || search_fold($7) || '%')
      ORDER BY ${orderBy(query, { starts_at: "v.starts_at" }, "v.item_id")}`,
    params,
    query,
  );
}

const EVENT = `
  SELECT ce.calendar_event_id, ce.title, ce.description, ce.event_type, ce.owner_employee_id,
         ${personJson("e", "d")} AS owner, ce.starts_at, ce.ends_at, ce.all_day, ce.location,
         ce.visibility, ce.entity_type, ce.entity_id, ce.cancelled_at, ce.created_at,
         COALESCE((SELECT json_agg(json_build_object('employee', ${personJson("ae", "ad")}, 'response', a.response)
                                   ORDER BY ae.first_name, ae.last_name)
                     FROM calendar_event_attendee a
                     JOIN employee ae ON ae.employee_id = a.employee_id
                     LEFT JOIN department ad ON ad.department_id = ae.department_id
                    WHERE a.calendar_event_id = ce.calendar_event_id), '[]'::json) AS attendees
    FROM calendar_event ce
    LEFT JOIN employee e ON e.employee_id = ce.owner_employee_id
    LEFT JOIN department d ON d.department_id = e.department_id`;

/** One event the reader may see, or null. */
async function getFor(db, id, employeeId) {
  const params = [id, employeeId];
  const { rows } = await db.query(`${EVENT} WHERE ce.calendar_event_id = $1 AND ${SEES("$2")}`, params);
  return rows[0] || null;
}

async function lock(client, id) {
  const { rows } = await client.query(
    "SELECT calendar_event_id, owner_employee_id, cancelled_at FROM calendar_event WHERE calendar_event_id = $1 FOR UPDATE",
    [id],
  );
  return rows[0] || null;
}

const COLUMNS = ["title", "description", "event_type", "owner_employee_id", "starts_at", "ends_at",
  "all_day", "location", "visibility", "entity_type", "entity_id", "created_by", "cancelled_at"];

async function insert(client, row) {
  const keys = COLUMNS.filter((k) => row[k] !== undefined);
  const { rows } = await client.query(
    `INSERT INTO calendar_event (${keys.join(", ")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")})
     RETURNING calendar_event_id`,
    keys.map((k) => row[k]),
  );
  return rows[0].calendar_event_id;
}

async function update(client, id, changes) {
  const keys = COLUMNS.filter((k) => changes[k] !== undefined);
  if (!keys.length) return;
  await client.query(
    `UPDATE calendar_event SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE calendar_event_id = $1`,
    [id, ...keys.map((k) => changes[k])],
  );
}

/** Make the attendee list exactly these people, keeping answers already given. */
async function setAttendees(client, id, employeeIds) {
  await client.query(
    "DELETE FROM calendar_event_attendee WHERE calendar_event_id = $1 AND NOT (employee_id = ANY($2::uuid[]))",
    [id, employeeIds],
  );
  if (employeeIds.length) {
    await client.query(
      `INSERT INTO calendar_event_attendee (calendar_event_id, employee_id)
       SELECT $1, unnest($2::uuid[]) ON CONFLICT (calendar_event_id, employee_id) DO NOTHING`,
      [id, employeeIds],
    );
  }
}

async function attendeeIds(db, id) {
  const { rows } = await db.query(
    "SELECT employee_id FROM calendar_event_attendee WHERE calendar_event_id = $1 ORDER BY employee_id",
    [id],
  );
  return rows.map((r) => r.employee_id);
}

/** Record an attendee's answer; false when they are not invited. */
async function respond(client, id, employeeId, response) {
  const { rowCount } = await client.query(
    `UPDATE calendar_event_attendee SET response = $3, responded_at = now()
      WHERE calendar_event_id = $1 AND employee_id = $2`,
    [id, employeeId, response],
  );
  return rowCount > 0;
}

/** The employees among these ids who are on the staff now. */
async function activeOf(db, ids) {
  if (!ids.length) return [];
  const { rows } = await db.query(
    "SELECT employee_id FROM employee WHERE employee_id = ANY($1::uuid[]) AND status = 'active'",
    [ids],
  );
  return rows.map((r) => r.employee_id);
}

module.exports = { month, getFor, lock, insert, update, setAttendees, attendeeIds, respond, activeOf };
