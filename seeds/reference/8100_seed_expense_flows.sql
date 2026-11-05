-- M8 the expense chain's reference data as agreed on 04/11/2026 (docs/guides/expenses.md §6, §8).
-- Codes and settings only (A26): no request, person or category.
--
--   approvals    version 1 of expenses.request (the line manager unless the requester manages
--                people, then Operations & People, 48 hours each) and of expenses.requisition (the
--                CEO, 72 hours); the same definitions as DEFAULTS in shared/workflow/definitions.js,
--                which pass validateDefinition() (MIGRATIONS §9).
--   statuses     the request's, the requisition's and the payee types, as the contract spells them.
--                8099's `paid` is not a request status any more (a request is `disbursed`).
--   numbering    a request is numbered `expense` (EXP-0001, 0099); 8099's `expense_request` scheme
--                is taken out while nothing was numbered with it.
--   capability   expenses.finance, held by Operations & People and the Implementation Team, which
--                holds every capability so training runs from the build account (the CEO holds
--                every one).
--
-- Each is edited on Settings afterwards (Approvals, Documents & Numbering, Roles & Permissions), so
-- DO NOTHING keeps a re-run from overwriting a person's choice.
-- UP
INSERT INTO workflow_definition (key, version, module_key, name, description, context_types, stages, active)
VALUES (
  'expenses.request', 1, 'expenses', 'Expense Request',
  'The line manager, then Operations & People. A line manager''s own request goes straight to Operations & People.',
  '{"amount":"money","requester_manages_people":"boolean"}'::jsonb,
  '[{"key":"line_manager","name":"Line Manager","approver":{"type":"manager_of_subject"},"condition":{"field":"requester_manages_people","op":"=","value":false},"sla_hours":48},{"key":"operations_people","name":"Operations & People","approver":{"type":"role","value":"operations_people"},"sla_hours":48}]'::jsonb,
  true
)
ON CONFLICT (key, version) DO NOTHING;

INSERT INTO workflow_definition (key, version, module_key, name, description, context_types, stages, active)
VALUES (
  'expenses.requisition', 1, 'expenses', 'Requisition',
  'The CEO approves or rejects the batch of approved requests.',
  '{"total":"money"}'::jsonb,
  '[{"key":"ceo","name":"CEO","approver":{"type":"ceo"},"sla_hours":72}]'::jsonb,
  true
)
ON CONFLICT (key, version) DO NOTHING;

INSERT INTO reference_value (domain, code, label, display_order)
VALUES
  ('expense_status', 'sent_back', 'Sent Back', 25),
  ('expense_status', 'in_requisition', 'In Requisition', 32),
  ('expense_status', 'authorised', 'Authorised', 34),
  ('expense_status', 'disbursed', 'Disbursed', 36),
  ('requisition_status', 'submitted', 'With the CEO', 10),
  ('requisition_status', 'approved', 'Approved', 20),
  ('requisition_status', 'rejected', 'Rejected', 30),
  ('requisition_status', 'cancelled', 'Cancelled', 40),
  ('payee_type', 'staff', 'Staff', 10),
  ('payee_type', 'vendor', 'Vendor', 20),
  ('payee_type', 'partner', 'Partner', 30),
  ('payee_type', 'task_team', 'Dedicated Task Team (DTT)', 40)
ON CONFLICT (domain, code) DO NOTHING;

UPDATE reference_value SET active = false
 WHERE domain = 'expense_status' AND code = 'paid' AND active;

-- DESTRUCTIVE: 8099's unused expense_request scheme row (a request is numbered `expense`).
DELETE FROM numbering_scheme s
 WHERE s.doc_type = 'expense_request'
   AND NOT EXISTS (SELECT 1 FROM numbering_counter nc WHERE nc.doc_type = s.doc_type);

INSERT INTO capability (code, name, description)
VALUES ('expenses.finance', 'Run Expenses',
        'Group approved requests into requisitions, record disbursements, set budgets and manage the expense categories.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_capability (role_id, capability_id)
SELECT r.role_id, c.capability_id
  FROM role r
  CROSS JOIN capability c
 WHERE r.code IN ('implementation', 'operations_people') AND c.code = 'expenses.finance'
ON CONFLICT (role_id, capability_id) DO NOTHING;

-- DOWN
DELETE FROM role_capability
 WHERE capability_id IN (SELECT capability_id FROM capability WHERE code = 'expenses.finance')
   AND role_id IN (SELECT role_id FROM role WHERE code IN ('implementation', 'operations_people'));
-- A capability someone has since given to a person or another role stays.
DELETE FROM capability c
 WHERE c.code = 'expenses.finance'
   AND NOT EXISTS (SELECT 1 FROM user_capability uc WHERE uc.capability_id = c.capability_id)
   AND NOT EXISTS (SELECT 1 FROM role_capability rc WHERE rc.capability_id = c.capability_id);
-- 8099's `expense_request` scheme is not put back: nothing numbers with it.
UPDATE reference_value SET active = true
 WHERE domain = 'expense_status' AND code = 'paid' AND NOT active;
DELETE FROM reference_value
 WHERE (domain = 'expense_status' AND code IN ('sent_back', 'in_requisition', 'authorised', 'disbursed'))
    OR (domain = 'requisition_status' AND code IN ('submitted', 'approved', 'rejected', 'cancelled'))
    OR (domain = 'payee_type' AND code IN ('staff', 'vendor', 'partner', 'task_team'));
-- Version 1 only, and only while no approval was opened on it.
DELETE FROM workflow_definition d
 WHERE d.key IN ('expenses.request', 'expenses.requisition') AND d.version = 1
   AND NOT EXISTS (SELECT 1 FROM workflow_instance i WHERE i.workflow_definition_id = d.workflow_definition_id);
