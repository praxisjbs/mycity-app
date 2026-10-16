-- M1 dashboard, attendance, leave, community, mailbox and reporting foundations.
-- UP
CREATE TABLE IF NOT EXISTS home_alert_rule (
  home_alert_rule_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key citext NOT NULL UNIQUE,
  metric text NOT NULL,
  threshold numeric NOT NULL,
  window_days integer CHECK (window_days IS NULL OR window_days > 0),
  severity text NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  permission_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS home_alert (
  home_alert_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  home_alert_rule_id uuid NOT NULL REFERENCES home_alert_rule(home_alert_rule_id),
  subject_type text NOT NULL,
  subject_id text NOT NULL,
  title text NOT NULL,
  trigger text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  over_by numeric,
  raised_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  escalated_at timestamptz,
  cleared_at timestamptz,
  cleared_by uuid REFERENCES app_user(user_id),
  outcome text CHECK (outcome IS NULL OR outcome IN ('cleared', 'dismissed')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS home_alert_open_subject_uq
  ON home_alert (home_alert_rule_id, subject_type, subject_id) WHERE cleared_at IS NULL;

CREATE TABLE IF NOT EXISTS attendance_policy (
  attendance_policy_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  grace_minutes integer NOT NULL DEFAULT 0 CHECK (grace_minutes >= 0),
  earliest_clock_in_minutes integer NOT NULL DEFAULT 120 CHECK (earliest_clock_in_minutes >= 0),
  latest_clock_out_minutes integer NOT NULL DEFAULT 240 CHECK (latest_clock_out_minutes >= 0),
  require_known_device boolean NOT NULL DEFAULT true,
  require_geofence boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS employee_attendance_policy (
  employee_attendance_policy_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employee(employee_id),
  attendance_policy_id uuid NOT NULL REFERENCES attendance_policy(attendance_policy_id),
  worksite_id uuid REFERENCES worksite(worksite_id),
  effective_from date NOT NULL,
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, effective_from),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE TABLE IF NOT EXISTS attendance_event (
  attendance_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employee(employee_id),
  event_type text NOT NULL CHECK (event_type IN ('clock_in', 'clock_out')),
  occurred_at timestamptz NOT NULL,
  worksite_id uuid REFERENCES worksite(worksite_id),
  known_device_id uuid REFERENCES known_device(known_device_id),
  latitude numeric(9,6),
  longitude numeric(9,6),
  accuracy_m numeric(10,2),
  distance_m numeric(10,2),
  source text NOT NULL CHECK (source IN ('pwa', 'admin', 'import', 'system')),
  validation_state text NOT NULL CHECK (validation_state IN ('accepted', 'review', 'rejected')),
  validation jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((latitude IS NULL) = (longitude IS NULL))
);

CREATE INDEX IF NOT EXISTS attendance_event_employee_time_idx ON attendance_event (employee_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS attendance_day (
  attendance_day_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employee(employee_id),
  attendance_date date NOT NULL,
  status text NOT NULL,
  first_clock_in_at timestamptz,
  last_clock_out_at timestamptz,
  worked_minutes integer NOT NULL DEFAULT 0 CHECK (worked_minutes >= 0),
  late_minutes integer NOT NULL DEFAULT 0 CHECK (late_minutes >= 0),
  overtime_minutes integer NOT NULL DEFAULT 0 CHECK (overtime_minutes >= 0),
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, attendance_date)
);

CREATE TABLE IF NOT EXISTS attendance_exception (
  attendance_exception_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_day_id uuid NOT NULL REFERENCES attendance_day(attendance_day_id),
  exception_type text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'under_review', 'resolved', 'dismissed')),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  reviewed_by uuid REFERENCES app_user(user_id),
  reviewed_at timestamptz,
  resolution text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leave_type (
  leave_type_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code citext NOT NULL UNIQUE,
  name text NOT NULL,
  unit text NOT NULL CHECK (unit IN ('days', 'hours')),
  policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leave_balance (
  leave_balance_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employee(employee_id),
  leave_type_id uuid NOT NULL REFERENCES leave_type(leave_type_id),
  period_start date NOT NULL,
  period_end date NOT NULL,
  opening numeric(10,2) NOT NULL DEFAULT 0,
  accrued numeric(10,2) NOT NULL DEFAULT 0,
  used numeric(10,2) NOT NULL DEFAULT 0,
  adjusted numeric(10,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, leave_type_id, period_start, period_end),
  CHECK (period_end >= period_start)
);

CREATE TABLE IF NOT EXISTS leave_request (
  leave_request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employee(employee_id),
  leave_type_id uuid NOT NULL REFERENCES leave_type(leave_type_id),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  amount numeric(10,2) NOT NULL CHECK (amount > 0), -- @money:ok leave duration in days, not currency
  reason text,
  status text NOT NULL DEFAULT 'draft',
  workflow_instance_id uuid REFERENCES workflow_instance(workflow_instance_id),
  submitted_at timestamptz,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on)
);

CREATE TABLE IF NOT EXISTS community_channel (
  community_channel_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_type text NOT NULL CHECK (channel_type IN ('company', 'department', 'team', 'group', 'direct')),
  name text,
  description text,
  department_id uuid REFERENCES department(department_id),
  private boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL REFERENCES app_user(user_id),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS community_member (
  community_member_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_channel_id uuid NOT NULL REFERENCES community_channel(community_channel_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  member_role text NOT NULL DEFAULT 'member',
  joined_at timestamptz NOT NULL DEFAULT now(),
  muted_until timestamptz,
  last_read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (community_channel_id, user_id)
);

CREATE TABLE IF NOT EXISTS community_message (
  community_message_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_channel_id uuid NOT NULL REFERENCES community_channel(community_channel_id) ON DELETE CASCADE,
  sender_user_id uuid REFERENCES app_user(user_id),
  parent_message_id uuid REFERENCES community_message(community_message_id),
  body text,
  message_type text NOT NULL DEFAULT 'text' CHECK (message_type IN ('text', 'image', 'audio', 'video', 'file', 'system')),
  document_id uuid REFERENCES document(document_id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  sent_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (body IS NOT NULL OR document_id IS NOT NULL OR message_type = 'system')
);

CREATE INDEX IF NOT EXISTS community_message_channel_time_idx ON community_message (community_channel_id, sent_at DESC);

CREATE TABLE IF NOT EXISTS community_reaction (
  community_reaction_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_message_id uuid NOT NULL REFERENCES community_message(community_message_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  reaction text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (community_message_id, user_id, reaction)
);

CREATE TABLE IF NOT EXISTS peer_recognition (
  peer_recognition_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_employee_id uuid NOT NULL REFERENCES employee(employee_id),
  to_employee_id uuid NOT NULL REFERENCES employee(employee_id),
  value_code text,
  message text NOT NULL,
  community_message_id uuid REFERENCES community_message(community_message_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_employee_id <> to_employee_id)
);

CREATE TABLE IF NOT EXISTS announcement (
  announcement_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL,
  audience jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'published', 'archived')),
  published_by uuid REFERENCES app_user(user_id),
  publish_at timestamptz,
  published_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mail_account (
  mail_account_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  email citext NOT NULL,
  incoming_protocol text NOT NULL CHECK (incoming_protocol IN ('imap', 'pop3')),
  incoming_host text NOT NULL,
  incoming_port integer NOT NULL CHECK (incoming_port BETWEEN 1 AND 65535),
  outgoing_host text NOT NULL,
  outgoing_port integer NOT NULL CHECK (outgoing_port BETWEEN 1 AND 65535),
  username text NOT NULL,
  integration_secret_id uuid NOT NULL REFERENCES integration_secret(integration_secret_id),
  tls boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'active',
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, email)
);

CREATE TABLE IF NOT EXISTS mail_folder (
  mail_folder_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mail_account_id uuid NOT NULL REFERENCES mail_account(mail_account_id) ON DELETE CASCADE,
  remote_key text NOT NULL,
  name text NOT NULL,
  special_use text,
  last_uid bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mail_account_id, remote_key)
);

CREATE TABLE IF NOT EXISTS mail_thread (
  mail_thread_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mail_account_id uuid NOT NULL REFERENCES mail_account(mail_account_id) ON DELETE CASCADE,
  subject text NOT NULL,
  participant_addresses citext[] NOT NULL DEFAULT '{}',
  last_message_at timestamptz NOT NULL,
  unread_count integer NOT NULL DEFAULT 0 CHECK (unread_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mail_message (
  mail_message_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mail_thread_id uuid NOT NULL REFERENCES mail_thread(mail_thread_id) ON DELETE CASCADE,
  mail_folder_id uuid REFERENCES mail_folder(mail_folder_id),
  remote_id text,
  internet_message_id text,
  from_address citext NOT NULL,
  to_addresses citext[] NOT NULL DEFAULT '{}',
  cc_addresses citext[] NOT NULL DEFAULT '{}',
  subject text NOT NULL,
  body_text text,
  body_html text,
  direction text NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
  sent_at timestamptz,
  received_at timestamptz,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mail_thread_id, remote_id)
);

CREATE TABLE IF NOT EXISTS mail_attachment (
  mail_attachment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mail_message_id uuid NOT NULL REFERENCES mail_message(mail_message_id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES document(document_id),
  content_id text,
  inline boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mail_message_id, document_id)
);

CREATE TABLE IF NOT EXISTS saved_report (
  saved_report_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES app_user(user_id),
  name text NOT NULL,
  report_key text NOT NULL,
  definition jsonb NOT NULL,
  shared boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, name)
);

CREATE TABLE IF NOT EXISTS report_schedule (
  report_schedule_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  saved_report_id uuid NOT NULL REFERENCES saved_report(saved_report_id) ON DELETE CASCADE,
  recurrence jsonb NOT NULL,
  timezone text NOT NULL DEFAULT 'Africa/Lagos',
  recipients citext[] NOT NULL,
  active boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  next_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- DOWN
DROP TABLE IF EXISTS report_schedule;
DROP TABLE IF EXISTS saved_report;
DROP TABLE IF EXISTS mail_attachment;
DROP TABLE IF EXISTS mail_message;
DROP TABLE IF EXISTS mail_thread;
DROP TABLE IF EXISTS mail_folder;
DROP TABLE IF EXISTS mail_account;
DROP TABLE IF EXISTS announcement;
DROP TABLE IF EXISTS peer_recognition;
DROP TABLE IF EXISTS community_reaction;
DROP INDEX IF EXISTS community_message_channel_time_idx;
DROP TABLE IF EXISTS community_message;
DROP TABLE IF EXISTS community_member;
DROP TABLE IF EXISTS community_channel;
DROP TABLE IF EXISTS leave_request;
DROP TABLE IF EXISTS leave_balance;
DROP TABLE IF EXISTS leave_type;
DROP TABLE IF EXISTS attendance_exception;
DROP TABLE IF EXISTS attendance_day;
DROP INDEX IF EXISTS attendance_event_employee_time_idx;
DROP TABLE IF EXISTS attendance_event;
DROP TABLE IF EXISTS employee_attendance_policy;
DROP TABLE IF EXISTS attendance_policy;
DROP INDEX IF EXISTS home_alert_open_subject_uq;
DROP TABLE IF EXISTS home_alert;
DROP TABLE IF EXISTS home_alert_rule;
