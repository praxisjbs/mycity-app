-- M5 status lists as the contract spells them (migrations 5010 to 5030): an offer can be approved (waiting for the company's signature and Send) and withdrawn; onboarding moves through documentation, pre-onboarding and onboarding.
-- UP
INSERT INTO reference_value (domain, code, label, display_order)
VALUES
  ('offer_status', 'approved', 'Approved', 25),
  ('offer_status', 'withdrawn', 'Withdrawn', 70),
  ('onboarding_status', 'documentation', 'Documentation', 5),
  ('onboarding_status', 'pre_onboarding', 'Pre-Onboarding', 15),
  ('onboarding_status', 'onboarding', 'Onboarding', 25)
ON CONFLICT (domain, code) DO NOTHING;
-- 5099's pending and in_progress are not states an onboarding case takes.
UPDATE reference_value SET active = false
WHERE domain = 'onboarding_status' AND code IN ('pending', 'in_progress');

-- DOWN
UPDATE reference_value SET active = true
WHERE domain = 'onboarding_status' AND code IN ('pending', 'in_progress');
DELETE FROM reference_value
WHERE (domain = 'offer_status' AND code IN ('approved', 'withdrawn'))
   OR (domain = 'onboarding_status' AND code IN ('documentation', 'pre_onboarding', 'onboarding'));
