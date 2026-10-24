-- Additive migration: the student's file ("ficha"), with the fields of the master document,
-- sections 6.1 to 6.4. 0001..0007 stay untouched.
--
-- One row per student, written only by a professional with an active technical care assignment.
-- It holds personal and health-related information reported by the student, so it is never read
-- by the client portal, a platform manager, or commercial and finance members. Which legal basis
-- and consent text apply to it is a decision of the product owners and is not recorded here.
-- Height and weight are the latest declared values with the date they refer to. Dated
-- measurements with history belong to the assessment records, which are separate.
-- Allowed values (gender, goal, level) are validated in code, so a new option needs no rebuild.
-- The numeric CHECKs are plausibility limits that catch typing mistakes, not clinical rules.
CREATE TABLE student_profiles (
  student_id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  birth_date TEXT CHECK (birth_date IS NULL OR birth_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  gender TEXT CHECK (gender IS NULL OR length(gender) BETWEEN 1 AND 40),
  email TEXT CHECK (email IS NULL OR length(email) BETWEEN 3 AND 254),
  phone TEXT CHECK (phone IS NULL OR length(phone) BETWEEN 6 AND 30),
  height_cm INTEGER CHECK (height_cm IS NULL OR height_cm BETWEEN 50 AND 260),
  weight_kg REAL CHECK (weight_kg IS NULL OR (weight_kg >= 10 AND weight_kg <= 500)),
  body_measured_on TEXT CHECK (body_measured_on IS NULL OR body_measured_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  goal TEXT CHECK (goal IS NULL OR length(goal) BETWEEN 1 AND 60),
  level TEXT CHECK (level IS NULL OR length(level) BETWEEN 1 AND 40),
  days_per_week INTEGER CHECK (days_per_week IS NULL OR days_per_week BETWEEN 1 AND 7),
  session_minutes INTEGER CHECK (session_minutes IS NULL OR session_minutes BETWEEN 10 AND 300),
  location TEXT CHECK (location IS NULL OR length(location) <= 120),
  equipment TEXT CHECK (equipment IS NULL OR length(equipment) <= 500),
  experience TEXT CHECK (experience IS NULL OR length(experience) <= 1000),
  injuries TEXT CHECK (injuries IS NULL OR length(injuries) <= 1000),
  surgeries TEXT CHECK (surgeries IS NULL OR length(surgeries) <= 1000),
  pains TEXT CHECK (pains IS NULL OR length(pains) <= 1000),
  limitations TEXT CHECK (limitations IS NULL OR length(limitations) <= 1000),
  medications_conditions TEXT CHECK (medications_conditions IS NULL OR length(medications_conditions) <= 1000),
  relevant_notes TEXT CHECK (relevant_notes IS NULL OR length(relevant_notes) <= 1000),
  preferred_exercises TEXT CHECK (preferred_exercises IS NULL OR length(preferred_exercises) <= 500),
  disliked_exercises TEXT CHECK (disliked_exercises IS NULL OR length(disliked_exercises) <= 500),
  excluded_exercises TEXT CHECK (excluded_exercises IS NULL OR length(excluded_exercises) <= 500),
  professional_notes TEXT CHECK (professional_notes IS NULL OR length(professional_notes) <= 1000),
  updated_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (organization_id, student_id) REFERENCES students(organization_id, id)
);

INSERT INTO app_schema_versions(version) VALUES ('0008_student_profiles');
