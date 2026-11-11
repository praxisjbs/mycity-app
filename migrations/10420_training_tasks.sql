-- M10 Training: a task can point at the training enrolment it carries out (docs/guides/knowledge.md §6.7).
--
-- Each assigned enrolment sets a task "Complete <course>" for the person, its record the enrolment
-- (`entity_type` `training_enrolment`); the task closes itself when the course completes. Widened,
-- not narrowed; the lookup by record is already indexed (task_entity_idx, 2010).

-- UP
ALTER TABLE task DROP CONSTRAINT IF EXISTS task_entity_check;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_entity_check') THEN
    ALTER TABLE task ADD CONSTRAINT task_entity_check
      CHECK ((entity_type IS NULL) = (entity_id IS NULL)
             AND (entity_type IS NULL OR entity_type IN ('partner', 'vacancy', 'goal', 'key_result', 'scorecard',
                                                         'performance_review', 'improvement_plan', 'task',
                                                         'training_enrolment')));
  END IF;
END $$;

-- DOWN
-- 2400's list comes back; a training task loses its pointer first.
UPDATE task SET entity_type = NULL, entity_id = NULL -- DESTRUCTIVE: rollback only; the pointer UP allowed
 WHERE entity_type = 'training_enrolment';
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
