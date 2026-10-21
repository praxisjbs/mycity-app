-- M1 policies' reference data (docs/guides/policies.md §4). Codes and settings only (A26): no
-- policy, person or text.
--
--   numbering   policy, a policy's number: POL-0001, never reset (src/shared/numbering/schemes.js).
--   approval    version 1 of policy.approval: one stage, the CEO, 72 hours; the same definition as
--               DEFAULTS in shared/workflow/definitions.js, which passes validateDefinition()
--               (MIGRATIONS §9). Operations & People change its stages on Settings · Approvals.
--   capability  policies.manage (src/shared/access/access.catalog.js), for Operations & People and
--               the Implementation Team; the CEO holds every capability.
--
-- Each is edited on Settings afterwards (Documents & Numbering, Approvals, Roles & Permissions); a
-- save there writes a new row or version, so DO NOTHING keeps a re-run harmless.
-- UP
INSERT INTO numbering_scheme (doc_type, prefix, padding, separator, reset, include_period)
VALUES ('policy', 'POL', 4, '-', 'never', false)
ON CONFLICT (doc_type) DO NOTHING;

INSERT INTO workflow_definition (key, version, module_key, name, description, context_types, stages, active)
VALUES (
  'policy.approval', 1, 'knowledge', 'Policy Approval',
  'The CEO approves and signs a policy version before it can start.',
  '{}'::jsonb,
  '[{"key":"ceo","name":"CEO","approver":{"type":"ceo"},"sla_hours":72}]'::jsonb,
  true
)
ON CONFLICT (key, version) DO NOTHING;

INSERT INTO capability (code, name, description)
VALUES ('policies.manage', 'Manage Policies', 'Write, publish, withdraw and archive company policies, and see who has acknowledged them.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_capability (role_id, capability_id)
SELECT r.role_id, c.capability_id
  FROM role r
  CROSS JOIN capability c
 WHERE r.code IN ('implementation', 'operations_people')
   AND c.code = 'policies.manage'
ON CONFLICT (role_id, capability_id) DO NOTHING;

-- DOWN
DELETE FROM role_capability
 WHERE capability_id IN (SELECT capability_id FROM capability WHERE code = 'policies.manage')
   AND role_id IN (SELECT role_id FROM role WHERE code IN ('implementation', 'operations_people'));
-- A capability someone has since given to a person or another role stays.
DELETE FROM capability c
 WHERE c.code = 'policies.manage'
   AND NOT EXISTS (SELECT 1 FROM user_capability uc WHERE uc.capability_id = c.capability_id)
   AND NOT EXISTS (SELECT 1 FROM role_capability rc WHERE rc.capability_id = c.capability_id);
-- Version 1 only, and only while no submission was opened on it.
DELETE FROM workflow_definition d
 WHERE d.key = 'policy.approval' AND d.version = 1
   AND NOT EXISTS (SELECT 1 FROM workflow_instance i WHERE i.workflow_definition_id = d.workflow_definition_id);
DELETE FROM numbering_scheme s
 WHERE s.doc_type = 'policy'
   AND NOT EXISTS (SELECT 1 FROM numbering_counter nc WHERE nc.doc_type = s.doc_type);
