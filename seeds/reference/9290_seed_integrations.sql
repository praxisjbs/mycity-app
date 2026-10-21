-- M9 Settings · Integrations: who may open it (docs/guides/integrations.md §8).
--
-- The IT team only: the keys and passwords of the services the ERP runs on are not
-- Operations & People's, Management's or anyone else's to see or change. The CEO needs no
-- grant: the CEO passes every permission check (src/middleware/rbac.js), and the fan-out
-- never adds the CEO to a permission audience.
--
-- `integrations` is a module key, not a role test, so a new IT hire is given Integrations
-- from Settings · Roles & Permissions with no deploy. No connection, key or URL is seeded
-- (A26): each environment's are entered on the screen.
-- UP
INSERT INTO permission (role_id, module_key, scope, can_view, can_create, can_edit, can_delete, can_approve, can_export)
SELECT r.role_id, g.module_key, g.scope, g.v, g.c, g.e, g.d, g.a, g.x
  FROM role r
  JOIN (VALUES
    -- The build team, until handover: everything, as they hold everywhere else.
    ('implementation', 'integrations', 'all', true, true, true, true, true, true),
    -- IT: see it, save and test it, remove saved settings. Nothing to create, approve or export.
    ('administrator', 'integrations', 'all', true, false, true, true, false, false)
  ) AS g (role_code, module_key, scope, v, c, e, d, a, x) ON g.role_code = r.code::text
-- DO NOTHING: a grant changed on Roles & Permissions is never written over by a re-run
-- (docs/MIGRATIONS.md §9).
ON CONFLICT (role_id, module_key) DO NOTHING;

-- DOWN
DELETE FROM permission
 WHERE module_key = 'integrations'
   AND role_id IN (SELECT role_id FROM role WHERE code IN ('implementation', 'administrator'));
