-- M2 My Workspace: a task's steps, the tasks it waits on, who watches it, its holds, and why it is late.
-- UP

-- Why an overdue task is late: asked on its panel and when it reaches Done after its due time.
ALTER TABLE task ADD COLUMN IF NOT EXISTS late_reason text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_late_reason_check') THEN
    ALTER TABLE task ADD CONSTRAINT task_late_reason_check
      CHECK (late_reason IS NULL OR late_reason IN ('waiting_on_others', 'underestimated', 'deprioritised', 'other'));
  END IF;
END $$;

-- A step inside a task: done or not. Removed with its task.
CREATE TABLE IF NOT EXISTS task_step (
  task_step_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES task(task_id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 300),
  due_on date,
  done_at timestamptz,
  done_by uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL REFERENCES app_user(user_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_step_task_idx ON task_step (task_id, sort_order, task_step_id);
CREATE INDEX IF NOT EXISTS task_step_done_by_fk_idx ON task_step (done_by);
CREATE INDEX IF NOT EXISTS task_step_created_by_fk_idx ON task_step (created_by);
CREATE OR REPLACE TRIGGER task_step_set_updated_at BEFORE UPDATE ON task_step
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- task_id waits on depends_on_task_id. Satisfied when that task is done, or when someone said to go
-- ahead anyway (overridden_at). A cancelled prerequisite never satisfies the edge on its own. Longer
-- cycles than a task waiting on itself are refused by the tasks service, which walks the graph.
CREATE TABLE IF NOT EXISTS task_dependency (
  task_dependency_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES task(task_id) ON DELETE CASCADE,
  depends_on_task_id uuid NOT NULL REFERENCES task(task_id) ON DELETE CASCADE,
  overridden_at timestamptz,
  overridden_by uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  override_reason text CHECK (override_reason IS NULL OR char_length(override_reason) <= 500),
  created_by uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_dependency_not_self CHECK (task_id <> depends_on_task_id),
  CONSTRAINT task_dependency_pair_uq UNIQUE (task_id, depends_on_task_id)
);
CREATE INDEX IF NOT EXISTS task_dependency_depends_on_fk_idx ON task_dependency (depends_on_task_id);
CREATE INDEX IF NOT EXISTS task_dependency_overridden_by_fk_idx ON task_dependency (overridden_by);
CREATE INDEX IF NOT EXISTS task_dependency_created_by_fk_idx ON task_dependency (created_by);
CREATE OR REPLACE TRIGGER task_dependency_set_updated_at BEFORE UPDATE ON task_dependency
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Someone told when a task moves, without owning it.
CREATE TABLE IF NOT EXISTS task_watcher (
  task_watcher_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES task(task_id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employee(employee_id) ON DELETE RESTRICT,
  created_by uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_watcher_pair_uq UNIQUE (task_id, employee_id)
);
CREATE INDEX IF NOT EXISTS task_watcher_employee_fk_idx ON task_watcher (employee_id);
CREATE INDEX IF NOT EXISTS task_watcher_created_by_fk_idx ON task_watcher (created_by);
CREATE OR REPLACE TRIGGER task_watcher_set_updated_at BEFORE UPDATE ON task_watcher
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A hold on a task and its note. At most one open hold per task; resolved holds are its history,
-- the evidence for how long it was held and why its due time moved (due_shift_days). task.blocked_reason
-- and task.blocked_at carry the open hold for the readers that read the task alone.
CREATE TABLE IF NOT EXISTS task_blockage (
  task_blockage_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES task(task_id) ON DELETE CASCADE,
  note text NOT NULL CHECK (char_length(btrim(note)) BETWEEN 1 AND 500),
  estimated_resolve_on date,
  raised_by uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  raised_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  resolve_note text CHECK (resolve_note IS NULL OR char_length(resolve_note) <= 500),
  due_shift_days integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_blockage_resolved_after_raised CHECK (resolved_at IS NULL OR resolved_at >= raised_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS task_blockage_one_open_uq ON task_blockage (task_id) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS task_blockage_task_idx ON task_blockage (task_id, raised_at DESC, task_blockage_id);
CREATE INDEX IF NOT EXISTS task_blockage_open_idx ON task_blockage (raised_at) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS task_blockage_raised_by_fk_idx ON task_blockage (raised_by);
CREATE INDEX IF NOT EXISTS task_blockage_resolved_by_fk_idx ON task_blockage (resolved_by);
CREATE OR REPLACE TRIGGER task_blockage_set_updated_at BEFORE UPDATE ON task_blockage
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- The history now names steps, waiting on, watchers, pings and reminders. Widened, not narrowed.
ALTER TABLE task_activity DROP CONSTRAINT IF EXISTS task_activity_kind_check;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_activity_kind_check') THEN
    ALTER TABLE task_activity ADD CONSTRAINT task_activity_kind_check
      CHECK (kind IN ('created', 'status_changed', 'assigned', 'edited', 'blocked', 'unblocked', 'cancelled', 'commented',
                      'step_added', 'step_done', 'step_reopened', 'step_removed',
                      'waiting_added', 'waiting_removed', 'waiting_overridden',
                      'watcher_added', 'watcher_removed', 'pinged', 'reminders_set'));
  END IF;
END $$;

-- DOWN
-- The narrower list comes back; history lines of the new kinds go first.
DELETE FROM task_activity -- DESTRUCTIVE: rollback only; history lines UP allowed
 WHERE kind IN ('step_added', 'step_done', 'step_reopened', 'step_removed', 'waiting_added', 'waiting_removed',
                'waiting_overridden', 'watcher_added', 'watcher_removed', 'pinged', 'reminders_set');
ALTER TABLE task_activity DROP CONSTRAINT IF EXISTS task_activity_kind_check;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_activity_kind_check') THEN
    ALTER TABLE task_activity ADD CONSTRAINT task_activity_kind_check
      CHECK (kind IN ('created', 'status_changed', 'assigned', 'edited', 'blocked', 'unblocked', 'cancelled', 'commented'));
  END IF;
END $$;
DROP TRIGGER IF EXISTS task_blockage_set_updated_at ON task_blockage;
DROP INDEX IF EXISTS task_blockage_resolved_by_fk_idx;
DROP INDEX IF EXISTS task_blockage_raised_by_fk_idx;
DROP INDEX IF EXISTS task_blockage_open_idx;
DROP INDEX IF EXISTS task_blockage_task_idx;
DROP INDEX IF EXISTS task_blockage_one_open_uq;
DROP TABLE IF EXISTS task_blockage; -- DESTRUCTIVE: rollback only; drops what UP created
DROP TRIGGER IF EXISTS task_watcher_set_updated_at ON task_watcher;
DROP INDEX IF EXISTS task_watcher_created_by_fk_idx;
DROP INDEX IF EXISTS task_watcher_employee_fk_idx;
DROP TABLE IF EXISTS task_watcher; -- DESTRUCTIVE: rollback only; drops what UP created
DROP TRIGGER IF EXISTS task_dependency_set_updated_at ON task_dependency;
DROP INDEX IF EXISTS task_dependency_created_by_fk_idx;
DROP INDEX IF EXISTS task_dependency_overridden_by_fk_idx;
DROP INDEX IF EXISTS task_dependency_depends_on_fk_idx;
DROP TABLE IF EXISTS task_dependency; -- DESTRUCTIVE: rollback only; drops what UP created
DROP TRIGGER IF EXISTS task_step_set_updated_at ON task_step;
DROP INDEX IF EXISTS task_step_created_by_fk_idx;
DROP INDEX IF EXISTS task_step_done_by_fk_idx;
DROP INDEX IF EXISTS task_step_task_idx;
DROP TABLE IF EXISTS task_step; -- DESTRUCTIVE: rollback only; drops what UP created
ALTER TABLE task DROP CONSTRAINT IF EXISTS task_late_reason_check;
ALTER TABLE task DROP COLUMN IF EXISTS late_reason; -- DESTRUCTIVE: rollback only; drops what UP added
