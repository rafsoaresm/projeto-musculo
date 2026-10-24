import type { D1Database } from "@cloudflare/workers-types";
import {
  assembleDelivered,
  type DeliveredRevisionRow,
  type StudentTrainingPlan,
} from "./student-plan";
import {
  activeUser,
  assertContext,
  technicalAccessExists,
  type AuthenticatedContext,
} from "./students";

/**
 * A delivered revision read as a document (for the PDF). Delivered revisions are immutable, so
 * any of them can be regenerated later, not only the newest one. Only a delivered revision
 * qualifies: a draft, a ready or an approved one has not been handed to the student, and a file
 * would be a way around that step.
 */
export interface PlanDocumentSource {
  studentId: string;
  studentName: string;
  organizationName: string;
  plan: StudentTrainingPlan;
}

export const PDF_DOWNLOADED = "PLAN_PDF_DOWNLOADED";

/** Who downloaded which revision and when. Never the content. */
export async function recordPdfDownload(
  db: D1Database,
  event: { organizationId: string; actorUserId: string; revisionId: string },
  now = new Date(),
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO access_audit_events (id, organization_id, actor_user_id, action, subject_id, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    )
    .bind(
      crypto.randomUUID(),
      event.organizationId,
      event.actorUserId,
      PDF_DOWNLOADED,
      event.revisionId,
      now.toISOString(),
    )
    .run();
}

export function planDocumentsFor(db: D1Database, context: AuthenticatedContext | null) {
  const { userId, organizationId } = assertContext(context);
  return {
    /** The delivered revision, for a professional with an active technical assignment. */
    async delivered(planId: string, revisionId: string): Promise<PlanDocumentSource | null> {
      const row = await db
        .prepare(
          `SELECT p.id AS planId, p.title, r.id AS revisionId, r.organization_id AS organizationId,
             r.revision_number AS revisionNumber, r.delivered_at AS deliveredAt,
             (SELECT pr.display_name FROM professionals pr
               WHERE pr.organization_id = r.organization_id
                 AND pr.user_id = r.delivered_by_user_id) AS deliveredBy,
             r.start_date AS startDate, r.end_date AS endDate, r.schedule_json AS scheduleJson,
             s.id AS studentId, s.display_name AS studentName, o.name AS organizationName
           FROM training_plans p
           JOIN plan_revisions r ON r.organization_id = p.organization_id AND r.plan_id = p.id
           JOIN students s ON s.organization_id = p.organization_id AND s.id = p.student_id
           JOIN organizations o ON o.id = p.organization_id
           WHERE p.organization_id = ?1 AND p.id = ?3 AND r.id = ?4 AND r.state = 'DELIVERED'
             AND ${activeUser("?2")} AND ${technicalAccessExists("s", "?2")}`,
        )
        .bind(organizationId, userId, planId, revisionId)
        .first<
          DeliveredRevisionRow & { studentId: string; studentName: string; organizationName: string }
        >();
      if (!row) return null;
      const [plan] = await assembleDelivered(db, [row]);
      return {
        studentId: row.studentId,
        studentName: row.studentName,
        organizationName: row.organizationName,
        plan,
      };
    },
  };
}
