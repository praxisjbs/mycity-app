-- M2 Performance reference data: the capability goals.view_all (docs/guides/performance.md §6.23, §8;
-- JBS Praxis, 28/10/2026). It reads the whole organisational and company plan; the CEO holds every
-- capability, and the Implementation Team holds everything there is so training runs from the build
-- account. Management holds it by default. Edited on Settings · Roles & Permissions afterwards, so
-- inserted only when absent. A code and its holders only (A26): no goal, objective or person.
-- UP
INSERT INTO capability (code, name, description)
VALUES
  ('goals.view_all', 'View All Goals', 'Read the whole organisational and company plan: every organisational goal, company objective and key result.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_capability (role_id, capability_id)
SELECT r.role_id, c.capability_id
  FROM (VALUES
    ('management', 'goals.view_all'),
    ('implementation', 'goals.view_all')
  ) AS g (role_code, capability_code)
  JOIN role r ON r.code = g.role_code
  JOIN capability c ON c.code = g.capability_code
ON CONFLICT (role_id, capability_id) DO NOTHING;

-- DOWN
DELETE FROM role_capability rc
 USING role r, capability c,
       (VALUES
         ('management', 'goals.view_all'),
         ('implementation', 'goals.view_all')
       ) AS g (role_code, capability_code)
 WHERE rc.role_id = r.role_id AND rc.capability_id = c.capability_id
   AND r.code = g.role_code AND c.code = g.capability_code;
-- A capability someone has since given to a person or another role stays: deleting it would cascade
-- into their choice.
DELETE FROM capability c
 WHERE c.code = 'goals.view_all'
   AND NOT EXISTS (SELECT 1 FROM user_capability uc WHERE uc.capability_id = c.capability_id)
   AND NOT EXISTS (SELECT 1 FROM role_capability rc WHERE rc.capability_id = c.capability_id);
