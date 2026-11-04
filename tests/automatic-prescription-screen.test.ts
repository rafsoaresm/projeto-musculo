import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { plansFor } from "@/db/plans";
import { proposalService, type ProposalOutcome } from "@/modules/prescricao/automatica/service";
import { answersFromForm, EMPTY_FORM, openRequired } from "@/modules/prescricao/automatica/view";
import { ALL_MIGRATIONS, migrate } from "./helpers/migrate";

// Motor S9 on a real local D1 (migrations 0001–0045): what the professional's screens read before and during a proposal. The
// generation form's data (questions, facts considered, policy, previous answers), the alternatives of the substitution dialog, and
// the progress the processing indicator shows; each reachable only by the organization and the assigned professional.
let mf: Miniflare;
let db: D1Database;
const scope = (userId: string, organizationId = "org-a") => ({ userId, organizationId });
const NOW = new Date("2026-11-20T15:00:00Z");
const service = (userId = "tech-a", organizationId = "org-a") => proposalService(db, scope(userId, organizationId), { now: () => NOW });
const V2 = {
  schemaVersion: 2,
  startDate: "2026-11-23",
  phases: [
    { name: "Base", weeks: 3, sessionsPerWeek: 2, workouts: [{ label: "A", exerciseTarget: 3 }, { label: "B", exerciseTarget: null }], trainingDays: [0, 3] },
    { name: "Força", weeks: 2, sessionsPerWeek: 1, workouts: [{ label: "Full", exerciseTarget: 3 }] },
  ],
};
let plan: { planId: string; revisionId: string };

function ok(outcome: ProposalOutcome): Extract<ProposalOutcome, { ok: true }> {
  if (!outcome.ok) throw new Error(`${outcome.reason}: ${outcome.message}`);
  return outcome;
}

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('test'); } };",
      compatibilityDate: "2026-10-23",
      d1Databases: { DB: "automatic-prescription-screen-tests" },
      cf: false,
    }),
  );
  db = await mf.getD1Database("DB");
  await migrate(db, ALL_MIGRATIONS);
  const people = ["tech-a", "tech-b", "tech-c"];
  await db.batch([
    ...people.map((p) => db.prepare("INSERT INTO auth_user(id,name,email,created_at,updated_at) VALUES (?1,?1,?2,0,0)").bind(p, `${p}@example.test`)),
    db.prepare(`INSERT INTO users(id) VALUES ${people.map((p) => `('${p}')`).join(",")}`),
    db.prepare("INSERT INTO organizations(id,name) VALUES ('org-a','Studio A'),('org-b','Studio B')"),
    db.prepare("INSERT INTO memberships(organization_id,user_id,role) VALUES ('org-a','tech-a','TECHNICAL'),('org-b','tech-b','TECHNICAL'),('org-a','tech-c','TECHNICAL')"),
    db.prepare("INSERT INTO professionals(id,organization_id,user_id,display_name) VALUES ('pro-a','org-a','tech-a','Pro A'),('pro-b','org-b','tech-b','Pro B'),('pro-c','org-a','tech-c','Pro C')"),
    db.prepare("INSERT INTO students(id,organization_id,display_name) VALUES ('st-1','org-a','One')"),
    db.prepare("INSERT INTO care_assignments(organization_id,student_id,professional_id) VALUES ('org-a','st-1','pro-a')"),
    db.prepare(
      `INSERT INTO student_profiles(student_id,organization_id,goal,level,days_per_week,session_minutes,equipment,injuries,updated_by_user_id)
       VALUES ('st-1','org-a','Hipertrofia','Intermediário',3,60,'Halteres em casa','Dor no ombro direito','tech-a')`,
    ),
  ]);
  const created = await plansFor(db, scope("tech-a")).create("st-1", { title: "Plano da tela", input: V2 as never });
  if (!created) throw new Error("plan");
  plan = created;
}, 120_000);
afterAll(async () => {
  await mf?.dispose();
});

describe("the generation form's data (UI items 1 and 6)", () => {
  it("asks what the records do not say, suggests without pre-selecting, and shows the free text as it is", async () => {
    const out = await service().screen(plan.planId, plan.revisionId);
    if (out.status !== "ok") throw new Error(out.status);
    const s = out.screen;
    expect(s.structure.map((p) => p.index)).toEqual([1, 2]);
    expect(s.questions.filter((q) => q.required).map((q) => [q.code, q.phaseIndex ?? null, q.label ?? null])).toEqual([
      ["STIMULUS", 1, null],
      ["EXERCISE_COUNT", 1, "B"],
      ["STIMULUS", 2, null],
      ["EQUIPMENT", null, null],
    ]);
    // The goal text only gives chips; the form starts with nothing chosen.
    expect(s.suggestions.map((x) => x.value)).toEqual(["HYPERTROPHY"]);
    expect(openRequired(s.questions, EMPTY_FORM)).toHaveLength(4);
    expect(s.questions.find((q) => q.code === "EQUIPMENT")?.context).toContain("Halteres em casa");
    expect(s.freeText).toContainEqual({ label: "Lesões", text: "Dor no ombro direito" });
    expect(s.considered.find((f) => f.label === "Objetivo")).toMatchObject({ value: "Hipertrofia", source: "Ficha" });
    expect(s.considered.find((f) => f.label === "Triagem (PAR-Q)")?.value).toBe("Não feita");
    // Q1: the policy table is the rule set's; the defaults decided on 04/11/2026 are assumptions until the professional chooses.
    expect(s.policy.length).toBeGreaterThan(5);
    expect(s.assumptions.map((a) => a.code)).toEqual(expect.arrayContaining(["DOSE_MODE_DEFAULT", "METADATA_TRUST_DEFAULT", "FREE_TEXT_NOT_PARSED"]));
    expect(s.library.length).toBeGreaterThan(20);
    expect(s.lastAnswers).toBeNull();
  });

  it("is not reachable by another organization, an unassigned professional, or past DRAFT", async () => {
    expect(await service("tech-b", "org-b").screen(plan.planId, plan.revisionId)).toEqual({ status: "not_found" });
    expect(await service("tech-c").screen(plan.planId, plan.revisionId)).toEqual({ status: "not_found" });
  });
});

