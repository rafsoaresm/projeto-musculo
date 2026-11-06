/**
 * Sugestão de progressão pelo histórico de execução. É só sugestão, mostrada no traço e no painel
 * do item; nunca é gravada como valor da dose. Proteções: dor → REVIEW; dados faltando →
 * INSUFFICIENT_DATA; sem incremento do equipamento → MAINTAIN; aumento acima do teto → MAINTAIN.
 */
import { cmp } from "./vocabulary";
import { daysBetween } from "./calendar";
import type { CatalogExercise, Dose, ExposureLog, ProgressionProposal, ProgressionSettings } from "./types";

const RULE = "PROGRESSION_HISTORY";

function proposal(action: ProgressionProposal["action"], suggestedLoadKg: number | null, explanation: string, exposuresUsed: number): ProgressionProposal {
  return { action, suggestedLoadKg, explanation, basis: action === "MAINTAIN" && suggestedLoadKg !== null ? "STUDENT_DATA" : "HEURISTIC", ruleId: RULE, exposuresUsed };
}

export function proposeProgression(
  history: ExposureLog[],
  exercise: CatalogExercise,
  prescribed: Dose,
  settings: ProgressionSettings,
  today: string,
): ProgressionProposal {
  const relevant = history
    .filter((x) => x.exerciseId === exercise.id && x.date <= today && daysBetween(x.date, today) <= settings.windowDays)
    .sort((a, b) => cmp(a.date, b.date) || cmp(a.ref ?? "", b.ref ?? ""));
  if (!relevant.length) return proposal("INSUFFICIENT_DATA", null, "Sem registros deste exercício na janela de histórico.", 0);
  if (relevant.some((x) => x.pain)) return proposal("REVIEW", null, "Dor relatada em um registro: revisão profissional antes de qualquer progressão.", relevant.length);
  if (prescribed.metric !== "REPS") return proposal("INSUFFICIENT_DATA", null, "Sugestão por histórico só para doses por repetições.", 0);
  if (!Number.isInteger(settings.consecutiveSuccesses) || settings.consecutiveSuccesses < 1)
    return proposal("INSUFFICIENT_DATA", null, "Regra de progressão inválida (número de exposições).", 0);
  const n = settings.consecutiveSuccesses;
  // As N exposições cronologicamente mais recentes devem atender ao critério.
  // Filtrar primeiro as completas fazia uma sessão recente incompleta desaparecer e permitia progredir com sucessos antigos.
  const last = relevant.slice(-n);
  if (last.length < n) return proposal("INSUFFICIENT_DATA", null, `Menos de ${n} execuções disponíveis para comparação.`, last.length);
  if (last.some((x) => x.metric !== "REPS")) return proposal("REVIEW", null, "A métrica mudou entre as últimas execuções: revisão profissional antes de progredir.", n);
  if (last.some((x) => x.sets.length < prescribed.sets || x.sets.slice(0, prescribed.sets).some((set) => !set.completed)))
    return proposal("MAINTAIN", null, "Uma das últimas execuções está incompleta: não há sucessos consecutivos suficientes para sugerir aumento.", n);
  const equipment = last[0].equipmentKey;
  if (last.some((x) => x.equipmentKey !== equipment)) return proposal("REVIEW", null, "Equipamento diferente entre as execuções: não dá para comparar.", n);
  const sets = last.flatMap((x) => x.sets.slice(0, prescribed.sets));
  if (sets.some((s) => s.loadKg === null || s.loadBasis === null || s.rir === null || s.reps === null))
    return proposal("INSUFFICIENT_DATA", null, "Faltam carga, base da carga, repetições ou RIR por série.", n);
  if (sets.some((s) => s.loadBasis !== prescribed.loadBasis)) return proposal("REVIEW", null, "A base da carga registrada difere da prescrita.", n);
  // Política de dose (2026.11.6+): o que o aluno REGISTROU (repetições e RIR por série) pode pedir revisão da dose antes de qualquer
  // aumento. Só leitura de registros reais; nada aqui escreve dose, e o aumento segue exigindo o aceite do profissional.
  if (settings.conditional && sets.every((s) => (s.reps as number) < prescribed.reps.min))
    return proposal("REVIEW", null, `As repetições registradas ficaram abaixo da faixa prescrita (${prescribed.reps.min}–${prescribed.reps.max}) em ${n} execuções: rever a dose antes de progredir.`, n);
  const loads = [...new Set(sets.map((s) => s.loadKg as number))];
  if (loads.length !== 1) return proposal("REVIEW", null, "Cargas diferentes entre séries ou execuções: conferir antes de progredir.", n);
  const load = loads[0];
  const target = prescribed.intensity?.kind === "RIR" ? prescribed.intensity.range.min : null;
  if (target === null) return proposal("INSUFFICIENT_DATA", null, "A dose não usa RIR: sem como comparar o esforço registrado.", n);
  if (settings.conditional && sets.every((s) => (s.rir as number) < target))
    return proposal("REVIEW", null, `O esforço registrado ficou acima do indicado (RIR menor que o prescrito, ${target}) em ${n} execuções: rever a dose antes de progredir.`, n);
  if (!sets.every((s) => (s.reps as number) >= prescribed.reps.max && (s.rir as number) >= target))
    return proposal("MAINTAIN", load, "Ainda não atingiu o topo da faixa com o esforço indicado em todas as séries.", n);
  const inc = settings.incrementKg;
  if (inc === null || !Number.isFinite(inc) || inc <= 0) return proposal("MAINTAIN", load, "Topo da faixa atingido; o incremento do equipamento não foi informado, então a carga se mantém até o profissional decidir.", n);
  if (load <= 0 || inc / load > settings.maximumIncrementFraction)
    return proposal("MAINTAIN", load, "O menor incremento passa do aumento máximo configurado; não aumentar automaticamente.", n);
  return { action: "INCREASE", suggestedLoadKg: Math.round((load + inc) * 100) / 100, explanation: `Sugerir +${inc} kg na mesma base após ${n} execuções no topo da faixa; exige aceite do profissional.`, basis: "HEURISTIC", ruleId: RULE, exposuresUsed: n };
}
