-- M5: MyCity's New Joiner list and its Your First 30 Days plan, the checklist and default onboarding plan a new database starts from. A26 allows it: Send Offer refuses an empty checklist, so the code cannot run without one (AJ, 11/11/2026; MILESTONES §10). Both stay MyCity's to edit on the Checklist and Plans settings, and nothing here writes over an edit.
-- UP
INSERT INTO document_requirement (code, name, description, kind, required, expires, display_order)
VALUES
  ('proof_of_address', 'Proof of Residential Address', 'A recent utility bill or tenancy agreement.', 'file', true, false, 10),
  ('valid_id', 'Valid ID', 'National ID, international passport, driving licence or voter''s card.', 'file', true, true, 20),
  ('certificates', 'Educational and Professional Certificates', 'With your NYSC certificate or exemption letter.', 'file', true, false, 30),
  ('evidence_of_separation', 'Evidence of Separation', 'From your last employer: a resignation acceptance or release letter.', 'file', true, false, 40),
  ('birth_certificate', 'Birth Certificate', NULL, 'file', true, false, 50),
  ('employee_data_form', 'Employee Data Form', 'The form from Operations & People, filled and signed.', 'file', true, false, 60),
  ('mylagosapp_wallet_id', 'MyLagosApp Wallet ID', NULL, 'number', true, false, 70),
  ('passport_photo', 'Passport Photograph', NULL, 'file', true, false, 80),
  ('account_opening_form', 'Account Opening Form', 'The salary account form, filled and signed.', 'file', true, false, 90)
ON CONFLICT (code) DO NOTHING;

INSERT INTO onboarding_plan (department_id, name)
SELECT NULL, 'Your First 30 Days'
 WHERE NOT EXISTS (SELECT 1 FROM onboarding_plan WHERE department_id IS NULL)
ON CONFLICT DO NOTHING;

-- Slide 26 of the HR Induction deck; the induction session is the first step of Week 1. Added only
-- while the default plan has no steps, so a plan MyCity has edited keeps its own.
INSERT INTO onboarding_plan_step (onboarding_plan_id, position, title, description, owner_role, due_offset_days)
SELECT p.onboarding_plan_id, s.position, s.title, s.description, s.owner_role, s.due_offset_days
  FROM onboarding_plan p
 CROSS JOIN (VALUES
   (1, 'HR Induction', 'The induction session with Operations & People.', 'case_owner', 0),
   (2, 'Week 1', 'Understand the business, your team, your role, tools, trackers and key stakeholders.', 'line_manager', 7),
   (3, 'Weeks 2 to 3', 'Start owning deliverables, ask questions, build relationships, and learn the customer and city context.', 'line_manager', 21),
   (4, 'Week 4', 'Demonstrate delivery, review early wins and gaps, and align priorities with your manager for the next 60 to 90 days.', 'line_manager', 30)
 ) AS s (position, title, description, owner_role, due_offset_days)
 WHERE p.department_id IS NULL
   AND p.name = 'Your First 30 Days'
   AND NOT EXISTS (SELECT 1 FROM onboarding_plan_step x WHERE x.onboarding_plan_id = p.onboarding_plan_id)
ON CONFLICT (onboarding_plan_id, position) DO NOTHING;

-- DOWN
-- Only what UP inserted, by its natural key: the default plan while nobody has saved it on the Plans
-- settings (its steps go with it), and the requirements no hire's checklist has used.
DELETE FROM onboarding_plan
 WHERE department_id IS NULL AND name = 'Your First 30 Days' AND updated_by IS NULL AND updated_at = created_at;
DELETE FROM document_requirement r
 WHERE r.code IN ('proof_of_address', 'valid_id', 'certificates', 'evidence_of_separation', 'birth_certificate',
                  'employee_data_form', 'mylagosapp_wallet_id', 'passport_photo', 'account_opening_form')
   AND NOT EXISTS (SELECT 1 FROM onboarding_checklist_item i WHERE i.document_requirement_id = r.document_requirement_id);
