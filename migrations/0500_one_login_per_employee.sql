-- M0 one login per employee: app_user.employee_id is unique, as identity.md §4 always said (audit 25/10/2026).
-- Two invitations racing for one person were stopped only by the email's own uniqueness, which a
-- corrected work email in between got round; the index makes the second insert fail instead.
-- UP
CREATE UNIQUE INDEX IF NOT EXISTS app_user_employee_uq ON app_user (employee_id);

-- DOWN
DROP INDEX IF EXISTS app_user_employee_uq;
