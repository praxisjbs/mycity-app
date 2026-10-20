-- M1 policies, brought forward from M10 by TB on 20/10/2026 (docs/guides/policies.md §4).
--
--   policy                 one company policy: a written document or a rules policy of a type the
--                          code knows (attendance). Numbered (policy, POL-0001). At most one
--                          attendance policy. Archived, a document stops applying.
--   policy_version         a policy's draft, its submission for approval and its numbered versions
--                          from a first day. At most one draft and one submission a policy; a
--                          version number is never used twice. The text is Markdown (the one
--                          renderer, shared/documents/markdown.js); a rules type's rules are one
--                          jsonb document checked by its contract on every write and read whole,
--                          never filtered (MIGRATIONS §6). `content_hash` is over what staff read.
--   policy_audience        who a version applies to beyond everyone: departments, work patterns,
--                          named people; filtered in SQL, so rows, not jsonb.
--   policy_signature       the publisher's and each approver's signature on a version: a PNG in
--                          the vault, with the name and title copied at signing.
--   policy_acknowledgement one row per person and version: acknowledged (with the device and the
--                          hash of what they read), reminded, or put off until tomorrow.
-- UP
CREATE TABLE IF NOT EXISTS policy (
  policy_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number citext NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('document', 'attendance')),
  title text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  archived_at timestamptz,
  archived_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  archive_reason text,
  created_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT policy_archived_check CHECK ((status = 'archived') = (archived_at IS NOT NULL)),
  CONSTRAINT policy_rules_never_archived_check CHECK (kind = 'document' OR status = 'active')
);
CREATE UNIQUE INDEX IF NOT EXISTS policy_one_attendance_uq ON policy ((kind)) WHERE kind = 'attendance';
CREATE INDEX IF NOT EXISTS policy_title_idx ON policy (title, policy_id);
CREATE INDEX IF NOT EXISTS policy_archived_by_fk_idx ON policy (archived_by);
CREATE INDEX IF NOT EXISTS policy_created_by_fk_idx ON policy (created_by);
CREATE INDEX IF NOT EXISTS policy_updated_by_fk_idx ON policy (updated_by);
CREATE OR REPLACE TRIGGER policy_set_updated_at BEFORE UPDATE ON policy
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS policy_version (
  policy_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id uuid NOT NULL REFERENCES policy(policy_id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'published', 'withdrawn')),
  version integer,
  effective_from date,
  note text,
  title text NOT NULL,
  body_markdown text,
  rules jsonb,
  applies_to_everyone boolean NOT NULL DEFAULT true,
  needs_acknowledgement boolean NOT NULL DEFAULT true,
  acknowledge_within_days integer NOT NULL DEFAULT 7 CHECK (acknowledge_within_days BETWEEN 1 AND 30),
  needs_approval boolean NOT NULL DEFAULT false,
  content_hash text,
  workflow_instance_id uuid REFERENCES workflow_instance(workflow_instance_id) ON DELETE SET NULL,
  document_id uuid REFERENCES document(document_id) ON DELETE SET NULL,
  submitted_at timestamptz,
  submitted_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  published_at timestamptz,
  published_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  withdrawn_at timestamptz,
  withdrawn_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  withdraw_reason text,
  created_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- A draft has no number; a submission waits with its first day, note and hash; a version has
  -- its number and publication; a withdrawn one says when.
  CONSTRAINT policy_version_state_check CHECK (
    (status = 'draft' AND version IS NULL AND submitted_at IS NULL)
    OR (status = 'submitted' AND version IS NULL AND effective_from IS NOT NULL AND note IS NOT NULL
        AND content_hash IS NOT NULL AND submitted_at IS NOT NULL)
    OR (status IN ('published', 'withdrawn') AND version > 0 AND effective_from IS NOT NULL
        AND note IS NOT NULL AND content_hash IS NOT NULL AND published_at IS NOT NULL)
  ),
  CONSTRAINT policy_version_withdrawn_check CHECK ((status = 'withdrawn') = (withdrawn_at IS NOT NULL)),
  CONSTRAINT policy_version_content_check CHECK (body_markdown IS NULL OR rules IS NULL),
  CONSTRAINT policy_version_rules_object_check CHECK (rules IS NULL OR jsonb_typeof(rules) = 'object')
);
CREATE UNIQUE INDEX IF NOT EXISTS policy_version_number_uq
  ON policy_version (policy_id, version) WHERE version IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS policy_version_one_draft_uq
  ON policy_version (policy_id) WHERE status = 'draft';
CREATE UNIQUE INDEX IF NOT EXISTS policy_version_one_submitted_uq
  ON policy_version (policy_id) WHERE status = 'submitted';
