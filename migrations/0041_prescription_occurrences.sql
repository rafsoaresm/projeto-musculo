-- Additive migration: prescription per session occurrence, for the automatic prescription (motor v2, design §3.2).
-- 0001..0040 stay untouched; nothing existing is deleted or rewritten.
--
-- plan_revisions.content_version: a counter of content changes of a DRAFT revision, so a proposal generated on version N cannot be
--   applied over a draft the professional changed afterwards (compare-and-set). Row triggers bump it on prescribed_exercises and on a
--   real change of the structure (saveDraft always rewrites input_json/schedule_json, so the trigger compares the values). The two
--   occurrence tables below have NO bump triggers (one apply can write thousands of rows): every repository batch that writes them
--   ends with one explicit bump statement.
-- plan_revisions.prescription_model: TEMPLATE (one dose per workout, every revision before this migration, read exactly as before) or
--   OCCURRENCE (one dose per session of each week). It moves only TEMPLATE -> OCCURRENCE, and only while DRAFT.
-- prescribed_exercises: dose_json (structured dose, optional), dose_text (the text the student reads, materialised when written),
--   application_id / source_slot_key (which application of a proposal created the row, and the engine slot), copied_from_id (set by
--   copies: new revision, duplicate, copy phase/workout) and substitutes_prescribed_exercise_id. Provenance never changes once written.
-- plan_session_occurrences: one row per session of each week of the saved schedule, for OCCURRENCE revisions.
-- prescribed_exercise_occurrences: the dose of one prescribed exercise in one occurrence, with its text materialised. Order inside an
--   occurrence is always prescribed_exercises.position (one position space).
--
-- Existing rows: content_version 0, prescription_model TEMPLATE, every new column NULL. Nothing is backfilled.
-- Revisions past DRAFT stay untouchable (0007); the new tables get equivalent triggers.

ALTER TABLE plan_revisions ADD COLUMN content_version INTEGER NOT NULL DEFAULT 0 CHECK (content_version >= 0);
ALTER TABLE plan_revisions ADD COLUMN prescription_model TEXT NOT NULL DEFAULT 'TEMPLATE' CHECK (prescription_model IN ('TEMPLATE', 'OCCURRENCE'));

ALTER TABLE prescribed_exercises ADD COLUMN dose_json TEXT CHECK (dose_json IS NULL OR (json_valid(dose_json) AND length(dose_json) <= 4000));
ALTER TABLE prescribed_exercises ADD COLUMN dose_text TEXT CHECK (dose_text IS NULL OR length(dose_text) <= 300);
ALTER TABLE prescribed_exercises ADD COLUMN application_id TEXT;
ALTER TABLE prescribed_exercises ADD COLUMN source_slot_key TEXT CHECK (source_slot_key IS NULL OR length(source_slot_key) <= 300);
ALTER TABLE prescribed_exercises ADD COLUMN copied_from_id TEXT;
ALTER TABLE prescribed_exercises ADD COLUMN substitutes_prescribed_exercise_id TEXT;
CREATE INDEX prescribed_exercises_application_idx ON prescribed_exercises(revision_id, application_id, source_slot_key)
  WHERE application_id IS NOT NULL;
CREATE INDEX prescribed_exercises_copied_idx ON prescribed_exercises(revision_id, copied_from_id)
  WHERE copied_from_id IS NOT NULL;

-- The counter and the model are content: frozen past DRAFT like the rest (0007).
CREATE TRIGGER plan_revisions_model_frozen
BEFORE UPDATE OF content_version, prescription_model ON plan_revisions
WHEN OLD.state <> 'DRAFT'
  AND (NEW.content_version IS NOT OLD.content_version OR NEW.prescription_model IS NOT OLD.prescription_model)
BEGIN
  SELECT RAISE(ABORT, 'PLAN_REVISION_FROZEN');
