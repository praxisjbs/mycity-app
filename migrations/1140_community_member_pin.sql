-- M1 Staff Community: each member pins up to 3 conversations for themselves (community.md §3 step 16).
-- UP

ALTER TABLE community_member ADD COLUMN IF NOT EXISTS pinned_at timestamptz;
CREATE INDEX IF NOT EXISTS community_member_pinned_idx ON community_member (user_id, pinned_at) WHERE pinned_at IS NOT NULL;

-- DOWN

DROP INDEX IF EXISTS community_member_pinned_idx;
ALTER TABLE community_member DROP COLUMN IF EXISTS pinned_at;
