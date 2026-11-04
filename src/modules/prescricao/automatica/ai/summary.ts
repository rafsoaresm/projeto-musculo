/**
 * Resumo compacto e sem identificação de uma versão da proposta, para uma revisão opcional por IA (design V3 §6).
 *
 * Entra: códigos de estímulo, nível de experiência (enum), minutos por sessão, modalidades, exercícios por apelido, achados da
 * avaliação só como código/grau/nível, a auditoria (faixas por músculo e padrão, achados com números) e os avisos do motor.
 * Não entra: nome, CPF, ids de aluno/plano/avaliação/exercício, datas, fotos, observações, texto livre do objetivo, da
 * anamnese ou dos nomes de treino, nem as sessões uma a uma.
 *
 * Determinístico: a mesma proposta dá o mesmo texto canônico (e a mesma chave de cache). Se passar de `maxChars`, corta nesta
 * ordem até caber: alternativas, achados INFO da auditoria, linhas de padrão. O que foi cortado fica contado em `omitted`.
 */
import "server-only";
import { canonicalJson } from "@/modules/prescricao/motor/hash";
import { getRuleSet } from "@/modules/prescricao/motor/rules";
import type { CatalogExercise, EngineResult, StudentFacts } from "@/modules/prescricao/motor/types";
import { normalizeText } from "@/modules/prescricao/motor/vocabulary";
import {
  workoutKey,
  type AiAllowedRefs,
  type AiReviewSummary,
  type AiSummaryAuditFinding,
  type AiSummaryExercise,
  type AiSummaryFinding,
  type AiSummaryIssue,
  type AiSummaryPhase,
} from "./contracts";

export const AI_SUMMARY_MAX_ALTERNATIVES = 5;
const ENUM_CODE = /^[A-Z0-9_]{1,60}$/;
/** Códigos estruturados dos achados (ex.: `FLEXITEST`, `TEST:pushup`, `ankle_dorsiflexion`): nunca texto livre. */
const FACT_CODE = /^[A-Za-z0-9_:.-]{1,80}$/;
const EXPERIENCES = new Set(["BEGINNER", "INTERMEDIATE", "ADVANCED"]);

export interface AiSummaryBuild {
  summary: AiReviewSummary;
  allowed: AiAllowedRefs;
  /** Tamanho do texto canônico do resumo. */
  chars: number;
  /** false: nem os cortes permitidos couberam em `maxChars` (o resumo não deve ser enviado). */
  fits: boolean;
}

const codes = (list: readonly string[] | null | undefined, re = ENUM_CODE) => [...new Set((list ?? []).filter((c) => re.test(c)))];

