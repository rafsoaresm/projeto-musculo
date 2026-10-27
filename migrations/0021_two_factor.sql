-- Additive migration: second step of the sign-in (an authenticator app), chosen by each person.
-- 0001..0020 stay untouched.
--
-- Better Auth keeps the state of the second step in two places: a flag on the account and one row of
-- secrets per account. Both are written by the library. The secret of the app and the recovery codes
-- are stored ENCRYPTED by it (with the platform secret), never in clear text; a row that is not
-- verified yet is a setup in progress and does not ask for anything at sign-in.
--
-- The change of the flag is written to the trail by the database itself, so no code path can turn the
-- second step on or off without leaving a line: who it was (the account), what happened and when,
-- never the secret. A reset made by a platform manager adds its own, separate, line saying who did it.
ALTER TABLE auth_user ADD COLUMN two_factor_enabled INTEGER NOT NULL DEFAULT 0 CHECK (two_factor_enabled IN (0, 1));

CREATE TABLE auth_two_factor (
  id TEXT PRIMARY KEY NOT NULL,
  secret TEXT NOT NULL,
  backup_codes TEXT NOT NULL,
  user_id TEXT NOT NULL UNIQUE REFERENCES auth_user(id) ON DELETE CASCADE,
  verified INTEGER NOT NULL DEFAULT 1 CHECK (verified IN (0, 1)),
  failed_verification_count INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER
);

CREATE TRIGGER auth_user_two_factor_audit
AFTER UPDATE OF two_factor_enabled ON auth_user
WHEN NEW.two_factor_enabled <> OLD.two_factor_enabled
  AND EXISTS (SELECT 1 FROM users u WHERE u.id = NEW.id)
BEGIN
  INSERT INTO access_audit_events (id, organization_id, actor_user_id, action, subject_id, created_at)
  VALUES (
    lower(hex(randomblob(16))),
    NULL,
    NEW.id,
    CASE WHEN NEW.two_factor_enabled = 1 THEN 'TWO_FACTOR_ENABLED' ELSE 'TWO_FACTOR_DISABLED' END,
    NEW.id,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  );
END;

INSERT INTO app_schema_versions(version) VALUES ('0021_two_factor');
