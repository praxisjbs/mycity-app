-- M1 the clock watch: reminders to clock in and the automatic clock-out, as the attendance module
-- writes them (docs/guides/attendance.md §4, §6.14).
--
--   attendance_clock_reminder  one row per reminder sent, unique per person, day and kind, so the
--                              watch (every 5 minutes) sends it once a day; the notice is about it
--   attendance_event           an automatic clock-out (source 'system', already allowed by 1000) is
--                              counted apart: one a person a work date, beside the one active event
--                              of each type the person and People may write, so People's
--                              correction of its time is written next to it instead of over it
--   attendance_exception       the automatic_clock_out type, opened when the person explains one
-- UP
CREATE TABLE IF NOT EXISTS attendance_clock_reminder (
  attendance_clock_reminder_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employee(employee_id) ON DELETE RESTRICT,
  work_date date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('clock_in_due')),
  sent_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS attendance_clock_reminder_once_uq
  ON attendance_clock_reminder (employee_id, work_date, kind);
CREATE OR REPLACE TRIGGER attendance_clock_reminder_set_updated_at BEFORE UPDATE ON attendance_clock_reminder
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE UNIQUE INDEX IF NOT EXISTS attendance_event_one_active_person_uq
  ON attendance_event (employee_id, work_date, event_type)
  WHERE validation_state IN ('accepted', 'review') AND source <> 'system';
CREATE UNIQUE INDEX IF NOT EXISTS attendance_event_one_automatic_uq
  ON attendance_event (employee_id, work_date)
  WHERE source = 'system' AND event_type = 'clock_out';
-- Replaced by the two above: the same rule for every punch but the system's.
DROP INDEX IF EXISTS attendance_event_one_active_uq;

ALTER TABLE attendance_exception DROP CONSTRAINT IF EXISTS attendance_exception_type_home_check;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_exception_type_watch_check') THEN
    ALTER TABLE attendance_exception ADD CONSTRAINT attendance_exception_type_watch_check
      CHECK (exception_type IN ('outside_worksite', 'outside_home', 'location_unverified', 'unknown_device',
                                'suspicious_timestamp', 'missing_clock_out', 'automatic_clock_out'));
  END IF;
END;
$$;

-- DOWN
ALTER TABLE attendance_exception DROP CONSTRAINT IF EXISTS attendance_exception_type_watch_check;
-- Restores 1310's list; refused while an automatic_clock_out exception exists, which needs this file.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_exception_type_home_check') THEN
    ALTER TABLE attendance_exception ADD CONSTRAINT attendance_exception_type_home_check
      CHECK (exception_type IN ('outside_worksite', 'outside_home', 'location_unverified', 'unknown_device',
                                'suspicious_timestamp', 'missing_clock_out'));
  END IF;
END;
$$;
-- Restores 1300's index; refused while a day holds both an automatic clock-out and People's
-- correction of it, which needs this file.
CREATE UNIQUE INDEX IF NOT EXISTS attendance_event_one_active_uq
  ON attendance_event (employee_id, work_date, event_type) WHERE validation_state IN ('accepted', 'review');
DROP INDEX IF EXISTS attendance_event_one_automatic_uq;
DROP INDEX IF EXISTS attendance_event_one_active_person_uq;
DROP TRIGGER IF EXISTS attendance_clock_reminder_set_updated_at ON attendance_clock_reminder;
DROP INDEX IF EXISTS attendance_clock_reminder_once_uq;
DROP TABLE IF EXISTS attendance_clock_reminder;
