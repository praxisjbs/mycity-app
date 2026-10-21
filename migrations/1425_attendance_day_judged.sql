-- M1 a day judged once, and its early departure (docs/guides/attendance.md §4, §6.4; TB's decisions
-- of 20/10/2026, T2, T5).
--
--   attendance_day.early_minutes                 the minutes the person's own last clock-out came
--                                                before the shift's end, once past the policy's
--                                                early grace (0 otherwise)
--   attendance_day.policy_version_id             the Attendance policy version that judged the day:
--                                                the one its first clock-in was judged by, or for a
--                                                day with none the one in force on its date when the
--                                                day-close closed it; null for the type's defaults
--   attendance_day.attendance_work_schedule_id   the person's work schedule in force on the date,
--                                                null for the company hours
--   attendance_day.shift_working, shift_starts_at, shift_ends_at
--                                                the shift the day was judged against
--   attendance_day.judged_at                     when those were recorded; once set, a recalculation
--                                                (a decision, the day-close, a system clock-out)
--                                                reads them, never a newer version or schedule
--
-- A day recorded before this file has no judgement yet: its next recalculation records one, from
-- its first clock-in's version and the schedule then in force.
-- UP
ALTER TABLE attendance_day ADD COLUMN IF NOT EXISTS early_minutes integer NOT NULL DEFAULT 0;
ALTER TABLE attendance_day ADD COLUMN IF NOT EXISTS policy_version_id uuid
  REFERENCES policy_version(policy_version_id) ON DELETE RESTRICT;
ALTER TABLE attendance_day ADD COLUMN IF NOT EXISTS attendance_work_schedule_id uuid
  REFERENCES attendance_work_schedule(attendance_work_schedule_id) ON DELETE RESTRICT;
ALTER TABLE attendance_day ADD COLUMN IF NOT EXISTS shift_working boolean;
ALTER TABLE attendance_day ADD COLUMN IF NOT EXISTS shift_starts_at time;
ALTER TABLE attendance_day ADD COLUMN IF NOT EXISTS shift_ends_at time;
ALTER TABLE attendance_day ADD COLUMN IF NOT EXISTS judged_at timestamptz;
CREATE INDEX IF NOT EXISTS attendance_day_policy_version_fk_idx ON attendance_day (policy_version_id);
CREATE INDEX IF NOT EXISTS attendance_day_work_schedule_fk_idx ON attendance_day (attendance_work_schedule_id);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_day_early_minutes_check') THEN
    ALTER TABLE attendance_day ADD CONSTRAINT attendance_day_early_minutes_check CHECK (early_minutes >= 0);
  END IF;
END;
$$;

-- DOWN
ALTER TABLE attendance_day DROP CONSTRAINT IF EXISTS attendance_day_early_minutes_check;
DROP INDEX IF EXISTS attendance_day_work_schedule_fk_idx;
DROP INDEX IF EXISTS attendance_day_policy_version_fk_idx;
ALTER TABLE attendance_day DROP COLUMN IF EXISTS judged_at;
ALTER TABLE attendance_day DROP COLUMN IF EXISTS shift_ends_at;
ALTER TABLE attendance_day DROP COLUMN IF EXISTS shift_starts_at;
ALTER TABLE attendance_day DROP COLUMN IF EXISTS shift_working;
ALTER TABLE attendance_day DROP COLUMN IF EXISTS attendance_work_schedule_id;
ALTER TABLE attendance_day DROP COLUMN IF EXISTS policy_version_id;
ALTER TABLE attendance_day DROP COLUMN IF EXISTS early_minutes;
