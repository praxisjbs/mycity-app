-- M10 Knowledge Hub's reference data: SOPs and Training (docs/guides/knowledge.md §4, §8). Codes and
-- settings only (A26): no SOP, course, department or person.
--
--   numbering   sop, an SOP's number: SOP-0001, never reset; training_course, a course's: TRN-0001,
--               never reset; training_certificate, a certificate's: CERT-2026-0001, by year
--               (src/shared/numbering/schemes.js).
--   capability  sops.manage (write, publish and archive any department's SOPs; a department's head
--               writes its own without it) and training.manage (build, publish, assign and archive
--               courses, and see everyone's progress), for Operations & People and the Implementation
--               Team; the CEO holds every capability (src/shared/access/access.catalog.js).
--
-- Each is edited on Settings afterwards (Documents & Numbering, Roles & Permissions), so DO NOTHING
-- keeps a re-run from writing over an edit.
-- UP
INSERT INTO numbering_scheme (doc_type, prefix, padding, separator, reset, include_period)
VALUES
  ('sop', 'SOP', 4, '-', 'never', false),
  ('training_course', 'TRN', 4, '-', 'never', false),
  ('training_certificate', 'CERT', 4, '-', 'yearly', true)
ON CONFLICT (doc_type) DO NOTHING;

INSERT INTO capability (code, name, description)
VALUES
  ('sops.manage', 'Manage SOPs', 'Write, publish and archive any department''s SOPs.'),
  ('training.manage', 'Manage Training', 'Build, publish, assign and archive courses, and see everyone''s progress and certificates.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_capability (role_id, capability_id)
SELECT r.role_id, c.capability_id
  FROM role r
  CROSS JOIN capability c
 WHERE r.code IN ('implementation', 'operations_people')
   AND c.code IN ('sops.manage', 'training.manage')
ON CONFLICT (role_id, capability_id) DO NOTHING;

-- DOWN
DELETE FROM role_capability
 WHERE capability_id IN (SELECT capability_id FROM capability WHERE code IN ('sops.manage', 'training.manage'))
   AND role_id IN (SELECT role_id FROM role WHERE code IN ('implementation', 'operations_people'));
-- A capability someone has since given to a person or another role stays.
DELETE FROM capability c
 WHERE c.code IN ('sops.manage', 'training.manage')
   AND NOT EXISTS (SELECT 1 FROM user_capability uc WHERE uc.capability_id = c.capability_id)
   AND NOT EXISTS (SELECT 1 FROM role_capability rc WHERE rc.capability_id = c.capability_id);
DELETE FROM numbering_scheme s
 WHERE s.doc_type IN ('sop', 'training_course', 'training_certificate')
   AND NOT EXISTS (SELECT 1 FROM numbering_counter nc WHERE nc.doc_type = s.doc_type);
