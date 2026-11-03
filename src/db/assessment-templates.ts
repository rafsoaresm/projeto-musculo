import type { D1Database } from "@cloudflare/workers-types";
import { readEnabledParts, templateInputSchema, templateRecord, type TemplatePart } from "@/modules/avaliacoes/v2/template";
import { activeUser, assertContext, type AuthenticatedContext } from "./students";

/**
 * The models (templates) of the Avaliação Física of an organization (handoff V2 sections 2 and 6; slice 0.85). Read and written only by an active
 * technical member (owner, manager or technical) of the organization of the session; the organization comes from the session, never from what
 * the screen sends. A model is versioned: editing it writes a new version, and a draft keeps the version it started with (also triggers of 0036).
 * Archiving a model only stops offering it; nothing is deleted.
 */
export interface TemplateSummary {
  id: string;
  name: string;
  /** The newest version. */
  version: number;
  /** The parts that are on, in the order of the steps. */
  enabled: TemplatePart[];
  archivedAt: string | null;
  updatedAt: string;
  /** How many assessments (drafts included) started with any version of it. */
  assessments: number;
}
export type TemplateSaveOutcome =
  | { status: "saved"; id: string; version: number }
  /** Nothing changed: no new version. */
  | { status: "unchanged"; id: string; version: number }
  | { status: "invalid" }
  /** Someone wrote a newer version since the screen read it. */
  | { status: "conflict" }
  | { status: "not_found" };

type Raw = { id: string; name: string; version: number; enabled: string; archivedAt: string | null; updatedAt: string; assessments: number };

export function assessmentTemplatesFor(db: D1Database, context: AuthenticatedContext | null) {
  const { userId, organizationId } = assertContext(context);
  // ?1 organization and ?2 acting user, always.
  const technical = `${activeUser("?2")} AND EXISTS (SELECT 1 FROM memberships m
    WHERE m.organization_id = ?1 AND m.user_id = ?2 AND m.revoked_at IS NULL AND m.role IN ('OWNER','MANAGER','TECHNICAL'))`;
  const columns = `t.id, v.name, v.version, v.enabled_modules AS enabled, t.archived_at AS archivedAt, v.created_at AS updatedAt,
    (SELECT count(*) FROM assessments a WHERE a.organization_id = t.organization_id AND a.template_id = t.id) AS assessments`;
  const latest = `v.version = (SELECT max(w.version) FROM assessment_form_template_versions w WHERE w.template_id = t.id)`;
  const shape = (row: Raw): TemplateSummary => ({ ...row, enabled: [...(readEnabledParts(row.enabled) ?? [])] });

  const api = {
    /** The models of the organization, newest version of each, by name; archived ones only when asked. */
    async list(options: { includeArchived?: boolean } = {}): Promise<TemplateSummary[]> {
      const rows = await db
        .prepare(
          `SELECT ${columns} FROM assessment_form_templates t
           JOIN assessment_form_template_versions v ON v.template_id = t.id AND v.organization_id = t.organization_id AND ${latest}
           WHERE t.organization_id = ?1 AND ${technical} AND (?3 = 1 OR t.archived_at IS NULL)
           ORDER BY t.archived_at IS NOT NULL, v.name COLLATE NOCASE`,
        )
        .bind(organizationId, userId, options.includeArchived ? 1 : 0)
        .all<Raw>();
      return rows.results.map(shape);
    },

    async get(id: string): Promise<TemplateSummary | null> {
      const row = await db
        .prepare(
          `SELECT ${columns} FROM assessment_form_templates t
           JOIN assessment_form_template_versions v ON v.template_id = t.id AND v.organization_id = t.organization_id AND ${latest}
           WHERE t.organization_id = ?1 AND t.id = ?3 AND ${technical}`,
        )
        .bind(organizationId, userId, id)
        .first<Raw>();
      return row ? shape(row) : null;
    },

    /** A new model, version 1. */
    async create(raw: unknown, now = new Date()): Promise<TemplateSaveOutcome> {
      const parsed = templateInputSchema.safeParse(raw);
      if (!parsed.success) return { status: "invalid" };
      const record = templateRecord(parsed.data);
      const id = crypto.randomUUID();
      const stamp = now.toISOString();
      const results = await db.batch([
        db
          .prepare(
            `INSERT INTO assessment_form_templates (id, organization_id, created_by_user_id, created_at)
             SELECT ?3, ?1, ?2, ?4 WHERE ${technical}`,
          )
          .bind(organizationId, userId, id, stamp),
        db
          .prepare(
            `INSERT INTO assessment_form_template_versions (template_id, organization_id, version, name, enabled_modules, created_by_user_id, created_at)
             SELECT ?3, ?1, 1, ?5, ?6, ?2, ?4 WHERE (SELECT changes()) > 0`,
          )
          .bind(organizationId, userId, id, stamp, record.name, JSON.stringify(record.enabled)),
      ]);
      return results[0].meta.changes > 0 ? { status: "saved", id, version: 1 } : { status: "not_found" };
    },

    /**
     * Edits a model: writes the next version, based on the version the screen read (a newer one written meanwhile is a conflict, never silently
     * replaced). The drafts started with an older version keep it. When nothing changed, no version is written.
     */
    async update(id: string, raw: unknown, expectedVersion: number, now = new Date()): Promise<TemplateSaveOutcome> {
      const parsed = templateInputSchema.safeParse(raw);
      if (!parsed.success || !Number.isInteger(expectedVersion)) return { status: "invalid" };
      const record = templateRecord(parsed.data);
      const current = await api.get(id);
      if (!current || current.archivedAt !== null) return { status: "not_found" };
      if (current.version !== expectedVersion) return { status: "conflict" };
      if (current.name === record.name && JSON.stringify(current.enabled) === JSON.stringify(record.enabled))
        return { status: "unchanged", id, version: current.version };
      try {
        const result = await db
          .prepare(
            `INSERT INTO assessment_form_template_versions (template_id, organization_id, version, name, enabled_modules, created_by_user_id, created_at)
             SELECT t.id, t.organization_id, ?4 + 1, ?5, ?6, ?2, ?7 FROM assessment_form_templates t
             WHERE t.organization_id = ?1 AND t.id = ?3 AND t.archived_at IS NULL AND ${technical}
               AND (SELECT max(w.version) FROM assessment_form_template_versions w WHERE w.template_id = t.id) = ?4`,
          )
          .bind(organizationId, userId, id, expectedVersion, record.name, JSON.stringify(record.enabled), now.toISOString())
          .run();
        return result.meta.changes > 0 ? { status: "saved", id, version: expectedVersion + 1 } : { status: "conflict" };
      } catch (error) {
        // Two saves of the same version at once: the primary key keeps one.
        if (String(error).includes("UNIQUE") || String(error).includes("PRIMARY")) return { status: "conflict" };
        throw error;
      }
    },

    /** Stops (or starts again) offering a model when an assessment starts. The assessments made with it keep it. */
    async setArchived(id: string, archived: boolean, now = new Date()): Promise<boolean> {
      const result = await db
        .prepare(
          `UPDATE assessment_form_templates SET archived_at = CASE WHEN ?4 = 1 THEN ?5 ELSE NULL END
           WHERE organization_id = ?1 AND id = ?3 AND (archived_at IS NULL) = (?4 = 1) AND ${technical}`,
        )
        .bind(organizationId, userId, id, archived ? 1 : 0, now.toISOString())
        .run();
      return result.meta.changes > 0;
    },
  };
  return api;
}
