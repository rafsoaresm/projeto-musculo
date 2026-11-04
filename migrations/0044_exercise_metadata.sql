-- Additive migration: exercise library metadata for the automatic prescription (motor S4, design §3.4). 0001..0043 stay untouched.
--
-- exercise_attributes: one row per (exercise, scope, field). The scope is '' for the system library (platform curation and the
--   inferred seed of 0045) or the id of the organization whose professionals adjusted it. A field has a provenance:
--   REVIEWED  a person confirmed the value (professional for the organization scope, platform manager for the system scope);
--   INFERRED  a deterministic name-based rule produced it (rule_id + rules_version), shown as "Inferido (não revisado)";
--   PENDING   it needs curation: the value is not used for selection.
--   Values are canonical JSON validated in code (src/modules/biblioteca/metadata/fields.ts), so new codes need no rebuild.
--   Precedence for an organization: its own REVIEWED, its own PENDING, system REVIEWED, its own INFERRED, system PENDING,
--   system INFERRED (src/modules/biblioteca/metadata/status.ts and src/db/exercise-metadata.ts).
--   Rows are never deleted. Inference never overwrites what a person decided (REVIEWED, or PENDING set by a person).
-- exercise_relations: curated alternatives (substitutions) between two exercises, per scope; removal is a timestamp, never a delete.
-- exercise_attribute_events: append-only trail of every change to the two tables above (who, what, which rule).
--
-- Scope rules (triggers): the system scope only holds system exercises; an organization scope only holds exercises that
-- organization can see (system or its own) and the organization must exist; both ends of a relation must be visible to its scope.
-- Nothing here identifies a student or carries health data.

CREATE TABLE exercise_attributes (
  id TEXT PRIMARY KEY NOT NULL,
  exercise_id TEXT NOT NULL REFERENCES exercises(id),
  scope_organization_id TEXT NOT NULL CHECK (length(scope_organization_id) <= 64),
  field TEXT NOT NULL CHECK (field IN ('modality', 'metric', 'primary_muscles', 'secondary_muscles', 'movement_patterns',
    'equipment', 'equipment_alternatives', 'difficulty', 'laterality', 'compound', 'seconds_per_rep', 'caution_tags')),
  value_json TEXT CHECK (value_json IS NULL OR (json_valid(value_json) AND length(value_json) <= 2000)),
  status TEXT NOT NULL CHECK (status IN ('REVIEWED', 'INFERRED', 'PENDING')),
  source TEXT NOT NULL CHECK (source IN ('PROFESSIONAL', 'PLATFORM', 'INFERENCE')),
  rule_id TEXT CHECK (rule_id IS NULL OR length(rule_id) BETWEEN 1 AND 60),
  rules_version TEXT CHECK (rules_version IS NULL OR length(rules_version) BETWEEN 1 AND 40),
  reviewed_by_user_id TEXT REFERENCES users(id),
  reviewed_at TEXT,
  updated_by_user_id TEXT REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  last_write_id TEXT NOT NULL CHECK (length(last_write_id) BETWEEN 1 AND 64),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (exercise_id, scope_organization_id, field),
  CHECK (status <> 'REVIEWED' OR (value_json IS NOT NULL AND reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL
    AND source IN ('PROFESSIONAL', 'PLATFORM') AND rule_id IS NULL)),
  CHECK (status <> 'INFERRED' OR (value_json IS NOT NULL AND source = 'INFERENCE' AND rule_id IS NOT NULL
    AND rules_version IS NOT NULL AND reviewed_by_user_id IS NULL)),
  CHECK (status <> 'PENDING' OR reviewed_by_user_id IS NULL),
  CHECK (source <> 'PLATFORM' OR scope_organization_id = ''),
  CHECK (source <> 'PROFESSIONAL' OR scope_organization_id <> '')
);
CREATE INDEX exercise_attributes_scope_idx ON exercise_attributes(scope_organization_id, status, exercise_id);

