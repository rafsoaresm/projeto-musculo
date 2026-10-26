-- Additive migration: requests from the data subject (the student) and the controlled erasure of
-- postural photos on request. 0001..0016 stay untouched.
--
-- What a student can ask for is recorded here, with the date the answer is due, and answered by the
-- professional who has the technical assignment over them (the legal pack, questions 6 and 7: an
-- answer within 15 days, by the professional, with the support of screens of the tool). A request is
-- never edited and never deleted, and it has at most one outcome: a request that was answered is not
-- reopened, a new one is made. The tool does not decide anything by itself: it records, shows the
-- deadline, and carries out only the one thing it can carry out, which is erasing the stored photos.
--
-- Erasing a photo is an exception to the freeze of a recorded assessment, so it is not an update of
-- `assessment_photos`: those rows, and the triggers that freeze them, stay exactly as they are. The
-- bytes are removed from the private storage and one row of `photo_erasures` is added, which says that
-- the photo existed, which request erased it and who did it. Nothing in the tool shows or serves a
-- photo that has such a row. A photo of an assessment that is still a draft is also deleted (the draft
-- is changeable); the record stays.
CREATE TABLE data_subject_requests (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  requested_by_user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN (
    'ACCESS', 'CORRECTION', 'PHOTOS_DELETION', 'DATA_DELETION', 'ACCEPTANCE_WITHDRAWAL', 'OTHER'
  )),
  message TEXT CHECK (message IS NULL OR length(message) <= 1000),
  created_at TEXT NOT NULL,
  due_at TEXT NOT NULL,
  UNIQUE (organization_id, id),
  CHECK (due_at > created_at),
  FOREIGN KEY (organization_id, student_id) REFERENCES students(organization_id, id)
);
CREATE INDEX data_subject_requests_student_idx
  ON data_subject_requests(organization_id, student_id, created_at);

-- How a request ended. One row at most per request, which is what closes it.
CREATE TABLE data_subject_request_outcomes (
  request_id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('FULFILLED', 'PARTIALLY_FULFILLED', 'DECLINED', 'CANCELLED')),
  note TEXT CHECK (note IS NULL OR length(note) <= 2000),
  decided_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  -- A refusal or a partial answer has to say why or what was left out.
  CHECK (outcome IN ('FULFILLED', 'CANCELLED') OR (note IS NOT NULL AND length(trim(note)) >= 1)),
  FOREIGN KEY (organization_id, request_id) REFERENCES data_subject_requests(organization_id, id)
);

-- A photo that was erased on request. The photo's own row is kept (or deleted with its draft); this
-- row is what remains of the fact.
CREATE TABLE photo_erasures (
  photo_id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  assessment_id TEXT NOT NULL,
  view TEXT NOT NULL CHECK (view IN ('ANTERIOR', 'LATERAL_LEFT', 'LATERAL_RIGHT', 'POSTERIOR')),
  request_id TEXT NOT NULL REFERENCES data_subject_requests(id),
  erased_by_user_id TEXT NOT NULL REFERENCES users(id),
  erased_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, assessment_id) REFERENCES assessments(organization_id, id)
);
CREATE INDEX photo_erasures_assessment_idx ON photo_erasures(organization_id, assessment_id);

-- A request is made by a login that is linked to that student right now and is not blocked.
CREATE TRIGGER data_subject_requests_linked_login
BEFORE INSERT ON data_subject_requests
WHEN NOT EXISTS (
  SELECT 1 FROM student_access sa
  WHERE sa.organization_id = NEW.organization_id AND sa.student_id = NEW.student_id
    AND sa.user_id = NEW.requested_by_user_id AND sa.revoked_at IS NULL
) OR NOT EXISTS (SELECT 1 FROM users u WHERE u.id = NEW.requested_by_user_id AND u.disabled_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'REQUEST_LOGIN_INVALID');
END;

-- One open request of each kind per student: asking again while it is open adds nothing.
CREATE TRIGGER data_subject_requests_one_open
BEFORE INSERT ON data_subject_requests
WHEN EXISTS (
  SELECT 1 FROM data_subject_requests r
  WHERE r.organization_id = NEW.organization_id AND r.student_id = NEW.student_id AND r.kind = NEW.kind
    AND NOT EXISTS (SELECT 1 FROM data_subject_request_outcomes o WHERE o.request_id = r.id)
)
BEGIN
  SELECT RAISE(ABORT, 'REQUEST_ALREADY_OPEN');
END;

CREATE TRIGGER data_subject_requests_append_only_update
BEFORE UPDATE ON data_subject_requests
BEGIN
  SELECT RAISE(ABORT, 'REQUEST_APPEND_ONLY');
END;

CREATE TRIGGER data_subject_requests_append_only_delete
BEFORE DELETE ON data_subject_requests
BEGIN
  SELECT RAISE(ABORT, 'REQUEST_APPEND_ONLY');
END;

