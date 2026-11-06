-- M7 partnership categories (their agreement templates, delivery checklists and custom fields) and leads (docs/guides/partnerships.md §4.2, §6.3, §6.4).
--
--   partner_category                 MyCity's partnership types (Event, Hospitality, Vendor...), entered on
--                                    Partnerships · Categories or by Start From Tracker; never seeded (A26)
--   partner_category_template        which agreement templates a category offers; the wording is
--                                    template_version's (one document engine), named by its key
--   partner_category_checklist_item  what MyCity delivers on a signed deal of the category (§6.7)
--   partnership_field                a custom field for leads, partners or deals, of one category or all (§6.3)
--   lead                             an organisation before its deal is signed; its status is read from
--                                    its deal's stage by the service (§6.4), never typed
-- UP
CREATE TABLE IF NOT EXISTS partner_category (
  partner_category_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- One spelling a category: "Event" and "event" are the same type.
  name citext NOT NULL UNIQUE,
  description text,
  default_commission_pct numeric(5,2) CHECK (default_commission_pct BETWEEN 0 AND 100),
  default_validity_days integer CHECK (default_validity_days > 0),
  -- Analytics counts this category's leads as vendor leads (§6.18).
  counts_as_vendor boolean NOT NULL DEFAULT false,
  display_order integer,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER partner_category_set_updated_at BEFORE UPDATE ON partner_category
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS partner_category_template (
  partner_category_template_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_category_id uuid NOT NULL REFERENCES partner_category(partner_category_id) ON DELETE CASCADE,
  -- A key of template_version (kind document): the wording lives there, versioned.
  template_key citext NOT NULL,
  kind text NOT NULL CHECK (kind IN ('deal_merchant', 'mou', 'service_agreement', 'contract')),
  label text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  -- MyCity signs too.
  countersigned boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_category_template_key_uq UNIQUE (partner_category_id, template_key)
);

-- One default a category and kind; Generate Agreement picks it.
CREATE UNIQUE INDEX IF NOT EXISTS partner_category_template_default_uq
  ON partner_category_template (partner_category_id, kind) WHERE is_default AND active;

CREATE OR REPLACE TRIGGER partner_category_template_set_updated_at BEFORE UPDATE ON partner_category_template
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS partner_category_checklist_item (
  partner_category_checklist_item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_category_id uuid NOT NULL REFERENCES partner_category(partner_category_id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 120),
  description text,
  -- Due `due_days` after signing, or before the event's start.
  due_from text NOT NULL CHECK (due_from IN ('signing', 'event_start')),
  due_days integer NOT NULL CHECK (due_days >= 0),
  position integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS partner_category_checklist_item_category_idx
  ON partner_category_checklist_item (partner_category_id, position);

CREATE OR REPLACE TRIGGER partner_category_checklist_item_set_updated_at BEFORE UPDATE ON partner_category_checklist_item
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS partnership_field (
  partnership_field_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- snake_case from the label, never changed: the key of every record's `custom` value.
  key text NOT NULL UNIQUE CHECK (key ~ '^[a-z][a-z0-9_]{0,59}$'),
  label text NOT NULL,
  field_type text NOT NULL
    CHECK (field_type IN ('text', 'long_text', 'number', 'money', 'date', 'pick', 'multi_pick', 'yes_no', 'url')),
  -- The choices of a pick: a JSON array of strings.
  options jsonb,
  applies_to text NOT NULL CHECK (applies_to IN ('lead', 'partner', 'deal')),
  -- Null: every category.
  partner_category_id uuid REFERENCES partner_category(partner_category_id) ON DELETE RESTRICT,
  filterable boolean NOT NULL DEFAULT false,
  position integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partnership_field_pick_options CHECK (field_type NOT IN ('pick', 'multi_pick') OR jsonb_typeof(options) = 'array')
);

CREATE INDEX IF NOT EXISTS partnership_field_category_idx ON partnership_field (partner_category_id);

CREATE OR REPLACE TRIGGER partnership_field_set_updated_at BEFORE UPDATE ON partnership_field
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS lead (
  lead_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number citext NOT NULL UNIQUE,
  name text NOT NULL,
  partner_category_id uuid REFERENCES partner_category(partner_category_id) ON DELETE RESTRICT,
  industry text,
  -- With `cities`, the lead's region cities are place rows (owner lead.cities).
  region_scope text CHECK (region_scope IN ('cities', 'national', 'africa', 'worldwide')),
  website text,
  objective text,
  -- A lead_source code.
  source text,
  owner_id uuid REFERENCES employee(employee_id) ON DELETE RESTRICT,
  identified_on date,
  -- partnership_impact codes.
  impact text[],
  impact_rating text CHECK (impact_rating IN ('high', 'medium', 'low')),
  impact_note text,
  comments text,
  custom jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'qualified', 'lost', 'converted')),
  lost_reason text,
  converted_partner_id uuid REFERENCES partner(partner_id) ON DELETE RESTRICT,
  converted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_lost_reason CHECK (status <> 'lost' OR lost_reason IS NOT NULL),
  CONSTRAINT lead_converted_partner CHECK (status <> 'converted' OR converted_partner_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS lead_owner_idx ON lead (owner_id);
CREATE INDEX IF NOT EXISTS lead_category_idx ON lead (partner_category_id);
CREATE INDEX IF NOT EXISTS lead_status_idx ON lead (status);
CREATE INDEX IF NOT EXISTS lead_converted_partner_idx ON lead (converted_partner_id);
CREATE INDEX IF NOT EXISTS lead_identified_on_idx ON lead (identified_on);
CREATE INDEX IF NOT EXISTS lead_custom_idx ON lead USING gin (custom);
CREATE INDEX IF NOT EXISTS lead_name_trgm_idx ON lead USING gin (search_fold(name) gin_trgm_ops);

CREATE OR REPLACE TRIGGER lead_set_updated_at BEFORE UPDATE ON lead
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- DOWN
DROP TRIGGER IF EXISTS lead_set_updated_at ON lead;
DROP INDEX IF EXISTS lead_name_trgm_idx;
DROP INDEX IF EXISTS lead_custom_idx;
DROP INDEX IF EXISTS lead_identified_on_idx;
DROP INDEX IF EXISTS lead_converted_partner_idx;
DROP INDEX IF EXISTS lead_status_idx;
DROP INDEX IF EXISTS lead_category_idx;
DROP INDEX IF EXISTS lead_owner_idx;
DROP TABLE IF EXISTS lead;
DROP TRIGGER IF EXISTS partnership_field_set_updated_at ON partnership_field;
DROP INDEX IF EXISTS partnership_field_category_idx;
DROP TABLE IF EXISTS partnership_field;
DROP TRIGGER IF EXISTS partner_category_checklist_item_set_updated_at ON partner_category_checklist_item;
DROP INDEX IF EXISTS partner_category_checklist_item_category_idx;
DROP TABLE IF EXISTS partner_category_checklist_item;
DROP TRIGGER IF EXISTS partner_category_template_set_updated_at ON partner_category_template;
DROP INDEX IF EXISTS partner_category_template_default_uq;
DROP TABLE IF EXISTS partner_category_template;
DROP TRIGGER IF EXISTS partner_category_set_updated_at ON partner_category;
DROP TABLE IF EXISTS partner_category;
