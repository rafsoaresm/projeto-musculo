/**
 * Registro das regras do motor. Cada conjunto é congelado por `id@version`: mudar um número é
 * publicar uma versão nova, para que toda geração gravada continue reproduzível.
 * Os valores ficam em JSON para serem lidos por TypeScript e por scripts `.mjs` sem carregador TS.
 */
import base from "./gymgital-base.json";
import base2 from "./gymgital-base-2026.11.2.json";
import base3 from "./gymgital-base-2026.11.3.json";
import base4 from "./gymgital-base-2026.11.4.json";
import base5 from "./gymgital-base-2026.11.5.json";
import base6 from "./gymgital-base-2026.11.6.json";
import referencesFile from "./references.json";
import { DOSE_PROFILE_CODES, EXERCISE_CLASSES } from "../types";
import type { Basis, BlueprintRole, DoseParam, DoseProfileCode, Experience, ExerciseClass, LoadBasis, Metric, RuleSetRef, WeeklyProgression } from "../types";
import { MUSCLE_LABELS, PATTERN_LABELS } from "../vocabulary";

export interface DoseDefault {
  /** Código do estímulo, ou "*" para qualquer estímulo da modalidade. */
  stimulus: string;
  modality: string;
  metric: Metric;
  values: Partial<Record<DoseParam, number>>;
  loadInstruction?: string;
  loadBasis?: LoadBasis;
  recoveryMode?: "PASSIVE" | "ACTIVE";
}

export type SelectionWeight =
  | "primaryTarget"
  | "primaryRepeatDivisor"
  | "secondaryTarget"
  | "patternNew"
  | "patternRepeat"
  | "noTargets"
  | "compound"
  | "preferred"
  | "historyContinuity"
  | "historyPain"
  | "usedInOtherWorkoutOfPhase"
  | "usedInPreviousPhase"
  | "beginnerDifficulty"
  | "otherDifficulty"
  | "inferredMetadata"
  | "avoidCurrent";

export interface RuleValues {
  DOSE_DEFAULTS: DoseDefault[];
  LOAD_INSTRUCTION_DEFAULT: string;
  LOAD_BASIS_DEFAULT: LoadBasis;
  MODALITY_FOR_STIMULUS: Record<string, string[]>;
  GOAL_STIMULUS_HINTS: Array<{ keywords: string[]; stimulus: string }>;
  DEFAULT_COVERAGE: Record<string, string[]>;
  EXPERIENCE_MAP: Record<string, Experience>;
  /** Pesos novos de uma versão ficam opcionais: versões anteriores não os têm e valem como peso 0. */
  SELECTION_WEIGHTS: Record<SelectionWeight, number> & Partial<Record<"noTargetsPatternRepeat" | "noExternalLoad", number>>;
  COMPOUND_PRIORITY_STIMULI: string[];
  ALTERNATIVES_LIMIT: number;
  ALTERNATIVE_WEIGHTS: { curated: number; sharedPrimary: number; sharedPattern: number; sameMetric: number };
  DURATION: {
    warmupSeconds: number;
    transitionSecondsPerExercise: number;
    defaultSecondsPerRep: number;
    unilateralFactor: number;
  };
  COUNT_FROM_TIME: { minimum: number };
  LINEAR_ROUNDING: { decimals: number };
  DELOAD_ROUNDING: { floor: number };
  INDIRECT_VOLUME_FACTOR: number;
  VOLUME_MODALITIES: string[];
  EXPOSURE_WINDOW_DAYS: number;
  PROGRESSION_HISTORY: { consecutiveSuccesses: number; maximumIncrementFraction: number };
  MOVEMENT_FINDING_PATTERN_MAP: Record<string, string[]>;
  MOVEMENT_FINDING_GRADES: string[];
}

/** Limiares da auditoria técnica do plano (2026.11.3). Frações em [0, 1]; nenhum bloqueia. */
export interface AuditThresholds {
  weekJumpFraction: number;
  phaseJumpFraction: number;
  uniformShare: number;
  uniformMinItems: number;
  balanceRatioMax: number;
  regionShareMax: number;
  workoutShareMax: number;
  durationUnderuseFraction: number;
  patternRepeatInSession: number;
  doseRestFactorMax: number;
  maxFindings: number;
}

/** Pesos da seleção por microciclo (2026.11.4). Pesos podem ser negativos; maxSteps é um limite técnico (inteiro ≥ 1). */
export interface MicrocycleSelection {
  weeklyDeficit: number;
  frequencyGap: number;
  targetAffinity: number;
  overTarget: number;
  weeklyPatternNew: number;
  weeklyPatternRepeat: number;
  weeklyPatternRedundancy: number;
  sameExerciseWeekly: number;
  maxSteps: number;
}

/** Alvos sugeridos de um estímulo (2026.11.4): só valem depois do aceite do profissional. */
export interface StimulusTargetSuggestion {
  muscles?: string[];
  patterns?: string[];
  minDirectSessions?: number;
  weeklyWeightedSets?: { min: number; max: number };
}

/** Leitura da avaliação (`FLEXITEST:<código>`) que vira observação nos exercícios destes padrões. */
export interface FindingObservation {
  patterns: string[];
  text: string;
}

export interface AuditBalancePair {
  code: string;
  a: string[];
  b: string[];
}

/** Seleção guiada pela estratégia aceita (2026.11.5): descontos e bônus de pontuação, nunca proibições. */
export interface MicrocycleBlueprint {
  /** Desconto (≤ 0) de um exercício fora do foco do treino (nem músculo dominante/apoio nem padrão-alvo/transbordo). */
  offFocus: number;
  /** Bônus (≥ 0) de um exercício cujo músculo principal é de apoio do treino. */
  supportingBonus: number;
  /** Bônus (≥ 0) de um exercício nomeado pela estratégia. */
  candidateBonus: number;
  /** Desconto (≤ 0) de repetir, no mesmo treino de corpo inteiro, um padrão-alvo que o treino já tem. */
  fullBodyPatternRepeat: number;
  /** Limite técnico de candidatos por treino (1 a 6). */
  maxCandidatesPerWorkout: number;
}

