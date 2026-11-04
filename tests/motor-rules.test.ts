import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_RULESET, REFERENCES, RULESETS, TECHNICAL_LIMITS, canonicalJson, describeStructuredDose, generate, getRuleSet,
  renderRulesTable, sha256Hex, toDisplayFields, validateDose, validateRuleSet, type Basis, type Dose, type EngineResult,
} from "@/modules/prescricao/motor";
import { baseInput, parameters, structure } from "./helpers/motor-fixtures";

const BASES: Basis[] = ["EVIDENCE", "HEURISTIC", "HEURISTIC_ACCEPTED", "PROFESSIONAL", "STUDENT_DATA"];

/** Para cada valor da dose, os parâmetros do traço que podem tê-lo produzido (um basta). */
function traceNeeds(dose: Dose): string[][] {
  const out: string[][] = [];
  const intensity = ["intensity", "rirMin", "rirMax", "rpeMin", "rpeMax"];
  const opt = (v: unknown, names: string[]) => { if (v !== undefined && v !== null) out.push(names); };
  switch (dose.metric) {
    case "REPS":
      out.push(["sets"], ["repsMin", "repsMax"], ["loadBasis"]);
      opt(dose.restSeconds, ["restSeconds"]); opt(dose.intensity, intensity); opt(dose.tempo, ["tempo"]);
      opt(dose.method, ["method"]); opt(dose.loadInstruction, ["loadInstruction"]);
      break;
    case "TIME":
      out.push(["sets"], ["durationMin", "durationMax"]);
      opt(dose.restSeconds, ["restSeconds"]); opt(dose.intensity, intensity); opt(dose.method, ["method"]);
      break;
    case "DISTANCE":
      out.push(["sets"], ["distanceMin", "distanceMax"]);
      opt(dose.restSeconds, ["restSeconds"]); opt(dose.intensity, intensity);
      break;
    case "INTERVALS":
      out.push(["blocks"], ["repeats"], ["recoveryMin", "recoveryMax"], ["recoveryMode"]);
      opt(dose.work.durationSeconds, ["workDurationMin", "workDurationMax"]); opt(dose.work.distanceMeters, ["workDistanceMin", "workDistanceMax"]);
      opt(dose.work.intensity, intensity); opt(dose.restBetweenBlocksSeconds, ["restBetweenBlocks"]);
      break;
    case "CONTINUOUS":
      opt(dose.durationSeconds, ["durationMin", "durationMax"]); opt(dose.distanceMeters, ["distanceMin", "distanceMax"]); opt(dose.intensity, intensity);
      break;
  }
  return out;
}

function variety(): EngineResult[] {
  return [
    generate(baseInput()),
    generate(baseInput({ parameters: parameters({ progressionByPhase: [{ phaseIndex: 1, progression: { model: "LINEAR", ramps: [{ param: "sets", from: 2, to: 4 }], deload: { weeks: [4], setsMultiplier: 0.5 } } }] }) })),
    generate(baseInput({
      structure: structure("2026-11-09", [{ weeks: 2, sessionsPerWeek: 3, workouts: [
        { label: "Z2", exerciseTarget: 1, focus: { stimulus: { value: "AEROBIC_ENDURANCE", source: "STRUCTURE", basis: "PROFESSIONAL" } } },
        { label: "HIIT", exerciseTarget: 1, focus: { stimulus: { value: "INTERVALS", source: "STRUCTURE", basis: "PROFESSIONAL" } } },
        { label: "Mob", exerciseTarget: 2, focus: { stimulus: { value: "MOBILITY", source: "STRUCTURE", basis: "PROFESSIONAL" } } },
      ] }]),
    })),
  ];
}

