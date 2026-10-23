-- M2 My Workspace: Why Late's reasons become a list MyCity keeps (docs/guides/workspace.md §4, §6 Late reasons; JBS Praxis, 23/10/2026).
--
-- A reason is added, and switched off or on, by a holder of `workspace.late_reasons`; it is never
-- deleted, so the answers already given keep it. `task.late_reason` holds a reason's code; the CHECK
-- of 2020 that listed four codes gives way to the list, which the tasks service checks. The six
-- starting reasons are seeded in 2590.

-- UP
CREATE TABLE IF NOT EXISTS task_late_reason (
  task_late_reason_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[a-z][a-z0-9_]{0,59}$'),
  label text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 60),
  active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_late_reason_created_by_fk_idx ON task_late_reason (created_by);
CREATE INDEX IF NOT EXISTS task_late_reason_order_idx ON task_late_reason (active, display_order, label);

CREATE OR REPLACE TRIGGER task_late_reason_set_updated_at BEFORE UPDATE ON task_late_reason
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE task DROP CONSTRAINT IF EXISTS task_late_reason_check;

-- DOWN
-- 2020's four codes come back; an answer with a reason added since reads Other.
UPDATE task SET late_reason = 'other' -- DESTRUCTIVE: rollback only; a reason UP allowed
 WHERE late_reason IS NOT NULL AND late_reason NOT IN ('waiting_on_others', 'underestimated', 'deprioritised', 'other');
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_late_reason_check') THEN
    ALTER TABLE task ADD CONSTRAINT task_late_reason_check
      CHECK (late_reason IS NULL OR late_reason IN ('waiting_on_others', 'underestimated', 'deprioritised', 'other'));
  END IF;
END $$;
DROP TRIGGER IF EXISTS task_late_reason_set_updated_at ON task_late_reason;
DROP INDEX IF EXISTS task_late_reason_order_idx;
DROP INDEX IF EXISTS task_late_reason_created_by_fk_idx;
DROP TABLE IF EXISTS task_late_reason; -- DESTRUCTIVE: rollback only; drops what UP added
