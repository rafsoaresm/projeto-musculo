-- Additive migration: models (templates) of the Avaliação Física (handoff V2 section 2: "Permitir reordenar ou desativar módulos opcionais por
-- template, sem apagar avaliações anteriores"; section 6: templateId, templateVersion, enabledModules, assessment_form_templates; ROADMAP 0.85).
-- 0001..0035 stay untouched; nothing existing is changed or deleted.
--
-- assessment_form_templates: a named model of an organization. Only `archived_at` changes (a model archived is no longer offered; the
--   assessments made with it keep pointing to it).
-- assessment_form_template_versions: what a model asks for, version by version. Editing a model writes a new version; a version is never
--   changed nor deleted, so a draft keeps the version it started with. `enabled_modules` is the ordered list of the optional parts that are on
--   (codes of src/modules/avaliacoes/v2/template.ts, checked by the app); its order is the order of the steps. Triagem/PAR-Q is not a part: it
--   is always in (it gates the plans).
-- assessments.template_id / template_version / enabled_modules: the model and version a draft of the new format started with, and the copy of
--   its list. NULL for every assessment made before (and for "Todos os módulos", the default): everything on, as before. Set when the draft is
--   created (an amendment copies those of the assessment it amends) and never changed afterwards.

CREATE TABLE assessment_form_templates (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  archived_at TEXT,
  UNIQUE (organization_id, id)
);
CREATE INDEX assessment_form_templates_org_idx ON assessment_form_templates(organization_id, archived_at);

CREATE TABLE assessment_form_template_versions (
  template_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  enabled_modules TEXT NOT NULL CHECK (json_valid(enabled_modules) AND json_type(enabled_modules) = 'array' AND length(enabled_modules) <= 1000),
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (template_id, version),
  FOREIGN KEY (organization_id, template_id) REFERENCES assessment_form_templates(organization_id, id)
);

-- Who writes a model or a version: an active technical member (owner, manager or technical) of that organization.
CREATE TRIGGER assessment_form_templates_technical
BEFORE INSERT ON assessment_form_templates
WHEN NOT EXISTS (
  SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id
  WHERE m.organization_id = NEW.organization_id AND m.user_id = NEW.created_by_user_id AND m.revoked_at IS NULL
    AND m.role IN ('OWNER', 'MANAGER', 'TECHNICAL') AND u.disabled_at IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'TEMPLATE_NOT_AUTHORIZED');
END;
CREATE TRIGGER assessment_form_template_versions_technical
BEFORE INSERT ON assessment_form_template_versions
WHEN NOT EXISTS (
  SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id
  WHERE m.organization_id = NEW.organization_id AND m.user_id = NEW.created_by_user_id AND m.revoked_at IS NULL
    AND m.role IN ('OWNER', 'MANAGER', 'TECHNICAL') AND u.disabled_at IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'TEMPLATE_NOT_AUTHORIZED');
END;

-- A model keeps its organization and its author; only archived_at moves. A model is never deleted (assessments point to it).
CREATE TRIGGER assessment_form_templates_fixed
BEFORE UPDATE OF id, organization_id, created_by_user_id, created_at ON assessment_form_templates
BEGIN
  SELECT RAISE(ABORT, 'TEMPLATE_FIXED');
END;
CREATE TRIGGER assessment_form_templates_no_delete
BEFORE DELETE ON assessment_form_templates
BEGIN
  SELECT RAISE(ABORT, 'TEMPLATE_FIXED');
END;

-- A version is written once: never changed, never deleted (a draft keeps the version it started with).
CREATE TRIGGER assessment_form_template_versions_append_only_update
BEFORE UPDATE ON assessment_form_template_versions
BEGIN
  SELECT RAISE(ABORT, 'TEMPLATE_VERSION_FIXED');
END;
CREATE TRIGGER assessment_form_template_versions_append_only_delete
BEFORE DELETE ON assessment_form_template_versions
BEGIN
  SELECT RAISE(ABORT, 'TEMPLATE_VERSION_FIXED');
END;

ALTER TABLE assessments ADD COLUMN template_id TEXT;
ALTER TABLE assessments ADD COLUMN template_version INTEGER CHECK (template_version IS NULL OR template_version >= 1);
ALTER TABLE assessments ADD COLUMN enabled_modules TEXT
  CHECK (enabled_modules IS NULL OR (json_valid(enabled_modules) AND json_type(enabled_modules) = 'array' AND length(enabled_modules) <= 1000));

-- A draft with a model points to a version of a model of its own organization, of the new format, and carries exactly that version's list;
-- without a model, no list (everything on).
CREATE TRIGGER assessments_template_insert
BEFORE INSERT ON assessments
WHEN (NEW.template_id IS NULL) <> (NEW.template_version IS NULL)
  OR (NEW.template_id IS NULL AND NEW.enabled_modules IS NOT NULL)
  OR (NEW.template_id IS NOT NULL AND (NEW.format_version IS NOT 2 OR NOT EXISTS (
    SELECT 1 FROM assessment_form_template_versions v
    WHERE v.template_id = NEW.template_id AND v.version = NEW.template_version AND v.organization_id = NEW.organization_id
      AND v.enabled_modules = NEW.enabled_modules)))
BEGIN
  SELECT RAISE(ABORT, 'ASSESSMENT_TEMPLATE_INVALID');
END;

-- The model of an assessment is set when it is created and never changes, draft or recorded.
CREATE TRIGGER assessments_template_fixed
BEFORE UPDATE OF template_id, template_version, enabled_modules ON assessments
WHEN NEW.template_id IS NOT OLD.template_id OR NEW.template_version IS NOT OLD.template_version OR NEW.enabled_modules IS NOT OLD.enabled_modules
BEGIN
  SELECT RAISE(ABORT, 'ASSESSMENT_TEMPLATE_FIXED');
END;

INSERT INTO app_schema_versions(version) VALUES ('0036_assessment_templates');
