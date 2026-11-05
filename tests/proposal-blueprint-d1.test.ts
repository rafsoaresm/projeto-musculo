/**
 * Motor V4, PR 2.2: o blueprint aceito grava junto com a versão da proposta (migration 0048), no mesmo lote da geração, e volta no
 * modelo de leitura com os hashes (compilado, do planejador e da resposta do modelo). D1 local (Miniflare/workerd, migrations 0001–0048).
 * A montagem do aceite a partir do banco é da sub-etapa 2.3: aqui as linhas de execução e de aceite são semeadas por SQL, como o
 * servidor as teria gravado, e o bloco compilado entra pelo argumento interno do serviço (nunca pelo payload).
 */
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { plansFor } from "@/db/plans";
import { proposalsFor } from "@/db/prescription-proposals";
import type { BlueprintAnswers, GenerationAnswersInput } from "@/modules/prescricao/automatica/contracts";
import { blueprintOf, itemProvenance, proposalBlueprintView } from "@/modules/prescricao/automatica/blueprint-view";
import { mergeBlueprint, proposalService, type ProposalOutcome } from "@/modules/prescricao/automatica/service";
import { canonicalJson, sha256Hex } from "@/modules/prescricao/motor";
import { ALL_MIGRATIONS, migrate } from "./helpers/migrate";

let mf: Miniflare;
let db: D1Database;
const scope = (userId: string, organizationId = "org-a") => ({ userId, organizationId });
const NOW = new Date("2026-11-20T15:00:00Z");
const service = (userId = "tech-a", organizationId = "org-a") => proposalService(db, scope(userId, organizationId), { now: () => NOW });
const repo = (userId = "tech-a", organizationId = "org-a") => proposalsFor(db, scope(userId, organizationId));
const run = (sql: string, ...binds: unknown[]) => db.prepare(sql).bind(...binds).run();
const count = async (sql: string, ...binds: unknown[]) => (await db.prepare(sql).bind(...binds).first<{ n: number }>())!.n;
let seq = 0;
const id = (label: string) => `${label}-${String(++seq).padStart(4, "0")}-0000-0000-000000000000`.slice(0, 40);

const V2 = {
  schemaVersion: 2, startDate: "2026-11-23",
  phases: [
    { name: "Base", weeks: 3, sessionsPerWeek: 2, workouts: [{ label: "A", exerciseTarget: 4 }, { label: "B", exerciseTarget: 4 }], trainingDays: [0, 3] },
    { name: "Força", weeks: 2, sessionsPerWeek: 1, workouts: [{ label: "Full", exerciseTarget: 3 }] },
    { name: "Pico", weeks: 1, sessionsPerWeek: 1, workouts: [{ label: "Full", exerciseTarget: 2 }] },
  ],
};
const ANSWERS: GenerationAnswersInput = {
  stimulusByPhase: [
    { phaseIndex: 1, value: "HYPERTROPHY", basis: "PROFESSIONAL" },
    { phaseIndex: 2, value: "STRENGTH", basis: "PROFESSIONAL" },
    { phaseIndex: 3, value: "STRENGTH", basis: "PROFESSIONAL" },
  ],
  equipmentCodes: ["BARBELL", "RACK", "MACHINE", "DUMBBELL", "BENCH", "CABLE", "PULL_UP_BAR"],
};
const ok = (o: ProposalOutcome) => {
  if (!o.ok) throw new Error(`${o.reason}: ${o.message}`);
  return o;
};
const failure = (o: ProposalOutcome) => (o.ok ? "ok" : o.reason);

interface Draft { planId: string; revisionId: string }
async function newDraft(student = "st-1", orgUser = "tech-a"): Promise<Draft> {
  const created = await plansFor(db, scope(orgUser)).create(student, { title: "Plano gerado", input: V2 as never });
  if (!created) throw new Error("plan");
  return created;
}
const contentVersion = (d: Draft) => count("SELECT content_version AS n FROM plan_revisions WHERE id = ?1", d.revisionId);

