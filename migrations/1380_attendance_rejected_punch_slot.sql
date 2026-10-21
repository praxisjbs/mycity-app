-- M1 a punch People reject frees its slot, as the attendance module writes it
-- (docs/guides/attendance.md §4, §6.2, §6.8).
--
--   attendance_event.slot  how many punches of its type that work date, among the person's and
--                          People's, a decision had already excluded when it was written: 0 for the
--                          first, 1 for the one after People rejected it, and so on. Written once,
--                          with the punch, so the table stays append-only (1300's trigger)
--   the unique index       one active (accepted or review) event of each type per person, work date
--                          and slot among every punch but the system's, in place of 1360's one per
--                          work date: a punch a decision excluded keeps its row and its slot, the
--                          next one takes the next slot, and two written at once still collide
--
-- Every punch before this file is the first of its type that day, so the default 0 is its slot.
-- UP
ALTER TABLE attendance_event ADD COLUMN IF NOT EXISTS slot smallint NOT NULL DEFAULT 0;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_event_slot_check') THEN
    ALTER TABLE attendance_event ADD CONSTRAINT attendance_event_slot_check CHECK (slot >= 0);
  END IF;
END;
$$;
CREATE UNIQUE INDEX IF NOT EXISTS attendance_event_one_active_slot_uq
  ON attendance_event (employee_id, work_date, event_type, slot)
  WHERE validation_state IN ('accepted', 'review') AND source <> 'system';
-- Replaced by the one above: the same rule, a slot at a time.
DROP INDEX IF EXISTS attendance_event_one_active_person_uq;

-- DOWN
-- Restores 1360's index; refused while a day holds a punch People rejected beside the one that
-- took its slot, which needs this file.
CREATE UNIQUE INDEX IF NOT EXISTS attendance_event_one_active_person_uq
  ON attendance_event (employee_id, work_date, event_type)
  WHERE validation_state IN ('accepted', 'review') AND source <> 'system';
DROP INDEX IF EXISTS attendance_event_one_active_slot_uq;
ALTER TABLE attendance_event DROP CONSTRAINT IF EXISTS attendance_event_slot_check;
ALTER TABLE attendance_event DROP COLUMN IF EXISTS slot;
