-- M7 partnership reference data.
-- UP
INSERT INTO reference_value (domain, code, label, display_order)
VALUES
  ('partner_type', 'government', 'Government', 10),
  ('partner_type', 'corporate', 'Corporate', 20),
  ('partner_type', 'ngo', 'NGO', 30),
  ('partner_type', 'vendor', 'Vendor', 40),
  ('partnership_stage', 'lead', 'Lead', 10),
  ('partnership_stage', 'qualified', 'Qualified', 20),
  ('partnership_stage', 'proposal', 'Proposal', 30),
  ('partnership_stage', 'negotiation', 'Negotiation', 40),
  ('partnership_stage', 'agreement', 'Agreement', 50),
  ('partnership_stage', 'active', 'Active', 60),
  ('partnership_stage', 'closed', 'Closed', 70),
  ('interaction_type', 'email', 'Email', 10),
  ('interaction_type', 'call', 'Call', 20),
  ('interaction_type', 'meeting', 'Meeting', 30),
  ('interaction_type', 'note', 'Note', 40)
ON CONFLICT (domain, code) DO UPDATE SET label = EXCLUDED.label, display_order = EXCLUDED.display_order, active = true;

INSERT INTO numbering_scheme (doc_type, prefix, padding, separator, reset, include_period)
VALUES ('partner', 'PAR', 4, '-', 'never', false), ('partnership_opportunity', 'POP', 4, '-', 'yearly', true), ('partnership_agreement', 'AGR', 4, '-', 'yearly', true)
ON CONFLICT (doc_type) DO UPDATE SET prefix = EXCLUDED.prefix, padding = EXCLUDED.padding, separator = EXCLUDED.separator, reset = EXCLUDED.reset, include_period = EXCLUDED.include_period;

-- DOWN
DELETE FROM numbering_scheme WHERE doc_type IN ('partner', 'partnership_opportunity', 'partnership_agreement');
DELETE FROM reference_value WHERE domain IN ('partner_type', 'partnership_stage', 'interaction_type');
