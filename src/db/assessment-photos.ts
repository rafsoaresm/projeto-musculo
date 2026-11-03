import type { D1Database, R2Bucket, R2ObjectBody } from "@cloudflare/workers-types";
import {
  isPhotoView,
  photoObjectKey,
  sanitizeJpeg,
  type PhotoView,
} from "@/modules/avaliacoes/photos";
import { activeUser, assertContext, technicalAccessExists, type AuthenticatedContext } from "./students";

/**
 * Postural photos of an assessment. The image is in the private object storage and is reached
 * only through this repository: a professional with an active technical care assignment. A photo is
 * stored or replaced only while the assessment is a draft; it can be removed at any time (the photo of
 * a recorded assessment is erased: its frozen row stays, with a record of the erasure). The database holds the index and
 * the storage holds the bytes; each key is unguessable and never leaves the server.
 *
 * Order matters when the two stores cannot be changed together. Upload: the object first, then the
 * row, and the object is removed again if the row is refused. Removal: the object first, then the
 * row, so a failure never leaves a row pointing at nothing.
 */
export interface PhotoRow {
  view: PhotoView;
  sizeBytes: number;
  width: number;
  height: number;
  createdAt: string;
  /** When it was erased (by the professional, or on the student's request); null while it is stored. */
  erasedAt: string | null;
}
export type PutOutcome =
  | { status: "stored"; replaced: boolean }
  | { status: "invalid"; reason: "NOT_JPEG" | "TOO_LARGE" | "BAD_DIMENSIONS" | "TRUNCATED" | "VIEW" }
  /** The draft's model leaves the postural assessment out (slice 0.85): that part, and so its photos, is not in this draft. */
  | { status: "not_included" }
  | { status: "not_found" };
export type RemoveOutcome = { status: "removed" } | { status: "erased" } | { status: "not_found" };

export const PHOTO_ADDED = "ASSESSMENT_PHOTO_ADDED";
export const PHOTO_REMOVED = "ASSESSMENT_PHOTO_REMOVED";
export const PHOTO_ERASED = "ASSESSMENT_PHOTO_ERASED";

