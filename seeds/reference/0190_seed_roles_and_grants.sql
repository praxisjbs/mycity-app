-- M0 roles and their grants: the six roles MyCity runs on (agreed 16/10/2026 from the staff list),
-- plus the implementation team's full-access role. Reference data only: who holds a role is decided
-- in the app (Settings, Users) or by create-admin, never here. The CEO is a flag on the login, not a role.
-- Grants are module -> actions -> record scope (all, team, own). Roles add up; the widest scope wins.
-- UP
INSERT INTO role (code, name, description, is_system, home_view, rank)
VALUES
  ('implementation', 'Implementation Team', 'Full access for the build team until handover.', true, 'operations', 100),
  ('operations_people', 'Operations & People', 'People, HR and operations across every module.', true, 'operations', 90),
  ('management', 'Management', 'Organisation-wide oversight and approvals.', true, 'operations', 80),
  ('head_of_department', 'Head of Department', 'Runs a department and approves for it.', true, 'partnerships', 60),
  ('administrator', 'System Administrator', 'Settings, users and roles.', true, 'staff', 50),
  ('manager', 'Line Manager', 'Manages the people who report to them.', true, 'staff', 40),
  ('employee', 'Staff', 'Their own work and records.', true, 'staff', 10)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  is_system = EXCLUDED.is_system,
  home_view = EXCLUDED.home_view,
  rank = EXCLUDED.rank,
  active = true,
  updated_at = now();

