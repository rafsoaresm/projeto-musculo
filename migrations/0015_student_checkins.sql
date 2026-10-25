-- Additive migration: the student's check-in (reference document, section 9: "percepção de esforço,
-- recuperação, observações e desconforto relatado"). 0001..0014 stay untouched.
--
-- A check-in is what the student says about how they are, in their own words and numbers. The tool
-- does not score it, does not read it as good or bad, sends no alert and changes no plan because of
-- it: the professional reads it and decides. It is also not an urgency channel, and the screen says so.
--
-- One check-in per student per day. `effort` is how hard the last days felt, 0 to 10; `recovery` is
-- how recovered the student feels, 1 to 5 (words are on the screen, the number is what is kept);
-- both are optional. A report of discomfort is kept as reported: once a check-in carries one, or once
-- the professional has read it, it is frozen (no edit, no delete), whatever the application does. A
-- check-in with neither can be corrected or deleted by the student; the application limits that to the day it was made.
-- The professional's reading is a separate append-only record, like the reading of a workout log.
CREATE TABLE student_checkins (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  checked_on TEXT NOT NULL CHECK (checked_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  effort INTEGER CHECK (effort IS NULL OR effort BETWEEN 0 AND 10),
  recovery INTEGER CHECK (recovery IS NULL OR recovery BETWEEN 1 AND 5),
  discomfort_reported INTEGER NOT NULL DEFAULT 0 CHECK (discomfort_reported IN (0, 1)),
  discomfort_notes TEXT CHECK (discomfort_notes IS NULL OR length(discomfort_notes) <= 500),
  notes TEXT CHECK (notes IS NULL OR length(notes) <= 500),
  logged_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id, id),
  UNIQUE (student_id, checked_on),
  -- Notes about a discomfort only make sense with the report of one.
  CHECK (discomfort_reported = 1 OR discomfort_notes IS NULL),
  FOREIGN KEY (organization_id, student_id) REFERENCES students(organization_id, id)
);
CREATE INDEX student_checkins_student_idx ON student_checkins(organization_id, student_id, checked_on);

-- The professional's reading of a check-in. Append-only.
CREATE TABLE checkin_acknowledgements (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  checkin_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  note TEXT CHECK (note IS NULL OR length(note) <= 500),
  created_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, checkin_id) REFERENCES student_checkins(organization_id, id)
);
CREATE INDEX checkin_acknowledgements_checkin_idx ON checkin_acknowledgements(checkin_id, created_at);

-- A check-in is made by a login that is linked to that student right now.
CREATE TRIGGER student_checkins_linked_login
BEFORE INSERT ON student_checkins
WHEN NOT EXISTS (
  SELECT 1 FROM student_access sa
  WHERE sa.organization_id = NEW.organization_id AND sa.student_id = NEW.student_id
    AND sa.user_id = NEW.logged_by_user_id AND sa.revoked_at IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'CHECKIN_LOGIN_INVALID');
END;

-- What a check-in is about never changes.
CREATE TRIGGER student_checkins_identity_frozen
BEFORE UPDATE OF organization_id, student_id, checked_on, logged_by_user_id, created_at ON student_checkins
BEGIN
  SELECT RAISE(ABORT, 'CHECKIN_IDENTITY_FROZEN');
END;

-- A report of discomfort, and a check-in the professional has read, are kept as they were.
CREATE TRIGGER student_checkins_frozen_update
BEFORE UPDATE ON student_checkins
WHEN OLD.discomfort_reported = 1 OR EXISTS (SELECT 1 FROM checkin_acknowledgements a WHERE a.checkin_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'CHECKIN_FROZEN');
END;

CREATE TRIGGER student_checkins_frozen_delete
BEFORE DELETE ON student_checkins
WHEN OLD.discomfort_reported = 1 OR EXISTS (SELECT 1 FROM checkin_acknowledgements a WHERE a.checkin_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'CHECKIN_FROZEN');
END;

CREATE TRIGGER checkin_acknowledgements_append_only_update
BEFORE UPDATE ON checkin_acknowledgements
BEGIN
  SELECT RAISE(ABORT, 'CHECKIN_ACKNOWLEDGEMENT_APPEND_ONLY');
END;

CREATE TRIGGER checkin_acknowledgements_append_only_delete
BEFORE DELETE ON checkin_acknowledgements
BEGIN
  SELECT RAISE(ABORT, 'CHECKIN_ACKNOWLEDGEMENT_APPEND_ONLY');
END;

INSERT INTO app_schema_versions(version) VALUES ('0015_student_checkins');
