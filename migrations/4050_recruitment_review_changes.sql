-- M4 the internal Modules Review of 04/11/2026 and MyCity's documents: the interview card, screening
-- conditions, scorecard parts on or off, untimed assessments, applications from the pool
-- (docs/guides/recruitment.md §6.1 to §6.7; MILESTONES §9, decided 04/11/2026).
--
--   vacancy          + screening_conditions: the one to three must-meet conditions Screen All With AI
--                      asked for, kept for later reads; + working_days: "Monday to Saturday", from
--                      MyCity's job description.
--   recruitment_scorecard_criterion  + active: the part is used for this role; a part switched off
--                      weighs 0.
--   application      source may be pool (Invite to Apply from the Talent Pool).
--   application_assessment  + due_days: an untimed (take-home) sitting is due at 23:59 Lagos this many
--                      days after Start; null for a timed one.
--   interview_round  + decision (select, on_hold, reject), replacing 4040's recommendation (added on
--                      this branch, never written); + current_employer, academics (outstanding,
--                      very_good, good, average, poor), total_experience_months,
--                      relevant_experience_months: the card's Candidate Details, filled once;
--                      + form_document_id: the Interview Assessment Form PDF (SET NULL).
--   interview_feedback  overall_rating 1 to 10; + decision, the panelist's own (4000's recommendation
--                      stays unused).
--   interview_rating rating 1 to 10, as MyCity's form grades each trait.
-- UP
ALTER TABLE vacancy
  ADD COLUMN IF NOT EXISTS screening_conditions text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS working_days text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vacancy_screening_conditions_check') THEN
    ALTER TABLE vacancy ADD CONSTRAINT vacancy_screening_conditions_check
      CHECK (cardinality(screening_conditions) <= 3);
  END IF;
END;
$$;

ALTER TABLE recruitment_scorecard_criterion ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recruitment_scorecard_criterion_active_check') THEN
    ALTER TABLE recruitment_scorecard_criterion ADD CONSTRAINT recruitment_scorecard_criterion_active_check
      CHECK (active OR weight = 0);
  END IF;
END;
$$;

ALTER TABLE application DROP CONSTRAINT IF EXISTS application_source_check;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'application_source_pool_check') THEN
    ALTER TABLE application ADD CONSTRAINT application_source_pool_check
      CHECK (source IS NULL OR source IN ('careers', 'invited', 'pool'));
  END IF;
END;
$$;

ALTER TABLE application_assessment ADD COLUMN IF NOT EXISTS due_days integer;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'application_assessment_due_days_check') THEN
    ALTER TABLE application_assessment ADD CONSTRAINT application_assessment_due_days_check
      CHECK (due_days IS NULL OR due_days BETWEEN 1 AND 14);
  END IF;
END;
$$;

ALTER TABLE interview_round DROP CONSTRAINT IF EXISTS interview_round_status_check;
-- DESTRUCTIVE: added by 4040 on this branch and never written; the round's call is now decision.
ALTER TABLE interview_round DROP COLUMN IF EXISTS recommendation;
ALTER TABLE interview_round
  ADD COLUMN IF NOT EXISTS decision text,
  ADD COLUMN IF NOT EXISTS current_employer text,
  ADD COLUMN IF NOT EXISTS academics text,
  ADD COLUMN IF NOT EXISTS total_experience_months integer,
  ADD COLUMN IF NOT EXISTS relevant_experience_months integer,
  ADD COLUMN IF NOT EXISTS form_document_id uuid REFERENCES document(document_id) ON DELETE SET NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'interview_round_card_check') THEN
    ALTER TABLE interview_round ADD CONSTRAINT interview_round_card_check CHECK (
      status IN ('open', 'closed')
      AND (status = 'closed') = (closed_at IS NOT NULL)
      AND (decision IS NULL OR decision IN ('select', 'on_hold', 'reject'))
      AND (report IS NULL OR status = 'closed')
      AND (interview_score IS NULL OR interview_score BETWEEN 0 AND 100)
      AND (academics IS NULL OR academics IN ('outstanding', 'very_good', 'good', 'average', 'poor'))
      AND (total_experience_months IS NULL OR total_experience_months BETWEEN 0 AND 720)
      AND (relevant_experience_months IS NULL OR relevant_experience_months BETWEEN 0 AND 720));
  END IF;
