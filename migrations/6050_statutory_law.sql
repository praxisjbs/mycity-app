-- M6 payroll, PR 11: the statutory engine to the law PR 9 read (docs/guides/payroll.md §4.2, §6.12, §6.16, §13.1
-- items 39 to 46). Built and shipped off, as before: nothing here is read until someone with payroll.configure switches
-- the advanced option on, and no figure is seeded (A26).
--
--   statutory_rate        two new items, rent_relief (a rate of the year's rent and its cap, in flat_amount) and
--                         minimum_wage (a month's amount, in flat_amount), and the base `rent`. `relief`, the
--                         Consolidated Relief Allowance's shape (no legal source from 1 January 2026), stays allowed for
--                         the rows saved before; the code never saves, shows or computes it again
--   payslip_line.code     gains paye_refund, an earning: the tax paid back when the year's cumulative tax falls
--                         (Operation of PAYE Regulations 2002, reg 4(2))
--   payslip.taxable_pay   the month's taxable pay an advanced payslip's PAYE was worked from, before rent relief, so the
--                         later months of the year read the year to date; null in simple mode, with no PAYE table, and
--                         in a month the minimum wage exempts
--   employee              nhf_contributes (the person's choice, NHF Act s.4(1)(b)) and state_of_residence (where their
--                         PAYE goes), both masked as employee.statutory and written through the organisation service
--   employee_rent_declaration   a person's declared rent for a tax year with its evidence; the property's address is a
--                         place (owner employee_rent_declaration.property_address), its readable line kept here
--   employee_pay_to_date  a person's taxable pay and tax for a year before MyCity's first statutory month (a previous
--                         employer's leaving certificate, or MyCity's own months before the option was on)
--
-- payroll_setting's three convention columns (paye_basis, pension_reduces_taxable, nhf_reduces_taxable) stay, unread:
-- the law settles all three, so the engine fixes them (§6.12 rule 14). 6000, 6020 and 6040 are merged and never edited
-- (MIGRATIONS §3); widening a CHECK is not destructive (§8). Every CHECK list is the contract's (statutory.js,
-- payslips.js, organisation.js NIGERIAN_STATES).
-- UP
ALTER TABLE statutory_rate DROP CONSTRAINT IF EXISTS statutory_rate_item_check;
ALTER TABLE statutory_rate DROP CONSTRAINT IF EXISTS statutory_rate_base_check;
ALTER TABLE statutory_rate DROP CONSTRAINT IF EXISTS statutory_rate_flat_check;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'statutory_rate_item_check') THEN
    ALTER TABLE statutory_rate ADD CONSTRAINT statutory_rate_item_check CHECK (item IN (
      'paye', 'pension_employee', 'pension_employer', 'nhf', 'itf', 'nsitf', 'rent_relief', 'minimum_wage', 'relief'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'statutory_rate_base_check') THEN
    ALTER TABLE statutory_rate ADD CONSTRAINT statutory_rate_base_check CHECK (base IN (
      'gross', 'pensionable', 'basic', 'taxable', 'annual_payroll', 'rent'));
  END IF;
  -- An amount on a version: rent relief's cap, the minimum wage, and the retired relief's flat amount.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'statutory_rate_flat_check') THEN
    ALTER TABLE statutory_rate ADD CONSTRAINT statutory_rate_flat_check CHECK (
      flat_amount IS NULL OR item IN ('rent_relief', 'minimum_wage', 'relief'));
  END IF;
END $$;

ALTER TABLE payslip_line DROP CONSTRAINT IF EXISTS payslip_line_code_check;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payslip_line_code_check') THEN
    ALTER TABLE payslip_line ADD CONSTRAINT payslip_line_code_check CHECK (code IN (
      'monthly_pay', 'overtime', 'lateness', 'early_departure', 'absence', 'unpaid_leave', 'unpaid_suspension', 'fine',
      'advance', 'adjustment_earning', 'adjustment_deduction', 'paye', 'paye_refund', 'pension_employee',
      'pension_employer', 'nhf', 'itf', 'nsitf'));
  END IF;
END $$;

-- The month's taxable pay an advanced payslip's PAYE was worked from, read back as the year to date.
ALTER TABLE payslip ADD COLUMN IF NOT EXISTS taxable_pay numeric(18,2);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payslip_taxable_pay_check') THEN
    ALTER TABLE payslip ADD CONSTRAINT payslip_taxable_pay_check CHECK (taxable_pay IS NULL OR taxable_pay >= 0);
  END IF;
