-- Additive migration: the acceptance of the terms, made once when a person joins the tool
-- (a professional when creating the workspace, a student when accepting the invitation).
-- 0001..0012 stay untouched.
--
-- A row says who accepted which version of which text, and when. The text itself lives in the
-- application and the row keeps its SHA-256, so what was accepted can always be proved even after
-- the wording changes. A student can also authorize, in the same act, photos of their posture: that
-- is a separate, optional choice inside the same acceptance, never a condition of it.
--
-- The table only grows. The current state of a person is their latest row: a new version of the
-- text, or a withdrawal of the photos authorization, is a new row, never a change of an old one.
-- The photos choice exists only for students.
CREATE TABLE consent_acceptances (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  audience TEXT NOT NULL CHECK (audience IN ('PROFESSIONAL', 'STUDENT')),
  terms_version TEXT NOT NULL CHECK (length(terms_version) BETWEEN 1 AND 60),
  terms_sha256 TEXT NOT NULL CHECK (length(terms_sha256) = 64 AND terms_sha256 NOT GLOB '*[^0-9a-f]*'),
  photos_authorized INTEGER NOT NULL DEFAULT 0 CHECK (photos_authorized IN (0, 1)),
  accepted_at TEXT NOT NULL,
  CHECK (audience = 'STUDENT' OR photos_authorized = 0)
);
CREATE INDEX consent_acceptances_user_idx ON consent_acceptances(user_id, audience, accepted_at);

CREATE TRIGGER consent_acceptances_append_only_update
BEFORE UPDATE ON consent_acceptances
BEGIN
  SELECT RAISE(ABORT, 'CONSENT_APPEND_ONLY');
END;

CREATE TRIGGER consent_acceptances_append_only_delete
BEFORE DELETE ON consent_acceptances
BEGIN
  SELECT RAISE(ABORT, 'CONSENT_APPEND_ONLY');
END;

INSERT INTO app_schema_versions(version) VALUES ('0013_consent');
