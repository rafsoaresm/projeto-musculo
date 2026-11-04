-- Additive migration: automatic prescription proposals (motor v2, design §3.3). 0001..0041 stay untouched.
--
-- A proposal is the engine's workspace on one DRAFT revision: the professional navigates it, regenerates a scope, substitutes, locks,
-- records a decision about a flag, rebases or discards it, and finally applies it to the draft. Nothing here edits a prescription:
-- every manual edit happens after apply, in the existing editor, on the DRAFT revision. Nothing here approves or delivers anything.
--
-- prescription_proposals: the proposal under review. version + last_write_id make every change a compare-and-set; base_content_version
--   is the revision's content_version it was generated on (it only moves forward, by rebase). At most one OPEN proposal per revision.
--   States move only OPEN -> APPLIED | DISCARDED | SUPERSEDED (markReady supersedes); a closed proposal never changes; none is deleted.
-- prescription_generations: append-only ledger of every engine run (versions, hashes, scope, request hash). Holds ids, codes and
--   hashes only, never health free text.
-- prescription_generation_inputs: the full canonical engine input of a run, for replay. It contains student facts, so it is deletable
--   with the student's data (decided 04/11/2026, PENDENCIAS R14 Q9); once deleted, the generation keeps its hashes but cannot be replayed.
-- proposal_occurrences / proposal_items: the engine output, one row per session occurrence and per exercise in it. Writable only while
--   the proposal is OPEN. origin SUBSTITUTED is the engine's own output for a substitution (substitutes_slot_key keeps the original).
-- proposal_decisions: append-only trail of what the professional did on the proposal.
-- prescription_applications: append-only, one per proposal, idempotent per (revision, key).

CREATE TABLE prescription_proposals (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN', 'APPLIED', 'DISCARDED', 'SUPERSEDED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  last_write_id TEXT NOT NULL CHECK (length(last_write_id) BETWEEN 16 AND 64),
  base_content_version INTEGER NOT NULL CHECK (base_content_version >= 0),
  engine_version TEXT NOT NULL CHECK (length(engine_version) BETWEEN 1 AND 20),
  rules_id TEXT NOT NULL CHECK (length(rules_id) BETWEEN 1 AND 60),
  rules_version TEXT NOT NULL CHECK (length(rules_version) BETWEEN 1 AND 40),
  parameters_json TEXT NOT NULL CHECK (json_valid(parameters_json) AND length(parameters_json) <= 100000),
  status TEXT NOT NULL CHECK (status IN ('SUCCEEDED', 'INFEASIBLE')),
  validation TEXT NOT NULL CHECK (validation IN ('PASSED', 'WARNINGS', 'BLOCKED')),
  complete INTEGER NOT NULL DEFAULT 0 CHECK (complete IN (0, 1)),
  phases_generated TEXT NOT NULL CHECK (json_valid(phases_generated) AND length(phases_generated) <= 2000),
  summary_json TEXT NOT NULL CHECK (json_valid(summary_json) AND length(summary_json) <= 500000),
  output_hash TEXT NOT NULL CHECK (length(output_hash) = 64),
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  closed_at TEXT,
  closed_by_user_id TEXT REFERENCES users(id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, revision_id) REFERENCES plan_revisions(organization_id, id)
);
CREATE UNIQUE INDEX prescription_proposals_one_open ON prescription_proposals(revision_id) WHERE state = 'OPEN';
CREATE INDEX prescription_proposals_revision_idx ON prescription_proposals(organization_id, revision_id, created_at);

