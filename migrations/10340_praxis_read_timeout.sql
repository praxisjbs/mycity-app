-- M10 Praxis AI Engine, PR3 (docs/guides/praxis-ai.md §6.3 step 8, §6.13): a read or summary cut by the 3 second statement timeout is kept as timed_out, so the Sources tab can say the question covered too much.
-- UP

-- Widening the CHECK: timed_out joins read, refused, invalid and failed (docs/MIGRATIONS.md §8: not destructive).
ALTER TABLE ai_message_read DROP CONSTRAINT IF EXISTS ai_message_read_outcome_check;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_message_read_outcome_check_v2') THEN
    ALTER TABLE ai_message_read ADD CONSTRAINT ai_message_read_outcome_check_v2
      CHECK (outcome IN ('read', 'refused', 'invalid', 'failed', 'timed_out'));
  END IF;
END $$;

-- DOWN
ALTER TABLE ai_message_read DROP CONSTRAINT IF EXISTS ai_message_read_outcome_check_v2;
-- The narrower check comes back; a timed-out read reads as failed under it.
UPDATE ai_message_read SET outcome = 'failed' WHERE outcome = 'timed_out'; -- DESTRUCTIVE: rollback only; which reads timed out is lost
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_message_read_outcome_check') THEN
    ALTER TABLE ai_message_read ADD CONSTRAINT ai_message_read_outcome_check
      CHECK (outcome IN ('read', 'refused', 'invalid', 'failed'));
  END IF;
END $$;
