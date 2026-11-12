-- M6 payroll, PR 10: every statutory version carries its legal source, or says it has none (docs/guides/payroll.md
-- §4.2, §6.12 rule 12, §13.1 item 31; TB, 11/11/2026). A version is the rows of one item starting on one day (a PAYE
-- table is one row a band); every row of it carries the same source:
--
--   source_title, source_section   the instrument and the section the figure comes from ("Pension Reform Act 2014",
--                                  "Section 4")
--   source_url                     where it is published, when there is a link (optional)
--   source_document_id             the instrument itself in the vault, claimed from the upload engine by the save as a
--                                  `statutory_source` document (optional; a removed document leaves the source as it was)
--   source_checked_on              the day a person read it
--   no_legal_source, no_source_reason   or: no instrument gives this figure, and why ("a company rule, not a law")
--
-- statutory_rate_source_check holds a row to exactly one of the two. Rows saved before this file had no source (staging
-- held a test PAYE band), so the UP marks them No Legal Source with the reason "Entered before sources were required"
-- before the check is added, and the check holds on every database. 6020 is merged and never edited (MIGRATIONS §3).
-- UP
ALTER TABLE statutory_rate ADD COLUMN IF NOT EXISTS source_title text;
ALTER TABLE statutory_rate ADD COLUMN IF NOT EXISTS source_section text;
ALTER TABLE statutory_rate ADD COLUMN IF NOT EXISTS source_url text;
ALTER TABLE statutory_rate ADD COLUMN IF NOT EXISTS source_document_id uuid REFERENCES document(document_id) ON DELETE SET NULL;
ALTER TABLE statutory_rate ADD COLUMN IF NOT EXISTS source_checked_on date;
ALTER TABLE statutory_rate ADD COLUMN IF NOT EXISTS no_legal_source boolean NOT NULL DEFAULT false;
ALTER TABLE statutory_rate ADD COLUMN IF NOT EXISTS no_source_reason text;
CREATE INDEX IF NOT EXISTS statutory_rate_source_document_fk_idx ON statutory_rate (source_document_id);

-- A row with neither (saved before sources were required) is marked No Legal Source, so the check below holds.
UPDATE statutory_rate
   SET no_legal_source = true, no_source_reason = 'Entered before sources were required'
 WHERE no_legal_source = false AND source_title IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'statutory_rate_source_check') THEN
    ALTER TABLE statutory_rate ADD CONSTRAINT statutory_rate_source_check CHECK (
      (no_legal_source AND no_source_reason IS NOT NULL AND source_title IS NULL AND source_section IS NULL
        AND source_url IS NULL AND source_document_id IS NULL AND source_checked_on IS NULL)
      OR
      (NOT no_legal_source AND no_source_reason IS NULL AND source_title IS NOT NULL AND source_section IS NOT NULL
        AND source_checked_on IS NOT NULL)
    );
  END IF;
END $$;

-- DOWN
-- DESTRUCTIVE: the sources entered since this file are lost on the way down; the rates themselves stay.
ALTER TABLE statutory_rate DROP CONSTRAINT IF EXISTS statutory_rate_source_check;
DROP INDEX IF EXISTS statutory_rate_source_document_fk_idx;
ALTER TABLE statutory_rate DROP COLUMN IF EXISTS no_source_reason;
ALTER TABLE statutory_rate DROP COLUMN IF EXISTS no_legal_source;
ALTER TABLE statutory_rate DROP COLUMN IF EXISTS source_checked_on;
ALTER TABLE statutory_rate DROP COLUMN IF EXISTS source_document_id;
ALTER TABLE statutory_rate DROP COLUMN IF EXISTS source_url;
ALTER TABLE statutory_rate DROP COLUMN IF EXISTS source_section;
ALTER TABLE statutory_rate DROP COLUMN IF EXISTS source_title;
