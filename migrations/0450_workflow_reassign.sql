-- M0 approvals: a stage given to someone else is a decision on the request's record.
--
-- Operations & People can reassign a waiting stage when its approver has left or is away
-- (docs/guides/foundation.md §11). The move is written to workflow_decision like every other,
-- so a request's history says who reassigned it, to whom and why; 0070's check did not allow
-- the word.
-- UP
ALTER TABLE workflow_decision DROP CONSTRAINT IF EXISTS workflow_decision_decision_check;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_decision_decision_check') THEN
    ALTER TABLE workflow_decision ADD CONSTRAINT workflow_decision_decision_check
      CHECK (decision IN ('approve', 'reject', 'request_changes', 'cancel', 'timeout_approve', 'timeout_reject', 'reassign'));
  END IF;
END;
$$;

-- DOWN
-- Restores 0070's check. Fails on a database that holds a reassignment, which is the point:
-- such a database needs this file.
ALTER TABLE workflow_decision DROP CONSTRAINT IF EXISTS workflow_decision_decision_check;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_decision_decision_check') THEN
    ALTER TABLE workflow_decision ADD CONSTRAINT workflow_decision_decision_check
      CHECK (decision IN ('approve', 'reject', 'request_changes', 'cancel', 'timeout_approve', 'timeout_reject'));
  END IF;
END;
$$;
