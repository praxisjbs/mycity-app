-- M0 defaults for field visibility and capabilities (docs/guides/foundation.md §6.3, TB 16/10/2026).
--
--   field visibility  salary, bank, personal details, and tax and pension numbers are visible to
--                     Operations & People, Management and the Implementation Team, and masked for
--                     every other role. The CEO is never masked; everyone sees their own record.
--   capabilities      posting an announcement and clearing an alert, held by the same three roles
--                     (and the CEO, who holds every authority).
--
-- Each row is edited on Settings, Roles & Permissions afterwards, so it is inserted only when absent
-- (docs/MIGRATIONS.md §9): a re-run never overwrites what a person chose. Reference data only: the
-- codes the code switches on and the roles of 0290, no people.
-- UP
INSERT INTO field_visibility (role_id, field_key, visibility)
SELECT r.role_id, f.field_key,
       CASE WHEN r.code IN ('implementation', 'operations_people', 'management') THEN 'visible' ELSE 'masked' END
  FROM role r
  CROSS JOIN (VALUES ('employee.salary'), ('employee.bank'), ('employee.personal'), ('employee.statutory'))
    AS f (field_key)
 WHERE r.code IN ('implementation', 'operations_people', 'management', 'head_of_department', 'administrator', 'manager', 'employee')
ON CONFLICT (role_id, field_key) DO NOTHING;

INSERT INTO capability (code, name, description)
VALUES
  ('announcements.post', 'Post Announcements', 'Post to the announcements channel and track who has read a post.'),
  ('alerts.clear', 'Clear Alerts', 'Clear or dismiss an alert on Home.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_capability (role_id, capability_id)
SELECT r.role_id, c.capability_id
  FROM role r
  CROSS JOIN capability c
 WHERE r.code IN ('implementation', 'operations_people', 'management')
   AND c.code IN ('announcements.post', 'alerts.clear')
ON CONFLICT (role_id, capability_id) DO NOTHING;

-- DOWN
DELETE FROM role_capability
 WHERE capability_id IN (SELECT capability_id FROM capability WHERE code IN ('announcements.post', 'alerts.clear'))
   AND role_id IN (SELECT role_id FROM role WHERE code IN ('implementation', 'operations_people', 'management'));
-- A capability someone has since given to a person or another role stays: deleting it would cascade
-- into their choice.
DELETE FROM capability c
 WHERE c.code IN ('announcements.post', 'alerts.clear')
   AND NOT EXISTS (SELECT 1 FROM user_capability uc WHERE uc.capability_id = c.capability_id)
   AND NOT EXISTS (SELECT 1 FROM role_capability rc WHERE rc.capability_id = c.capability_id);
DELETE FROM field_visibility
 WHERE field_key IN ('employee.salary', 'employee.bank', 'employee.personal', 'employee.statutory')
   AND role_id IN (SELECT role_id FROM role WHERE code IN (
     'implementation', 'operations_people', 'management', 'head_of_department', 'administrator', 'manager', 'employee'
   ));
