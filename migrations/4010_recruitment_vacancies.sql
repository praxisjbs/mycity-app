-- M4 a vacancy as New Vacancy writes it, its questions and its scorecard weights
-- (docs/guides/recruitment.md §4, §6.1, §6.5; contract packages/contract/schemas/vacancies.js).
--
--   vacancy  + org_seat_id: the organogram's vacant seat it fills (SET NULL: the vacancy outlives a
--              seat closed later); + employment_type, work_pattern_note, location (the line of the
--              place picked at level area, owner vacancy.location), probation_months, reports_to,
--              min_experience_years, salary_min, salary_max, salary_visible, nice_to_have,
--              target_start_on: the fields of New Vacancy and the public page; + published_at,
--              paused_at, closed_at, close_reason: the lifecycle draft, open, paused, closed;
--              + description_ai_run_id: the Write With AI run a description was drafted by;
--              + working_days ("Monday to Saturday", MyCity's job description); + screening_conditions:
--              the one to three must-meet conditions Screen With AI last asked for.
--              slug may be null: a draft has none until it is first published, and it never
--              changes after (MILESTONES §9, decided 04/11/2026); a draft never published may close
--              without one.
--              The CHECKs are the contract's enums; status is now checked (Home's owes).
--              Indexes: every foreign key, and status (Home's open count), closes_at, published_at.
--   vacancy_question  + purpose: application (asked on Apply) or interview (rated by each
--              panelist); + active: a question answered or rated is retired, never deleted.
--   recruitment_scorecard_criterion  weights 0 to 100 (0 leaves a part out; 4000 refused 0); the
--              five codes of A10; source_type is screening, assessment or interview; + active: the part
--              is used for this role (decided 04/11/2026), and a part switched off weighs 0.
-- UP
ALTER TABLE vacancy ALTER COLUMN slug DROP NOT NULL;
ALTER TABLE vacancy
  ADD COLUMN IF NOT EXISTS org_seat_id uuid REFERENCES org_seat(org_seat_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS employment_type text,
  ADD COLUMN IF NOT EXISTS work_pattern_note text,
  ADD COLUMN IF NOT EXISTS location text,
  ADD COLUMN IF NOT EXISTS probation_months integer,
  ADD COLUMN IF NOT EXISTS reports_to text,
  ADD COLUMN IF NOT EXISTS min_experience_years integer,
  ADD COLUMN IF NOT EXISTS salary_min numeric(18,2),
  ADD COLUMN IF NOT EXISTS salary_max numeric(18,2),
  ADD COLUMN IF NOT EXISTS salary_visible boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS nice_to_have text,
  ADD COLUMN IF NOT EXISTS target_start_on date,
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD COLUMN IF NOT EXISTS paused_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS close_reason text,
  ADD COLUMN IF NOT EXISTS description_ai_run_id uuid REFERENCES ai_run(run_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS working_days text,
  ADD COLUMN IF NOT EXISTS screening_conditions text[] NOT NULL DEFAULT '{}';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vacancy_status_check') THEN
    ALTER TABLE vacancy ADD CONSTRAINT vacancy_status_check CHECK (status IN ('draft', 'open', 'paused', 'closed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vacancy_work_pattern_check') THEN
    ALTER TABLE vacancy ADD CONSTRAINT vacancy_work_pattern_check
      CHECK (work_pattern IS NULL OR work_pattern IN ('on_site', 'hybrid', 'remote'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vacancy_employment_type_check') THEN
    ALTER TABLE vacancy ADD CONSTRAINT vacancy_employment_type_check
      CHECK (employment_type IS NULL OR employment_type IN ('full_time', 'part_time', 'contract', 'internship'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vacancy_close_reason_check') THEN
    ALTER TABLE vacancy ADD CONSTRAINT vacancy_close_reason_check
      CHECK (close_reason IS NULL OR (status = 'closed' AND close_reason IN ('filled', 'cancelled', 'on_hold')));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vacancy_published_slug_check') THEN
    ALTER TABLE vacancy ADD CONSTRAINT vacancy_published_slug_check CHECK (published_at IS NULL OR slug IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vacancy_numbers_check') THEN
    ALTER TABLE vacancy ADD CONSTRAINT vacancy_numbers_check CHECK (
      (probation_months IS NULL OR probation_months BETWEEN 0 AND 24)
      AND (min_experience_years IS NULL OR min_experience_years BETWEEN 0 AND 40)
      AND (salary_min IS NULL OR salary_min >= 0)
      AND (salary_max IS NULL OR salary_max >= 0)
      AND (salary_min IS NULL OR salary_max IS NULL OR salary_max >= salary_min)
      AND cardinality(screening_conditions) <= 3);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS vacancy_status_idx ON vacancy (status);
CREATE INDEX IF NOT EXISTS vacancy_closes_at_idx ON vacancy (closes_at);
CREATE INDEX IF NOT EXISTS vacancy_published_at_idx ON vacancy (published_at);
CREATE INDEX IF NOT EXISTS vacancy_title_idx ON vacancy (title);
CREATE INDEX IF NOT EXISTS vacancy_created_at_idx ON vacancy (created_at);
CREATE INDEX IF NOT EXISTS vacancy_department_id_idx ON vacancy (department_id);
CREATE INDEX IF NOT EXISTS vacancy_hiring_manager_id_idx ON vacancy (hiring_manager_id);
CREATE INDEX IF NOT EXISTS vacancy_worksite_id_idx ON vacancy (worksite_id);
CREATE INDEX IF NOT EXISTS vacancy_created_by_idx ON vacancy (created_by);
CREATE INDEX IF NOT EXISTS vacancy_org_seat_id_idx ON vacancy (org_seat_id);
CREATE INDEX IF NOT EXISTS vacancy_description_ai_run_id_idx ON vacancy (description_ai_run_id);

ALTER TABLE vacancy_question
  ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'application',
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vacancy_question_purpose_check') THEN
    ALTER TABLE vacancy_question ADD CONSTRAINT vacancy_question_purpose_check
      CHECK (purpose IN ('application', 'interview'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vacancy_question_type_check') THEN
    ALTER TABLE vacancy_question ADD CONSTRAINT vacancy_question_type_check
      CHECK (question_type IN ('text', 'yes_no', 'choice', 'rating') AND (purpose = 'interview') = (question_type = 'rating'));
  END IF;
END;
$$;
CREATE INDEX IF NOT EXISTS vacancy_question_vacancy_idx ON vacancy_question (vacancy_id, purpose, display_order);

ALTER TABLE recruitment_scorecard_criterion DROP CONSTRAINT IF EXISTS recruitment_scorecard_criterion_weight_check;
ALTER TABLE recruitment_scorecard_criterion ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recruitment_scorecard_criterion_weight_range_check') THEN
    ALTER TABLE recruitment_scorecard_criterion ADD CONSTRAINT recruitment_scorecard_criterion_weight_range_check
      CHECK (weight >= 0 AND weight <= 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recruitment_scorecard_criterion_code_check') THEN
    ALTER TABLE recruitment_scorecard_criterion ADD CONSTRAINT recruitment_scorecard_criterion_code_check
      CHECK (code IN ('screening', 'psychometric', 'technical', 'case_study', 'interview')
             AND source_type IN ('screening', 'assessment', 'interview')
             AND (active OR weight = 0));
  END IF;
END;
$$;

-- DOWN
ALTER TABLE recruitment_scorecard_criterion DROP CONSTRAINT IF EXISTS recruitment_scorecard_criterion_code_check;
ALTER TABLE recruitment_scorecard_criterion DROP CONSTRAINT IF EXISTS recruitment_scorecard_criterion_weight_range_check;
ALTER TABLE recruitment_scorecard_criterion DROP COLUMN IF EXISTS active; -- DESTRUCTIVE: rollback only; drops what UP added
-- DESTRUCTIVE: rollback only; a part weighted 0 cannot be kept under 4000's rule, so it is removed.
DELETE FROM recruitment_scorecard_criterion WHERE weight = 0;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recruitment_scorecard_criterion_weight_check') THEN
    ALTER TABLE recruitment_scorecard_criterion ADD CONSTRAINT recruitment_scorecard_criterion_weight_check
      CHECK (weight > 0 AND weight <= 100);
  END IF;
END;
$$;

DROP INDEX IF EXISTS vacancy_question_vacancy_idx;
ALTER TABLE vacancy_question DROP CONSTRAINT IF EXISTS vacancy_question_type_check;
ALTER TABLE vacancy_question DROP CONSTRAINT IF EXISTS vacancy_question_purpose_check;
ALTER TABLE vacancy_question DROP COLUMN IF EXISTS active; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE vacancy_question DROP COLUMN IF EXISTS purpose; -- DESTRUCTIVE: rollback only; drops what UP added

DROP INDEX IF EXISTS vacancy_description_ai_run_id_idx;
DROP INDEX IF EXISTS vacancy_org_seat_id_idx;
DROP INDEX IF EXISTS vacancy_created_by_idx;
DROP INDEX IF EXISTS vacancy_worksite_id_idx;
DROP INDEX IF EXISTS vacancy_hiring_manager_id_idx;
DROP INDEX IF EXISTS vacancy_department_id_idx;
DROP INDEX IF EXISTS vacancy_created_at_idx;
DROP INDEX IF EXISTS vacancy_title_idx;
DROP INDEX IF EXISTS vacancy_published_at_idx;
DROP INDEX IF EXISTS vacancy_closes_at_idx;
DROP INDEX IF EXISTS vacancy_status_idx;
ALTER TABLE vacancy DROP CONSTRAINT IF EXISTS vacancy_numbers_check;
ALTER TABLE vacancy DROP CONSTRAINT IF EXISTS vacancy_published_slug_check;
ALTER TABLE vacancy DROP CONSTRAINT IF EXISTS vacancy_close_reason_check;
ALTER TABLE vacancy DROP CONSTRAINT IF EXISTS vacancy_employment_type_check;
ALTER TABLE vacancy DROP CONSTRAINT IF EXISTS vacancy_work_pattern_check;
ALTER TABLE vacancy DROP CONSTRAINT IF EXISTS vacancy_status_check;
ALTER TABLE vacancy
  DROP COLUMN IF EXISTS screening_conditions, -- DESTRUCTIVE: rollback only; drops what UP added
  DROP COLUMN IF EXISTS working_days,
  DROP COLUMN IF EXISTS description_ai_run_id,
  DROP COLUMN IF EXISTS close_reason,
  DROP COLUMN IF EXISTS closed_at,
  DROP COLUMN IF EXISTS paused_at,
  DROP COLUMN IF EXISTS published_at,
  DROP COLUMN IF EXISTS target_start_on,
  DROP COLUMN IF EXISTS nice_to_have,
  DROP COLUMN IF EXISTS salary_visible,
  DROP COLUMN IF EXISTS salary_max,
  DROP COLUMN IF EXISTS salary_min,
  DROP COLUMN IF EXISTS min_experience_years,
  DROP COLUMN IF EXISTS reports_to,
  DROP COLUMN IF EXISTS probation_months,
  DROP COLUMN IF EXISTS location,
  DROP COLUMN IF EXISTS work_pattern_note,
  DROP COLUMN IF EXISTS employment_type,
  DROP COLUMN IF EXISTS org_seat_id;
-- A draft never published has no slug; 4000 required one, so it is given its id.
UPDATE vacancy SET slug = 'draft-' || vacancy_id::text WHERE slug IS NULL;
ALTER TABLE vacancy ALTER COLUMN slug SET NOT NULL; -- DESTRUCTIVE: rollback only; every row was given a slug above
