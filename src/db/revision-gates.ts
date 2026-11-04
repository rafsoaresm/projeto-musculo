import { activeUser, technicalAccessExists } from "./students";

/**
 * The one gate every statement on a plan revision's content goes through (motor S6, design §4.1): the revision belongs to the
 * plan and to the organization, the acting user is active, and the user reaches the plan's student through an active technical
 * care assignment on a membership that is not revoked. Organization and user come from the verified session, never a payload.
 *
 * Binding convention (fixed, so the gate can be dropped into any statement): ?1 organization, ?2 user, ?3 plan, ?4 revision.
 *
 * "DRAFT": the revision is still open to content changes. "ANY": any state, for reading history of past revisions.
 */
export type RevisionGateMode = "DRAFT" | "ANY";

export function revisionGate(mode: RevisionGateMode): string {
  const state = mode === "DRAFT" ? "AND r.state = 'DRAFT'" : "";
  return `EXISTS (SELECT 1 FROM plan_revisions r
    JOIN training_plans tp ON tp.organization_id = r.organization_id AND tp.id = r.plan_id
    JOIN students s ON s.organization_id = tp.organization_id AND s.id = tp.student_id
    WHERE r.organization_id = ?1 AND r.id = ?4 AND r.plan_id = ?3 ${state}
      AND ${activeUser("?2")} AND ${technicalAccessExists("s", "?2")})`;
}
