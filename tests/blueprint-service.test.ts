/**
 * Motor V4, PR 2.3: do aceite da estratégia à proposta, pelo servidor, em D1 local (Miniflare, migrações 0001-0048) com o provedor
 * `mock` (nenhuma chamada externa). Sequência: planejar (IA mock ou regras) -> aceitar (linha só de acréscimo) -> gerar a partir do aceite
 * (compila, mescla nas respostas, grava a proposta e o vínculo no mesmo lote). Depois: trocar, travar, regenerar, atualizar e
 * "voltar à estratégia" mantêm as decisões do profissional. Nenhum caminho aprova, entrega ou aplica.
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createPlannerEnv, ANSWERS, type PlannerEnv } from "./helpers/ai-planner-env";
import { plansFor } from "@/db/plans";
import { proposalsFor } from "@/db/prescription-proposals";
import { loadCatalogForPlan } from "@/modules/prescricao/automatica/context";
import { itemProvenance } from "@/modules/prescricao/automatica/blueprint-view";
import { blueprintOf } from "@/modules/prescricao/automatica/blueprint-view";
import { proposalService, type ProposalOutcome } from "@/modules/prescricao/automatica/service";
import { canonicalJson } from "@/modules/prescricao/motor/hash";
import { blueprintService, type AcceptOutcome, type AcceptPayload } from "@/modules/prescricao/planejador/accept";
import type { PlanningOutcome } from "@/modules/prescricao/planejador/orchestration";
import { emptyDelta } from "@/modules/prescricao/planejador/focus";

vi.mock("server-only", () => ({}));

let t: PlannerEnv;
const NOW = new Date("2026-11-20T15:00:00Z");
const XINTUS = {
  schemaVersion: 2, startDate: "2026-11-23",
  phases: [1, 2, 3].map((n) => ({ name: `Fase ${n}`, weeks: 4, sessionsPerWeek: 4, workouts: [{ label: "A", exerciseTarget: 6 }, { label: "B", exerciseTarget: 6 }], trainingDays: [0, 1, 3, 4] })),
};
const XINTUS_ANSWERS = { ...ANSWERS, stimulusByPhase: [1, 2, 3].map((phaseIndex) => ({ phaseIndex, value: "HYPERTROPHY", basis: "PROFESSIONAL" as const })) };

beforeAll(async () => {
  t = await createPlannerEnv("blueprint-service-tests");
});
afterAll(async () => {
  await t?.dispose();
});

const blueprints = (who = "tech-a", org = "org-a") => blueprintService(t.db, t.org(who, org), { now: () => NOW });
const proposals = (who = "tech-a", org = "org-a") => proposalService(t.db, t.org(who, org), { now: () => NOW });
const store = (who = "tech-a", org = "org-a") => proposalsFor(t.db, t.org(who, org));
type Draft = { planId: string; revisionId: string };

const planOk = async (d: Draft, mode: "AI" | "RULES", answers: unknown = XINTUS_ANSWERS, svc = t.service()) => {
  const out: PlanningOutcome = await svc.plan(d.planId, d.revisionId, { idempotencyKey: t.id("plan"), baseContentVersion: await t.contentVersion(d.revisionId), mode, answers } as never);
  if (!out.ok) throw new Error(`plan ${out.reason}: ${out.message}`);
  return out;
};
const acceptBody = async (d: Draft, runId: string, over: Partial<AcceptPayload> = {}): Promise<AcceptPayload> => ({
  idempotencyKey: t.id("acc"), runId, strategyId: "S1", phases: [], baseContentVersion: await t.contentVersion(d.revisionId), ...over,
});
async function acceptOk(d: Draft, runId: string, over: Partial<AcceptPayload> = {}) {
  const out: AcceptOutcome = await blueprints().accept(d.planId, d.revisionId, await acceptBody(d, runId, over));
  if (!out.ok) throw new Error(`accept ${out.reason}: ${out.message}`);
  return out;
}
const genBody = async (d: Draft, acceptanceId: string, answers: unknown = XINTUS_ANSWERS) => ({
  idempotencyKey: t.id("gen"), baseContentVersion: await t.contentVersion(d.revisionId), acceptanceId, answers,
});
function proposalOk(o: ProposalOutcome) {
  if (!o.ok) throw new Error(`${o.reason}: ${o.message}`);
  return o;
}
const reasonOf = (o: ProposalOutcome | AcceptOutcome) => (o.ok ? "ok" : o.reason);
async function generateOk(d: Draft, acceptanceId: string, answers: unknown = XINTUS_ANSWERS) {
  return proposalOk(await blueprints().generate(d.planId, d.revisionId, await genBody(d, acceptanceId, answers)));
}
async function snapshot(d: Draft, proposalId: string) {
  const snap = await store().asEngineResult(d.planId, d.revisionId, proposalId);
  if (!snap) throw new Error("snapshot");
  return snap;
}
const itemsOf = (r: Awaited<ReturnType<typeof snapshot>>["result"], phaseIndex: number, label: string) =>
  r.occurrences.filter((o) => o.phaseIndex === phaseIndex && o.label === label).flatMap((o) => o.items);
const cas = (version: number) => ({ writeId: t.id("write"), expectedVersion: version });
/** Nothing that belongs to the prescription moved: the revision is a draft, no row was applied, approved or delivered. */
async function untouched(d: Draft) {
  expect(await t.first<{ state: string }>("SELECT state FROM plan_revisions WHERE id = ?1", d.revisionId)).toMatchObject({ state: "DRAFT" });
  expect(await t.n("SELECT COUNT(*) AS n FROM prescribed_exercises WHERE revision_id = ?1", d.revisionId)).toBe(0);
  expect(await t.n("SELECT COUNT(*) AS n FROM prescription_applications WHERE revision_id = ?1", d.revisionId)).toBe(0);
  expect(await t.n("SELECT COUNT(*) AS n FROM training_plan_events WHERE plan_id = ?1 AND action IN ('APPROVED','DELIVERED','MARKED_READY','READY','APPROVAL','DELIVERY')", d.planId)).toBe(0);
  expect(await t.n("SELECT COUNT(*) AS n FROM plan_revisions WHERE id = ?1 AND (approved_at IS NOT NULL OR delivered_at IS NOT NULL)", d.revisionId)).toBe(0);
}

