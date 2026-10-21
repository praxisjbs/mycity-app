-- M1 Staff Community's media and links (docs/guides/community.md §3 steps 17 and 18, §4).
--
--   document.page_count       a PDF's pages, counted by media-derive when it draws the first page
--                             (the picture itself is a document_variant, webp-960 and webp-320)
--   community_link_preview    one card per address: what the page says about itself, fetched by
--                             the server, its picture copied into the vault; a ready card is used
--                             for a week, an empty or failed one is tried again after an hour
--   community_message         the first link's card, shared by every message that posts it
-- UP
ALTER TABLE document ADD COLUMN IF NOT EXISTS page_count integer;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_page_count_check') THEN
    ALTER TABLE document ADD CONSTRAINT document_page_count_check CHECK (page_count IS NULL OR page_count >= 1);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS community_link_preview (
  community_link_preview_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url text NOT NULL CHECK (char_length(url) BETWEEN 4 AND 2048),
  status text NOT NULL CHECK (status IN ('ready', 'empty', 'failed')),
  site_name text,
  title text,
  description text,
  image_document_id uuid REFERENCES document(document_id) ON DELETE SET NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS community_link_preview_url_uq ON community_link_preview (url);
CREATE INDEX IF NOT EXISTS community_link_preview_image_document_id_fk_idx ON community_link_preview (image_document_id);
CREATE OR REPLACE TRIGGER community_link_preview_set_updated_at BEFORE UPDATE ON community_link_preview
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE community_message ADD COLUMN IF NOT EXISTS community_link_preview_id uuid
  REFERENCES community_link_preview(community_link_preview_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS community_message_community_link_preview_id_fk_idx ON community_message (community_link_preview_id);

-- DOWN
DROP INDEX IF EXISTS community_message_community_link_preview_id_fk_idx;
-- DESTRUCTIVE: rolling back forgets which card each message showed; the messages keep their links.
ALTER TABLE community_message DROP COLUMN IF EXISTS community_link_preview_id;
DROP TRIGGER IF EXISTS community_link_preview_set_updated_at ON community_link_preview;
DROP INDEX IF EXISTS community_link_preview_image_document_id_fk_idx;
DROP INDEX IF EXISTS community_link_preview_url_uq;
-- DESTRUCTIVE: rolling back forgets every fetched card; their pictures stay in the vault.
DROP TABLE IF EXISTS community_link_preview;
ALTER TABLE document DROP CONSTRAINT IF EXISTS document_page_count_check;
-- DESTRUCTIVE: rolling back forgets the page counts; a re-derive counts them again.
ALTER TABLE document DROP COLUMN IF EXISTS page_count;
