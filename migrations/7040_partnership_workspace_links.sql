-- M7 a project, task or calendar event connected to a partner or a lead and one of its deals (docs/guides/partnerships.md §4.2, §6.16; docs/guides/workspace.md).
--
-- Written only through the Workspace services, from M7 PR 5 (Connect to Partner); until then nothing
-- writes or reads them. A record is connected to a partner or to a lead, never both; the deal is
-- that record's. Connecting never widens who may see the work (A24). On conversion the lead's
-- links move to its partner, through the Workspace services. M2's tables, changed for M7 with AJ's
-- review (docs/MIGRATIONS.md §1.3).
-- UP
ALTER TABLE project
  ADD COLUMN IF NOT EXISTS partner_id uuid REFERENCES partner(partner_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES lead(lead_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deal_id uuid REFERENCES partnership_opportunity(partnership_opportunity_id) ON DELETE SET NULL;

ALTER TABLE task
  ADD COLUMN IF NOT EXISTS partner_id uuid REFERENCES partner(partner_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES lead(lead_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deal_id uuid REFERENCES partnership_opportunity(partnership_opportunity_id) ON DELETE SET NULL;

ALTER TABLE calendar_event
  ADD COLUMN IF NOT EXISTS partner_id uuid REFERENCES partner(partner_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES lead(lead_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deal_id uuid REFERENCES partnership_opportunity(partnership_opportunity_id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_partner_or_lead' AND conrelid = 'project'::regclass) THEN
    ALTER TABLE project ADD CONSTRAINT project_partner_or_lead CHECK (partner_id IS NULL OR lead_id IS NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_partner_or_lead' AND conrelid = 'task'::regclass) THEN
    ALTER TABLE task ADD CONSTRAINT task_partner_or_lead CHECK (partner_id IS NULL OR lead_id IS NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'calendar_event_partner_or_lead' AND conrelid = 'calendar_event'::regclass) THEN
    ALTER TABLE calendar_event ADD CONSTRAINT calendar_event_partner_or_lead CHECK (partner_id IS NULL OR lead_id IS NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS project_partner_idx ON project (partner_id);
CREATE INDEX IF NOT EXISTS project_lead_idx ON project (lead_id);
CREATE INDEX IF NOT EXISTS project_deal_idx ON project (deal_id);
CREATE INDEX IF NOT EXISTS task_partner_idx ON task (partner_id);
CREATE INDEX IF NOT EXISTS task_lead_idx ON task (lead_id);
CREATE INDEX IF NOT EXISTS task_deal_idx ON task (deal_id);
CREATE INDEX IF NOT EXISTS calendar_event_partner_idx ON calendar_event (partner_id);
CREATE INDEX IF NOT EXISTS calendar_event_lead_idx ON calendar_event (lead_id);
CREATE INDEX IF NOT EXISTS calendar_event_deal_idx ON calendar_event (deal_id);

-- DOWN
DROP INDEX IF EXISTS calendar_event_deal_idx;
DROP INDEX IF EXISTS calendar_event_lead_idx;
DROP INDEX IF EXISTS calendar_event_partner_idx;
DROP INDEX IF EXISTS task_deal_idx;
DROP INDEX IF EXISTS task_lead_idx;
DROP INDEX IF EXISTS task_partner_idx;
DROP INDEX IF EXISTS project_deal_idx;
DROP INDEX IF EXISTS project_lead_idx;
DROP INDEX IF EXISTS project_partner_idx;
ALTER TABLE calendar_event DROP CONSTRAINT IF EXISTS calendar_event_partner_or_lead;
ALTER TABLE task DROP CONSTRAINT IF EXISTS task_partner_or_lead;
ALTER TABLE project DROP CONSTRAINT IF EXISTS project_partner_or_lead;
ALTER TABLE calendar_event
  DROP COLUMN IF EXISTS deal_id,
  DROP COLUMN IF EXISTS lead_id,
  DROP COLUMN IF EXISTS partner_id;
ALTER TABLE task
  DROP COLUMN IF EXISTS deal_id,
  DROP COLUMN IF EXISTS lead_id,
  DROP COLUMN IF EXISTS partner_id;
ALTER TABLE project
  DROP COLUMN IF EXISTS deal_id,
  DROP COLUMN IF EXISTS lead_id,
  DROP COLUMN IF EXISTS partner_id;
