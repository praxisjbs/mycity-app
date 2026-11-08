-- M5 the offer approval (docs/guides/offers.md §3 step 2, §6): version 1 of recruitment.offer, the head
-- of the hiring department and then the CEO, 72 hours each; the same definition as DEFAULTS in
-- shared/workflow/definitions.js, which passes validateDefinition() (MIGRATIONS §9). Edited on
-- Settings · Approvals afterwards, so DO NOTHING keeps a re-run from overwriting a person's choice.
-- The flow's first stage is the head of the hiring department, and deciding a stage needs the
-- module's approve grant (workflow.service approveScope): Head of Department gains `approve` on
-- recruitment in its team scope, only while its grant is exactly as 0290 left it, so a choice made
-- on Settings · Roles is never overwritten (docs/MIGRATIONS.md §9).
-- UP
INSERT INTO workflow_definition (key, version, module_key, name, description, context_types, stages, active)
VALUES (
  'recruitment.offer', 1, 'recruitment', 'Offer of Employment',
  'The head of the hiring department, then the CEO, before the offer is signed for the company and sent.',
  '{"annual_compensation":"money","outside_range":"boolean","department_id":"uuid","department_head_employee_id":"uuid"}'::jsonb,
  '[{"key":"head_of_department","name":"Head of Department","approver":{"type":"employee_in_context","value":"department_head_employee_id"},"sla_hours":72},{"key":"ceo","name":"CEO","approver":{"type":"ceo"},"sla_hours":72}]'::jsonb,
  true
)
ON CONFLICT (key, version) DO NOTHING;

UPDATE permission p SET can_approve = true, updated_at = now()
  FROM role r
 WHERE r.role_id = p.role_id AND r.code = 'head_of_department' AND p.module_key = 'recruitment'
   AND p.scope = 'team' AND p.can_view AND p.can_create AND p.can_edit AND NOT p.can_delete
   AND NOT p.can_approve AND NOT p.can_export;

-- DOWN
UPDATE permission p SET can_approve = false, updated_at = now()
  FROM role r
 WHERE r.role_id = p.role_id AND r.code = 'head_of_department' AND p.module_key = 'recruitment'
   AND p.scope = 'team' AND p.can_view AND p.can_create AND p.can_edit AND NOT p.can_delete
   AND p.can_approve AND NOT p.can_export;
DELETE FROM workflow_definition
WHERE key = 'recruitment.offer' AND version = 1
  AND NOT EXISTS (SELECT 1 FROM workflow_instance i WHERE i.definition_key = 'recruitment.offer');
