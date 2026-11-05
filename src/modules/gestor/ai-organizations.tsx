"use client";
import { useState } from "react";
import { Pill } from "@/components/ui";
import type { OrganizationAiRow, PlanRow } from "@/db/ai-platform";
import { setOrganizationAi } from "./ai-actions";
import { Answer, useRunner } from "./ai-ui";
import { organizationState, organizationUsage } from "./ai-view";

interface Props {
  organizations: OrganizationAiRow[];
  plans: PlanRow[];
  canWrite: boolean;
  /** The text the gestor confirms before enabling (copy.ts). */
  ackText: string;
}

/**
 * One row per organization: AI on/off (default off), the plan, and the month's use against the plan's allowance. Enabling asks for the
 * acknowledgement first. Disabling is immediate and keeps history. The state is always spelled out in words, never by color alone.
 */
export function OrganizationsPanel({ organizations, plans, canWrite, ackText }: Props) {
  const { pending, outcome, run } = useRunner();
  const [enabling, setEnabling] = useState<OrganizationAiRow | null>(null);
  const [ack, setAck] = useState(false);
  const [pick, setPick] = useState("");
  // The plan select only STAGES a choice; saving is an explicit button (changing a select with the arrow keys must not write on every step).
  const [staged, setStaged] = useState<Record<string, string>>({});
  const live = plans.filter((p) => !p.archivedAt);
  // No plan, or a plan that was archived: the gestor must choose a live one here (the row's select is not required first).
  const needsPick = enabling !== null && (!enabling.quotaPlanId || !live.some((p) => p.id === enabling.quotaPlanId));
  const byId = new Map(plans.map((p) => [p.id, p]));

  return (
    <section className="panel" aria-labelledby="ai-orgs-title">
      <h2 id="ai-orgs-title">Organizações</h2>
      <p className="small muted">
        Por padrão a IA está desligada em todas. Para habilitar é preciso um plano de IA com franquia maior que zero. Quem usa a ferramenta nunca vê chaves, provedores, modelos nem custos: vê apenas o uso de tokens e, se for o caso, “IA não incluída no plano”.
      </p>
      {organizations.length === 0 ? (
        <p className="muted">Nenhuma organização ainda.</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table stack">
            <caption className="sr-only">Organizações e o uso de IA no mês</caption>
            <thead>
              <tr>
                <th scope="col">Organização</th>
                <th scope="col">IA ativa</th>
                <th scope="col">Plano de IA</th>
                <th scope="col">Uso do mês</th>
                <th scope="col">Estado</th>
              </tr>
            </thead>
            <tbody>
              {organizations.map((org) => {
                const plan = org.quotaPlanId ? (byId.get(org.quotaPlanId) ?? null) : null;
                const state = organizationState(org, plan);
                const usage = organizationUsage(org, plan);
                return (
                  <tr key={org.organizationId} data-org={org.organizationName}>
                    <th scope="row" data-label="Organização">
                      {org.organizationName}
                    </th>
                    <td data-label="IA ativa">
                      <label className="check-row check-row-tap ai-switch">
                        <input
                          type="checkbox"
                          role="switch"
                          checked={org.enabled}
                          disabled={!canWrite || pending}
                          aria-label={`IA ativa para ${org.organizationName}`}
                          onChange={(event) => {
                            if (event.target.checked) {
                              setAck(false);
                              setPick("");
                              setEnabling(org);
                            } else {
                              run(() => setOrganizationAi(org.organizationId, { enabled: false }, org.version));
                            }
                          }}
                        />
                        <span>{org.enabled ? "Sim" : "Não"}</span>
                      </label>
                    </td>
                    <td data-label="Plano de IA">
                      <div className="inline-form">
                        <select
                          aria-label={`Plano de IA de ${org.organizationName}`}
                          value={staged[org.organizationId] ?? org.quotaPlanId ?? ""}
                          disabled={!canWrite || pending}
                          onChange={(event) => setStaged((prev) => ({ ...prev, [org.organizationId]: event.target.value }))}
                        >
                          <option value="">Sem plano</option>
                          {live.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                          {plan?.archivedAt && <option value={plan.id}>{plan.name} (arquivado)</option>}
                        </select>
                        {staged[org.organizationId] !== undefined && staged[org.organizationId] !== (org.quotaPlanId ?? "") && (
                          <button
                            type="button"
                            className="button primary small"
                            disabled={!canWrite || pending}
                            aria-label={`Aplicar plano de IA a ${org.organizationName}`}
                            onClick={() => {
                              const quotaPlanId = staged[org.organizationId] || null;
                              run(
                                () => setOrganizationAi(org.organizationId, { quotaPlanId }, org.version),
                                (result) => {
                                  if (!result.ok) return;
                                  setStaged((prev) => {
                                    const next = { ...prev };
                                    delete next[org.organizationId];
                                    return next;
                                  });
                                },
                              );
                            }}
                          >
                            Aplicar plano
                          </button>
                        )}
                      </div>
                    </td>
                    <td data-label="Uso do mês">
                      <div className="ai-use">
                        {usage.percent !== null && <progress value={usage.percent} max={100} aria-label={`Uso do plano por ${org.organizationName}`} />}
                        <span>{usage.text}</span>
                        {usage.remainingText && <small className="cell-sub">{usage.remainingText}</small>}
                      </div>
                    </td>
                    <td data-label="Estado">
                      <Pill tone={state.tone === "danger" ? "danger" : state.tone}>{state.label}</Pill>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Answer outcome={outcome} />
      {enabling && (
        <form
          className="stack-form ai-confirm"
          aria-label={`Habilitar a IA para ${enabling.organizationName}`}
          onSubmit={(event) => {
            event.preventDefault();
            const target = enabling;
            run(() => setOrganizationAi(target.organizationId, { enabled: true, acknowledged: ack, ...(pick ? { quotaPlanId: pick } : {}) }, target.version), (r) => r.ok && setEnabling(null));
          }}
        >
          <h3>Habilitar a IA para {enabling.organizationName}</h3>
          {needsPick && (
            <label>
              Plano de IA
              <select value={pick} onChange={(e) => setPick(e.target.value)} required>
                <option value="">Escolha um plano</option>
                {live.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="check-row check-row-tap">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            <span>{ackText}</span>
          </label>
          <div className="inline-form">
            <button className="button primary small" disabled={!ack || pending || (needsPick && !pick)}>
              {pending ? "Habilitando…" : "Habilitar a IA"}
            </button>
            <button type="button" className="button secondary small" disabled={pending} onClick={() => setEnabling(null)}>
              Cancelar
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
