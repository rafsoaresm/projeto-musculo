-- Additive migration: platform manager, one-use student invitations and access audit.
-- 0001 and 0002 stay untouched. Same conventions: server-generated IDs, UTC ISO-8601 text.
-- A platform manager has NO membership and therefore NO technical access to students.
CREATE TABLE platform_admins (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  revoked_at TEXT
);

-- Only the SHA-256 of the token is stored. The raw token is shown once to the professional.
CREATE TABLE student_invites (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  accepted_by_user_id TEXT REFERENCES users(id),
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (organization_id, student_id) REFERENCES students(organization_id, id)
);
CREATE INDEX student_invites_student_idx ON student_invites(organization_id, student_id, created_at);

-- Actions are validated in code, not by CHECK, so new events do not need a table rebuild.
CREATE TABLE access_audit_events (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT REFERENCES organizations(id),
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 64),
  subject_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX access_audit_events_created_idx ON access_audit_events(created_at);
CREATE INDEX access_audit_events_organization_idx ON access_audit_events(organization_id, created_at);

INSERT INTO app_schema_versions(version) VALUES ('0003_roles_and_access');
