-- M2 My Workspace: the task numbering scheme and the cancelled task status.
-- UP
INSERT INTO numbering_scheme (doc_type, prefix, padding, separator, reset, include_period)
VALUES ('task', 'TSK', 4, '-', 'never', false)
ON CONFLICT (doc_type) DO NOTHING;

INSERT INTO reference_value (domain, code, label, display_order)
VALUES ('task_status', 'cancelled', 'Cancelled', 50)
ON CONFLICT (domain, code) DO UPDATE SET
  label = EXCLUDED.label,
  display_order = EXCLUDED.display_order,
  active = true;

-- DOWN
DELETE FROM reference_value WHERE domain = 'task_status' AND code = 'cancelled';
DELETE FROM numbering_scheme WHERE doc_type = 'task';
