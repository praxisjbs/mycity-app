-- M4 blind panel interviews: the round's state, the consolidated report, each panelist's draft and
-- submitted feedback, and one rating a panelist a question (docs/guides/recruitment.md §4, §6.6;
-- contract packages/contract/schemas/interviews.js; A10 steps 1 to 4).
--
--   interview_round  status is open or closed (default open, was scheduled); closed_at is set
--                exactly when it is closed; + closed_by (SET NULL); + report, recommendation
--                (advance, hold, not_progress), reported_by (SET NULL), reported_at: the consolidated
--                report; + interview_score 0 to 100: the panel's mean overall rating times 20, set
--                when it closes. Round membership is its interview's panel.
--   interview    CHECKs interview_type (in_person, video, phone) and status (scheduled, done,
--                cancelled); + worksite_id: where an in-person interview is (SET NULL), never a
--                typed address, so 4000's location stays unused; + calendar_event_id: the
--                panelists' calendar entry (SET NULL).
--   interview_feedback  a draft until submitted: submitted_at and recommendation may be null;
--                + overall_rating 1 to 5 (required at submit, by the service); + comments: what
--                the rest of the panel reads once the round closes. private_notes stay the
--                author's only. 4000's scorecard jsonb stays unused: ratings are rows.
--   interview_rating  new: one rating (1 to 5) a feedback a vacancy interview question, so each
--                panelist rates each question once (A10 step 1: the rater is in the key through the
--                feedback). RESTRICT on the question: a rated question is retired, never deleted.
-- UP
ALTER TABLE interview_round
  ADD COLUMN IF NOT EXISTS closed_by uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS report text,
  ADD COLUMN IF NOT EXISTS recommendation text,
  ADD COLUMN IF NOT EXISTS reported_by uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reported_at timestamptz,
  ADD COLUMN IF NOT EXISTS interview_score numeric(5,2);
UPDATE interview_round SET status = CASE WHEN closed_at IS NULL THEN 'open' ELSE 'closed' END
 WHERE status NOT IN ('open', 'closed');
ALTER TABLE interview_round ALTER COLUMN status SET DEFAULT 'open';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'interview_round_status_check') THEN
    ALTER TABLE interview_round ADD CONSTRAINT interview_round_status_check CHECK (
      status IN ('open', 'closed')
      AND (status = 'closed') = (closed_at IS NOT NULL)
      AND (recommendation IS NULL OR recommendation IN ('advance', 'hold', 'not_progress'))
      AND (report IS NULL OR status = 'closed')
      AND (interview_score IS NULL OR interview_score BETWEEN 0 AND 100));
  END IF;
END;
$$;
CREATE INDEX IF NOT EXISTS interview_round_closed_by_idx ON interview_round (closed_by);
CREATE INDEX IF NOT EXISTS interview_round_reported_by_idx ON interview_round (reported_by);

ALTER TABLE interview
  ADD COLUMN IF NOT EXISTS worksite_id uuid REFERENCES worksite(worksite_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS calendar_event_id uuid REFERENCES calendar_event(calendar_event_id) ON DELETE SET NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'interview_type_status_check') THEN
    ALTER TABLE interview ADD CONSTRAINT interview_type_status_check CHECK (
      interview_type IN ('in_person', 'video', 'phone')
      AND status IN ('scheduled', 'done', 'cancelled'));
  END IF;
END;
$$;
CREATE INDEX IF NOT EXISTS interview_interview_round_id_idx ON interview (interview_round_id);
CREATE INDEX IF NOT EXISTS interview_scheduled_start_idx ON interview (scheduled_start);
CREATE INDEX IF NOT EXISTS interview_created_by_idx ON interview (created_by);
CREATE INDEX IF NOT EXISTS interview_worksite_id_idx ON interview (worksite_id);
CREATE INDEX IF NOT EXISTS interview_calendar_event_id_idx ON interview (calendar_event_id);

CREATE INDEX IF NOT EXISTS interview_panelist_employee_idx ON interview_panelist (employee_id);

ALTER TABLE interview_feedback
  ADD COLUMN IF NOT EXISTS overall_rating smallint,
  ADD COLUMN IF NOT EXISTS comments text;
