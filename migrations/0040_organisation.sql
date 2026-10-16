-- M0 departments, worksites, employees and effective-dated reporting lines.
-- UP
CREATE TABLE IF NOT EXISTS department (
  department_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_department_id uuid REFERENCES department(department_id),
  code citext NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS worksite (
  worksite_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code citext NOT NULL UNIQUE,
  name text NOT NULL,
  address jsonb NOT NULL DEFAULT '{}'::jsonb,
  latitude numeric(9,6) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude numeric(9,6) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  radius_m integer NOT NULL CHECK (radius_m > 0),
  timezone text NOT NULL DEFAULT 'Africa/Lagos',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS employee (
  employee_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number citext NOT NULL UNIQUE,
  first_name text NOT NULL,
  middle_name text,
  last_name text NOT NULL,
  preferred_name text,
  work_email citext NOT NULL UNIQUE,
  personal_email citext,
  phone text,
  job_title text NOT NULL,
  department_id uuid NOT NULL REFERENCES department(department_id),
  worksite_id uuid REFERENCES worksite(worksite_id),
  line_manager_id uuid REFERENCES employee(employee_id),
  employment_type text NOT NULL,
  work_pattern text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  start_date date NOT NULL,
  confirmation_due_on date,
  confirmed_on date,
  left_on date,
  profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (confirmation_due_on IS NULL OR confirmation_due_on >= start_date),
  CHECK (left_on IS NULL OR left_on >= start_date)
);

CREATE TABLE IF NOT EXISTS reporting_line (
  reporting_line_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employee(employee_id),
  manager_id uuid NOT NULL REFERENCES employee(employee_id),
  effective_from date NOT NULL,
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, manager_id, effective_from),
  CHECK (employee_id <> manager_id),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE OR REPLACE VIEW employee_team_closure AS
WITH RECURSIVE team AS (
  SELECT employee_id AS manager_id, employee_id, 0 AS depth
  FROM employee
  UNION ALL
  SELECT team.manager_id, employee.employee_id, team.depth + 1
  FROM team
  JOIN employee ON employee.line_manager_id = team.employee_id
  WHERE team.depth < 32
)
SELECT manager_id, employee_id, min(depth) AS depth
FROM team
GROUP BY manager_id, employee_id;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'app_user_employee_fk') THEN
    ALTER TABLE app_user
      ADD CONSTRAINT app_user_employee_fk
      FOREIGN KEY (employee_id) REFERENCES employee(employee_id);
  END IF;
END;
$$;

-- DOWN
ALTER TABLE app_user DROP CONSTRAINT IF EXISTS app_user_employee_fk;
DROP VIEW IF EXISTS employee_team_closure;
DROP TABLE IF EXISTS reporting_line;
DROP TABLE IF EXISTS employee;
DROP TABLE IF EXISTS worksite;
DROP TABLE IF EXISTS department;
