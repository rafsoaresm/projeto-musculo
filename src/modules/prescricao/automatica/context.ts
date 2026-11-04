/**
 * The input adapter's reading half (motor S5, design §2.1): every fact a generation uses, read through the existing gated
 * repositories. Organization and user come from the verified session (`AuthenticatedContext`), never from a payload; each
 * repository filters organization + active user + active technical assignment + revocation on every query.
 *
 * Imported only through `input.ts` (`server-only`). Kept apart so tests can run it against a local D1.
 */
import type { D1Database } from "@cloudflare/workers-types";
import { assessmentsFor } from "@/db/assessments";
import { exerciseMetadataFor } from "@/db/exercise-metadata";
import { exercisesFor } from "@/db/exercises";
import { plansFor } from "@/db/plans";
import { prescriptionFor } from "@/db/prescription";
import { profilesFor } from "@/db/student-profile";
import type { AuthenticatedContext } from "@/db/students";
import { executionFor } from "@/db/workout-sessions";
import { readConclusion } from "@/modules/avaliacoes/v2/conclusion";
import { readMovement } from "@/modules/avaliacoes/v2/flexitest";
import { readTests } from "@/modules/avaliacoes/v2/physical-tests";
import { readPosture } from "@/modules/avaliacoes/v2/posture";
import { readProfile, readScreening } from "@/modules/avaliacoes/v2/screening";
import { todayInBrazil } from "@/modules/execucao/contracts";
import { toExposureHistory } from "@/modules/execucao/exposures";
import { DEFAULT_RULESET, getRuleSet } from "@/modules/prescricao/motor/rules";
import type { RuleSetRef } from "@/modules/prescricao/motor/types";
import { buildPeriodization } from "@/modules/training/periodization";
import { buildCatalog, withoutCautionField, type AssessmentRecord, type GenerationContext } from "./facts";

export type LoadOutcome =
  | { status: "ok"; context: GenerationContext }
  /** The plan or revision does not exist for this user (other organization, no assignment, revoked, disabled): one answer for all. */
  | { status: "not_found" }
  /** Generation writes only into a DRAFT revision; READY, APPROVED and DELIVERED revisions are never touched. */
  | { status: "not_open"; state: string };

async function newestAssessment(db: D1Database, context: AuthenticatedContext, studentId: string): Promise<AssessmentRecord | null> {
  const repo = assessmentsFor(db, context);
  const standing = await repo.standing(studentId);
  if (!standing) return null;
  const detail = await repo.get(standing.assessmentId);
  if (!detail) return null;
  const v2 = detail.formatVersion === 2 ? await repo.sections(detail.id) : null;
  const section = (name: string) => v2?.sections.find((s) => s.module === name)?.payload;
  return {
    id: detail.id,
    assessedOn: detail.assessedOn,
    recordedAt: detail.recordedAt,
    formatVersion: detail.formatVersion,
    standing: { risk: standing.risk, reviewed: standing.reviewed, reviewedAt: standing.reviewedAt },
    legacy: detail.formatVersion === 2 ? null : { flags: detail.flags, posture: detail.posture, movement: detail.movement },
    profile: v2 ? readProfile(section("profile")) : null,
    screening: v2 && section("screening") !== undefined ? readScreening(section("screening")) : null,
    posture: v2 && section("posture") !== undefined ? readPosture(section("posture")) : null,
    movement: v2 && section("movement") !== undefined ? readMovement(section("movement")) : null,
    tests: v2 && section("tests") !== undefined ? readTests(section("tests")) : null,
    conclusion: v2 && section("conclusion") !== undefined ? readConclusion(section("conclusion")) : null,
    results: detail.results,
  };
}

/**
 * Reads everything one generation needs for a plan revision. `rules` picks the history window (EXPOSURE_WINDOW_DAYS of that
 * rule set); `now` gives the reference date in São Paulo (the engine never reads the clock).
 */
export async function loadGenerationContext(
  db: D1Database,
  context: AuthenticatedContext,
  planId: string,
  revisionId: string,
  options: { now?: Date; rules?: RuleSetRef } = {},
): Promise<LoadOutcome> {
  const rules = getRuleSet(options.rules ?? DEFAULT_RULESET);
  if (!rules) throw new Error("RULESET_UNKNOWN");
  const found = await plansFor(db, context).findRevision(planId, revisionId);
  if (!found) return { status: "not_found" };
  if (found.revision.state !== "DRAFT") return { status: "not_open", state: found.revision.state };
  const asOf = todayInBrazil(options.now ?? new Date());
  const studentId = found.plan.studentId;
  const [profile, assessment, records, existing, window] = await Promise.all([
    profilesFor(db, context).get(studentId),
    newestAssessment(db, context, studentId),
    exercisesFor(db, context).list({}),
    prescriptionFor(db, context).listWithDose(planId, revisionId),
    executionFor(db, context).exposures(studentId, { sinceDays: rules.rules.EXPOSURE_WINDOW_DAYS.value, today: asOf }),
  ]);
  // The revision was reachable a moment ago; a null here means access changed meanwhile: answer as not found.
  if (!window) return { status: "not_found" };
  const metadata = await exerciseMetadataFor(db, context).resolve(records.map((r) => r.id));
  const catalog = buildCatalog(records, metadata);
  const { rows, ...windowInfo } = window;
  return {
    status: "ok",
    context: {
      asOf,
      plan: { id: found.plan.id, studentId, title: found.plan.title },
      revision: {
        id: found.revision.id,
        state: found.revision.state,
        contentVersion: found.revision.contentVersion,
        prescriptionModel: found.revision.prescriptionModel,
        // Rebuilt from the saved input: the same weeks, slots and dates the stored schedule and the student's calendar use.
        schedule: buildPeriodization(found.revision.input),
      },
      profile,
      assessment,
      catalog,
      cautionTagsUnknown: withoutCautionField(metadata, catalog.map((e) => e.id)),
      history: { window: windowInfo, summary: toExposureHistory(rows, new Map(catalog.map((e) => [e.id, e.metric]))) },
      existing,
    },
  };
}
