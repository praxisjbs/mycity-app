-- M2 Performance reference data: Operations & People read, share and edit the whole plan
-- (docs/guides/performance.md P27, §6.25, §8; JBS Praxis, 28/10/2026). They are given goals.view_all,
-- goals.company and goals.organisation, which Management and the Implementation Team hold in the same
-- way; the CEO holds every capability, and General Management holds the three through its department
-- (shared/rbac/grants-cache.js). Edited on Settings · Roles & Permissions afterwards, so inserted only
-- when absent. A role's holdings only (A26): no goal, objective or person.
-- UP
INSERT INTO role_capability (role_id, capability_id)
SELECT r.role_id, c.capability_id
  FROM (VALUES
    ('operations_people', 'goals.view_all'),
    ('operations_people', 'goals.company'),
    ('operations_people', 'goals.organisation')
  ) AS g (role_code, capability_code)
  JOIN role r ON r.code = g.role_code
  JOIN capability c ON c.code = g.capability_code
ON CONFLICT (role_id, capability_id) DO NOTHING;

-- DOWN
DELETE FROM role_capability rc
 USING role r, capability c,
       (VALUES
         ('operations_people', 'goals.view_all'),
         ('operations_people', 'goals.company'),
         ('operations_people', 'goals.organisation')
       ) AS g (role_code, capability_code)
 WHERE rc.role_id = r.role_id AND rc.capability_id = c.capability_id
   AND r.code = g.role_code AND c.code = g.capability_code;
