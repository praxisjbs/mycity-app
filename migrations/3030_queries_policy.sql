-- M3 the policy a query rule enforces and a query cites (docs/guides/queries.md §6.2, §6.3).
--
--   query_rule      + policy_id, policy_clause: the Knowledge Hub policy the rule enforces, and the
--                     line its letters quote (People's choice, written on Rules)
--   employee_query  + policy_version_id, policy_clause: the version in force the day it was raised,
--                     so the letter and the record always name what was in force then
--
-- RESTRICT: a policy is archived, never deleted, and a version is never deleted once published.
-- UP
ALTER TABLE query_rule ADD COLUMN IF NOT EXISTS policy_id uuid REFERENCES policy(policy_id) ON DELETE RESTRICT;
ALTER TABLE query_rule ADD COLUMN IF NOT EXISTS policy_clause text CHECK (policy_clause IS NULL OR char_length(policy_clause) <= 300);
CREATE INDEX IF NOT EXISTS query_rule_policy_idx ON query_rule (policy_id);

ALTER TABLE employee_query ADD COLUMN IF NOT EXISTS policy_version_id uuid REFERENCES policy_version(policy_version_id) ON DELETE RESTRICT;
ALTER TABLE employee_query ADD COLUMN IF NOT EXISTS policy_clause text CHECK (policy_clause IS NULL OR char_length(policy_clause) <= 300);
CREATE INDEX IF NOT EXISTS employee_query_policy_version_idx ON employee_query (policy_version_id);

-- DOWN
DROP INDEX IF EXISTS employee_query_policy_version_idx;
ALTER TABLE employee_query DROP COLUMN IF EXISTS policy_clause;
ALTER TABLE employee_query DROP COLUMN IF EXISTS policy_version_id;
DROP INDEX IF EXISTS query_rule_policy_idx;
ALTER TABLE query_rule DROP COLUMN IF EXISTS policy_clause;
ALTER TABLE query_rule DROP COLUMN IF EXISTS policy_id;
