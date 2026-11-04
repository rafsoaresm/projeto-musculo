-- Additive migration: execution of OCCURRENCE revisions (motor v2, design §3.5, numbered 0043 here). 0001..0042 stay untouched.
--
-- workout_sessions.occurrence_id: a log of an OCCURRENCE revision points at the session occurrence it executes (required for those
--   revisions, refused for TEMPLATE ones, which have no occurrences). It never changes once written. Logs of TEMPLATE revisions, all
--   existing ones included, are unchanged and keep occurrence_id NULL.
-- session_exercises of such a log must be an exercise included in that occurrence.
-- session_sets: optional per-set fields the student may type (RIR, duration, distance, how the load was counted). Never filled in by
--   the application; NULL is "not informed", never 0. Shown to the student collapsed (decided 04/11/2026, PENDENCIAS R14 Q7).
--
-- Logging the same occurrence on two different days is not blocked here (decided 04/11/2026, Q5): adherence counts it once. The 0012
-- UNIQUE (student_id, revision_id, phase_index, workout_label, performed_on) stays, so the same workout twice on one day is refused.

ALTER TABLE workout_sessions ADD COLUMN occurrence_id TEXT;
CREATE INDEX workout_sessions_occurrence_idx ON workout_sessions(occurrence_id) WHERE occurrence_id IS NOT NULL;

CREATE TRIGGER workout_sessions_occurrence_valid
BEFORE INSERT ON workout_sessions
WHEN NEW.occurrence_id IS NOT NULL AND (
  (SELECT prescription_model FROM plan_revisions WHERE id = NEW.revision_id) IS NOT 'OCCURRENCE'
  OR NOT EXISTS (
    SELECT 1 FROM plan_session_occurrences o WHERE o.id = NEW.occurrence_id AND o.revision_id = NEW.revision_id
      AND o.organization_id = NEW.organization_id AND o.phase_index = NEW.phase_index
      AND o.workout_label = NEW.workout_label))
BEGIN
  SELECT RAISE(ABORT, 'SESSION_OCCURRENCE_INVALID');
END;
CREATE TRIGGER workout_sessions_occurrence_required
BEFORE INSERT ON workout_sessions
WHEN NEW.occurrence_id IS NULL
  AND (SELECT prescription_model FROM plan_revisions WHERE id = NEW.revision_id) = 'OCCURRENCE'
BEGIN
  SELECT RAISE(ABORT, 'SESSION_OCCURRENCE_INVALID');
END;
CREATE TRIGGER workout_sessions_occurrence_frozen
BEFORE UPDATE OF occurrence_id ON workout_sessions
WHEN NEW.occurrence_id IS NOT OLD.occurrence_id
BEGIN
  SELECT RAISE(ABORT, 'WORKOUT_SESSION_IDENTITY_FROZEN');
END;
CREATE TRIGGER session_exercises_in_occurrence
BEFORE INSERT ON session_exercises
WHEN (SELECT occurrence_id FROM workout_sessions WHERE id = NEW.session_id) IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM workout_sessions ws JOIN prescribed_exercise_occurrences x ON x.occurrence_id = ws.occurrence_id
  WHERE ws.id = NEW.session_id AND x.prescribed_exercise_id = NEW.prescribed_exercise_id AND x.included = 1)
BEGIN
  SELECT RAISE(ABORT, 'SESSION_EXERCISE_INVALID');
END;

ALTER TABLE session_sets ADD COLUMN rir INTEGER CHECK (rir IS NULL OR rir BETWEEN 0 AND 10);
ALTER TABLE session_sets ADD COLUMN duration_seconds INTEGER CHECK (duration_seconds IS NULL OR duration_seconds BETWEEN 0 AND 86400);
ALTER TABLE session_sets ADD COLUMN distance_meters REAL CHECK (distance_meters IS NULL OR (distance_meters >= 0 AND distance_meters <= 1000000));
ALTER TABLE session_sets ADD COLUMN load_basis TEXT CHECK (load_basis IS NULL OR load_basis IN
  ('TOTAL', 'PER_HAND', 'PER_SIDE', 'MACHINE_STACK', 'BODYWEIGHT', 'ASSISTANCE', 'NONE'));

INSERT INTO app_schema_versions(version) VALUES ('0043_execution_occurrences');
