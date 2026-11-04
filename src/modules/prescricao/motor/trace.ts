import { getRuleSet, verifiedRefs, type RuleId, type RuleSet, type RuleValues } from "./rules";
import { cmp } from "./vocabulary";
import type { Basis, Issue, ParamTrace, RuleUse, TraceEntry } from "./types";

/**
 * Leitura das regras com registro do que foi usado: cada valor lido entra em `rulesUsed` e pode
 * gerar entradas de traço com a base da regra. Referências não verificadas nunca saem daqui.
 */
export class RuleLog {
  private readonly used = new Set<RuleId>();
  constructor(readonly rules: RuleSet) {}

  get<K extends RuleId>(id: K): RuleValues[K] {
    this.used.add(id);
    return this.rules.rules[id].value;
  }

  basis(id: RuleId): Basis {
    return this.rules.rules[id].basis;
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
    for (const id of this.used) out.set(id, { ruleId: id, basis: this.basis(id), label: this.rules.rules[id].description });
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

/** Remove avisos repetidos (mesmo código, caminho e mensagem), mantendo a primeira ordem. */
export function uniqueIssues(issues: Issue[]): Issue[] {
  const seen = new Set<string>();
  const out: Issue[] = [];
  for (const i of issues) {
    const key = `${i.stage}|${i.code}|${i.path}|${i.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(i);
  }
  return out;
}
