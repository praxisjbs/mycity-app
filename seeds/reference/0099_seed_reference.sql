-- M0 product reference data only. No people, client records or demonstration rows.
-- UP
INSERT INTO role (code, name, description, is_system)
VALUES
  ('administrator', 'Administrator', 'System administration and configuration.', true),
  ('management', 'Management', 'Organisation-wide management and approvals.', true),
  ('manager', 'Manager', 'Team management and approvals.', true),
  ('employee', 'Employee', 'Employee self-service access.', true)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  is_system = EXCLUDED.is_system,
  active = true;

INSERT INTO working_week (weekday, is_working_day, starts_at, ends_at)
VALUES
  (1, true, '09:00', '17:00'),
  (2, true, '09:00', '17:00'),
  (3, true, '09:00', '17:00'),
  (4, true, '09:00', '17:00'),
  (5, true, '09:00', '17:00'),
  (6, false, NULL, NULL),
  (7, false, NULL, NULL)
ON CONFLICT (weekday) DO UPDATE SET
  is_working_day = EXCLUDED.is_working_day,
  starts_at = EXCLUDED.starts_at,
  ends_at = EXCLUDED.ends_at;

INSERT INTO numbering_scheme (doc_type, prefix, padding, separator, reset, include_period)
VALUES
  ('employee', 'MCA', 4, '-', 'never', false),
  ('document', 'DOC', 4, '-', 'never', false),
  ('import_batch', 'IMP', 4, '-', 'never', false),
  ('query', 'QRY', 4, '-', 'never', false),
  ('sanction', 'SAN', 4, '-', 'never', false),
  ('letter', 'LTR', 4, '-', 'never', false),
  ('vacancy', 'VAC', 4, '-', 'never', false),
  ('offer', 'OFF', 4, '-', 'never', false),
  ('contract', 'CON', 4, '-', 'never', false),
  ('payroll_run', 'PAY', 0, '-', 'monthly', true),
  ('payslip', 'PAY', 4, '-', 'monthly', true),
  ('proposal', 'PRO', 4, '-', 'never', false),
  ('mou', 'MOU', 4, '-', 'never', false),
  ('expense', 'EXP', 4, '-', 'never', false),
  ('requisition', 'REQ', 4, '-', 'never', false),
  ('disbursement', 'DSB', 4, '-', 'never', false)
ON CONFLICT (doc_type) DO UPDATE SET
  prefix = EXCLUDED.prefix,
  padding = EXCLUDED.padding,
  separator = EXCLUDED.separator,
  reset = EXCLUDED.reset,
  include_period = EXCLUDED.include_period;

INSERT INTO reference_value (domain, code, label, display_order)
VALUES
  ('employment_status', 'active', 'Active', 10),
  ('employment_status', 'suspended', 'Suspended', 20),
  ('employment_status', 'left', 'Left', 30),
  ('work_pattern', 'onsite', 'On-site', 10),
  ('work_pattern', 'hybrid', 'Hybrid', 20),
  ('work_pattern', 'remote', 'Remote', 30)
ON CONFLICT (domain, code) DO UPDATE SET
  label = EXCLUDED.label,
  display_order = EXCLUDED.display_order,
  active = true;

-- DOWN
DELETE FROM reference_value WHERE domain IN ('employment_status', 'work_pattern');
DELETE FROM numbering_scheme WHERE doc_type IN ('employee', 'document', 'import_batch', 'query', 'sanction', 'letter', 'vacancy', 'offer', 'contract', 'payroll_run', 'payslip', 'proposal', 'mou', 'expense', 'requisition', 'disbursement');
DELETE FROM working_week WHERE weekday BETWEEN 1 AND 7;
DELETE FROM role WHERE code IN ('administrator', 'management', 'manager', 'employee');
