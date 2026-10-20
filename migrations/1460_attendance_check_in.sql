-- M1 check-ins at each stop on a temporary site's day, as the attendance module writes them
-- (docs/guides/attendance.md §4, §6.12).
--
--   attendance_check_in    one stop: the server's time and the device's beside it, the reading (or
--                          none), the address of that day's site it was matched to, its distance and
--                          verdict, the evidence (the site, the address's name and radius, the mode,
--                          why a reading was unclear) and the policy version. Evidence, never a
--                          shift. One per person per idempotency key. Append-only.
--   attendance_exception   a flag can be about a check-in (attendance_check_in_id): one per check-in
--                          and type, as one per punch and type. 1300's day-level index
--                          (attendance_exception_day_type_uq, one missing clock-out a day) now
--                          leaves check-ins out, so two flagged check-ins on one day open two.
-- UP
CREATE TABLE IF NOT EXISTS attendance_check_in (
  attendance_check_in_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employee(employee_id) ON DELETE RESTRICT,
  work_date date NOT NULL,
  occurred_at timestamptz NOT NULL,
  device_at timestamptz,
  latitude numeric(9,6) CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  longitude numeric(9,6) CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  accuracy_m numeric(10,2),
  temporary_site_location_id uuid NOT NULL
    REFERENCES attendance_temporary_site_location(temporary_site_location_id) ON DELETE RESTRICT,
  distance_m numeric(10,2),
  verdict text NOT NULL CHECK (verdict IN ('inside', 'outside', 'unverified')),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  policy_version_id uuid REFERENCES policy_version(policy_version_id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  request_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((latitude IS NULL) = (longitude IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS attendance_check_in_idempotency_uq ON attendance_check_in (employee_id, idempotency_key);
-- The day's route, in time order: the panel, My Attendance and the day's evidence.
CREATE INDEX IF NOT EXISTS attendance_check_in_day_idx ON attendance_check_in (employee_id, work_date, occurred_at);
CREATE INDEX IF NOT EXISTS attendance_check_in_location_fk_idx ON attendance_check_in (temporary_site_location_id);
CREATE INDEX IF NOT EXISTS attendance_check_in_policy_version_fk_idx ON attendance_check_in (policy_version_id);
CREATE OR REPLACE TRIGGER attendance_check_in_append_only BEFORE UPDATE OR DELETE ON attendance_check_in
FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();

ALTER TABLE attendance_exception ADD COLUMN IF NOT EXISTS attendance_check_in_id uuid
  REFERENCES attendance_check_in(attendance_check_in_id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX IF NOT EXISTS attendance_exception_check_in_type_uq
  ON attendance_exception (attendance_check_in_id, exception_type) WHERE attendance_check_in_id IS NOT NULL;
-- 1300's day-level index, narrowed: a check-in's exception is its own, not the day's.
DROP INDEX IF EXISTS attendance_exception_day_type_uq;
CREATE UNIQUE INDEX IF NOT EXISTS attendance_exception_day_type_uq
  ON attendance_exception (attendance_day_id, exception_type)
  WHERE attendance_event_id IS NULL AND attendance_check_in_id IS NULL;

-- DOWN
-- 1300's index cannot hold two exceptions of a type on one day, so the check-ins' go first.
DELETE FROM attendance_exception WHERE attendance_check_in_id IS NOT NULL;
DROP INDEX IF EXISTS attendance_exception_day_type_uq;
CREATE UNIQUE INDEX IF NOT EXISTS attendance_exception_day_type_uq
  ON attendance_exception (attendance_day_id, exception_type) WHERE attendance_event_id IS NULL;
DROP INDEX IF EXISTS attendance_exception_check_in_type_uq;
ALTER TABLE attendance_exception DROP COLUMN IF EXISTS attendance_check_in_id;
DROP TRIGGER IF EXISTS attendance_check_in_append_only ON attendance_check_in;
DROP INDEX IF EXISTS attendance_check_in_policy_version_fk_idx;
DROP INDEX IF EXISTS attendance_check_in_location_fk_idx;
DROP INDEX IF EXISTS attendance_check_in_day_idx;
DROP INDEX IF EXISTS attendance_check_in_idempotency_uq;
DROP TABLE IF EXISTS attendance_check_in;
