/**
 * Política de dose por perfil (regras 2026.11.6+). Puro: escolhe, entre os perfis do conjunto de regras, o que a biblioteca e o
 * estímulo justificam, e escreve nos rascunhos da dose apenas repetições, RIR e descanso (nunca séries, nunca carga).
 *
 * Princípios (docs/MOTOR-PRESCRICAO.md, "Política de dose por perfil"):
 *  - um número só difere entre exercícios quando uma regra diz por quê (cada valor traz perfil, motivos e "o que mudaria");
 *  - metadado que falta na biblioteca (composto, lateralidade, dificuldade, padrões, músculos) nunca é adivinhado: o critério
 *    fica DESCONHECIDO, o perfil que dependeria dele não é aplicado e a incerteza é registrada;
 *  - o profissional vence (ajustes de dose e linhas preservadas são aplicados depois, em dose.ts), e a progressão da fase por último.
 */
import type { RuleLog } from "./trace";
import type { DoseProfile, DoseProfileCriteria } from "./rules";
import type { DoseDraft } from "./dose";
import type { CatalogExercise, DoseParam, Experience, ExerciseClass, Issue, Metric, OccurrenceOut, ParamTrace } from "./types";
import { DOSE_UNCERTAIN_CODE, DOSE_UNCERTAIN_SEGMENT } from "./trace";

/** Campos de metadado que um perfil pode ler; quando nulos viram incerteza. */
export type ProfileField = "compound" | "laterality" | "difficulty" | "patterns" | "primaryMuscles";
const FIELD_ORDER: readonly ProfileField[] = ["compound", "laterality", "difficulty", "patterns", "primaryMuscles"];
export const PROFILE_FIELD_LABELS: Record<ProfileField, string> = {
  compound: "composto ou isolado", laterality: "lateralidade", difficulty: "dificuldade", patterns: "padrões de movimento", primaryMuscles: "músculos principais",
};

const LOWER_MUSCLES = new Set(["QUADRICEPS", "HAMSTRINGS", "GLUTEUS", "ADDUCTORS", "ABDUCTORS", "CALVES"]);
const TRUNK_MUSCLES = new Set(["ABS", "OBLIQUES"]);
const CORE_PATTERNS = new Set(["ANTI_EXTENSION", "ANTI_ROTATION", "ANTI_LATERAL_FLEXION", "TRUNK_FLEXION", "ROTATION"]);
const PUSH_PATTERNS = new Set(["HORIZONTAL_PUSH", "VERTICAL_PUSH"]);
const PULL_PATTERNS = new Set(["HORIZONTAL_PULL", "VERTICAL_PULL"]);

/**
 * Classe do exercício para a política de dose. `unknown` diz qual metadado faltou quando a classe ficou em OTHER por falta de
 * informação (nunca por palpite): hoje só `compound`.
 */
export function classOf(e: Pick<CatalogExercise, "modality" | "compound" | "patterns" | "primaryMuscles">): { cls: ExerciseClass; unknown: ProfileField | null } {
  const modality = e.modality ?? "";
  if (modality === "CARDIO") return { cls: "CONDITIONING", unknown: null };
  if (modality === "MOBILITY" || modality === "BALANCE") return { cls: "MOBILITY", unknown: null };
  if (modality === "SKILL") return { cls: "OTHER", unknown: null };
  const primary = e.primaryMuscles;
  if (e.patterns.some((p) => CORE_PATTERNS.has(p)) || (primary.length > 0 && primary.every((m) => TRUNK_MUSCLES.has(m)))) return { cls: "CORE", unknown: null };
  if (e.compound === null) return { cls: "OTHER", unknown: "compound" };
  const lower = primary.some((m) => LOWER_MUSCLES.has(m));
  if (e.compound === false) return { cls: lower ? "ISOLATION_LOWER" : "ISOLATION_UPPER", unknown: null };
  if (lower) return { cls: "COMPOUND_LOWER", unknown: null };
  if (e.patterns.some((p) => PULL_PATTERNS.has(p)) && !e.patterns.some((p) => PUSH_PATTERNS.has(p))) return { cls: "COMPOUND_UPPER_PULL", unknown: null };
  if (e.patterns.some((p) => PUSH_PATTERNS.has(p)) && !e.patterns.some((p) => PULL_PATTERNS.has(p))) return { cls: "COMPOUND_UPPER_PUSH", unknown: null };
  return { cls: "OTHER", unknown: null };
}

