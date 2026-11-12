-- M5 onboarding: the rest of MyCity's Guarantor Form on a guarantor (date of birth, contact and residential addresses, the conviction and recommendation answers, a copy of their ID), so Operations & People check the form against what the hire entered.
-- UP
ALTER TABLE onboarding_guarantor ADD COLUMN IF NOT EXISTS date_of_birth date;
-- Each address's readable line; the place itself is kept by places.save() (owners onboarding_guarantor.*).
ALTER TABLE onboarding_guarantor ADD COLUMN IF NOT EXISTS contact_address text;
ALTER TABLE onboarding_guarantor ADD COLUMN IF NOT EXISTS residential_address text;
ALTER TABLE onboarding_guarantor ADD COLUMN IF NOT EXISTS convicted boolean;
ALTER TABLE onboarding_guarantor ADD COLUMN IF NOT EXISTS conviction_details text;
ALTER TABLE onboarding_guarantor ADD COLUMN IF NOT EXISTS recommends boolean;
ALTER TABLE onboarding_guarantor ADD COLUMN IF NOT EXISTS id_document_id uuid REFERENCES document(document_id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS onboarding_guarantor_id_document_idx ON onboarding_guarantor (id_document_id);

-- DOWN
DROP INDEX IF EXISTS onboarding_guarantor_id_document_idx;
ALTER TABLE onboarding_guarantor DROP COLUMN IF EXISTS id_document_id;
ALTER TABLE onboarding_guarantor DROP COLUMN IF EXISTS recommends;
ALTER TABLE onboarding_guarantor DROP COLUMN IF EXISTS conviction_details;
ALTER TABLE onboarding_guarantor DROP COLUMN IF EXISTS convicted;
ALTER TABLE onboarding_guarantor DROP COLUMN IF EXISTS residential_address;
ALTER TABLE onboarding_guarantor DROP COLUMN IF EXISTS contact_address;
ALTER TABLE onboarding_guarantor DROP COLUMN IF EXISTS date_of_birth;
