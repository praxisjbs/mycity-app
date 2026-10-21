-- M1 pending deductions and overtime, and overtime approved beforehand, as the attendance module
-- writes them (docs/guides/attendance.md §4, §6.17; TB's decisions of 20/10/2026, T4, T6).
--
--   attendance_pay_item           one per person, day and kind (a late, early or absent day's
--                                 deduction, or the day's overtime): its minutes, how its amount was
--                                 worked out, the amount (numeric(18,2) through shared/money, null
--                                 with no salary set; masked as the salary is), the version that
--                                 judged the day, its status (pending, waived, confirmed, cut,
--                                 in_run), who decided it (null when the system did) and why, and the
--                                 overtime minutes confirmed. Settled in the transaction that
--                                 recalculates the day
--   attendance_overtime_approval  overtime a line manager or People approved for a person's day
--                                 beforehand (Approve Overtime), read under the Pre-Approved method;
--                                 one per person and day, the same day again replacing it
--
-- payroll_run_id is the run payroll takes an item into (M6, status in_run). M6's run table does not
-- exist yet, so it is a nullable uuid with no foreign key here; M6 adds the key with the run.
-- UP
CREATE TABLE IF NOT EXISTS attendance_pay_item (
  attendance_pay_item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employee(employee_id) ON DELETE RESTRICT,
  attendance_day_id uuid REFERENCES attendance_day(attendance_day_id) ON DELETE RESTRICT,
  work_date date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('late', 'early_departure', 'absence', 'overtime')),
  minutes integer NOT NULL CHECK (minutes >= 0),
  rest_day boolean NOT NULL DEFAULT false,
  method text NOT NULL CHECK (method IN ('pro_rata', 'per_hour', 'per_day', 'daily_rate', 'multiplier')),
  amount numeric(18,2),
  policy_version_id uuid REFERENCES policy_version(policy_version_id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'waived', 'confirmed', 'cut', 'in_run')),
  decided_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  decided_at timestamptz,
  reason text,
  confirmed_minutes integer CHECK (confirmed_minutes IS NULL OR confirmed_minutes >= 0),
  payroll_run_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_pay_item_amount_check CHECK (amount IS NULL OR amount >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS attendance_pay_item_once_uq
  ON attendance_pay_item (employee_id, work_date, kind);
-- People · Attendance's Deductions and Overtime: pending first, then the newest day.
CREATE INDEX IF NOT EXISTS attendance_pay_item_list_idx ON attendance_pay_item (status, work_date DESC);
CREATE INDEX IF NOT EXISTS attendance_pay_item_day_fk_idx ON attendance_pay_item (attendance_day_id);
CREATE INDEX IF NOT EXISTS attendance_pay_item_policy_version_fk_idx ON attendance_pay_item (policy_version_id);
CREATE INDEX IF NOT EXISTS attendance_pay_item_decided_by_fk_idx ON attendance_pay_item (decided_by);
CREATE OR REPLACE TRIGGER attendance_pay_item_set_updated_at BEFORE UPDATE ON attendance_pay_item
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS attendance_overtime_approval (
  attendance_overtime_approval_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employee(employee_id) ON DELETE RESTRICT,
  work_date date NOT NULL,
  minutes integer NOT NULL CHECK (minutes BETWEEN 1 AND 720),
  approved_by uuid NOT NULL REFERENCES app_user(user_id) ON DELETE RESTRICT,
  approved_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS attendance_overtime_approval_once_uq
  ON attendance_overtime_approval (employee_id, work_date);
CREATE INDEX IF NOT EXISTS attendance_overtime_approval_approved_by_fk_idx ON attendance_overtime_approval (approved_by);
CREATE OR REPLACE TRIGGER attendance_overtime_approval_set_updated_at BEFORE UPDATE ON attendance_overtime_approval
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- DOWN
DROP TRIGGER IF EXISTS attendance_overtime_approval_set_updated_at ON attendance_overtime_approval;
DROP INDEX IF EXISTS attendance_overtime_approval_approved_by_fk_idx;
DROP INDEX IF EXISTS attendance_overtime_approval_once_uq;
DROP TABLE IF EXISTS attendance_overtime_approval;
DROP TRIGGER IF EXISTS attendance_pay_item_set_updated_at ON attendance_pay_item;
DROP INDEX IF EXISTS attendance_pay_item_decided_by_fk_idx;
DROP INDEX IF EXISTS attendance_pay_item_policy_version_fk_idx;
DROP INDEX IF EXISTS attendance_pay_item_day_fk_idx;
DROP INDEX IF EXISTS attendance_pay_item_list_idx;
DROP INDEX IF EXISTS attendance_pay_item_once_uq;
DROP TABLE IF EXISTS attendance_pay_item;
