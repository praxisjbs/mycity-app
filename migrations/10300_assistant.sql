-- M10 Praxis AI: conversation counters, what each answer read, and citations that name a record (docs/guides/praxis-ai.md §4).
-- UP

-- A conversation keeps when it was last asked in and how many questions it holds, for Recent and History.
ALTER TABLE ai_conversation ADD COLUMN IF NOT EXISTS last_asked_at timestamptz;
ALTER TABLE ai_conversation ADD COLUMN IF NOT EXISTS questions integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_conversation_questions_check') THEN
    ALTER TABLE ai_conversation ADD CONSTRAINT ai_conversation_questions_check CHECK (questions >= 0);
  END IF;
END $$;

CREATE OR REPLACE TRIGGER ai_conversation_set_updated_at
  BEFORE UPDATE ON ai_conversation
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS ai_conversation_user_last_idx ON ai_conversation (user_id, last_asked_at DESC);

-- An answer keeps how many rows its reads returned and the module of its first read: History reports on both.
ALTER TABLE ai_message ADD COLUMN IF NOT EXISTS rows_read integer NOT NULL DEFAULT 0;
ALTER TABLE ai_message ADD COLUMN IF NOT EXISTS module_key text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_message_rows_read_check') THEN
    ALTER TABLE ai_message ADD CONSTRAINT ai_message_rows_read_check CHECK (rows_read >= 0);
  END IF;
  -- The roles seeded as ai_message_role (10099).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_message_role_check') THEN
    ALTER TABLE ai_message ADD CONSTRAINT ai_message_role_check CHECK (role IN ('user', 'assistant', 'system'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_message_feedback_check') THEN
    ALTER TABLE ai_message ADD CONSTRAINT ai_message_feedback_check CHECK (feedback IS NULL OR feedback IN ('up', 'down'));
  END IF;
END $$;

CREATE OR REPLACE TRIGGER ai_message_set_updated_at
  BEFORE UPDATE ON ai_message
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS ai_message_conversation_idx ON ai_message (ai_conversation_id, created_at);
CREATE INDEX IF NOT EXISTS ai_message_parent_idx ON ai_message (parent_message_id);
CREATE INDEX IF NOT EXISTS ai_message_run_idx ON ai_message (ai_run_id);

-- A citation may name a record an answer read (entity_type, entity_id and the read), not only an article or a document.
ALTER TABLE ai_message_citation ADD COLUMN IF NOT EXISTS entity_type text;
ALTER TABLE ai_message_citation ADD COLUMN IF NOT EXISTS entity_id text;
ALTER TABLE ai_message_citation ADD COLUMN IF NOT EXISTS read_key text;

ALTER TABLE ai_message_citation DROP CONSTRAINT IF EXISTS ai_message_citation_check;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_message_citation_source_check') THEN
    ALTER TABLE ai_message_citation ADD CONSTRAINT ai_message_citation_source_check CHECK (
      knowledge_article_version_id IS NOT NULL
      OR document_id IS NOT NULL
      OR (entity_type IS NOT NULL AND entity_id IS NOT NULL)
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ai_message_citation_message_idx ON ai_message_citation (ai_message_id);
CREATE INDEX IF NOT EXISTS ai_message_citation_version_idx ON ai_message_citation (knowledge_article_version_id);
CREATE INDEX IF NOT EXISTS ai_message_citation_document_idx ON ai_message_citation (document_id);

-- DOWN
DROP INDEX IF EXISTS ai_message_citation_document_idx;
DROP INDEX IF EXISTS ai_message_citation_version_idx;
DROP INDEX IF EXISTS ai_message_citation_message_idx;
ALTER TABLE ai_message_citation DROP CONSTRAINT IF EXISTS ai_message_citation_source_check;
-- The narrower check comes back; a citation that names only a record would break it, so those go first.
DELETE FROM ai_message_citation WHERE knowledge_article_version_id IS NULL AND document_id IS NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_message_citation_check') THEN
    ALTER TABLE ai_message_citation
      ADD CONSTRAINT ai_message_citation_check CHECK (knowledge_article_version_id IS NOT NULL OR document_id IS NOT NULL);
  END IF;
END $$;
ALTER TABLE ai_message_citation DROP COLUMN IF EXISTS read_key;
ALTER TABLE ai_message_citation DROP COLUMN IF EXISTS entity_id;
ALTER TABLE ai_message_citation DROP COLUMN IF EXISTS entity_type;
DROP INDEX IF EXISTS ai_message_run_idx;
DROP INDEX IF EXISTS ai_message_parent_idx;
DROP INDEX IF EXISTS ai_message_conversation_idx;
DROP TRIGGER IF EXISTS ai_message_set_updated_at ON ai_message;
ALTER TABLE ai_message DROP CONSTRAINT IF EXISTS ai_message_feedback_check;
ALTER TABLE ai_message DROP CONSTRAINT IF EXISTS ai_message_role_check;
ALTER TABLE ai_message DROP CONSTRAINT IF EXISTS ai_message_rows_read_check;
ALTER TABLE ai_message DROP COLUMN IF EXISTS module_key;
ALTER TABLE ai_message DROP COLUMN IF EXISTS rows_read;
DROP INDEX IF EXISTS ai_conversation_user_last_idx;
DROP TRIGGER IF EXISTS ai_conversation_set_updated_at ON ai_conversation;
ALTER TABLE ai_conversation DROP CONSTRAINT IF EXISTS ai_conversation_questions_check;
ALTER TABLE ai_conversation DROP COLUMN IF EXISTS questions;
ALTER TABLE ai_conversation DROP COLUMN IF EXISTS last_asked_at;
