-- M2 Performance PR 3: the statuses a monthly round and a review may hold, the review's second level, and each item's corrective action (docs/guides/performance.md §4, §6.12, §6.16).
--
-- The status checks are added NOT VALID: they hold every row written or changed from now on, while
-- staging's demonstration rows from Home (written before Performance existed, with the old 'draft'
-- status) stay until seeds/staging/46_performance_reviews.js takes them away. Production never held
-- them. The same file gives the same schema on an empty database and a full one.
-- UP

-- A round is open until Operations & People close it.
ALTER TABLE performance_cycle ALTER COLUMN status SET DEFAULT 'open';
-- A review opens with the employee's check-in.
ALTER TABLE performance_review ALTER COLUMN status SET DEFAULT 'check_in';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'performance_cycle_status_check') THEN
    ALTER TABLE performance_cycle ADD CONSTRAINT performance_cycle_status_check
      CHECK (status IN ('open', 'closed')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'performance_review_status_check') THEN
    ALTER TABLE performance_review ADD CONSTRAINT performance_review_status_check
      CHECK (status IN ('check_in', 'with_reviewer', 'second_level', 'with_hr', 'closed', 'returned')) NOT VALID;
  END IF;
END $$;

-- The reviewer's own effective line manager, worked out when the reviewer submits (§6.13): who
-- decides the second level, and who reads the whole review after it.
ALTER TABLE performance_review ADD COLUMN IF NOT EXISTS second_level_employee_id uuid REFERENCES employee(employee_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS performance_review_second_level_fk_idx ON performance_review (second_level_employee_id);

-- A corrective action on an item scored below its target: kept here while the reviewer works, and
-- made a task for its owner when the review is submitted (the task's id is kept beside it).
ALTER TABLE performance_review_item ADD COLUMN IF NOT EXISTS corrective_title text;
ALTER TABLE performance_review_item ADD COLUMN IF NOT EXISTS corrective_owner_id uuid REFERENCES employee(employee_id) ON DELETE SET NULL;
ALTER TABLE performance_review_item ADD COLUMN IF NOT EXISTS corrective_due_on date;
ALTER TABLE performance_review_item ADD COLUMN IF NOT EXISTS corrective_task_id uuid REFERENCES task(task_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS performance_review_item_corrective_owner_fk_idx ON performance_review_item (corrective_owner_id);
CREATE INDEX IF NOT EXISTS performance_review_item_corrective_task_fk_idx ON performance_review_item (corrective_task_id);

-- DOWN

DROP INDEX IF EXISTS performance_review_item_corrective_task_fk_idx;
DROP INDEX IF EXISTS performance_review_item_corrective_owner_fk_idx;
ALTER TABLE performance_review_item DROP COLUMN IF EXISTS corrective_task_id; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE performance_review_item DROP COLUMN IF EXISTS corrective_due_on; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE performance_review_item DROP COLUMN IF EXISTS corrective_owner_id; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE performance_review_item DROP COLUMN IF EXISTS corrective_title; -- DESTRUCTIVE: rollback only; drops what UP added
DROP INDEX IF EXISTS performance_review_second_level_fk_idx;
ALTER TABLE performance_review DROP COLUMN IF EXISTS second_level_employee_id; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE performance_review DROP CONSTRAINT IF EXISTS performance_review_status_check;
ALTER TABLE performance_cycle DROP CONSTRAINT IF EXISTS performance_cycle_status_check;
ALTER TABLE performance_review ALTER COLUMN status SET DEFAULT 'draft';
ALTER TABLE performance_cycle ALTER COLUMN status SET DEFAULT 'draft';
