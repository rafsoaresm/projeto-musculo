import type { D1Database } from "@cloudflare/workers-types";
import {
  exerciseInputSchema,
  parseVideoUrl,
  videoStatusFor,
  type VideoStatus,
} from "@/modules/biblioteca/contracts";
import { activeUser, assertContext, type AuthenticatedContext } from "./students";

/**
 * Exercise library. System exercises (organization_id NULL) are read-only and
 * visible to the technical members of every organization. An organization's own
 * exercises are visible and editable only to its technical members: owner,
 * manager or technical role, active and not blocked. Commercial and finance
 * members, students and platform managers never reach this table.
 *
 * Editing or archiving an exercise never rewrites a prescription: prescribed
 * exercises keep their own snapshot.
 */
export interface ExerciseRecord {
  id: string;
  scope: "SYSTEM" | "ORGANIZATION";
  name: string;
  category: string;
  level: string | null;
  videoUrl: string | null;
  videoStatus: VideoStatus;
  videoVerifiedAt: string | null;
  notes: string | null;
  source: string;
  archivedAt: string | null;
  updatedAt: string;
}
export interface ExerciseFilters {
  query?: string;
  category?: string;
  scope?: "ALL" | "SYSTEM" | "ORGANIZATION";
  includeArchived?: boolean;
}
export type SaveOutcome =
  | { status: "saved"; id: string }
  | { status: "duplicate" }
  | { status: "conflict" }
  | { status: "not_found" };

/**
 * Duplicates and searches use this key, not SQL lower(), which ignores accents.
 * Same rule as the migration's seed rows: lower case, spaces collapsed.
 */
export const nameKey = (name: string) =>
  name.normalize("NFC").trim().toLocaleLowerCase("pt-BR").replace(/\s+/g, " ");

/** The validated, normalized link, or null when there is none. */
const normalizedLink = (raw: string | null) =>
  raw ? (parseVideoUrl(raw)?.url ?? null) : null;

const columns = `e.id,
  CASE WHEN e.organization_id IS NULL THEN 'SYSTEM' ELSE 'ORGANIZATION' END AS scope,
  e.name, e.category, e.level, e.video_url AS videoUrl, e.video_status AS videoStatus,
  e.video_verified_at AS videoVerifiedAt, e.notes, e.source,
  e.archived_at AS archivedAt, e.updated_at AS updatedAt`;

