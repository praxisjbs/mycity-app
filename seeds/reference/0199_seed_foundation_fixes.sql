-- M0 reference data corrected to the contract and the decisions (A22, A26).
--
--   work_pattern     the contract's on_site, not onsite (organisation.js WORK_PATTERNS)
--   employment_type  the contract's EMPLOYMENT_TYPES; the code list had none
--   gender           the values employee_gender_check allows (0110)
--   working week     Saturday 09:00 to 15:00 is a working day (A22); 0099 seeded it off
--   staff number     MyCity's own five-digit IDs, no prefix (00001), decided with TB 16/10/2026
--
-- The working week and the numbering scheme are edited in Settings, so each is replaced only
-- while it still holds the value 0099 seeded (docs/MIGRATIONS.md §9).
-- UP
-- DESTRUCTIVE: the misspelt 'onsite' code goes; no employee can hold it (employee_work_pattern_check, 0110).
DELETE FROM reference_value WHERE domain = 'work_pattern' AND code = 'onsite';

INSERT INTO reference_value (domain, code, label, display_order)
VALUES
  ('work_pattern', 'on_site', 'On-site', 10),
  ('employment_type', 'full_time', 'Full Time', 10),
  ('employment_type', 'part_time', 'Part Time', 20),
  ('employment_type', 'contractor', 'Contractor', 30),
  ('employment_type', 'consultant', 'Consultant', 40),
  ('employment_type', 'intern', 'Intern', 50),
  ('gender', 'female', 'Female', 10),
  ('gender', 'male', 'Male', 20)
ON CONFLICT (domain, code) DO NOTHING;

INSERT INTO working_week (weekday, is_working_day, starts_at, ends_at)
VALUES (6, true, '09:00', '15:00')
ON CONFLICT (weekday) DO UPDATE SET
  is_working_day = EXCLUDED.is_working_day,
  starts_at = EXCLUDED.starts_at,
  ends_at = EXCLUDED.ends_at
WHERE working_week.is_working_day = false AND working_week.starts_at IS NULL;

INSERT INTO numbering_scheme (doc_type, prefix, padding, separator, reset, include_period)
VALUES ('employee', '', 5, '', 'never', false)
ON CONFLICT (doc_type) DO UPDATE SET
  prefix = EXCLUDED.prefix,
  padding = EXCLUDED.padding,
  separator = EXCLUDED.separator
WHERE numbering_scheme.prefix = 'MCA' AND numbering_scheme.padding = 4 AND numbering_scheme.separator = '-';

-- DOWN
UPDATE numbering_scheme SET prefix = 'MCA', padding = 4, separator = '-'
WHERE doc_type = 'employee' AND prefix = '' AND padding = 5 AND separator = '';

UPDATE working_week SET is_working_day = false, starts_at = NULL, ends_at = NULL
WHERE weekday = 6 AND is_working_day = true AND starts_at = '09:00' AND ends_at = '15:00';

DELETE FROM reference_value WHERE domain IN ('employment_type', 'gender');
DELETE FROM reference_value WHERE domain = 'work_pattern' AND code = 'on_site';

INSERT INTO reference_value (domain, code, label, display_order)
VALUES ('work_pattern', 'onsite', 'On-site', 10)
ON CONFLICT (domain, code) DO NOTHING;
