-- Additive migration: the contact form of the public page (Meu Site). 0001..0025 stay untouched.
--
-- sites.inquiries_open: the site's own switch for receiving messages. It is born closed (0) and the owner or the manager
--   turns it on. It is not enough by itself: the environment must also have opened the public forms (see PENDENCIAS, J8 and J12).
-- site_inquiries: what a visitor wrote in the form, waiting for the professional to turn it into a lead or discard it. It is
--   not a lead: it has no stage, no owner among the users and no history, because nobody of the organization has accepted it
--   yet. It holds a name, a way to reach the person, an optional message, the address of the privacy notice that was shown
--   when the box was ticked, and (for a short while) a hash of the sender's address used only to limit abuse. Turning it into
--   a lead or discarding it deletes the row; nothing here is kept after that.
--
-- What the visitor wrote never changes after it arrives, and an inquiry always belongs to the organization of its site.

ALTER TABLE sites ADD COLUMN inquiries_open INTEGER NOT NULL DEFAULT 0 CHECK (inquiries_open IN (0,1));

CREATE TABLE site_inquiries (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  site_id TEXT NOT NULL REFERENCES sites(id),
  -- The address of the page of the site the form was on; empty for the home page.
  page TEXT NOT NULL DEFAULT '' CHECK (length(page) <= 40),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 160),
  email TEXT CHECK (email IS NULL OR length(email) BETWEEN 3 AND 254),
  phone TEXT CHECK (phone IS NULL OR length(phone) BETWEEN 6 AND 30),
  -- The same keys as a lead, so a message from a person already in the list is noticed.
  email_key TEXT CHECK (email_key IS NULL OR length(email_key) BETWEEN 3 AND 254),
  phone_key TEXT CHECK (phone_key IS NULL OR length(phone_key) BETWEEN 8 AND 15),
  message TEXT CHECK (message IS NULL OR length(message) BETWEEN 1 AND 1000),
  -- The privacy notice that stood beside the box the visitor ticked: the record of what was agreed to.
  notice_url TEXT NOT NULL CHECK (length(notice_url) BETWEEN 8 AND 300),
  -- A keyed hash of the sender's address, kept only to count how often one sender writes; emptied soon after (never read for anything else).
  ip_key TEXT CHECK (ip_key IS NULL OR length(ip_key) = 32),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (organization_id, id),
  CHECK (email IS NOT NULL OR phone IS NOT NULL),
  CHECK ((email IS NULL) = (email_key IS NULL)),
  CHECK ((phone IS NULL) = (phone_key IS NULL))
);
CREATE INDEX site_inquiries_site_idx ON site_inquiries(site_id, created_at);
CREATE INDEX site_inquiries_organization_idx ON site_inquiries(organization_id, created_at);

CREATE TRIGGER site_inquiries_of_the_site_organization
BEFORE INSERT ON site_inquiries
WHEN NEW.organization_id <> (SELECT s.organization_id FROM sites s WHERE s.id = NEW.site_id)
BEGIN
  SELECT RAISE(ABORT, 'an inquiry belongs to the organization of its site');
END;

-- Only the hash of the address may be emptied; what the person wrote is never edited.
CREATE TRIGGER site_inquiries_not_edited
BEFORE UPDATE OF id, organization_id, site_id, page, name, email, phone, email_key, phone_key, message, notice_url, created_at ON site_inquiries
BEGIN
  SELECT RAISE(ABORT, 'what a visitor wrote does not change');
END;

INSERT INTO app_schema_versions(version) VALUES ('0026_site_inquiries');
