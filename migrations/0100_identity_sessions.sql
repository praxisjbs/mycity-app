-- M0 sign-in sessions as the session policy enforces them: a fixed ceiling from sign-in, an idle
-- limit read from the last refresh, refresh-token rotation, and the device a session was opened on.
-- Credential links serve invitations as well as resets. A role names the Home view it opens.
-- UP
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS last_failed_login_at timestamptz;
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS password_changed_at timestamptz;

ALTER TABLE user_session ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE user_session ADD COLUMN IF NOT EXISTS method text NOT NULL DEFAULT 'password'
  CHECK (method IN ('password', 'pin', 'passkey', 'password_totp'));
ALTER TABLE user_session ADD COLUMN IF NOT EXISTS known_device_id uuid
  REFERENCES known_device(known_device_id) ON DELETE SET NULL;
ALTER TABLE user_session ADD COLUMN IF NOT EXISTS device_label text;
ALTER TABLE user_session ADD COLUMN IF NOT EXISTS end_reason text
  CHECK (end_reason IS NULL OR end_reason IN (
    'signed_out', 'session_max_age', 'inactivity_timeout', 'refresh_token_reuse',
    'password_changed', 'password_reset', 'ended_by_user', 'ended_by_admin', 'account_suspended'
  ));
CREATE INDEX IF NOT EXISTS user_session_user_issued_idx ON user_session (user_id, issued_at DESC);

ALTER TABLE known_device ADD COLUMN IF NOT EXISTS last_ip inet;

ALTER TABLE password_reset ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'reset'
  CHECK (purpose IN ('reset', 'invite'));
ALTER TABLE password_reset ADD COLUMN IF NOT EXISTS requested_by uuid REFERENCES app_user(user_id);
ALTER TABLE password_reset ADD COLUMN IF NOT EXISTS requested_ip inet;
ALTER TABLE password_reset ADD COLUMN IF NOT EXISTS source_event_id uuid UNIQUE;
CREATE INDEX IF NOT EXISTS password_reset_open_idx ON password_reset (user_id) WHERE used_at IS NULL;

ALTER TABLE role ADD COLUMN IF NOT EXISTS home_view text
  CHECK (home_view IS NULL OR home_view IN ('operations', 'ceo', 'partnerships', 'staff'));
ALTER TABLE role ADD COLUMN IF NOT EXISTS rank integer NOT NULL DEFAULT 0;

-- DOWN
ALTER TABLE role DROP COLUMN IF EXISTS rank;
ALTER TABLE role DROP COLUMN IF EXISTS home_view;
DROP INDEX IF EXISTS password_reset_open_idx;
ALTER TABLE password_reset DROP COLUMN IF EXISTS source_event_id;
ALTER TABLE password_reset DROP COLUMN IF EXISTS requested_ip;
ALTER TABLE password_reset DROP COLUMN IF EXISTS requested_by;
ALTER TABLE password_reset DROP COLUMN IF EXISTS purpose;
ALTER TABLE known_device DROP COLUMN IF EXISTS last_ip;
DROP INDEX IF EXISTS user_session_user_issued_idx;
ALTER TABLE user_session DROP COLUMN IF EXISTS end_reason;
ALTER TABLE user_session DROP COLUMN IF EXISTS device_label;
ALTER TABLE user_session DROP COLUMN IF EXISTS known_device_id;
ALTER TABLE user_session DROP COLUMN IF EXISTS method;
ALTER TABLE user_session DROP COLUMN IF EXISTS last_seen_at;
ALTER TABLE app_user DROP COLUMN IF EXISTS password_changed_at;
ALTER TABLE app_user DROP COLUMN IF EXISTS last_failed_login_at;
