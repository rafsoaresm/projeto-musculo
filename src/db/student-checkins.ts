import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { parseCheckin } from "@/modules/checkin/contracts";
import { todayInBrazil } from "@/modules/execucao/contracts";
import { activeUser, assertContext, technicalAccessExists, type AuthenticatedContext } from "./students";

/**
 * The student's check-in: how they feel, in their own numbers and words. It is a record next to the
 * plan, not part of it: nothing here reads a check-in to change a workout, approve or release
 * anything, and it is not scored. The professional reads it and decides.
 *
 * Two sides, like the workout log. The student reaches only the check-ins of the students their own
 * login is linked to; the professional reaches only those of students they have an active technical
 * assignment over. A check-in with a report of discomfort, or one the professional has read, is
 * frozen; any other can be corrected or deleted by the student on the day it was made.
 */
export interface CheckinRow {
  id: string;
  checkedOn: string;
  effort: number | null;
  recovery: number | null;
  discomfort: boolean;
  discomfortNotes: string | null;
  notes: string | null;
  createdAt: string;
  /** When the professional first read it; null while unread. */
  acknowledgedAt: string | null;
}
export interface StudentCheckin extends CheckinRow {
  editable: boolean;
}
export interface PendingCheckinRow {
  checkinId: string;
  studentId: string;
  studentName: string;
  checkedOn: string;
  discomfort: boolean;
}
export type SaveCheckinOutcome =
  | { status: "saved"; id: string; created: boolean; discomfort: boolean }
  | { status: "locked" }
  | { status: "conflict" }
  | { status: "not_found" };
export type RemoveCheckinOutcome = { status: "removed" } | { status: "locked" } | { status: "not_found" };
export type AcknowledgeCheckinOutcome = { status: "recorded" } | { status: "not_found" };

export const CHECKIN_READ = "CHECKIN_READ";

const columns = `c.id, c.checked_on AS checkedOn, c.effort, c.recovery, c.discomfort_reported AS discomfort,
  c.discomfort_notes AS discomfortNotes, c.notes, c.created_at AS createdAt,
  (SELECT MIN(a.created_at) FROM checkin_acknowledgements a WHERE a.checkin_id = c.id) AS acknowledgedAt`;
type RawRow = Omit<CheckinRow, "discomfort"> & { discomfort: number };
const shape = ({ discomfort, ...row }: RawRow): CheckinRow => ({ ...row, discomfort: Boolean(discomfort) });

