-- M7 proposals with the Proposal Studio's questions, sources, images, saved templates and views, MyCity's proof points, and agreements as the guide has them (docs/guides/partnerships.md §4.2, §6.8 to §6.11).
--
--   proposal_template      a saved structure for a category: layouts, their order and tone notes,
--                          never a partner's facts
--   partnership_proposal   gains its brief, structured content, design template, AI run, validity,
--                          public link, recipients, views, outcome and the version it revises;
--                          status as the studio and the link move it
--   proposal_question      a question card Claude asks, with its answer and what it replaced
--   proposal_source        notes or a transcript given to Claude
--   proposal_asset         an image of a proposal (a kit stand-in until MyCity uploads one)
--   proposal_view          one opening of the public link; the address is kept only as a keyed hash
--   proof_point            a fact about MyCity a proposal may cite; MyCity enters them (A26)
--   partnership_agreement  on a lead or a partner (one of the two), filled from a category template
--                          (key and version), with its approval, the sealed copy, renewal and
--                          closing; status Draft to Renewed or Closed (MILESTONES §12); starts_on is
--                          set at signing
--   agreement_obligation   dropped: nothing ever wrote it, and a deal's deliverables replace it (§4.1)
-- UP

/* ------------------------------------------------------------------ *
 * Saved proposal templates
 * ------------------------------------------------------------------ */
