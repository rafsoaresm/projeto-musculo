-- Additive migration: the documents of the embedded Frappe Builder editor (Meu Site, new editor). 0001..0026 stay untouched.
--
-- The editor keeps what it edits as "documents" of a few types (a page, a component, a block template, a variable, a font ...). One row
-- holds one document as JSON, under the organization that owns it; the application checks the type, the size and the role of the
-- person in each statement. The editor never chooses the organization: it comes from the verified session.
--
-- Nothing here is public. A page is only shown to visitors after it is published, and that copy is kept apart (a later migration).

CREATE TABLE builder_docs (
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  doctype TEXT NOT NULL CHECK (doctype IN (
    'Builder Page', 'Builder Component', 'Block Template', 'Builder Client Script', 'Builder Page Client Script',
    'Builder Project Folder', 'Builder Settings', 'Website Settings', 'Website Route Redirect', 'User Font',
    'Builder Token', 'Builder Variable', 'Builder Snapshot'
  )),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 140),
  -- The whole document, as the editor reads it back. Capped so that one row stays well inside what D1 accepts.
  data TEXT NOT NULL CHECK (json_valid(data) AND length(data) <= 1500000),
  created_by TEXT NOT NULL REFERENCES users(id),
  updated_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (organization_id, doctype, name)
) WITHOUT ROWID;
CREATE INDEX builder_docs_recent_idx ON builder_docs(organization_id, doctype, updated_at);

INSERT INTO app_schema_versions(version) VALUES ('0027_builder_docs');
