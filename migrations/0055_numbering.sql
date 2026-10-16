-- M0 gap-free document numbering.
-- UP
CREATE TABLE IF NOT EXISTS numbering_scheme (
  doc_type text PRIMARY KEY,
  prefix text NOT NULL,
  padding smallint NOT NULL DEFAULT 4 CHECK (padding BETWEEN 0 AND 10),
  separator text NOT NULL DEFAULT '-',
  reset text NOT NULL DEFAULT 'never' CHECK (reset IN ('never', 'yearly', 'monthly')),
  include_period boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS numbering_counter (
  doc_type text NOT NULL REFERENCES numbering_scheme(doc_type),
  period text NOT NULL DEFAULT '',
  last_value bigint NOT NULL DEFAULT 0 CHECK (last_value >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (doc_type, period)
);

-- DOWN
DROP TABLE IF EXISTS numbering_counter;
DROP TABLE IF EXISTS numbering_scheme;
