-- M0 settings, working week, holidays and configurable reference values.
-- UP
CREATE TABLE IF NOT EXISTS setting (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_by uuid REFERENCES app_user(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS working_week (
  weekday smallint PRIMARY KEY CHECK (weekday BETWEEN 1 AND 7),
  is_working_day boolean NOT NULL,
  starts_at time,
  ends_at time,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT is_working_day OR (starts_at IS NOT NULL AND ends_at IS NOT NULL AND ends_at > starts_at))
);

CREATE TABLE IF NOT EXISTS public_holiday (
  public_holiday_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  holiday_date date NOT NULL UNIQUE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reference_value (
  reference_value_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain text NOT NULL,
  code citext NOT NULL,
  label text NOT NULL,
  description text,
  display_order integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (domain, code)
);

-- DOWN
DROP TABLE IF EXISTS reference_value;
DROP TABLE IF EXISTS public_holiday;
DROP TABLE IF EXISTS working_week;
DROP TABLE IF EXISTS setting;
