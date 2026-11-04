-- M4 the Talent Pool, moved from M5 by TB on 04/11/2026 (docs/guides/recruitment.md §6.9): candidates
-- kept for 24 months after a role, with why, and invited back to a later one.
--
--   talent_pool_entry  one candidate in the pool: the application they were added from (SET NULL),
--                the reason, who added them (SET NULL), expires_at (24 months on, when
--                talent-pool-purge takes them off), Invite to Apply (invited_at, invited_vacancy_id,
--                SET NULL), and removed_at, removed_reason once off the pool, early or at the end of
--                their time. A candidate is in the pool once at a time (live_key). CASCADE on the
--                candidate: an entry is part of the person's record.
--
-- 5000 (M5) made talent_pool and talent_pool_member for named pools. M4 numbers below 5000, so it
-- cannot build on them; they stay unused, and the route map's record type is talent_pool_entry.
-- UP
CREATE TABLE IF NOT EXISTS talent_pool_entry (
  talent_pool_entry_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES candidate(candidate_id) ON DELETE CASCADE,
  application_id uuid REFERENCES application(application_id) ON DELETE SET NULL,
  reason text NOT NULL,
  added_by uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  invited_at timestamptz,
  invited_vacancy_id uuid REFERENCES vacancy(vacancy_id) ON DELETE SET NULL,
  removed_at timestamptz,
  removed_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at),
  CHECK (invited_vacancy_id IS NULL OR invited_at IS NOT NULL),
  CHECK (removed_reason IS NULL OR removed_at IS NOT NULL)
);
CREATE OR REPLACE TRIGGER talent_pool_entry_set_updated_at BEFORE UPDATE ON talent_pool_entry
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE UNIQUE INDEX IF NOT EXISTS talent_pool_entry_live_key ON talent_pool_entry (candidate_id) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS talent_pool_entry_candidate_idx ON talent_pool_entry (candidate_id);
CREATE INDEX IF NOT EXISTS talent_pool_entry_application_idx ON talent_pool_entry (application_id);
CREATE INDEX IF NOT EXISTS talent_pool_entry_added_by_idx ON talent_pool_entry (added_by);
CREATE INDEX IF NOT EXISTS talent_pool_entry_invited_vacancy_idx ON talent_pool_entry (invited_vacancy_id);
CREATE INDEX IF NOT EXISTS talent_pool_entry_expires_idx ON talent_pool_entry (expires_at) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS talent_pool_entry_created_idx ON talent_pool_entry (created_at);
CREATE INDEX IF NOT EXISTS talent_pool_entry_invited_idx ON talent_pool_entry (invited_at);

-- DOWN
DROP INDEX IF EXISTS talent_pool_entry_invited_idx;
DROP INDEX IF EXISTS talent_pool_entry_created_idx;
DROP INDEX IF EXISTS talent_pool_entry_expires_idx;
DROP INDEX IF EXISTS talent_pool_entry_invited_vacancy_idx;
DROP INDEX IF EXISTS talent_pool_entry_added_by_idx;
DROP INDEX IF EXISTS talent_pool_entry_application_idx;
DROP INDEX IF EXISTS talent_pool_entry_candidate_idx;
DROP INDEX IF EXISTS talent_pool_entry_live_key;
DROP TRIGGER IF EXISTS talent_pool_entry_set_updated_at ON talent_pool_entry;
DROP TABLE IF EXISTS talent_pool_entry; -- DESTRUCTIVE: rollback only; drops what UP added
