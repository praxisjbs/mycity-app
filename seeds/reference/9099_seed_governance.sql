-- M9 governance roles, permissions and reference data.
-- UP
INSERT INTO reference_value (domain, code, label, display_order)
VALUES
  ('security_severity', 'info', 'Information', 10),
  ('security_severity', 'warning', 'Warning', 20),
  ('security_severity', 'critical', 'Critical', 30),
  ('access_review_decision', 'retain', 'Retain', 10),
  ('access_review_decision', 'revoke', 'Revoke', 20),
  ('access_review_decision', 'change', 'Change', 30),
  ('webhook_status', 'pending', 'Pending', 10),
  ('webhook_status', 'delivered', 'Delivered', 20),
  ('webhook_status', 'failed', 'Failed', 30)
ON CONFLICT (domain, code) DO UPDATE SET label = EXCLUDED.label, display_order = EXCLUDED.display_order, active = true;

-- DOWN
DELETE FROM reference_value WHERE domain IN ('security_severity', 'access_review_decision', 'webhook_status');