describe("regras: sugestão -> aceite -> geração, sem IA configurada", () => {
  it("o caminho completo funciona com a IA desligada, o vínculo vem do aceite e nada é aprovado ou aplicado", async () => {
    const d = await t.newDraft("st-1", "tech-a", "org-a", XINTUS);
    const plan = await planOk(d, "RULES");
    const acc = await acceptOk(d, plan.runId);
    expect(acc).toMatchObject({ replayed: false, acceptance: { strategyId: "S1", splitFamily: "UPPER_LOWER", edits: [] } });
    expect(acc.acceptance.workouts.filter((w) => w.phaseIndex === 1).map((w) => [w.label, w.role, w.source])).toEqual([["A", "UPPER", "RULES_HEURISTIC"], ["B", "LOWER", "RULES_HEURISTIC"]]);
    const out = await generateOk(d, acc.acceptance.acceptanceId);
    expect(out).toMatchObject({ version: 1, complete: true });
    const snap = await snapshot(d, out.proposalId);
    expect(blueprintOf(snap.header.parameters)).toMatchObject({ acceptances: [{ acceptanceId: acc.acceptance.acceptanceId, runId: plan.runId, strategyId: "S1", source: "RULES_HEURISTIC" }] });
    const links = await store().blueprintLinks(d.planId, d.revisionId, out.proposalId);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ acceptanceId: acc.acceptance.acceptanceId, runId: plan.runId, responseHash: null, templatesVersion: "gymgital-base@2026.11.5", rulesVersion: "2026.11.5" });
    expect(await t.n("SELECT COUNT(*) AS n FROM ai_usage_ledger")).toBe(0);
    await untouched(d);
  });
});

