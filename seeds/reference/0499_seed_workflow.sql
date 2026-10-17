-- M0 the leave approval flow: the line manager, then Operations & People over 5 days.
--
-- docs/guides/foundation.md §6.5. The same definition as `leave.approval` in
-- shared/workflow/definitions.js DEFAULTS, which passes validateDefinition() (MIGRATIONS §9).
-- Operations & People change the number of days, or any stage, on Settings, Approvals: a save
-- writes version 2 and on, so version 1 is never edited and DO NOTHING keeps a re-run harmless.
-- UP
INSERT INTO workflow_definition (key, version, module_key, name, description, context_types, stages, active)
VALUES (
  'leave.approval', 1, 'people', 'Leave Request',
  'The line manager, then Operations & People when the request is over 5 days.',
  '{"days":"number"}'::jsonb,
  '[{"key":"line_manager","name":"Line Manager","approver":{"type":"manager_of_subject"},"sla_hours":48},{"key":"operations_people","name":"Operations & People","approver":{"type":"role","value":"operations_people"},"condition":{"field":"days","op":">","value":5},"sla_hours":48}]'::jsonb,
  true
)
ON CONFLICT (key, version) DO NOTHING;

-- DOWN
-- Version 1 only, and only while no request was opened on it: a request keeps the version it
-- started on, so its definition stays. Versions saved on Settings are people's, not this file's.
DELETE FROM workflow_definition d
 WHERE d.key = 'leave.approval' AND d.version = 1
   AND NOT EXISTS (SELECT 1 FROM workflow_instance i WHERE i.workflow_definition_id = d.workflow_definition_id);
