-- Motor V4, sub-stage 1.2c: the platform side of the AI planner (design V4 §3.7). Additive: no existing table is altered.
-- Platform scope (no organization_id) except `ai_organization_settings`; every access goes through the gestor repository (adminGuard on each
-- statement) or the single reader of key ciphertext. Provider keys are stored ENCRYPTED (AES-GCM, server secret `AI_SECRETS_KEY`);
-- the column is write-only for the app: no SELECT list of the gestor repository names it.

CREATE TABLE ai_platform_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  kill_switch INTEGER NOT NULL DEFAULT 0 CHECK (kill_switch IN (0,1)),
  kill_switch_by_user_id TEXT REFERENCES users(id),
  kill_switch_at TEXT,
  updated_at TEXT NOT NULL
);
INSERT INTO ai_platform_settings (id, kill_switch, updated_at) VALUES (1, 0, strftime('%Y-%m-%dT%H:%M:%fZ','now'));

CREATE TABLE ai_provider_connections (
  kind TEXT PRIMARY KEY NOT NULL CHECK (kind IN ('openai','anthropic','google')),
  key_ciphertext TEXT NOT NULL CHECK (length(key_ciphertext) BETWEEN 40 AND 4096),
  key_key_id TEXT NOT NULL CHECK (length(key_key_id) BETWEEN 1 AND 20),
  key_last4 TEXT NOT NULL CHECK (length(key_last4) BETWEEN 1 AND 4),
  connected_at TEXT NOT NULL,
  connected_by_user_id TEXT NOT NULL REFERENCES users(id),
  rotated_at TEXT,
  rotated_by_user_id TEXT REFERENCES users(id),
  last_test_at TEXT,
  last_test_ok INTEGER CHECK (last_test_ok IS NULL OR last_test_ok IN (0,1)),
  last_test_code TEXT CHECK (last_test_code IS NULL OR length(last_test_code) <= 40),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1)
);

CREATE TABLE ai_task_settings (
  task TEXT PRIMARY KEY NOT NULL CHECK (task IN ('PLANNER','ADJUSTMENTS')),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
  provider_kind TEXT CHECK (provider_kind IS NULL OR provider_kind IN ('openai','anthropic','google','mock')),
  model_id TEXT CHECK (model_id IS NULL OR (length(model_id) BETWEEN 1 AND 80 AND model_id NOT GLOB '*[^A-Za-z0-9._:-]*')),
  max_input_tokens INTEGER NOT NULL DEFAULT 12000 CHECK (max_input_tokens BETWEEN 500 AND 200000),
  max_output_tokens INTEGER NOT NULL DEFAULT 6144 CHECK (max_output_tokens BETWEEN 100 AND 32000),
  timeout_ms INTEGER NOT NULL DEFAULT 25000 CHECK (timeout_ms BETWEEN 2000 AND 120000),
  max_retries INTEGER NOT NULL DEFAULT 1 CHECK (max_retries IN (0,1)),
  currency TEXT CHECK (currency IS NULL OR currency IN ('BRL','USD','EUR')),
  price_input_micros_per_million INTEGER CHECK (price_input_micros_per_million IS NULL OR price_input_micros_per_million >= 0),
  price_output_micros_per_million INTEGER CHECK (price_output_micros_per_million IS NULL OR price_output_micros_per_million >= 0),
  send_system_exercise_names INTEGER NOT NULL DEFAULT 0 CHECK (send_system_exercise_names IN (0,1)),
  updated_at TEXT NOT NULL,
  updated_by_user_id TEXT REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 1,
  CHECK ((price_input_micros_per_million IS NULL) = (price_output_micros_per_million IS NULL)),
  CHECK (price_input_micros_per_million IS NULL OR currency IS NOT NULL),
  CHECK (enabled = 0 OR (provider_kind IS NOT NULL AND model_id IS NOT NULL))
);
INSERT INTO ai_task_settings (task, updated_at) VALUES
  ('PLANNER', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('ADJUSTMENTS', strftime('%Y-%m-%dT%H:%M:%fZ','now'));

CREATE TABLE ai_quota_plans (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 60),
  name_key TEXT NOT NULL UNIQUE,
  allowance_mode TEXT NOT NULL CHECK (allowance_mode IN ('TOTAL','SPLIT')),
  monthly_total_tokens INTEGER CHECK (monthly_total_tokens IS NULL OR monthly_total_tokens >= 0),
  monthly_input_tokens INTEGER CHECK (monthly_input_tokens IS NULL OR monthly_input_tokens >= 0),
  monthly_output_tokens INTEGER CHECK (monthly_output_tokens IS NULL OR monthly_output_tokens >= 0),
  per_request_cap_planning INTEGER NOT NULL DEFAULT 0 CHECK (per_request_cap_planning >= 0),
  per_request_cap_adjustment INTEGER NOT NULL DEFAULT 0 CHECK (per_request_cap_adjustment >= 0),
  monthly_cost_cap_micros INTEGER CHECK (monthly_cost_cap_micros IS NULL OR monthly_cost_cap_micros >= 0),
  requests_per_minute INTEGER NOT NULL DEFAULT 6 CHECK (requests_per_minute BETWEEN 1 AND 120),
  cost_cap_currency TEXT CHECK (cost_cap_currency IS NULL OR cost_cap_currency IN ('BRL','USD','EUR')),
  archived_at TEXT,
  created_at TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL,
  updated_by_user_id TEXT NOT NULL REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 1,
  CHECK ((allowance_mode = 'TOTAL' AND monthly_total_tokens IS NOT NULL AND monthly_input_tokens IS NULL AND monthly_output_tokens IS NULL)
      OR (allowance_mode = 'SPLIT' AND monthly_total_tokens IS NULL AND monthly_input_tokens IS NOT NULL AND monthly_output_tokens IS NOT NULL)),
  CHECK (monthly_cost_cap_micros IS NULL OR cost_cap_currency IS NOT NULL)
);

CREATE TABLE ai_organization_settings (
  organization_id TEXT PRIMARY KEY NOT NULL REFERENCES organizations(id),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
  quota_plan_id TEXT REFERENCES ai_quota_plans(id),
  enabled_at TEXT,
  enabled_by_user_id TEXT REFERENCES users(id),
  ack_version TEXT CHECK (ack_version IS NULL OR length(ack_version) <= 20),
  plan_assigned_at TEXT,
  plan_assigned_by_user_id TEXT REFERENCES users(id),
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  CHECK (enabled = 0 OR (enabled_by_user_id IS NOT NULL AND ack_version IS NOT NULL AND enabled_at IS NOT NULL))
);

CREATE TABLE ai_circuit_state (
  provider_kind TEXT NOT NULL,
  model_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'CLOSED' CHECK (state IN ('CLOSED','OPEN','HALF_OPEN')),
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  first_failure_at TEXT,
  opened_at TEXT,
  probe_started_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (provider_kind, model_id)
);

INSERT INTO app_schema_versions(version) VALUES ('0046_ai_platform');
