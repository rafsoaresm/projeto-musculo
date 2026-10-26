import type { D1Database, D1PreparedStatement, R2Bucket } from "@cloudflare/workers-types";
import {
  dueAtFor,
  isOverdue,
  parseAnswer,
  parseRequest,
  type RequestKind,
  type RequestOutcome,
} from "@/modules/pedidos/contracts";
import { activeUser, assertContext, technicalAccessExists, type AuthenticatedContext } from "./students";

/**
 * Requests from the data subject. The student asks, with a deadline; the professional with the
 * technical assignment over them answers. The tool records both and carries out only one thing: the
 * erasure of the stored photos, which is an exception to the freeze of a recorded assessment and is
 * therefore only possible under an open request of that very student (the database refuses it
 * otherwise). A request is never edited or deleted and has at most one outcome.
 *
 * Two sides, like the check-in. The student reaches only the requests of the students their own login
 * is linked to; the professional only those of students under their active technical assignment.
 */
export interface RequestRow {
  id: string;
  studentId: string;
  kind: RequestKind;
  message: string | null;
  createdAt: string;
  dueAt: string;
  outcome: RequestOutcome | null;
  outcomeNote: string | null;
  decidedAt: string | null;
  /** Open and past its deadline, at the moment it was read. */
  overdue: boolean;
}
export interface OpenRequestRow {
  id: string;
  studentId: string;
  studentName: string;
  kind: RequestKind;
  createdAt: string;
  dueAt: string;
  overdue: boolean;
}

export type OpenRequestOutcome = { status: "opened"; id: string; dueAt: string } | { status: "already_open" } | { status: "not_found" };
export type CancelRequestOutcome = { status: "cancelled" } | { status: "not_open" };
export type AnswerRequestOutcome =
  | { status: "answered" }
  | { status: "use_erasure" }
  | { status: "not_found" };
export type ErasePhotosOutcome =
  | { status: "erased"; count: number }
  | { status: "photos_remain" }
  | { status: "storage_unavailable" }
  | { status: "not_found" };

export const REQUEST_OPENED = "DATA_REQUEST_OPENED";
export const REQUEST_ANSWERED = "DATA_REQUEST_ANSWERED";
export const REQUEST_CANCELLED = "DATA_REQUEST_CANCELLED";

const columns = `r.id, r.student_id AS studentId, r.kind, r.message, r.created_at AS createdAt,
  r.due_at AS dueAt, o.outcome, o.note AS outcomeNote, o.created_at AS decidedAt`;
const joined = `data_subject_requests r
  LEFT JOIN data_subject_request_outcomes o ON o.request_id = r.id`;
const withOverdue = (row: Omit<RequestRow, "overdue">, now: Date): RequestRow => ({
  ...row,
  overdue: row.outcome === null && isOverdue(row.dueAt, now),
});
const noOutcome = (alias: string) =>
  `NOT EXISTS (SELECT 1 FROM data_subject_request_outcomes o WHERE o.request_id = ${alias}.id)`;

