-- M7 partnerships reference data (docs/guides/partnerships.md §4.3, §6.9, §8): code lists, numbering, the agreement approval, the two capabilities, and 7099's business choices switched off.
-- Codes and settings only (A26): no category, stage, impact, source or document kind (MyCity enters
-- those on Partnerships · Categories or with Start From Tracker), no partner, no person.
--
--   code lists    deal_health (on_track, follow_up_required, stalled) and interaction_type (call,
--                 meeting, email, visit, note), the codes the service switches on, as the contract
--                 spells them; 7099 seeded four interaction types, `visit` joins them
--   7099, off     its partner_type and partnership_stage rows were MyCity's choices seeded (A26):
--                 switched off, deleting nothing a row uses
--   numbering     partner PAR-0001 (never resets; 7099's row kept), lead LED-0001, deal DEAL-2026-0001
--                 (yearly), proposal PRO-0001 (0099's row kept), agreement AGR-2026-0001 (yearly)
--                 (§13.1 item 27); 7099's `partnership_opportunity` and `partnership_agreement`
--                 schemes and 0099's `mou` are taken out while nothing was numbered with them
--   approval      partnership.agreement version 1, as DEFAULTS in shared/workflow/definitions.js
--                 (validateDefinition() passes): the Head of Department of the deal owner's
--                 department, then the CEO, 72 hours each
--   capabilities  partnerships.configure (Implementation, Operations & People) and
--                 partnerships.money (Operations & People, Management, Implementation); General
--                 Management hold partnerships.money through their department, in code
--                 (GENERAL_MANAGEMENT_CAPABILITIES), and the CEO holds every capability
--
-- Rows a person edits later (numbering, the approval, who holds a capability) are inserted only when
-- absent (docs/MIGRATIONS.md §9).
-- UP
INSERT INTO reference_value (domain, code, label, display_order)
VALUES
  ('deal_health', 'on_track', 'On Track', 10),
  ('deal_health', 'follow_up_required', 'Follow-up Required', 20),
  ('deal_health', 'stalled', 'Stalled', 30)
ON CONFLICT (domain, code) DO NOTHING;

-- The guide's order: call, meeting, email, visit, note.
INSERT INTO reference_value (domain, code, label, display_order)
VALUES
  ('interaction_type', 'call', 'Call', 10),
  ('interaction_type', 'meeting', 'Meeting', 20),
  ('interaction_type', 'email', 'Email', 30),
  ('interaction_type', 'visit', 'Visit', 40),
  ('interaction_type', 'note', 'Note', 50)
ON CONFLICT (domain, code) DO UPDATE SET display_order = EXCLUDED.display_order, active = true;

UPDATE reference_value SET active = false
 WHERE domain = 'partner_type' AND code IN ('government', 'corporate', 'ngo', 'vendor') AND active;
UPDATE reference_value SET active = false
 WHERE domain = 'partnership_stage' AND code IN ('lead', 'qualified', 'proposal', 'negotiation', 'agreement', 'active', 'closed')
   AND active AND metadata = '{}'::jsonb;

INSERT INTO numbering_scheme (doc_type, prefix, padding, separator, reset, include_period)
VALUES
  ('partner', 'PAR', 4, '-', 'never', false),
  ('lead', 'LED', 4, '-', 'never', false),
  ('deal', 'DEAL', 4, '-', 'yearly', true),
  ('proposal', 'PRO', 4, '-', 'never', false),
  ('agreement', 'AGR', 4, '-', 'yearly', true)
ON CONFLICT (doc_type) DO NOTHING;

-- 7099's `partnership_opportunity` and `partnership_agreement` schemes and 0099's `mou` are unused: a
-- deal is numbered `deal`, an agreement `agreement`, and an MOU is an agreement.
-- DESTRUCTIVE: three unused numbering_scheme rows, each only while nothing was numbered with it.
DELETE FROM numbering_scheme s
 WHERE s.doc_type IN ('partnership_opportunity', 'partnership_agreement', 'mou')
   AND NOT EXISTS (SELECT 1 FROM numbering_counter nc WHERE nc.doc_type = s.doc_type);

INSERT INTO workflow_definition (key, version, module_key, name, description, context_types, stages, active)
VALUES (
  'partnership.agreement', 1, 'partnerships', 'Partner Agreement',
  'The Head of Department of the deal owner''s department, then the CEO.',
  '{"value":"money","commission_pct":"number","commission_deviates":"boolean","kind":"text","partner_category_id":"uuid","owner_department_id":"uuid","department_head_employee_id":"uuid"}'::jsonb,
  '[{"key":"head_of_department","name":"Head of Department","approver":{"type":"employee_in_context","value":"department_head_employee_id"},"sla_hours":72},{"key":"ceo","name":"CEO","approver":{"type":"ceo"},"sla_hours":72}]'::jsonb,
  true
)
ON CONFLICT (key, version) DO NOTHING;

INSERT INTO capability (code, name, description)
VALUES
  ('partnerships.configure', 'Configure Partnerships',
   'Set up the partnership categories with their agreement templates, delivery checklists and custom fields, the pipeline''s stages and lists, the proof points and the saved proposal templates.'),
  ('partnerships.money', 'See Commission and Returns',
   'See and enter commission, the merchant''s take and returns, and import returns.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_capability (role_id, capability_id)
SELECT r.role_id, c.capability_id
  FROM role r
  CROSS JOIN capability c
 WHERE (c.code = 'partnerships.configure' AND r.code IN ('implementation', 'operations_people'))
    OR (c.code = 'partnerships.money' AND r.code IN ('implementation', 'operations_people', 'management'))
ON CONFLICT (role_id, capability_id) DO NOTHING;

-- DOWN
DELETE FROM role_capability rc
 USING role r, capability c
 WHERE r.role_id = rc.role_id
   AND c.capability_id = rc.capability_id
   AND rc.granted_by IS NULL
   AND ((c.code = 'partnerships.configure' AND r.code IN ('implementation', 'operations_people'))
     OR (c.code = 'partnerships.money' AND r.code IN ('implementation', 'operations_people', 'management')));
-- A capability someone has since given to a person or another role stays.
DELETE FROM capability c
 WHERE c.code IN ('partnerships.configure', 'partnerships.money')
   AND NOT EXISTS (SELECT 1 FROM user_capability uc WHERE uc.capability_id = c.capability_id)
   AND NOT EXISTS (SELECT 1 FROM role_capability rc WHERE rc.capability_id = c.capability_id);
-- Version 1 only, and only while no agreement was submitted on it.
DELETE FROM workflow_definition d
 WHERE d.key = 'partnership.agreement' AND d.version = 1
   AND NOT EXISTS (SELECT 1 FROM workflow_instance i WHERE i.workflow_definition_id = d.workflow_definition_id);
-- The schemes taken out are not put back: nothing numbers with them. The kept rows (partner,
-- proposal) are 7099's and 0099's.
DELETE FROM numbering_scheme s
 WHERE s.doc_type IN ('lead', 'deal', 'agreement')
   AND NOT EXISTS (SELECT 1 FROM numbering_counter nc WHERE nc.doc_type = s.doc_type);
UPDATE reference_value SET active = true
 WHERE domain = 'partnership_stage' AND code IN ('lead', 'qualified', 'proposal', 'negotiation', 'agreement', 'active', 'closed')
   AND NOT active;
UPDATE reference_value SET active = true
 WHERE domain = 'partner_type' AND code IN ('government', 'corporate', 'ngo', 'vendor') AND NOT active;
DELETE FROM reference_value WHERE domain = 'interaction_type' AND code = 'visit';
UPDATE reference_value SET display_order = CASE code WHEN 'email' THEN 10 WHEN 'call' THEN 20 WHEN 'meeting' THEN 30 WHEN 'note' THEN 40 END
 WHERE domain = 'interaction_type' AND code IN ('email', 'call', 'meeting', 'note');
DELETE FROM reference_value WHERE domain = 'deal_health' AND code IN ('on_track', 'follow_up_required', 'stalled');