END $$;

ALTER TABLE employee ADD COLUMN IF NOT EXISTS nhf_contributes boolean NOT NULL DEFAULT false;
ALTER TABLE employee ADD COLUMN IF NOT EXISTS state_of_residence text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_state_of_residence_check') THEN
    ALTER TABLE employee ADD CONSTRAINT employee_state_of_residence_check CHECK (state_of_residence IS NULL OR state_of_residence IN (
      'abia', 'adamawa', 'akwa_ibom', 'anambra', 'bauchi', 'bayelsa', 'benue', 'borno', 'cross_river', 'delta', 'ebonyi',
      'edo', 'ekiti', 'enugu', 'fct', 'gombe', 'imo', 'jigawa', 'kaduna', 'kano', 'katsina', 'kebbi', 'kogi', 'kwara',
      'lagos', 'nasarawa', 'niger', 'ogun', 'ondo', 'osun', 'oyo', 'plateau', 'rivers', 'sokoto', 'taraba', 'yobe',
      'zamfara'));
  END IF;
END $$;
-- The statutory report groups PAYE by the State a person lives in.
CREATE INDEX IF NOT EXISTS employee_state_of_residence_idx ON employee (state_of_residence);

CREATE TABLE IF NOT EXISTS employee_rent_declaration (
  employee_rent_declaration_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employee(employee_id) ON DELETE RESTRICT,
  year smallint NOT NULL CHECK (year BETWEEN 2026 AND 2100),
  -- The rent the person paid (their own share in a shared tenancy) and the months it covers, first days of months.
  rent_paid numeric(18,2) NOT NULL CHECK (rent_paid > 0),
  covers_from date NOT NULL CHECK (covers_from = date_trunc('month', covers_from)::date),
  covers_to date NOT NULL CHECK (covers_to = date_trunc('month', covers_to)::date),
  tenant_name text NOT NULL,
  landlord_name text NOT NULL,
  landlord_phone text,
  landlord_tax_id text,
  landlord_nin text,
  -- The readable line of the property's place (owner employee_rent_declaration.property_address), rewritten when a
  -- place saved while address search was down is named.
  property_address text NOT NULL,
  -- The evidence of payment, claimed from the upload engine as a rent_evidence document.
  evidence_document_id uuid REFERENCES document(document_id) ON DELETE SET NULL,
  entered_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_rent_declaration_span_check CHECK (covers_to >= covers_from),
  CONSTRAINT employee_rent_declaration_landlord_check CHECK (
    landlord_phone IS NOT NULL OR landlord_tax_id IS NOT NULL OR landlord_nin IS NOT NULL)
);
-- One declaration a person a year; also the person's own index (their declarations, newest year first).
CREATE UNIQUE INDEX IF NOT EXISTS employee_rent_declaration_year_uq ON employee_rent_declaration (employee_id, year);
CREATE INDEX IF NOT EXISTS employee_rent_declaration_evidence_fk_idx ON employee_rent_declaration (evidence_document_id);
CREATE INDEX IF NOT EXISTS employee_rent_declaration_entered_by_fk_idx ON employee_rent_declaration (entered_by);
CREATE OR REPLACE TRIGGER employee_rent_declaration_set_updated_at BEFORE UPDATE ON employee_rent_declaration
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS employee_pay_to_date (
  employee_pay_to_date_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employee(employee_id) ON DELETE RESTRICT,
  year smallint NOT NULL CHECK (year BETWEEN 2026 AND 2100),
  taxable_pay numeric(18,2) NOT NULL CHECK (taxable_pay >= 0),
  tax_paid numeric(18,2) NOT NULL CHECK (tax_paid >= 0),
  -- A previous employer's leaving certificate, claimed from the upload engine as a leaving_certificate document.
  document_id uuid REFERENCES document(document_id) ON DELETE SET NULL,
  entered_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- One entry a person a year; also the person's own index (their years, newest first).
CREATE UNIQUE INDEX IF NOT EXISTS employee_pay_to_date_year_uq ON employee_pay_to_date (employee_id, year);
CREATE INDEX IF NOT EXISTS employee_pay_to_date_document_fk_idx ON employee_pay_to_date (document_id);
CREATE INDEX IF NOT EXISTS employee_pay_to_date_entered_by_fk_idx ON employee_pay_to_date (entered_by);
CREATE OR REPLACE TRIGGER employee_pay_to_date_set_updated_at BEFORE UPDATE ON employee_pay_to_date
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- DOWN
DROP TRIGGER IF EXISTS employee_pay_to_date_set_updated_at ON employee_pay_to_date;
DROP INDEX IF EXISTS employee_pay_to_date_entered_by_fk_idx;
DROP INDEX IF EXISTS employee_pay_to_date_document_fk_idx;
DROP INDEX IF EXISTS employee_pay_to_date_year_uq;
-- DESTRUCTIVE: the pay to date entered since this file is lost on the way down.
DROP TABLE IF EXISTS employee_pay_to_date;
DROP TRIGGER IF EXISTS employee_rent_declaration_set_updated_at ON employee_rent_declaration;
DROP INDEX IF EXISTS employee_rent_declaration_entered_by_fk_idx;
DROP INDEX IF EXISTS employee_rent_declaration_evidence_fk_idx;
DROP INDEX IF EXISTS employee_rent_declaration_year_uq;
-- DESTRUCTIVE: the rent declared since this file is lost on the way down; its places are removed with it.
DELETE FROM place WHERE owner = 'employee_rent_declaration.property_address';
DROP TABLE IF EXISTS employee_rent_declaration;
DROP INDEX IF EXISTS employee_state_of_residence_idx;
ALTER TABLE employee DROP CONSTRAINT IF EXISTS employee_state_of_residence_check;
-- DESTRUCTIVE: the State of residence and the NHF choice entered since this file are lost on the way down.
ALTER TABLE employee DROP COLUMN IF EXISTS state_of_residence;
ALTER TABLE employee DROP COLUMN IF EXISTS nhf_contributes;
ALTER TABLE payslip DROP CONSTRAINT IF EXISTS payslip_taxable_pay_check;
-- DESTRUCTIVE: the taxable pay kept on advanced payslips since this file is lost on the way down.
ALTER TABLE payslip DROP COLUMN IF EXISTS taxable_pay;
-- DESTRUCTIVE: a PAYE refund line cannot stand under the narrower check, so it is removed on the way down.
DELETE FROM payslip_line WHERE code = 'paye_refund';
ALTER TABLE payslip_line DROP CONSTRAINT IF EXISTS payslip_line_code_check;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payslip_line_code_check') THEN
    ALTER TABLE payslip_line ADD CONSTRAINT payslip_line_code_check CHECK (code IN (
      'monthly_pay', 'overtime', 'lateness', 'early_departure', 'absence', 'unpaid_leave', 'unpaid_suspension', 'fine',
      'advance', 'adjustment_earning', 'adjustment_deduction', 'paye', 'pension_employee', 'pension_employer', 'nhf',
      'itf', 'nsitf'));
  END IF;
END $$;
-- DESTRUCTIVE: rent relief and minimum wage versions cannot stand under the narrower checks, so they are removed.
DELETE FROM statutory_rate WHERE item IN ('rent_relief', 'minimum_wage') OR base = 'rent';
ALTER TABLE statutory_rate DROP CONSTRAINT IF EXISTS statutory_rate_flat_check;
ALTER TABLE statutory_rate DROP CONSTRAINT IF EXISTS statutory_rate_base_check;
ALTER TABLE statutory_rate DROP CONSTRAINT IF EXISTS statutory_rate_item_check;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'statutory_rate_item_check') THEN
    ALTER TABLE statutory_rate ADD CONSTRAINT statutory_rate_item_check CHECK (item IN (
      'paye', 'pension_employee', 'pension_employer', 'nhf', 'itf', 'nsitf', 'relief'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'statutory_rate_base_check') THEN
    ALTER TABLE statutory_rate ADD CONSTRAINT statutory_rate_base_check CHECK (base IN (
      'gross', 'pensionable', 'basic', 'taxable', 'annual_payroll'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'statutory_rate_flat_check') THEN
    ALTER TABLE statutory_rate ADD CONSTRAINT statutory_rate_flat_check CHECK (flat_amount IS NULL OR item = 'relief');
  END IF;
END $$;
