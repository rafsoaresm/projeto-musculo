-- Additive migration: the words of the terms, chosen by the platform manager. 0001..0015 stay untouched.
--
-- Until now the text lived only in the application. The text approved by the lawyer is still the
-- initial one (it is in the application and is in force while this table has no row for an audience);
-- from here on the platform manager can publish another, and it takes over for everyone.
--
-- A row is one published version of one audience's text: the words as JSON, the version name, the
-- SHA-256 of that exact text, who published it, when, and why. It never changes and is never deleted:
-- every acceptance in `consent_acceptances` points at a version and a hash, and the proof of what a
-- person accepted must stay readable after the wording changes. The version in force for an audience
-- is its latest row. Only an active platform manager can publish.
CREATE TABLE terms_versions (
  id TEXT PRIMARY KEY NOT NULL,
  audience TEXT NOT NULL CHECK (audience IN ('PROFESSIONAL', 'STUDENT')),
  version TEXT NOT NULL CHECK (length(version) BETWEEN 1 AND 60),
  content_json TEXT NOT NULL CHECK (json_valid(content_json) AND length(content_json) <= 60000),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  change_note TEXT CHECK (change_note IS NULL OR length(change_note) <= 500),
  published_by_user_id TEXT NOT NULL REFERENCES users(id),
  published_at TEXT NOT NULL,
  UNIQUE (audience, version),
  UNIQUE (audience, sha256)
);
CREATE INDEX terms_versions_latest_idx ON terms_versions(audience, published_at);

CREATE TRIGGER terms_versions_admin_only
BEFORE INSERT ON terms_versions
WHEN NOT EXISTS (
  SELECT 1 FROM platform_admins pa JOIN users u ON u.id = pa.user_id
  WHERE pa.user_id = NEW.published_by_user_id AND pa.revoked_at IS NULL AND u.disabled_at IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'TERMS_ADMIN_REQUIRED');
END;

CREATE TRIGGER terms_versions_append_only_update
BEFORE UPDATE ON terms_versions
BEGIN
  SELECT RAISE(ABORT, 'TERMS_APPEND_ONLY');
END;

CREATE TRIGGER terms_versions_append_only_delete
BEFORE DELETE ON terms_versions
BEGIN
  SELECT RAISE(ABORT, 'TERMS_APPEND_ONLY');
END;

INSERT INTO app_schema_versions(version) VALUES ('0016_terms_versions');
