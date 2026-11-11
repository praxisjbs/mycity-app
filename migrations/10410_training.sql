-- M10 Training: courses, who must take them, progress and certificates (docs/guides/knowledge.md §4,
-- §6.5 to §6.9).
--
--   training_course               a course. Numbered (training_course, TRN-0001). Draft, published
--                                 (once, with the publisher's signature, name and title copied then,
--                                 printed on every certificate) or archived. Library: anyone may
--                                 take it. Proof Required: asked at the end. Issue Certificate.
--   training_item                 a course's items in order: a file (the vault), a video or course
--                                 link, or a written lesson (Markdown). The order is unique, checked
--                                 at commit, so a reorder can swap two positions.
--   training_assignment           one Assign Training press: everyone or an audience, the days a
--                                 person has to finish, whether joiners keep being enrolled.
--   training_assignment_audience  the audience beyond everyone: departments, roles, named people;
--                                 matched in SQL, so rows.
--   training_enrolment            one person on one course, assigned or started from the Library:
--                                 due date, start, completion, proof, the certificate's number, PDF
--                                 and hash, the task it set and the reminders sent.
--   training_item_progress        an item a person has marked done.
-- UP
CREATE TABLE IF NOT EXISTS training_course (
  training_course_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number citext NOT NULL UNIQUE,
  title text NOT NULL,
  summary text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  library boolean NOT NULL DEFAULT false,
  proof_required boolean NOT NULL DEFAULT false,
  proof_prompt text,
  issue_certificate boolean NOT NULL DEFAULT true,
  published_at timestamptz,
  published_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  signer_name text,
  signer_title text,
  signature_document_id uuid REFERENCES document(document_id) ON DELETE RESTRICT,
  archived_at timestamptz,
  archived_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  archive_reason text,
  created_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT training_course_archived_check CHECK ((status = 'archived') = (archived_at IS NOT NULL)),
  -- Published once: the publication and its signature arrive together and never leave.
  CONSTRAINT training_course_published_check CHECK (
    (published_at IS NULL AND published_by IS NULL AND signer_name IS NULL AND signature_document_id IS NULL)
    OR (published_at IS NOT NULL AND published_by IS NOT NULL AND signer_name IS NOT NULL AND signature_document_id IS NOT NULL)
  ),
  CONSTRAINT training_course_published_state_check CHECK (status <> 'published' OR published_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS training_course_title_idx ON training_course (title, training_course_id);
CREATE INDEX IF NOT EXISTS training_course_status_idx ON training_course (status, updated_at, training_course_id);
CREATE INDEX IF NOT EXISTS training_course_library_idx ON training_course (title, training_course_id)
  WHERE status = 'published' AND library;
CREATE INDEX IF NOT EXISTS training_course_published_by_fk_idx ON training_course (published_by);
CREATE INDEX IF NOT EXISTS training_course_signature_fk_idx ON training_course (signature_document_id);
CREATE INDEX IF NOT EXISTS training_course_archived_by_fk_idx ON training_course (archived_by);
CREATE INDEX IF NOT EXISTS training_course_created_by_fk_idx ON training_course (created_by);
CREATE INDEX IF NOT EXISTS training_course_updated_by_fk_idx ON training_course (updated_by);
CREATE OR REPLACE TRIGGER training_course_set_updated_at BEFORE UPDATE ON training_course
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS training_item (
  training_item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  training_course_id uuid NOT NULL REFERENCES training_course(training_course_id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position BETWEEN 1 AND 40),
  kind text NOT NULL CHECK (kind IN ('file', 'video', 'link', 'lesson')),
  title text NOT NULL,
  url text,
  document_id uuid REFERENCES document(document_id) ON DELETE RESTRICT,
  lesson_markdown text,
  minutes integer CHECK (minutes BETWEEN 1 AND 600),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Each kind holds exactly its own content.
  CONSTRAINT training_item_content_check CHECK (
    (kind = 'file' AND document_id IS NOT NULL AND url IS NULL AND lesson_markdown IS NULL)
    OR (kind IN ('video', 'link') AND url IS NOT NULL AND document_id IS NULL AND lesson_markdown IS NULL)
    OR (kind = 'lesson' AND lesson_markdown IS NOT NULL AND url IS NULL AND document_id IS NULL)
  ),
  CONSTRAINT training_item_url_check CHECK (url IS NULL OR url ~ '^https://'),
  CONSTRAINT training_item_position_uq UNIQUE (training_course_id, position) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX IF NOT EXISTS training_item_document_fk_idx ON training_item (document_id);
CREATE OR REPLACE TRIGGER training_item_set_updated_at BEFORE UPDATE ON training_item
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS training_assignment (
  training_assignment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  training_course_id uuid NOT NULL REFERENCES training_course(training_course_id) ON DELETE RESTRICT,
  everyone boolean NOT NULL DEFAULT false,
  due_within_days integer CHECK (due_within_days BETWEEN 1 AND 365),
  keep_assigning boolean NOT NULL DEFAULT true,
  withdrawn_at timestamptz,
  withdrawn_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  created_by uuid REFERENCES app_user(user_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT training_assignment_withdrawn_check CHECK ((withdrawn_at IS NULL) = (withdrawn_by IS NULL))
);
CREATE INDEX IF NOT EXISTS training_assignment_course_fk_idx ON training_assignment (training_course_id, created_at, training_assignment_id);
-- The assignments that still enrol joiners.
CREATE INDEX IF NOT EXISTS training_assignment_open_idx ON training_assignment (training_course_id)
  WHERE withdrawn_at IS NULL AND keep_assigning;
CREATE INDEX IF NOT EXISTS training_assignment_withdrawn_by_fk_idx ON training_assignment (withdrawn_by);
CREATE INDEX IF NOT EXISTS training_assignment_created_by_fk_idx ON training_assignment (created_by);
CREATE OR REPLACE TRIGGER training_assignment_set_updated_at BEFORE UPDATE ON training_assignment
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS training_assignment_audience (
  training_assignment_audience_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  training_assignment_id uuid NOT NULL REFERENCES training_assignment(training_assignment_id) ON DELETE CASCADE,
  department_id uuid REFERENCES department(department_id) ON DELETE RESTRICT,
  role_id uuid REFERENCES role(role_id) ON DELETE RESTRICT,
  employee_id uuid REFERENCES employee(employee_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT training_assignment_audience_one_check CHECK (num_nonnulls(department_id, role_id, employee_id) = 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS training_assignment_audience_once_uq
  ON training_assignment_audience (training_assignment_id, COALESCE(department_id, role_id, employee_id));
CREATE INDEX IF NOT EXISTS training_assignment_audience_department_fk_idx ON training_assignment_audience (department_id);
CREATE INDEX IF NOT EXISTS training_assignment_audience_role_fk_idx ON training_assignment_audience (role_id);
CREATE INDEX IF NOT EXISTS training_assignment_audience_employee_fk_idx ON training_assignment_audience (employee_id);

CREATE TABLE IF NOT EXISTS training_enrolment (
  training_enrolment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  training_course_id uuid NOT NULL REFERENCES training_course(training_course_id) ON DELETE RESTRICT,
  employee_id uuid NOT NULL REFERENCES employee(employee_id) ON DELETE RESTRICT,
  training_assignment_id uuid REFERENCES training_assignment(training_assignment_id) ON DELETE SET NULL,
  due_on date,
  started_at timestamptz,
  completed_at timestamptz,
  proof_url text CHECK (proof_url IS NULL OR proof_url ~ '^https://'),
  proof_document_id uuid REFERENCES document(document_id) ON DELETE RESTRICT,
  certificate_number citext UNIQUE,
  certificate_document_id uuid REFERENCES document(document_id) ON DELETE RESTRICT,
  certificate_hash text,
  task_id uuid REFERENCES task(task_id) ON DELETE SET NULL,
  reminded_at timestamptz,
  reminders_sent integer NOT NULL DEFAULT 0 CHECK (reminders_sent >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT training_enrolment_proof_check CHECK (proof_url IS NULL OR proof_document_id IS NULL),
  -- A certificate's number and hash exist only on a completion; its PDF follows from the worker.
  CONSTRAINT training_enrolment_certificate_check CHECK (
    certificate_number IS NULL OR (completed_at IS NOT NULL AND certificate_hash IS NOT NULL)
  ),
  CONSTRAINT training_enrolment_certificate_pdf_check CHECK (certificate_document_id IS NULL OR certificate_number IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS training_enrolment_once_uq ON training_enrolment (training_course_id, employee_id);
CREATE INDEX IF NOT EXISTS training_enrolment_employee_fk_idx ON training_enrolment (employee_id, completed_at, due_on);
CREATE INDEX IF NOT EXISTS training_enrolment_assignment_fk_idx ON training_enrolment (training_assignment_id);
-- The reminder engine's sweep: open enrolments with a due date.
CREATE INDEX IF NOT EXISTS training_enrolment_due_idx ON training_enrolment (due_on, training_enrolment_id)
  WHERE completed_at IS NULL AND due_on IS NOT NULL;
CREATE INDEX IF NOT EXISTS training_enrolment_proof_document_fk_idx ON training_enrolment (proof_document_id);
CREATE INDEX IF NOT EXISTS training_enrolment_certificate_document_fk_idx ON training_enrolment (certificate_document_id);
CREATE INDEX IF NOT EXISTS training_enrolment_task_fk_idx ON training_enrolment (task_id);
CREATE OR REPLACE TRIGGER training_enrolment_set_updated_at BEFORE UPDATE ON training_enrolment
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS training_item_progress (
  training_item_progress_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  training_enrolment_id uuid NOT NULL REFERENCES training_enrolment(training_enrolment_id) ON DELETE CASCADE,
  training_item_id uuid NOT NULL REFERENCES training_item(training_item_id) ON DELETE CASCADE,
  done_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS training_item_progress_once_uq ON training_item_progress (training_enrolment_id, training_item_id);
CREATE INDEX IF NOT EXISTS training_item_progress_item_fk_idx ON training_item_progress (training_item_id);

-- DOWN
DROP TABLE IF EXISTS training_item_progress;
DROP TRIGGER IF EXISTS training_enrolment_set_updated_at ON training_enrolment;
DROP TABLE IF EXISTS training_enrolment;
DROP TABLE IF EXISTS training_assignment_audience;
DROP TRIGGER IF EXISTS training_assignment_set_updated_at ON training_assignment;
DROP TABLE IF EXISTS training_assignment;
DROP TRIGGER IF EXISTS training_item_set_updated_at ON training_item;
DROP TABLE IF EXISTS training_item;
DROP TRIGGER IF EXISTS training_course_set_updated_at ON training_course;
DROP TABLE IF EXISTS training_course;
