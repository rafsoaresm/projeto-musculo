import type { D1Database, R2Bucket, R2ObjectBody } from "@cloudflare/workers-types";
import { isPhotoView, type PhotoView } from "@/modules/avaliacoes/photos";
import { isModule } from "@/modules/avaliacoes/catalog";
import type { ReportInput, ReportPhoto } from "@/modules/avaliacoes/v2/report";
import { readEnabledParts } from "@/modules/avaliacoes/v2/template";
import type { EvolutionSource } from "@/modules/avaliacoes/v2/evolution";
import { COMPOSITION_MODULE, readComposition } from "@/modules/avaliacoes/v2/composition";
import { CONCLUSION_MODULE, readConclusion } from "@/modules/avaliacoes/v2/conclusion";
import { MOVEMENT_MODULE, readMovement } from "@/modules/avaliacoes/v2/flexitest";
import { TESTS_MODULE, readTests } from "@/modules/avaliacoes/v2/physical-tests";
import { POSTURE_MODULE, readPosture } from "@/modules/avaliacoes/v2/posture";
import { PROFILE_MODULE, SCREENING_MODULE, readProfile, readScreening } from "@/modules/avaliacoes/v2/screening";
import { reviewedSql, riskSql, type ResultRow } from "./assessments";
import { activeUser, assertContext, technicalAccessExists, type AuthenticatedContext } from "./students";

/**
 * The report (PDF) of a recorded Avaliação Física, read for the professional who has the student under active technical care, and for the login
 * linked to that student (user's decisions of 02/11/2026 and 03/11/2026: the report goes to both, with no further lock). Only a recorded
 * assessment of the new format qualifies: a draft is not a record, and the earlier format has its own screen and no report. Every query is gated
 * by the organization and the reach of who asks (care assignment for the professional, the active link for the student); nothing comes from the
 * request besides the ids. A download is recorded in the audit trail (who, which, when; never the content).
 */
export const ASSESSMENT_PDF_DOWNLOADED = "ASSESSMENT_PDF_DOWNLOADED";

/** One recorded assessment as the student's list shows it. */
export interface StudentAssessmentItem {
  id: string;
  assessedOn: string;
  kind: "INITIAL" | "REASSESSMENT";
  recordedAt: string | null;
  amendsAssessmentId: string | null;
  amendedById: string | null;
}

type HeadRow = {
  id: string;
  organizationId: string;
  studentName: string;
  organizationName: string;
  assessedOn: string;
  kind: "INITIAL" | "REASSESSMENT";
  recordedAt: string | null;
  recordedByName: string | null;
  riskStatus: "CLEAR" | "REVIEW_REQUIRED";
  reviewed: number;
  amendsAssessmentId: string | null;
  amendReason: string | null;
  amendedById: string | null;
  amendedAt: string | null;
  amendsAssessedOn: string | null;
  templateVersion: number | null;
  templateName: string | null;
  enabled: string | null;
};

const headColumns = `a.id, a.organization_id AS organizationId, s.display_name AS studentName, o.name AS organizationName,
  a.assessed_on AS assessedOn, a.kind, a.recorded_at AS recordedAt,
  (SELECT p.display_name FROM professionals p WHERE p.organization_id = a.organization_id AND p.user_id = a.recorded_by_user_id) AS recordedByName,
  ${riskSql("a")} AS riskStatus, ${reviewedSql("a")} AS reviewed,
  a.amends_assessment_id AS amendsAssessmentId, a.amend_reason AS amendReason,
  (SELECT n.id FROM assessments n WHERE n.organization_id = a.organization_id AND n.amends_assessment_id = a.id AND n.state = 'RECORDED'
     ORDER BY n.recorded_at DESC LIMIT 1) AS amendedById,
  (SELECT n.recorded_at FROM assessments n WHERE n.organization_id = a.organization_id AND n.amends_assessment_id = a.id AND n.state = 'RECORDED'
     ORDER BY n.recorded_at DESC LIMIT 1) AS amendedAt,
  (SELECT o2.assessed_on FROM assessments o2 WHERE o2.organization_id = a.organization_id AND o2.id = a.amends_assessment_id) AS amendsAssessedOn,
  a.template_version AS templateVersion, a.enabled_modules AS enabled,
  (SELECT v.name FROM assessment_form_template_versions v
     WHERE v.organization_id = a.organization_id AND v.template_id = a.template_id AND v.version = a.template_version) AS templateName`;

