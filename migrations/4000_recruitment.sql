-- M4 vacancies, candidate pipeline, assessments and blind panel interviews.
-- UP
CREATE TABLE IF NOT EXISTS vacancy (
  vacancy_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number text NOT NULL UNIQUE,
  department_id uuid REFERENCES department(department_id),
  hiring_manager_id uuid REFERENCES employee(employee_id),
  title text NOT NULL,
  slug citext NOT NULL UNIQUE,
  description text NOT NULL,
  requirements text,
  positions integer NOT NULL DEFAULT 1 CHECK (positions > 0),
  work_pattern text,
  worksite_id uuid REFERENCES worksite(worksite_id),
  status text NOT NULL DEFAULT 'draft',
  opens_at timestamptz,
  closes_at timestamptz,
  created_by uuid NOT NULL REFERENCES app_user(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (closes_at IS NULL OR opens_at IS NULL OR closes_at >= opens_at)
);

CREATE TABLE IF NOT EXISTS vacancy_question (
  vacancy_question_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vacancy_id uuid NOT NULL REFERENCES vacancy(vacancy_id) ON DELETE CASCADE,
  question_type text NOT NULL,
  prompt text NOT NULL,
  options jsonb,
  required boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS candidate (
  candidate_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name text NOT NULL,
  last_name text NOT NULL,
  email citext NOT NULL,
  phone text,
  location text,
  profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  consented_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (email)
);

CREATE TABLE IF NOT EXISTS application (
  application_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vacancy_id uuid NOT NULL REFERENCES vacancy(vacancy_id),
  candidate_id uuid NOT NULL REFERENCES candidate(candidate_id),
  source text,
  stage text NOT NULL DEFAULT 'application',
  status text NOT NULL DEFAULT 'active',
  cover_letter text,
  cv_document_id uuid REFERENCES document(document_id),
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  provisional_score numeric(8,4),
  provisional_ai_run_id uuid REFERENCES ai_run(run_id),
  current_stage_entered_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz NOT NULL DEFAULT now(),
  withdrawn_at timestamptz,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vacancy_id, candidate_id)
);

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

CREATE TABLE IF NOT EXISTS recruitment_scorecard_criterion (
  recruitment_scorecard_criterion_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vacancy_id uuid NOT NULL REFERENCES vacancy(vacancy_id) ON DELETE CASCADE,
  code citext NOT NULL,
  name text NOT NULL,
  source_type text NOT NULL,
  weight numeric(5,2) NOT NULL CHECK (weight > 0 AND weight <= 100),
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vacancy_id, code)
);

CREATE TABLE IF NOT EXISTS assessment_definition (
  assessment_definition_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code citext NOT NULL UNIQUE,
  name text NOT NULL,
  assessment_type text NOT NULL,
  instructions text,
  duration_minutes integer CHECK (duration_minutes IS NULL OR duration_minutes > 0),
  scoring_method text NOT NULL,
  pass_score numeric(8,4),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS assessment_question (
  assessment_question_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_definition_id uuid NOT NULL REFERENCES assessment_definition(assessment_definition_id) ON DELETE CASCADE,
  question_type text NOT NULL,
  prompt text NOT NULL,
  options jsonb,
  answer_key_enc text,
  max_score numeric(8,4) NOT NULL CHECK (max_score >= 0),
  display_order integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS application_assessment (
  application_assessment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES application(application_id),
  assessment_definition_id uuid NOT NULL REFERENCES assessment_definition(assessment_definition_id),
  public_token_id uuid REFERENCES public_token(public_token_id),
  status text NOT NULL DEFAULT 'assigned',
  assigned_at timestamptz NOT NULL DEFAULT now(),
  starts_at timestamptz,
  due_at timestamptz,
  submitted_at timestamptz,
  scored_at timestamptz,
  score numeric(8,4),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (application_id, assessment_definition_id)
);

CREATE TABLE IF NOT EXISTS assessment_response (
  assessment_response_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_assessment_id uuid NOT NULL REFERENCES application_assessment(application_assessment_id) ON DELETE CASCADE,
  assessment_question_id uuid NOT NULL REFERENCES assessment_question(assessment_question_id),
  response jsonb NOT NULL,
  awarded_score numeric(8,4),
  reviewer_comment text,
  answered_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (application_assessment_id, assessment_question_id)
);

CREATE TABLE IF NOT EXISTS interview_round (
  interview_round_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES application(application_id),
  round_number integer NOT NULL CHECK (round_number > 0),
  title text NOT NULL,
  status text NOT NULL DEFAULT 'scheduled',
  feedback_closes_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (application_id, round_number)
);

CREATE TABLE IF NOT EXISTS interview (
  interview_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  interview_round_id uuid NOT NULL REFERENCES interview_round(interview_round_id) ON DELETE CASCADE,
  interview_type text NOT NULL,
  scheduled_start timestamptz NOT NULL,
  scheduled_end timestamptz NOT NULL,
  location text,
  meeting_url text,
  status text NOT NULL DEFAULT 'scheduled',
  created_by uuid NOT NULL REFERENCES app_user(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (scheduled_end > scheduled_start)
);

CREATE TABLE IF NOT EXISTS interview_panelist (
  interview_panelist_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  interview_id uuid NOT NULL REFERENCES interview(interview_id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employee(employee_id),
  panel_role text,
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (interview_id, employee_id)
);

CREATE TABLE IF NOT EXISTS interview_feedback (
  interview_feedback_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  interview_panelist_id uuid NOT NULL UNIQUE REFERENCES interview_panelist(interview_panelist_id) ON DELETE CASCADE,
  scorecard jsonb NOT NULL DEFAULT '{}'::jsonb,
  recommendation text NOT NULL,
  private_notes text,
  cleaned_notes text,
  ai_run_id uuid REFERENCES ai_run(run_id),
  submitted_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- DOWN
DROP TABLE IF EXISTS interview_feedback;
DROP TABLE IF EXISTS interview_panelist;
DROP TABLE IF EXISTS interview;
DROP TABLE IF EXISTS interview_round;
DROP TABLE IF EXISTS assessment_response;
DROP TABLE IF EXISTS application_assessment;
DROP TABLE IF EXISTS assessment_question;
DROP TABLE IF EXISTS assessment_definition;
DROP TABLE IF EXISTS recruitment_scorecard_criterion;
DROP TABLE IF EXISTS application_stage_history;
DROP TABLE IF EXISTS application;
DROP TABLE IF EXISTS candidate;
DROP TABLE IF EXISTS vacancy_question;
DROP TABLE IF EXISTS vacancy;
