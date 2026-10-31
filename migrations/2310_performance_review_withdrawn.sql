-- M2 Performance: a review scored without its check-in, and a review closed as Withdrawn (docs/guides/performance.md §4, §11).
--
-- Score Without Check-In: once the check-in's due date has passed, the reviewer may score without
-- it, saying why; the moment and the reason are kept on the review, shown on it and in its PDF.
-- Withdrawn: a leaver's open review, or one Operations & People withdraw, closes at HR's stage
-- without a score, with its note. The status check is replaced, NOT VALID as 2300's was, so rows
-- written before it are left alone.
-- UP

ALTER TABLE performance_review ADD COLUMN IF NOT EXISTS no_check_in_at timestamptz;
ALTER TABLE performance_review ADD COLUMN IF NOT EXISTS no_check_in_reason text;
ALTER TABLE performance_review ADD COLUMN IF NOT EXISTS withdrawn_at timestamptz;
ALTER TABLE performance_review ADD COLUMN IF NOT EXISTS withdrawn_reason text;

-- Widening the status check (not destructive, MIGRATIONS §8): the same values and `withdrawn`.
ALTER TABLE performance_review DROP CONSTRAINT IF EXISTS performance_review_status_check;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'performance_review_status_check') THEN
    ALTER TABLE performance_review ADD CONSTRAINT performance_review_status_check
      CHECK (status IN ('check_in', 'with_reviewer', 'second_level', 'with_hr', 'closed', 'returned', 'withdrawn')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'performance_review_withdrawn_check') THEN
    ALTER TABLE performance_review ADD CONSTRAINT performance_review_withdrawn_check
      CHECK ((status = 'withdrawn') = (withdrawn_at IS NOT NULL)) NOT VALID;
  END IF;
END $$;

-- DOWN

ALTER TABLE performance_review DROP CONSTRAINT IF EXISTS performance_review_withdrawn_check;
ALTER TABLE performance_review DROP CONSTRAINT IF EXISTS performance_review_status_check;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'performance_review_status_check') THEN
    ALTER TABLE performance_review ADD CONSTRAINT performance_review_status_check
      CHECK (status IN ('check_in', 'with_reviewer', 'second_level', 'with_hr', 'closed', 'returned')) NOT VALID;
  END IF;
END $$;
ALTER TABLE performance_review DROP COLUMN IF EXISTS withdrawn_reason; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE performance_review DROP COLUMN IF EXISTS withdrawn_at; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE performance_review DROP COLUMN IF EXISTS no_check_in_reason; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE performance_review DROP COLUMN IF EXISTS no_check_in_at; -- DESTRUCTIVE: rollback only; drops what UP added