// ---------- critérios em lógica de três valores ----------

type Tri = { v: "YES" | "NO" | "UNKNOWN"; unknown: ProfileField[] };
const YES: Tri = { v: "YES", unknown: [] };
const NO: Tri = { v: "NO", unknown: [] };
const unknownOf = (...fields: ProfileField[]): Tri => ({ v: "UNKNOWN", unknown: fields });

function and(list: Tri[]): Tri {
  if (list.some((t) => t.v === "NO")) return NO;
  const unknown = list.flatMap((t) => t.unknown);
  return unknown.length || list.some((t) => t.v === "UNKNOWN") ? { v: "UNKNOWN", unknown } : YES;
}
function or(list: Tri[]): Tri {
  if (list.some((t) => t.v === "YES")) return YES;
  const unknown = list.flatMap((t) => t.unknown);
  return list.some((t) => t.v === "UNKNOWN") ? { v: "UNKNOWN", unknown } : NO;
}

function criterion(c: DoseProfileCriteria, e: CatalogExercise): Tri {
  const out: Tri[] = [];
  if (c.exerciseIds) out.push(c.exerciseIds.includes(e.id) ? YES : NO);
  if (c.compound !== undefined) out.push(e.compound === null ? unknownOf("compound") : e.compound === c.compound ? YES : NO);
  if (c.laterality !== undefined) out.push(e.laterality === null ? unknownOf("laterality") : e.laterality === c.laterality ? YES : NO);
  if (c.classes) {
    const k = classOf(e);
    out.push(k.unknown ? unknownOf(k.unknown) : c.classes.includes(k.cls) ? YES : NO);
  }
  // Lista vazia na biblioteca = ainda sem curadoria: não dá para dizer que o exercício NÃO tem o padrão ou o músculo.
  if (c.patternsAny) out.push(e.patterns.some((p) => c.patternsAny!.includes(p)) ? YES : e.patterns.length ? NO : unknownOf("patterns"));
  if (c.primaryMusclesAny) out.push(e.primaryMuscles.some((m) => c.primaryMusclesAny!.includes(m)) ? YES : e.primaryMuscles.length ? NO : unknownOf("primaryMuscles"));
  if (c.difficultyMin !== undefined) out.push(e.difficulty === null ? unknownOf("difficulty") : e.difficulty >= c.difficultyMin ? YES : NO);
  if (c.difficultyMax !== undefined) out.push(e.difficulty === null ? unknownOf("difficulty") : e.difficulty <= c.difficultyMax ? YES : NO);
  return and(out);
}

function evaluate(p: DoseProfile, e: CatalogExercise): Tri {
  const { stimulus: _s, modality: _m, metric: _t, anyOf, ...base } = p.match;
  void _s; void _m; void _t;
  const parts = [criterion(base, e)];
  if (anyOf?.length) parts.push(or(anyOf.map((g) => criterion(g, e))));
  return and(parts);
}

const TIER: Record<string, number> = { exerciseIds: 3, classes: 2, patternsAny: 2, primaryMusclesAny: 2, compound: 1, laterality: 1, difficultyMin: 1, difficultyMax: 1 };
function specificityOf(p: DoseProfile): { tier: number; count: number } {
  const { stimulus: _s, modality: _m, metric: _t, anyOf, ...base } = p.match;
  void _s; void _m; void _t;
  const keys = [...Object.keys(base), ...(anyOf ?? []).flatMap((g) => Object.keys(g))];
  return { tier: Math.max(0, ...keys.map((k) => TIER[k] ?? 0)), count: Object.keys(base).length + (anyOf?.length ? 1 : 0) };
}

/** Motivo de cada critério de um ramo `anyOf`. Os códigos aqui são os mesmos que o arquivo de regras usa nos `reasons`. */
const BRANCH_REASONS: Partial<Record<keyof DoseProfileCriteria, string>> = { patternsAny: "HEAVY_PATTERN", difficultyMin: "HIGH_DIFFICULTY" };

/**
 * Motivos do perfil para um exercício. Um perfil com `anyOf` casa por mais de um caminho (ex.: padrão pesado OU dificuldade alta)
 * e o arquivo de regras (imutável) lista um motivo fixo; aqui o motivo de ramo é trocado pelo(s) ramo(s) que de fato casaram,
 * para o traço nunca dizer "padrão pesado" de um supino que entrou só pela dificuldade.
 */
