-- M6 payroll, the advanced option: salary grades, where people are placed, pay components, statutory rates, the base
-- a statutory line was worked from, and the employee's tax and pension numbers (docs/guides/payroll.md §4.1, §4.2,
-- §6.11, §6.12). Built and shipped off: nothing here is read until someone with payroll.configure switches the option
-- on from a date, and no rate, band, relief or grade is seeded (A26). MyCity enters each one on Configurations.
--
--   salary_grade            a band (minimum to maximum) under a code, from a date; a new version of a code from a later
--                           date ends the one before
--   employee_salary_grade   the grade a person is placed in, from a date; read against that grade's band in force
--   employee_pay_component  a person's monthly gross split into basic, housing, transport and others, each pensionable
--                           or not, from a date; a version is every row of the person starting that day
--   statutory_rate          a rate, a PAYE band or the relief, from a date; a version is every row of an item starting
--                           that day (a PAYE table is one row a band, in its position)
--   payslip_line.base_amount   what a statutory line's rate was applied to, for the statutory report
--   employee.tax_id, pension_pin, pension_administrator, nhf_number   masked as employee.statutory; written through
--                           the organisation service (TB)
--
-- Every versioned table is read with asOf and written with addVersion (shared/db/effective-dated), which locks the
-- key's versions and ends the open one the day before the new one starts. No two versions of one key overlap: each
-- key has one version starting on a given day and at most one open version (the two unique indexes below), and the
-- one write path closes the open version as it adds the next. Money is numeric(18,2); a rate is a percentage,
-- numeric(9,6). Every CHECK list is the contract's enum (packages/contract/schemas/statutory.js).
-- UP
CREATE TABLE IF NOT EXISTS salary_grade (
  salary_grade_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code citext NOT NULL,
  name text NOT NULL,
  minimum numeric(18,2) NOT NULL CHECK (minimum >= 0),
  maximum numeric(18,2) NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  created_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT salary_grade_band_check CHECK (maximum >= minimum),
  CONSTRAINT salary_grade_span_check CHECK (effective_to IS NULL OR effective_to > effective_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS salary_grade_version_uq ON salary_grade (code, effective_from);
CREATE UNIQUE INDEX IF NOT EXISTS salary_grade_open_uq ON salary_grade (code) WHERE effective_to IS NULL;
-- The grades listed lowest band first, and by the day a version starts (as of a date).
CREATE INDEX IF NOT EXISTS salary_grade_minimum_idx ON salary_grade (minimum);
CREATE INDEX IF NOT EXISTS salary_grade_effective_idx ON salary_grade (effective_from, effective_to);
CREATE INDEX IF NOT EXISTS salary_grade_created_by_fk_idx ON salary_grade (created_by);
CREATE OR REPLACE TRIGGER salary_grade_set_updated_at BEFORE UPDATE ON salary_grade
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS employee_salary_grade (
  employee_salary_grade_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employee(employee_id) ON DELETE RESTRICT,
  -- Any version of the grade: the band read is the version of its code in force on the day asked.
  salary_grade_id uuid NOT NULL REFERENCES salary_grade(salary_grade_id) ON DELETE RESTRICT,
  effective_from date NOT NULL,
  effective_to date,
  created_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_salary_grade_span_check CHECK (effective_to IS NULL OR effective_to > effective_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS employee_salary_grade_version_uq ON employee_salary_grade (employee_id, effective_from);
CREATE UNIQUE INDEX IF NOT EXISTS employee_salary_grade_open_uq ON employee_salary_grade (employee_id) WHERE effective_to IS NULL;
CREATE INDEX IF NOT EXISTS employee_salary_grade_grade_fk_idx ON employee_salary_grade (salary_grade_id);
CREATE INDEX IF NOT EXISTS employee_salary_grade_created_by_fk_idx ON employee_salary_grade (created_by);
CREATE OR REPLACE TRIGGER employee_salary_grade_set_updated_at BEFORE UPDATE ON employee_salary_grade
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS employee_pay_component (
  employee_pay_component_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employee(employee_id) ON DELETE RESTRICT,
  code citext NOT NULL CHECK (code::text ~ '^[a-z][a-z0-9_]*$'),
  label text NOT NULL,
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  pensionable boolean NOT NULL DEFAULT false,
  effective_from date NOT NULL,
  effective_to date,
  created_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_pay_component_span_check CHECK (effective_to IS NULL OR effective_to > effective_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS employee_pay_component_version_uq ON employee_pay_component (employee_id, code, effective_from);
CREATE UNIQUE INDEX IF NOT EXISTS employee_pay_component_open_uq ON employee_pay_component (employee_id, code) WHERE effective_to IS NULL;
CREATE INDEX IF NOT EXISTS employee_pay_component_employee_idx ON employee_pay_component (employee_id, effective_from);
CREATE INDEX IF NOT EXISTS employee_pay_component_created_by_fk_idx ON employee_pay_component (created_by);
CREATE OR REPLACE TRIGGER employee_pay_component_set_updated_at BEFORE UPDATE ON employee_pay_component
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS statutory_rate (
  statutory_rate_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item text NOT NULL CHECK (item IN ('paye', 'pension_employee', 'pension_employer', 'nhf', 'itf', 'nsitf', 'relief')),
  kind text NOT NULL CHECK (kind IN ('employee', 'employer')),
  base text NOT NULL CHECK (base IN ('gross', 'pensionable', 'basic', 'taxable', 'annual_payroll')),
  rate numeric(9,6) NOT NULL DEFAULT 0 CHECK (rate >= 0 AND rate <= 100),
  band_from numeric(18,2) CHECK (band_from >= 0),
  band_to numeric(18,2),
  flat_amount numeric(18,2) CHECK (flat_amount >= 0),
  position smallint CHECK (position >= 1),
  effective_from date NOT NULL,
  effective_to date,
  created_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT statutory_rate_span_check CHECK (effective_to IS NULL OR effective_to > effective_from),
  -- Which side an item falls on is code (statutory.js ITEM_KIND), held here too.
  CONSTRAINT statutory_rate_item_kind_check CHECK (kind = CASE WHEN item IN ('pension_employer', 'itf', 'nsitf') THEN 'employer' ELSE 'employee' END),
  -- A PAYE row is a band, in its place; no other item has one.
  CONSTRAINT statutory_rate_band_check CHECK ((item = 'paye') = (position IS NOT NULL AND band_from IS NOT NULL)),
  CONSTRAINT statutory_rate_band_order_check CHECK (band_to IS NULL OR band_from IS NULL OR band_to > band_from),
  CONSTRAINT statutory_rate_flat_check CHECK (flat_amount IS NULL OR item = 'relief')
);
CREATE UNIQUE INDEX IF NOT EXISTS statutory_rate_version_uq ON statutory_rate (item, (COALESCE(position, 0)), effective_from);
CREATE UNIQUE INDEX IF NOT EXISTS statutory_rate_open_uq ON statutory_rate (item, (COALESCE(position, 0))) WHERE effective_to IS NULL;
-- The rates in force on a day (Compute, Switch On) and listed by item and first day (Configurations).
CREATE INDEX IF NOT EXISTS statutory_rate_effective_idx ON statutory_rate (item, effective_from, effective_to);
CREATE INDEX IF NOT EXISTS statutory_rate_created_by_fk_idx ON statutory_rate (created_by);
CREATE OR REPLACE TRIGGER statutory_rate_set_updated_at BEFORE UPDATE ON statutory_rate
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- What a statutory line's rate was applied to (its pensionable pay, its taxable pay), kept for the report; null on
-- every other line.
ALTER TABLE payslip_line ADD COLUMN IF NOT EXISTS base_amount numeric(18,2);

-- The tax and pension numbers the statutory mask already names (shared/rbac/field-mask.js employee.statutory).
ALTER TABLE employee ADD COLUMN IF NOT EXISTS tax_id text;
ALTER TABLE employee ADD COLUMN IF NOT EXISTS pension_pin text;
ALTER TABLE employee ADD COLUMN IF NOT EXISTS pension_administrator text;
ALTER TABLE employee ADD COLUMN IF NOT EXISTS nhf_number text;

-- DOWN
ALTER TABLE employee DROP COLUMN IF EXISTS nhf_number;
ALTER TABLE employee DROP COLUMN IF EXISTS pension_administrator;
ALTER TABLE employee DROP COLUMN IF EXISTS pension_pin;
ALTER TABLE employee DROP COLUMN IF EXISTS tax_id;
ALTER TABLE payslip_line DROP COLUMN IF EXISTS base_amount;
DROP TRIGGER IF EXISTS statutory_rate_set_updated_at ON statutory_rate;
DROP INDEX IF EXISTS statutory_rate_created_by_fk_idx;
DROP INDEX IF EXISTS statutory_rate_effective_idx;
DROP INDEX IF EXISTS statutory_rate_open_uq;
DROP INDEX IF EXISTS statutory_rate_version_uq;
DROP TABLE IF EXISTS statutory_rate;
DROP TRIGGER IF EXISTS employee_pay_component_set_updated_at ON employee_pay_component;
DROP INDEX IF EXISTS employee_pay_component_created_by_fk_idx;
DROP INDEX IF EXISTS employee_pay_component_employee_idx;
DROP INDEX IF EXISTS employee_pay_component_open_uq;
DROP INDEX IF EXISTS employee_pay_component_version_uq;
DROP TABLE IF EXISTS employee_pay_component;
DROP TRIGGER IF EXISTS employee_salary_grade_set_updated_at ON employee_salary_grade;
DROP INDEX IF EXISTS employee_salary_grade_created_by_fk_idx;
DROP INDEX IF EXISTS employee_salary_grade_grade_fk_idx;
DROP INDEX IF EXISTS employee_salary_grade_open_uq;
DROP INDEX IF EXISTS employee_salary_grade_version_uq;
DROP TABLE IF EXISTS employee_salary_grade;
DROP TRIGGER IF EXISTS salary_grade_set_updated_at ON salary_grade;
DROP INDEX IF EXISTS salary_grade_created_by_fk_idx;
DROP INDEX IF EXISTS salary_grade_effective_idx;
DROP INDEX IF EXISTS salary_grade_minimum_idx;
DROP INDEX IF EXISTS salary_grade_open_uq;
DROP INDEX IF EXISTS salary_grade_version_uq;
DROP TABLE IF EXISTS salary_grade;
