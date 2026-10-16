-- M4 recruitment pipeline and assessment reference data.
-- UP
INSERT INTO reference_value (domain, code, label, display_order)
VALUES
  ('vacancy_status', 'draft', 'Draft', 10),
  ('vacancy_status', 'open', 'Open', 20),
  ('vacancy_status', 'paused', 'Paused', 30),
  ('vacancy_status', 'closed', 'Closed', 40),
  ('application_stage', 'application', 'Application', 10),
  ('application_stage', 'screening', 'Screening', 20),
  ('application_stage', 'assessment', 'Assessment', 30),
  ('application_stage', 'interview', 'Interview', 40),
  ('application_stage', 'shortlist', 'Shortlist', 50),
  ('application_stage', 'offer', 'Offer', 60),
  ('application_stage', 'documentation', 'Documentation', 70),
  ('application_stage', 'pre_onboarding', 'Pre-onboarding', 80),
  ('application_stage', 'onboarding', 'Onboarding', 90),
  ('application_stage', 'hired', 'Hired', 100),
  ('application_stage', 'rejected', 'Rejected', 110),
  ('assessment_type', 'psychometric', 'Psychometric', 10),
  ('assessment_type', 'technical', 'Technical', 20),
  ('assessment_type', 'case_study', 'Case Study', 30),
  ('assessment_type', 'practical', 'Practical', 40)
ON CONFLICT (domain, code) DO UPDATE SET
  label = EXCLUDED.label,
  display_order = EXCLUDED.display_order,
  active = true;

-- DOWN
DELETE FROM reference_value WHERE domain IN ('vacancy_status', 'application_stage', 'assessment_type');
