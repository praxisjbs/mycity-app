-- M10 SOPs: each department's own standard operating procedures (docs/guides/knowledge.md §4, §6.2, §6.3).
--
--   sop          one procedure of one department. Numbered (sop, SOP-0001). The department is fixed
--                when it is created. Archived, it leaves search, the AI and the screens' Procedures.
--   sop_version  an SOP's draft and its numbered versions. At most one draft an SOP; a version
--                number is never used twice and a published version is never edited. A version is
--                in force from the moment it is published, so the newest published one is read.
--                `content_hash` is over what staff read.
--   sop_step     a version's numbered steps: the text (Markdown), who does it, the screen it happens
--                on (a route map key, module/tab) and a file from the vault. Written whole with the
--                version, so a step has no updated_at; indexed by screen for the Procedures list.
-- UP
CREATE TABLE IF NOT EXISTS sop (
  sop_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number citext NOT NULL UNIQUE,
  department_id uuid NOT NULL REFERENCES department(department_id) ON DELETE RESTRICT,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  archived_at timestamptz,
  archived_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  archive_reason text,
  created_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sop_archived_check CHECK ((status = 'archived') = (archived_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS sop_department_fk_idx ON sop (department_id, title, sop_id);
CREATE INDEX IF NOT EXISTS sop_title_idx ON sop (title, sop_id);
CREATE INDEX IF NOT EXISTS sop_updated_at_idx ON sop (updated_at, sop_id);
CREATE INDEX IF NOT EXISTS sop_archived_by_fk_idx ON sop (archived_by);
CREATE INDEX IF NOT EXISTS sop_created_by_fk_idx ON sop (created_by);
CREATE INDEX IF NOT EXISTS sop_updated_by_fk_idx ON sop (updated_by);
CREATE OR REPLACE TRIGGER sop_set_updated_at BEFORE UPDATE ON sop
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS sop_version (
  sop_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sop_id uuid NOT NULL REFERENCES sop(sop_id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  version integer,
  title text NOT NULL,
  purpose text,
  scope text,
  roles text[] NOT NULL DEFAULT '{}'::text[],
  note text,
  content_hash text,
  published_at timestamptz,
  published_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  created_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- A draft has no number; a version has its number, its purpose, its hash and its publication.
  -- `version IS NOT NULL` is spelled out: NULL > 0 is unknown, and a CHECK lets unknown through.
  CONSTRAINT sop_version_state_check CHECK (
    (status = 'draft' AND version IS NULL AND published_at IS NULL)
    OR (status = 'published' AND version IS NOT NULL AND version > 0 AND purpose IS NOT NULL AND content_hash IS NOT NULL
        AND published_at IS NOT NULL)
  ),
  CONSTRAINT sop_version_roles_check CHECK (cardinality(roles) <= 10)
);
CREATE UNIQUE INDEX IF NOT EXISTS sop_version_number_uq
  ON sop_version (sop_id, version) WHERE version IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sop_version_one_draft_uq
  ON sop_version (sop_id) WHERE status = 'draft';
-- The version in force: the newest published one.
CREATE INDEX IF NOT EXISTS sop_version_in_force_idx
  ON sop_version (sop_id, version DESC) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS sop_version_published_by_fk_idx ON sop_version (published_by);
CREATE INDEX IF NOT EXISTS sop_version_created_by_fk_idx ON sop_version (created_by);
CREATE INDEX IF NOT EXISTS sop_version_updated_by_fk_idx ON sop_version (updated_by);
CREATE OR REPLACE TRIGGER sop_version_set_updated_at BEFORE UPDATE ON sop_version
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS sop_step (
  sop_step_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sop_version_id uuid NOT NULL REFERENCES sop_version(sop_version_id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position BETWEEN 1 AND 50),
  text text NOT NULL,
  who text,
  screen_key text CHECK (screen_key IS NULL OR screen_key ~ '^[a-z_]+/[a-z0-9-]+$'),
  document_id uuid REFERENCES document(document_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sop_step_position_uq UNIQUE (sop_version_id, position)
);
CREATE INDEX IF NOT EXISTS sop_step_screen_idx ON sop_step (screen_key, sop_version_id) WHERE screen_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS sop_step_document_fk_idx ON sop_step (document_id);

-- DOWN
DROP TABLE IF EXISTS sop_step;
DROP TRIGGER IF EXISTS sop_version_set_updated_at ON sop_version;
DROP TABLE IF EXISTS sop_version;
DROP TRIGGER IF EXISTS sop_set_updated_at ON sop;
DROP TABLE IF EXISTS sop;
