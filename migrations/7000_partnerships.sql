-- M7 partnership CRM, proposals and agreements.
-- UP
CREATE TABLE IF NOT EXISTS partner (
  partner_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number text NOT NULL UNIQUE,
  name text NOT NULL,
  partner_type text NOT NULL,
  status text NOT NULL DEFAULT 'prospect',
  website text,
  industry text,
  country_code char(2),
  owner_id uuid REFERENCES employee(employee_id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS partner_contact (
  partner_contact_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES partner(partner_id) ON DELETE CASCADE,
  first_name text NOT NULL,
  last_name text NOT NULL,
  email citext,
  phone text,
  job_title text,
  primary_contact boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS partner_contact_email_uq ON partner_contact (partner_id, email) WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS partnership_opportunity (
  partnership_opportunity_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number text NOT NULL UNIQUE,
  partner_id uuid NOT NULL REFERENCES partner(partner_id),
  title text NOT NULL,
  stage text NOT NULL DEFAULT 'lead',
  status text NOT NULL DEFAULT 'open',
  owner_id uuid REFERENCES employee(employee_id),
  estimated_value numeric(18,2),
  currency char(3),
  probability numeric(5,2) CHECK (probability BETWEEN 0 AND 100),
  expected_close_on date,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS partnership_stage_history (
  partnership_stage_history_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partnership_opportunity_id uuid NOT NULL REFERENCES partnership_opportunity(partnership_opportunity_id) ON DELETE CASCADE,
  from_stage text,
  to_stage text NOT NULL,
  changed_by uuid REFERENCES app_user(user_id),
  reason text,
  changed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS partner_interaction (
  partner_interaction_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES partner(partner_id),
  partnership_opportunity_id uuid REFERENCES partnership_opportunity(partnership_opportunity_id),
  contact_id uuid REFERENCES partner_contact(partner_contact_id),
  interaction_type text NOT NULL,
  subject text NOT NULL,
  summary text,
  occurred_at timestamptz NOT NULL,
  owner_id uuid REFERENCES employee(employee_id),
  mail_message_id uuid REFERENCES mail_message(mail_message_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS partnership_proposal (
  partnership_proposal_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partnership_opportunity_id uuid NOT NULL REFERENCES partnership_opportunity(partnership_opportunity_id),
  number text NOT NULL UNIQUE,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  status text NOT NULL DEFAULT 'draft',
  value numeric(18,2),
  currency char(3),
  document_id uuid REFERENCES document(document_id),
  sent_at timestamptz,
  accepted_at timestamptz,
  created_by uuid NOT NULL REFERENCES app_user(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS partnership_agreement (
  partnership_agreement_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES partner(partner_id),
  partnership_opportunity_id uuid REFERENCES partnership_opportunity(partnership_opportunity_id),
  proposal_id uuid REFERENCES partnership_proposal(partnership_proposal_id),
  number text NOT NULL UNIQUE,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  starts_on date NOT NULL,
  ends_on date,
  value numeric(18,2),
  currency char(3),
  document_id uuid REFERENCES document(document_id),
  signature_request_id uuid REFERENCES signature_request(signature_request_id),
  owner_id uuid REFERENCES employee(employee_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on IS NULL OR ends_on >= starts_on)
);

CREATE TABLE IF NOT EXISTS agreement_obligation (
  agreement_obligation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partnership_agreement_id uuid NOT NULL REFERENCES partnership_agreement(partnership_agreement_id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  owner_id uuid REFERENCES employee(employee_id),
  due_on date,
  status text NOT NULL DEFAULT 'pending',
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- DOWN
DROP TABLE IF EXISTS agreement_obligation;
DROP TABLE IF EXISTS partnership_agreement;
DROP TABLE IF EXISTS partnership_proposal;
DROP TABLE IF EXISTS partner_interaction;
DROP TABLE IF EXISTS partnership_stage_history;
DROP TABLE IF EXISTS partnership_opportunity;
DROP TABLE IF EXISTS partner_contact;
DROP TABLE IF EXISTS partner;
