-- M8 budgets, requisitions, expenses and disbursements.
-- UP
CREATE TABLE IF NOT EXISTS expense_category (
  expense_category_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code citext NOT NULL UNIQUE,
  name text NOT NULL,
  parent_id uuid REFERENCES expense_category(expense_category_id),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS budget (
  budget_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number text NOT NULL UNIQUE,
  name text NOT NULL,
  department_id uuid REFERENCES department(department_id),
  owner_id uuid REFERENCES employee(employee_id),
  currency char(3) NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  approved_by uuid REFERENCES app_user(user_id),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on)
);

CREATE TABLE IF NOT EXISTS budget_line (
  budget_line_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id uuid NOT NULL REFERENCES budget(budget_id) ON DELETE CASCADE,
  expense_category_id uuid NOT NULL REFERENCES expense_category(expense_category_id),
  amount numeric(18,2) NOT NULL CHECK (amount >= 0),
  committed_amount numeric(18,2) NOT NULL DEFAULT 0 CHECK (committed_amount >= 0),
  spent_amount numeric(18,2) NOT NULL DEFAULT 0 CHECK (spent_amount >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (budget_id, expense_category_id)
);

CREATE TABLE IF NOT EXISTS expense_request (
  expense_request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number text NOT NULL UNIQUE,
  employee_id uuid NOT NULL REFERENCES employee(employee_id),
  department_id uuid REFERENCES department(department_id),
  budget_line_id uuid REFERENCES budget_line(budget_line_id),
  expense_category_id uuid NOT NULL REFERENCES expense_category(expense_category_id),
  purpose text NOT NULL,
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  currency char(3) NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  needed_on date,
  submitted_at timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS requisition (
  requisition_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_request_id uuid UNIQUE REFERENCES expense_request(expense_request_id),
  number text NOT NULL UNIQUE,
  requester_id uuid NOT NULL REFERENCES employee(employee_id),
  supplier_name text,
  status text NOT NULL DEFAULT 'draft',
  currency char(3) NOT NULL,
  total_amount numeric(18,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  submitted_at timestamptz,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS requisition_line (
  requisition_line_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requisition_id uuid NOT NULL REFERENCES requisition(requisition_id) ON DELETE CASCADE,
  expense_category_id uuid NOT NULL REFERENCES expense_category(expense_category_id),
  description text NOT NULL,
  quantity numeric(18,4) NOT NULL CHECK (quantity > 0),
  unit_price numeric(18,2) NOT NULL CHECK (unit_price >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS disbursement (
  disbursement_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_request_id uuid REFERENCES expense_request(expense_request_id),
  requisition_id uuid REFERENCES requisition(requisition_id),
  number text NOT NULL UNIQUE,
  recipient_type text NOT NULL,
  recipient_name text NOT NULL,
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  currency char(3) NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  payment_reference text,
  paid_at timestamptz,
  processed_by uuid REFERENCES app_user(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expense_request_id IS NOT NULL OR requisition_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS expense_transaction (
  expense_transaction_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_request_id uuid REFERENCES expense_request(expense_request_id),
  requisition_id uuid REFERENCES requisition(requisition_id),
  disbursement_id uuid REFERENCES disbursement(disbursement_id),
  transaction_type text NOT NULL,
  amount numeric(18,2) NOT NULL CHECK (amount >= 0),
  currency char(3) NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  reference text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- DOWN
DROP TABLE IF EXISTS expense_transaction;
DROP TABLE IF EXISTS disbursement;
DROP TABLE IF EXISTS requisition_line;
DROP TABLE IF EXISTS requisition;
DROP TABLE IF EXISTS expense_request;
DROP TABLE IF EXISTS budget_line;
DROP TABLE IF EXISTS budget;
DROP TABLE IF EXISTS expense_category;
