-- Additive migration: what the student actually did (master document, phase 4: "cargas executadas,
-- RPE/RIR real, dor, aderência"). 0001..0011 stay untouched.
--
-- EXECUTION IS NOT PRESCRIPTION. A workout session points at a delivered revision and at the
-- prescribed exercises it was made of, and copies nothing back: the delivered revision stays exactly
-- as the professional delivered it, and the log is the student's own record next to it. Nothing here
-- changes a plan, approves or releases anything, and no rule or model reads this to adjust a
-- workout: the professional reads it and decides.
--
-- One session per student, revision, phase, workout and day. Sets are numbers the student typed
-- (repetitions, load in kg); an exercise can be marked as not done. `rir` is the reps the student
-- felt in reserve, optional. `effort` is the whole session, 0 to 10, optional. Pain or discomfort
-- is reported per exercise and for the session, and is never interpreted.
--
-- A report of pain or discomfort is kept: once a session carries one, the session and everything
-- under it are frozen (no edit, no delete), whatever the application does. The same happens once
-- the professional has recorded a reading of it. A session with neither can be corrected by the
-- student; the application limits that to the first 24 hours.
-- The professional's reading of a session is a separate append-only record.
CREATE TABLE workout_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  phase_index INTEGER NOT NULL CHECK (phase_index BETWEEN 1 AND 12),
  workout_label TEXT NOT NULL CHECK (length(workout_label) BETWEEN 1 AND 20),
  performed_on TEXT NOT NULL CHECK (performed_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  effort INTEGER CHECK (effort IS NULL OR effort BETWEEN 0 AND 10),
  pain_reported INTEGER NOT NULL DEFAULT 0 CHECK (pain_reported IN (0, 1)),
  notes TEXT CHECK (notes IS NULL OR length(notes) <= 500),
  logged_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id, id),
  UNIQUE (student_id, revision_id, phase_index, workout_label, performed_on),
  FOREIGN KEY (organization_id, student_id) REFERENCES students(organization_id, id),
  FOREIGN KEY (organization_id, revision_id) REFERENCES plan_revisions(organization_id, id)
);
CREATE INDEX workout_sessions_student_idx ON workout_sessions(organization_id, student_id, performed_on);

CREATE TABLE session_exercises (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  prescribed_exercise_id TEXT NOT NULL REFERENCES prescribed_exercises(id),
  exercise_name TEXT NOT NULL CHECK (length(trim(exercise_name)) BETWEEN 1 AND 120),
  position INTEGER NOT NULL CHECK (position >= 0),
  done INTEGER NOT NULL DEFAULT 1 CHECK (done IN (0, 1)),
  rir INTEGER CHECK (rir IS NULL OR rir BETWEEN 0 AND 10),
  pain INTEGER NOT NULL DEFAULT 0 CHECK (pain IN (0, 1)),
  notes TEXT CHECK (notes IS NULL OR length(notes) <= 300),
  UNIQUE (organization_id, id),
  UNIQUE (session_id, prescribed_exercise_id),
  FOREIGN KEY (organization_id, session_id) REFERENCES workout_sessions(organization_id, id)
);

CREATE TABLE session_sets (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  session_exercise_id TEXT NOT NULL,
  set_number INTEGER NOT NULL CHECK (set_number BETWEEN 1 AND 20),
  reps INTEGER CHECK (reps IS NULL OR reps BETWEEN 0 AND 999),
  load_kg REAL CHECK (load_kg IS NULL OR (load_kg >= 0 AND load_kg <= 1000)),
  UNIQUE (session_exercise_id, set_number),
  FOREIGN KEY (organization_id, session_exercise_id) REFERENCES session_exercises(organization_id, id)
);

-- The professional's reading of a session. Append-only.
CREATE TABLE session_acknowledgements (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  note TEXT CHECK (note IS NULL OR length(note) <= 500),
  created_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, session_id) REFERENCES workout_sessions(organization_id, id)
);
CREATE INDEX session_acknowledgements_session_idx ON session_acknowledgements(session_id, created_at);

-- A session is made only on the delivered revision of a plan of that same student.
CREATE TRIGGER workout_sessions_delivered_only
BEFORE INSERT ON workout_sessions
WHEN NOT EXISTS (
  SELECT 1 FROM plan_revisions r JOIN training_plans p ON p.organization_id = r.organization_id AND p.id = r.plan_id
  WHERE r.id = NEW.revision_id AND r.state = 'DELIVERED' AND p.student_id = NEW.student_id
)
BEGIN
  SELECT RAISE(ABORT, 'SESSION_REVISION_INVALID');
END;

-- What a session is about never changes.
CREATE TRIGGER workout_sessions_identity_frozen
BEFORE UPDATE OF organization_id, student_id, revision_id, phase_index, workout_label, performed_on,
  logged_by_user_id, created_at ON workout_sessions
BEGIN
  SELECT RAISE(ABORT, 'WORKOUT_SESSION_IDENTITY_FROZEN');
END;

