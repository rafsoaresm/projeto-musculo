-- Additive migration: the files of the new site editor, and which editor makes the public page of a site. 0001..0027 stay untouched.
--
-- builder_files: the images a person sends from the editor (Frappe Builder embedded in Meu Site). The bytes are in the private object
--   storage (SITE_MEDIA, under the organization's own key); this table is the index and says what the file is. Unlike the images of the
--   first editor (site_assets), which are public only while a published version uses them, a file sent from the new editor is public
--   by its address as soon as it exists, as the files of the editor it comes from are: the address is a random identifier that is
--   written in nothing but the editor and the pages of the site. A file can be removed; one that a page still shows then breaks there.
--
-- site_deletions: the owner or a manager can delete the whole site (address, drafts, versions, images, everything of the new editor). The
--   versions of the first editor are immutable and their images are kept while a version uses them, so the triggers that say so stand aside
--   for exactly one case: the site is being deleted, which the statements of that deletion announce by a row here, in the same batch,
--   removed before the batch ends (a batch is all or nothing). Nothing else writes to this table.
--
-- sites.engine: which editor made the page at /s/<address>. 'native' is the first editor (its release pointer decides what is shown);
--   'frappe' is the new one, and then /s/<address> sends visitors to /site/<address>, where its published pages are. Every site is
--   'native' until its owner chooses the other, which is never done by itself and can be undone: nothing of the first editor is deleted.

ALTER TABLE sites ADD COLUMN engine TEXT NOT NULL DEFAULT 'native' CHECK (engine IN ('native', 'frappe'));

CREATE TABLE builder_files (
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  id TEXT NOT NULL CHECK (length(id) = 36),
  object_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL CHECK (length(file_name) BETWEEN 1 AND 200),
  content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png')),
  bytes INTEGER NOT NULL CHECK (bytes BETWEEN 1 AND 10485760),
  width INTEGER NOT NULL CHECK (width BETWEEN 1 AND 16384),
  height INTEGER NOT NULL CHECK (height BETWEEN 1 AND 16384),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (organization_id, id)
) WITHOUT ROWID;
CREATE INDEX builder_files_recent_idx ON builder_files(organization_id, created_at);

CREATE TRIGGER builder_files_immutable_update
BEFORE UPDATE ON builder_files
BEGIN
  SELECT RAISE(ABORT, 'a file does not change');
END;

-- At most 300 files per organization, whoever writes.
CREATE TRIGGER builder_files_limit
BEFORE INSERT ON builder_files
WHEN (SELECT COUNT(*) FROM builder_files f WHERE f.organization_id = NEW.organization_id) >= 300
BEGIN
  SELECT RAISE(ABORT, 'an organization has at most 300 files');
END;

CREATE TABLE site_deletions (
  site_id TEXT PRIMARY KEY NOT NULL
);

DROP TRIGGER site_releases_immutable_delete;
CREATE TRIGGER site_releases_immutable_delete
BEFORE DELETE ON site_releases
WHEN NOT EXISTS (SELECT 1 FROM site_deletions d WHERE d.site_id = OLD.site_id)
BEGIN
  SELECT RAISE(ABORT, 'a release is not deleted');
END;

DROP TRIGGER site_release_assets_immutable_delete;
CREATE TRIGGER site_release_assets_immutable_delete
BEFORE DELETE ON site_release_assets
WHEN NOT EXISTS (SELECT 1 FROM site_deletions d WHERE d.site_id = OLD.site_id)
BEGIN
  SELECT RAISE(ABORT, 'what a release uses is not deleted');
END;

DROP TRIGGER site_assets_kept_when_published;
CREATE TRIGGER site_assets_kept_when_published
BEFORE DELETE ON site_assets
WHEN EXISTS (SELECT 1 FROM site_release_assets ra WHERE ra.asset_id = OLD.id)
  AND NOT EXISTS (SELECT 1 FROM site_deletions d WHERE d.site_id = OLD.site_id)
BEGIN
  SELECT RAISE(ABORT, 'an image used by a published version is not deleted');
END;

INSERT INTO app_schema_versions(version) VALUES ('0028_builder_files_engine');
