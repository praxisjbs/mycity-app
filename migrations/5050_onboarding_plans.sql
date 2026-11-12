-- M5 onboarding plans: a department's steps (and the company's default plan, no department), and the steps copied onto a hire's case when it reaches onboarding.
-- UP
CREATE TABLE IF NOT EXISTS onboarding_plan (
  onboarding_plan_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid REFERENCES department(department_id) ON DELETE CASCADE,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  updated_by uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE TRIGGER onboarding_plan_set_updated_at BEFORE UPDATE ON onboarding_plan
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- One plan a department, and one default plan with no department.
CREATE UNIQUE INDEX IF NOT EXISTS onboarding_plan_department_key ON onboarding_plan (department_id)
  WHERE department_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS onboarding_plan_default_key ON onboarding_plan ((department_id IS NULL))
  WHERE department_id IS NULL;
CREATE INDEX IF NOT EXISTS onboarding_plan_created_by_idx ON onboarding_plan (created_by);
CREATE INDEX IF NOT EXISTS onboarding_plan_updated_by_idx ON onboarding_plan (updated_by);

-- A plan's steps. The owner is a role, named as a person when the steps are copied onto a case.
-- sop_id is M10's sop (migration 10400, which runs after this block): the service checks it, so
-- it has no foreign key here.
CREATE TABLE IF NOT EXISTS onboarding_plan_step (
  onboarding_plan_step_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  onboarding_plan_id uuid NOT NULL REFERENCES onboarding_plan(onboarding_plan_id) ON DELETE CASCADE,
  position smallint NOT NULL CHECK (position >= 1),
  title text NOT NULL,
  description text,
  owner_role text NOT NULL CHECK (owner_role IN ('case_owner', 'line_manager', 'head_of_department', 'hire')),
  due_offset_days smallint NOT NULL DEFAULT 0 CHECK (due_offset_days BETWEEN 0 AND 365),
  sop_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (onboarding_plan_id, position)
);
CREATE OR REPLACE TRIGGER onboarding_plan_step_set_updated_at BEFORE UPDATE ON onboarding_plan_step
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS onboarding_plan_step_sop_idx ON onboarding_plan_step (sop_id);

-- The steps a hire's case works through, copied from the plan with the owner and due day resolved.
CREATE TABLE IF NOT EXISTS onboarding_case_step (
  onboarding_case_step_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  onboarding_case_id uuid NOT NULL REFERENCES onboarding_case(onboarding_case_id) ON DELETE CASCADE,
  onboarding_plan_step_id uuid REFERENCES onboarding_plan_step(onboarding_plan_step_id) ON DELETE SET NULL,
  position smallint NOT NULL CHECK (position >= 1),
  title text NOT NULL,
  description text,
  owner_role text NOT NULL CHECK (owner_role IN ('case_owner', 'line_manager', 'head_of_department', 'hire')),
  owner_id uuid REFERENCES employee(employee_id) ON DELETE SET NULL,
  due_on date,
  sop_id uuid,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done')),
  done_by uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  done_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (onboarding_case_id, position),
  CHECK ((status = 'done') = (done_at IS NOT NULL))
);
CREATE OR REPLACE TRIGGER onboarding_case_step_set_updated_at BEFORE UPDATE ON onboarding_case_step
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS onboarding_case_step_plan_step_idx ON onboarding_case_step (onboarding_plan_step_id);
CREATE INDEX IF NOT EXISTS onboarding_case_step_owner_idx ON onboarding_case_step (owner_id);
CREATE INDEX IF NOT EXISTS onboarding_case_step_done_by_idx ON onboarding_case_step (done_by);
CREATE INDEX IF NOT EXISTS onboarding_case_step_sop_idx ON onboarding_case_step (sop_id);
CREATE INDEX IF NOT EXISTS onboarding_case_step_due_idx ON onboarding_case_step (due_on) WHERE status = 'pending';

-- DOWN
DROP INDEX IF EXISTS onboarding_case_step_due_idx;
DROP INDEX IF EXISTS onboarding_case_step_sop_idx;
DROP INDEX IF EXISTS onboarding_case_step_done_by_idx;
DROP INDEX IF EXISTS onboarding_case_step_owner_idx;
DROP INDEX IF EXISTS onboarding_case_step_plan_step_idx;
DROP TRIGGER IF EXISTS onboarding_case_step_set_updated_at ON onboarding_case_step;
DROP TABLE IF EXISTS onboarding_case_step;
DROP INDEX IF EXISTS onboarding_plan_step_sop_idx;
DROP TRIGGER IF EXISTS onboarding_plan_step_set_updated_at ON onboarding_plan_step;
DROP TABLE IF EXISTS onboarding_plan_step;
DROP INDEX IF EXISTS onboarding_plan_updated_by_idx;
DROP INDEX IF EXISTS onboarding_plan_created_by_idx;
DROP INDEX IF EXISTS onboarding_plan_default_key;
DROP INDEX IF EXISTS onboarding_plan_department_key;
DROP TRIGGER IF EXISTS onboarding_plan_set_updated_at ON onboarding_plan;
DROP TABLE IF EXISTS onboarding_plan;
