-- M2 Performance foundation: quarters, the OKR tree, KPIs' months, plans, scorecards, rounds, reviews, PIPs, commitments and weekly summaries (docs/guides/performance.md §4).
--
-- Every table the five Performance pull requests write, so the three that run in parallel never need a
-- migration of their own. The 2000 tables Home already reads keep every column they had: this file adds,
-- it never drops (DATABASE_SCHEMA M2). Status checks on the four 2000 tables Home's staging rows fill
-- (organisational_goal, employee_target, performance_cycle, performance_review) come with the pull request
-- that replaces those rows; until then the services validate them through the contract.
-- UP

-- A function's head: a person, or a vacant seat (the person above it acts). Never both.
ALTER TABLE department ADD COLUMN IF NOT EXISTS head_employee_id uuid REFERENCES employee(employee_id) ON DELETE SET NULL;
ALTER TABLE department ADD COLUMN IF NOT EXISTS head_seat_id uuid REFERENCES org_seat(org_seat_id) ON DELETE SET NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'department_head_check') THEN
    ALTER TABLE department ADD CONSTRAINT department_head_check
      CHECK (head_employee_id IS NULL OR head_seat_id IS NULL);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS department_head_employee_fk_idx ON department (head_employee_id);
CREATE INDEX IF NOT EXISTS department_head_seat_fk_idx ON department (head_seat_id);

-- A quarter and the scoring rules it carries (ScoringRules, copied from the last quarter).
CREATE TABLE IF NOT EXISTS performance_period (
  performance_period_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  plan_year_starts_on date NOT NULL,
  targets_lock_on date,
  live_from date,
  status text NOT NULL DEFAULT 'planning' CHECK (status IN ('planning', 'active', 'closed')),
  rules jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (starts_on),
  CHECK (ends_on > starts_on),
  CHECK (plan_year_starts_on <= starts_on)
);
CREATE INDEX IF NOT EXISTS performance_period_status_idx ON performance_period (status, starts_on);
CREATE OR REPLACE TRIGGER performance_period_set_updated_at BEFORE UPDATE ON performance_period
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Organisational goals: the CEO's year, in MyCity's words.
ALTER TABLE organisational_goal ADD COLUMN IF NOT EXISTS code citext;
ALTER TABLE organisational_goal ADD COLUMN IF NOT EXISTS strategic_theme text;
ALTER TABLE organisational_goal ADD COLUMN IF NOT EXISTS detail text;
ALTER TABLE organisational_goal ADD COLUMN IF NOT EXISTS success_measure text;
ALTER TABLE organisational_goal ADD COLUMN IF NOT EXISTS reference_target text;
ALTER TABLE organisational_goal ADD COLUMN IF NOT EXISTS baseline text;
ALTER TABLE organisational_goal ADD COLUMN IF NOT EXISTS key_decisions text;
ALTER TABLE organisational_goal ADD COLUMN IF NOT EXISTS function_cascade text;
ALTER TABLE organisational_goal ADD COLUMN IF NOT EXISTS plan_year_starts_on date;
CREATE UNIQUE INDEX IF NOT EXISTS organisational_goal_code_uq ON organisational_goal (plan_year_starts_on, code)
  WHERE code IS NOT NULL;
-- Asked by Home: Goals This Quarter.
CREATE INDEX IF NOT EXISTS organisational_goal_level_dates_idx ON organisational_goal (level, starts_on, ends_on);
CREATE INDEX IF NOT EXISTS organisational_goal_owner_fk_idx ON organisational_goal (owner_employee_id);
CREATE INDEX IF NOT EXISTS organisational_goal_parent_fk_idx ON organisational_goal (parent_goal_id);
CREATE INDEX IF NOT EXISTS organisational_goal_department_fk_idx ON organisational_goal (department_id);
CREATE INDEX IF NOT EXISTS organisational_goal_employee_fk_idx ON organisational_goal (employee_id);
CREATE INDEX IF NOT EXISTS organisational_goal_workflow_fk_idx ON organisational_goal (workflow_instance_id);

