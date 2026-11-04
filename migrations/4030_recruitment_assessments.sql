-- M4 assessments, the sittings sent to candidates, and their answers
-- (docs/guides/recruitment.md §4, §6.7; contract packages/contract/schemas/assessments.js).
--
--   assessment_definition  + created_by (SET NULL: the assessment outlives a login); CHECKs for
--                assessment_type (seed 4099's codes), scoring_method (auto, manual, mixed, worked out
--                from the questions; default manual until it has any) and pass_score (0 to 100).
--                active now defaults to false: a new assessment is a draft until it is switched on.
--   assessment_question  CHECK question_type (choice, text, file; decided 04/11/2026) and max_score
--                (0 to 100). A choice's options are kept in options as {id, text}; each option's
--                points only in answer_key_enc, encrypted, so no read can send them to the public site.
--   application_assessment (a sitting)  + start_by: the last Lagos day the link may be started;
--                + started_at: when the candidate pressed Start (4000's starts_at stays unused);
--                + current_question: where a reopened link resumes; + sent_by (SET NULL);
--                + due_days: an untimed (take-home) sitting is due at 23:59 Lagos this many days
--                after Start, 1 to 14; null for a timed one.
--                status is sent, in_progress, submitted, timed_out, scored, expired, cancelled
--                (default sent, was assigned); score 0 to 100. One live sitting of an assessment per
--                application: 4000's unique pair is narrowed to sittings neither cancelled nor
--                expired, so a lapsed one can be sent again.
--   assessment_response  + document_id: a file answer (SET NULL); + marked_by, marked_at: who
--                marked a written or file answer. response may be null for a file answer.
-- UP
ALTER TABLE assessment_definition
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES app_user(user_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS assessment_definition_created_by_idx ON assessment_definition (created_by);
ALTER TABLE assessment_definition ALTER COLUMN active SET DEFAULT false;
ALTER TABLE assessment_definition ALTER COLUMN scoring_method SET DEFAULT 'manual';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assessment_definition_type_check') THEN
    ALTER TABLE assessment_definition ADD CONSTRAINT assessment_definition_type_check CHECK (
      assessment_type IN ('psychometric', 'technical', 'case_study', 'practical')
      AND scoring_method IN ('auto', 'manual', 'mixed')
      AND (pass_score IS NULL OR pass_score BETWEEN 0 AND 100));
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assessment_question_type_check') THEN
    ALTER TABLE assessment_question ADD CONSTRAINT assessment_question_type_check
      CHECK (question_type IN ('choice', 'text', 'file') AND max_score <= 100);
  END IF;
END;
$$;
CREATE INDEX IF NOT EXISTS assessment_question_definition_idx ON assessment_question (assessment_definition_id, display_order);

ALTER TABLE application_assessment
  ADD COLUMN IF NOT EXISTS start_by date,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS current_question integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sent_by uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS due_days integer;
UPDATE application_assessment SET status = 'sent' WHERE status = 'assigned';
UPDATE application_assessment SET start_by = (assigned_at AT TIME ZONE 'Africa/Lagos')::date + 3 WHERE start_by IS NULL;
ALTER TABLE application_assessment ALTER COLUMN status SET DEFAULT 'sent';
ALTER TABLE application_assessment ALTER COLUMN start_by SET NOT NULL; -- DESTRUCTIVE: every row was given a start-by day above
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'application_assessment_status_check') THEN
    ALTER TABLE application_assessment ADD CONSTRAINT application_assessment_status_check CHECK (
      status IN ('sent', 'in_progress', 'submitted', 'timed_out', 'scored', 'expired', 'cancelled')
      AND current_question >= 0
      AND (due_days IS NULL OR due_days BETWEEN 1 AND 14)
      AND (score IS NULL OR score BETWEEN 0 AND 100)
      AND (status = 'sent' OR status IN ('expired', 'cancelled') OR started_at IS NOT NULL));
  END IF;
END;
$$;
-- 4000's UNIQUE (application_id, assessment_definition_id), by the name PostgreSQL gave it (63 characters).
ALTER TABLE application_assessment
  DROP CONSTRAINT IF EXISTS application_assessment_application_id_assessment_definition_key;
CREATE UNIQUE INDEX IF NOT EXISTS application_assessment_live_key ON application_assessment (application_id, assessment_definition_id)
  WHERE status NOT IN ('cancelled', 'expired');
CREATE INDEX IF NOT EXISTS application_assessment_application_idx ON application_assessment (application_id);
CREATE INDEX IF NOT EXISTS application_assessment_definition_idx ON application_assessment (assessment_definition_id);
CREATE INDEX IF NOT EXISTS application_assessment_public_token_idx ON application_assessment (public_token_id);
CREATE INDEX IF NOT EXISTS application_assessment_sent_by_idx ON application_assessment (sent_by);
CREATE INDEX IF NOT EXISTS application_assessment_status_idx ON application_assessment (status, submitted_at);
CREATE INDEX IF NOT EXISTS application_assessment_assigned_at_idx ON application_assessment (assigned_at);
CREATE INDEX IF NOT EXISTS application_assessment_submitted_at_idx ON application_assessment (submitted_at);
-- The clock (assessment-expire): sittings running past their time, and links never started.
CREATE INDEX IF NOT EXISTS application_assessment_due_idx ON application_assessment (due_at) WHERE status = 'in_progress';
CREATE INDEX IF NOT EXISTS application_assessment_start_by_idx ON application_assessment (start_by) WHERE status = 'sent';

ALTER TABLE assessment_response
  ADD COLUMN IF NOT EXISTS document_id uuid REFERENCES document(document_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS marked_by uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS marked_at timestamptz;
ALTER TABLE assessment_response ALTER COLUMN response DROP NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assessment_response_awarded_check') THEN
    ALTER TABLE assessment_response ADD CONSTRAINT assessment_response_awarded_check
      CHECK (awarded_score IS NULL OR awarded_score BETWEEN 0 AND 100);
  END IF;
END;
$$;
CREATE INDEX IF NOT EXISTS assessment_response_question_idx ON assessment_response (assessment_question_id);
CREATE INDEX IF NOT EXISTS assessment_response_document_idx ON assessment_response (document_id);
CREATE INDEX IF NOT EXISTS assessment_response_marked_by_idx ON assessment_response (marked_by);

-- DOWN
DROP INDEX IF EXISTS assessment_response_marked_by_idx;
DROP INDEX IF EXISTS assessment_response_document_idx;
DROP INDEX IF EXISTS assessment_response_question_idx;
ALTER TABLE assessment_response DROP CONSTRAINT IF EXISTS assessment_response_awarded_check;
-- A file answer has no response; 4000 required one.
UPDATE assessment_response SET response = '{}'::jsonb WHERE response IS NULL;
ALTER TABLE assessment_response ALTER COLUMN response SET NOT NULL; -- DESTRUCTIVE: rollback only; every row was given one above
ALTER TABLE assessment_response
  DROP COLUMN IF EXISTS marked_at, -- DESTRUCTIVE: rollback only; drops what UP added
  DROP COLUMN IF EXISTS marked_by,
  DROP COLUMN IF EXISTS document_id;

DROP INDEX IF EXISTS application_assessment_start_by_idx;
DROP INDEX IF EXISTS application_assessment_due_idx;
DROP INDEX IF EXISTS application_assessment_submitted_at_idx;
DROP INDEX IF EXISTS application_assessment_assigned_at_idx;
DROP INDEX IF EXISTS application_assessment_status_idx;
DROP INDEX IF EXISTS application_assessment_sent_by_idx;
DROP INDEX IF EXISTS application_assessment_public_token_idx;
DROP INDEX IF EXISTS application_assessment_definition_idx;
DROP INDEX IF EXISTS application_assessment_application_idx;
DROP INDEX IF EXISTS application_assessment_live_key;
-- DESTRUCTIVE: rollback only; 4000 allowed one sitting a pair, so each pair keeps its live sitting,
-- or else its latest lapsed one, and the other lapsed ones are removed.
DELETE FROM application_assessment a
 USING (SELECT application_assessment_id,
               row_number() OVER (PARTITION BY application_id, assessment_definition_id
                                  ORDER BY (status NOT IN ('cancelled', 'expired')) DESC, assigned_at DESC,
                                           application_assessment_id) AS n
          FROM application_assessment) r
 WHERE r.application_assessment_id = a.application_assessment_id AND r.n > 1;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'application_assessment_application_id_assessment_definition_key') THEN
    ALTER TABLE application_assessment ADD CONSTRAINT application_assessment_application_id_assessment_definition_key
      UNIQUE (application_id, assessment_definition_id);
  END IF;
END;
$$;
ALTER TABLE application_assessment DROP CONSTRAINT IF EXISTS application_assessment_status_check;
ALTER TABLE application_assessment ALTER COLUMN status SET DEFAULT 'assigned';
UPDATE application_assessment SET status = 'assigned' WHERE status = 'sent';
ALTER TABLE application_assessment
  DROP COLUMN IF EXISTS due_days, -- DESTRUCTIVE: rollback only; drops what UP added
  DROP COLUMN IF EXISTS sent_by,
  DROP COLUMN IF EXISTS current_question,
  DROP COLUMN IF EXISTS started_at,
  DROP COLUMN IF EXISTS start_by;

DROP INDEX IF EXISTS assessment_question_definition_idx;
ALTER TABLE assessment_question DROP CONSTRAINT IF EXISTS assessment_question_type_check;
ALTER TABLE assessment_definition DROP CONSTRAINT IF EXISTS assessment_definition_type_check;
ALTER TABLE assessment_definition ALTER COLUMN scoring_method DROP DEFAULT;
ALTER TABLE assessment_definition ALTER COLUMN active SET DEFAULT true;
DROP INDEX IF EXISTS assessment_definition_created_by_idx;
ALTER TABLE assessment_definition DROP COLUMN IF EXISTS created_by; -- DESTRUCTIVE: rollback only; drops what UP added
