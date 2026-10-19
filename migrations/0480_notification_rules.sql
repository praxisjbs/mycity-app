-- M0 Settings · Notifications: the company's rule per notice, its reminders, each person's quiet hours and digest, and the reminder engine's occurrences.
--
-- Brought forward from M6 by TB on 19/10/2026 (docs/guides/notifications.md §4, §6, §7.1):
--
--   notification_rule            one row per notice People changed (event_key unique): On or Off,
--                                its urgency (null: as the code says) and its default channels
--                                (each null: the category's default). Reset to Default deletes it.
--   notification_rule_recipient  the roles and people a notice is copied to, exactly one of the two
--   notification_reminder_rule   one row per company reminder once People save it (approvals,
--                                probation, digest); until then the code's defaults apply
--   notification_setting         a person's quiet hours and digest switch, and the Lagos day their
--                                last digest was decided, made the first time either is needed
--   reminder                     one occurrence of a declared reminder, unique per (key, record,
--                                occurrence), so finding or scheduling it twice adds nothing
-- UP
CREATE TABLE IF NOT EXISTS notification_rule (
  notification_rule_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT true,
  urgency text CHECK (urgency IN ('normal', 'important', 'urgent')),
  in_app boolean,
  email boolean,
  push boolean,
  updated_by uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER notification_rule_set_updated_at
  BEFORE UPDATE ON notification_rule
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS notification_rule_updated_by_fk_idx ON notification_rule (updated_by);

CREATE TABLE IF NOT EXISTS notification_rule_recipient (
  notification_rule_recipient_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_rule_id uuid NOT NULL REFERENCES notification_rule(notification_rule_id) ON DELETE CASCADE,
  role_id uuid REFERENCES role(role_id) ON DELETE CASCADE,
  employee_id uuid REFERENCES employee(employee_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((role_id IS NULL) <> (employee_id IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS notification_rule_recipient_role_key
  ON notification_rule_recipient (notification_rule_id, role_id) WHERE role_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS notification_rule_recipient_employee_key
  ON notification_rule_recipient (notification_rule_id, employee_id) WHERE employee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS notification_rule_recipient_role_id_fk_idx ON notification_rule_recipient (role_id);
CREATE INDEX IF NOT EXISTS notification_rule_recipient_employee_id_fk_idx ON notification_rule_recipient (employee_id);

CREATE TABLE IF NOT EXISTS notification_reminder_rule (
  notification_reminder_rule_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reminder_key text NOT NULL UNIQUE CHECK (reminder_key IN ('approvals', 'probation', 'digest')),
  enabled boolean NOT NULL,
  every_hours integer CHECK (every_hours BETWEEN 1 AND 168),
  days_ahead integer CHECK (days_ahead BETWEEN 1 AND 90),
  at_time time,
  updated_by uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER notification_reminder_rule_set_updated_at
  BEFORE UPDATE ON notification_reminder_rule
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS notification_reminder_rule_updated_by_fk_idx ON notification_reminder_rule (updated_by);

CREATE TABLE IF NOT EXISTS notification_setting (
  notification_setting_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES app_user(user_id) ON DELETE CASCADE,
  quiet_enabled boolean NOT NULL DEFAULT false,
  quiet_from time NOT NULL DEFAULT '21:00',
  quiet_to time NOT NULL DEFAULT '07:00',
  digest boolean NOT NULL DEFAULT true,
  digest_sent_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (quiet_from <> quiet_to)
);

CREATE OR REPLACE TRIGGER notification_setting_set_updated_at
  BEFORE UPDATE ON notification_setting
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS reminder (
  reminder_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reminder_key text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  occurrence text NOT NULL DEFAULT '',
  due_at timestamptz NOT NULL,
  every_minutes integer CHECK (every_minutes >= 5),
  work_hours boolean NOT NULL DEFAULT false,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  fired_count integer NOT NULL DEFAULT 0,
  last_fired_at timestamptz,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'done', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reminder_key, entity_type, entity_id, occurrence)
);

CREATE OR REPLACE TRIGGER reminder_set_updated_at
  BEFORE UPDATE ON reminder
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS reminder_due_idx ON reminder (due_at) WHERE state = 'pending';

-- DOWN
DROP INDEX IF EXISTS reminder_due_idx;
DROP TRIGGER IF EXISTS reminder_set_updated_at ON reminder;
DROP TABLE IF EXISTS reminder;
DROP TRIGGER IF EXISTS notification_setting_set_updated_at ON notification_setting;
DROP TABLE IF EXISTS notification_setting;
DROP INDEX IF EXISTS notification_reminder_rule_updated_by_fk_idx;
DROP TRIGGER IF EXISTS notification_reminder_rule_set_updated_at ON notification_reminder_rule;
DROP TABLE IF EXISTS notification_reminder_rule;
DROP INDEX IF EXISTS notification_rule_recipient_employee_id_fk_idx;
DROP INDEX IF EXISTS notification_rule_recipient_role_id_fk_idx;
DROP INDEX IF EXISTS notification_rule_recipient_employee_key;
DROP INDEX IF EXISTS notification_rule_recipient_role_key;
DROP TABLE IF EXISTS notification_rule_recipient;
DROP INDEX IF EXISTS notification_rule_updated_by_fk_idx;
DROP TRIGGER IF EXISTS notification_rule_set_updated_at ON notification_rule;
DROP TABLE IF EXISTS notification_rule;