export function buildAiSummary(
  result: EngineResult,
  student: StudentFacts,
  catalog: ReadonlyMap<string, CatalogExercise>,
  limits: { maxChars: number },
): AiSummaryBuild {
  // Apelidos de exercício: na ordem fase → treino → semana → sessão → posição; alternativas depois das do plano.
  const aliasOf = new Map<string, string>();
  const alias = (id: string): string => {
    let a = aliasOf.get(id);
    if (!a) aliasOf.set(id, (a = `X${aliasOf.size + 1}`));
    return a;
  };
  const occurrences = [...result.occurrences].sort((a, b) => a.phaseIndex - b.phaseIndex || a.week - b.week || a.slot - b.slot);
  const audit = result.audit ?? null;

  // Rótulos de treino também por apelido (`T1`…): o rótulo é livre e pode carregar texto do profissional. O mesmo rótulo
  // em fases diferentes recebe o mesmo apelido, para que o rodízio continue legível.
  const workoutAliasOf = new Map<string, string>();
  const workoutAlias = (label: string): string => {
    let a = workoutAliasOf.get(label);
    if (!a) workoutAliasOf.set(label, (a = `T${workoutAliasOf.size + 1}`));
    return a;
  };

  const phases: AiSummaryPhase[] = [...result.phases]
    .sort((a, b) => a.phaseIndex - b.phaseIndex)
    .map((p) => {
      const inPhase = occurrences.filter((o) => o.phaseIndex === p.phaseIndex);
      const auditPhase = audit?.phases.find((a) => a.phaseIndex === p.phaseIndex) ?? null;
      const workouts = result.workouts
        .filter((w) => w.phaseIndex === p.phaseIndex)
        .map((w) => {
          const planned: string[] = [];
          const pool: string[] = [];
          const unlisted = new Set<string>();
          const mine = inPhase.filter((x) => x.label === w.label);
          for (const o of mine)
            for (const item of [...o.items].sort((a, b) => a.position - b.position)) {
              if (!item.exerciseId || !catalog.has(item.exerciseId)) {
                unlisted.add(item.slotKey);
                continue;
              }
              if (!planned.includes(item.exerciseId)) planned.push(item.exerciseId);
              for (const alt of item.alternatives) if (catalog.has(alt) && !pool.includes(alt)) pool.push(alt);
            }
          return {
            label: workoutAlias(w.label),
            modalities: codes(w.modalities?.value ?? mine.flatMap((o) => o.items.map((i) => i.modality ?? ""))).sort(),
            exposuresPerWeek: auditPhase?.workouts.find((r) => r.label === w.label)?.exposuresPerWeek ?? null,
            exercises: planned.map(alias),
            unlistedItems: unlisted.size,
            // ids por enquanto: recebem apelido depois de todos os exercícios do plano
            alternatives: pool.filter((id) => !planned.includes(id)).slice(0, AI_SUMMARY_MAX_ALTERNATIVES),
          };
        });
      return {
        phaseIndex: p.phaseIndex,
        weeks: p.weeks,
        sessionsPerWeek: p.sessionsPerWeek,
        stimuli: codes(inPhase.map((o) => o.stimulus?.value ?? "")).sort(),
        workouts,
        muscles: (auditPhase?.muscles ?? [])
          .filter((m) => m.isTarget || m.classification !== "NONE")
          .map((m) => ({
            muscle: m.muscle, isTarget: m.isTarget, classification: m.classification,
            direct: m.direct, weighted: m.weighted, directSessions: m.directSessions,
          })),
        musclesWithoutStimulus: (auditPhase?.muscles ?? []).filter((m) => !m.isTarget && m.classification === "NONE").map((m) => m.muscle),
        patterns: (auditPhase?.patterns ?? [])
          .filter((r) => r.isTarget || r.sessions.max > 0)
          .map((r) => ({ pattern: r.pattern, isTarget: r.isTarget, sets: r.sets, sessions: r.sessions })),
        patternsWithoutStimulus: (auditPhase?.patterns ?? []).filter((r) => !r.isTarget && r.sessions.max === 0).map((r) => r.pattern),
      };
    });
  for (const p of phases) for (const w of p.workouts) w.alternatives = w.alternatives.map(alias);
  const workoutRows = phases.flatMap((p) => p.workouts);

  const findings: AiSummaryFinding[] = [];
  for (const f of student.findings) {
    if (!FACT_CODE.test(f.code) || !ENUM_CODE.test(f.kind)) continue;
    const row: AiSummaryFinding = { alias: `F${findings.length + 1}`, kind: f.kind, code: f.code };
    if (f.grade && FACT_CODE.test(f.grade)) row.grade = f.grade;
    const readings = (f.readings ?? []).filter((r) => FACT_CODE.test(r.code) && Number.isFinite(r.level)).map((r) => ({ code: r.code, level: r.level }));
    if (readings.length) row.readings = readings;
    findings.push(row);
  }

  const auditFindings: AiSummaryAuditFinding[] = (audit?.findings ?? []).map((f, i) => {
    const row: AiSummaryAuditFinding = { alias: `A${i + 1}`, code: f.code, severity: f.severity, status: f.status };
    if (f.phaseIndex !== undefined) row.phaseIndex = f.phaseIndex;
    if (f.week !== undefined) row.week = f.week;
    if (f.label !== undefined && workoutAliasOf.has(f.label)) row.label = workoutAliasOf.get(f.label);
    if (f.muscle !== undefined) row.muscle = f.muscle;
    if (f.pattern !== undefined) row.pattern = f.pattern;
    if (f.measured) row.measured = { unit: f.measured.unit, value: f.measured.value, ...(f.measured.from !== undefined ? { from: f.measured.from } : {}) };
    if (f.target)
      row.target = {
        unit: f.target.unit, basis: f.target.basis,
        ...(f.target.min !== undefined ? { min: f.target.min } : {}),
        ...(f.target.max !== undefined ? { max: f.target.max } : {}),
      };
    return row;
  });

  const issues: AiSummaryIssue[] = result.issues
    .filter((i) => i.severity !== "INFO" && ENUM_CODE.test(i.code))
    .map((i, n) => ({
      alias: `I${n + 1}`, code: i.code, severity: i.severity,
      ...(i.phaseIndex !== undefined ? { phaseIndex: i.phaseIndex } : {}),
      ...(i.label !== undefined && workoutAliasOf.has(i.label) ? { label: workoutAliasOf.get(i.label) } : {}),
    }));

  const level = student.level?.value;
  const mapped = level ? getRuleSet(result.rules)?.rules.EXPERIENCE_MAP.value[normalizeText(level)] : undefined;
  const minutes = student.sessionMinutes?.value;
  const omitted = { alternatives: 0, infoFindings: 0, patternRows: 0 };
  const exerciseRow = (id: string): AiSummaryExercise => {
    const e = catalog.get(id)!;
    return {
      alias: aliasOf.get(id)!, name: e.name.slice(0, 80), modality: e.modality && ENUM_CODE.test(e.modality) ? e.modality : null,
      primaryMuscles: codes(e.primaryMuscles), secondaryMuscles: codes(e.secondaryMuscles), patterns: codes(e.patterns),
    };
  };
  const idOfAlias = new Map([...aliasOf].map(([id, a]) => [a, id]));

  const assemble = (): AiReviewSummary => {
    const used = new Set(workoutRows.flatMap((w) => [...w.exercises, ...w.alternatives]));
    return {
      engineVersion: result.engineVersion,
      rules: `${result.rules.id}@${result.rules.version}`,
      auditVersion: audit?.auditVersion ?? null,
      student: {
        experience: mapped && EXPERIENCES.has(mapped) ? (mapped as AiReviewSummary["student"]["experience"]) : null,
        sessionMinutes: typeof minutes === "number" && Number.isFinite(minutes) ? minutes : null,
      },
      phases: phases.map((p) => ({ ...p, workouts: p.workouts.map((w) => ({ ...w })), patterns: [...p.patterns] })),
      findings,
      audit: auditFindings,
      issues,
      exercises: [...used].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))).map((a) => exerciseRow(idOfAlias.get(a)!)),
      omitted: { ...omitted },
    };
  };

  // Corte determinístico. A estimativa desconta o tamanho do elemento retirado; o tamanho real é conferido antes de parar.
  let chars = canonicalJson(assemble()).length;
  let estimate = chars;
  const cut = (removed: unknown) => (estimate -= canonicalJson(removed).length + 1);
  while (chars > limits.maxChars) {
    if (estimate <= limits.maxChars) {
      chars = canonicalJson(assemble()).length;
      estimate = chars;
      if (chars <= limits.maxChars) break;
    }
    const most = Math.max(0, ...workoutRows.map((w) => w.alternatives.length));
    const infoAt = auditFindings.map((f) => f.severity).lastIndexOf("INFO");
    const patternPhase = [...phases].reverse().find((p) => p.patterns.length > 0);
    if (most > 0) {
      const w = [...workoutRows].reverse().find((x) => x.alternatives.length === most)!;
      cut(w.alternatives.pop());
      omitted.alternatives++;
    } else if (infoAt >= 0) {
      cut(auditFindings.splice(infoAt, 1)[0]);
      omitted.infoFindings++;
    } else if (patternPhase) {
      cut(patternPhase.patterns.pop());
      omitted.patternRows++;
    } else {
      chars = canonicalJson(assemble()).length;
      break;
    }
  }

  const summary = assemble();
  chars = canonicalJson(summary).length;
  const allowed: AiAllowedRefs = {
    workouts: Object.fromEntries(summary.phases.map((p) => [String(p.phaseIndex), p.workouts.map((w) => w.label)])),
    eligibleByWorkout: Object.fromEntries(
      summary.phases.flatMap((p) => p.workouts.map((w) => [workoutKey(p.phaseIndex, w.label), [...w.exercises, ...w.alternatives]])),
    ),
    refs: [
      ...summary.findings.map((f) => f.alias),
      ...summary.audit.map((f) => f.alias),
      ...summary.issues.map((i) => i.alias),
      ...summary.exercises.map((e) => e.alias),
    ],
    exerciseIds: Object.fromEntries(summary.exercises.map((e) => [e.alias, idOfAlias.get(e.alias)!])),
    workoutLabels: Object.fromEntries([...workoutAliasOf].map(([label, a]) => [a, label])),
  };
  return { summary, allowed, chars, fits: chars <= limits.maxChars };
}
