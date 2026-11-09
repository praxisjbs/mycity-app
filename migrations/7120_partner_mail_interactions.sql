-- M7 mail linked to a partner (docs/guides/partnerships.md §4.2, §6.15; M7 PR 8).
--
--   partner_interaction.mail_message_id   the message an email interaction was logged from now lets the
--                                         message go (ON DELETE SET NULL): the mailbox's owner emptying
--                                         Trash, or the server dropping a message, never takes the
--                                         record's history with it, and never fails on it.
--   partner_interaction.mail_thread_id    the linked thread it came from, so its mailbox's owner can open
--                                         the whole conversation from the 360 (nobody else can, §6.15).
--   partner_interaction.mail_from,        who it was from and to, as the excerpt shows them to the
--   partner_interaction.mail_to           record's readers; kept with the interaction, not read from the
--                                         message, for the same reason.
-- UP
ALTER TABLE partner_interaction ADD COLUMN IF NOT EXISTS mail_thread_id uuid REFERENCES mail_thread(mail_thread_id) ON DELETE SET NULL;
ALTER TABLE partner_interaction ADD COLUMN IF NOT EXISTS mail_from text;
ALTER TABLE partner_interaction ADD COLUMN IF NOT EXISTS mail_to text[];
CREATE INDEX IF NOT EXISTS partner_interaction_mail_thread_idx ON partner_interaction (mail_thread_id);

ALTER TABLE partner_interaction DROP CONSTRAINT IF EXISTS partner_interaction_mail_message_id_fkey;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'partner_interaction_mail_message_set_null_fkey' AND conrelid = 'partner_interaction'::regclass) THEN
    ALTER TABLE partner_interaction ADD CONSTRAINT partner_interaction_mail_message_set_null_fkey
      FOREIGN KEY (mail_message_id) REFERENCES mail_message(mail_message_id) ON DELETE SET NULL;
  END IF;
END $$;

-- DOWN
ALTER TABLE partner_interaction DROP CONSTRAINT IF EXISTS partner_interaction_mail_message_set_null_fkey;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'partner_interaction_mail_message_id_fkey' AND conrelid = 'partner_interaction'::regclass) THEN
    ALTER TABLE partner_interaction ADD CONSTRAINT partner_interaction_mail_message_id_fkey
      FOREIGN KEY (mail_message_id) REFERENCES mail_message(mail_message_id);
  END IF;
END $$;
DROP INDEX IF EXISTS partner_interaction_mail_thread_idx;
ALTER TABLE partner_interaction DROP COLUMN IF EXISTS mail_to; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE partner_interaction DROP COLUMN IF EXISTS mail_from; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE partner_interaction DROP COLUMN IF EXISTS mail_thread_id; -- DESTRUCTIVE: rollback only; drops what UP added
