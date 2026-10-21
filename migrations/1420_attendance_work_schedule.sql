-- M1 a person's own work schedule, as the attendance module writes it (docs/guides/attendance.md §4,
-- §6.13; TB's decisions of 20/10/2026, T7 and T8).
--
--   attendance_work_schedule  a person's week from a first day: for each ISO weekday (Monday first)
--                             Working or Off, a working day's start and end (both, or neither for
--                             the company hours) and its place, Office or Remote; with a reason and
--                             who set it. One row per person per first day (setting it again from the
--                             same day replaces it); the row in force on a date is the latest that
--                             started by then. None means the company hours of the Attendance policy
--                             in force, at the place the work pattern gives.
--
-- It replaces attendance_schedule (1340), a hybrid employee's office days. Each of its rows is
-- copied into a schedule from the same first day, with the same reason and author: hours blank (the
-- company hours), Working on the weekdays the working week of Settings · Organisation works when
-- this file runs (Monday to Friday when it holds none, as shared/time/working-week reads it), the
-- office days Office and the other working days Remote. attendance_schedule is read by nothing after
-- this file and is dropped by a later release (MIGRATIONS §8). The copy is the rows as they stand:
-- a row set again later is the attendance service's, never this file's.
-- UP
CREATE TABLE IF NOT EXISTS attendance_work_schedule (
  attendance_work_schedule_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employee(employee_id) ON DELETE RESTRICT,
  days jsonb NOT NULL,
  effective_from date NOT NULL,
  reason text NOT NULL,
  set_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  set_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_work_schedule_days_check
    CHECK (jsonb_typeof(days) = 'array' AND jsonb_array_length(days) = 7)
);
-- The clock's read: the schedule in force for a person on a date.
CREATE UNIQUE INDEX IF NOT EXISTS attendance_work_schedule_employee_from_uq
  ON attendance_work_schedule (employee_id, effective_from);
CREATE INDEX IF NOT EXISTS attendance_work_schedule_set_by_fk_idx ON attendance_work_schedule (set_by);
CREATE OR REPLACE TRIGGER attendance_work_schedule_set_updated_at BEFORE UPDATE ON attendance_work_schedule
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO attendance_work_schedule (employee_id, days, effective_from, reason, set_by, set_at)
SELECT s.employee_id,
       (SELECT jsonb_agg(
                 jsonb_build_object(
                   'weekday', wd.d,
                   'working', wd.worked,
                   'starts_at', NULL,
                   'ends_at', NULL,
                   'place', CASE WHEN NOT wd.worked THEN NULL
                                 WHEN wd.d = ANY (s.office_days) THEN 'office'
                                 ELSE 'remote' END)
                 ORDER BY wd.d)
          FROM (SELECT g.d::smallint AS d,
                       CASE WHEN EXISTS (SELECT 1 FROM working_week)
                            THEN COALESCE((SELECT ww.is_working_day FROM working_week ww WHERE ww.weekday = g.d), false)
                            ELSE g.d <= 5 END AS worked
                  FROM generate_series(1, 7) AS g(d)) wd),
       s.effective_from, s.reason, s.set_by, s.set_at
  FROM attendance_schedule s
ON CONFLICT (employee_id, effective_from) DO NOTHING;

-- DOWN
DROP TRIGGER IF EXISTS attendance_work_schedule_set_updated_at ON attendance_work_schedule;
DROP INDEX IF EXISTS attendance_work_schedule_set_by_fk_idx;
DROP INDEX IF EXISTS attendance_work_schedule_employee_from_uq;
DROP TABLE IF EXISTS attendance_work_schedule;
