-- M1 field assignments' reference data (docs/guides/attendance.md §6.12). Codes and settings only
-- (A26): no assignment, person or site.
--
--   numbering   field_assignment, an assignment's number: FA-0001, never reset
--               (src/shared/numbering/schemes.js).
--
-- Edited on Settings afterwards (Documents & Numbering); a save there writes the row, so DO NOTHING
-- keeps a re-run harmless.
-- UP
INSERT INTO numbering_scheme (doc_type, prefix, padding, separator, reset, include_period)
VALUES ('field_assignment', 'FA', 4, '-', 'never', false)
ON CONFLICT (doc_type) DO NOTHING;

-- DOWN
-- A number already issued is never taken back: once an assignment is numbered, its counter keeps
-- the scheme.
DELETE FROM numbering_scheme s
 WHERE s.doc_type = 'field_assignment'
   AND NOT EXISTS (SELECT 1 FROM numbering_counter nc WHERE nc.doc_type = s.doc_type);
