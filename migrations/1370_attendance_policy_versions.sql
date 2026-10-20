-- M1 attendance policy versions: People publish them from a first day, staff acknowledge them (docs/guides/attendance.md §6.15).
--
--   attendance_policy     one organisation policy in numbered versions: status (draft, published,
--                         withdrawn), version, effective_from, the note People write, who published
--                         or withdrew it and when, why it was withdrawn, who saved it. At most one
--                         draft; a version number is never used twice. The location check has a mode
--                         for each kind of place (office, home, field site) in place of 1300's one
--                         geofence_mode, which stays, written equal to the office's, until a later
--                         release drops it with 1000's booleans (MIGRATIONS §8). A row from before
--                         this file is published with no version and no first day: it applies only
--                         until the first version starts, and its three modes take its one.
--   attendance_policy_acknowledgement
--                         one row per person and version: when they were reminded to acknowledge it
--                         and when they did.
-- UP
ALTER TABLE attendance_policy ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'published';
ALTER TABLE attendance_policy ADD COLUMN IF NOT EXISTS version integer;
ALTER TABLE attendance_policy ADD COLUMN IF NOT EXISTS effective_from date;
ALTER TABLE attendance_policy ADD COLUMN IF NOT EXISTS note text;
ALTER TABLE attendance_policy ADD COLUMN IF NOT EXISTS published_at timestamptz;
ALTER TABLE attendance_policy ADD COLUMN IF NOT EXISTS published_by uuid
  REFERENCES app_user(user_id) ON DELETE RESTRICT;
ALTER TABLE attendance_policy ADD COLUMN IF NOT EXISTS withdrawn_at timestamptz;
ALTER TABLE attendance_policy ADD COLUMN IF NOT EXISTS withdrawn_by uuid
  REFERENCES app_user(user_id) ON DELETE RESTRICT;
ALTER TABLE attendance_policy ADD COLUMN IF NOT EXISTS withdraw_reason text;
ALTER TABLE attendance_policy ADD COLUMN IF NOT EXISTS created_by uuid
  REFERENCES app_user(user_id) ON DELETE RESTRICT;
ALTER TABLE attendance_policy ADD COLUMN IF NOT EXISTS updated_by uuid
  REFERENCES app_user(user_id) ON DELETE RESTRICT;
ALTER TABLE attendance_policy ADD COLUMN IF NOT EXISTS office_geofence_mode text NOT NULL DEFAULT 'warn';
ALTER TABLE attendance_policy ADD COLUMN IF NOT EXISTS home_geofence_mode text NOT NULL DEFAULT 'warn';
ALTER TABLE attendance_policy ADD COLUMN IF NOT EXISTS site_geofence_mode text NOT NULL DEFAULT 'warn';

