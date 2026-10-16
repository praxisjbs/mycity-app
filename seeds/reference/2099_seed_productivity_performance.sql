-- M2 task, goal and review reference values.
-- UP
INSERT INTO reference_value (domain, code, label, display_order)
VALUES
  ('task_status', 'todo', 'To Do', 10),
  ('task_status', 'in_progress', 'In Progress', 20),
  ('task_status', 'in_review', 'In Review', 30),
  ('task_status', 'done', 'Done', 40),
  ('task_priority', 'low', 'Low', 10),
  ('task_priority', 'normal', 'Normal', 20),
  ('task_priority', 'high', 'High', 30),
  ('task_priority', 'urgent', 'Urgent', 40),
  ('goal_status', 'draft', 'Draft', 10),
  ('goal_status', 'pending_approval', 'Pending Approval', 20),
  ('goal_status', 'active', 'Active', 30),
  ('goal_status', 'completed', 'Completed', 40),
  ('review_status', 'draft', 'Draft', 10),
  ('review_status', 'self_submitted', 'Self Submitted', 20),
  ('review_status', 'manager_submitted', 'Manager Submitted', 30),
  ('review_status', 'acknowledged', 'Acknowledged', 40)
ON CONFLICT (domain, code) DO UPDATE SET
  label = EXCLUDED.label,
  display_order = EXCLUDED.display_order,
  active = true;

INSERT INTO numbering_scheme (doc_type, prefix, padding, separator, reset, include_period)
VALUES ('project', 'PRJ', 6, '-', 'yearly', true)
ON CONFLICT (doc_type) DO UPDATE SET
  prefix = EXCLUDED.prefix,
  padding = EXCLUDED.padding,
  separator = EXCLUDED.separator,
  reset = EXCLUDED.reset,
  include_period = EXCLUDED.include_period;

-- DOWN
DELETE FROM numbering_scheme WHERE doc_type = 'project';
DELETE FROM reference_value WHERE domain IN ('task_status', 'task_priority', 'goal_status', 'review_status');