-- Only the student's own login cancels a request, and the student never answers their own.
CREATE TRIGGER data_subject_request_outcomes_who
BEFORE INSERT ON data_subject_request_outcomes
WHEN (NEW.outcome = 'CANCELLED') <> (
  NEW.decided_by_user_id = (SELECT r.requested_by_user_id FROM data_subject_requests r WHERE r.id = NEW.request_id)
)
BEGIN
  SELECT RAISE(ABORT, 'REQUEST_OUTCOME_WRONG_ACTOR');
END;

-- An answer comes from a professional with an active technical assignment over the student.
CREATE TRIGGER data_subject_request_outcomes_professional
BEFORE INSERT ON data_subject_request_outcomes
WHEN NEW.outcome <> 'CANCELLED' AND NOT EXISTS (
  SELECT 1 FROM data_subject_requests r
  JOIN care_assignments ca ON ca.organization_id = r.organization_id AND ca.student_id = r.student_id
    AND ca.revoked_at IS NULL
  JOIN professionals p ON p.organization_id = ca.organization_id AND p.id = ca.professional_id
  JOIN memberships m ON m.organization_id = p.organization_id AND m.user_id = p.user_id AND m.revoked_at IS NULL
  WHERE r.id = NEW.request_id AND p.user_id = NEW.decided_by_user_id
    AND m.role IN ('OWNER', 'MANAGER', 'TECHNICAL')
)
BEGIN
  SELECT RAISE(ABORT, 'REQUEST_OUTCOME_NOT_AUTHORIZED');
END;

-- A request to erase the photos is only fulfilled when no photo of the student is left stored.
CREATE TRIGGER data_subject_request_outcomes_photos_gone
BEFORE INSERT ON data_subject_request_outcomes
WHEN NEW.outcome IN ('FULFILLED', 'PARTIALLY_FULFILLED')
  AND EXISTS (SELECT 1 FROM data_subject_requests r WHERE r.id = NEW.request_id AND r.kind = 'PHOTOS_DELETION')
  AND EXISTS (
    SELECT 1 FROM assessment_photos p
    JOIN assessments a ON a.organization_id = p.organization_id AND a.id = p.assessment_id
    JOIN data_subject_requests r ON r.organization_id = a.organization_id AND r.student_id = a.student_id
    WHERE r.id = NEW.request_id
      AND NOT EXISTS (SELECT 1 FROM photo_erasures e WHERE e.photo_id = p.id)
  )
BEGIN
  SELECT RAISE(ABORT, 'PHOTOS_STILL_STORED');
END;

CREATE TRIGGER data_subject_request_outcomes_append_only_update
BEFORE UPDATE ON data_subject_request_outcomes
BEGIN
  SELECT RAISE(ABORT, 'REQUEST_APPEND_ONLY');
END;

CREATE TRIGGER data_subject_request_outcomes_append_only_delete
BEFORE DELETE ON data_subject_request_outcomes
BEGIN
  SELECT RAISE(ABORT, 'REQUEST_APPEND_ONLY');
END;

-- An erasure records a photo that exists, under an open request of the student it belongs to to
-- erase photos, made by a professional with an active technical assignment over that student.
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

CREATE TRIGGER photo_erasures_need_request
BEFORE INSERT ON photo_erasures
WHEN NOT EXISTS (
  SELECT 1 FROM data_subject_requests r
  JOIN assessments a ON a.organization_id = r.organization_id AND a.student_id = r.student_id
  WHERE r.id = NEW.request_id AND r.kind = 'PHOTOS_DELETION' AND r.organization_id = NEW.organization_id
    AND a.id = NEW.assessment_id
    AND NOT EXISTS (SELECT 1 FROM data_subject_request_outcomes o WHERE o.request_id = r.id)
)
BEGIN
  SELECT RAISE(ABORT, 'PHOTO_ERASURE_NEEDS_REQUEST');
END;

CREATE TRIGGER photo_erasures_professional
BEFORE INSERT ON photo_erasures
WHEN NOT EXISTS (
  SELECT 1 FROM data_subject_requests r
  JOIN care_assignments ca ON ca.organization_id = r.organization_id AND ca.student_id = r.student_id
    AND ca.revoked_at IS NULL
  JOIN professionals p ON p.organization_id = ca.organization_id AND p.id = ca.professional_id
  JOIN memberships m ON m.organization_id = p.organization_id AND m.user_id = p.user_id AND m.revoked_at IS NULL
  WHERE r.id = NEW.request_id AND p.user_id = NEW.erased_by_user_id
    AND m.role IN ('OWNER', 'MANAGER', 'TECHNICAL')
)
BEGIN
  SELECT RAISE(ABORT, 'PHOTO_ERASURE_NOT_AUTHORIZED');
END;

CREATE TRIGGER photo_erasures_append_only_update
BEFORE UPDATE ON photo_erasures
BEGIN
  SELECT RAISE(ABORT, 'PHOTO_ERASURE_APPEND_ONLY');
END;

CREATE TRIGGER photo_erasures_append_only_delete
BEFORE DELETE ON photo_erasures
BEGIN
  SELECT RAISE(ABORT, 'PHOTO_ERASURE_APPEND_ONLY');
END;

INSERT INTO app_schema_versions(version) VALUES ('0017_data_subject_requests');