CREATE TABLE IF NOT EXISTS proposal_template (
  proposal_template_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  partner_category_id uuid REFERENCES partner_category(partner_category_id) ON DELETE RESTRICT,
  structure jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_from_proposal_id uuid REFERENCES partnership_proposal(partnership_proposal_id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS proposal_template_category_idx ON proposal_template (partner_category_id);
CREATE INDEX IF NOT EXISTS proposal_template_from_idx ON proposal_template (created_from_proposal_id);

CREATE OR REPLACE TRIGGER proposal_template_set_updated_at BEFORE UPDATE ON proposal_template
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

/* ------------------------------------------------------------------ *
 * partnership_proposal
 * ------------------------------------------------------------------ */
ALTER TABLE partnership_proposal
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS brief jsonb,
  -- The contract's ProposalContent: sections, each a layout of the design kit.
  ADD COLUMN IF NOT EXISTS content jsonb,
  ADD COLUMN IF NOT EXISTS design_template_id uuid REFERENCES proposal_template(proposal_template_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ai_run_id uuid REFERENCES ai_run(run_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS valid_until date,
  ADD COLUMN IF NOT EXISTS public_token_id uuid REFERENCES public_token(public_token_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sent_to text[],
  ADD COLUMN IF NOT EXISTS sent_cc text[],
  ADD COLUMN IF NOT EXISTS first_viewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_viewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS view_count integer NOT NULL DEFAULT 0 CHECK (view_count >= 0),
  ADD COLUMN IF NOT EXISTS declined_at timestamptz,
  ADD COLUMN IF NOT EXISTS decline_reason text,
  ADD COLUMN IF NOT EXISTS withdrawn_at timestamptz,
  ADD COLUMN IF NOT EXISTS supersedes_id uuid REFERENCES partnership_proposal(partnership_proposal_id) ON DELETE SET NULL;

UPDATE partnership_proposal SET status = 'draft'
 WHERE status NOT IN ('brief', 'questions', 'writing', 'draft', 'sent', 'viewed', 'accepted', 'declined', 'expired', 'withdrawn');

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'partnership_proposal_status_check' AND conrelid = 'partnership_proposal'::regclass) THEN
    ALTER TABLE partnership_proposal ADD CONSTRAINT partnership_proposal_status_check
      CHECK (status IN ('brief', 'questions', 'writing', 'draft', 'sent', 'viewed', 'accepted', 'declined', 'expired', 'withdrawn'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS partnership_proposal_deal_idx ON partnership_proposal (partnership_opportunity_id);
CREATE INDEX IF NOT EXISTS partnership_proposal_status_idx ON partnership_proposal (status);
CREATE INDEX IF NOT EXISTS partnership_proposal_document_idx ON partnership_proposal (document_id);
CREATE INDEX IF NOT EXISTS partnership_proposal_created_by_idx ON partnership_proposal (created_by);
CREATE INDEX IF NOT EXISTS partnership_proposal_template_idx ON partnership_proposal (design_template_id);
CREATE INDEX IF NOT EXISTS partnership_proposal_ai_run_idx ON partnership_proposal (ai_run_id);
CREATE INDEX IF NOT EXISTS partnership_proposal_token_idx ON partnership_proposal (public_token_id);
CREATE INDEX IF NOT EXISTS partnership_proposal_supersedes_idx ON partnership_proposal (supersedes_id);

/* ------------------------------------------------------------------ *
 * The studio's question cards, sources and images, and the link's views
 * ------------------------------------------------------------------ */
CREATE TABLE IF NOT EXISTS proposal_question (
  proposal_question_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partnership_proposal_id uuid NOT NULL REFERENCES partnership_proposal(partnership_proposal_id) ON DELETE CASCADE,
  position integer NOT NULL,
  group_key text NOT NULL CHECK (group_key IN ('partner', 'offer', 'audience', 'money', 'timing', 'proof')),
  question text NOT NULL,
  why text,
  answer_kind text NOT NULL
    CHECK (answer_kind IN ('short_text', 'long_text', 'number', 'money', 'date', 'pick', 'multi_pick')),
  options jsonb,
  suggested jsonb,
  -- Where the suggestion came from: "From the transcript, 00:21:51", "From the deal".
  suggested_from text,
  required boolean NOT NULL DEFAULT false,
  answer jsonb,
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'answered', 'skipped', 'replaced')),
  replaces_id uuid REFERENCES proposal_question(proposal_question_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS proposal_question_proposal_idx ON proposal_question (partnership_proposal_id, position);
CREATE INDEX IF NOT EXISTS proposal_question_replaces_idx ON proposal_question (replaces_id);

CREATE OR REPLACE TRIGGER proposal_question_set_updated_at BEFORE UPDATE ON proposal_question
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS proposal_source (
  proposal_source_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partnership_proposal_id uuid NOT NULL REFERENCES partnership_proposal(partnership_proposal_id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('notes', 'transcript')),
  -- A transcript upload.
  document_id uuid REFERENCES document(document_id) ON DELETE SET NULL,
  -- The notes, or the transcript's text.
  text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT proposal_source_has_content CHECK (text IS NOT NULL OR document_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS proposal_source_proposal_idx ON proposal_source (partnership_proposal_id);
CREATE INDEX IF NOT EXISTS proposal_source_document_idx ON proposal_source (document_id);

CREATE OR REPLACE TRIGGER proposal_source_set_updated_at BEFORE UPDATE ON proposal_source
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS proposal_asset (
  proposal_asset_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partnership_proposal_id uuid NOT NULL REFERENCES partnership_proposal(partnership_proposal_id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES document(document_id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('cover', 'gallery', 'logo', 'section')),
  section_key text,
  alt text NOT NULL,
  -- A kit image used until MyCity uploads one; the studio lists them before Send.
  stand_in boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS proposal_asset_proposal_idx ON proposal_asset (partnership_proposal_id);
CREATE INDEX IF NOT EXISTS proposal_asset_document_idx ON proposal_asset (document_id);

CREATE OR REPLACE TRIGGER proposal_asset_set_updated_at BEFORE UPDATE ON proposal_asset
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS proposal_view (
  proposal_view_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partnership_proposal_id uuid NOT NULL REFERENCES partnership_proposal(partnership_proposal_id) ON DELETE CASCADE,
  viewed_at timestamptz NOT NULL DEFAULT now(),
  -- SHA-256 of the address with a server secret; never the address.
  ip_hash text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS proposal_view_proposal_idx ON proposal_view (partnership_proposal_id, viewed_at DESC);

CREATE OR REPLACE TRIGGER proposal_view_set_updated_at BEFORE UPDATE ON proposal_view
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

/* ------------------------------------------------------------------ *
 * MyCity's proof points
 * ------------------------------------------------------------------ */
CREATE TABLE IF NOT EXISTS proof_point (
  proof_point_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('stat', 'partner_logo', 'endorsement', 'result')),
  label text NOT NULL,
  -- The figure as said: "10,000+".
  value text,
  detail text,
  -- A logo or an image.
  document_id uuid REFERENCES document(document_id) ON DELETE SET NULL,
  -- Where the fact comes from.
  source_note text,
  position integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS proof_point_document_idx ON proof_point (document_id);

CREATE OR REPLACE TRIGGER proof_point_set_updated_at BEFORE UPDATE ON proof_point
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

/* ------------------------------------------------------------------ *
 * partnership_agreement
 * ------------------------------------------------------------------ */
ALTER TABLE partnership_agreement ALTER COLUMN partner_id DROP NOT NULL;
ALTER TABLE partnership_agreement ALTER COLUMN starts_on DROP NOT NULL;
ALTER TABLE partnership_agreement
  ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES lead(lead_id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS kind text CHECK (kind IN ('deal_merchant', 'mou', 'service_agreement', 'contract')),
  -- The category template it was filled from: template_version's key, and the version used.
  ADD COLUMN IF NOT EXISTS template_key citext,
  ADD COLUMN IF NOT EXISTS template_version integer CHECK (template_version >= 0),
  -- The values and asks it was filled with.
  ADD COLUMN IF NOT EXISTS fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- The edited wording, Markdown through the one renderer.
  ADD COLUMN IF NOT EXISTS body text,
  ADD COLUMN IF NOT EXISTS workflow_instance_id uuid REFERENCES workflow_instance(workflow_instance_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS signed_document_id uuid REFERENCES document(document_id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS signed_at timestamptz,
  ADD COLUMN IF NOT EXISTS signed_outside boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS renewal_notice_days integer NOT NULL DEFAULT 90 CHECK (renewal_notice_days >= 0),
  ADD COLUMN IF NOT EXISTS renews_agreement_id uuid REFERENCES partnership_agreement(partnership_agreement_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS close_reason text;

UPDATE partnership_agreement SET status = 'draft'
 WHERE status NOT IN ('draft', 'review', 'approval', 'sent', 'viewed', 'signed', 'active', 'expiring', 'renewed', 'closed');

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'partnership_agreement_status_check' AND conrelid = 'partnership_agreement'::regclass) THEN
    ALTER TABLE partnership_agreement ADD CONSTRAINT partnership_agreement_status_check
      CHECK (status IN ('draft', 'review', 'approval', 'sent', 'viewed', 'signed', 'active', 'expiring', 'renewed', 'closed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'partnership_agreement_one_record' AND conrelid = 'partnership_agreement'::regclass) THEN
    ALTER TABLE partnership_agreement ADD CONSTRAINT partnership_agreement_one_record CHECK (num_nonnulls(partner_id, lead_id) = 1);
  END IF;
END $$;

-- Home asked for (status, starts_on) (home.md §4.1).
CREATE INDEX IF NOT EXISTS partnership_agreement_status_starts_idx ON partnership_agreement (status, starts_on);
CREATE INDEX IF NOT EXISTS partnership_agreement_partner_idx ON partnership_agreement (partner_id);
CREATE INDEX IF NOT EXISTS partnership_agreement_lead_idx ON partnership_agreement (lead_id);
CREATE INDEX IF NOT EXISTS partnership_agreement_deal_idx ON partnership_agreement (partnership_opportunity_id);
CREATE INDEX IF NOT EXISTS partnership_agreement_proposal_idx ON partnership_agreement (proposal_id);
CREATE INDEX IF NOT EXISTS partnership_agreement_owner_idx ON partnership_agreement (owner_id);
CREATE INDEX IF NOT EXISTS partnership_agreement_document_idx ON partnership_agreement (document_id);
CREATE INDEX IF NOT EXISTS partnership_agreement_signature_request_idx ON partnership_agreement (signature_request_id);
CREATE INDEX IF NOT EXISTS partnership_agreement_workflow_idx ON partnership_agreement (workflow_instance_id);
CREATE INDEX IF NOT EXISTS partnership_agreement_signed_document_idx ON partnership_agreement (signed_document_id);
CREATE INDEX IF NOT EXISTS partnership_agreement_renews_idx ON partnership_agreement (renews_agreement_id);

/* ------------------------------------------------------------------ *
 * agreement_obligation
 * ------------------------------------------------------------------ */
-- Nothing ever wrote it. A row in it stops this file, so nothing anyone entered is lost; the same
-- schema results on every database.
DO $$
DECLARE held boolean;
BEGIN
  IF to_regclass('public.agreement_obligation') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM agreement_obligation)' INTO held;
    IF held THEN
      RAISE EXCEPTION 'agreement_obligation holds rows; move them to deal_deliverable before this file runs';
    END IF;
  END IF;
END $$;
-- DESTRUCTIVE: agreement_obligation, empty (checked above) and read by no code; deal_deliverable replaces it.
DROP TABLE IF EXISTS agreement_obligation;

-- DOWN
CREATE TABLE IF NOT EXISTS agreement_obligation (
  agreement_obligation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partnership_agreement_id uuid NOT NULL REFERENCES partnership_agreement(partnership_agreement_id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  owner_id uuid REFERENCES employee(employee_id),
  due_on date,
  status text NOT NULL DEFAULT 'pending',
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP INDEX IF EXISTS partnership_agreement_renews_idx;
DROP INDEX IF EXISTS partnership_agreement_signed_document_idx;
DROP INDEX IF EXISTS partnership_agreement_workflow_idx;
DROP INDEX IF EXISTS partnership_agreement_signature_request_idx;
DROP INDEX IF EXISTS partnership_agreement_document_idx;
DROP INDEX IF EXISTS partnership_agreement_owner_idx;
DROP INDEX IF EXISTS partnership_agreement_proposal_idx;
DROP INDEX IF EXISTS partnership_agreement_deal_idx;
DROP INDEX IF EXISTS partnership_agreement_lead_idx;
DROP INDEX IF EXISTS partnership_agreement_partner_idx;
DROP INDEX IF EXISTS partnership_agreement_status_starts_idx;
ALTER TABLE partnership_agreement DROP CONSTRAINT IF EXISTS partnership_agreement_one_record;
ALTER TABLE partnership_agreement DROP CONSTRAINT IF EXISTS partnership_agreement_status_check;
-- 7000 had no leads, and every agreement started on a date: a lead's agreement, or one never signed, goes.
UPDATE partnership_agreement SET renews_agreement_id = NULL
 WHERE renews_agreement_id IN (SELECT partnership_agreement_id FROM partnership_agreement WHERE partner_id IS NULL OR starts_on IS NULL);
DELETE FROM partnership_agreement WHERE partner_id IS NULL OR starts_on IS NULL;
ALTER TABLE partnership_agreement
  DROP COLUMN IF EXISTS close_reason,
  DROP COLUMN IF EXISTS closed_at,
  DROP COLUMN IF EXISTS renews_agreement_id,
  DROP COLUMN IF EXISTS renewal_notice_days,
  DROP COLUMN IF EXISTS signed_outside,
  DROP COLUMN IF EXISTS signed_at,
  DROP COLUMN IF EXISTS signed_document_id,
  DROP COLUMN IF EXISTS workflow_instance_id,
  DROP COLUMN IF EXISTS body,
  DROP COLUMN IF EXISTS fields,
  DROP COLUMN IF EXISTS template_version,
  DROP COLUMN IF EXISTS template_key,
  DROP COLUMN IF EXISTS kind,
  DROP COLUMN IF EXISTS lead_id;
ALTER TABLE partnership_agreement ALTER COLUMN starts_on SET NOT NULL;
ALTER TABLE partnership_agreement ALTER COLUMN partner_id SET NOT NULL;

DROP TRIGGER IF EXISTS proof_point_set_updated_at ON proof_point;
DROP TABLE IF EXISTS proof_point;
DROP TRIGGER IF EXISTS proposal_view_set_updated_at ON proposal_view;
DROP TABLE IF EXISTS proposal_view;
DROP TRIGGER IF EXISTS proposal_asset_set_updated_at ON proposal_asset;
DROP TABLE IF EXISTS proposal_asset;
DROP TRIGGER IF EXISTS proposal_source_set_updated_at ON proposal_source;
DROP TABLE IF EXISTS proposal_source;
DROP TRIGGER IF EXISTS proposal_question_set_updated_at ON proposal_question;
DROP TABLE IF EXISTS proposal_question;

DROP INDEX IF EXISTS partnership_proposal_supersedes_idx;
DROP INDEX IF EXISTS partnership_proposal_token_idx;
DROP INDEX IF EXISTS partnership_proposal_ai_run_idx;
DROP INDEX IF EXISTS partnership_proposal_template_idx;
DROP INDEX IF EXISTS partnership_proposal_created_by_idx;
DROP INDEX IF EXISTS partnership_proposal_document_idx;
DROP INDEX IF EXISTS partnership_proposal_status_idx;
DROP INDEX IF EXISTS partnership_proposal_deal_idx;
ALTER TABLE partnership_proposal DROP CONSTRAINT IF EXISTS partnership_proposal_status_check;
ALTER TABLE partnership_proposal
  DROP COLUMN IF EXISTS supersedes_id,
  DROP COLUMN IF EXISTS withdrawn_at,
  DROP COLUMN IF EXISTS decline_reason,
  DROP COLUMN IF EXISTS declined_at,
  DROP COLUMN IF EXISTS view_count,
  DROP COLUMN IF EXISTS last_viewed_at,
  DROP COLUMN IF EXISTS first_viewed_at,
  DROP COLUMN IF EXISTS sent_cc,
  DROP COLUMN IF EXISTS sent_to,
  DROP COLUMN IF EXISTS public_token_id,
  DROP COLUMN IF EXISTS valid_until,
  DROP COLUMN IF EXISTS ai_run_id,
  DROP COLUMN IF EXISTS design_template_id,
  DROP COLUMN IF EXISTS content,
  DROP COLUMN IF EXISTS brief,
  DROP COLUMN IF EXISTS title;

DROP TRIGGER IF EXISTS proposal_template_set_updated_at ON proposal_template;
DROP TABLE IF EXISTS proposal_template;