ALTER TABLE interview_feedback ALTER COLUMN submitted_at DROP NOT NULL;
ALTER TABLE interview_feedback ALTER COLUMN recommendation DROP NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'interview_feedback_values_check') THEN
    ALTER TABLE interview_feedback ADD CONSTRAINT interview_feedback_values_check CHECK (
      (overall_rating IS NULL OR overall_rating BETWEEN 1 AND 5)
      AND (recommendation IS NULL OR recommendation IN ('strong_yes', 'yes', 'no', 'strong_no'))
      AND (submitted_at IS NULL OR (overall_rating IS NOT NULL AND recommendation IS NOT NULL)));
  END IF;
END;
$$;
CREATE INDEX IF NOT EXISTS interview_feedback_ai_run_id_idx ON interview_feedback (ai_run_id);

CREATE TABLE IF NOT EXISTS interview_rating (
  interview_rating_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  interview_feedback_id uuid NOT NULL REFERENCES interview_feedback(interview_feedback_id) ON DELETE CASCADE,
  vacancy_question_id uuid NOT NULL REFERENCES vacancy_question(vacancy_question_id) ON DELETE RESTRICT,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (interview_feedback_id, vacancy_question_id)
);
CREATE INDEX IF NOT EXISTS interview_rating_question_idx ON interview_rating (vacancy_question_id);
CREATE OR REPLACE TRIGGER interview_rating_set_updated_at BEFORE UPDATE ON interview_rating
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- DOWN
DROP TRIGGER IF EXISTS interview_rating_set_updated_at ON interview_rating;
DROP INDEX IF EXISTS interview_rating_question_idx;
DROP TABLE IF EXISTS interview_rating; -- DESTRUCTIVE: rollback only; drops what UP added

DROP INDEX IF EXISTS interview_feedback_ai_run_id_idx;
ALTER TABLE interview_feedback DROP CONSTRAINT IF EXISTS interview_feedback_values_check;
-- DESTRUCTIVE: rollback only; 4000 knew no drafts, so feedback never submitted is removed.
DELETE FROM interview_feedback WHERE submitted_at IS NULL OR recommendation IS NULL;
ALTER TABLE interview_feedback ALTER COLUMN recommendation SET NOT NULL; -- DESTRUCTIVE: rollback only; drafts removed above
ALTER TABLE interview_feedback ALTER COLUMN submitted_at SET NOT NULL; -- DESTRUCTIVE: rollback only; drafts removed above
ALTER TABLE interview_feedback
  DROP COLUMN IF EXISTS comments, -- DESTRUCTIVE: rollback only; drops what UP added
  DROP COLUMN IF EXISTS overall_rating;

DROP INDEX IF EXISTS interview_panelist_employee_idx;

DROP INDEX IF EXISTS interview_calendar_event_id_idx;
DROP INDEX IF EXISTS interview_worksite_id_idx;
DROP INDEX IF EXISTS interview_created_by_idx;
DROP INDEX IF EXISTS interview_scheduled_start_idx;
DROP INDEX IF EXISTS interview_interview_round_id_idx;
ALTER TABLE interview DROP CONSTRAINT IF EXISTS interview_type_status_check;
ALTER TABLE interview
  DROP COLUMN IF EXISTS calendar_event_id, -- DESTRUCTIVE: rollback only; drops what UP added
  DROP COLUMN IF EXISTS worksite_id;

DROP INDEX IF EXISTS interview_round_reported_by_idx;
DROP INDEX IF EXISTS interview_round_closed_by_idx;
ALTER TABLE interview_round DROP CONSTRAINT IF EXISTS interview_round_status_check;
ALTER TABLE interview_round ALTER COLUMN status SET DEFAULT 'scheduled';
ALTER TABLE interview_round
  DROP COLUMN IF EXISTS interview_score, -- DESTRUCTIVE: rollback only; drops what UP added
  DROP COLUMN IF EXISTS reported_at,
  DROP COLUMN IF EXISTS reported_by,
  DROP COLUMN IF EXISTS recommendation,
  DROP COLUMN IF EXISTS report,
  DROP COLUMN IF EXISTS closed_by;
