-- M0 identities, sessions, devices and credential recovery.
-- UP
CREATE TABLE IF NOT EXISTS app_user (
  user_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  email citext NOT NULL UNIQUE,
  password_hash text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'left')),
  is_ceo boolean NOT NULL DEFAULT false,
  mfa_secret_enc text,
  mfa_enrolled_at timestamptz,
  failed_login_count integer NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
  locked_until timestamptz,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS app_user_one_ceo_uq ON app_user (is_ceo) WHERE is_ceo;

CREATE TABLE IF NOT EXISTS user_session (
  session_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  refresh_token_hash text NOT NULL UNIQUE,
  ip_address inet,
  user_agent text,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  killed_at timestamptz,
  killed_by uuid REFERENCES app_user(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > issued_at)
);

CREATE TABLE IF NOT EXISTS known_device (
  known_device_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  fingerprint_hash text NOT NULL,
  label text,
  platform text,
  trusted_at timestamptz,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, fingerprint_hash)
);

CREATE TABLE IF NOT EXISTS password_reset (
  password_reset_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- DOWN
DROP TABLE IF EXISTS password_reset;
DROP TABLE IF EXISTS known_device;
DROP TABLE IF EXISTS user_session;
DROP TABLE IF EXISTS app_user;
