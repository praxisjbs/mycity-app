-- M7 the Proposal Studio (docs/guides/partnerships.md §4.2, §6.10, §6.11; M7 PR 7).
--
--   partnership_proposal.progress       where the studio's job stands while Claude asks or writes:
--                                       { job: questions|draft, step, failed, reason, at }, null when
--                                       nothing runs; a failure keeps the brief and the answers, and
--                                       Try Again queues the job once more (§6.10).
--   partnership_proposal.link_secret    the private link's token, encrypted for this proposal
--                                       (services/secrets/encryption.service), so Copy Link can show
--                                       the link while it works; public_token keeps only its hash.
--                                       Cleared when the link stops (declined, expired, withdrawn).
--   partnership_proposal.sent_subject,  what the person confirmed in Send Proposal, mailed with the PDF
--   partnership_proposal.sent_message   once the worker has drawn it.
--   partnership_proposal.number         a revision keeps its proposal's number (PRO-0012, version 2), so
--                                       the number is unique with its version, not alone.
-- UP
ALTER TABLE partnership_proposal ADD COLUMN IF NOT EXISTS progress jsonb;
ALTER TABLE partnership_proposal ADD COLUMN IF NOT EXISTS link_secret text;
ALTER TABLE partnership_proposal ADD COLUMN IF NOT EXISTS sent_subject text;
ALTER TABLE partnership_proposal ADD COLUMN IF NOT EXISTS sent_message text;

ALTER TABLE partnership_proposal DROP CONSTRAINT IF EXISTS partnership_proposal_number_key;
CREATE UNIQUE INDEX IF NOT EXISTS partnership_proposal_number_version_uq ON partnership_proposal (number, version);
CREATE INDEX IF NOT EXISTS partnership_proposal_valid_until_idx ON partnership_proposal (valid_until) WHERE status IN ('sent', 'viewed');

-- DOWN
-- A number alone is unique again only while no proposal has a second version: refuse rather than lose one.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM partnership_proposal GROUP BY number HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'partnership_proposal holds revised proposals: a number has more than one version';
  END IF;
END $$;
DROP INDEX IF EXISTS partnership_proposal_valid_until_idx;
DROP INDEX IF EXISTS partnership_proposal_number_version_uq;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'partnership_proposal_number_key') THEN
    ALTER TABLE partnership_proposal ADD CONSTRAINT partnership_proposal_number_key UNIQUE (number);
  END IF;
END $$;
ALTER TABLE partnership_proposal DROP COLUMN IF EXISTS sent_message;
ALTER TABLE partnership_proposal DROP COLUMN IF EXISTS sent_subject;
ALTER TABLE partnership_proposal DROP COLUMN IF EXISTS link_secret;
ALTER TABLE partnership_proposal DROP COLUMN IF EXISTS progress;