/** O que um papel de treino significa (2026.11.5). */
export interface BlueprintRoleFocus {
  dominantMuscles: string[];
  supportingMuscles: string[];
  targetPatterns: string[];
  spilloverPatterns: string[];
}

export interface BlueprintFamilyTemplate {
  family: string;
  /** Números de treinos distintos (de volume) que a divisão aceita sem mudar a periodização, ou qualquer número. */
  labelCounts: number[] | "ANY";
  roleCycle: BlueprintRole[];
  minLabels?: number;
  minSessionsPerWeek?: number;
}
export interface BlueprintRecommendation {
  when: { sessionsPerWeekMin?: number; sessionsPerWeekMax?: number; experience?: Array<Experience | null> };
  family: string;
  ifSupported?: boolean;
}
export interface BlueprintStrategyTemplates {
  families: BlueprintFamilyTemplate[];
  recommend: BlueprintRecommendation[];
  maxStrategies: number;
  volumeModalities: string[];
}

/** Limiares da aderência à estratégia na auditoria (2026.11.5). */
export interface AuditStrategy {
  adherenceMin: number;
  overlapNote: number;
  exposureMinPerWeek: number;
}

/** Critérios de um perfil de dose; todos os informados precisam valer. Metadado nulo na biblioteca = critério desconhecido (nunca palpite). */
export interface DoseProfileCriteria {
  compound?: boolean;
  laterality?: "UNILATERAL" | "BILATERAL";
  classes?: ExerciseClass[];
  patternsAny?: string[];
  primaryMusclesAny?: string[];
  difficultyMin?: number;
  difficultyMax?: number;
  exerciseIds?: string[];
}
export interface DoseProfileMatch extends DoseProfileCriteria {
  stimulus: string[];
  modality: string;
  metric: Metric;
  /** Pelo menos um destes grupos de critérios precisa valer (além dos critérios acima). */
  anyOf?: DoseProfileCriteria[];
}
/** Perfil de dose (2026.11.6). `values` nunca traz séries; a carga nunca é proposta. */
export interface DoseProfile {
  id: string;
  code: DoseProfileCode | null;
  match: DoseProfileMatch;
  values: Partial<Record<DoseParam, number>>;
  loadInstruction?: string;
  reasons: string[];
  changeIf: string;
}
export interface DoseModifiers {
  experience: Partial<Record<Experience, { rirShift: number; capRir: number }>>;
  shortSession: { sessionMinutesMax: number; restScale: number };
}
export interface ProgressionTemplate {
  applied: boolean;
  progression?: WeeklyProgression;
  loadInstruction?: string;
}
export interface AuditDose {
  exerciseJumpSets: number;
  restJumpFraction: number;
}

/**
 * Regras que só existem a partir de uma versão: uma versão anterior não as tem e o motor segue sem elas.
 * 2026.11.2: EXTERNAL_LOAD_STIMULI. 2026.11.3: AUDIT_* (auditoria técnica do plano). 2026.11.4: MICROCYCLE_SELECTION,
 * MICROCYCLE_TARGET_SUGGESTIONS e FINDING_OBSERVATION_MAP (seleção por microciclo, alvos sugeridos, observações da avaliação).
 * 2026.11.5: MICROCYCLE_BLUEPRINT, BLUEPRINT_ROLE_FOCUS, BLUEPRINT_STRATEGY_TEMPLATES e AUDIT_STRATEGY (estratégia aceita guia a seleção).
 * 2026.11.6: DOSE_PROFILES, DOSE_MODIFIERS e DOSE_CLASS_MAP (política de dose por perfil, lida pelo motor desde a 3.1);
 * PROGRESSION_TEMPLATES e AUDIT_DOSE (dados lidos a partir da 3.2).
 */
export interface OptionalRuleValues {
  EXTERNAL_LOAD_STIMULI: string[];
  AUDIT_THRESHOLDS: AuditThresholds;
  AUDIT_COMPREHENSIVE_STIMULI: string[];
  AUDIT_BALANCE_PAIRS: AuditBalancePair[];
  AUDIT_REGIONS: Record<string, string[]>;
  MICROCYCLE_SELECTION: MicrocycleSelection;
  MICROCYCLE_TARGET_SUGGESTIONS: Record<string, StimulusTargetSuggestion>;
  FINDING_OBSERVATION_MAP: Record<string, FindingObservation>;
  MICROCYCLE_BLUEPRINT: MicrocycleBlueprint;
  BLUEPRINT_ROLE_FOCUS: Record<BlueprintRole, BlueprintRoleFocus>;
  BLUEPRINT_STRATEGY_TEMPLATES: BlueprintStrategyTemplates;
  AUDIT_STRATEGY: AuditStrategy;
  DOSE_PROFILES: DoseProfile[];
  DOSE_MODIFIERS: DoseModifiers;
  DOSE_CLASS_MAP: Record<ExerciseClass, DoseProfileCode[]>;
  PROGRESSION_TEMPLATES: Record<string, ProgressionTemplate>;
  AUDIT_DOSE: AuditDose;
}

export type RequiredRuleId = keyof RuleValues;
export type OptionalRuleId = keyof OptionalRuleValues;
export type RuleId = RequiredRuleId | OptionalRuleId;

export interface RuleEntry<T> {
  basis: Basis;
  description: string;
  value: T;
  /** Ids de references.json. Só referências VERIFIED chegam ao traço e à interface. */
  refs?: string[];
}

export interface RuleSet {
  id: string;
  version: string;
  comment?: string;
  rules: { [K in RequiredRuleId]: RuleEntry<RuleValues[K]> } & { [K in OptionalRuleId]?: RuleEntry<OptionalRuleValues[K]> };
}

