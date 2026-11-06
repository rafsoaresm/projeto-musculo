-- Motor V4, sub-stage 1.2c: organization/student scope of the AI planner (design V4 §3.7). Additive.
-- Usage ledger and month counters (reserve -> settle), tenant-segregated cache with TTL, append-only planning runs with idempotency
-- keys, the model's raw output (deletable with the student's data) and the professional's acceptances (append-only).
-- No prompt, no response text, no name or e-mail is ever stored in the ledger or the cache key: hashes and counts only.

CREATE TABLE ai_usage_month (
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  month TEXT NOT NULL CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  used_input INTEGER NOT NULL DEFAULT 0 CHECK (used_input >= 0),
  used_output INTEGER NOT NULL DEFAULT 0 CHECK (used_output >= 0),
  reserved_input INTEGER NOT NULL DEFAULT 0 CHECK (reserved_input >= 0),
  reserved_output INTEGER NOT NULL DEFAULT 0 CHECK (reserved_output >= 0),
  requests INTEGER NOT NULL DEFAULT 0,
  failed_requests INTEGER NOT NULL DEFAULT 0,
  cache_hits INTEGER NOT NULL DEFAULT 0,
  reserved_cost_micros INTEGER NOT NULL DEFAULT 0 CHECK (reserved_cost_micros >= 0),
  cost_micros INTEGER NOT NULL DEFAULT 0,
  cost_currency TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (organization_id, month)
);

CREATE TABLE ai_usage_ledger (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  month TEXT NOT NULL,
  task TEXT NOT NULL CHECK (task IN ('PLANNER','ADJUSTMENTS')),
  request_key TEXT NOT NULL CHECK (length(request_key) BETWEEN 16 AND 80),
  state TEXT NOT NULL CHECK (state IN ('RESERVED','SETTLED','RELEASED','CHARGED_UNKNOWN')),
  provider_kind TEXT,
  model_id TEXT,
  reserved_input INTEGER NOT NULL CHECK (reserved_input >= 0),
  reserved_output INTEGER NOT NULL CHECK (reserved_output >= 0),
  reserved_cost_micros INTEGER NOT NULL DEFAULT 0 CHECK (reserved_cost_micros >= 0),
  input_tokens INTEGER,
  output_tokens INTEGER,
  cached_input_tokens INTEGER,
  usage_source TEXT CHECK (usage_source IS NULL OR usage_source IN ('PROVIDER','ESTIMATE')),
  cost_micros INTEGER,
  currency TEXT,
  price_input_micros_per_million INTEGER,
  price_output_micros_per_million INTEGER,
  attempts INTEGER NOT NULL DEFAULT 1,
  latency_ms INTEGER,
  http_status INTEGER,
  error_code TEXT CHECK (error_code IS NULL OR length(error_code) <= 40),
  cache_hit INTEGER NOT NULL DEFAULT 0 CHECK (cache_hit IN (0,1)),
  requested_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  settled_at TEXT,
  UNIQUE (organization_id, request_key),
  FOREIGN KEY (organization_id, month) REFERENCES ai_usage_month(organization_id, month)
);
CREATE INDEX ai_usage_ledger_org_month_idx ON ai_usage_ledger(organization_id, month, created_at);
CREATE INDEX ai_usage_ledger_reserved_idx ON ai_usage_ledger(created_at) WHERE state = 'RESERVED';
CREATE TRIGGER ai_usage_ledger_settled_immutable BEFORE UPDATE ON ai_usage_ledger WHEN OLD.state <> 'RESERVED'
BEGIN SELECT RAISE(ABORT, 'AI_LEDGER_IMMUTABLE'); END;
CREATE TRIGGER ai_usage_ledger_no_delete BEFORE DELETE ON ai_usage_ledger
BEGIN SELECT RAISE(ABORT, 'AI_LEDGER_APPEND_ONLY'); END;

CREATE TABLE ai_planner_cache (
  organization_id TEXT NOT NULL,
  cache_key TEXT NOT NULL CHECK (length(cache_key) = 64),
  student_id TEXT NOT NULL,
  task TEXT NOT NULL,
  provider_kind TEXT NOT NULL,
  model_id TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  response_json TEXT NOT NULL CHECK (json_valid(response_json) AND length(response_json) <= 120000),
  response_hash TEXT NOT NULL CHECK (length(response_hash) = 64),
  input_tokens INTEGER,
  output_tokens INTEGER,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  last_hit_at TEXT,
  PRIMARY KEY (organization_id, cache_key),
  FOREIGN KEY (organization_id, student_id) REFERENCES students(organization_id, id)
);
CREATE INDEX ai_planner_cache_student_idx ON ai_planner_cache(organization_id, student_id);
CREATE INDEX ai_planner_cache_expiry_idx ON ai_planner_cache(expires_at);

