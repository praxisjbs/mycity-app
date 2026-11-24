-- M1 one unregistered-device exception per person, device and work date, as the attendance module
-- writes it (docs/guides/attendance.md §4, §6.6).
--
--   attendance_exception.attendance_device_id  the device an unknown_device exception is about. A
--                                              day belongs to one person, so the day and the device
--                                              are the person, the device and the work date
--   attendance_exception_device_day_uq         one open unknown_device exception a day and device:
--                                              the first punch from the device opens it, the later
--                                              ones that day attach to it while it is open
--   attendance_exception_punch                 a later punch attached to an open exception. Deciding
--                                              the exception decides it too (a rejection excludes
--                                              every punch it holds). Written with the punch, never
--                                              changed
--
-- Existing rows: the device is copied from the punch onto every decided unknown_device exception and
-- onto the earliest open one of each day and device. Any later open one of the same day and device
-- (one exception per punch, as before this file) keeps no device, so the unique index cannot fail on
-- them, and People decide it on its own as before.
-- UP
ALTER TABLE attendance_exception ADD COLUMN IF NOT EXISTS attendance_device_id uuid
  REFERENCES attendance_device(attendance_device_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS attendance_exception_device_fk_idx ON attendance_exception (attendance_device_id);

UPDATE attendance_exception x
   SET attendance_device_id = ev.attendance_device_id
  FROM attendance_event ev
 WHERE ev.attendance_event_id = x.attendance_event_id
   AND x.exception_type = 'unknown_device'
   AND x.attendance_device_id IS NULL
   AND ev.attendance_device_id IS NOT NULL
   AND (x.status <> 'open'
        OR NOT EXISTS (
          SELECT 1
            FROM attendance_exception y
            JOIN attendance_event ey ON ey.attendance_event_id = y.attendance_event_id
           WHERE y.attendance_day_id = x.attendance_day_id
             AND y.exception_type = 'unknown_device'
             AND y.status = 'open'
             AND ey.attendance_device_id = ev.attendance_device_id
             AND (y.created_at, y.attendance_exception_id) < (x.created_at, x.attendance_exception_id)));

CREATE UNIQUE INDEX IF NOT EXISTS attendance_exception_device_day_uq
  ON attendance_exception (attendance_day_id, attendance_device_id)
  WHERE exception_type = 'unknown_device' AND status = 'open' AND attendance_device_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS attendance_exception_punch (
  attendance_exception_punch_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_exception_id uuid NOT NULL
    REFERENCES attendance_exception(attendance_exception_id) ON DELETE CASCADE,
  attendance_event_id uuid NOT NULL REFERENCES attendance_event(attendance_event_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS attendance_exception_punch_uq
  ON attendance_exception_punch (attendance_exception_id, attendance_event_id);
CREATE INDEX IF NOT EXISTS attendance_exception_punch_event_fk_idx ON attendance_exception_punch (attendance_event_id);

-- DOWN
-- A punch attached to an exception People rejected counts again once its link is gone: roll back
-- only with the code that writes the links.
DROP INDEX IF EXISTS attendance_exception_punch_event_fk_idx;
DROP INDEX IF EXISTS attendance_exception_punch_uq;
DROP TABLE IF EXISTS attendance_exception_punch;
DROP INDEX IF EXISTS attendance_exception_device_day_uq;
DROP INDEX IF EXISTS attendance_exception_device_fk_idx;
ALTER TABLE attendance_exception DROP COLUMN IF EXISTS attendance_device_id;
