-- M1 Organogram: the person each employee answers to while the seat above them is empty (organogram.md §4, §6).
-- Their line manager, or, for someone who reports to a vacant seat, the first person above that seat,
-- through any vacant seats between (TB, 19/10/2026). Approvals, team scope and the notifications that
-- follow team scope read it; the chart still draws the seat. A seat with nobody above it gives no one,
-- and the approver is then the CEO, as for anyone with no line manager.
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
)
SELECT e.employee_id, COALESCE(e.line_manager_id, seat.manager_id) AS manager_id
  FROM employee e
  LEFT JOIN seat_up seat
    ON e.line_manager_id IS NULL
   AND seat.org_seat_id = e.line_manager_seat_id
   AND seat.manager_id IS NOT NULL;

-- DOWN

DROP VIEW IF EXISTS employee_effective_manager;