CREATE TABLE planning_runs (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 16 AND 64),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  attempt INTEGER NOT NULL DEFAULT 1 CHECK (attempt >= 1),
  mode TEXT NOT NULL CHECK (mode IN ('AI','RULES')),
  status TEXT NOT NULL CHECK (status IN ('RUNNING','SUCCEEDED','FAILED')),
  failure_code TEXT CHECK (failure_code IS NULL OR length(failure_code) <= 40),
  base_content_version INTEGER NOT NULL CHECK (base_content_version >= 0),
  structure_fingerprint TEXT NOT NULL CHECK (length(structure_fingerprint) BETWEEN 16 AND 64),
  context_hash TEXT CHECK (context_hash IS NULL OR length(context_hash) = 64),
  aliases_hash TEXT CHECK (aliases_hash IS NULL OR length(aliases_hash) = 64),
  cache_key TEXT,
  cache_hit INTEGER NOT NULL DEFAULT 0 CHECK (cache_hit IN (0,1)),
  provider_kind TEXT,
  model_id TEXT,
  prompt_version TEXT,
  schema_version INTEGER,
  templates_version TEXT,
  response_hash TEXT,
  blueprint_hash TEXT,
  omitted_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(omitted_json) AND length(omitted_json) <= 4000),
  usage_json TEXT CHECK (usage_json IS NULL OR (json_valid(usage_json) AND length(usage_json) <= 2000)),
  ledger_id TEXT,
  requested_by_user_id TEXT NOT NULL REFERENCES users(id),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, revision_id, idempotency_key),
  FOREIGN KEY (organization_id, revision_id) REFERENCES plan_revisions(organization_id, id)
);
CREATE INDEX planning_runs_revision_idx ON planning_runs(organization_id, revision_id, started_at);
-- Single flight: two requests with the same context cannot both be calling the provider.
CREATE UNIQUE INDEX planning_runs_cache_flight ON planning_runs(organization_id, cache_key) WHERE status = 'RUNNING' AND cache_key IS NOT NULL;
CREATE TRIGGER planning_runs_transition BEFORE UPDATE ON planning_runs
WHEN NOT (OLD.status = 'RUNNING' AND NEW.status IN ('RUNNING','SUCCEEDED','FAILED')
          AND NEW.id = OLD.id AND NEW.organization_id = OLD.organization_id AND NEW.revision_id = OLD.revision_id
          AND NEW.idempotency_key = OLD.idempotency_key AND NEW.request_hash = OLD.request_hash AND NEW.mode = OLD.mode)
BEGIN SELECT RAISE(ABORT, 'PLANNING_RUN_IMMUTABLE'); END;
CREATE TRIGGER planning_runs_no_delete BEFORE DELETE ON planning_runs
BEGIN SELECT RAISE(ABORT, 'PLANNING_RUN_APPEND_ONLY'); END;

-- The model's raw (validated) output: deletable with the student's data, like prescription_generation_inputs.
CREATE TABLE planning_run_payloads (
  run_id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  blueprint_json TEXT NOT NULL CHECK (json_valid(blueprint_json) AND length(blueprint_json) <= 200000),
  created_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, run_id) REFERENCES planning_runs(organization_id, id)
);
CREATE INDEX planning_run_payloads_student_idx ON planning_run_payloads(organization_id, student_id);
CREATE TRIGGER planning_run_payloads_student BEFORE INSERT ON planning_run_payloads
WHEN NOT EXISTS (SELECT 1 FROM planning_runs r JOIN training_plans tp ON tp.organization_id = r.organization_id AND tp.id = r.plan_id
                 WHERE r.id = NEW.run_id AND r.organization_id = NEW.organization_id AND tp.student_id = NEW.student_id)
BEGIN SELECT RAISE(ABORT, 'PLANNING_PAYLOAD_STUDENT_INVALID'); END;
CREATE TRIGGER planning_run_payloads_no_update BEFORE UPDATE ON planning_run_payloads
BEGIN SELECT RAISE(ABORT, 'PLANNING_APPEND_ONLY'); END;

-- What the professional chose from a run (codes only: roles, deltas, candidate ids). Append-only; never erased with a student.
CREATE TABLE blueprint_acceptances (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 16 AND 64),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  strategy_id TEXT NOT NULL CHECK (strategy_id IN ('S1','S2','S3','CUSTOM')),
  split_family TEXT NOT NULL,
  final_json TEXT NOT NULL CHECK (json_valid(final_json) AND length(final_json) <= 120000),
  dosing_json TEXT NOT NULL DEFAULT '{"byClass":[],"progression":[]}' CHECK (json_valid(dosing_json) AND length(dosing_json) <= 4000),
  edits_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(edits_json) AND length(edits_json) <= 8000),
  acceptance_hash TEXT NOT NULL CHECK (length(acceptance_hash) = 64),
  structure_fingerprint TEXT NOT NULL,
  base_content_version INTEGER NOT NULL,
  accepted_by_user_id TEXT NOT NULL REFERENCES users(id),
  accepted_at TEXT NOT NULL,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, revision_id, idempotency_key),
  FOREIGN KEY (organization_id, run_id) REFERENCES planning_runs(organization_id, id)
);
CREATE INDEX blueprint_acceptances_revision_idx ON blueprint_acceptances(organization_id, revision_id, accepted_at);
CREATE TRIGGER blueprint_acceptances_append_only_u BEFORE UPDATE ON blueprint_acceptances
BEGIN SELECT RAISE(ABORT, 'ACCEPTANCE_APPEND_ONLY'); END;
CREATE TRIGGER blueprint_acceptances_append_only_d BEFORE DELETE ON blueprint_acceptances
BEGIN SELECT RAISE(ABORT, 'ACCEPTANCE_APPEND_ONLY'); END;

INSERT INTO app_schema_versions(version) VALUES ('0047_ai_planning');
