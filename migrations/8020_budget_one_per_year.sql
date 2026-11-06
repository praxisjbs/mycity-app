-- M8: one budget per department per year (handoff decision 7; audit F7). New Budget's check in
-- budgets.service ran without a lock, so two saves at once could both pass; this index refuses
-- the second, and the service answers it 409 BUDGET_EXISTS. A budget's year starts on 1 January,
-- so the department and its first day are the year. Budgets saved twice before this index lands
-- would stop it being built: the later of each pair is closed first, never deleted (its lines and
-- its history stay readable), so the index covers open budgets only.
-- UP
UPDATE budget b
   SET status = 'closed', updated_at = now()
 WHERE b.status <> 'closed'
   AND EXISTS (SELECT 1 FROM budget o
                WHERE o.department_id = b.department_id AND o.starts_on = b.starts_on AND o.status <> 'closed'
                  AND (o.created_at, o.budget_id) < (b.created_at, b.budget_id));

CREATE UNIQUE INDEX IF NOT EXISTS budget_one_per_department_year
  ON budget (department_id, starts_on) WHERE status <> 'closed';

-- DOWN
-- The closing above is not undone: a budget it closed was a second one for its year.
DROP INDEX IF EXISTS budget_one_per_department_year;
