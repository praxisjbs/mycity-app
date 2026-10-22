-- M2 Performance reference data (docs/guides/performance.md §4, §6.4, §6.7, §6.11, §6.12, §8). Codes
-- and settings only (A26): no goal, KPI, scorecard, rule value or person.
--
--   capabilities  goals.organisation and goals.confirm (the CEO, who holds every authority, and the
--                 Implementation Team, which holds everything there is so training runs from the
--                 build account); goals.company (Management); goals.function (Management, Head of
--                 Department, Operations & People); performance.manage (Operations & People).
--                 Edited on Settings · Roles & Permissions afterwards, so inserted only when absent.
--   approvals     version 1 of performance.plan, performance.target_change, performance.commitments
--                 and performance.review: the same definitions as DEFAULTS in
--                 shared/workflow/definitions.js, which pass validateDefinition() (MIGRATIONS §9).
--                 A save on Settings · Approvals writes a new version, so DO NOTHING keeps a re-run
--                 harmless.
--   code lists    the contract's enums for key result types, measures and statuses, line measures and
--                 sources, review stages, PIP statuses and ratings, as reference_value domains.
--
-- The scoring rules' defaults live in the code (packages/contract/schemas/scoring.js DEFAULT_RULES)
-- until Operations & People save a quarter.
-- UP
INSERT INTO capability (code, name, description)
VALUES
  ('goals.organisation', 'Set Organisational Goals', 'Record and edit the organisational goals and their quarterly targets.'),
  ('goals.company', 'Set Company OKRs', 'Set the company objectives and key results, and send the company plan.'),
  ('goals.function', 'Set Function OKRs', 'Set a function''s objectives, key results and KPIs, report its month and send its plan, as its head or acting head.'),
  ('goals.confirm', 'Confirm Scores', 'Confirm the month''s key result scores the heads propose.'),
  ('performance.manage', 'Run Performance', 'Run the cycle: quarters and their rules, rounds, reviewer changes, conduct, improvement plans, probation outcomes and imports.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_capability (role_id, capability_id)
SELECT r.role_id, c.capability_id
  FROM (VALUES
    ('management', 'goals.company'),
    ('management', 'goals.function'),
    ('head_of_department', 'goals.function'),
    ('operations_people', 'goals.function'),
    ('operations_people', 'performance.manage'),
    ('implementation', 'goals.organisation'),
    ('implementation', 'goals.company'),
    ('implementation', 'goals.function'),
    ('implementation', 'goals.confirm'),
    ('implementation', 'performance.manage')
  ) AS g (role_code, capability_code)
  JOIN role r ON r.code = g.role_code
  JOIN capability c ON c.code = g.capability_code
ON CONFLICT (role_id, capability_id) DO NOTHING;

INSERT INTO workflow_definition (key, version, module_key, name, description, context_types, stages, active)
VALUES (
  'performance.plan', 1, 'performance', 'Quarter Plan',
  'The head''s line manager, Operations & People, then the CEO. The company plan goes to the CEO.',
  '{"head_reports_to_ceo":"boolean","by_operations_people":"boolean","is_company":"boolean"}'::jsonb,
  '[{"key":"line_manager","name":"Line Manager","approver":{"type":"manager_of_subject"},"condition":[{"field":"head_reports_to_ceo","op":"=","value":false},{"field":"is_company","op":"=","value":false}],"sla_hours":72},{"key":"operations_people","name":"Operations & People","approver":{"type":"role","value":"operations_people"},"condition":[{"field":"by_operations_people","op":"=","value":false},{"field":"is_company","op":"=","value":false}],"sla_hours":72},{"key":"ceo","name":"CEO","approver":{"type":"ceo"},"sla_hours":72}]'::jsonb,
  true
)
ON CONFLICT (key, version) DO NOTHING;

INSERT INTO workflow_definition (key, version, module_key, name, description, context_types, stages, active)
VALUES (
  'performance.target_change', 1, 'performance', 'Target Change',
  'The CEO approves a change to a binding target.',
  '{}'::jsonb,
  '[{"key":"ceo","name":"CEO","approver":{"type":"ceo"},"sla_hours":72}]'::jsonb,
  true
)
ON CONFLICT (key, version) DO NOTHING;

INSERT INTO workflow_definition (key, version, module_key, name, description, context_types, stages, active)
VALUES (
  'performance.commitments', 1, 'performance', 'Monthly Commitments',
  'The person''s reviewer approves the month''s commitments; the CEO approves a head''s.',
  '{"is_function_head":"boolean","reviewer_employee_id":"uuid"}'::jsonb,
  '[{"key":"reviewer","name":"Reviewer","approver":{"type":"employee_in_context","value":"reviewer_employee_id"},"condition":{"field":"is_function_head","op":"=","value":false},"sla_hours":48},{"key":"ceo","name":"CEO","approver":{"type":"ceo"},"condition":{"field":"is_function_head","op":"=","value":true},"sla_hours":48}]'::jsonb,
  true
)
ON CONFLICT (key, version) DO NOTHING;

INSERT INTO workflow_definition (key, version, module_key, name, description, context_types, stages, active)
VALUES (
  'performance.review', 1, 'performance', 'Monthly Review',
  'The reviewer''s own manager, then Operations & People close it.',
  '{"second_level_employee_id":"uuid","reviewer_is_ceo":"boolean"}'::jsonb,
  '[{"key":"second_level","name":"Second Level","approver":{"type":"employee_in_context","value":"second_level_employee_id"},"condition":{"field":"reviewer_is_ceo","op":"=","value":false},"sla_hours":48},{"key":"operations_people","name":"Operations & People","approver":{"type":"role","value":"operations_people"},"sla_hours":48}]'::jsonb,
  true
)
ON CONFLICT (key, version) DO NOTHING;

INSERT INTO reference_value (domain, code, label, display_order)
VALUES
  ('kr_type', 'diagnostic_gate', 'Diagnostic Gate', 10),
  ('kr_type', 'visibility_gate', 'Visibility Gate', 20),
  ('kr_type', 'enabling', 'Enabling', 30),
  ('kr_type', 'compliance_retiring', 'Compliance Retiring', 40),
  ('kr_type', 'compliance_floor', 'Compliance Floor', 50),
  ('kr_type', 'outcome', 'Outcome', 60),
  ('kr_type', 'output', 'Output', 70),
  ('kr_measure', 'numeric', 'Numeric', 10),
  ('kr_measure', 'dated', 'Dated', 20),
  ('kr_measure', 'yes_no', 'Yes or No', 30),
  ('kr_measure', 'multi_part', 'Multi-Part', 40),
  ('kr_status', 'not_started', 'Not Started', 10),
  ('kr_status', 'on_track', 'On Track', 20),
  ('kr_status', 'at_risk', 'At Risk', 30),
  ('kr_status', 'off_track', 'Off Track', 40),
  ('kr_status', 'done', 'Done', 50),
  ('kr_status', 'missed', 'Missed', 60),
  ('line_measure', 'numeric', 'Numeric', 10),
  ('line_measure', 'milestone', 'Milestone', 20),
  ('line_measure', 'standard', 'Standard', 30),
  ('line_measure', 'binary', 'Met or Not', 40),
  ('line_source', 'own', 'Own Figure', 10),
  ('line_source', 'key_result', 'Key Result', 20),
  ('line_source', 'team_result', 'Team Result', 30),
  ('line_source', 'function_kpi', 'Function KPI', 40),
  ('line_source', 'commitments', 'Commitments', 50),
  ('line_source', 'update_on_time', 'Update On Time', 60),
  ('line_source', 'team_reviews', 'Team Reviews', 70),
  ('line_source', 'tasks', 'Tasks', 80),
  ('review_stage', 'check_in', 'Check-In', 10),
  ('review_stage', 'with_reviewer', 'With Reviewer', 20),
  ('review_stage', 'second_level', 'Second Level', 30),
  ('review_stage', 'with_hr', 'With HR', 40),
  ('review_stage', 'closed', 'Closed', 50),
  ('review_stage', 'returned', 'Returned', 60),
  ('pip_status', 'open', 'Open', 10),
  ('pip_status', 'passed', 'Passed', 20),
  ('pip_status', 'extended', 'Extended', 30),
  ('pip_status', 'not_met', 'Not Met', 40),
  ('rating', 'exceeds', 'Exceeds', 10),
  ('rating', 'meets', 'Meets', 20),
  ('rating', 'partly_meets', 'Partly Meets', 30),
  ('rating', 'below', 'Below', 40)
ON CONFLICT (domain, code) DO UPDATE SET
  label = EXCLUDED.label,
  display_order = EXCLUDED.display_order,
  active = true;

-- DOWN
DELETE FROM reference_value WHERE domain IN ('kr_type', 'kr_measure', 'kr_status', 'line_measure', 'line_source', 'review_stage', 'pip_status', 'rating');

-- Version 1 only, and only while nothing was opened on it: an approval keeps the version it started on.
DELETE FROM workflow_definition d
 WHERE d.key IN ('performance.plan', 'performance.target_change', 'performance.commitments', 'performance.review')
   AND d.version = 1
   AND NOT EXISTS (SELECT 1 FROM workflow_instance i WHERE i.workflow_definition_id = d.workflow_definition_id);

DELETE FROM role_capability rc
 USING role r, capability c,
       (VALUES
         ('management', 'goals.company'),
         ('management', 'goals.function'),
         ('head_of_department', 'goals.function'),
         ('operations_people', 'goals.function'),
         ('operations_people', 'performance.manage'),
         ('implementation', 'goals.organisation'),
         ('implementation', 'goals.company'),
         ('implementation', 'goals.function'),
         ('implementation', 'goals.confirm'),
         ('implementation', 'performance.manage')
       ) AS g (role_code, capability_code)
 WHERE rc.role_id = r.role_id AND rc.capability_id = c.capability_id
   AND r.code = g.role_code AND c.code = g.capability_code;
-- A capability someone has since given to a person or another role stays: deleting it would cascade
-- into their choice.
DELETE FROM capability c
 WHERE c.code IN ('goals.organisation', 'goals.company', 'goals.function', 'goals.confirm', 'performance.manage')
   AND NOT EXISTS (SELECT 1 FROM user_capability uc WHERE uc.capability_id = c.capability_id)
   AND NOT EXISTS (SELECT 1 FROM role_capability rc WHERE rc.capability_id = c.capability_id);
