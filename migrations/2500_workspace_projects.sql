-- M2 My Workspace: projects get a screen (docs/guides/workspace.md §4, §6 Projects; JBS Praxis, 23/10/2026).
--
-- The `project` table came with the 2000 schema, unused. A project now records who started it, its
-- status is checked against the contract's (`active`, `completed`), and its links are indexed for the
-- list and for scope. `department_id` and `starts_on` stay unused.

-- UP
ALTER TABLE project ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES app_user(user_id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_status_check') THEN
    ALTER TABLE project ADD CONSTRAINT project_status_check CHECK (status IN ('active', 'completed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS project_owner_fk_idx ON project (owner_employee_id);
CREATE INDEX IF NOT EXISTS project_department_fk_idx ON project (department_id);
CREATE INDEX IF NOT EXISTS project_created_by_fk_idx ON project (created_by);
CREATE INDEX IF NOT EXISTS project_status_created_idx ON project (status, created_at DESC);

-- DOWN
DROP INDEX IF EXISTS project_status_created_idx;
DROP INDEX IF EXISTS project_created_by_fk_idx;
DROP INDEX IF EXISTS project_department_fk_idx;
DROP INDEX IF EXISTS project_owner_fk_idx;
ALTER TABLE project DROP CONSTRAINT IF EXISTS project_status_check;
ALTER TABLE project DROP COLUMN IF EXISTS created_by; -- DESTRUCTIVE: rollback only; drops what UP added
