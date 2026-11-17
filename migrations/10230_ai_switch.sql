-- M10 AI Control: who last switched the whole of AI off or on, and when (docs/guides/ai-control.md decision 36, §4, §6.7).
--
-- Switch Off AI and Switch On AI on AI Control · Spend write ai_setting.enabled through the
-- ai_governance service. updated_by changes with a cap too, so it cannot say who switched: the
-- switch keeps its own two columns, null until someone presses it.
-- UP
ALTER TABLE ai_setting ADD COLUMN IF NOT EXISTS switched_by uuid REFERENCES app_user(user_id) ON DELETE SET NULL;
ALTER TABLE ai_setting ADD COLUMN IF NOT EXISTS switched_at timestamptz;
CREATE INDEX IF NOT EXISTS ai_setting_switched_by_fk_idx ON ai_setting (switched_by);

-- DOWN
DROP INDEX IF EXISTS ai_setting_switched_by_fk_idx;
ALTER TABLE ai_setting DROP COLUMN IF EXISTS switched_at;
ALTER TABLE ai_setting DROP COLUMN IF EXISTS switched_by;
