-- M6 payroll: whether a leave type is unpaid (docs/guides/payroll.md §4.1, §6.5; AJ reviews it, leave is M1).
-- Payroll deducts the working days of an approved request of an unpaid type at the person's daily rate, because
-- nothing in attendance deducts for leave. The flag is data on the type, so People decide which types are
-- unpaid and no code switches on a type's name. 6099 flags the seeded Unpaid type.
-- UP
ALTER TABLE leave_type ADD COLUMN IF NOT EXISTS unpaid boolean NOT NULL DEFAULT false;

-- DOWN
ALTER TABLE leave_type DROP COLUMN IF EXISTS unpaid;
