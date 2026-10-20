-- M1 a birthday known only as a day and a month (docs/guides/community.md §3 step 3, §4).
--
-- MyCity's staff sheet gives most people's birthday as a day and month with no year, which is
-- not a date, so date_of_birth stays empty and no birthday card could ever post. These two
-- columns hold the day and month alone; the celebrations read them when date_of_birth is empty.
-- The staff loader fills them from the sheet on each deploy, only for a person with neither.
-- UP
ALTER TABLE employee ADD COLUMN IF NOT EXISTS birth_day smallint;
ALTER TABLE employee ADD COLUMN IF NOT EXISTS birth_month smallint;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_birth_day_month_chk') THEN
    ALTER TABLE employee ADD CONSTRAINT employee_birth_day_month_chk CHECK (
      (birth_day IS NULL AND birth_month IS NULL)
      OR (birth_month BETWEEN 1 AND 12
          AND birth_day BETWEEN 1 AND (CASE WHEN birth_month = 2 THEN 29
                                            WHEN birth_month IN (4, 6, 9, 11) THEN 30
                                            ELSE 31 END)));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS employee_birth_day_month_idx ON employee (birth_month, birth_day) WHERE birth_month IS NOT NULL;

-- DOWN
DROP INDEX IF EXISTS employee_birth_day_month_idx;
ALTER TABLE employee DROP CONSTRAINT IF EXISTS employee_birth_day_month_chk;
-- DESTRUCTIVE: rolling back forgets the birthdays known only as a day and month; the staff sheet still holds them.
ALTER TABLE employee DROP COLUMN IF EXISTS birth_month;
ALTER TABLE employee DROP COLUMN IF EXISTS birth_day;
