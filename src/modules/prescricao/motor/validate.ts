/** Validação da entrada: nunca lança; cada problema vira um aviso (ERROR torna a proposta INFEASIBLE). */
import { validDate } from "./calendar";
import { TECHNICAL_LIMITS } from "./bounds";
import { validateProgression } from "./progress-week";
import type { EngineInput, Issue } from "./types";

const intOk = (n: unknown, min: number) => typeof n === "number" && Number.isInteger(n) && n >= min;
const numOk = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0;

export function validateInput(input: EngineInput): Issue[] {
  const out: Issue[] = [];
  const err = (code: string, path: string, message: string, extra: Partial<Issue> = {}) =>
    out.push({ severity: "ERROR", code, path, message, stage: "INPUT", ...extra });
  if (!validDate(input.asOf)) err("INPUT_INVALID", "asOf", "Data de referência inválida.");
  if (!validDate(input.structure.startDate)) err("INPUT_INVALID", "structure.startDate", "Data de início da periodização inválida.");
  const phases = input.structure.phases;
  if (!phases.length) err("INPUT_INVALID", "structure.phases", "A periodização não tem fases.");
  if (phases.length > TECHNICAL_LIMITS.MAX_PHASES)
    err("PHASES_OVER_TECHNICAL_LIMIT", "structure.phases", `${phases.length} fases; o limite técnico de gravação é ${TECHNICAL_LIMITS.MAX_PHASES}.`);
  const indexes = new Set<number>();
  for (const p of phases) {
    const path = `phases.${p.index}`;
    if (indexes.has(p.index)) err("INPUT_INVALID", path, `Fase ${p.index} repetida.`);
    indexes.add(p.index);
    if (!intOk(p.weeks, 1)) err("INPUT_INVALID", `${path}.weeks`, `Fase ${p.index}: semanas precisam ser um inteiro ≥ 1.`, { phaseIndex: p.index });
    if (!intOk(p.sessionsPerWeek, 0)) err("INPUT_INVALID", `${path}.sessionsPerWeek`, `Fase ${p.index}: sessões por semana inválidas.`, { phaseIndex: p.index });
    else if (p.sessionsPerWeek > TECHNICAL_LIMITS.MAX_SESSIONS_PER_WEEK)
      err("SESSIONS_OVER_TECHNICAL_LIMIT", `${path}.sessionsPerWeek`, `Fase ${p.index}: ${p.sessionsPerWeek} sessões por semana; limite técnico ${TECHNICAL_LIMITS.MAX_SESSIONS_PER_WEEK}.`, { phaseIndex: p.index });
    const labels = new Set<string>();
    for (const w of p.workouts) {
      if (!w.label.trim()) err("INPUT_INVALID", `${path}.workouts`, `Fase ${p.index}: treino sem rótulo.`, { phaseIndex: p.index });
      if (labels.has(w.label)) err("INPUT_INVALID", `${path}.workouts.${w.label}`, `Fase ${p.index}: treino ${w.label} repetido.`, { phaseIndex: p.index, label: w.label });
      labels.add(w.label);
      if (w.exerciseTarget !== null && !intOk(w.exerciseTarget, 0))
        err("INPUT_INVALID", `${path}.workouts.${w.label}.exerciseTarget`, `Treino ${w.label}: quantidade de exercícios inválida.`, { phaseIndex: p.index, label: w.label });
      if (w.focus.minutes !== undefined && !(numOk(w.focus.minutes) && w.focus.minutes > 0))
        err("INPUT_INVALID", `${path}.workouts.${w.label}.minutes`, `Treino ${w.label}: tempo inválido.`, { phaseIndex: p.index, label: w.label });
    }
    if (p.sessionsPerWeek > 0 && intOk(p.weeks, 1) && !p.occurrences.length)
      err("OCCURRENCES_MISSING", path, `Fase ${p.index}: nenhuma sessão no calendário.`, { phaseIndex: p.index });
    const keys = new Set<string>();
    for (const o of p.occurrences) {
      const okey = `${o.week}:${o.slot}`;
      if (keys.has(okey)) err("INPUT_INVALID", `${path}.occurrences.${okey}`, `Fase ${p.index}: sessão ${okey} repetida.`, { phaseIndex: p.index });
      keys.add(okey);
      if (!intOk(o.week, 1) || o.week > p.weeks || !intOk(o.slot, 1) || o.slot > p.sessionsPerWeek)
        err("INPUT_INVALID", `${path}.occurrences.${okey}`, `Fase ${p.index}: sessão ${okey} fora da fase.`, { phaseIndex: p.index });
      if (!labels.has(o.label))
        err("OCCURRENCE_LABEL_UNKNOWN", `${path}.occurrences.${okey}`, `Fase ${p.index}: a sessão ${okey} usa o treino ${o.label}, que não existe.`, { phaseIndex: p.index, label: o.label });
      if (o.plannedDate !== null && !validDate(o.plannedDate)) err("INPUT_INVALID", `${path}.occurrences.${okey}.plannedDate`, "Data prevista inválida.", { phaseIndex: p.index });
    }
    const prof = input.parameters.progressionByPhase.find((x) => x.phaseIndex === p.index)?.progression ?? p.progression?.value;
    if (prof && intOk(p.weeks, 1))
      for (const problem of validateProgression(prof, p.weeks))
        err("PROGRESSION_INVALID", `${path}.progression`, `Fase ${p.index}: ${problem}.`, { phaseIndex: p.index });
  }
  const ids = new Set<string>();
  for (const e of input.catalog) {
    if (ids.has(e.id)) err("INPUT_INVALID", `catalog.${e.id}`, `Exercício ${e.id} repetido no catálogo.`);
    ids.add(e.id);
    if (e.difficulty !== null && !(numOk(e.difficulty))) err("INPUT_INVALID", `catalog.${e.id}.difficulty`, `${e.name}: dificuldade inválida.`);
    if (e.secondsPerRep !== null && !(numOk(e.secondsPerRep) && e.secondsPerRep > 0)) err("INPUT_INVALID", `catalog.${e.id}.secondsPerRep`, `${e.name}: segundos por repetição inválidos.`);
  }
  const P = input.parameters;
  if (P.availableMinutes !== null && !(numOk(P.availableMinutes) && P.availableMinutes > 0)) err("INPUT_INVALID", "parameters.availableMinutes", "Tempo disponível inválido.");
  for (const c of P.exerciseCountByWorkout)
    if (c.count !== "BY_TIME" && !intOk(c.count, 0)) err("INPUT_INVALID", "parameters.exerciseCountByWorkout", `Quantidade inválida no treino ${c.label}.`, { phaseIndex: c.phaseIndex, label: c.label });
  for (const [i, o] of P.doseOverrides.entries())
    for (const [k, v] of Object.entries(o.patch.values ?? {}))
      if (!numOk(v)) err("DOSE_INVALID", `parameters.doseOverrides[${i}].${k}`, `Ajuste de dose com ${k} inválido (negativo, infinito ou vazio).`);
  for (const id of [...P.preferredExerciseIds, ...P.excludedExerciseIds])
    if (!ids.has(id)) err("INPUT_INVALID", "parameters.exercises", `Exercício ${id} não está na biblioteca visível.`);
  if (input.scope.kind === "PHASES")
    for (const i of input.scope.phaseIndexes)
      if (!indexes.has(i)) err("INPUT_INVALID", "scope", `Fase ${i} não existe.`);
  return out;
}
