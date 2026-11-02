-- Additive migration: the physical assessment, version 2 (handoff "Avaliação Física V2", 02/11/2026; ROADMAP 0.68). 0001..0032 stay untouched.
--
-- The same assessments, evolved: an assessment of the new format keeps its modules (profile and goals, screening and PAR-Q, body composition,
-- posture, movement, physical tests, conclusion) each as a section of its own, and what is computed from them (body fat by a named protocol,
-- BMI, waist-hip ratio, VO2 estimate...) as results that say which formula, which version and which inputs gave them. The assessments made
-- before keep their format (format_version NULL) and are read as they were.
--
-- assessments.format_version: NULL for the earlier formats, 2 for the new one.
-- assessments.revision: the version of the draft that a save is based on; a save that comes from an older revision is refused (two tabs, two
--   people), never the last one silently winning.
-- assessments.amends_assessment_id and amend_reason: an amendment of a recorded assessment is a new assessment that points to it, with the
--   reason written; the recorded one is never changed. Both or neither.
-- assessments.student_snapshot: the student's data as the assessment used them (birth date, height...), so a later change of the profile does
--   not change what an assessment said.
-- assessment_sections: one row per module of an assessment, with its state and its data (JSON, checked by the app; the database checks the
--   size and that it is JSON). Frozen once the assessment is recorded.
-- assessment_results: what was computed (or, for the earlier format, typed) from the data, one row per result, with the method, the formula
--   version, the inputs and the flags (e.g. "outside the original validation population"). Written when the assessment is recorded, then frozen.
--   A body fat percentage typed in an earlier assessment is copied here with the method `legacy_formula_unknown`: nobody knows which protocol
--   gave it, and it is never compared with a computed one as if it were the same thing.
--
-- The screening_answered column of 0031 was not in the list of columns frozen by assessments_content_frozen: the trigger below closes that.

ALTER TABLE assessments ADD COLUMN format_version INTEGER CHECK (format_version IS NULL OR format_version = 2);
ALTER TABLE assessments ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1);
ALTER TABLE assessments ADD COLUMN amends_assessment_id TEXT REFERENCES assessments(id);
ALTER TABLE assessments ADD COLUMN amend_reason TEXT CHECK (amend_reason IS NULL OR length(trim(amend_reason)) BETWEEN 3 AND 1000);
ALTER TABLE assessments ADD COLUMN student_snapshot TEXT CHECK (student_snapshot IS NULL OR (json_valid(student_snapshot) AND length(student_snapshot) <= 4000));

CREATE TABLE assessment_sections (
  assessment_id TEXT NOT NULL REFERENCES assessments(id),
  organization_id TEXT NOT NULL,
  module TEXT NOT NULL CHECK (length(module) BETWEEN 2 AND 40 AND module NOT GLOB '*[^a-z_]*'),
  status TEXT NOT NULL CHECK (status IN ('NOT_STARTED', 'IN_PROGRESS', 'DONE', 'SKIPPED')),
  payload TEXT NOT NULL CHECK (json_valid(payload) AND length(payload) <= 64000),
  updated_at TEXT NOT NULL,
  updated_by_user_id TEXT NOT NULL REFERENCES users(id),
  PRIMARY KEY (assessment_id, module),
  FOREIGN KEY (organization_id, assessment_id) REFERENCES assessments(organization_id, id)
);

CREATE TABLE assessment_results (
  id TEXT PRIMARY KEY NOT NULL,
  assessment_id TEXT NOT NULL REFERENCES assessments(id),
  organization_id TEXT NOT NULL,
  code TEXT NOT NULL CHECK (length(code) BETWEEN 2 AND 60 AND code NOT GLOB '*[^a-z0-9_]*'),
  value REAL,
  unit TEXT CHECK (unit IS NULL OR length(unit) <= 20),
  method TEXT NOT NULL CHECK (length(method) BETWEEN 2 AND 80),
  formula_version TEXT CHECK (formula_version IS NULL OR length(formula_version) <= 40),
  inputs TEXT CHECK (inputs IS NULL OR (json_valid(inputs) AND length(inputs) <= 8000)),
  flags TEXT CHECK (flags IS NULL OR (json_valid(flags) AND length(flags) <= 2000)),
  created_at TEXT NOT NULL,
  UNIQUE (assessment_id, code),
  FOREIGN KEY (organization_id, assessment_id) REFERENCES assessments(organization_id, id)
);
CREATE INDEX assessment_results_org_idx ON assessment_results(organization_id, code);

