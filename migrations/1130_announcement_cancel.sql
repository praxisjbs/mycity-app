-- M1 Staff Community: a scheduled announcement can be cancelled before it goes out (community.md §3 step 2, §6).
-- UP

ALTER TABLE announcement DROP CONSTRAINT IF EXISTS announcement_status_check;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'announcement_state_check') THEN
    ALTER TABLE announcement ADD CONSTRAINT announcement_state_check
      CHECK (status IN ('draft', 'scheduled', 'published', 'archived', 'cancelled'));
  END IF;
END $$;

-- DOWN

-- A cancelled announcement was never posted; without the status it is kept as archived.
UPDATE announcement SET status = 'archived' WHERE status = 'cancelled';
ALTER TABLE announcement DROP CONSTRAINT IF EXISTS announcement_state_check;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'announcement_status_check') THEN
    ALTER TABLE announcement ADD CONSTRAINT announcement_status_check
      CHECK (status IN ('draft', 'scheduled', 'published', 'archived'));
  END IF;
END $$;
