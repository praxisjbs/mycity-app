-- M2 the goal cascade (A16): goal levels and numbers, the quarterly cascade, a department's month approved as one, and the individual monthly KPI.
-- UP

-- A department's month: its targets and its people's KPIs, submitted and approved together
-- (docs/guides/performance.md §3 step 5). `month` is the first day of the month.
CREATE TABLE IF NOT EXISTS performance_plan (
  performance_plan_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES department(department_id) ON DELETE RESTRICT,
  month date NOT NULL CHECK (extract(day FROM month) = 1),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending_approval', 'active', 'returned')),
  submitted_by uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  submitted_at timestamptz,
  workflow_instance_id uuid REFERENCES workflow_instance(workflow_instance_id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (department_id, month)
);
CREATE INDEX IF NOT EXISTS performance_plan_month_idx ON performance_plan (month, status);
CREATE INDEX IF NOT EXISTS performance_plan_submitted_by_fk_idx ON performance_plan (submitted_by);
CREATE INDEX IF NOT EXISTS performance_plan_workflow_fk_idx ON performance_plan (workflow_instance_id);
CREATE OR REPLACE TRIGGER performance_plan_set_updated_at BEFORE UPDATE ON performance_plan
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A goal: its number, the organisational goal's fields, and the plan a departmental target belongs to.
-- `code` is filled by numbering for every level (OG, AG, MG, DT); nullable only for rows written
-- before this file.
ALTER TABLE organisational_goal ADD COLUMN IF NOT EXISTS code citext;
ALTER TABLE organisational_goal ADD COLUMN IF NOT EXISTS strategic_theme text;
ALTER TABLE organisational_goal ADD COLUMN IF NOT EXISTS success_measure text;
ALTER TABLE organisational_goal ADD COLUMN IF NOT EXISTS baseline text;
ALTER TABLE organisational_goal ADD COLUMN IF NOT EXISTS performance_plan_id uuid
  REFERENCES performance_plan(performance_plan_id) ON DELETE SET NULL;

-- The levels as A16 sets them replace 2000's list. Relaxing and replacing a check, not destructive.
ALTER TABLE organisational_goal DROP CONSTRAINT IF EXISTS organisational_goal_level_check;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organisational_goal_cascade_level_check') THEN
    ALTER TABLE organisational_goal ADD CONSTRAINT organisational_goal_cascade_level_check
      CHECK (level IN ('organisation', 'annual', 'monthly', 'department'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organisational_goal_status_check') THEN
    ALTER TABLE organisational_goal ADD CONSTRAINT organisational_goal_status_check
      CHECK (status IN ('draft', 'pending_approval', 'active', 'returned', 'completed', 'cancelled'));
  END IF;
  -- A departmental target names its department; an organisational goal has no parent.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organisational_goal_department_check') THEN
    ALTER TABLE organisational_goal ADD CONSTRAINT organisational_goal_department_check
      CHECK (level <> 'department' OR department_id IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organisational_goal_parent_check') THEN
    ALTER TABLE organisational_goal ADD CONSTRAINT organisational_goal_parent_check
      CHECK (level <> 'organisation' OR parent_goal_id IS NULL);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS organisational_goal_code_uq ON organisational_goal (code) WHERE code IS NOT NULL;
CREATE INDEX IF NOT EXISTS organisational_goal_parent_fk_idx ON organisational_goal (parent_goal_id);
CREATE INDEX IF NOT EXISTS organisational_goal_department_fk_idx ON organisational_goal (department_id);
CREATE INDEX IF NOT EXISTS organisational_goal_employee_fk_idx ON organisational_goal (employee_id);
CREATE INDEX IF NOT EXISTS organisational_goal_owner_fk_idx ON organisational_goal (owner_employee_id);
CREATE INDEX IF NOT EXISTS organisational_goal_workflow_fk_idx ON organisational_goal (workflow_instance_id);
CREATE INDEX IF NOT EXISTS organisational_goal_plan_fk_idx ON organisational_goal (performance_plan_id);
-- Asked by Home (home.md §4.1): a level's goals live in a period.
CREATE INDEX IF NOT EXISTS organisational_goal_level_period_idx ON organisational_goal (level, starts_on, ends_on);

-- What an organisational or annual goal should reach each quarter.
CREATE TABLE IF NOT EXISTS organisational_goal_quarter (
  organisational_goal_quarter_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisational_goal_id uuid NOT NULL REFERENCES organisational_goal(organisational_goal_id) ON DELETE CASCADE,
  quarter smallint NOT NULL CHECK (quarter BETWEEN 1 AND 4),
  milestone text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisational_goal_id, quarter)
);
CREATE OR REPLACE TRIGGER organisational_goal_quarter_set_updated_at BEFORE UPDATE ON organisational_goal_quarter
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- The individual monthly KPI: its month, unit and direction, where its progress comes from, who
-- set it and the plan that approves it. `month` is nullable only for rows written before this file.
ALTER TABLE employee_target ADD COLUMN IF NOT EXISTS month date;
ALTER TABLE employee_target ADD COLUMN IF NOT EXISTS unit text;
ALTER TABLE employee_target ADD COLUMN IF NOT EXISTS direction text NOT NULL DEFAULT 'higher';
ALTER TABLE employee_target ADD COLUMN IF NOT EXISTS progress_source text NOT NULL DEFAULT 'manual';
ALTER TABLE employee_target ADD COLUMN IF NOT EXISTS set_by_employee_id uuid
  REFERENCES employee(employee_id) ON DELETE RESTRICT;
ALTER TABLE employee_target ADD COLUMN IF NOT EXISTS performance_plan_id uuid
  REFERENCES performance_plan(performance_plan_id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_target_status_check') THEN
    ALTER TABLE employee_target ADD CONSTRAINT employee_target_status_check
      CHECK (status IN ('draft', 'pending_approval', 'active', 'returned', 'completed', 'cancelled', 'met'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_target_direction_check') THEN
    ALTER TABLE employee_target ADD CONSTRAINT employee_target_direction_check
      CHECK (direction IN ('higher', 'lower'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_target_progress_source_check') THEN
    ALTER TABLE employee_target ADD CONSTRAINT employee_target_progress_source_check
      CHECK (progress_source IN ('manual', 'tasks'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_target_month_check') THEN
    ALTER TABLE employee_target ADD CONSTRAINT employee_target_month_check
      CHECK (month IS NULL OR extract(day FROM month) = 1);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS employee_target_goal_fk_idx ON employee_target (organisational_goal_id);
CREATE INDEX IF NOT EXISTS employee_target_kpi_definition_fk_idx ON employee_target (kpi_definition_id);
CREATE INDEX IF NOT EXISTS employee_target_employee_month_idx ON employee_target (employee_id, month);
CREATE INDEX IF NOT EXISTS employee_target_set_by_fk_idx ON employee_target (set_by_employee_id);
CREATE INDEX IF NOT EXISTS employee_target_plan_fk_idx ON employee_target (performance_plan_id);
CREATE INDEX IF NOT EXISTS employee_target_approved_by_fk_idx ON employee_target (approved_by);
-- Asked by Home (home.md §4.1): a person's targets due in a period.
CREATE INDEX IF NOT EXISTS employee_target_employee_due_idx ON employee_target (employee_id, due_on);

-- DOWN
DROP INDEX IF EXISTS employee_target_employee_due_idx;
DROP INDEX IF EXISTS employee_target_approved_by_fk_idx;
DROP INDEX IF EXISTS employee_target_plan_fk_idx;
DROP INDEX IF EXISTS employee_target_set_by_fk_idx;
DROP INDEX IF EXISTS employee_target_employee_month_idx;
DROP INDEX IF EXISTS employee_target_kpi_definition_fk_idx;
DROP INDEX IF EXISTS employee_target_goal_fk_idx;
ALTER TABLE employee_target DROP CONSTRAINT IF EXISTS employee_target_month_check;
ALTER TABLE employee_target DROP CONSTRAINT IF EXISTS employee_target_progress_source_check;
ALTER TABLE employee_target DROP CONSTRAINT IF EXISTS employee_target_direction_check;
ALTER TABLE employee_target DROP CONSTRAINT IF EXISTS employee_target_status_check;
ALTER TABLE employee_target DROP COLUMN IF EXISTS performance_plan_id; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE employee_target DROP COLUMN IF EXISTS set_by_employee_id; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE employee_target DROP COLUMN IF EXISTS progress_source; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE employee_target DROP COLUMN IF EXISTS direction; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE employee_target DROP COLUMN IF EXISTS unit; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE employee_target DROP COLUMN IF EXISTS month; -- DESTRUCTIVE: rollback only; drops what UP added
DROP TRIGGER IF EXISTS organisational_goal_quarter_set_updated_at ON organisational_goal_quarter;
DROP TABLE IF EXISTS organisational_goal_quarter;
DROP INDEX IF EXISTS organisational_goal_level_period_idx;
DROP INDEX IF EXISTS organisational_goal_plan_fk_idx;
DROP INDEX IF EXISTS organisational_goal_workflow_fk_idx;
DROP INDEX IF EXISTS organisational_goal_owner_fk_idx;
DROP INDEX IF EXISTS organisational_goal_employee_fk_idx;
DROP INDEX IF EXISTS organisational_goal_department_fk_idx;
DROP INDEX IF EXISTS organisational_goal_parent_fk_idx;
DROP INDEX IF EXISTS organisational_goal_code_uq;
ALTER TABLE organisational_goal DROP CONSTRAINT IF EXISTS organisational_goal_parent_check;
ALTER TABLE organisational_goal DROP CONSTRAINT IF EXISTS organisational_goal_department_check;
ALTER TABLE organisational_goal DROP CONSTRAINT IF EXISTS organisational_goal_status_check;
ALTER TABLE organisational_goal DROP CONSTRAINT IF EXISTS organisational_goal_cascade_level_check;
-- 2000's level list comes back; rows at the annual or monthly level would refuse it, so a rollback
-- with goals in them fails here rather than losing them.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organisational_goal_level_check') THEN
    ALTER TABLE organisational_goal ADD CONSTRAINT organisational_goal_level_check
      CHECK (level IN ('organisation', 'department', 'team', 'role', 'individual'));
  END IF;
END $$;
ALTER TABLE organisational_goal DROP COLUMN IF EXISTS performance_plan_id; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE organisational_goal DROP COLUMN IF EXISTS baseline; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE organisational_goal DROP COLUMN IF EXISTS success_measure; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE organisational_goal DROP COLUMN IF EXISTS strategic_theme; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE organisational_goal DROP COLUMN IF EXISTS code; -- DESTRUCTIVE: rollback only; drops what UP added
DROP TRIGGER IF EXISTS performance_plan_set_updated_at ON performance_plan;
DROP INDEX IF EXISTS performance_plan_workflow_fk_idx;
DROP INDEX IF EXISTS performance_plan_submitted_by_fk_idx;
DROP INDEX IF EXISTS performance_plan_month_idx;
DROP TABLE IF EXISTS performance_plan;
