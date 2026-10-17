-- M0 track A: the People register, archiving, and the indexes its list and the org tree read.
--
-- The register (#24), the employee 360, Org Chart (#91) and Organogram (#92) run on these
-- columns (docs/guides/foundation.md §4, §6.6; docs/guides/organogram.md §4). Three changes:
--
--   1. Archiving. People put a record away rather than delete it: `archived` joins the status
--      check, with the day it happened and the reason. The record keeps its history and its
--      documents, leaves every list and the tree, and comes back with Restore.
--   2. start_date is no longer NOT NULL. MyCity's staff sheet has no joining date for three of
--      its eighteen people (seeds/staff/staff-list.xlsx, 16/10/2026), and a joining date that
--      is wrong is worse than one that is absent: it would drive probation, tenure and leave
--      accrual. Add Employee on screen still asks for one (EmployeeCreate keeps it required);
--      the importer leaves it empty and People fill it in. Relaxing a constraint is not
--      destructive (docs/MIGRATIONS.md §8).
--   3. The indexes every allow-listed sort and filter of EmployeeListQuery needs, and one
--      trigram index for the name and title search behind ⌘K and the list's own search box.
-- UP
ALTER TABLE employee ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE employee ADD COLUMN IF NOT EXISTS archive_reason text;

ALTER TABLE employee ALTER COLUMN start_date DROP NOT NULL;

DO $$
BEGIN
  ALTER TABLE employee DROP CONSTRAINT IF EXISTS employee_status_check;
  ALTER TABLE employee ADD CONSTRAINT employee_status_check
    CHECK (status IN ('active', 'suspended', 'left', 'archived'));
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_archived_check') THEN
    ALTER TABLE employee ADD CONSTRAINT employee_archived_check
      CHECK ((status = 'archived') = (archived_at IS NOT NULL));
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS employee_name_idx ON employee (last_name, first_name);
CREATE INDEX IF NOT EXISTS employee_status_idx ON employee (status);
CREATE INDEX IF NOT EXISTS employee_job_title_idx ON employee (job_title);
CREATE INDEX IF NOT EXISTS employee_work_pattern_idx ON employee (work_pattern);
CREATE INDEX IF NOT EXISTS employee_employment_type_idx ON employee (employment_type);
CREATE INDEX IF NOT EXISTS employee_start_date_idx ON employee (start_date);
CREATE INDEX IF NOT EXISTS employee_created_at_idx ON employee (created_at);
CREATE INDEX IF NOT EXISTS employee_confirmation_due_idx ON employee (confirmation_due_on)
  WHERE confirmation_due_on IS NOT NULL AND confirmed_on IS NULL;
CREATE INDEX IF NOT EXISTS employee_search_idx ON employee
  USING gin (search_fold(first_name || ' ' || last_name || ' ' || job_title) gin_trgm_ops);

-- DOWN
DROP INDEX IF EXISTS employee_search_idx;
DROP INDEX IF EXISTS employee_confirmation_due_idx;
DROP INDEX IF EXISTS employee_created_at_idx;
DROP INDEX IF EXISTS employee_start_date_idx;
DROP INDEX IF EXISTS employee_employment_type_idx;
DROP INDEX IF EXISTS employee_work_pattern_idx;
DROP INDEX IF EXISTS employee_job_title_idx;
DROP INDEX IF EXISTS employee_status_idx;
DROP INDEX IF EXISTS employee_name_idx;
ALTER TABLE employee DROP CONSTRAINT IF EXISTS employee_archived_check;
DO $$
BEGIN
  DELETE FROM employee WHERE status = 'archived';
  UPDATE employee SET start_date = created_at::date WHERE start_date IS NULL;
  ALTER TABLE employee DROP CONSTRAINT IF EXISTS employee_status_check;
  ALTER TABLE employee ADD CONSTRAINT employee_status_check
    CHECK (status IN ('active', 'suspended', 'left'));
  ALTER TABLE employee ALTER COLUMN start_date SET NOT NULL;
END;
$$;
ALTER TABLE employee DROP COLUMN IF EXISTS archive_reason;
ALTER TABLE employee DROP COLUMN IF EXISTS archived_at;
