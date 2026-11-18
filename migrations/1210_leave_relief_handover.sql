-- M1 leave: a request's relief officer and handover note, and each leave type's rule for them (docs/guides/ess.md §6).
--
-- Edidiong asked at the work progress review of 16/11/2026 that a person requesting leave pick the
-- colleague who covers for them (the relief officer) and upload a handover note; TB settled the
-- details on 17/11/2026. Written by leave.service.request (the person's own request): both columns
-- are optional, required by the service only when the type asks for them.
--
--   leave_request.relief_employee_id    the relief officer. SET NULL: an optional link, and an
--                                        employee is archived rather than deleted.
--   leave_request.handover_document_id  the note in the vault (vault.claim). SET NULL: the vault
--                                        removes nothing a person uploaded, but an optional link.
--   leave_type.handover_every_request   every request of the type needs both (Annual, 1295).
--   leave_type.handover_over_days       or a request of more than this many working days does;
--                                        null when length never asks. 7 on every type that exists
--                                        and on a new one, a company rule with no legal source
--                                        (TB, 17/11/2026), which People change per type on
--                                        People · Leave. LeaveTypeCreate defaults to the same 7.
-- UP
ALTER TABLE leave_request ADD COLUMN IF NOT EXISTS relief_employee_id uuid REFERENCES employee(employee_id) ON DELETE SET NULL;
ALTER TABLE leave_request ADD COLUMN IF NOT EXISTS handover_document_id uuid REFERENCES document(document_id) ON DELETE SET NULL;
ALTER TABLE leave_type ADD COLUMN IF NOT EXISTS handover_every_request boolean NOT NULL DEFAULT false;
ALTER TABLE leave_type ADD COLUMN IF NOT EXISTS handover_over_days integer DEFAULT 7;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leave_type_handover_over_days_check') THEN
    ALTER TABLE leave_type ADD CONSTRAINT leave_type_handover_over_days_check
      CHECK (handover_over_days IS NULL OR handover_over_days BETWEEN 0 AND 366);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS leave_request_relief_employee_id_fk_idx ON leave_request (relief_employee_id);
CREATE INDEX IF NOT EXISTS leave_request_handover_document_id_fk_idx ON leave_request (handover_document_id);

-- DOWN
DROP INDEX IF EXISTS leave_request_handover_document_id_fk_idx;
DROP INDEX IF EXISTS leave_request_relief_employee_id_fk_idx;
ALTER TABLE leave_type DROP CONSTRAINT IF EXISTS leave_type_handover_over_days_check;
-- DESTRUCTIVE: rolling back loses each type's relief and handover rule; People set them again.
ALTER TABLE leave_type DROP COLUMN IF EXISTS handover_over_days;
-- DESTRUCTIVE: as above.
ALTER TABLE leave_type DROP COLUMN IF EXISTS handover_every_request;
-- DESTRUCTIVE: rolling back loses which note each request carried; the files stay in the vault, and the audit keeps the claim.
ALTER TABLE leave_request DROP COLUMN IF EXISTS handover_document_id;
-- DESTRUCTIVE: rolling back loses each request's relief officer; the audit row of the request keeps it.
ALTER TABLE leave_request DROP COLUMN IF EXISTS relief_employee_id;