export interface Reference {
  id: string;
  citation: string;
  pmid?: string;
  status: "VERIFIED" | "UNVERIFIED";
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export const REFERENCES: readonly Reference[] = deepFreeze(
  (referencesFile as unknown as { references: Reference[] }).references.map((r) => ({ ...r })),
);

const GYMGITAL_BASE_2026_11_1 = deepFreeze(JSON.parse(JSON.stringify(base)) as RuleSet);
/**
 * 2026.11.2: treino sem alvos espalha os padrões (noTargetsPatternRepeat) e, nos estímulos de carga, um exercício resistido sem
 * nenhum equipamento perde pontos (EXTERNAL_LOAD_STIMULI, noExternalLoad). O resto é igual à 2026.11.1.
 */
const GYMGITAL_BASE_2026_11_2 = deepFreeze(JSON.parse(JSON.stringify(base2)) as RuleSet);
/**
 * 2026.11.3: 2026.11.2 + regras da auditoria técnica do plano (AUDIT_THRESHOLDS, AUDIT_COMPREHENSIVE_STIMULI, AUDIT_BALANCE_PAIRS,
 * AUDIT_REGIONS). Seleção e doses iguais às da 2026.11.2.
 */
const GYMGITAL_BASE_2026_11_3 = deepFreeze(JSON.parse(JSON.stringify(base3)) as RuleSet);
/**
 * 2026.11.4: 2026.11.3 + seleção da fase inteira por microciclo (MICROCYCLE_SELECTION), alvos sugeridos para aceite
 * (MICROCYCLE_TARGET_SUGGESTIONS) e leituras da avaliação que viram observação (FINDING_OBSERVATION_MAP). Doses iguais.
 */
const GYMGITAL_BASE_2026_11_4 = deepFreeze(JSON.parse(JSON.stringify(base4)) as RuleSet);
/**
 * 2026.11.5: 2026.11.4 + seleção por estratégia (MICROCYCLE_BLUEPRINT), papéis dos treinos (BLUEPRINT_ROLE_FOCUS), modelos da
 * estratégia por regras (BLUEPRINT_STRATEGY_TEMPLATES) e limiares da aderência à estratégia (AUDIT_STRATEGY). Todas as regras da
 * 2026.11.4 estão iguais; sem uma estratégia aceita na entrada o resultado é o da 2026.11.4.
 */
const GYMGITAL_BASE_2026_11_5 = deepFreeze(JSON.parse(JSON.stringify(base5)) as RuleSet);
/**
 * 2026.11.6: 2026.11.5 + política de dose por perfil (DOSE_PROFILES, DOSE_MODIFIERS, DOSE_CLASS_MAP) e os dados da progressão e da
 * auditoria de doses (PROGRESSION_TEMPLATES, AUDIT_DOSE; consumidos na 3.2). NÃO é o padrão: só entra por escolha explícita do
 * profissional (`OPT_IN_RULESETS`), até o Técnico validar a tabela. Sem DOSE_PROFILES a dose é a da 2026.11.5, byte a byte.
 */
const GYMGITAL_BASE_2026_11_6 = deepFreeze(JSON.parse(JSON.stringify(base6)) as RuleSet);

/** Conjuntos publicados. Uma versão publicada nunca muda: novos números entram como nova versão. */
export const RULESETS: Readonly<Record<string, RuleSet>> = deepFreeze({
  [`${GYMGITAL_BASE_2026_11_1.id}@${GYMGITAL_BASE_2026_11_1.version}`]: GYMGITAL_BASE_2026_11_1,
  [`${GYMGITAL_BASE_2026_11_2.id}@${GYMGITAL_BASE_2026_11_2.version}`]: GYMGITAL_BASE_2026_11_2,
  [`${GYMGITAL_BASE_2026_11_3.id}@${GYMGITAL_BASE_2026_11_3.version}`]: GYMGITAL_BASE_2026_11_3,
  [`${GYMGITAL_BASE_2026_11_4.id}@${GYMGITAL_BASE_2026_11_4.version}`]: GYMGITAL_BASE_2026_11_4,
  [`${GYMGITAL_BASE_2026_11_5.id}@${GYMGITAL_BASE_2026_11_5.version}`]: GYMGITAL_BASE_2026_11_5,
  [`${GYMGITAL_BASE_2026_11_6.id}@${GYMGITAL_BASE_2026_11_6.version}`]: GYMGITAL_BASE_2026_11_6,
});

/** A versão usada nas gerações novas (a mais recente); propostas gravadas seguem com a versão delas. */
export const DEFAULT_RULESET: RuleSetRef = { id: GYMGITAL_BASE_2026_11_5.id, version: GYMGITAL_BASE_2026_11_5.version };

/**
 * Versões publicadas que uma geração nova só usa por escolha explícita do profissional (nunca por padrão). A 2026.11.6 traz doses
 * por perfil que o Técnico ainda não validou (docs/PENDENCIAS.md): trocar o padrão é decisão separada.
 */
export const OPT_IN_RULESETS: readonly RuleSetRef[] = Object.freeze([{ id: GYMGITAL_BASE_2026_11_6.id, version: GYMGITAL_BASE_2026_11_6.version }]);

/** A versão de uma geração nova: o padrão, ou a versão de adesão escolhida (qualquer outra é recusada com null). */
export function rulesetForNewGeneration(rulesVersion?: string | null): RuleSetRef | null {
  if (rulesVersion === undefined || rulesVersion === null || rulesVersion === DEFAULT_RULESET.version) return DEFAULT_RULESET;
  return OPT_IN_RULESETS.find((r) => r.version === rulesVersion) ?? null;
}

export function getRuleSet(ref: RuleSetRef): RuleSet | null {
  return RULESETS[`${ref.id}@${ref.version}`] ?? null;
}

/** Referências de uma regra que podem aparecer: apenas as VERIFIED. */
export function verifiedRefs(rules: RuleSet, ruleId: RuleId): string[] {
  const refs = rules.rules[ruleId]?.refs ?? [];
  return refs.filter((id) => REFERENCES.some((r) => r.id === id && r.status === "VERIFIED"));
}

const BASES: Basis[] = ["EVIDENCE", "HEURISTIC", "HEURISTIC_ACCEPTED", "PROFESSIONAL", "STUDENT_DATA"];
const DOSE_RANGES: Array<[DoseParam, DoseParam]> = [
  ["repsMin", "repsMax"],
  ["durationMin", "durationMax"],
  ["distanceMin", "distanceMax"],
  ["rirMin", "rirMax"],
  ["rpeMin", "rpeMax"],
  ["workDurationMin", "workDurationMax"],
  ["workDistanceMin", "workDistanceMax"],
  ["recoveryMin", "recoveryMax"],
];

function numbersIn(value: unknown, path: string, out: Array<[string, number]>): void {
  if (typeof value === "number") out.push([path, value]);
  else if (Array.isArray(value)) value.forEach((v, i) => numbersIn(v, `${path}[${i}]`, out));
  else if (value && typeof value === "object")
    for (const [k, v] of Object.entries(value)) numbersIn(v, `${path}.${k}`, out);
}

/** Problemas de um conjunto de regras; vazio = válido. Coberto por teste para cada versão publicada. */
export function validateRuleSet(rules: RuleSet): string[] {
  const problems: string[] = [];
  for (const [id, entry] of Object.entries(rules.rules) as Array<[RuleId, RuleEntry<unknown>]>) {
    if (!BASES.includes(entry.basis)) problems.push(`${id}: base desconhecida ${String(entry.basis)}`);
    if (entry.basis === "HEURISTIC_ACCEPTED" || entry.basis === "PROFESSIONAL" || entry.basis === "STUDENT_DATA")
      problems.push(`${id}: uma regra padrão só pode ser HEURISTIC ou EVIDENCE`);
    if (!entry.description?.trim()) problems.push(`${id}: sem descrição`);
    for (const ref of entry.refs ?? []) {
      const known = REFERENCES.find((r) => r.id === ref);
      if (!known) problems.push(`${id}: referência inexistente ${ref}`);
      else if (entry.basis === "EVIDENCE" && known.status !== "VERIFIED")
        problems.push(`${id}: base EVIDENCE com referência não verificada ${ref}`);
    }
    if (entry.basis === "EVIDENCE" && !(entry.refs ?? []).length) problems.push(`${id}: EVIDENCE sem referência`);
    const nums: Array<[string, number]> = [];
    numbersIn(entry.value, id, nums);
    for (const [path, n] of nums) if (!Number.isFinite(n)) problems.push(`${path}: número inválido`);
  }
  for (const [i, d] of rules.rules.DOSE_DEFAULTS.value.entries()) {
    for (const [k, v] of Object.entries(d.values))
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0) problems.push(`DOSE_DEFAULTS[${i}].${k}: negativo ou inválido`);
    for (const [min, max] of DOSE_RANGES) {
      const a = d.values[min];
      const b = d.values[max];
      if (a !== undefined && b !== undefined && a > b) problems.push(`DOSE_DEFAULTS[${i}]: ${min} > ${max}`);
    }
  }
  const keys = rules.rules.DOSE_DEFAULTS.value.map((d) => `${d.stimulus}|${d.modality}|${d.metric}`);
  if (new Set(keys).size !== keys.length) problems.push("DOSE_DEFAULTS: entradas repetidas para o mesmo estímulo, modalidade e métrica");
  problems.push(...auditRuleProblems(rules));
  problems.push(...microcycleRuleProblems(rules));
  problems.push(...blueprintRuleProblems(rules));
  problems.push(...doseRuleProblems(rules));
  return problems;
}

