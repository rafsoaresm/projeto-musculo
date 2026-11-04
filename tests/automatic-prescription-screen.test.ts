import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { plansFor } from "@/db/plans";
import { prescriptionFor } from "@/db/prescription";
import { changedDoseFields, restTextForEditing } from "@/modules/prescricao/describe";
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

  it("is not reachable by another organization or an unassigned professional", async () => {
    expect(await service("tech-b", "org-b").screen(plan.planId, plan.revisionId)).toEqual({ status: "not_found" });
    expect(await service("tech-c").screen(plan.planId, plan.revisionId)).toEqual({ status: "not_found" });
  });

  it("is not offered on a revision past DRAFT", async () => {
    const other = await plansFor(db, scope("tech-a")).create("st-1", { title: "Plano pronto", input: V2 as never });
    if (!other) throw new Error("plan");
    expect(await plansFor(db, scope("tech-a")).markReady(other.planId, other.revisionId, NOW)).toBe(true);
    const state = await db.prepare("SELECT state FROM plan_revisions WHERE id = ?1").bind(other.revisionId).first<{ state: string }>();
    expect(state?.state).toBe("READY");
    expect(await service().screen(other.planId, other.revisionId)).toEqual({ status: "not_open" });
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
    // A revoked assignment, a revoked membership and a deactivated professional lose both reads at once, and get them back.
    const run = (sql: string) => db.prepare(sql).run();
    for (const [what, cut, restore] of [
      ["revoked assignment", "UPDATE care_assignments SET revoked_at = 'x' WHERE professional_id = 'pro-a'", "UPDATE care_assignments SET revoked_at = NULL WHERE professional_id = 'pro-a'"],
      ["revoked membership", "UPDATE memberships SET revoked_at = 'x' WHERE user_id = 'tech-a'", "UPDATE memberships SET revoked_at = NULL WHERE user_id = 'tech-a'"],
      ["deactivated user", "UPDATE users SET disabled_at = '2026-11-20T00:00:00.000Z' WHERE id = 'tech-a'", "UPDATE users SET disabled_at = NULL WHERE id = 'tech-a'"],
    ] as const) {
      await run(cut);
      expect(await service().screen(plan.planId, plan.revisionId), what).toEqual({ status: "not_found" });
      expect(await service().alternatives(plan.planId, plan.revisionId, target), what).toEqual({ status: "not_found" });
      await run(restore);
    }
    expect((await service().alternatives(plan.planId, plan.revisionId, target)).status).toBe("ok");

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

describe("editing an applied proposal (UI items 7 and 11)", () => {
  it("a notes-only save keeps the engine dose; the approval count includes edits made in one session", async () => {
    const draft = await plansFor(db, scope("tech-a")).create("st-1", { title: "Plano editado", input: V2 as never });
    if (!draft) throw new Error("plan");
    const policy = await service().screen(draft.planId, draft.revisionId).then((o) => (o.status === "ok" ? o.screen.policy : []));
    const built = answersFromForm(
      {
        ...EMPTY_FORM,
        stimulus: [
          { phaseIndex: 1, value: "HYPERTROPHY", basis: "PROFESSIONAL" },
          { phaseIndex: 2, value: "STRENGTH", basis: "PROFESSIONAL" },
        ],
        equipment: ["BARBELL", "RACK", "MACHINE", "DUMBBELL", "BENCH", "CABLE", "PULL_UP_BAR"],
        counts: [{ phaseIndex: 1, label: "B", count: "3" }],
      },
      policy,
    );
    if (!built.ok) throw new Error(built.errors.join());
    const cv = (await db.prepare("SELECT content_version AS n FROM plan_revisions WHERE id = ?1").bind(draft.revisionId).first<{ n: number }>())!.n;
    const generated = ok(await service().generate(draft.planId, draft.revisionId, { idempotencyKey: "edit-gen-00000-0000-0000-000000000001", baseContentVersion: cv, answers: built.answers }));
    const applied = await service().apply(draft.planId, draft.revisionId, {
      proposalId: generated.proposalId, idempotencyKey: "edit-apply-000-0000-0000-000000000001", expectedVersion: generated.version,
      conflictMode: "PRESERVE", confirmedWorkouts: [], confirmInfeasible: false,
    });
    if (!applied.ok) throw new Error(applied.reason);

    const repo = prescriptionFor(db, scope("tech-a"));
    const before = await repo.automaticCounts(draft.planId, draft.revisionId);
    expect(before.total).toBeGreaterThan(0);
    expect(before.edited).toBe(0);
    // Another organization and an unassigned professional count nothing.
    expect(await prescriptionFor(db, scope("tech-b", "org-b")).automaticCounts(draft.planId, draft.revisionId)).toEqual({ total: 0, edited: 0 });
    expect(await prescriptionFor(db, scope("tech-c")).automaticCounts(draft.planId, draft.revisionId)).toEqual({ total: 0, edited: 0 });

    const sessions = await repo.occurrences(draft.planId, draft.revisionId, { phaseIndex: 1, week: 1 });
    const x = sessions[0].items.find((i) => i.doseText)!;
    expect(x).toBeDefined();
    // What the per-session form opens with, and what it sends when only the notes change.
    const initial = {
      sets: x.sets ?? "", reps: x.reps ?? "", loadInstruction: x.loadInstruction ?? "", cadence: x.cadence ?? "",
      restSeconds: x.restSeconds === null ? "" : String(x.restSeconds), restText: restTextForEditing(x),
      rirMin: x.rirMin === null ? "" : String(x.rirMin), rirMax: x.rirMax === null ? "" : String(x.rirMax), notes: x.notes ?? "",
    };
    const notesOnly = changedDoseFields(initial, { ...initial, notes: "Pegada neutra" });
    expect(notesOnly).toEqual({ notes: "Pegada neutra" });
    expect(await repo.updateOccurrence(draft.planId, draft.revisionId, [x.id], notesOnly)).toMatchObject({ status: "saved" });
    const kept = await db.prepare("SELECT dose_text AS doseText, dose_json AS doseJson, notes FROM prescribed_exercise_occurrences WHERE id = ?1").bind(x.id).first<{ doseText: string | null; doseJson: string | null; notes: string }>();
    expect(kept).toEqual({ doseText: x.doseText, doseJson: expect.any(String), notes: "Pegada neutra" });
    // Edited in one session only: the row itself is untouched, and the approval line counts it.
    expect(await repo.automaticCounts(draft.planId, draft.revisionId)).toEqual({ total: before.total, edited: 1 });

    // A typed dose replaces the stored one (stored as typed, B56).
    const typed = changedDoseFields(initial, { ...initial, sets: "5" });
    expect(Object.keys(typed)).toEqual(["sets", "reps", "loadInstruction", "cadence", "restSeconds", "restText", "rirMin", "rirMax"]);
    expect(await repo.updateOccurrence(draft.planId, draft.revisionId, [x.id], typed)).toMatchObject({ status: "saved" });
    const replaced = await db.prepare("SELECT dose_text AS doseText, sets FROM prescribed_exercise_occurrences WHERE id = ?1").bind(x.id).first<{ doseText: string | null; sets: string }>();
    expect(replaced).toEqual({ doseText: null, sets: "5" });

    // The workout card form: a notes-only save keeps the row's engine dose too.
    const row = (await repo.listWithDose(draft.planId, draft.revisionId)).find((r) => r.doseText && r.id !== x.prescribedExerciseId)!;
    const rowInitial = {
      sets: row.sets ?? "", reps: row.reps ?? "", loadInstruction: row.loadInstruction ?? "", cadence: row.cadence ?? "",
      restSeconds: row.restSeconds === null ? "" : String(row.restSeconds), restText: restTextForEditing(row),
      rirMin: row.rirMin === null ? "" : String(row.rirMin), rirMax: row.rirMax === null ? "" : String(row.rirMax), notes: row.notes ?? "",
    };
    const payload = { ...changedDoseFields(rowInitial, { ...rowInitial, notes: "Sem pressa" }), videoUrl: row.videoUrl, notes: "Sem pressa" };
    expect(await repo.update(draft.planId, draft.revisionId, row.id, payload)).toBe(true);
    const rowAfter = (await repo.listWithDose(draft.planId, draft.revisionId)).find((r) => r.id === row.id)!;
    expect(rowAfter).toMatchObject({ doseText: row.doseText, notes: "Sem pressa", sets: row.sets, restText: row.restText });
  });
});
