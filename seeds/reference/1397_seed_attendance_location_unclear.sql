-- M1 the location_unverified exception reads Location Unclear (docs/guides/attendance.md §6.5): a
-- reading too rough, at the edge of the fence or missing proves nothing either way, so the label
-- 1390 seeded (Location Unverified) is renamed. A code list only (A26): no person, punch or place.
-- A label someone has since changed is left as it is.
-- UP
INSERT INTO reference_value (domain, code, label, display_order)
VALUES ('attendance_exception', 'location_unverified', 'Location Unclear', 25)
ON CONFLICT (domain, code) DO UPDATE SET label = EXCLUDED.label
 WHERE reference_value.label = 'Location Unverified';

-- DOWN
UPDATE reference_value SET label = 'Location Unverified'
 WHERE domain = 'attendance_exception' AND code = 'location_unverified' AND label = 'Location Unclear';