const hex = (c: string) => c.repeat(64);
interface Seeded { acceptanceId: string; runId: string; blueprintHash: string; responseHash: string | null; acceptanceHash: string }
/** The rows the acceptance flow (2.3) writes: the planner run and the professional's acceptance, on this revision. */
async function seedAcceptance(d: Draft, over: { mode?: "AI" | "RULES"; student?: string; orgId?: string } = {}): Promise<Seeded> {
  const mode = over.mode ?? "RULES";
  const n = ++seq;
  const runId = `run-${n}`;
  const acceptanceId = `acc-${n}`;
  const responseHash = mode === "AI" ? hex("e") : null;
  const blueprintHash = hex("b");
  await run(
    `INSERT INTO planning_runs(id,organization_id,plan_id,revision_id,idempotency_key,request_hash,mode,status,base_content_version,structure_fingerprint,context_hash,response_hash,blueprint_hash,requested_by_user_id,started_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7,'SUCCEEDED',1,?8,?9,?10,?11,'tech-a','x')`,
    runId, over.orgId ?? "org-a", d.planId, d.revisionId, `runkey-${String(n).padStart(12, "0")}`, hex("a"), mode, "f".repeat(32), hex("c"), responseHash, blueprintHash,
  );
  await run(
    `INSERT INTO blueprint_acceptances(id,organization_id,plan_id,revision_id,run_id,idempotency_key,request_hash,strategy_id,split_family,final_json,acceptance_hash,structure_fingerprint,base_content_version,accepted_by_user_id,accepted_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7,'S1','UPPER_LOWER','{}',?8,?9,1,'tech-a','x')`,
    acceptanceId, over.orgId ?? "org-a", d.planId, d.revisionId, runId, `acckey-${String(n).padStart(12, "0")}`, hex("a"), hex("d"), "f".repeat(32),
  );
  return { acceptanceId, runId, blueprintHash, responseHash, acceptanceHash: hex("d") };
}

/** A (phase 1) superior, B inferior; the other phases' "Full" are full body. */
function block(s: Seeded, source: "AI_SUGGESTED" | "RULES_HEURISTIC" = "RULES_HEURISTIC"): BlueprintAnswers {
  const w = (phaseIndex: number, label: string, role: BlueprintAnswers["workouts"][number]["role"]) => ({
    phaseIndex, label, acceptanceId: s.acceptanceId, role, source, focusDelta: null, candidateExerciseIds: [] as string[],
  });
  return {
    version: 1,
    structureFingerprint: "f".repeat(32),
    acceptances: [{ acceptanceId: s.acceptanceId, runId: s.runId, blueprintHash: s.blueprintHash, acceptanceHash: s.acceptanceHash, strategyId: "S1", splitFamily: "UPPER_LOWER", source }],
    workouts: [w(1, "A", "UPPER"), w(1, "B", "LOWER"), w(2, "Full", "FULL_BODY"), w(3, "Full", "FULL_BODY")],
  };
}
async function generatedWith(d: Draft, b: BlueprintAnswers, answers: GenerationAnswersInput = ANSWERS, who = service()) {
  return who.generate(d.planId, d.revisionId, { idempotencyKey: id("gen"), baseContentVersion: await contentVersion(d), answers }, { blueprint: b });
}
const cas = (version: number) => ({ writeId: id("write"), expectedVersion: version });

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('test'); } };",
      compatibilityDate: "2026-10-23",
      d1Databases: { DB: "proposal-blueprint-tests" },
      cf: false,
    }),
  );
  db = await mf.getD1Database("DB");
  await migrate(db, ALL_MIGRATIONS);
  const people = ["tech-a", "tech-b", "client-1"];
  await db.batch([
    ...people.map((p) => db.prepare("INSERT INTO auth_user(id,name,email,created_at,updated_at) VALUES (?1,?1,?2,0,0)").bind(p, `${p}@example.test`)),
    db.prepare(`INSERT INTO users(id) VALUES ${people.map((p) => `('${p}')`).join(",")}`),
    db.prepare("INSERT INTO organizations(id,name) VALUES ('org-a','Studio A'),('org-b','Studio B')"),
    db.prepare("INSERT INTO memberships(organization_id,user_id,role) VALUES ('org-a','tech-a','TECHNICAL'),('org-b','tech-b','TECHNICAL')"),
    db.prepare("INSERT INTO professionals(id,organization_id,user_id,display_name) VALUES ('pro-a','org-a','tech-a','Pro A'),('pro-b','org-b','tech-b','Pro B')"),
    db.prepare("INSERT INTO students(id,organization_id,display_name) VALUES ('st-1','org-a','One'),('st-b','org-b','B')"),
    db.prepare("INSERT INTO care_assignments(organization_id,student_id,professional_id) VALUES ('org-a','st-1','pro-a'),('org-b','st-b','pro-b')"),
    db.prepare("INSERT INTO student_access(organization_id,student_id,user_id) VALUES ('org-a','st-1','client-1')"),
    db.prepare(
      `INSERT INTO student_profiles(student_id,organization_id,goal,level,days_per_week,session_minutes,injuries,updated_by_user_id)
       VALUES ('st-1','org-a','Hipertrofia','Intermediário',3,60,'SEGREDO-LESAO','tech-a')`,
    ),
  ]);
});
afterAll(async () => {
  await mf?.dispose();
});

