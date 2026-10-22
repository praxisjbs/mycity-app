-- M2 Performance plan code list (docs/guides/performance.md §6.1): the statuses an organisational goal
-- holds since migration 2200, as the goal_status domain. Draft, Pending Approval and Completed are
-- retired (a goal is recorded active and closed at the year's end); Closed is added. Codes only (A26).
-- UP
INSERT INTO reference_value (domain, code, label, display_order)
VALUES ('goal_status', 'active', 'Active', 30), ('goal_status', 'closed', 'Closed', 40)
ON CONFLICT (domain, code) DO UPDATE SET
  label = EXCLUDED.label,
  display_order = EXCLUDED.display_order,
  active = true;

UPDATE reference_value SET active = false
 WHERE domain = 'goal_status' AND code IN ('draft', 'pending_approval', 'completed') AND active;

-- DOWN
UPDATE reference_value SET active = true
 WHERE domain = 'goal_status' AND code IN ('draft', 'pending_approval', 'completed');
DELETE FROM reference_value WHERE domain = 'goal_status' AND code = 'closed';
