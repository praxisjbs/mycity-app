-- M1 remote staff's approved homes, as the attendance module writes them (docs/guides/attendance.md
-- §4, §6.5, §6.10).
--
--   attendance_home       a remote employee's home location: one reading taken at home and the
--                         address in their words, waiting for People, then approved or rejected.
--                         At most one waiting and one approved per person; approving supersedes the
--                         old approved one, and a new request supersedes one still waiting. The
--                         address and the point are personal data (masked under employee.personal).
--   attendance_policy     home_radius_m: the fence around an approved home (100 m).
--   attendance_exception  the outside_home type, a remote punch beyond its approved home's fence.
-- UP
CREATE TABLE IF NOT EXISTS attendance_home (
  attendance_home_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employee(employee_id) ON DELETE RESTRICT,
  address text NOT NULL,
  latitude numeric(9,6) NOT NULL,
  longitude numeric(9,6) NOT NULL,
  accuracy_m numeric(8,1),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'superseded')),
  requested_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  decided_at timestamptz,
  decision_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS attendance_home_one_pending_uq ON attendance_home (employee_id) WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS attendance_home_one_approved_uq ON attendance_home (employee_id) WHERE status = 'approved';
CREATE INDEX IF NOT EXISTS attendance_home_employee_idx ON attendance_home (employee_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS attendance_home_queue_idx ON attendance_home (status, requested_at DESC);
CREATE INDEX IF NOT EXISTS attendance_home_requested_by_fk_idx ON attendance_home (requested_by);
CREATE INDEX IF NOT EXISTS attendance_home_decided_by_fk_idx ON attendance_home (decided_by);
CREATE OR REPLACE TRIGGER attendance_home_set_updated_at BEFORE UPDATE ON attendance_home
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE attendance_policy ADD COLUMN IF NOT EXISTS home_radius_m integer NOT NULL DEFAULT 100;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_policy_home_radius_m_check') THEN
    ALTER TABLE attendance_policy ADD CONSTRAINT attendance_policy_home_radius_m_check
      CHECK (home_radius_m BETWEEN 25 AND 1000);
  END IF;
END;
$$;

ALTER TABLE attendance_exception DROP CONSTRAINT IF EXISTS attendance_exception_type_check;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_exception_type_home_check') THEN
    ALTER TABLE attendance_exception ADD CONSTRAINT attendance_exception_type_home_check
      CHECK (exception_type IN ('outside_worksite', 'outside_home', 'location_unverified', 'unknown_device',
                                'suspicious_timestamp', 'missing_clock_out'));
  END IF;
END;
$$;

-- DOWN
ALTER TABLE attendance_exception DROP CONSTRAINT IF EXISTS attendance_exception_type_home_check;
-- Restores 1300's list; refused while an outside_home exception exists, which needs this file.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_exception_type_check') THEN
    ALTER TABLE attendance_exception ADD CONSTRAINT attendance_exception_type_check
      CHECK (exception_type IN ('outside_worksite', 'location_unverified', 'unknown_device',
                                'suspicious_timestamp', 'missing_clock_out'));
  END IF;
END;
$$;

ALTER TABLE attendance_policy DROP CONSTRAINT IF EXISTS attendance_policy_home_radius_m_check;
ALTER TABLE attendance_policy DROP COLUMN IF EXISTS home_radius_m;

DROP TRIGGER IF EXISTS attendance_home_set_updated_at ON attendance_home;
DROP INDEX IF EXISTS attendance_home_decided_by_fk_idx;
DROP INDEX IF EXISTS attendance_home_requested_by_fk_idx;
DROP INDEX IF EXISTS attendance_home_queue_idx;
DROP INDEX IF EXISTS attendance_home_employee_idx;
DROP INDEX IF EXISTS attendance_home_one_approved_uq;
DROP INDEX IF EXISTS attendance_home_one_pending_uq;
DROP TABLE IF EXISTS attendance_home;
