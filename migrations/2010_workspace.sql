-- M2 My Workspace: what a task points at and who set it (A24), the cancelled status, task history, calendar attendees and visibility.
-- UP

-- A task: its number, who set it, its horizon, the KPI it counts towards and the record it points at.
ALTER TABLE task ADD COLUMN IF NOT EXISTS number citext;
ALTER TABLE task ADD COLUMN IF NOT EXISTS set_by_employee_id uuid REFERENCES employee(employee_id) ON DELETE RESTRICT;
ALTER TABLE task ADD COLUMN IF NOT EXISTS cadence text;
ALTER TABLE task ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE task ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE task ADD COLUMN IF NOT EXISTS cancel_reason text;
ALTER TABLE task ADD COLUMN IF NOT EXISTS blocked_at timestamptz;
ALTER TABLE task ADD COLUMN IF NOT EXISTS employee_target_id uuid REFERENCES employee_target(employee_target_id) ON DELETE SET NULL;
ALTER TABLE task ADD COLUMN IF NOT EXISTS entity_type text;
ALTER TABLE task ADD COLUMN IF NOT EXISTS entity_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_status_check') THEN
    ALTER TABLE task ADD CONSTRAINT task_status_check
      CHECK (status IN ('todo', 'in_progress', 'in_review', 'done', 'cancelled'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_priority_check') THEN
    ALTER TABLE task ADD CONSTRAINT task_priority_check
      CHECK (priority IN ('low', 'normal', 'high', 'urgent'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_cadence_check') THEN
    ALTER TABLE task ADD CONSTRAINT task_cadence_check
      CHECK (cadence IS NULL OR cadence IN ('daily', 'weekly'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_entity_check') THEN
    ALTER TABLE task ADD CONSTRAINT task_entity_check
      CHECK ((entity_type IS NULL) = (entity_id IS NULL)
             AND (entity_type IS NULL OR entity_type IN ('partner', 'vacancy', 'goal')));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_cancelled_check') THEN
    ALTER TABLE task ADD CONSTRAINT task_cancelled_check
      CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS task_number_uq ON task (number) WHERE number IS NOT NULL;
CREATE INDEX IF NOT EXISTS task_project_fk_idx ON task (project_id);
CREATE INDEX IF NOT EXISTS task_parent_fk_idx ON task (parent_task_id);
CREATE INDEX IF NOT EXISTS task_created_by_fk_idx ON task (created_by);
CREATE INDEX IF NOT EXISTS task_set_by_fk_idx ON task (set_by_employee_id);
CREATE INDEX IF NOT EXISTS task_employee_target_fk_idx ON task (employee_target_id) WHERE employee_target_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS task_entity_idx ON task (entity_type, entity_id) WHERE entity_type IS NOT NULL;
-- Asked by Home: the overdue count.
CREATE INDEX IF NOT EXISTS task_open_due_idx ON task (due_at) WHERE archived_at IS NULL AND completed_at IS NULL;
-- The board: one column, in its order.
CREATE INDEX IF NOT EXISTS task_board_idx ON task (primary_assignee_id, status, sort_order, task_id) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS task_completed_idx ON task (completed_at) WHERE completed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS task_assignee_employee_fk_idx ON task_assignee (employee_id);
CREATE INDEX IF NOT EXISTS task_comment_task_idx ON task_comment (task_id, created_at);
CREATE INDEX IF NOT EXISTS task_comment_author_fk_idx ON task_comment (author_user_id);

-- A task's history: written by the tasks service with every change, never edited.
CREATE TABLE IF NOT EXISTS task_activity (
  task_activity_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES task(task_id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('created', 'status_changed', 'assigned', 'edited', 'blocked', 'unblocked', 'cancelled', 'commented')),
  from_status text,
  to_status text,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_activity_task_idx ON task_activity (task_id, created_at);
CREATE INDEX IF NOT EXISTS task_activity_actor_fk_idx ON task_activity (actor_user_id);
CREATE INDEX IF NOT EXISTS task_activity_created_idx ON task_activity (created_at);
-- History is never rewritten. It goes with its task, which the app never deletes.
CREATE OR REPLACE TRIGGER task_activity_append_only BEFORE UPDATE ON task_activity
FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();

-- Calendar: who can see an event, the record it belongs to, and whether it was called off.
ALTER TABLE calendar_event ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'attendees';
ALTER TABLE calendar_event ADD COLUMN IF NOT EXISTS entity_type text;
ALTER TABLE calendar_event ADD COLUMN IF NOT EXISTS entity_id uuid;
ALTER TABLE calendar_event ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'calendar_event_type_check') THEN
    ALTER TABLE calendar_event ADD CONSTRAINT calendar_event_type_check
      CHECK (event_type IN ('meeting', 'deadline', 'campaign', 'event', 'interview'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'calendar_event_visibility_check') THEN
    ALTER TABLE calendar_event ADD CONSTRAINT calendar_event_visibility_check
      CHECK (visibility IN ('private', 'attendees', 'everyone'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'calendar_event_entity_check') THEN
    ALTER TABLE calendar_event ADD CONSTRAINT calendar_event_entity_check
      CHECK ((entity_type IS NULL) = (entity_id IS NULL)
             AND (entity_type IS NULL OR entity_type IN ('interview', 'partner', 'vacancy')));
  END IF;
END $$;

-- Asked by Home: Your Week.
CREATE INDEX IF NOT EXISTS calendar_event_owner_starts_idx ON calendar_event (owner_employee_id, starts_at);
CREATE INDEX IF NOT EXISTS calendar_event_starts_idx ON calendar_event (starts_at);
CREATE INDEX IF NOT EXISTS calendar_event_task_fk_idx ON calendar_event (task_id);
CREATE INDEX IF NOT EXISTS calendar_event_created_by_fk_idx ON calendar_event (created_by);
CREATE INDEX IF NOT EXISTS calendar_event_entity_idx ON calendar_event (entity_type, entity_id) WHERE entity_type IS NOT NULL;

CREATE TABLE IF NOT EXISTS calendar_event_attendee (
  calendar_event_attendee_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_event_id uuid NOT NULL REFERENCES calendar_event(calendar_event_id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employee(employee_id) ON DELETE RESTRICT,
  response text NOT NULL DEFAULT 'pending' CHECK (response IN ('pending', 'accepted', 'declined')),
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (calendar_event_id, employee_id)
);
CREATE INDEX IF NOT EXISTS calendar_event_attendee_employee_fk_idx ON calendar_event_attendee (employee_id);
CREATE OR REPLACE TRIGGER calendar_event_attendee_set_updated_at BEFORE UPDATE ON calendar_event_attendee
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- DOWN
DROP TRIGGER IF EXISTS calendar_event_attendee_set_updated_at ON calendar_event_attendee;
DROP INDEX IF EXISTS calendar_event_attendee_employee_fk_idx;
DROP TABLE IF EXISTS calendar_event_attendee;
DROP INDEX IF EXISTS calendar_event_entity_idx;
DROP INDEX IF EXISTS calendar_event_created_by_fk_idx;
DROP INDEX IF EXISTS calendar_event_task_fk_idx;
DROP INDEX IF EXISTS calendar_event_starts_idx;
DROP INDEX IF EXISTS calendar_event_owner_starts_idx;
ALTER TABLE calendar_event DROP CONSTRAINT IF EXISTS calendar_event_entity_check;
ALTER TABLE calendar_event DROP CONSTRAINT IF EXISTS calendar_event_visibility_check;
ALTER TABLE calendar_event DROP CONSTRAINT IF EXISTS calendar_event_type_check;
ALTER TABLE calendar_event DROP COLUMN IF EXISTS cancelled_at; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE calendar_event DROP COLUMN IF EXISTS entity_id; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE calendar_event DROP COLUMN IF EXISTS entity_type; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE calendar_event DROP COLUMN IF EXISTS visibility; -- DESTRUCTIVE: rollback only; drops what UP added
DROP TRIGGER IF EXISTS task_activity_append_only ON task_activity;
DROP INDEX IF EXISTS task_activity_created_idx;
DROP INDEX IF EXISTS task_activity_actor_fk_idx;
DROP INDEX IF EXISTS task_activity_task_idx;
DROP TABLE IF EXISTS task_activity;
DROP INDEX IF EXISTS task_comment_author_fk_idx;
DROP INDEX IF EXISTS task_comment_task_idx;
DROP INDEX IF EXISTS task_assignee_employee_fk_idx;
DROP INDEX IF EXISTS task_completed_idx;
DROP INDEX IF EXISTS task_board_idx;
DROP INDEX IF EXISTS task_open_due_idx;
DROP INDEX IF EXISTS task_entity_idx;
DROP INDEX IF EXISTS task_employee_target_fk_idx;
DROP INDEX IF EXISTS task_set_by_fk_idx;
DROP INDEX IF EXISTS task_created_by_fk_idx;
DROP INDEX IF EXISTS task_parent_fk_idx;
DROP INDEX IF EXISTS task_project_fk_idx;
DROP INDEX IF EXISTS task_number_uq;
ALTER TABLE task DROP CONSTRAINT IF EXISTS task_cancelled_check;
ALTER TABLE task DROP CONSTRAINT IF EXISTS task_entity_check;
ALTER TABLE task DROP CONSTRAINT IF EXISTS task_cadence_check;
ALTER TABLE task DROP CONSTRAINT IF EXISTS task_priority_check;
ALTER TABLE task DROP CONSTRAINT IF EXISTS task_status_check;
ALTER TABLE task DROP COLUMN IF EXISTS entity_id; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE task DROP COLUMN IF EXISTS entity_type; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE task DROP COLUMN IF EXISTS employee_target_id; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE task DROP COLUMN IF EXISTS blocked_at; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE task DROP COLUMN IF EXISTS cancel_reason; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE task DROP COLUMN IF EXISTS cancelled_at; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE task DROP COLUMN IF EXISTS started_at; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE task DROP COLUMN IF EXISTS cadence; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE task DROP COLUMN IF EXISTS set_by_employee_id; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE task DROP COLUMN IF EXISTS number; -- DESTRUCTIVE: rollback only; drops what UP added
