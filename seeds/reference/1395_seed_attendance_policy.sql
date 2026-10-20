-- M1 attendance policy: 1099's Standard policy moves out (A26; docs/guides/attendance.md §4, §6.15).
--
-- A policy is MyCity's business choice, set on Settings · Attendance Policy and published there as
-- a version (A26, DATABASE_SCHEMA §5.3). 1099 seeded one called Standard. It goes only while it is
-- exactly as 1099 and 1300 to 1370 left it and nothing was judged by it or points at it: a database
-- whose punches name it keeps it, and it applies there until MyCity's first version starts.
-- Reference data only: no policy, person or punch is written.
-- UP
-- DESTRUCTIVE: removes 1099's seeded Standard policy (A26); one that was changed, or that a punch or a person points at, is kept.
DELETE FROM attendance_policy p
 WHERE p.name = 'Standard'
   AND p.status = 'published'
   AND p.version IS NULL
   AND p.active
   AND p.grace_minutes = 0
   AND p.earliest_clock_in_minutes = 120
   AND p.latest_clock_out_minutes = 240
   AND p.require_known_device
   AND p.require_geofence
   AND p.geofence_mode = 'warn'
   AND p.office_geofence_mode = 'warn'
   AND p.home_geofence_mode = 'warn'
   AND p.site_geofence_mode = 'warn'
   AND p.device_mode = 'off'
   AND p.max_accuracy_m = 100
   AND p.home_radius_m = 100
   AND NOT EXISTS (SELECT 1 FROM attendance_event e WHERE e.attendance_policy_id = p.attendance_policy_id)
   AND NOT EXISTS (SELECT 1 FROM employee_attendance_policy ea WHERE ea.attendance_policy_id = p.attendance_policy_id)
   AND NOT EXISTS (SELECT 1 FROM attendance_policy_acknowledgement a WHERE a.attendance_policy_id = p.attendance_policy_id);

-- DOWN
-- The Standard policy as 1099 left it, unless a policy holds the name now.
INSERT INTO attendance_policy (name, grace_minutes, require_known_device, require_geofence, active)
VALUES ('Standard', 0, true, true, true)
ON CONFLICT (name) DO NOTHING;