export function reasonsFor(p: DoseProfile, e: CatalogExercise): string[] {
  const branches = p.match.anyOf;
  if (!branches?.length) return [...p.reasons];
  const branchCodes = new Set(Object.values(BRANCH_REASONS));
  const matched = branches.flatMap((g) => (criterion(g, e).v === "YES" ? Object.keys(g).map((k) => BRANCH_REASONS[k as keyof DoseProfileCriteria]).filter((c): c is string => Boolean(c)) : []));
  const base = p.reasons.filter((r) => !branchCodes.has(r));
  return [...base, ...new Set(matched)];
}

export interface ProfileChoice {
  /** O perfil aplicado, ou null (padrão genérico). */
  profile: DoseProfile | null;
  /** Motivos do perfil aplicado para ESTE exercício (ver `reasonsFor`); vazio sem perfil. */
  reasons: string[];
  /** Existia ao menos um perfil para este estímulo, modalidade e métrica (senão nada era esperado). */
  expected: boolean;
  /** Metadados que faltaram e poderiam mudar a escolha, em ordem fixa. */
  uncertain: ProfileField[];
}

/**
 * Escolha do perfil: dos perfis do estímulo, modalidade e métrica, valem os que o exercício confirma (todos os critérios YES).
 * Vence o mais específico (exercício > classe/padrão/músculo > composto/lateralidade/dificuldade), depois o de mais critérios,
 * depois a ordem da tabela. Um perfil mais específico que não pôde ser avaliado (metadado nulo) NÃO é aplicado; o metadado vira
 * incerteza.
 */
export function profileFor(profiles: readonly DoseProfile[], exercise: CatalogExercise, stimulus: string, modality: string, metric: Metric): ProfileChoice {
  const pool = profiles
    .map((p, index) => ({ p, index, spec: specificityOf(p) }))
    .filter(({ p }) => p.match.stimulus.includes(stimulus) && p.match.modality === modality && p.match.metric === metric);
  if (!pool.length) return { profile: null, reasons: [], expected: false, uncertain: [] };
  const better = (a: (typeof pool)[number], b: (typeof pool)[number]) => b.spec.tier - a.spec.tier || b.spec.count - a.spec.count || a.index - b.index;
  const evaluated = pool.map((x) => ({ ...x, t: evaluate(x.p, exercise) })).sort(better);
  const chosen = evaluated.find((x) => x.t.v === "YES") ?? null;
  const outranking = evaluated.filter((x) => x.t.v === "UNKNOWN" && (!chosen || better(x, chosen) < 0));
  const fields = new Set(outranking.flatMap((x) => x.t.unknown));
  return { profile: chosen ? chosen.p : null, reasons: chosen ? reasonsFor(chosen.p, exercise) : [], expected: true, uncertain: FIELD_ORDER.filter((f) => fields.has(f)) };
}

// ---------- aplicação no rascunho da dose ----------

const round5 = (n: number) => Math.round(n / 5) * 5;

export interface ProfileContext {
  experience: Experience | null;
  /** Minutos disponíveis do treino (`budgetFor`), ou null quando não há. */
  budgetMinutes: number | null;
}

/** Valores finais do perfil depois dos ajustes por experiência e por sessão curta, com os motivos de cada parâmetro. */
export function profileValues(log: RuleLog, profile: DoseProfile, ctx: ProfileContext): { values: Partial<Record<DoseParam, number>>; reasons: Partial<Record<DoseParam, string[]>> } {
  const values: Partial<Record<DoseParam, number>> = { ...profile.values };
  const reasons: Partial<Record<DoseParam, string[]>> = {};
  const add = (param: DoseParam, code: string) => (reasons[param] = [...(reasons[param] ?? []), code]);
  const mods = log.optional("DOSE_MODIFIERS");
  const exp = ctx.experience ? mods?.experience[ctx.experience] : undefined;
  if (exp && exp.rirShift !== 0) {
    for (const k of ["rirMin", "rirMax"] as const) {
      const old = values[k];
      if (old === undefined) continue;
      // O ajuste nunca leva abaixo do valor do perfil quando o teto é menor que ele, nem abaixo de zero.
      const next = Math.max(0, exp.rirShift > 0 ? Math.min(old + exp.rirShift, Math.max(exp.capRir, old)) : old + exp.rirShift);
      if (next !== old) {
        values[k] = next;
        add(k, `EXPERIENCE_${ctx.experience}`);
      }
    }
    if (values.rirMin !== undefined && values.rirMax !== undefined && values.rirMin > values.rirMax) values.rirMax = values.rirMin;
  }
  const short = mods?.shortSession;
  if (short && ctx.budgetMinutes !== null && ctx.budgetMinutes <= short.sessionMinutesMax && values.restSeconds !== undefined) {
    const next = round5(values.restSeconds * short.restScale);
    if (next !== values.restSeconds) {
      values.restSeconds = next;
      add("restSeconds", "TIME_BUDGET_SHORT");
    }
  }
  return { values, reasons };
}

