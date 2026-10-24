-- Additive migration: saved periodization plans per student, with revisions.
-- 0001..0003 stay untouched. Same conventions: server-generated IDs, UTC ISO-8601 text.
-- Plans are technical records: only a professional with an active care assignment reads
-- or writes them (enforced by the repository on every query). Students and platform
-- managers never reach this table, and nothing here is visible in the client portal.

CREATE TABLE training_plans (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, student_id) REFERENCES students(organization_id, id)
);
CREATE INDEX training_plans_student_idx ON training_plans(organization_id, student_id, created_at);

-- One row per revision. The whole lifecycle is listed now so later approval and delivery
-- do not need a table rebuild; today only DRAFT and READY are reachable. READY means the
-- structure was validated. It is NOT approval and does not release anything to the student.
-- Content changes only while DRAFT: every UPDATE in the repository filters on that state.
CREATE TABLE plan_revisions (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  revision_number INTEGER NOT NULL CHECK (revision_number >= 1),
  state TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (state IN ('DRAFT','REVIEW_REQUIRED','READY','APPROVED','DELIVERED','ARCHIVED')),
  input_json TEXT NOT NULL CHECK (json_valid(input_json)),
  schedule_json TEXT NOT NULL CHECK (json_valid(schedule_json)),
  engine_version TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  total_weeks INTEGER NOT NULL CHECK (total_weeks > 0),
  total_sessions INTEGER NOT NULL CHECK (total_sessions > 0),
  based_on_revision_id TEXT,
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ready_at TEXT,
  UNIQUE (plan_id, revision_number),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, plan_id) REFERENCES training_plans(organization_id, id),
  FOREIGN KEY (organization_id, based_on_revision_id) REFERENCES plan_revisions(organization_id, id)
);
-- At most one open draft per plan, so two people cannot fork the same plan in parallel.
CREATE UNIQUE INDEX plan_revisions_one_draft ON plan_revisions(plan_id) WHERE state = 'DRAFT';

-- Trail of who did what. Actions are validated in code, never by CHECK, so new events
-- need no table rebuild. No plan content is stored here.
CREATE TABLE training_plan_events (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 64),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (organization_id, plan_id) REFERENCES training_plans(organization_id, id),
  FOREIGN KEY (organization_id, revision_id) REFERENCES plan_revisions(organization_id, id)
);
CREATE INDEX training_plan_events_plan_idx ON training_plan_events(organization_id, plan_id, created_at);

INSERT INTO app_schema_versions(version) VALUES ('0004_training_plans');
