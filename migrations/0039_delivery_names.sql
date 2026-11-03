-- Additive migration: the names of who delivered, written at the moment of the delivery (PENDENCIAS B15; ROADMAP 0.90).
-- 0001..0038 stay untouched; nothing existing is deleted.
--
-- Until now the name of the professional and of the workspace (organization) were read live wherever a delivery was shown, so a rename in
-- "Configurações" changed how deliveries already made named who made them. From here on:
--   plan_revisions.delivered_by_name / delivered_organization_name: the professional's display name and the workspace's name when the revision
--     was delivered to the student.
--   assessments.recorded_by_name / recorded_organization_name: the same when the assessment was recorded ("registrada por").
-- The triggers below write them in the same statement that delivers or records (any path that does it, the app or a direct UPDATE), and they
-- never change afterwards; a statement cannot bring its own names (it is refused). delivered_by_name / recorded_by_name stay empty (NULL) when
-- the person had no professional record then: the screens leave the name out and the PDFs and the assessment report say "Não informado",
-- never an invented name.
--
-- Existing rows: the names are filled in now from the CURRENT names. The name they had at the moment of the delivery before this migration is
-- unknown (it was never stored); a rename made before this migration is therefore not reflected in older deliveries.
--
-- name_history: one row each time the workspace is renamed or a professional changes their display name in "Configurações": the name before,
-- the name after, who changed it and when. Written by the repository in the same batch as the rename; never updated, never deleted. No row
-- exists for renames made before this migration (unknown).

ALTER TABLE plan_revisions ADD COLUMN delivered_by_name TEXT CHECK (delivered_by_name IS NULL OR length(trim(delivered_by_name)) BETWEEN 1 AND 160);
ALTER TABLE plan_revisions ADD COLUMN delivered_organization_name TEXT CHECK (delivered_organization_name IS NULL OR length(trim(delivered_organization_name)) BETWEEN 1 AND 160);
ALTER TABLE assessments ADD COLUMN recorded_by_name TEXT CHECK (recorded_by_name IS NULL OR length(trim(recorded_by_name)) BETWEEN 1 AND 160);
ALTER TABLE assessments ADD COLUMN recorded_organization_name TEXT CHECK (recorded_organization_name IS NULL OR length(trim(recorded_organization_name)) BETWEEN 1 AND 160);

-- Backfill from the current names (the historical name is unknown).
UPDATE plan_revisions
SET delivered_by_name = (SELECT p.display_name FROM professionals p
                          WHERE p.organization_id = plan_revisions.organization_id AND p.user_id = plan_revisions.delivered_by_user_id),
    delivered_organization_name = (SELECT o.name FROM organizations o WHERE o.id = plan_revisions.organization_id)
WHERE state = 'DELIVERED';

UPDATE assessments
SET recorded_by_name = (SELECT p.display_name FROM professionals p
                         WHERE p.organization_id = assessments.organization_id AND p.user_id = assessments.recorded_by_user_id),
    recorded_organization_name = (SELECT o.name FROM organizations o WHERE o.id = assessments.organization_id)
WHERE state = 'RECORDED';

-- The names are written once: the workspace name is always there after a delivery, so it marks the names as frozen. Before the delivery
-- (or the record) there is nothing to name.
CREATE TRIGGER plan_revisions_names_written_once
BEFORE UPDATE OF delivered_by_name, delivered_organization_name ON plan_revisions
WHEN (OLD.delivered_organization_name IS NOT NULL
       AND (NEW.delivered_by_name IS NOT OLD.delivered_by_name OR NEW.delivered_organization_name IS NOT OLD.delivered_organization_name))
  OR (NEW.delivered_at IS NULL AND (NEW.delivered_by_name IS NOT NULL OR NEW.delivered_organization_name IS NOT NULL))
  -- The statement that delivers cannot bring its own names: only the trigger below writes them, once the row is already DELIVERED.
  OR (OLD.state <> 'DELIVERED' AND (NEW.delivered_by_name IS NOT NULL OR NEW.delivered_organization_name IS NOT NULL))
BEGIN
  SELECT RAISE(ABORT, 'PLAN_REVISION_FROZEN');
END;

CREATE TRIGGER assessments_names_written_once
BEFORE UPDATE OF recorded_by_name, recorded_organization_name ON assessments
WHEN (OLD.recorded_organization_name IS NOT NULL
       AND (NEW.recorded_by_name IS NOT OLD.recorded_by_name OR NEW.recorded_organization_name IS NOT OLD.recorded_organization_name))
  OR (NEW.recorded_at IS NULL AND (NEW.recorded_by_name IS NOT NULL OR NEW.recorded_organization_name IS NOT NULL))
  -- The statement that records cannot bring its own names: only the trigger below writes them, once the row is already RECORDED.
  OR (OLD.state <> 'RECORDED' AND (NEW.recorded_by_name IS NOT NULL OR NEW.recorded_organization_name IS NOT NULL))
