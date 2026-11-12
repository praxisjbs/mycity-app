-- M10 Training: a person's own notes on a course, taken beside it on ESS · My Training (docs/guides/knowledge.md §6.13).
--
--   training_note   one running note per person and course, saved as they type. The person's
--                   alone: no route reads another's, Praxis AI reads none, and nothing is told.
--                   Keyed on the course, not the enrolment, so a Library course can be noted
--                   before it is started; it stays after completion.

-- UP
CREATE TABLE IF NOT EXISTS training_note (
  training_note_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  training_course_id uuid NOT NULL REFERENCES training_course(training_course_id) ON DELETE RESTRICT,
  employee_id uuid NOT NULL REFERENCES employee(employee_id) ON DELETE RESTRICT,
  body text NOT NULL DEFAULT '' CHECK (char_length(body) <= 20000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS training_note_once_uq ON training_note (employee_id, training_course_id);
CREATE INDEX IF NOT EXISTS training_note_course_fk_idx ON training_note (training_course_id);
CREATE OR REPLACE TRIGGER training_note_set_updated_at BEFORE UPDATE ON training_note
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- DOWN
DROP TRIGGER IF EXISTS training_note_set_updated_at ON training_note;
DROP TABLE IF EXISTS training_note; -- DESTRUCTIVE: rollback only; drops the notes UP's table holds
