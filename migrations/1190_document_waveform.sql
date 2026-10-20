-- M1 a voice note's waveform (docs/guides/community.md §3 step 8, §4).
--
-- The worker measures a voice note's loudness when it transcodes it (services/media/av-pipeline.js):
-- 48 bars, each 0 to 100 against the loudest, so the bubble draws the sound itself rather than a
-- fixed shape, before a byte of the note is fetched. Null until the note is measured.
-- UP
ALTER TABLE document ADD COLUMN IF NOT EXISTS waveform smallint[];
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_waveform_check') THEN
    ALTER TABLE document ADD CONSTRAINT document_waveform_check CHECK (
      waveform IS NULL
      OR (cardinality(waveform) BETWEEN 1 AND 64 AND 0 <= ALL (waveform) AND 100 >= ALL (waveform)));
  END IF;
END $$;

-- DOWN
ALTER TABLE document DROP CONSTRAINT IF EXISTS document_waveform_check;
-- DESTRUCTIVE: rolling back forgets the measured waveforms; media-derive measures them again.
ALTER TABLE document DROP COLUMN IF EXISTS waveform;
