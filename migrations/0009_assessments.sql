-- Additive migration: assessments with the screening of the master document (section 7.1)
-- and flexible baseline metrics (section 7.2). 0001..0008 stay untouched.
--
-- An assessment is a dated record, never a single state that gets overwritten: a reassessment is
-- a new record linked to the previous one. DRAFT is editable. RECORDED is final and frozen, also
-- against direct SQL, by the triggers below.
-- The screening items are the six of the document: pain during exertion, dizziness or fainting,
-- reported chest pain, injury under treatment, recent surgery, reported medical restriction.
-- If ANY is marked, risk_status is REVIEW_REQUIRED, and the CHECK ties the two together so they
-- cannot disagree. CLEAR only means that no alert was captured by this instrument. It is not a
-- clinical clearance and nothing in the product presents it as one.
-- A review of a REVIEW_REQUIRED assessment is a separate, append-only record with the
-- professional's basis. It never erases the risk status.
-- Photos, posture views and movement tests are not part of this migration.
CREATE TABLE assessments (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  assessed_on TEXT NOT NULL CHECK (assessed_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  kind TEXT NOT NULL CHECK (kind IN ('INITIAL', 'REASSESSMENT')),
  previous_assessment_id TEXT,
  state TEXT NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT', 'RECORDED')),
  exertion_pain INTEGER NOT NULL DEFAULT 0 CHECK (exertion_pain IN (0, 1)),
  dizziness_fainting INTEGER NOT NULL DEFAULT 0 CHECK (dizziness_fainting IN (0, 1)),
  chest_pain INTEGER NOT NULL DEFAULT 0 CHECK (chest_pain IN (0, 1)),
  injury_in_treatment INTEGER NOT NULL DEFAULT 0 CHECK (injury_in_treatment IN (0, 1)),
  recent_surgery INTEGER NOT NULL DEFAULT 0 CHECK (recent_surgery IN (0, 1)),
  medical_restriction INTEGER NOT NULL DEFAULT 0 CHECK (medical_restriction IN (0, 1)),
  screening_notes TEXT CHECK (screening_notes IS NULL OR length(screening_notes) <= 1000),
  notes TEXT CHECK (notes IS NULL OR length(notes) <= 1000),
  risk_status TEXT NOT NULL CHECK (risk_status IN ('CLEAR', 'REVIEW_REQUIRED')),
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  recorded_at TEXT,
  recorded_by_user_id TEXT REFERENCES users(id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, student_id) REFERENCES students(organization_id, id),
  FOREIGN KEY (organization_id, previous_assessment_id) REFERENCES assessments(organization_id, id),
  CHECK (risk_status = CASE WHEN exertion_pain + dizziness_fainting + chest_pain + injury_in_treatment + recent_surgery + medical_restriction > 0 THEN 'REVIEW_REQUIRED' ELSE 'CLEAR' END)
);
CREATE INDEX assessments_student_idx ON assessments(organization_id, student_id, assessed_on);
-- At most one open draft per student, so two people do not start parallel assessments.
CREATE UNIQUE INDEX assessments_one_draft ON assessments(student_id) WHERE state = 'DRAFT';

-- A typed, flexible record: resting heart rate, blood pressure as noted, waist, body fat and any
-- test or measure the professional chooses. value_text is what was typed. value_number is set
-- when it is a plain number, so a later chart can use it. Units and sides are explicit.
CREATE TABLE assessment_metrics (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  assessment_id TEXT NOT NULL,
  metric_type TEXT NOT NULL CHECK (length(metric_type) BETWEEN 1 AND 40),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  value_text TEXT NOT NULL CHECK (length(trim(value_text)) BETWEEN 1 AND 40),
  value_number REAL,
  unit TEXT CHECK (unit IS NULL OR length(unit) <= 20),
  side TEXT CHECK (side IS NULL OR side IN ('LEFT', 'RIGHT', 'BOTH')),
  notes TEXT CHECK (notes IS NULL OR length(notes) <= 500),
  position INTEGER NOT NULL CHECK (position >= 1),
  UNIQUE (assessment_id, position),
  FOREIGN KEY (organization_id, assessment_id) REFERENCES assessments(organization_id, id)
);

CREATE TABLE assessment_reviews (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  assessment_id TEXT NOT NULL,
  reviewer_user_id TEXT NOT NULL REFERENCES users(id),
  basis TEXT NOT NULL CHECK (length(trim(basis)) BETWEEN 1 AND 1000),
  reviewed_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, assessment_id) REFERENCES assessments(organization_id, id)
);
CREATE INDEX assessment_reviews_assessment_idx ON assessment_reviews(assessment_id, reviewed_at);