-- The version in force on a date: the latest first day on or before it.
CREATE INDEX IF NOT EXISTS policy_version_in_force_idx
  ON policy_version (policy_id, effective_from DESC, version DESC) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS policy_version_workflow_instance_fk_idx ON policy_version (workflow_instance_id);
CREATE INDEX IF NOT EXISTS policy_version_document_fk_idx ON policy_version (document_id);
CREATE INDEX IF NOT EXISTS policy_version_submitted_by_fk_idx ON policy_version (submitted_by);
CREATE INDEX IF NOT EXISTS policy_version_published_by_fk_idx ON policy_version (published_by);
CREATE INDEX IF NOT EXISTS policy_version_withdrawn_by_fk_idx ON policy_version (withdrawn_by);
CREATE INDEX IF NOT EXISTS policy_version_created_by_fk_idx ON policy_version (created_by);
CREATE INDEX IF NOT EXISTS policy_version_updated_by_fk_idx ON policy_version (updated_by);
CREATE OR REPLACE TRIGGER policy_version_set_updated_at BEFORE UPDATE ON policy_version
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS policy_audience (
  policy_audience_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_version_id uuid NOT NULL REFERENCES policy_version(policy_version_id) ON DELETE CASCADE,
  department_id uuid REFERENCES department(department_id) ON DELETE RESTRICT,
  work_pattern text CHECK (work_pattern IN ('on_site', 'hybrid', 'remote')),
  employee_id uuid REFERENCES employee(employee_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT policy_audience_one_check CHECK (num_nonnulls(department_id, work_pattern, employee_id) = 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS policy_audience_once_uq
  ON policy_audience (policy_version_id, COALESCE(department_id::text, work_pattern, employee_id::text));
CREATE INDEX IF NOT EXISTS policy_audience_department_fk_idx ON policy_audience (department_id);
CREATE INDEX IF NOT EXISTS policy_audience_employee_fk_idx ON policy_audience (employee_id);

CREATE TABLE IF NOT EXISTS policy_signature (
  policy_signature_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_version_id uuid NOT NULL REFERENCES policy_version(policy_version_id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('publisher', 'approver')),
  stage_key text,
  stage_name text,
  user_id uuid NOT NULL REFERENCES app_user(user_id) ON DELETE RESTRICT,
  employee_id uuid REFERENCES employee(employee_id) ON DELETE RESTRICT,
  signer_name text NOT NULL,
  signer_title text,
  signed_at timestamptz NOT NULL DEFAULT now(),
  signature_document_id uuid NOT NULL REFERENCES document(document_id) ON DELETE RESTRICT,
  content_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS policy_signature_version_fk_idx ON policy_signature (policy_version_id, signed_at);
CREATE INDEX IF NOT EXISTS policy_signature_user_fk_idx ON policy_signature (user_id);
CREATE INDEX IF NOT EXISTS policy_signature_employee_fk_idx ON policy_signature (employee_id);
CREATE INDEX IF NOT EXISTS policy_signature_document_fk_idx ON policy_signature (signature_document_id);

CREATE TABLE IF NOT EXISTS policy_acknowledgement (
  policy_acknowledgement_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_version_id uuid NOT NULL REFERENCES policy_version(policy_version_id) ON DELETE RESTRICT,
  employee_id uuid NOT NULL REFERENCES employee(employee_id) ON DELETE RESTRICT,
  acknowledged_at timestamptz,
  content_hash text,
  known_device_id uuid REFERENCES known_device(known_device_id) ON DELETE SET NULL,
  reminded_at timestamptz,
  deferred_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS policy_acknowledgement_once_uq
  ON policy_acknowledgement (policy_version_id, employee_id);
CREATE INDEX IF NOT EXISTS policy_acknowledgement_employee_fk_idx ON policy_acknowledgement (employee_id);
CREATE INDEX IF NOT EXISTS policy_acknowledgement_known_device_fk_idx ON policy_acknowledgement (known_device_id);
CREATE OR REPLACE TRIGGER policy_acknowledgement_set_updated_at BEFORE UPDATE ON policy_acknowledgement
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- DOWN
DROP TRIGGER IF EXISTS policy_acknowledgement_set_updated_at ON policy_acknowledgement;
DROP TABLE IF EXISTS policy_acknowledgement;
DROP TABLE IF EXISTS policy_signature;
DROP TABLE IF EXISTS policy_audience;
DROP TRIGGER IF EXISTS policy_version_set_updated_at ON policy_version;
DROP TABLE IF EXISTS policy_version;
DROP TRIGGER IF EXISTS policy_set_updated_at ON policy;
DROP TABLE IF EXISTS policy;