-- A report of pain or discomfort, and a session the professional has read, are kept as they were.
CREATE TRIGGER workout_sessions_pain_frozen_update
BEFORE UPDATE ON workout_sessions
WHEN OLD.pain_reported = 1 OR EXISTS (SELECT 1 FROM session_acknowledgements a WHERE a.session_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'WORKOUT_SESSION_FROZEN');
END;

CREATE TRIGGER workout_sessions_pain_frozen_delete
BEFORE DELETE ON workout_sessions
WHEN OLD.pain_reported = 1 OR EXISTS (SELECT 1 FROM session_acknowledgements a WHERE a.session_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'WORKOUT_SESSION_FROZEN');
END;

-- An exercise of a session is one of the prescribed exercises of that very workout.
CREATE TRIGGER session_exercises_same_workout
BEFORE INSERT ON session_exercises
WHEN NOT EXISTS (
  SELECT 1 FROM workout_sessions ws JOIN prescribed_exercises pe
    ON pe.revision_id = ws.revision_id AND pe.phase_index = ws.phase_index AND pe.workout_label = ws.workout_label
  WHERE ws.id = NEW.session_id AND pe.id = NEW.prescribed_exercise_id
)
BEGIN
  SELECT RAISE(ABORT, 'SESSION_EXERCISE_INVALID');
END;

CREATE TRIGGER session_exercises_pain_frozen_insert
BEFORE INSERT ON session_exercises
WHEN (SELECT pain_reported FROM workout_sessions WHERE id = NEW.session_id) = 1
  OR EXISTS (SELECT 1 FROM session_acknowledgements a WHERE a.session_id = NEW.session_id)
BEGIN
  SELECT RAISE(ABORT, 'WORKOUT_SESSION_FROZEN');
END;

CREATE TRIGGER session_exercises_pain_frozen_update
BEFORE UPDATE ON session_exercises
WHEN (SELECT pain_reported FROM workout_sessions WHERE id = OLD.session_id) = 1
  OR EXISTS (SELECT 1 FROM session_acknowledgements a WHERE a.session_id = OLD.session_id)
BEGIN
  SELECT RAISE(ABORT, 'WORKOUT_SESSION_FROZEN');
END;

CREATE TRIGGER session_exercises_pain_frozen_delete
BEFORE DELETE ON session_exercises
WHEN (SELECT pain_reported FROM workout_sessions WHERE id = OLD.session_id) = 1
  OR EXISTS (SELECT 1 FROM session_acknowledgements a WHERE a.session_id = OLD.session_id)
BEGIN
  SELECT RAISE(ABORT, 'WORKOUT_SESSION_FROZEN');
END;

CREATE TRIGGER session_sets_pain_frozen_insert
BEFORE INSERT ON session_sets
WHEN (SELECT ws.pain_reported FROM session_exercises se JOIN workout_sessions ws ON ws.id = se.session_id
      WHERE se.id = NEW.session_exercise_id) = 1
  OR EXISTS (SELECT 1 FROM session_exercises se JOIN session_acknowledgements a ON a.session_id = se.session_id
      WHERE se.id = NEW.session_exercise_id)
BEGIN
  SELECT RAISE(ABORT, 'WORKOUT_SESSION_FROZEN');
END;

CREATE TRIGGER session_sets_pain_frozen_update
BEFORE UPDATE ON session_sets
WHEN (SELECT ws.pain_reported FROM session_exercises se JOIN workout_sessions ws ON ws.id = se.session_id
      WHERE se.id = OLD.session_exercise_id) = 1
  OR EXISTS (SELECT 1 FROM session_exercises se JOIN session_acknowledgements a ON a.session_id = se.session_id
      WHERE se.id = OLD.session_exercise_id)
BEGIN
  SELECT RAISE(ABORT, 'WORKOUT_SESSION_FROZEN');
END;

CREATE TRIGGER session_sets_pain_frozen_delete
BEFORE DELETE ON session_sets
WHEN (SELECT ws.pain_reported FROM session_exercises se JOIN workout_sessions ws ON ws.id = se.session_id
      WHERE se.id = OLD.session_exercise_id) = 1
  OR EXISTS (SELECT 1 FROM session_exercises se JOIN session_acknowledgements a ON a.session_id = se.session_id
      WHERE se.id = OLD.session_exercise_id)
BEGIN
  SELECT RAISE(ABORT, 'WORKOUT_SESSION_FROZEN');
END;

CREATE TRIGGER session_acknowledgements_append_only_update
BEFORE UPDATE ON session_acknowledgements
BEGIN
  SELECT RAISE(ABORT, 'SESSION_ACKNOWLEDGEMENT_APPEND_ONLY');
END;

CREATE TRIGGER session_acknowledgements_append_only_delete
BEFORE DELETE ON session_acknowledgements
BEGIN
  SELECT RAISE(ABORT, 'SESSION_ACKNOWLEDGEMENT_APPEND_ONLY');
END;

INSERT INTO app_schema_versions(version) VALUES ('0012_workout_sessions');
