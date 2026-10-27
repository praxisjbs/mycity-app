-- M3 an attendance breach's query, who raised a query, and who signs a sanction
-- (docs/guides/queries.md §3, §4, §6.2, §6.4; attendance.md §4).
--
--   attendance_rule_breach.employee_query_id  the key to the query Queries & Sanctions raised for
--                     the breach, owed since attendance's 1430 left the column without one.
--                     SET NULL: a breach outlives anything done to its query
--   employee_query  + source: who raised it, `person` (Raise a Query), `rule` (a rule on Rules) or
--                     `attendance` (an Attendance policy breach). Rows before it: a person when
--                     raised_by is set, otherwise a rule
--   sanction        + signed_by: the Operations & People approver who signed it when they approved
--                     it (their drawn signature is signature_document_id, from 3020); null for a
--                     sanction signed by its proposer before this
-- UP
ALTER TABLE employee_query ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'person';
UPDATE employee_query SET source = 'rule' WHERE raised_by IS NULL AND source = 'person';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_query_source_check') THEN
    ALTER TABLE employee_query ADD CONSTRAINT employee_query_source_check CHECK (source IN ('person', 'rule', 'attendance'));
  END IF;
END;
$$;

ALTER TABLE sanction ADD COLUMN IF NOT EXISTS signed_by uuid REFERENCES app_user(user_id);

-- A breach naming a query that is not there (none should) is cleared before the key holds.
UPDATE attendance_rule_breach b SET employee_query_id = NULL
 WHERE b.employee_query_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM employee_query q WHERE q.employee_query_id = b.employee_query_id);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_rule_breach_query_fk') THEN
    ALTER TABLE attendance_rule_breach
      ADD CONSTRAINT attendance_rule_breach_query_fk
      FOREIGN KEY (employee_query_id) REFERENCES employee_query(employee_query_id) ON DELETE SET NULL;
  END IF;
END;
$$;
CREATE INDEX IF NOT EXISTS attendance_rule_breach_query_idx ON attendance_rule_breach (employee_query_id);

-- DOWN
DROP INDEX IF EXISTS attendance_rule_breach_query_idx;
ALTER TABLE attendance_rule_breach DROP CONSTRAINT IF EXISTS attendance_rule_breach_query_fk;
ALTER TABLE sanction DROP COLUMN IF EXISTS signed_by;
ALTER TABLE employee_query DROP CONSTRAINT IF EXISTS employee_query_source_check;
ALTER TABLE employee_query DROP COLUMN IF EXISTS source;
