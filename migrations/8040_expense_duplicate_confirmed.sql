-- M8: when a requester sent a request despite a possible duplicate (Send Anyway), kept on the request so
-- its approvers read "Sent despite a possible duplicate" (QA audit BG-020; docs/guides/expenses.md
-- §6.8 rule 2). Null when it was sent with none found, or not sent yet; each send sets it again.
-- UP
ALTER TABLE expense_request ADD COLUMN IF NOT EXISTS duplicate_confirmed_at timestamptz;

-- DOWN
ALTER TABLE expense_request DROP COLUMN IF EXISTS duplicate_confirmed_at; -- DESTRUCTIVE: rollback only; drops what UP added