describe("a geração com a estratégia aceita grava o bloco e o vínculo no mesmo lote", () => {
  it("o bloco compilado volta nas respostas gravadas; o vínculo traz os hashes da execução; os treinos A e B se diferenciam", async () => {
    const d = await newDraft();
    const s = await seedAcceptance(d, { mode: "AI" });
    const b = block(s, "AI_SUGGESTED");
    const out = ok(await generatedWith(d, b));
    expect(out).toMatchObject({ version: 1, complete: true });
    const snap = (await repo().asEngineResult(d.planId, d.revisionId, out.proposalId))!;
    // round trip: the stored answers carry the compiled block, canonically
    expect(canonicalJson((snap.header.parameters as { blueprint: unknown }).blueprint)).toBe(canonicalJson(b));
    expect(blueprintOf(snap.header.parameters)).toEqual(b);
    // the focus reached the engine: the stored workouts carry the blueprint coverage, the audit carries the strategy block
    const cov = snap.result.workouts.filter((w) => w.phaseIndex === 1).map((w) => [w.label, w.coverage?.origin, w.coverage?.blueprint?.role, w.coverage?.blueprint?.source]);
    expect(cov).toEqual([["A", "BLUEPRINT_FOCUS", "UPPER", "AI_SUGGESTED"], ["B", "BLUEPRINT_FOCUS", "LOWER", "AI_SUGGESTED"]]);
    expect(snap.result.audit!.auditVersion).toBe("1.1.0");
    expect(snap.result.audit!.strategy!.strategyIds).toEqual(["S1"]);
    const musclesIn = (label: string) =>
      new Set(snap.result.occurrences.filter((o) => o.phaseIndex === 1 && o.label === label).flatMap((o) => o.items.map((i) => i.exerciseName)));
    expect([...musclesIn("A")].filter((n) => musclesIn("B").has(n))).toEqual([]);
    // the link: one row for the generation, with the hashes of the run, read from the run itself (never from the caller)
    const links = await repo().blueprintLinks(d.planId, d.revisionId, out.proposalId);
    const gen = (await db.prepare("SELECT id, rules_id AS r, rules_version AS v FROM prescription_generations WHERE proposal_id = ?1").bind(out.proposalId).first<{ id: string; r: string; v: string }>())!;
    expect(links).toEqual([
      {
        generationId: gen.id, acceptanceId: s.acceptanceId, runId: s.runId, compiledHash: await sha256Hex(canonicalJson(b)), blueprintHash: s.blueprintHash,
        responseHash: s.responseHash, rulesId: "gymgital-base", rulesVersion: "2026.11.5", createdAt: NOW.toISOString(),
      },
    ]);
    expect(gen).toMatchObject({ r: "gymgital-base", v: "2026.11.5" });
  });

  it("o modelo de leitura devolve estratégia, papéis, origens e o registro; uma execução por regras não tem hash de resposta", async () => {
    const d = await newDraft();
    const s = await seedAcceptance(d, { mode: "RULES" });
    const out = ok(await generatedWith(d, block(s)));
    const view = await service().blueprint(d.planId, d.revisionId, out.proposalId);
    expect(view.status).toBe("ok");
    if (view.status !== "ok" || !view.blueprint) throw new Error("view");
    expect(view.blueprint.strategies).toEqual([
      { acceptanceId: s.acceptanceId, strategyId: "S1", splitFamily: "UPPER_LOWER", familyLabel: "Superior / Inferior", source: "RULES_HEURISTIC", originLabel: "Padrão por regras (editável)" },
    ]);
    expect(view.blueprint.workouts.filter((w) => w.phaseIndex === 1).map((w) => [w.label, w.roleLabel, w.originLabel])).toEqual([
      ["A", "Superior", "Padrão por regras (editável)"], ["B", "Inferior", "Padrão por regras (editável)"],
    ]);
    expect(view.blueprint.record.runs).toEqual([{ acceptanceId: s.acceptanceId, runId: s.runId, blueprintHash: s.blueprintHash, responseHash: null, kind: "RULES" }]);
    expect(view.blueprint.record.generations).toHaveLength(1);
    // an AI run is labelled as such and carries its response hash
    const d2 = await newDraft();
    const ai = await seedAcceptance(d2, { mode: "AI" });
    const out2 = ok(await generatedWith(d2, block(ai, "AI_SUGGESTED")));
    const v2 = await service().blueprint(d2.planId, d2.revisionId, out2.proposalId);
    if (v2.status !== "ok" || !v2.blueprint) throw new Error("view");
    expect(v2.blueprint.record.runs[0]).toMatchObject({ kind: "AI", responseHash: hex("e") });
    expect(v2.blueprint.strategies[0].originLabel).toBe("Sugestão da IA");
  });

  it("cada operação grava um vínculo novo e refaz a auditoria; a regeneração de uma fase reproduz o foco da primeira estratégia", async () => {
    const d = await newDraft();
    const s = await seedAcceptance(d);
    const first = ok(await generatedWith(d, block(s)));
    const before = (await repo().asEngineResult(d.planId, d.revisionId, first.proposalId))!;
    const next = ok(await service().regenerate(d.planId, d.revisionId, { proposalId: first.proposalId, idempotencyKey: id("key"), ...cas(1), scope: { kind: "PHASE", phaseIndex: 1 } }));
    expect(next.version).toBe(2);
    const after = (await repo().asEngineResult(d.planId, d.revisionId, first.proposalId))!;
    expect(after.result.workouts.map((w) => w.coverage?.blueprint?.role)).toEqual(before.result.workouts.map((w) => w.coverage?.blueprint?.role));
    expect(after.result.audit!.strategy).toBeDefined();
    const links = await repo().blueprintLinks(d.planId, d.revisionId, first.proposalId);
    expect(links).toHaveLength(2);
    expect(new Set(links.map((l) => l.generationId)).size).toBe(2);
    expect(new Set(links.map((l) => l.compiledHash)).size).toBe(1);
    // the audit stored with the proposal after the operation covers every strategy workout again (A, B, and "Full" of phases 2 and 3)
    expect(after.result.audit!.strategy!.workouts.map((w) => `${w.phaseIndex}/${w.label}`)).toEqual(["1/A", "1/B", "2/Full", "3/Full"]);
  });
});