CREATE TABLE exercise_relations (
  id TEXT PRIMARY KEY NOT NULL,
  from_exercise_id TEXT NOT NULL REFERENCES exercises(id),
  to_exercise_id TEXT NOT NULL REFERENCES exercises(id),
  scope_organization_id TEXT NOT NULL CHECK (length(scope_organization_id) <= 64),
  -- ALTERNATIVE today; validated in code so a new kind needs no rebuild.
  kind TEXT NOT NULL CHECK (length(kind) BETWEEN 1 AND 30),
  status TEXT NOT NULL CHECK (status IN ('REVIEWED', 'INFERRED', 'PENDING')),
  source TEXT NOT NULL CHECK (source IN ('PROFESSIONAL', 'PLATFORM', 'INFERENCE')),
  rule_id TEXT CHECK (rule_id IS NULL OR length(rule_id) BETWEEN 1 AND 60),
  rules_version TEXT CHECK (rules_version IS NULL OR length(rules_version) BETWEEN 1 AND 40),
  created_by_user_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  removed_at TEXT,
  removed_by_user_id TEXT REFERENCES users(id),
  last_write_id TEXT NOT NULL CHECK (length(last_write_id) BETWEEN 1 AND 64),
  CHECK (from_exercise_id <> to_exercise_id),
  CHECK (status <> 'REVIEWED' OR (created_by_user_id IS NOT NULL AND source IN ('PROFESSIONAL', 'PLATFORM'))),
  CHECK (status <> 'INFERRED' OR (source = 'INFERENCE' AND rule_id IS NOT NULL AND rules_version IS NOT NULL)),
  CHECK (source <> 'PLATFORM' OR scope_organization_id = ''),
  CHECK (source <> 'PROFESSIONAL' OR scope_organization_id <> '')
);
CREATE UNIQUE INDEX exercise_relations_active ON exercise_relations(from_exercise_id, to_exercise_id, scope_organization_id, kind)
  WHERE removed_at IS NULL;
CREATE INDEX exercise_relations_scope_idx ON exercise_relations(scope_organization_id, from_exercise_id);

CREATE TABLE exercise_attribute_events (
  id TEXT PRIMARY KEY NOT NULL,
  scope_organization_id TEXT NOT NULL CHECK (length(scope_organization_id) <= 64),
  exercise_id TEXT NOT NULL REFERENCES exercises(id),
  -- A metadata field, or 'alternatives' for a relation.
  field TEXT NOT NULL CHECK (length(field) BETWEEN 1 AND 40),
  action TEXT NOT NULL CHECK (action IN ('SET', 'REVIEWED', 'PENDING', 'INFERRED', 'RELATION_ADDED', 'RELATION_REMOVED')),
  status TEXT CHECK (status IS NULL OR status IN ('REVIEWED', 'INFERRED', 'PENDING')),
  value_json TEXT CHECK (value_json IS NULL OR (json_valid(value_json) AND length(value_json) <= 2000)),
  rule_id TEXT CHECK (rule_id IS NULL OR length(rule_id) BETWEEN 1 AND 60),
  rules_version TEXT CHECK (rules_version IS NULL OR length(rules_version) BETWEEN 1 AND 40),
  actor_user_id TEXT REFERENCES users(id),
  write_id TEXT NOT NULL CHECK (length(write_id) BETWEEN 1 AND 64),
  created_at TEXT NOT NULL
);
CREATE INDEX exercise_attribute_events_exercise_idx ON exercise_attribute_events(scope_organization_id, exercise_id, created_at);

CREATE TRIGGER exercise_attributes_scope
BEFORE INSERT ON exercise_attributes
WHEN NOT EXISTS (
  SELECT 1 FROM exercises e
  WHERE e.id = NEW.exercise_id
    AND ((NEW.scope_organization_id = '' AND e.organization_id IS NULL)
      OR (NEW.scope_organization_id <> '' AND (e.organization_id IS NULL OR e.organization_id = NEW.scope_organization_id)
        AND EXISTS (SELECT 1 FROM organizations o WHERE o.id = NEW.scope_organization_id))))
