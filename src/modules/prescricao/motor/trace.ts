import { getRuleSet, verifiedRefs, type OptionalRuleId, type OptionalRuleValues, type RequiredRuleId, type RuleEntry, type RuleId, type RuleSet, type RuleValues } from "./rules";
import { cmp } from "./vocabulary";
import type { Basis, Issue, ParamTrace, RuleUse, TraceEntry } from "./types";

/**
 * Leitura das regras com registro do que foi usado: cada valor lido entra em `rulesUsed` e pode
 * gerar entradas de traço com a base da regra. Referências não verificadas nunca saem daqui.
 */
export class RuleLog {
  private readonly used = new Set<RuleId>();
  constructor(readonly rules: RuleSet) {}

  get<K extends RequiredRuleId>(id: K): RuleValues[K] {
    this.used.add(id);
    return (this.rules.rules[id] as RuleEntry<RuleValues[K]>).value;
  }

  /** Uma regra que a versão em uso pode não ter: undefined (e não registrada como usada) quando falta. */
  optional<K extends OptionalRuleId>(id: K): OptionalRuleValues[K] | undefined {
    const entry = this.rules.rules[id] as { value: OptionalRuleValues[K] } | undefined;
    if (!entry) return undefined;
    this.used.add(id);
    return entry.value;
  }

  basis(id: RuleId): Basis {
    return this.rules.rules[id]?.basis ?? "HEURISTIC";
  }

  entry(id: RuleId, code: string, detail: string): TraceEntry {
    this.used.add(id);
    return { code, basis: this.basis(id), ruleId: id, detail };
  }

  param(param: string, value: unknown, id: RuleId): ParamTrace {
    this.used.add(id);
    const refs = verifiedRefs(this.rules, id);
    return { param, value, basis: this.basis(id), ruleId: id, ...(refs.length ? { refs } : {}) };
  }

  rulesUsed(extra: RuleUse[] = []): RuleUse[] {
    const out = new Map<string, RuleUse>();
    for (const r of extra) out.set(r.ruleId, r);
    for (const id of this.used) out.set(id, { ruleId: id, basis: this.basis(id), label: this.rules.rules[id]?.description ?? id });
    return [...out.values()].sort((a, b) => cmp(a.ruleId, b.ruleId));
  }
}

export function ruleLogFor(ref: { id: string; version: string }): RuleLog | null {
  const rules = getRuleSet(ref);
  return rules ? new RuleLog(rules) : null;
}

export type IssueDraft = Omit<Issue, "stage"> & { stage?: Issue["stage"] };

export function issue(stage: Issue["stage"], draft: Omit<Issue, "stage">): Issue {
  return { ...draft, stage };
}

/** Aviso de metadado ausente para o perfil de dose (2026.11.6+): um por exercício, juntado por treino. */
export const DOSE_UNCERTAIN_CODE = "DOSE_PROFILE_UNCERTAIN";
export const DOSE_UNCERTAIN_SEGMENT = ".items.";

/**
 * Junta os avisos por exercício (`<treino>.items.<id>`) em UM aviso por treino, com a contagem de exercícios distintos. Avisos já
 * juntados (caminho do treino) passam como estão; sem avisos por exercício devolve a mesma lista.
 */
function collapseDoseUncertainty(issues: Issue[]): Issue[] {
  const perItem = (i: Issue) => i.code === DOSE_UNCERTAIN_CODE && i.path.includes(DOSE_UNCERTAIN_SEGMENT);
  if (!issues.some(perItem)) return issues;
  const groups = new Map<string, { first: Issue; paths: Set<string> }>();
  for (const i of issues.filter(perItem)) {
    const workout = i.path.slice(0, i.path.indexOf(DOSE_UNCERTAIN_SEGMENT));
    const g = groups.get(workout) ?? groups.set(workout, { first: i, paths: new Set() }).get(workout)!;
    g.paths.add(i.path);
  }
  const emitted = new Set<string>();
  const out: Issue[] = [];
  for (const i of issues) {
    if (!perItem(i)) {
      out.push(i);
      continue;
    }
    const workout = i.path.slice(0, i.path.indexOf(DOSE_UNCERTAIN_SEGMENT));
    if (emitted.has(workout)) continue;
    emitted.add(workout);
    const g = groups.get(workout)!;
    const n = g.paths.size;
    out.push({
      ...g.first, path: workout, count: n,
      message: `Treino ${g.first.label ?? workout}: ${n} exercício(s) sem metadado necessário para escolher o perfil de dose mais específico (composto, lateralidade, dificuldade, padrões); usado o perfil ou o padrão que os metadados conhecidos permitem.`,
    });
  }
  return out;
}

/** Remove avisos repetidos (mesmo código, caminho e mensagem), mantendo a primeira ordem. */
export function uniqueIssues(all: Issue[]): Issue[] {
  const seen = new Set<string>();
  const out: Issue[] = [];
  for (const i of collapseDoseUncertainty(all)) {
    const key = `${i.stage}|${i.code}|${i.path}|${i.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(i);
  }
  return out;
}
