-- M10 Document Centre: who may open it (docs/guides/document-centre.md §8).
--
-- Everyone opens the Library. The grant opens the screen and never a file: each document is listed
-- only for a reader the vault would let open it from its own module (§6.3), so the scope here is
-- `all` for every role and narrows nothing.
--
-- Create and edit are for the people who upload the company's own documents (PR 2 of the guide's
-- build plan): the heads and those who run the company. Delete, which archives one, is for those
-- who keep the library. The CEO needs no grant: the CEO passes every permission check
-- (src/middleware/rbac.js).
-- UP
INSERT INTO permission (role_id, module_key, scope, can_view, can_create, can_edit, can_delete, can_approve, can_export)
SELECT r.role_id, g.module_key, g.scope, g.v, g.c, g.e, g.d, g.a, g.x
  FROM role r
  JOIN (VALUES
    -- The build team, until handover: everything, as they hold everywhere else.
    ('implementation', 'documents', 'all', true, true, true, true, true, true),
    -- Those who keep the library: upload, edit and archive.
    ('operations_people', 'documents', 'all', true, true, true, true, false, false),
    ('administrator', 'documents', 'all', true, true, true, true, false, false),
    -- Those who add their own area's company documents.
    ('management', 'documents', 'all', true, true, true, false, false, false),
    ('head_of_department', 'documents', 'all', true, true, true, false, false, false),
    -- Everyone else finds, previews and downloads.
    ('manager', 'documents', 'all', true, false, false, false, false, false),
    ('employee', 'documents', 'all', true, false, false, false, false, false)
  ) AS g (role_code, module_key, scope, v, c, e, d, a, x) ON g.role_code = r.code::text
-- DO NOTHING: a grant changed on Roles & Permissions is never written over by a re-run
-- (docs/MIGRATIONS.md §9).
ON CONFLICT (role_id, module_key) DO NOTHING;

-- DOWN
DELETE FROM permission
 WHERE module_key = 'documents'
   AND role_id IN (SELECT role_id FROM role WHERE code IN
     ('implementation', 'operations_people', 'administrator', 'management', 'head_of_department', 'manager', 'employee'));
