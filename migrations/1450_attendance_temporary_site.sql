-- M1 temporary sites, as the attendance module writes them (docs/guides/attendance.md §4, §6.11).
--
--   attendance_temporary_site           a place to work for some days: a purpose from the
--                                       contract's list, a name, a description, the first and
--                                       last day (at most 90 in all). Numbered (temporary_site,
--                                       TS-0001). Submitted from Add Work Site and decided in its
--                                       approval (attendance.temporary_site), or added by People
--                                       and approved at once. A withdrawal or a cancellation keeps
--                                       when, by whom and why in cancelled_at, cancelled_by and
--                                       cancel_reason. Never deleted.
--   attendance_temporary_site_location  its one to eight addresses, each picked (place_id, the
--                                       place kept under the owner
--                                       attendance_temporary_site_location.address), its readable
--                                       line, the place's point as the fence's centre, a radius of
--                                       150 to 500 m and the place's time zone. A Temporary Home's
--                                       is personal data, read only through the service.
--   attendance_temporary_site_member    the people on it, at most 25. Taking someone off keeps the
--                                       row with removed_at; one approved or waiting site a person
--                                       a day is the service's rule, under the person's lock.
-- UP
CREATE TABLE IF NOT EXISTS attendance_temporary_site (
  temporary_site_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN (
    'client_visit', 'partner_meeting', 'training_delivering', 'training_attending', 'event', 'conference',
    'workshop', 'exhibition', 'market_activation', 'field_survey', 'site_inspection', 'media_engagement',
    'government_visit', 'out_of_station', 'coworking_space', 'temporary_home', 'other')),
  name text NOT NULL CHECK (char_length(name) BETWEEN 3 AND 120),
  description text NOT NULL CHECK (char_length(description) BETWEEN 30 AND 1000),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  status text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'approved', 'rejected', 'withdrawn', 'cancelled')),
  submitted_by uuid NOT NULL REFERENCES app_user(user_id) ON DELETE RESTRICT,
  workflow_instance_id uuid REFERENCES workflow_instance(workflow_instance_id) ON DELETE SET NULL,
  approved_at timestamptz,
  approved_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_temporary_site_span_check CHECK (ends_on >= starts_on AND ends_on - starts_on <= 89)
);
CREATE UNIQUE INDEX IF NOT EXISTS attendance_temporary_site_number_uq ON attendance_temporary_site (number);
-- The clock's and the overlap's read: the sites that apply on a day.
CREATE INDEX IF NOT EXISTS attendance_temporary_site_days_idx
  ON attendance_temporary_site (starts_on, ends_on) WHERE status IN ('submitted', 'approved');
CREATE INDEX IF NOT EXISTS attendance_temporary_site_status_idx ON attendance_temporary_site (status, starts_on);
CREATE INDEX IF NOT EXISTS attendance_temporary_site_submitted_by_fk_idx ON attendance_temporary_site (submitted_by);
CREATE INDEX IF NOT EXISTS attendance_temporary_site_workflow_instance_id_fk_idx
  ON attendance_temporary_site (workflow_instance_id);
CREATE INDEX IF NOT EXISTS attendance_temporary_site_approved_by_fk_idx ON attendance_temporary_site (approved_by);
CREATE INDEX IF NOT EXISTS attendance_temporary_site_cancelled_by_fk_idx ON attendance_temporary_site (cancelled_by);
CREATE OR REPLACE TRIGGER attendance_temporary_site_set_updated_at BEFORE UPDATE ON attendance_temporary_site
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS attendance_temporary_site_location (
  temporary_site_location_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  temporary_site_id uuid NOT NULL REFERENCES attendance_temporary_site(temporary_site_id) ON DELETE CASCADE,
  position smallint NOT NULL CHECK (position BETWEEN 1 AND 8),
  name text CHECK (name IS NULL OR char_length(name) BETWEEN 1 AND 60),
  place_id uuid NOT NULL REFERENCES place(place_id) ON DELETE RESTRICT,
  address text NOT NULL,
  latitude numeric(9,6) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude numeric(9,6) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  radius_m integer NOT NULL CHECK (radius_m BETWEEN 150 AND 500),
  timezone text NOT NULL DEFAULT 'Africa/Lagos',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS attendance_temporary_site_location_position_uq
  ON attendance_temporary_site_location (temporary_site_id, position);
CREATE INDEX IF NOT EXISTS attendance_temporary_site_location_place_id_fk_idx
  ON attendance_temporary_site_location (place_id);

CREATE TABLE IF NOT EXISTS attendance_temporary_site_member (
  temporary_site_id uuid NOT NULL REFERENCES attendance_temporary_site(temporary_site_id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employee(employee_id) ON DELETE RESTRICT,
  added_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  removed_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  removed_reason text,
  PRIMARY KEY (temporary_site_id, employee_id)
);
-- The clock's read: the site a person is on for a work date.
CREATE INDEX IF NOT EXISTS attendance_temporary_site_member_employee_idx
  ON attendance_temporary_site_member (employee_id) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS attendance_temporary_site_member_employee_fk_idx
  ON attendance_temporary_site_member (employee_id);
CREATE INDEX IF NOT EXISTS attendance_temporary_site_member_removed_by_fk_idx
  ON attendance_temporary_site_member (removed_by);

-- DOWN
DROP INDEX IF EXISTS attendance_temporary_site_member_removed_by_fk_idx;
DROP INDEX IF EXISTS attendance_temporary_site_member_employee_fk_idx;
DROP INDEX IF EXISTS attendance_temporary_site_member_employee_idx;
DROP TABLE IF EXISTS attendance_temporary_site_member;
DROP INDEX IF EXISTS attendance_temporary_site_location_place_id_fk_idx;
DROP INDEX IF EXISTS attendance_temporary_site_location_position_uq;
DROP TABLE IF EXISTS attendance_temporary_site_location;
DROP TRIGGER IF EXISTS attendance_temporary_site_set_updated_at ON attendance_temporary_site;
DROP INDEX IF EXISTS attendance_temporary_site_cancelled_by_fk_idx;
DROP INDEX IF EXISTS attendance_temporary_site_approved_by_fk_idx;
DROP INDEX IF EXISTS attendance_temporary_site_workflow_instance_id_fk_idx;
DROP INDEX IF EXISTS attendance_temporary_site_submitted_by_fk_idx;
DROP INDEX IF EXISTS attendance_temporary_site_status_idx;
DROP INDEX IF EXISTS attendance_temporary_site_days_idx;
DROP INDEX IF EXISTS attendance_temporary_site_number_uq;
DROP TABLE IF EXISTS attendance_temporary_site;
