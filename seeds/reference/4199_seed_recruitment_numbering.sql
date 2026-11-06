-- M4 the application's number (APP-0001, the reference a candidate is given) and the pipeline's
-- code list as the code uses it (docs/guides/recruitment.md §4, §6.2, §6.3).
--
--   numbering_scheme  application: APP, four digits, never reset. DO NOTHING: a scheme someone has
--                     edited on Documents & Numbering is theirs.
--   reference_value   application_stage `rejected` is retired: a candidate who is not progressed
--                     keeps their stage and takes status not_progressed (candidates.js), so no row
--                     is ever at a stage called rejected.
-- UP
INSERT INTO numbering_scheme (doc_type, prefix, padding, separator, reset, include_period)
VALUES ('application', 'APP', 4, '-', 'never', false)
ON CONFLICT (doc_type) DO NOTHING;

UPDATE reference_value SET active = false WHERE domain = 'application_stage' AND code = 'rejected';

-- DOWN
UPDATE reference_value SET active = true WHERE domain = 'application_stage' AND code = 'rejected';
-- A number already issued is never taken back: once an application is numbered, its counter keeps the scheme.
DELETE FROM numbering_scheme s
 WHERE s.doc_type = 'application'
   AND NOT EXISTS (SELECT 1 FROM numbering_counter nc WHERE nc.doc_type = s.doc_type);
