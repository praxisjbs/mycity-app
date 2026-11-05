-- M8 the expense chain as agreed on 04/11/2026 (docs/guides/expenses.md §4, §6): a request's lines,
-- payee and invoice, many requests to a requisition, the approvals' instances, Reference Missing on
-- a disbursement, a category's type, a project's budget, the statuses, and the indexes Home and the
-- lists read. NGN only is the contract's and the service's rule, not a CHECK: Home's sums already
-- leave other currencies out (docs/guides/home.md §13). Additive only: requisition.expense_request_id and requisition.supplier_name, which
-- 8000 made for one request per requisition, stay in place unused and go in a later release.
-- UP

-- A request: what it is paid to, its invoice, where it sits now.
ALTER TABLE expense_request ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES project(project_id) ON DELETE SET NULL;
ALTER TABLE expense_request ADD COLUMN IF NOT EXISTS requisition_id uuid REFERENCES requisition(requisition_id) ON DELETE SET NULL;
ALTER TABLE expense_request ADD COLUMN IF NOT EXISTS workflow_instance_id uuid REFERENCES workflow_instance(workflow_instance_id) ON DELETE SET NULL;
ALTER TABLE expense_request ADD COLUMN IF NOT EXISTS invoice_document_id uuid REFERENCES document(document_id) ON DELETE SET NULL;
ALTER TABLE expense_request ADD COLUMN IF NOT EXISTS payee_type text NOT NULL DEFAULT 'staff';
ALTER TABLE expense_request ADD COLUMN IF NOT EXISTS payee_name text;
ALTER TABLE expense_request ADD COLUMN IF NOT EXISTS bank_name text;
ALTER TABLE expense_request ADD COLUMN IF NOT EXISTS account_name text;
ALTER TABLE expense_request ADD COLUMN IF NOT EXISTS account_number text;
ALTER TABLE expense_request ADD COLUMN IF NOT EXISTS uses_profile_account boolean NOT NULL DEFAULT false;
ALTER TABLE expense_request ADD COLUMN IF NOT EXISTS over_budget boolean NOT NULL DEFAULT false;
ALTER TABLE expense_request ADD COLUMN IF NOT EXISTS sent_back_at timestamptz;
ALTER TABLE expense_request ADD COLUMN IF NOT EXISTS authorised_at timestamptz;
ALTER TABLE expense_request ADD COLUMN IF NOT EXISTS disbursed_at timestamptz;
ALTER TABLE expense_request ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expense_request_status_valid') THEN
    ALTER TABLE expense_request ADD CONSTRAINT expense_request_status_valid CHECK (status IN (
      'draft', 'submitted', 'sent_back', 'approved', 'in_requisition', 'authorised', 'disbursed',
      'rejected', 'cancelled'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expense_request_payee_type_valid') THEN
    ALTER TABLE expense_request ADD CONSTRAINT expense_request_payee_type_valid
      CHECK (payee_type IN ('staff', 'vendor', 'partner', 'task_team'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS expense_request_status_idx ON expense_request (status);
CREATE INDEX IF NOT EXISTS expense_request_employee_idx ON expense_request (employee_id);
CREATE INDEX IF NOT EXISTS expense_request_department_idx ON expense_request (department_id);
CREATE INDEX IF NOT EXISTS expense_request_category_idx ON expense_request (expense_category_id);
CREATE INDEX IF NOT EXISTS expense_request_budget_line_idx ON expense_request (budget_line_id);
CREATE INDEX IF NOT EXISTS expense_request_project_idx ON expense_request (project_id);
CREATE INDEX IF NOT EXISTS expense_request_requisition_idx ON expense_request (requisition_id);
CREATE INDEX IF NOT EXISTS expense_request_workflow_idx ON expense_request (workflow_instance_id);
CREATE INDEX IF NOT EXISTS expense_request_invoice_idx ON expense_request (invoice_document_id);
CREATE INDEX IF NOT EXISTS expense_request_submitted_idx ON expense_request (submitted_at);

-- A request's lines. Its amount is quantity times unit price, two places, written by the service;
-- the request's amount is their sum.
CREATE TABLE IF NOT EXISTS expense_request_line (
  expense_request_line_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_request_id uuid NOT NULL REFERENCES expense_request(expense_request_id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position >= 1),
  description text NOT NULL,
  quantity numeric(12,2) NOT NULL CHECK (quantity > 0),
  unit_price numeric(18,2) NOT NULL CHECK (unit_price >= 0),
  amount numeric(18,2) NOT NULL CHECK (amount >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (expense_request_id, position)
);
CREATE OR REPLACE TRIGGER expense_request_line_set_updated_at BEFORE UPDATE ON expense_request_line
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A category: operating or capital, and what it is for. No approval threshold (decision 1).
ALTER TABLE expense_category ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'operating';
ALTER TABLE expense_category ADD COLUMN IF NOT EXISTS description text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expense_category_type_valid') THEN
    ALTER TABLE expense_category ADD CONSTRAINT expense_category_type_valid CHECK (type IN ('operating', 'capital'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS expense_category_parent_idx ON expense_category (parent_id);

-- A requisition: the CEO's batch of approved requests, decided in its own approval.
ALTER TABLE requisition ADD COLUMN IF NOT EXISTS workflow_instance_id uuid REFERENCES workflow_instance(workflow_instance_id) ON DELETE SET NULL;
ALTER TABLE requisition ADD COLUMN IF NOT EXISTS rejected_at timestamptz;
ALTER TABLE requisition ALTER COLUMN status SET DEFAULT 'submitted';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'requisition_status_valid') THEN
    ALTER TABLE requisition ADD CONSTRAINT requisition_status_valid
      CHECK (status IN ('submitted', 'approved', 'rejected', 'cancelled'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS requisition_status_idx ON requisition (status);
CREATE INDEX IF NOT EXISTS requisition_requester_idx ON requisition (requester_id);
CREATE INDEX IF NOT EXISTS requisition_workflow_idx ON requisition (workflow_instance_id);

-- A disbursement: one per request, the payee as paid, the reference or a receipt. A null
-- payment_reference is Reference Missing (decision 2); nothing refuses it here.
ALTER TABLE disbursement ADD COLUMN IF NOT EXISTS bank_name text;
ALTER TABLE disbursement ADD COLUMN IF NOT EXISTS account_name text;
ALTER TABLE disbursement ADD COLUMN IF NOT EXISTS account_number text;
ALTER TABLE disbursement ADD COLUMN IF NOT EXISTS receipt_document_id uuid REFERENCES document(document_id) ON DELETE SET NULL;
ALTER TABLE disbursement ADD COLUMN IF NOT EXISTS paid_on date;
ALTER TABLE disbursement ALTER COLUMN status SET DEFAULT 'paid';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'disbursement_status_valid') THEN
    ALTER TABLE disbursement ADD CONSTRAINT disbursement_status_valid CHECK (status IN ('paid'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'disbursement_recipient_type_valid') THEN
    ALTER TABLE disbursement ADD CONSTRAINT disbursement_recipient_type_valid
      CHECK (recipient_type IN ('staff', 'vendor', 'partner', 'task_team'));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS disbursement_one_per_request ON disbursement (expense_request_id)
  WHERE expense_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS disbursement_requisition_idx ON disbursement (requisition_id);
CREATE INDEX IF NOT EXISTS disbursement_processed_by_idx ON disbursement (processed_by);
CREATE INDEX IF NOT EXISTS disbursement_receipt_idx ON disbursement (receipt_document_id);
CREATE INDEX IF NOT EXISTS disbursement_missing_reference_idx ON disbursement (paid_at)
  WHERE payment_reference IS NULL;

-- A department's budget for a year, and its lines by category.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'budget_status_valid') THEN
    ALTER TABLE budget ADD CONSTRAINT budget_status_valid CHECK (status IN ('draft', 'approved', 'closed'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS budget_owner_idx ON budget (owner_id);
CREATE INDEX IF NOT EXISTS budget_department_idx ON budget (department_id);
CREATE INDEX IF NOT EXISTS budget_approved_by_idx ON budget (approved_by);
CREATE INDEX IF NOT EXISTS budget_line_category_idx ON budget_line (expense_category_id);

-- A project's optional budget (M2's table; AJ owns both).
ALTER TABLE project ADD COLUMN IF NOT EXISTS budget_amount numeric(18,2);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_budget_amount_valid') THEN
    ALTER TABLE project ADD CONSTRAINT project_budget_amount_valid CHECK (budget_amount IS NULL OR budget_amount >= 0);
  END IF;
END $$;

-- DOWN
ALTER TABLE project DROP CONSTRAINT IF EXISTS project_budget_amount_valid;
ALTER TABLE project DROP COLUMN IF EXISTS budget_amount;

DROP INDEX IF EXISTS budget_line_category_idx;
DROP INDEX IF EXISTS budget_approved_by_idx;
DROP INDEX IF EXISTS budget_department_idx;
DROP INDEX IF EXISTS budget_owner_idx;
ALTER TABLE budget DROP CONSTRAINT IF EXISTS budget_status_valid;

DROP INDEX IF EXISTS disbursement_missing_reference_idx;
DROP INDEX IF EXISTS disbursement_receipt_idx;
DROP INDEX IF EXISTS disbursement_processed_by_idx;
DROP INDEX IF EXISTS disbursement_requisition_idx;
DROP INDEX IF EXISTS disbursement_one_per_request;
ALTER TABLE disbursement DROP CONSTRAINT IF EXISTS disbursement_recipient_type_valid;
ALTER TABLE disbursement DROP CONSTRAINT IF EXISTS disbursement_status_valid;
ALTER TABLE disbursement ALTER COLUMN status SET DEFAULT 'pending';
ALTER TABLE disbursement DROP COLUMN IF EXISTS paid_on;
ALTER TABLE disbursement DROP COLUMN IF EXISTS receipt_document_id;
ALTER TABLE disbursement DROP COLUMN IF EXISTS account_number;
ALTER TABLE disbursement DROP COLUMN IF EXISTS account_name;
ALTER TABLE disbursement DROP COLUMN IF EXISTS bank_name;

DROP INDEX IF EXISTS requisition_workflow_idx;
DROP INDEX IF EXISTS requisition_requester_idx;
DROP INDEX IF EXISTS requisition_status_idx;
ALTER TABLE requisition DROP CONSTRAINT IF EXISTS requisition_status_valid;
ALTER TABLE requisition ALTER COLUMN status SET DEFAULT 'draft';
ALTER TABLE requisition DROP COLUMN IF EXISTS rejected_at;
ALTER TABLE requisition DROP COLUMN IF EXISTS workflow_instance_id;

DROP INDEX IF EXISTS expense_category_parent_idx;
ALTER TABLE expense_category DROP CONSTRAINT IF EXISTS expense_category_type_valid;
ALTER TABLE expense_category DROP COLUMN IF EXISTS description;
ALTER TABLE expense_category DROP COLUMN IF EXISTS type;

DROP TRIGGER IF EXISTS expense_request_line_set_updated_at ON expense_request_line;
DROP TABLE IF EXISTS expense_request_line;

DROP INDEX IF EXISTS expense_request_submitted_idx;
DROP INDEX IF EXISTS expense_request_invoice_idx;
DROP INDEX IF EXISTS expense_request_workflow_idx;
DROP INDEX IF EXISTS expense_request_requisition_idx;
DROP INDEX IF EXISTS expense_request_project_idx;
DROP INDEX IF EXISTS expense_request_budget_line_idx;
DROP INDEX IF EXISTS expense_request_category_idx;
DROP INDEX IF EXISTS expense_request_department_idx;
DROP INDEX IF EXISTS expense_request_employee_idx;
DROP INDEX IF EXISTS expense_request_status_idx;
ALTER TABLE expense_request DROP CONSTRAINT IF EXISTS expense_request_payee_type_valid;
ALTER TABLE expense_request DROP CONSTRAINT IF EXISTS expense_request_status_valid;
ALTER TABLE expense_request DROP COLUMN IF EXISTS cancelled_at;
ALTER TABLE expense_request DROP COLUMN IF EXISTS disbursed_at;
ALTER TABLE expense_request DROP COLUMN IF EXISTS authorised_at;
ALTER TABLE expense_request DROP COLUMN IF EXISTS sent_back_at;
ALTER TABLE expense_request DROP COLUMN IF EXISTS over_budget;
ALTER TABLE expense_request DROP COLUMN IF EXISTS uses_profile_account;
ALTER TABLE expense_request DROP COLUMN IF EXISTS account_number;
ALTER TABLE expense_request DROP COLUMN IF EXISTS account_name;
ALTER TABLE expense_request DROP COLUMN IF EXISTS bank_name;
ALTER TABLE expense_request DROP COLUMN IF EXISTS payee_name;
ALTER TABLE expense_request DROP COLUMN IF EXISTS payee_type;
ALTER TABLE expense_request DROP COLUMN IF EXISTS invoice_document_id;
ALTER TABLE expense_request DROP COLUMN IF EXISTS workflow_instance_id;
ALTER TABLE expense_request DROP COLUMN IF EXISTS requisition_id;
ALTER TABLE expense_request DROP COLUMN IF EXISTS project_id;
