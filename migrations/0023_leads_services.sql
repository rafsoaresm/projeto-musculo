-- Additive migration: the commercial side of the tool. 0001..0022 stay untouched.
--
-- service_offerings: what the professional sells (a name, a description, how it is delivered). No price
--   yet: nothing here charges anyone, and money would need its own decision (see PENDENCIAS, R4).
-- leads: a person interested in a service who is NOT a student. It holds a name, a way to reach them, where
--   they came from and what they asked about. No health data. One lead belongs to one organization and
--   points to a service of the same organization, and to a student of the same organization once converted.
-- lead_events: the timeline of a lead. Only added to, never edited.
--
-- Actions are validated here, not only in code: a lost lead has a reason and only a lost lead does; a lead has
-- some way to reach it; a converted lead was won first and is frozen afterwards (it keeps its attribution);
-- a converted lead is never deleted. Who may do what (owner, manager, commercial) is decided in the
-- statements of the repository, as for the other modules.

CREATE TABLE service_offerings (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 160),
  description TEXT CHECK (description IS NULL OR length(description) <= 1000),
  delivery TEXT NOT NULL CHECK (delivery IN ('IN_PERSON','ONLINE','HYBRID')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (organization_id, id)
);
CREATE UNIQUE INDEX service_offerings_name_idx ON service_offerings(organization_id, lower(trim(name)));

CREATE TABLE leads (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 160),
  email TEXT CHECK (email IS NULL OR length(email) BETWEEN 3 AND 254),
  phone TEXT CHECK (phone IS NULL OR length(phone) BETWEEN 6 AND 30),
  -- The same address or number typed two ways has the same key: how duplicates are found.
  email_key TEXT CHECK (email_key IS NULL OR length(email_key) BETWEEN 3 AND 254),
  phone_key TEXT CHECK (phone_key IS NULL OR length(phone_key) BETWEEN 8 AND 15),
  source TEXT NOT NULL CHECK (source IN ('INSTAGRAM','WHATSAPP','INDICACAO','PRESENCIAL','SITE','OUTRO')),
  service_id TEXT,
  stage TEXT NOT NULL DEFAULT 'NEW' CHECK (stage IN ('NEW','CONTACT','ASSESSMENT','PROPOSAL','WON','LOST')),
  lost_reason TEXT CHECK (lost_reason IS NULL OR lost_reason IN ('PRICE','NO_RESPONSE','CHOSE_OTHER','NOT_NOW','OTHER')),
  student_id TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (organization_id, id),
  CHECK (email IS NOT NULL OR phone IS NOT NULL),
  CHECK ((email IS NULL) = (email_key IS NULL)),
  CHECK ((phone IS NULL) = (phone_key IS NULL)),
  CHECK ((stage = 'LOST') = (lost_reason IS NOT NULL)),
  FOREIGN KEY (organization_id, service_id) REFERENCES service_offerings(organization_id, id),
  FOREIGN KEY (organization_id, student_id) REFERENCES students(organization_id, id)
);
CREATE INDEX leads_stage_idx ON leads(organization_id, stage, updated_at);
CREATE INDEX leads_email_key_idx ON leads(organization_id, email_key);
CREATE INDEX leads_phone_key_idx ON leads(organization_id, phone_key);
CREATE UNIQUE INDEX leads_student_idx ON leads(organization_id, student_id) WHERE student_id IS NOT NULL;

-- A lead is born unconverted; it is converted by an update that finds it won.
CREATE TRIGGER leads_born_unconverted
BEFORE INSERT ON leads
WHEN NEW.student_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'a lead is converted after it exists');
END;

CREATE TRIGGER leads_convert_only_when_won
BEFORE UPDATE OF student_id ON leads
WHEN NEW.student_id IS NOT NULL AND NEW.stage <> 'WON'
BEGIN
  SELECT RAISE(ABORT, 'only a won lead is converted');
END;

-- Converted leads are frozen: they keep the attribution of the student they became.
CREATE TRIGGER leads_converted_frozen
BEFORE UPDATE ON leads
WHEN OLD.student_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'a converted lead does not change');
END;

CREATE TRIGGER leads_converted_not_deleted
BEFORE DELETE ON leads
WHEN OLD.student_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'a converted lead is not deleted');
END;

CREATE TABLE lead_events (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  lead_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('CREATED','STAGE','NOTE','EDITED','CONVERTED')),
  from_stage TEXT CHECK (from_stage IS NULL OR from_stage IN ('NEW','CONTACT','ASSESSMENT','PROPOSAL','WON','LOST')),
  to_stage TEXT CHECK (to_stage IS NULL OR to_stage IN ('NEW','CONTACT','ASSESSMENT','PROPOSAL','WON','LOST')),
  lost_reason TEXT CHECK (lost_reason IS NULL OR lost_reason IN ('PRICE','NO_RESPONSE','CHOSE_OTHER','NOT_NOW','OTHER')),
  note TEXT CHECK (note IS NULL OR length(note) BETWEEN 1 AND 1000),
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (organization_id, lead_id) REFERENCES leads(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX lead_events_lead_idx ON lead_events(organization_id, lead_id, created_at);

CREATE TRIGGER lead_events_not_edited
BEFORE UPDATE ON lead_events
BEGIN
  SELECT RAISE(ABORT, 'the timeline of a lead is only added to');
END;

-- The timeline goes away only with its lead (deleting a lead on request); never one line by itself.
CREATE TRIGGER lead_events_not_deleted_alone
BEFORE DELETE ON lead_events
WHEN EXISTS (SELECT 1 FROM leads l WHERE l.organization_id = OLD.organization_id AND l.id = OLD.lead_id)
BEGIN
  SELECT RAISE(ABORT, 'the timeline of a lead is only added to');
END;

INSERT INTO app_schema_versions(version) VALUES ('0023_leads_services');