export function exercisesFor(
  db: D1Database,
  context: AuthenticatedContext | null,
) {
  const { userId, organizationId } = assertContext(context);
  // ?1 is always the organization and ?2 the acting user.
  const technical = `${activeUser("?2")} AND EXISTS (SELECT 1 FROM memberships m
    WHERE m.organization_id = ?1 AND m.user_id = ?2 AND m.revoked_at IS NULL
      AND m.role IN ('OWNER','MANAGER','TECHNICAL'))`;
  const visible = `(e.organization_id IS NULL OR e.organization_id = ?1) AND ${technical}`;
  const isUnique = (error: unknown) => String(error).includes("UNIQUE");

  return {
    async list(filters: ExerciseFilters = {}): Promise<ExerciseRecord[]> {
      const needle = filters.query ? nameKey(filters.query) : "";
      const result = await db
        .prepare(
          `SELECT ${columns} FROM exercises e
           WHERE ${visible}
             AND (?3 = 1 OR e.archived_at IS NULL)
             AND (?4 IS NULL OR e.category = ?4)
             AND (?5 IS NULL OR e.name_key LIKE ?5 ESCAPE '\\')
             AND (?6 = 'ALL' OR (?6 = 'SYSTEM' AND e.organization_id IS NULL)
                  OR (?6 = 'ORGANIZATION' AND e.organization_id = ?1))
           ORDER BY e.category, e.name_key`,
        )
        .bind(
          organizationId,
          userId,
          filters.includeArchived ? 1 : 0,
          filters.category || null,
          needle ? `%${needle.replace(/[\\%_]/g, "\\$&")}%` : null,
          filters.scope ?? "ALL",
        )
        .all<ExerciseRecord>();
      return result.results;
    },

    async find(id: string): Promise<ExerciseRecord | null> {
      return db
        .prepare(`SELECT ${columns} FROM exercises e WHERE ${visible} AND e.id = ?3`)
        .bind(organizationId, userId, id)
        .first<ExerciseRecord>();
    },

    /** A new exercise is never verified: review the video after saving. */
    async create(raw: unknown, now = new Date()): Promise<SaveOutcome> {
      const input = exerciseInputSchema.parse(raw);
      const link = normalizedLink(input.videoUrl);
      const id = crypto.randomUUID();
      const stamp = now.toISOString();
      try {
        const result = await db
          .prepare(
            `INSERT INTO exercises
               (id, organization_id, name, name_key, category, level, video_url,
                video_status, notes, source, created_by_user_id, created_at, updated_at)
             SELECT ?3, ?1, ?4, ?11, ?5, ?6, ?7, ?8, ?9, 'ORGANIZATION', ?2, ?10, ?10
             WHERE ${technical}`,
          )
          .bind(
            organizationId,
            userId,
            id,
            input.name,
            input.category,
            input.level,
            link,
            videoStatusFor(link, false, false),
            input.notes,
            stamp,
            nameKey(input.name),
          )
          .run();
        return result.meta.changes > 0
          ? { status: "saved", id }
          : { status: "not_found" };
      } catch (error) {
        if (isUnique(error)) return { status: "duplicate" };
        throw error;
      }
    },

    /** Own exercises only. A changed link clears the verification. */
    async update(
      id: string,
      raw: unknown,
      now = new Date(),
    ): Promise<SaveOutcome> {
      const input = exerciseInputSchema.parse(raw);
      const current = await this.find(id);
      if (!current || current.scope !== "ORGANIZATION" || current.archivedAt)
        return { status: "not_found" };
      const url = normalizedLink(input.videoUrl);
      const status = videoStatusFor(
        url,
        input.videoVerified,
        url === current.videoUrl,
      );
      const stamp = now.toISOString();
      const keepsVerification =
        status === "VERIFIED" && current.videoStatus === "VERIFIED";
      try {
        const result = await db
          .prepare(
            `UPDATE exercises
             SET name = ?4, name_key = ?14, category = ?5, level = ?6, video_url = ?7,
               video_status = ?8, video_verified_at = ?9, video_verified_by_user_id = ?10,
               notes = ?11, updated_at = ?12
             WHERE id = ?3 AND organization_id = ?1 AND archived_at IS NULL
               AND updated_at = ?13 AND ${technical}`,
          )
          .bind(
            organizationId,
            userId,
            id,
            input.name,
            input.category,
            input.level,
            url,
            status,
            status === "VERIFIED"
              ? keepsVerification
                ? current.videoVerifiedAt
                : stamp
              : null,
            status === "VERIFIED" ? userId : null,
            input.notes,
            stamp,
            current.updatedAt,
            nameKey(input.name),
          )
          .run();
        // Nothing changed although the exercise was visible: someone saved it first.
        return result.meta.changes > 0
          ? { status: "saved", id }
          : { status: "conflict" };
      } catch (error) {
        if (isUnique(error)) return { status: "duplicate" };
        throw error;
      }
    },

    async archive(id: string, now = new Date()): Promise<boolean> {
      const result = await db
        .prepare(
          `UPDATE exercises SET archived_at = ?4, updated_at = ?4
           WHERE id = ?3 AND organization_id = ?1 AND archived_at IS NULL
             AND ${technical}`,
        )
        .bind(organizationId, userId, id, now.toISOString())
        .run();
      return result.meta.changes > 0;
    },

    async restore(id: string, now = new Date()): Promise<SaveOutcome> {
      try {
        const result = await db
          .prepare(
            `UPDATE exercises SET archived_at = NULL, updated_at = ?4
             WHERE id = ?3 AND organization_id = ?1 AND archived_at IS NOT NULL
               AND ${technical}`,
          )
          .bind(organizationId, userId, id, now.toISOString())
          .run();
        return result.meta.changes > 0
          ? { status: "saved", id }
          : { status: "not_found" };
      } catch (error) {
        if (isUnique(error)) return { status: "duplicate" };
        throw error;
      }
    },

    /** Copies a system exercise into this organization so it can be edited. */
    async copyFromSystem(systemId: string, now = new Date()): Promise<SaveOutcome> {
      const id = crypto.randomUUID();
      const stamp = now.toISOString();
      try {
        const result = await db
          .prepare(
            `INSERT INTO exercises
               (id, organization_id, name, name_key, category, level, video_url,
                video_status, notes, source, created_by_user_id, created_at, updated_at)
             SELECT ?3, ?1, e.name, e.name_key, e.category, e.level, e.video_url,
               e.video_status, NULL, 'ORGANIZATION', ?2, ?4, ?4
             FROM exercises e
             WHERE e.id = ?5 AND e.organization_id IS NULL AND e.archived_at IS NULL
               AND ${technical}`,
          )
          .bind(organizationId, userId, id, stamp, systemId)
          .run();
        return result.meta.changes > 0
          ? { status: "saved", id }
          : { status: "not_found" };
      } catch (error) {
        if (isUnique(error)) return { status: "duplicate" };
        throw error;
      }
    },
  };
}
