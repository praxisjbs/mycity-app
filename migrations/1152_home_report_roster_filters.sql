-- M1 Home · Reports: Daily Attendance's one status becomes a list of statuses, beside the day it reads (home.md §6 Reports).
-- UP

-- A saved report's single status becomes a list of one; with no day it reads today, as before.
UPDATE saved_report
   SET definition = jsonb_set(
         definition #- '{filters,roster_status}',
         '{filters,roster_statuses}',
         jsonb_build_array(definition #> '{filters,roster_status}'))
 WHERE definition #> '{filters,roster_status}' IS NOT NULL;

-- DOWN

-- A report keeps the first of its statuses, and reads today again.
UPDATE saved_report
   SET definition = jsonb_set(
         definition #- '{filters,roster_statuses}',
         '{filters,roster_status}',
         definition #> '{filters,roster_statuses,0}')
 WHERE definition #> '{filters,roster_statuses,0}' IS NOT NULL;
UPDATE saved_report
   SET definition = definition #- '{filters,roster_day}'
 WHERE definition #> '{filters,roster_day}' IS NOT NULL;