describe("atomicidade, aceite de outra revisão e isolamento", () => {
  it("um aceite que não é desta revisão (ou não existe) falha o lote inteiro: nenhuma proposta, geração ou vínculo", async () => {
    const d = await newDraft();
    const other = await newDraft();
    const foreign = await seedAcceptance(other);
    const before = {
      proposals: await count("SELECT COUNT(*) AS n FROM prescription_proposals WHERE revision_id = ?1", d.revisionId),
      gens: await count("SELECT COUNT(*) AS n FROM prescription_generations WHERE revision_id = ?1", d.revisionId),
      links: await count("SELECT COUNT(*) AS n FROM proposal_blueprint_links"),
    };
    expect(failure(await generatedWith(d, block(foreign)))).toBe("blueprint_invalid");
    const ghost: Seeded = { ...foreign, acceptanceId: "acc-inexistente" };
    expect(failure(await generatedWith(d, block(ghost)))).toBe("blueprint_invalid");
    expect(await count("SELECT COUNT(*) AS n FROM prescription_proposals WHERE revision_id = ?1", d.revisionId)).toBe(before.proposals);
    expect(await count("SELECT COUNT(*) AS n FROM prescription_generations WHERE revision_id = ?1", d.revisionId)).toBe(before.gens);
    expect(await count("SELECT COUNT(*) AS n FROM proposal_blueprint_links")).toBe(before.links);
    // the revision is free: the right acceptance still generates
    const mine = await seedAcceptance(d);
    ok(await generatedWith(d, block(mine)));
  });

  it("os vínculos são imutáveis (sem UPDATE nem DELETE) e só ligam gerações da própria proposta", async () => {
    const d = await newDraft();
    const s = await seedAcceptance(d);
    const out = ok(await generatedWith(d, block(s)));
    await expect(run("UPDATE proposal_blueprint_links SET compiled_hash = ?1 WHERE proposal_id = ?2", hex("9"), out.proposalId)).rejects.toThrow(/BLUEPRINT_LINK_APPEND_ONLY/);
    await expect(run("DELETE FROM proposal_blueprint_links WHERE proposal_id = ?1", out.proposalId)).rejects.toThrow(/BLUEPRINT_LINK_APPEND_ONLY/);
    const gen = (await db.prepare("SELECT id FROM prescription_generations WHERE proposal_id = ?1").bind(out.proposalId).first<{ id: string }>())!;
    // a generation of another proposal / an acceptance of another revision cannot be linked by hand either
    const d2 = await newDraft();
    const s2 = await seedAcceptance(d2);
    await expect(
      run(
        `INSERT INTO proposal_blueprint_links(id,organization_id,proposal_id,generation_id,acceptance_id,run_id,compiled_hash,rules_id,rules_version,created_at)
         VALUES ('l-x','org-a',?1,?2,?3,?4,?5,'gymgital-base','2026.11.5','x')`,
        out.proposalId, gen.id, s2.acceptanceId, s2.runId, hex("1"),
      ),
    ).rejects.toThrow(/BLUEPRINT_LINK_INVALID/);
  });

  it("outra organização não lê o vínculo nem o modelo de leitura", async () => {
    const d = await newDraft();
    const s = await seedAcceptance(d);
    const out = ok(await generatedWith(d, block(s)));
    expect(await repo("tech-b", "org-b").blueprintLinks(d.planId, d.revisionId, out.proposalId)).toEqual([]);
    expect(await service("tech-b", "org-b").blueprint(d.planId, d.revisionId, out.proposalId)).toEqual({ status: "not_found" });
  });

  it("uma proposta sem estratégia (e uma antiga, sem vínculo) lê como antes", async () => {
    const d = await newDraft();
    const out = ok(await service().generate(d.planId, d.revisionId, { idempotencyKey: id("gen"), baseContentVersion: await contentVersion(d), answers: ANSWERS }));
    expect(await count("SELECT COUNT(*) AS n FROM proposal_blueprint_links WHERE proposal_id = ?1", out.proposalId)).toBe(0);
    expect(await service().blueprint(d.planId, d.revisionId, out.proposalId)).toEqual({ status: "ok", blueprint: null });
    const snap = (await repo().asEngineResult(d.planId, d.revisionId, out.proposalId))!;
    expect(snap.result.audit?.auditVersion).toBe("1.0.0");
    expect("strategy" in snap.result.audit!).toBe(false);
    expect(JSON.stringify(snap.header.parameters)).not.toContain("blueprint");
  });

  it("o navegador nunca envia `blueprint`: generate e regenerate recusam, e nada é gravado", async () => {
    const d = await newDraft();
    const s = await seedAcceptance(d);
    const forged = { ...ANSWERS, blueprint: block(s) } as unknown as GenerationAnswersInput;
    const refused = await service().generate(d.planId, d.revisionId, { idempotencyKey: id("gen"), baseContentVersion: await contentVersion(d), answers: forged });
    expect(failure(refused)).toBe("invalid");
    const real = ok(await generatedWith(d, block(s)));
    const regen = await service().regenerate(d.planId, d.revisionId, { proposalId: real.proposalId, idempotencyKey: id("key"), ...cas(1), scope: { kind: "PHASE", phaseIndex: 1 }, answers: { blueprint: block(s) } as never });
    expect(failure(regen)).toBe("invalid");
    expect(await count("SELECT COUNT(*) AS n FROM proposal_blueprint_links WHERE proposal_id = ?1", real.proposalId)).toBe(1);
  });

  it("o vínculo guarda só ids, códigos e hashes: nenhum texto de saúde, nenhuma chave", async () => {
    const rows = await db.prepare("SELECT * FROM proposal_blueprint_links").all<Record<string, unknown>>();
    expect(rows.results.length).toBeGreaterThan(0);
    for (const r of rows.results) {
      expect(JSON.stringify(r)).not.toContain("SEGREDO");
      for (const k of ["compiled_hash", "blueprint_hash", "response_hash"]) if (r[k] !== null) expect(String(r[k])).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe("patchAnswers: a estratégia de uma replanejada parcial não reescreve as outras fases", () => {
  const s1: Seeded = { acceptanceId: "acc-1", runId: "run-1", blueprintHash: hex("1"), responseHash: null, acceptanceHash: hex("2") };
  const s2: Seeded = { acceptanceId: "acc-2", runId: "run-2", blueprintHash: hex("3"), responseHash: null, acceptanceHash: hex("4") };
  const first = block(s1);
  const secondPhases = (): BlueprintAnswers => ({
    ...block(s2), workouts: block(s2).workouts.filter((w) => w.phaseIndex >= 2).map((w) => ({ ...w, role: "UPPER" as const })),
  });

  it("uma replanejada a partir da fase 2 mantém a fase 1 com o PRIMEIRO aceite e troca as outras", () => {
    const merged = mergeBlueprint(first, secondPhases(), false) as BlueprintAnswers;
    expect(merged.workouts.filter((w) => w.phaseIndex === 1).every((w) => w.acceptanceId === "acc-1")).toBe(true);
    expect(merged.workouts.filter((w) => w.phaseIndex >= 2).every((w) => w.acceptanceId === "acc-2")).toBe(true);
    expect(merged.acceptances.map((a) => a.acceptanceId)).toEqual(["acc-1", "acc-2"]);
    expect(merged.workouts.map((w) => [w.phaseIndex, w.label])).toEqual([[1, "A"], [1, "B"], [2, "Full"], [3, "Full"]]);
  });

  it("o aceite que nenhum treino cita mais é descartado; a troca completa substitui tudo", () => {
    const over = { ...block(s2), workouts: block(s2).workouts.map((w) => ({ ...w, role: "UPPER" as const })) };
    const merged = mergeBlueprint(first, over, false) as BlueprintAnswers;
    expect(merged.acceptances.map((a) => a.acceptanceId)).toEqual(["acc-2"]);
    expect(mergeBlueprint(first, secondPhases(), true)).toEqual(secondPhases());
    expect(mergeBlueprint(first, "lixo", false)).toBe("lixo");
    expect(mergeBlueprint(undefined, first, false)).toEqual(first);
  });

  it("a doses da primeira ficam quando a nova não envia as suas", () => {
    const withDosing = { ...first, dosing: { byClass: [], progression: [{ phaseIndex: 1, intent: "HOLD" as const }] } };
    expect((mergeBlueprint(withDosing, secondPhases(), false) as BlueprintAnswers).dosing).toEqual(withDosing.dosing);
  });
});

describe("a origem de cada item", () => {
  const trace = (basis: "HEURISTIC" | "STUDENT_DATA" | "PROFESSIONAL", code = "RANK") => ({ selection: [{ code, basis, detail: "" }], params: [] as Array<{ param: string; value: unknown; basis: "HEURISTIC" | "PROFESSIONAL"; ruleId?: string }> });
  const cov = (source: "AI_SUGGESTED" | "RULES_HEURISTIC" | "PROFESSIONAL") => ({
    muscles: [], patterns: [], basis: "HEURISTIC_ACCEPTED" as const, origin: "BLUEPRINT_FOCUS" as const,
    blueprint: { role: "UPPER" as const, source, strategyId: "S1", supporting: [], spillover: [], candidates: [] },
  });

  it("profissional, regra, IA e dado do aluno aparecem em facetas separadas, e a IA nunca vira evidência", () => {
    const engine = itemProvenance({ origin: "ENGINE", trace: trace("HEURISTIC") }, { coverage: cov("AI_SUGGESTED") });
    expect(engine).toMatchObject({ decidedBy: "AI_SUGGESTED", focus: "AI_SUGGESTED", selection: "RULES_HEURISTIC", dose: "RULES_HEURISTIC", studentData: false });
    expect(engine.labels).toMatchObject({ decidedBy: "Sugestão da IA", focus: "Sugestão da IA", selection: "Padrão por regras (editável)", studentData: null });
    expect(JSON.stringify(engine.labels)).not.toMatch(/evidência/i);
    const rules = itemProvenance({ origin: "ENGINE", trace: trace("STUDENT_DATA", "HISTORY_CONTINUITY") }, { coverage: cov("RULES_HEURISTIC") });
    expect(rules).toMatchObject({ decidedBy: "RULES_HEURISTIC", focus: "RULES_HEURISTIC", studentData: true });
    expect(rules.labels.studentData).toBe("Dado do aluno");
    for (const origin of ["PRESERVED", "LOCKED", "SUBSTITUTED"] as const)
      expect(itemProvenance({ origin, trace: trace("HEURISTIC") }, { coverage: cov("AI_SUGGESTED") }).decidedBy).toBe("PROFESSIONAL");
    const noFocus = itemProvenance({ origin: "ENGINE", trace: { selection: [], params: [{ param: "sets", value: 3, basis: "PROFESSIONAL" }] } }, { coverage: null });
    expect(noFocus).toMatchObject({ decidedBy: "RULES_HEURISTIC", focus: null, dose: "PROFESSIONAL" });
    expect(noFocus.labels.focus).toBeNull();
  });

  it("a visão do bloco sem estratégia é nula e um bloco inválido não quebra a leitura", () => {
    expect(proposalBlueprintView({}, [])).toBeNull();
    expect(proposalBlueprintView({ blueprint: { lixo: true } }, [])).toBeNull();
  });
});
