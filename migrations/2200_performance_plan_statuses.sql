-- M2 Performance PR 2: the statuses an organisational goal and a scorecard line may hold, now that
-- Performance writes them (docs/guides/performance.md §4, §6.4) and staging's Home rows are replaced.
-- UP

-- A goal is active when the CEO records it (A16); nothing writes a draft goal.
ALTER TABLE organisational_goal ALTER COLUMN status SET DEFAULT 'active';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organisational_goal_status_check') THEN
    ALTER TABLE organisational_goal ADD CONSTRAINT organisational_goal_status_check
      CHECK (status IN ('active', 'closed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_target_status_check') THEN
    ALTER TABLE employee_target ADD CONSTRAINT employee_target_status_check
      CHECK (status IN ('draft', 'active', 'closed', 'cancelled'));
  END IF;
END $$;

-- DOWN

ALTER TABLE employee_target DROP CONSTRAINT IF EXISTS employee_target_status_check;
ALTER TABLE organisational_goal DROP CONSTRAINT IF EXISTS organisational_goal_status_check;
ALTER TABLE organisational_goal ALTER COLUMN status SET DEFAULT 'draft';