const MICRO_POSITIVE = ["weeklyDeficit", "frequencyGap", "targetAffinity", "weeklyPatternNew", "weeklyPatternRepeat"] as const;
const MICRO_NEGATIVE = ["overTarget", "weeklyPatternRedundancy", "sameExerciseWeekly"] as const;

/** Regras da seleção por microciclo (opcionais): sinais dos pesos, limite de passos, códigos e números das sugestões. */
function microcycleRuleProblems(rules: RuleSet): string[] {
  const problems: string[] = [];
  const m = rules.rules.MICROCYCLE_SELECTION?.value;
  if (m) {
    for (const k of MICRO_POSITIVE) if (!(typeof m[k] === "number" && m[k] >= 0)) problems.push(`MICROCYCLE_SELECTION.${k}: deve ser ≥ 0`);
    for (const k of MICRO_NEGATIVE) if (!(typeof m[k] === "number" && m[k] <= 0)) problems.push(`MICROCYCLE_SELECTION.${k}: peso contra, deve ser ≤ 0`);
    if (!(Number.isInteger(m.maxSteps) && m.maxSteps >= 1)) problems.push("MICROCYCLE_SELECTION.maxSteps: inteiro ≥ 1");
  }
  for (const [stimulus, s] of Object.entries(rules.rules.MICROCYCLE_TARGET_SUGGESTIONS?.value ?? {})) {
    for (const x of s.muscles ?? []) if (!MUSCLE_LABELS[x]) problems.push(`MICROCYCLE_TARGET_SUGGESTIONS.${stimulus}: músculo desconhecido ${x}`);
    for (const x of s.patterns ?? []) if (!PATTERN_LABELS[x]) problems.push(`MICROCYCLE_TARGET_SUGGESTIONS.${stimulus}: padrão desconhecido ${x}`);
    if (!(s.muscles?.length || s.patterns?.length)) problems.push(`MICROCYCLE_TARGET_SUGGESTIONS.${stimulus}: sem músculos nem padrões`);
    if (s.minDirectSessions !== undefined && !(Number.isInteger(s.minDirectSessions) && s.minDirectSessions >= 1 && s.minDirectSessions <= 14))
      problems.push(`MICROCYCLE_TARGET_SUGGESTIONS.${stimulus}.minDirectSessions: inteiro de 1 a 14`);
    const w = s.weeklyWeightedSets;
    if (w && !(w.min >= 0 && w.max >= w.min && w.max <= 60)) problems.push(`MICROCYCLE_TARGET_SUGGESTIONS.${stimulus}.weeklyWeightedSets: 0 ≤ min ≤ max ≤ 60`);
    if ((s.minDirectSessions !== undefined || w) && !s.muscles?.length) problems.push(`MICROCYCLE_TARGET_SUGGESTIONS.${stimulus}: alvos semanais sem músculos`);
  }
  for (const [key, o] of Object.entries(rules.rules.FINDING_OBSERVATION_MAP?.value ?? {})) {
    if (!/^FLEXITEST:[a-z_]+$/.test(key)) problems.push(`FINDING_OBSERVATION_MAP.${key}: chave fora do formato FLEXITEST:<código>`);
    if (!o.patterns.length) problems.push(`FINDING_OBSERVATION_MAP.${key}: sem padrões`);
    for (const p of o.patterns) if (!PATTERN_LABELS[p]) problems.push(`FINDING_OBSERVATION_MAP.${key}: padrão desconhecido ${p}`);
    if (!o.text?.trim()) problems.push(`FINDING_OBSERVATION_MAP.${key}: sem texto`);
  }
  return problems;
}