END;
CREATE TRIGGER plan_revisions_version_forward
BEFORE UPDATE OF content_version ON plan_revisions
WHEN NEW.content_version < OLD.content_version
BEGIN
  SELECT RAISE(ABORT, 'PLAN_REVISION_VERSION_INVALID');
END;
CREATE TRIGGER plan_revisions_model_one_way
BEFORE UPDATE OF prescription_model ON plan_revisions
WHEN OLD.prescription_model = 'OCCURRENCE' AND NEW.prescription_model <> 'OCCURRENCE'
BEGIN
  SELECT RAISE(ABORT, 'PLAN_REVISION_MODEL_INVALID');
END;

-- Bumps only on a real change of the structure: a save that writes the same bytes is not a change.
CREATE TRIGGER plan_revisions_bump_on_structure
AFTER UPDATE OF input_json, schedule_json ON plan_revisions
WHEN NEW.input_json IS NOT OLD.input_json OR NEW.schedule_json IS NOT OLD.schedule_json
BEGIN
  UPDATE plan_revisions SET content_version = content_version + 1 WHERE id = NEW.id;
END;

CREATE TRIGGER prescribed_exercises_bump_insert
AFTER INSERT ON prescribed_exercises
BEGIN
  UPDATE plan_revisions SET content_version = content_version + 1 WHERE id = NEW.revision_id;
END;
CREATE TRIGGER prescribed_exercises_bump_delete
AFTER DELETE ON prescribed_exercises
BEGIN
  UPDATE plan_revisions SET content_version = content_version + 1 WHERE id = OLD.revision_id;
END;
-- Only the content columns: touching updated_at alone is not a change.
CREATE TRIGGER prescribed_exercises_bump_update
AFTER UPDATE ON prescribed_exercises
WHEN NEW.phase_index IS NOT OLD.phase_index OR NEW.workout_label IS NOT OLD.workout_label
  OR NEW.position IS NOT OLD.position OR NEW.exercise_id IS NOT OLD.exercise_id OR NEW.name IS NOT OLD.name
  OR NEW.sets IS NOT OLD.sets OR NEW.reps IS NOT OLD.reps OR NEW.load_instruction IS NOT OLD.load_instruction
  OR NEW.cadence IS NOT OLD.cadence OR NEW.rest_seconds IS NOT OLD.rest_seconds OR NEW.rest_text IS NOT OLD.rest_text
  OR NEW.rir_min IS NOT OLD.rir_min OR NEW.rir_max IS NOT OLD.rir_max OR NEW.notes IS NOT OLD.notes
  OR NEW.dose_json IS NOT OLD.dose_json OR NEW.dose_text IS NOT OLD.dose_text OR NEW.origin IS NOT OLD.origin
BEGIN
  UPDATE plan_revisions SET content_version = content_version + 1 WHERE id = NEW.revision_id;
END;

-- Where a row came from is written once, with the row.
CREATE TRIGGER prescribed_exercises_provenance_frozen
BEFORE UPDATE OF application_id, source_slot_key, copied_from_id, substitutes_prescribed_exercise_id ON prescribed_exercises
WHEN OLD.application_id IS NOT NEW.application_id OR OLD.source_slot_key IS NOT NEW.source_slot_key
  OR OLD.copied_from_id IS NOT NEW.copied_from_id
  OR OLD.substitutes_prescribed_exercise_id IS NOT NEW.substitutes_prescribed_exercise_id
BEGIN
  SELECT RAISE(ABORT, 'PRESCRIBED_EXERCISE_PROVENANCE_FROZEN');
END;

