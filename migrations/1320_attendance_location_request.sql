-- M1 work location requests, as the attendance module writes them (docs/guides/attendance.md §4,
-- §6.11).
--
--   attendance_location_request  a request to work somewhere else for some days: a temporary
--                                home (with one reading taken there), a remote day or a client
--                                visit. Numbered (location_request, WLR-0001), decided in its
--                                approval (attendance.location_request); the outcome is copied
--                                onto the row after commit. Approved, it decides the place a
--                                punch on those days is matched to. The point is a temporary
--                                home's only, and personal data (masked under employee.personal).
-- UP
CREATE TABLE IF NOT EXISTS attendance_location_request (
  location_request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number text NOT NULL,
  employee_id uuid NOT NULL REFERENCES employee(employee_id) ON DELETE RESTRICT,
  request_type text NOT NULL CHECK (request_type IN ('temporary_home', 'remote_day', 'client_visit')),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  address text,
  latitude numeric(9,6),
  longitude numeric(9,6),
  accuracy_m numeric(8,1),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'approved', 'rejected', 'cancelled')),
  workflow_instance_id uuid REFERENCES workflow_instance(workflow_instance_id) ON DELETE SET NULL,
  requested_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_location_request_span_check CHECK (ends_on >= starts_on),
  CONSTRAINT attendance_location_request_point_check CHECK ((latitude IS NULL) = (longitude IS NULL)),
  CONSTRAINT attendance_location_request_home_point_check CHECK (latitude IS NULL OR request_type = 'temporary_home')
);
CREATE UNIQUE INDEX IF NOT EXISTS attendance_location_request_number_uq ON attendance_location_request (number);
CREATE INDEX IF NOT EXISTS attendance_location_request_employee_idx
  ON attendance_location_request (employee_id, starts_on DESC);
CREATE INDEX IF NOT EXISTS attendance_location_request_queue_idx
  ON attendance_location_request (status, requested_at DESC);
-- The clock's read: the approved request covering a person's work date.
CREATE INDEX IF NOT EXISTS attendance_location_request_approved_idx
  ON attendance_location_request (employee_id, starts_on, ends_on) WHERE status = 'approved';
CREATE INDEX IF NOT EXISTS attendance_location_request_workflow_instance_id_fk_idx
  ON attendance_location_request (workflow_instance_id);
CREATE INDEX IF NOT EXISTS attendance_location_request_requested_by_fk_idx
  ON attendance_location_request (requested_by);
CREATE OR REPLACE TRIGGER attendance_location_request_set_updated_at BEFORE UPDATE ON attendance_location_request
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- DOWN
DROP TRIGGER IF EXISTS attendance_location_request_set_updated_at ON attendance_location_request;
DROP INDEX IF EXISTS attendance_location_request_requested_by_fk_idx;
DROP INDEX IF EXISTS attendance_location_request_workflow_instance_id_fk_idx;
DROP INDEX IF EXISTS attendance_location_request_approved_idx;
DROP INDEX IF EXISTS attendance_location_request_queue_idx;
DROP INDEX IF EXISTS attendance_location_request_employee_idx;
DROP INDEX IF EXISTS attendance_location_request_number_uq;
DROP TABLE IF EXISTS attendance_location_request;
