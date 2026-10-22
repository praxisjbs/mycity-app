-- M2 Performance PR 4: a Recovery task points at the missed commitment it recovers, and a rescope keeps its reason (docs/guides/performance.md §4, §6.11).
--
-- A commitment is a task, so its Recovery task names it as its record: `entity_type` `task`. Widened,
-- not narrowed; the lookup by record is already indexed (task_entity_idx, 2010). A rescope's reason
-- is asked when it is sent and shown to its approver, on the panel and in the month-end report; it
-- is cleared when the rescope is refused.

-- UP
ALTER TABLE task ADD COLUMN IF NOT EXISTS rescope_reason text;
ALTER TABLE task DROP CONSTRAINT IF EXISTS task_entity_check;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_entity_check') THEN
    ALTER TABLE task ADD CONSTRAINT task_entity_check
      CHECK ((entity_type IS NULL) = (entity_id IS NULL)
             AND (entity_type IS NULL OR entity_type IN ('partner', 'vacancy', 'goal', 'key_result', 'scorecard',
                                                         'performance_review', 'improvement_plan', 'task')));
  END IF;
END $$;

-- DOWN
-- 2100's list comes back; a Recovery task loses its pointer first.
UPDATE task SET entity_type = NULL, entity_id = NULL -- DESTRUCTIVE: rollback only; the pointer UP allowed
 WHERE entity_type = 'task';
ALTER TABLE task DROP CONSTRAINT IF EXISTS task_entity_check;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_entity_check') THEN
    ALTER TABLE task ADD CONSTRAINT task_entity_check
      CHECK ((entity_type IS NULL) = (entity_id IS NULL)
             AND (entity_type IS NULL OR entity_type IN ('partner', 'vacancy', 'goal', 'key_result', 'scorecard',
                                                         'performance_review', 'improvement_plan')));
  END IF;
END $$;
ALTER TABLE task DROP COLUMN IF EXISTS rescope_reason; -- DESTRUCTIVE: rollback only; drops what UP added
