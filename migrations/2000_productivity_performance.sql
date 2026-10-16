-- M2 projects, tasks, calendar, goal cascade, KPIs and performance reviews.
-- UP
CREATE TABLE IF NOT EXISTS project (
  project_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  owner_employee_id uuid REFERENCES employee(employee_id),
  department_id uuid REFERENCES department(department_id),
  status text NOT NULL DEFAULT 'active',
  starts_on date,
  due_on date,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (due_on IS NULL OR starts_on IS NULL OR due_on >= starts_on)
);

CREATE TABLE IF NOT EXISTS task (
  task_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES project(project_id),
  parent_task_id uuid REFERENCES task(task_id),
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'todo',
  priority text NOT NULL DEFAULT 'normal',
  created_by uuid NOT NULL REFERENCES app_user(user_id),
  primary_assignee_id uuid REFERENCES employee(employee_id),
  starts_at timestamptz,
  due_at timestamptz,
  completed_at timestamptz,
  recurrence jsonb,
  blocked_reason text,
  sort_order numeric(18,6) NOT NULL DEFAULT 0,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (due_at IS NULL OR starts_at IS NULL OR due_at >= starts_at)
);

CREATE INDEX IF NOT EXISTS task_assignee_due_idx ON task (primary_assignee_id, status, due_at) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS task_assignee (
  task_assignee_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES task(task_id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employee(employee_id),
  assignment_role text,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, employee_id)
);

CREATE TABLE IF NOT EXISTS task_comment (
  task_comment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES task(task_id) ON DELETE CASCADE,
  author_user_id uuid NOT NULL REFERENCES app_user(user_id),
  body text NOT NULL,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS calendar_event (
  calendar_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  event_type text NOT NULL,
  owner_employee_id uuid REFERENCES employee(employee_id),
  task_id uuid REFERENCES task(task_id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  all_day boolean NOT NULL DEFAULT false,
  location text,
  recurrence jsonb,
  created_by uuid NOT NULL REFERENCES app_user(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE TABLE IF NOT EXISTS organisational_goal (
  organisational_goal_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_goal_id uuid REFERENCES organisational_goal(organisational_goal_id),
  level text NOT NULL CHECK (level IN ('organisation', 'department', 'team', 'role', 'individual')),
  department_id uuid REFERENCES department(department_id),
  employee_id uuid REFERENCES employee(employee_id),
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'draft',
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  weight numeric(5,2) NOT NULL DEFAULT 100 CHECK (weight > 0 AND weight <= 100),
  owner_employee_id uuid NOT NULL REFERENCES employee(employee_id),
  workflow_instance_id uuid REFERENCES workflow_instance(workflow_instance_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on)
);

CREATE TABLE IF NOT EXISTS kpi_definition (
  kpi_definition_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code citext NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  job_title text,
  measurement_type text NOT NULL,
  unit text,
  direction text NOT NULL DEFAULT 'higher' CHECK (direction IN ('higher', 'lower', 'target')),
  scoring jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS employee_target (
  employee_target_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisational_goal_id uuid REFERENCES organisational_goal(organisational_goal_id),
  kpi_definition_id uuid REFERENCES kpi_definition(kpi_definition_id),
  employee_id uuid NOT NULL REFERENCES employee(employee_id),
  title text NOT NULL,
  target_value numeric(18,4),
  actual_value numeric(18,4),
  weight numeric(5,2) NOT NULL CHECK (weight > 0 AND weight <= 100),
  status text NOT NULL DEFAULT 'draft',
  due_on date,
  approved_by uuid REFERENCES app_user(user_id),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS performance_cycle (
  performance_cycle_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  self_review_opens_at timestamptz,
  manager_review_opens_at timestamptz,
  closes_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name, starts_on),
  CHECK (ends_on >= starts_on)
);

CREATE TABLE IF NOT EXISTS performance_review (
  performance_review_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  performance_cycle_id uuid NOT NULL REFERENCES performance_cycle(performance_cycle_id),
  employee_id uuid NOT NULL REFERENCES employee(employee_id),
  reviewer_employee_id uuid NOT NULL REFERENCES employee(employee_id),
  review_type text NOT NULL CHECK (review_type IN ('self', 'manager', 'designated')),
  status text NOT NULL DEFAULT 'draft',
  overall_score numeric(8,4),
  summary text,
  dictation_document_id uuid REFERENCES document(document_id),
  submitted_at timestamptz,
  acknowledged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (performance_cycle_id, employee_id, reviewer_employee_id, review_type)
);

CREATE TABLE IF NOT EXISTS performance_review_item (
  performance_review_item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  performance_review_id uuid NOT NULL REFERENCES performance_review(performance_review_id) ON DELETE CASCADE,
  employee_target_id uuid REFERENCES employee_target(employee_target_id),
  kpi_definition_id uuid REFERENCES kpi_definition(kpi_definition_id),
  score numeric(8,4),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (employee_target_id IS NOT NULL OR kpi_definition_id IS NOT NULL)
);

-- DOWN
DROP TABLE IF EXISTS performance_review_item;
DROP TABLE IF EXISTS performance_review;
DROP TABLE IF EXISTS performance_cycle;
DROP TABLE IF EXISTS employee_target;
DROP TABLE IF EXISTS kpi_definition;
DROP TABLE IF EXISTS organisational_goal;
DROP TABLE IF EXISTS calendar_event;
DROP TABLE IF EXISTS task_comment;
DROP TABLE IF EXISTS task_assignee;
DROP INDEX IF EXISTS task_assignee_due_idx;
DROP TABLE IF EXISTS task;
DROP TABLE IF EXISTS project;
