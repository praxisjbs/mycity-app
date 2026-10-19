-- M1 field assignments, as the attendance module writes them (docs/guides/attendance.md §4,
-- §6.12).
--
--   attendance_field_assignment  people sent to one or two sites for some days by their line
--                                manager or People, in force from the moment it is saved.
--                                Numbered (field_assignment, FA-0001); cancelled, it stops
--                                applying to the days still to come. Never deleted.
--   attendance_field_site        its one or two sites: a client's venue with a centre and a
--                                radius, typed as a worksite's are. Not personal data.
--   attendance_field_member      the people on it, at most 25. Taking someone off keeps the row
--                                with removed_at; one active assignment a person a day is the
--                                service's rule, under the person's lock.
-- UP
CREATE TABLE IF NOT EXISTS attendance_field_assignment (
  field_assignment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number text NOT NULL,
  name text NOT NULL,
  client text NOT NULL,
  note text,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  assigned_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_field_assignment_span_check CHECK (ends_on >= starts_on AND ends_on - starts_on <= 30)
);
CREATE UNIQUE INDEX IF NOT EXISTS attendance_field_assignment_number_uq ON attendance_field_assignment (number);
CREATE INDEX IF NOT EXISTS attendance_field_assignment_days_idx
  ON attendance_field_assignment (starts_on, ends_on) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS attendance_field_assignment_assigned_by_fk_idx ON attendance_field_assignment (assigned_by);
CREATE INDEX IF NOT EXISTS attendance_field_assignment_cancelled_by_fk_idx ON attendance_field_assignment (cancelled_by);
CREATE OR REPLACE TRIGGER attendance_field_assignment_set_updated_at BEFORE UPDATE ON attendance_field_assignment
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS attendance_field_site (
  field_site_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  field_assignment_id uuid NOT NULL REFERENCES attendance_field_assignment(field_assignment_id) ON DELETE CASCADE,
  position smallint NOT NULL CHECK (position IN (1, 2)),
  name text NOT NULL,
  address text,
  latitude numeric(9,6) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude numeric(9,6) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  radius_m integer NOT NULL CHECK (radius_m BETWEEN 100 AND 500),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS attendance_field_site_position_uq ON attendance_field_site (field_assignment_id, position);

CREATE TABLE IF NOT EXISTS attendance_field_member (
  field_assignment_id uuid NOT NULL REFERENCES attendance_field_assignment(field_assignment_id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employee(employee_id) ON DELETE RESTRICT,
  added_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  removed_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  removed_reason text,
  PRIMARY KEY (field_assignment_id, employee_id)
);
-- The clock's read: the assignment a person is on for a work date.
CREATE INDEX IF NOT EXISTS attendance_field_member_employee_idx
  ON attendance_field_member (employee_id) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS attendance_field_member_removed_by_fk_idx ON attendance_field_member (removed_by);

-- DOWN
DROP INDEX IF EXISTS attendance_field_member_removed_by_fk_idx;
DROP INDEX IF EXISTS attendance_field_member_employee_idx;
DROP TABLE IF EXISTS attendance_field_member;
DROP INDEX IF EXISTS attendance_field_site_position_uq;
DROP TABLE IF EXISTS attendance_field_site;
DROP TRIGGER IF EXISTS attendance_field_assignment_set_updated_at ON attendance_field_assignment;
DROP INDEX IF EXISTS attendance_field_assignment_cancelled_by_fk_idx;
DROP INDEX IF EXISTS attendance_field_assignment_assigned_by_fk_idx;
DROP INDEX IF EXISTS attendance_field_assignment_days_idx;
DROP INDEX IF EXISTS attendance_field_assignment_number_uq;
DROP TABLE IF EXISTS attendance_field_assignment;
