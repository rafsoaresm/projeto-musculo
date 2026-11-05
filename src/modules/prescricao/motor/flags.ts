/**
 * Alertas da triagem, da avaliação, da anamnese e do histórico. Só saída: nenhum alerta muda a
 * seleção sozinho. Cada sugestão vira uma decisão de um clique do profissional, usada na próxima
 * geração. Observações isoladas da avaliação (postura, flexibilidade) não são contraindicação.
 */
import { cmp, numberText, PATTERN_LABELS } from "./vocabulary";
import type { RuleLog } from "./trace";
import type { EngineInput, Flag, FlagDecision } from "./types";

/** Leitura da avaliação abaixo da mediana das leituras do próprio aluno, com a observação da regra. Nunca é contraindicação. */
export interface AssessmentObservation {
  key: string;
  code: string;
  label: string;
  level: number;
  median: number;
  patterns: string[];
  text: string;
  ref?: string;
}

function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/**
 * Observações da avaliação (regra FINDING_OBSERVATION_MAP, 2026.11.4+): para cada leitura estruturada do Flexiteste com
 * nível abaixo da mediana das leituras preenchidas do aluno e com entrada na regra. Sem a regra, nenhuma.
 */
export function assessmentObservations(log: RuleLog, input: EngineInput): AssessmentObservation[] {
  const map = log.optional("FINDING_OBSERVATION_MAP");
  if (!map) return [];
  const out: AssessmentObservation[] = [];
  for (const f of input.student.findings) {
    if (f.code !== "FLEXITEST" || !f.readings?.length) continue;
    const m = median(f.readings.map((r) => r.level));
    for (const r of [...f.readings].sort((a, b) => cmp(a.code, b.code))) {
      const key = `FLEXITEST:${r.code}`;
      const rule = map[key];
      if (!rule || !(r.level < m)) continue;
      out.push({ key, code: r.code, label: r.label, level: r.level, median: m, patterns: [...rule.patterns], text: rule.text, ...(f.ref ? { ref: f.ref } : {}) });
    }
  }
  return out;
}

export function buildFlags(log: RuleLog, input: EngineInput): Flag[] {
  const flags: Flag[] = [];
  const s = input.student.screening;
  const ref = s.ref ? { ref: s.ref } : {};
  if (s.parq === "NOT_DONE")
    flags.push({ code: "SCREENING_NOT_DONE", severity: "WARNING", source: "SCREENING", ...ref, message: "Triagem (PAR-Q) não registrada. A proposta é gerada, mas a aprovação segue as regras da triagem." });
  if (s.parq === "POSITIVE" && !s.professionalDecision)
    flags.push({ code: "SCREENING_REVIEW_REQUIRED", severity: "WARNING", source: "SCREENING", ...ref, message: "Triagem com resposta positiva sem decisão profissional registrada." });
  if (s.professionalDecision === "REFER")
    flags.push({ code: "SCREENING_REFERRED", severity: "WARNING", source: "SCREENING", ...ref, message: "Decisão registrada: encaminhar. Confira se o treino proposto é compatível com o encaminhamento." });
  if (s.professionalDecision === "CLEARED_WITH_RESTRICTIONS")
    flags.push({ code: "SCREENING_RESTRICTIONS", severity: "WARNING", source: "SCREENING", ...ref, message: "Liberado com restrições: transforme cada restrição em exclusão explícita (padrão, exercício ou cuidado)." });
  if (s.professionalDecision === "OTHER")
    flags.push({ code: "SCREENING_OTHER_DECISION", severity: "WARNING", source: "SCREENING", ...ref, message: "Decisão registrada: outra decisão. Leia a nota da triagem na avaliação e transforme o que ela pede em exclusões explícitas." });
  if (s.professionalDecision === "REVIEWED")
    flags.push({ code: "SCREENING_REVIEWED", severity: "INFO", source: "SCREENING", ...ref, message: "Alerta da triagem (formato anterior) revisado pelo profissional. Leia o fundamento registrado na avaliação." });
  if (s.medicalClearanceRecorded)
    flags.push({ code: "MEDICAL_CLEARANCE_RECORDED", severity: "INFO", source: "SCREENING", ...ref, message: "Decisão registrada: precisa de liberação médica. Não impede a geração nem a aprovação; confira a liberação antes de entregar." });

  const map = log.get("MOVEMENT_FINDING_PATTERN_MAP");
  const grades = new Set(log.get("MOVEMENT_FINDING_GRADES"));
  for (const f of input.student.findings) {
    const fref = f.ref ? { ref: f.ref } : {};
    if (f.kind === "MOVEMENT" && f.grade && grades.has(f.grade) && map[f.code]?.length) {
      for (const pattern of map[f.code]) {
        flags.push({
          code: `MOVEMENT_FINDING:${f.code}:${pattern}`, severity: "WARNING", source: "ASSESSMENT", ...fref,
          message: `${f.label}. Sugestão para decidir: evitar o padrão ${PATTERN_LABELS[pattern] ?? pattern}. Não é contraindicação automática.`,
          suggestedDecision: { kind: "EXCLUDE_PATTERN", pattern },
        });
      }
    } else if (f.kind === "ANAMNESIS") {
      flags.push({ code: `ANAMNESIS:${f.code}`, severity: "INFO", source: "ANAMNESIS", ...fref, message: `${f.label}. Interpretar e, se for o caso, registrar exclusões explícitas.` });
    } else {
      flags.push({ code: `ASSESSMENT:${f.kind}:${f.code}`, severity: "INFO", source: "ASSESSMENT", ...fref, message: `${f.label}. Observação isolada da avaliação: não muda a seleção.` });
    }
  }
  for (const o of assessmentObservations(log, input))
    flags.push({
      code: `ASSESSMENT_OBSERVATION:${o.key}`, severity: "INFO", source: "ASSESSMENT", ...(o.ref ? { ref: o.ref } : {}),
      message: `${o.label}: nível ${numberText(o.level)}, abaixo da mediana das leituras do aluno (${numberText(o.median)}). Observação na execução de ${o.patterns.map((p) => PATTERN_LABELS[p] ?? p).join(", ")}: ${o.text}. Não é contraindicação; nenhum exercício foi excluído.`,
    });
  const pain = [...new Set(input.history.filter((h) => h.pain && h.date <= input.asOf).map((h) => h.exerciseId))].sort(cmp);
  const names = new Map(input.catalog.map((e) => [e.id, e.name]));
  for (const id of pain)
    flags.push({
      code: `HISTORY_PAIN:${id}`, severity: "WARNING", source: "HISTORY",
      message: `Dor relatada pelo aluno em ${names.get(id) ?? "um exercício"}. Sugestão para decidir: excluir o exercício.`,
      suggestedDecision: { kind: "EXCLUDE_EXERCISE", exerciseId: id },
    });
  const decisions = new Map(input.parameters.acceptedFlagDecisions.map((d) => [d.flagCode, d.decision]));
  return flags.map((f) => (decisions.has(f.code) ? { ...f, decided: decisions.get(f.code) as FlagDecision } : f));
}
