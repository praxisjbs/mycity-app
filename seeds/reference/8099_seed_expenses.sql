-- M8 expense reference data.
-- UP
INSERT INTO expense_category (code, name)
VALUES ('travel', 'Travel'), ('office', 'Office Supplies'), ('training', 'Training'), ('utilities', 'Utilities'), ('professional_services', 'Professional Services')
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, active = true;

INSERT INTO reference_value (domain, code, label, display_order)
VALUES
  ('expense_status', 'draft', 'Draft', 10),
  ('expense_status', 'submitted', 'Submitted', 20),
  ('expense_status', 'approved', 'Approved', 30),
  ('expense_status', 'rejected', 'Rejected', 40),
  ('expense_status', 'paid', 'Paid', 50),
  ('expense_status', 'cancelled', 'Cancelled', 60),
  ('disbursement_status', 'pending', 'Pending', 10),
  ('disbursement_status', 'processing', 'Processing', 20),
  ('disbursement_status', 'paid', 'Paid', 30),
  ('disbursement_status', 'failed', 'Failed', 40)
ON CONFLICT (domain, code) DO UPDATE SET label = EXCLUDED.label, display_order = EXCLUDED.display_order, active = true;

INSERT INTO numbering_scheme (doc_type, prefix, padding, separator, reset, include_period)
VALUES ('budget', 'BUD', 4, '-', 'yearly', true), ('expense_request', 'EXR', 4, '-', 'yearly', true)
ON CONFLICT (doc_type) DO UPDATE SET prefix = EXCLUDED.prefix, padding = EXCLUDED.padding, separator = EXCLUDED.separator, reset = EXCLUDED.reset, include_period = EXCLUDED.include_period;

-- DOWN
DELETE FROM numbering_scheme WHERE doc_type IN ('budget', 'expense_request');
DELETE FROM reference_value WHERE domain IN ('expense_status', 'disbursement_status');
DELETE FROM expense_category WHERE code IN ('travel', 'office', 'training', 'utilities', 'professional_services');
