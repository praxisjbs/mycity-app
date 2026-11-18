-- M7 deal controls after the QA audit (docs/guides/partnerships.md §6.5, §13.2; QA F52, F53).
--
--   partnership_opportunity.health        widened by `overdue`: an open deal past its expected close
--                                         date, set each morning by the partner-inactivity scheduler
--                                         (never by a person), cleared by a new close date or signing
--   partnership_opportunity.non_monetary  a deal signed with no money value on purpose (a media swap,
--                                         a free listing): Partnership Signed asks for a value or this
-- UP
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'partnership_opportunity_health_check' AND conrelid = 'partnership_opportunity'::regclass
       AND pg_get_constraintdef(oid) NOT LIKE '%overdue%'
  ) THEN
    ALTER TABLE partnership_opportunity DROP CONSTRAINT partnership_opportunity_health_check;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'partnership_opportunity_health_check' AND conrelid = 'partnership_opportunity'::regclass) THEN
    ALTER TABLE partnership_opportunity ADD CONSTRAINT partnership_opportunity_health_check
      CHECK (health IN ('on_track', 'follow_up_required', 'stalled', 'overdue'));
  END IF;
END $$;

ALTER TABLE partnership_opportunity ADD COLUMN IF NOT EXISTS non_monetary boolean NOT NULL DEFAULT false;

-- DOWN
ALTER TABLE partnership_opportunity DROP COLUMN IF EXISTS non_monetary;
-- An overdue deal goes back to the health the narrower check allows; the morning job sets it again.
UPDATE partnership_opportunity SET health = 'follow_up_required' WHERE health = 'overdue';
ALTER TABLE partnership_opportunity DROP CONSTRAINT IF EXISTS partnership_opportunity_health_check;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'partnership_opportunity_health_check' AND conrelid = 'partnership_opportunity'::regclass) THEN
    ALTER TABLE partnership_opportunity ADD CONSTRAINT partnership_opportunity_health_check
      CHECK (health IN ('on_track', 'follow_up_required', 'stalled'));
  END IF;
END $$;
