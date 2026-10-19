-- M1 hybrid staff's weekly schedule, as the attendance module writes it (docs/guides/attendance.md §4,
-- §6.13).
--
--   attendance_schedule  the days a hybrid employee works at their worksite (ISO weekdays, 1 Monday
--                        to 7 Sunday), from a first day, set by People with a reason. The other
--                        working days are worked from home and fenced on the approved home. One
--                        row per person per first day (setting it again from the same day replaces
--                        it); the row in force on a date is the latest that started by then.
-- UP
CREATE TABLE IF NOT EXISTS attendance_schedule (
  attendance_schedule_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employee(employee_id) ON DELETE RESTRICT,
  office_days smallint[] NOT NULL,
  effective_from date NOT NULL,
  reason text NOT NULL,
  set_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  set_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_schedule_days_check
    CHECK (cardinality(office_days) BETWEEN 1 AND 7 AND office_days <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[])
);
-- The clock's read: the schedule in force for a person on a date.
CREATE UNIQUE INDEX IF NOT EXISTS attendance_schedule_employee_from_uq
  ON attendance_schedule (employee_id, effective_from);
CREATE INDEX IF NOT EXISTS attendance_schedule_set_by_fk_idx ON attendance_schedule (set_by);
CREATE OR REPLACE TRIGGER attendance_schedule_set_updated_at BEFORE UPDATE ON attendance_schedule
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- DOWN
DROP TRIGGER IF EXISTS attendance_schedule_set_updated_at ON attendance_schedule;
DROP INDEX IF EXISTS attendance_schedule_set_by_fk_idx;
DROP INDEX IF EXISTS attendance_schedule_employee_from_uq;
DROP TABLE IF EXISTS attendance_schedule;