CREATE TABLE prescription_generations (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 16 AND 64),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  scope TEXT NOT NULL CHECK (scope IN ('FULL', 'CONTINUE', 'ITEM', 'OCCURRENCE', 'WEEK', 'WORKOUT', 'PHASE',
    'FROM_PHASE', 'SUBSTITUTE', 'REBASE')),
  scope_json TEXT NOT NULL CHECK (json_valid(scope_json) AND length(scope_json) <= 2000),
  base_content_version INTEGER NOT NULL CHECK (base_content_version >= 0),
  base_proposal_version INTEGER CHECK (base_proposal_version IS NULL OR base_proposal_version >= 1),
  engine_version TEXT NOT NULL CHECK (length(engine_version) BETWEEN 1 AND 20),
  rules_id TEXT NOT NULL CHECK (length(rules_id) BETWEEN 1 AND 60),
  rules_version TEXT NOT NULL CHECK (length(rules_version) BETWEEN 1 AND 40),
  vocabulary_version TEXT NOT NULL CHECK (length(vocabulary_version) BETWEEN 1 AND 40),
  catalog_hash TEXT NOT NULL CHECK (length(catalog_hash) = 64),
  input_hash TEXT NOT NULL CHECK (length(input_hash) = 64),
  output_hash TEXT NOT NULL CHECK (length(output_hash) = 64),
  facts_json TEXT NOT NULL CHECK (json_valid(facts_json) AND length(facts_json) <= 20000),
  status TEXT NOT NULL CHECK (status IN ('SUCCEEDED', 'INFEASIBLE')),
  validation TEXT NOT NULL CHECK (validation IN ('PASSED', 'WARNINGS', 'BLOCKED')),
  issue_codes_json TEXT NOT NULL CHECK (json_valid(issue_codes_json) AND length(issue_codes_json) <= 20000),
  requested_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, revision_id, idempotency_key),
  FOREIGN KEY (organization_id, proposal_id) REFERENCES prescription_proposals(organization_id, id)
);
CREATE INDEX prescription_generations_proposal_idx ON prescription_generations(proposal_id, created_at);

CREATE TABLE prescription_generation_inputs (
  generation_id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  input_json TEXT NOT NULL CHECK (json_valid(input_json) AND length(input_json) <= 900000),
  created_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, generation_id) REFERENCES prescription_generations(organization_id, id)
);
CREATE INDEX prescription_generation_inputs_student_idx ON prescription_generation_inputs(organization_id, student_id);
-- Deletable (data of the student), never rewritten.
CREATE TRIGGER prescription_generation_inputs_no_update
BEFORE UPDATE ON prescription_generation_inputs
BEGIN
  SELECT RAISE(ABORT, 'GENERATION_APPEND_ONLY');
END;