-- A row from before versions keeps judging as it did: its one mode becomes each place's. The
-- service writes a version's three modes itself, so a re-run touches only those older rows and
-- leaves them as they are.
UPDATE attendance_policy
   SET office_geofence_mode = geofence_mode,
       home_geofence_mode = geofence_mode,
       site_geofence_mode = geofence_mode
 WHERE version IS NULL
   AND status = 'published'
   AND (office_geofence_mode, home_geofence_mode, site_geofence_mode)
       IS DISTINCT FROM (geofence_mode, geofence_mode, geofence_mode);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_policy_status_check') THEN
    ALTER TABLE attendance_policy ADD CONSTRAINT attendance_policy_status_check
      CHECK (status IN ('draft', 'published', 'withdrawn'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_policy_office_geofence_mode_check') THEN
    ALTER TABLE attendance_policy ADD CONSTRAINT attendance_policy_office_geofence_mode_check
      CHECK (office_geofence_mode IN ('off', 'warn', 'block'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_policy_home_geofence_mode_check') THEN
    ALTER TABLE attendance_policy ADD CONSTRAINT attendance_policy_home_geofence_mode_check
      CHECK (home_geofence_mode IN ('off', 'warn', 'block'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_policy_site_geofence_mode_check') THEN
    ALTER TABLE attendance_policy ADD CONSTRAINT attendance_policy_site_geofence_mode_check
      CHECK (site_geofence_mode IN ('off', 'warn', 'block'));
  END IF;
  -- A draft has no number; a version has its number, first day and publication, and a withdrawn
  -- one says when. A row from before versions is published with none of them.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_policy_version_check') THEN
    ALTER TABLE attendance_policy ADD CONSTRAINT attendance_policy_version_check
      CHECK (
        (status = 'draft' AND version IS NULL)
        OR (status = 'published' AND version IS NULL AND effective_from IS NULL)
        OR (status IN ('published', 'withdrawn') AND version > 0 AND effective_from IS NOT NULL
            AND published_at IS NOT NULL AND note IS NOT NULL)
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_policy_withdrawn_check') THEN
    ALTER TABLE attendance_policy ADD CONSTRAINT attendance_policy_withdrawn_check
      CHECK ((status = 'withdrawn') = (withdrawn_at IS NOT NULL));
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS attendance_policy_version_uq
  ON attendance_policy (version) WHERE version IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS attendance_policy_one_draft_uq
  ON attendance_policy ((status)) WHERE status = 'draft';
-- The version in force on a date: the latest first day on or before it.
CREATE INDEX IF NOT EXISTS attendance_policy_in_force_idx
  ON attendance_policy (effective_from DESC, version DESC) WHERE status = 'published' AND version IS NOT NULL;
CREATE INDEX IF NOT EXISTS attendance_policy_published_by_fk_idx ON attendance_policy (published_by);
CREATE INDEX IF NOT EXISTS attendance_policy_withdrawn_by_fk_idx ON attendance_policy (withdrawn_by);
CREATE INDEX IF NOT EXISTS attendance_policy_created_by_fk_idx ON attendance_policy (created_by);
CREATE INDEX IF NOT EXISTS attendance_policy_updated_by_fk_idx ON attendance_policy (updated_by);

COMMENT ON COLUMN attendance_policy.geofence_mode IS
  'Superseded by office_geofence_mode, home_geofence_mode and site_geofence_mode (1370); written equal to the office''s, not read.';

CREATE TABLE IF NOT EXISTS attendance_policy_acknowledgement (
  attendance_policy_acknowledgement_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_policy_id uuid NOT NULL REFERENCES attendance_policy(attendance_policy_id) ON DELETE RESTRICT,
  employee_id uuid NOT NULL REFERENCES employee(employee_id) ON DELETE RESTRICT,
  reminded_at timestamptz,
  acknowledged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS attendance_policy_acknowledgement_once_uq
  ON attendance_policy_acknowledgement (attendance_policy_id, employee_id);
CREATE INDEX IF NOT EXISTS attendance_policy_acknowledgement_employee_fk_idx
  ON attendance_policy_acknowledgement (employee_id);

CREATE OR REPLACE TRIGGER attendance_policy_acknowledgement_set_updated_at
  BEFORE UPDATE ON attendance_policy_acknowledgement
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- DOWN
-- Before versions every active row was a policy: a draft never judged a punch and a withdrawn
-- version never applied, so neither may become one once their status is gone.
UPDATE attendance_policy SET active = false WHERE status IN ('draft', 'withdrawn') AND active;
DROP TRIGGER IF EXISTS attendance_policy_acknowledgement_set_updated_at ON attendance_policy_acknowledgement;
DROP INDEX IF EXISTS attendance_policy_acknowledgement_employee_fk_idx;
DROP INDEX IF EXISTS attendance_policy_acknowledgement_once_uq;
DROP TABLE IF EXISTS attendance_policy_acknowledgement;

COMMENT ON COLUMN attendance_policy.geofence_mode IS NULL;
DROP INDEX IF EXISTS attendance_policy_updated_by_fk_idx;
DROP INDEX IF EXISTS attendance_policy_created_by_fk_idx;
DROP INDEX IF EXISTS attendance_policy_withdrawn_by_fk_idx;
DROP INDEX IF EXISTS attendance_policy_published_by_fk_idx;
DROP INDEX IF EXISTS attendance_policy_in_force_idx;
DROP INDEX IF EXISTS attendance_policy_one_draft_uq;
DROP INDEX IF EXISTS attendance_policy_version_uq;

ALTER TABLE attendance_policy DROP CONSTRAINT IF EXISTS attendance_policy_withdrawn_check;
ALTER TABLE attendance_policy DROP CONSTRAINT IF EXISTS attendance_policy_version_check;
ALTER TABLE attendance_policy DROP CONSTRAINT IF EXISTS attendance_policy_site_geofence_mode_check;
ALTER TABLE attendance_policy DROP CONSTRAINT IF EXISTS attendance_policy_home_geofence_mode_check;
ALTER TABLE attendance_policy DROP CONSTRAINT IF EXISTS attendance_policy_office_geofence_mode_check;
ALTER TABLE attendance_policy DROP CONSTRAINT IF EXISTS attendance_policy_status_check;

ALTER TABLE attendance_policy DROP COLUMN IF EXISTS site_geofence_mode;
ALTER TABLE attendance_policy DROP COLUMN IF EXISTS home_geofence_mode;
ALTER TABLE attendance_policy DROP COLUMN IF EXISTS office_geofence_mode;
ALTER TABLE attendance_policy DROP COLUMN IF EXISTS updated_by;
ALTER TABLE attendance_policy DROP COLUMN IF EXISTS created_by;
ALTER TABLE attendance_policy DROP COLUMN IF EXISTS withdraw_reason;
ALTER TABLE attendance_policy DROP COLUMN IF EXISTS withdrawn_by;
ALTER TABLE attendance_policy DROP COLUMN IF EXISTS withdrawn_at;
ALTER TABLE attendance_policy DROP COLUMN IF EXISTS published_by;
ALTER TABLE attendance_policy DROP COLUMN IF EXISTS published_at;
ALTER TABLE attendance_policy DROP COLUMN IF EXISTS note;
ALTER TABLE attendance_policy DROP COLUMN IF EXISTS effective_from;
ALTER TABLE attendance_policy DROP COLUMN IF EXISTS version;
ALTER TABLE attendance_policy DROP COLUMN IF EXISTS status;
