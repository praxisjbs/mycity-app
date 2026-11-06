-- M7 PR 2: a category template's asks (docs/guides/partnerships.md §4.2, §6.8).
--
--   partner_category_template.asks   the values a person gives when an agreement is generated from the
--                                    template ("How long is the service", "Opening hours"), each with its
--                                    key, label, type and, where MyCity's wording has one, its default;
--                                    the wording itself is template_version's. 7010 gave the template its
--                                    key, kind and flags and nowhere to keep these.
-- UP
ALTER TABLE partner_category_template
  ADD COLUMN IF NOT EXISTS asks jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'partner_category_template_asks_array') THEN
    ALTER TABLE partner_category_template
      ADD CONSTRAINT partner_category_template_asks_array CHECK (jsonb_typeof(asks) = 'array');
  END IF;
END $$;

-- DOWN
ALTER TABLE partner_category_template DROP CONSTRAINT IF EXISTS partner_category_template_asks_array;
ALTER TABLE partner_category_template DROP COLUMN IF EXISTS asks;
