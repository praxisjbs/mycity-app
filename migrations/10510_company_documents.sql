-- M10 Document Centre: the company's own documents, in categories with an audience (docs/guides/document-centre.md §4, §6.4, §6.5).
--
--   document_category       MyCity's own list of categories. A name is unique without regard to case.
--                           Seen by everyone, or by the roles named on it. Archived, never deleted
--                           while in use. Never seeded outside staging (A26).
--   document_category_role  the roles of a `roles` audience; both keys, gone with the category or the
--                           role. A `roles` category names one at least: checked by the service.
--   company_document        one company document through all its versions: its number (DOC-0001,
--                           the vault's `document` scheme), the vault's current version
--                           (`document_id`), its category, title, description and tags. Its expiry
--                           is the vault's own `document.expires_on`, not a second column.
-- UP
CREATE TABLE IF NOT EXISTS document_category (
  document_category_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name citext NOT NULL UNIQUE,
  description text,
  audience text NOT NULL DEFAULT 'everyone' CHECK (audience IN ('everyone', 'roles')),
  archived_at timestamptz,
  created_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS document_category_created_by_fk_idx ON document_category (created_by);
CREATE INDEX IF NOT EXISTS document_category_created_at_idx ON document_category (created_at, document_category_id);
CREATE OR REPLACE TRIGGER document_category_set_updated_at BEFORE UPDATE ON document_category
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS document_category_role (
  document_category_id uuid NOT NULL REFERENCES document_category(document_category_id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES role(role_id) ON DELETE CASCADE,
  PRIMARY KEY (document_category_id, role_id)
);
CREATE INDEX IF NOT EXISTS document_category_role_role_fk_idx ON document_category_role (role_id);

CREATE TABLE IF NOT EXISTS company_document (
  company_document_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number citext NOT NULL UNIQUE,
  document_id uuid NOT NULL UNIQUE REFERENCES document(document_id) ON DELETE RESTRICT,
  document_category_id uuid NOT NULL REFERENCES document_category(document_category_id) ON DELETE RESTRICT,
  title text NOT NULL,
  description text,
  tags text[] NOT NULL DEFAULT '{}',
  archived_at timestamptz,
  archived_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  created_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_document_archived_check CHECK ((archived_at IS NULL) = (archived_by IS NULL))
);
CREATE INDEX IF NOT EXISTS company_document_category_fk_idx ON company_document (document_category_id);
CREATE INDEX IF NOT EXISTS company_document_archived_by_fk_idx ON company_document (archived_by);
CREATE INDEX IF NOT EXISTS company_document_created_by_fk_idx ON company_document (created_by);
CREATE INDEX IF NOT EXISTS company_document_tags_idx ON company_document USING gin (tags);
CREATE OR REPLACE TRIGGER company_document_set_updated_at BEFORE UPDATE ON company_document
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- DOWN
DROP TRIGGER IF EXISTS company_document_set_updated_at ON company_document;
DROP TRIGGER IF EXISTS document_category_set_updated_at ON document_category;
DROP TABLE IF EXISTS company_document;
DROP TABLE IF EXISTS document_category_role;
DROP TABLE IF EXISTS document_category;