describe("Xintus com a IA (mock) pelo servidor: superior/inferior, corpo inteiro e três fases", () => {
  beforeAll(async () => {
    await t.configure({ provider: "mock", model: "mock-ul", orgs: ["org-a"] });
  });

  it("aceitar superior/inferior: A e B ficam diferentes de verdade, a auditoria reconhece e a origem de cada item se resolve", async () => {
    const d = await t.newDraft("st-1", "tech-a", "org-a", XINTUS);
    const plan = await planOk(d, "AI");
    expect(plan.producer).toBe("AI");
    const acc = await acceptOk(d, plan.runId);
    const out = await generateOk(d, acc.acceptance.acceptanceId);
    const snap = await snapshot(d, out.proposalId);
    const catalog = await loadCatalogForPlan(t.db, t.org("tech-a"), d.planId, d.revisionId);
    if (catalog.status !== "ok") throw new Error("catalog");
    const exercise = new Map(catalog.catalog.map((e) => [e.id, e]));
    const A = new Set(snap.result.occurrences.filter((o) => o.phaseIndex === 1 && o.label === "A").flatMap((o) => o.items.map((i) => i.exerciseId!)));
    const B = new Set(snap.result.occurrences.filter((o) => o.phaseIndex === 1 && o.label === "B").flatMap((o) => o.items.map((i) => i.exerciseId!)));
    expect([...A].filter((id) => B.has(id))).toEqual([]);
    const primaries = (ids: Set<string>) => new Set([...ids].flatMap((id) => exercise.get(id)?.primaryMuscles ?? []));
    const patterns = (ids: Set<string>) => new Set([...ids].flatMap((id) => exercise.get(id)?.patterns ?? []));
    const pa = primaries(A);
    const pb = primaries(B);
    const jaccard = [...pa].filter((m) => pb.has(m)).length / new Set([...pa, ...pb]).size;
    expect(jaccard).toBeLessThanOrEqual(0.15);
    expect(patterns(A).has("SQUAT") || patterns(A).has("HINGE")).toBe(false);
    expect(["SQUAT", "HINGE"].some((p) => patterns(B).has(p))).toBe(true);
    expect(["HORIZONTAL_PUSH", "HORIZONTAL_PULL", "VERTICAL_PULL", "VERTICAL_PUSH"].filter((p) => patterns(A).has(p)).length).toBeGreaterThanOrEqual(2);

    // the audit recognises the strategy
    const audit = snap.result.audit!;
    expect(audit.auditVersion).toBe("1.1.0");
    expect(audit.strategy!.strategyIds).toEqual(["S1"]);
    for (const w of audit.strategy!.workouts) expect(w.adherenceMin, `${w.phaseIndex}/${w.label}`).toBeGreaterThanOrEqual(0.7);
    expect(audit.findings.filter((f) => f.code === "AUDIT_STRATEGY_ADHERENCE_LOW")).toEqual([]);
    expect(audit.findings.filter((f) => /^AUDIT_TARGET_(MUSCLE|PATTERN)_UNMET$/.test(f.code) && (f as { target?: { origin?: string } }).target?.origin === "BLUEPRINT_FOCUS")).toEqual([]);

    // record: link, AI provenance, hashes of the run
    const block = blueprintOf(snap.header.parameters)!;
    expect(block.acceptances[0].source).toBe("AI_SUGGESTED");
    const run = (await t.first<{ response_hash: string; blueprint_hash: string }>("SELECT response_hash, blueprint_hash FROM planning_runs WHERE id = ?1", plan.runId))!;
    const [link] = await store().blueprintLinks(d.planId, d.revisionId, out.proposalId);
    expect(link).toMatchObject({ acceptanceId: acc.acceptance.acceptanceId, runId: plan.runId, responseHash: run.response_hash, blueprintHash: run.blueprint_hash });
    const view = await proposals().blueprint(d.planId, d.revisionId, out.proposalId);
    expect(view).toMatchObject({ status: "ok", blueprint: { record: { runs: [{ kind: "AI" }] } } });
    for (const w of snap.result.workouts) {
      for (const occ of snap.result.occurrences.filter((o) => o.phaseIndex === w.phaseIndex && o.label === w.label))
        for (const item of occ.items) {
          const p = itemProvenance(item, w);
          const nominated = !!w.coverage?.blueprint?.candidates.includes(item.exerciseId ?? "");
          expect(p.decidedBy).toBe(nominated ? "AI_SUGGESTED" : "RULES_HEURISTIC");
          expect(p.focus).toBe("AI_SUGGESTED");
          expect(p.selection).toBe("RULES_HEURISTIC");
        }
    }
    await untouched(d);
  });

  it("aceite + regras 2026.11.6 (adesão): A e B diferem nos exercícios E nas doses; sem a adesão fica a 2026.11.5; versão fora da lista é recusada", async () => {
    const d = await t.newDraft("st-1", "tech-a", "org-a", XINTUS);
    const plan = await planOk(d, "AI");
    const acc = await acceptOk(d, plan.runId);
    const id = acc.acceptance.acceptanceId;
    // a version that is neither the default nor a published opt-in is refused before anything is compiled
    expect(reasonOf(await blueprints().generate(d.planId, d.revisionId, { ...(await genBody(d, id)), rulesVersion: "2026.11.4" }))).toBe("invalid");
    expect(reasonOf(await blueprints().generate(d.planId, d.revisionId, { ...(await genBody(d, id)), rulesVersion: "9.9.9" }))).toBe("invalid");
    expect(await t.n("SELECT COUNT(*) AS n FROM prescription_proposals WHERE revision_id = ?1", d.revisionId)).toBe(0);
    const out = proposalOk(await blueprints().generate(d.planId, d.revisionId, { ...(await genBody(d, id)), rulesVersion: "2026.11.6" }));
    const snap = await snapshot(d, out.proposalId);
    expect(snap.header.rulesVersion).toBe("2026.11.6");
    const [link] = await store().blueprintLinks(d.planId, d.revisionId, out.proposalId);
    expect(link).toMatchObject({ acceptanceId: id, rulesVersion: "2026.11.6" });
    const A = itemsOf(snap.result, 1, "A");
    const B = itemsOf(snap.result, 1, "B");
    const ids = (items: typeof A) => new Set(items.map((i) => i.exerciseId));
    expect([...ids(A)].filter((x) => ids(B).has(x))).toEqual([]);
    // the doses are no longer one number for everybody, and the profile that set each is in the trace
    const doseOf = (i: (typeof A)[number]) => {
      const dose = i.dose as { sets?: number; reps?: { min: number; max: number }; restSeconds?: number | null } | null;
      return `${dose?.sets}x${dose?.reps?.min}-${dose?.reps?.max}/${dose?.restSeconds}`;
    };
    const doses = new Set([...A, ...B].map(doseOf));
    expect(doses.size).toBeGreaterThan(1);
    expect([...A, ...B].some((i) => i.trace.params.some((p) => p.profileId))).toBe(true);
    await untouched(d);
  });

  it("corpo inteiro escolhido explicitamente é respeitado: válido, com agachar e empurrar em A e B, sem pena por 'fora do foco'", async () => {
    const d = await t.newDraft("st-1", "tech-a", "org-a", XINTUS);
    const plan = await planOk(d, "RULES");
    // the rules offer FULL_BODY as one of the strategies; the professional picks it
    const strategies = (await blueprints().current(d.planId, d.revisionId))!.run.strategies;
    const full = strategies.find((s) => s.splitFamily === "FULL_BODY")!;
    expect(full.acceptable).toBe(true);
    const acc = await acceptOk(d, plan.runId, { strategyId: full.strategyId });
    expect(acc.acceptance.splitFamily).toBe("FULL_BODY");
    const out = await generateOk(d, acc.acceptance.acceptanceId);
    const snap = await snapshot(d, out.proposalId);
    expect(snap.result.workouts.every((w) => w.coverage?.origin === "BLUEPRINT_FOCUS" && w.coverage.blueprint?.role === "FULL_BODY")).toBe(true);
    const catalog = await loadCatalogForPlan(t.db, t.org("tech-a"), d.planId, d.revisionId);
    if (catalog.status !== "ok") throw new Error("catalog");
    const exercise = new Map(catalog.catalog.map((e) => [e.id, e]));
    const patternsIn = (label: string) => new Set(itemsOf(snap.result, 1, label).flatMap((i) => exercise.get(i.exerciseId!)?.patterns ?? []));
    for (const label of ["A", "B"]) {
      const p = patternsIn(label);
      expect(p.has("SQUAT") || p.has("HINGE") || p.has("LUNGE"), label).toBe(true);
      expect(p.has("HORIZONTAL_PUSH") || p.has("VERTICAL_PUSH"), label).toBe(true);
    }
    // B is not the leftover of A: in every phase each full-body workout spreads over the base patterns (no 3 presses + 2 squats)
    for (const phase of [1, 2, 3])
      for (const label of ["A", "B"]) {
        const first = snap.result.occurrences.filter((o) => o.phaseIndex === phase && o.label === label).sort((a, b) => a.week - b.week)[0];
        const items = first.items;
        const perPattern = new Map<string, number>();
        for (const i of items) for (const x of exercise.get(i.exerciseId!)?.patterns ?? []) perPattern.set(x, (perPattern.get(x) ?? 0) + 1);
        expect(perPattern.size, `${phase}${label}`).toBeGreaterThanOrEqual(5);
        expect(Math.max(...perPattern.values()), `${phase}${label}`).toBeLessThanOrEqual(2);
        expect(perPattern.has("HINGE") || perPattern.has("LUNGE"), `${phase}${label}`).toBe(true);
        expect(perPattern.has("VERTICAL_PULL") || perPattern.has("HORIZONTAL_PULL"), `${phase}${label}`).toBe(true);
      }
    expect(snap.result.occurrences.flatMap((o) => o.items).every((i) => !i.trace.selection.some((e) => e.code === "MICRO_OFF_FOCUS"))).toBe(true);
    expect(snap.result.audit!.findings.filter((f) => f.code === "AUDIT_STRATEGY_ADHERENCE_LOW" && (f as { status?: string }).status === "OPEN")).toEqual([]);
  });

  it("três fases com divisões diferentes e um foco editado: cada fase segue o seu papel e a edição vira decisão do profissional", async () => {
    const d = await t.newDraft("st-1", "tech-a", "org-a", XINTUS);
    const plan = await planOk(d, "AI");
    const body = {
      phases: [
        { phaseIndex: 2, workouts: [{ label: "A", role: "FULL_BODY" as const, focusDelta: null, candidateExerciseIds: [] }, { label: "B", role: "FULL_BODY" as const, focusDelta: null, candidateExerciseIds: [] }] },
        { phaseIndex: 3, workouts: [{ label: "A", role: "UPPER" as const, focusDelta: { ...emptyDelta(), removeDominant: ["BICEPS"], addSupporting: ["BICEPS"] }, candidateExerciseIds: [] }] },
      ],
    };
    const acc = await acceptOk(d, plan.runId, body);
    expect(acc.acceptance.edits.map((e) => [e.phaseIndex, e.label, e.field])).toEqual([
      [2, "A", "allowedSpilloverPatterns"], [2, "A", "dominantMuscles"], [2, "A", "role"], [2, "A", "supportingMuscles"], [2, "A", "targetPatterns"],
      [2, "B", "allowedSpilloverPatterns"], [2, "B", "dominantMuscles"], [2, "B", "role"], [2, "B", "supportingMuscles"], [2, "B", "targetPatterns"],
      [3, "A", "dominantMuscles"], [3, "A", "supportingMuscles"],
    ]);
    const out = await generateOk(d, acc.acceptance.acceptanceId);
    const snap = await snapshot(d, out.proposalId);
    const cov = (p: number, l: string) => snap.result.workouts.find((w) => w.phaseIndex === p && w.label === l)!.coverage!;
    expect([cov(1, "A").blueprint!.role, cov(1, "B").blueprint!.role, cov(2, "A").blueprint!.role, cov(2, "B").blueprint!.role, cov(3, "A").blueprint!.role, cov(3, "B").blueprint!.role])
      .toEqual(["UPPER", "LOWER", "FULL_BODY", "FULL_BODY", "UPPER", "LOWER"]);
    expect([cov(1, "A").blueprint!.source, cov(2, "A").blueprint!.source, cov(3, "A").blueprint!.source, cov(3, "B").blueprint!.source]).toEqual(["AI_SUGGESTED", "PROFESSIONAL", "PROFESSIONAL", "AI_SUGGESTED"]);
    // phase 3's edited workout moved biceps from dominant to supporting
    expect(cov(3, "A").muscles).not.toContain("BICEPS");
    expect(cov(1, "A").muscles).toContain("BICEPS");
    expect(cov(3, "A").blueprint!.supporting).toContain("BICEPS");
    await untouched(d);
  });

  it("personalizada: todo treino é decisão do profissional, e o foco salvo na periodização não se edita", async () => {
    const d = await t.newDraft("st-1", "tech-a", "org-a", XINTUS);
    const plan = await planOk(d, "AI");
    const custom = await acceptOk(d, plan.runId, {
      strategyId: "CUSTOM",
      phases: [1, 2, 3].map((phaseIndex) => ({ phaseIndex, workouts: [{ label: "A", role: "PUSH" as const, focusDelta: null, candidateExerciseIds: [] }, { label: "B", role: "PULL" as const, focusDelta: null, candidateExerciseIds: [] }] })),
    });
    expect(custom.acceptance).toMatchObject({ strategyId: "CUSTOM", splitFamily: "CUSTOM" });
    expect(custom.acceptance.workouts.every((w) => w.source === "PROFESSIONAL")).toBe(true);
    const out = await generateOk(d, custom.acceptance.acceptanceId);
    const snap = await snapshot(d, out.proposalId);
    expect(snap.result.workouts.map((w) => [w.label, w.coverage!.blueprint!.role, w.coverage!.blueprint!.source]).slice(0, 2)).toEqual([["A", "PUSH", "PROFESSIONAL"], ["B", "PULL", "PROFESSIONAL"]]);
    expect(reasonOf(await blueprints().accept(d.planId, d.revisionId, await acceptBody(d, plan.runId, { strategyId: "CUSTOM", phases: [] })))).toBe("invalid");
  });

  it("recusas do aceite: estratégia informativa, treino que não existe, candidato fora da estratégia, dose fora da estratégia, corpo desconhecido", async () => {
    const d = await t.newDraft("st-1", "tech-a", "org-a", XINTUS);
    const plan = await planOk(d, "RULES");
    const attempt = async (over: Partial<AcceptPayload>) => reasonOf(await blueprints().accept(d.planId, d.revisionId, await acceptBody(d, plan.runId, over)));
    const informational = (await blueprints().current(d.planId, d.revisionId))!.run.strategies.find((s) => s.requiresScheduleChange);
    expect(informational, "2 treinos: PPL é informativo").toBeDefined();
    expect(await attempt({ strategyId: informational!.strategyId })).toBe("strategy_requires_schedule_change");
    expect(await attempt({ phases: [{ phaseIndex: 1, workouts: [{ label: "Z", role: "UPPER", focusDelta: null, candidateExerciseIds: [] }] }] })).toBe("invalid");
    expect(await attempt({ phases: [{ phaseIndex: 9, workouts: [{ label: "A", role: "UPPER", focusDelta: null, candidateExerciseIds: [] }] }] })).toBe("invalid");
    expect(await attempt({ phases: [{ phaseIndex: 1, workouts: [{ label: "A", role: "UPPER", focusDelta: null, candidateExerciseIds: ["nao-existe"] }] }] })).toBe("invalid");
    expect(await attempt({ dosing: { byClass: [{ exerciseClass: "COMPOUND_MULTIJOINT", profileCode: "STRENGTH_HEAVY" }], progression: [] } as never })).toBe("invalid");
    expect(await attempt({ runId: "run-que-nao-existe" })).toBe("run_missing");
    expect(await attempt({ strategyId: "S9" as never })).toBe("invalid");
    expect(await t.n("SELECT COUNT(*) AS n FROM blueprint_acceptances WHERE revision_id = ?1", d.revisionId)).toBe(0);
  });
});

