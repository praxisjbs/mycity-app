-- M0 configurable approvals and entity state history.
-- UP
CREATE TABLE IF NOT EXISTS workflow_definition (
  workflow_definition_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key citext NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  module_key text NOT NULL,
  name text NOT NULL,
  description text,
  context_types jsonb NOT NULL DEFAULT '{}'::jsonb,
  stages jsonb NOT NULL DEFAULT '[]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES app_user(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (key, version)
);

CREATE TABLE IF NOT EXISTS workflow_instance (
  workflow_instance_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_definition_id uuid NOT NULL REFERENCES workflow_definition(workflow_definition_id),
  definition_key text NOT NULL,
  module_key text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  subject_employee_id uuid REFERENCES employee(employee_id),
  current_stage text,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'approved', 'rejected', 'cancelled', 'timeout_approved', 'timeout_rejected')),
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  stage_approvers jsonb NOT NULL DEFAULT '[]'::jsonb,
  stage_entered_at timestamptz NOT NULL DEFAULT now(),
  stage_due_at timestamptz,
  opened_by uuid REFERENCES app_user(user_id),
  opened_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS workflow_instance_pending_subject_uq
  ON workflow_instance (entity_type, entity_id) WHERE state = 'pending';

CREATE TABLE IF NOT EXISTS workflow_decision (
  workflow_decision_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id uuid NOT NULL REFERENCES workflow_instance(workflow_instance_id) ON DELETE CASCADE,
  stage_key text NOT NULL,
  actor_id uuid REFERENCES app_user(user_id),
  decision text NOT NULL CHECK (decision IN ('approve', 'reject', 'request_changes', 'cancel', 'timeout_approve', 'timeout_reject')),
  reason text,
  decided_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS entity_state_history (
  entity_state_history_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  from_state text,
  to_state text NOT NULL,
  actor_id uuid REFERENCES app_user(user_id),
  reason text,
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- DOWN
DROP TABLE IF EXISTS entity_state_history;
DROP TABLE IF EXISTS workflow_decision;
DROP INDEX IF EXISTS workflow_instance_pending_subject_uq;
DROP TABLE IF EXISTS workflow_instance;
DROP TABLE IF EXISTS workflow_definition;