END;
$$;
CREATE INDEX IF NOT EXISTS interview_round_form_document_idx ON interview_round (form_document_id);

ALTER TABLE interview_feedback DROP CONSTRAINT IF EXISTS interview_feedback_values_check;
ALTER TABLE interview_feedback ADD COLUMN IF NOT EXISTS decision text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'interview_feedback_card_check') THEN
    ALTER TABLE interview_feedback ADD CONSTRAINT interview_feedback_card_check CHECK (
      (overall_rating IS NULL OR overall_rating BETWEEN 1 AND 10)
      AND (decision IS NULL OR decision IN ('select', 'on_hold', 'reject'))
      AND (submitted_at IS NULL OR decision IS NOT NULL));
  END IF;
END;
$$;

ALTER TABLE interview_rating DROP CONSTRAINT IF EXISTS interview_rating_rating_check;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'interview_rating_range_check') THEN
    ALTER TABLE interview_rating ADD CONSTRAINT interview_rating_range_check CHECK (rating BETWEEN 1 AND 10);
  END IF;
END;
$$;

-- DOWN
ALTER TABLE interview_rating DROP CONSTRAINT IF EXISTS interview_rating_range_check;
-- DESTRUCTIVE: rollback only; 4040 rated 1 to 5, so ratings above 5 are brought down to 5.
UPDATE interview_rating SET rating = 5 WHERE rating > 5;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'interview_rating_rating_check') THEN
    ALTER TABLE interview_rating ADD CONSTRAINT interview_rating_rating_check CHECK (rating BETWEEN 1 AND 5);
  END IF;
END;
$$;

ALTER TABLE interview_feedback DROP CONSTRAINT IF EXISTS interview_feedback_card_check;
ALTER TABLE interview_feedback DROP COLUMN IF EXISTS decision; -- DESTRUCTIVE: rollback only; drops what UP added
-- DESTRUCTIVE: rollback only; 4040 rated 1 to 5, and a submitted card needed a recommendation.
UPDATE interview_feedback SET overall_rating = 5 WHERE overall_rating > 5;
DELETE FROM interview_feedback WHERE submitted_at IS NOT NULL AND recommendation IS NULL;
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

DROP INDEX IF EXISTS interview_round_form_document_idx;
ALTER TABLE interview_round DROP CONSTRAINT IF EXISTS interview_round_card_check;
ALTER TABLE interview_round
  DROP COLUMN IF EXISTS form_document_id, -- DESTRUCTIVE: rollback only; drops what UP added
  DROP COLUMN IF EXISTS relevant_experience_months,
  DROP COLUMN IF EXISTS total_experience_months,
  DROP COLUMN IF EXISTS academics,
  DROP COLUMN IF EXISTS current_employer,
  DROP COLUMN IF EXISTS decision;
ALTER TABLE interview_round ADD COLUMN IF NOT EXISTS recommendation text;
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

ALTER TABLE application_assessment DROP CONSTRAINT IF EXISTS application_assessment_due_days_check;
ALTER TABLE application_assessment DROP COLUMN IF EXISTS due_days; -- DESTRUCTIVE: rollback only; drops what UP added

ALTER TABLE application DROP CONSTRAINT IF EXISTS application_source_pool_check;
-- DESTRUCTIVE: rollback only; 4020 knew no pool source, so those applications read as invited.
UPDATE application SET source = 'invited' WHERE source = 'pool';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'application_source_check') THEN
    ALTER TABLE application ADD CONSTRAINT application_source_check
      CHECK (source IS NULL OR source IN ('careers', 'invited'));
  END IF;
END;
$$;

ALTER TABLE recruitment_scorecard_criterion DROP CONSTRAINT IF EXISTS recruitment_scorecard_criterion_active_check;
ALTER TABLE recruitment_scorecard_criterion DROP COLUMN IF EXISTS active; -- DESTRUCTIVE: rollback only; drops what UP added

ALTER TABLE vacancy DROP CONSTRAINT IF EXISTS vacancy_screening_conditions_check;
ALTER TABLE vacancy
  DROP COLUMN IF EXISTS working_days, -- DESTRUCTIVE: rollback only; drops what UP added
  DROP COLUMN IF EXISTS screening_conditions;
