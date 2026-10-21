-- M1 the Attendance policy's consequence rules breached, as the attendance module writes them
-- (docs/guides/attendance.md §4, §6.16; TB's decisions of 20/10/2026, T1, T3, T5).
--
--   attendance_rule_breach  one row per breach of a rule by a person: the rule (late arrivals, early
--                           departure, absence, forgotten clock-outs, location flags), the version in
--                           force on the day that crossed it, the period counted (a week, the month,
--                           30 days) and its bounds, what was counted (the days and their minutes,
--                           and which of the count and the hours came first), what the version said
--                           it does (alert, raise a query) and when it happened. Written in the
--                           transaction of the punch, decision or day-close that crossed it; the
--                           Home alert it raised is set after commit. Unique on the person, the rule
--                           and the last day it counted, so a recalculation or a retried run adds
--                           none, and a breach's days are never counted again (the count restarts).
--
-- employee_query_id is the query Queries & Sanctions raises for it (M3). M3's employee_query is
-- created by 3000, after this file runs, so it is a nullable uuid with no foreign key here; M3 adds
-- the key with its subscriber.
-- UP
CREATE TABLE IF NOT EXISTS attendance_rule_breach (
  attendance_rule_breach_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employee(employee_id) ON DELETE RESTRICT,
  rule text NOT NULL CHECK (rule IN ('late', 'early_departure', 'absence', 'forgotten_clock_out', 'location_flag')),
  policy_version_id uuid REFERENCES policy_version(policy_version_id) ON DELETE RESTRICT,
  period text NOT NULL CHECK (period IN ('week', 'month', 'days_30')),
  period_start date NOT NULL,
  period_end date NOT NULL,
  count integer NOT NULL CHECK (count >= 1),
  minutes integer NOT NULL DEFAULT 0 CHECK (minutes >= 0),
  reached text NOT NULL CHECK (reached IN ('count', 'hours')),
  days date[] NOT NULL,
  last_day date NOT NULL,
  alert boolean NOT NULL,
  raise_query boolean NOT NULL,
  breached_at timestamptz NOT NULL DEFAULT now(),
  home_alert_id uuid REFERENCES home_alert(home_alert_id) ON DELETE SET NULL,
  employee_query_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_rule_breach_bounds_check CHECK (period_end >= period_start)
);
CREATE UNIQUE INDEX IF NOT EXISTS attendance_rule_breach_once_uq
  ON attendance_rule_breach (employee_id, rule, last_day);
-- The engine's read: the person's latest breach of a rule.
CREATE INDEX IF NOT EXISTS attendance_rule_breach_latest_idx
  ON attendance_rule_breach (employee_id, rule, last_day DESC);
CREATE INDEX IF NOT EXISTS attendance_rule_breach_policy_version_fk_idx ON attendance_rule_breach (policy_version_id);
CREATE INDEX IF NOT EXISTS attendance_rule_breach_home_alert_fk_idx ON attendance_rule_breach (home_alert_id);
CREATE OR REPLACE TRIGGER attendance_rule_breach_set_updated_at BEFORE UPDATE ON attendance_rule_breach
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- DOWN
DROP TRIGGER IF EXISTS attendance_rule_breach_set_updated_at ON attendance_rule_breach;
DROP INDEX IF EXISTS attendance_rule_breach_home_alert_fk_idx;
DROP INDEX IF EXISTS attendance_rule_breach_policy_version_fk_idx;
DROP INDEX IF EXISTS attendance_rule_breach_latest_idx;
DROP INDEX IF EXISTS attendance_rule_breach_once_uq;
DROP TABLE IF EXISTS attendance_rule_breach;
