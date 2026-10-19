-- M0 web push: each browser's subscription as a device, and a delivery log per notice and device.
--
-- Brought forward from M6 by TB on 19/10/2026 (docs/guides/notifications.md §4, §6):
--
--   push_subscription  one row per browser install (endpoint unique). Saving it again from the
--                      same browser updates the row and moves it to whoever is signed in there.
--                      device_token_hash is the hash of the token the service worker shows to
--                      renew the subscription or mark a notice read without a session.
--                      vapid_key_id names the server key it was made under, so a browser
--                      subscribed under an older key is asked to subscribe again.
--                      revoked_reason says why a device stopped: switched off, refused by the
--                      push service, moved to someone else, signed out everywhere, suspended.
--   push_delivery      one row per (notice, device), so a retried job never sends twice; a test
--                      push has no notice. status is what happened to that send.
-- UP
ALTER TABLE push_subscription ADD COLUMN IF NOT EXISTS known_device_id uuid REFERENCES known_device(known_device_id) ON DELETE SET NULL;
ALTER TABLE push_subscription ADD COLUMN IF NOT EXISTS label text NOT NULL DEFAULT 'Browser';
ALTER TABLE push_subscription ADD COLUMN IF NOT EXISTS platform text;
ALTER TABLE push_subscription ADD COLUMN IF NOT EXISTS device_token_hash text;
ALTER TABLE push_subscription ADD COLUMN IF NOT EXISTS vapid_key_id text;
ALTER TABLE push_subscription ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
ALTER TABLE push_subscription ADD COLUMN IF NOT EXISTS last_success_at timestamptz;
ALTER TABLE push_subscription ADD COLUMN IF NOT EXISTS last_failure_at timestamptz;
ALTER TABLE push_subscription ADD COLUMN IF NOT EXISTS failure_count integer NOT NULL DEFAULT 0;
ALTER TABLE push_subscription ADD COLUMN IF NOT EXISTS last_error text;
ALTER TABLE push_subscription ADD COLUMN IF NOT EXISTS revoked_reason text
  CHECK (revoked_reason IN ('turned_off', 'refused', 'moved', 'signed_out', 'suspended', 'left'));

CREATE INDEX IF NOT EXISTS push_subscription_known_device_id_fk_idx ON push_subscription (known_device_id);
CREATE INDEX IF NOT EXISTS push_subscription_user_active_idx ON push_subscription (user_id)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS push_delivery (
  push_delivery_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid REFERENCES notification(notification_id) ON DELETE CASCADE,
  push_subscription_id uuid NOT NULL REFERENCES push_subscription(push_subscription_id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('sent', 'failed', 'gone', 'skipped_read')),
  http_status integer,
  error text,
  attempts integer NOT NULL DEFAULT 0,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER push_delivery_set_updated_at
  BEFORE UPDATE ON push_delivery
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE UNIQUE INDEX IF NOT EXISTS push_delivery_notification_subscription_key
  ON push_delivery (notification_id, push_subscription_id) WHERE notification_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS push_delivery_push_subscription_id_fk_idx ON push_delivery (push_subscription_id);

-- DOWN
DROP INDEX IF EXISTS push_delivery_push_subscription_id_fk_idx;
DROP INDEX IF EXISTS push_delivery_notification_subscription_key;
DROP TRIGGER IF EXISTS push_delivery_set_updated_at ON push_delivery;
DROP TABLE IF EXISTS push_delivery;
DROP INDEX IF EXISTS push_subscription_user_active_idx;
DROP INDEX IF EXISTS push_subscription_known_device_id_fk_idx;
ALTER TABLE push_subscription DROP COLUMN IF EXISTS revoked_reason;
ALTER TABLE push_subscription DROP COLUMN IF EXISTS last_error;
ALTER TABLE push_subscription DROP COLUMN IF EXISTS failure_count;
ALTER TABLE push_subscription DROP COLUMN IF EXISTS last_failure_at;
ALTER TABLE push_subscription DROP COLUMN IF EXISTS last_success_at;
ALTER TABLE push_subscription DROP COLUMN IF EXISTS last_seen_at;
ALTER TABLE push_subscription DROP COLUMN IF EXISTS vapid_key_id;
ALTER TABLE push_subscription DROP COLUMN IF EXISTS device_token_hash;
ALTER TABLE push_subscription DROP COLUMN IF EXISTS platform;
ALTER TABLE push_subscription DROP COLUMN IF EXISTS label;
ALTER TABLE push_subscription DROP COLUMN IF EXISTS known_device_id;
