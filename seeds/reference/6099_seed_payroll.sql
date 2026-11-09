-- M6 payroll's reference data, and only what the code cannot run without (A26, docs/MIGRATIONS.md §9;
-- docs/guides/payroll.md §4.3, §6.9, §8).
--
--   approvals    version 1 of payroll.run: the CEO alone, 72 hours (JBS Praxis, 08/11/2026). Its context carries
--                money (net_total), so the engine never approves it on a timeout: it re-arms the stage and tells
--                the CEO. The same definition as DEFAULTS in shared/workflow/definitions.js, which passes
--                validateDefinition(). MyCity adds a stage or a role on Settings · Approvals without code.
--   capability   payroll.configure, held by Operations & People and the Implementation Team (the CEO holds every
--                capability). It guards the advanced switch, the pay day, the bank rule and the statutory rates,
--                bands, grades and pay components.
--   leave        the seeded Unpaid leave type is flagged unpaid (6030), so payroll deducts its days.
--
-- No setting row, no rate, no band, no grade, no run and no pay day: those are MyCity's choices or its data, and
-- the default pay day (30) is a constant in code. Each row here is edited on Settings afterwards, so it is
-- inserted only when absent and a re-run never writes over a person's choice.
-- UP
INSERT INTO workflow_definition (key, version, module_key, name, description, context_types, stages, active)
VALUES (
  'payroll.run', 1, 'payroll', 'Payroll Run',
  'The CEO approves the month''s payroll before payslips are published.',
  '{"net_total":"money"}'::jsonb,
  '[{"key":"ceo","name":"CEO","approver":{"type":"ceo"},"sla_hours":72}]'::jsonb,
  true
)
ON CONFLICT (key, version) DO NOTHING;

INSERT INTO capability (code, name, description)
VALUES ('payroll.configure', 'Configure Payroll',
        'Switch the advanced option on or off, set the pay day and the bank rule, and enter the statutory rates, bands, salary grades and pay components.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_capability (role_id, capability_id)
SELECT r.role_id, c.capability_id
  FROM role r
  CROSS JOIN capability c
 WHERE r.code IN ('implementation', 'operations_people') AND c.code = 'payroll.configure'
ON CONFLICT (role_id, capability_id) DO NOTHING;

-- Only a type still holding the default is flagged, so a person's later choice survives a re-run.
UPDATE leave_type SET unpaid = true WHERE code = 'unpaid' AND NOT unpaid;

-- DOWN
UPDATE leave_type SET unpaid = false WHERE code = 'unpaid' AND unpaid;
DELETE FROM role_capability
 WHERE capability_id IN (SELECT capability_id FROM capability WHERE code = 'payroll.configure')
   AND role_id IN (SELECT role_id FROM role WHERE code IN ('implementation', 'operations_people'));
-- A capability someone has since given to a person or another role stays: deleting it would cascade into their choice.
DELETE FROM capability c
 WHERE c.code = 'payroll.configure'
   AND NOT EXISTS (SELECT 1 FROM user_capability uc WHERE uc.capability_id = c.capability_id)
   AND NOT EXISTS (SELECT 1 FROM role_capability rc WHERE rc.capability_id = c.capability_id);
-- Version 1 only, and only while no approval was opened on it.
DELETE FROM workflow_definition d
 WHERE d.key = 'payroll.run' AND d.version = 1
   AND NOT EXISTS (SELECT 1 FROM workflow_instance i WHERE i.workflow_definition_id = d.workflow_definition_id);
