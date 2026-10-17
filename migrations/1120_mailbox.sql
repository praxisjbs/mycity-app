-- M1 Mailbox: connection status and errors, the canonical folders with their sync cursor, threading keys, message fields the reader shows, drafts and the send queue (mailbox.md §4).
-- UP

-- One connection per person in M1; its status as the screens read it.
ALTER TABLE mail_account ALTER COLUMN status SET DEFAULT 'connected';
ALTER TABLE mail_account ADD COLUMN IF NOT EXISTS last_error_code text;
ALTER TABLE mail_account ADD COLUMN IF NOT EXISTS consecutive_failures integer NOT NULL DEFAULT 0;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mail_account_status_check') THEN
    ALTER TABLE mail_account ADD CONSTRAINT mail_account_status_check
      CHECK (status IN ('connected', 'needs_reconnect', 'disconnected'));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS mail_account_one_per_user_uq ON mail_account (user_id);
CREATE INDEX IF NOT EXISTS mail_account_secret_idx ON mail_account (integration_secret_id);

-- The six canonical folders, mapped from the server's special-use flags or names.
ALTER TABLE mail_folder ADD COLUMN IF NOT EXISTS kind text;
ALTER TABLE mail_folder ADD COLUMN IF NOT EXISTS uidvalidity bigint;
ALTER TABLE mail_folder ADD COLUMN IF NOT EXISTS last_sync_at timestamptz;
ALTER TABLE mail_folder ADD COLUMN IF NOT EXISTS last_error text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mail_folder_kind_check') THEN
    ALTER TABLE mail_folder ADD CONSTRAINT mail_folder_kind_check
      CHECK (kind IS NULL OR kind IN ('inbox', 'sent', 'drafts', 'archive', 'spam', 'trash'));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS mail_folder_kind_uq ON mail_folder (mail_account_id, kind) WHERE kind IS NOT NULL;

-- Threading by Message-ID, In-Reply-To and References (threading.js).
ALTER TABLE mail_thread ADD COLUMN IF NOT EXISTS thread_key text;
ALTER TABLE mail_thread ADD COLUMN IF NOT EXISTS has_attachment boolean NOT NULL DEFAULT false;
ALTER TABLE mail_thread ADD COLUMN IF NOT EXISTS message_count integer NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS mail_thread_key_uq ON mail_thread (mail_account_id, thread_key) WHERE thread_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS mail_thread_account_last_idx ON mail_thread (mail_account_id, last_message_at DESC);

ALTER TABLE mail_message ADD COLUMN IF NOT EXISTS mail_account_id uuid REFERENCES mail_account(mail_account_id) ON DELETE CASCADE;
ALTER TABLE mail_message ADD COLUMN IF NOT EXISTS from_name text;
ALTER TABLE mail_message ADD COLUMN IF NOT EXISTS snippet text;
ALTER TABLE mail_message ADD COLUMN IF NOT EXISTS in_reply_to text;
ALTER TABLE mail_message ADD COLUMN IF NOT EXISTS references_header text[] NOT NULL DEFAULT '{}';
ALTER TABLE mail_message ADD COLUMN IF NOT EXISTS has_attachment boolean NOT NULL DEFAULT false;
-- One copy of a message per mailbox, whichever folder it is in now: a move on the server moves the row.
CREATE UNIQUE INDEX IF NOT EXISTS mail_message_internet_id_uq ON mail_message (mail_account_id, internet_message_id) WHERE internet_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS mail_message_thread_time_idx ON mail_message (mail_thread_id, received_at);
CREATE INDEX IF NOT EXISTS mail_message_folder_idx ON mail_message (mail_folder_id);
CREATE INDEX IF NOT EXISTS mail_attachment_document_idx ON mail_attachment (document_id);

