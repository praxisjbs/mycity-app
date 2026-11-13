-- M8: a request's line may take money off (a discount, a deposit or an amount already paid on the invoice), so a request reads as its invoice does and asks for what the invoice asks to be paid. The request's own amount stays above zero: expenses.service refuses one that is not (docs/guides/expenses.md §6.1 rule 1; TB, 13/11/2026).
-- UP
ALTER TABLE expense_request_line DROP CONSTRAINT IF EXISTS expense_request_line_unit_price_check;
ALTER TABLE expense_request_line DROP CONSTRAINT IF EXISTS expense_request_line_amount_check;

-- DOWN
-- NOT VALID: a line already saved below zero stays as it was; new lines are held to zero or above again.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expense_request_line_unit_price_check') THEN
    ALTER TABLE expense_request_line ADD CONSTRAINT expense_request_line_unit_price_check CHECK (unit_price >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expense_request_line_amount_check') THEN
    ALTER TABLE expense_request_line ADD CONSTRAINT expense_request_line_amount_check CHECK (amount >= 0) NOT VALID;
  END IF;
END $$;
