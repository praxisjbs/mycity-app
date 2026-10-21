-- M9 Settings · System Health: who may open it (docs/guides/system-health.md §8).
--
-- Deliberately not Operations & People, not Management and not by role rank. A stack
-- trace is not theirs to act on, and waking them for one creates alarm without action.
-- The CEO needs no grant: the CEO passes every permission check (src/middleware/rbac.js),
-- and the fan-out never adds the CEO to a permission audience, so no fault reaches her phone.
--
-- `system_health` is a module key, not a role test, so a new IT hire is given System Health
-- from Settings · Roles & Permissions with no deploy.
-- UP
INSERT INTO permission (role_id, module_key, scope, can_view, can_create, can_edit, can_delete, can_approve, can_export)
SELECT r.role_id, g.module_key, g.scope, g.v, g.c, g.e, g.d, g.a, g.x
  FROM role r
  JOIN (VALUES
    -- The build team, until handover: everything, as they hold everywhere else.
    ('implementation', 'system_health', 'all', true, true, true, true, true, true),
    -- IT: see it, act on it, download a brief. Nothing to create, delete or approve here.
    ('administrator', 'system_health', 'all', true, false, true, false, false, true)
  ) AS g (role_code, module_key, scope, v, c, e, d, a, x) ON g.role_code = r.code::text
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
 WHERE module_key = 'system_health'
   AND role_id IN (SELECT role_id FROM role WHERE code IN ('implementation', 'administrator'));
