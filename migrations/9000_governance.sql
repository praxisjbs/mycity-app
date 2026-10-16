-- M9 governance, access reviews, integrations and webhooks.
-- UP
CREATE TABLE IF NOT EXISTS security_event (
  security_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  severity text NOT NULL,
  actor_user_id uuid REFERENCES app_user(user_id),
  source_ip inet,
  user_agent text,
  subject_type text,
  subject_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES app_user(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS access_review (
  access_review_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  owner_id uuid NOT NULL REFERENCES app_user(user_id),
  starts_at timestamptz,
  due_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS access_review_item (
  access_review_item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  access_review_id uuid NOT NULL REFERENCES access_review(access_review_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(user_id),
  role_id uuid REFERENCES role(role_id),
  capability_id uuid REFERENCES capability(capability_id),
  decision text,
  decided_by uuid REFERENCES app_user(user_id),
  decided_at timestamptz,
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (role_id IS NOT NULL OR capability_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS integration_connection (
  integration_connection_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code citext NOT NULL UNIQUE,
  provider text NOT NULL,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'inactive',
  integration_secret_id uuid REFERENCES integration_secret(integration_secret_id),
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_checked_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS webhook_endpoint (
  webhook_endpoint_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_connection_id uuid REFERENCES integration_connection(integration_connection_id),
  name text NOT NULL,
  url text NOT NULL,
  secret_hash text NOT NULL,
  event_types text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS webhook_delivery (
  webhook_delivery_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_endpoint_id uuid NOT NULL REFERENCES webhook_endpoint(webhook_endpoint_id) ON DELETE CASCADE,
  event_type text NOT NULL,
  event_id uuid,
  payload jsonb NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  status text NOT NULL DEFAULT 'pending',
  next_attempt_at timestamptz,
  delivered_at timestamptz,
  response_status integer,
  response_body text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- DOWN
DROP TABLE IF EXISTS webhook_delivery;
DROP TABLE IF EXISTS webhook_endpoint;
DROP TABLE IF EXISTS integration_connection;
DROP TABLE IF EXISTS access_review_item;
DROP TABLE IF EXISTS access_review;
DROP TABLE IF EXISTS security_event;
