-- Additive migration: the network of the free code of the public pages (Meu Site, new editor). 0001..0028 stay untouched.
--
-- sites.code_external_open: the site's own switch for what the free code of its pages may reach. The "HTML" and "iframe" blocks of the new editor are
-- shown on the public page as frames that cannot touch the site (no cookie, no storage, no reach into the page). By default they cannot reach
-- anything else either: nothing is fetched from anywhere. Turning this on (owner or manager, written to the audit trail) lets that code load scripts,
-- styles, images and frames from `https` addresses, which sends the visitor's address to those sites: it is born closed (0).

ALTER TABLE sites ADD COLUMN code_external_open INTEGER NOT NULL DEFAULT 0 CHECK (code_external_open IN (0,1));

INSERT INTO app_schema_versions(version) VALUES ('0029_code_external_open');
