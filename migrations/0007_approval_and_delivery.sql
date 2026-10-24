-- Additive migration: approval and delivery of a plan revision, and the database-level
-- guarantees that a revision which left DRAFT never changes again.
-- 0001..0006 stay untouched. Same conventions: server-generated IDs, UTC ISO-8601 text.
--
-- READY (validated structure) -> APPROVED (an act of the professional) -> DELIVERED (released to
-- the student). The states already exist in plan_revisions.state. Approval and delivery are
-- always a human act: nothing here lets a rule engine or an AI approve or release anything.
-- approval_screening records what the screening situation was when the professional approved,
-- so history stays readable once the screening instrument exists. NOT_RECORDED means that no
-- screening was registered for the student: the professional acknowledged it, and that is not
-- a clearance of any kind.
ALTER TABLE plan_revisions ADD COLUMN approved_at TEXT;
ALTER TABLE plan_revisions ADD COLUMN approved_by_user_id TEXT REFERENCES users(id);
ALTER TABLE plan_revisions ADD COLUMN approval_screening TEXT CHECK (approval_screening IS NULL OR length(approval_screening) BETWEEN 1 AND 40);
ALTER TABLE plan_revisions ADD COLUMN delivered_at TEXT;
ALTER TABLE plan_revisions ADD COLUMN delivered_by_user_id TEXT REFERENCES users(id);

-- Content never changes once the revision is past DRAFT. Changing a delivered plan means a new
-- revision, so what the student received and what was executed stay tied to the exact content.
CREATE TRIGGER plan_revisions_content_frozen
BEFORE UPDATE OF input_json, schedule_json, engine_version, start_date, end_date, total_weeks,
  total_sessions, revision_number, plan_id, organization_id, based_on_revision_id ON plan_revisions
WHEN OLD.state <> 'DRAFT'
BEGIN
  SELECT RAISE(ABORT, 'PLAN_REVISION_FROZEN');
END;

-- States only move forward, one step at a time.
CREATE TRIGGER plan_revisions_state_forward
BEFORE UPDATE OF state ON plan_revisions
WHEN NEW.state <> OLD.state AND NOT (
  (OLD.state = 'DRAFT' AND NEW.state = 'READY') OR
  (OLD.state = 'READY' AND NEW.state = 'APPROVED') OR
  (OLD.state = 'APPROVED' AND NEW.state = 'DELIVERED'))
BEGIN
  SELECT RAISE(ABORT, 'PLAN_REVISION_STATE_INVALID');
END;

-- Approval and delivery facts are written once, with the transition that makes them true.
CREATE TRIGGER plan_revisions_approval_written_once
BEFORE UPDATE OF approved_at, approved_by_user_id, approval_screening, delivered_at, delivered_by_user_id ON plan_revisions
WHEN (OLD.approved_at IS NOT NULL AND (NEW.approved_at IS NOT OLD.approved_at OR NEW.approved_by_user_id IS NOT OLD.approved_by_user_id OR NEW.approval_screening IS NOT OLD.approval_screening))
  OR (OLD.delivered_at IS NOT NULL AND (NEW.delivered_at IS NOT OLD.delivered_at OR NEW.delivered_by_user_id IS NOT OLD.delivered_by_user_id))
BEGIN
  SELECT RAISE(ABORT, 'PLAN_REVISION_FROZEN');
END;

CREATE TRIGGER plan_revisions_no_delete
BEFORE DELETE ON plan_revisions
WHEN OLD.state <> 'DRAFT'
BEGIN
  SELECT RAISE(ABORT, 'PLAN_REVISION_FROZEN');
END;

-- The prescription travels with its revision: rows can be added, changed or removed only while
-- the revision is a DRAFT.
CREATE TRIGGER prescribed_exercises_frozen_insert
BEFORE INSERT ON prescribed_exercises
WHEN (SELECT state FROM plan_revisions WHERE id = NEW.revision_id) <> 'DRAFT'
BEGIN
  SELECT RAISE(ABORT, 'PLAN_REVISION_FROZEN');
END;

CREATE TRIGGER prescribed_exercises_frozen_update
BEFORE UPDATE ON prescribed_exercises
WHEN (SELECT state FROM plan_revisions WHERE id = OLD.revision_id) <> 'DRAFT'
  OR (SELECT state FROM plan_revisions WHERE id = NEW.revision_id) <> 'DRAFT'
BEGIN
  SELECT RAISE(ABORT, 'PLAN_REVISION_FROZEN');
END;

CREATE TRIGGER prescribed_exercises_frozen_delete
BEFORE DELETE ON prescribed_exercises
WHEN (SELECT state FROM plan_revisions WHERE id = OLD.revision_id) <> 'DRAFT'
BEGIN
  SELECT RAISE(ABORT, 'PLAN_REVISION_FROZEN');
END;

INSERT INTO app_schema_versions(version) VALUES ('0007_approval_and_delivery');