-- No 1..12 CHECK on phase_index here: the cap lives in prescribed_exercises (0006) and workout_sessions (0012).
CREATE TABLE plan_session_occurrences (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  phase_index INTEGER NOT NULL CHECK (phase_index >= 1),
  week_index INTEGER NOT NULL CHECK (week_index >= 1),
  slot_index INTEGER NOT NULL CHECK (slot_index >= 1),
  workout_label TEXT NOT NULL CHECK (length(workout_label) BETWEEN 1 AND 20),
  week_start TEXT NOT NULL CHECK (week_start GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  planned_date TEXT CHECK (planned_date IS NULL OR planned_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  stimulus TEXT CHECK (stimulus IS NULL OR length(stimulus) <= 40),
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id, id),
  UNIQUE (revision_id, phase_index, week_index, slot_index),
  FOREIGN KEY (organization_id, revision_id) REFERENCES plan_revisions(organization_id, id)
);
CREATE INDEX plan_session_occurrences_workout_idx
  ON plan_session_occurrences(revision_id, phase_index, workout_label, week_index, slot_index);

CREATE TABLE prescribed_exercise_occurrences (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  prescribed_exercise_id TEXT NOT NULL REFERENCES prescribed_exercises(id),
  occurrence_id TEXT NOT NULL,
  included INTEGER NOT NULL DEFAULT 1 CHECK (included IN (0, 1)),
  sets TEXT CHECK (sets IS NULL OR length(sets) <= 20),
  reps TEXT CHECK (reps IS NULL OR length(reps) <= 40),
  load_instruction TEXT CHECK (load_instruction IS NULL OR length(load_instruction) <= 120),
  cadence TEXT CHECK (cadence IS NULL OR length(cadence) <= 40),
  rest_seconds INTEGER CHECK (rest_seconds IS NULL OR rest_seconds BETWEEN 0 AND 3600),
  rest_text TEXT CHECK (rest_text IS NULL OR length(rest_text) <= 40),
  rir_min INTEGER CHECK (rir_min IS NULL OR rir_min BETWEEN 0 AND 10),
  rir_max INTEGER CHECK (rir_max IS NULL OR rir_max BETWEEN 0 AND 10),
  notes TEXT CHECK (notes IS NULL OR length(notes) <= 500),
  dose_json TEXT CHECK (dose_json IS NULL OR (json_valid(dose_json) AND length(dose_json) <= 4000)),
  dose_text TEXT CHECK (dose_text IS NULL OR length(dose_text) <= 300),
  trace_json TEXT CHECK (trace_json IS NULL OR (json_valid(trace_json) AND length(trace_json) <= 8000)),
  origin TEXT NOT NULL DEFAULT 'PROFESSIONAL' CHECK (origin IN ('PROFESSIONAL', 'SYSTEM', 'SYSTEM_EDITED', 'AI')),
  source_proposal_item_id TEXT,
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (rir_min IS NULL OR rir_max IS NULL OR rir_min <= rir_max),
  UNIQUE (organization_id, id),
  UNIQUE (prescribed_exercise_id, occurrence_id),
  FOREIGN KEY (organization_id, occurrence_id) REFERENCES plan_session_occurrences(organization_id, id),
  FOREIGN KEY (organization_id, revision_id) REFERENCES plan_revisions(organization_id, id)
);
CREATE INDEX prescribed_exercise_occurrences_occ_idx ON prescribed_exercise_occurrences(occurrence_id, included);
CREATE INDEX prescribed_exercise_occurrences_pe_idx ON prescribed_exercise_occurrences(prescribed_exercise_id);

-- The exercise and the occurrence belong to the same workout of the same revision and organization.
CREATE TRIGGER prescribed_exercise_occurrences_same_workout
BEFORE INSERT ON prescribed_exercise_occurrences
WHEN NOT EXISTS (
  SELECT 1 FROM prescribed_exercises pe JOIN plan_session_occurrences o
    ON o.revision_id = pe.revision_id AND o.phase_index = pe.phase_index AND o.workout_label = pe.workout_label
  WHERE pe.id = NEW.prescribed_exercise_id AND o.id = NEW.occurrence_id AND pe.revision_id = NEW.revision_id
    AND pe.organization_id = NEW.organization_id AND o.organization_id = NEW.organization_id)
BEGIN
  SELECT RAISE(ABORT, 'OCCURRENCE_ITEM_INVALID');
END;
CREATE TRIGGER prescribed_exercise_occurrences_identity_frozen
BEFORE UPDATE OF organization_id, revision_id, prescribed_exercise_id, occurrence_id ON prescribed_exercise_occurrences
WHEN NEW.organization_id IS NOT OLD.organization_id OR NEW.revision_id IS NOT OLD.revision_id
  OR NEW.prescribed_exercise_id IS NOT OLD.prescribed_exercise_id OR NEW.occurrence_id IS NOT OLD.occurrence_id
BEGIN
  SELECT RAISE(ABORT, 'OCCURRENCE_ITEM_INVALID');
END;

CREATE TRIGGER plan_session_occurrences_frozen_insert
BEFORE INSERT ON plan_session_occurrences
WHEN (SELECT state FROM plan_revisions WHERE id = NEW.revision_id) <> 'DRAFT'
BEGIN
  SELECT RAISE(ABORT, 'PLAN_REVISION_FROZEN');
END;
-- Dates may be recomputed by saveDraft while DRAFT; identity and label never change.
CREATE TRIGGER plan_session_occurrences_frozen_update
BEFORE UPDATE ON plan_session_occurrences
WHEN (SELECT state FROM plan_revisions WHERE id = OLD.revision_id) <> 'DRAFT'
  OR NEW.revision_id IS NOT OLD.revision_id OR NEW.organization_id IS NOT OLD.organization_id
  OR NEW.phase_index IS NOT OLD.phase_index OR NEW.week_index IS NOT OLD.week_index
  OR NEW.slot_index IS NOT OLD.slot_index OR NEW.workout_label IS NOT OLD.workout_label
BEGIN
  SELECT RAISE(ABORT, 'PLAN_REVISION_FROZEN');
END;
CREATE TRIGGER plan_session_occurrences_frozen_delete
BEFORE DELETE ON plan_session_occurrences
WHEN (SELECT state FROM plan_revisions WHERE id = OLD.revision_id) <> 'DRAFT'
BEGIN
  SELECT RAISE(ABORT, 'PLAN_REVISION_FROZEN');
END;
-- Children first, so no dose is left without its occurrence.
CREATE TRIGGER plan_session_occurrences_children_first
BEFORE DELETE ON plan_session_occurrences
WHEN EXISTS (SELECT 1 FROM prescribed_exercise_occurrences x WHERE x.occurrence_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'OCCURRENCE_ITEMS_FIRST');
END;
CREATE TRIGGER prescribed_exercise_occurrences_frozen_insert
BEFORE INSERT ON prescribed_exercise_occurrences
WHEN (SELECT state FROM plan_revisions WHERE id = NEW.revision_id) <> 'DRAFT'
BEGIN
  SELECT RAISE(ABORT, 'PLAN_REVISION_FROZEN');
END;
CREATE TRIGGER prescribed_exercise_occurrences_frozen_update
BEFORE UPDATE ON prescribed_exercise_occurrences
WHEN (SELECT state FROM plan_revisions WHERE id = OLD.revision_id) <> 'DRAFT'
BEGIN
  SELECT RAISE(ABORT, 'PLAN_REVISION_FROZEN');
END;
CREATE TRIGGER prescribed_exercise_occurrences_frozen_delete
BEFORE DELETE ON prescribed_exercise_occurrences
WHEN (SELECT state FROM plan_revisions WHERE id = OLD.revision_id) <> 'DRAFT'
BEGIN
  SELECT RAISE(ABORT, 'PLAN_REVISION_FROZEN');
END;
CREATE TRIGGER prescribed_exercises_occurrences_first
BEFORE DELETE ON prescribed_exercises
WHEN EXISTS (SELECT 1 FROM prescribed_exercise_occurrences x WHERE x.prescribed_exercise_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'OCCURRENCE_ITEMS_FIRST');
END;

INSERT INTO app_schema_versions(version) VALUES ('0041_prescription_occurrences');
