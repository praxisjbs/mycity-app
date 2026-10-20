-- M1 the Attendance policy moves into policies (docs/guides/policies.md §4, attendance.md §6.1).
--
-- Settings · Attendance Policy is retired (TB, 20/10/2026): the Attendance policy becomes a rules
-- policy on Knowledge Hub · Policies. Its draft, versions and acknowledgements are copied from
-- attendance_policy and attendance_policy_acknowledgement into policy_version and
-- policy_acknowledgement KEEPING THEIR IDS, so a punch's attendance_policy_id, a notice's record
-- and an acknowledgement all still name the same version. A punch from now on records
-- attendance_event.policy_version_id. attendance_event is append-only (1300's trigger), so a punch
-- made before this file is not rewritten: its attendance_policy_id already holds its version's id,
-- and the code reads COALESCE(policy_version_id, attendance_policy_id). A row from before versions
-- (no number) was only ever a test's or 1099's, removed by 1395; it is not a version and is not
-- copied.
--
-- The Attendance policy is created here whether or not a version exists: one organisation policy
-- that Knowledge Hub · Policies always lists. With no version it holds no rule (the type's defaults
-- apply until MyCity publishes one, A26). It is numbered from the `policy` scheme seeded in 1396. Each copied version's hash is the
-- SHA-256 of its rules as stored: nobody acknowledged a hash before this file, so none is compared.
-- attendance_policy and attendance_policy_acknowledgement are read by nothing after this file and
-- are dropped by a later release (MIGRATIONS §8).
-- UP
ALTER TABLE attendance_event ADD COLUMN IF NOT EXISTS policy_version_id uuid
  REFERENCES policy_version(policy_version_id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS attendance_event_policy_version_fk_idx ON attendance_event (policy_version_id);

DO $$
DECLARE
  pid uuid;
  seq bigint;
BEGIN
  SELECT policy_id INTO pid FROM policy WHERE kind = 'attendance';
  IF pid IS NULL THEN
    INSERT INTO numbering_counter (doc_type, period, last_value) VALUES ('policy', 'all', 1)
    ON CONFLICT (doc_type, period) DO UPDATE SET last_value = numbering_counter.last_value + 1
    RETURNING last_value INTO seq;
    INSERT INTO policy (number, kind, title)
    VALUES ('POL-' || lpad(seq::text, 4, '0'), 'attendance', 'Attendance Policy')
    RETURNING policy_id INTO pid;
  END IF;

  INSERT INTO policy_version (
    policy_version_id, policy_id, status, version, effective_from, note, title, rules,
    applies_to_everyone, needs_acknowledgement, acknowledge_within_days, needs_approval, content_hash,
    published_at, published_by, withdrawn_at, withdrawn_by, withdraw_reason,
    created_by, updated_by, created_at, updated_at
  )
  SELECT ap.attendance_policy_id, pid, ap.status, ap.version, ap.effective_from, ap.note, 'Attendance Policy',
         r.rules, true, true, 7, false,
         CASE WHEN ap.version IS NULL THEN NULL
              ELSE encode(sha256(convert_to(r.rules::text, 'UTF8')), 'hex') END,
         ap.published_at, ap.published_by, ap.withdrawn_at, ap.withdrawn_by, ap.withdraw_reason,
         ap.created_by, ap.updated_by, ap.created_at, ap.updated_at
    FROM attendance_policy ap
    CROSS JOIN LATERAL (
      SELECT jsonb_build_object(
        'grace_minutes', ap.grace_minutes,
        'office_geofence_mode', ap.office_geofence_mode,
        'home_geofence_mode', ap.home_geofence_mode,
        'site_geofence_mode', ap.site_geofence_mode,
        'device_mode', ap.device_mode,
        'max_accuracy_m', ap.max_accuracy_m,
        'home_radius_m', ap.home_radius_m
      ) AS rules
    ) r
   WHERE ap.version IS NOT NULL OR ap.status = 'draft'
  ON CONFLICT (policy_version_id) DO NOTHING;
END;
$$;

INSERT INTO policy_acknowledgement (policy_version_id, employee_id, acknowledged_at, reminded_at, created_at, updated_at)
SELECT a.attendance_policy_id, a.employee_id, a.acknowledged_at, a.reminded_at, a.created_at, a.updated_at
  FROM attendance_policy_acknowledgement a
  JOIN policy_version v ON v.policy_version_id = a.attendance_policy_id
ON CONFLICT (policy_version_id, employee_id) DO NOTHING;

COMMENT ON TABLE attendance_policy IS
  'Frozen by 1405: its versions are policy_version rows with the same ids; read by nothing, dropped by a later release.';
COMMENT ON TABLE attendance_policy_acknowledgement IS
  'Frozen by 1405: copied to policy_acknowledgement; read by nothing, dropped by a later release.';

-- DOWN
-- The copies go, and the Attendance policy with them when nothing else was added to it. A version
-- published after this file ran exists only in policy_version and is not copied back: it goes
-- with the policy only if it is the last thing holding it.
COMMENT ON TABLE attendance_policy_acknowledgement IS NULL;
COMMENT ON TABLE attendance_policy IS NULL;
DROP INDEX IF EXISTS attendance_event_policy_version_fk_idx;
ALTER TABLE attendance_event DROP COLUMN IF EXISTS policy_version_id;
DELETE FROM policy_acknowledgement a
 USING attendance_policy ap
 WHERE a.policy_version_id = ap.attendance_policy_id;
DELETE FROM policy_version v
 USING attendance_policy ap
 WHERE v.policy_version_id = ap.attendance_policy_id
   AND NOT EXISTS (SELECT 1 FROM policy_acknowledgement a WHERE a.policy_version_id = v.policy_version_id)
   AND NOT EXISTS (SELECT 1 FROM policy_signature s WHERE s.policy_version_id = v.policy_version_id);
DELETE FROM policy p
 WHERE p.kind = 'attendance'
   AND NOT EXISTS (SELECT 1 FROM policy_version v WHERE v.policy_id = p.policy_id);
