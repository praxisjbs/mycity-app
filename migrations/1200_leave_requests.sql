-- M1 leave requests as the leave module writes them (docs/guides/ess.md §3 step 5, §6).
--
-- 1000 created leave_request with a free-text status defaulting to 'draft'. Nothing writes a
-- draft: a request is submitted the moment it is saved, so the status is the contract's four
-- (LeaveStatus in packages/contract/schemas/leave.js) and the default is 'submitted'.
--
--   recorded_by   People recorded the leave on someone's behalf (People · Leave, Record Leave).
--                 It is approved at once, with no approval flow; who recorded it is kept here and
--                 in the audit row. Null for a request the employee made.
--   cancelled_at  when it was withdrawn or cancelled; the reason is on the approval and the audit.
--
-- The indexes are the ones the leave lists, the calendar, the clash list and the balance read
-- filter and join on, and the foreign keys 1000 left unindexed.
-- UP
ALTER TABLE leave_request ADD COLUMN IF NOT EXISTS recorded_by uuid REFERENCES app_user(user_id) ON DELETE SET NULL;
ALTER TABLE leave_request ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE leave_request ALTER COLUMN status SET DEFAULT 'submitted';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leave_request_status_check') THEN
    ALTER TABLE leave_request ADD CONSTRAINT leave_request_status_check
      CHECK (status IN ('submitted', 'approved', 'rejected', 'cancelled'));
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS leave_request_employee_dates_idx ON leave_request (employee_id, starts_on, ends_on);
CREATE INDEX IF NOT EXISTS leave_request_dates_idx ON leave_request (starts_on, ends_on);
CREATE INDEX IF NOT EXISTS leave_request_status_idx ON leave_request (status);
CREATE INDEX IF NOT EXISTS leave_request_submitted_at_idx ON leave_request (submitted_at);
CREATE INDEX IF NOT EXISTS leave_request_created_at_idx ON leave_request (created_at);
CREATE INDEX IF NOT EXISTS leave_request_leave_type_id_fk_idx ON leave_request (leave_type_id);
CREATE INDEX IF NOT EXISTS leave_request_workflow_instance_id_fk_idx ON leave_request (workflow_instance_id);
CREATE INDEX IF NOT EXISTS leave_request_recorded_by_fk_idx ON leave_request (recorded_by);
CREATE INDEX IF NOT EXISTS leave_balance_leave_type_id_fk_idx ON leave_balance (leave_type_id);
CREATE INDEX IF NOT EXISTS leave_type_name_idx ON leave_type (name);

-- DOWN
DROP INDEX IF EXISTS leave_type_name_idx;
DROP INDEX IF EXISTS leave_balance_leave_type_id_fk_idx;
DROP INDEX IF EXISTS leave_request_recorded_by_fk_idx;
DROP INDEX IF EXISTS leave_request_workflow_instance_id_fk_idx;
DROP INDEX IF EXISTS leave_request_leave_type_id_fk_idx;
DROP INDEX IF EXISTS leave_request_created_at_idx;
DROP INDEX IF EXISTS leave_request_submitted_at_idx;
DROP INDEX IF EXISTS leave_request_status_idx;
DROP INDEX IF EXISTS leave_request_dates_idx;
DROP INDEX IF EXISTS leave_request_employee_dates_idx;
ALTER TABLE leave_request DROP CONSTRAINT IF EXISTS leave_request_status_check;
ALTER TABLE leave_request ALTER COLUMN status SET DEFAULT 'draft';
-- DESTRUCTIVE: rolling back loses who recorded a leave and when one was cancelled; the audit keeps both.
ALTER TABLE leave_request DROP COLUMN IF EXISTS cancelled_at;
-- DESTRUCTIVE: as above.
ALTER TABLE leave_request DROP COLUMN IF EXISTS recorded_by;
