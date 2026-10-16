-- M0 notification inbox, preferences, push subscriptions and alerts.
-- UP
CREATE TABLE IF NOT EXISTS notification (
  notification_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES event_log(event_id),
  event_key text NOT NULL,
  category text NOT NULL,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'high')),
  title text NOT NULL,
  body text NOT NULL,
  entity_type text,
  entity_id text,
  channels text[] NOT NULL DEFAULT ARRAY['in_app']::text[],
  read_at timestamptz,
  delivery_queued_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, user_id)
);

CREATE TABLE IF NOT EXISTS notification_preference (
  user_id uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  category text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('in_app', 'email', 'push')),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, category, channel)
);

CREATE TABLE IF NOT EXISTS push_subscription (
  push_subscription_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS alert (
  alert_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES app_user(user_id),
  category text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  title text NOT NULL,
  body text,
  entity_type text,
  entity_id text,
  raised_at timestamptz NOT NULL DEFAULT now(),
  cleared_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- DOWN
DROP TABLE IF EXISTS alert;
DROP TABLE IF EXISTS push_subscription;
DROP TABLE IF EXISTS notification_preference;
DROP TABLE IF EXISTS notification;
