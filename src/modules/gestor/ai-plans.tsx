"use client";
import { useState } from "react";
import { Notice, Pill } from "@/components/ui";
import type { PlanRow, TaskRow } from "@/db/ai-platform";
import { archivePlan, savePlan } from "./ai-actions";
import { Answer, useRunner, type Outcome } from "./ai-ui";
import { CURRENCIES, allowanceText, costCapRule, currencyConflicts, formatMoney, planIsZero, priceToField, type PlanFormValues } from "./ai-view";

const EMPTY: PlanFormValues = { name: "", mode: "TOTAL", total: "", input: "", output: "", capPlanning: "", capAdjustment: "", requestsPerMinute: "6", costCap: "", costCurrency: "USD" };

function valuesOf(plan: PlanRow): PlanFormValues {
  return {
    name: plan.name, mode: plan.mode, total: String(plan.totalTokens ?? ""), input: String(plan.inputTokens ?? ""), output: String(plan.outputTokens ?? ""),
    capPlanning: String(plan.perRequestCapPlanning), capAdjustment: String(plan.perRequestCapAdjustment), requestsPerMinute: String(plan.requestsPerMinute),
    costCap: priceToField(plan.costCapMicros), costCurrency: plan.costCapCurrency ?? "USD",
  };
}

/** The quota plans: what the SaaS operator allows each organization to spend on AI per month. Zero means "IA não incluída". */
export function PlansPanel({ plans, tasks, canWrite }: { plans: PlanRow[]; tasks: TaskRow[]; canWrite: boolean }) {
  const [editing, setEditing] = useState<PlanRow | "new" | null>(null);
  const [archiving, setArchiving] = useState<string | null>(null);
  const archive = useRunner();
  // the form closes when it saves, so what it answered is kept here
  const [saved, setSaved] = useState<Outcome | null>(null);
  const conflicts = currencyConflicts(plans, tasks);
  return (
    <>
      <section className="panel" aria-labelledby="ai-plans-title">
        <div className="panel-title">
          <h2 id="ai-plans-title">Planos de IA</h2>
          <button type="button" className="button primary small" disabled={!canWrite} onClick={() => (setSaved(null), setEditing("new"))}>
            Novo plano
          </button>
        </div>
        {conflicts.length > 0 && (
          <Notice tone="warning">
            <p>
              O limite de custo de {conflicts.join(", ")} está em uma moeda diferente da dos preços digitados em Modelos. Enquanto for assim, as organizações desse plano ficam sem IA. Ajuste o plano ou os preços.
            </p>
          </Notice>
        )}
        {plans.length === 0 ? (
          <p className="muted">Nenhum plano ainda. Sem plano, nenhuma organização tem IA.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table stack">
              <caption className="sr-only">Planos de IA</caption>
              <thead>
                <tr>
                  <th scope="col">Plano</th>
                  <th scope="col">Franquia mensal</th>
                  <th scope="col">Limite por pedido</th>
                  <th scope="col">Pedidos por minuto</th>
                  <th scope="col">Limite de custo</th>
                  <th scope="col">Organizações</th>
                  <th scope="col">
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {plans.map((plan) => (
                  <tr key={plan.id} data-plan={plan.name}>
                    <th scope="row" data-label="Plano">
                      {plan.name}
                      {plan.archivedAt ? <Pill>Arquivado</Pill> : planIsZero(plan) ? <Pill tone="warning">IA não incluída</Pill> : null}
                    </th>
                    <td data-label="Franquia mensal">{allowanceText(plan)}</td>
                    <td data-label="Limite por pedido">
                      Planejamento {plan.perRequestCapPlanning.toLocaleString("pt-BR")}
                      <small className="cell-sub">Ajuste {plan.perRequestCapAdjustment.toLocaleString("pt-BR")} tokens</small>
                    </td>
                    <td data-label="Pedidos por minuto">{plan.requestsPerMinute}</td>
                    <td data-label="Limite de custo">{plan.costCapMicros !== null && plan.costCapCurrency ? formatMoney(plan.costCapMicros, plan.costCapCurrency) : "Sem limite por custo"}</td>
                    <td data-label="Organizações">{plan.organizations}</td>
                    <td>
                      {!plan.archivedAt && (
                        <span className="inline-form">
                          <button type="button" className="button secondary small" disabled={!canWrite} onClick={() => (setSaved(null), setEditing(plan))} aria-label={`Editar o plano ${plan.name}`}>
                            Editar
                          </button>
                          {archiving === plan.id ? (
                            <>
                              <button
                                type="button"
                                className="button danger-outline small"
                                disabled={archive.pending || !canWrite}
                                onClick={() => (setSaved(null), archive.run(() => archivePlan(plan.id), () => setArchiving(null)))}
                              >
                                Confirmar: arquivar {plan.name}
                              </button>
                              <button type="button" className="button secondary small" onClick={() => setArchiving(null)}>
                                Voltar
                              </button>
                            </>
                          ) : (
                            <button type="button" className="button danger-outline small" disabled={!canWrite} onClick={() => setArchiving(plan.id)} aria-label={`Arquivar o plano ${plan.name}`}>
                              Arquivar
                            </button>
                          )}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Answer outcome={saved ?? archive.outcome} />
        <p className="small muted">
          Franquia zero significa “IA não incluída no plano”. Arquivar tira o plano de quem o usa: essas organizações ficam sem IA até receberem outro plano. Quando o plano de cobrança (SaaS) existir, cada plano de cobrança apontará para um plano de IA.
        </p>
      </section>
      {editing && <PlanForm key={editing === "new" ? "new" : editing.id + editing.version} plan={editing === "new" ? null : editing} tasks={tasks} onDone={(outcome) => (setSaved(outcome), setEditing(null))} canWrite={canWrite} />}
    </>
  );
}

function PlanForm({ plan, tasks, onDone, canWrite }: { plan: PlanRow | null; tasks: TaskRow[]; onDone: (outcome: Outcome | null) => void; canWrite: boolean }) {
  const { pending, outcome, run } = useRunner();
  const [v, setV] = useState<PlanFormValues>(plan ? valuesOf(plan) : EMPTY);
  const set = <K extends keyof PlanFormValues>(key: K, value: PlanFormValues[K]) => setV((c) => ({ ...c, [key]: value }));
  const rule = costCapRule(tasks);
  return (
    <section className="panel" aria-labelledby="ai-plan-form-title">
      <h2 id="ai-plan-form-title">{plan ? `Editar o plano ${plan.name}` : "Novo plano de IA"}</h2>
      <form
        className="stack-form"
        aria-label={plan ? "Editar plano de IA" : "Novo plano de IA"}
        onSubmit={(event) => {
          event.preventDefault();
          const sent = rule.allowed ? { ...v, costCurrency: rule.currency } : { ...v, costCap: "" };
          run(() => savePlan(plan?.id ?? null, sent, plan?.version ?? null), (r) => r.ok && onDone({ ok: true, message: r.message }));
        }}
      >
        <label>
          Nome do plano
          <input value={v.name} onChange={(e) => set("name", e.target.value)} maxLength={60} required autoComplete="off" disabled={!canWrite} />
        </label>
        <fieldset className="ai-fieldset" disabled={!canWrite}>
          <legend>Franquia mensal de tokens, por organização</legend>
          <div className="ai-radios">
            <label className="check-row check-row-tap">
              <input type="radio" name="mode" value="TOTAL" checked={v.mode === "TOTAL"} onChange={() => set("mode", "TOTAL")} />
              <span>Total (entrada e saída somadas)</span>
            </label>
            <label className="check-row check-row-tap">
              <input type="radio" name="mode" value="SPLIT" checked={v.mode === "SPLIT"} onChange={() => set("mode", "SPLIT")} />
              <span>Entrada e saída separadas</span>
            </label>
          </div>
          {v.mode === "TOTAL" ? (
            <label>
              Tokens por mês
              <input inputMode="numeric" value={v.total} onChange={(e) => set("total", e.target.value)} placeholder="0 = IA não incluída" />
            </label>
          ) : (
            <div className="field-grid">
              <label>
                Tokens de entrada por mês
                <input inputMode="numeric" value={v.input} onChange={(e) => set("input", e.target.value)} />
              </label>
              <label>
                Tokens de saída por mês
                <input inputMode="numeric" value={v.output} onChange={(e) => set("output", e.target.value)} />
              </label>
            </div>
          )}
        </fieldset>
        <fieldset className="ai-fieldset" disabled={!canWrite}>
          <legend>Limites por pedido e ritmo</legend>
          <div className="field-grid">
            <label>
              Planejamento (tokens por pedido)
              <input inputMode="numeric" value={v.capPlanning} onChange={(e) => set("capPlanning", e.target.value)} placeholder="0 = não incluído" />
            </label>
            <label>
              Ajuste assistido (tokens por pedido)
              <input inputMode="numeric" value={v.capAdjustment} onChange={(e) => set("capAdjustment", e.target.value)} placeholder="0 = não incluído" />
            </label>
            <label>
              Pedidos por minuto (por organização)
              <input inputMode="numeric" value={v.requestsPerMinute} onChange={(e) => set("requestsPerMinute", e.target.value)} />
            </label>
          </div>
        </fieldset>
        <fieldset className="ai-fieldset" disabled={!canWrite || !rule.allowed}>
          <legend>Limite de custo mensal (opcional)</legend>
          {rule.allowed ? (
            <div className="field-grid">
              <label>
                Valor por mês
                <input inputMode="decimal" value={v.costCap} onChange={(e) => (set("costCap", e.target.value), set("costCurrency", rule.currency))} placeholder="sem limite" autoComplete="off" />
              </label>
              <label>
                Moeda
                <select value={rule.currency} disabled aria-label="Moeda do limite de custo">
                  {CURRENCIES.filter((c) => c === rule.currency).map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
            </div>
          ) : (
            <p className="small muted">
              {rule.reason}
              {plan?.costCapMicros != null ? " O limite de custo que este plano tinha será removido ao salvar." : ""}
            </p>
          )}
        </fieldset>
        <div className="inline-form">
          <button className="button primary small" disabled={!canWrite || pending}>
            {pending ? "Salvando…" : "Salvar plano"}
          </button>
          <button type="button" className="button secondary small" disabled={pending} onClick={() => onDone(null)}>
            Cancelar
          </button>
        </div>
        <Answer outcome={outcome} />
      </form>
    </section>
  );
}
