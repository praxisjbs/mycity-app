-- M1 Home: the date a deadline alert is about (home.md §6 Alerts, §11).
--
-- A person who clears a deadline alert (a document expiring, a confirmation or a contract coming
-- due) has dealt with that date. When the date changes the alert is raised again, so the shared
-- alert engine (src/shared/alerts/alerts.js) writes the date on each raise and compares it with
-- the one a closed alert was about. NULL for a count metric. No release has raised an alert yet,
-- so nothing is filled in.
-- UP
ALTER TABLE home_alert ADD COLUMN IF NOT EXISTS due_on date;

-- DOWN
ALTER TABLE home_alert DROP COLUMN IF EXISTS due_on;
