-- M5 offers: the offer summary's terms, the monthly pay lines, the final job description, approval, the score snapshot, and a new offer after one ends.
-- UP
ALTER TABLE offer ADD COLUMN IF NOT EXISTS job_description text;
ALTER TABLE offer ADD COLUMN IF NOT EXISTS working_hours text;
ALTER TABLE offer ADD COLUMN IF NOT EXISTS probation_months smallint;
ALTER TABLE offer ADD COLUMN IF NOT EXISTS workflow_instance_id uuid REFERENCES workflow_instance(workflow_instance_id) ON DELETE SET NULL;
ALTER TABLE offer ADD COLUMN IF NOT EXISTS signature_request_id uuid REFERENCES signature_request(signature_request_id) ON DELETE SET NULL;
ALTER TABLE offer ADD COLUMN IF NOT EXISTS score_snapshot numeric(5,2);
ALTER TABLE offer ADD COLUMN IF NOT EXISTS decision_snapshot text;
ALTER TABLE offer ADD COLUMN IF NOT EXISTS sent_at timestamptz;
ALTER TABLE offer ADD COLUMN IF NOT EXISTS withdrawn_at timestamptz;
ALTER TABLE offer ADD COLUMN IF NOT EXISTS end_reason text;
ALTER TABLE offer ADD COLUMN IF NOT EXISTS reports_to text;
ALTER TABLE offer ADD COLUMN IF NOT EXISTS role_function text;
ALTER TABLE offer ADD COLUMN IF NOT EXISTS role_scope text;
ALTER TABLE offer ADD COLUMN IF NOT EXISTS employment_type text;
ALTER TABLE offer ADD COLUMN IF NOT EXISTS work_pattern text;
ALTER TABLE offer ADD COLUMN IF NOT EXISTS office_days smallint;
ALTER TABLE offer ADD COLUMN IF NOT EXISTS annual_leave_days smallint;
ALTER TABLE offer ADD COLUMN IF NOT EXISTS incentives text;
ALTER TABLE offer ADD COLUMN IF NOT EXISTS outside_range boolean NOT NULL DEFAULT false;
ALTER TABLE offer ADD COLUMN IF NOT EXISTS range_reason text;
ALTER TABLE offer ADD COLUMN IF NOT EXISTS additional_terms text;
ALTER TABLE offer ADD COLUMN IF NOT EXISTS terms_version integer;
ALTER TABLE offer ADD COLUMN IF NOT EXISTS submitted_at timestamptz;

-- The monthly compensation, line by line (Basic Salary, Internet & Recharge Allowance, ...).
-- offer.annual_compensation is twelve times their sum, written by the offers service.
CREATE TABLE IF NOT EXISTS offer_pay_line (
  offer_pay_line_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id uuid NOT NULL REFERENCES offer(offer_id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position >= 1),
  name text NOT NULL,
  monthly_amount numeric(18,2) NOT NULL CHECK (monthly_amount >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (offer_id, position)
);
CREATE OR REPLACE TRIGGER offer_pay_line_set_updated_at BEFORE UPDATE ON offer_pay_line
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'offer_status_check') THEN
    ALTER TABLE offer ADD CONSTRAINT offer_status_check
      CHECK (status IN ('draft', 'approval', 'approved', 'sent', 'accepted', 'declined', 'expired', 'withdrawn'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'offer_probation_months_check') THEN
    ALTER TABLE offer ADD CONSTRAINT offer_probation_months_check
      CHECK (probation_months IS NULL OR probation_months BETWEEN 0 AND 24);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'offer_score_snapshot_check') THEN
    ALTER TABLE offer ADD CONSTRAINT offer_score_snapshot_check
      CHECK (score_snapshot IS NULL OR score_snapshot BETWEEN 0 AND 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'offer_employment_type_check') THEN
    ALTER TABLE offer ADD CONSTRAINT offer_employment_type_check
      CHECK (employment_type IS NULL OR employment_type IN ('full_time', 'part_time', 'contract', 'internship'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'offer_work_pattern_check') THEN
    ALTER TABLE offer ADD CONSTRAINT offer_work_pattern_check
      CHECK (work_pattern IS NULL OR work_pattern IN ('on_site', 'hybrid', 'remote'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'offer_office_days_check') THEN
    ALTER TABLE offer ADD CONSTRAINT offer_office_days_check
      CHECK (office_days IS NULL OR office_days BETWEEN 0 AND 7);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'offer_annual_leave_days_check') THEN
    ALTER TABLE offer ADD CONSTRAINT offer_annual_leave_days_check
      CHECK (annual_leave_days IS NULL OR annual_leave_days BETWEEN 0 AND 60);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'offer_decision_snapshot_check') THEN
    ALTER TABLE offer ADD CONSTRAINT offer_decision_snapshot_check
      CHECK (decision_snapshot IS NULL OR decision_snapshot IN ('select', 'on_hold', 'reject'));
  END IF;
END $$;

