-- M8: a request's line may carry a negative unit price (a discount, or a payment already made on the
-- invoice), so a request read from an invoice asks for its balance due with every line the approvers
-- should see (docs/guides/praxis-ai.md decision 45; docs/guides/expenses.md §6.1 rule 1). The
-- request's total stays above zero: the service's rule (EXPENSE_TOTAL_NOT_POSITIVE). 8010's CHECKs
-- on a line's unit price and amount go; its quantity stays above zero. Relaxing a CHECK is not
-- destructive.
-- UP
ALTER TABLE expense_request_line DROP CONSTRAINT IF EXISTS expense_request_line_unit_price_check;
ALTER TABLE expense_request_line DROP CONSTRAINT IF EXISTS expense_request_line_amount_check;

-- DOWN
-- The CHECKs come back NOT VALID, so a rollback runs while a discount line is saved: new lines are
-- held to them again and the lines already saved stay as they are.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expense_request_line_unit_price_check') THEN
    ALTER TABLE expense_request_line ADD CONSTRAINT expense_request_line_unit_price_check CHECK (unit_price >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expense_request_line_amount_check') THEN
    ALTER TABLE expense_request_line ADD CONSTRAINT expense_request_line_amount_check CHECK (amount >= 0) NOT VALID;
  END IF;
END $$;
