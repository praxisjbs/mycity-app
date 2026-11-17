-- M1 leave reference data: Annual leave needs a relief officer and a handover note on every request.
--
-- TB, 17/11/2026: "for annual leave only, or any leave above 7 days" (docs/guides/ess.md §6). 1210
-- gives every type the 7 days; this sets the seeded Annual type (1290, code `annual`) to every
-- request. Which types need cover is a business choice, which A26 keeps out of reference seeds; it
-- is seeded here by TB's decision, as 1290's four types are (docs/DATABASE_SCHEMA.md §4). People
-- change it on People · Leave, so the row is changed only while it still holds 1210's default
-- (docs/MIGRATIONS.md §9): a re-run never writes over their choice.
-- UP
UPDATE leave_type
   SET handover_every_request = true
 WHERE code = 'annual' AND handover_every_request = false AND handover_over_days = 7;

-- DOWN
UPDATE leave_type
   SET handover_every_request = false
 WHERE code = 'annual' AND handover_every_request = true;
