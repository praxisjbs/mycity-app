-- M2 review cycles (A17, A18): cycle statuses and questions, the review's approval and PDF, per-KPI ratings, and each answer with its dictation.
-- UP

-- A cycle: who opened it and the statuses it moves through.
ALTER TABLE performance_cycle ADD COLUMN IF NOT EXISTS opened_by uuid REFERENCES app_user(user_id) ON DELETE SET NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'performance_cycle_status_check') THEN
    ALTER TABLE performance_cycle ADD CONSTRAINT performance_cycle_status_check
      CHECK (status IN ('draft', 'scheduled', 'open', 'closed'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS performance_cycle_opened_by_fk_idx ON performance_cycle (opened_by);
-- The 06:00 job: scheduled cycles whose opening day has come.
CREATE INDEX IF NOT EXISTS performance_cycle_status_opens_idx ON performance_cycle (status, self_review_opens_at);

-- The questions a cycle asks, copied from the last cycle when one opens.
CREATE TABLE IF NOT EXISTS performance_cycle_question (
  performance_cycle_question_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  performance_cycle_id uuid NOT NULL REFERENCES performance_cycle(performance_cycle_id) ON DELETE CASCADE,
  position smallint NOT NULL CHECK (position > 0),
  prompt text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (performance_cycle_id, position)
);
CREATE OR REPLACE TRIGGER performance_cycle_question_set_updated_at BEFORE UPDATE ON performance_cycle_question
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A review: its approval (manager review, second level, HR), its PDF once closed, and its statuses.
ALTER TABLE performance_review ADD COLUMN IF NOT EXISTS workflow_instance_id uuid
  REFERENCES workflow_instance(workflow_instance_id) ON DELETE SET NULL;
ALTER TABLE performance_review ADD COLUMN IF NOT EXISTS document_id uuid
  REFERENCES document(document_id) ON DELETE SET NULL;
ALTER TABLE performance_review ADD COLUMN IF NOT EXISTS closed_at timestamptz;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'performance_review_status_check') THEN
    ALTER TABLE performance_review ADD CONSTRAINT performance_review_status_check
      CHECK (status IN ('draft', 'submitted', 'second_level', 'with_hr', 'closed', 'returned'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'performance_review_overall_score_check') THEN
    ALTER TABLE performance_review ADD CONSTRAINT performance_review_overall_score_check
      CHECK (overall_score IS NULL OR overall_score BETWEEN 1 AND 5);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS performance_review_cycle_fk_idx ON performance_review (performance_cycle_id, status);
CREATE INDEX IF NOT EXISTS performance_review_employee_fk_idx ON performance_review (employee_id);
CREATE INDEX IF NOT EXISTS performance_review_reviewer_fk_idx ON performance_review (reviewer_employee_id);
CREATE INDEX IF NOT EXISTS performance_review_workflow_fk_idx ON performance_review (workflow_instance_id);
CREATE INDEX IF NOT EXISTS performance_review_document_fk_idx ON performance_review (document_id);
CREATE INDEX IF NOT EXISTS performance_review_dictation_fk_idx ON performance_review (dictation_document_id);

-- A rating per KPI, 1 to 5, one per KPI on a review.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'performance_review_item_score_check') THEN
    ALTER TABLE performance_review_item ADD CONSTRAINT performance_review_item_score_check
      CHECK (score IS NULL OR score BETWEEN 1 AND 5);
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS performance_review_item_target_uq
  ON performance_review_item (performance_review_id, employee_target_id) WHERE employee_target_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS performance_review_item_target_fk_idx ON performance_review_item (employee_target_id);
CREATE INDEX IF NOT EXISTS performance_review_item_kpi_definition_fk_idx ON performance_review_item (kpi_definition_id);

-- An answer to one of the cycle's questions (A18): the text kept, and when dictated the audio,
-- what was said, and the AI run that tidied it.
CREATE TABLE IF NOT EXISTS performance_review_answer (
  performance_review_answer_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  performance_review_id uuid NOT NULL REFERENCES performance_review(performance_review_id) ON DELETE CASCADE,
  performance_cycle_question_id uuid NOT NULL
    REFERENCES performance_cycle_question(performance_cycle_question_id) ON DELETE RESTRICT,
  answer_text text,
  dictation_document_id uuid REFERENCES document(document_id) ON DELETE SET NULL,
  transcript text,
  ai_run_id uuid REFERENCES ai_run(run_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (performance_review_id, performance_cycle_question_id)
);
CREATE INDEX IF NOT EXISTS performance_review_answer_question_fk_idx ON performance_review_answer (performance_cycle_question_id);
CREATE INDEX IF NOT EXISTS performance_review_answer_dictation_fk_idx ON performance_review_answer (dictation_document_id);
CREATE INDEX IF NOT EXISTS performance_review_answer_ai_run_fk_idx ON performance_review_answer (ai_run_id);
CREATE OR REPLACE TRIGGER performance_review_answer_set_updated_at BEFORE UPDATE ON performance_review_answer
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- DOWN
DROP TRIGGER IF EXISTS performance_review_answer_set_updated_at ON performance_review_answer;
DROP INDEX IF EXISTS performance_review_answer_ai_run_fk_idx;
DROP INDEX IF EXISTS performance_review_answer_dictation_fk_idx;
DROP INDEX IF EXISTS performance_review_answer_question_fk_idx;
DROP TABLE IF EXISTS performance_review_answer;
DROP INDEX IF EXISTS performance_review_item_kpi_definition_fk_idx;
DROP INDEX IF EXISTS performance_review_item_target_fk_idx;
DROP INDEX IF EXISTS performance_review_item_target_uq;
ALTER TABLE performance_review_item DROP CONSTRAINT IF EXISTS performance_review_item_score_check;
DROP INDEX IF EXISTS performance_review_dictation_fk_idx;
DROP INDEX IF EXISTS performance_review_document_fk_idx;
DROP INDEX IF EXISTS performance_review_workflow_fk_idx;
DROP INDEX IF EXISTS performance_review_reviewer_fk_idx;
DROP INDEX IF EXISTS performance_review_employee_fk_idx;
DROP INDEX IF EXISTS performance_review_cycle_fk_idx;
ALTER TABLE performance_review DROP CONSTRAINT IF EXISTS performance_review_overall_score_check;
ALTER TABLE performance_review DROP CONSTRAINT IF EXISTS performance_review_status_check;
ALTER TABLE performance_review DROP COLUMN IF EXISTS closed_at; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE performance_review DROP COLUMN IF EXISTS document_id; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE performance_review DROP COLUMN IF EXISTS workflow_instance_id; -- DESTRUCTIVE: rollback only; drops what UP added
DROP TRIGGER IF EXISTS performance_cycle_question_set_updated_at ON performance_cycle_question;
DROP TABLE IF EXISTS performance_cycle_question;
DROP INDEX IF EXISTS performance_cycle_status_opens_idx;
DROP INDEX IF EXISTS performance_cycle_opened_by_fk_idx;
ALTER TABLE performance_cycle DROP CONSTRAINT IF EXISTS performance_cycle_status_check;
ALTER TABLE performance_cycle DROP COLUMN IF EXISTS opened_by; -- DESTRUCTIVE: rollback only; drops what UP added