-- Recorded assessments never change.
CREATE TRIGGER assessments_content_frozen
BEFORE UPDATE OF organization_id, student_id, assessed_on, kind, previous_assessment_id,
  exertion_pain, dizziness_fainting, chest_pain, injury_in_treatment, recent_surgery,
  medical_restriction, screening_notes, notes, risk_status, created_by_user_id ON assessments
WHEN OLD.state = 'RECORDED'
BEGIN
  SELECT RAISE(ABORT, 'ASSESSMENT_FROZEN');
END;

CREATE TRIGGER assessments_state_forward
BEFORE UPDATE OF state ON assessments
WHEN NEW.state <> OLD.state AND NOT (OLD.state = 'DRAFT' AND NEW.state = 'RECORDED')
BEGIN
  SELECT RAISE(ABORT, 'ASSESSMENT_STATE_INVALID');
END;

CREATE TRIGGER assessments_recorded_once
BEFORE UPDATE OF recorded_at, recorded_by_user_id ON assessments
WHEN OLD.recorded_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'ASSESSMENT_FROZEN');
END;

CREATE TRIGGER assessments_no_delete
BEFORE DELETE ON assessments
WHEN OLD.state = 'RECORDED'
BEGIN
  SELECT RAISE(ABORT, 'ASSESSMENT_FROZEN');
END;

CREATE TRIGGER assessment_metrics_frozen_insert
BEFORE INSERT ON assessment_metrics
WHEN (SELECT state FROM assessments WHERE id = NEW.assessment_id) <> 'DRAFT'
BEGIN
  SELECT RAISE(ABORT, 'ASSESSMENT_FROZEN');
END;

CREATE TRIGGER assessment_metrics_frozen_update
BEFORE UPDATE ON assessment_metrics
WHEN (SELECT state FROM assessments WHERE id = OLD.assessment_id) <> 'DRAFT'
  OR (SELECT state FROM assessments WHERE id = NEW.assessment_id) <> 'DRAFT'
BEGIN
  SELECT RAISE(ABORT, 'ASSESSMENT_FROZEN');
END;

CREATE TRIGGER assessment_metrics_frozen_delete
BEFORE DELETE ON assessment_metrics
WHEN (SELECT state FROM assessments WHERE id = OLD.assessment_id) <> 'DRAFT'
BEGIN
  SELECT RAISE(ABORT, 'ASSESSMENT_FROZEN');
END;

-- A review exists only for a recorded assessment that required one, and is never changed.
CREATE TRIGGER assessment_reviews_only_when_required
BEFORE INSERT ON assessment_reviews
WHEN (SELECT state FROM assessments WHERE id = NEW.assessment_id) <> 'RECORDED'
  OR (SELECT risk_status FROM assessments WHERE id = NEW.assessment_id) <> 'REVIEW_REQUIRED'
BEGIN
  SELECT RAISE(ABORT, 'ASSESSMENT_REVIEW_NOT_APPLICABLE');
END;

CREATE TRIGGER assessment_reviews_append_only_update
BEFORE UPDATE ON assessment_reviews
BEGIN
  SELECT RAISE(ABORT, 'ASSESSMENT_REVIEW_APPEND_ONLY');
END;

CREATE TRIGGER assessment_reviews_append_only_delete
BEFORE DELETE ON assessment_reviews
BEGIN
  SELECT RAISE(ABORT, 'ASSESSMENT_REVIEW_APPEND_ONLY');
END;

-- Approval now records which assessment stood behind it. approval_screening becomes one of
-- NOT_RECORDED (acknowledged by the professional), CLEAR (no alert captured) or
-- REVIEW_REQUIRED_REVIEWED (alerts, with a recorded professional review).
ALTER TABLE plan_revisions ADD COLUMN approval_assessment_id TEXT REFERENCES assessments(id);

DROP TRIGGER plan_revisions_approval_written_once;
CREATE TRIGGER plan_revisions_approval_written_once
BEFORE UPDATE OF approved_at, approved_by_user_id, approval_screening, approval_assessment_id, delivered_at, delivered_by_user_id ON plan_revisions
WHEN (OLD.approved_at IS NOT NULL AND (NEW.approved_at IS NOT OLD.approved_at OR NEW.approved_by_user_id IS NOT OLD.approved_by_user_id OR NEW.approval_screening IS NOT OLD.approval_screening OR NEW.approval_assessment_id IS NOT OLD.approval_assessment_id))
  OR (OLD.delivered_at IS NOT NULL AND (NEW.delivered_at IS NOT OLD.delivered_at OR NEW.delivered_by_user_id IS NOT OLD.delivered_by_user_id))
BEGIN
  SELECT RAISE(ABORT, 'PLAN_REVISION_FROZEN');
END;

INSERT INTO app_schema_versions(version) VALUES ('0009_assessments');