describe("generation with the form's answers, the indicator, alternatives (UI items 2, 8)", () => {
  it("generates from the form, reports progress, then offers alternatives and keeps the answers for next time", async () => {
    const built = answersFromForm(
      {
        ...EMPTY_FORM,
        stimulus: [
          { phaseIndex: 1, value: "HYPERTROPHY", basis: "HEURISTIC_ACCEPTED", ruleId: "GOAL_STIMULUS_HINTS" },
          { phaseIndex: 2, value: "STRENGTH", basis: "PROFESSIONAL" },
        ],
        equipment: ["BARBELL", "RACK", "MACHINE", "DUMBBELL", "BENCH", "CABLE", "PULL_UP_BAR"],
        counts: [{ phaseIndex: 1, label: "B", count: "3" }],
      },
      (await service().screen(plan.planId, plan.revisionId).then((o) => (o.status === "ok" ? o.screen.policy : []))),
    );
    if (!built.ok) throw new Error(built.errors.join());
    const cv = (await db.prepare("SELECT content_version AS n FROM plan_revisions WHERE id = ?1").bind(plan.revisionId).first<{ n: number }>())!.n;
    const generated = ok(await service().generate(plan.planId, plan.revisionId, { idempotencyKey: "screen-gen-0000-0000-0000-000000000001", baseContentVersion: cv, answers: built.answers }));
    expect(generated.progress).toEqual({ generated: 2, total: 2 });
    expect(generated.complete).toBe(true);
    // A replay of the same click says nothing new about progress.
    const replay = ok(await service().generate(plan.planId, plan.revisionId, { idempotencyKey: "screen-gen-0000-0000-0000-000000000001", baseContentVersion: cv, answers: built.answers }));
    expect(replay.replayed).toBe(true);
    expect(replay.progress).toBeUndefined();

    const view = await service().previewApply(plan.planId, plan.revisionId, generated.proposalId);
    expect(view?.phasesMissing).toEqual([]);
    const snap = await db
      .prepare(
        `SELECT i.slot_key AS slotKey, o.week_index AS week, o.slot_index AS slot FROM proposal_items i
         JOIN proposal_occurrences o ON o.id = i.proposal_occurrence_id WHERE o.proposal_id = ?1 AND o.phase_index = 1 ORDER BY o.week_index, o.slot_index LIMIT 1`,
      )
      .bind(generated.proposalId)
      .first<{ slotKey: string; week: number; slot: number }>();
    const target = { proposalId: generated.proposalId, phaseIndex: 1, slotKey: snap!.slotKey, week: snap!.week, slot: snap!.slot };
    const alternatives = await service().alternatives(plan.planId, plan.revisionId, target);
    if (alternatives.status !== "ok") throw new Error(alternatives.status);
    expect(alternatives.alternatives.length).toBeGreaterThan(0);
    for (const a of alternatives.alternatives) expect(["REVIEWED", "INCLUDES_INFERRED", "PENDING", "NOT_APPLICABLE"]).toContain(a.metadata);
    // Another organization and an unassigned professional get nothing; a malformed target is refused.
    expect(await service("tech-b", "org-b").alternatives(plan.planId, plan.revisionId, target)).toEqual({ status: "not_found" });
    expect(await service("tech-c").alternatives(plan.planId, plan.revisionId, target)).toEqual({ status: "not_found" });
    expect(await service().alternatives(plan.planId, plan.revisionId, { ...target, phaseIndex: 0 })).toEqual({ status: "invalid" });

    // The substitution the dialog sends, with the first alternative, on the whole phase.
    const header = await db.prepare("SELECT version FROM prescription_proposals WHERE id = ?1").bind(generated.proposalId).first<{ version: number }>();
    const substituted = ok(
      await service().substitute(plan.planId, plan.revisionId, {
        proposalId: generated.proposalId,
        idempotencyKey: "screen-sub-0000-0000-0000-000000000001",
        writeId: "screen-sub-w-000-0000-0000-000000000001",
        expectedVersion: header!.version,
        target: { phaseIndex: 1, slotKey: snap!.slotKey, applies: { kind: "PHASE" } },
        newExerciseId: alternatives.alternatives[0].exerciseId,
      }),
    );
    expect(substituted.progress).toEqual({ generated: 2, total: 2 });

    // Next visit (after a discard): the form offers the previous answers, by a click only.
    ok(await service().discard(plan.planId, plan.revisionId, { proposalId: generated.proposalId, writeId: "screen-dis-w-000-0000-0000-000000000001", expectedVersion: substituted.version }));
    const again = await service().screen(plan.planId, plan.revisionId);
    if (again.status !== "ok") throw new Error(again.status);
    expect(again.screen.lastAnswers?.answers).toMatchObject({ equipmentCodes: ["BARBELL", "BENCH", "CABLE", "DUMBBELL", "MACHINE", "PULL_UP_BAR", "RACK"] });
  });
});
