-- M1 a temporary site's hours, as the attendance module writes them (docs/guides/attendance.md
-- §4, §6.11; owner decision of 21/10/2026).
--
-- A site runs on the Usual Shift (the organisation's week) or on its own Site Hours: a start and an
-- end, the end after the start on the same day, the same for every day of the site. A site with
-- its own hours makes each of its days a working day for its people, with those hours on the
-- site's clock. Sites added before this keep the Usual Shift.

-- UP
ALTER TABLE attendance_temporary_site ADD COLUMN IF NOT EXISTS hours text NOT NULL DEFAULT 'usual';
ALTER TABLE attendance_temporary_site ADD COLUMN IF NOT EXISTS starts_at time;
ALTER TABLE attendance_temporary_site ADD COLUMN IF NOT EXISTS ends_at time;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_temporary_site_hours_check') THEN
    ALTER TABLE attendance_temporary_site ADD CONSTRAINT attendance_temporary_site_hours_check
      CHECK (hours IN ('usual', 'site'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_temporary_site_hours_times_check') THEN
    ALTER TABLE attendance_temporary_site ADD CONSTRAINT attendance_temporary_site_hours_times_check
      CHECK ((hours = 'usual' AND starts_at IS NULL AND ends_at IS NULL)
          OR (hours = 'site' AND starts_at IS NOT NULL AND ends_at IS NOT NULL AND ends_at > starts_at));
  END IF;
END;
$$;

-- DOWN
ALTER TABLE attendance_temporary_site DROP CONSTRAINT IF EXISTS attendance_temporary_site_hours_times_check;
ALTER TABLE attendance_temporary_site DROP CONSTRAINT IF EXISTS attendance_temporary_site_hours_check;
ALTER TABLE attendance_temporary_site DROP COLUMN IF EXISTS ends_at;
ALTER TABLE attendance_temporary_site DROP COLUMN IF EXISTS starts_at;
ALTER TABLE attendance_temporary_site DROP COLUMN IF EXISTS hours;