-- Durations in minutes as the engine computes them (may be fractional); NULL is "not computable", never 0.
CREATE TABLE proposal_occurrences (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  phase_index INTEGER NOT NULL CHECK (phase_index >= 1),
  week_index INTEGER NOT NULL CHECK (week_index >= 1),
  slot_index INTEGER NOT NULL CHECK (slot_index >= 1),
  workout_label TEXT NOT NULL CHECK (length(workout_label) BETWEEN 1 AND 20),
  week_start TEXT NOT NULL CHECK (week_start GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  planned_date TEXT CHECK (planned_date IS NULL OR planned_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  stimulus TEXT CHECK (stimulus IS NULL OR length(stimulus) <= 40),
  stimulus_json TEXT CHECK (stimulus_json IS NULL OR (json_valid(stimulus_json) AND length(stimulus_json) <= 1000)),
  estimated_minutes REAL CHECK (estimated_minutes IS NULL OR estimated_minutes >= 0),
  duration_complete INTEGER NOT NULL DEFAULT 0 CHECK (duration_complete IN (0, 1)),
  budget_minutes REAL CHECK (budget_minutes IS NULL OR budget_minutes >= 0),
  budget_source TEXT CHECK (budget_source IS NULL OR budget_source IN ('WORKOUT', 'PARAMETERS', 'PROFILE')),
  generation_id TEXT NOT NULL,
  UNIQUE (organization_id, id),
  UNIQUE (proposal_id, phase_index, week_index, slot_index),
  FOREIGN KEY (organization_id, proposal_id) REFERENCES prescription_proposals(organization_id, id)
);

CREATE TABLE proposal_items (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  proposal_occurrence_id TEXT NOT NULL,
  slot_key TEXT NOT NULL CHECK (length(slot_key) BETWEEN 1 AND 300),
  substitutes_slot_key TEXT CHECK (substitutes_slot_key IS NULL OR length(substitutes_slot_key) <= 300),
  position INTEGER NOT NULL CHECK (position >= 0),
  exercise_id TEXT REFERENCES exercises(id),
  exercise_name TEXT NOT NULL CHECK (length(trim(exercise_name)) BETWEEN 1 AND 120),
  modality TEXT CHECK (modality IS NULL OR length(modality) <= 40),
  metric TEXT CHECK (metric IS NULL OR metric IN ('REPS', 'TIME', 'DISTANCE', 'INTERVALS', 'CONTINUOUS')),
  dose_json TEXT CHECK (dose_json IS NULL OR (json_valid(dose_json) AND length(dose_json) <= 4000)),
  dose_text TEXT CHECK (dose_text IS NULL OR length(dose_text) <= 300),
  sets TEXT CHECK (sets IS NULL OR length(sets) <= 20),
  reps TEXT CHECK (reps IS NULL OR length(reps) <= 40),
  load_instruction TEXT CHECK (load_instruction IS NULL OR length(load_instruction) <= 120),
  cadence TEXT CHECK (cadence IS NULL OR length(cadence) <= 40),
  rest_seconds INTEGER CHECK (rest_seconds IS NULL OR rest_seconds BETWEEN 0 AND 3600),
  rest_text TEXT CHECK (rest_text IS NULL OR length(rest_text) <= 40),
  rir_min INTEGER CHECK (rir_min IS NULL OR rir_min BETWEEN 0 AND 10),
  rir_max INTEGER CHECK (rir_max IS NULL OR rir_max BETWEEN 0 AND 10),
  trace_json TEXT NOT NULL CHECK (json_valid(trace_json) AND length(trace_json) <= 8000),
  alternatives_json TEXT NOT NULL CHECK (json_valid(alternatives_json) AND length(alternatives_json) <= 4000),
  metadata_trust TEXT NOT NULL CHECK (metadata_trust IN ('REVIEWED', 'INCLUDES_INFERRED', 'PENDING', 'NOT_APPLICABLE')),
  origin TEXT NOT NULL CHECK (origin IN ('ENGINE', 'PRESERVED', 'LOCKED', 'SUBSTITUTED')),
  existing_prescribed_exercise_id TEXT,
  generation_id TEXT NOT NULL,
  CHECK (rir_min IS NULL OR rir_max IS NULL OR rir_min <= rir_max),
  CHECK ((origin = 'PRESERVED') = (existing_prescribed_exercise_id IS NOT NULL)),
  UNIQUE (organization_id, id),
  UNIQUE (proposal_occurrence_id, slot_key),
  FOREIGN KEY (organization_id, proposal_occurrence_id) REFERENCES proposal_occurrences(organization_id, id)
);
CREATE INDEX proposal_items_slot_idx ON proposal_items(proposal_id, slot_key);

CREATE TABLE proposal_decisions (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL CHECK (action IN ('GENERATED', 'CONTINUED', 'REGENERATE_ITEM', 'REGENERATE_OCCURRENCE',
    'REGENERATE_WEEK', 'REGENERATE_WORKOUT', 'REGENERATE_PHASE', 'REGENERATE_FROM_PHASE', 'SUBSTITUTE', 'LOCK',
    'UNLOCK', 'ACCEPT_FLAG_DECISION', 'REBASE', 'DISCARD', 'APPLY', 'SUPERSEDED', 'AI_SUGGESTION_RECORDED')),
  write_id TEXT NOT NULL CHECK (length(write_id) BETWEEN 16 AND 64),
  target_json TEXT NOT NULL CHECK (json_valid(target_json) AND length(target_json) <= 2000),
  change_json TEXT CHECK (change_json IS NULL OR (json_valid(change_json) AND length(change_json) <= 20000)),
  reason TEXT CHECK (reason IS NULL OR length(reason) <= 500),
  generation_id TEXT,
  proposal_version_after INTEGER NOT NULL CHECK (proposal_version_after >= 1),
  created_at TEXT NOT NULL,
  UNIQUE (proposal_id, write_id),
  FOREIGN KEY (organization_id, proposal_id) REFERENCES prescription_proposals(organization_id, id)
);
CREATE INDEX proposal_decisions_proposal_idx ON proposal_decisions(proposal_id, created_at);

CREATE TABLE prescription_applications (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  proposal_id TEXT NOT NULL UNIQUE,
  proposal_version INTEGER NOT NULL CHECK (proposal_version >= 1),
  base_content_version INTEGER NOT NULL CHECK (base_content_version >= 0),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 16 AND 64),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  conflict_mode TEXT NOT NULL CHECK (conflict_mode IN ('PRESERVE', 'REPLACE_CONFIRMED')),
  infeasible_confirmed INTEGER NOT NULL DEFAULT 0 CHECK (infeasible_confirmed IN (0, 1)),
  replaced_json TEXT CHECK (replaced_json IS NULL OR (json_valid(replaced_json) AND length(replaced_json) <= 500000)),
  applied_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE (organization_id, id),
  UNIQUE (revision_id, idempotency_key),
  FOREIGN KEY (organization_id, revision_id) REFERENCES plan_revisions(organization_id, id),
  FOREIGN KEY (organization_id, proposal_id) REFERENCES prescription_proposals(organization_id, id)
);

-- Relational checks the composite foreign keys cannot express: same plan, same revision, revision still a DRAFT.
CREATE TRIGGER prescription_proposals_plan_matches
BEFORE INSERT ON prescription_proposals
WHEN NOT EXISTS (SELECT 1 FROM plan_revisions r WHERE r.organization_id = NEW.organization_id
  AND r.id = NEW.revision_id AND r.plan_id = NEW.plan_id AND r.state = 'DRAFT')
BEGIN
  SELECT RAISE(ABORT, 'PLAN_REVISION_FROZEN');
END;
CREATE TRIGGER prescription_generations_matches
BEFORE INSERT ON prescription_generations
WHEN NOT EXISTS (SELECT 1 FROM prescription_proposals p WHERE p.id = NEW.proposal_id
  AND p.organization_id = NEW.organization_id AND p.revision_id = NEW.revision_id AND p.plan_id = NEW.plan_id)
BEGIN
  SELECT RAISE(ABORT, 'PROPOSAL_ITEM_INVALID');
END;
CREATE TRIGGER prescription_applications_matches
BEFORE INSERT ON prescription_applications
WHEN NOT EXISTS (SELECT 1 FROM prescription_proposals p JOIN plan_revisions r
    ON r.organization_id = p.organization_id AND r.id = p.revision_id
  WHERE p.id = NEW.proposal_id AND p.organization_id = NEW.organization_id AND p.revision_id = NEW.revision_id
    AND p.plan_id = NEW.plan_id AND r.state = 'DRAFT')
BEGIN
  SELECT RAISE(ABORT, 'PLAN_REVISION_FROZEN');
END;

CREATE TRIGGER prescription_proposals_state_forward
BEFORE UPDATE OF state ON prescription_proposals
WHEN NEW.state <> OLD.state AND NOT (OLD.state = 'OPEN' AND NEW.state IN ('APPLIED', 'DISCARDED', 'SUPERSEDED'))
BEGIN
  SELECT RAISE(ABORT, 'PROPOSAL_STATE_INVALID');
END;
CREATE TRIGGER prescription_proposals_closed_frozen
BEFORE UPDATE ON prescription_proposals
WHEN OLD.state <> 'OPEN'
BEGIN
  SELECT RAISE(ABORT, 'PROPOSAL_CLOSED');
END;
CREATE TRIGGER prescription_proposals_identity_frozen
BEFORE UPDATE OF id, organization_id, plan_id, revision_id, created_by_user_id, created_at ON prescription_proposals
WHEN NEW.id IS NOT OLD.id OR NEW.organization_id IS NOT OLD.organization_id OR NEW.plan_id IS NOT OLD.plan_id
  OR NEW.revision_id IS NOT OLD.revision_id OR NEW.created_by_user_id IS NOT OLD.created_by_user_id
  OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'PROPOSAL_IDENTITY_FROZEN');
