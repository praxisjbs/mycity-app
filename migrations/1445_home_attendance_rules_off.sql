-- M1 Home's own attendance alert rules switched off: the Attendance policy is the one source of every
-- attendance threshold (TB's decisions of 20/10/2026, T1; docs/guides/home.md §6 Alerts,
-- docs/guides/attendance.md §6.16).
--
--   home_alert_rule  every rule on the late_arrivals or missing_clock_out metric is switched off.
--                    Those metrics left the metric list in the same release: New Rule no longer
--                    offers them and the sweep no longer reads them. Attendance's alerts are the
--                    policy's breaches, raised on the rules the system keeps for the policy
--                    (metric attendance_policy), so nothing is lost
--   home_alert       each open alert of those rules is dismissed as the rule change, with the note
--                    "Rule switched off" and nobody as the one who closed it, as switching a rule off
--                    on Alert Rules does (shared/alerts closeForRule); it stays on View Dismissed
--   home_alert_rule  a check keeps them off: no rule on either metric is switched on again
--
-- The rules and their alerts are kept, so the record of what was raised stays.
-- UP
UPDATE home_alert SET cleared_at = now(), cleared_by = NULL, outcome = 'dismissed', note = 'Rule switched off'
 WHERE cleared_at IS NULL
   AND home_alert_rule_id IN (SELECT home_alert_rule_id FROM home_alert_rule
                               WHERE metric IN ('late_arrivals', 'missing_clock_out'));
UPDATE home_alert_rule SET enabled = false
 WHERE metric IN ('late_arrivals', 'missing_clock_out') AND enabled;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'home_alert_rule_attendance_retired_check') THEN
    ALTER TABLE home_alert_rule ADD CONSTRAINT home_alert_rule_attendance_retired_check
      CHECK (NOT (enabled AND metric IN ('late_arrivals', 'missing_clock_out')));
  END IF;
END;
$$;

-- DOWN
-- The rules switched off stay off and the alerts dismissed stay dismissed: which were on or open
-- before was not kept, and the metrics they watch are gone from the code.
ALTER TABLE home_alert_rule DROP CONSTRAINT IF EXISTS home_alert_rule_attendance_retired_check;
