-- Additive migration: a postural photo depends on the student's own recorded authorization.
-- 0001..0013 stay untouched.
--
-- Until now the professional ticked a box saying the student had authorized the photos
-- (`consent_confirmed_by_user_id`, still kept: it says who uploaded). From now on the authorization
-- is the student's own, given when they joined (`consent_acceptances.photos_authorized`), and each
-- new photo points at the exact acceptance that authorized it: which version and which words, and
-- when. That is what a later request from the student (access, withdrawal, deletion) needs in order
-- to find the photos that depended on it.
--
-- The column is nullable only because ALTER TABLE cannot add a required one; the trigger below makes
-- it required for every new photo and refuses an acceptance that is not a student's authorization.
-- The application also checks, before the insert and again inside it, that the acceptance is the
-- latest one of the student's active login and of the version in force.
ALTER TABLE assessment_photos ADD COLUMN consent_acceptance_id TEXT REFERENCES consent_acceptances(id);

CREATE TRIGGER assessment_photos_need_authorization
BEFORE INSERT ON assessment_photos
WHEN NEW.consent_acceptance_id IS NULL
  OR NOT EXISTS (
    SELECT 1 FROM consent_acceptances c
    WHERE c.id = NEW.consent_acceptance_id AND c.audience = 'STUDENT' AND c.photos_authorized = 1
  )
BEGIN
  SELECT RAISE(ABORT, 'PHOTO_AUTHORIZATION_REQUIRED');
END;

INSERT INTO app_schema_versions(version) VALUES ('0014_photo_consent_link');
