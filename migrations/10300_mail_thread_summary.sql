-- M10 mail AI, brought forward (TB, 22/10/2026): Summarise Thread's answer, kept per conversation until its newest message changes (mailbox.md §1.1 decision 7, §3 step 14, §4).
-- One row per conversation, replaced in place by the next fresh summary; it goes with its conversation.
-- UP

CREATE TABLE IF NOT EXISTS mail_thread_summary (
  mail_thread_summary_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mail_thread_id uuid NOT NULL REFERENCES mail_thread(mail_thread_id) ON DELETE CASCADE,
  gist text NOT NULL,
  key_points text[] NOT NULL DEFAULT '{}',
  asked_of_you text[] NOT NULL DEFAULT '{}',
  message_count integer NOT NULL CHECK (message_count >= 0),
  last_message_id uuid REFERENCES mail_message(mail_message_id) ON DELETE SET NULL,
  ai_run_id uuid REFERENCES ai_run(run_id) ON DELETE SET NULL,
  summarised_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mail_thread_summary_thread_uq UNIQUE (mail_thread_id),
  CONSTRAINT mail_thread_summary_points_ck CHECK (cardinality(key_points) <= 5 AND cardinality(asked_of_you) <= 5)
);

CREATE INDEX IF NOT EXISTS mail_thread_summary_last_message_fk_idx ON mail_thread_summary (last_message_id);
CREATE INDEX IF NOT EXISTS mail_thread_summary_ai_run_fk_idx ON mail_thread_summary (ai_run_id);

CREATE OR REPLACE TRIGGER mail_thread_summary_set_updated_at BEFORE UPDATE ON mail_thread_summary
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- DOWN

DROP TRIGGER IF EXISTS mail_thread_summary_set_updated_at ON mail_thread_summary;
DROP INDEX IF EXISTS mail_thread_summary_ai_run_fk_idx;
DROP INDEX IF EXISTS mail_thread_summary_last_message_fk_idx;
DROP TABLE IF EXISTS mail_thread_summary;
