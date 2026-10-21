-- M10 AI Control: voice notes recorded before the action registry carry its key (docs/guides/ai-control.md §4, §6.5).
--
-- Before 10200 a voice note's run was kept under the purpose `transcription`. The registry
-- (src/services/ai/actions.js) names that action `voice-note-transcription`, so Spend · By Action
-- showed those runs as the bare old key, with no job. They move onto the registered key;
-- ai_run.original_purpose keeps the key each was recorded under, so DOWN puts it back exactly.
-- UP
ALTER TABLE ai_run ADD COLUMN IF NOT EXISTS original_purpose text;

UPDATE ai_run
   SET original_purpose = purpose,
       purpose = 'voice-note-transcription'
 WHERE purpose = 'transcription';

-- DOWN
UPDATE ai_run
   SET purpose = original_purpose
 WHERE original_purpose IS NOT NULL;
ALTER TABLE ai_run DROP COLUMN IF EXISTS original_purpose;
