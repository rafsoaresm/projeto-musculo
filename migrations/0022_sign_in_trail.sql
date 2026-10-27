-- Additive migration: a line in the trail for every sign-in, and an index to read a person's own lines.
-- 0001..0021 stay untouched.
--
-- A sign-in is a session being created (after the code of the second step, when it is on). The database
-- writes the line itself, so no path of the code can open a session without leaving one. The line says who
-- and when: no address, no browser, no password. People read their own lines in "Minha conta"; the
-- manager's audit page lists a fixed set of actions and does not include this one. A session made
-- before the person has a profile in the tool (the sign-up itself) leaves no line.
CREATE TRIGGER auth_session_sign_in_audit
AFTER INSERT ON auth_session
WHEN EXISTS (SELECT 1 FROM users u WHERE u.id = NEW.user_id)
BEGIN
  INSERT INTO access_audit_events (id, organization_id, actor_user_id, action, subject_id, created_at)
  VALUES (
    lower(hex(randomblob(16))),
    NULL,
    NEW.user_id,
    'SIGN_IN',
    NEW.user_id,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  );
END;

CREATE INDEX access_audit_events_actor_idx ON access_audit_events(actor_user_id, action, created_at);

INSERT INTO app_schema_versions(version) VALUES ('0022_sign_in_trail');
