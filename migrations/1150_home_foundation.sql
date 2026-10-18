-- M1 Home: named alert rules and their authors, the employee an alert is about, report schedules and numbered report runs, per-role and personal KPI cards, and the indexes Home's reads need (home.md §4).
--
-- Decided with TB on 17/10/2026: saved_report and report_schedule (1000) stay and gain what the
-- reports engine needs. A report is generated as each recipient in each format, so a run is one
-- file: one home_report_run row per recipient and format, numbered by numbering.allocate()
-- (report_run, seeded by 1199). A card id in role_kpi and home_kpi_pick is a key of the KPI
-- catalogue (src/modules/dashboard/kpi-catalog), which is code, so the service checks it.
--
-- Only tables numbered below this file are touched. On a new database the M2 and later tables are
-- created after it, so the indexes Home's reads want on them are requests to their owners
-- (docs/DATABASE_SCHEMA.md, each owning milestone's Owes).
--
-- No release has written a report schedule yet, so one schedule per report is a unique index
-- with nothing to clean up first.
-- UP

-- A rule has the name people gave it on the New Rule form, and who made and last changed it.
-- Rules written before the form existed take their key as their name.
ALTER TABLE home_alert_rule ADD COLUMN IF NOT EXISTS name text;
UPDATE home_alert_rule SET name = key::text WHERE name IS NULL;
-- DESTRUCTIVE: name becomes required. Every existing rule was given its key as its name just above, so nothing is lost.
ALTER TABLE home_alert_rule ALTER COLUMN name SET NOT NULL;
ALTER TABLE home_alert_rule ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES app_user(user_id) ON DELETE SET NULL;
ALTER TABLE home_alert_rule ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES app_user(user_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS home_alert_rule_created_by_idx ON home_alert_rule (created_by);
CREATE INDEX IF NOT EXISTS home_alert_rule_updated_by_idx ON home_alert_rule (updated_by);
-- A signal handler or a daily sweep reads the switched-on rules of one metric.
CREATE INDEX IF NOT EXISTS home_alert_rule_metric_idx ON home_alert_rule (metric) WHERE enabled;

-- The employee an alert is about, when it is about one. The Alerts list is scoped by it (a manager
-- sees their team's) and clearing checks the clearer's scope reaches them. An alert about no one in
-- particular (a budget, a partner) has none, and only holders with all scope see it.
ALTER TABLE home_alert ADD COLUMN IF NOT EXISTS subject_employee_id uuid REFERENCES employee(employee_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS home_alert_subject_employee_idx ON home_alert (subject_employee_id);
CREATE INDEX IF NOT EXISTS home_alert_rule_idx ON home_alert (home_alert_rule_id);
CREATE INDEX IF NOT EXISTS home_alert_cleared_by_idx ON home_alert (cleared_by);
-- Open alerts newest first (the list, Needs You, the ageing sweep); every alert by when it was raised
-- (the high open count, history) and when it was cleared (Cleared This Week, View Dismissed).
CREATE INDEX IF NOT EXISTS home_alert_open_idx ON home_alert (raised_at DESC) WHERE cleared_at IS NULL;
CREATE INDEX IF NOT EXISTS home_alert_raised_idx ON home_alert (raised_at DESC);
CREATE INDEX IF NOT EXISTS home_alert_cleared_idx ON home_alert (cleared_at DESC) WHERE cleared_at IS NOT NULL;

-- A report with runs is archived, never deleted: a run keeps its report (home_report_run below).
ALTER TABLE saved_report ADD COLUMN IF NOT EXISTS archived_at timestamptz;
CREATE INDEX IF NOT EXISTS saved_report_report_key_idx ON saved_report (report_key);

-- A schedule is a recurrence rule (src/shared/time/recurrence.js) counted from a start day, run at a
-- time of day in its timezone (18:00 unless the form says otherwise), in PDF, XLSX or both. A report
-- is generated as each recipient, so a recipient is someone who signs in (recipients keeps their
-- addresses for display).
ALTER TABLE report_schedule ADD COLUMN IF NOT EXISTS starts_on date;
UPDATE report_schedule SET starts_on = (created_at AT TIME ZONE timezone)::date WHERE starts_on IS NULL;
-- DESTRUCTIVE: starts_on becomes required. Every existing schedule was given the day it was created on just above, so nothing is lost.
ALTER TABLE report_schedule ALTER COLUMN starts_on SET NOT NULL;
ALTER TABLE report_schedule ADD COLUMN IF NOT EXISTS run_time time NOT NULL DEFAULT '18:00';
ALTER TABLE report_schedule ADD COLUMN IF NOT EXISTS formats text[] NOT NULL DEFAULT '{pdf}';
ALTER TABLE report_schedule ADD COLUMN IF NOT EXISTS recipient_user_ids uuid[] NOT NULL DEFAULT '{}';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'report_schedule_formats_check') THEN
    ALTER TABLE report_schedule ADD CONSTRAINT report_schedule_formats_check
      CHECK (cardinality(formats) > 0 AND formats <@ ARRAY['pdf', 'xlsx']::text[]);
  END IF;
END $$;
-- One schedule per report (the report card shows one); it is also the foreign key's index.
CREATE UNIQUE INDEX IF NOT EXISTS report_schedule_report_uq ON report_schedule (saved_report_id);
-- The scheduler's scan for schedules that are due.
CREATE INDEX IF NOT EXISTS report_schedule_due_idx ON report_schedule (next_run_at) WHERE active;

-- One generated file: a report, for one recipient, in one format. A scheduled run carries its
-- schedule and the slot it fired for, and a slot is generated once per recipient and format however
-- often the scheduler looks. A run on demand has neither. Skipped: the recipient can no longer
-- sign in or open the report's source, so nothing was generated for them.
CREATE TABLE IF NOT EXISTS home_report_run (
  home_report_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number citext NOT NULL UNIQUE,
  saved_report_id uuid NOT NULL REFERENCES saved_report(saved_report_id) ON DELETE RESTRICT,
  report_schedule_id uuid REFERENCES report_schedule(report_schedule_id) ON DELETE SET NULL,
  scheduled_for timestamptz,
  recipient_user_id uuid NOT NULL REFERENCES app_user(user_id) ON DELETE RESTRICT,
  requested_by uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  format text NOT NULL CHECK (format IN ('pdf', 'xlsx')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed', 'skipped')),
  document_id uuid REFERENCES document(document_id) ON DELETE SET NULL,
  emailed_at timestamptz,
  error text,
  run_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- A run from a schedule names its slot, or the slot index below could not hold it to one.
  CONSTRAINT home_report_run_slot_check CHECK (report_schedule_id IS NULL OR scheduled_for IS NOT NULL)
);
-- Leads with report_schedule_id, so it is also that foreign key's index.
CREATE UNIQUE INDEX IF NOT EXISTS home_report_run_slot_uq
  ON home_report_run (report_schedule_id, scheduled_for, recipient_user_id, format) WHERE report_schedule_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS home_report_run_report_idx ON home_report_run (saved_report_id, run_at DESC);
CREATE INDEX IF NOT EXISTS home_report_run_recipient_idx ON home_report_run (recipient_user_id, run_at DESC);
CREATE INDEX IF NOT EXISTS home_report_run_requested_by_idx ON home_report_run (requested_by);
CREATE INDEX IF NOT EXISTS home_report_run_document_idx ON home_report_run (document_id);
CREATE INDEX IF NOT EXISTS home_report_run_run_at_idx ON home_report_run (run_at DESC);
CREATE OR REPLACE TRIGGER home_report_run_set_updated_at BEFORE UPDATE ON home_report_run
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A role's KPI cards on Home: up to four defaults in order, and the ones its members cannot take off.
CREATE TABLE IF NOT EXISTS role_kpi (
  role_kpi_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id uuid NOT NULL UNIQUE REFERENCES role(role_id) ON DELETE CASCADE,
  default_ids text[] NOT NULL DEFAULT '{}',
  locked_ids text[] NOT NULL DEFAULT '{}',
  updated_by uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT role_kpi_default_ids_check CHECK (cardinality(default_ids) <= 4),
  CONSTRAINT role_kpi_locked_ids_check CHECK (locked_ids <@ default_ids)
);
CREATE INDEX IF NOT EXISTS role_kpi_updated_by_idx ON role_kpi (updated_by);
CREATE OR REPLACE TRIGGER role_kpi_set_updated_at BEFORE UPDATE ON role_kpi
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- The cards a person chose for themselves, in order. No row: they follow their roles. An empty
-- list: they chose to see none.
CREATE TABLE IF NOT EXISTS home_kpi_pick (
  home_kpi_pick_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES app_user(user_id) ON DELETE CASCADE,
  kpi_ids text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT home_kpi_pick_kpi_ids_check CHECK (cardinality(kpi_ids) <= 4)
);
CREATE OR REPLACE TRIGGER home_kpi_pick_set_updated_at BEFORE UPDATE ON home_kpi_pick
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Activity Today on Home reads the day's events, newest first.
CREATE INDEX IF NOT EXISTS event_log_occurred_idx ON event_log (occurred_at DESC);

-- DOWN
DROP INDEX IF EXISTS event_log_occurred_idx;
DROP TRIGGER IF EXISTS home_kpi_pick_set_updated_at ON home_kpi_pick;
DROP TABLE IF EXISTS home_kpi_pick;
DROP TRIGGER IF EXISTS role_kpi_set_updated_at ON role_kpi;
DROP INDEX IF EXISTS role_kpi_updated_by_idx;
DROP TABLE IF EXISTS role_kpi;
DROP TRIGGER IF EXISTS home_report_run_set_updated_at ON home_report_run;
DROP INDEX IF EXISTS home_report_run_run_at_idx;
DROP INDEX IF EXISTS home_report_run_document_idx;
DROP INDEX IF EXISTS home_report_run_requested_by_idx;
DROP INDEX IF EXISTS home_report_run_recipient_idx;
DROP INDEX IF EXISTS home_report_run_report_idx;
DROP INDEX IF EXISTS home_report_run_slot_uq;
DROP TABLE IF EXISTS home_report_run;
DROP INDEX IF EXISTS report_schedule_due_idx;
DROP INDEX IF EXISTS report_schedule_report_uq;
ALTER TABLE report_schedule DROP CONSTRAINT IF EXISTS report_schedule_formats_check;
ALTER TABLE report_schedule DROP COLUMN IF EXISTS recipient_user_ids;
ALTER TABLE report_schedule DROP COLUMN IF EXISTS formats;
ALTER TABLE report_schedule DROP COLUMN IF EXISTS run_time;
ALTER TABLE report_schedule DROP COLUMN IF EXISTS starts_on;
DROP INDEX IF EXISTS saved_report_report_key_idx;
ALTER TABLE saved_report DROP COLUMN IF EXISTS archived_at;
DROP INDEX IF EXISTS home_alert_cleared_idx;
DROP INDEX IF EXISTS home_alert_raised_idx;
DROP INDEX IF EXISTS home_alert_open_idx;
DROP INDEX IF EXISTS home_alert_cleared_by_idx;
DROP INDEX IF EXISTS home_alert_rule_idx;
DROP INDEX IF EXISTS home_alert_subject_employee_idx;
ALTER TABLE home_alert DROP COLUMN IF EXISTS subject_employee_id;
DROP INDEX IF EXISTS home_alert_rule_metric_idx;
DROP INDEX IF EXISTS home_alert_rule_updated_by_idx;
DROP INDEX IF EXISTS home_alert_rule_created_by_idx;
ALTER TABLE home_alert_rule DROP COLUMN IF EXISTS updated_by;
ALTER TABLE home_alert_rule DROP COLUMN IF EXISTS created_by;
ALTER TABLE home_alert_rule DROP COLUMN IF EXISTS name;
