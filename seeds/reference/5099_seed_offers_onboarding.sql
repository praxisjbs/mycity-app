-- M5 offer and onboarding reference data.
-- UP
INSERT INTO reference_value (domain, code, label, display_order)
VALUES
  ('offer_status', 'draft', 'Draft', 10),
  ('offer_status', 'approval', 'Awaiting Approval', 20),
  ('offer_status', 'sent', 'Sent', 30),
  ('offer_status', 'accepted', 'Accepted', 40),
  ('offer_status', 'declined', 'Declined', 50),
  ('offer_status', 'expired', 'Expired', 60),
  ('onboarding_status', 'pending', 'Pending', 10),
  ('onboarding_status', 'in_progress', 'In Progress', 20),
  ('onboarding_status', 'completed', 'Completed', 30),
  ('onboarding_status', 'cancelled', 'Cancelled', 40),
  ('signature_status', 'pending', 'Pending', 10),
  ('signature_status', 'signed', 'Signed', 20),
  ('signature_status', 'declined', 'Declined', 30),
  ('signature_status', 'expired', 'Expired', 40)
ON CONFLICT (domain, code) DO UPDATE SET label = EXCLUDED.label, display_order = EXCLUDED.display_order, active = true;

-- DOWN
DELETE FROM reference_value WHERE domain IN ('offer_status', 'onboarding_status', 'signature_status');
