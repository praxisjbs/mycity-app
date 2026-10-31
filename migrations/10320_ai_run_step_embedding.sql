-- M10 AI Control: a ledger step may be an embedding, the Embeddings job's vectors for search (docs/guides/ai-control.md §6.6).
-- UP
-- Widened, not narrowed: every kind 10200 allowed is still allowed.
ALTER TABLE ai_run_step DROP CONSTRAINT IF EXISTS ai_run_step_kind_check;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_run_step_kind_check') THEN
    ALTER TABLE ai_run_step
      ADD CONSTRAINT ai_run_step_kind_check CHECK (kind IN ('completion', 'retry', 'transcription', 'search', 'embedding'));
  END IF;
END;
$$;

-- DOWN
-- The narrower kind comes back; an embedding step would break it, so those go first.
DELETE FROM ai_run_step WHERE kind = 'embedding'; -- DESTRUCTIVE: the embedding steps' token counts; their runs stay
ALTER TABLE ai_run_step DROP CONSTRAINT IF EXISTS ai_run_step_kind_check;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_run_step_kind_check') THEN
    ALTER TABLE ai_run_step
      ADD CONSTRAINT ai_run_step_kind_check CHECK (kind IN ('completion', 'retry', 'transcription', 'search'));
  END IF;
END;
$$;