-- What each quarter of the plan year should reach towards a goal.
CREATE TABLE IF NOT EXISTS organisational_goal_target (
  organisational_goal_target_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisational_goal_id uuid NOT NULL REFERENCES organisational_goal(organisational_goal_id) ON DELETE CASCADE,
  performance_period_id uuid NOT NULL REFERENCES performance_period(performance_period_id) ON DELETE RESTRICT,
  target_text text,
  target_value numeric(18,4),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisational_goal_id, performance_period_id)
);
CREATE INDEX IF NOT EXISTS organisational_goal_target_period_fk_idx ON organisational_goal_target (performance_period_id);
CREATE OR REPLACE TRIGGER organisational_goal_target_set_updated_at BEFORE UPDATE ON organisational_goal_target
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A function's (or the company's) quarter plan, approved as one through performance.plan.
CREATE TABLE IF NOT EXISTS performance_plan (
  performance_plan_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  performance_period_id uuid NOT NULL REFERENCES performance_period(performance_period_id) ON DELETE RESTRICT,
  department_id uuid REFERENCES department(department_id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'binding', 'returned')),
  workflow_instance_id uuid REFERENCES workflow_instance(workflow_instance_id) ON DELETE SET NULL,
  submitted_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  submitted_at timestamptz,
  returned_reason text,
  binding_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (performance_period_id, department_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS performance_plan_company_uq ON performance_plan (performance_period_id)
  WHERE department_id IS NULL;
CREATE INDEX IF NOT EXISTS performance_plan_department_fk_idx ON performance_plan (department_id);
CREATE INDEX IF NOT EXISTS performance_plan_workflow_fk_idx ON performance_plan (workflow_instance_id);
CREATE INDEX IF NOT EXISTS performance_plan_submitted_by_fk_idx ON performance_plan (submitted_by);
CREATE OR REPLACE TRIGGER performance_plan_set_updated_at BEFORE UPDATE ON performance_plan
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Objectives: CO-O1 for the company, BM-O2 for a function (G1).
CREATE TABLE IF NOT EXISTS okr_objective (
  okr_objective_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  performance_period_id uuid NOT NULL REFERENCES performance_period(performance_period_id) ON DELETE RESTRICT,
  performance_plan_id uuid NOT NULL REFERENCES performance_plan(performance_plan_id) ON DELETE CASCADE,
  department_id uuid REFERENCES department(department_id) ON DELETE RESTRICT,
  code citext NOT NULL,
  title text NOT NULL,
  organisational_goal_id uuid REFERENCES organisational_goal(organisational_goal_id) ON DELETE SET NULL,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (performance_period_id, code)
);
CREATE INDEX IF NOT EXISTS okr_objective_plan_fk_idx ON okr_objective (performance_plan_id, position);
CREATE INDEX IF NOT EXISTS okr_objective_department_fk_idx ON okr_objective (department_id);
CREATE INDEX IF NOT EXISTS okr_objective_goal_fk_idx ON okr_objective (organisational_goal_id);
CREATE OR REPLACE TRIGGER okr_objective_set_updated_at BEFORE UPDATE ON okr_objective
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Key results: BM-KR2.1. A multi-part key result keeps its parts in `parts`, each scored then averaged.
CREATE TABLE IF NOT EXISTS okr_key_result (
  okr_key_result_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  okr_objective_id uuid NOT NULL REFERENCES okr_objective(okr_objective_id) ON DELETE CASCADE,
  code citext NOT NULL,
  statement text NOT NULL,
  kr_type text CHECK (kr_type IN ('diagnostic_gate', 'visibility_gate', 'enabling', 'compliance_retiring', 'compliance_floor', 'outcome', 'output')),
  measure text NOT NULL DEFAULT 'numeric' CHECK (measure IN ('numeric', 'dated', 'yes_no', 'multi_part')),
  direction text NOT NULL DEFAULT 'higher' CHECK (direction IN ('higher', 'lower')),
  unit text,
  baseline_text text,
  target_value numeric(18,4),
  target_text text,
  target_provisional boolean NOT NULL DEFAULT false,
  target_locked_at timestamptz,
  parts jsonb,
  starts_on date,
  finishes_on date,
  accountable_employee_id uuid REFERENCES employee(employee_id) ON DELETE RESTRICT,
  co_accountable_employee_id uuid REFERENCES employee(employee_id) ON DELETE RESTRICT,
  accountable_note text,
  scored_from_key_result_id uuid REFERENCES okr_key_result(okr_key_result_id) ON DELETE SET NULL,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (okr_objective_id, code),
  CHECK (finishes_on IS NULL OR starts_on IS NULL OR finishes_on >= starts_on),
  CHECK (scored_from_key_result_id IS NULL OR scored_from_key_result_id <> okr_key_result_id)
);
CREATE INDEX IF NOT EXISTS okr_key_result_objective_idx ON okr_key_result (okr_objective_id, position);
CREATE INDEX IF NOT EXISTS okr_key_result_accountable_fk_idx ON okr_key_result (accountable_employee_id);
CREATE INDEX IF NOT EXISTS okr_key_result_co_accountable_fk_idx ON okr_key_result (co_accountable_employee_id);
CREATE INDEX IF NOT EXISTS okr_key_result_scored_from_fk_idx ON okr_key_result (scored_from_key_result_id);
CREATE INDEX IF NOT EXISTS okr_key_result_code_idx ON okr_key_result (code);
CREATE OR REPLACE TRIGGER okr_key_result_set_updated_at BEFORE UPDATE ON okr_key_result
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A function key result's Linked Company KR; the company's Contributing list reads the same rows.
CREATE TABLE IF NOT EXISTS okr_key_result_link (
  okr_key_result_link_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  okr_key_result_id uuid NOT NULL REFERENCES okr_key_result(okr_key_result_id) ON DELETE CASCADE,
  company_key_result_id uuid NOT NULL REFERENCES okr_key_result(okr_key_result_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (okr_key_result_id, company_key_result_id),
  CHECK (okr_key_result_id <> company_key_result_id)
);
CREATE INDEX IF NOT EXISTS okr_key_result_link_company_fk_idx ON okr_key_result_link (company_key_result_id);

-- One report per key result per month: the latest month is "now".
CREATE TABLE IF NOT EXISTS okr_key_result_month (
  okr_key_result_month_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  okr_key_result_id uuid NOT NULL REFERENCES okr_key_result(okr_key_result_id) ON DELETE CASCADE,
  month date NOT NULL CHECK (extract(day FROM month) = 1),
  status text NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'on_track', 'at_risk', 'off_track', 'done', 'missed')),
  actual_value numeric(18,4),
  actual_text text,
  actual_source text,
  update_text text,
  recovery_employee_id uuid REFERENCES employee(employee_id) ON DELETE RESTRICT,
  recovery_due_on date,
  proposed_score numeric(6,4) CHECK (proposed_score BETWEEN 0 AND 1),
  proposed_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  confirmed_score numeric(6,4) CHECK (confirmed_score BETWEEN 0 AND 1),
  confirmed_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (okr_key_result_id, month)
);
CREATE INDEX IF NOT EXISTS okr_key_result_month_month_idx ON okr_key_result_month (month);
CREATE INDEX IF NOT EXISTS okr_key_result_month_recovery_fk_idx ON okr_key_result_month (recovery_employee_id);
CREATE INDEX IF NOT EXISTS okr_key_result_month_proposed_by_fk_idx ON okr_key_result_month (proposed_by);
CREATE INDEX IF NOT EXISTS okr_key_result_month_confirmed_by_fk_idx ON okr_key_result_month (confirmed_by);
CREATE OR REPLACE TRIGGER okr_key_result_month_set_updated_at BEFORE UPDATE ON okr_key_result_month
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- KPIs: a function's standing operational measures (TBO-K01).
ALTER TABLE kpi_definition ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES department(department_id) ON DELETE RESTRICT;
ALTER TABLE kpi_definition ADD COLUMN IF NOT EXISTS formula text;
ALTER TABLE kpi_definition ADD COLUMN IF NOT EXISTS target_text text;
ALTER TABLE kpi_definition ADD COLUMN IF NOT EXISTS target_value numeric(18,4);
ALTER TABLE kpi_definition ADD COLUMN IF NOT EXISTS frequency text;
ALTER TABLE kpi_definition ADD COLUMN IF NOT EXISTS data_source text;
ALTER TABLE kpi_definition ADD COLUMN IF NOT EXISTS starts_period_id uuid REFERENCES performance_period(performance_period_id) ON DELETE SET NULL;
-- The KPIs service writes no measurement type; a monthly standard is what every KPI here is.
ALTER TABLE kpi_definition ALTER COLUMN measurement_type SET DEFAULT 'standard';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kpi_definition_frequency_check') THEN
    ALTER TABLE kpi_definition ADD CONSTRAINT kpi_definition_frequency_check
      CHECK (frequency IS NULL OR frequency IN ('weekly', 'monthly', 'quarterly'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS kpi_definition_department_fk_idx ON kpi_definition (department_id);
CREATE INDEX IF NOT EXISTS kpi_definition_starts_period_fk_idx ON kpi_definition (starts_period_id);

-- Former codes from the workbook's change map (OP-KR2.2 is now TBO-KR3.3).
CREATE TABLE IF NOT EXISTS okr_code_alias (
  okr_code_alias_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  performance_period_id uuid NOT NULL REFERENCES performance_period(performance_period_id) ON DELETE CASCADE,
  alias_code citext NOT NULL,
  okr_key_result_id uuid REFERENCES okr_key_result(okr_key_result_id) ON DELETE CASCADE,
  kpi_definition_id uuid REFERENCES kpi_definition(kpi_definition_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (performance_period_id, alias_code),
  CHECK ((okr_key_result_id IS NULL) <> (kpi_definition_id IS NULL))
);
CREATE INDEX IF NOT EXISTS okr_code_alias_key_result_fk_idx ON okr_code_alias (okr_key_result_id);
CREATE INDEX IF NOT EXISTS okr_code_alias_kpi_fk_idx ON okr_code_alias (kpi_definition_id);

-- One actual per KPI per month. N/A when no eligible cases, never 100%.
CREATE TABLE IF NOT EXISTS kpi_month (
  kpi_month_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kpi_definition_id uuid NOT NULL REFERENCES kpi_definition(kpi_definition_id) ON DELETE CASCADE,
  month date NOT NULL CHECK (extract(day FROM month) = 1),
  result text NOT NULL CHECK (result IN ('met', 'not_met', 'na')),
  actual_value numeric(18,4),
  actual_text text,
  comment text,
  recorded_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kpi_definition_id, month)
);
CREATE INDEX IF NOT EXISTS kpi_month_month_idx ON kpi_month (month);
CREATE INDEX IF NOT EXISTS kpi_month_recorded_by_fk_idx ON kpi_month (recorded_by);
CREATE OR REPLACE TRIGGER kpi_month_set_updated_at BEFORE UPDATE ON kpi_month
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A person's scorecard for a quarter: Results, KPIs and Accountability.
CREATE TABLE IF NOT EXISTS scorecard (
  scorecard_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  performance_period_id uuid NOT NULL REFERENCES performance_period(performance_period_id) ON DELETE RESTRICT,
  employee_id uuid NOT NULL REFERENCES employee(employee_id) ON DELETE RESTRICT,
  department_id uuid REFERENCES department(department_id) ON DELETE RESTRICT,
  scope_text text,
  reviewer_employee_id uuid REFERENCES employee(employee_id) ON DELETE RESTRICT,
  reviewer_role_code citext,
  reviewer_reason text,
  dotted_employee_id uuid REFERENCES employee(employee_id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'binding', 'agreed', 'closed')),
  employee_agreed_at timestamptz,
  reviewer_agreed_at timestamptz,
  disagreed_at timestamptz,
  disagree_reason text,
  results_weight integer NOT NULL DEFAULT 60 CHECK (results_weight BETWEEN 0 AND 100),
  kpis_weight integer NOT NULL DEFAULT 25 CHECK (kpis_weight BETWEEN 0 AND 100),
  accountability_weight integer NOT NULL DEFAULT 15 CHECK (accountability_weight BETWEEN 0 AND 100),
  score_to_date numeric(6,4) CHECK (score_to_date BETWEEN 0 AND 1),
  rating text CHECK (rating IN ('exceeds', 'meets', 'partly_meets', 'below')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (performance_period_id, employee_id),
  CHECK (results_weight + kpis_weight + accountability_weight = 100),
  CHECK (reviewer_employee_id IS NULL OR reviewer_role_code IS NULL),
  CHECK (reviewer_employee_id IS NULL OR reviewer_employee_id <> employee_id)
);
CREATE INDEX IF NOT EXISTS scorecard_employee_fk_idx ON scorecard (employee_id);
CREATE INDEX IF NOT EXISTS scorecard_department_fk_idx ON scorecard (department_id);
CREATE INDEX IF NOT EXISTS scorecard_reviewer_fk_idx ON scorecard (reviewer_employee_id);
CREATE INDEX IF NOT EXISTS scorecard_dotted_fk_idx ON scorecard (dotted_employee_id);
CREATE INDEX IF NOT EXISTS scorecard_period_status_idx ON scorecard (performance_period_id, status);
CREATE OR REPLACE TRIGGER scorecard_set_updated_at BEFORE UPDATE ON scorecard
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A scorecard line. `title` is the goal or KPI; target_value, weight, due_on and kpi_definition_id exist (2000).
ALTER TABLE employee_target ADD COLUMN IF NOT EXISTS scorecard_id uuid REFERENCES scorecard(scorecard_id) ON DELETE CASCADE;
ALTER TABLE employee_target ADD COLUMN IF NOT EXISTS section text;
ALTER TABLE employee_target ADD COLUMN IF NOT EXISTS position integer NOT NULL DEFAULT 0;
ALTER TABLE employee_target ADD COLUMN IF NOT EXISTS measure text;
ALTER TABLE employee_target ADD COLUMN IF NOT EXISTS direction text NOT NULL DEFAULT 'higher';
ALTER TABLE employee_target ADD COLUMN IF NOT EXISTS unit text;
ALTER TABLE employee_target ADD COLUMN IF NOT EXISTS target_text text;
ALTER TABLE employee_target ADD COLUMN IF NOT EXISTS milestone_due_on date;
ALTER TABLE employee_target ADD COLUMN IF NOT EXISTS frequency_text text;
ALTER TABLE employee_target ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE employee_target ADD COLUMN IF NOT EXISTS okr_key_result_id uuid REFERENCES okr_key_result(okr_key_result_id) ON DELETE SET NULL;
ALTER TABLE employee_target ADD COLUMN IF NOT EXISTS share_value numeric(18,4);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_target_section_check') THEN
    ALTER TABLE employee_target ADD CONSTRAINT employee_target_section_check
      CHECK (section IS NULL OR section IN ('results', 'kpis', 'accountability'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_target_measure_check') THEN
    ALTER TABLE employee_target ADD CONSTRAINT employee_target_measure_check
      CHECK (measure IS NULL OR measure IN ('numeric', 'milestone', 'standard', 'binary'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_target_direction_check') THEN
    ALTER TABLE employee_target ADD CONSTRAINT employee_target_direction_check
      CHECK (direction IN ('higher', 'lower'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_target_source_check') THEN
    ALTER TABLE employee_target ADD CONSTRAINT employee_target_source_check
      CHECK (source IS NULL OR source IN ('own', 'key_result', 'team_result', 'function_kpi', 'commitments', 'update_on_time', 'team_reviews', 'tasks'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_target_scorecard_line_check') THEN
    ALTER TABLE employee_target ADD CONSTRAINT employee_target_scorecard_line_check
      CHECK (scorecard_id IS NULL OR (section IS NOT NULL AND measure IS NOT NULL AND source IS NOT NULL));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS employee_target_scorecard_idx ON employee_target (scorecard_id, section, position);
CREATE INDEX IF NOT EXISTS employee_target_key_result_fk_idx ON employee_target (okr_key_result_id);
CREATE INDEX IF NOT EXISTS employee_target_kpi_fk_idx ON employee_target (kpi_definition_id);
CREATE INDEX IF NOT EXISTS employee_target_goal_fk_idx ON employee_target (organisational_goal_id);
CREATE INDEX IF NOT EXISTS employee_target_approved_by_fk_idx ON employee_target (approved_by);
-- Asked by Home: My Targets.
CREATE INDEX IF NOT EXISTS employee_target_employee_due_idx ON employee_target (employee_id, due_on);

-- The key results a Team result line averages.
CREATE TABLE IF NOT EXISTS employee_target_key_result (
  employee_target_key_result_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_target_id uuid NOT NULL REFERENCES employee_target(employee_target_id) ON DELETE CASCADE,
  okr_key_result_id uuid NOT NULL REFERENCES okr_key_result(okr_key_result_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_target_id, okr_key_result_id)
);
CREATE INDEX IF NOT EXISTS employee_target_key_result_kr_fk_idx ON employee_target_key_result (okr_key_result_id);

-- A request to change a binding target; the original stays on its row, the history reads from here.
CREATE TABLE IF NOT EXISTS target_change (
  target_change_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  okr_key_result_id uuid REFERENCES okr_key_result(okr_key_result_id) ON DELETE CASCADE,
  employee_target_id uuid REFERENCES employee_target(employee_target_id) ON DELETE CASCADE,
  from_value numeric(18,4),
  from_text text,
  to_value numeric(18,4),
  to_text text,
  from_month date NOT NULL CHECK (extract(day FROM from_month) = 1),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  workflow_instance_id uuid REFERENCES workflow_instance(workflow_instance_id) ON DELETE SET NULL,
  requested_by uuid NOT NULL REFERENCES app_user(user_id) ON DELETE RESTRICT,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((okr_key_result_id IS NULL) <> (employee_target_id IS NULL))
);
CREATE INDEX IF NOT EXISTS target_change_key_result_fk_idx ON target_change (okr_key_result_id);
CREATE INDEX IF NOT EXISTS target_change_target_fk_idx ON target_change (employee_target_id);
CREATE INDEX IF NOT EXISTS target_change_workflow_fk_idx ON target_change (workflow_instance_id);
CREATE INDEX IF NOT EXISTS target_change_requested_by_fk_idx ON target_change (requested_by);
CREATE INDEX IF NOT EXISTS target_change_status_idx ON target_change (status, created_at);
CREATE OR REPLACE TRIGGER target_change_set_updated_at BEFORE UPDATE ON target_change
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A monthly round ("October 2026") and its deadlines, from the quarter's rules.
ALTER TABLE performance_cycle ADD COLUMN IF NOT EXISTS performance_period_id uuid REFERENCES performance_period(performance_period_id) ON DELETE RESTRICT;
ALTER TABLE performance_cycle ADD COLUMN IF NOT EXISTS month date;
ALTER TABLE performance_cycle ADD COLUMN IF NOT EXISTS check_in_due_on date;
ALTER TABLE performance_cycle ADD COLUMN IF NOT EXISTS head_check_in_due_on date;
ALTER TABLE performance_cycle ADD COLUMN IF NOT EXISTS review_due_on date;
ALTER TABLE performance_cycle ADD COLUMN IF NOT EXISTS second_level_due_on date;
ALTER TABLE performance_cycle ADD COLUMN IF NOT EXISTS close_due_on date;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'performance_cycle_month_check') THEN
    ALTER TABLE performance_cycle ADD CONSTRAINT performance_cycle_month_check
      CHECK (month IS NULL OR extract(day FROM month) = 1);
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS performance_cycle_period_month_uq ON performance_cycle (performance_period_id, month);
CREATE INDEX IF NOT EXISTS performance_cycle_closes_idx ON performance_cycle (closes_at);

-- One review per scorecard per month, and probation reviews (no scorecard, no round needed).
ALTER TABLE performance_review ADD COLUMN IF NOT EXISTS scorecard_id uuid REFERENCES scorecard(scorecard_id) ON DELETE RESTRICT;
ALTER TABLE performance_review ADD COLUMN IF NOT EXISTS review_kind text NOT NULL DEFAULT 'monthly';
ALTER TABLE performance_review ADD COLUMN IF NOT EXISTS check_in_submitted_at timestamptz;
ALTER TABLE performance_review ADD COLUMN IF NOT EXISTS closed_at timestamptz;
ALTER TABLE performance_review ADD COLUMN IF NOT EXISTS returned_reason text;
ALTER TABLE performance_review ADD COLUMN IF NOT EXISTS workflow_instance_id uuid REFERENCES workflow_instance(workflow_instance_id) ON DELETE SET NULL;
ALTER TABLE performance_review ADD COLUMN IF NOT EXISTS dotted_employee_id uuid REFERENCES employee(employee_id) ON DELETE RESTRICT;
ALTER TABLE performance_review ADD COLUMN IF NOT EXISTS dotted_input text;
ALTER TABLE performance_review ADD COLUMN IF NOT EXISTS dotted_input_at timestamptz;
ALTER TABLE performance_review ADD COLUMN IF NOT EXISTS score_month numeric(6,4);
ALTER TABLE performance_review ADD COLUMN IF NOT EXISTS score_to_date numeric(6,4);
ALTER TABLE performance_review ADD COLUMN IF NOT EXISTS rating text;
ALTER TABLE performance_review ADD COLUMN IF NOT EXISTS conduct_breach boolean NOT NULL DEFAULT false;
ALTER TABLE performance_review ADD COLUMN IF NOT EXISTS conduct_note text;
ALTER TABLE performance_review ADD COLUMN IF NOT EXISTS probation_outcome text;
ALTER TABLE performance_review ADD COLUMN IF NOT EXISTS document_id uuid REFERENCES document(document_id) ON DELETE RESTRICT;
-- A probation review opens when Probation Ending fires, whatever round is open.
ALTER TABLE performance_review ALTER COLUMN performance_cycle_id DROP NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'performance_review_kind_check') THEN
    ALTER TABLE performance_review ADD CONSTRAINT performance_review_kind_check
      CHECK (review_kind IN ('monthly', 'probation'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'performance_review_round_check') THEN
    ALTER TABLE performance_review ADD CONSTRAINT performance_review_round_check
      CHECK (review_kind = 'probation' OR performance_cycle_id IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'performance_review_rating_check') THEN
    ALTER TABLE performance_review ADD CONSTRAINT performance_review_rating_check
      CHECK (rating IS NULL OR rating IN ('exceeds', 'meets', 'partly_meets', 'below'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'performance_review_probation_outcome_check') THEN
    ALTER TABLE performance_review ADD CONSTRAINT performance_review_probation_outcome_check
      CHECK (probation_outcome IS NULL OR probation_outcome IN ('confirm', 'extend', 'end'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'performance_review_scores_check') THEN
    ALTER TABLE performance_review ADD CONSTRAINT performance_review_scores_check
      CHECK ((score_month IS NULL OR score_month BETWEEN 0 AND 1) AND (score_to_date IS NULL OR score_to_date BETWEEN 0 AND 1));
  END IF;
END $$;
-- One review per scorecard per round. The 2000 key (cycle, employee, reviewer, type) stays: Home's
-- staging rows hold a self and a manager review per person, and a new review never repeats it.
CREATE UNIQUE INDEX IF NOT EXISTS performance_review_scorecard_round_uq ON performance_review (performance_cycle_id, scorecard_id)
  WHERE scorecard_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS performance_review_probation_open_uq ON performance_review (employee_id)
  WHERE review_kind = 'probation' AND closed_at IS NULL;
CREATE INDEX IF NOT EXISTS performance_review_round_status_idx ON performance_review (performance_cycle_id, status);
CREATE INDEX IF NOT EXISTS performance_review_reviewer_open_idx ON performance_review (reviewer_employee_id) WHERE status <> 'closed';
CREATE INDEX IF NOT EXISTS performance_review_employee_fk_idx ON performance_review (employee_id);
CREATE INDEX IF NOT EXISTS performance_review_scorecard_fk_idx ON performance_review (scorecard_id);
CREATE INDEX IF NOT EXISTS performance_review_workflow_fk_idx ON performance_review (workflow_instance_id);
CREATE INDEX IF NOT EXISTS performance_review_dotted_fk_idx ON performance_review (dotted_employee_id);
CREATE INDEX IF NOT EXISTS performance_review_document_fk_idx ON performance_review (document_id);
CREATE INDEX IF NOT EXISTS performance_review_dictation_fk_idx ON performance_review (dictation_document_id);

-- One item per line per review: the check-in's actual, evidence and action; proposed, self and final scores.
ALTER TABLE performance_review_item ADD COLUMN IF NOT EXISTS criterion text;
ALTER TABLE performance_review_item ADD COLUMN IF NOT EXISTS actual_value numeric(18,4);
ALTER TABLE performance_review_item ADD COLUMN IF NOT EXISTS actual_text text;
ALTER TABLE performance_review_item ADD COLUMN IF NOT EXISTS achieved_on date;
ALTER TABLE performance_review_item ADD COLUMN IF NOT EXISTS evidence_kind text;
ALTER TABLE performance_review_item ADD COLUMN IF NOT EXISTS evidence_entity_type text;
ALTER TABLE performance_review_item ADD COLUMN IF NOT EXISTS evidence_entity_id uuid;
ALTER TABLE performance_review_item ADD COLUMN IF NOT EXISTS evidence_document_id uuid REFERENCES document(document_id) ON DELETE RESTRICT;
ALTER TABLE performance_review_item ADD COLUMN IF NOT EXISTS evidence_url text;
ALTER TABLE performance_review_item ADD COLUMN IF NOT EXISTS evidence_note text;
ALTER TABLE performance_review_item ADD COLUMN IF NOT EXISTS action_text text;
ALTER TABLE performance_review_item ADD COLUMN IF NOT EXISTS action_transcript text;
ALTER TABLE performance_review_item ADD COLUMN IF NOT EXISTS action_document_id uuid REFERENCES document(document_id) ON DELETE RESTRICT;
ALTER TABLE performance_review_item ADD COLUMN IF NOT EXISTS action_ai_run_id uuid REFERENCES ai_run(run_id) ON DELETE SET NULL;
ALTER TABLE performance_review_item ADD COLUMN IF NOT EXISTS proposed_score numeric(6,4);
ALTER TABLE performance_review_item ADD COLUMN IF NOT EXISTS self_score numeric(6,4);
ALTER TABLE performance_review_item ADD COLUMN IF NOT EXISTS self_reason text;
ALTER TABLE performance_review_item ADD COLUMN IF NOT EXISTS override_reason text;
ALTER TABLE performance_review_item ADD COLUMN IF NOT EXISTS assessable boolean NOT NULL DEFAULT true;
ALTER TABLE performance_review_item ADD COLUMN IF NOT EXISTS auto boolean NOT NULL DEFAULT false;
-- Widened, not narrowed: a probation review without a scorecard scores criteria (§6.16).
ALTER TABLE performance_review_item DROP CONSTRAINT IF EXISTS performance_review_item_check;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'performance_review_item_subject_check') THEN
    ALTER TABLE performance_review_item ADD CONSTRAINT performance_review_item_subject_check
      CHECK (employee_target_id IS NOT NULL OR kpi_definition_id IS NOT NULL OR criterion IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'performance_review_item_criterion_check') THEN
    ALTER TABLE performance_review_item ADD CONSTRAINT performance_review_item_criterion_check
      CHECK (criterion IS NULL OR criterion IN ('objectives', 'quality', 'timeliness', 'attendance', 'conduct'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'performance_review_item_evidence_check') THEN
    ALTER TABLE performance_review_item ADD CONSTRAINT performance_review_item_evidence_check
      CHECK (evidence_kind IS NULL OR evidence_kind IN ('record', 'document', 'link', 'note'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'performance_review_item_scores_check') THEN
    ALTER TABLE performance_review_item ADD CONSTRAINT performance_review_item_scores_check
      CHECK ((proposed_score IS NULL OR proposed_score BETWEEN 0 AND 1)
             AND (self_score IS NULL OR self_score BETWEEN 0 AND 1));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS performance_review_item_line_uq ON performance_review_item (performance_review_id, employee_target_id)
  WHERE employee_target_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS performance_review_item_criterion_uq ON performance_review_item (performance_review_id, criterion)
  WHERE criterion IS NOT NULL;
CREATE INDEX IF NOT EXISTS performance_review_item_review_fk_idx ON performance_review_item (performance_review_id);
CREATE INDEX IF NOT EXISTS performance_review_item_target_fk_idx ON performance_review_item (employee_target_id);
CREATE INDEX IF NOT EXISTS performance_review_item_kpi_fk_idx ON performance_review_item (kpi_definition_id);
CREATE INDEX IF NOT EXISTS performance_review_item_evidence_doc_fk_idx ON performance_review_item (evidence_document_id);
CREATE INDEX IF NOT EXISTS performance_review_item_action_doc_fk_idx ON performance_review_item (action_document_id);
CREATE INDEX IF NOT EXISTS performance_review_item_ai_run_fk_idx ON performance_review_item (action_ai_run_id);

-- A performance improvement plan, started from a closed review rated Below. Its actions are tasks.
CREATE TABLE IF NOT EXISTS improvement_plan (
  improvement_plan_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employee(employee_id) ON DELETE RESTRICT,
  performance_review_id uuid REFERENCES performance_review(performance_review_id) ON DELETE RESTRICT,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  review_on date NOT NULL,
  summary text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'passed', 'extended', 'not_met')),
  outcome_note text,
  created_by uuid NOT NULL REFERENCES app_user(user_id) ON DELETE RESTRICT,
  decided_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on)
);
CREATE INDEX IF NOT EXISTS improvement_plan_employee_fk_idx ON improvement_plan (employee_id, status);
CREATE INDEX IF NOT EXISTS improvement_plan_review_fk_idx ON improvement_plan (performance_review_id);
CREATE INDEX IF NOT EXISTS improvement_plan_created_by_fk_idx ON improvement_plan (created_by);
CREATE INDEX IF NOT EXISTS improvement_plan_decided_by_fk_idx ON improvement_plan (decided_by);
CREATE INDEX IF NOT EXISTS improvement_plan_review_on_idx ON improvement_plan (review_on) WHERE status = 'open';
CREATE OR REPLACE TRIGGER improvement_plan_set_updated_at BEFORE UPDATE ON improvement_plan
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS improvement_plan_line (
  improvement_plan_line_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  improvement_plan_id uuid NOT NULL REFERENCES improvement_plan(improvement_plan_id) ON DELETE CASCADE,
  employee_target_id uuid REFERENCES employee_target(employee_target_id) ON DELETE SET NULL,
  text text NOT NULL,
  target_text text,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS improvement_plan_line_plan_idx ON improvement_plan_line (improvement_plan_id, position);
CREATE INDEX IF NOT EXISTS improvement_plan_line_target_fk_idx ON improvement_plan_line (employee_target_id);
CREATE OR REPLACE TRIGGER improvement_plan_line_set_updated_at BEFORE UPDATE ON improvement_plan_line
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One person's commitments for a month, approved as one through performance.commitments.
CREATE TABLE IF NOT EXISTS commitment_set (
  commitment_set_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employee(employee_id) ON DELETE RESTRICT,
  month date NOT NULL CHECK (extract(day FROM month) = 1),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'returned')),
  workflow_instance_id uuid REFERENCES workflow_instance(workflow_instance_id) ON DELETE SET NULL,
  submitted_at timestamptz,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, month)
);
CREATE INDEX IF NOT EXISTS commitment_set_workflow_fk_idx ON commitment_set (workflow_instance_id);
CREATE INDEX IF NOT EXISTS commitment_set_month_idx ON commitment_set (month, status);
CREATE OR REPLACE TRIGGER commitment_set_set_updated_at BEFORE UPDATE ON commitment_set
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A commitment is a task: its acceptance criteria, its month, and the date approval fixed.
ALTER TABLE task ADD COLUMN IF NOT EXISTS is_commitment boolean NOT NULL DEFAULT false;
ALTER TABLE task ADD COLUMN IF NOT EXISTS acceptance_criteria text;
ALTER TABLE task ADD COLUMN IF NOT EXISTS commitment_month date;
ALTER TABLE task ADD COLUMN IF NOT EXISTS original_due_at timestamptz;
ALTER TABLE task ADD COLUMN IF NOT EXISTS commitment_set_id uuid REFERENCES commitment_set(commitment_set_id) ON DELETE SET NULL;
ALTER TABLE task ADD COLUMN IF NOT EXISTS rescoped_at timestamptz;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_commitment_check') THEN
    ALTER TABLE task ADD CONSTRAINT task_commitment_check
      CHECK (NOT is_commitment OR (commitment_month IS NOT NULL AND extract(day FROM commitment_month) = 1));
  END IF;
END $$;
-- Widened, not narrowed: a task may now point at a key result, a scorecard, a review or a PIP.
ALTER TABLE task DROP CONSTRAINT IF EXISTS task_entity_check;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_entity_check') THEN
    ALTER TABLE task ADD CONSTRAINT task_entity_check
      CHECK ((entity_type IS NULL) = (entity_id IS NULL)
             AND (entity_type IS NULL OR entity_type IN ('partner', 'vacancy', 'goal', 'key_result', 'scorecard', 'performance_review', 'improvement_plan')));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS task_commitment_month_idx ON task (commitment_month, primary_assignee_id) WHERE is_commitment;
CREATE INDEX IF NOT EXISTS task_commitment_set_fk_idx ON task (commitment_set_id) WHERE commitment_set_id IS NOT NULL;

-- The one line a person writes each week, and a tidied summary they accepted.
CREATE TABLE IF NOT EXISTS weekly_summary (
  weekly_summary_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employee(employee_id) ON DELETE RESTRICT,
  week_starts_on date NOT NULL CHECK (extract(isodow FROM week_starts_on) = 1),
  support_needed text,
  summary_text text,
  ai_run_id uuid REFERENCES ai_run(run_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, week_starts_on)
);
CREATE INDEX IF NOT EXISTS weekly_summary_week_idx ON weekly_summary (week_starts_on);
CREATE INDEX IF NOT EXISTS weekly_summary_ai_run_fk_idx ON weekly_summary (ai_run_id);
CREATE OR REPLACE TRIGGER weekly_summary_set_updated_at BEFORE UPDATE ON weekly_summary
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- DOWN
DROP TRIGGER IF EXISTS weekly_summary_set_updated_at ON weekly_summary;
DROP INDEX IF EXISTS weekly_summary_ai_run_fk_idx;
DROP INDEX IF EXISTS weekly_summary_week_idx;
DROP TABLE IF EXISTS weekly_summary;

DROP INDEX IF EXISTS task_commitment_set_fk_idx;
DROP INDEX IF EXISTS task_commitment_month_idx;
-- The narrower entity list comes back; tasks pointing at the new kinds lose the pointer first.
UPDATE task SET entity_type = NULL, entity_id = NULL -- DESTRUCTIVE: rollback only; the pointers UP allowed
 WHERE entity_type IN ('key_result', 'scorecard', 'performance_review', 'improvement_plan');
ALTER TABLE task DROP CONSTRAINT IF EXISTS task_entity_check;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_entity_check') THEN
    ALTER TABLE task ADD CONSTRAINT task_entity_check
      CHECK ((entity_type IS NULL) = (entity_id IS NULL)
             AND (entity_type IS NULL OR entity_type IN ('partner', 'vacancy', 'goal')));
  END IF;
END $$;
ALTER TABLE task DROP CONSTRAINT IF EXISTS task_commitment_check;
ALTER TABLE task DROP COLUMN IF EXISTS rescoped_at; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE task DROP COLUMN IF EXISTS commitment_set_id; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE task DROP COLUMN IF EXISTS original_due_at; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE task DROP COLUMN IF EXISTS commitment_month; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE task DROP COLUMN IF EXISTS acceptance_criteria; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE task DROP COLUMN IF EXISTS is_commitment; -- DESTRUCTIVE: rollback only; drops what UP added

DROP TRIGGER IF EXISTS commitment_set_set_updated_at ON commitment_set;
DROP INDEX IF EXISTS commitment_set_month_idx;
DROP INDEX IF EXISTS commitment_set_workflow_fk_idx;
DROP TABLE IF EXISTS commitment_set;

DROP TRIGGER IF EXISTS improvement_plan_line_set_updated_at ON improvement_plan_line;
DROP INDEX IF EXISTS improvement_plan_line_target_fk_idx;
DROP INDEX IF EXISTS improvement_plan_line_plan_idx;
DROP TABLE IF EXISTS improvement_plan_line;
DROP TRIGGER IF EXISTS improvement_plan_set_updated_at ON improvement_plan;
DROP INDEX IF EXISTS improvement_plan_review_on_idx;
DROP INDEX IF EXISTS improvement_plan_decided_by_fk_idx;
DROP INDEX IF EXISTS improvement_plan_created_by_fk_idx;
DROP INDEX IF EXISTS improvement_plan_review_fk_idx;
DROP INDEX IF EXISTS improvement_plan_employee_fk_idx;
DROP TABLE IF EXISTS improvement_plan;

DROP INDEX IF EXISTS performance_review_item_ai_run_fk_idx;
DROP INDEX IF EXISTS performance_review_item_action_doc_fk_idx;
DROP INDEX IF EXISTS performance_review_item_evidence_doc_fk_idx;
DROP INDEX IF EXISTS performance_review_item_kpi_fk_idx;
DROP INDEX IF EXISTS performance_review_item_target_fk_idx;
DROP INDEX IF EXISTS performance_review_item_review_fk_idx;
DROP INDEX IF EXISTS performance_review_item_criterion_uq;
DROP INDEX IF EXISTS performance_review_item_line_uq;
ALTER TABLE performance_review_item DROP CONSTRAINT IF EXISTS performance_review_item_scores_check;
ALTER TABLE performance_review_item DROP CONSTRAINT IF EXISTS performance_review_item_evidence_check;
ALTER TABLE performance_review_item DROP CONSTRAINT IF EXISTS performance_review_item_criterion_check;
-- The narrower subject check comes back; criterion items have no line, so they go first.
DELETE FROM performance_review_item WHERE employee_target_id IS NULL AND kpi_definition_id IS NULL; -- DESTRUCTIVE: rollback only; rows only UP allowed
ALTER TABLE performance_review_item DROP CONSTRAINT IF EXISTS performance_review_item_subject_check;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'performance_review_item_check') THEN
    ALTER TABLE performance_review_item ADD CONSTRAINT performance_review_item_check
      CHECK (employee_target_id IS NOT NULL OR kpi_definition_id IS NOT NULL);
  END IF;
END $$;
ALTER TABLE performance_review_item DROP COLUMN IF EXISTS auto; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE performance_review_item DROP COLUMN IF EXISTS assessable; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE performance_review_item DROP COLUMN IF EXISTS override_reason; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE performance_review_item DROP COLUMN IF EXISTS self_reason; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE performance_review_item DROP COLUMN IF EXISTS self_score; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE performance_review_item DROP COLUMN IF EXISTS proposed_score; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE performance_review_item DROP COLUMN IF EXISTS action_ai_run_id; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE performance_review_item DROP COLUMN IF EXISTS action_document_id; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE performance_review_item DROP COLUMN IF EXISTS action_transcript; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE performance_review_item DROP COLUMN IF EXISTS action_text; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE performance_review_item DROP COLUMN IF EXISTS evidence_note; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE performance_review_item DROP COLUMN IF EXISTS evidence_url; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE performance_review_item DROP COLUMN IF EXISTS evidence_document_id; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE performance_review_item DROP COLUMN IF EXISTS evidence_entity_id; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE performance_review_item DROP COLUMN IF EXISTS evidence_entity_type; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE performance_review_item DROP COLUMN IF EXISTS evidence_kind; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE performance_review_item DROP COLUMN IF EXISTS achieved_on; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE performance_review_item DROP COLUMN IF EXISTS actual_text; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE performance_review_item DROP COLUMN IF EXISTS actual_value; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE performance_review_item DROP COLUMN IF EXISTS criterion; -- DESTRUCTIVE: rollback only; drops what UP added

DROP INDEX IF EXISTS performance_review_dictation_fk_idx;
DROP INDEX IF EXISTS performance_review_document_fk_idx;
DROP INDEX IF EXISTS performance_review_dotted_fk_idx;
DROP INDEX IF EXISTS performance_review_workflow_fk_idx;
DROP INDEX IF EXISTS performance_review_scorecard_fk_idx;
DROP INDEX IF EXISTS performance_review_employee_fk_idx;
DROP INDEX IF EXISTS performance_review_reviewer_open_idx;
DROP INDEX IF EXISTS performance_review_round_status_idx;
DROP INDEX IF EXISTS performance_review_probation_open_uq;
DROP INDEX IF EXISTS performance_review_scorecard_round_uq;
ALTER TABLE performance_review DROP CONSTRAINT IF EXISTS performance_review_scores_check;
ALTER TABLE performance_review DROP CONSTRAINT IF EXISTS performance_review_probation_outcome_check;
ALTER TABLE performance_review DROP CONSTRAINT IF EXISTS performance_review_rating_check;
ALTER TABLE performance_review DROP CONSTRAINT IF EXISTS performance_review_round_check;
ALTER TABLE performance_review DROP CONSTRAINT IF EXISTS performance_review_kind_check;
-- Probation reviews have no round; NOT NULL comes back once they are gone.
DELETE FROM performance_review WHERE performance_cycle_id IS NULL; -- DESTRUCTIVE: rollback only; rows only UP allowed
ALTER TABLE performance_review ALTER COLUMN performance_cycle_id SET NOT NULL; -- DESTRUCTIVE: rollback only; restores 2000's rule
ALTER TABLE performance_review DROP COLUMN IF EXISTS document_id; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE performance_review DROP COLUMN IF EXISTS probation_outcome; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE performance_review DROP COLUMN IF EXISTS conduct_note; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE performance_review DROP COLUMN IF EXISTS conduct_breach; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE performance_review DROP COLUMN IF EXISTS rating; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE performance_review DROP COLUMN IF EXISTS score_to_date; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE performance_review DROP COLUMN IF EXISTS score_month; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE performance_review DROP COLUMN IF EXISTS dotted_input_at; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE performance_review DROP COLUMN IF EXISTS dotted_input; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE performance_review DROP COLUMN IF EXISTS dotted_employee_id; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE performance_review DROP COLUMN IF EXISTS workflow_instance_id; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE performance_review DROP COLUMN IF EXISTS returned_reason; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE performance_review DROP COLUMN IF EXISTS closed_at; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE performance_review DROP COLUMN IF EXISTS check_in_submitted_at; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE performance_review DROP COLUMN IF EXISTS review_kind; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE performance_review DROP COLUMN IF EXISTS scorecard_id; -- DESTRUCTIVE: rollback only; drops what UP added

DROP INDEX IF EXISTS performance_cycle_closes_idx;
DROP INDEX IF EXISTS performance_cycle_period_month_uq;
ALTER TABLE performance_cycle DROP CONSTRAINT IF EXISTS performance_cycle_month_check;
ALTER TABLE performance_cycle DROP COLUMN IF EXISTS close_due_on; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE performance_cycle DROP COLUMN IF EXISTS second_level_due_on; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE performance_cycle DROP COLUMN IF EXISTS review_due_on; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE performance_cycle DROP COLUMN IF EXISTS head_check_in_due_on; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE performance_cycle DROP COLUMN IF EXISTS check_in_due_on; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE performance_cycle DROP COLUMN IF EXISTS month; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE performance_cycle DROP COLUMN IF EXISTS performance_period_id; -- DESTRUCTIVE: rollback only; drops what UP added

DROP TRIGGER IF EXISTS target_change_set_updated_at ON target_change;
DROP INDEX IF EXISTS target_change_status_idx;
DROP INDEX IF EXISTS target_change_requested_by_fk_idx;
DROP INDEX IF EXISTS target_change_workflow_fk_idx;
DROP INDEX IF EXISTS target_change_target_fk_idx;
DROP INDEX IF EXISTS target_change_key_result_fk_idx;
DROP TABLE IF EXISTS target_change;

DROP INDEX IF EXISTS employee_target_key_result_kr_fk_idx;
DROP TABLE IF EXISTS employee_target_key_result;

DROP INDEX IF EXISTS employee_target_employee_due_idx;
DROP INDEX IF EXISTS employee_target_approved_by_fk_idx;
DROP INDEX IF EXISTS employee_target_goal_fk_idx;
DROP INDEX IF EXISTS employee_target_kpi_fk_idx;
DROP INDEX IF EXISTS employee_target_key_result_fk_idx;
DROP INDEX IF EXISTS employee_target_scorecard_idx;
ALTER TABLE employee_target DROP CONSTRAINT IF EXISTS employee_target_scorecard_line_check;
ALTER TABLE employee_target DROP CONSTRAINT IF EXISTS employee_target_source_check;
ALTER TABLE employee_target DROP CONSTRAINT IF EXISTS employee_target_direction_check;
ALTER TABLE employee_target DROP CONSTRAINT IF EXISTS employee_target_measure_check;
ALTER TABLE employee_target DROP CONSTRAINT IF EXISTS employee_target_section_check;
ALTER TABLE employee_target DROP COLUMN IF EXISTS share_value; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE employee_target DROP COLUMN IF EXISTS okr_key_result_id; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE employee_target DROP COLUMN IF EXISTS source; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE employee_target DROP COLUMN IF EXISTS frequency_text; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE employee_target DROP COLUMN IF EXISTS milestone_due_on; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE employee_target DROP COLUMN IF EXISTS target_text; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE employee_target DROP COLUMN IF EXISTS unit; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE employee_target DROP COLUMN IF EXISTS direction; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE employee_target DROP COLUMN IF EXISTS measure; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE employee_target DROP COLUMN IF EXISTS position; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE employee_target DROP COLUMN IF EXISTS section; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE employee_target DROP COLUMN IF EXISTS scorecard_id; -- DESTRUCTIVE: rollback only; drops what UP added

DROP TRIGGER IF EXISTS scorecard_set_updated_at ON scorecard;
DROP INDEX IF EXISTS scorecard_period_status_idx;
DROP INDEX IF EXISTS scorecard_dotted_fk_idx;
DROP INDEX IF EXISTS scorecard_reviewer_fk_idx;
DROP INDEX IF EXISTS scorecard_department_fk_idx;
DROP INDEX IF EXISTS scorecard_employee_fk_idx;
DROP TABLE IF EXISTS scorecard;

DROP TRIGGER IF EXISTS kpi_month_set_updated_at ON kpi_month;
DROP INDEX IF EXISTS kpi_month_recorded_by_fk_idx;
DROP INDEX IF EXISTS kpi_month_month_idx;
DROP TABLE IF EXISTS kpi_month;

DROP INDEX IF EXISTS okr_code_alias_kpi_fk_idx;
DROP INDEX IF EXISTS okr_code_alias_key_result_fk_idx;
DROP TABLE IF EXISTS okr_code_alias;

DROP INDEX IF EXISTS kpi_definition_starts_period_fk_idx;
DROP INDEX IF EXISTS kpi_definition_department_fk_idx;
ALTER TABLE kpi_definition DROP CONSTRAINT IF EXISTS kpi_definition_frequency_check;
ALTER TABLE kpi_definition ALTER COLUMN measurement_type DROP DEFAULT;
ALTER TABLE kpi_definition DROP COLUMN IF EXISTS starts_period_id; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE kpi_definition DROP COLUMN IF EXISTS data_source; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE kpi_definition DROP COLUMN IF EXISTS frequency; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE kpi_definition DROP COLUMN IF EXISTS target_value; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE kpi_definition DROP COLUMN IF EXISTS target_text; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE kpi_definition DROP COLUMN IF EXISTS formula; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE kpi_definition DROP COLUMN IF EXISTS department_id; -- DESTRUCTIVE: rollback only; drops what UP added

DROP TRIGGER IF EXISTS okr_key_result_month_set_updated_at ON okr_key_result_month;
DROP INDEX IF EXISTS okr_key_result_month_confirmed_by_fk_idx;
DROP INDEX IF EXISTS okr_key_result_month_proposed_by_fk_idx;
DROP INDEX IF EXISTS okr_key_result_month_recovery_fk_idx;
DROP INDEX IF EXISTS okr_key_result_month_month_idx;
DROP TABLE IF EXISTS okr_key_result_month;

DROP INDEX IF EXISTS okr_key_result_link_company_fk_idx;
DROP TABLE IF EXISTS okr_key_result_link;

DROP TRIGGER IF EXISTS okr_key_result_set_updated_at ON okr_key_result;
DROP INDEX IF EXISTS okr_key_result_code_idx;
DROP INDEX IF EXISTS okr_key_result_scored_from_fk_idx;
DROP INDEX IF EXISTS okr_key_result_co_accountable_fk_idx;
DROP INDEX IF EXISTS okr_key_result_accountable_fk_idx;
DROP INDEX IF EXISTS okr_key_result_objective_idx;
DROP TABLE IF EXISTS okr_key_result;

DROP TRIGGER IF EXISTS okr_objective_set_updated_at ON okr_objective;
DROP INDEX IF EXISTS okr_objective_goal_fk_idx;
DROP INDEX IF EXISTS okr_objective_department_fk_idx;
DROP INDEX IF EXISTS okr_objective_plan_fk_idx;
DROP TABLE IF EXISTS okr_objective;

DROP TRIGGER IF EXISTS performance_plan_set_updated_at ON performance_plan;
DROP INDEX IF EXISTS performance_plan_submitted_by_fk_idx;
DROP INDEX IF EXISTS performance_plan_workflow_fk_idx;
DROP INDEX IF EXISTS performance_plan_department_fk_idx;
DROP INDEX IF EXISTS performance_plan_company_uq;
DROP TABLE IF EXISTS performance_plan;

DROP TRIGGER IF EXISTS organisational_goal_target_set_updated_at ON organisational_goal_target;
DROP INDEX IF EXISTS organisational_goal_target_period_fk_idx;
DROP TABLE IF EXISTS organisational_goal_target;

DROP INDEX IF EXISTS organisational_goal_workflow_fk_idx;
DROP INDEX IF EXISTS organisational_goal_employee_fk_idx;
DROP INDEX IF EXISTS organisational_goal_department_fk_idx;
DROP INDEX IF EXISTS organisational_goal_parent_fk_idx;
DROP INDEX IF EXISTS organisational_goal_owner_fk_idx;
DROP INDEX IF EXISTS organisational_goal_level_dates_idx;
DROP INDEX IF EXISTS organisational_goal_code_uq;
ALTER TABLE organisational_goal DROP COLUMN IF EXISTS plan_year_starts_on; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE organisational_goal DROP COLUMN IF EXISTS function_cascade; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE organisational_goal DROP COLUMN IF EXISTS key_decisions; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE organisational_goal DROP COLUMN IF EXISTS baseline; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE organisational_goal DROP COLUMN IF EXISTS reference_target; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE organisational_goal DROP COLUMN IF EXISTS success_measure; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE organisational_goal DROP COLUMN IF EXISTS detail; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE organisational_goal DROP COLUMN IF EXISTS strategic_theme; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE organisational_goal DROP COLUMN IF EXISTS code; -- DESTRUCTIVE: rollback only; drops what UP added

DROP TRIGGER IF EXISTS performance_period_set_updated_at ON performance_period;
DROP INDEX IF EXISTS performance_period_status_idx;
DROP TABLE IF EXISTS performance_period;

DROP INDEX IF EXISTS department_head_seat_fk_idx;
DROP INDEX IF EXISTS department_head_employee_fk_idx;
ALTER TABLE department DROP CONSTRAINT IF EXISTS department_head_check;
ALTER TABLE department DROP COLUMN IF EXISTS head_seat_id; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE department DROP COLUMN IF EXISTS head_employee_id; -- DESTRUCTIVE: rollback only; drops what UP added