END;
-- base_content_version moves forward only (rebase); version moves one step per write.
CREATE TRIGGER prescription_proposals_base_forward
BEFORE UPDATE OF base_content_version ON prescription_proposals
WHEN NEW.base_content_version < OLD.base_content_version
BEGIN
  SELECT RAISE(ABORT, 'PROPOSAL_VERSION_INVALID');
END;
CREATE TRIGGER prescription_proposals_version_forward
BEFORE UPDATE OF version ON prescription_proposals
WHEN NEW.version <> OLD.version + 1
BEGIN
  SELECT RAISE(ABORT, 'PROPOSAL_VERSION_INVALID');
END;
CREATE TRIGGER prescription_proposals_no_delete
BEFORE DELETE ON prescription_proposals
BEGIN
  SELECT RAISE(ABORT, 'PROPOSAL_APPEND_ONLY');
END;

CREATE TRIGGER proposal_items_open_insert
BEFORE INSERT ON proposal_items
WHEN (SELECT state FROM prescription_proposals WHERE id = NEW.proposal_id) IS NOT 'OPEN'
BEGIN
  SELECT RAISE(ABORT, 'PROPOSAL_CLOSED');
END;
CREATE TRIGGER proposal_items_open_update
BEFORE UPDATE ON proposal_items
WHEN (SELECT state FROM prescription_proposals WHERE id = OLD.proposal_id) IS NOT 'OPEN'
  OR NEW.id IS NOT OLD.id OR NEW.proposal_id IS NOT OLD.proposal_id OR NEW.organization_id IS NOT OLD.organization_id
  OR NEW.proposal_occurrence_id IS NOT OLD.proposal_occurrence_id