export const BLUEPRINT_ROLES: readonly BlueprintRole[] = [
  "FULL_BODY", "UPPER", "LOWER", "PUSH", "PULL", "LEGS", "CHEST_TRICEPS", "BACK_BICEPS", "SHOULDERS_ARMS", "CORE", "CUSTOM", "CARDIO", "MOBILITY", "BALANCE", "SKILL",
];
const VOLUME_ROLES: readonly BlueprintRole[] = ["FULL_BODY", "UPPER", "LOWER", "PUSH", "PULL", "LEGS", "CHEST_TRICEPS", "BACK_BICEPS", "SHOULDERS_ARMS", "CORE"];

/** Regras da seleção por estratégia (opcionais, 2026.11.5+): sinais, papéis e códigos existentes, modelos que só citam papéis definidos. */
function blueprintRuleProblems(rules: RuleSet): string[] {
  const problems: string[] = [];
  const b = rules.rules.MICROCYCLE_BLUEPRINT?.value;
  if (b) {
    if (!rules.rules.MICROCYCLE_SELECTION) problems.push("MICROCYCLE_BLUEPRINT: exige MICROCYCLE_SELECTION no mesmo conjunto");
    if (!rules.rules.AUDIT_THRESHOLDS) problems.push("MICROCYCLE_BLUEPRINT: exige AUDIT_THRESHOLDS no mesmo conjunto");
    if (!(typeof b.offFocus === "number" && b.offFocus <= 0)) problems.push("MICROCYCLE_BLUEPRINT.offFocus: desconto, deve ser ≤ 0");
    if (!(typeof b.supportingBonus === "number" && b.supportingBonus >= 0)) problems.push("MICROCYCLE_BLUEPRINT.supportingBonus: deve ser ≥ 0");
    if (!(typeof b.candidateBonus === "number" && b.candidateBonus >= 0)) problems.push("MICROCYCLE_BLUEPRINT.candidateBonus: deve ser ≥ 0");
    if (!(typeof b.fullBodyPatternRepeat === "number" && b.fullBodyPatternRepeat <= 0)) problems.push("MICROCYCLE_BLUEPRINT.fullBodyPatternRepeat: desconto, deve ser ≤ 0");
    if (!(Number.isInteger(b.maxCandidatesPerWorkout) && b.maxCandidatesPerWorkout >= 1 && b.maxCandidatesPerWorkout <= 6))
      problems.push("MICROCYCLE_BLUEPRINT.maxCandidatesPerWorkout: inteiro de 1 a 6");
  }
  const roles = rules.rules.BLUEPRINT_ROLE_FOCUS?.value;
  if (roles) {
    for (const role of Object.keys(roles)) if (!BLUEPRINT_ROLES.includes(role as BlueprintRole)) problems.push(`BLUEPRINT_ROLE_FOCUS: papel desconhecido ${role}`);
    for (const role of BLUEPRINT_ROLES) {
      const f = roles[role];
      if (!f) { problems.push(`BLUEPRINT_ROLE_FOCUS.${role}: papel sem entrada`); continue; }
      for (const m of [...f.dominantMuscles, ...f.supportingMuscles]) if (!MUSCLE_LABELS[m]) problems.push(`BLUEPRINT_ROLE_FOCUS.${role}: músculo desconhecido ${m}`);
      for (const pt of [...f.targetPatterns, ...f.spilloverPatterns]) if (!PATTERN_LABELS[pt]) problems.push(`BLUEPRINT_ROLE_FOCUS.${role}: padrão desconhecido ${pt}`);
      if (f.dominantMuscles.some((m) => f.supportingMuscles.includes(m))) problems.push(`BLUEPRINT_ROLE_FOCUS.${role}: músculo dominante e de apoio ao mesmo tempo`);
      const empty = !f.dominantMuscles.length && !f.targetPatterns.length;
      if (VOLUME_ROLES.includes(role) && empty) problems.push(`BLUEPRINT_ROLE_FOCUS.${role}: papel de volume sem foco`);
      if (!VOLUME_ROLES.includes(role) && (!empty || f.supportingMuscles.length || f.spilloverPatterns.length)) problems.push(`BLUEPRINT_ROLE_FOCUS.${role}: papel sem volume deve ficar vazio`);
    }
  }
  const t = rules.rules.BLUEPRINT_STRATEGY_TEMPLATES?.value;
  if (t) {
    if (!roles) problems.push("BLUEPRINT_STRATEGY_TEMPLATES: exige BLUEPRINT_ROLE_FOCUS no mesmo conjunto");
    const families = new Set(t.families.map((f) => f.family));
    if (families.size !== t.families.length) problems.push("BLUEPRINT_STRATEGY_TEMPLATES: família repetida");
    for (const f of t.families) {
      for (const r of f.roleCycle) if (!BLUEPRINT_ROLES.includes(r) || (roles && !roles[r])) problems.push(`BLUEPRINT_STRATEGY_TEMPLATES.${f.family}: papel desconhecido ${r}`);
      if (!f.roleCycle.length) problems.push(`BLUEPRINT_STRATEGY_TEMPLATES.${f.family}: ciclo de papéis vazio`);
      if (f.labelCounts !== "ANY" && !(f.labelCounts.length && f.labelCounts.every((n) => Number.isInteger(n) && n >= 1 && n <= 8)))
        problems.push(`BLUEPRINT_STRATEGY_TEMPLATES.${f.family}.labelCounts: inteiros de 1 a 8 ou "ANY"`);
    }
    for (const r of t.recommend) if (!families.has(r.family)) problems.push(`BLUEPRINT_STRATEGY_TEMPLATES.recommend: família desconhecida ${r.family}`);
    if (!(Number.isInteger(t.maxStrategies) && t.maxStrategies >= 1 && t.maxStrategies <= 3)) problems.push("BLUEPRINT_STRATEGY_TEMPLATES.maxStrategies: inteiro de 1 a 3");
    if (!t.volumeModalities.length) problems.push("BLUEPRINT_STRATEGY_TEMPLATES.volumeModalities: vazio");
  }
  const a = rules.rules.AUDIT_STRATEGY?.value;
  if (a) {
    for (const k of ["adherenceMin", "overlapNote"] as const) if (!(typeof a[k] === "number" && a[k] >= 0 && a[k] <= 1)) problems.push(`AUDIT_STRATEGY.${k}: fora de [0, 1]`);
    if (!(typeof a.exposureMinPerWeek === "number" && a.exposureMinPerWeek >= 0)) problems.push("AUDIT_STRATEGY.exposureMinPerWeek: deve ser ≥ 0");
  }
  return problems;
}