-- The body fat typed in the earlier format, kept as a result whose method nobody knows (before the triggers below, which would refuse it).
INSERT INTO assessment_results (id, assessment_id, organization_id, code, value, unit, method, formula_version, inputs, flags, created_at)
SELECT lower(hex(randomblob(16))), m.assessment_id, a.organization_id, 'body_fat_percent', m.value_number, '%', 'legacy_formula_unknown', NULL, NULL,
       json_array('legacy_formula_unknown'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM assessment_metrics m JOIN assessments a ON a.id = m.assessment_id
WHERE m.metric_type = 'BODY_FAT' AND m.value_number IS NOT NULL AND a.state = 'RECORDED'
  AND m.position = (SELECT MIN(m2.position) FROM assessment_metrics m2 WHERE m2.assessment_id = m.assessment_id AND m2.metric_type = 'BODY_FAT' AND m2.value_number IS NOT NULL);

-- What the new columns add is frozen with the rest once the assessment is recorded (and screening_answered too, which 0031 left out).
CREATE TRIGGER assessments_v2_frozen
BEFORE UPDATE OF format_version, revision, amends_assessment_id, amend_reason, student_snapshot, screening_answered ON assessments
WHEN OLD.state = 'RECORDED'
BEGIN
  SELECT RAISE(ABORT, 'ASSESSMENT_FROZEN');
END;

-- An amendment points to a recorded assessment of the same student and organization, and says why; the reason never goes without it.
CREATE TRIGGER assessments_amend_insert
BEFORE INSERT ON assessments
WHEN (NEW.amends_assessment_id IS NULL) <> (NEW.amend_reason IS NULL)
  OR (NEW.amends_assessment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM assessments o WHERE o.id = NEW.amends_assessment_id AND o.organization_id = NEW.organization_id
      AND o.student_id = NEW.student_id AND o.state = 'RECORDED'))
BEGIN
  SELECT RAISE(ABORT, 'ASSESSMENT_AMEND_INVALID');
END;
CREATE TRIGGER assessments_amend_update
BEFORE UPDATE OF amends_assessment_id, amend_reason ON assessments
WHEN (NEW.amends_assessment_id IS NULL) <> (NEW.amend_reason IS NULL)
  OR (NEW.amends_assessment_id IS NOT OLD.amends_assessment_id)
BEGIN
  SELECT RAISE(ABORT, 'ASSESSMENT_AMEND_INVALID');
END;

-- Sections and results: written only while the assessment is a draft, and only for an assessment of the same organization.
CREATE TRIGGER assessment_sections_frozen_insert
BEFORE INSERT ON assessment_sections
WHEN (SELECT state FROM assessments WHERE id = NEW.assessment_id AND organization_id = NEW.organization_id) IS NOT 'DRAFT'
BEGIN
  SELECT RAISE(ABORT, 'ASSESSMENT_FROZEN');
END;
CREATE TRIGGER assessment_sections_frozen_update
BEFORE UPDATE ON assessment_sections
WHEN (SELECT state FROM assessments WHERE id = OLD.assessment_id) <> 'DRAFT'
  OR NEW.assessment_id <> OLD.assessment_id OR NEW.organization_id <> OLD.organization_id OR NEW.module <> OLD.module
BEGIN
  SELECT RAISE(ABORT, 'ASSESSMENT_FROZEN');
END;
CREATE TRIGGER assessment_sections_frozen_delete
BEFORE DELETE ON assessment_sections
WHEN (SELECT state FROM assessments WHERE id = OLD.assessment_id) <> 'DRAFT'
BEGIN
  SELECT RAISE(ABORT, 'ASSESSMENT_FROZEN');
END;
CREATE TRIGGER assessment_results_frozen_insert
BEFORE INSERT ON assessment_results
WHEN (SELECT state FROM assessments WHERE id = NEW.assessment_id AND organization_id = NEW.organization_id) IS NOT 'DRAFT'
BEGIN
  SELECT RAISE(ABORT, 'ASSESSMENT_FROZEN');
END;
CREATE TRIGGER assessment_results_frozen_update
BEFORE UPDATE ON assessment_results
WHEN (SELECT state FROM assessments WHERE id = OLD.assessment_id) <> 'DRAFT'
  OR NEW.assessment_id <> OLD.assessment_id OR NEW.organization_id <> OLD.organization_id
BEGIN
  SELECT RAISE(ABORT, 'ASSESSMENT_FROZEN');
END;
CREATE TRIGGER assessment_results_frozen_delete
BEFORE DELETE ON assessment_results
WHEN (SELECT state FROM assessments WHERE id = OLD.assessment_id) <> 'DRAFT'
BEGIN
  SELECT RAISE(ABORT, 'ASSESSMENT_FROZEN');
END;

INSERT INTO app_schema_versions(version) VALUES ('0033_assessment_v2');
