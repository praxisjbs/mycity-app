-- M0 User Guide search: the meaning index, one vector for each passage of docs/manual on the Guide Search model (docs/guides/user-guide.md §4, §6.8).
-- The passages themselves are the chapters' files; a row keeps only the hash of what was embedded,
-- the model that embedded it and the vector. Nothing a person typed is kept.
-- UP
CREATE TABLE IF NOT EXISTS user_guide_passage (
  user_guide_passage_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- sha256 of the passage as embedded (where it sits, what it says, its picture's words).
  text_hash text NOT NULL CHECK (text_hash ~ '^[0-9a-f]{64}$'),
  model text NOT NULL,
  embedding vector(1536) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (text_hash, model)
);

CREATE OR REPLACE TRIGGER user_guide_passage_set_updated_at
  BEFORE UPDATE ON user_guide_passage
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Nearest passages by cosine distance; OpenAI's vectors are unit length.
CREATE INDEX IF NOT EXISTS user_guide_passage_embedding_idx ON user_guide_passage USING hnsw (embedding vector_cosine_ops);

-- DOWN
DROP INDEX IF EXISTS user_guide_passage_embedding_idx;
DROP TRIGGER IF EXISTS user_guide_passage_set_updated_at ON user_guide_passage;
DROP TABLE IF EXISTS user_guide_passage;
