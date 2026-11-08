-- M5 documentation before onboarding: requirement kinds, the case's phases and privacy acknowledgement, each item's typed value and verification, the guarantors and their reference checks, and the contract's statuses.
-- UP
ALTER TABLE document_requirement ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'file';
ALTER TABLE document_requirement ADD COLUMN IF NOT EXISTS display_order integer NOT NULL DEFAULT 0;

ALTER TABLE onboarding_case ALTER COLUMN status SET DEFAULT 'documentation';
ALTER TABLE onboarding_case ADD COLUMN IF NOT EXISTS privacy_acknowledged_at timestamptz;
ALTER TABLE onboarding_case ADD COLUMN IF NOT EXISTS documentation_completed_at timestamptz;
ALTER TABLE onboarding_case ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE onboarding_case ADD COLUMN IF NOT EXISTS end_reason text;

ALTER TABLE onboarding_checklist_item ADD COLUMN IF NOT EXISTS uploaded_at timestamptz;
ALTER TABLE onboarding_checklist_item ADD COLUMN IF NOT EXISTS verified_by uuid REFERENCES app_user(user_id) ON DELETE SET NULL;
ALTER TABLE onboarding_checklist_item ADD COLUMN IF NOT EXISTS verified_at timestamptz;
ALTER TABLE onboarding_checklist_item ADD COLUMN IF NOT EXISTS rejected_reason text;
ALTER TABLE onboarding_checklist_item ADD COLUMN IF NOT EXISTS entered_value text;

