-- M1 wishes under a birthday or anniversary card (docs/guides/community.md §3 step 3).
--
-- Colleagues send a short wish to the person a celebration card is for. Wishes stay under the
-- card, never in the channel's stream: the card shows the latest two and counts the rest. A wish
-- is never edited; its author or a moderator deletes it, and the row stays for the audit.
-- UP
CREATE TABLE IF NOT EXISTS community_wish (
  community_wish_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_message_id uuid NOT NULL REFERENCES community_message(community_message_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(user_id) ON DELETE RESTRICT,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 280),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS community_wish_card_idx ON community_wish (community_message_id, created_at DESC);
CREATE INDEX IF NOT EXISTS community_wish_user_idx ON community_wish (user_id);
CREATE OR REPLACE TRIGGER community_wish_set_updated_at BEFORE UPDATE ON community_wish
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- DOWN
DROP TRIGGER IF EXISTS community_wish_set_updated_at ON community_wish;
DROP INDEX IF EXISTS community_wish_user_idx;
DROP INDEX IF EXISTS community_wish_card_idx;
-- DESTRUCTIVE: rolling back loses every wish; the cards and their celebrations stay.
DROP TABLE IF EXISTS community_wish;
