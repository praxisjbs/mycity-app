-- M9 Exchange Rates (docs/guides/integrations.md §1.2 decision 10, §4): every currency against
-- the dollar, fetched daily at midnight Lagos (or by Sync Rates) and kept by day, so AI prices
-- turn into naira and a later module can switch currency with the same table.
--
-- exchange_rate   one row per Lagos day, base and currency. A second fetch on the same day
--                 replaces that day's rows. Read through shared/money/fx.js only.
-- UP
CREATE TABLE IF NOT EXISTS exchange_rate (
  exchange_rate_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The Lagos day the rate is used for: the day it was fetched.
  day date NOT NULL,
  base text NOT NULL CHECK (base ~ '^[A-Z]{3}$'),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  -- Units of `currency` to one `base`.
  rate numeric(24,10) NOT NULL CHECK (rate > 0),
  -- When the provider last moved its rates, as it says.
  provider_updated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (day, base, currency)
);

CREATE OR REPLACE TRIGGER exchange_rate_set_updated_at
  BEFORE UPDATE ON exchange_rate
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- The newest rate of a currency on or before a day.
CREATE INDEX IF NOT EXISTS exchange_rate_currency_day_idx ON exchange_rate (base, currency, day DESC);

-- DOWN
DROP INDEX IF EXISTS exchange_rate_currency_day_idx;
DROP TRIGGER IF EXISTS exchange_rate_set_updated_at ON exchange_rate;
DROP TABLE IF EXISTS exchange_rate;
