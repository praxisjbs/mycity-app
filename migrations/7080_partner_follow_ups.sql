-- M7 a quiet partner's or lead's follow-up, one a quiet spell (docs/guides/partnerships.md §6.12).
--
--   partner_follow_up   the `partner-inactivity` job's record that it followed up a record's quiet
--                       spell: the spell's key `partner-inactivity:<record id>:<day of last contact>`
--                       (unique, so a morning run again, or a spell that lasts weeks, raises one
--                       follow-up), the record (a partner or a lead), the day the spell started, and
--                       the Workspace task it gave the owner (none when the owner has no login).
--                       Written only by partner_pipeline.inactivity. The outbox's own dedup keys are
--                       purged after days, which a spell outlasts, so the job keeps its own.
-- UP
CREATE TABLE IF NOT EXISTS partner_follow_up (
  partner_follow_up_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dedup_key text NOT NULL UNIQUE,
  partner_id uuid REFERENCES partner(partner_id) ON DELETE CASCADE,
  lead_id uuid REFERENCES lead(lead_id) ON DELETE CASCADE,
  -- The Lagos day of the last contact the spell runs from (or the day the record was made).
  last_contact_on date NOT NULL,
  task_id uuid REFERENCES task(task_id) ON DELETE SET NULL,
  raised_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_follow_up_one_record CHECK (num_nonnulls(partner_id, lead_id) = 1)
);

CREATE INDEX IF NOT EXISTS partner_follow_up_partner_idx ON partner_follow_up (partner_id);
CREATE INDEX IF NOT EXISTS partner_follow_up_lead_idx ON partner_follow_up (lead_id);
CREATE INDEX IF NOT EXISTS partner_follow_up_task_idx ON partner_follow_up (task_id);

CREATE OR REPLACE TRIGGER partner_follow_up_set_updated_at BEFORE UPDATE ON partner_follow_up
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- DOWN
DROP TRIGGER IF EXISTS partner_follow_up_set_updated_at ON partner_follow_up;
DROP INDEX IF EXISTS partner_follow_up_task_idx;
DROP INDEX IF EXISTS partner_follow_up_lead_idx;
DROP INDEX IF EXISTS partner_follow_up_partner_idx;
DROP TABLE IF EXISTS partner_follow_up;
