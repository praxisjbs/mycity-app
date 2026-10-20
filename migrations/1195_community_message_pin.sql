-- M1 a message pinned at the top of its conversation for a while (docs/guides/community.md §3 step 16).
--
-- A moderator (either person, in a direct conversation) pins a message for 24 hours, 7 days or 30
-- days. It is pinned while pinned_until is ahead, so it unpins itself with no job; at most three
-- are pinned at once in a conversation, and a fourth takes the place of the oldest.
-- UP
ALTER TABLE community_message ADD COLUMN IF NOT EXISTS pinned_until timestamptz;
ALTER TABLE community_message ADD COLUMN IF NOT EXISTS pinned_at timestamptz;
ALTER TABLE community_message ADD COLUMN IF NOT EXISTS pinned_by uuid REFERENCES app_user(user_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS community_message_pinned_idx ON community_message (community_channel_id, pinned_until) WHERE pinned_until IS NOT NULL;
CREATE INDEX IF NOT EXISTS community_message_pinned_by_fk_idx ON community_message (pinned_by);

-- DOWN
DROP INDEX IF EXISTS community_message_pinned_by_fk_idx;
DROP INDEX IF EXISTS community_message_pinned_idx;
-- DESTRUCTIVE: rolling back unpins every pinned message; the messages stay.
ALTER TABLE community_message DROP COLUMN IF EXISTS pinned_by;
ALTER TABLE community_message DROP COLUMN IF EXISTS pinned_at;
ALTER TABLE community_message DROP COLUMN IF EXISTS pinned_until;
