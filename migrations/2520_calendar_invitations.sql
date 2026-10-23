-- M2 My Workspace: invitations by email carry how many times their event has changed (docs/guides/workspace.md §4, §6 Invitations by email).
--
-- An attendee's calendar app keeps one entry per event (the same UID) and takes the copy with the
-- highest SEQUENCE, so each change and calling it off counts one up.

-- UP
ALTER TABLE calendar_event ADD COLUMN IF NOT EXISTS ics_sequence integer NOT NULL DEFAULT 0;

-- DOWN
ALTER TABLE calendar_event DROP COLUMN IF EXISTS ics_sequence; -- DESTRUCTIVE: rollback only; drops what UP added
