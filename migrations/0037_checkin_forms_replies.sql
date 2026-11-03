-- Additive migration: check-ins the professional configures, check-ins of previous days and the professional's reply (PENDENCIAS B8;
-- ROADMAP 0.87). 0001..0036 stay untouched; nothing existing is changed or deleted.
--
-- checkin_form_versions: what the check-in of one student asks, version by version. The professional with an active technical
--   assignment over the student chooses which of the existing questions are asked (effort 0 to 10, recovery in words, notes) and may
--   add questions of their own, answered with text only. The report of discomfort is not a choice: it is always asked. A version is never
--   changed nor deleted; a check-in keeps the version it was answered with. A student without a version is asked everything, as before.
--   `questions` is the ordered list [{"id","text"}] checked by the app (src/modules/checkin/contracts.ts).
-- student_checkins.form_version_id / answers: the version a check-in was answered with (NULL: the default, every existing question,
--   which is what every check-in made before this migration was asked) and the text answers to the professional's own questions
--   ([{"questionId","answer"}]). Set when the check-in is made; the version never changes afterwards.
-- checkin_replies: the professional's replies to a check-in, in text, append-only, shown to the student with who wrote and when.
-- checkin_reply_seen: until when the student login has seen the replies of a student record (the in-app "nova resposta" marker). No e-mail.
--
-- The window to register the check-in of a previous day is decided in the app (MAX_DAYS_BACK of the workout log, PENDENCIAS T2).

CREATE TABLE checkin_form_versions (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  ask_effort INTEGER NOT NULL CHECK (ask_effort IN (0, 1)),
  ask_recovery INTEGER NOT NULL CHECK (ask_recovery IN (0, 1)),
  ask_notes INTEGER NOT NULL CHECK (ask_notes IN (0, 1)),
  questions TEXT NOT NULL CHECK (json_valid(questions) AND json_type(questions) = 'array' AND length(questions) <= 4000),
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE (organization_id, id),
  UNIQUE (student_id, version),
  FOREIGN KEY (organization_id, student_id) REFERENCES students(organization_id, id)
);
CREATE INDEX checkin_form_versions_student_idx ON checkin_form_versions(organization_id, student_id, version);

CREATE TRIGGER checkin_form_versions_append_only_update
BEFORE UPDATE ON checkin_form_versions
BEGIN
  SELECT RAISE(ABORT, 'CHECKIN_FORM_APPEND_ONLY');
END;

CREATE TRIGGER checkin_form_versions_append_only_delete
BEFORE DELETE ON checkin_form_versions
BEGIN
  SELECT RAISE(ABORT, 'CHECKIN_FORM_APPEND_ONLY');
END;

ALTER TABLE student_checkins ADD COLUMN form_version_id TEXT REFERENCES checkin_form_versions(id);
ALTER TABLE student_checkins ADD COLUMN answers TEXT
  CHECK (answers IS NULL OR (json_valid(answers) AND json_type(answers) = 'array' AND length(answers) <= 8000));

-- A check-in is answered with a version of its own student.
CREATE TRIGGER student_checkins_form_of_student
BEFORE INSERT ON student_checkins
WHEN NEW.form_version_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM checkin_form_versions f
  WHERE f.id = NEW.form_version_id AND f.organization_id = NEW.organization_id AND f.student_id = NEW.student_id
)
BEGIN
  SELECT RAISE(ABORT, 'CHECKIN_FORM_INVALID');
END;

-- The version a check-in was answered with never changes.
CREATE TRIGGER student_checkins_form_frozen
BEFORE UPDATE OF form_version_id ON student_checkins
WHEN OLD.form_version_id IS NOT NEW.form_version_id
BEGIN
  SELECT RAISE(ABORT, 'CHECKIN_IDENTITY_FROZEN');
END;

CREATE TABLE checkin_replies (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  checkin_id TEXT NOT NULL,
  author_user_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 1000),
  created_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, checkin_id) REFERENCES student_checkins(organization_id, id)
);
CREATE INDEX checkin_replies_checkin_idx ON checkin_replies(checkin_id, created_at);
CREATE INDEX checkin_replies_org_idx ON checkin_replies(organization_id, created_at);

CREATE TRIGGER checkin_replies_append_only_update
BEFORE UPDATE ON checkin_replies
BEGIN
  SELECT RAISE(ABORT, 'CHECKIN_REPLY_APPEND_ONLY');
END;

CREATE TRIGGER checkin_replies_append_only_delete
BEFORE DELETE ON checkin_replies
BEGIN
  SELECT RAISE(ABORT, 'CHECKIN_REPLY_APPEND_ONLY');
END;

-- A check-in with a reply is kept as it was, like one the professional has read.
CREATE TRIGGER student_checkins_replied_update
BEFORE UPDATE ON student_checkins
WHEN EXISTS (SELECT 1 FROM checkin_replies r WHERE r.checkin_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'CHECKIN_FROZEN');
END;

CREATE TRIGGER student_checkins_replied_delete
BEFORE DELETE ON student_checkins
WHEN EXISTS (SELECT 1 FROM checkin_replies r WHERE r.checkin_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'CHECKIN_FROZEN');
END;

CREATE TABLE checkin_reply_seen (
  organization_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  seen_at TEXT NOT NULL,
  PRIMARY KEY (student_id, user_id),
  FOREIGN KEY (organization_id, student_id) REFERENCES students(organization_id, id)
);

INSERT INTO app_schema_versions(version) VALUES ('0037_checkin_forms_replies');