BEGIN
  SELECT RAISE(ABORT, 'EXERCISE_ATTRIBUTE_SCOPE_INVALID');
END;

CREATE TRIGGER exercise_attributes_identity_frozen
BEFORE UPDATE ON exercise_attributes
WHEN NEW.id IS NOT OLD.id OR NEW.exercise_id IS NOT OLD.exercise_id
  OR NEW.scope_organization_id IS NOT OLD.scope_organization_id OR NEW.field IS NOT OLD.field
  OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'EXERCISE_ATTRIBUTE_IDENTITY_FROZEN');
END;

CREATE TRIGGER exercise_attributes_review_wins
BEFORE UPDATE ON exercise_attributes
WHEN NEW.source = 'INFERENCE' AND OLD.source <> 'INFERENCE'
BEGIN
  SELECT RAISE(ABORT, 'EXERCISE_ATTRIBUTE_REVIEW_WINS');
END;

CREATE TRIGGER exercise_attributes_version_forward
BEFORE UPDATE ON exercise_attributes
WHEN NEW.version IS NOT OLD.version + 1 OR NEW.last_write_id IS OLD.last_write_id
BEGIN
  SELECT RAISE(ABORT, 'EXERCISE_ATTRIBUTE_VERSION_INVALID');
END;

CREATE TRIGGER exercise_attributes_no_delete
BEFORE DELETE ON exercise_attributes
BEGIN
  SELECT RAISE(ABORT, 'EXERCISE_ATTRIBUTE_PERMANENT');
END;

CREATE TRIGGER exercise_relations_scope
BEFORE INSERT ON exercise_relations
WHEN (SELECT count(*) FROM exercises e
  WHERE e.id IN (NEW.from_exercise_id, NEW.to_exercise_id)
    AND ((NEW.scope_organization_id = '' AND e.organization_id IS NULL)
      OR (NEW.scope_organization_id <> '' AND (e.organization_id IS NULL OR e.organization_id = NEW.scope_organization_id)))) <> 2
  OR (NEW.scope_organization_id <> '' AND NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = NEW.scope_organization_id))
BEGIN
  SELECT RAISE(ABORT, 'EXERCISE_RELATION_SCOPE_INVALID');
END;

CREATE TRIGGER exercise_relations_frozen
BEFORE UPDATE ON exercise_relations
WHEN OLD.removed_at IS NOT NULL OR NEW.removed_at IS NULL
  OR NEW.id IS NOT OLD.id OR NEW.from_exercise_id IS NOT OLD.from_exercise_id OR NEW.to_exercise_id IS NOT OLD.to_exercise_id
  OR NEW.scope_organization_id IS NOT OLD.scope_organization_id OR NEW.kind IS NOT OLD.kind OR NEW.status IS NOT OLD.status
  OR NEW.source IS NOT OLD.source OR NEW.rule_id IS NOT OLD.rule_id OR NEW.rules_version IS NOT OLD.rules_version
  OR NEW.created_by_user_id IS NOT OLD.created_by_user_id OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'EXERCISE_RELATION_FROZEN');
END;

CREATE TRIGGER exercise_relations_no_delete
BEFORE DELETE ON exercise_relations
BEGIN
  SELECT RAISE(ABORT, 'EXERCISE_RELATION_PERMANENT');
END;

CREATE TRIGGER exercise_attribute_events_no_update
BEFORE UPDATE ON exercise_attribute_events
BEGIN
  SELECT RAISE(ABORT, 'EXERCISE_ATTRIBUTE_EVENT_APPEND_ONLY');
END;

CREATE TRIGGER exercise_attribute_events_no_delete
BEFORE DELETE ON exercise_attribute_events
BEGIN
  SELECT RAISE(ABORT, 'EXERCISE_ATTRIBUTE_EVENT_APPEND_ONLY');
END;

INSERT INTO app_schema_versions(version) VALUES ('0044_exercise_metadata');
