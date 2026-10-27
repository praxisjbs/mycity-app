-- M2 Performance: every organisational goal carries its ID (docs/guides/performance.md §6.1;
-- JBS Praxis, 27/10/2026). From this release the service numbers each new goal from the scheme
-- seeded in 2291 and the Goal ID is no longer typed; this file gives an ID to a goal recorded
-- before, while it was typed and optional.
--
--   organisational_goal.code_given_at   when the system gave the goal its ID; null for one a person
--                                       typed before this file. Written by the service with the ID.
--
--   A goal with an ID keeps it. One without is given the next of its plan year, in the order the
--   goals were recorded, after the highest number of the scheme's own shape already given that
--   year (ORG-2026-01 to ORG-2026-04 typed, the next is ORG-2026-05), and the year's counter is
--   moved past them all, as numbering.advanceTo() moves it, so a goal recorded on screen never
--   repeats one. The number and its pattern are built as src/shared/numbering/numbering.js
--   format() and sequencePattern() build them, from the scheme's row. Only the plan's goals are
--   numbered (level organisation, with a plan year); nothing is numbered while no scheme row exists.
-- UP
ALTER TABLE organisational_goal ADD COLUMN IF NOT EXISTS code_given_at timestamptz;

DO $$
DECLARE
  s record;
  y record;
  g record;
  slot text;
  parts text[];
  pattern text;
  seq integer;
  special text := '([.*+?^${}()|\[\]\\])';
BEGIN
  SELECT prefix, padding, separator, reset, include_period INTO s
    FROM numbering_scheme WHERE doc_type = 'organisational_goal';
  IF NOT FOUND OR s.padding < 1 THEN
    RETURN;
  END IF;
  FOR y IN
    SELECT DISTINCT plan_year_starts_on AS starts_on
      FROM organisational_goal
     WHERE level = 'organisation' AND plan_year_starts_on IS NOT NULL
     ORDER BY plan_year_starts_on
  LOOP
    slot := CASE s.reset
      WHEN 'never' THEN 'all'
      WHEN 'yearly' THEN to_char(y.starts_on, 'YYYY')
      ELSE to_char(y.starts_on, 'YYYY-MM')
    END;
    parts := ARRAY[s.prefix];
    IF s.include_period AND slot <> 'all' THEN
      parts := parts || replace(slot, '-', coalesce(nullif(s.separator, ''), '-'));
    END IF;
    -- The scheme's own shape, the sequence captured, at most two digits past the padding.
    pattern := '^' || array_to_string(
      ARRAY(SELECT regexp_replace(p, special, '\\\1', 'g') FROM unnest(parts) AS p)
        || ('([0-9]{' || s.padding || ',' || (s.padding + 2) || '})'),
      regexp_replace(s.separator, special, '\\\1', 'g')) || '$';
    SELECT GREATEST(
             COALESCE((SELECT max(substring(code::text from pattern)::integer)
                         FROM organisational_goal
                        WHERE code::text ~ pattern
                          AND (slot = 'all' OR plan_year_starts_on = y.starts_on)), 0),
             COALESCE((SELECT last_value FROM numbering_counter
                        WHERE doc_type = 'organisational_goal' AND numbering_counter.period = slot), 0))
      INTO seq;
    FOR g IN
      SELECT organisational_goal_id
        FROM organisational_goal
       WHERE level = 'organisation' AND plan_year_starts_on = y.starts_on AND code IS NULL
       ORDER BY created_at, organisational_goal_id
    LOOP
      seq := seq + 1;
      UPDATE organisational_goal
         SET code = array_to_string(parts || lpad(seq::text, s.padding, '0'), s.separator), code_given_at = now()
       WHERE organisational_goal_id = g.organisational_goal_id;
    END LOOP;
    IF seq > 0 THEN
      INSERT INTO numbering_counter (doc_type, period, last_value) VALUES ('organisational_goal', slot, seq)
      ON CONFLICT (doc_type, period)
      DO UPDATE SET last_value = GREATEST(numbering_counter.last_value, EXCLUDED.last_value);
    END IF;
  END LOOP;
END $$;

-- DOWN
-- The IDs the system gave go with the rule that gave them: those goals read no ID again, as before
-- this file. An ID a person typed stays, and the counter is never taken back (numbering.js).
UPDATE organisational_goal SET code = NULL WHERE code_given_at IS NOT NULL;
ALTER TABLE organisational_goal DROP COLUMN IF EXISTS code_given_at;
