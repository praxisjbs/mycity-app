-- M10 Training: a certificate keeps the name and course title it was issued with (docs/guides/knowledge.md §6.9, §6.10).
--
-- A certificate states the holder's full name and the course's title as they were on the day it was
-- completed; its hash is over those facts, and Verify a Document recomputes it from them. A person
-- or course renamed later keeps the certificate as issued, so the facts are kept on the enrolment
-- beside the number and the hash, filled in the same transaction. A completion made before this
-- file (M10 PR 3, no screens yet) is filled from the record as it stands now.

-- UP
ALTER TABLE training_enrolment ADD COLUMN IF NOT EXISTS certificate_holder_name text;
ALTER TABLE training_enrolment ADD COLUMN IF NOT EXISTS certificate_course_title text;

UPDATE training_enrolment te
   SET certificate_holder_name = btrim(e.first_name || ' ' || e.last_name),
       certificate_course_title = c.title
  FROM employee e, training_course c
 WHERE e.employee_id = te.employee_id
   AND c.training_course_id = te.training_course_id
   AND te.certificate_number IS NOT NULL
   AND (te.certificate_holder_name IS NULL OR te.certificate_course_title IS NULL);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'training_enrolment_certificate_facts_check') THEN
    ALTER TABLE training_enrolment ADD CONSTRAINT training_enrolment_certificate_facts_check
      CHECK ((certificate_number IS NULL) = (certificate_holder_name IS NULL AND certificate_course_title IS NULL)
             AND (certificate_holder_name IS NULL) = (certificate_course_title IS NULL));
  END IF;
END $$;

-- DOWN
ALTER TABLE training_enrolment DROP CONSTRAINT IF EXISTS training_enrolment_certificate_facts_check;
ALTER TABLE training_enrolment DROP COLUMN IF EXISTS certificate_course_title; -- DESTRUCTIVE: rollback only; drops what UP added
ALTER TABLE training_enrolment DROP COLUMN IF EXISTS certificate_holder_name; -- DESTRUCTIVE: rollback only; drops what UP added