describe("motor: regras, bases e referências", () => {
  it("todo conjunto publicado é válido", () => {
    for (const [id, rules] of Object.entries(RULESETS)) expect(validateRuleSet(rules), id).toEqual([]);
  });

  it("nenhuma regra é EVIDENCE enquanto as referências não forem verificadas", () => {
    const rules = getRuleSet(DEFAULT_RULESET)!;
    expect(REFERENCES.every((r) => r.status === "UNVERIFIED")).toBe(true);
    for (const [id, entry] of Object.entries(rules.rules)) expect(entry.basis, id).toBe("HEURISTIC");
    const forged = JSON.parse(JSON.stringify(rules));
    forged.rules.INDIRECT_VOLUME_FACTOR.basis = "EVIDENCE";
    expect(validateRuleSet(forged).join(" ")).toMatch(/EVIDENCE com referência não verificada/);
    forged.rules.INDIRECT_VOLUME_FACTOR.refs = ["INVENTADA"];
    expect(validateRuleSet(forged).join(" ")).toMatch(/referência inexistente/);
  });

  it("o conjunto publicado é congelado", () => {
    const rules = getRuleSet(DEFAULT_RULESET)!;
    expect(Object.isFrozen(rules.rules.DOSE_DEFAULTS.value[0].values)).toBe(true);
    expect(() => { (rules.rules.ALTERNATIVES_LIMIT as { value: number }).value = 99; }).toThrow();
  });

  it("todo parâmetro e toda escolha da proposta têm base conhecida", () => {
    for (const r of variety())
      for (const o of r.occurrences)
        for (const item of o.items) {
          for (const p of item.trace.params) expect(BASES, `${item.exerciseName}.${p.param}`).toContain(p.basis);
          for (const s of item.trace.selection) expect(BASES).toContain(s.basis);
          if (item.dose && item.origin === "ENGINE") {
            const params = new Set(item.trace.params.map((p) => p.param));
            expect(params.has("metric")).toBe(true);
            for (const need of traceNeeds(item.dose))
              expect(need.some((p) => params.has(p)), `${item.exerciseName}: ${need.join("|")} sem traço`).toBe(true);
          }
        }
  });

  it("referências não verificadas não saem em nenhum resultado", () => {
    for (const r of variety()) {
      const text = canonicalJson(r);
      expect(text).not.toMatch(/PELLAND|CURRIER|41343037|41843416|"refs"/);
      expect(text).not.toMatch(/"EVIDENCE"/);
    }
  });

  it("rulesUsed lista o que foi lido, com base e descrição", () => {
    const r = generate(baseInput());
    const used = r.rulesUsed.map((u) => u.ruleId);
    expect(used).toEqual([...used].sort());
    expect(used).toEqual(expect.arrayContaining(["DOSE_DEFAULTS", "SELECTION_WEIGHTS", "DURATION", "INDIRECT_VOLUME_FACTOR"]));
    expect(r.rulesUsed.every((u) => u.basis === "HEURISTIC" && u.label.length > 10)).toBe(true);
  });

  it("docs/MOTOR-PRESCRICAO.md tem a tabela de regras atual (sem divergência)", () => {
    const doc = readFileSync(join(process.cwd(), "docs/MOTOR-PRESCRICAO.md"), "utf8");
    const m = doc.match(/<!-- regras:inicio -->\n([\s\S]*?)\n<!-- regras:fim -->/);
    expect(m, "marcadores da tabela").not.toBeNull();
    expect(m![1].trim()).toBe(renderRulesTable(getRuleSet(DEFAULT_RULESET)!).trim());
  });

  it("o motor não importa nada que aprove, entregue ou acesse o banco (grafo inteiro, além da pasta)", () => {
    const root = join(process.cwd(), "src");
    const resolve = (from: string, spec: string): string | null => {
      const base = spec.startsWith("@/") ? join(root, spec.slice(2)) : spec.startsWith(".") ? join(dirname(from), spec) : null;
      if (!base) return null;
      for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) if (existsSync(c) && statSync(c).isFile()) return c;
      throw new Error(`${from}: não resolvi ${spec}`);
    };
    const PACKAGES = new Set(["zod"]);
    const seen = new Set<string>();
    const queue = [join(root, "modules/prescricao/motor/index.ts")];
    while (queue.length) {
      const f = queue.pop()!;
      if (seen.has(f)) continue;
      seen.add(f);
      const src = readFileSync(f, "utf8");
      if (f.endsWith(".json")) continue;
      expect(src, f).not.toMatch(/\bapprove\b|\bdeliver\b|planos\/actions|getCloudflareContext|env\.DB|"use server"|server-only/);
      for (const [, spec] of src.matchAll(/(?:from|import)\s*\(?\s*"([^"]+)"/g)) {
        const target = resolve(f, spec);
        if (target === null) {
          expect(PACKAGES.has(spec), `${f} importa o pacote ${spec}`).toBe(true);
          continue;
        }
        expect(target.startsWith(join(root, "db")) || target.includes("/actions"), `${f} importa ${spec}`).toBe(false);
        queue.push(target);
      }
    }
    // o grafo sai da pasta do motor (contratos da prescrição e da biblioteca) e foi seguido
    expect([...seen].some((f) => f.includes("modules/biblioteca/contracts"))).toBe(true);
  });

  it("um conjunto publicado nunca muda sob a mesma versão (SHA-256 fixado)", async () => {
    // Mudou um número? Publique uma nova versão em rules/ e acrescente o hash dela aqui; nunca troque um hash existente.
    const PUBLISHED: Record<string, string> = {
      "gymgital-base@2026.11.1": "556661b43ccff6132af17ba773dcbfb5e43bdb077a0e41ca21df53ab0f798764",
      "gymgital-base@2026.11.2": "7e08a7c38504ed0b033532c57b813decba7789e5d419fd5dff3143d1ba2a2ae5",
    };
    for (const [id, rules] of Object.entries(RULESETS)) {
      expect(PUBLISHED[id], `${id} sem hash fixado`).toBeDefined();
      expect(await sha256Hex(canonicalJson(rules)), id).toBe(PUBLISHED[id]);
    }
  });
});

