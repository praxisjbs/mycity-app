-- M0 track C: capabilities a role holds, two-step required by role, and the indexes the Audit Log,
-- failed sign-ins and the live session list read by (docs/guides/foundation.md §4).
--
--   role_capability            an authority a role holds beside its grants (posting an announcement,
--                              clearing an alert); user_capability stays for one person's own
--   role.two_step_required     everyone holding the role sets two-step up at their next sign-in
--   audit_ledger indexes       the log is read newest first, by module, by action, by record
--   user_session index         live sessions across every login, most recently used first
--   spent_challenge purpose    the set-up step's ticket (two_step_setup) is spent like the others
-- UP
CREATE TABLE IF NOT EXISTS role_capability (
  role_capability_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id uuid NOT NULL REFERENCES role(role_id) ON DELETE CASCADE,
  capability_id uuid NOT NULL REFERENCES capability(capability_id) ON DELETE CASCADE,
  granted_by uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (role_id, capability_id)
);
CREATE INDEX IF NOT EXISTS role_capability_capability_id_fk_idx ON role_capability (capability_id);
CREATE INDEX IF NOT EXISTS role_capability_granted_by_fk_idx ON role_capability (granted_by);
CREATE OR REPLACE TRIGGER role_capability_set_updated_at BEFORE UPDATE ON role_capability
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE role ADD COLUMN IF NOT EXISTS two_step_required boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS audit_ledger_occurred_idx ON audit_ledger (occurred_at DESC, audit_ledger_id);
CREATE INDEX IF NOT EXISTS audit_ledger_module_occurred_idx ON audit_ledger (module_key, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_ledger_action_occurred_idx ON audit_ledger (action, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_ledger_entity_idx ON audit_ledger (entity_type, entity_id);

CREATE INDEX IF NOT EXISTS user_session_live_idx ON user_session (last_seen_at DESC) WHERE killed_at IS NULL;

ALTER TABLE spent_challenge DROP CONSTRAINT IF EXISTS spent_challenge_purpose_check;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'spent_challenge_purpose_check') THEN
    ALTER TABLE spent_challenge ADD CONSTRAINT spent_challenge_purpose_check
      CHECK (purpose IN ('two_step', 'two_step_setup', 'passkey_sign_in', 'passkey_add', 'passkey_confirm'));
  END IF;
END;
$$;

-- DOWN
-- DESTRUCTIVE: spent set-up tickets go with the purpose that allowed them; each expired 15 minutes after it was issued.
DELETE FROM spent_challenge WHERE purpose = 'two_step_setup';
ALTER TABLE spent_challenge DROP CONSTRAINT IF EXISTS spent_challenge_purpose_check;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'spent_challenge_purpose_check') THEN
    ALTER TABLE spent_challenge ADD CONSTRAINT spent_challenge_purpose_check
      CHECK (purpose IN ('two_step', 'passkey_sign_in', 'passkey_add', 'passkey_confirm'));
  END IF;
END;
$$;
DROP INDEX IF EXISTS user_session_live_idx;
DROP INDEX IF EXISTS audit_ledger_entity_idx;
DROP INDEX IF EXISTS audit_ledger_action_occurred_idx;
DROP INDEX IF EXISTS audit_ledger_module_occurred_idx;
DROP INDEX IF EXISTS audit_ledger_occurred_idx;
ALTER TABLE role DROP COLUMN IF EXISTS two_step_required;
DROP TRIGGER IF EXISTS role_capability_set_updated_at ON role_capability;
DROP INDEX IF EXISTS role_capability_granted_by_fk_idx;
DROP INDEX IF EXISTS role_capability_capability_id_fk_idx;
DROP TABLE IF EXISTS role_capability;