const PROFILE_PARAMS: readonly DoseParam[] = ["repsMin", "repsMax", "durationMin", "durationMax", "distanceMin", "distanceMax", "restSeconds", "rirMin", "rirMax", "rpeMin", "rpeMax"];

function criteriaProblems(c: DoseProfileCriteria, where: string, out: string[]): void {
  for (const k of Object.keys(c))
    if (!["compound", "laterality", "classes", "patternsAny", "primaryMusclesAny", "difficultyMin", "difficultyMax", "exerciseIds"].includes(k)) out.push(`${where}: critério desconhecido ${k}`);
  if (c.compound !== undefined && typeof c.compound !== "boolean") out.push(`${where}.compound: booleano`);
  if (c.laterality !== undefined && c.laterality !== "UNILATERAL" && c.laterality !== "BILATERAL") out.push(`${where}.laterality: UNILATERAL ou BILATERAL`);
  for (const x of c.classes ?? []) if (!EXERCISE_CLASSES.includes(x)) out.push(`${where}.classes: classe desconhecida ${x}`);
  for (const x of c.patternsAny ?? []) if (!PATTERN_LABELS[x]) out.push(`${where}.patternsAny: padrão desconhecido ${x}`);
  for (const x of c.primaryMusclesAny ?? []) if (!MUSCLE_LABELS[x]) out.push(`${where}.primaryMusclesAny: músculo desconhecido ${x}`);
  for (const k of ["classes", "patternsAny", "primaryMusclesAny", "exerciseIds"] as const) if (c[k] && !c[k]!.length) out.push(`${where}.${k}: lista vazia`);
  if (c.exerciseIds && new Set(c.exerciseIds).size !== c.exerciseIds.length) out.push(`${where}.exerciseIds: ids repetidos`);
  for (const k of ["difficultyMin", "difficultyMax"] as const)
    if (c[k] !== undefined && !(Number.isInteger(c[k]) && (c[k] as number) >= 1 && (c[k] as number) <= 5)) out.push(`${where}.${k}: inteiro de 1 a 5`);
  if (c.difficultyMin !== undefined && c.difficultyMax !== undefined && c.difficultyMin > c.difficultyMax) out.push(`${where}: difficultyMin > difficultyMax`);
}

