-- M7 agreements: why an agreement went back to Draft (an approver rejected it or asked for changes, or its approval was withdrawn), and when, shown on it until it is submitted again.
-- UP
ALTER TABLE partnership_agreement
  ADD COLUMN IF NOT EXISTS returned_reason text,
  ADD COLUMN IF NOT EXISTS returned_at timestamptz;

-- DOWN
ALTER TABLE partnership_agreement
  DROP COLUMN IF EXISTS returned_at,
  DROP COLUMN IF EXISTS returned_reason;
