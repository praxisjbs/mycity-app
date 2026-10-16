-- M0 error_event accepts an error reported with no extra detail (src/shared/observability/error-reporter.js).
--
-- The reporter writes extra as NULL when the caller passes none, and swallows its own failure so
-- that reporting an error can never raise another. With 0030's NOT NULL every such error was
-- silently lost. Found in the Postgres log of the integration run in CI.
-- UP
ALTER TABLE error_event ALTER COLUMN extra DROP NOT NULL;

-- DOWN
ALTER TABLE error_event ALTER COLUMN extra SET NOT NULL;
