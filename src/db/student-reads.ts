import type { D1Database } from "@cloudflare/workers-types";
import { activeUser, assertContext, technicalAccessExists, type AuthenticatedContext } from "./students";

/**
 * The trail of reads of a student's data by professionals (PENDENCIAS B9, slice 0.88). One row each time a professional opens the
 * student's record, an assessment, a plan revision, the postural photos or a PDF: who, which student, what kind, when. Never the content.
 *
 * Organization, person and student come from the verified session and from the record the page has just loaded through its own
 * repository; the row is written only when the professional still has technical access (an active care assignment) over that student, in
 * the same statement. Opening the same kind of the same student again within READ_DEDUP_MINUTES adds nothing, so a page that redraws
 * itself (the autosave of an assessment, a tab, a reload) or the several photos of one assessment leave one line.
 *
 * Who sees it: the OWNER or MANAGER of the organization, on the student's page, for students they reach; and the student, in "Minha conta",
 * for the students linked to their own login. Nothing is ever deleted: retention (J3, J9, B12) is not decided.
 */
export const STUDENT_READ_KINDS = ["STUDENT_RECORD", "ASSESSMENT", "PLAN_REVISION", "PHOTOS", "ASSESSMENT_PDF", "PLAN_PDF"] as const;
export type StudentReadKind = (typeof STUDENT_READ_KINDS)[number];

export const STUDENT_READ_LABEL: Record<StudentReadKind, string> = {
  STUDENT_RECORD: "Ficha do aluno",
  ASSESSMENT: "Avaliação física",
  PLAN_REVISION: "Plano de treino",
  PHOTOS: "Fotos posturais",
  ASSESSMENT_PDF: "PDF da avaliação física",
  PLAN_PDF: "PDF do plano de treino",
};

/** The same kinds as the student reads them about themselves in "Minha conta": no third person. */
export const OWN_STUDENT_READ_LABEL: Record<StudentReadKind, string> = { ...STUDENT_READ_LABEL, STUDENT_RECORD: "Ficha" };

/** A product choice of this slice, not a rule of anyone else: one line per person, student and kind in this interval. */
export const READ_DEDUP_MINUTES = 10;
const MAX_ROWS = 50;

export interface StudentRead {
  kind: StudentReadKind;
  /** ISO timestamp. */
  at: string;
  /** The professional's display name in that organization, as it is now; null when they have none. */
  professionalName: string | null;
}
export interface OwnStudentRead extends StudentRead {
  organizationName: string;
  studentId: string;
}

/**
 * Leaves the line for one read. Returns whether a line was written (false: a line of the same kind is recent, or there is no technical
 * access). It never throws to the page: a read that could not be recorded is logged, the page is still shown.
 */
export async function recordStudentRead(
  db: D1Database,
  context: AuthenticatedContext | null,
  studentId: string,
  kind: StudentReadKind,
  now = new Date(),
): Promise<boolean> {
  const { userId, organizationId } = assertContext(context);
  if (!STUDENT_READ_KINDS.includes(kind) || !studentId) return false;
  const since = new Date(now.getTime() - READ_DEDUP_MINUTES * 60_000).toISOString();
  try {
    const result = await db
      .prepare(
        `INSERT INTO student_data_reads (id, organization_id, student_id, actor_user_id, kind, created_at)
         SELECT ?1, s.organization_id, s.id, ?3, ?5, ?6 FROM students s
         WHERE s.organization_id = ?2 AND s.id = ?4 AND ${activeUser("?3")} AND ${technicalAccessExists("s", "?3")}
           AND NOT EXISTS (SELECT 1 FROM student_data_reads r
             WHERE r.actor_user_id = ?3 AND r.student_id = s.id AND r.organization_id = s.organization_id
               AND r.kind = ?5 AND r.created_at > ?7)`,
      )
      .bind(crypto.randomUUID(), organizationId, userId, studentId, kind, now.toISOString(), since)
      .run();
    return result.meta.changes > 0;
  } catch {
    console.error("STUDENT_READ_AUDIT_FAILED");
    return false;
  }
}

/** Whether this role sees the reads of the students it reaches. */
export const seesStudentReads = (role: string) => role === "OWNER" || role === "MANAGER";

/**
 * The latest reads of one student, for the organization's OWNER or MANAGER who reaches the student. Anyone else (another role, another
 * organization, no care assignment) gets an empty list from the same statement.
 */
export async function readsOfStudent(db: D1Database, context: AuthenticatedContext | null, studentId: string): Promise<StudentRead[]> {
  const { userId, organizationId } = assertContext(context);
  const result = await db
    .prepare(
      `SELECT r.kind, r.created_at AS at, p.display_name AS professionalName
       FROM student_data_reads r
       JOIN students s ON s.organization_id = r.organization_id AND s.id = r.student_id
       LEFT JOIN professionals p ON p.organization_id = r.organization_id AND p.user_id = r.actor_user_id
       WHERE r.organization_id = ?1 AND r.student_id = ?3 AND ${activeUser("?2")}
         AND EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = ?1 AND m.user_id = ?2
           AND m.revoked_at IS NULL AND m.role IN ('OWNER','MANAGER'))
         AND ${technicalAccessExists("s", "?2")}
       ORDER BY r.created_at DESC, r.id LIMIT ${MAX_ROWS}`,
    )
    .bind(organizationId, userId, studentId)
    .all<StudentRead>();
  return result.results;
}

/**
 * "Quem acessou os meus dados": the latest reads of the students linked to this login by an active invitation-made link. The students
 * come from the link, never from the request.
 */
export async function readsOfOwnData(db: D1Database, userId: string): Promise<OwnStudentRead[]> {
  if (!userId?.trim()) throw new Error("A verified session is required.");
  const result = await db
    .prepare(
      `SELECT r.kind, r.created_at AS at, p.display_name AS professionalName, o.name AS organizationName, r.student_id AS studentId
       FROM student_data_reads r
       JOIN student_access sa ON sa.organization_id = r.organization_id AND sa.student_id = r.student_id
       JOIN organizations o ON o.id = r.organization_id
       LEFT JOIN professionals p ON p.organization_id = r.organization_id AND p.user_id = r.actor_user_id
       WHERE sa.user_id = ?1 AND sa.revoked_at IS NULL AND ${activeUser("?1")}
       ORDER BY r.created_at DESC, r.id LIMIT ${MAX_ROWS}`,
    )
    .bind(userId)
    .all<OwnStudentRead>();
  return result.results;
}
