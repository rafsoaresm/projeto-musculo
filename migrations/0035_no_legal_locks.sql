-- Additive migration: the legal locks come out of the database (decision of the product owner, 03/11/2026: "remover tudo"). 0001..0034 stay
-- untouched. Only the rules that existed for legal reasons are removed; the rules of security, integrity and tenant isolation stay exactly as
-- they were (only the platform manager writes the terms; a request is made by the student's linked login and answered by a professional with an
-- active assignment; an erasure is made by such a professional; recorded assessments, delivered revisions and published releases stay frozen).
--
-- Nothing below deletes or changes data except two things: every existing site starts receiving messages (the application now creates new sites
-- with the switch on), and `photo_erasures` is rebuilt so an erasure no longer needs a request (its rows are copied as they are).

-- D1: an acceptance of the terms was append-only.
DROP TRIGGER IF EXISTS consent_acceptances_append_only_update;
DROP TRIGGER IF EXISTS consent_acceptances_append_only_delete;

-- D2: a postural photo needed the student's own recorded authorization.
DROP TRIGGER IF EXISTS assessment_photos_need_authorization;

-- D3: data subject requests: one open per kind, append-only requests and outcomes, and "erase my photos" closed only with no photo left.
-- Kept: data_subject_requests_linked_login, data_subject_request_outcomes_who, data_subject_request_outcomes_professional (isolation), and the
-- table CHECK that a refusal or a partial answer carries a note (a CHECK cannot be dropped without rebuilding the table; it blocks no action).
DROP TRIGGER IF EXISTS data_subject_requests_one_open;
DROP TRIGGER IF EXISTS data_subject_requests_append_only_update;
DROP TRIGGER IF EXISTS data_subject_requests_append_only_delete;
DROP TRIGGER IF EXISTS data_subject_request_outcomes_photos_gone;
DROP TRIGGER IF EXISTS data_subject_request_outcomes_append_only_update;
DROP TRIGGER IF EXISTS data_subject_request_outcomes_append_only_delete;

-- D5: published terms were append-only, and the draft had to follow the revision steps in the database (the editor keeps its optimistic lock in
-- the statements themselves). Kept: terms_versions_admin_only, terms_drafts_admin_insert, terms_drafts_admin_update (access control).
DROP TRIGGER IF EXISTS terms_versions_append_only_update;
DROP TRIGGER IF EXISTS terms_versions_append_only_delete;
DROP TRIGGER IF EXISTS terms_drafts_first_revision;
DROP TRIGGER IF EXISTS terms_drafts_update_rules;

-- D6: what a visitor wrote could not be edited. Kept: site_inquiries_of_the_site_organization (isolation).
DROP TRIGGER IF EXISTS site_inquiries_not_edited;

-- B8: every site receives messages; new sites are created with the switch on by the application (the column's DEFAULT 0 stays: changing a
-- default needs a rebuild of `sites`, which many tables reference).
UPDATE sites SET inquiries_open = 1 WHERE inquiries_open = 0;

-- D4: a photo is erased by the professional who attends the student, with or without a request of the student. `request_id` was NOT NULL, so
-- the table is rebuilt with SQLite's documented procedure (new table, copy, drop, rename). Nothing references `photo_erasures`, and the only
-- trigger of another table that read it (data_subject_request_outcomes_photos_gone) was dropped above. Its own triggers go with the old table:
-- photo_erasures_need_request and photo_erasures_append_only_* (legal) are not recreated; photo_erasures_need_photo (integrity: the photo exists,
-- in that organization, assessment and view) and photo_erasures_professional (isolation) are recreated, the latter now reading the assignment
-- through the assessment, so it also holds for an erasure without a request; a request, when there is one, must be of the same student.
PRAGMA defer_foreign_keys = true;

CREATE TABLE photo_erasures_next (
  photo_id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  assessment_id TEXT NOT NULL,
  view TEXT NOT NULL CHECK (view IN ('ANTERIOR', 'LATERAL_LEFT', 'LATERAL_RIGHT', 'POSTERIOR')),
  request_id TEXT REFERENCES data_subject_requests(id),
  erased_by_user_id TEXT NOT NULL REFERENCES users(id),
  erased_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, assessment_id) REFERENCES assessments(organization_id, id)
);
INSERT INTO photo_erasures_next (photo_id, organization_id, assessment_id, view, request_id, erased_by_user_id, erased_at)
  SELECT photo_id, organization_id, assessment_id, view, request_id, erased_by_user_id, erased_at FROM photo_erasures;
DROP TABLE photo_erasures;
ALTER TABLE photo_erasures_next RENAME TO photo_erasures;
CREATE INDEX photo_erasures_assessment_idx ON photo_erasures(organization_id, assessment_id);

CREATE TRIGGER photo_erasures_need_photo
BEFORE INSERT ON photo_erasures
WHEN NOT EXISTS (
  SELECT 1 FROM assessment_photos p
  WHERE p.id = NEW.photo_id AND p.organization_id = NEW.organization_id
    AND p.assessment_id = NEW.assessment_id AND p.view = NEW.view
)
BEGIN
  SELECT RAISE(ABORT, 'PHOTO_ERASURE_NO_PHOTO');
END;

CREATE TRIGGER photo_erasures_professional
BEFORE INSERT ON photo_erasures
WHEN NOT EXISTS (
  SELECT 1 FROM assessments a
  JOIN care_assignments ca ON ca.organization_id = a.organization_id AND ca.student_id = a.student_id
    AND ca.revoked_at IS NULL
  JOIN professionals p ON p.organization_id = ca.organization_id AND p.id = ca.professional_id
  JOIN memberships m ON m.organization_id = p.organization_id AND m.user_id = p.user_id AND m.revoked_at IS NULL
  WHERE a.organization_id = NEW.organization_id AND a.id = NEW.assessment_id AND p.user_id = NEW.erased_by_user_id
    AND m.role IN ('OWNER', 'MANAGER', 'TECHNICAL')
) OR (NEW.request_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM data_subject_requests r
  JOIN assessments a ON a.organization_id = r.organization_id AND a.student_id = r.student_id
  WHERE r.id = NEW.request_id AND r.organization_id = NEW.organization_id AND a.id = NEW.assessment_id
))
BEGIN
  SELECT RAISE(ABORT, 'PHOTO_ERASURE_NOT_AUTHORIZED');
END;

INSERT INTO app_schema_versions(version) VALUES ('0035_no_legal_locks');
