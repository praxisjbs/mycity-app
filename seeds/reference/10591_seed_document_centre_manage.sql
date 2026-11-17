-- M10 Document Centre: who keeps the library (docs/guides/document-centre.md §8).
--
--   capability  documents.manage: the Categories tab (categories and who sees each), and seeing,
--               editing, replacing and archiving every company document, for the Implementation
--               Team, the System Administrator and Operations & People. The CEO holds every
--               capability (src/shared/access/access.catalog.js).
--
-- Given on Settings · Roles & Permissions afterwards, so DO NOTHING keeps a re-run from writing
-- over an edit (docs/MIGRATIONS.md §9).
-- UP
INSERT INTO capability (code, name, description)
VALUES
  ('documents.manage', 'Manage Documents', 'Keep the Document Centre''s categories and who sees each, and edit, replace and archive every company document.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_capability (role_id, capability_id)
SELECT r.role_id, c.capability_id
  FROM role r
  CROSS JOIN capability c
 WHERE r.code IN ('implementation', 'administrator', 'operations_people')
   AND c.code = 'documents.manage'
ON CONFLICT (role_id, capability_id) DO NOTHING;

-- DOWN
DELETE FROM role_capability
 WHERE capability_id IN (SELECT capability_id FROM capability WHERE code = 'documents.manage')
   AND role_id IN (SELECT role_id FROM role WHERE code IN ('implementation', 'administrator', 'operations_people'));
-- A capability someone has since given to a person or another role stays.
DELETE FROM capability c
 WHERE c.code = 'documents.manage'
   AND NOT EXISTS (SELECT 1 FROM user_capability uc WHERE uc.capability_id = c.capability_id)
   AND NOT EXISTS (SELECT 1 FROM role_capability rc WHERE rc.capability_id = c.capability_id);
