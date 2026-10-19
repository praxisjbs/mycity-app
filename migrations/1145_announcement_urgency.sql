-- M1 announcement levels: the urgency its poster chose, and who acknowledged an urgent one.
--
-- Added by TB on 19/10/2026 (docs/guides/community.md §3 step 2, §4, §6). The notices it sends
-- carry the same urgency (0470_notification_urgency.sql).
--
--   announcement       urgency: normal, important or urgent. Important reminds the unread once
--                      after 4 hours; urgent repeats until each person acknowledges
--   announcement_read  acknowledged_at: set by Acknowledge on an urgent announcement, which also
--                      sets read_at; an urgent announcement counts as read only once acknowledged
-- UP
ALTER TABLE announcement ADD COLUMN IF NOT EXISTS urgency text NOT NULL DEFAULT 'normal'
  CHECK (urgency IN ('normal', 'important', 'urgent'));
ALTER TABLE announcement_read ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz;

-- DOWN
ALTER TABLE announcement_read DROP COLUMN IF EXISTS acknowledged_at;
ALTER TABLE announcement DROP COLUMN IF EXISTS urgency;
