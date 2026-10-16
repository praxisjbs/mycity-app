-- M0 the other ways to sign in (docs/guides/identity.md): two-step sign-in with an authenticator
-- app and its recovery codes, passkeys, the PIN, how long a device may skip the code, when a
-- session last proved who it is, and the challenges already spent.
--
-- app_user      two-step: the key being set up until its first code proves it, how often a device
--               is asked (the person's choice; Once a Day for a new set-up), the last code step
--               taken, so a code works once. The PIN: its Argon2 hash and the wrong tries, counted
--               like a password's (a doubling wait) and in a rolling 30 days; enough of either
--               switches the PIN off. mfa_secret_enc and mfa_enrolled_at are 0010's.
-- known_device  until when this browser may sign this person in without the code.
-- user_session  when the session last proved who it is (a password, a passkey or the PIN), so a
--               way to sign in can be added or removed within the window after it. A session
--               begun with the PIN and then the code is pin_totp.
-- mfa_recovery_code  ten one-use codes per person, Argon2 hashes only; used_at spends one.
-- passkey       one row per WebAuthn credential: its id and public key, the signature counter,
--               where it was added, a label the person chooses.
-- spent_challenge    a passkey or code-step ticket that has been used, so it cannot be used again;
--               written only after the answer it carried checked out.
-- UP
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS mfa_frequency text NOT NULL DEFAULT 'daily'
  CHECK (mfa_frequency IN ('every_sign_in', 'daily', 'monthly'));
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS mfa_pending_secret_enc text;
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS mfa_pending_until timestamptz;
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS mfa_last_step integer;
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS pin_hash text;
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS pin_changed_at timestamptz;
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS pin_failed_count integer NOT NULL DEFAULT 0
  CHECK (pin_failed_count >= 0);
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS pin_last_failed_at timestamptz;
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS pin_window_started_at timestamptz;
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS pin_window_failures integer NOT NULL DEFAULT 0
  CHECK (pin_window_failures >= 0);

ALTER TABLE known_device ADD COLUMN IF NOT EXISTS mfa_trusted_until timestamptz;

ALTER TABLE user_session ADD COLUMN IF NOT EXISTS reauthenticated_at timestamptz;
ALTER TABLE user_session DROP CONSTRAINT IF EXISTS user_session_method_check;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_session_method_check') THEN
    ALTER TABLE user_session ADD CONSTRAINT user_session_method_check
      CHECK (method IN ('password', 'password_totp', 'pin', 'pin_totp', 'passkey'));
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS mfa_recovery_code (
  mfa_recovery_code_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mfa_recovery_code_user_id_fk_idx ON mfa_recovery_code (user_id);
CREATE OR REPLACE TRIGGER mfa_recovery_code_set_updated_at BEFORE UPDATE ON mfa_recovery_code
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS passkey (
  passkey_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  credential_id text NOT NULL UNIQUE,
  public_key text NOT NULL,
  sign_count bigint NOT NULL DEFAULT 0 CHECK (sign_count >= 0),
  transports text[] NOT NULL DEFAULT '{}',
  backed_up boolean NOT NULL DEFAULT false,
  label text NOT NULL,
  known_device_id uuid REFERENCES known_device(known_device_id) ON DELETE SET NULL,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS passkey_user_id_fk_idx ON passkey (user_id, created_at);
CREATE INDEX IF NOT EXISTS passkey_known_device_id_fk_idx ON passkey (known_device_id);
CREATE OR REPLACE TRIGGER passkey_set_updated_at BEFORE UPDATE ON passkey
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS spent_challenge (
  spent_challenge_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_hash text NOT NULL UNIQUE,
  purpose text NOT NULL
    CHECK (purpose IN ('two_step', 'passkey_sign_in', 'passkey_add', 'passkey_confirm')),
  user_id uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS spent_challenge_user_id_fk_idx ON spent_challenge (user_id);
CREATE INDEX IF NOT EXISTS spent_challenge_expires_idx ON spent_challenge (expires_at);
CREATE OR REPLACE TRIGGER spent_challenge_set_updated_at BEFORE UPDATE ON spent_challenge
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- DOWN
-- The method check goes back to 0200's list. Like 0100, it fails on a database that holds a
-- session begun with the PIN and a code: such a database needs this file.
DROP TRIGGER IF EXISTS spent_challenge_set_updated_at ON spent_challenge;
DROP INDEX IF EXISTS spent_challenge_expires_idx;
DROP INDEX IF EXISTS spent_challenge_user_id_fk_idx;
DROP TABLE IF EXISTS spent_challenge;

DROP TRIGGER IF EXISTS passkey_set_updated_at ON passkey;
DROP INDEX IF EXISTS passkey_known_device_id_fk_idx;
DROP INDEX IF EXISTS passkey_user_id_fk_idx;
DROP TABLE IF EXISTS passkey;

DROP TRIGGER IF EXISTS mfa_recovery_code_set_updated_at ON mfa_recovery_code;
DROP INDEX IF EXISTS mfa_recovery_code_user_id_fk_idx;
DROP TABLE IF EXISTS mfa_recovery_code;

ALTER TABLE user_session DROP CONSTRAINT IF EXISTS user_session_method_check;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_session_method_check') THEN
    ALTER TABLE user_session ADD CONSTRAINT user_session_method_check
      CHECK (method IN ('password', 'pin', 'passkey', 'password_totp'));
  END IF;
END;
$$;
ALTER TABLE user_session DROP COLUMN IF EXISTS reauthenticated_at;

ALTER TABLE known_device DROP COLUMN IF EXISTS mfa_trusted_until;

ALTER TABLE app_user DROP COLUMN IF EXISTS pin_window_failures;
ALTER TABLE app_user DROP COLUMN IF EXISTS pin_window_started_at;
ALTER TABLE app_user DROP COLUMN IF EXISTS pin_last_failed_at;
ALTER TABLE app_user DROP COLUMN IF EXISTS pin_failed_count;
ALTER TABLE app_user DROP COLUMN IF EXISTS pin_changed_at;
ALTER TABLE app_user DROP COLUMN IF EXISTS pin_hash;
ALTER TABLE app_user DROP COLUMN IF EXISTS mfa_last_step;
ALTER TABLE app_user DROP COLUMN IF EXISTS mfa_pending_until;
ALTER TABLE app_user DROP COLUMN IF EXISTS mfa_pending_secret_enc;
ALTER TABLE app_user DROP COLUMN IF EXISTS mfa_frequency;
