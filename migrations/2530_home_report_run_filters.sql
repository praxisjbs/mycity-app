-- M2: a report run keeps the filters it was asked with, so My Workspace · Analytics' Export builds each file with its own period (docs/guides/workspace.md §6, docs/guides/home.md §4).
--
-- A personal export's report (the person's own Workspace Analytics) holds one set of filters, but
-- each press can ask for another period. Kept on the run, a file is built with the period it was
-- pressed for, and a run still waiting never holds up a press for another period. Null on every
-- other run, which reads its report's filters as before (reports.generate). Additive and nullable:
-- every writer of home_report_run is reports.repo insertRun, which supplies it or leaves it null.
-- Changing home_report_run (1150, Home, TB) is reviewed by its owner on this PR (MIGRATIONS §1.3).

-- UP
ALTER TABLE home_report_run ADD COLUMN IF NOT EXISTS filters jsonb;

-- DOWN
ALTER TABLE home_report_run DROP COLUMN IF EXISTS filters; -- DESTRUCTIVE: rollback only; drops what UP added
