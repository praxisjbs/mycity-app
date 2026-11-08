-- M5: drop 5000's talent_pool and talent_pool_member, never used (M4's pool is 4060's talent_pool_entry).
-- DESTRUCTIVE: both tables were never written by any code, so no data is lost; M4 keeps its pool in 4060.
-- UP
DROP TABLE IF EXISTS talent_pool_member;
DROP TABLE IF EXISTS talent_pool;

-- DOWN
CREATE TABLE IF NOT EXISTS talent_pool (
  talent_pool_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS talent_pool_member (
  talent_pool_member_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  talent_pool_id uuid NOT NULL REFERENCES talent_pool(talent_pool_id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES candidate(candidate_id) ON DELETE CASCADE,
  notes text,
  added_by uuid REFERENCES app_user(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (talent_pool_id, candidate_id)
);
