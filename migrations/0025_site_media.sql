-- Additive migration: the images of the public page. 0001..0024 stay untouched.
--
-- site_assets:         one row per image the professional sent. The bytes are in the private object storage
--                      (SITE_MEDIA); this table is the index and says what the file is. The row never changes.
-- site_release_assets: which images a release uses, written in the same batch that makes the release. The public
--                      route serves an image only if it is in the release the pointer names, so an image that was
--                      only uploaded, only in a draft, or in a page taken offline is never reachable without a login.
--
-- An image that a release uses cannot be deleted (the release is immutable, and so is what it shows). An image that
-- no release uses can be.

CREATE TABLE site_assets (
  id TEXT PRIMARY KEY NOT NULL,
  site_id TEXT NOT NULL REFERENCES sites(id),
  object_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png')),
  bytes INTEGER NOT NULL CHECK (bytes BETWEEN 1 AND 5242880),
  width INTEGER NOT NULL CHECK (width BETWEEN 1 AND 8192),
  height INTEGER NOT NULL CHECK (height BETWEEN 1 AND 8192),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (site_id, id)
);
CREATE INDEX site_assets_site_idx ON site_assets(site_id, created_at);

CREATE TRIGGER site_assets_immutable_update
BEFORE UPDATE ON site_assets
BEGIN
  SELECT RAISE(ABORT, 'an image does not change');
END;

-- At most 60 images per site, whoever writes.
CREATE TRIGGER site_assets_limit
BEFORE INSERT ON site_assets
WHEN (SELECT COUNT(*) FROM site_assets a WHERE a.site_id = NEW.site_id) >= 60
BEGIN
  SELECT RAISE(ABORT, 'a site has at most 60 images');
END;

-- An image used by a release is not deleted: the release is immutable and shows it.
CREATE TRIGGER site_assets_kept_when_published
BEFORE DELETE ON site_assets
WHEN EXISTS (SELECT 1 FROM site_release_assets ra WHERE ra.asset_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'an image used by a published version is not deleted');
END;

CREATE TABLE site_release_assets (
  release_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  PRIMARY KEY (release_id, asset_id),
  -- Both belong to the same site: a release cannot use the image of another site.
  FOREIGN KEY (site_id, release_id) REFERENCES site_releases(site_id, id),
  FOREIGN KEY (site_id, asset_id) REFERENCES site_assets(site_id, id)
);
CREATE INDEX site_release_assets_asset_idx ON site_release_assets(asset_id);

CREATE TRIGGER site_release_assets_immutable_update
BEFORE UPDATE ON site_release_assets
BEGIN
  SELECT RAISE(ABORT, 'what a release uses does not change');
END;

CREATE TRIGGER site_release_assets_immutable_delete
BEFORE DELETE ON site_release_assets
BEGIN
  SELECT RAISE(ABORT, 'what a release uses is not deleted');
END;

INSERT INTO app_schema_versions(version) VALUES ('0025_site_media');
