-- M6 payroll deductions: a fine accepted or an advance recorded, with its months, and the foreign key that
-- ties an attendance pay item to the run that took it (docs/guides/payroll.md §4.2, §6.6).
--
--   payroll_deduction              a fine accepted (source sanction_fine) or a salary advance recorded
--                                  (source salary_advance). A pending fine is not a row: it stays on
--                                  sanction_fine until accepted
--   payroll_deduction_instalment   one month's share of a deduction; each scheduled one in a run's month
--                                  becomes a payslip line, in_run at Submit and applied at approval
--   attendance_pay_item            gains its foreign key to payroll_run, owed since 1435 (attendance guide
--                                  §6.17; LA reviews it): a nullable link, so a deleted run frees its items
--
-- One live deduction per fine: the unique index on sanction_fine_id leaves out a cancelled row, so a fine
-- released back to pending (guide §6.6 rule 5) can be accepted again as a new deduction.
-- UP
CREATE TABLE IF NOT EXISTS payroll_deduction (
  payroll_deduction_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employee(employee_id) ON DELETE RESTRICT,
  source text NOT NULL CHECK (source IN ('sanction_fine', 'salary_advance')),
  sanction_fine_id uuid REFERENCES sanction_fine(sanction_fine_id) ON DELETE RESTRICT,
  reason text NOT NULL,
  total_amount numeric(18,2) NOT NULL CHECK (total_amount > 0),
  instalments smallint NOT NULL CHECK (instalments BETWEEN 1 AND 12),
  start_period date NOT NULL,
  granted_on date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'settled', 'cancelled')),
  settled_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  created_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- A fine names its fine and an advance does not.
  CONSTRAINT payroll_deduction_fine_check CHECK ((source = 'sanction_fine') = (sanction_fine_id IS NOT NULL)),
  CONSTRAINT payroll_deduction_start_check CHECK (start_period = date_trunc('month', start_period)::date)
);
CREATE UNIQUE INDEX IF NOT EXISTS payroll_deduction_live_fine_uq
  ON payroll_deduction (sanction_fine_id) WHERE status <> 'cancelled';
CREATE INDEX IF NOT EXISTS payroll_deduction_sanction_fine_fk_idx ON payroll_deduction (sanction_fine_id);
CREATE INDEX IF NOT EXISTS payroll_deduction_employee_status_idx ON payroll_deduction (employee_id, status);
-- The Deductions tab: its status chips, its month filter and its newest-first order.
CREATE INDEX IF NOT EXISTS payroll_deduction_status_period_idx ON payroll_deduction (status, start_period);
CREATE INDEX IF NOT EXISTS payroll_deduction_created_idx ON payroll_deduction (created_at DESC);
CREATE INDEX IF NOT EXISTS payroll_deduction_created_by_fk_idx ON payroll_deduction (created_by);
CREATE OR REPLACE TRIGGER payroll_deduction_set_updated_at BEFORE UPDATE ON payroll_deduction
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS payroll_deduction_instalment (
  payroll_deduction_instalment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_deduction_id uuid NOT NULL REFERENCES payroll_deduction(payroll_deduction_id) ON DELETE CASCADE,
  period date NOT NULL,
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'in_run', 'applied', 'cancelled')),
  payroll_run_id uuid REFERENCES payroll_run(payroll_run_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_deduction_instalment_month_uq UNIQUE (payroll_deduction_id, period),
  CONSTRAINT payroll_deduction_instalment_period_check CHECK (period = date_trunc('month', period)::date)
);
-- Compute finds a month's scheduled instalments by (period, status).
CREATE INDEX IF NOT EXISTS payroll_deduction_instalment_period_status_idx
  ON payroll_deduction_instalment (period, status);
CREATE INDEX IF NOT EXISTS payroll_deduction_instalment_run_fk_idx ON payroll_deduction_instalment (payroll_run_id);
CREATE OR REPLACE TRIGGER payroll_deduction_instalment_set_updated_at BEFORE UPDATE ON payroll_deduction_instalment
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_pay_item_payroll_run_fk') THEN
    ALTER TABLE attendance_pay_item
      ADD CONSTRAINT attendance_pay_item_payroll_run_fk
      FOREIGN KEY (payroll_run_id) REFERENCES payroll_run(payroll_run_id) ON DELETE SET NULL;
  END IF;
END
$$;
CREATE INDEX IF NOT EXISTS attendance_pay_item_payroll_run_fk_idx ON attendance_pay_item (payroll_run_id);

-- DOWN
DROP INDEX IF EXISTS attendance_pay_item_payroll_run_fk_idx;
ALTER TABLE attendance_pay_item DROP CONSTRAINT IF EXISTS attendance_pay_item_payroll_run_fk;
DROP TRIGGER IF EXISTS payroll_deduction_instalment_set_updated_at ON payroll_deduction_instalment;
DROP INDEX IF EXISTS payroll_deduction_instalment_run_fk_idx;
DROP INDEX IF EXISTS payroll_deduction_instalment_period_status_idx;
DROP TABLE IF EXISTS payroll_deduction_instalment;
DROP TRIGGER IF EXISTS payroll_deduction_set_updated_at ON payroll_deduction;
DROP INDEX IF EXISTS payroll_deduction_created_by_fk_idx;
DROP INDEX IF EXISTS payroll_deduction_created_idx;
DROP INDEX IF EXISTS payroll_deduction_status_period_idx;
DROP INDEX IF EXISTS payroll_deduction_employee_status_idx;
DROP INDEX IF EXISTS payroll_deduction_sanction_fine_fk_idx;
DROP INDEX IF EXISTS payroll_deduction_live_fine_uq;
DROP TABLE IF EXISTS payroll_deduction;
