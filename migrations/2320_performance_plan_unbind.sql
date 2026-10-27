-- M2 Performance: unbinding a binding plan (docs/guides/performance.md §4, §6.22; JBS Praxis, 27/10/2026).
--
-- A function's head asks the CEO to unbind a binding plan, with a reason (plan_unbind). Approved, the
-- plan is unbound: live like a binding one, and open for objectives and key results to be added or
-- changed. Send Plan then goes to the CEO alone and the plan is revising while they decide, binding
-- again on their approval. The plan's status check is widened with the two states; the request is a
-- row of its own, like a target change, and one request waits per plan.
-- UP

-- Widening the status check (not destructive, MIGRATIONS §8): the same values, `unbound` and `revising`.
ALTER TABLE performance_plan DROP CONSTRAINT IF EXISTS performance_plan_status_check;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'performance_plan_status_check') THEN
    ALTER TABLE performance_plan ADD CONSTRAINT performance_plan_status_check
      CHECK (status IN ('draft', 'submitted', 'binding', 'returned', 'unbound', 'revising'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS plan_unbind (
  plan_unbind_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  performance_plan_id uuid NOT NULL REFERENCES performance_plan(performance_plan_id) ON DELETE CASCADE,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  workflow_instance_id uuid REFERENCES workflow_instance(workflow_instance_id) ON DELETE SET NULL,
  requested_by uuid NOT NULL REFERENCES app_user(user_id) ON DELETE RESTRICT,
  decided_at timestamptz,
  decision_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS plan_unbind_pending_uq ON plan_unbind (performance_plan_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS plan_unbind_plan_fk_idx ON plan_unbind (performance_plan_id, created_at);
CREATE INDEX IF NOT EXISTS plan_unbind_workflow_fk_idx ON plan_unbind (workflow_instance_id);
CREATE INDEX IF NOT EXISTS plan_unbind_requested_by_fk_idx ON plan_unbind (requested_by);
CREATE INDEX IF NOT EXISTS plan_unbind_status_idx ON plan_unbind (status, created_at);
CREATE OR REPLACE TRIGGER plan_unbind_set_updated_at BEFORE UPDATE ON plan_unbind
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- DOWN

DROP TRIGGER IF EXISTS plan_unbind_set_updated_at ON plan_unbind;
DROP INDEX IF EXISTS plan_unbind_status_idx;
DROP INDEX IF EXISTS plan_unbind_requested_by_fk_idx;
DROP INDEX IF EXISTS plan_unbind_workflow_fk_idx;
DROP INDEX IF EXISTS plan_unbind_plan_fk_idx;
DROP INDEX IF EXISTS plan_unbind_pending_uq;
DROP TABLE IF EXISTS plan_unbind; -- DESTRUCTIVE: rollback only; drops the requests UP created

-- Narrowing again: rows written as unbound or revising are left alone (NOT VALID), as 2310's DOWN does.
ALTER TABLE performance_plan DROP CONSTRAINT IF EXISTS performance_plan_status_check;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'performance_plan_status_check') THEN
    ALTER TABLE performance_plan ADD CONSTRAINT performance_plan_status_check
      CHECK (status IN ('draft', 'submitted', 'binding', 'returned')) NOT VALID;
  END IF;
END $$;
