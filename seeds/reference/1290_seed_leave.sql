-- M1 leave reference data: the statuses the code uses, and the leave types every database starts with.
--
-- Statuses: the contract's four (packages/contract/schemas/leave.js). 1099 listed 'draft', which
-- nothing writes (1200 makes 'submitted' the default and checks the four), and had no 'cancelled'.
-- A code list equals the code (docs/MIGRATIONS.md §7.6): cancelled is added, and draft is switched
-- off rather than deleted.
--
-- Leave types: Annual (20 working days a year), Compassionate (5), Sick (12) and Unpaid (no
-- allowance), the four the Request Leave form offers (docs/guides/ess.md §10). Which types MyCity
-- offers is a business choice, which A26 keeps out of reference seeds; the team lead decided on
-- 17/10/2026 that these four are seeded and People add, change, retire or delete the rest on People ·
-- Leave (docs/DATABASE_SCHEMA.md §4). People will edit these rows, so they are inserted with DO
-- NOTHING (docs/MIGRATIONS.md §9): a re-run never writes over a change made on the screen.
-- UP
INSERT INTO reference_value (domain, code, label, display_order)
VALUES ('leave_status', 'cancelled', 'Cancelled', 50)
ON CONFLICT (domain, code) DO UPDATE SET label = EXCLUDED.label, display_order = EXCLUDED.display_order, active = true;

UPDATE reference_value SET active = false WHERE domain = 'leave_status' AND code = 'draft';

INSERT INTO leave_type (code, name, unit, policy)
VALUES
  ('annual', 'Annual', 'days', '{"days_per_year": 20}'::jsonb),
  ('compassionate', 'Compassionate', 'days', '{"days_per_year": 5}'::jsonb),
  ('sick', 'Sick', 'days', '{"days_per_year": 12}'::jsonb),
  ('unpaid', 'Unpaid', 'days', '{"days_per_year": null}'::jsonb)
ON CONFLICT (code) DO NOTHING;

-- DOWN
-- The four types only while nothing uses them: a request or a balance keeps its type.
DELETE FROM leave_type t
 WHERE t.code IN ('annual', 'compassionate', 'sick', 'unpaid')
   AND NOT EXISTS (SELECT 1 FROM leave_request r WHERE r.leave_type_id = t.leave_type_id)
   AND NOT EXISTS (SELECT 1 FROM leave_balance b WHERE b.leave_type_id = t.leave_type_id);
UPDATE reference_value SET active = true WHERE domain = 'leave_status' AND code = 'draft';
DELETE FROM reference_value WHERE domain = 'leave_status' AND code = 'cancelled';
