-- M1 Organogram: the person each employee answers to skips a manager who no longer works here (QA BG-005, JBS Praxis 24/11/2026).
-- As 1160, through vacant seats, and now also past a line manager whose record is not active (archived,
-- left or suspended): the next active manager above them answers instead, climbing as far as it takes.
-- Nobody active above gives no one, and the approver is then the CEO (shared/workflow/approvers.js).
-- Approvals, team scope and the notifications that follow team scope read it; the chart still draws the
-- true line (organogram.md §4, §6).
-- UP

CREATE OR REPLACE VIEW employee_effective_manager AS
WITH RECURSIVE seat_up AS (
  SELECT s.org_seat_id, s.line_manager_id AS manager_id, s.line_manager_seat_id AS next_seat_id, 0 AS hops
    FROM org_seat s
   WHERE s.status = 'vacant'
  UNION ALL
  SELECT seat_up.org_seat_id, s.line_manager_id, s.line_manager_seat_id, seat_up.hops + 1
    FROM seat_up
    JOIN org_seat s ON s.org_seat_id = seat_up.next_seat_id AND s.status = 'vacant'
   WHERE seat_up.manager_id IS NULL AND seat_up.hops < 32
),
direct AS (
  SELECT e.employee_id, COALESCE(e.line_manager_id, seat.manager_id) AS manager_id
    FROM employee e
    LEFT JOIN seat_up seat
      ON e.line_manager_id IS NULL
     AND seat.org_seat_id = e.line_manager_seat_id
     AND seat.manager_id IS NOT NULL
),
climb AS (
  SELECT d.employee_id, d.manager_id, 0 AS hops
    FROM direct d
  UNION ALL
  SELECT climb.employee_id, up.manager_id, climb.hops + 1
    FROM climb
    JOIN employee m ON m.employee_id = climb.manager_id AND m.status <> 'active'
    JOIN direct up ON up.employee_id = m.employee_id
   WHERE climb.hops < 32
)
SELECT DISTINCT ON (climb.employee_id)
       climb.employee_id,
       CASE WHEN m.status = 'active' THEN climb.manager_id END AS manager_id
  FROM climb
  LEFT JOIN employee m ON m.employee_id = climb.manager_id
 ORDER BY climb.employee_id, climb.hops DESC;

-- DOWN

CREATE OR REPLACE VIEW employee_effective_manager AS
WITH RECURSIVE seat_up AS (
  SELECT s.org_seat_id, s.line_manager_id AS manager_id, s.line_manager_seat_id AS next_seat_id, 0 AS hops
    FROM org_seat s
   WHERE s.status = 'vacant'
  UNION ALL
  SELECT seat_up.org_seat_id, s.line_manager_id, s.line_manager_seat_id, seat_up.hops + 1
    FROM seat_up
    JOIN org_seat s ON s.org_seat_id = seat_up.next_seat_id AND s.status = 'vacant'
   WHERE seat_up.manager_id IS NULL AND seat_up.hops < 32
)
SELECT e.employee_id, COALESCE(e.line_manager_id, seat.manager_id) AS manager_id
  FROM employee e
  LEFT JOIN seat_up seat
    ON e.line_manager_id IS NULL
   AND seat.org_seat_id = e.line_manager_seat_id
   AND seat.manager_id IS NOT NULL;