CREATE TABLE IF NOT EXISTS mail_draft (
  mail_draft_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  mail_account_id uuid NOT NULL REFERENCES mail_account(mail_account_id) ON DELETE CASCADE,
  to_addresses text[] NOT NULL DEFAULT '{}',
  cc_addresses text[] NOT NULL DEFAULT '{}',
  bcc_addresses text[] NOT NULL DEFAULT '{}',
  subject text NOT NULL DEFAULT '',
  body_html text NOT NULL DEFAULT '',
  document_ids uuid[] NOT NULL DEFAULT '{}',
  in_reply_to uuid REFERENCES mail_message(mail_message_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mail_draft_user_idx ON mail_draft (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS mail_draft_account_idx ON mail_draft (mail_account_id);
CREATE INDEX IF NOT EXISTS mail_draft_reply_idx ON mail_draft (in_reply_to);
CREATE OR REPLACE TRIGGER mail_draft_set_updated_at BEFORE UPDATE ON mail_draft
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS mail_send_queue (
  mail_send_queue_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  mail_account_id uuid NOT NULL REFERENCES mail_account(mail_account_id) ON DELETE CASCADE,
  mail_draft_id uuid REFERENCES mail_draft(mail_draft_id) ON DELETE SET NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'cancelled')),
  release_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  error_code text,
  last_error text,
  idempotency_key text,
  sent_message_id uuid REFERENCES mail_message(mail_message_id) ON DELETE SET NULL,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS mail_send_queue_idempotency_uq ON mail_send_queue (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS mail_send_queue_due_idx ON mail_send_queue (release_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS mail_send_queue_user_idx ON mail_send_queue (user_id);
CREATE INDEX IF NOT EXISTS mail_send_queue_account_idx ON mail_send_queue (mail_account_id);
CREATE INDEX IF NOT EXISTS mail_send_queue_draft_idx ON mail_send_queue (mail_draft_id);
CREATE INDEX IF NOT EXISTS mail_send_queue_message_idx ON mail_send_queue (sent_message_id);
CREATE OR REPLACE TRIGGER mail_send_queue_set_updated_at BEFORE UPDATE ON mail_send_queue
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- DOWN
DROP TRIGGER IF EXISTS mail_send_queue_set_updated_at ON mail_send_queue;
DROP INDEX IF EXISTS mail_send_queue_message_idx;
DROP INDEX IF EXISTS mail_send_queue_draft_idx;
DROP INDEX IF EXISTS mail_send_queue_account_idx;
DROP INDEX IF EXISTS mail_send_queue_user_idx;
DROP INDEX IF EXISTS mail_send_queue_due_idx;
DROP INDEX IF EXISTS mail_send_queue_idempotency_uq;
DROP TABLE IF EXISTS mail_send_queue;
DROP TRIGGER IF EXISTS mail_draft_set_updated_at ON mail_draft;
DROP INDEX IF EXISTS mail_draft_reply_idx;
DROP INDEX IF EXISTS mail_draft_account_idx;
DROP INDEX IF EXISTS mail_draft_user_idx;
DROP TABLE IF EXISTS mail_draft;
DROP INDEX IF EXISTS mail_attachment_document_idx;
DROP INDEX IF EXISTS mail_message_folder_idx;
DROP INDEX IF EXISTS mail_message_thread_time_idx;
DROP INDEX IF EXISTS mail_message_internet_id_uq;
ALTER TABLE mail_message DROP COLUMN IF EXISTS has_attachment;
ALTER TABLE mail_message DROP COLUMN IF EXISTS references_header;
ALTER TABLE mail_message DROP COLUMN IF EXISTS in_reply_to;
ALTER TABLE mail_message DROP COLUMN IF EXISTS snippet;
ALTER TABLE mail_message DROP COLUMN IF EXISTS from_name;
ALTER TABLE mail_message DROP COLUMN IF EXISTS mail_account_id;
DROP INDEX IF EXISTS mail_thread_account_last_idx;
DROP INDEX IF EXISTS mail_thread_key_uq;
ALTER TABLE mail_thread DROP COLUMN IF EXISTS message_count;
ALTER TABLE mail_thread DROP COLUMN IF EXISTS has_attachment;
ALTER TABLE mail_thread DROP COLUMN IF EXISTS thread_key;
DROP INDEX IF EXISTS mail_folder_kind_uq;
ALTER TABLE mail_folder DROP CONSTRAINT IF EXISTS mail_folder_kind_check;
ALTER TABLE mail_folder DROP COLUMN IF EXISTS last_error;
ALTER TABLE mail_folder DROP COLUMN IF EXISTS last_sync_at;
ALTER TABLE mail_folder DROP COLUMN IF EXISTS uidvalidity;
ALTER TABLE mail_folder DROP COLUMN IF EXISTS kind;
DROP INDEX IF EXISTS mail_account_secret_idx;
DROP INDEX IF EXISTS mail_account_one_per_user_uq;
ALTER TABLE mail_account DROP CONSTRAINT IF EXISTS mail_account_status_check;
ALTER TABLE mail_account DROP COLUMN IF EXISTS consecutive_failures;
ALTER TABLE mail_account DROP COLUMN IF EXISTS last_error_code;
ALTER TABLE mail_account ALTER COLUMN status SET DEFAULT 'active';
