-- Motor V4, sub-stage 4.3b: assisted adjustments of a proposal (design V4 §6.7). Additive: no ALTER of 0041-0048 tables.
-- The request is STRUCTURED (the item, an operation, numbers, constraint codes): there is no free text anywhere, so `request_json` holds
-- codes and keys only. The ledger rows reuse `ai_usage_ledger` with task = 'ADJUSTMENTS' and a server-generated request key.
-- `adjustment_payloads` holds the suggestion with real ids and the before/after diff (exercise names for the professional's screen):
-- deletable with the student's data, like `planning_run_payloads`. The decisions (applied / rejected / expired) are append-only.

CREATE TABLE adjustment_requests (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  base_version INTEGER NOT NULL CHECK (base_version >= 1),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 16 AND 64),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  request_json TEXT NOT NULL CHECK (json_valid(request_json) AND length(request_json) <= 2000),
  mode TEXT NOT NULL CHECK (mode IN ('AI','STRUCTURED')),
  status TEXT NOT NULL CHECK (status IN ('RUNNING','SUCCEEDED','FAILED')),
  failure_code TEXT CHECK (failure_code IS NULL OR length(failure_code) <= 40),
  attempt INTEGER NOT NULL DEFAULT 1 CHECK (attempt >= 1),
  context_hash TEXT CHECK (context_hash IS NULL OR length(context_hash) = 64),
  cache_key TEXT,
  cache_hit INTEGER NOT NULL DEFAULT 0 CHECK (cache_hit IN (0,1)),
  provider_kind TEXT,
  model_id TEXT,
  prompt_version TEXT,
  response_hash TEXT,
  usage_json TEXT CHECK (usage_json IS NULL OR (json_valid(usage_json) AND length(usage_json) <= 2000)),
  ledger_id TEXT,
  requested_by_user_id TEXT NOT NULL REFERENCES users(id),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, proposal_id, idempotency_key),
  FOREIGN KEY (organization_id, proposal_id) REFERENCES prescription_proposals(organization_id, id),
  FOREIGN KEY (organization_id, revision_id) REFERENCES plan_revisions(organization_id, id)
);
CREATE INDEX adjustment_requests_proposal_idx ON adjustment_requests(organization_id, proposal_id, started_at);
-- Single flight: two requests with the same structured request and context cannot both be calling the provider.
CREATE UNIQUE INDEX adjustment_requests_cache_flight ON adjustment_requests(organization_id, cache_key) WHERE status = 'RUNNING' AND cache_key IS NOT NULL;
CREATE TRIGGER adjustment_requests_transition BEFORE UPDATE ON adjustment_requests
WHEN NOT (OLD.status = 'RUNNING' AND NEW.status IN ('RUNNING','SUCCEEDED','FAILED')
          AND NEW.id = OLD.id AND NEW.organization_id = OLD.organization_id AND NEW.proposal_id = OLD.proposal_id
          AND NEW.idempotency_key = OLD.idempotency_key AND NEW.request_hash = OLD.request_hash AND NEW.mode = OLD.mode
          AND NEW.base_version = OLD.base_version AND NEW.request_json = OLD.request_json)
BEGIN SELECT RAISE(ABORT, 'ADJUSTMENT_REQUEST_IMMUTABLE'); END;
CREATE TRIGGER adjustment_requests_no_delete BEFORE DELETE ON adjustment_requests
BEGIN SELECT RAISE(ABORT, 'ADJUSTMENT_REQUEST_APPEND_ONLY'); END;

CREATE TABLE adjustment_payloads (
  request_id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  suggestion_json TEXT NOT NULL CHECK (json_valid(suggestion_json) AND length(suggestion_json) <= 60000),
  created_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, request_id) REFERENCES adjustment_requests(organization_id, id)
);
CREATE INDEX adjustment_payloads_student_idx ON adjustment_payloads(organization_id, student_id);
CREATE TRIGGER adjustment_payloads_student BEFORE INSERT ON adjustment_payloads
WHEN NOT EXISTS (SELECT 1 FROM adjustment_requests r JOIN training_plans tp ON tp.organization_id = r.organization_id AND tp.id = r.plan_id
                 WHERE r.id = NEW.request_id AND r.organization_id = NEW.organization_id AND tp.student_id = NEW.student_id)
BEGIN SELECT RAISE(ABORT, 'ADJUSTMENT_PAYLOAD_STUDENT_INVALID'); END;
CREATE TRIGGER adjustment_payloads_no_update BEFORE UPDATE ON adjustment_payloads
BEGIN SELECT RAISE(ABORT, 'ADJUSTMENT_APPEND_ONLY'); END;

-- One decision per request (applied, rejected or expired), append-only: a second apply or reject of the same suggestion is refused here.
CREATE TABLE adjustment_decisions (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('APPLIED','REJECTED','EXPIRED')),
  generation_id TEXT,
  decided_by_user_id TEXT NOT NULL REFERENCES users(id),
  decided_at TEXT NOT NULL,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, request_id),
  FOREIGN KEY (organization_id, request_id) REFERENCES adjustment_requests(organization_id, id),
  FOREIGN KEY (organization_id, generation_id) REFERENCES prescription_generations(organization_id, id),
  CHECK ((decision = 'APPLIED') = (generation_id IS NOT NULL))
);
CREATE TRIGGER adjustment_decisions_append_only_u BEFORE UPDATE ON adjustment_decisions
BEGIN SELECT RAISE(ABORT, 'ADJUSTMENT_DECISION_APPEND_ONLY'); END;
CREATE TRIGGER adjustment_decisions_append_only_d BEFORE DELETE ON adjustment_decisions
BEGIN SELECT RAISE(ABORT, 'ADJUSTMENT_DECISION_APPEND_ONLY'); END;

INSERT INTO app_schema_versions(version) VALUES ('0049_ai_adjustments');