/** The student's side, through the verified link of their own login. */
export function studentRequestsFor(db: D1Database, userId: string) {
  if (!userId?.trim()) throw new Error("AUTHENTICATION_REQUIRED");
  // ?1 is always the acting login.
  const linked = (alias: string) => `EXISTS (SELECT 1 FROM student_access sa
    WHERE sa.organization_id = ${alias}.organization_id AND sa.student_id = ${alias}.student_id
      AND sa.user_id = ?1 AND sa.revoked_at IS NULL AND ${activeUser("?1")})`;
  const audit = (action: string, requestId: string, stamp: string) =>
    db
      .prepare(
        `INSERT INTO access_audit_events (id, organization_id, actor_user_id, action, subject_id, created_at)
         SELECT ?1, r.organization_id, ?2, ?3, r.id, ?5 FROM data_subject_requests r
         WHERE r.id = ?4 AND (SELECT changes()) > 0`,
      )
      .bind(crypto.randomUUID(), userId, action, requestId, stamp);

  return {
    /** The student's own requests: the open ones first, then the answered, newest first. */
    async list(studentId: string, now = new Date()): Promise<RequestRow[]> {
      const result = await db
        .prepare(
          `SELECT ${columns} FROM ${joined}
           WHERE r.student_id = ?2 AND ${linked("r")}
           ORDER BY (o.outcome IS NULL) DESC, r.created_at DESC LIMIT 50`,
        )
        .bind(userId, studentId)
        .all<Omit<RequestRow, "overdue">>();
      return result.results.map((row) => withOverdue(row, now));
    },

    /**
     * Opens a request. One request of each kind can be open at a time. Throws a ZodError for a
     * malformed one (nothing is written).
     */
    async open(studentId: string, raw: unknown, now = new Date()): Promise<OpenRequestOutcome> {
      const input = parseRequest(raw);
      const stamp = now.toISOString();
      const id = crypto.randomUUID();
      const dueAt = dueAtFor(stamp);
      try {
        const results = await db.batch([
          db
            .prepare(
              `INSERT INTO data_subject_requests
                 (id, organization_id, student_id, requested_by_user_id, kind, message, created_at, due_at)
               SELECT ?3, sa.organization_id, sa.student_id, ?1, ?4, ?5, ?6, ?7 FROM student_access sa
               WHERE sa.user_id = ?1 AND sa.student_id = ?2 AND sa.revoked_at IS NULL AND ${activeUser("?1")}
               LIMIT 1`,
            )
            .bind(userId, studentId, id, input.kind, input.message, stamp, dueAt),
          audit(REQUEST_OPENED, id, stamp),
        ]);
        return results[0].meta.changes > 0 ? { status: "opened", id, dueAt } : { status: "not_found" };
      } catch (error) {
        const message = String(error);
        if (message.includes("REQUEST_ALREADY_OPEN")) return { status: "already_open" };
        if (message.includes("REQUEST_LOGIN_INVALID")) return { status: "not_found" };
        throw error;
      }
    },

    /** The student withdraws a request that is still open. */
    async cancel(requestId: string, now = new Date()): Promise<CancelRequestOutcome> {
      const stamp = now.toISOString();
      const results = await db.batch([
        db
          .prepare(
            `INSERT INTO data_subject_request_outcomes
               (request_id, organization_id, outcome, note, decided_by_user_id, created_at)
             SELECT r.id, r.organization_id, 'CANCELLED', NULL, ?1, ?3 FROM data_subject_requests r
             WHERE r.id = ?2 AND r.requested_by_user_id = ?1 AND ${linked("r")} AND ${noOutcome("r")}`,
          )
          .bind(userId, requestId, stamp),
        audit(REQUEST_CANCELLED, requestId, stamp),
      ]);
      return results[0].meta.changes > 0 ? { status: "cancelled" } : { status: "not_open" };
    },
  };
}

/**
 * The professional's side. `bucket` is the private photo storage; it is needed only to erase photos
 * and is the storage binding itself, whether or not new photos are being accepted.
 */