describe("idempotência, aceite mais novo e corrida de versões", () => {
  it("a mesma chave devolve o mesmo aceite e a mesma proposta; outra chave com outros dados é recusada; aceites paralelos com a mesma chave dão uma linha", async () => {
    const d = await t.newDraft("st-1", "tech-a", "org-a", XINTUS);
    const plan = await planOk(d, "RULES");
    const body = await acceptBody(d, plan.runId);
    const first = (await blueprints().accept(d.planId, d.revisionId, body)) as Extract<AcceptOutcome, { ok: true }>;
    const again = (await blueprints().accept(d.planId, d.revisionId, body)) as Extract<AcceptOutcome, { ok: true }>;
    expect(first.ok && again.ok).toBe(true);
    expect(again).toMatchObject({ replayed: true, acceptance: { acceptanceId: first.acceptance.acceptanceId } });
    expect(reasonOf(await blueprints().accept(d.planId, d.revisionId, { ...body, strategyId: "S2" }))).toBe("key_reused");

    const parallelKey = t.id("par");
    const results = await Promise.all([1, 2, 3].map(() => blueprints().accept(d.planId, d.revisionId, { ...body, idempotencyKey: parallelKey, strategyId: "S2" })));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(new Set(results.map((r) => (r.ok ? r.acceptance.acceptanceId : ""))).size).toBe(1);
    expect(await t.n("SELECT COUNT(*) AS n FROM blueprint_acceptances WHERE revision_id = ?1 AND idempotency_key = ?2", d.revisionId, parallelKey)).toBe(1);

    // generation: same key -> same proposal, replayed; the other acceptance (older) is not the current one
    const gen = await genBody(d, results[0].ok ? results[0].acceptance.acceptanceId : "");
    const g1 = proposalOk(await blueprints().generate(d.planId, d.revisionId, gen));
    const g2 = proposalOk(await blueprints().generate(d.planId, d.revisionId, gen));
    expect(g2).toMatchObject({ proposalId: g1.proposalId, replayed: true });
    expect(await t.n("SELECT COUNT(*) AS n FROM prescription_proposals WHERE revision_id = ?1", d.revisionId)).toBe(1);
    expect(await t.n("SELECT COUNT(*) AS n FROM proposal_blueprint_links WHERE proposal_id = ?1", g1.proposalId)).toBe(1);
    // the same key with another acceptance is a different request
    expect(reasonOf(await blueprints().generate(d.planId, d.revisionId, { ...gen, acceptanceId: first.acceptance.acceptanceId }))).toBe("blueprint_invalid");
  });

  it("um aceite novo substitui o anterior: gerar com o antigo é recusado e o atual vence", async () => {
    const d = await t.newDraft("st-1", "tech-a", "org-a", XINTUS);
    const plan = await planOk(d, "RULES");
    const old = await acceptOk(d, plan.runId);
    const latest = await acceptOk(d, plan.runId, { strategyId: "S2" });
    expect(reasonOf(await blueprints().generate(d.planId, d.revisionId, await genBody(d, old.acceptance.acceptanceId)))).toBe("blueprint_invalid");
    const out = await generateOk(d, latest.acceptance.acceptanceId);
    const block = blueprintOf((await snapshot(d, out.proposalId)).header.parameters)!;
    expect(block.acceptances.map((a) => [a.acceptanceId, a.splitFamily])).toEqual([[latest.acceptance.acceptanceId, "FULL_BODY"]]);
    const current = await blueprints().current(d.planId, d.revisionId);
    expect(current?.acceptance?.acceptanceId).toBe(latest.acceptance.acceptanceId);
  });

  it("o rascunho mudou entre planejar e aceitar, ou entre aceitar e gerar: revision_changed; a periodização mudou: structure_changed", async () => {
    const d = await t.newDraft("st-1", "tech-a", "org-a", XINTUS);
    const plan = await planOk(d, "RULES");
    // (1) stale base on accept
    const stale = await acceptBody(d, plan.runId);
    await t.run("UPDATE plan_revisions SET content_version = content_version + 1 WHERE id = ?1", d.revisionId);
    expect(reasonOf(await blueprints().accept(d.planId, d.revisionId, stale))).toBe("revision_changed");
    // (2) the run was made for another version: accepting at the current version is also refused
    expect(reasonOf(await blueprints().accept(d.planId, d.revisionId, await acceptBody(d, plan.runId)))).toBe("revision_changed");
    // planning again at the current version
    const again = await planOk(d, "RULES", { ...XINTUS_ANSWERS, excludedPatterns: ["CARRY"] });
    const acc = await acceptOk(d, again.runId);
    const before = await genBody(d, acc.acceptance.acceptanceId);
    await t.run("UPDATE plan_revisions SET content_version = content_version + 1 WHERE id = ?1", d.revisionId);
    expect(reasonOf(await blueprints().generate(d.planId, d.revisionId, before))).toBe("revision_changed");
    // the rows changed but the structure did not: a fresh generation with the current version works with the same acceptance
    proposalOk(await blueprints().generate(d.planId, d.revisionId, await genBody(d, acc.acceptance.acceptanceId)));

    // (3) structure edited after accept
    const e = await t.newDraft("st-1", "tech-a", "org-a", XINTUS);
    const p2 = await planOk(e, "RULES");
    const a2 = await acceptOk(e, p2.runId);
    const renamed = { ...XINTUS, phases: XINTUS.phases.map((p, i) => (i === 0 ? { ...p, name: "Outro nome" } : p)) };
    expect(await plansFor(t.db, t.org("tech-a")).saveDraft(e.planId, e.revisionId, renamed, NOW)).toBe(true);
    expect(reasonOf(await blueprints().generate(e.planId, e.revisionId, await genBody(e, a2.acceptance.acceptanceId)))).toBe("structure_changed");
    expect(reasonOf(await blueprints().accept(e.planId, e.revisionId, await acceptBody(e, p2.runId)))).not.toBe("ok");
    expect(await t.n("SELECT COUNT(*) AS n FROM prescription_proposals WHERE revision_id = ?1", e.revisionId)).toBe(0);
  });

  it("isolamento: outra organização, e quem não atende o aluno, não aceita nem gera nem lê", async () => {
    const d = await t.newDraft("st-1", "tech-a", "org-a", XINTUS);
    const plan = await planOk(d, "RULES");
    const acc = await acceptOk(d, plan.runId);
    for (const [who, org] of [["tech-b", "org-b"], ["tech-off", "org-a"]] as const) {
      expect(reasonOf(await blueprints(who, org).accept(d.planId, d.revisionId, await acceptBody(d, plan.runId)))).toBe("not_found");
      expect(reasonOf(await blueprints(who, org).generate(d.planId, d.revisionId, await genBody(d, acc.acceptance.acceptanceId)))).toBe("blueprint_invalid");
      expect(await blueprints(who, org).current(d.planId, d.revisionId)).toBeNull();
    }
    expect(await t.n("SELECT COUNT(*) AS n FROM blueprint_acceptances WHERE revision_id = ?1", d.revisionId)).toBe(1);
  });

  it("o navegador nunca envia `blueprint`: generate e replan recusam, e a linha do aceite é só de acréscimo", async () => {
    const d = await t.newDraft("st-1", "tech-a", "org-a", XINTUS);
    const plan = await planOk(d, "RULES");
    const acc = await acceptOk(d, plan.runId);
    const forged = await genBody(d, acc.acceptance.acceptanceId, { ...XINTUS_ANSWERS, blueprint: { version: 1 } });
    expect(reasonOf(await blueprints().generate(d.planId, d.revisionId, forged))).toBe("invalid");
    expect(reasonOf(await blueprints().accept(d.planId, d.revisionId, { ...(await acceptBody(d, plan.runId)), blueprint: {} } as never))).toBe("invalid");
    await expect(t.run("UPDATE blueprint_acceptances SET strategy_id = 'S2' WHERE id = ?1", acc.acceptance.acceptanceId)).rejects.toThrow(/ACCEPTANCE_APPEND_ONLY/);
    await expect(t.run("DELETE FROM blueprint_acceptances WHERE id = ?1", acc.acceptance.acceptanceId)).rejects.toThrow(/ACCEPTANCE_APPEND_ONLY/);
  });
});

