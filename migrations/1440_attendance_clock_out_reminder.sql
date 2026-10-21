-- M1 reminders to clock out, every few minutes from the shift's end, as the clock watch writes them
-- (docs/guides/attendance.md §4, §6.14; TB's decisions of 20/10/2026, T13).
--
--   attendance_clock_reminder.kind    clock_in_due (1360) or clock_out_due
--   attendance_clock_reminder.slot    0 for the one reminder to clock in; 1, 2, 3 ... for each
--                                     reminder to clock out, every clock_out_reminder_minutes from
--                                     the shift's end until the system clock-out
--   attendance_clock_reminder.due_at  the reminder's time
--
-- 1360 held one reminder per person, day and kind; a day now holds one reminder to clock out per
-- slot, so the unique key becomes the person, the day, the kind and the slot (a widening, so it
-- loses nothing). A retried run sends none twice.
-- UP
ALTER TABLE attendance_clock_reminder ADD COLUMN IF NOT EXISTS slot smallint NOT NULL DEFAULT 0;
ALTER TABLE attendance_clock_reminder ADD COLUMN IF NOT EXISTS due_at timestamptz;
ALTER TABLE attendance_clock_reminder DROP CONSTRAINT IF EXISTS attendance_clock_reminder_kind_check;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_clock_reminder_kind_out_check') THEN
    ALTER TABLE attendance_clock_reminder ADD CONSTRAINT attendance_clock_reminder_kind_out_check
      CHECK (kind IN ('clock_in_due', 'clock_out_due'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_clock_reminder_slot_check') THEN
    ALTER TABLE attendance_clock_reminder ADD CONSTRAINT attendance_clock_reminder_slot_check
      CHECK ((kind = 'clock_in_due' AND slot = 0) OR (kind = 'clock_out_due' AND slot >= 1));
  END IF;
END;
$$;
CREATE UNIQUE INDEX IF NOT EXISTS attendance_clock_reminder_slot_uq
  ON attendance_clock_reminder (employee_id, work_date, kind, slot);
DROP INDEX IF EXISTS attendance_clock_reminder_once_uq;

-- DOWN
-- Restores 1360's key and kinds; refused while a reminder to clock out exists, which needs this file.
CREATE UNIQUE INDEX IF NOT EXISTS attendance_clock_reminder_once_uq
  ON attendance_clock_reminder (employee_id, work_date, kind);
DROP INDEX IF EXISTS attendance_clock_reminder_slot_uq;
ALTER TABLE attendance_clock_reminder DROP CONSTRAINT IF EXISTS attendance_clock_reminder_slot_check;
ALTER TABLE attendance_clock_reminder DROP CONSTRAINT IF EXISTS attendance_clock_reminder_kind_out_check;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_clock_reminder_kind_check') THEN
    ALTER TABLE attendance_clock_reminder ADD CONSTRAINT attendance_clock_reminder_kind_check
      CHECK (kind IN ('clock_in_due'));
  END IF;
END;
$$;
ALTER TABLE attendance_clock_reminder DROP COLUMN IF EXISTS due_at;
ALTER TABLE attendance_clock_reminder DROP COLUMN IF EXISTS slot;
