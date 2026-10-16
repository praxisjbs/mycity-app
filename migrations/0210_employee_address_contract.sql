-- M0 employee: a home address and, for contract staff, the day the contract ends.
--
-- ESS My Profile shows and edits the address (docs/guides/ess.md §10), and field masking already
-- treats home_address as personal data (src/shared/rbac/field-mask.js, employee.personal). A
-- consultant or contractor is engaged for a fixed term; contract_ends_on records it, and is
-- indexed because the contracts ending soon are a list People will read. Both are optional:
-- create-admin and the Users invitation write them when they are known.
-- UP
ALTER TABLE employee ADD COLUMN IF NOT EXISTS home_address text;
ALTER TABLE employee ADD COLUMN IF NOT EXISTS contract_ends_on date;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_contract_ends_check') THEN
    ALTER TABLE employee ADD CONSTRAINT employee_contract_ends_check
      CHECK (contract_ends_on IS NULL OR contract_ends_on >= start_date);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS employee_contract_ends_idx ON employee (contract_ends_on) WHERE contract_ends_on IS NOT NULL;

-- DOWN
DROP INDEX IF EXISTS employee_contract_ends_idx;
ALTER TABLE employee DROP CONSTRAINT IF EXISTS employee_contract_ends_check;
ALTER TABLE employee DROP COLUMN IF EXISTS contract_ends_on;
ALTER TABLE employee DROP COLUMN IF EXISTS home_address;