/** Política de dose (2026.11.6+): perfis válidos, sem séries, sem carga, intervalos coerentes, ids e exercícios únicos, códigos conhecidos. */
function doseRuleProblems(rules: RuleSet): string[] {
  const problems: string[] = [];
  const profiles = rules.rules.DOSE_PROFILES?.value;
  if (profiles) {
    const ids = new Set<string>();
    const exerciseIds = new Map<string, string>();
    for (const [i, p] of profiles.entries()) {
      const where = `DOSE_PROFILES[${p.id ?? i}]`;
      if (!p.id?.trim()) problems.push(`${where}: sem id`);
      if (ids.has(p.id)) problems.push(`${where}: id repetido`);
      ids.add(p.id);
      if (p.code !== null && !DOSE_PROFILE_CODES.includes(p.code)) problems.push(`${where}: código desconhecido ${String(p.code)}`);
      if (!p.match.stimulus?.length) problems.push(`${where}.match.stimulus: vazio`);
      if (!p.match.modality?.trim()) problems.push(`${where}.match.modality: vazio`);
      const { stimulus: _s, modality: _m, metric: _t, anyOf: _a, ...criteria } = p.match;
      void _s; void _m; void _t; void _a;
      criteriaProblems(criteria, `${where}.match`, problems);
      if (!["REPS", "TIME", "DISTANCE", "INTERVALS", "CONTINUOUS"].includes(p.match.metric)) problems.push(`${where}.match.metric: métrica desconhecida ${String(p.match.metric)}`);
      for (const [j, alt] of (p.match.anyOf ?? []).entries()) {
        criteriaProblems(alt, `${where}.match.anyOf[${j}]`, problems);
        if (!Object.keys(alt).length) problems.push(`${where}.match.anyOf[${j}]: grupo vazio`);
      }
      for (const id of [...(p.match.exerciseIds ?? []), ...(p.match.anyOf ?? []).flatMap((a) => a.exerciseIds ?? [])]) {
        const other = exerciseIds.get(id);
        if (other && other !== p.id) problems.push(`${where}: exercício ${id} também está no perfil ${other}`);
        exerciseIds.set(id, p.id);
      }
      if ("sets" in p.values) problems.push(`${where}.values: perfil não define séries`);
      if (!Object.keys(p.values).length && !p.loadInstruction) problems.push(`${where}.values: vazio`);
      for (const [k, v] of Object.entries(p.values)) {
        if (!PROFILE_PARAMS.includes(k as DoseParam)) problems.push(`${where}.values.${k}: parâmetro não permitido em perfil`);
        else if (typeof v !== "number" || !Number.isFinite(v) || v < 0) problems.push(`${where}.values.${k}: negativo ou inválido`);
      }
      for (const [min, max] of DOSE_RANGES) {
        const a = p.values[min];
        const b = p.values[max];
        if (a !== undefined && b !== undefined && a > b) problems.push(`${where}: ${min} > ${max}`);
        if ((a === undefined) !== (b === undefined) && min !== "rpeMin") problems.push(`${where}: ${min} e ${max} vão juntos`);
      }
      if ((p.values.rirMax ?? 0) > 10 || (p.values.rpeMax ?? 0) > 10) problems.push(`${where}: RIR/RPE acima de 10`);
      if (/\d\s*kg|\bkg\b/i.test(p.loadInstruction ?? "")) problems.push(`${where}.loadInstruction: não propõe quilos`);
      if (!p.reasons?.length) problems.push(`${where}.reasons: vazio`);
      if (!p.changeIf?.trim()) problems.push(`${where}.changeIf: vazio`);
    }
  }
  const m = rules.rules.DOSE_MODIFIERS?.value;
  if (m) {
    for (const [lvl, e] of Object.entries(m.experience)) {
      if (!["BEGINNER", "INTERMEDIATE", "ADVANCED"].includes(lvl)) problems.push(`DOSE_MODIFIERS.experience: nível desconhecido ${lvl}`);
      if (!(Number.isInteger(e.rirShift) && Math.abs(e.rirShift) <= 3)) problems.push(`DOSE_MODIFIERS.experience.${lvl}.rirShift: inteiro de -3 a 3`);
      if (!(Number.isInteger(e.capRir) && e.capRir >= 0 && e.capRir <= 10)) problems.push(`DOSE_MODIFIERS.experience.${lvl}.capRir: inteiro de 0 a 10`);
    }
    if (!(Number.isInteger(m.shortSession.sessionMinutesMax) && m.shortSession.sessionMinutesMax >= 1)) problems.push("DOSE_MODIFIERS.shortSession.sessionMinutesMax: inteiro ≥ 1");
    if (!(m.shortSession.restScale > 0 && m.shortSession.restScale <= 1)) problems.push("DOSE_MODIFIERS.shortSession.restScale: em (0, 1]");
  }
  const map = rules.rules.DOSE_CLASS_MAP?.value;
  if (map) {
    for (const cls of EXERCISE_CLASSES) if (!map[cls]) problems.push(`DOSE_CLASS_MAP.${cls}: classe sem entrada`);
    const known = new Set((profiles ?? []).map((p) => p.code).filter(Boolean));
    for (const [cls, codes] of Object.entries(map)) {
      if (!EXERCISE_CLASSES.includes(cls as ExerciseClass)) problems.push(`DOSE_CLASS_MAP: classe desconhecida ${cls}`);
      for (const c of codes) {
        if (!DOSE_PROFILE_CODES.includes(c)) problems.push(`DOSE_CLASS_MAP.${cls}: código desconhecido ${c}`);
        else if (profiles && !known.has(c)) problems.push(`DOSE_CLASS_MAP.${cls}: nenhum perfil tem o código ${c}`);
      }
    }
  }
  for (const [intent, t] of Object.entries(rules.rules.PROGRESSION_TEMPLATES?.value ?? {})) {
    if (t.applied && !t.progression) problems.push(`PROGRESSION_TEMPLATES.${intent}: aplicada sem progressão`);
    if (!t.applied && (t.progression || t.loadInstruction)) problems.push(`PROGRESSION_TEMPLATES.${intent}: não aplicada não traz progressão`);
    if (t.progression?.deload) problems.push(`PROGRESSION_TEMPLATES.${intent}: a descarga nunca é gerada`);
  }
  const a = rules.rules.AUDIT_DOSE?.value;
  if (a) {
    if (!(Number.isInteger(a.exerciseJumpSets) && a.exerciseJumpSets >= 1)) problems.push("AUDIT_DOSE.exerciseJumpSets: inteiro ≥ 1");
    if (!(typeof a.restJumpFraction === "number" && a.restJumpFraction > 0 && a.restJumpFraction <= 1)) problems.push("AUDIT_DOSE.restJumpFraction: em (0, 1]");
  }
  return problems;
}

const AUDIT_FRACTIONS = ["weekJumpFraction", "phaseJumpFraction", "uniformShare", "regionShareMax", "workoutShareMax", "durationUnderuseFraction"] as const;
const AUDIT_COUNTS = ["uniformMinItems", "patternRepeatInSession", "maxFindings"] as const;

