-- M7 partners, contacts, deals, their history and interactions as the guide has them, with a deal's options, team, deliverables, returns and linked mail (docs/guides/partnerships.md §4.2).
--
--   partner                    gains its category, region scope, logo, since, lead, custom values and
--                              closing; status is active, dormant or closed (§6.6). `partner_type` is
--                              copied into a category where rows hold one and stops being required;
--                              nothing reads it after this release, and it is dropped one release later
--                              (docs/MIGRATIONS.md §8)
--   partner_contact            a person at a lead or a partner (one of the two), with several phones
--   partnership_opportunity    the deal: on a lead or a partner, its event, health and blockers, terms,
--                              validity and custom values; status open, live, completed or lost; the
--                              first stage of MyCity's list is set by the service, not a default
--   partnership_stage_history  stage and health lines, with where each came from
--   partner_interaction        on a lead or a partner (one of the two); a note is a type
--   deal_option                a priced line of a deal, up to five (the Deal Merchant Agreement's grid)
--   deal_member                the deal's team
--   deal_deliverable           a delivery checklist item raised as a Workspace task (§6.7)
--   deal_return                a deal's month of returns and downloads (§6.14)
--   partner_mail_thread        a mail thread linked to a lead or partner (§6.15)
--
-- Existing rows are kept: a status outside the new lists becomes the nearest the guide has (a
-- partner `prospect` is `dormant`, a deal's other status `open`, an unknown interaction a `note`).
-- UP

/* ------------------------------------------------------------------ *
 * partner
 * ------------------------------------------------------------------ */
ALTER TABLE partner
  ADD COLUMN IF NOT EXISTS legal_name text,
  ADD COLUMN IF NOT EXISTS partner_category_id uuid REFERENCES partner_category(partner_category_id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS region_scope text CHECK (region_scope IN ('cities', 'national', 'africa', 'worldwide')),
  ADD COLUMN IF NOT EXISTS logo_document_id uuid REFERENCES document(document_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS since date,
  ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES lead(lead_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS custom jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS close_reason text;

-- A partner type held by a row becomes a category of that name (7099's label where it had one).
INSERT INTO partner_category (name)
SELECT DISTINCT COALESCE(rv.label, initcap(replace(p.partner_type, '_', ' ')))
  FROM partner p
  LEFT JOIN reference_value rv ON rv.domain = 'partner_type' AND rv.code = p.partner_type
 WHERE p.partner_category_id IS NULL AND NULLIF(btrim(p.partner_type), '') IS NOT NULL
ON CONFLICT (name) DO NOTHING;

UPDATE partner p
   SET partner_category_id = c.partner_category_id
  FROM partner_category c
 WHERE p.partner_category_id IS NULL
   AND NULLIF(btrim(p.partner_type), '') IS NOT NULL
   AND c.name = COALESCE((SELECT rv.label FROM reference_value rv WHERE rv.domain = 'partner_type' AND rv.code = p.partner_type),
                         initcap(replace(p.partner_type, '_', ' ')))::citext;

ALTER TABLE partner ALTER COLUMN partner_type DROP NOT NULL;

UPDATE partner SET status = 'dormant' WHERE status NOT IN ('active', 'dormant', 'closed');
ALTER TABLE partner ALTER COLUMN status SET DEFAULT 'dormant';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'partner_status_check' AND conrelid = 'partner'::regclass) THEN
    ALTER TABLE partner ADD CONSTRAINT partner_status_check CHECK (status IN ('active', 'dormant', 'closed'));
  END IF;
END $$;

-- Home asked for the owner's index (home.md §4.1).
CREATE INDEX IF NOT EXISTS partner_owner_idx ON partner (owner_id);
CREATE INDEX IF NOT EXISTS partner_status_idx ON partner (status);
CREATE INDEX IF NOT EXISTS partner_category_idx ON partner (partner_category_id);
CREATE INDEX IF NOT EXISTS partner_lead_idx ON partner (lead_id);
CREATE INDEX IF NOT EXISTS partner_logo_idx ON partner (logo_document_id);
CREATE INDEX IF NOT EXISTS partner_custom_idx ON partner USING gin (custom);
CREATE INDEX IF NOT EXISTS partner_name_trgm_idx ON partner USING gin (search_fold(name) gin_trgm_ops);

/* ------------------------------------------------------------------ *
 * partner_contact
 * ------------------------------------------------------------------ */
ALTER TABLE partner_contact ALTER COLUMN partner_id DROP NOT NULL;
ALTER TABLE partner_contact
  ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES lead(lead_id) ON DELETE CASCADE,
  -- Every number the person gave; `phone` stays the first.
  ADD COLUMN IF NOT EXISTS phones text[],
  ADD COLUMN IF NOT EXISTS signatory boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'partner_contact_one_record' AND conrelid = 'partner_contact'::regclass) THEN
    ALTER TABLE partner_contact ADD CONSTRAINT partner_contact_one_record CHECK (num_nonnulls(partner_id, lead_id) = 1);
  END IF;
END $$;

-- One address a record (7000 keeps the partner's).
CREATE UNIQUE INDEX IF NOT EXISTS partner_contact_lead_email_uq
  ON partner_contact (lead_id, email) WHERE email IS NOT NULL AND lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS partner_contact_partner_idx ON partner_contact (partner_id);
CREATE INDEX IF NOT EXISTS partner_contact_lead_idx ON partner_contact (lead_id);

/* ------------------------------------------------------------------ *
 * partnership_opportunity: the deal
 * ------------------------------------------------------------------ */
ALTER TABLE partnership_opportunity ALTER COLUMN partner_id DROP NOT NULL;
ALTER TABLE partnership_opportunity ALTER COLUMN stage DROP DEFAULT;
ALTER TABLE partnership_opportunity
  ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES lead(lead_id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS event_title text,
  ADD COLUMN IF NOT EXISTS event_starts_on date,
  ADD COLUMN IF NOT EXISTS event_ends_on date,
  ADD COLUMN IF NOT EXISTS expected_attendance integer CHECK (expected_attendance >= 0),
  ADD COLUMN IF NOT EXISTS objective text,
  -- A deal_health code.
  ADD COLUMN IF NOT EXISTS health text NOT NULL DEFAULT 'on_track' CHECK (health IN ('on_track', 'follow_up_required', 'stalled')),
  ADD COLUMN IF NOT EXISTS blockers text,
  ADD COLUMN IF NOT EXISTS next_action text,
  ADD COLUMN IF NOT EXISTS next_action_on date,
  ADD COLUMN IF NOT EXISTS commission_pct numeric(5,2) CHECK (commission_pct BETWEEN 0 AND 100),
  -- The rate differs from the category's default; shown on the deal and the approval card.
  ADD COLUMN IF NOT EXISTS commission_deviates boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS validity_days integer CHECK (validity_days > 0),
  ADD COLUMN IF NOT EXISTS valid_until date,
  ADD COLUMN IF NOT EXISTS identified_on date,
  ADD COLUMN IF NOT EXISTS signed_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS close_reason text,
  ADD COLUMN IF NOT EXISTS impact text[],
  ADD COLUMN IF NOT EXISTS impact_rating text CHECK (impact_rating IN ('high', 'medium', 'low')),
  ADD COLUMN IF NOT EXISTS impact_note text,
  ADD COLUMN IF NOT EXISTS comments text,
  ADD COLUMN IF NOT EXISTS custom jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE partnership_opportunity SET status = 'open' WHERE status NOT IN ('open', 'live', 'completed', 'lost');

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'partnership_opportunity_status_check' AND conrelid = 'partnership_opportunity'::regclass) THEN
    ALTER TABLE partnership_opportunity ADD CONSTRAINT partnership_opportunity_status_check
      CHECK (status IN ('open', 'live', 'completed', 'lost'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'partnership_opportunity_on_a_record' AND conrelid = 'partnership_opportunity'::regclass) THEN
    ALTER TABLE partnership_opportunity ADD CONSTRAINT partnership_opportunity_on_a_record
      CHECK (partner_id IS NOT NULL OR lead_id IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'partnership_opportunity_event_dates' AND conrelid = 'partnership_opportunity'::regclass) THEN
    ALTER TABLE partnership_opportunity ADD CONSTRAINT partnership_opportunity_event_dates
      CHECK (event_ends_on IS NULL OR event_starts_on IS NULL OR event_ends_on >= event_starts_on);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'partnership_opportunity_stalled_blockers' AND conrelid = 'partnership_opportunity'::regclass) THEN
    ALTER TABLE partnership_opportunity ADD CONSTRAINT partnership_opportunity_stalled_blockers
      CHECK (health <> 'stalled' OR blockers IS NOT NULL);
  END IF;
END $$;

-- Home asked for (owner_id, status) (home.md §4.1).
CREATE INDEX IF NOT EXISTS partnership_opportunity_owner_status_idx ON partnership_opportunity (owner_id, status);
CREATE INDEX IF NOT EXISTS partnership_opportunity_stage_idx ON partnership_opportunity (stage);
CREATE INDEX IF NOT EXISTS partnership_opportunity_lead_idx ON partnership_opportunity (lead_id);
CREATE INDEX IF NOT EXISTS partnership_opportunity_partner_idx ON partnership_opportunity (partner_id);
CREATE INDEX IF NOT EXISTS partnership_opportunity_custom_idx ON partnership_opportunity USING gin (custom);

/* ------------------------------------------------------------------ *
 * partnership_stage_history: append only (no update path in the repo)
 * ------------------------------------------------------------------ */
ALTER TABLE partnership_stage_history
  -- For a health line, from_stage and to_stage hold deal_health codes.
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'stage' CHECK (kind IN ('stage', 'health')),
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'person'
    CHECK (source IN ('person', 'signature', 'import', 'system', 'conversion'));

CREATE INDEX IF NOT EXISTS partnership_stage_history_deal_idx
  ON partnership_stage_history (partnership_opportunity_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS partnership_stage_history_changed_by_idx ON partnership_stage_history (changed_by);

/* ------------------------------------------------------------------ *
 * partner_interaction
 * ------------------------------------------------------------------ */
ALTER TABLE partner_interaction ALTER COLUMN partner_id DROP NOT NULL;
ALTER TABLE partner_interaction
  ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES lead(lead_id) ON DELETE RESTRICT;

UPDATE partner_interaction SET interaction_type = 'note'
 WHERE interaction_type NOT IN ('call', 'meeting', 'email', 'visit', 'note');

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'partner_interaction_one_record' AND conrelid = 'partner_interaction'::regclass) THEN
    ALTER TABLE partner_interaction ADD CONSTRAINT partner_interaction_one_record CHECK (num_nonnulls(partner_id, lead_id) = 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'partner_interaction_type_check' AND conrelid = 'partner_interaction'::regclass) THEN
    ALTER TABLE partner_interaction ADD CONSTRAINT partner_interaction_type_check
      CHECK (interaction_type IN ('call', 'meeting', 'email', 'visit', 'note'));
  END IF;
END $$;

-- Home asked for (partner_id, occurred_at DESC) (home.md §4.1).
CREATE INDEX IF NOT EXISTS partner_interaction_partner_occurred_idx ON partner_interaction (partner_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS partner_interaction_lead_occurred_idx ON partner_interaction (lead_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS partner_interaction_deal_idx ON partner_interaction (partnership_opportunity_id);
CREATE INDEX IF NOT EXISTS partner_interaction_contact_idx ON partner_interaction (contact_id);
CREATE INDEX IF NOT EXISTS partner_interaction_owner_idx ON partner_interaction (owner_id);
-- A linked mail message is logged once (§6.15).
CREATE UNIQUE INDEX IF NOT EXISTS partner_interaction_mail_message_uq
  ON partner_interaction (mail_message_id) WHERE mail_message_id IS NOT NULL;

/* ------------------------------------------------------------------ *
 * A deal's options, team, deliverables and returns
 * ------------------------------------------------------------------ */
CREATE TABLE IF NOT EXISTS deal_option (
  deal_option_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES partnership_opportunity(partnership_opportunity_id) ON DELETE CASCADE,
  position smallint NOT NULL CHECK (position BETWEEN 1 AND 5),
  label text NOT NULL,
  original_price numeric(18,2),
  discount_pct numeric(5,2) CHECK (discount_pct BETWEEN 0 AND 100),
  deal_price numeric(18,2),
  -- A price that is not money: "App Download", "Free Entry".
  price_note text,
  commission_amount numeric(18,2),
  merchant_take numeric(18,2),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT deal_option_position_uq UNIQUE (deal_id, position)
);

CREATE OR REPLACE TRIGGER deal_option_set_updated_at BEFORE UPDATE ON deal_option
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS deal_member (
  deal_member_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES partnership_opportunity(partnership_opportunity_id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employee(employee_id) ON DELETE RESTRICT,
  role text NOT NULL DEFAULT 'support' CHECK (role IN ('owner', 'lead', 'support', 'on_ground')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT deal_member_uq UNIQUE (deal_id, employee_id)
);

CREATE INDEX IF NOT EXISTS deal_member_employee_idx ON deal_member (employee_id);

CREATE OR REPLACE TRIGGER deal_member_set_updated_at BEFORE UPDATE ON deal_member
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS deal_deliverable (
  deal_deliverable_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES partnership_opportunity(partnership_opportunity_id) ON DELETE CASCADE,
  -- Null: added by hand on the Deals tab.
  checklist_item_id uuid REFERENCES partner_category_checklist_item(partner_category_checklist_item_id) ON DELETE SET NULL,
  title text NOT NULL,
  -- Its status is its task's.
  task_id uuid REFERENCES task(task_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- A checklist item is raised once a deal.
CREATE UNIQUE INDEX IF NOT EXISTS deal_deliverable_item_uq
  ON deal_deliverable (deal_id, checklist_item_id) WHERE checklist_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS deal_deliverable_deal_idx ON deal_deliverable (deal_id);
CREATE INDEX IF NOT EXISTS deal_deliverable_item_idx ON deal_deliverable (checklist_item_id);
CREATE INDEX IF NOT EXISTS deal_deliverable_task_idx ON deal_deliverable (task_id);

CREATE OR REPLACE TRIGGER deal_deliverable_set_updated_at BEFORE UPDATE ON deal_deliverable
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS deal_return (
  deal_return_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES partnership_opportunity(partnership_opportunity_id) ON DELETE RESTRICT,
  -- The 1st of the month the figures are for.
  month date NOT NULL CHECK (date_part('day', month) = 1),
  units_sold integer CHECK (units_sold >= 0),
  gross_sales numeric(18,2),
  mycity_commission numeric(18,2),
  paid_to_partner numeric(18,2),
  downloads integer CHECK (downloads >= 0),
  note text,
  source text NOT NULL DEFAULT 'entered' CHECK (source IN ('entered', 'import')),
  import_batch_id uuid REFERENCES import_batch(import_batch_id) ON DELETE SET NULL,
  entered_by uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- A month imported again replaces the deal's figures for it.
  CONSTRAINT deal_return_month_uq UNIQUE (deal_id, month)
);

CREATE INDEX IF NOT EXISTS deal_return_import_batch_idx ON deal_return (import_batch_id);
CREATE INDEX IF NOT EXISTS deal_return_entered_by_idx ON deal_return (entered_by);

CREATE OR REPLACE TRIGGER deal_return_set_updated_at BEFORE UPDATE ON deal_return
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

/* ------------------------------------------------------------------ *
 * A mail thread linked to a lead or a partner
 * ------------------------------------------------------------------ */
CREATE TABLE IF NOT EXISTS partner_mail_thread (
  partner_mail_thread_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mail_thread_id uuid NOT NULL UNIQUE REFERENCES mail_thread(mail_thread_id) ON DELETE CASCADE,
  partner_id uuid REFERENCES partner(partner_id) ON DELETE RESTRICT,
  lead_id uuid REFERENCES lead(lead_id) ON DELETE RESTRICT,
  deal_id uuid REFERENCES partnership_opportunity(partnership_opportunity_id) ON DELETE SET NULL,
  bound_by uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  bound_at timestamptz NOT NULL DEFAULT now(),
  unbound_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_mail_thread_one_record CHECK (num_nonnulls(partner_id, lead_id) = 1)
);

CREATE INDEX IF NOT EXISTS partner_mail_thread_partner_idx ON partner_mail_thread (partner_id);
CREATE INDEX IF NOT EXISTS partner_mail_thread_lead_idx ON partner_mail_thread (lead_id);
CREATE INDEX IF NOT EXISTS partner_mail_thread_deal_idx ON partner_mail_thread (deal_id);
CREATE INDEX IF NOT EXISTS partner_mail_thread_bound_by_idx ON partner_mail_thread (bound_by);

CREATE OR REPLACE TRIGGER partner_mail_thread_set_updated_at BEFORE UPDATE ON partner_mail_thread
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- DOWN
DROP TRIGGER IF EXISTS partner_mail_thread_set_updated_at ON partner_mail_thread;
DROP TABLE IF EXISTS partner_mail_thread;
DROP TRIGGER IF EXISTS deal_return_set_updated_at ON deal_return;
DROP TABLE IF EXISTS deal_return;
DROP TRIGGER IF EXISTS deal_deliverable_set_updated_at ON deal_deliverable;
DROP TABLE IF EXISTS deal_deliverable;
DROP TRIGGER IF EXISTS deal_member_set_updated_at ON deal_member;
DROP TABLE IF EXISTS deal_member;
DROP TRIGGER IF EXISTS deal_option_set_updated_at ON deal_option;
DROP TABLE IF EXISTS deal_option;

-- A lead's own interactions, deals and contacts go with the lead column: 7000 had no leads.
DROP INDEX IF EXISTS partner_interaction_mail_message_uq;
DROP INDEX IF EXISTS partner_interaction_owner_idx;
DROP INDEX IF EXISTS partner_interaction_contact_idx;
DROP INDEX IF EXISTS partner_interaction_deal_idx;
DROP INDEX IF EXISTS partner_interaction_lead_occurred_idx;
DROP INDEX IF EXISTS partner_interaction_partner_occurred_idx;
ALTER TABLE partner_interaction DROP CONSTRAINT IF EXISTS partner_interaction_type_check;
ALTER TABLE partner_interaction DROP CONSTRAINT IF EXISTS partner_interaction_one_record;
DELETE FROM partner_interaction WHERE partner_id IS NULL;
ALTER TABLE partner_interaction DROP COLUMN IF EXISTS lead_id;
ALTER TABLE partner_interaction ALTER COLUMN partner_id SET NOT NULL;

DROP INDEX IF EXISTS partnership_stage_history_changed_by_idx;
DROP INDEX IF EXISTS partnership_stage_history_deal_idx;
ALTER TABLE partnership_stage_history DROP COLUMN IF EXISTS source;
ALTER TABLE partnership_stage_history DROP COLUMN IF EXISTS kind;

DROP INDEX IF EXISTS partnership_opportunity_custom_idx;
DROP INDEX IF EXISTS partnership_opportunity_partner_idx;
DROP INDEX IF EXISTS partnership_opportunity_lead_idx;
DROP INDEX IF EXISTS partnership_opportunity_stage_idx;
DROP INDEX IF EXISTS partnership_opportunity_owner_status_idx;
ALTER TABLE partnership_opportunity DROP CONSTRAINT IF EXISTS partnership_opportunity_stalled_blockers;
ALTER TABLE partnership_opportunity DROP CONSTRAINT IF EXISTS partnership_opportunity_event_dates;
ALTER TABLE partnership_opportunity DROP CONSTRAINT IF EXISTS partnership_opportunity_on_a_record;
ALTER TABLE partnership_opportunity DROP CONSTRAINT IF EXISTS partnership_opportunity_status_check;
-- A lead's deals cannot stand without a partner: they go, with what hangs on them.
DELETE FROM partnership_stage_history h
 USING partnership_opportunity o
 WHERE o.partnership_opportunity_id = h.partnership_opportunity_id AND o.partner_id IS NULL;
UPDATE partner_interaction i SET partnership_opportunity_id = NULL
  FROM partnership_opportunity o
 WHERE o.partnership_opportunity_id = i.partnership_opportunity_id AND o.partner_id IS NULL;
DELETE FROM partnership_proposal pp
 USING partnership_opportunity o
 WHERE o.partnership_opportunity_id = pp.partnership_opportunity_id AND o.partner_id IS NULL;
DELETE FROM partnership_opportunity WHERE partner_id IS NULL;
ALTER TABLE partnership_opportunity
  DROP COLUMN IF EXISTS custom,
  DROP COLUMN IF EXISTS comments,
  DROP COLUMN IF EXISTS impact_note,
  DROP COLUMN IF EXISTS impact_rating,
  DROP COLUMN IF EXISTS impact,
  DROP COLUMN IF EXISTS close_reason,
  DROP COLUMN IF EXISTS completed_at,
  DROP COLUMN IF EXISTS signed_at,
  DROP COLUMN IF EXISTS identified_on,
  DROP COLUMN IF EXISTS valid_until,
  DROP COLUMN IF EXISTS validity_days,
  DROP COLUMN IF EXISTS commission_deviates,
  DROP COLUMN IF EXISTS commission_pct,
  DROP COLUMN IF EXISTS next_action_on,
  DROP COLUMN IF EXISTS next_action,
  DROP COLUMN IF EXISTS blockers,
  DROP COLUMN IF EXISTS health,
  DROP COLUMN IF EXISTS objective,
  DROP COLUMN IF EXISTS expected_attendance,
  DROP COLUMN IF EXISTS event_ends_on,
  DROP COLUMN IF EXISTS event_starts_on,
  DROP COLUMN IF EXISTS event_title,
  DROP COLUMN IF EXISTS lead_id;
ALTER TABLE partnership_opportunity ALTER COLUMN stage SET DEFAULT 'lead';
ALTER TABLE partnership_opportunity ALTER COLUMN partner_id SET NOT NULL;

DROP INDEX IF EXISTS partner_contact_lead_idx;
DROP INDEX IF EXISTS partner_contact_partner_idx;
DROP INDEX IF EXISTS partner_contact_lead_email_uq;
ALTER TABLE partner_contact DROP CONSTRAINT IF EXISTS partner_contact_one_record;
DELETE FROM partner_contact WHERE partner_id IS NULL;
ALTER TABLE partner_contact
  DROP COLUMN IF EXISTS signatory,
  DROP COLUMN IF EXISTS phones,
  DROP COLUMN IF EXISTS lead_id;
ALTER TABLE partner_contact ALTER COLUMN partner_id SET NOT NULL;

DROP INDEX IF EXISTS partner_name_trgm_idx;
DROP INDEX IF EXISTS partner_custom_idx;
DROP INDEX IF EXISTS partner_logo_idx;
DROP INDEX IF EXISTS partner_lead_idx;
DROP INDEX IF EXISTS partner_category_idx;
DROP INDEX IF EXISTS partner_status_idx;
DROP INDEX IF EXISTS partner_owner_idx;
ALTER TABLE partner DROP CONSTRAINT IF EXISTS partner_status_check;
ALTER TABLE partner ALTER COLUMN status SET DEFAULT 'prospect';
-- A partner made after this file has no type of its own: it takes its category's name back.
UPDATE partner p
   SET partner_type = COALESCE((SELECT lower(c.name::text) FROM partner_category c WHERE c.partner_category_id = p.partner_category_id), 'other')
 WHERE p.partner_type IS NULL;
ALTER TABLE partner ALTER COLUMN partner_type SET NOT NULL;
ALTER TABLE partner
  DROP COLUMN IF EXISTS close_reason,
  DROP COLUMN IF EXISTS closed_at,
  DROP COLUMN IF EXISTS custom,
  DROP COLUMN IF EXISTS lead_id,
  DROP COLUMN IF EXISTS since,
  DROP COLUMN IF EXISTS logo_document_id,
  DROP COLUMN IF EXISTS region_scope,
  DROP COLUMN IF EXISTS partner_category_id,
  DROP COLUMN IF EXISTS legal_name;
-- The categories this file made from partner types go with the column; 7010's DOWN drops the table.
