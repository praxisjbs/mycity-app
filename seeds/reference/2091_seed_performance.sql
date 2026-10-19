-- M2 Performance Management's reference data (docs/guides/performance.md §4, §6, §8). Codes and settings
-- only (A26): no goal, cycle, question or person.
--
--   numbering     a goal's number by level: organisational OG-2026-01, annual AG-2026-01, monthly
--                 MG-2026-001, departmental target DT-2026-001; yearly, with the year
--                 (src/shared/numbering/schemes.js).
--   statuses      goal, plan, KPI, cycle and review statuses as the contract spells them; 2099's
--                 review statuses that nothing writes any more are switched off.
--   approvals     version 1 of performance.goal (Management, Operations & People, the CEO) and of
--                 performance.review (the reviewer's line manager, Operations & People), 48 hours each;
--                 the same definitions as DEFAULTS in shared/workflow/definitions.js, which pass
--                 validateDefinition() (MIGRATIONS §9).
--   capabilities  goals.organisation (the CEO only, who holds every authority, so no role is given
--                 it), goals.company (Management), goals.department (Head of Department),
--                 kpis.assign (Line Manager, Head of Department), reviews.cycles (Operations & People);
--                 the Implementation Team holds all but goals.organisation until handover.
--
-- Schemes, approvals and grants are edited on Settings afterwards; DO NOTHING keeps a re-run from
-- overwriting a person's choice.
-- UP
INSERT INTO numbering_scheme (doc_type, prefix, padding, separator, reset, include_period)
VALUES
  ('goal_organisation', 'OG', 2, '-', 'yearly', true),
  ('goal_annual', 'AG', 2, '-', 'yearly', true),
  ('goal_monthly', 'MG', 3, '-', 'yearly', true),
  ('goal_department', 'DT', 3, '-', 'yearly', true)
ON CONFLICT (doc_type) DO NOTHING;

INSERT INTO reference_value (domain, code, label, display_order)
VALUES
  ('goal_level', 'organisation', 'Organisational', 10),
  ('goal_level', 'annual', 'Annual', 20),
  ('goal_level', 'monthly', 'Monthly', 30),
  ('goal_level', 'department', 'Departmental', 40),
  ('goal_status', 'returned', 'Returned', 35),
  ('goal_status', 'cancelled', 'Cancelled', 50),
  ('plan_status', 'draft', 'Draft', 10),
  ('plan_status', 'pending_approval', 'Pending Approval', 20),
  ('plan_status', 'active', 'Approved', 30),
  ('plan_status', 'returned', 'Returned', 40),
  ('kpi_status', 'draft', 'Draft', 10),
  ('kpi_status', 'pending_approval', 'Pending Approval', 20),
  ('kpi_status', 'active', 'Active', 30),
  ('kpi_status', 'returned', 'Returned', 35),
  ('kpi_status', 'met', 'Met', 40),
  ('kpi_status', 'completed', 'Completed', 50),
  ('kpi_status', 'cancelled', 'Cancelled', 60),
  ('cycle_status', 'draft', 'Draft', 10),
  ('cycle_status', 'scheduled', 'Scheduled', 20),
  ('cycle_status', 'open', 'Open', 30),
  ('cycle_status', 'closed', 'Closed', 40),
  ('review_status', 'submitted', 'Submitted', 20),
  ('review_status', 'second_level', 'Second Level', 30),
  ('review_status', 'with_hr', 'With HR', 40),
  ('review_status', 'closed', 'Closed', 50),
  ('review_status', 'returned', 'Returned', 60)
ON CONFLICT (domain, code) DO NOTHING;

-- 2099 seeded these before the review flow was decided; nothing writes them.
UPDATE reference_value SET active = false
 WHERE domain = 'review_status' AND code IN ('self_submitted', 'manager_submitted', 'acknowledged');

INSERT INTO workflow_definition (key, version, module_key, name, description, context_types, stages, active)
VALUES
  (
    'performance.goal', 1, 'performance', 'Goals and Targets',
    'Management, then Operations & People, then the CEO, whose approval makes it binding.',
    '{}'::jsonb,
    '[{"key":"management","name":"Management","approver":{"type":"role","value":"management"},"sla_hours":48},{"key":"operations_people","name":"Operations & People","approver":{"type":"role","value":"operations_people"},"sla_hours":48},{"key":"ceo","name":"CEO","approver":{"type":"ceo"},"sla_hours":48}]'::jsonb,
    true
  ),
  (
    'performance.review', 1, 'performance', 'Performance Review',
    'The reviewer''s line manager, then Operations & People.',
    '{}'::jsonb,
    '[{"key":"second_level","name":"Second Level","approver":{"type":"manager_of_subject"},"sla_hours":48},{"key":"operations_people","name":"Operations & People","approver":{"type":"role","value":"operations_people"},"sla_hours":48}]'::jsonb,
    true
  )
ON CONFLICT (key, version) DO NOTHING;

INSERT INTO capability (code, name, description)
VALUES
  ('goals.organisation', 'Set Organisational Goals', 'Record and activate the organisation''s goals.'),
  ('goals.company', 'Set Company Goals', 'Set annual and monthly goals under the organisational goals.'),
  ('goals.department', 'Set Department Targets', 'Set a department''s monthly targets and submit its month.'),
  ('kpis.assign', 'Assign KPIs', 'Set the monthly KPIs and weights of the people in scope.'),
  ('reviews.cycles', 'Run Review Cycles', 'Open and close review cycles and edit their questions.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_capability (role_id, capability_id)
SELECT r.role_id, c.capability_id
  FROM role r
  CROSS JOIN capability c
 WHERE (c.code = 'goals.company' AND r.code IN ('implementation', 'management'))
    OR (c.code = 'goals.department' AND r.code IN ('implementation', 'head_of_department'))
    OR (c.code = 'kpis.assign' AND r.code IN ('implementation', 'head_of_department', 'manager'))
    OR (c.code = 'reviews.cycles' AND r.code IN ('implementation', 'operations_people'))
ON CONFLICT (role_id, capability_id) DO NOTHING;

-- DOWN
DELETE FROM role_capability rc
 USING role r, capability c
 WHERE r.role_id = rc.role_id
   AND c.capability_id = rc.capability_id
   -- Only rows a seed wrote: a grant made on Settings, Roles & Permissions records who made it.
   AND rc.granted_by IS NULL
   AND ((c.code = 'goals.company' AND r.code IN ('implementation', 'management'))
     OR (c.code = 'goals.department' AND r.code IN ('implementation', 'head_of_department'))
     OR (c.code = 'kpis.assign' AND r.code IN ('implementation', 'head_of_department', 'manager'))
     OR (c.code = 'reviews.cycles' AND r.code IN ('implementation', 'operations_people')));
-- A capability someone has since given to a person or another role stays.
DELETE FROM capability c
 WHERE c.code IN ('goals.organisation', 'goals.company', 'goals.department', 'kpis.assign', 'reviews.cycles')
   AND NOT EXISTS (SELECT 1 FROM user_capability uc WHERE uc.capability_id = c.capability_id)
   AND NOT EXISTS (SELECT 1 FROM role_capability rc WHERE rc.capability_id = c.capability_id);
-- Version 1 only, and only while nothing was opened on it.
DELETE FROM workflow_definition d
 WHERE d.key IN ('performance.goal', 'performance.review') AND d.version = 1
   AND NOT EXISTS (SELECT 1 FROM workflow_instance i WHERE i.workflow_definition_id = d.workflow_definition_id);
UPDATE reference_value SET active = true
 WHERE domain = 'review_status' AND code IN ('self_submitted', 'manager_submitted', 'acknowledged');
DELETE FROM reference_value
 WHERE (domain IN ('goal_level', 'plan_status', 'kpi_status', 'cycle_status'))
    OR (domain = 'goal_status' AND code IN ('returned', 'cancelled'))
    OR (domain = 'review_status' AND code IN ('submitted', 'second_level', 'with_hr', 'closed', 'returned'));
-- A number already issued is never taken back: a scheme with a counter keeps it.
DELETE FROM numbering_scheme s
 WHERE s.doc_type IN ('goal_organisation', 'goal_annual', 'goal_monthly', 'goal_department')
   AND NOT EXISTS (SELECT 1 FROM numbering_counter nc WHERE nc.doc_type = s.doc_type);
