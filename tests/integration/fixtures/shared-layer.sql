-- The smallest schema the shared layer runs against, for tests/integration only.
--
-- It holds exactly the columns BACKEND_STRUCTURE §11.1 says the shared layer reads and
-- writes, so the integration suite can prove emit, the outbox, the approval engine,
-- notifications, alerts and the resource kit against a real Postgres before the M0
-- migrations exist. It is NOT a migration and is never applied to a real database:
-- the suite refuses to run unless the database name ends in "_test".
--
-- Once migrations 0001 to 0099 land, the suite runs them instead of this file and this
-- file is deleted. Until then, a column added to §11.1 is added here in the same PR.

DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE OR REPLACE FUNCTION search_fold(t text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT lower(unaccent('unaccent', coalesce(t, ''))) $$;

-- 0040 (the parts identity needs first)
CREATE TABLE employee (
  employee_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name      text NOT NULL,
  last_name       text NOT NULL,
  line_manager_id uuid REFERENCES employee (employee_id)
);

-- 0010
CREATE TABLE app_user (
  user_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employee (employee_id),
  email       text NOT NULL UNIQUE,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'left')),
  is_ceo      boolean NOT NULL DEFAULT false
);

-- 0020
CREATE TABLE role (
  role_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code    text NOT NULL UNIQUE
);
CREATE TABLE user_role (
  user_id uuid NOT NULL REFERENCES app_user (user_id),
  role_id uuid NOT NULL REFERENCES role (role_id),
  PRIMARY KEY (user_id, role_id)
);
CREATE TABLE permission (
  role_id     uuid NOT NULL REFERENCES role (role_id),
  module_key  text NOT NULL,
  can_view    boolean NOT NULL DEFAULT false,
  can_create  boolean NOT NULL DEFAULT false,
  can_edit    boolean NOT NULL DEFAULT false,
  can_delete  boolean NOT NULL DEFAULT false,
  can_approve boolean NOT NULL DEFAULT false,
  can_export  boolean NOT NULL DEFAULT false,
  scope       text NOT NULL DEFAULT 'own' CHECK (scope IN ('all', 'team', 'own')),
  PRIMARY KEY (role_id, module_key)
);
CREATE TABLE field_visibility (
  role_id    uuid NOT NULL REFERENCES role (role_id),
  field_key  text NOT NULL,
  visibility text NOT NULL CHECK (visibility IN ('visible', 'masked')),
  PRIMARY KEY (role_id, field_key)
);

-- 0030
CREATE TABLE event_log (
  event_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key       text NOT NULL,
  module_key      text NOT NULL,
  entity_type     text NOT NULL,
  entity_id       text NOT NULL,
  actor_user_id   uuid,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_id      text,
  import_batch_id uuid,
  occurred_at     timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE audit_ledger (
  audit_id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id        uuid NOT NULL REFERENCES event_log (event_id),
  occurred_at     timestamptz NOT NULL,
  actor_user_id   uuid,
  actor_name      text,
  actor_email     text,
  actor_ip        text,
  action          text NOT NULL,
  module_key      text NOT NULL,
  entity_type     text NOT NULL,
  entity_id       text NOT NULL,
  before          jsonb,
  after           jsonb,
  changed_fields  text[],
  is_sensitive    boolean NOT NULL DEFAULT false,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_id      text,
  import_batch_id uuid
);
CREATE TABLE event_outbox (
  outbox_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id           uuid NOT NULL REFERENCES event_log (event_id),
  event_key          text NOT NULL,
  dedup_key          text,
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  attempts           int NOT NULL DEFAULT 0,
  max_attempts       int NOT NULL DEFAULT 8,
  next_attempt_at    timestamptz NOT NULL DEFAULT now(),
  completed_handlers text[] NOT NULL DEFAULT '{}',
  last_error         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  processed_at       timestamptz
);
CREATE UNIQUE INDEX event_outbox_dedup ON event_outbox (dedup_key) WHERE dedup_key IS NOT NULL;
CREATE INDEX event_outbox_due ON event_outbox (next_attempt_at) WHERE status = 'pending';

-- 0060
CREATE TABLE notification (
  notification_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES app_user (user_id),
  event_id           uuid NOT NULL REFERENCES event_log (event_id),
  event_key          text NOT NULL,
  category           text NOT NULL,
  priority           text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'high')),
  title              text NOT NULL,
  body               text,
  entity_type        text NOT NULL,
  entity_id          text NOT NULL,
  channels           text[] NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  read_at            timestamptz,
  delivery_queued_at timestamptz,
  UNIQUE (event_id, user_id)
);
CREATE TABLE notification_preference (
  user_id  uuid NOT NULL REFERENCES app_user (user_id),
  category text NOT NULL,
  channel  text NOT NULL CHECK (channel IN ('in_app', 'email', 'push')),
  enabled  boolean NOT NULL,
  PRIMARY KEY (user_id, category, channel)
);

