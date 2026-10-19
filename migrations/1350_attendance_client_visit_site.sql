-- M1 a client visit's site on its work location request (docs/guides/attendance.md §4, §6.11).
--
--   attendance_location_request  gains site_latitude, site_longitude and site_radius_m: the
--                                client's venue a client visit is fenced on, typed as a field
--                                site's is (a radius of 100 to 500 m). All three or none, and only
--                                on a client visit. Not personal data. A client visit sent before
--                                this file has none: its approval stays the check.
-- UP
ALTER TABLE attendance_location_request ADD COLUMN IF NOT EXISTS site_latitude numeric(9,6);
ALTER TABLE attendance_location_request ADD COLUMN IF NOT EXISTS site_longitude numeric(9,6);
ALTER TABLE attendance_location_request ADD COLUMN IF NOT EXISTS site_radius_m integer;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_location_request_site_check') THEN
    ALTER TABLE attendance_location_request ADD CONSTRAINT attendance_location_request_site_check
      CHECK ((site_latitude IS NULL) = (site_longitude IS NULL)
             AND (site_latitude IS NULL) = (site_radius_m IS NULL)
             AND (site_latitude IS NULL OR request_type = 'client_visit')
             AND (site_latitude IS NULL OR site_latitude BETWEEN -90 AND 90)
             AND (site_longitude IS NULL OR site_longitude BETWEEN -180 AND 180)
             AND (site_radius_m IS NULL OR site_radius_m BETWEEN 100 AND 500));
  END IF;
END $$;

-- DOWN
ALTER TABLE attendance_location_request DROP CONSTRAINT IF EXISTS attendance_location_request_site_check;
ALTER TABLE attendance_location_request DROP COLUMN IF EXISTS site_radius_m;
ALTER TABLE attendance_location_request DROP COLUMN IF EXISTS site_longitude;
ALTER TABLE attendance_location_request DROP COLUMN IF EXISTS site_latitude;
