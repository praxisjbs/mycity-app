-- M1 Home reference data: the capabilities behind Home's managers' tabs, report run numbering, and 1099's alert thresholds moved out (home.md §8, TB 17/10/2026).
--
--   capabilities  home.team (the Team tab) and home.reports (build, schedule, run and receive
--                 reports), held by Implementation, Operations & People, Management, Heads of
--                 Department and Managers; alerts.manage (create and edit alert rules), held by the
--                 first three. Heads of Department and Managers also gain alerts.clear (0449), so they
--                 clear their own team's alerts where the rule's permission reaches them. The CEO
--                 holds every capability without a grant.
--   numbering     report_run, a report run's number: RPT-0001, never reset
--                 (src/shared/numbering/schemes.js).
--   alert rules   1099 seeded three thresholds. A threshold is MyCity's business choice (A26), entered
--                 on Home, Alerts, so the three go: each only while it is exactly as 1099 left it and
--                 no alert points at it. A rule someone has changed, or one with alerts, stays theirs.
--
-- Capabilities, grants and the numbering scheme are edited on Settings afterwards, so each is
-- inserted only when absent (docs/MIGRATIONS.md §9): a re-run never overwrites what a person chose.
-- Reference data only: codes the code switches on and the roles of 0290, no people.
-- UP
INSERT INTO capability (code, name, description)
VALUES
  ('home.team', 'View Team', 'Open the Team tab on Home: who is in today and the team''s figures.'),
  ('home.reports', 'Run Reports', 'Build, schedule and run reports on Home, and receive them.'),
  ('alerts.manage', 'Manage Alert Rules', 'Create, change and switch off the rules that raise alerts on Home.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_capability (role_id, capability_id)
SELECT r.role_id, c.capability_id
  FROM role r
  CROSS JOIN capability c
 WHERE (c.code IN ('home.team', 'home.reports')
        AND r.code IN ('implementation', 'operations_people', 'management', 'head_of_department', 'manager'))
    OR (c.code = 'alerts.manage' AND r.code IN ('implementation', 'operations_people', 'management'))
    OR (c.code = 'alerts.clear' AND r.code IN ('head_of_department', 'manager'))
ON CONFLICT (role_id, capability_id) DO NOTHING;

INSERT INTO numbering_scheme (doc_type, prefix, padding, separator, reset, include_period)
VALUES ('report_run', 'RPT', 4, '-', 'never', false)
ON CONFLICT (doc_type) DO NOTHING;

-- Untouched means every value as 1099 wrote it, still switched on, still named after its key (1150)
-- and never saved by anyone on Home (no author).
-- DESTRUCTIVE: removes 1099's seeded alert thresholds (A26); an edited rule, or one an alert points at, is kept.
DELETE FROM home_alert_rule r
 USING (VALUES
          ('attendance.absence', 'absence_count', 1, 1, 'high', 'people.view'),
          ('attendance.lateness', 'late_count', 3, 30, 'medium', 'people.view'),
          ('leave.pending', 'pending_days', 2, NULL, 'medium', 'people.approve')
       ) AS seeded (key, metric, threshold, window_days, severity, permission_key)
 WHERE r.key = seeded.key::citext
   AND r.metric = seeded.metric
   AND r.threshold = seeded.threshold
   AND r.window_days IS NOT DISTINCT FROM seeded.window_days
   AND r.severity = seeded.severity
   AND r.permission_key = seeded.permission_key
   AND r.enabled
   AND r.name = r.key::text
   AND r.created_by IS NULL
   AND r.updated_by IS NULL
   AND NOT EXISTS (SELECT 1 FROM home_alert a WHERE a.home_alert_rule_id = r.home_alert_rule_id);

-- DOWN
-- The three thresholds as 1099 left them, unless a rule holds the key now.
INSERT INTO home_alert_rule (key, name, metric, threshold, window_days, severity, permission_key, enabled)
VALUES
  ('attendance.absence', 'attendance.absence', 'absence_count', 1, 1, 'high', 'people.view', true),
  ('attendance.lateness', 'attendance.lateness', 'late_count', 3, 30, 'medium', 'people.view', true),
  ('leave.pending', 'leave.pending', 'pending_days', 2, NULL, 'medium', 'people.approve', true)
ON CONFLICT (key) DO NOTHING;
-- A number already issued is never taken back: once a run is numbered, its counter keeps the scheme.
DELETE FROM numbering_scheme s
 WHERE s.doc_type = 'report_run'
   AND NOT EXISTS (SELECT 1 FROM numbering_counter nc WHERE nc.doc_type = s.doc_type);
DELETE FROM role_capability rc
 USING role r, capability c
 WHERE r.role_id = rc.role_id
   AND c.capability_id = rc.capability_id
   -- Only rows a seed wrote: a grant made on Settings, Roles & Permissions records who made it, so a
   -- role given alerts.clear there before this seed ran keeps it.
   AND rc.granted_by IS NULL
   AND ((c.code IN ('home.team', 'home.reports')
         AND r.code IN ('implementation', 'operations_people', 'management', 'head_of_department', 'manager'))
     OR (c.code = 'alerts.manage' AND r.code IN ('implementation', 'operations_people', 'management'))
     OR (c.code = 'alerts.clear' AND r.code IN ('head_of_department', 'manager')));
-- A capability someone has since given to a person or another role stays: deleting it would cascade
-- into their choice.
DELETE FROM capability c
 WHERE c.code IN ('home.team', 'home.reports', 'alerts.manage')
   AND NOT EXISTS (SELECT 1 FROM user_capability uc WHERE uc.capability_id = c.capability_id)
   AND NOT EXISTS (SELECT 1 FROM role_capability rc WHERE rc.capability_id = c.capability_id);
