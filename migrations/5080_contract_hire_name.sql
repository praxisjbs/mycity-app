-- M5 employment contracts: the hire's name as the contract was generated with it, so what a signature covers (its content hash) never changes when the employee record is renamed later.
-- UP
ALTER TABLE employment_contract ADD COLUMN IF NOT EXISTS hire_name text;
-- The contracts already made take the name their employee holds now, the one they were made with.
UPDATE employment_contract ct
   SET hire_name = btrim(e.first_name || ' ' || e.last_name)
  FROM employee e
 WHERE e.employee_id = ct.employee_id AND ct.hire_name IS NULL;

-- DOWN
ALTER TABLE employment_contract DROP COLUMN IF EXISTS hire_name;