/** The student's side, through the verified link of their own login. */
export function studentCheckinsFor(db: D1Database, userId: string) {
  if (!userId?.trim()) throw new Error("AUTHENTICATION_REQUIRED");
  // ?1 is always the acting login.
  const linked = (alias: string) => `EXISTS (SELECT 1 FROM student_access sa
    WHERE sa.organization_id = ${alias}.organization_id AND sa.student_id = ${alias}.student_id
      AND sa.user_id = ?1 AND sa.revoked_at IS NULL AND ${activeUser("?1")})`;
  const owned = (checkinParam: string) => `EXISTS (SELECT 1 FROM student_checkins c
    WHERE c.id = ${checkinParam} AND c.logged_by_user_id = ?1 AND ${linked("c")})`;

  const api = {
    /** The student's own check-ins, newest first. */
    async recent(studentId: string, limit = 14, now = new Date()): Promise<StudentCheckin[]> {
      const result = await db
        .prepare(
          `SELECT ${columns}, c.logged_by_user_id AS loggedBy
           FROM student_checkins c
           WHERE c.student_id = ?2 AND ${linked("c")}
           ORDER BY c.checked_on DESC, c.created_at DESC LIMIT ?3`,
        )
        .bind(userId, studentId, Math.max(1, Math.min(limit, 60)))
        .all<RawRow & { loggedBy: string }>();
      return result.results.map(({ loggedBy, ...row }) => {
        const shaped = shape(row);
        return {
          ...shaped,
          // Only the check-in of today is open to correction, and only while nothing froze it.
          editable:
            loggedBy === userId && !shaped.discomfort && shaped.acknowledgedAt === null && shaped.checkedOn === todayInBrazil(now),
        };
      });
    },

    /**
     * Creates the check-in of today, or corrects it while it is still editable. Throws a ZodError for a
     * malformed or empty check-in, which nothing is written for.
     */
    async save(studentId: string, raw: unknown, now = new Date()): Promise<SaveCheckinOutcome> {
      const input = parseCheckin(raw);
      const stamp = now.toISOString();
      const today = todayInBrazil(now);

      const target = await db
        .prepare(
          `SELECT sa.organization_id AS organizationId
           FROM student_access sa
           JOIN students s ON s.organization_id = sa.organization_id AND s.id = sa.student_id
           WHERE sa.user_id = ?1 AND sa.student_id = ?2 AND sa.revoked_at IS NULL AND ${activeUser("?1")}`,
        )
        .bind(userId, studentId)
        .first<{ organizationId: string }>();
      if (!target) return { status: "not_found" };

      const existing = await db
        .prepare(
          `SELECT c.id, c.discomfort_reported AS discomfort, c.logged_by_user_id AS loggedBy,
             EXISTS (SELECT 1 FROM checkin_acknowledgements a WHERE a.checkin_id = c.id) AS acknowledged
           FROM student_checkins c WHERE c.student_id = ?1 AND c.checked_on = ?2`,
        )
        .bind(studentId, today)
        .first<{ id: string; discomfort: number; loggedBy: string; acknowledged: number }>();
      if (existing && (existing.loggedBy !== userId || existing.discomfort || existing.acknowledged))
        return { status: "locked" };

      try {
        if (existing) {
          const result = await db
            .prepare(
              `UPDATE student_checkins SET effort = ?3, recovery = ?4, discomfort_reported = ?5,
                 discomfort_notes = ?6, notes = ?7, updated_at = ?8
               WHERE id = ?2 AND ${owned("?2")}`,
            )
            .bind(userId, existing.id, input.effort, input.recovery, input.discomfort ? 1 : 0, input.discomfortNotes, input.notes, stamp)
            .run();
          if (result.meta.changes === 0) return { status: "locked" };
          return { status: "saved", id: existing.id, created: false, discomfort: input.discomfort };
        }
        const id = crypto.randomUUID();
        const result = await db
          .prepare(
            `INSERT INTO student_checkins
               (id, organization_id, student_id, checked_on, effort, recovery, discomfort_reported,
                discomfort_notes, notes, logged_by_user_id, created_at, updated_at)
             SELECT ?3, ?4, ?2, ?5, ?6, ?7, ?8, ?9, ?10, ?1, ?11, ?11
             WHERE ${activeUser("?1")} AND EXISTS (SELECT 1 FROM student_access sa
               WHERE sa.organization_id = ?4 AND sa.student_id = ?2 AND sa.user_id = ?1 AND sa.revoked_at IS NULL)`,
          )
          .bind(
            userId, studentId, id, target.organizationId, today, input.effort, input.recovery,
            input.discomfort ? 1 : 0, input.discomfortNotes, input.notes, stamp,
          )
          .run();
        if (result.meta.changes === 0) return { status: "not_found" };
        return { status: "saved", id, created: true, discomfort: input.discomfort };
      } catch (error) {
        const message = String(error);
        if (message.includes("CHECKIN_FROZEN")) return { status: "locked" };
        if (message.includes("UNIQUE")) return { status: "conflict" };
        throw error;
      }
    },

    async remove(checkinId: string, now = new Date()): Promise<RemoveCheckinOutcome> {
      const row = await db
        .prepare(
          `SELECT c.discomfort_reported AS discomfort, c.checked_on AS checkedOn,
             EXISTS (SELECT 1 FROM checkin_acknowledgements a WHERE a.checkin_id = c.id) AS acknowledged
           FROM student_checkins c WHERE c.id = ?2 AND ${owned("?2")}`,
        )
        .bind(userId, checkinId)
        .first<{ discomfort: number; checkedOn: string; acknowledged: number }>();
      if (!row) return { status: "not_found" };
      if (row.discomfort || row.acknowledged || row.checkedOn !== todayInBrazil(now)) return { status: "locked" };
      try {
        const result = await db
          .prepare(`DELETE FROM student_checkins WHERE id = ?2 AND ${owned("?2")}`)
          .bind(userId, checkinId)
          .run();
        return result.meta.changes > 0 ? { status: "removed" } : { status: "not_found" };
      } catch (error) {
        if (String(error).includes("CHECKIN_FROZEN")) return { status: "locked" };
        throw error;
      }
    },
  };
  return api;
}

