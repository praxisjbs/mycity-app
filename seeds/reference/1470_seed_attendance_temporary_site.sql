-- M1 temporary sites' reference data (docs/guides/attendance.md §6.11). Codes and settings only
-- (A26): no site, person or place. The purposes are the contract's enum, not seeded.
--
--   numbering   temporary_site, a site's number: TS-0001, never reset
--               (src/shared/numbering/schemes.js).
--   approval    version 1 of attendance.temporary_site: Operations & People, 48 hours; the same
--               definition as DEFAULTS in shared/workflow/definitions.js, which passes
--               validateDefinition() (MIGRATIONS §9).
--
-- Both are edited on Settings afterwards (Documents & Numbering, Approvals); a save there writes a
-- new row or version, so DO NOTHING keeps a re-run harmless.
-- UP
INSERT INTO numbering_scheme (doc_type, prefix, padding, separator, reset, include_period)
VALUES ('temporary_site', 'TS', 4, '-', 'never', false)
ON CONFLICT (doc_type) DO NOTHING;

INSERT INTO workflow_definition (key, version, module_key, name, description, context_types, stages, active)
VALUES (
  'attendance.temporary_site', 1, 'people', 'Temporary Site',
  'Operations & People approve where people work for some days.',
  '{"days":"number"}'::jsonb,
  '[{"key":"operations_people","name":"Operations & People","approver":{"type":"role","value":"operations_people"},"sla_hours":48}]'::jsonb,
  true
)
ON CONFLICT (key, version) DO NOTHING;

-- DOWN
-- Version 1 only, and only while no site was opened on it: a site keeps the version it started on.
-- A number already issued is never taken back: once a site is numbered, its counter keeps the scheme.
DELETE FROM workflow_definition d
 WHERE d.key = 'attendance.temporary_site' AND d.version = 1
   AND NOT EXISTS (SELECT 1 FROM workflow_instance i WHERE i.workflow_definition_id = d.workflow_definition_id);
DELETE FROM numbering_scheme s
 WHERE s.doc_type = 'temporary_site'
   AND NOT EXISTS (SELECT 1 FROM numbering_counter nc WHERE nc.doc_type = s.doc_type);
