-- M0 places: every address a person enters, picked from the address search, pinned on the map, or the device's location while search is down (docs/guides/addresses.md §4, F27).
-- UP

CREATE TABLE IF NOT EXISTS place (
  place_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Which field of which record type (src/shared/places/owners.js): "<table>.<column>".
  owner text NOT NULL CHECK (owner ~ '^[a-z_]+\.[a-z_]+$'),
  -- The record's id, or "organisation" for the company's own profile.
  owner_key text NOT NULL,
  source text NOT NULL CHECK (source IN ('search', 'pin', 'device', 'typed')),
  -- The provider's line; null only while a device location waits to be named.
  formatted text,
  details text CHECK (char_length(details) <= 120),
  lat numeric(9,6) CHECK (lat BETWEEN -90 AND 90),
  lon numeric(9,6) CHECK (lon BETWEEN -180 AND 180),
  accuracy_m numeric(9,1) CHECK (accuracy_m >= 0),
  provider_id text,
  kind text NOT NULL DEFAULT 'unknown'
    CHECK (kind IN ('building', 'street', 'landmark', 'area', 'city', 'region', 'country', 'unknown')),
  city text,
  state text,
  country_code text CHECK (char_length(country_code) = 2),
  verified boolean NOT NULL DEFAULT false,
  pending boolean NOT NULL DEFAULT false,
  named_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT place_owner_key UNIQUE (owner, owner_key),
  CONSTRAINT place_point_whole CHECK ((lat IS NULL) = (lon IS NULL)),
  CONSTRAINT place_point_known CHECK (source = 'typed' OR lat IS NOT NULL),
  CONSTRAINT place_named CHECK (formatted IS NOT NULL OR pending)
);

-- The naming job reads the waiting ones, oldest first.
CREATE INDEX IF NOT EXISTS place_pending_idx ON place (created_at) WHERE pending;

CREATE OR REPLACE TRIGGER place_set_updated_at BEFORE UPDATE ON place
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Every address saved before addresses were picked: kept as typed and unverified, with the
-- record's own point where it has one (guide §6.6). Nothing is cleared or geocoded.
INSERT INTO place (owner, owner_key, source, formatted)
SELECT 'organisation.address', 'organisation', 'typed', btrim(s.value #>> '{}')
  FROM setting s
 WHERE s.key = 'organisation.address' AND jsonb_typeof(s.value) = 'string'
   AND NULLIF(btrim(s.value #>> '{}'), '') IS NOT NULL
ON CONFLICT (owner, owner_key) DO NOTHING;

INSERT INTO place (owner, owner_key, source, formatted, lat, lon)
SELECT 'worksite.address', w.worksite_id::text, 'typed', btrim(w.address ->> 'text'), w.latitude, w.longitude
  FROM worksite w
 WHERE NULLIF(btrim(w.address ->> 'text'), '') IS NOT NULL
ON CONFLICT (owner, owner_key) DO NOTHING;

-- Attendance's tables come later in a fresh database (13xx), so these run only where they exist:
-- on a database that already holds them, where this file applies after them.
DO $$
BEGIN
  IF to_regclass('public.attendance_field_site') IS NOT NULL THEN
    EXECUTE $q$
      INSERT INTO place (owner, owner_key, source, formatted, lat, lon)
      SELECT 'attendance_field_site.address', fs.field_site_id::text, 'typed', btrim(fs.address), fs.latitude, fs.longitude
        FROM attendance_field_site fs
       WHERE NULLIF(btrim(fs.address), '') IS NOT NULL
      ON CONFLICT (owner, owner_key) DO NOTHING
    $q$;
  END IF;
  IF to_regclass('public.attendance_location_request') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'attendance_location_request' AND column_name = 'site_latitude') THEN
    EXECUTE $q$
      INSERT INTO place (owner, owner_key, source, formatted, lat, lon)
      SELECT 'attendance_location_request.address', r.location_request_id::text, 'typed', btrim(r.address),
             CASE WHEN r.site_longitude IS NOT NULL THEN r.site_latitude END,
             CASE WHEN r.site_latitude IS NOT NULL THEN r.site_longitude END
        FROM attendance_location_request r
       WHERE NULLIF(btrim(r.address), '') IS NOT NULL
      ON CONFLICT (owner, owner_key) DO NOTHING
    $q$;
  END IF;
  IF to_regclass('public.attendance_home') IS NOT NULL THEN
    EXECUTE $q$
      INSERT INTO place (owner, owner_key, source, formatted)
      SELECT 'attendance_home.address', h.attendance_home_id::text, 'typed', btrim(h.address)
        FROM attendance_home h
       WHERE NULLIF(btrim(h.address), '') IS NOT NULL
      ON CONFLICT (owner, owner_key) DO NOTHING
    $q$;
  END IF;
END $$;

INSERT INTO place (owner, owner_key, source, formatted)
SELECT 'employee.home_address', e.employee_id::text, 'typed', btrim(e.home_address)
  FROM employee e
 WHERE NULLIF(btrim(e.home_address), '') IS NOT NULL
ON CONFLICT (owner, owner_key) DO NOTHING;

-- DOWN

DROP INDEX IF EXISTS place_pending_idx;
DROP TRIGGER IF EXISTS place_set_updated_at ON place;
DROP TABLE IF EXISTS place;
