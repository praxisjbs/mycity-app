-- M1 reference values and configurable operational defaults.
-- UP
INSERT INTO reference_value (domain, code, label, display_order)
VALUES
  ('attendance_status', 'present', 'Present', 10),
  ('attendance_status', 'late', 'Late', 20),
  ('attendance_status', 'absent', 'Absent', 30),
  ('attendance_status', 'leave', 'On Leave', 40),
  ('attendance_exception', 'missing_clock_out', 'Missing Clock Out', 10),
  ('attendance_exception', 'outside_worksite', 'Outside Worksite', 20),
  ('attendance_exception', 'unknown_device', 'Unknown Device', 30),
  ('leave_status', 'draft', 'Draft', 10),
  ('leave_status', 'submitted', 'Submitted', 20),
  ('leave_status', 'approved', 'Approved', 30),
  ('leave_status', 'rejected', 'Rejected', 40),
  ('notification_category', 'attendance', 'Attendance', 10),
  ('notification_category', 'leave', 'Leave', 20),
  ('notification_category', 'community', 'Community', 30)
ON CONFLICT (domain, code) DO UPDATE SET
  label = EXCLUDED.label,
  display_order = EXCLUDED.display_order,
  active = true;

INSERT INTO attendance_policy (name, grace_minutes, require_known_device, require_geofence, active)
VALUES ('Standard', 0, true, true, true)
ON CONFLICT (name) DO UPDATE SET
  require_known_device = EXCLUDED.require_known_device,
  require_geofence = EXCLUDED.require_geofence,
  active = true;

INSERT INTO home_alert_rule (key, metric, threshold, window_days, severity, permission_key, enabled)
VALUES
  ('attendance.absence', 'absence_count', 1, 1, 'high', 'people.view', true),
  ('attendance.lateness', 'late_count', 3, 30, 'medium', 'people.view', true),
  ('leave.pending', 'pending_days', 2, NULL, 'medium', 'people.approve', true)
ON CONFLICT (key) DO UPDATE SET
  metric = EXCLUDED.metric,
  threshold = EXCLUDED.threshold,
  window_days = EXCLUDED.window_days,
  severity = EXCLUDED.severity,
  permission_key = EXCLUDED.permission_key,
  enabled = true;

-- DOWN
DELETE FROM home_alert_rule WHERE key IN ('attendance.absence', 'attendance.lateness', 'leave.pending');
DELETE FROM attendance_policy WHERE name = 'Standard';
DELETE FROM reference_value WHERE domain IN ('attendance_status', 'attendance_exception', 'leave_status', 'notification_category');
