-- M1 clock-in and clock-out as the attendance, devices and worksites modules write them
-- (docs/guides/attendance.md §4, §6).
--
--   attendance_policy     the geofence and device modes (off, warn, block; MILESTONES §6.2,
--                         REUSE_MAP §2.2) and the accuracy a reading must reach. They replace
--                         1000's require_geofence and require_known_device booleans, which nothing
--                         reads; the booleans are dropped in a later release (MIGRATIONS §8).
--   attendance_device     the devices a person clocks in from: the session's known_device, first
--                         seen on a punch, registered by the person (at most three, enforced by the
--                         devices service), removed by them or by People.
--   attendance_event      the workplace date, the device's own time beside the server's, the device
--                         and policy it was judged with, the client's idempotency key, a note, and
--                         who recorded a correction. One active (accepted or review) event of each
--                         type per person per day, and one per idempotency key. Append-only.
--   attendance_day        the four statuses the reference seed lists, or none yet (a day whose only
--                         punch a decision excluded), and the register's index.
--   attendance_exception  the punch it is about, the decision's outcome, the person's explanation,
--                         the exception types the code raises, and one exception per punch and type
--                         (one day-level missing clock-out per day), so a retried job adds none.
--
-- DESTRUCTIVE: attendance_event.work_date is set NOT NULL after a backfill from occurred_at in
-- Africa/Lagos; no code wrote the table before this file, so nothing is lost. The exception status
-- check is narrowed to open and resolved, the two the code writes; no row can hold another.
-- UP
ALTER TABLE attendance_policy ADD COLUMN IF NOT EXISTS geofence_mode text NOT NULL DEFAULT 'warn';
ALTER TABLE attendance_policy ADD COLUMN IF NOT EXISTS device_mode text NOT NULL DEFAULT 'off';
ALTER TABLE attendance_policy ADD COLUMN IF NOT EXISTS max_accuracy_m integer NOT NULL DEFAULT 100;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_policy_geofence_mode_check') THEN
    ALTER TABLE attendance_policy ADD CONSTRAINT attendance_policy_geofence_mode_check
      CHECK (geofence_mode IN ('off', 'warn', 'block'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_policy_device_mode_check') THEN
    ALTER TABLE attendance_policy ADD CONSTRAINT attendance_policy_device_mode_check
      CHECK (device_mode IN ('off', 'warn', 'block'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_policy_max_accuracy_m_check') THEN
    ALTER TABLE attendance_policy ADD CONSTRAINT attendance_policy_max_accuracy_m_check
      CHECK (max_accuracy_m > 0);
  END IF;
END;
$$;
COMMENT ON COLUMN attendance_policy.require_geofence IS 'Superseded by geofence_mode (1300); not read.';
COMMENT ON COLUMN attendance_policy.require_known_device IS 'Superseded by device_mode (1300); not read.';

CREATE INDEX IF NOT EXISTS employee_attendance_policy_policy_fk_idx
  ON employee_attendance_policy (attendance_policy_id);
CREATE INDEX IF NOT EXISTS employee_attendance_policy_worksite_fk_idx
  ON employee_attendance_policy (worksite_id);

CREATE TABLE IF NOT EXISTS attendance_device (
  attendance_device_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employee(employee_id) ON DELETE RESTRICT,
  known_device_id uuid NOT NULL UNIQUE REFERENCES known_device(known_device_id) ON DELETE CASCADE,
  label text NOT NULL,
  status text NOT NULL DEFAULT 'observed' CHECK (status IN ('observed', 'registered', 'removed')),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_punch_at timestamptz,
  registered_at timestamptz,
  removed_at timestamptz,
  removed_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  removal_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS attendance_device_employee_idx ON attendance_device (employee_id, status);
CREATE INDEX IF NOT EXISTS attendance_device_status_idx ON attendance_device (status, first_seen_at DESC);
CREATE INDEX IF NOT EXISTS attendance_device_removed_by_fk_idx ON attendance_device (removed_by);
CREATE OR REPLACE TRIGGER attendance_device_set_updated_at BEFORE UPDATE ON attendance_device
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE attendance_event ADD COLUMN IF NOT EXISTS work_date date;
ALTER TABLE attendance_event ADD COLUMN IF NOT EXISTS device_at timestamptz;
ALTER TABLE attendance_event ADD COLUMN IF NOT EXISTS attendance_device_id uuid
  REFERENCES attendance_device(attendance_device_id) ON DELETE RESTRICT;
ALTER TABLE attendance_event ADD COLUMN IF NOT EXISTS attendance_policy_id uuid
  REFERENCES attendance_policy(attendance_policy_id) ON DELETE RESTRICT;
ALTER TABLE attendance_event ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE attendance_event ADD COLUMN IF NOT EXISTS note text;
ALTER TABLE attendance_event ADD COLUMN IF NOT EXISTS recorded_by uuid
  REFERENCES app_user(user_id) ON DELETE RESTRICT;
ALTER TABLE attendance_event ADD COLUMN IF NOT EXISTS reason text;
UPDATE attendance_event SET work_date = (occurred_at AT TIME ZONE 'Africa/Lagos')::date WHERE work_date IS NULL;
ALTER TABLE attendance_event ALTER COLUMN work_date SET NOT NULL; -- DESTRUCTIVE: backfilled above; no writer existed before this file
CREATE UNIQUE INDEX IF NOT EXISTS attendance_event_one_active_uq
  ON attendance_event (employee_id, work_date, event_type) WHERE validation_state IN ('accepted', 'review');
CREATE UNIQUE INDEX IF NOT EXISTS attendance_event_idempotency_uq
  ON attendance_event (employee_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS attendance_event_work_date_idx ON attendance_event (work_date, employee_id);
CREATE INDEX IF NOT EXISTS attendance_event_worksite_fk_idx ON attendance_event (worksite_id);
CREATE INDEX IF NOT EXISTS attendance_event_known_device_fk_idx ON attendance_event (known_device_id);
CREATE INDEX IF NOT EXISTS attendance_event_device_fk_idx ON attendance_event (attendance_device_id);
CREATE INDEX IF NOT EXISTS attendance_event_policy_fk_idx ON attendance_event (attendance_policy_id);
CREATE INDEX IF NOT EXISTS attendance_event_recorded_by_fk_idx ON attendance_event (recorded_by);
CREATE OR REPLACE TRIGGER attendance_event_append_only BEFORE UPDATE OR DELETE ON attendance_event
FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();

ALTER TABLE attendance_day ALTER COLUMN status DROP NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_day_status_check') THEN
    ALTER TABLE attendance_day ADD CONSTRAINT attendance_day_status_check
      CHECK (status IS NULL OR status IN ('present', 'late', 'absent', 'leave'));
  END IF;
END;
$$;
CREATE INDEX IF NOT EXISTS attendance_day_date_status_idx ON attendance_day (attendance_date, status);

ALTER TABLE attendance_exception ADD COLUMN IF NOT EXISTS attendance_event_id uuid
  REFERENCES attendance_event(attendance_event_id) ON DELETE RESTRICT;
ALTER TABLE attendance_exception ADD COLUMN IF NOT EXISTS outcome text;
ALTER TABLE attendance_exception ADD COLUMN IF NOT EXISTS employee_note text;
ALTER TABLE attendance_exception ADD COLUMN IF NOT EXISTS employee_noted_at timestamptz;
ALTER TABLE attendance_exception DROP CONSTRAINT IF EXISTS attendance_exception_status_check;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_exception_status_open_check') THEN
    ALTER TABLE attendance_exception ADD CONSTRAINT attendance_exception_status_open_check
      CHECK (status IN ('open', 'resolved'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_exception_outcome_check') THEN
    ALTER TABLE attendance_exception ADD CONSTRAINT attendance_exception_outcome_check
      CHECK (outcome IS NULL OR outcome IN ('accepted', 'rejected', 'corrected'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_exception_type_check') THEN
    ALTER TABLE attendance_exception ADD CONSTRAINT attendance_exception_type_check
      CHECK (exception_type IN ('outside_worksite', 'location_unverified', 'unknown_device',
                                'suspicious_timestamp', 'missing_clock_out'));
  END IF;
END;
$$;
CREATE UNIQUE INDEX IF NOT EXISTS attendance_exception_event_type_uq
  ON attendance_exception (attendance_event_id, exception_type) WHERE attendance_event_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS attendance_exception_day_type_uq
  ON attendance_exception (attendance_day_id, exception_type) WHERE attendance_event_id IS NULL;
CREATE INDEX IF NOT EXISTS attendance_exception_day_fk_idx ON attendance_exception (attendance_day_id);
CREATE INDEX IF NOT EXISTS attendance_exception_event_fk_idx ON attendance_exception (attendance_event_id);
CREATE INDEX IF NOT EXISTS attendance_exception_reviewed_by_fk_idx ON attendance_exception (reviewed_by);
CREATE INDEX IF NOT EXISTS attendance_exception_queue_idx ON attendance_exception (status, created_at DESC);

-- DOWN
DROP INDEX IF EXISTS attendance_exception_queue_idx;
DROP INDEX IF EXISTS attendance_exception_reviewed_by_fk_idx;
DROP INDEX IF EXISTS attendance_exception_event_fk_idx;
DROP INDEX IF EXISTS attendance_exception_day_fk_idx;
DROP INDEX IF EXISTS attendance_exception_day_type_uq;
DROP INDEX IF EXISTS attendance_exception_event_type_uq;
ALTER TABLE attendance_exception DROP CONSTRAINT IF EXISTS attendance_exception_type_check;
ALTER TABLE attendance_exception DROP CONSTRAINT IF EXISTS attendance_exception_outcome_check;
ALTER TABLE attendance_exception DROP CONSTRAINT IF EXISTS attendance_exception_status_open_check;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_exception_status_check') THEN
    ALTER TABLE attendance_exception ADD CONSTRAINT attendance_exception_status_check
      CHECK (status IN ('open', 'under_review', 'resolved', 'dismissed'));
  END IF;
END;
$$;
ALTER TABLE attendance_exception DROP COLUMN IF EXISTS employee_noted_at;
ALTER TABLE attendance_exception DROP COLUMN IF EXISTS employee_note;
ALTER TABLE attendance_exception DROP COLUMN IF EXISTS outcome;
ALTER TABLE attendance_exception DROP COLUMN IF EXISTS attendance_event_id;

DROP INDEX IF EXISTS attendance_day_date_status_idx;
ALTER TABLE attendance_day DROP CONSTRAINT IF EXISTS attendance_day_status_check;
-- Restores 1000's NOT NULL; fails on a database that holds a day with no status, which needs this file.
ALTER TABLE attendance_day ALTER COLUMN status SET NOT NULL; -- DESTRUCTIVE: only in DOWN, refused while a day has no status

DROP TRIGGER IF EXISTS attendance_event_append_only ON attendance_event;
DROP INDEX IF EXISTS attendance_event_recorded_by_fk_idx;
DROP INDEX IF EXISTS attendance_event_policy_fk_idx;
DROP INDEX IF EXISTS attendance_event_device_fk_idx;
DROP INDEX IF EXISTS attendance_event_known_device_fk_idx;
DROP INDEX IF EXISTS attendance_event_worksite_fk_idx;
DROP INDEX IF EXISTS attendance_event_work_date_idx;
DROP INDEX IF EXISTS attendance_event_idempotency_uq;
DROP INDEX IF EXISTS attendance_event_one_active_uq;
ALTER TABLE attendance_event DROP COLUMN IF EXISTS reason;
ALTER TABLE attendance_event DROP COLUMN IF EXISTS recorded_by;
ALTER TABLE attendance_event DROP COLUMN IF EXISTS note;
ALTER TABLE attendance_event DROP COLUMN IF EXISTS idempotency_key;
ALTER TABLE attendance_event DROP COLUMN IF EXISTS attendance_policy_id;
ALTER TABLE attendance_event DROP COLUMN IF EXISTS attendance_device_id;
ALTER TABLE attendance_event DROP COLUMN IF EXISTS device_at;
ALTER TABLE attendance_event DROP COLUMN IF EXISTS work_date;

DROP TRIGGER IF EXISTS attendance_device_set_updated_at ON attendance_device;
DROP INDEX IF EXISTS attendance_device_removed_by_fk_idx;
DROP INDEX IF EXISTS attendance_device_status_idx;
DROP INDEX IF EXISTS attendance_device_employee_idx;
DROP TABLE IF EXISTS attendance_device;

DROP INDEX IF EXISTS employee_attendance_policy_worksite_fk_idx;
DROP INDEX IF EXISTS employee_attendance_policy_policy_fk_idx;

COMMENT ON COLUMN attendance_policy.require_known_device IS NULL;
COMMENT ON COLUMN attendance_policy.require_geofence IS NULL;
ALTER TABLE attendance_policy DROP CONSTRAINT IF EXISTS attendance_policy_max_accuracy_m_check;
ALTER TABLE attendance_policy DROP CONSTRAINT IF EXISTS attendance_policy_device_mode_check;
ALTER TABLE attendance_policy DROP CONSTRAINT IF EXISTS attendance_policy_geofence_mode_check;
ALTER TABLE attendance_policy DROP COLUMN IF EXISTS max_accuracy_m;
ALTER TABLE attendance_policy DROP COLUMN IF EXISTS device_mode;
ALTER TABLE attendance_policy DROP COLUMN IF EXISTS geofence_mode;
