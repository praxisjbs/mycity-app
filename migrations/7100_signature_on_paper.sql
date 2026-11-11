-- M7 signatures (shared with M5): a signature made on paper and recorded (Record Signed Copy) has no email, since nobody was sent a link; every other signature keeps one.
-- UP
ALTER TABLE signature ALTER COLUMN signer_email DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'signature_email_unless_paper_check') THEN
    ALTER TABLE signature ADD CONSTRAINT signature_email_unless_paper_check
      CHECK (signer_email IS NOT NULL OR method = 'paper');
  END IF;
END $$;

-- DOWN
ALTER TABLE signature DROP CONSTRAINT IF EXISTS signature_email_unless_paper_check;
-- DESTRUCTIVE: the signatures recorded from paper, which 5020's schema cannot hold without an email; their requests and the vaulted scans stay.
DELETE FROM signature WHERE signer_email IS NULL;
ALTER TABLE signature ALTER COLUMN signer_email SET NOT NULL;