/** Escreve o perfil no rascunho (depois do padrão genérico e antes dos ajustes do profissional). */
export function applyProfile(log: RuleLog, draft: DoseDraft, profile: DoseProfile, ctx: ProfileContext, profileReasons: readonly string[] = profile.reasons): void {
  const { values, reasons } = profileValues(log, profile, ctx);
  const basis = log.basis("DOSE_PROFILES");
  const trace = (param: DoseParam | null) => ({
    basis, ruleId: "DOSE_PROFILES", profileId: profile.id, reasons: [...profileReasons, ...(param ? reasons[param] ?? [] : [])], changeIf: profile.changeIf, origin: "RULES_HEURISTIC" as const,
  });
  for (const [k, v] of Object.entries(values) as Array<[DoseParam, number]>) draft.set(k, v, trace(k));
  if (profile.loadInstruction !== undefined) draft.setExtra("loadInstruction", profile.loadInstruction, trace(null));
}

export const SETS_CHANGE_IF = "Muda com a progressão da fase ou se o profissional editar.";
const UNCERTAIN_CHANGE_IF = "Completar o metadado do exercício na biblioteca (composto, lateralidade, dificuldade, padrões) ou definir a dose à mão.";

/** Traço do perfil escolhido e da incerteza, para o item. */
export function profileTrace(log: RuleLog, choice: ProfileChoice): ParamTrace[] {
  const basis = log.basis("DOSE_PROFILES");
  const out: ParamTrace[] = [];
  if (choice.profile)
    out.push({ param: "profile", value: choice.profile.id, basis, ruleId: "DOSE_PROFILES", profileId: choice.profile.id, reasons: choice.reasons, changeIf: choice.profile.changeIf, origin: "RULES_HEURISTIC" });
  if (choice.uncertain.length)
    out.push({ param: "profile", value: choice.profile ? choice.profile.id : null, basis, ruleId: "DOSE_PROFILES", reasons: choice.uncertain.map((f) => `METADATA_MISSING:${f}`), changeIf: UNCERTAIN_CHANGE_IF, origin: "RULES_HEURISTIC" });
  return out;
}

/** Texto do aviso por exercício (juntado por treino em `uniqueIssues`). */
export const uncertaintyMessage = (name: string, fields: readonly ProfileField[]): string =>
  `${name}: falta ${fields.map((f) => PROFILE_FIELD_LABELS[f]).join(", ")} na biblioteca para escolher o perfil de dose.`;

/**
 * Avisos de metadado ausente refeitos a partir dos itens FINAIS (o traço de cada item guarda o que faltou). Depois de trocar ou
 * regenerar parte da proposta, os avisos gravados descrevem itens que já não existem; quem tem os itens finais refaz o conjunto
 * (um por exercício e treino, juntado depois em `uniqueIssues`), em vez de somar ao que estava gravado.
 */
export function doseUncertaintyIssues(occurrences: readonly OccurrenceOut[]): Issue[] {
  const out: Issue[] = [];
  const seen = new Set<string>();
  for (const o of occurrences)
    for (const i of o.items) {
      if (!i.exerciseId) continue;
      const missing = i.trace.params.filter((x) => x.param === "profile" && x.ruleId === "DOSE_PROFILES").flatMap((x) => x.reasons ?? [])
        .filter((r) => r.startsWith("METADATA_MISSING:")).map((r) => r.slice("METADATA_MISSING:".length) as ProfileField);
      if (!missing.length) continue;
      const path = `phases.${o.phaseIndex}.workouts.${o.label}${DOSE_UNCERTAIN_SEGMENT}${i.exerciseId}`;
      if (seen.has(path)) continue;
      seen.add(path);
      out.push({ severity: "INFO", code: DOSE_UNCERTAIN_CODE, path, phaseIndex: o.phaseIndex, label: o.label, stage: "SELECTION", message: uncertaintyMessage(i.exerciseName, FIELD_ORDER.filter((f) => missing.includes(f))) });
    }
  return out;
}
