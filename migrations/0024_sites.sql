-- Additive migration: "Meu Site", the public page of a professional. 0001..0023 stay untouched.
--
-- sites:          one site per organization in this slice, with the address (slug) the page is served under.
-- site_drafts:    the working copy, one per site, with a revision that goes up by one per save (optimistic
--                 concurrency: a save says the revision it saw, and the statement refuses a different one).
-- site_releases:  what was published, immutable. A release is the document as it was at that moment (the
--                 services chosen are written into it), so what is public never changes by itself.
-- site_published: the pointer to the release that is public. Publishing writes a release and moves this
--                 pointer in the same batch; taking the page offline deletes the row. Nothing is public
--                 without a row here, and the pointer can only name a release of its own site.
--
-- Who may edit and publish (owner, manager) is decided in the statements of the repository, as for the
-- other modules. A published page holds no student data: the document has only text typed by the
-- professional and contact fields, never an HTML fragment or a free link.

CREATE TABLE sites (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL UNIQUE REFERENCES organizations(id),
  slug TEXT NOT NULL
    CHECK (length(slug) BETWEEN 3 AND 40 AND slug GLOB '[a-z0-9]*' AND slug NOT GLOB '*[^a-z0-9-]*'
           AND slug NOT GLOB '*-' AND slug NOT GLOB '*--*'),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX sites_slug_idx ON sites(slug);

CREATE TABLE site_drafts (
  site_id TEXT PRIMARY KEY NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  content TEXT NOT NULL CHECK (json_valid(content) AND length(content) <= 60000),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  updated_by TEXT NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- The revision of a draft goes up by one, never back and never skipping; the site of a draft never changes.
CREATE TRIGGER site_drafts_revision_steps
BEFORE UPDATE ON site_drafts
WHEN NEW.revision <> OLD.revision + 1 OR NEW.site_id <> OLD.site_id
BEGIN
  SELECT RAISE(ABORT, 'the revision of a draft goes up by one');
END;

CREATE TABLE site_releases (
  id TEXT PRIMARY KEY NOT NULL,
  site_id TEXT NOT NULL REFERENCES sites(id),
  number INTEGER NOT NULL CHECK (number >= 1),
  -- The revision of the draft this release was made from: tells whether the draft has changes not published.
  draft_revision INTEGER NOT NULL CHECK (draft_revision >= 1),
  content TEXT NOT NULL CHECK (json_valid(content) AND length(content) <= 60000),
  content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (site_id, number),
  UNIQUE (site_id, id)
);

-- The numbers of the releases of a site are 1, 2, 3... with no gap and no repetition.
CREATE TRIGGER site_releases_numbered
BEFORE INSERT ON site_releases
WHEN NEW.number <> (SELECT COALESCE(MAX(r.number), 0) + 1 FROM site_releases r WHERE r.site_id = NEW.site_id)
BEGIN
  SELECT RAISE(ABORT, 'releases are numbered in order');
END;

CREATE TRIGGER site_releases_immutable_update
BEFORE UPDATE ON site_releases
BEGIN
  SELECT RAISE(ABORT, 'a release does not change');
END;

CREATE TRIGGER site_releases_immutable_delete
BEFORE DELETE ON site_releases
BEGIN
  SELECT RAISE(ABORT, 'a release is not deleted');
END;

CREATE TABLE site_published (
  site_id TEXT PRIMARY KEY NOT NULL REFERENCES sites(id),
  release_id TEXT NOT NULL,
  published_by TEXT NOT NULL REFERENCES users(id),
  published_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (site_id, release_id) REFERENCES site_releases(site_id, id)
);

-- The address of a page that is public does not change: links already shared would break.
CREATE TRIGGER sites_slug_fixed_while_public
BEFORE UPDATE OF slug ON sites
WHEN NEW.slug <> OLD.slug AND EXISTS (SELECT 1 FROM site_published p WHERE p.site_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'the address of a public page does not change');
END;

INSERT INTO app_schema_versions(version) VALUES ('0024_sites');
