-- M7 the documents of a lead or a partner, and partner.partner_type dropped (docs/guides/partnerships.md §4.2, §6.2, §6.4, §6.6).
--
--   partner_document        a vault document of a lead or a partner (one of the two): its kind (a
--                           partner_document_kind code), the deal it is about, and where it came from:
--                           Upload Document, a proposal, an agreement, or the signed copy that evidences
--                           a signing (§6.4, §6.6). The vault's row names this row as its entity
--                           (`partner_document`), so a lead's documents follow it to its partner when
--                           this row is re-pointed, and the vault is never rewritten.
--   partner.partner_type    copied into partner_category by 7020 and read by nothing since M7 PR 1:
--                           dropped one release later, as docs/MIGRATIONS.md §8 asks.
-- UP
CREATE TABLE IF NOT EXISTS partner_document (
  partner_document_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL UNIQUE REFERENCES document(document_id) ON DELETE CASCADE,
  partner_id uuid REFERENCES partner(partner_id) ON DELETE RESTRICT,
  lead_id uuid REFERENCES lead(lead_id) ON DELETE RESTRICT,
  deal_id uuid REFERENCES partnership_opportunity(partnership_opportunity_id) ON DELETE SET NULL,
  -- A partner_document_kind code (MyCity's list); null for a signed copy.
  kind text,
  origin text NOT NULL DEFAULT 'upload' CHECK (origin IN ('upload', 'proposal', 'agreement', 'signed_copy')),
  attached_by uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_document_one_record CHECK (num_nonnulls(partner_id, lead_id) = 1)
);

CREATE INDEX IF NOT EXISTS partner_document_partner_idx ON partner_document (partner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS partner_document_lead_idx ON partner_document (lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS partner_document_deal_idx ON partner_document (deal_id);
CREATE INDEX IF NOT EXISTS partner_document_attached_by_idx ON partner_document (attached_by);

CREATE OR REPLACE TRIGGER partner_document_set_updated_at BEFORE UPDATE ON partner_document
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- DESTRUCTIVE: partner.partner_type, a copy of each partner's category name since 7020; nothing has read or written it since M7 PR 1.
ALTER TABLE partner DROP COLUMN IF EXISTS partner_type;

-- DOWN
-- The type comes back from each partner's category, as 7020 copied it the other way.
ALTER TABLE partner ADD COLUMN IF NOT EXISTS partner_type text;
UPDATE partner p
   SET partner_type = COALESCE((SELECT lower(c.name::text) FROM partner_category c WHERE c.partner_category_id = p.partner_category_id), 'other')
 WHERE p.partner_type IS NULL;
DROP TRIGGER IF EXISTS partner_document_set_updated_at ON partner_document;
DROP INDEX IF EXISTS partner_document_attached_by_idx;
DROP INDEX IF EXISTS partner_document_deal_idx;
DROP INDEX IF EXISTS partner_document_lead_idx;
DROP INDEX IF EXISTS partner_document_partner_idx;
DROP TABLE IF EXISTS partner_document;
