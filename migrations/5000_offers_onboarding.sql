-- M5 offers, signatures, contracts and onboarding.
-- UP
CREATE TABLE IF NOT EXISTS offer (
  offer_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL UNIQUE REFERENCES application(application_id),
  number text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'draft',
  job_title text NOT NULL,
  department_id uuid REFERENCES department(department_id),
  worksite_id uuid REFERENCES worksite(worksite_id),
  start_date date,
  expires_at timestamptz,
  currency char(3) NOT NULL,
  annual_compensation numeric(18,2) NOT NULL CHECK (annual_compensation >= 0),
  terms jsonb NOT NULL DEFAULT '{}'::jsonb,
  document_id uuid REFERENCES document(document_id),
  approved_by uuid REFERENCES app_user(user_id),
  approved_at timestamptz,
  accepted_at timestamptz,
  declined_at timestamptz,
  created_by uuid NOT NULL REFERENCES app_user(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS signature_request (
  signature_request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES document(document_id),
  subject_type text NOT NULL,
  subject_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  expires_at timestamptz,
  completed_at timestamptz,
  created_by uuid NOT NULL REFERENCES app_user(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS signature (
  signature_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signature_request_id uuid NOT NULL REFERENCES signature_request(signature_request_id) ON DELETE CASCADE,
  signer_type text NOT NULL,
  signer_id uuid,
  signer_name text NOT NULL,
  signer_email citext NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  signed_at timestamptz,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (signature_request_id, signer_email)
);

CREATE TABLE IF NOT EXISTS document_requirement (
  document_requirement_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code citext NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  required boolean NOT NULL DEFAULT true,
  expires boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS onboarding_case (
  onboarding_case_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL UNIQUE REFERENCES application(application_id),
  offer_id uuid NOT NULL UNIQUE REFERENCES offer(offer_id),
  employee_id uuid UNIQUE REFERENCES employee(employee_id),
  owner_id uuid REFERENCES employee(employee_id),
  status text NOT NULL DEFAULT 'pending',
  starts_on date,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS onboarding_checklist_item (
  onboarding_checklist_item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  onboarding_case_id uuid NOT NULL REFERENCES onboarding_case(onboarding_case_id) ON DELETE CASCADE,
  document_requirement_id uuid REFERENCES document_requirement(document_requirement_id),
  title text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  assignee_id uuid REFERENCES employee(employee_id),
  due_at timestamptz,
  completed_at timestamptz,
  document_id uuid REFERENCES document(document_id),
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS employment_contract (
  employment_contract_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  onboarding_case_id uuid NOT NULL REFERENCES onboarding_case(onboarding_case_id),
  employee_id uuid REFERENCES employee(employee_id),
  number text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'draft',
  starts_on date NOT NULL,
  ends_on date,
  document_id uuid NOT NULL REFERENCES document(document_id),
  signature_request_id uuid REFERENCES signature_request(signature_request_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on IS NULL OR ends_on >= starts_on)
);

CREATE TABLE IF NOT EXISTS talent_pool (
  talent_pool_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS talent_pool_member (
  talent_pool_member_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  talent_pool_id uuid NOT NULL REFERENCES talent_pool(talent_pool_id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES candidate(candidate_id) ON DELETE CASCADE,
  notes text,
  added_by uuid REFERENCES app_user(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (talent_pool_id, candidate_id)
);

-- DOWN
DROP TABLE IF EXISTS talent_pool_member;
DROP TABLE IF EXISTS talent_pool;
DROP TABLE IF EXISTS employment_contract;
DROP TABLE IF EXISTS onboarding_checklist_item;
DROP TABLE IF EXISTS onboarding_case;
DROP TABLE IF EXISTS document_requirement;
DROP TABLE IF EXISTS signature;
DROP TABLE IF EXISTS signature_request;
DROP TABLE IF EXISTS offer;
