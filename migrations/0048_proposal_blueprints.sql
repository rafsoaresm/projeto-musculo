-- Motor V4, sub-stage 2.2: the accepted strategy a proposal generation used (design V4 §3.7, §4.7). Additive: no ALTER of 0041-0047 tables.
-- One row per (generation, acceptance): the proposal's `parameters_json` holds the compiled block (`answers.blueprint`); this table
-- ties each generation of the proposal to the acceptance(s) and planner run(s) that block came from, with the hashes that make it
-- reproducible: the compiled block's hash, the planner's blueprint hash and, for an AI run, the hash of the model's response (the
-- response itself stays in planning_run_payloads, deletable with the student's data). Codes, ids and hashes only: no prompt, no text.
-- Append-only, like the generations it points to; a proposal without a row (generated before this version, or with no strategy) reads as before.
CREATE TABLE proposal_blueprint_links (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  generation_id TEXT NOT NULL,
  acceptance_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  compiled_hash TEXT NOT NULL CHECK (length(compiled_hash) = 64),
  blueprint_hash TEXT CHECK (blueprint_hash IS NULL OR length(blueprint_hash) = 64),
  response_hash TEXT CHECK (response_hash IS NULL OR length(response_hash) = 64),
  rules_id TEXT NOT NULL CHECK (length(rules_id) BETWEEN 1 AND 60),
  rules_version TEXT NOT NULL CHECK (length(rules_version) BETWEEN 1 AND 40),
  created_at TEXT NOT NULL,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, generation_id, acceptance_id),
  FOREIGN KEY (organization_id, proposal_id) REFERENCES prescription_proposals(organization_id, id),
  FOREIGN KEY (organization_id, generation_id) REFERENCES prescription_generations(organization_id, id),
  FOREIGN KEY (organization_id, acceptance_id) REFERENCES blueprint_acceptances(organization_id, id),
  FOREIGN KEY (organization_id, run_id) REFERENCES planning_runs(organization_id, id)
);
CREATE INDEX proposal_blueprint_links_proposal_idx ON proposal_blueprint_links(organization_id, proposal_id, created_at);
-- Relational check the composite keys cannot express: the generation belongs to the proposal, and the acceptance (and its run) belongs
-- to the same revision as the proposal.
CREATE TRIGGER proposal_blueprint_links_matches
BEFORE INSERT ON proposal_blueprint_links
WHEN NOT EXISTS (
  SELECT 1 FROM prescription_generations g
  JOIN blueprint_acceptances a ON a.organization_id = g.organization_id AND a.revision_id = g.revision_id
  WHERE g.organization_id = NEW.organization_id AND g.id = NEW.generation_id AND g.proposal_id = NEW.proposal_id
    AND a.id = NEW.acceptance_id AND a.run_id = NEW.run_id)
BEGIN
  SELECT RAISE(ABORT, 'BLUEPRINT_LINK_INVALID');
END;
CREATE TRIGGER proposal_blueprint_links_append_only_u BEFORE UPDATE ON proposal_blueprint_links
BEGIN SELECT RAISE(ABORT, 'BLUEPRINT_LINK_APPEND_ONLY'); END;
CREATE TRIGGER proposal_blueprint_links_append_only_d BEFORE DELETE ON proposal_blueprint_links
BEGIN SELECT RAISE(ABORT, 'BLUEPRINT_LINK_APPEND_ONLY'); END;

INSERT INTO app_schema_versions(version) VALUES ('0048_proposal_blueprints');