INSERT INTO permission (role_id, module_key, scope, can_view, can_create, can_edit, can_delete, can_approve, can_export)
SELECT r.role_id, g.module_key, g.scope, g.v, g.c, g.e, g.d, g.a, g.x
  FROM role r
  JOIN (VALUES
    -- Implementation Team: everything, everywhere.
    ('implementation', 'home', 'all', true, true, true, true, true, true),
    ('implementation', 'workspace', 'all', true, true, true, true, true, true),
    ('implementation', 'ess', 'own', true, true, true, true, true, true),
    ('implementation', 'community', 'all', true, true, true, true, true, true),
    ('implementation', 'mailbox', 'own', true, true, true, true, true, true),
    ('implementation', 'people', 'all', true, true, true, true, true, true),
    ('implementation', 'performance', 'all', true, true, true, true, true, true),
    ('implementation', 'queries', 'all', true, true, true, true, true, true),
    ('implementation', 'recruitment', 'all', true, true, true, true, true, true),
    ('implementation', 'payroll', 'all', true, true, true, true, true, true),
    ('implementation', 'partnerships', 'all', true, true, true, true, true, true),
    ('implementation', 'expenses', 'all', true, true, true, true, true, true),
    ('implementation', 'knowledge', 'all', true, true, true, true, true, true),
    ('implementation', 'praxis_ai', 'all', true, true, true, true, true, true),
    ('implementation', 'settings', 'all', true, true, true, true, true, true),
    -- Operations & People: every module, organisation-wide.
    ('operations_people', 'home', 'all', true, true, true, true, true, true),
    ('operations_people', 'workspace', 'all', true, true, true, true, true, true),
    ('operations_people', 'ess', 'own', true, true, true, false, false, true),
    ('operations_people', 'community', 'all', true, true, true, true, true, true),
    ('operations_people', 'mailbox', 'own', true, true, true, true, false, true),
    ('operations_people', 'people', 'all', true, true, true, true, true, true),
    ('operations_people', 'performance', 'all', true, true, true, true, true, true),
    ('operations_people', 'queries', 'all', true, true, true, true, true, true),
    ('operations_people', 'recruitment', 'all', true, true, true, true, true, true),
    ('operations_people', 'payroll', 'all', true, true, true, true, true, true),
    ('operations_people', 'partnerships', 'all', true, true, true, true, true, true),
    ('operations_people', 'expenses', 'all', true, true, true, true, true, true),
    ('operations_people', 'knowledge', 'all', true, true, true, true, true, true),
    ('operations_people', 'praxis_ai', 'all', true, true, true, false, false, true),
    ('operations_people', 'settings', 'all', true, true, true, true, true, true),
    -- Management: sees and approves everything; changes settings only through People.
    ('management', 'home', 'all', true, true, true, false, true, true),
    ('management', 'workspace', 'all', true, true, true, true, true, true),
    ('management', 'ess', 'own', true, true, true, false, false, true),
    ('management', 'community', 'all', true, true, true, true, true, true),
    ('management', 'mailbox', 'own', true, true, true, true, false, true),
    ('management', 'people', 'all', true, true, true, false, true, true),
    ('management', 'performance', 'all', true, true, true, false, true, true),
    ('management', 'queries', 'all', true, true, true, false, true, true),
    ('management', 'recruitment', 'all', true, true, true, false, true, true),
    ('management', 'payroll', 'all', true, false, false, false, true, true),
    ('management', 'partnerships', 'all', true, true, true, false, true, true),
    ('management', 'expenses', 'all', true, true, true, false, true, true),
    ('management', 'knowledge', 'all', true, true, true, false, true, true),
    ('management', 'praxis_ai', 'all', true, true, true, false, false, true),
    ('management', 'settings', 'all', true, false, false, false, false, true),
    -- Head of Department: their department (the reporting tree under them), with approvals.
    ('head_of_department', 'home', 'team', true, true, true, false, true, true),
    ('head_of_department', 'workspace', 'team', true, true, true, true, true, true),
    ('head_of_department', 'ess', 'own', true, true, true, false, false, false),
    ('head_of_department', 'community', 'own', true, true, true, true, false, false),
    ('head_of_department', 'mailbox', 'own', true, true, true, true, false, false),
    ('head_of_department', 'people', 'team', true, false, false, false, true, true),
    ('head_of_department', 'performance', 'team', true, true, true, false, true, true),
    ('head_of_department', 'queries', 'team', true, true, true, false, true, false),
    ('head_of_department', 'recruitment', 'team', true, true, true, false, false, false),
    ('head_of_department', 'partnerships', 'team', true, true, true, false, true, true),
    ('head_of_department', 'expenses', 'team', true, true, true, false, true, true),
    ('head_of_department', 'knowledge', 'all', true, false, false, false, false, false),
    ('head_of_department', 'praxis_ai', 'own', true, true, false, false, false, false),
    -- System Administrator: settings, users and roles, plus their own work.
    ('administrator', 'home', 'own', true, false, false, false, false, false),
    ('administrator', 'workspace', 'own', true, true, true, true, false, false),
    ('administrator', 'ess', 'own', true, true, true, false, false, false),
    ('administrator', 'community', 'own', true, true, true, true, false, false),
    ('administrator', 'mailbox', 'own', true, true, true, true, false, false),
    ('administrator', 'knowledge', 'all', true, false, false, false, false, false),
    ('administrator', 'praxis_ai', 'own', true, true, false, false, false, false),
    ('administrator', 'settings', 'all', true, true, true, true, true, true),
    -- Line Manager: the people who report to them.
    ('manager', 'home', 'team', true, false, false, false, false, false),
    ('manager', 'workspace', 'team', true, true, true, true, true, false),
    ('manager', 'ess', 'own', true, true, true, false, false, false),
    ('manager', 'community', 'own', true, true, true, true, false, false),
    ('manager', 'mailbox', 'own', true, true, true, true, false, false),
    ('manager', 'people', 'team', true, false, false, false, true, false),
    ('manager', 'performance', 'team', true, true, true, false, true, false),
    ('manager', 'queries', 'team', true, true, false, false, false, false),
    ('manager', 'partnerships', 'team', true, true, true, false, false, false),
    ('manager', 'expenses', 'team', true, true, true, false, true, false),
    ('manager', 'knowledge', 'all', true, false, false, false, false, false),
    ('manager', 'praxis_ai', 'own', true, true, false, false, false, false),
    -- Staff: their own work and records.
    ('employee', 'home', 'own', true, false, false, false, false, false),
    ('employee', 'workspace', 'own', true, true, true, true, false, false),
    ('employee', 'ess', 'own', true, true, true, false, false, false),
    ('employee', 'community', 'own', true, true, true, true, false, false),
    ('employee', 'mailbox', 'own', true, true, true, true, false, false),
    ('employee', 'performance', 'own', true, true, true, false, false, false),
    ('employee', 'queries', 'own', true, false, false, false, false, false),
    ('employee', 'partnerships', 'own', true, true, true, false, false, false),
    ('employee', 'expenses', 'own', true, true, true, false, false, false),
    ('employee', 'knowledge', 'all', true, false, false, false, false, false),
    ('employee', 'praxis_ai', 'own', true, true, false, false, false, false)
  ) AS g (code, module_key, scope, v, c, e, d, a, x) ON g.code = r.code::text
ON CONFLICT (role_id, module_key) DO UPDATE SET
  scope = EXCLUDED.scope,
  can_view = EXCLUDED.can_view,
  can_create = EXCLUDED.can_create,
  can_edit = EXCLUDED.can_edit,
  can_delete = EXCLUDED.can_delete,
  can_approve = EXCLUDED.can_approve,
  can_export = EXCLUDED.can_export,
  updated_at = now();

-- DOWN
DELETE FROM permission
 WHERE role_id IN (SELECT role_id FROM role WHERE code IN (
   'implementation', 'operations_people', 'management', 'head_of_department', 'administrator', 'manager', 'employee'
 ));
DELETE FROM role WHERE code IN ('implementation', 'operations_people', 'head_of_department');
UPDATE role SET name = 'Administrator', description = 'System administration and configuration.', home_view = NULL, rank = 0
 WHERE code = 'administrator';
UPDATE role SET name = 'Management', description = 'Organisation-wide management and approvals.', home_view = NULL, rank = 0
 WHERE code = 'management';
UPDATE role SET name = 'Manager', description = 'Team management and approvals.', home_view = NULL, rank = 0
 WHERE code = 'manager';
UPDATE role SET name = 'Employee', description = 'Employee self-service access.', home_view = NULL, rank = 0
 WHERE code = 'employee';