/** Regras da auditoria (opcionais): números no domínio certo e códigos existentes no vocabulário. */
function auditRuleProblems(rules: RuleSet): string[] {
  const problems: string[] = [];
  const t = rules.rules.AUDIT_THRESHOLDS?.value;
  if (t) {
    for (const k of AUDIT_FRACTIONS) if (!(typeof t[k] === "number" && t[k] >= 0 && t[k] <= 1)) problems.push(`AUDIT_THRESHOLDS.${k}: fora de [0, 1]`);
    for (const k of AUDIT_COUNTS) if (!(Number.isInteger(t[k]) && t[k] >= 1)) problems.push(`AUDIT_THRESHOLDS.${k}: inteiro ≥ 1`);
    if (!(typeof t.balanceRatioMax === "number" && t.balanceRatioMax >= 1)) problems.push("AUDIT_THRESHOLDS.balanceRatioMax: deve ser ≥ 1");
    if (!(typeof t.doseRestFactorMax === "number" && t.doseRestFactorMax >= 1)) problems.push("AUDIT_THRESHOLDS.doseRestFactorMax: deve ser ≥ 1");
  }
  for (const p of rules.rules.AUDIT_BALANCE_PAIRS?.value ?? []) {
    if (!p.code?.trim() || !p.a.length || !p.b.length) problems.push(`AUDIT_BALANCE_PAIRS.${p.code}: par incompleto`);
    for (const code of [...p.a, ...p.b]) if (!PATTERN_LABELS[code]) problems.push(`AUDIT_BALANCE_PAIRS.${p.code}: padrão desconhecido ${code}`);
    if (p.a.some((x) => p.b.includes(x))) problems.push(`AUDIT_BALANCE_PAIRS.${p.code}: padrão nos dois lados`);
  }
  const regions = rules.rules.AUDIT_REGIONS?.value;
  if (regions) {
    const seen = new Set<string>();
    for (const [region, muscles] of Object.entries(regions))
      for (const m of muscles) {
        if (!MUSCLE_LABELS[m]) problems.push(`AUDIT_REGIONS.${region}: músculo desconhecido ${m}`);
        if (seen.has(m)) problems.push(`AUDIT_REGIONS: ${m} em mais de uma região`);
        seen.add(m);
      }
  }
  return problems;
}

const BASIS_TEXT: Record<Basis, string> = {
  EVIDENCE: "Evidência (referência verificada)",
  HEURISTIC: "Heurística operacional (editável)",
  HEURISTIC_ACCEPTED: "Heurística aceita pelo profissional",
  PROFESSIONAL: "Decisão do profissional",
  STUDENT_DATA: "Dado do aluno",
};

function cell(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/**
 * Tabela Markdown das regras, gravada em docs/MOTOR-PRESCRICAO.md entre os marcadores
 * `<!-- regras:inicio -->` e `<!-- regras:fim -->`. Um teste falha se o documento divergir.
 */
export function renderRulesTable(rules: RuleSet): string {
  const lines = [
    `Conjunto \`${rules.id}\` versão \`${rules.version}\`.`,
    "",
    "| Regra | Base | O que faz | Valor |",
    "|---|---|---|---|",
  ];
  for (const [id, entry] of Object.entries(rules.rules) as Array<[RuleId, RuleEntry<unknown>]>) {
    if (id === "DOSE_DEFAULTS") {
      lines.push(`| ${id} | ${BASIS_TEXT[entry.basis]} | ${cell(entry.description)} | ver tabela de doses |`);
      continue;
    }
    if (id === "DOSE_PROFILES") {
      lines.push(`| ${id} | ${BASIS_TEXT[entry.basis]} | ${cell(entry.description)} | ver tabela de perfis de dose |`);
      continue;
    }
    lines.push(`| ${id} | ${BASIS_TEXT[entry.basis]} | ${cell(entry.description)} | \`${cell(entry.value)}\` |`);
  }
  lines.push("", "Doses padrão (`DOSE_DEFAULTS`):", "", "| Estímulo | Modalidade | Métrica | Valores |", "|---|---|---|---|");
  for (const d of rules.rules.DOSE_DEFAULTS.value) {
    const extras = [d.loadBasis && `loadBasis=${d.loadBasis}`, d.recoveryMode && `recoveryMode=${d.recoveryMode}`, d.loadInstruction && `"${d.loadInstruction}"`]
      .filter(Boolean)
      .join("; ");
    lines.push(`| ${d.stimulus} | ${d.modality} | ${d.metric} | \`${cell(d.values)}\`${extras ? ` ${cell(extras)}` : ""} |`);
  }
  const profiles = rules.rules.DOSE_PROFILES?.value;
  if (profiles) {
    lines.push("", "Perfis de dose (`DOSE_PROFILES`; escolhe o mais específico, depois o de mais critérios, depois a ordem da tabela; nunca definem séries nem carga):", "", "| Perfil | Código | Estímulo | Critérios | Valores | Por quê |", "|---|---|---|---|---|---|");
    for (const p of profiles) {
      const { stimulus, modality, metric, ...criteria } = p.match;
      lines.push(`| ${p.id} | ${p.code ?? "—"} | ${stimulus.join(", ")} (${modality}/${metric}) | \`${cell(criteria)}\` | \`${cell(p.values)}\`${p.loadInstruction ? ` "${cell(p.loadInstruction)}"` : ""} | ${p.reasons.join(", ")} |`);
    }
  }
  lines.push("", "Referências:", "", "| Id | Citação | Estado |", "|---|---|---|");
  for (const r of REFERENCES) lines.push(`| ${r.id} | ${cell(r.citation)} | ${r.status === "VERIFIED" ? "Verificada" : "NÃO VERIFICADA (não aparece para usuários)"} |`);
  return lines.join("\n");
}

export { BASIS_TEXT };