-- Two guarantors a hire, not related to them: one a previous employer, one who has known them four
-- years or more. Operations & People run a reference check on each.
CREATE TABLE IF NOT EXISTS onboarding_guarantor (
  onboarding_guarantor_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  onboarding_case_id uuid NOT NULL REFERENCES onboarding_case(onboarding_case_id) ON DELETE CASCADE,
  position smallint NOT NULL CHECK (position IN (1, 2)),
  kind text NOT NULL,
  full_name text NOT NULL,
  relationship text NOT NULL,
  organisation text,
  job_title text,
  phone text NOT NULL,
  email citext,
  years_known smallint CHECK (years_known IS NULL OR years_known BETWEEN 0 AND 80),
  form_document_id uuid REFERENCES document(document_id) ON DELETE RESTRICT,
  check_status text NOT NULL DEFAULT 'pending',
  check_note text,
  checked_by uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (onboarding_case_id, position)
);
CREATE OR REPLACE TRIGGER onboarding_guarantor_set_updated_at BEFORE UPDATE ON onboarding_guarantor
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_requirement_kind_check') THEN
    ALTER TABLE document_requirement ADD CONSTRAINT document_requirement_kind_check
      CHECK (kind IN ('file', 'number', 'both'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'onboarding_case_status_check') THEN
    ALTER TABLE onboarding_case ADD CONSTRAINT onboarding_case_status_check
      CHECK (status IN ('documentation', 'pre_onboarding', 'onboarding', 'completed', 'cancelled'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'onboarding_checklist_item_status_check') THEN
    ALTER TABLE onboarding_checklist_item ADD CONSTRAINT onboarding_checklist_item_status_check
      CHECK (status IN ('pending', 'uploaded', 'verified', 'rejected'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'onboarding_guarantor_kind_check') THEN
    ALTER TABLE onboarding_guarantor ADD CONSTRAINT onboarding_guarantor_kind_check
      CHECK (kind IN ('previous_employer', 'personal'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'onboarding_guarantor_check_status_check') THEN
    ALTER TABLE onboarding_guarantor ADD CONSTRAINT onboarding_guarantor_check_status_check
      CHECK (check_status IN ('pending', 'passed', 'failed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employment_contract_status_check') THEN
    ALTER TABLE employment_contract ADD CONSTRAINT employment_contract_status_check
      CHECK (status IN ('draft', 'sent', 'signed', 'cancelled'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS onboarding_case_owner_id_idx ON onboarding_case (owner_id);
CREATE INDEX IF NOT EXISTS onboarding_case_status_idx ON onboarding_case (status);
CREATE INDEX IF NOT EXISTS onboarding_checklist_item_case_idx ON onboarding_checklist_item (onboarding_case_id, display_order);
CREATE INDEX IF NOT EXISTS onboarding_checklist_item_requirement_idx ON onboarding_checklist_item (document_requirement_id);
CREATE INDEX IF NOT EXISTS onboarding_checklist_item_assignee_idx ON onboarding_checklist_item (assignee_id);
CREATE INDEX IF NOT EXISTS onboarding_checklist_item_document_idx ON onboarding_checklist_item (document_id);
CREATE INDEX IF NOT EXISTS onboarding_checklist_item_verified_by_idx ON onboarding_checklist_item (verified_by);
CREATE INDEX IF NOT EXISTS onboarding_guarantor_form_document_idx ON onboarding_guarantor (form_document_id);
CREATE INDEX IF NOT EXISTS onboarding_guarantor_checked_by_idx ON onboarding_guarantor (checked_by);
CREATE INDEX IF NOT EXISTS employment_contract_case_idx ON employment_contract (onboarding_case_id);
CREATE INDEX IF NOT EXISTS employment_contract_employee_idx ON employment_contract (employee_id);
CREATE INDEX IF NOT EXISTS employment_contract_document_idx ON employment_contract (document_id);
CREATE INDEX IF NOT EXISTS employment_contract_signature_request_idx ON employment_contract (signature_request_id);

-- DOWN
DROP INDEX IF EXISTS onboarding_guarantor_checked_by_idx;
DROP INDEX IF EXISTS onboarding_guarantor_form_document_idx;
DROP TRIGGER IF EXISTS onboarding_guarantor_set_updated_at ON onboarding_guarantor;
DROP TABLE IF EXISTS onboarding_guarantor;
DROP INDEX IF EXISTS employment_contract_signature_request_idx;
DROP INDEX IF EXISTS employment_contract_document_idx;
DROP INDEX IF EXISTS employment_contract_employee_idx;
DROP INDEX IF EXISTS employment_contract_case_idx;
DROP INDEX IF EXISTS onboarding_checklist_item_verified_by_idx;
DROP INDEX IF EXISTS onboarding_checklist_item_document_idx;
DROP INDEX IF EXISTS onboarding_checklist_item_assignee_idx;
DROP INDEX IF EXISTS onboarding_checklist_item_requirement_idx;
DROP INDEX IF EXISTS onboarding_checklist_item_case_idx;
DROP INDEX IF EXISTS onboarding_case_status_idx;
DROP INDEX IF EXISTS onboarding_case_owner_id_idx;
ALTER TABLE employment_contract DROP CONSTRAINT IF EXISTS employment_contract_status_check;
ALTER TABLE onboarding_checklist_item DROP CONSTRAINT IF EXISTS onboarding_checklist_item_status_check;
ALTER TABLE onboarding_case DROP CONSTRAINT IF EXISTS onboarding_case_status_check;
ALTER TABLE document_requirement DROP CONSTRAINT IF EXISTS document_requirement_kind_check;
ALTER TABLE onboarding_checklist_item DROP COLUMN IF EXISTS entered_value;
ALTER TABLE onboarding_checklist_item DROP COLUMN IF EXISTS rejected_reason;
ALTER TABLE onboarding_checklist_item DROP COLUMN IF EXISTS verified_at;
ALTER TABLE onboarding_checklist_item DROP COLUMN IF EXISTS verified_by;
ALTER TABLE onboarding_checklist_item DROP COLUMN IF EXISTS uploaded_at;
ALTER TABLE onboarding_case DROP COLUMN IF EXISTS end_reason;
ALTER TABLE onboarding_case DROP COLUMN IF EXISTS cancelled_at;
ALTER TABLE onboarding_case DROP COLUMN IF EXISTS documentation_completed_at;
ALTER TABLE onboarding_case DROP COLUMN IF EXISTS privacy_acknowledged_at;
ALTER TABLE onboarding_case ALTER COLUMN status SET DEFAULT 'pending';
ALTER TABLE document_requirement DROP COLUMN IF EXISTS display_order;
ALTER TABLE document_requirement DROP COLUMN IF EXISTS kind;