export function assessmentPhotosFor(
  db: D1Database,
  bucket: R2Bucket,
  context: AuthenticatedContext | null,
) {
  const { userId, organizationId } = assertContext(context);
  // ?1 organization and ?2 acting user, always. ?3 is the assessment.
  const reach = (alias: string) => `EXISTS (SELECT 1 FROM students s
    WHERE s.organization_id = ${alias}.organization_id AND s.id = ${alias}.student_id
      AND ${activeUser("?2")} AND ${technicalAccessExists("s", "?2")})`;
  const openDraft = `EXISTS (SELECT 1 FROM assessments a WHERE a.organization_id = ?1 AND a.id = ?3
    AND a.state = 'DRAFT' AND ${reach("a")})`;
  const audit = (action: string, subject: string, stamp: string) =>
    db
      .prepare(
        `INSERT INTO access_audit_events (id, organization_id, actor_user_id, action, subject_id, created_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE (SELECT changes()) > 0`,
      )
      .bind(crypto.randomUUID(), organizationId, userId, action, subject, stamp);

  return {
    /** The photos of an assessment this user reaches, in the order of the views. */
    async list(assessmentId: string): Promise<PhotoRow[]> {
      const result = await db
        .prepare(
          `SELECT p.view, p.size_bytes AS sizeBytes, p.width, p.height, p.created_at AS createdAt,
             e.erased_at AS erasedAt
           FROM assessment_photos p
           JOIN assessments a ON a.organization_id = p.organization_id AND a.id = p.assessment_id
           LEFT JOIN photo_erasures e ON e.photo_id = p.id
           WHERE p.organization_id = ?1 AND p.assessment_id = ?3 AND ${reach("a")}
           ORDER BY CASE p.view WHEN 'ANTERIOR' THEN 1 WHEN 'LATERAL_LEFT' THEN 2
             WHEN 'LATERAL_RIGHT' THEN 3 ELSE 4 END`,
        )
        .bind(organizationId, userId, assessmentId)
        .all<PhotoRow>();
      return result.results;
    },

    /**
     * Stores or replaces the photo of one view of an open draft. A draft whose model leaves the postural assessment out (slice 0.85) takes no
     * photo: the photos belong to that part.
     */
    async put(assessmentId: string, view: string, body: Uint8Array, now = new Date()): Promise<PutOutcome> {
      if (!isPhotoView(view)) return { status: "invalid", reason: "VIEW" };
      const target = await db
        .prepare(
          `SELECT (a.enabled_modules IS NULL OR EXISTS (SELECT 1 FROM json_each(a.enabled_modules) WHERE value = 'posture')) AS posture
           FROM assessments a WHERE a.organization_id = ?1 AND a.id = ?3 AND a.state = 'DRAFT' AND ${reach("a")}`,
        )
        .bind(organizationId, userId, assessmentId)
        .first<{ posture: number }>();
      if (!target) return { status: "not_found" };
      if (!target.posture) return { status: "not_included" };
      const stamp = now.toISOString();
      const image = sanitizeJpeg(body);
      if (!image.ok) return { status: "invalid", reason: image.reason };

      const previous = await db
        .prepare("SELECT object_key AS key FROM assessment_photos WHERE organization_id = ?1 AND assessment_id = ?2 AND view = ?3")
        .bind(organizationId, assessmentId, view)
        .first<{ key: string }>();
      const key = photoObjectKey(organizationId, assessmentId);
      await bucket.put(key, image.bytes, { httpMetadata: { contentType: "image/jpeg" } });
      try {
        const results = await db.batch([
          db
            .prepare(
              `DELETE FROM assessment_photos
               WHERE organization_id = ?1 AND assessment_id = ?3 AND view = ?4 AND ${openDraft}`,
            )
            .bind(organizationId, userId, assessmentId, view),
          db
            .prepare(
              `INSERT INTO assessment_photos
                 (id, organization_id, assessment_id, view, object_key, content_type, size_bytes,
                  width, height, consent_confirmed_by_user_id, created_at)
               SELECT ?4, ?1, ?3, ?5, ?6, 'image/jpeg', ?7, ?8, ?9, ?2, ?10
               WHERE ${openDraft}`,
            )
            .bind(
              organizationId, userId, assessmentId, crypto.randomUUID(), view, key,
              image.bytes.length, image.width, image.height, stamp,
            ),
          audit(PHOTO_ADDED, assessmentId, stamp),
        ]);
        if (results[1].meta.changes === 0) throw new Error("PHOTO_NOT_STORED");
      } catch (error) {
        await bucket.delete(key).catch(() => undefined);
        // The draft was recorded meanwhile.
        if (error instanceof Error && error.message === "PHOTO_NOT_STORED") return { status: "not_found" };
        throw error;
      }
      // The replaced image is no longer referenced by anything: remove it.
      if (previous) await bucket.delete(previous.key).catch(() => undefined);
      return { status: "stored", replaced: Boolean(previous) };
    },

    /** The image of one view, for a professional who reaches the assessment. Null otherwise. */
    async read(
      assessmentId: string,
      view: string,
    ): Promise<{ studentId: string; body: R2ObjectBody["body"]; size: number } | null> {
      if (!isPhotoView(view)) return null;
      const row = await db
        .prepare(
          `SELECT a.student_id AS studentId, p.object_key AS key
           FROM assessment_photos p
           JOIN assessments a ON a.organization_id = p.organization_id AND a.id = p.assessment_id
           WHERE p.organization_id = ?1 AND p.assessment_id = ?3 AND p.view = ?4 AND ${reach("a")}
             AND NOT EXISTS (SELECT 1 FROM photo_erasures e WHERE e.photo_id = p.id)`,
        )
        .bind(organizationId, userId, assessmentId, view)
        .first<{ studentId: string; key: string }>();
      if (!row) return null;
      const object = await bucket.get(row.key);
      return object ? { studentId: row.studentId, body: object.body, size: object.size } : null;
    },

    /**
     * Removes the photo of one view. On an open draft the photo and its row go. On a recorded assessment the row is frozen, so the bytes are
     * removed from the private storage and an erasure is recorded (no request of the student is needed): the photo is shown as erased.
     * Object first: if a step fails, the photo is still there and the removal can be tried again.
     */
    async remove(assessmentId: string, view: string, now = new Date()): Promise<RemoveOutcome> {
      if (!isPhotoView(view)) return { status: "not_found" };
      const row = await db
        .prepare(
          `SELECT p.id, p.object_key AS key, a.state FROM assessment_photos p
           JOIN assessments a ON a.organization_id = p.organization_id AND a.id = p.assessment_id
           WHERE p.organization_id = ?1 AND p.assessment_id = ?3 AND p.view = ?4 AND ${reach("a")}
             AND NOT EXISTS (SELECT 1 FROM photo_erasures e WHERE e.photo_id = p.id)`,
        )
        .bind(organizationId, userId, assessmentId, view)
        .first<{ id: string; key: string; state: string }>();
      if (!row) return { status: "not_found" };
      await bucket.delete(row.key);
      const stamp = now.toISOString();
      if (row.state === "DRAFT") {
        const results = await db.batch([
          db
            .prepare(
              `DELETE FROM assessment_photos
               WHERE organization_id = ?1 AND assessment_id = ?3 AND view = ?4 AND ${openDraft}`,
            )
            .bind(organizationId, userId, assessmentId, view),
          audit(PHOTO_REMOVED, assessmentId, stamp),
        ]);
        if (results[0].meta.changes > 0) return { status: "removed" };
        // The draft was recorded meanwhile: the bytes are gone, so the erasure is recorded below.
      }
      const results = await db.batch([
        db
          .prepare(
            `INSERT INTO photo_erasures (photo_id, organization_id, assessment_id, view, request_id, erased_by_user_id, erased_at)
             SELECT p.id, p.organization_id, p.assessment_id, p.view, NULL, ?2, ?5
             FROM assessment_photos p
             JOIN assessments a ON a.organization_id = p.organization_id AND a.id = p.assessment_id
             WHERE p.id = ?4 AND p.organization_id = ?1 AND p.assessment_id = ?3 AND ${reach("a")}
               AND NOT EXISTS (SELECT 1 FROM photo_erasures e WHERE e.photo_id = p.id)`,
          )
          .bind(organizationId, userId, assessmentId, row.id, stamp),
        audit(PHOTO_ERASED, assessmentId, stamp),
      ]);
      return results[0].meta.changes > 0 ? { status: "erased" } : { status: "not_found" };
    },
  };
}
