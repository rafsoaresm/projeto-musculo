-- Additive migration: postural analysis (master document section 8) and movement, mobility and
-- control tests (section 9) as part of an assessment. 0001..0009 stay untouched.
--
-- Postural findings are a visual record and a working hypothesis, never a diagnosis. A marked
-- finding is one row (grade is NULL). Movement tests carry the document's five-step scale in
-- `grade`. Rows exist only for what was recorded: no row means "not assessed". The allowed item
-- keys and grades live in the code, like the other lists of the product, so adding an item does
-- not rebuild a table. Neither posture nor movement changes `risk_status`: that is decided by the
-- six screening items alone (section 7.1).
-- The special item 'NOTES' of the POSTURE area holds the free postural notes.
-- Photos are not part of this migration: there is no private file storage yet.
CREATE TABLE assessment_findings (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  assessment_id TEXT NOT NULL,
  area TEXT NOT NULL CHECK (area IN ('POSTURE', 'MOVEMENT')),
  item TEXT NOT NULL CHECK (length(item) BETWEEN 1 AND 60),
  grade TEXT CHECK (grade IS NULL OR length(grade) BETWEEN 1 AND 30),
  notes TEXT CHECK (notes IS NULL OR length(notes) <= 1000),
  UNIQUE (assessment_id, area, item),
  FOREIGN KEY (organization_id, assessment_id) REFERENCES assessments(organization_id, id),
  CHECK ((area = 'MOVEMENT') = (grade IS NOT NULL))
);

-- Recorded assessments never change, and neither do their findings.
CREATE TRIGGER assessment_findings_frozen_insert
BEFORE INSERT ON assessment_findings
WHEN (SELECT state FROM assessments WHERE id = NEW.assessment_id) <> 'DRAFT'
BEGIN
  SELECT RAISE(ABORT, 'ASSESSMENT_FROZEN');
END;

CREATE TRIGGER assessment_findings_frozen_update
BEFORE UPDATE ON assessment_findings
WHEN (SELECT state FROM assessments WHERE id = OLD.assessment_id) <> 'DRAFT'
  OR (SELECT state FROM assessments WHERE id = NEW.assessment_id) <> 'DRAFT'
BEGIN
  SELECT RAISE(ABORT, 'ASSESSMENT_FROZEN');
END;

CREATE TRIGGER assessment_findings_frozen_delete
BEFORE DELETE ON assessment_findings
WHEN (SELECT state FROM assessments WHERE id = OLD.assessment_id) <> 'DRAFT'
BEGIN
  SELECT RAISE(ABORT, 'ASSESSMENT_FROZEN');
END;

INSERT INTO app_schema_versions(version) VALUES ('0010_posture_and_movement');
