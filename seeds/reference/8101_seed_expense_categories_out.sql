-- M8: take 8099's five expense categories out (A26: categories are MyCity's own business choice,
-- entered on Expenses · Categories, Add Suggested Categories while there are none;
-- docs/guides/expenses.md §6.7, docs/handoff/m8-expenses-audit.md F4). Runs on every environment,
-- production included, so Add Suggested Categories is offered there too. A category a request or a
-- budget line names is kept: on staging that is Home's demonstration rows until M8's staging seed
-- (seeds/staging/80_expenses.js) takes them away and the five with them.
-- UP
-- Untouched means as 8099 wrote it: its code and name, operating, no description.
-- DESTRUCTIVE: removes 8099's seeded categories (A26); one a request or a budget line names, or that was changed, is kept.
DELETE FROM expense_category c
 USING (VALUES
          ('travel', 'Travel'),
          ('office', 'Office Supplies'),
          ('training', 'Training'),
          ('utilities', 'Utilities'),
          ('professional_services', 'Professional Services')
       ) AS seeded (code, name)
 WHERE c.code = seeded.code
   AND c.name = seeded.name
   AND c.description IS NULL
   AND NOT EXISTS (SELECT 1 FROM expense_request er WHERE er.expense_category_id = c.expense_category_id)
   AND NOT EXISTS (SELECT 1 FROM budget_line bl WHERE bl.expense_category_id = c.expense_category_id);

-- DOWN
-- The five as 8099 left them, unless a category holds the code now.
INSERT INTO expense_category (code, name)
VALUES ('travel', 'Travel'), ('office', 'Office Supplies'), ('training', 'Training'), ('utilities', 'Utilities'), ('professional_services', 'Professional Services')
ON CONFLICT (code) DO NOTHING;
