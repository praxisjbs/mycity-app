-- M0 document vault, generated artifacts and versioned templates.
-- UP
CREATE TABLE IF NOT EXISTS document (
  document_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_type text NOT NULL,
  title text NOT NULL,
  original_name text,
  storage_key text NOT NULL UNIQUE,
  mime text NOT NULL,
  bytes bigint NOT NULL CHECK (bytes >= 0),
  content_hash text,
  artifact_hash text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  supersedes_id uuid REFERENCES document(document_id),
  is_current boolean NOT NULL DEFAULT true,
  entity_type text,
  entity_id text,
  subject_employee_id uuid REFERENCES employee(employee_id),
  sensitivity text NOT NULL DEFAULT 'normal' CHECK (sensitivity IN ('normal', 'personal', 'restricted')),
  locked_at timestamptz,
  expires_on date,
  scan_status text NOT NULL DEFAULT 'pending' CHECK (scan_status IN ('clean', 'pending', 'infected', 'skipped')),
  source text NOT NULL CHECK (source IN ('upload', 'generated', 'import')),
  number text UNIQUE,
  template_key text,
  template_version integer,
  render_status text CHECK (render_status IS NULL OR render_status IN ('pending', 'done', 'failed')),
  render_html text,
  render_error text,
  width integer,
  height integer,
  duration_ms integer,
  uploaded_by uuid REFERENCES app_user(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((entity_type IS NULL) = (entity_id IS NULL))
);

CREATE TABLE IF NOT EXISTS document_variant (
  document_variant_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES document(document_id) ON DELETE CASCADE,
  kind text NOT NULL,
  storage_key text NOT NULL UNIQUE,
  mime text NOT NULL,
  bytes bigint NOT NULL CHECK (bytes >= 0),
  width integer,
  height integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, kind)
);

CREATE TABLE IF NOT EXISTS template (
  template_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('document', 'email')),
  key citext NOT NULL,
  name text NOT NULL,
  description text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, key)
);

CREATE TABLE IF NOT EXISTS template_version (
  template_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('document', 'email')),
  key citext NOT NULL,
  version integer NOT NULL CHECK (version >= 0),
  subject text,
  title text,
  body text NOT NULL,
  format text NOT NULL CHECK (format IN ('html', 'markdown')),
  created_by uuid REFERENCES app_user(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, key, version)
);

-- DOWN
DROP TABLE IF EXISTS template_version;
DROP TABLE IF EXISTS template;
DROP TABLE IF EXISTS document_variant;
DROP TABLE IF EXISTS document;
