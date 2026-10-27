-- M2 Performance: the approval flow for unbinding a binding plan (docs/guides/performance.md §6.22;
-- JBS Praxis, 27/10/2026). A flow only (A26): the same definition as DEFAULTS in
-- shared/workflow/definitions.js, which passes validateDefinition().
--
--   performance.plan_change   the CEO decides a request to unbind a binding plan, and the changes
--                             then made to it
--
-- A save on Settings · Approvals writes a new version, so DO NOTHING keeps a re-run from writing over it.
-- UP

INSERT INTO workflow_definition (key, version, module_key, name, description, context_types, stages, active)
VALUES (
  'performance.plan_change', 1, 'performance', 'Plan Change',
  'The CEO approves unbinding a binding plan, then the changes made to it.',
  '{}'::jsonb,
  '[{"key":"ceo","name":"CEO","approver":{"type":"ceo"},"sla_hours":72}]'::jsonb,
  true
)
ON CONFLICT (key, version) DO NOTHING;

-- DOWN

-- Version 1 only, and only while nothing was opened on it: an approval keeps the version it started on.
DELETE FROM workflow_definition d
 WHERE d.key = 'performance.plan_change'
   AND d.version = 1
   AND NOT EXISTS (SELECT 1 FROM workflow_instance i WHERE i.workflow_definition_id = d.workflow_definition_id);
