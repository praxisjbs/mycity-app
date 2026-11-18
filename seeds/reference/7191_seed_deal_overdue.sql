-- M7 deal health Overdue (docs/guides/partnerships.md §6.5; QA F52): the code the morning job sets on an open deal past its expected close date, as the contract spells it, so its history line reads Overdue.
-- A code the service switches on (A26), not a business choice.
-- UP
INSERT INTO reference_value (domain, code, label, display_order)
VALUES ('deal_health', 'overdue', 'Overdue', 40)
ON CONFLICT (domain, code) DO NOTHING;

-- DOWN
DELETE FROM reference_value WHERE domain = 'deal_health' AND code = 'overdue';
