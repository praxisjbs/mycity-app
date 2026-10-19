-- M3 the consequence chain, letter templates, rule settings and the one-query-per-breach key (docs/guides/queries.md §4).
--
--   letter_template    the letters this module may send; wording is template_version under the same key
--   consequence_step   MyCity's ladder, one rung a row in position order, entered on Chain Settings (A26)
--   query_rule         + measure, letter_template, activated_at; new rules start as drafts
--   employee_query     + outcome, reminded_at, dedup_key (unique), letter_document_id; status checked
--   sanction           + number, consequence_step_id, evidence, workflow_instance_id; status checked
-- UP
CREATE TABLE IF NOT EXISTS letter_template (
  letter_template_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key citext NOT NULL UNIQUE,
  name text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('query', 'sanction')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'retired')),
  created_by uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS letter_template_purpose_idx ON letter_template (purpose, status);
CREATE INDEX IF NOT EXISTS letter_template_created_by_idx ON letter_template (created_by);
CREATE OR REPLACE TRIGGER letter_template_set_updated_at BEFORE UPDATE ON letter_template
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS consequence_step (
  consequence_step_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code citext NOT NULL UNIQUE,
  name text NOT NULL,
  position integer NOT NULL CHECK (position > 0),
  letter_template citext REFERENCES letter_template(key) ON DELETE RESTRICT,
  financial_effect text NOT NULL DEFAULT 'none' CHECK (financial_effect IN ('none', 'unpaid_days', 'ends_employment')),
  default_days integer CHECK (default_days IS NULL OR default_days BETWEEN 1 AND 365),
  valid_days integer CHECK (valid_days IS NULL OR valid_days BETWEEN 1 AND 3660),
  evidence_required boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Inserting a rung moves the ones below it down in the same transaction, so the check waits for the commit.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'consequence_step_position_key') THEN
    ALTER TABLE consequence_step ADD CONSTRAINT consequence_step_position_key UNIQUE (position) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS consequence_step_letter_template_idx ON consequence_step (letter_template);
