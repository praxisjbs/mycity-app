-- Tables that exist only for tests/integration: the resource kit's test module (test_thing) and
-- the records its scope and search tests point at. Everything else comes from the real
-- migrations (helpers/schema.js). Never applied to a real database.

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

CREATE TABLE test_thing (
  test_thing_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number        text UNIQUE,
  name          text NOT NULL,
  owner_employee_id uuid,
  archived_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
