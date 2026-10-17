-- M1 Staff Community: post policy, pinned and system channels, read and delivered pointers, poll votes, transcripts, presence and announcement reads (community.md §4).
-- UP

ALTER TABLE community_channel ADD COLUMN IF NOT EXISTS post_policy text NOT NULL DEFAULT 'everyone';
ALTER TABLE community_channel ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false;
ALTER TABLE community_channel ADD COLUMN IF NOT EXISTS system_key text;
-- #general and #announcements are made by the system the first time they are needed, by no one.
ALTER TABLE community_channel ALTER COLUMN created_by DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'community_channel_post_policy_check') THEN
    ALTER TABLE community_channel ADD CONSTRAINT community_channel_post_policy_check
      CHECK (post_policy IN ('everyone', 'admins', 'people_ceo'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'community_channel_system_key_check') THEN
    ALTER TABLE community_channel ADD CONSTRAINT community_channel_system_key_check
      CHECK (system_key IS NULL OR system_key IN ('general', 'announcements'));
  END IF;
END $$;

-- One #general and one #announcements; a channel name is unique among live, named channels.
CREATE UNIQUE INDEX IF NOT EXISTS community_channel_system_key_uq ON community_channel (system_key) WHERE system_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS community_channel_name_uq ON community_channel (name) WHERE channel_type <> 'direct' AND archived_at IS NULL;
CREATE INDEX IF NOT EXISTS community_channel_department_idx ON community_channel (department_id);
CREATE INDEX IF NOT EXISTS community_channel_created_by_idx ON community_channel (created_by);

ALTER TABLE community_member ADD COLUMN IF NOT EXISTS last_delivered_at timestamptz;
CREATE INDEX IF NOT EXISTS community_member_user_idx ON community_member (user_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'community_member_member_role_check') THEN
    ALTER TABLE community_member ADD CONSTRAINT community_member_member_role_check
      CHECK (member_role IN ('admin', 'member'));
  END IF;
END $$;

-- The message kinds the community writes (community.js MESSAGE_TYPES): widening the check.
ALTER TABLE community_message DROP CONSTRAINT IF EXISTS community_message_message_type_check;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'community_message_kind_check') THEN
    ALTER TABLE community_message ADD CONSTRAINT community_message_kind_check
      CHECK (message_type IN ('text', 'image', 'audio', 'video', 'file', 'system', 'poll', 'recognition', 'birthday', 'anniversary', 'announcement'));
  END IF;
END $$;
ALTER TABLE community_message ADD COLUMN IF NOT EXISTS transcript text;
CREATE INDEX IF NOT EXISTS community_message_sender_idx ON community_message (sender_user_id);
CREATE INDEX IF NOT EXISTS community_message_parent_idx ON community_message (parent_message_id);
CREATE INDEX IF NOT EXISTS community_message_document_idx ON community_message (document_id);

CREATE INDEX IF NOT EXISTS community_reaction_user_idx ON community_reaction (user_id);

ALTER TABLE peer_recognition ADD COLUMN IF NOT EXISTS note_written_by_system boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS peer_recognition_from_idx ON peer_recognition (from_employee_id);
CREATE INDEX IF NOT EXISTS peer_recognition_to_idx ON peer_recognition (to_employee_id);
CREATE INDEX IF NOT EXISTS peer_recognition_message_idx ON peer_recognition (community_message_id);

