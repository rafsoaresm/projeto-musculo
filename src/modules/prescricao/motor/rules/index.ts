/**
 * Registro das regras do motor. Cada conjunto é congelado por `id@version`: mudar um número é
 * publicar uma versão nova, para que toda geração gravada continue reproduzível.
 * Os valores ficam em JSON para serem lidos por TypeScript e por scripts `.mjs` sem carregador TS.
 */
import base from "./gymgital-base.json";
import base2 from "./gymgital-base-2026.11.2.json";
import base3 from "./gymgital-base-2026.11.3.json";
import referencesFile from "./references.json";
import type { Basis, DoseParam, Experience, LoadBasis, Metric, RuleSetRef } from "../types";
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

export interface AuditBalancePair {
  code: string;
  a: string[];
  b: string[];
}

/**
 * Regras que só existem a partir de uma versão: uma versão anterior não as tem e o motor segue sem elas.
 * 2026.11.2: EXTERNAL_LOAD_STIMULI. 2026.11.3: AUDIT_* (auditoria técnica do plano).
 */
export interface OptionalRuleValues {
  EXTERNAL_LOAD_STIMULI: string[];
  AUDIT_THRESHOLDS: AuditThresholds;
  AUDIT_COMPREHENSIVE_STIMULI: string[];
  AUDIT_BALANCE_PAIRS: AuditBalancePair[];
  AUDIT_REGIONS: Record<string, string[]>;
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
const GYMGITAL_BASE = deepFreeze(JSON.parse(JSON.stringify(base3)) as RuleSet);

/** Conjuntos publicados. Uma versão publicada nunca muda: novos números entram como nova versão. */
export const RULESETS: Readonly<Record<string, RuleSet>> = deepFreeze({
  [`${GYMGITAL_BASE_2026_11_1.id}@${GYMGITAL_BASE_2026_11_1.version}`]: GYMGITAL_BASE_2026_11_1,
  [`${GYMGITAL_BASE_2026_11_2.id}@${GYMGITAL_BASE_2026_11_2.version}`]: GYMGITAL_BASE_2026_11_2,
  [`${GYMGITAL_BASE.id}@${GYMGITAL_BASE.version}`]: GYMGITAL_BASE,
});

/** A versão usada nas gerações novas (a mais recente); propostas gravadas seguem com a versão delas. */
export const DEFAULT_RULESET: RuleSetRef = { id: GYMGITAL_BASE.id, version: GYMGITAL_BASE.version };

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
    lines.push(`| ${id} | ${BASIS_TEXT[entry.basis]} | ${cell(entry.description)} | \`${cell(entry.value)}\` |`);
  }
  lines.push("", "Doses padrão (`DOSE_DEFAULTS`):", "", "| Estímulo | Modalidade | Métrica | Valores |", "|---|---|---|---|");
  for (const d of rules.rules.DOSE_DEFAULTS.value) {
    const extras = [d.loadBasis && `loadBasis=${d.loadBasis}`, d.recoveryMode && `recoveryMode=${d.recoveryMode}`, d.loadInstruction && `"${d.loadInstruction}"`]
      .filter(Boolean)
      .join("; ");
    lines.push(`| ${d.stimulus} | ${d.modality} | ${d.metric} | \`${cell(d.values)}\`${extras ? ` ${cell(extras)}` : ""} |`);
  }
  lines.push("", "Referências:", "", "| Id | Citação | Estado |", "|---|---|---|");
  for (const r of REFERENCES) lines.push(`| ${r.id} | ${cell(r.citation)} | ${r.status === "VERIFIED" ? "Verificada" : "NÃO VERIFICADA (não aparece para usuários)"} |`);
  return lines.join("\n");
}

export { BASIS_TEXT };
