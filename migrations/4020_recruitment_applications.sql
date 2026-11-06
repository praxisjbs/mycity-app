-- M4 an application as Apply writes it and the pipeline moves it
-- (docs/guides/recruitment.md §4, §6.2 to §6.4; contract packages/contract/schemas/candidates.js).
--
--   application  + number: APP-0001, from numbering (seed 4199), the reference a candidate is given;
--                + years_experience, consented_at: from the Apply form;
--                + screening_score, screening_summary, screening_ai_run_id, screened_at: the AI read
--                  of the CV, made only when a person presses Score With AI (decided 04/11/2026).
--                  provisional_score (4000) is the free estimate; provisional_ai_run_id (4000)
--                  stays unused, since the estimate is arithmetic and has no run.
--                The CHECKs are the contract's enums: stage is every code of the pipeline (M4 uses
--                the first five, M5 the rest), status as candidates.js. Scores are 0 to 100.
--                source is careers, invited (Invite to Apply on a vacancy) or pool (Invite to Apply
--                from the Talent Pool), default careers and never null.
--                Indexes: every foreign key, stage, current_stage_entered_at (the board's sort), and
--                (status, current_stage_entered_at) for Home's Recruitment SLA sweep (Home's owes).
--   application_stage_history  dropped: it was never written; a move is a row of the shared
--                entity_state_history (shared/state/state-history, entity_type application).
-- UP
ALTER TABLE application
  ADD COLUMN IF NOT EXISTS number citext,
  ADD COLUMN IF NOT EXISTS years_experience integer,
  ADD COLUMN IF NOT EXISTS consented_at timestamptz,
  ADD COLUMN IF NOT EXISTS screening_score numeric(5,2),
  ADD COLUMN IF NOT EXISTS screening_summary text,
  ADD COLUMN IF NOT EXISTS screening_ai_run_id uuid REFERENCES ai_run(run_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS screened_at timestamptz;
-- No application was written before this file (the module was empty); any that were get a number.
UPDATE application SET number = 'APP-' || upper(left(application_id::text, 8)) WHERE number IS NULL;
ALTER TABLE application ALTER COLUMN number SET NOT NULL; -- DESTRUCTIVE: every row was numbered above
UPDATE application SET source = 'careers' WHERE source IS NULL;
ALTER TABLE application ALTER COLUMN source SET DEFAULT 'careers';
ALTER TABLE application ALTER COLUMN source SET NOT NULL; -- DESTRUCTIVE: every row was given a source above
CREATE UNIQUE INDEX IF NOT EXISTS application_number_key ON application (number);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'application_stage_check') THEN
    ALTER TABLE application ADD CONSTRAINT application_stage_check CHECK (stage IN (
      'application', 'screening', 'assessment', 'interview', 'shortlist',
      'offer', 'documentation', 'pre_onboarding', 'onboarding', 'hired'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'application_status_check') THEN
    ALTER TABLE application ADD CONSTRAINT application_status_check
      CHECK (status IN ('active', 'not_progressed', 'withdrawn', 'hired'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'application_source_check') THEN
    ALTER TABLE application ADD CONSTRAINT application_source_check
      CHECK (source IN ('careers', 'invited', 'pool'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'application_scores_check') THEN
    ALTER TABLE application ADD CONSTRAINT application_scores_check CHECK (
      (provisional_score IS NULL OR provisional_score BETWEEN 0 AND 100)
      AND (screening_score IS NULL OR screening_score BETWEEN 0 AND 100)
      AND (years_experience IS NULL OR years_experience BETWEEN 0 AND 60));
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS application_status_stage_since_idx ON application (status, current_stage_entered_at);
CREATE INDEX IF NOT EXISTS application_vacancy_stage_idx ON application (vacancy_id, stage);
CREATE INDEX IF NOT EXISTS application_stage_idx ON application (stage);
CREATE INDEX IF NOT EXISTS application_stage_since_idx ON application (current_stage_entered_at);
CREATE INDEX IF NOT EXISTS application_candidate_id_idx ON application (candidate_id);
CREATE INDEX IF NOT EXISTS application_applied_at_idx ON application (applied_at);
CREATE INDEX IF NOT EXISTS application_cv_document_id_idx ON application (cv_document_id);
CREATE INDEX IF NOT EXISTS application_provisional_ai_run_id_idx ON application (provisional_ai_run_id);
CREATE INDEX IF NOT EXISTS application_screening_ai_run_id_idx ON application (screening_ai_run_id);

-- DESTRUCTIVE: never written by any code (the module was empty); stage moves are entity_state_history rows.
DROP TABLE IF EXISTS application_stage_history;

-- DOWN
CREATE TABLE IF NOT EXISTS application_stage_history (
  application_stage_history_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES application(application_id) ON DELETE CASCADE,
  from_stage text,
  to_stage text NOT NULL,
  changed_by uuid REFERENCES app_user(user_id),
  reason text,
  entered_at timestamptz NOT NULL DEFAULT now(),
  exited_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP INDEX IF EXISTS application_screening_ai_run_id_idx;
DROP INDEX IF EXISTS application_provisional_ai_run_id_idx;
DROP INDEX IF EXISTS application_cv_document_id_idx;
DROP INDEX IF EXISTS application_applied_at_idx;
DROP INDEX IF EXISTS application_candidate_id_idx;
DROP INDEX IF EXISTS application_stage_since_idx;
DROP INDEX IF EXISTS application_stage_idx;
DROP INDEX IF EXISTS application_vacancy_stage_idx;
DROP INDEX IF EXISTS application_status_stage_since_idx;
ALTER TABLE application DROP CONSTRAINT IF EXISTS application_scores_check;
ALTER TABLE application DROP CONSTRAINT IF EXISTS application_source_check;
ALTER TABLE application DROP CONSTRAINT IF EXISTS application_status_check;
ALTER TABLE application DROP CONSTRAINT IF EXISTS application_stage_check;
DROP INDEX IF EXISTS application_number_key;
ALTER TABLE application ALTER COLUMN source DROP NOT NULL;
ALTER TABLE application ALTER COLUMN source DROP DEFAULT;
ALTER TABLE application
  DROP COLUMN IF EXISTS screened_at, -- DESTRUCTIVE: rollback only; drops what UP added
  DROP COLUMN IF EXISTS screening_ai_run_id,
  DROP COLUMN IF EXISTS screening_summary,
  DROP COLUMN IF EXISTS screening_score,
  DROP COLUMN IF EXISTS consented_at,
  DROP COLUMN IF EXISTS years_experience,
  DROP COLUMN IF EXISTS number;
