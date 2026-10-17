-- M1 the attendance exception types the clock-in code raises beyond 1099's three
-- (docs/guides/attendance.md §6.5, §6.4): a reading that could not prove where the person was,
-- and a device clock implausibly ahead of the server. Code lists only (A26): no policy, person,
-- device, holiday or coordinate.
-- UP
INSERT INTO reference_value (domain, code, label, display_order)
VALUES
  ('attendance_exception', 'location_unverified', 'Location Unverified', 25),
  ('attendance_exception', 'suspicious_timestamp', 'Device Time Ahead', 40)
ON CONFLICT (domain, code) DO NOTHING;

-- DOWN
DELETE FROM reference_value
 WHERE domain = 'attendance_exception' AND code IN ('location_unverified', 'suspicious_timestamp');
