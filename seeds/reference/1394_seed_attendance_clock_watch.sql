-- M1 the attendance exception type an explained automatic clock-out opens
-- (docs/guides/attendance.md §6.8, §6.14). A code list only (A26): no person, punch or time.
-- UP
INSERT INTO reference_value (domain, code, label, display_order)
VALUES ('attendance_exception', 'automatic_clock_out', 'Automatic Clock-Out', 12)
ON CONFLICT (domain, code) DO NOTHING;

-- DOWN
DELETE FROM reference_value WHERE domain = 'attendance_exception' AND code = 'automatic_clock_out';
