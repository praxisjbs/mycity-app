-- M0 track A: the code list the register switches on.
--
-- A26 (docs/MIGRATIONS.md §9): a reference seed carries only what the code cannot run
-- without. `archived` is an employee status the code and the contract both spell
-- (packages/contract/schemas/organisation.js EMPLOYEE_STATUSES, migration 0300), so the
-- employment_status domain seeded in 0099 gains its row. No people: the real staff load
-- through the import engine from seeds/staff/ (docs/guides/foundation.md §6.1).
-- UP
INSERT INTO reference_value (domain, code, label, display_order)
VALUES ('employment_status', 'archived', 'Archived', 40)
ON CONFLICT (domain, code) DO NOTHING;

-- DOWN
DELETE FROM reference_value WHERE domain = 'employment_status' AND code = 'archived';
