-- M2 Performance: the numbering scheme for an organisational goal's ID (docs/guides/performance.md
-- §6.1; JBS Praxis, 27/10/2026). Codes and settings only (A26): no goal.
--
--   organisational_goal   ORG-2026-01: the plan year and two digits, starting again each year
--                         (src/shared/numbering/schemes.js). The service numbers a goal by its plan
--                         year's first day, so a 2027 goal recorded in December reads ORG-2027-01.
--
-- Settings · Documents & Numbering edits the row afterwards; DO NOTHING keeps a re-run from writing
-- over that edit.
-- UP
INSERT INTO numbering_scheme (doc_type, prefix, padding, separator, reset, include_period)
VALUES ('organisational_goal', 'ORG', 2, '-', 'yearly', true)
ON CONFLICT (doc_type) DO NOTHING;

-- DOWN
-- A number already issued is never taken back: once a goal is numbered, its counter keeps the scheme.
DELETE FROM numbering_scheme s
 WHERE s.doc_type = 'organisational_goal'
   AND NOT EXISTS (SELECT 1 FROM numbering_counter nc WHERE nc.doc_type = s.doc_type);
