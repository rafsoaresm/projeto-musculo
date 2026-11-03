import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import {
  DEFAULT_CHECKIN_FORM,
  REPLY_MAX,
  checkinDayAllowed,
  parseCheckin,
  parseCheckinForm,
  readAnswers,
  readQuestions,
  sameCheckinForm,
  type CheckinAnswer,
  type CheckinFormShape,
} from "@/modules/checkin/contracts";
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
  /** What this check-in was asked: the version it was answered with (default: everything, as before 0.87). Never the current one. */
  form: CheckinFormShape;
  /** The number of that version; null for the default. */
  formVersion: number | null;
  /** Text answers to the professional's own questions of that version. */
  answers: CheckinAnswer[];
  /** The professional's replies, oldest first. */
  replies: CheckinReply[];
}
export interface CheckinReply {
  id: string;
  body: string;
  /** The professional's display name in the organization (or the account name); null when neither exists. */
  authorName: string | null;
  createdAt: string;
}
export interface StudentCheckin extends CheckinRow {
  editable: boolean;
  /** A reply the student login has not seen yet (the in-app "nova resposta" marker). */
  newReply: boolean;
}
/** The form a check-in is asked with today: the latest version, or the default when the professional never configured one. */
export interface CurrentCheckinForm {
  id: string | null;
  version: number | null;
  createdAt: string | null;
  form: CheckinFormShape;
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
  | { status: "out_of_range" }
  | { status: "conflict" }
  /** The page answered other questions than the ones this check-in is asked with now: nothing is written, nothing is dropped. */
  | { status: "form_changed" }
  | { status: "not_found" };
export type RemoveCheckinOutcome = { status: "removed" } | { status: "locked" } | { status: "not_found" };
export type AcknowledgeCheckinOutcome = { status: "recorded" } | { status: "not_found" };
export type ReplyCheckinOutcome = { status: "recorded"; id: string } | { status: "not_found" };
export type SaveCheckinFormOutcome =
  | { status: "saved"; version: number }
  | { status: "unchanged" }
  | { status: "conflict" }
  | { status: "not_found" };

export const CHECKIN_READ = "CHECKIN_READ";
export const CHECKIN_REPLY = "CHECKIN_REPLY";
export const CHECKIN_FORM_CHANGED = "CHECKIN_FORM_CHANGED";

const columns = `c.id, c.checked_on AS checkedOn, c.effort, c.recovery, c.discomfort_reported AS discomfort,
  c.discomfort_notes AS discomfortNotes, c.notes, c.created_at AS createdAt, c.answers AS answersJson,
  (SELECT MIN(a.created_at) FROM checkin_acknowledgements a WHERE a.checkin_id = c.id) AS acknowledgedAt,
  f.version AS formVersion, f.ask_effort AS askEffort, f.ask_recovery AS askRecovery, f.ask_notes AS askNotes,
  f.questions AS questionsJson`;
const formJoin = `LEFT JOIN checkin_form_versions f ON f.id = c.form_version_id AND f.organization_id = c.organization_id
  AND f.student_id = c.student_id`;
interface RawRow {
  id: string;
  checkedOn: string;
  effort: number | null;
  recovery: number | null;
  discomfort: number;
  discomfortNotes: string | null;
  notes: string | null;
  createdAt: string;
  answersJson: string | null;
  acknowledgedAt: string | null;
  formVersion: number | null;
  askEffort: number | null;
  askRecovery: number | null;
  askNotes: number | null;
  questionsJson: string | null;
}
interface RawForm {
  id: string;
  version: number;
  createdAt: string;
  askEffort: number;
  askRecovery: number;
  askNotes: number;
  questionsJson: string;
}
const formOf = (row: { formVersion: number | null; askEffort: number | null; askRecovery: number | null; askNotes: number | null; questionsJson: string | null }): CheckinFormShape =>
  row.formVersion === null
    ? DEFAULT_CHECKIN_FORM
    : {
        askEffort: Boolean(row.askEffort),
        askRecovery: Boolean(row.askRecovery),
        askNotes: Boolean(row.askNotes),
        questions: readQuestions(row.questionsJson),
      };
const shape = (row: RawRow, replies: CheckinReply[]): CheckinRow => ({
  id: row.id,
  checkedOn: row.checkedOn,
  effort: row.effort,
  recovery: row.recovery,
  discomfort: Boolean(row.discomfort),
  discomfortNotes: row.discomfortNotes,
  notes: row.notes,
  createdAt: row.createdAt,
  acknowledgedAt: row.acknowledgedAt,
  form: formOf(row),
  formVersion: row.formVersion,
  answers: readAnswers(row.answersJson),
  replies,
});
const currentOf = (row: RawForm | null): CurrentCheckinForm =>
  row
    ? {
        id: row.id,
        version: row.version,
        createdAt: row.createdAt,
        form: formOf({ ...row, formVersion: row.version }),
      }
    : { id: null, version: null, createdAt: null, form: DEFAULT_CHECKIN_FORM };
const formColumns = `f.id, f.version, f.created_at AS createdAt, f.ask_effort AS askEffort, f.ask_recovery AS askRecovery,
  f.ask_notes AS askNotes, f.questions AS questionsJson`;
/** Who wrote a reply: the display name of the professional in the organization, or the account name. */
const replyAuthor = `COALESCE(
  (SELECT p.display_name FROM professionals p WHERE p.organization_id = r.organization_id AND p.user_id = r.author_user_id),
  (SELECT au.name FROM auth_user au WHERE au.id = r.author_user_id))`;
/** The day a check-in was made, in Brazil: the correction window is that day, whatever day the check-in is about. */
const madeOn = (createdAt: string) => todayInBrazil(new Date(createdAt));

/**
 * The replies of the given check-ins, grouped by check-in. `allowed` is the authorization condition over alias c (the same as the
 * query that listed the check-ins), so a reply never leaves its check-in's scope.
 */
async function repliesOf(
  db: D1Database,
  ids: string[],
  allowed: string,
  binds: unknown[],
): Promise<Map<string, CheckinReply[]>> {
  const grouped = new Map<string, CheckinReply[]>();
  if (ids.length === 0) return grouped;
  const position = binds.length + 1;
  const result = await db
    .prepare(
      `SELECT r.id, r.checkin_id AS checkinId, r.body, r.created_at AS createdAt, ${replyAuthor} AS authorName
       FROM checkin_replies r
       JOIN student_checkins c ON c.organization_id = r.organization_id AND c.id = r.checkin_id
       WHERE r.checkin_id IN (SELECT value FROM json_each(?${position})) AND ${allowed}
       ORDER BY r.created_at ASC, r.id ASC`,
    )
    .bind(...binds, JSON.stringify(ids))
    .all<CheckinReply & { checkinId: string }>();
  for (const { checkinId, ...reply } of result.results) {
    const list = grouped.get(checkinId) ?? [];
    list.push(reply);
    grouped.set(checkinId, list);
  }
  return grouped;
}

/** The student's side, through the verified link of their own login. */
export function studentCheckinsFor(db: D1Database, userId: string) {
  if (!userId?.trim()) throw new Error("AUTHENTICATION_REQUIRED");
  // ?1 is always the acting login.
  const linked = (alias: string) => `EXISTS (SELECT 1 FROM student_access sa
    WHERE sa.organization_id = ${alias}.organization_id AND sa.student_id = ${alias}.student_id
      AND sa.user_id = ?1 AND sa.revoked_at IS NULL AND ${activeUser("?1")})`;
  const owned = (checkinParam: string) => `EXISTS (SELECT 1 FROM student_checkins c
    WHERE c.id = ${checkinParam} AND c.logged_by_user_id = ?1 AND ${linked("c")})`;
  const frozen = (alias: string) => `(${alias}.discomfort_reported = 1
    OR EXISTS (SELECT 1 FROM checkin_acknowledgements a WHERE a.checkin_id = ${alias}.id)
    OR EXISTS (SELECT 1 FROM checkin_replies r WHERE r.checkin_id = ${alias}.id))`;

  async function currentForm(studentId: string): Promise<CurrentCheckinForm> {
    const row = await db
      .prepare(
        `SELECT ${formColumns} FROM checkin_form_versions f
         WHERE f.student_id = ?2 AND ${linked("f")}
         ORDER BY f.version DESC LIMIT 1`,
      )
      .bind(userId, studentId)
      .first<RawForm>();
    return currentOf(row);
  }

  const api = {
    /** The form the student is asked today (the latest version the professional saved, or the default). */
    currentForm,

    /** The student's own check-ins, newest first, each with the questions it was answered with and the professional's replies. */
    async recent(studentId: string, limit = 14, now = new Date()): Promise<StudentCheckin[]> {
      const result = await db
        .prepare(
          `SELECT ${columns}, c.logged_by_user_id AS loggedBy
           FROM student_checkins c ${formJoin}
           WHERE c.student_id = ?2 AND ${linked("c")}
           ORDER BY c.checked_on DESC, c.created_at DESC LIMIT ?3`,
        )
        .bind(userId, studentId, Math.max(1, Math.min(limit, 60)))
        .all<RawRow & { loggedBy: string }>();
      const replies = await repliesOf(db, result.results.map((row) => row.id), linked("c"), [userId]);
      const seen = await db
        .prepare(`SELECT seen_at AS seenAt FROM checkin_reply_seen WHERE student_id = ?2 AND user_id = ?1`)
        .bind(userId, studentId)
        .first<{ seenAt: string }>();
      const today = todayInBrazil(now);
      return result.results.map(({ loggedBy, ...row }) => {
        const shaped = shape(row, replies.get(row.id) ?? []);
        return {
          ...shaped,
          // Open to correction only on the day it was made, and only while nothing froze it.
          editable:
            loggedBy === userId &&
            !shaped.discomfort &&
            shaped.acknowledgedAt === null &&
            shaped.replies.length === 0 &&
            madeOn(shaped.createdAt) === today,
          newReply: shaped.replies.some((reply) => !seen || reply.createdAt > seen.seenAt),
        };
      });
    },

    /** How many replies of the professional the login has not seen yet (the marker on the student's home). */
    async unseenReplies(studentId: string): Promise<number> {
      const row = await db
        .prepare(
          `SELECT COUNT(*) AS n FROM checkin_replies r
           JOIN student_checkins c ON c.organization_id = r.organization_id AND c.id = r.checkin_id
           WHERE c.student_id = ?2 AND ${linked("c")}
             AND r.created_at > COALESCE((SELECT s.seen_at FROM checkin_reply_seen s WHERE s.student_id = ?2 AND s.user_id = ?1), '')`,
        )
        .bind(userId, studentId)
        .first<{ n: number }>();
      return row?.n ?? 0;
    },

    /**
     * The login has seen the replies up to `upTo`: the newest reply the page actually showed (never later than now), so a reply that
     * arrives after the page was rendered stays new. Without `upTo`, up to now. Only for a student it is linked to.
     */
    async markRepliesSeen(studentId: string, now = new Date(), upTo?: string): Promise<void> {
      const shown = typeof upTo === "string" ? Date.parse(upTo) : Number.NaN;
      const seenAt = new Date(Number.isNaN(shown) ? now.getTime() : Math.min(shown, now.getTime())).toISOString();
      await db
        .prepare(
          `INSERT INTO checkin_reply_seen (organization_id, student_id, user_id, seen_at)
           SELECT sa.organization_id, sa.student_id, ?1, ?3 FROM student_access sa
           WHERE sa.student_id = ?2 AND sa.user_id = ?1 AND sa.revoked_at IS NULL AND ${activeUser("?1")}
           ON CONFLICT (student_id, user_id) DO UPDATE SET seen_at = excluded.seen_at WHERE excluded.seen_at > checkin_reply_seen.seen_at`,
        )
        .bind(userId, studentId, seenAt)
        .run();
    },

    /**
     * Creates the check-in of a day (today, or one of the last days of the window), or corrects it on the day it was made while it is
     * still editable. The answers are read against the form of that check-in: the current one for a new check-in, the one it was
     * answered with for a correction. `formVersion` is the version the page asked with (null for the default); when it is sent and is
     * no longer the one this check-in is read against, nothing is written (form_changed), so no typed answer is silently dropped.
     * Throws a ZodError for a malformed or empty check-in, which nothing is written for.
     */
    async save(studentId: string, raw: unknown, now = new Date()): Promise<SaveCheckinOutcome> {
      const { checkedOn, formVersion, ...rest } = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
      const askedWith = (version: number | null) => formVersion === undefined || formVersion === version;
      const stamp = now.toISOString();
      const today = todayInBrazil(now);
      const day = checkedOn === undefined || checkedOn === null ? today : checkedOn;
      if (typeof day !== "string" || !checkinDayAllowed(day, today)) return { status: "out_of_range" };

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
          `SELECT c.id, c.logged_by_user_id AS loggedBy, c.created_at AS createdAt, ${frozen("c")} AS frozen,
             f.version AS formVersion, f.ask_effort AS askEffort, f.ask_recovery AS askRecovery, f.ask_notes AS askNotes,
             f.questions AS questionsJson
           FROM student_checkins c ${formJoin}
           WHERE c.organization_id = ?3 AND c.student_id = ?1 AND c.checked_on = ?2`,
        )
        .bind(studentId, day, target.organizationId)
        .first<Pick<RawRow, "id" | "createdAt" | "formVersion" | "askEffort" | "askRecovery" | "askNotes" | "questionsJson"> & { loggedBy: string; frozen: number }>();
      if (existing && (existing.loggedBy !== userId || existing.frozen || madeOn(existing.createdAt) !== today))
        return { status: "locked" };

      try {
        if (existing) {
          if (!askedWith(existing.formVersion)) return { status: "form_changed" };
          const input = parseCheckin(rest, formOf(existing));
          const result = await db
            .prepare(
              `UPDATE student_checkins SET effort = ?3, recovery = ?4, discomfort_reported = ?5,
                 discomfort_notes = ?6, notes = ?7, answers = ?8, updated_at = ?9
               WHERE id = ?2 AND ${owned("?2")}`,
            )
            .bind(
              userId, existing.id, input.effort, input.recovery, input.discomfort ? 1 : 0, input.discomfortNotes, input.notes,
              input.answers.length > 0 ? JSON.stringify(input.answers) : null, stamp,
            )
            .run();
          if (result.meta.changes === 0) return { status: "locked" };
          return { status: "saved", id: existing.id, created: false, discomfort: input.discomfort };
        }
        const current = await currentForm(studentId);
        if (!askedWith(current.version)) return { status: "form_changed" };
        const input = parseCheckin(rest, current.form);
        const id = crypto.randomUUID();
        const result = await db
          .prepare(
            `INSERT INTO student_checkins
               (id, organization_id, student_id, checked_on, effort, recovery, discomfort_reported,
                discomfort_notes, notes, logged_by_user_id, created_at, updated_at, form_version_id, answers)
             SELECT ?3, ?4, ?2, ?5, ?6, ?7, ?8, ?9, ?10, ?1, ?11, ?11, ?12, ?13
             WHERE ${activeUser("?1")} AND EXISTS (SELECT 1 FROM student_access sa
               WHERE sa.organization_id = ?4 AND sa.student_id = ?2 AND sa.user_id = ?1 AND sa.revoked_at IS NULL)`,
          )
          .bind(
            userId, studentId, id, target.organizationId, day, input.effort, input.recovery,
            input.discomfort ? 1 : 0, input.discomfortNotes, input.notes, stamp, current.id,
            input.answers.length > 0 ? JSON.stringify(input.answers) : null,
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
          `SELECT c.created_at AS createdAt, ${frozen("c")} AS frozen
           FROM student_checkins c WHERE c.id = ?2 AND ${owned("?2")}`,
        )
        .bind(userId, checkinId)
        .first<{ createdAt: string; frozen: number }>();
      if (!row) return { status: "not_found" };
      if (row.frozen || madeOn(row.createdAt) !== todayInBrazil(now)) return { status: "locked" };
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

  async function currentForm(studentId: string): Promise<CurrentCheckinForm> {
    const row = await db
      .prepare(
        `SELECT ${formColumns} FROM checkin_form_versions f
         WHERE f.organization_id = ?1 AND f.student_id = ?3 AND ${reach("f")}
         ORDER BY f.version DESC LIMIT 1`,
      )
      .bind(organizationId, userId, studentId)
      .first<RawForm>();
    return currentOf(row);
  }

  /** What the student's check-in asks today. Null when the professional does not reach the student. */
  async function form(studentId: string): Promise<CurrentCheckinForm | null> {
    const student = await db
      .prepare(
        `SELECT 1 AS ok FROM students s
         WHERE s.organization_id = ?1 AND s.id = ?3 AND ${activeUser("?2")} AND ${technicalAccessExists("s", "?2")}`,
      )
      .bind(organizationId, userId, studentId)
      .first<{ ok: number }>();
    if (!student) return null;
    return currentForm(studentId);
  }

  return {
    /** The check-ins of one student, newest first, each with the questions it was answered with and the replies. */
    async list(studentId: string, limit = 30): Promise<CheckinRow[]> {
      const result = await db
        .prepare(
          `SELECT ${columns}
           FROM student_checkins c ${formJoin}
           WHERE c.organization_id = ?1 AND c.student_id = ?3 AND ${reach("c")}
           ORDER BY c.checked_on DESC, c.created_at DESC LIMIT ?4`,
        )
        .bind(organizationId, userId, studentId, Math.max(1, Math.min(limit, 100)))
        .all<RawRow>();
      const replies = await repliesOf(
        db,
        result.results.map((row) => row.id),
        `c.organization_id = ?1 AND ${reach("c")}`,
        [organizationId, userId],
      );
      return result.results.map((row) => shape(row, replies.get(row.id) ?? []));
    },

    /** What the student's check-in asks today. Null when the professional does not reach the student. */
    form,

    /**
     * Saves what the student's check-in asks as a new version. Past check-ins keep the version they were answered with; a save that
     * asks the same as the current version writes nothing. `expectedVersion` is the version the editor started from (null for the
     * default): when it is given and someone saved another version since, nothing is written (conflict), so a stale editor never
     * silently undoes the other change. Throws a ZodError for a malformed form.
     */
    async saveForm(
      studentId: string,
      raw: unknown,
      now = new Date(),
      expectedVersion?: number | null,
    ): Promise<SaveCheckinFormOutcome> {
      const current = await form(studentId);
      if (!current) return { status: "not_found" };
      const next = parseCheckinForm(raw);
      if (sameCheckinForm(next, current.form)) return { status: "unchanged" };
      if (expectedVersion !== undefined && expectedVersion !== current.version) return { status: "conflict" };
      const version = (current.version ?? 0) + 1;
      const id = crypto.randomUUID();
      const stamp = now.toISOString();
      try {
        const results = await db.batch([
          db
            .prepare(
              `INSERT INTO checkin_form_versions
                 (id, organization_id, student_id, version, ask_effort, ask_recovery, ask_notes, questions, created_by_user_id, created_at)
               SELECT ?4, s.organization_id, s.id, ?5, ?6, ?7, ?8, ?9, ?2, ?10
               FROM students s
               WHERE s.organization_id = ?1 AND s.id = ?3 AND ${activeUser("?2")} AND ${technicalAccessExists("s", "?2")}`,
            )
            .bind(
              organizationId, userId, studentId, id, version, next.askEffort ? 1 : 0, next.askRecovery ? 1 : 0,
              next.askNotes ? 1 : 0, JSON.stringify(next.questions), stamp,
            ),
          db
            .prepare(
              `INSERT INTO access_audit_events (id, organization_id, actor_user_id, action, subject_id, created_at)
               SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE EXISTS (SELECT 1 FROM checkin_form_versions WHERE id = ?7)`,
            )
            .bind(crypto.randomUUID(), organizationId, userId, CHECKIN_FORM_CHANGED, studentId, stamp, id),
        ]);
        return results[0].meta.changes > 0 ? { status: "saved", version } : { status: "not_found" };
      } catch (error) {
        if (String(error).includes("UNIQUE")) return { status: "conflict" };
        throw error;
      }
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
     * A reply to the student, in text. It is shown to the student with who wrote it and when; it is never changed nor deleted. A reply
     * means the check-in was read: when nobody had registered the reading, it is registered with it (without a note). It changes no
     * plan and sends no e-mail.
     */
    async reply(checkinId: string, body: unknown, now = new Date()): Promise<ReplyCheckinOutcome> {
      const text = typeof body === "string" ? body.trim() : "";
      if (!text) throw new Error("REPLY_EMPTY");
      if (text.length > REPLY_MAX) throw new Error("REPLY_TOO_LONG");
      const stamp = now.toISOString();
      const id = crypto.randomUUID();
      const results = await db.batch([
        db
          .prepare(
            `INSERT INTO checkin_replies (id, organization_id, checkin_id, author_user_id, body, created_at)
             SELECT ?4, c.organization_id, c.id, ?2, ?5, ?6
             FROM student_checkins c
             WHERE c.organization_id = ?1 AND c.id = ?3 AND ${reach("c")}`,
          )
          .bind(organizationId, userId, checkinId, id, text, stamp),
        db
          .prepare(
            `INSERT INTO checkin_acknowledgements (id, organization_id, checkin_id, user_id, note, created_at)
             SELECT ?1, ?2, ?3, ?4, NULL, ?5
             WHERE EXISTS (SELECT 1 FROM checkin_replies WHERE id = ?6)
               AND NOT EXISTS (SELECT 1 FROM checkin_acknowledgements a WHERE a.checkin_id = ?3)`,
          )
          .bind(crypto.randomUUID(), organizationId, checkinId, userId, stamp, id),
        db
          .prepare(
            `INSERT INTO access_audit_events (id, organization_id, actor_user_id, action, subject_id, created_at)
             SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE EXISTS (SELECT 1 FROM checkin_replies WHERE id = ?7)`,
          )
          .bind(crypto.randomUUID(), organizationId, userId, CHECKIN_REPLY, checkinId, stamp, id),
      ]);
      return results[0].meta.changes > 0 ? { status: "recorded", id } : { status: "not_found" };
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
