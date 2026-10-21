-- M10 AI Control: who may open it (docs/guides/ai-control.md §8, decision 12).
--
-- The Implementation Team and the System Administrator set it up: chains, prices and caps.
-- Operations & People see all three tabs and change nothing, so they know when a provider's
-- account needs recharging. Nobody else holds it. The CEO needs no grant: the CEO passes every
-- permission check (src/middleware/rbac.js).
--
-- `ai_control` is a module key, not a role test, so a new IT hire is given AI Control from
-- Settings · Roles & Permissions with no deploy.
-- UP
INSERT INTO permission (role_id, module_key, scope, can_view, can_create, can_edit, can_delete, can_approve, can_export)
SELECT r.role_id, g.module_key, g.scope, g.v, g.c, g.e, g.d, g.a, g.x
  FROM role r
  JOIN (VALUES
    -- The build team, until handover: everything, as they hold everywhere else.
    ('implementation', 'ai_control', 'all', true, true, true, true, true, true),
    -- IT: change chains, find and accept prices, set caps.
    ('administrator', 'ai_control', 'all', true, false, true, false, false, false),
    -- Operations & People: view only.
    ('operations_people', 'ai_control', 'all', true, false, false, false, false, false)
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
 WHERE module_key = 'ai_control'
   AND role_id IN (SELECT role_id FROM role WHERE code IN ('implementation', 'administrator', 'operations_people'));