BEGIN
  SELECT RAISE(ABORT, 'PROPOSAL_CLOSED');
END;
CREATE TRIGGER proposal_items_open_delete
BEFORE DELETE ON proposal_items
WHEN (SELECT state FROM prescription_proposals WHERE id = OLD.proposal_id) IS NOT 'OPEN'
BEGIN
  SELECT RAISE(ABORT, 'PROPOSAL_CLOSED');
END;
CREATE TRIGGER proposal_items_same_proposal
BEFORE INSERT ON proposal_items
WHEN NOT EXISTS (SELECT 1 FROM proposal_occurrences o WHERE o.id = NEW.proposal_occurrence_id
  AND o.proposal_id = NEW.proposal_id AND o.organization_id = NEW.organization_id)
BEGIN
  SELECT RAISE(ABORT, 'PROPOSAL_ITEM_INVALID');
END;
CREATE TRIGGER proposal_occurrences_open_insert
BEFORE INSERT ON proposal_occurrences
WHEN (SELECT state FROM prescription_proposals WHERE id = NEW.proposal_id) IS NOT 'OPEN'
BEGIN
  SELECT RAISE(ABORT, 'PROPOSAL_CLOSED');
END;
CREATE TRIGGER proposal_occurrences_open_update
BEFORE UPDATE ON proposal_occurrences
WHEN (SELECT state FROM prescription_proposals WHERE id = OLD.proposal_id) IS NOT 'OPEN'
  OR NEW.id IS NOT OLD.id OR NEW.proposal_id IS NOT OLD.proposal_id OR NEW.organization_id IS NOT OLD.organization_id
  OR NEW.phase_index IS NOT OLD.phase_index OR NEW.week_index IS NOT OLD.week_index
  OR NEW.slot_index IS NOT OLD.slot_index OR NEW.workout_label IS NOT OLD.workout_label
BEGIN
  SELECT RAISE(ABORT, 'PROPOSAL_CLOSED');
END;
CREATE TRIGGER proposal_occurrences_open_delete
BEFORE DELETE ON proposal_occurrences
WHEN (SELECT state FROM prescription_proposals WHERE id = OLD.proposal_id) IS NOT 'OPEN'
  OR EXISTS (SELECT 1 FROM proposal_items i WHERE i.proposal_occurrence_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'PROPOSAL_CLOSED');
END;

CREATE TRIGGER prescription_generations_no_update
BEFORE UPDATE ON prescription_generations
BEGIN
  SELECT RAISE(ABORT, 'GENERATION_APPEND_ONLY');
END;
CREATE TRIGGER prescription_generations_no_delete
BEFORE DELETE ON prescription_generations
BEGIN
  SELECT RAISE(ABORT, 'GENERATION_APPEND_ONLY');
END;
CREATE TRIGGER proposal_decisions_no_update
BEFORE UPDATE ON proposal_decisions
BEGIN
  SELECT RAISE(ABORT, 'DECISION_APPEND_ONLY');
END;
CREATE TRIGGER proposal_decisions_no_delete
BEFORE DELETE ON proposal_decisions
BEGIN
  SELECT RAISE(ABORT, 'DECISION_APPEND_ONLY');
END;
CREATE TRIGGER prescription_applications_no_update
BEFORE UPDATE ON prescription_applications
BEGIN
  SELECT RAISE(ABORT, 'APPLICATION_APPEND_ONLY');
END;
CREATE TRIGGER prescription_applications_no_delete
BEFORE DELETE ON prescription_applications
BEGIN
  SELECT RAISE(ABORT, 'APPLICATION_APPEND_ONLY');
END;

INSERT INTO app_schema_versions(version) VALUES ('0042_prescription_proposals');
