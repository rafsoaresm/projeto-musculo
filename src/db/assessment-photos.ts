import type { D1Database, R2Bucket, R2ObjectBody } from "@cloudflare/workers-types";
import { ageOn } from "@/modules/ficha/contracts";
import {
  isPhotoView,
  photoObjectKey,
  sanitizeJpeg,
  type PhotoView,
} from "@/modules/avaliacoes/photos";
import { latestStudentAcceptanceId, photoAuthorizationFor } from "./consent";
import { activeUser, assertContext, technicalAccessExists, type AuthenticatedContext } from "./students";

/**
 * Postural photos of an assessment. The image is in the private object storage and is reached
 * only through this repository: a professional with an active technical care assignment, and only
 * while the assessment is a draft for anything that changes it. The database holds the index and
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
}
export type PutOutcome =
  | { status: "stored"; replaced: boolean }
  | { status: "consent_required"; reason: "NO_LOGIN" | "NOT_ACCEPTED" | "OUTDATED" | "DECLINED" }
  | { status: "minor" }
  | { status: "invalid"; reason: "NOT_JPEG" | "TOO_LARGE" | "BAD_DIMENSIONS" | "TRUNCATED" | "VIEW" }
  | { status: "not_found" };
export type RemoveOutcome = { status: "removed" } | { status: "not_found" };

export const PHOTO_ADDED = "ASSESSMENT_PHOTO_ADDED";
export const PHOTO_REMOVED = "ASSESSMENT_PHOTO_REMOVED";

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
          `SELECT p.view, p.size_bytes AS sizeBytes, p.width, p.height, p.created_at AS createdAt
           FROM assessment_photos p
           JOIN assessments a ON a.organization_id = p.organization_id AND a.id = p.assessment_id
           WHERE p.organization_id = ?1 AND p.assessment_id = ?3 AND ${reach("a")}
           ORDER BY CASE p.view WHEN 'ANTERIOR' THEN 1 WHEN 'LATERAL_LEFT' THEN 2
             WHEN 'LATERAL_RIGHT' THEN 3 ELSE 4 END`,
        )
        .bind(organizationId, userId, assessmentId)
        .all<PhotoRow>();
      return result.results;
    },

    /**
     * Stores or replaces the photo of one view of an open draft. The authorization is the student's
     * own, recorded when they joined: without it from the login linked to them, in the version of the
     * terms in force, nothing is stored, and nothing the professional sends can stand in for it. Each
     * photo keeps the id of the acceptance that authorized it. A student known to be under 18 is
     * refused: the product does not support minors yet.
     */
    async put(assessmentId: string, view: string, body: Uint8Array, now = new Date()): Promise<PutOutcome> {
      if (!isPhotoView(view)) return { status: "invalid", reason: "VIEW" };
      const target = await db
        .prepare(
          `SELECT a.student_id AS studentId, sp.birth_date AS birthDate
           FROM assessments a
           LEFT JOIN student_profiles sp
             ON sp.organization_id = a.organization_id AND sp.student_id = a.student_id
           WHERE a.organization_id = ?1 AND a.id = ?3 AND a.state = 'DRAFT' AND ${reach("a")}`,
        )
        .bind(organizationId, userId, assessmentId)
        .first<{ studentId: string; birthDate: string | null }>();
      if (!target) return { status: "not_found" };
      const stamp = now.toISOString();
      if (target.birthDate && ageOn(target.birthDate, stamp.slice(0, 10)) < 18) return { status: "minor" };
      const authorization = await photoAuthorizationFor(db, organizationId, target.studentId);
      if (authorization.status === "denied") return { status: "consent_required", reason: authorization.reason };
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
                  width, height, consent_confirmed_by_user_id, created_at, consent_acceptance_id)
               SELECT ?4, ?1, ?3, ?5, ?6, 'image/jpeg', ?7, ?8, ?9, ?2, ?10, ?11
               WHERE ${openDraft} AND ?11 = ${latestStudentAcceptanceId("?1", "?12")}`,
            )
            .bind(
              organizationId, userId, assessmentId, crypto.randomUUID(), view, key,
              image.bytes.length, image.width, image.height, stamp, authorization.acceptanceId,
              target.studentId,
            ),
          audit(PHOTO_ADDED, assessmentId, stamp),
        ]);
        if (results[1].meta.changes === 0) throw new Error("PHOTO_NOT_STORED");
      } catch (error) {
        await bucket.delete(key).catch(() => undefined);
        if (error instanceof Error && error.message === "PHOTO_NOT_STORED") {
          // Either the draft was recorded meanwhile or the student's authorization changed meanwhile.
          const again = await photoAuthorizationFor(db, organizationId, target.studentId);
          return again.status === "denied" ? { status: "consent_required", reason: again.reason } : { status: "not_found" };
        }
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
           WHERE p.organization_id = ?1 AND p.assessment_id = ?3 AND p.view = ?4 AND ${reach("a")}`,
        )
        .bind(organizationId, userId, assessmentId, view)
        .first<{ studentId: string; key: string }>();
      if (!row) return null;
      const object = await bucket.get(row.key);
      return object ? { studentId: row.studentId, body: object.body, size: object.size } : null;
    },

    /** Removes the photo of one view of an open draft. */
    async remove(assessmentId: string, view: string, now = new Date()): Promise<RemoveOutcome> {
      if (!isPhotoView(view)) return { status: "not_found" };
      const row = await db
        .prepare(
          `SELECT p.object_key AS key FROM assessment_photos p
           WHERE p.organization_id = ?1 AND p.assessment_id = ?3 AND p.view = ?4 AND ${openDraft}`,
        )
        .bind(organizationId, userId, assessmentId, view)
        .first<{ key: string }>();
      if (!row) return { status: "not_found" };
      // Object first: if it fails the row stays and the removal can be tried again.
      await bucket.delete(row.key);
      const stamp = now.toISOString();
      const results = await db.batch([
        db
          .prepare(
            `DELETE FROM assessment_photos
             WHERE organization_id = ?1 AND assessment_id = ?3 AND view = ?4 AND ${openDraft}`,
          )
          .bind(organizationId, userId, assessmentId, view),
        audit(PHOTO_REMOVED, assessmentId, stamp),
      ]);
      return results[0].meta.changes > 0 ? { status: "removed" } : { status: "not_found" };
    },
  };
}
