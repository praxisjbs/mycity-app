-- Nigeria's public holidays for 2026 and 2027 (TB, 17/10/2026). A26 keeps business choices out of
-- reference seeds; a holiday set by law is not one, so these are seeded in every environment.
--
--   declared   the days the Public Holidays Act fixes: New Year's Day, Good Friday, Easter Monday,
--              Workers' Day, Democracy Day, Independence Day, Christmas Day and Boxing Day
--   expected   the days the Federal Government names only shortly before: Eid-el-Fitr and
--              Eid-el-Kabir (the day and the next working day), Eid-el-Maulud, and the working day
--              given for a holiday that falls on a weekend. Their dates follow the Umm al-Qura
--              calendar; someone confirms or moves each on Settings · Organisation when it is
--              announced (migration 0410)
--
-- A holiday is edited on screen afterwards, so each row is inserted only when its date is free
-- (docs/MIGRATIONS.md §9): a re-run never overwrites a holiday someone entered, moved or confirmed.
-- UP
INSERT INTO public_holiday (holiday_date, name, expected)
VALUES
  ('2026-01-01', 'New Year''s Day', false),
  ('2026-03-20', 'Eid-el-Fitr', true),
  ('2026-03-23', 'Eid-el-Fitr Holiday', true),
  ('2026-04-03', 'Good Friday', false),
  ('2026-04-06', 'Easter Monday', false),
  ('2026-05-01', 'Workers'' Day', false),
  ('2026-05-27', 'Eid-el-Kabir', true),
  ('2026-05-28', 'Eid-el-Kabir Holiday', true),
  ('2026-06-12', 'Democracy Day', false),
  ('2026-08-25', 'Eid-el-Maulud', true),
  ('2026-10-01', 'Independence Day', false),
  ('2026-12-25', 'Christmas Day', false),
  ('2026-12-26', 'Boxing Day', false),
  ('2026-12-28', 'Boxing Day Holiday', true),
  ('2027-01-01', 'New Year''s Day', false),
  ('2027-03-09', 'Eid-el-Fitr', true),
  ('2027-03-10', 'Eid-el-Fitr Holiday', true),
  ('2027-03-26', 'Good Friday', false),
  ('2027-03-29', 'Easter Monday', false),
  ('2027-05-01', 'Workers'' Day', false),
  ('2027-05-03', 'Workers'' Day Holiday', true),
  ('2027-05-16', 'Eid-el-Kabir', true),
  ('2027-05-17', 'Eid-el-Kabir Holiday', true),
  ('2027-05-18', 'Eid-el-Kabir Holiday', true),
  ('2027-06-12', 'Democracy Day', false),
  ('2027-06-14', 'Democracy Day Holiday', true),
  ('2027-08-14', 'Eid-el-Maulud', true),
  ('2027-08-16', 'Eid-el-Maulud Holiday', true),
  ('2027-10-01', 'Independence Day', false),
  ('2027-12-25', 'Christmas Day', false),
  ('2027-12-26', 'Boxing Day', false),
  ('2027-12-27', 'Christmas Day Holiday', true),
  ('2027-12-28', 'Boxing Day Holiday', true)
ON CONFLICT (holiday_date) DO NOTHING;

-- DOWN
DELETE FROM public_holiday
 WHERE (holiday_date, name) IN (VALUES
  ('2026-01-01'::date, 'New Year''s Day'),
  ('2026-03-20'::date, 'Eid-el-Fitr'),
  ('2026-03-23'::date, 'Eid-el-Fitr Holiday'),
  ('2026-04-03'::date, 'Good Friday'),
  ('2026-04-06'::date, 'Easter Monday'),
  ('2026-05-01'::date, 'Workers'' Day'),
  ('2026-05-27'::date, 'Eid-el-Kabir'),
  ('2026-05-28'::date, 'Eid-el-Kabir Holiday'),
  ('2026-06-12'::date, 'Democracy Day'),
  ('2026-08-25'::date, 'Eid-el-Maulud'),
  ('2026-10-01'::date, 'Independence Day'),
  ('2026-12-25'::date, 'Christmas Day'),
  ('2026-12-26'::date, 'Boxing Day'),
  ('2026-12-28'::date, 'Boxing Day Holiday'),
  ('2027-01-01'::date, 'New Year''s Day'),
  ('2027-03-09'::date, 'Eid-el-Fitr'),
  ('2027-03-10'::date, 'Eid-el-Fitr Holiday'),
  ('2027-03-26'::date, 'Good Friday'),
  ('2027-03-29'::date, 'Easter Monday'),
  ('2027-05-01'::date, 'Workers'' Day'),
  ('2027-05-03'::date, 'Workers'' Day Holiday'),
  ('2027-05-16'::date, 'Eid-el-Kabir'),
  ('2027-05-17'::date, 'Eid-el-Kabir Holiday'),
  ('2027-05-18'::date, 'Eid-el-Kabir Holiday'),
  ('2027-06-12'::date, 'Democracy Day'),
  ('2027-06-14'::date, 'Democracy Day Holiday'),
  ('2027-08-14'::date, 'Eid-el-Maulud'),
  ('2027-08-16'::date, 'Eid-el-Maulud Holiday'),
  ('2027-10-01'::date, 'Independence Day'),
  ('2027-12-25'::date, 'Christmas Day'),
  ('2027-12-26'::date, 'Boxing Day'),
  ('2027-12-27'::date, 'Christmas Day Holiday'),
  ('2027-12-28'::date, 'Boxing Day Holiday')
 );
