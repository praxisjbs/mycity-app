-- M0 encrypted integration references and public access tokens.
-- UP
CREATE TABLE IF NOT EXISTS integration_secret (
  integration_secret_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  key text NOT NULL,
  ciphertext text NOT NULL,
  key_version integer NOT NULL DEFAULT 1 CHECK (key_version > 0),
  active boolean NOT NULL DEFAULT true,
  rotated_at timestamptz,
  created_by uuid REFERENCES app_user(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, key)
);

CREATE TABLE IF NOT EXISTS public_token (
  public_token_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  scope text NOT NULL,
  subject_type text NOT NULL,
  subject_id text NOT NULL,
  single_use boolean NOT NULL DEFAULT true,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  revoked_at timestamptz,
  created_by uuid REFERENCES app_user(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- DOWN
DROP TABLE IF EXISTS public_token;
DROP TABLE IF EXISTS integration_secret;
