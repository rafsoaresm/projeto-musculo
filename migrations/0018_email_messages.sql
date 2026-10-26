-- Additive migration: the record of e-mail the tool sends. 0001..0017 stay untouched.
--
-- The only e-mail so far is the link to set a new password. This table does two things: it limits
-- how many e-mails one address can be sent in an hour (so the form cannot be used to flood someone),
-- and it tells the operator whether the sending works (SENT, FAILED, or THROTTLED for the ones that
-- were held back). It never keeps the link, the token or the text of a message: those are secrets and
-- would be a way into an account. The one exception is the local capture transport used by the
-- browser tests on 127.0.0.1, which keeps the text so a test can open the link; the table refuses
-- a text for any other provider.
--
-- The address is kept as the person typed it in lower case, because it is what the limit counts.
-- Rows can be deleted by a future retention routine: this is an operating record, not an audit trail.
CREATE TABLE email_messages (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('PASSWORD_RESET')),
  recipient TEXT NOT NULL CHECK (length(recipient) BETWEEN 3 AND 254 AND recipient = lower(recipient)),
  status TEXT NOT NULL CHECK (status IN ('SENT', 'FAILED', 'THROTTLED')),
  provider TEXT NOT NULL CHECK (provider IN ('ses', 'capture')),
  provider_message_id TEXT CHECK (provider_message_id IS NULL OR length(provider_message_id) <= 200),
  error_code TEXT CHECK (error_code IS NULL OR length(error_code) <= 120),
  captured_text TEXT CHECK (captured_text IS NULL OR (provider = 'capture' AND length(captured_text) <= 4000)),
  created_at TEXT NOT NULL
);
CREATE INDEX email_messages_recipient_idx ON email_messages(recipient, kind, created_at);
CREATE INDEX email_messages_created_idx ON email_messages(kind, created_at);

INSERT INTO app_schema_versions(version) VALUES ('0018_email_messages');
