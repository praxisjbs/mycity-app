-- M1 Mailbox: the senders whose web images a mailbox owner always shows (mailbox.md §3 step 3, §6).
-- Rows are added and removed, never changed, so the table has no updated_at.
-- UP

CREATE TABLE IF NOT EXISTS mail_image_trust (
  mail_image_trust_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mail_account_id uuid NOT NULL REFERENCES mail_account(mail_account_id) ON DELETE CASCADE,
  sender_address citext NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mail_account_id, sender_address)
);

-- DOWN

DROP TABLE IF EXISTS mail_image_trust;