function parseJson(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/** The parse of the flags of a result (a JSON array of strings; anything else reads as none). */
const flagsOf = (raw: string | null) => {
  const parsed = parseJson(raw);
  return Array.isArray(parsed) ? parsed.filter((flag): flag is string => typeof flag === "string") : [];
};

/**
 * The report with, when the private photo storage is given, the bytes of the stored posture photos for the PDF (slice 0.86). The storage keys
 * never leave this module.
 */
export type AssessmentReportSource = ReportInput & { photoImages?: Partial<Record<PhotoView, Uint8Array>> };

/** The bytes of the stored photos (not erased) of the index, from the private storage; one that cannot be read is left out. */
async function photoBytes(bucket: R2Bucket, rows: readonly (ReportPhoto & { key: string })[]) {
  const images: Partial<Record<PhotoView, Uint8Array>> = {};
  await Promise.all(
    rows
      .filter((row) => row.erasedAt === null)
      .map(async (row) => {
        try {
          const object = await bucket.get(row.key);
          if (object) images[row.view] = new Uint8Array(await object.arrayBuffer());
        } catch {
          // Unreadable: the report says "Foto indisponível no momento." for it.
        }
      }),
  );
  return images;
}

/**
 * Sections, results, posture photos and the PAR-Q decider of an assessment whose head came from a gated query (organization and reach already
 * checked).
 */
async function assemble(db: D1Database, head: HeadRow, bucket: R2Bucket | null = null): Promise<AssessmentReportSource> {
  const [sections, results, photoRows] = await Promise.all([
    db
      .prepare(`SELECT module, payload FROM assessment_sections WHERE organization_id = ?1 AND assessment_id = ?2`)
      .bind(head.organizationId, head.id)
      .all<{ module: string; payload: string }>(),
    db
      .prepare(
        `SELECT r.code, r.value, r.unit, r.method, r.formula_version AS formulaVersion, r.inputs, r.flags
         FROM assessment_results r WHERE r.organization_id = ?1 AND r.assessment_id = ?2 ORDER BY r.rowid`,
      )
      .bind(head.organizationId, head.id)
      .all<{ code: string; value: number | null; unit: string | null; method: string; formulaVersion: string | null; inputs: string | null; flags: string | null }>(),
    db
      .prepare(
        `SELECT p.view, p.created_at AS createdAt, e.erased_at AS erasedAt, p.object_key AS key
         FROM assessment_photos p LEFT JOIN photo_erasures e ON e.photo_id = p.id
         WHERE p.organization_id = ?1 AND p.assessment_id = ?2
         ORDER BY CASE p.view WHEN 'ANTERIOR' THEN 1 WHEN 'LATERAL_LEFT' THEN 2 WHEN 'LATERAL_RIGHT' THEN 3 ELSE 4 END`,
      )
      .bind(head.organizationId, head.id)
      .all<ReportPhoto & { key: string }>(),
  ]);
  const photoIndex = photoRows.results.filter((row) => isPhotoView(row.view));
  const payloads = new Map(sections.results.filter((row) => isModule(row.module)).map((row) => [row.module, parseJson(row.payload)]));
  const section = <T,>(module: string, read: (raw: unknown) => T): T | null => (payloads.has(module) ? read(payloads.get(module)) : null);
  const screening = section(SCREENING_MODULE, readScreening);
  const reviewer = screening?.parq.professionalReview.reviewerUserId;
  const decidedBy = reviewer
    ? ((
        await db
          .prepare(`SELECT p.display_name AS name FROM professionals p WHERE p.organization_id = ?1 AND p.user_id = ?2`)
          .bind(head.organizationId, reviewer)
          .first<{ name: string | null }>()
      )?.name ?? null)
    : null;
  return {
    assessment: {
      id: head.id,
      assessedOn: head.assessedOn,
      kind: head.kind,
      recordedAt: head.recordedAt,
      recordedByName: head.recordedByName,
      riskStatus: head.riskStatus,
      reviewed: Boolean(head.reviewed),
      amendsAssessmentId: head.amendsAssessmentId,
      amendReason: head.amendReason,
      amendedById: head.amendedById,
    },
    amendsAssessedOn: head.amendsAssessedOn,
    amendedAt: head.amendedAt,
    studentName: head.studentName,
    organizationName: head.organizationName,
    results: results.results.map(
      (row): ResultRow => ({
        code: row.code,
        value: row.value,
        unit: row.unit,
        method: row.method,
        formulaVersion: row.formulaVersion,
        inputs: (parseJson(row.inputs) as Record<string, unknown> | null) ?? null,
        flags: flagsOf(row.flags),
      }),
    ),
    profile: section(PROFILE_MODULE, readProfile),
    screening,
    composition: section(COMPOSITION_MODULE, readComposition),
    posture: section(POSTURE_MODULE, readPosture),
    movement: section(MOVEMENT_MODULE, readMovement),
    tests: section(TESTS_MODULE, readTests),
    conclusion: section(CONCLUSION_MODULE, readConclusion),
    decidedBy,
    template: head.templateVersion !== null ? { name: head.templateName ?? "Modelo", version: head.templateVersion } : null,
    enabled: readEnabledParts(head.enabled),
    photos: photoIndex.map(({ view, createdAt, erasedAt }) => ({ view, createdAt, erasedAt })),
    ...(bucket && photoIndex.some((row) => row.erasedAt === null) ? { photoImages: await photoBytes(bucket, photoIndex) } : {}),
  };
}

/** The report of a recorded assessment of a student, for a professional with active technical care of that student; null otherwise. */
export function assessmentReportsFor(db: D1Database, context: AuthenticatedContext | null) {
  const { userId, organizationId } = assertContext(context);
  return {
    /** With the private photo storage, the bytes of the stored photos come too (for the PDF). */
    async source(studentId: string, assessmentId: string, bucket: R2Bucket | null = null): Promise<AssessmentReportSource | null> {
      const head = await db
        .prepare(
          `SELECT ${headColumns}
           FROM assessments a
           JOIN students s ON s.organization_id = a.organization_id AND s.id = a.student_id
           JOIN organizations o ON o.id = a.organization_id
           WHERE a.organization_id = ?1 AND a.student_id = ?3 AND a.id = ?4 AND a.state = 'RECORDED' AND a.format_version = 2
             AND ${activeUser("?2")} AND ${technicalAccessExists("s", "?2")}`,
        )
        .bind(organizationId, userId, studentId, assessmentId)
        .first<HeadRow>();
      return head ? assemble(db, head, bucket) : null;
    },
  };
}

/** The gate of the student: the login's active (not revoked) link to that student, and the login not blocked. ?1 user, ?2 student. */
const studentGate = `JOIN student_access sa ON sa.organization_id = a.organization_id AND sa.student_id = a.student_id
  WHERE sa.user_id = ?1 AND sa.student_id = ?2 AND sa.revoked_at IS NULL AND ${activeUser("?1")}
    AND a.state = 'RECORDED' AND a.format_version = 2`;

/** The recorded Avaliações Físicas of the student this login is linked to, the report of one of them, and the evolution of their results. */
export function studentAssessmentsFor(db: D1Database, userId: string, studentId: string) {
  const blank = !userId?.trim() || !studentId?.trim();
  return {
    /** Newest first. Only recorded assessments of the new format; drafts never appear. */
    async list(): Promise<StudentAssessmentItem[]> {
      if (blank) return [];
      const rows = await db
        .prepare(
          `SELECT a.id, a.assessed_on AS assessedOn, a.kind, a.recorded_at AS recordedAt, a.amends_assessment_id AS amendsAssessmentId,
             (SELECT n.id FROM assessments n WHERE n.organization_id = a.organization_id AND n.amends_assessment_id = a.id AND n.state = 'RECORDED'
                ORDER BY n.recorded_at DESC LIMIT 1) AS amendedById
           FROM assessments a ${studentGate}
           ORDER BY a.assessed_on DESC, a.recorded_at DESC`,
        )
        .bind(userId, studentId)
        .all<StudentAssessmentItem>();
      return rows.results;
    },
    /** The report of one of them (also the student's page of it, slice 0.86); with the photo storage, the bytes of its stored photos too. */
    async source(assessmentId: string, bucket: R2Bucket | null = null): Promise<AssessmentReportSource | null> {
      if (blank || !assessmentId?.trim()) return null;
      const head = await db
        .prepare(
          `SELECT ${headColumns}
           FROM assessments a
           JOIN students s ON s.organization_id = a.organization_id AND s.id = a.student_id
           JOIN organizations o ON o.id = a.organization_id
           ${studentGate} AND a.id = ?3`,
        )
        .bind(userId, studentId, assessmentId)
        .first<HeadRow>();
      return head ? assemble(db, head, bucket) : null;
    },
    /**
     * Slice 0.86: the image of one posture photo of one of their recorded assessments (user's decision of 03/11/2026: "o aluno pode ver as
     * próprias fotos"), read only. The same gate as the report (active link, login not blocked, organization, recorded, new format); a draft,
     * another student, an erased photo or an unknown view is null. The professional's route is never used for this.
     */
    async photo(bucket: R2Bucket, assessmentId: string, view: string): Promise<{ body: R2ObjectBody["body"]; size: number } | null> {
      if (blank || !assessmentId?.trim() || !isPhotoView(view)) return null;
      const row = await db
        .prepare(
          `SELECT p.object_key AS key
           FROM assessments a
           JOIN assessment_photos p ON p.organization_id = a.organization_id AND p.assessment_id = a.id
           ${studentGate} AND a.id = ?3 AND p.view = ?4
             AND NOT EXISTS (SELECT 1 FROM photo_erasures e WHERE e.photo_id = p.id)`,
        )
        .bind(userId, studentId, assessmentId, view)
        .first<{ key: string }>();
      if (!row) return null;
      const object = await bucket.get(row.key);
      return object ? { body: object.body, size: object.size } : null;
    },
    /**
     * Slice 0.84: the results of the student's recorded Avaliações Físicas, oldest first (two of one date in the order they were recorded), for
     * the same comparable series the professional reads (0.82). Like the professional's history, an assessment corrected by a recorded
     * amendment is left out (the amendment carries the values), and only the newest `limit` are read. Only the new format: the earlier one has
     * no method and is not shown to the student. Both queries pass the student's gate (active link, login not blocked, organization).
     */
    async evolution(limit = 24): Promise<EvolutionSource[]> {
      if (blank) return [];
      const heads = (
        await db
          .prepare(
            `SELECT a.id, a.assessed_on AS assessedOn, a.recorded_at AS recordedAt
             FROM assessments a ${studentGate}
               AND NOT EXISTS (SELECT 1 FROM assessments n WHERE n.organization_id = a.organization_id AND n.amends_assessment_id = a.id AND n.state = 'RECORDED')
             ORDER BY a.assessed_on DESC, a.recorded_at DESC LIMIT ?3`,
          )
          .bind(userId, studentId, Math.max(1, Math.min(limit, 100)))
          .all<{ id: string; assessedOn: string; recordedAt: string | null }>()
      ).results.reverse();
      if (heads.length === 0) return [];
      const rows = await db
        .prepare(
          `SELECT r.assessment_id AS assessmentId, r.code, r.value, r.unit, r.method, r.formula_version AS formulaVersion, r.inputs, r.flags
           FROM assessment_results r
           JOIN assessments a ON a.organization_id = r.organization_id AND a.id = r.assessment_id
           ${studentGate} AND a.id IN (SELECT value FROM json_each(?3))
           ORDER BY r.rowid`,
        )
        .bind(userId, studentId, JSON.stringify(heads.map((head) => head.id)))
        .all<{ assessmentId: string; code: string; value: number | null; unit: string | null; method: string; formulaVersion: string | null; inputs: string | null; flags: string | null }>();
      return heads.map((head) => ({
        id: head.id,
        assessedOn: head.assessedOn,
        recordedAt: head.recordedAt,
        formatVersion: 2,
        results: rows.results
          .filter((row) => row.assessmentId === head.id)
          .map(
            (row): ResultRow => ({
              code: row.code,
              value: row.value,
              unit: row.unit,
              method: row.method,
              formulaVersion: row.formulaVersion,
              inputs: (parseJson(row.inputs) as Record<string, unknown> | null) ?? null,
              flags: flagsOf(row.flags),
            }),
          ),
      }));
    },
  };
}

/** Who downloaded the report of which assessment and when. Never the content. */
export async function recordReportDownload(
  db: D1Database,
  event: { organizationId: string; actorUserId: string; assessmentId: string },
  now = new Date(),
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO access_audit_events (id, organization_id, actor_user_id, action, subject_id, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    )
    .bind(crypto.randomUUID(), event.organizationId, event.actorUserId, ASSESSMENT_PDF_DOWNLOADED, event.assessmentId, now.toISOString())
    .run();
}