/** The professional's side: reads what the student said, with an active technical assignment. */
export function checkinsFor(db: D1Database, context: AuthenticatedContext | null) {
  const { userId, organizationId } = assertContext(context);
  // ?1 organization, ?2 acting professional.
  const reach = (alias: string) => `EXISTS (SELECT 1 FROM students s
    WHERE s.organization_id = ${alias}.organization_id AND s.id = ${alias}.student_id
      AND ${activeUser("?2")} AND ${technicalAccessExists("s", "?2")})`;

  return {
    /** The check-ins of one student, newest first. */
    async list(studentId: string, limit = 30): Promise<CheckinRow[]> {
      const result = await db
        .prepare(
          `SELECT ${columns}
           FROM student_checkins c
           WHERE c.organization_id = ?1 AND c.student_id = ?3 AND ${reach("c")}
           ORDER BY c.checked_on DESC, c.created_at DESC LIMIT ?4`,
        )
        .bind(organizationId, userId, studentId, Math.max(1, Math.min(limit, 100)))
        .all<RawRow>();
      return result.results.map(shape);
    },

    /**
     * The reading of a check-in: who read it and when, with an optional note. It changes nothing else.
     * Reading it again adds another line; the first one is what the student sees as "read".
     */
    async acknowledge(checkinId: string, note: unknown, now = new Date()): Promise<AcknowledgeCheckinOutcome> {
      const text = typeof note === "string" ? note.trim() : "";
      if (text.length > 500) throw new Error("ACKNOWLEDGEMENT_NOTE_TOO_LONG");
      const stamp = now.toISOString();
      const statements: D1PreparedStatement[] = [
        db
          .prepare(
            `INSERT INTO checkin_acknowledgements (id, organization_id, checkin_id, user_id, note, created_at)
             SELECT ?4, c.organization_id, c.id, ?2, ?5, ?6
             FROM student_checkins c
             WHERE c.organization_id = ?1 AND c.id = ?3 AND ${reach("c")}`,
          )
          .bind(organizationId, userId, checkinId, crypto.randomUUID(), text || null, stamp),
        db
          .prepare(
            `INSERT INTO access_audit_events (id, organization_id, actor_user_id, action, subject_id, created_at)
             SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE (SELECT changes()) > 0`,
          )
          .bind(crypto.randomUUID(), organizationId, userId, CHECKIN_READ, checkinId, stamp),
      ];
      const results = await db.batch(statements);
      return results[0].meta.changes > 0 ? { status: "recorded" } : { status: "not_found" };
    },

    /**
     * The check-ins no professional has read yet, in the order they are shown: those that report a
     * discomfort first, then the others, each group from the newest. It is only an order: nothing is
     * scored and nothing is decided by it.
     */
    async pending(): Promise<PendingCheckinRow[]> {
      const result = await db
        .prepare(
          `SELECT c.id AS checkinId, c.student_id AS studentId, s.display_name AS studentName,
             c.checked_on AS checkedOn, c.discomfort_reported AS discomfort
           FROM student_checkins c
           JOIN students s ON s.organization_id = c.organization_id AND s.id = c.student_id
           WHERE c.organization_id = ?1 AND ${reach("c")}
             AND NOT EXISTS (SELECT 1 FROM checkin_acknowledgements a WHERE a.checkin_id = c.id)
           ORDER BY c.discomfort_reported DESC, c.checked_on DESC, c.created_at DESC`,
        )
        .bind(organizationId, userId)
        .all<Omit<PendingCheckinRow, "discomfort"> & { discomfort: number }>();
      return result.results.map(({ discomfort, ...row }) => ({ ...row, discomfort: Boolean(discomfort) }));
    },
  };
}
