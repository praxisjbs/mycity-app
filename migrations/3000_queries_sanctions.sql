-- M3 automated queries, responses, sanctions, fines and issued letters.
-- UP
CREATE TABLE IF NOT EXISTS query_rule (
  query_rule_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code citext NOT NULL UNIQUE,
  name text NOT NULL,
  source_event text NOT NULL,
  window_days integer NOT NULL CHECK (window_days > 0),
  threshold numeric(18,4) NOT NULL,
  condition jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES app_user(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS employee_query (
  employee_query_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number text NOT NULL UNIQUE,
  employee_id uuid NOT NULL REFERENCES employee(employee_id),
  query_rule_id uuid REFERENCES query_rule(query_rule_id),
  raised_by uuid REFERENCES app_user(user_id),
  subject text NOT NULL,
  details text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'awaiting_response',
  response_due_at timestamptz,
  responded_at timestamptz,
  reviewed_by uuid REFERENCES app_user(user_id),
  reviewed_at timestamptz,
  workflow_instance_id uuid REFERENCES workflow_instance(workflow_instance_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS query_response (
  query_response_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_query_id uuid NOT NULL REFERENCES employee_query(employee_query_id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employee(employee_id),
  body text NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_query_id, employee_id)
);

CREATE TABLE IF NOT EXISTS sanction (
  sanction_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_query_id uuid NOT NULL REFERENCES employee_query(employee_query_id),
  employee_id uuid NOT NULL REFERENCES employee(employee_id),
  sanction_type text NOT NULL,
  reason text NOT NULL,
  decided_by uuid NOT NULL REFERENCES app_user(user_id),
  effective_on date NOT NULL,
  ends_on date,
  status text NOT NULL DEFAULT 'issued',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on IS NULL OR ends_on >= effective_on)
);

CREATE TABLE IF NOT EXISTS sanction_fine (
  sanction_fine_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sanction_id uuid NOT NULL UNIQUE REFERENCES sanction(sanction_id),
  amount_ngn numeric(18,2) NOT NULL CHECK (amount_ngn > 0),
  employee_accepted_at timestamptz,
  employee_rejected_at timestamptz,
  rejection_reason text,
  settlement_status text NOT NULL DEFAULT 'pending' CHECK (settlement_status IN ('pending', 'accepted', 'rejected', 'settled', 'waived')),
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sanction_letter (
  sanction_letter_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sanction_id uuid NOT NULL REFERENCES sanction(sanction_id),
  document_id uuid NOT NULL REFERENCES document(document_id),
  letter_type text NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sanction_id, letter_type)
);

-- DOWN
DROP TABLE IF EXISTS sanction_letter;
DROP TABLE IF EXISTS sanction_fine;
DROP TABLE IF EXISTS sanction;
DROP TABLE IF EXISTS query_response;
DROP TABLE IF EXISTS employee_query;
DROP TABLE IF EXISTS query_rule;
