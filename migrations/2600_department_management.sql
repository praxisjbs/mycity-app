-- M2 departments kept on People · Departments: where a merged department went, and which Head of Department roles the system gave with a headship (docs/guides/organogram.md §6.1).
-- UP
ALTER TABLE department ADD COLUMN IF NOT EXISTS merged_into_department_id uuid REFERENCES department(department_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS department_merged_into_fk_idx ON department (merged_into_department_id);

-- True on a role the system gave because the person heads a department or acts for its open head
-- role; only such a row is taken back when they stop. A role given by hand stays false.
ALTER TABLE user_role ADD COLUMN IF NOT EXISTS from_headship boolean NOT NULL DEFAULT false;

-- DOWN
ALTER TABLE user_role DROP COLUMN IF EXISTS from_headship; -- DESTRUCTIVE: rollback only; drops what UP added
DROP INDEX IF EXISTS department_merged_into_fk_idx;
ALTER TABLE department DROP COLUMN IF EXISTS merged_into_department_id; -- DESTRUCTIVE: rollback only; drops what UP added
