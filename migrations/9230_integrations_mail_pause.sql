-- M9 System mail paused on Settings · Integrations, and the addresses the mail server refused
-- (docs/guides/integrations.md §4, §6.15, §6.16).
--
-- integration_connection   gains when system mail was paused and by whom (the System Sender's
--                          row only): while it is set, only invitations, password resets and
--                          IT's test email go out.
-- mail_refusal             one row per address the mail server refused for good (a mailbox
--                          that does not exist, a domain that takes no mail). Telemetry, like
--                          integration_usage: written as system mail sends, no event, deleted
--                          when mail to the address is accepted again or after 30 days.
-- UP
ALTER TABLE integration_connection
  ADD COLUMN IF NOT EXISTS paused_at timestamptz,
  ADD COLUMN IF NOT EXISTS paused_by uuid REFERENCES app_user(user_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS integration_connection_paused_by_idx ON integration_connection (paused_by);

CREATE TABLE IF NOT EXISTS mail_refusal (
  mail_refusal_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext NOT NULL UNIQUE,
  -- The system mail template that was being sent when it was last refused.
  template text NOT NULL,
  smtp_code integer,
  -- The mail server's own words, cut to 300 characters.
  reply text,
  refusals integer NOT NULL DEFAULT 1 CHECK (refusals > 0),
  first_refused_at timestamptz NOT NULL DEFAULT now(),
  last_refused_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER mail_refusal_set_updated_at
  BEFORE UPDATE ON mail_refusal
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS mail_refusal_last_refused_idx ON mail_refusal (last_refused_at DESC, mail_refusal_id);

-- DOWN
DROP INDEX IF EXISTS mail_refusal_last_refused_idx;
DROP TRIGGER IF EXISTS mail_refusal_set_updated_at ON mail_refusal;
DROP TABLE IF EXISTS mail_refusal;
DROP INDEX IF EXISTS integration_connection_paused_by_idx;
ALTER TABLE integration_connection
  DROP COLUMN IF EXISTS paused_by,
  DROP COLUMN IF EXISTS paused_at;
