/**
 * Registro das regras do motor. Cada conjunto é congelado por `id@version`: mudar um número é
 * publicar uma versão nova, para que toda geração gravada continue reproduzível.
 * Os valores ficam em JSON para serem lidos por TypeScript e por scripts `.mjs` sem carregador TS.
 */
import base from "./gymgital-base.json";
import referencesFile from "./references.json";
import type { Basis, DoseParam, Experience, LoadBasis, Metric, RuleSetRef } from "../types";

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
  SELECTION_WEIGHTS: Record<SelectionWeight, number>;
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

export type RuleId = keyof RuleValues;

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
  rules: { [K in RuleId]: RuleEntry<RuleValues[K]> };
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

const GYMGITAL_BASE = deepFreeze(JSON.parse(JSON.stringify(base)) as RuleSet);

/** Conjuntos publicados. Uma versão publicada nunca muda: novos números entram como nova versão. */
export const RULESETS: Readonly<Record<string, RuleSet>> = deepFreeze({
  [`${GYMGITAL_BASE.id}@${GYMGITAL_BASE.version}`]: GYMGITAL_BASE,
});

export const DEFAULT_RULESET: RuleSetRef = { id: GYMGITAL_BASE.id, version: GYMGITAL_BASE.version };

export function getRuleSet(ref: RuleSetRef): RuleSet | null {
  return RULESETS[`${ref.id}@${ref.version}`] ?? null;
}

/** Referências de uma regra que podem aparecer: apenas as VERIFIED. */
export function verifiedRefs(rules: RuleSet, ruleId: RuleId): string[] {
  const refs = rules.rules[ruleId].refs ?? [];
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
