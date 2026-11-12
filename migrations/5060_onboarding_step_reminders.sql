-- M5 onboarding: when an overdue plan step's owner was reminded, so onboarding-dispatch reminds each step once however often it runs.
-- UP
ALTER TABLE onboarding_case_step ADD COLUMN IF NOT EXISTS reminded_at timestamptz;

-- DOWN
ALTER TABLE onboarding_case_step DROP COLUMN IF EXISTS reminded_at;
