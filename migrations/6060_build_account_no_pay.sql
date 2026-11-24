-- M6 payroll: the build account carries no pay and no bank details (docs/guides/payroll.md §6.1 rule 6; JBS Praxis,
-- 24/11/2026, QA BG-003). The account `scripts/db/create-admin.js --build-account` makes is the implementation partner's,
-- never one of MyCity's staff, but until now it was made with a monthly gross and a placeholder bank account, so every
-- payroll run made by hand on staging and production counted it. The script no longer sets either, the run leaves out
-- every holder of the Implementation Team role (`payroll.inputs.peopleFor`, whatever pay a record is later given), and
-- this file clears both on the records already made.
--
-- The build account is found the way the code finds it: the employee whose login holds the role create-admin gives it
-- (`BUILD_ACCOUNT.role_code`, `implementation`), never by name. A database with no such login is unchanged. Payslips
-- already made are not touched: an approved run is locked, and the next Compute of an open run drops the account.
-- UP
UPDATE employee e
   SET gross_monthly = NULL, bank_name = NULL, account_number = NULL
 WHERE (e.gross_monthly IS NOT NULL OR e.bank_name IS NOT NULL OR e.account_number IS NOT NULL)
   AND EXISTS (SELECT 1 FROM app_user u
                 JOIN user_role ur ON ur.user_id = u.user_id
                 JOIN role r ON r.role_id = ur.role_id
                WHERE u.employee_id = e.employee_id AND r.code = 'implementation');

-- DOWN
-- Nothing to put back: the figures cleared were never MyCity's pay or a real account (the account number was ten zeros),
-- and UP changed no schema, so the round trip finds the catalogue as it left it.
SELECT 1;
