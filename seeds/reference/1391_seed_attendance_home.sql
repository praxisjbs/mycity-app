-- M1 the attendance exception type a remote punch beyond its approved home raises
-- (docs/guides/attendance.md §6.5, §6.10). A code list only (A26): no home, person or coordinate.
-- UP
INSERT INTO reference_value (domain, code, label, display_order)
VALUES ('attendance_exception', 'outside_home', 'Outside Home', 22)
ON CONFLICT (domain, code) DO NOTHING;

-- DOWN
DELETE FROM reference_value WHERE domain = 'attendance_exception' AND code = 'outside_home';
