-- M1 home alerts made to accept what the shared alerts code writes (src/shared/alerts/alerts.js).
--
-- alerts.raise() takes an optional trigger (NULL when the caller names none) and returns over_by
-- as a two-place figure ("1.00"), the shape the Home alert list shows. 1000 made trigger
-- required and over_by an unscaled numeric, which returns "1".
--
-- DESTRUCTIVE: over_by is retyped to numeric(18,2); a value with more than two places is rounded.
-- No release has raised an alert yet.
-- UP
ALTER TABLE home_alert ALTER COLUMN trigger DROP NOT NULL;
ALTER TABLE home_alert ALTER COLUMN over_by TYPE numeric(18,2);

-- DOWN
ALTER TABLE home_alert ALTER COLUMN over_by TYPE numeric;
ALTER TABLE home_alert ALTER COLUMN trigger SET NOT NULL;
