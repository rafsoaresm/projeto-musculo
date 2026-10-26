-- Additive migration: more than one platform manager, by single-use invitation. 0001..0018 stay untouched.
--
-- Until now there was exactly one way to become a manager: the setup token of the environment, which
-- works only while there is no active manager. So there was one manager, and if that person were lost
-- the platform had no one to operate it. A manager can now invite another: the link is shown once to
-- who issued it, only its SHA-256 is kept, and it makes whoever redeems it a manager. The role is
-- born from the link, never from an e-mail address (e-mail is not verified, so typing one would hand
-- the role to whoever registered it first).
--
-- An invitation is changed once, when it is accepted or cancelled, and never afterwards; it is never
-- deleted. It dies when it expires and when the manager who issued it is no longer a manager.
CREATE TABLE platform_admin_invites (
  id TEXT PRIMARY KEY NOT NULL,
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  -- A reminder for the issuer of who the link is for. It is shown to managers only.
  label TEXT CHECK (label IS NULL OR length(label) BETWEEN 1 AND 80),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  accepted_by_user_id TEXT REFERENCES users(id),
  revoked_at TEXT,
  revoked_by_user_id TEXT REFERENCES users(id),
  CHECK (expires_at > created_at),
  CHECK ((accepted_at IS NULL) = (accepted_by_user_id IS NULL)),
  CHECK ((revoked_at IS NULL) = (revoked_by_user_id IS NULL)),
  CHECK (accepted_at IS NULL OR revoked_at IS NULL)
);
CREATE INDEX platform_admin_invites_created_idx ON platform_admin_invites(created_at);

-- Only an active manager issues an invitation.
CREATE TRIGGER platform_admin_invites_manager_only
BEFORE INSERT ON platform_admin_invites
WHEN NOT EXISTS (
  SELECT 1 FROM platform_admins pa JOIN users u ON u.id = pa.user_id
  WHERE pa.user_id = NEW.created_by_user_id AND pa.revoked_at IS NULL AND u.disabled_at IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'PLATFORM_INVITE_MANAGER_REQUIRED');
END;

-- What an invitation is never changes, and neither does one that already ended.
CREATE TRIGGER platform_admin_invites_frozen
BEFORE UPDATE ON platform_admin_invites
WHEN OLD.accepted_at IS NOT NULL OR OLD.revoked_at IS NOT NULL
  OR NEW.id <> OLD.id OR NEW.token_hash <> OLD.token_hash OR NEW.created_by_user_id <> OLD.created_by_user_id
  OR NEW.created_at <> OLD.created_at OR NEW.expires_at <> OLD.expires_at OR NEW.label IS NOT OLD.label
BEGIN
  SELECT RAISE(ABORT, 'PLATFORM_INVITE_FROZEN');
END;

-- It is accepted only while it is open: not expired, and issued by someone who is still a manager.
CREATE TRIGGER platform_admin_invites_open_to_accept
BEFORE UPDATE OF accepted_at ON platform_admin_invites
WHEN NEW.accepted_at IS NOT NULL AND (
  NEW.accepted_at > OLD.expires_at
  OR NOT EXISTS (
    SELECT 1 FROM platform_admins pa JOIN users u ON u.id = pa.user_id
    WHERE pa.user_id = OLD.created_by_user_id AND pa.revoked_at IS NULL AND u.disabled_at IS NULL
  )
)
BEGIN
  SELECT RAISE(ABORT, 'PLATFORM_INVITE_NOT_OPEN');
END;

-- Only a manager cancels one.
CREATE TRIGGER platform_admin_invites_revoke_by_manager
BEFORE UPDATE OF revoked_at ON platform_admin_invites
WHEN NEW.revoked_at IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM platform_admins pa JOIN users u ON u.id = pa.user_id
  WHERE pa.user_id = NEW.revoked_by_user_id AND pa.revoked_at IS NULL AND u.disabled_at IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'PLATFORM_INVITE_MANAGER_REQUIRED');
END;

CREATE TRIGGER platform_admin_invites_no_delete
BEFORE DELETE ON platform_admin_invites
BEGIN
  SELECT RAISE(ABORT, 'PLATFORM_INVITE_APPEND_ONLY');
END;

INSERT INTO app_schema_versions(version) VALUES ('0019_platform_admin_invites');
