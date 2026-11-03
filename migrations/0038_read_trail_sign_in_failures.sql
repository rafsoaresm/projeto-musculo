-- Additive migration: failed sign-ins and the reads of a student's data by professionals (PENDENCIAS B9; ROADMAP 0.88).
-- 0001..0037 stay untouched; nothing existing is changed or deleted. Nothing here is ever deleted: retention (J3, J9, B12) is not decided.
--
-- sign_in_failures: one row per sign-in that failed at the password or at the code of the second step. It says who (the person when the
--   address belongs to someone with a profile in the tool; otherwise only an HMAC of the address, keyed with the server's secret, so the
--   address itself is not stored), when and a coarse reason. No password, no code, no address of the network, no browser.
--   PASSWORD: the address or the password did not match (the screen never says which). SECOND_STEP_CODE: a wrong code of the
--   authenticator or a wrong recovery code. SECOND_STEP_LOCKED: a code tried while the second step was locked after many wrong ones.
--   The person reads their own rows in "Minha conta".
-- student_data_reads: one row each time a professional opens the data of a student: the record (ficha), an assessment, a plan revision,
--   the postural photos, the PDF of an assessment or of a plan. Who, which student, what kind and when; never the content. Opening the
--   same kind of the same student again within a short interval (decided in the app, src/db/student-reads.ts) does not add a row.

CREATE TABLE sign_in_failures (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT REFERENCES users(id),
  identifier_hash TEXT CHECK (identifier_hash IS NULL OR length(identifier_hash) = 64),
  reason TEXT NOT NULL CHECK (reason IN ('PASSWORD', 'SECOND_STEP_CODE', 'SECOND_STEP_LOCKED')),
  created_at TEXT NOT NULL,
  CHECK (user_id IS NOT NULL OR identifier_hash IS NOT NULL)
);
CREATE INDEX sign_in_failures_user_idx ON sign_in_failures(user_id, created_at);
CREATE INDEX sign_in_failures_identifier_idx ON sign_in_failures(identifier_hash, created_at);

CREATE TABLE student_data_reads (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('STUDENT_RECORD', 'ASSESSMENT', 'PLAN_REVISION', 'PHOTOS', 'ASSESSMENT_PDF', 'PLAN_PDF')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, student_id) REFERENCES students(organization_id, id)
);
CREATE INDEX student_data_reads_student_idx ON student_data_reads(organization_id, student_id, created_at);
CREATE INDEX student_data_reads_recent_idx ON student_data_reads(actor_user_id, student_id, kind, created_at);

INSERT INTO app_schema_versions(version) VALUES ('0038_read_trail_sign_in_failures');