-- One open offer per application; a declined, expired or withdrawn one leaves room for the next.
ALTER TABLE offer DROP CONSTRAINT IF EXISTS offer_application_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS offer_one_open_per_application
  ON offer (application_id) WHERE status IN ('draft', 'approval', 'approved', 'sent', 'accepted');
CREATE INDEX IF NOT EXISTS offer_application_id_idx ON offer (application_id);
CREATE INDEX IF NOT EXISTS offer_status_idx ON offer (status);
CREATE INDEX IF NOT EXISTS offer_expires_at_idx ON offer (expires_at) WHERE status = 'sent';
CREATE INDEX IF NOT EXISTS offer_department_id_idx ON offer (department_id);
CREATE INDEX IF NOT EXISTS offer_worksite_id_idx ON offer (worksite_id);
CREATE INDEX IF NOT EXISTS offer_document_id_idx ON offer (document_id);
CREATE INDEX IF NOT EXISTS offer_approved_by_idx ON offer (approved_by);
CREATE INDEX IF NOT EXISTS offer_created_by_idx ON offer (created_by);
CREATE INDEX IF NOT EXISTS offer_workflow_instance_id_idx ON offer (workflow_instance_id);
CREATE INDEX IF NOT EXISTS offer_signature_request_id_idx ON offer (signature_request_id);

-- DOWN
DROP TRIGGER IF EXISTS offer_pay_line_set_updated_at ON offer_pay_line;
DROP TABLE IF EXISTS offer_pay_line;
DROP INDEX IF EXISTS offer_signature_request_id_idx;
DROP INDEX IF EXISTS offer_workflow_instance_id_idx;
DROP INDEX IF EXISTS offer_created_by_idx;
DROP INDEX IF EXISTS offer_approved_by_idx;
DROP INDEX IF EXISTS offer_document_id_idx;
DROP INDEX IF EXISTS offer_worksite_id_idx;
DROP INDEX IF EXISTS offer_department_id_idx;
DROP INDEX IF EXISTS offer_expires_at_idx;
DROP INDEX IF EXISTS offer_status_idx;
DROP INDEX IF EXISTS offer_application_id_idx;
DROP INDEX IF EXISTS offer_one_open_per_application;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'offer_application_id_key') THEN
    ALTER TABLE offer ADD CONSTRAINT offer_application_id_key UNIQUE (application_id);
  END IF;
END $$;
ALTER TABLE offer DROP CONSTRAINT IF EXISTS offer_annual_leave_days_check;
ALTER TABLE offer DROP CONSTRAINT IF EXISTS offer_office_days_check;
ALTER TABLE offer DROP CONSTRAINT IF EXISTS offer_work_pattern_check;
ALTER TABLE offer DROP CONSTRAINT IF EXISTS offer_employment_type_check;
ALTER TABLE offer DROP CONSTRAINT IF EXISTS offer_decision_snapshot_check;
ALTER TABLE offer DROP CONSTRAINT IF EXISTS offer_score_snapshot_check;
ALTER TABLE offer DROP CONSTRAINT IF EXISTS offer_probation_months_check;
ALTER TABLE offer DROP CONSTRAINT IF EXISTS offer_status_check;
ALTER TABLE offer DROP COLUMN IF EXISTS submitted_at;
ALTER TABLE offer DROP COLUMN IF EXISTS terms_version;
ALTER TABLE offer DROP COLUMN IF EXISTS additional_terms;
ALTER TABLE offer DROP COLUMN IF EXISTS range_reason;
ALTER TABLE offer DROP COLUMN IF EXISTS outside_range;
ALTER TABLE offer DROP COLUMN IF EXISTS incentives;
ALTER TABLE offer DROP COLUMN IF EXISTS annual_leave_days;
ALTER TABLE offer DROP COLUMN IF EXISTS office_days;
ALTER TABLE offer DROP COLUMN IF EXISTS work_pattern;
ALTER TABLE offer DROP COLUMN IF EXISTS employment_type;
ALTER TABLE offer DROP COLUMN IF EXISTS role_scope;
ALTER TABLE offer DROP COLUMN IF EXISTS role_function;
ALTER TABLE offer DROP COLUMN IF EXISTS reports_to;
ALTER TABLE offer DROP COLUMN IF EXISTS end_reason;
ALTER TABLE offer DROP COLUMN IF EXISTS withdrawn_at;
ALTER TABLE offer DROP COLUMN IF EXISTS sent_at;
ALTER TABLE offer DROP COLUMN IF EXISTS decision_snapshot;
ALTER TABLE offer DROP COLUMN IF EXISTS score_snapshot;
ALTER TABLE offer DROP COLUMN IF EXISTS signature_request_id;
ALTER TABLE offer DROP COLUMN IF EXISTS workflow_instance_id;
ALTER TABLE offer DROP COLUMN IF EXISTS probation_months;
ALTER TABLE offer DROP COLUMN IF EXISTS working_hours;
ALTER TABLE offer DROP COLUMN IF EXISTS job_description;
