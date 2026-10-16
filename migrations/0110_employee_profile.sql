-- M0 employee: the columns the contract, the staff importer and field masking name, and vacant seats.
--
-- The contract (packages/contract/schemas/organisation.js), the staff importer (BACKEND_STRUCTURE
-- §9.4), create-admin and shared/rbac/field-mask.js all name these fields. 0040 kept them in the
-- profile blob, where field masking, checks and money handling cannot reach them. MyCity's staff
-- list (16/10/2026) has every one of them, plus gender, dotted reporting lines and vacant posts
-- that have reports of their own (docs/guides/organogram.md §4, §6).
--
-- DESTRUCTIVE: employee.number is renamed staff_number, the key every caller uses. No release has
-- written employee rows yet, so nothing reads the old name.
-- UP
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employee' AND column_name = 'number')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employee' AND column_name = 'staff_number') THEN
    ALTER TABLE employee RENAME COLUMN number TO staff_number;
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS org_seat (
  org_seat_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  department_id uuid NOT NULL REFERENCES department(department_id) ON DELETE RESTRICT,
  line_manager_id uuid REFERENCES employee(employee_id) ON DELETE SET NULL,
  line_manager_seat_id uuid REFERENCES org_seat(org_seat_id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'vacant' CHECK (status IN ('vacant', 'filled', 'closed')),
  filled_by_employee_id uuid REFERENCES employee(employee_id) ON DELETE SET NULL,
  filled_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (line_manager_id IS NULL OR line_manager_seat_id IS NULL),
  CHECK (line_manager_seat_id IS NULL OR line_manager_seat_id <> org_seat_id),
  CHECK ((status = 'filled') = (filled_by_employee_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS org_seat_department_idx ON org_seat (department_id);
CREATE INDEX IF NOT EXISTS org_seat_line_manager_idx ON org_seat (line_manager_id);
CREATE INDEX IF NOT EXISTS org_seat_line_manager_seat_idx ON org_seat (line_manager_seat_id);
CREATE INDEX IF NOT EXISTS org_seat_filled_by_idx ON org_seat (filled_by_employee_id);
CREATE INDEX IF NOT EXISTS org_seat_vacant_idx ON org_seat (department_id) WHERE status = 'vacant';

CREATE OR REPLACE TRIGGER org_seat_set_updated_at BEFORE UPDATE ON org_seat
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE employee ADD COLUMN IF NOT EXISTS gender text;
ALTER TABLE employee ADD COLUMN IF NOT EXISTS date_of_birth date;
ALTER TABLE employee ADD COLUMN IF NOT EXISTS next_of_kin_name text;
ALTER TABLE employee ADD COLUMN IF NOT EXISTS next_of_kin_phone text;
ALTER TABLE employee ADD COLUMN IF NOT EXISTS next_of_kin_relationship text;
ALTER TABLE employee ADD COLUMN IF NOT EXISTS bank_name text;
ALTER TABLE employee ADD COLUMN IF NOT EXISTS account_number text;
ALTER TABLE employee ADD COLUMN IF NOT EXISTS gross_monthly numeric(18,2);
ALTER TABLE employee ADD COLUMN IF NOT EXISTS dotted_manager_id uuid REFERENCES employee(employee_id) ON DELETE SET NULL;
ALTER TABLE employee ADD COLUMN IF NOT EXISTS line_manager_seat_id uuid REFERENCES org_seat(org_seat_id) ON DELETE SET NULL;
ALTER TABLE employee ADD COLUMN IF NOT EXISTS dotted_manager_seat_id uuid REFERENCES org_seat(org_seat_id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_gender_check') THEN
    ALTER TABLE employee ADD CONSTRAINT employee_gender_check CHECK (gender IS NULL OR gender IN ('female', 'male'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_employment_type_check') THEN
    ALTER TABLE employee ADD CONSTRAINT employee_employment_type_check
      CHECK (employment_type IN ('full_time', 'part_time', 'contractor', 'consultant', 'intern'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_work_pattern_check') THEN
    ALTER TABLE employee ADD CONSTRAINT employee_work_pattern_check CHECK (work_pattern IN ('on_site', 'hybrid', 'remote'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_status_check') THEN
    ALTER TABLE employee ADD CONSTRAINT employee_status_check CHECK (status IN ('active', 'suspended', 'left'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_account_number_check') THEN
    ALTER TABLE employee ADD CONSTRAINT employee_account_number_check CHECK (account_number IS NULL OR account_number ~ '^[0-9]{10}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_gross_monthly_check') THEN
    ALTER TABLE employee ADD CONSTRAINT employee_gross_monthly_check CHECK (gross_monthly IS NULL OR gross_monthly >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_not_own_manager_check') THEN
    ALTER TABLE employee ADD CONSTRAINT employee_not_own_manager_check
      CHECK ((line_manager_id IS NULL OR line_manager_id <> employee_id) AND (dotted_manager_id IS NULL OR dotted_manager_id <> employee_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_one_line_manager_check') THEN
    ALTER TABLE employee ADD CONSTRAINT employee_one_line_manager_check
      CHECK ((line_manager_id IS NULL OR line_manager_seat_id IS NULL) AND (dotted_manager_id IS NULL OR dotted_manager_seat_id IS NULL));
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS employee_dotted_manager_idx ON employee (dotted_manager_id);
CREATE INDEX IF NOT EXISTS employee_line_manager_seat_idx ON employee (line_manager_seat_id);
CREATE INDEX IF NOT EXISTS employee_dotted_manager_seat_idx ON employee (dotted_manager_seat_id);
CREATE INDEX IF NOT EXISTS employee_birthday_idx ON employee (extract(month FROM date_of_birth), extract(day FROM date_of_birth));

-- DOWN
DROP INDEX IF EXISTS employee_birthday_idx;
DROP INDEX IF EXISTS employee_dotted_manager_seat_idx;
DROP INDEX IF EXISTS employee_line_manager_seat_idx;
DROP INDEX IF EXISTS employee_dotted_manager_idx;
ALTER TABLE employee DROP CONSTRAINT IF EXISTS employee_one_line_manager_check;
ALTER TABLE employee DROP CONSTRAINT IF EXISTS employee_not_own_manager_check;
ALTER TABLE employee DROP CONSTRAINT IF EXISTS employee_gross_monthly_check;
ALTER TABLE employee DROP CONSTRAINT IF EXISTS employee_account_number_check;
ALTER TABLE employee DROP CONSTRAINT IF EXISTS employee_status_check;
ALTER TABLE employee DROP CONSTRAINT IF EXISTS employee_work_pattern_check;
ALTER TABLE employee DROP CONSTRAINT IF EXISTS employee_employment_type_check;
ALTER TABLE employee DROP CONSTRAINT IF EXISTS employee_gender_check;
ALTER TABLE employee DROP COLUMN IF EXISTS dotted_manager_seat_id;
ALTER TABLE employee DROP COLUMN IF EXISTS line_manager_seat_id;
ALTER TABLE employee DROP COLUMN IF EXISTS dotted_manager_id;
ALTER TABLE employee DROP COLUMN IF EXISTS gross_monthly;
ALTER TABLE employee DROP COLUMN IF EXISTS account_number;
ALTER TABLE employee DROP COLUMN IF EXISTS bank_name;
ALTER TABLE employee DROP COLUMN IF EXISTS next_of_kin_relationship;
ALTER TABLE employee DROP COLUMN IF EXISTS next_of_kin_phone;
ALTER TABLE employee DROP COLUMN IF EXISTS next_of_kin_name;
ALTER TABLE employee DROP COLUMN IF EXISTS date_of_birth;
ALTER TABLE employee DROP COLUMN IF EXISTS gender;
DROP TRIGGER IF EXISTS org_seat_set_updated_at ON org_seat;
DROP INDEX IF EXISTS org_seat_vacant_idx;
DROP INDEX IF EXISTS org_seat_filled_by_idx;
DROP INDEX IF EXISTS org_seat_line_manager_seat_idx;
DROP INDEX IF EXISTS org_seat_line_manager_idx;
DROP INDEX IF EXISTS org_seat_department_idx;
DROP TABLE IF EXISTS org_seat;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employee' AND column_name = 'staff_number') THEN
    ALTER TABLE employee RENAME COLUMN staff_number TO number;
  END IF;
END;
$$;
