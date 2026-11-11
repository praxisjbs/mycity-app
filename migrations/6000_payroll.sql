-- M6 payroll: the setting, the monthly run, a person's payslip and its lines, and a run's adjustments
-- (docs/guides/payroll.md §4.2). Simple mode only: the advanced tables are 6020.
--
--   payroll_setting      the advanced switch, the pay day, Bank Details Required and the accountant's three
--                        conventions, effective-dated (read with asOf, written with addVersion,
--                        shared/db/effective-dated). With no row the run is simple, the pay day is the
--                        default 30 (a constant in code) and bank details are a warning. Nothing is seeded (A26)
--   payroll_run          one month's run, one per month ever: status, totals, the approval it waits on, who
--                        paid it and when, and the setting and rates it was computed with
--   payslip              one person in one run: their totals, working days, the bank snapshot taken at Compute
--                        (the full account number is never copied), the PDF once the run is approved
--   payslip_line         an earning, a deduction or an employer charge on a payslip; its amount is never
--                        negative, its kind gives the direction
--   payroll_adjustment   a one-off earning or deduction a person adds to a Draft or Computed run, with a reason
--
-- Money is numeric(18,2). A payslip's totals are the sums of its lines and a run's the sums of its payslips',
-- written by the service in one place (guide §6.8), so no CHECK ties them here. Every CHECK list below is the
-- contract's enum (packages/contract/schemas/payroll.js, payslips.js).
-- UP
CREATE TABLE IF NOT EXISTS payroll_setting (
  payroll_setting_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL DEFAULT 'organisation' CHECK (scope = 'organisation'),
  advanced_enabled boolean NOT NULL DEFAULT false,
  pay_day smallint CHECK (pay_day BETWEEN 1 AND 31),
  require_bank_details boolean NOT NULL DEFAULT false,
  paye_basis text CHECK (paye_basis IN ('annualised', 'monthly')),
  pension_reduces_taxable boolean,
  nhf_reduces_taxable boolean,
  effective_from date NOT NULL,
  effective_to date,
  changed_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_setting_span_check CHECK (effective_to IS NULL OR effective_to > effective_from),
  -- No two versions overlap. The scope can only be 'organisation', so the date range alone is the key.
  CONSTRAINT payroll_setting_no_overlap EXCLUDE USING gist (daterange(effective_from, effective_to) WITH &&)
);
CREATE INDEX IF NOT EXISTS payroll_setting_scope_idx ON payroll_setting (scope, effective_from DESC);
CREATE INDEX IF NOT EXISTS payroll_setting_changed_by_fk_idx ON payroll_setting (changed_by);
CREATE OR REPLACE TRIGGER payroll_setting_set_updated_at BEFORE UPDATE ON payroll_setting
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS payroll_run (
  payroll_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number citext NOT NULL UNIQUE,
  period date NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'computed', 'submitted', 'approved', 'paid')),
  advanced boolean NOT NULL DEFAULT false,
  headcount integer NOT NULL DEFAULT 0,
  earnings_total numeric(18,2) NOT NULL DEFAULT 0,
  deductions_total numeric(18,2) NOT NULL DEFAULT 0,
  net_total numeric(18,2) NOT NULL DEFAULT 0,
  employer_total numeric(18,2) NOT NULL DEFAULT 0,
  computed_at timestamptz,
  submitted_at timestamptz,
  approved_at timestamptz,
  submitted_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  approved_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  paid_on date,
  payment_reference text,
  paid_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  returned_reason text,
  workflow_instance_id uuid REFERENCES workflow_instance(workflow_instance_id) ON DELETE SET NULL,
  config_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_run_period_check CHECK (period = date_trunc('month', period)::date)
);
-- Runs by month newest first (Run History), and by status (Home's Payroll In Progress, the status filter).
CREATE INDEX IF NOT EXISTS payroll_run_period_idx ON payroll_run (period DESC);
CREATE INDEX IF NOT EXISTS payroll_run_status_idx ON payroll_run (status);
CREATE INDEX IF NOT EXISTS payroll_run_submitted_by_fk_idx ON payroll_run (submitted_by);
CREATE INDEX IF NOT EXISTS payroll_run_approved_by_fk_idx ON payroll_run (approved_by);
CREATE INDEX IF NOT EXISTS payroll_run_paid_by_fk_idx ON payroll_run (paid_by);
CREATE INDEX IF NOT EXISTS payroll_run_workflow_instance_fk_idx ON payroll_run (workflow_instance_id);
CREATE OR REPLACE TRIGGER payroll_run_set_updated_at BEFORE UPDATE ON payroll_run
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS payslip (
  payslip_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number citext NOT NULL UNIQUE,
  payroll_run_id uuid NOT NULL REFERENCES payroll_run(payroll_run_id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employee(employee_id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'excluded', 'published')),
  excluded_reason text,
  gross_monthly numeric(18,2),
  working_days smallint,
  working_days_paid smallint,
  earnings_total numeric(18,2) NOT NULL DEFAULT 0,
  deductions_total numeric(18,2) NOT NULL DEFAULT 0,
  net_pay numeric(18,2) NOT NULL DEFAULT 0,
  employer_total numeric(18,2) NOT NULL DEFAULT 0,
  bank_name text,
  account_last4 text,
  document_id uuid REFERENCES document(document_id) ON DELETE SET NULL,
  published_at timestamptz,
  emailed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payslip_run_employee_uq UNIQUE (payroll_run_id, employee_id),
  -- The reason is set if and only if the person is excluded.
  CONSTRAINT payslip_excluded_reason_check CHECK ((status = 'excluded') = (excluded_reason IS NOT NULL))
);
-- A person's payslips across runs (My Payslips), a run's by status (the tab), and by net pay (its sort).
CREATE INDEX IF NOT EXISTS payslip_employee_run_idx ON payslip (employee_id, payroll_run_id);
CREATE INDEX IF NOT EXISTS payslip_run_status_idx ON payslip (payroll_run_id, status);
CREATE INDEX IF NOT EXISTS payslip_run_net_pay_idx ON payslip (payroll_run_id, net_pay);
CREATE INDEX IF NOT EXISTS payslip_document_fk_idx ON payslip (document_id);
CREATE OR REPLACE TRIGGER payslip_set_updated_at BEFORE UPDATE ON payslip
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS payslip_line (
  payslip_line_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payslip_id uuid NOT NULL REFERENCES payslip(payslip_id) ON DELETE CASCADE,
  position smallint NOT NULL,
  kind text NOT NULL CHECK (kind IN ('earning', 'deduction', 'employer')),
  code text NOT NULL CHECK (code IN (
    'monthly_pay', 'overtime', 'lateness', 'early_departure', 'absence', 'unpaid_leave', 'unpaid_suspension',
    'fine', 'advance', 'adjustment_earning', 'adjustment_deduction',
    'paye', 'pension_employee', 'pension_employer', 'nhf', 'itf', 'nsitf'
  )),
  label text NOT NULL,
  detail text,
  amount numeric(18,2) NOT NULL CHECK (amount >= 0),
  -- A line with one source (an instalment, an adjustment) names it; a group (the month's lateness) has none.
  source_type text,
  source_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payslip_line_order_idx ON payslip_line (payslip_id, position);
CREATE INDEX IF NOT EXISTS payslip_line_source_idx ON payslip_line (source_type, source_id);
CREATE OR REPLACE TRIGGER payslip_line_set_updated_at BEFORE UPDATE ON payslip_line
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS payroll_adjustment (
  payroll_adjustment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id uuid NOT NULL REFERENCES payroll_run(payroll_run_id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employee(employee_id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('earning', 'deduction')),
  label text NOT NULL CHECK (char_length(label) <= 60),
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  reason text NOT NULL,
  created_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payroll_adjustment_run_employee_idx ON payroll_adjustment (payroll_run_id, employee_id);
CREATE INDEX IF NOT EXISTS payroll_adjustment_employee_fk_idx ON payroll_adjustment (employee_id);
CREATE INDEX IF NOT EXISTS payroll_adjustment_created_by_fk_idx ON payroll_adjustment (created_by);
CREATE OR REPLACE TRIGGER payroll_adjustment_set_updated_at BEFORE UPDATE ON payroll_adjustment
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- DOWN
DROP TRIGGER IF EXISTS payroll_adjustment_set_updated_at ON payroll_adjustment;
DROP INDEX IF EXISTS payroll_adjustment_created_by_fk_idx;
DROP INDEX IF EXISTS payroll_adjustment_employee_fk_idx;
DROP INDEX IF EXISTS payroll_adjustment_run_employee_idx;
DROP TABLE IF EXISTS payroll_adjustment;
DROP TRIGGER IF EXISTS payslip_line_set_updated_at ON payslip_line;
DROP INDEX IF EXISTS payslip_line_source_idx;
DROP INDEX IF EXISTS payslip_line_order_idx;
DROP TABLE IF EXISTS payslip_line;
DROP TRIGGER IF EXISTS payslip_set_updated_at ON payslip;
DROP INDEX IF EXISTS payslip_document_fk_idx;
DROP INDEX IF EXISTS payslip_run_net_pay_idx;
DROP INDEX IF EXISTS payslip_run_status_idx;
DROP INDEX IF EXISTS payslip_employee_run_idx;
DROP TABLE IF EXISTS payslip;
DROP TRIGGER IF EXISTS payroll_run_set_updated_at ON payroll_run;
DROP INDEX IF EXISTS payroll_run_workflow_instance_fk_idx;
DROP INDEX IF EXISTS payroll_run_paid_by_fk_idx;
DROP INDEX IF EXISTS payroll_run_approved_by_fk_idx;
DROP INDEX IF EXISTS payroll_run_submitted_by_fk_idx;
DROP INDEX IF EXISTS payroll_run_status_idx;
DROP INDEX IF EXISTS payroll_run_period_idx;
DROP TABLE IF EXISTS payroll_run;
DROP TRIGGER IF EXISTS payroll_setting_set_updated_at ON payroll_setting;
DROP INDEX IF EXISTS payroll_setting_changed_by_fk_idx;
DROP INDEX IF EXISTS payroll_setting_scope_idx;
DROP TABLE IF EXISTS payroll_setting;