describe("falha da IA: continuar por regras leva ao mesmo aceite e à mesma geração", () => {
  it("quota do provedor (mock) -> canContinueByRules -> plan(RULES) -> aceitar -> gerar; nada foi cobrado a mais nem aplicado", async () => {
    await t.configure({ provider: "mock", model: "mock-quota", orgs: ["org-a"] });
    const d = await t.newDraft("st-1", "tech-a", "org-a", XINTUS);
    const failed: PlanningOutcome = await t.service().plan(d.planId, d.revisionId, { idempotencyKey: t.id("plan"), baseContentVersion: await t.contentVersion(d.revisionId), mode: "AI", answers: XINTUS_ANSWERS } as never);
    expect(failed).toMatchObject({ ok: false, canContinueByRules: true });
    expect(await blueprints().current(d.planId, d.revisionId)).toBeNull();
    const plan = await planOk(d, "RULES");
    const acc = await acceptOk(d, plan.runId);
    const out = await generateOk(d, acc.acceptance.acceptanceId);
    expect(out.complete).toBe(true);
    await untouched(d);
  });
});

describe("depois da geração pela estratégia: trocar, travar, regenerar, voltar à estratégia e atualizar mantêm as decisões do profissional", () => {
  async function started() {
    await t.configure({ provider: "mock", model: "mock-ul", orgs: ["org-a"] });
    const d = await t.newDraft("st-1", "tech-a", "org-a", XINTUS);
    const plan = await planOk(d, "AI");
    const acc = await acceptOk(d, plan.runId);
    const out = await generateOk(d, acc.acceptance.acceptanceId);
    return { d, plan, acc, out, version: out.version };
  }
  const slotsOf = (r: Awaited<ReturnType<typeof snapshot>>["result"], phaseIndex: number, label: string) => itemsOf(r, phaseIndex, label).map((i) => i.slotKey);

  it("trocar, travar, regenerar a fase, 'voltar à estratégia' com outro aceite e atualizar: trocas e travas ficam, o foco gravado vale, a prévia conta certo", async () => {
    const { d, plan, acc, out } = await started();
    let snap = await snapshot(d, out.proposalId);
    const first = (phase: number, label: string, skip = 0) => {
      const seen = new Set<string>();
      return snap.result.occurrences.filter((o) => o.phaseIndex === phase && o.label === label).flatMap((o) => o.items).filter((i) => (seen.has(i.slotKey) ? false : (seen.add(i.slotKey), true)))[skip];
    };

    // lock one item of phase 2 / B, substitute another of phase 2 / A (a different library exercise, chosen from the engine's alternatives)
    const lockedItem = first(2, "B", 0);
    const swapTarget = first(2, "A", 0);
    let v = out.version;
    v = proposalOk(await proposals().lock(d.planId, d.revisionId, { proposalId: out.proposalId, ...cas(v), targets: [{ phaseIndex: 2, slotKey: lockedItem.slotKey }], locked: true })).version;
    const alternatives = await proposals().alternatives(d.planId, d.revisionId, { proposalId: out.proposalId, phaseIndex: 2, slotKey: swapTarget.slotKey, week: 1, slot: 1 });
    if (alternatives.status !== "ok" || !alternatives.alternatives.length) throw new Error("alternatives");
    const swapTo = alternatives.alternatives[0].exerciseId;
    v = proposalOk(await proposals().substitute(d.planId, d.revisionId, { proposalId: out.proposalId, idempotencyKey: t.id("sub"), ...cas(v), target: { phaseIndex: 2, slotKey: swapTarget.slotKey, applies: { kind: "PHASE" } }, newExerciseId: swapTo })).version;

    snap = await snapshot(d, out.proposalId);
    const decided = () => snap.result.occurrences.filter((o) => o.phaseIndex === 2).flatMap((o) => o.items.filter((i) => i.origin !== "ENGINE").map((i) => `${o.week}|${o.slot}|${i.slotKey}|${i.exerciseId}|${i.origin}`)).sort();
    const decidedBefore = decided();
    expect(decidedBefore.some((x) => x.endsWith("|LOCKED"))).toBe(true);
    expect(decidedBefore.some((x) => x.endsWith(`|${swapTo}|SUBSTITUTED`))).toBe(true);
    const blockBefore = canonicalJson(blueprintOf(snap.header.parameters));

    // regenerate phase 2 with no change: the same plan, the same block
    v = proposalOk(await proposals().regenerate(d.planId, d.revisionId, { proposalId: out.proposalId, idempotencyKey: t.id("reg"), ...cas(v), scope: { kind: "PHASE", phaseIndex: 2 } })).version;
    snap = await snapshot(d, out.proposalId);
    expect(decided()).toEqual(decidedBefore);
    expect(canonicalJson(blueprintOf(snap.header.parameters))).toBe(blockBefore);

    // a second acceptance (phases 2 and 3 become full body) and "voltar à estratégia" from phase 2 on
    const second = await acceptOk(d, plan.runId, {
      phases: [2, 3].map((phaseIndex) => ({ phaseIndex, workouts: ["A", "B"].map((label) => ({ label, role: "FULL_BODY" as const, focusDelta: null, candidateExerciseIds: [] })) })),
    });
    const preview = await blueprints().replanPreview(d.planId, d.revisionId, out.proposalId, { kind: "FROM_PHASE", phaseIndex: 2 });
    const scopeItems = snap.result.occurrences.filter((o) => o.phaseIndex >= 2).flatMap((o) => o.items);
    expect(preview).toEqual({
      kept: scopeItems.filter((i) => i.origin !== "ENGINE").length,
      replaced: scopeItems.filter((i) => i.origin === "ENGINE").length,
      locked: scopeItems.filter((i) => i.origin === "LOCKED").length,
      substituted: scopeItems.filter((i) => i.origin === "SUBSTITUTED").length,
      preserved: scopeItems.filter((i) => i.origin === "PRESERVED").length,
      phases: [2, 3],
    });
    expect(preview!.kept).toBeGreaterThan(0);
    const replan = proposalOk(await blueprints().replan(d.planId, d.revisionId, { proposalId: out.proposalId, idempotencyKey: t.id("rep"), writeId: t.id("write"), expectedVersion: v, acceptanceId: second.acceptance.acceptanceId, scope: { kind: "FROM_PHASE", phaseIndex: 2 } }));
    v = replan.version;
    snap = await snapshot(d, out.proposalId);
    expect(decided()).toEqual(decidedBefore);
    const block = blueprintOf(snap.header.parameters)!;
    const roleOf = (p: number, l: string) => block.workouts.find((w) => w.phaseIndex === p && w.label === l)!;
    expect([roleOf(1, "A").acceptanceId, roleOf(2, "A").acceptanceId, roleOf(3, "B").acceptanceId]).toEqual([acc.acceptance.acceptanceId, second.acceptance.acceptanceId, second.acceptance.acceptanceId]);
    expect([roleOf(1, "A").role, roleOf(2, "A").role, roleOf(3, "B").role]).toEqual(["UPPER", "FULL_BODY", "FULL_BODY"]);
    expect(snap.result.workouts.filter((w) => w.phaseIndex === 1).map((w) => w.coverage?.blueprint?.role)).toEqual(["UPPER", "LOWER"]);
    expect(snap.result.workouts.filter((w) => w.phaseIndex === 2).map((w) => w.coverage?.blueprint?.role)).toEqual(["FULL_BODY", "FULL_BODY"]);
    // the audit and the links are refreshed with it
    expect(snap.result.audit!.strategy!.workouts.map((w) => `${w.phaseIndex}/${w.label}:${w.role}`)).toEqual(["1/A:UPPER", "1/B:LOWER", "2/A:FULL_BODY", "2/B:FULL_BODY", "3/A:FULL_BODY", "3/B:FULL_BODY"]);
    const links = await store().blueprintLinks(d.planId, d.revisionId, out.proposalId);
    expect(new Set(links.filter((l) => l.generationId === links[links.length - 1].generationId).map((l) => l.acceptanceId))).toEqual(new Set([acc.acceptance.acceptanceId, second.acceptance.acceptanceId]));

    // a later regeneration of phase 1 still reproduces the FIRST strategy's focus
    v = proposalOk(await proposals().regenerate(d.planId, d.revisionId, { proposalId: out.proposalId, idempotencyKey: t.id("reg"), ...cas(v), scope: { kind: "PHASE", phaseIndex: 1 } })).version;
    snap = await snapshot(d, out.proposalId);
    expect(snap.result.workouts.filter((w) => w.phaseIndex === 1).map((w) => w.coverage?.blueprint?.role)).toEqual(["UPPER", "LOWER"]);

    // the draft's rows changed (not the structure): refresh keeps the strategy block and the decisions
    await t.run("UPDATE plan_revisions SET content_version = content_version + 1 WHERE id = ?1", d.revisionId);
    const rebased = proposalOk(await proposals().rebase(d.planId, d.revisionId, { proposalId: out.proposalId, idempotencyKey: t.id("rb"), ...cas(v) }));
    snap = await snapshot(d, out.proposalId);
    expect(rebased.version).toBeGreaterThan(v);
    expect(decided()).toEqual(decidedBefore);
    expect(canonicalJson(blueprintOf(snap.header.parameters)!.workouts)).toBe(canonicalJson(block.workouts));
    expect(slotsOf(snap.result, 1, "A").length).toBeGreaterThan(0);
    await untouched(d);
  });

  it("'voltar à estratégia' só com o aceite atual, em proposta aberta, e uma fase de cada vez; FULL troca o bloco inteiro", async () => {
    const { d, plan, acc, out } = await started();
    const second = await acceptOk(d, plan.runId, { phases: [{ phaseIndex: 2, workouts: ["A", "B"].map((label) => ({ label, role: "FULL_BODY" as const, focusDelta: null, candidateExerciseIds: [] })) }] });
    const base = { proposalId: out.proposalId, writeId: t.id("write") };
    // the older acceptance is no longer the current one
    expect(reasonOf(await blueprints().replan(d.planId, d.revisionId, { ...base, idempotencyKey: t.id("rep"), expectedVersion: out.version, acceptanceId: acc.acceptance.acceptanceId, scope: { kind: "PHASE", phaseIndex: 1 } }))).toBe("blueprint_invalid");
    // one phase
    const one = proposalOk(await blueprints().replan(d.planId, d.revisionId, { ...base, writeId: t.id("write"), idempotencyKey: t.id("rep"), expectedVersion: out.version, acceptanceId: second.acceptance.acceptanceId, scope: { kind: "PHASE", phaseIndex: 2 } }));
    let block = blueprintOf((await snapshot(d, out.proposalId)).header.parameters)!;
    expect(block.workouts.map((w) => w.role)).toEqual(["UPPER", "LOWER", "FULL_BODY", "FULL_BODY", "UPPER", "LOWER"]);
    expect(block.acceptances.map((a) => a.acceptanceId).sort()).toEqual([acc.acceptance.acceptanceId, second.acceptance.acceptanceId].sort());
    // the whole proposal: the block is replaced (phases the acceptance does not list lose their focus entry because it lists them all)
    proposalOk(await blueprints().replan(d.planId, d.revisionId, { ...base, writeId: t.id("write"), idempotencyKey: t.id("rep"), expectedVersion: one.version, acceptanceId: second.acceptance.acceptanceId, scope: { kind: "FULL" } }));
    block = blueprintOf((await snapshot(d, out.proposalId)).header.parameters)!;
    expect(block.acceptances.map((a) => a.acceptanceId)).toEqual([second.acceptance.acceptanceId]);
    expect(block.workouts.map((w) => w.acceptanceId)).toEqual(new Array(6).fill(second.acceptance.acceptanceId));
    // a discarded proposal cannot be replanned
    const snap = await snapshot(d, out.proposalId);
    proposalOk(await proposals().discard(d.planId, d.revisionId, { proposalId: out.proposalId, ...cas(snap.header.version) }));
    expect(reasonOf(await blueprints().replan(d.planId, d.revisionId, { ...base, writeId: t.id("write"), idempotencyKey: t.id("rep"), expectedVersion: snap.header.version + 1, acceptanceId: second.acceptance.acceptanceId, scope: { kind: "FULL" } }))).toBe("closed");
    await untouched(d);
  });

  it("FULL e FROM_PHASE em proposta gerada pela metade: valem para as fases que existem, sem exigir as que faltam", async () => {
    await t.configure({ provider: "mock", model: "mock-ul", orgs: ["org-a"] });
    const d = await t.newDraft("st-1", "tech-a", "org-a", XINTUS);
    const plan = await planOk(d, "AI");
    const acc = await acceptOk(d, plan.runId);
    const small = blueprintService(t.db, t.org("tech-a", "org-a"), { now: () => NOW, workUnitsPerRequest: 1 });
    const out = proposalOk(await small.generate(d.planId, d.revisionId, await genBody(d, acc.acceptance.acceptanceId)));
    expect(out.complete).toBe(false);
    expect((await snapshot(d, out.proposalId)).header.phasesGenerated).toEqual([1]);
    const full = proposalOk(await blueprints().replan(d.planId, d.revisionId, { proposalId: out.proposalId, writeId: t.id("write"), idempotencyKey: t.id("rep"), expectedVersion: out.version, acceptanceId: acc.acceptance.acceptanceId, scope: { kind: "FULL" } }));
    const after = await snapshot(d, out.proposalId);
    expect(after.header.phasesGenerated).toEqual([1]);
    expect(full.complete).toBe(false);
    expect((await blueprints().replanPreview(d.planId, d.revisionId, out.proposalId, { kind: "FULL" }))?.phases).toEqual([1]);
    await untouched(d);
  });

  it("repetir a geração pela estratégia com a mesma chave devolve a proposta já criada, mesmo se a periodização mudou depois", async () => {
    const d = await t.newDraft("st-1", "tech-a", "org-a", XINTUS);
    const plan = await planOk(d, "RULES");
    const acc = await acceptOk(d, plan.runId);
    const body = await genBody(d, acc.acceptance.acceptanceId);
    const first = proposalOk(await blueprints().generate(d.planId, d.revisionId, body));
    const renamed = { ...XINTUS, phases: XINTUS.phases.map((p, i) => (i === 0 ? { ...p, name: "Outro nome" } : p)) };
    expect(await plansFor(t.db, t.org("tech-a")).saveDraft(d.planId, d.revisionId, renamed, NOW)).toBe(true);
    const again = proposalOk(await blueprints().generate(d.planId, d.revisionId, body));
    expect(again).toMatchObject({ proposalId: first.proposalId, replayed: true });
    // another acceptance for the same key is not a replay
    expect(await t.n("SELECT COUNT(*) AS n FROM prescription_proposals WHERE revision_id = ?1", d.revisionId)).toBe(1);
  });

  it("determinismo: o mesmo aceite em duas revisões iguais dá resultados canonicamente iguais; regenerar sem mudar devolve o mesmo plano", async () => {
    await t.configure({ provider: "mock", model: "mock-ul", orgs: ["org-a"] });
    const run = async () => {
      const d = await t.newDraft("st-1", "tech-a", "org-a", XINTUS);
      const plan = await planOk(d, "AI");
      const acc = await acceptOk(d, plan.runId);
      const out = await generateOk(d, acc.acceptance.acceptanceId);
      return { d, out, snap: await snapshot(d, out.proposalId) };
    };
    const a = await run();
    const b = await run();
    const strip = (r: Awaited<ReturnType<typeof snapshot>>["result"]) => canonicalJson({ ...r, occurrences: r.occurrences.map((o) => ({ ...o, items: o.items.map((i) => ({ ...i, trace: undefined })) })) });
    const sameBlock = (x: typeof a.snap) => canonicalJson(blueprintOf(x.header.parameters)!.workouts.map((w) => ({ ...w, acceptanceId: "<id>" })));
    expect(sameBlock(b.snap)).toBe(sameBlock(a.snap));
    expect(canonicalJson(b.snap.result.occurrences.map((o) => o.items.map((i) => i.exerciseId)))).toBe(canonicalJson(a.snap.result.occurrences.map((o) => o.items.map((i) => i.exerciseId))));
    void strip;
    const before = canonicalJson(a.snap.result.occurrences);
    proposalOk(await proposals().regenerate(a.d.planId, a.d.revisionId, { proposalId: a.out.proposalId, idempotencyKey: t.id("reg"), ...cas(a.out.version), scope: { kind: "FROM_PHASE", phaseIndex: 1 } }));
    expect(canonicalJson((await snapshot(a.d, a.out.proposalId)).result.occurrences)).toBe(before);
  });
});

describe("fronteira estática: a estratégia nunca aplica, aprova nem entrega", () => {
  const files = ["accept.ts", "blueprint-actions.ts"].map((f) => readFileSync(`src/modules/prescricao/planejador/${f}`, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""));
  it("nem accept.ts nem as ações chamam apply, previewApply, aprovação ou entrega; só o serviço de propostas gera", () => {
    for (const text of files) {
      expect(text).not.toMatch(/\.apply\(|previewApply|approve|deliver|aprova|entrega/i);
      expect(text).not.toMatch(/\b(INSERT INTO|UPDATE|DELETE FROM)\s+(plan_revisions|prescribed_exercises|prescription_proposals|training_plans)\b/i);
    }
    expect(files[0]).toMatch(/proposals\(\)\.generate\(/);
    expect(files[0]).toMatch(/proposals\(\)\.replan\(/);
  });
  it("as ações são só funções assíncronas sobre o serviço (a sessão vem do servidor)", () => {
    expect(files[1].match(/export async function/g)).toHaveLength(5);
    expect(files[1]).not.toMatch(/export (const|let|function) /);
    expect(files[1]).toMatch(/requireWorkspace/);
  });
});