-- 0070
CREATE TABLE workflow_definition (
  workflow_definition_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key           text NOT NULL,
  version       int NOT NULL,
  module_key    text NOT NULL,
  name          text NOT NULL,
  description   text,
  context_types jsonb NOT NULL DEFAULT '{}'::jsonb,
  stages        jsonb NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (key, version)
);
CREATE TABLE workflow_instance (
  workflow_instance_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_definition_id uuid NOT NULL REFERENCES workflow_definition (workflow_definition_id),
  definition_key      text NOT NULL,
  module_key          text NOT NULL,
  entity_type         text NOT NULL,
  entity_id           text NOT NULL,
  subject_employee_id uuid,
  current_stage       text,
  state               text NOT NULL CHECK (state IN ('pending', 'approved', 'rejected', 'cancelled', 'timeout_approved', 'timeout_rejected')),
  context             jsonb NOT NULL DEFAULT '{}'::jsonb,
  stage_approvers     jsonb NOT NULL DEFAULT '[]'::jsonb,
  stage_entered_at    timestamptz,
  stage_due_at        timestamptz,
  opened_by           uuid,
  opened_at           timestamptz NOT NULL DEFAULT now(),
  completed_at        timestamptz
);
CREATE UNIQUE INDEX workflow_instance_one_open ON workflow_instance (entity_type, entity_id) WHERE state = 'pending';
CREATE TABLE workflow_decision (
  workflow_decision_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id uuid NOT NULL REFERENCES workflow_instance (workflow_instance_id),
  stage_key  text,
  actor_id   uuid,
  decision   text NOT NULL CHECK (decision IN ('approve', 'reject', 'request_changes', 'cancel', 'timeout_approve', 'timeout_reject')),
  reason     text,
  decided_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- 0055 (numbering, for the resource kit's numbered create)
CREATE TABLE numbering_scheme (
  doc_type       text PRIMARY KEY,
  prefix         text NOT NULL,
  padding        int NOT NULL,
  separator      text NOT NULL DEFAULT '-',
  reset          text NOT NULL DEFAULT 'never',
  include_period boolean NOT NULL DEFAULT false
);
CREATE TABLE numbering_counter (
  doc_type   text NOT NULL,
  period     text NOT NULL,
  last_value int NOT NULL,
  PRIMARY KEY (doc_type, period)
);

-- Home (M1)
CREATE TABLE home_alert_rule (
  home_alert_rule_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key            text NOT NULL UNIQUE,
  metric         text NOT NULL,
  threshold      numeric(18, 2) NOT NULL,
  window_days    int,
  severity       text NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  permission_key text NOT NULL,
  enabled        boolean NOT NULL DEFAULT true
);
CREATE TABLE home_alert (
  home_alert_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  home_alert_rule_id uuid NOT NULL REFERENCES home_alert_rule (home_alert_rule_id),
  subject_type text NOT NULL,
  subject_id   text NOT NULL,
  title        text NOT NULL,
  trigger      text,
  severity     text NOT NULL,
  over_by      numeric(18, 2),
  raised_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  escalated_at timestamptz,
  cleared_at   timestamptz,
  cleared_by   uuid,
  outcome      text CHECK (outcome IN ('cleared', 'dismissed')),
  note         text
);
CREATE UNIQUE INDEX home_alert_one_open ON home_alert (home_alert_rule_id, subject_type, subject_id) WHERE cleared_at IS NULL;

-- 0050 (settings, as the letterhead reads them)
CREATE TABLE setting (
  key   text PRIMARY KEY,
  value jsonb NOT NULL
);

-- 0080
CREATE TABLE document (
  document_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_type            text NOT NULL,
  title               text,
  original_name       text NOT NULL,
  storage_key         text NOT NULL UNIQUE,
  mime                text NOT NULL,
  bytes               bigint NOT NULL,
  content_hash        text,
  version             int NOT NULL DEFAULT 1,
  supersedes_id       uuid REFERENCES document (document_id),
  is_current          boolean NOT NULL DEFAULT true,
  entity_type         text NOT NULL,
  entity_id           text NOT NULL,
  subject_employee_id uuid,
  sensitivity         text NOT NULL CHECK (sensitivity IN ('normal', 'personal', 'restricted')),
  locked_at           timestamptz,
  expires_on          date,
  scan_status         text NOT NULL CHECK (scan_status IN ('clean', 'pending', 'infected', 'skipped')),
  source              text NOT NULL CHECK (source IN ('upload', 'generated', 'import')),
  number              text UNIQUE,
  template_key        text,
  template_version    int,
  render_status       text CHECK (render_status IN ('pending', 'done', 'failed')),
  render_html         text,
  render_error        text,
  width               int,
  height              int,
  duration_ms         int,
  uploaded_by         uuid,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX document_entity ON document (entity_type, entity_id) WHERE is_current;
CREATE TABLE document_variant (
  document_variant_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES document (document_id),
  kind        text NOT NULL,
  storage_key text NOT NULL UNIQUE,
  mime        text NOT NULL,
  bytes       bigint NOT NULL,
  width       int,
  height      int,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, kind)
);
CREATE TABLE template_version (
  template_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind       text NOT NULL CHECK (kind IN ('document', 'email')),
  key        text NOT NULL,
  version    int NOT NULL,
  subject    text,
  title      text,
  body       text NOT NULL,
  format     text NOT NULL CHECK (format IN ('html', 'markdown')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, key, version)
);

-- 0085
CREATE TABLE import_batch (
  import_batch_id uuid PRIMARY KEY,
  number       text NOT NULL UNIQUE,
  importer_key text NOT NULL,
  document_id  uuid NOT NULL REFERENCES document (document_id),
  file_name    text NOT NULL,
  sheet        text,
  header_row   int,
  mapping      jsonb NOT NULL DEFAULT '{}'::jsonb,
  options      jsonb NOT NULL DEFAULT '{}'::jsonb,
  status       text NOT NULL CHECK (status IN ('uploaded', 'mapped', 'previewed', 'committed', 'reverted', 'failed')),
  stats        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  previewed_at timestamptz,
  committed_at timestamptz,
  committed_by uuid,
  reverted_at  timestamptz,
  reverted_by  uuid
);
CREATE TABLE import_row (
  import_row_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_batch_id uuid NOT NULL REFERENCES import_batch (import_batch_id),
  row_number int NOT NULL,
  raw        jsonb NOT NULL,
  "values"   jsonb NOT NULL,
  status     text NOT NULL CHECK (status IN ('ok', 'warning', 'error', 'duplicate', 'unchanged', 'skipped')),
  problems   jsonb NOT NULL DEFAULT '[]'::jsonb,
  action     text NOT NULL CHECK (action IN ('create', 'update', 'none')),
  target_id  text,
  "before"   jsonb,
  diff       jsonb,
  UNIQUE (import_batch_id, row_number)
);
CREATE TABLE import_mapping_profile (
  import_mapping_profile_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  importer_key     text NOT NULL,
  name             text NOT NULL,
  header_signature text NOT NULL,
  mapping          jsonb NOT NULL,
  created_by       uuid,
  last_used_at     timestamptz,
  UNIQUE (importer_key, header_signature)
);

-- Records the import test writes through a small "service".
CREATE TABLE test_department (
  test_department_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE
);
CREATE TABLE test_person (
  test_person_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_number  text UNIQUE,
  first_name    text NOT NULL,
  last_name     text NOT NULL,
  work_email    text UNIQUE,
  gross_monthly numeric(18, 2),
  start_date    date,
  department_id uuid REFERENCES test_department (test_department_id),
  manager_id    uuid REFERENCES test_person (test_person_id),
  archived_at   timestamptz
);

-- A plain register for the resource kit's test.
CREATE TABLE test_thing (
  test_thing_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number        text UNIQUE,
  name          text NOT NULL,
  owner_employee_id uuid,
  archived_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
