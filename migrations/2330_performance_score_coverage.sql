-- M2 Performance: what a score to date rests on, kept beside it on the review and the scorecard (docs/guides/performance.md §4, §6.9; BG-012).
--
-- A score to date counts only the lines that have a score (§6.9, §6.14), so a rating can rest on a
-- small part of the scorecard. A closing review writes the weight of the lines scored and the
-- weight of every line beside its score; the scorecard takes both with its score to date. They
-- are shown beside Score and Rating ("32.5 of 100 scored") and in the review's PDF. The rating
-- rules do not change (P16).
--
-- Reviews closed before this file are filled once, as their close would have written it: a
-- monthly review from its scorecard's lines and which of them had a score in a closed month up to
-- its own; any other review from its own items (an item with no line weighs 1, as at close). A
-- scorecard takes the figures of its latest closed monthly review, as setScorecardScore does.
-- UP

ALTER TABLE performance_review ADD COLUMN IF NOT EXISTS weight_scored numeric(7,2);
ALTER TABLE performance_review ADD COLUMN IF NOT EXISTS weight_total numeric(7,2);
ALTER TABLE scorecard ADD COLUMN IF NOT EXISTS weight_scored numeric(7,2);
ALTER TABLE scorecard ADD COLUMN IF NOT EXISTS weight_total numeric(7,2);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'performance_review_weight_coverage_check') THEN
    ALTER TABLE performance_review ADD CONSTRAINT performance_review_weight_coverage_check
      CHECK (weight_scored IS NULL OR (weight_total IS NOT NULL AND weight_scored >= 0 AND weight_scored <= weight_total));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scorecard_weight_coverage_check') THEN
    ALTER TABLE scorecard ADD CONSTRAINT scorecard_weight_coverage_check
      CHECK (weight_scored IS NULL OR (weight_total IS NOT NULL AND weight_scored >= 0 AND weight_scored <= weight_total));
  END IF;
END $$;

-- A closed monthly review: its scorecard's weighted lines, and those scored in a closed month up to its own.
UPDATE performance_review pr
   SET weight_total = w.total, weight_scored = w.scored
  FROM (
    SELECT x.performance_review_id, sum(x.weight) AS total, COALESCE(sum(x.weight) FILTER (WHERE x.scored), 0) AS scored
      FROM (
        SELECT r.performance_review_id, t.weight,
               EXISTS (
                 SELECT 1
                   FROM performance_review_item i
                   JOIN performance_review r2 ON r2.performance_review_id = i.performance_review_id
                   JOIN performance_cycle c2 ON c2.performance_cycle_id = r2.performance_cycle_id
                  WHERE i.employee_target_id = t.employee_target_id
                    AND r2.scorecard_id = r.scorecard_id
                    AND r2.status = 'closed'
                    AND i.score IS NOT NULL
                    AND c2.month <= c.month) AS scored
          FROM performance_review r
          JOIN performance_cycle c ON c.performance_cycle_id = r.performance_cycle_id
          JOIN employee_target t ON t.scorecard_id = r.scorecard_id AND t.weight > 0
         WHERE r.status = 'closed' AND r.review_kind = 'monthly' AND r.weight_total IS NULL
      ) x
     GROUP BY x.performance_review_id
  ) w
 WHERE pr.performance_review_id = w.performance_review_id;

-- Any other closed review (probation): its own items, an item with no line weighing 1.
UPDATE performance_review pr
   SET weight_total = w.total, weight_scored = w.scored
  FROM (
    SELECT r.performance_review_id,
           sum(COALESCE(t.weight, 1)) AS total,
           COALESCE(sum(COALESCE(t.weight, 1)) FILTER (WHERE i.score IS NOT NULL), 0) AS scored
      FROM performance_review r
      JOIN performance_review_item i ON i.performance_review_id = r.performance_review_id
      LEFT JOIN employee_target t ON t.employee_target_id = i.employee_target_id
     WHERE r.status = 'closed' AND r.weight_total IS NULL
       AND NOT (r.review_kind = 'monthly' AND r.scorecard_id IS NOT NULL)
       AND COALESCE(t.weight, 1) > 0
     GROUP BY r.performance_review_id
  ) w
 WHERE pr.performance_review_id = w.performance_review_id;

-- A scorecard: the figures of its latest closed monthly review.
UPDATE scorecard s
   SET weight_total = l.weight_total, weight_scored = l.weight_scored
  FROM (
    SELECT DISTINCT ON (r.scorecard_id) r.scorecard_id, r.weight_total, r.weight_scored
      FROM performance_review r
     WHERE r.status = 'closed' AND r.review_kind = 'monthly' AND r.scorecard_id IS NOT NULL AND r.weight_total IS NOT NULL
     ORDER BY r.scorecard_id, r.closed_at DESC NULLS LAST, r.performance_review_id
  ) l
 WHERE s.scorecard_id = l.scorecard_id AND s.weight_total IS NULL;

-- DOWN

ALTER TABLE scorecard DROP CONSTRAINT IF EXISTS scorecard_weight_coverage_check;
ALTER TABLE performance_review DROP CONSTRAINT IF EXISTS performance_review_weight_coverage_check;
ALTER TABLE scorecard DROP COLUMN IF EXISTS weight_total; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE scorecard DROP COLUMN IF EXISTS weight_scored; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE performance_review DROP COLUMN IF EXISTS weight_total; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE performance_review DROP COLUMN IF EXISTS weight_scored; -- DESTRUCTIVE: rollback only; drops what UP added