BEGIN
  SELECT RAISE(ABORT, 'ASSESSMENT_FROZEN');
END;

-- Nor can a row be inserted with names already in it (the AFTER INSERT triggers below write them).
CREATE TRIGGER plan_revisions_names_not_on_insert
BEFORE INSERT ON plan_revisions
WHEN NEW.delivered_by_name IS NOT NULL OR NEW.delivered_organization_name IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'PLAN_REVISION_FROZEN');
END;

CREATE TRIGGER assessments_names_not_on_insert
BEFORE INSERT ON assessments
WHEN NEW.recorded_by_name IS NOT NULL OR NEW.recorded_organization_name IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'ASSESSMENT_FROZEN');
END;

-- Written at the moment of the delivery or of the record, whatever statement made it.
CREATE TRIGGER plan_revisions_names_on_delivery
AFTER UPDATE OF state ON plan_revisions
WHEN NEW.state = 'DELIVERED' AND OLD.state <> 'DELIVERED' AND NEW.delivered_organization_name IS NULL
BEGIN
  UPDATE plan_revisions
  SET delivered_by_name = (SELECT p.display_name FROM professionals p
                            WHERE p.organization_id = NEW.organization_id AND p.user_id = NEW.delivered_by_user_id),
      delivered_organization_name = (SELECT o.name FROM organizations o WHERE o.id = NEW.organization_id)
  WHERE id = NEW.id;
END;

CREATE TRIGGER plan_revisions_names_on_insert
AFTER INSERT ON plan_revisions
WHEN NEW.state = 'DELIVERED' AND NEW.delivered_organization_name IS NULL
BEGIN
  UPDATE plan_revisions
  SET delivered_by_name = (SELECT p.display_name FROM professionals p
                            WHERE p.organization_id = NEW.organization_id AND p.user_id = NEW.delivered_by_user_id),
      delivered_organization_name = (SELECT o.name FROM organizations o WHERE o.id = NEW.organization_id)
  WHERE id = NEW.id;
END;

CREATE TRIGGER assessments_names_on_record
AFTER UPDATE OF state ON assessments
WHEN NEW.state = 'RECORDED' AND OLD.state <> 'RECORDED' AND NEW.recorded_organization_name IS NULL
BEGIN
  UPDATE assessments
  SET recorded_by_name = (SELECT p.display_name FROM professionals p
                           WHERE p.organization_id = NEW.organization_id AND p.user_id = NEW.recorded_by_user_id),
      recorded_organization_name = (SELECT o.name FROM organizations o WHERE o.id = NEW.organization_id)
  WHERE id = NEW.id;
END;

CREATE TRIGGER assessments_names_on_insert
AFTER INSERT ON assessments
WHEN NEW.state = 'RECORDED' AND NEW.recorded_organization_name IS NULL
BEGIN
  UPDATE assessments
  SET recorded_by_name = (SELECT p.display_name FROM professionals p
                           WHERE p.organization_id = NEW.organization_id AND p.user_id = NEW.recorded_by_user_id),
      recorded_organization_name = (SELECT o.name FROM organizations o WHERE o.id = NEW.organization_id)
  WHERE id = NEW.id;
END;

CREATE TABLE name_history (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  subject TEXT NOT NULL CHECK (subject IN ('ORGANIZATION', 'PROFESSIONAL')),
  -- The professional whose name changed; NULL for the workspace.
  subject_user_id TEXT REFERENCES users(id),
  previous_name TEXT NOT NULL CHECK (length(trim(previous_name)) BETWEEN 1 AND 160),
  new_name TEXT NOT NULL CHECK (length(trim(new_name)) BETWEEN 1 AND 160),
  changed_by_user_id TEXT NOT NULL REFERENCES users(id),
  changed_at TEXT NOT NULL,
  CHECK ((subject = 'ORGANIZATION') = (subject_user_id IS NULL))
);
CREATE INDEX name_history_subject_idx ON name_history(organization_id, subject, subject_user_id, changed_at);

CREATE TRIGGER name_history_no_update
BEFORE UPDATE ON name_history
BEGIN
  SELECT RAISE(ABORT, 'NAME_HISTORY_FROZEN');
END;

CREATE TRIGGER name_history_no_delete
BEFORE DELETE ON name_history
BEGIN
  SELECT RAISE(ABORT, 'NAME_HISTORY_FROZEN');
END;

INSERT INTO app_schema_versions(version) VALUES ('0039_delivery_names');