describe("motor: modelos de dose e texto", () => {
  const cases: Array<[Dose, string]> = [
    [{ metric: "REPS", sets: 3, reps: { min: 8, max: 12 }, intensity: { kind: "RIR", range: { min: 1, max: 3 } }, tempo: "3-1-1", restSeconds: 90, loadBasis: "PER_HAND", loadKg: null, method: { kind: "SUPERSET", groupKey: "A" } },
      "3 × 8–12 repetições · RIR 1–3 · cadência 3-1-1 · descanso 90 s · carga por mão · Bi-set (grupo A)"],
    [{ metric: "REPS", sets: 5, reps: { min: 5, max: 5 }, intensity: { kind: "PERCENT_1RM", range: { min: 75, max: 80 } }, restSeconds: 180, loadBasis: "TOTAL", loadKg: null },
      "5 × 5 repetições · 75–80% de 1RM · descanso 3 min"],
    [{ metric: "TIME", sets: 2, durationSeconds: { min: 30, max: 45 }, restSeconds: 15 }, "2 × 30–45 s · descanso 15 s"],
    [{ metric: "DISTANCE", sets: 4, distanceMeters: { min: 400, max: 400 }, intensity: { kind: "PACE", secondsPerKm: { min: 300, max: 330 } }, restSeconds: 120 },
      "4 × 400 m · ritmo 5:00–5:30 /km · descanso 2 min"],
    [{ metric: "INTERVALS", blocks: 2, repeats: 6, work: { durationSeconds: { min: 30, max: 30 }, intensity: { kind: "ZONE", systemLabel: "Zona", zone: "5" } }, recovery: { durationSeconds: { min: 60, max: 90 }, mode: "ACTIVE" }, restBetweenBlocksSeconds: 180 },
      "2 blocos de 6 × 30 s (Zona 5) · recuperação ativa 60–90 s · descanso entre blocos 3 min"],
    [{ metric: "CONTINUOUS", durationSeconds: { min: 1200, max: 1800 }, intensity: { kind: "RPE", range: { min: 4, max: 5 } } }, "20–30 min contínuos · PSE 4–5"],
    [{ metric: "CONTINUOUS", distanceMeters: { min: 5000, max: 5000 } }, "5 km"],
  ];
  it.each(cases)("texto pt-BR: %j", (dose, text) => {
    expect(describeStructuredDose(dose)).toBe(text);
    expect(validateDose(dose)).toEqual([]);
    const d = toDisplayFields(dose);
    expect(d.doseText).toBe(text);
    for (const [k, max] of Object.entries(TECHNICAL_LIMITS.DISPLAY)) {
      const v = (d as unknown as Record<string, string | null>)[k];
      if (v) expect(v.length, k).toBeLessThanOrEqual(max);
    }
  });

  it("campos da ficha atual a partir da dose", () => {
    expect(toDisplayFields(cases[0][0])).toMatchObject({ sets: "3", reps: "8–12", cadence: "3-1-1", restSeconds: 90, restText: "90 s", rirMin: 1, rirMax: 3 });
    expect(toDisplayFields(null)).toMatchObject({ sets: null, reps: null, doseText: "Dose a definir pelo profissional" });
    expect(toDisplayFields(cases[4][0])).toMatchObject({ sets: "2 × 6", reps: "30 s", restText: "rec. 60–90 s" });
  });

  it.each([
    [{ metric: "REPS", sets: 2.5, reps: { min: 8, max: 12 }, restSeconds: 60, loadBasis: "TOTAL", loadKg: null }],
    [{ metric: "REPS", sets: 3, reps: { min: 12, max: 8 }, restSeconds: 60, loadBasis: "TOTAL", loadKg: null }],
    [{ metric: "REPS", sets: 3, reps: { min: 8, max: 12 }, restSeconds: -1, loadBasis: "TOTAL", loadKg: null }],
    [{ metric: "REPS", sets: 3, reps: { min: 8, max: 12 }, restSeconds: 60, loadBasis: "TOTAL", loadKg: 80 }],
    [{ metric: "REPS", sets: 3, reps: { min: 8, max: 12 }, intensity: { kind: "RIR", range: { min: 2, max: 14 } }, restSeconds: 60, loadBasis: "TOTAL", loadKg: null }],
    [{ metric: "TIME", sets: 1, durationSeconds: { min: Number.POSITIVE_INFINITY, max: 10 }, restSeconds: null }],
    [{ metric: "INTERVALS", blocks: 1, repeats: 4, work: {}, recovery: { durationSeconds: { min: 60, max: 60 }, mode: "PASSIVE" }, restBetweenBlocksSeconds: null }],
    [{ metric: "CONTINUOUS" }],
  ] as unknown as Array<[Dose]>)("dose inválida → DOSE_INVALID, sem lançar: %j", (dose) => {
    const issues = validateDose(dose);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.code === "DOSE_INVALID" && i.severity === "ERROR")).toBe(true);
  });

  it("séries 0 continuam 0 (não viram vazio nem 1)", () => {
    const d: Dose = { metric: "REPS", sets: 0, reps: { min: 8, max: 12 }, restSeconds: 60, loadBasis: "TOTAL", loadKg: null };
    expect(validateDose(d)).toEqual([]);
    expect(toDisplayFields(d).sets).toBe("0");
  });

  it("limites técnicos: alternativas e texto resumidos com aviso, nunca falha", () => {
    const st = structure("2026-11-09", [{ weeks: 1, sessionsPerWeek: 1, stimulus: "HYPERTROPHY", workouts: [{ label: "A", exerciseTarget: 1 }] }]);
    const long = "x".repeat(400);
    const r = generate(baseInput({ structure: st, parameters: parameters({ doseOverrides: [{ patch: { tempo: long } }] }) }));
    const item = r.occurrences[0].items[0];
    expect(item.display.doseText.length).toBeLessThanOrEqual(300);
    expect(item.display.cadence!.length).toBeLessThanOrEqual(40);
    expect(r.issues.map((i) => i.code)).toContain("DISPLAY_TRUNCATED");
    expect(item.alternatives.length).toBeLessThanOrEqual(TECHNICAL_LIMITS.MAX_ALTERNATIVES);
    expect(JSON.stringify(item.trace).length).toBeLessThanOrEqual(TECHNICAL_LIMITS.MAX_TRACE_JSON);
  });

  it("desempenho indicativo (Node): 12 fases × 4 semanas × 6 sessões com 200 exercícios", () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ ...baseInput().catalog[i % baseInput().catalog.length], id: `gen-${String(i).padStart(3, "0")}` }));
    const input = baseInput({
      catalog: many,
      structure: structure("2026-11-09", Array.from({ length: 12 }, () => ({ weeks: 4, sessionsPerWeek: 6, stimulus: "HYPERTROPHY", workouts: ["A", "B", "C"].map((label) => ({ label, exerciseTarget: 8 })) }))),
    });
    const t0 = performance.now();
    const r = generate(input);
    const ms = performance.now() - t0;
    expect(r.occurrences).toHaveLength(12 * 4 * 6);
    expect(ms).toBeLessThan(5000);
  });
});
