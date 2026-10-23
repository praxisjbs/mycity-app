-- M2 My Workspace reference data (docs/guides/workspace.md §4, §6 Late reasons, §8). Codes only (A26).
--
--   late reasons  the six Why Late starts with: the four the contract named since 2020, which tasks
--                 already carry, and Waiting on Client and Blocked by Another Team (JBS Praxis,
--                 23/10/2026). MyCity adds and switches them off on Tasks afterwards, so inserted only
--                 when absent.
--   capability    workspace.late_reasons (Management, Operations & People, and the Implementation Team,
--                 which holds everything there is; the CEO holds every authority). Edited on
--                 Settings · Roles & Permissions afterwards, so inserted only when absent.
-- UP
INSERT INTO task_late_reason (code, label, display_order)
VALUES
  ('waiting_on_others', 'Waiting on Others', 10),
  ('waiting_on_client', 'Waiting on Client', 20),
  ('blocked_by_another_team', 'Blocked by Another Team', 30),
  ('underestimated', 'Underestimated', 40),
  ('deprioritised', 'Deprioritised', 50),
  ('other', 'Other', 60)
ON CONFLICT (code) DO NOTHING;

INSERT INTO capability (code, name, description)
VALUES ('workspace.late_reasons', 'Manage Late Reasons', 'Add the reasons Why Late offers on a late task, and switch them off or on.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_capability (role_id, capability_id)
SELECT r.role_id, c.capability_id
  FROM (VALUES
    ('management', 'workspace.late_reasons'),
    ('operations_people', 'workspace.late_reasons'),
    ('implementation', 'workspace.late_reasons')
  ) AS g (role_code, capability_code)
  JOIN role r ON r.code = g.role_code
  JOIN capability c ON c.code = g.capability_code
ON CONFLICT (role_id, capability_id) DO NOTHING;

-- DOWN
DELETE FROM role_capability rc
 USING role r, capability c,
       (VALUES
         ('management', 'workspace.late_reasons'),
         ('operations_people', 'workspace.late_reasons'),
         ('implementation', 'workspace.late_reasons')
       ) AS g (role_code, capability_code)
 WHERE rc.role_id = r.role_id AND rc.capability_id = c.capability_id
   AND r.code = g.role_code AND c.code = g.capability_code;
-- A capability someone has since given to a person or another role stays: deleting it would cascade
-- into their choice.
DELETE FROM capability c
 WHERE c.code = 'workspace.late_reasons'
   AND NOT EXISTS (SELECT 1 FROM user_capability uc WHERE uc.capability_id = c.capability_id)
   AND NOT EXISTS (SELECT 1 FROM role_capability rc WHERE rc.capability_id = c.capability_id);
-- The starting six, while no task carries one and nobody has changed it; a reason added on the screen stays.
DELETE FROM task_late_reason r
 WHERE r.code IN ('waiting_on_others', 'waiting_on_client', 'blocked_by_another_team', 'underestimated', 'deprioritised', 'other')
   AND r.created_by IS NULL
   AND NOT EXISTS (SELECT 1 FROM task t WHERE t.late_reason = r.code);