CREATE TABLE IF NOT EXISTS community_poll_vote (
  community_poll_vote_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_message_id uuid NOT NULL REFERENCES community_message(community_message_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  option_index integer NOT NULL CHECK (option_index BETWEEN 0 AND 3),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (community_message_id, user_id)
);
CREATE INDEX IF NOT EXISTS community_poll_vote_user_idx ON community_poll_vote (user_id);
CREATE OR REPLACE TRIGGER community_poll_vote_set_updated_at BEFORE UPDATE ON community_poll_vote
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Who is online: a connected socket touches last_seen_at; online is a touch inside the last 90 seconds.
CREATE TABLE IF NOT EXISTS community_presence (
  community_presence_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES app_user(user_id) ON DELETE CASCADE,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE TRIGGER community_presence_set_updated_at BEFORE UPDATE ON community_presence
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE announcement ADD COLUMN IF NOT EXISTS community_message_id uuid REFERENCES community_message(community_message_id) ON DELETE SET NULL;
ALTER TABLE announcement ADD COLUMN IF NOT EXISTS audience_size integer NOT NULL DEFAULT 0;
ALTER TABLE announcement ADD COLUMN IF NOT EXISTS last_reminded_at timestamptz;
CREATE INDEX IF NOT EXISTS announcement_message_idx ON announcement (community_message_id);
CREATE INDEX IF NOT EXISTS announcement_published_by_idx ON announcement (published_by);
CREATE INDEX IF NOT EXISTS announcement_due_idx ON announcement (publish_at) WHERE status = 'scheduled';

CREATE TABLE IF NOT EXISTS announcement_read (
  announcement_read_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id uuid NOT NULL REFERENCES announcement(announcement_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (announcement_id, user_id)
);
CREATE INDEX IF NOT EXISTS announcement_read_user_idx ON announcement_read (user_id);
CREATE OR REPLACE TRIGGER announcement_read_set_updated_at BEFORE UPDATE ON announcement_read
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- DOWN
DROP TRIGGER IF EXISTS announcement_read_set_updated_at ON announcement_read;
DROP INDEX IF EXISTS announcement_read_user_idx;
DROP TABLE IF EXISTS announcement_read;
DROP INDEX IF EXISTS announcement_due_idx;
DROP INDEX IF EXISTS announcement_published_by_idx;
DROP INDEX IF EXISTS announcement_message_idx;
ALTER TABLE announcement DROP COLUMN IF EXISTS last_reminded_at;
ALTER TABLE announcement DROP COLUMN IF EXISTS audience_size;
ALTER TABLE announcement DROP COLUMN IF EXISTS community_message_id;
DROP TRIGGER IF EXISTS community_presence_set_updated_at ON community_presence;
DROP TABLE IF EXISTS community_presence;
DROP TRIGGER IF EXISTS community_poll_vote_set_updated_at ON community_poll_vote;
DROP INDEX IF EXISTS community_poll_vote_user_idx;
DROP TABLE IF EXISTS community_poll_vote;
DROP INDEX IF EXISTS peer_recognition_message_idx;
DROP INDEX IF EXISTS peer_recognition_to_idx;
DROP INDEX IF EXISTS peer_recognition_from_idx;
ALTER TABLE peer_recognition DROP COLUMN IF EXISTS note_written_by_system;
DROP INDEX IF EXISTS community_reaction_user_idx;
DROP INDEX IF EXISTS community_message_document_idx;
DROP INDEX IF EXISTS community_message_parent_idx;
DROP INDEX IF EXISTS community_message_sender_idx;
ALTER TABLE community_message DROP COLUMN IF EXISTS transcript;
ALTER TABLE community_message DROP CONSTRAINT IF EXISTS community_message_kind_check;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'community_message_message_type_check') THEN
    ALTER TABLE community_message ADD CONSTRAINT community_message_message_type_check
      CHECK (message_type IN ('text', 'image', 'audio', 'video', 'file', 'system'));
  END IF;
END $$;
ALTER TABLE community_member DROP CONSTRAINT IF EXISTS community_member_member_role_check;
DROP INDEX IF EXISTS community_member_user_idx;
ALTER TABLE community_member DROP COLUMN IF EXISTS last_delivered_at;
DROP INDEX IF EXISTS community_channel_created_by_idx;
DROP INDEX IF EXISTS community_channel_department_idx;
DROP INDEX IF EXISTS community_channel_name_uq;
DROP INDEX IF EXISTS community_channel_system_key_uq;
ALTER TABLE community_channel DROP CONSTRAINT IF EXISTS community_channel_system_key_check;
ALTER TABLE community_channel DROP CONSTRAINT IF EXISTS community_channel_post_policy_check;
ALTER TABLE community_channel DROP COLUMN IF EXISTS system_key;
-- DESTRUCTIVE: system channels have no creator; the rollback deletes them with their messages before restoring NOT NULL.
DELETE FROM community_channel WHERE created_by IS NULL;
ALTER TABLE community_channel ALTER COLUMN created_by SET NOT NULL;
ALTER TABLE community_channel DROP COLUMN IF EXISTS pinned;
ALTER TABLE community_channel DROP COLUMN IF EXISTS post_policy;
