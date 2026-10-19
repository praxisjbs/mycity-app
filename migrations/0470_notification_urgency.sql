-- M0 notice urgency: how hard a notice insists, its Acknowledge, and its urgent repeats.
--
-- Added by TB on 19/10/2026 (docs/guides/notifications.md §4, §6). An announcement's own level
-- and its acknowledgements are M1's, in 1145_announcement_urgency.sql.
--
--   notification       urgency (normal, important, urgent), from the event's declaration.
--                      acknowledge_required: only Acknowledge closes it (an urgent announcement);
--                      acknowledged_at: when it was. repeat_count, last_alert_at, repeat_day and
--                      repeats_on_day pace the urgent repeats: every 30 minutes from 08:00 to
--                      18:00 Lagos time, at most 8 on one Lagos day
--   push_delivery      round: 0 for the first alert, then the urgent repeat this device was last
--                      sent. Still one row per (notice, device): a new round updates it
-- UP
ALTER TABLE notification ADD COLUMN IF NOT EXISTS urgency text NOT NULL DEFAULT 'normal'
  CHECK (urgency IN ('normal', 'important', 'urgent'));
ALTER TABLE notification ADD COLUMN IF NOT EXISTS acknowledge_required boolean NOT NULL DEFAULT false;
ALTER TABLE notification ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz;
ALTER TABLE notification ADD COLUMN IF NOT EXISTS repeat_count integer NOT NULL DEFAULT 0;
ALTER TABLE notification ADD COLUMN IF NOT EXISTS last_alert_at timestamptz;
ALTER TABLE notification ADD COLUMN IF NOT EXISTS repeat_day date;
ALTER TABLE notification ADD COLUMN IF NOT EXISTS repeats_on_day integer NOT NULL DEFAULT 0;

-- The urgent bar reads one person's urgent notices and the repeat sweep reads them all; they are few.
CREATE INDEX IF NOT EXISTS notification_urgent_idx ON notification (user_id, created_at)
  WHERE urgency = 'urgent';

ALTER TABLE push_delivery ADD COLUMN IF NOT EXISTS round integer NOT NULL DEFAULT 0;

-- DOWN
ALTER TABLE push_delivery DROP COLUMN IF EXISTS round;
DROP INDEX IF EXISTS notification_urgent_idx;
ALTER TABLE notification DROP COLUMN IF EXISTS repeats_on_day;
ALTER TABLE notification DROP COLUMN IF EXISTS repeat_day;
ALTER TABLE notification DROP COLUMN IF EXISTS last_alert_at;
ALTER TABLE notification DROP COLUMN IF EXISTS repeat_count;
ALTER TABLE notification DROP COLUMN IF EXISTS acknowledged_at;
ALTER TABLE notification DROP COLUMN IF EXISTS acknowledge_required;
ALTER TABLE notification DROP COLUMN IF EXISTS urgency;
