-- M1 Mailbox: the Configure Signature capability (docs/guides/mailbox.md §8, TB 19/10/2026).
--
--   mailbox.signature  sets the company's signature links and what shows on everyone's signature,
--                      held by System Administrator (the CTO's role) and the Implementation Team
--                      (and the CEO, who holds every authority). Anyone else is given it on
--                      Settings, Roles & Permissions.
--
-- Inserted only when absent (docs/MIGRATIONS.md §9): a re-run never overwrites what a person chose.
-- Reference data only: the code the code switches on and the roles of 0290, no people, no links.
-- UP
INSERT INTO capability (code, name, description)
VALUES
  ('mailbox.signature', 'Configure Signature', 'Set the company''s signature links and what shows on everyone''s email signature.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_capability (role_id, capability_id)
SELECT r.role_id, c.capability_id
  FROM role r
  CROSS JOIN capability c
 WHERE r.code IN ('implementation', 'administrator')
   AND c.code = 'mailbox.signature'
ON CONFLICT (role_id, capability_id) DO NOTHING;

-- DOWN
DELETE FROM role_capability rc
 USING role r, capability c
 WHERE r.role_id = rc.role_id
   AND c.capability_id = rc.capability_id
   -- Only rows a seed wrote: a grant made on Settings, Roles & Permissions records who made it.
   AND rc.granted_by IS NULL
   AND c.code = 'mailbox.signature'
   AND r.code IN ('implementation', 'administrator');
-- A capability someone has since given to a person or another role stays: deleting it would cascade
-- into their choice.
DELETE FROM capability c
 WHERE c.code = 'mailbox.signature'
   AND NOT EXISTS (SELECT 1 FROM user_capability uc WHERE uc.capability_id = c.capability_id)
   AND NOT EXISTS (SELECT 1 FROM role_capability rc WHERE rc.capability_id = c.capability_id);
