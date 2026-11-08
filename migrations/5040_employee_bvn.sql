-- M5: the hire's Bank Verification Number on the employee record, restricted under employee.bank (TB reviews: organisation's table).
-- UP
ALTER TABLE employee ADD COLUMN IF NOT EXISTS bvn text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_bvn_check') THEN
    ALTER TABLE employee ADD CONSTRAINT employee_bvn_check CHECK (bvn IS NULL OR bvn ~ '^[0-9]{11}$');
  END IF;
END $$;

-- DOWN
ALTER TABLE employee DROP CONSTRAINT IF EXISTS employee_bvn_check;
ALTER TABLE employee DROP COLUMN IF EXISTS bvn;
