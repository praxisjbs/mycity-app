-- M1, for attendance's temporary sites: the employees an approval excludes from deciding it
-- (docs/guides/foundation.md §6.5, docs/guides/attendance.md §6.11).
--
--   workflow_instance.excluded_employee_ids  set by the module that opens the approval
--                                            (openInstance's exclude_employee_ids): they never
--                                            decide any of its stages, whatever role they hold, and
--                                            the stage's notice skips them. A temporary site
--                                            excludes everyone on it; every other approval is empty.
-- UP
ALTER TABLE workflow_instance ADD COLUMN IF NOT EXISTS excluded_employee_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

-- DOWN
ALTER TABLE workflow_instance DROP COLUMN IF EXISTS excluded_employee_ids;
