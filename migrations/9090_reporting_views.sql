-- Read-only operational reporting views.
-- UP
CREATE OR REPLACE VIEW attendance_summary AS
SELECT employee_id, attendance_date, status, worked_minutes, overtime_minutes
FROM attendance_day;

CREATE OR REPLACE VIEW recruitment_pipeline_summary AS
SELECT v.vacancy_id, v.number, v.title, a.stage, count(a.application_id)::bigint AS application_count
FROM vacancy v
LEFT JOIN application a ON a.vacancy_id = v.vacancy_id
GROUP BY v.vacancy_id, v.number, v.title, a.stage;

CREATE OR REPLACE VIEW partnership_pipeline_summary AS
SELECT stage, status, currency, count(*)::bigint AS opportunity_count,
       coalesce(sum(estimated_value), 0)::numeric(18,2) AS estimated_value
FROM partnership_opportunity
GROUP BY stage, status, currency;

CREATE OR REPLACE VIEW budget_utilisation_summary AS
SELECT b.budget_id, b.number, b.name, b.currency,
       coalesce(sum(bl.amount), 0)::numeric(18,2) AS allocated_amount,
       coalesce(sum(bl.committed_amount), 0)::numeric(18,2) AS committed_amount,
       coalesce(sum(bl.spent_amount), 0)::numeric(18,2) AS spent_amount
FROM budget b
LEFT JOIN budget_line bl ON bl.budget_id = b.budget_id
GROUP BY b.budget_id, b.number, b.name, b.currency;

-- DOWN
DROP VIEW IF EXISTS budget_utilisation_summary;
DROP VIEW IF EXISTS partnership_pipeline_summary;
DROP VIEW IF EXISTS recruitment_pipeline_summary;
DROP VIEW IF EXISTS attendance_summary;