export function dataRequestsFor(db: D1Database, context: AuthenticatedContext | null, bucket: R2Bucket | null = null) {
  const { userId, organizationId } = assertContext(context);
  // ?1 organization, ?2 acting professional.
  const reach = (alias: string) => `EXISTS (SELECT 1 FROM students s
    WHERE s.organization_id = ${alias}.organization_id AND s.id = ${alias}.student_id
      AND ${activeUser("?2")} AND ${technicalAccessExists("s", "?2")})`;
  const audit = (action: string, requestId: string, stamp: string) =>
    db
      .prepare(
        `INSERT INTO access_audit_events (id, organization_id, actor_user_id, action, subject_id, created_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE (SELECT changes()) > 0`,
      )
      .bind(crypto.randomUUID(), organizationId, userId, action, requestId, stamp);
  const outcomeInsert = (outcome: string, noteParam: string) =>
    `INSERT INTO data_subject_request_outcomes (request_id, organization_id, outcome, note, decided_by_user_id, created_at)
     SELECT r.id, r.organization_id, '${outcome}', ${noteParam}, ?2, ?4 FROM data_subject_requests r
     WHERE r.organization_id = ?1 AND r.id = ?3 AND ${reach("r")} AND ${noOutcome("r")}`;

  return {
    /** The requests nobody answered yet, across the students this professional attends, the most urgent first. */
    async pending(now = new Date()): Promise<OpenRequestRow[]> {
      const result = await db
        .prepare(
          `SELECT r.id, r.student_id AS studentId, s.display_name AS studentName, r.kind,
             r.created_at AS createdAt, r.due_at AS dueAt
           FROM data_subject_requests r
           JOIN students s ON s.organization_id = r.organization_id AND s.id = r.student_id
           WHERE r.organization_id = ?1 AND ${reach("r")} AND ${noOutcome("r")}
           ORDER BY r.due_at ASC, r.created_at ASC`,
        )
        .bind(organizationId, userId)
        .all<Omit<OpenRequestRow, "overdue">>();
      return result.results.map((row) => ({ ...row, overdue: isOverdue(row.dueAt, now) }));
    },

    /** Every request of one student, the open ones first. */
    async forStudent(studentId: string, now = new Date()): Promise<RequestRow[]> {
      const result = await db
        .prepare(
          `SELECT ${columns} FROM ${joined}
           WHERE r.organization_id = ?1 AND r.student_id = ?3 AND ${reach("r")}
           ORDER BY (o.outcome IS NULL) DESC, r.created_at DESC LIMIT 50`,
        )
        .bind(organizationId, userId, studentId)
        .all<Omit<RequestRow, "overdue">>();
      return result.results.map((row) => withOverdue(row, now));
    },

    /** How many stored photos of the student are still to be erased. */
    async photosStored(studentId: string): Promise<number> {
      const row = await db
        .prepare(
          `SELECT COUNT(*) AS total FROM assessment_photos p
           JOIN assessments a ON a.organization_id = p.organization_id AND a.id = p.assessment_id
           JOIN students s ON s.organization_id = a.organization_id AND s.id = a.student_id
           WHERE a.organization_id = ?1 AND a.student_id = ?3 AND ${activeUser("?2")} AND ${technicalAccessExists("s", "?2")}
             AND NOT EXISTS (SELECT 1 FROM photo_erasures e WHERE e.photo_id = p.id)`,
        )
        .bind(organizationId, userId, studentId)
        .first<{ total: number }>();
      return row?.total ?? 0;
    },

    /**
     * The professional's answer. A request to erase photos is only fulfilled by erasing them
     * (`erasePhotos`); it can be refused here with the reason. Throws a ZodError when a refusal or a
     * partial answer has no explanation.
     */
    async answer(requestId: string, raw: unknown, now = new Date()): Promise<AnswerRequestOutcome> {
      const input = parseAnswer(raw);
      const stamp = now.toISOString();
      const target = await db
        .prepare(
          `SELECT r.kind FROM data_subject_requests r
           WHERE r.organization_id = ?1 AND r.id = ?3 AND ${reach("r")} AND ${noOutcome("r")}`,
        )
        .bind(organizationId, userId, requestId)
        .first<{ kind: RequestKind }>();
      if (!target) return { status: "not_found" };
      if (target.kind === "PHOTOS_DELETION" && input.outcome !== "DECLINED") return { status: "use_erasure" };
      const results = await db.batch([
        db.prepare(outcomeInsert(input.outcome, "?5")).bind(organizationId, userId, requestId, stamp, input.note),
        audit(REQUEST_ANSWERED, requestId, stamp),
      ]);
      return results[0].meta.changes > 0 ? { status: "answered" } : { status: "not_found" };
    },

    /**
     * Carries out a request to erase the photos: for each stored photo of the student, the object is
     * removed from the private storage first and the record of the erasure is written after, so the
     * record never claims more than what was done. A photo that is part of a draft is also deleted;
     * the photo of a recorded assessment keeps its frozen row and is shown as erased. If anything
     * fails the request stays open and can be tried again: what was already erased is not redone.
     * When nothing is left the request is closed as fulfilled.
     */
    async erasePhotos(requestId: string, now = new Date()): Promise<ErasePhotosOutcome> {
      const request = await db
        .prepare(
          `SELECT r.student_id AS studentId FROM data_subject_requests r
           WHERE r.organization_id = ?1 AND r.id = ?3 AND r.kind = 'PHOTOS_DELETION'
             AND ${reach("r")} AND ${noOutcome("r")}`,
        )
        .bind(organizationId, userId, requestId)
        .first<{ studentId: string }>();
      if (!request) return { status: "not_found" };
      if (!bucket) return { status: "storage_unavailable" };

      const photos = await db
        .prepare(
          `SELECT p.id, p.object_key AS objectKey, a.state
           FROM assessment_photos p
           JOIN assessments a ON a.organization_id = p.organization_id AND a.id = p.assessment_id
           WHERE a.organization_id = ?1 AND a.student_id = ?2
             AND NOT EXISTS (SELECT 1 FROM photo_erasures e WHERE e.photo_id = p.id)`,
        )
        .bind(organizationId, request.studentId)
        .all<{ id: string; objectKey: string; state: string }>();

      const stamp = now.toISOString();
      for (const photo of photos.results) {
        // The bytes first: the record below is only written once they are gone.
        await bucket.delete(photo.objectKey);
        const statements: D1PreparedStatement[] = [
          db
            .prepare(
              `INSERT INTO photo_erasures (photo_id, organization_id, assessment_id, view, request_id, erased_by_user_id, erased_at)
               SELECT p.id, p.organization_id, p.assessment_id, p.view, ?3, ?2, ?4
               FROM assessment_photos p WHERE p.id = ?5 AND p.organization_id = ?1`,
            )
            .bind(organizationId, userId, requestId, stamp, photo.id),
          // A draft can be changed, so its row goes too; a recorded assessment keeps its frozen row.
          db
            .prepare(
              `DELETE FROM assessment_photos
               WHERE id = ?2 AND organization_id = ?1
                 AND EXISTS (SELECT 1 FROM photo_erasures e WHERE e.photo_id = assessment_photos.id)
                 AND (SELECT a.state FROM assessments a
                      WHERE a.organization_id = assessment_photos.organization_id AND a.id = assessment_photos.assessment_id) = 'DRAFT'`,
            )
            .bind(organizationId, photo.id),
        ];
        await db.batch(statements);
      }

      // The total under this request, which also counts what an earlier attempt already erased.
      const erased = await db
        .prepare("SELECT COUNT(*) AS total FROM photo_erasures WHERE request_id = ?1")
        .bind(requestId)
        .first<{ total: number }>();
      const count = erased?.total ?? 0;
      const note = count === 0 ? "Nenhuma foto estava guardada." : `${count} foto${count === 1 ? "" : "s"} apagada${count === 1 ? "" : "s"} do armazenamento.`;
      try {
        const results = await db.batch([
          db.prepare(outcomeInsert("FULFILLED", "?5")).bind(organizationId, userId, requestId, stamp, note),
          audit(REQUEST_ANSWERED, requestId, stamp),
        ]);
        return results[0].meta.changes > 0 ? { status: "erased", count } : { status: "not_found" };
      } catch (error) {
        // A photo was added while the others were being erased: the request stays open.
        if (String(error).includes("PHOTOS_STILL_STORED")) return { status: "photos_remain" };
        throw error;
      }
    },
  };
}