CREATE INDEX IF NOT EXISTS consequence_step_created_by_idx ON consequence_step (created_by);
CREATE OR REPLACE TRIGGER consequence_step_set_updated_at BEFORE UPDATE ON consequence_step
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE query_rule ADD COLUMN IF NOT EXISTS measure text NOT NULL DEFAULT 'count';
ALTER TABLE query_rule ADD COLUMN IF NOT EXISTS letter_template citext REFERENCES letter_template(key) ON DELETE RESTRICT;
ALTER TABLE query_rule ADD COLUMN IF NOT EXISTS activated_at timestamptz;
ALTER TABLE query_rule ALTER COLUMN active SET DEFAULT false;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'query_rule_measure_check') THEN
    ALTER TABLE query_rule ADD CONSTRAINT query_rule_measure_check CHECK (measure IN ('count', 'minutes'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'query_rule_source_event_check') THEN
    ALTER TABLE query_rule ADD CONSTRAINT query_rule_source_event_check CHECK (source_event IN
      ('lateness', 'absence', 'missing_clock_out', 'unenrolled_device', 'overdue_task', 'missed_target'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'query_rule_minutes_lateness_check') THEN
    ALTER TABLE query_rule ADD CONSTRAINT query_rule_minutes_lateness_check CHECK (measure = 'count' OR source_event = 'lateness');
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS query_rule_source_event_idx ON query_rule (source_event, active);
CREATE INDEX IF NOT EXISTS query_rule_letter_template_idx ON query_rule (letter_template);
CREATE INDEX IF NOT EXISTS query_rule_created_by_idx ON query_rule (created_by);

ALTER TABLE employee_query ADD COLUMN IF NOT EXISTS outcome text;
ALTER TABLE employee_query ADD COLUMN IF NOT EXISTS reminded_at timestamptz;
ALTER TABLE employee_query ADD COLUMN IF NOT EXISTS dedup_key text;
ALTER TABLE employee_query ADD COLUMN IF NOT EXISTS letter_document_id uuid REFERENCES document(document_id) ON DELETE RESTRICT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_query_status_check') THEN
    ALTER TABLE employee_query ADD CONSTRAINT employee_query_status_check CHECK (status IN ('awaiting_response', 'under_review', 'resolved'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_query_outcome_check') THEN
    ALTER TABLE employee_query ADD CONSTRAINT employee_query_outcome_check CHECK (
      (status = 'resolved' AND outcome IN ('no_action', 'sanctioned')) OR (status <> 'resolved' AND outcome IS NULL));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS employee_query_dedup_key_idx ON employee_query (dedup_key) WHERE dedup_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS employee_query_employee_idx ON employee_query (employee_id, created_at);
CREATE INDEX IF NOT EXISTS employee_query_rule_idx ON employee_query (query_rule_id, employee_id, created_at);
CREATE INDEX IF NOT EXISTS employee_query_raised_by_idx ON employee_query (raised_by, created_at);
CREATE INDEX IF NOT EXISTS employee_query_status_idx ON employee_query (status, created_at);
CREATE INDEX IF NOT EXISTS employee_query_reviewed_by_idx ON employee_query (reviewed_by);
CREATE INDEX IF NOT EXISTS employee_query_workflow_idx ON employee_query (workflow_instance_id);
CREATE INDEX IF NOT EXISTS employee_query_letter_idx ON employee_query (letter_document_id);
CREATE INDEX IF NOT EXISTS query_response_employee_idx ON query_response (employee_id);

ALTER TABLE sanction ADD COLUMN IF NOT EXISTS number citext UNIQUE;
ALTER TABLE sanction ADD COLUMN IF NOT EXISTS consequence_step_id uuid REFERENCES consequence_step(consequence_step_id) ON DELETE RESTRICT;
ALTER TABLE sanction ADD COLUMN IF NOT EXISTS evidence jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE sanction ADD COLUMN IF NOT EXISTS workflow_instance_id uuid REFERENCES workflow_instance(workflow_instance_id) ON DELETE RESTRICT;
ALTER TABLE sanction ALTER COLUMN status SET DEFAULT 'pending_approval';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sanction_status_check') THEN
    ALTER TABLE sanction ADD CONSTRAINT sanction_status_check CHECK (status IN ('pending_approval', 'issued', 'rejected', 'withdrawn'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sanction_issued_number_check') THEN
    ALTER TABLE sanction ADD CONSTRAINT sanction_issued_number_check CHECK (status <> 'issued' OR number IS NOT NULL);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS sanction_query_idx ON sanction (employee_query_id);
CREATE INDEX IF NOT EXISTS sanction_employee_idx ON sanction (employee_id, effective_on);
CREATE INDEX IF NOT EXISTS sanction_step_idx ON sanction (consequence_step_id);
CREATE INDEX IF NOT EXISTS sanction_decided_by_idx ON sanction (decided_by);
CREATE INDEX IF NOT EXISTS sanction_status_idx ON sanction (status, created_at);
CREATE INDEX IF NOT EXISTS sanction_workflow_idx ON sanction (workflow_instance_id);
CREATE INDEX IF NOT EXISTS sanction_fine_status_idx ON sanction_fine (settlement_status);
CREATE INDEX IF NOT EXISTS sanction_letter_document_idx ON sanction_letter (document_id);

-- DOWN
DROP INDEX IF EXISTS sanction_letter_document_idx;
DROP INDEX IF EXISTS sanction_fine_status_idx;
DROP INDEX IF EXISTS sanction_workflow_idx;
DROP INDEX IF EXISTS sanction_status_idx;
DROP INDEX IF EXISTS sanction_decided_by_idx;
DROP INDEX IF EXISTS sanction_step_idx;
DROP INDEX IF EXISTS sanction_employee_idx;
DROP INDEX IF EXISTS sanction_query_idx;
ALTER TABLE sanction DROP CONSTRAINT IF EXISTS sanction_issued_number_check;
ALTER TABLE sanction DROP CONSTRAINT IF EXISTS sanction_status_check;
ALTER TABLE sanction ALTER COLUMN status SET DEFAULT 'issued';
ALTER TABLE sanction DROP COLUMN IF EXISTS workflow_instance_id;
ALTER TABLE sanction DROP COLUMN IF EXISTS evidence;
ALTER TABLE sanction DROP COLUMN IF EXISTS consequence_step_id;
ALTER TABLE sanction DROP COLUMN IF EXISTS number;

DROP INDEX IF EXISTS query_response_employee_idx;
DROP INDEX IF EXISTS employee_query_letter_idx;
DROP INDEX IF EXISTS employee_query_workflow_idx;
DROP INDEX IF EXISTS employee_query_reviewed_by_idx;
DROP INDEX IF EXISTS employee_query_status_idx;
DROP INDEX IF EXISTS employee_query_raised_by_idx;
DROP INDEX IF EXISTS employee_query_rule_idx;
DROP INDEX IF EXISTS employee_query_employee_idx;
DROP INDEX IF EXISTS employee_query_dedup_key_idx;
ALTER TABLE employee_query DROP CONSTRAINT IF EXISTS employee_query_outcome_check;
ALTER TABLE employee_query DROP CONSTRAINT IF EXISTS employee_query_status_check;
ALTER TABLE employee_query DROP COLUMN IF EXISTS letter_document_id;
ALTER TABLE employee_query DROP COLUMN IF EXISTS dedup_key;
ALTER TABLE employee_query DROP COLUMN IF EXISTS reminded_at;
ALTER TABLE employee_query DROP COLUMN IF EXISTS outcome;

DROP INDEX IF EXISTS query_rule_created_by_idx;
DROP INDEX IF EXISTS query_rule_letter_template_idx;
DROP INDEX IF EXISTS query_rule_source_event_idx;
ALTER TABLE query_rule DROP CONSTRAINT IF EXISTS query_rule_minutes_lateness_check;
ALTER TABLE query_rule DROP CONSTRAINT IF EXISTS query_rule_source_event_check;
ALTER TABLE query_rule DROP CONSTRAINT IF EXISTS query_rule_measure_check;
ALTER TABLE query_rule ALTER COLUMN active SET DEFAULT true;
ALTER TABLE query_rule DROP COLUMN IF EXISTS activated_at;
ALTER TABLE query_rule DROP COLUMN IF EXISTS letter_template;
ALTER TABLE query_rule DROP COLUMN IF EXISTS measure;

DROP TRIGGER IF EXISTS consequence_step_set_updated_at ON consequence_step;
DROP INDEX IF EXISTS consequence_step_created_by_idx;
DROP INDEX IF EXISTS consequence_step_letter_template_idx;
DROP TABLE IF EXISTS consequence_step;

DROP TRIGGER IF EXISTS letter_template_set_updated_at ON letter_template;
DROP INDEX IF EXISTS letter_template_created_by_idx;
DROP INDEX IF EXISTS letter_template_purpose_idx;
DROP TABLE IF EXISTS letter_template;
