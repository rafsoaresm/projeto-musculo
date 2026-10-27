-- Additive migration: a draft of the terms, kept on the server. 0001..0019 stay untouched.
--
-- Until now the manager's edit lived only in the open page: closing it lost the work, and two managers
-- could not hand a text over. A draft is the words being written for one audience: at most one per
-- audience, shared by all active managers. It is NOT a published version: it changes nobody's
-- acceptance and nothing reads it but the editor. It may be incomplete (fields can be empty); the
-- rules for publishing (validated in code) apply when it is published, which also removes it.
--
-- `revision` is the optimistic lock: each save must carry the revision the editor loaded and raises it
-- by exactly one, so a manager never overwrites what another saved in between without knowing.
-- `base_sha256` is the hash of the text in force when the draft was started, to say when that text has
-- changed since. Only an active platform manager writes; the audience, the base and the sequence of
-- revisions are guarded here, not only in code.
CREATE TABLE terms_drafts (
  audience TEXT PRIMARY KEY NOT NULL CHECK (audience IN ('PROFESSIONAL', 'STUDENT')),
  content_json TEXT NOT NULL CHECK (json_valid(content_json) AND length(content_json) <= 60000),
  base_sha256 TEXT NOT NULL CHECK (length(base_sha256) = 64 AND base_sha256 NOT GLOB '*[^0-9a-f]*'),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  updated_by_user_id TEXT NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL
);

CREATE TRIGGER terms_drafts_admin_insert
BEFORE INSERT ON terms_drafts
WHEN NOT EXISTS (
  SELECT 1 FROM platform_admins pa JOIN users u ON u.id = pa.user_id
  WHERE pa.user_id = NEW.updated_by_user_id AND pa.revoked_at IS NULL AND u.disabled_at IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'TERMS_ADMIN_REQUIRED');
END;

CREATE TRIGGER terms_drafts_first_revision
BEFORE INSERT ON terms_drafts
WHEN NEW.revision <> 1
BEGIN
  SELECT RAISE(ABORT, 'TERMS_DRAFT_RULES');
END;

CREATE TRIGGER terms_drafts_admin_update
BEFORE UPDATE ON terms_drafts
WHEN NOT EXISTS (
  SELECT 1 FROM platform_admins pa JOIN users u ON u.id = pa.user_id
  WHERE pa.user_id = NEW.updated_by_user_id AND pa.revoked_at IS NULL AND u.disabled_at IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'TERMS_ADMIN_REQUIRED');
END;

CREATE TRIGGER terms_drafts_update_rules
BEFORE UPDATE ON terms_drafts
WHEN NEW.audience <> OLD.audience OR NEW.base_sha256 <> OLD.base_sha256 OR NEW.revision <> OLD.revision + 1
BEGIN
  SELECT RAISE(ABORT, 'TERMS_DRAFT_RULES');
END;

INSERT INTO app_schema_versions(version) VALUES ('0020_terms_drafts');
