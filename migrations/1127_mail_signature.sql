-- M1 Mailbox: email signatures, a person's own numbers and switches and the company's links and switches (mailbox.md §4).
-- The mobile stays on employee.phone and is never copied here. The configuration is one row at most.
-- UP

CREATE TABLE IF NOT EXISTS mail_signature (
  mail_signature_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES app_user(user_id) ON DELETE CASCADE,
  office_line text,
  show_mobile boolean NOT NULL DEFAULT true,
  show_whatsapp boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER mail_signature_set_updated_at
BEFORE UPDATE ON mail_signature
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS mail_signature_config (
  mail_signature_config_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_store_url text,
  google_play_url text,
  instagram_url text,
  tiktok_url text,
  linkedin_url text,
  x_url text,
  facebook_url text,
  youtube_url text,
  confidentiality_note text,
  show_whatsapp boolean NOT NULL DEFAULT true,
  show_app_links boolean NOT NULL DEFAULT true,
  show_social_links boolean NOT NULL DEFAULT true,
  show_legal boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS mail_signature_config_one_row_uq ON mail_signature_config ((true));
CREATE INDEX IF NOT EXISTS mail_signature_config_updated_by_idx ON mail_signature_config (updated_by);

CREATE OR REPLACE TRIGGER mail_signature_config_set_updated_at
BEFORE UPDATE ON mail_signature_config
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- DOWN

DROP TRIGGER IF EXISTS mail_signature_config_set_updated_at ON mail_signature_config;
DROP INDEX IF EXISTS mail_signature_config_updated_by_idx;
DROP INDEX IF EXISTS mail_signature_config_one_row_uq;
DROP TABLE IF EXISTS mail_signature_config;
DROP TRIGGER IF EXISTS mail_signature_set_updated_at ON mail_signature;
DROP TABLE IF EXISTS mail_signature;
