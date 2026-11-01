-- Additive migration: the editor of a site becomes fixed when it is chosen (handoff V4, decision D1). 0001..0029 stay untouched.
--
-- sites.engine_fixed: 1 when the editor was chosen in the two-step creation (cards, warning, confirmation) and cannot be changed for this site;
-- the only way to use the other editor is to delete the site and start again. The sites created before this migration stay at 0: some of them
-- hold content in both editors, and they are listed for the platform manager ("Sites e editores") before anything about them changes.

ALTER TABLE sites ADD COLUMN engine_fixed INTEGER NOT NULL DEFAULT 0 CHECK (engine_fixed IN (0,1));

INSERT INTO app_schema_versions(version) VALUES ('0030_site_engine_fixed');
