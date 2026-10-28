-- M2 Performance: sharing a company goal (docs/guides/performance.md §4, §6.24; JBS Praxis, 28/10/2026).
--
-- Each person reads their own department's goals and OKRs; the organisational goals and the company's
-- objectives are read in full only by the CEO and Management (§6.23). The CEO shares an organisational
-- goal, and Management a company objective with its key results, with all staff or chosen departments,
-- read only. One share per goal and one per objective (goal_share); the departments a share reaches are
-- goal_share_department. A goal or objective deleted takes its share; a department deleted takes its row.
-- UP

CREATE TABLE IF NOT EXISTS goal_share (
  goal_share_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisational_goal_id uuid REFERENCES organisational_goal(organisational_goal_id) ON DELETE CASCADE,
  okr_objective_id uuid REFERENCES okr_objective(okr_objective_id) ON DELETE CASCADE,
  audience text NOT NULL CHECK (audience IN ('all', 'departments')),
  shared_by uuid NOT NULL REFERENCES app_user(user_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT goal_share_one_item CHECK ((organisational_goal_id IS NOT NULL) <> (okr_objective_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS goal_share_goal_uq ON goal_share (organisational_goal_id) WHERE organisational_goal_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS goal_share_objective_uq ON goal_share (okr_objective_id) WHERE okr_objective_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS goal_share_shared_by_fk_idx ON goal_share (shared_by);
CREATE OR REPLACE TRIGGER goal_share_set_updated_at BEFORE UPDATE ON goal_share
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS goal_share_department (
  goal_share_id uuid NOT NULL REFERENCES goal_share(goal_share_id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES department(department_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (goal_share_id, department_id)
);
CREATE INDEX IF NOT EXISTS goal_share_department_department_fk_idx ON goal_share_department (department_id);

-- DOWN

DROP INDEX IF EXISTS goal_share_department_department_fk_idx;
DROP TABLE IF EXISTS goal_share_department; -- DESTRUCTIVE: rollback only; drops the departments of every share UP's table held
DROP TRIGGER IF EXISTS goal_share_set_updated_at ON goal_share;
DROP INDEX IF EXISTS goal_share_shared_by_fk_idx;
DROP INDEX IF EXISTS goal_share_objective_uq;
DROP INDEX IF EXISTS goal_share_goal_uq;
DROP TABLE IF EXISTS goal_share; -- DESTRUCTIVE: rollback only; drops the shares UP created
