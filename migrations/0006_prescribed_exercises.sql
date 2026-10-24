-- Additive migration: manual prescription of exercises on a plan revision.
-- 0001..0005 stay untouched. Same conventions: server-generated IDs, UTC ISO-8601 text.
--
-- Each row is one exercise inside one workout (a letter of the split) of one phase of one
-- revision. Content changes only while the revision is DRAFT: every write in the repository
-- filters on that state, and copying a revision copies these rows under new IDs.
-- name and video_* are a SNAPSHOT: editing or archiving a library exercise never changes a
-- prescription, and a video can be overridden here without touching the library.
-- Sets, reps, load, cadence and rest are the professional's own free text: this migration
-- (and the code) supplies no default dose, preset or load.
-- origin records who set the row. Only PROFESSIONAL is produced today; SYSTEM and AI are
-- reserved for the rule engine and need their own review flow before they appear.
CREATE TABLE prescribed_exercises (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  phase_index INTEGER NOT NULL CHECK (phase_index BETWEEN 1 AND 12),
  workout_label TEXT NOT NULL CHECK (length(workout_label) BETWEEN 1 AND 20),
  -- Order inside the workout. Gaps are allowed (removing leaves one). Zero is only a transient
  -- value inside a reorder batch.
  position INTEGER NOT NULL CHECK (position >= 0),
  exercise_id TEXT REFERENCES exercises(id),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  video_url TEXT CHECK (video_url IS NULL OR (length(video_url) <= 500 AND video_url LIKE 'https://%')),
  video_status TEXT NOT NULL DEFAULT 'NONE' CHECK (length(video_status) BETWEEN 1 AND 20),
  sets TEXT CHECK (sets IS NULL OR length(sets) <= 20),
  reps TEXT CHECK (reps IS NULL OR length(reps) <= 40),
  load_instruction TEXT CHECK (load_instruction IS NULL OR length(load_instruction) <= 120),
  cadence TEXT CHECK (cadence IS NULL OR length(cadence) <= 40),
  rest_seconds INTEGER CHECK (rest_seconds IS NULL OR rest_seconds BETWEEN 0 AND 3600),
  rest_text TEXT CHECK (rest_text IS NULL OR length(rest_text) <= 40),
  rir_min INTEGER CHECK (rir_min IS NULL OR rir_min BETWEEN 0 AND 10),
  rir_max INTEGER CHECK (rir_max IS NULL OR rir_max BETWEEN 0 AND 10),
  notes TEXT CHECK (notes IS NULL OR length(notes) <= 500),
  origin TEXT NOT NULL DEFAULT 'PROFESSIONAL' CHECK (length(origin) BETWEEN 1 AND 20),
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (rir_min IS NULL OR rir_max IS NULL OR rir_min <= rir_max),
  UNIQUE (revision_id, phase_index, workout_label, position),
  FOREIGN KEY (organization_id, revision_id) REFERENCES plan_revisions(organization_id, id)
);
CREATE INDEX prescribed_exercises_revision_idx ON prescribed_exercises(revision_id, phase_index, workout_label, position);

INSERT INTO app_schema_versions(version) VALUES ('0006_prescribed_exercises');
