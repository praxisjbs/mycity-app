-- M3 consequence chain and query reference data.
-- UP
INSERT INTO reference_value (domain, code, label, display_order)
VALUES
  ('query_status', 'awaiting_response', 'Awaiting Response', 10),
  ('query_status', 'under_review', 'Under Review', 20),
  ('query_status', 'resolved', 'Resolved', 30),
  ('sanction_type', 'caution', 'Caution', 10),
  ('sanction_type', 'warning', 'Warning', 20),
  ('sanction_type', 'second_warning', 'Second Warning', 30),
  ('sanction_type', 'suspension', 'Suspension', 40),
  ('sanction_type', 'suspension_without_pay', 'Suspension Without Pay', 50),
  ('sanction_type', 'termination', 'Termination', 60)
ON CONFLICT (domain, code) DO UPDATE SET
  label = EXCLUDED.label,
  display_order = EXCLUDED.display_order,
  active = true;

INSERT INTO workflow_definition (key, version, module_key, name, description, context_types, stages, active)
VALUES (
  'employee_consequence', 1, 'queries', 'Employee Consequence',
  'Configurable query and consequence review.',
  '{"employee_id":"uuid","sanction_type":"text"}'::jsonb,
  '[{"key":"manager_review","approver":{"role":"manager"},"on_approve":"operations_review","on_reject":"rejected","sla_hours":48},{"key":"operations_review","approver":{"role":"management"},"on_approve":"approved","on_reject":"rejected","sla_hours":48}]'::jsonb,
  true
)
ON CONFLICT (key, version) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  context_types = EXCLUDED.context_types,
  stages = EXCLUDED.stages,
  active = true;

-- DOWN
DELETE FROM workflow_definition WHERE key = 'employee_consequence' AND version = 1;
DELETE FROM reference_value WHERE domain IN ('query_status', 'sanction_type');
