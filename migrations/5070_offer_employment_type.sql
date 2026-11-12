-- M5 offers: an offer's employment type in the employee's spellings (contractor, consultant, intern), which the offer contract and the employee record use; 5010 had checked the vacancy's (contract, internship).
-- UP
-- The vacancy's spellings already on an offer become the employee's, so the CHECK below holds them.
UPDATE offer SET employment_type = 'contractor' WHERE employment_type = 'contract';
UPDATE offer SET employment_type = 'intern' WHERE employment_type = 'internship';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'offer_employment_type_check'
       AND pg_get_constraintdef(oid) NOT LIKE '%contractor%'
  ) THEN
    ALTER TABLE offer DROP CONSTRAINT offer_employment_type_check;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'offer_employment_type_check') THEN
    ALTER TABLE offer ADD CONSTRAINT offer_employment_type_check
      CHECK (employment_type IS NULL OR employment_type IN ('full_time', 'part_time', 'contractor', 'consultant', 'intern'));
  END IF;
END $$;

-- DOWN
-- 5010's CHECK again. A consultant has no vacancy spelling: it goes back as contract, the nearest.
ALTER TABLE offer DROP CONSTRAINT IF EXISTS offer_employment_type_check;
UPDATE offer SET employment_type = 'contract' WHERE employment_type IN ('contractor', 'consultant');
UPDATE offer SET employment_type = 'internship' WHERE employment_type = 'intern';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'offer_employment_type_check') THEN
    ALTER TABLE offer ADD CONSTRAINT offer_employment_type_check
      CHECK (employment_type IS NULL OR employment_type IN ('full_time', 'part_time', 'contract', 'internship'));
  END IF;
END $$;
