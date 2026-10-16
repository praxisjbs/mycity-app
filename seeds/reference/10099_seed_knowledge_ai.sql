-- M10 knowledge and assistant reference data.
-- UP
INSERT INTO reference_value (domain, code, label, display_order)
VALUES
  ('knowledge_status', 'draft', 'Draft', 10),
  ('knowledge_status', 'review', 'In Review', 20),
  ('knowledge_status', 'published', 'Published', 30),
  ('knowledge_status', 'archived', 'Archived', 40),
  ('knowledge_visibility', 'internal', 'Internal', 10),
  ('knowledge_visibility', 'restricted', 'Restricted', 20),
  ('ai_message_role', 'user', 'User', 10),
  ('ai_message_role', 'assistant', 'Assistant', 20),
  ('ai_message_role', 'system', 'System', 30)
ON CONFLICT (domain, code) DO UPDATE SET label = EXCLUDED.label, display_order = EXCLUDED.display_order, active = true;

INSERT INTO knowledge_category (code, name, description, display_order)
VALUES ('policies', 'Policies', 'Approved organisational policies.', 10), ('procedures', 'Procedures', 'Approved operational procedures.', 20), ('help', 'Help', 'MyCity product guidance.', 30)
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, display_order = EXCLUDED.display_order, active = true;

-- DOWN
DELETE FROM knowledge_category WHERE code IN ('policies', 'procedures', 'help');
DELETE FROM reference_value WHERE domain IN ('knowledge_status', 'knowledge_visibility', 'ai_message_role');
