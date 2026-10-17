-- M0 track C: a public holiday can be expected before it is declared (TB, 17/10/2026).
--
--   public_holiday.expected   true for a date seeded ahead of the Federal Government's announcement:
--                             the moon-dated Eids, and the working day given for a holiday that
--                             falls on a weekend. Confirming or moving it on Settings · Organisation
--                             sets it false; attendance and leave count it as a holiday either way.
--
-- No backfill: every holiday entered before this file was entered on screen, so it was declared.
-- UP
ALTER TABLE public_holiday ADD COLUMN IF NOT EXISTS expected boolean NOT NULL DEFAULT false;

-- DOWN
ALTER TABLE public_holiday DROP COLUMN IF EXISTS expected;
