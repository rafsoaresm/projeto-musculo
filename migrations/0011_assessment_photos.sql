-- Additive migration: postural photos of an assessment (master document, section 8, "evolução
-- recomendada": anterior, left lateral, right lateral and posterior). 0001..0010 stay untouched.
--
-- The image itself lives in the Webflow Cloud Object Storage (the PHOTOS binding), never in this
-- database and never behind a public address: it is read only through an authenticated, authorized
-- route. This table is the index: who attached it, to which assessment and view, under which
-- unguessable key. One photo per view per assessment; replacing one is a delete plus an insert and
-- only while the assessment is a draft. A recorded assessment keeps its photos, like everything
-- else in it, so the triggers below refuse any change after that.
-- `consent_confirmed_by_user_id` records that the professional confirmed, at upload, that the
-- student authorized this photo. It documents a confirmation. The legal basis and the text of the
-- consent for health images and for minors are not defined by the product yet.
CREATE TABLE assessment_photos (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  assessment_id TEXT NOT NULL,
  view TEXT NOT NULL CHECK (view IN ('ANTERIOR', 'LATERAL_LEFT', 'LATERAL_RIGHT', 'POSTERIOR')),
  object_key TEXT NOT NULL UNIQUE CHECK (length(object_key) BETWEEN 20 AND 200),
  content_type TEXT NOT NULL CHECK (content_type = 'image/jpeg'),
  size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
  width INTEGER NOT NULL CHECK (width BETWEEN 1 AND 8192),
  height INTEGER NOT NULL CHECK (height BETWEEN 1 AND 8192),
  consent_confirmed_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE (assessment_id, view),
  FOREIGN KEY (organization_id, assessment_id) REFERENCES assessments(organization_id, id)
);

CREATE TRIGGER assessment_photos_frozen_insert
BEFORE INSERT ON assessment_photos
WHEN (SELECT state FROM assessments WHERE id = NEW.assessment_id) <> 'DRAFT'
BEGIN
  SELECT RAISE(ABORT, 'ASSESSMENT_FROZEN');
END;

CREATE TRIGGER assessment_photos_frozen_update
BEFORE UPDATE ON assessment_photos
WHEN (SELECT state FROM assessments WHERE id = OLD.assessment_id) <> 'DRAFT'
  OR (SELECT state FROM assessments WHERE id = NEW.assessment_id) <> 'DRAFT'
BEGIN
  SELECT RAISE(ABORT, 'ASSESSMENT_FROZEN');
END;

CREATE TRIGGER assessment_photos_frozen_delete
BEFORE DELETE ON assessment_photos
WHEN (SELECT state FROM assessments WHERE id = OLD.assessment_id) <> 'DRAFT'
BEGIN
  SELECT RAISE(ABORT, 'ASSESSMENT_FROZEN');
END;

INSERT INTO app_schema_versions(version) VALUES ('0011_assessment_photos');
