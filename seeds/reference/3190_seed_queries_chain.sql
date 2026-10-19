-- M3 reference data for the consequence chain: the configure capability, the sanction approval and the shipped letter templates (docs/guides/queries.md §4).
--
--   capability        queries.configure (write query rules, the chain and letter templates), held by
--                     Implementation and Operations & People; the CEO holds every capability.
--   approval          queries.consequence version 1, as in shared/workflow/definitions.js DEFAULTS
--                     (validateDefinition() passes): Operations & People, then Management from rank 4.
--   approval, off     3099's employee_consequence fails validateDefinition() (its approvers have no
--                     type) and is replaced by queries.consequence; it is switched off, not deleted.
--   letter templates  one row per shipped file in templates/documents/, so the screen lists them and
--                     a rung or rule can name them. Template defaults the generator needs (A26).
--                     query-letter ships with wording and is active, so a rule can raise a query
--                     on a fresh database; the sanction letters wait for MyCity's samples (drafts).
--
-- The ladder itself (consequence_step) and every query rule are MyCity's choices, entered on
-- Sanctions, Chain Settings and on Rules (A26): none are seeded. Rows people edit later are inserted
-- only when absent (docs/MIGRATIONS.md §9).
-- UP
INSERT INTO capability (code, name, description)
VALUES ('queries.configure', 'Configure Queries', 'Write the query rules, the consequence chain and the letter templates.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_capability (role_id, capability_id)
SELECT r.role_id, c.capability_id
  FROM role r
  CROSS JOIN capability c
 WHERE c.code = 'queries.configure'
   AND r.code IN ('implementation', 'operations_people')
ON CONFLICT (role_id, capability_id) DO NOTHING;

INSERT INTO workflow_definition (key, version, module_key, name, description, context_types, stages, active)
VALUES (
  'queries.consequence', 1, 'queries', 'Sanction',
  'Operations & People, then Management from Suspension up.',
  '{"rank":"number","fine_amount":"money"}'::jsonb,
  '[{"key":"operations_people","name":"Operations & People","approver":{"type":"role","value":"operations_people"},"sla_hours":48},{"key":"management","name":"Management","approver":{"type":"role","value":"management"},"condition":{"field":"rank","op":">=","value":4},"sla_hours":48}]'::jsonb,
  true
)
ON CONFLICT (key, version) DO NOTHING;

UPDATE workflow_definition
   SET active = false
 WHERE key = 'employee_consequence' AND version = 1 AND active;

INSERT INTO letter_template (key, name, purpose, status)
VALUES
  ('query-letter', 'Query Letter', 'query', 'active'),
  ('caution-letter', 'Caution Letter', 'sanction', 'draft'),
  ('warning-letter', 'Warning Letter', 'sanction', 'draft'),
  ('suspension-letter', 'Suspension Letter', 'sanction', 'draft'),
  ('suspension-without-pay-letter', 'Suspension Without Pay Letter', 'sanction', 'draft'),
  ('termination-letter', 'Termination Letter', 'sanction', 'draft')
ON CONFLICT (key) DO NOTHING;

-- DOWN
-- Only templates no rung, rule or saved wording uses: a letter someone has edited stays theirs.
DELETE FROM letter_template t
 WHERE t.key IN ('query-letter', 'caution-letter', 'warning-letter', 'suspension-letter',
                 'suspension-without-pay-letter', 'termination-letter')
   AND t.created_by IS NULL
   AND NOT EXISTS (SELECT 1 FROM consequence_step s WHERE s.letter_template = t.key)
   AND NOT EXISTS (SELECT 1 FROM query_rule q WHERE q.letter_template = t.key)
   AND NOT EXISTS (SELECT 1 FROM template_version v WHERE v.kind = 'document' AND v.key = t.key);
UPDATE workflow_definition
   SET active = true
 WHERE key = 'employee_consequence' AND version = 1
   AND NOT EXISTS (SELECT 1 FROM workflow_definition d WHERE d.key = 'employee_consequence' AND d.version > 1);
-- Version 1 only, and only while no sanction was proposed on it.
DELETE FROM workflow_definition d
 WHERE d.key = 'queries.consequence' AND d.version = 1
   AND NOT EXISTS (SELECT 1 FROM workflow_instance i WHERE i.workflow_definition_id = d.workflow_definition_id);
DELETE FROM role_capability rc
 USING role r, capability c
 WHERE r.role_id = rc.role_id
   AND c.capability_id = rc.capability_id
   AND rc.granted_by IS NULL
   AND c.code = 'queries.configure'
   AND r.code IN ('implementation', 'operations_people');
DELETE FROM capability c
 WHERE c.code = 'queries.configure'
   AND NOT EXISTS (SELECT 1 FROM role_capability rc WHERE rc.capability_id = c.capability_id);
