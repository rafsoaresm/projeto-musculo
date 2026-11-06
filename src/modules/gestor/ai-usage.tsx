import Link from "next/link";
import { Pill, formatDateTime } from "@/components/ui";
import type { AiAuditRow, CircuitView, UsageRow } from "@/db/ai-platform";
import { AI_CACHE_TTL_DEFAULT_DAYS, AI_CACHE_TTL_MAX_DAYS } from "@/modules/prescricao/planejador/quota";
import type { OperationalReport } from "@/db/ai-reports";
import { cacheHitRate, errorCodeLabel, errorRate, formatLatency, formatPercent, type QuotaAlert } from "./ai-report-view";
import { TASK_LABEL, formatMoney, formatTokens, monthLabel } from "./ai-view";

const AUDIT_LABEL: Record<string, string> = {
  AI_PROVIDER_CONNECTED: "Provedor conectado",
  AI_PROVIDER_ROTATED: "Chave trocada",
  AI_PROVIDER_REMOVED: "Provedor removido",
  AI_PROVIDER_TESTED: "Conexão testada",
  AI_MODEL_TESTED: "Modelo testado",
  AI_TASK_CONFIGURED: "Tarefa configurada",
  AI_KILL_SWITCH_ON: "IA interrompida",
  AI_KILL_SWITCH_OFF: "IA liberada",
  AI_PLAN_SAVED: "Plano salvo",
  AI_PLAN_ARCHIVED: "Plano arquivado",
  AI_ORG_ENABLED: "IA habilitada para uma organização",
  AI_ORG_DISABLED: "IA desligada para uma organização",
  AI_ORG_PLAN_ASSIGNED: "Plano atribuído a uma organização",
};

const CIRCUIT_LABEL = { CLOSED: "Fechado (normal)", OPEN: "Aberto (chamadas suspensas)", HALF_OPEN: "Meio aberto (testando)" } as const;

/** Month totals per organization and task, the circuit of each provider/model, and the AI slice of the audit trail. Read-only. */
export function UsagePanel({
  month, months, rows, circuits, audit, operational, alerts,
}: { month: string; months: string[]; rows: UsageRow[]; circuits: CircuitView[]; audit: AiAuditRow[]; operational: OperationalReport; alerts: QuotaAlert[] }) {
  const ops = new Map(operational.rows.map((o) => [`${o.organizationId}/${o.task}`, o]));
  const anyUnknownCost = rows.some((r) => r.costMicros === null && !r.mixedCurrency);
  const anyPartialCost = rows.some((r) => r.costMicros !== null && r.unpricedCalls > 0);
  const anyMixedCurrency = rows.some((r) => r.mixedCurrency);
  return (
    <>
      <section className="panel" aria-labelledby="ai-alerts-title">
        <h2 id="ai-alerts-title">Alertas de franquia</h2>
        {alerts.length === 0 ? (
          <p className="muted">Nenhuma organização perto do limite do plano neste mês.</p>
        ) : (
          <ul className="ai-plain-list" role="list">
            {alerts.map((a) => (
              <li key={a.organizationId}>
                <Pill tone={a.level === "LIMIT" ? "danger" : "warning"}>{a.level === "LIMIT" ? "Limite atingido" : `${a.percent}% usado`}</Pill> {a.message}
              </li>
            ))}
          </ul>
        )}
        <p className="small muted">Os alertas valem para o mês corrente: aviso a partir de 80% da franquia e bloqueio em 100%, os mesmos números da aba Organizações.</p>
      </section>

      <section className="panel" aria-labelledby="ai-usage-title">
        <div className="panel-title">
          <h2 id="ai-usage-title">Uso em {monthLabel(month)}</h2>
          <form method="get" className="inline-form" aria-label="Escolher o mês">
            <input type="hidden" name="aba" value="uso" />
            <label className="ai-month">
              <span className="sr-only">Mês</span>
              <select name="mes" defaultValue={month}>
                {months.map((m) => (
                  <option key={m} value={m}>
                    {monthLabel(m)}
                  </option>
                ))}
              </select>
            </label>
            <button className="button secondary small">Ver</button>
          </form>
        </div>
        {rows.length === 0 ? (
          <p className="muted">Nenhum uso de IA registrado neste mês.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table stack">
              <caption className="sr-only">Uso de IA por organização e tarefa</caption>
              <thead>
                <tr>
                  <th scope="col">Organização</th>
                  <th scope="col">Tarefa</th>
                  <th scope="col" className="num">Pedidos</th>
                  <th scope="col" className="num">Reaproveitados (cache)</th>
                  <th scope="col" className="num">Erros</th>
                  <th scope="col" className="num">Tokens de entrada</th>
                  <th scope="col" className="num">Tokens de saída</th>
                  <th scope="col" className="num">Custo</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.organizationId}-${r.task}`}>
                    <th scope="row" data-label="Organização">{r.organizationName}</th>
                    <td data-label="Tarefa">{TASK_LABEL[r.task]}</td>
                    <td data-label="Pedidos" className="num">{formatTokens(r.requests)}</td>
                    <td data-label="Reaproveitados (cache)" className="num">{formatTokens(r.cacheHits)}</td>
                    <td data-label="Erros" className="num">{formatTokens(r.errors)}</td>
                    <td data-label="Tokens de entrada" className="num">{formatTokens(r.inputTokens)}</td>
                    <td data-label="Tokens de saída" className="num">{formatTokens(r.outputTokens)}</td>
                    <td data-label="Custo" className="num">{r.costMicros !== null && r.currency ? `${formatMoney(r.costMicros, r.currency)}${r.unpricedCalls > 0 ? " (parcial)" : ""}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {anyUnknownCost && <p className="small muted">“—” é custo desconhecido: o preço do modelo não estava digitado quando a chamada foi feita. A ferramenta nunca estima um preço.</p>}
        {anyPartialCost && <p className="small muted">“(parcial)” soma só as chamadas que tinham preço digitado; as demais chamadas do grupo ficaram sem preço e não entram na soma.</p>}
        {anyMixedCurrency && <p className="small muted">“—” também aparece quando as chamadas com preço usaram moedas diferentes: a ferramenta não soma moedas.</p>}
        <p className="small muted">
          Os tokens vêm do que o provedor informou; quando ele não informa, a ferramenta usa uma estimativa e marca como tal. Para o uso e o que resta da franquia de cada organização, veja a aba{" "}
          <Link className="account-link" href="/gestor/inteligencia-artificial?aba=organizacoes">Organizações</Link>.
        </p>
      </section>

      <section className="panel" aria-labelledby="ai-ops-title">
        <h2 id="ai-ops-title">Latência, erros e reaproveitamento</h2>
        {rows.length === 0 ? (
          <p className="muted">Sem chamadas neste mês.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table stack">
              <caption className="sr-only">Latência, erros e cache por organização e tarefa</caption>
              <thead>
                <tr>
                  <th scope="col">Organização</th>
                  <th scope="col">Tarefa</th>
                  <th scope="col" className="num">Latência mediana</th>
                  <th scope="col" className="num">Latência p95</th>
                  <th scope="col" className="num">Reaproveitamento (cache)</th>
                  <th scope="col" className="num">Taxa de erro</th>
                  <th scope="col">Erros por causa</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const o = ops.get(`${r.organizationId}/${r.task}`);
                  return (
                    <tr key={`${r.organizationId}-${r.task}`}>
                      <th scope="row" data-label="Organização">{r.organizationName}</th>
                      <td data-label="Tarefa">{TASK_LABEL[r.task]}</td>
                      <td data-label="Latência mediana" className="num">{formatLatency(o?.latency.p50Ms ?? null)}</td>
                      <td data-label="Latência p95" className="num">{formatLatency(o?.latency.p95Ms ?? null)}</td>
                      <td data-label="Reaproveitamento (cache)" className="num">{formatPercent(cacheHitRate(r.cacheHits, r.requests))}</td>
                      <td data-label="Taxa de erro" className="num">{formatPercent(errorRate(r.errors, r.requests))}</td>
                      <td data-label="Erros por causa">
                        {o && o.errorsByCode.length > 0 ? o.errorsByCode.map((e) => `${errorCodeLabel(e.code)}: ${e.count}`).join(" · ") : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="small muted">
          A latência é o tempo até o provedor responder, só das chamadas que chegaram a ele (cache não tem latência). “—” é sem amostra.
          {operational.latencyTruncated ? " Neste mês a amostra foi limitada às primeiras chamadas." : ""} Nada aqui contém texto de pedido, resposta ou dado de aluno: só contagens, tempos e códigos.
        </p>
      </section>

      <section className="panel" aria-labelledby="ai-circuits-title">
        <h2 id="ai-circuits-title">Estado de cada provedor e modelo</h2>
        {circuits.length === 0 ? (
          <p className="muted">Nenhuma falha registrada: todos os circuitos estão fechados.</p>
        ) : (
          <ul className="ai-plain-list">
            {circuits.map((c) => (
              <li key={`${c.providerKind}/${c.modelId}`}>
                <strong>{c.providerKind}</strong> · {c.modelId} <Pill tone={c.state === "CLOSED" ? "success" : "warning"}>{CIRCUIT_LABEL[c.state]}</Pill>{" "}
                <span className="small muted">desde {formatDateTime(c.since)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="small muted">Depois de 5 falhas de disponibilidade seguidas o modelo é suspenso por 1 minuto e a ferramenta tenta de novo com uma única chamada de prova.</p>
      </section>

      <section className="panel" aria-labelledby="ai-retention-title">
        <h2 id="ai-retention-title">Retenção e exclusão</h2>
        <ul className="ai-plain-list">
          <li>As respostas guardadas para reaproveitar (cache) expiram sozinhas: {AI_CACHE_TTL_DEFAULT_DAYS} dias por padrão, ajustável pela variável AI_CACHE_TTL_DAYS (até {AI_CACHE_TTL_MAX_DAYS} dias). Não há processo em segundo plano: as vencidas são apagadas quando a organização faz uma nova chamada.</li>
          <li>Quando o profissional cumpre um pedido de exclusão de dados do aluno, a ferramenta também apaga o cache, as respostas guardadas do planejador e os ajustes assistidos daquele aluno. Planejamentos, aceites e este registro de uso ficam, porque guardam só contagens, códigos e resumos criptográficos.</li>
          <li>O pedido enviado ao provedor nunca é guardado aqui. Quanto tempo o provedor o retém depende do contrato com ele e ainda precisa de confirmação (veja as pendências).</li>
        </ul>
      </section>

      <section className="panel" aria-labelledby="ai-audit-title">
        <h2 id="ai-audit-title">Últimas alterações</h2>
        {audit.length === 0 ? (
          <p className="muted">Nenhuma alteração de IA registrada.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table stack">
              <caption className="sr-only">Alterações de IA feitas por gestores</caption>
              <thead>
                <tr>
                  <th scope="col">Quando</th>
                  <th scope="col">Ação</th>
                  <th scope="col">Sobre</th>
                  <th scope="col">Feita por</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((a) => (
                  <tr key={a.id}>
                    <th scope="row" data-label="Quando">{formatDateTime(a.createdAt)}</th>
                    <td data-label="Ação">{AUDIT_LABEL[a.action] ?? a.action}</td>
                    <td data-label="Sobre">{a.subject}</td>
                    <td data-label="Feita por">{a.actorEmail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="small muted">O registro mostra o que mudou e quem mudou. Chaves, ou qualquer trecho delas, nunca entram nele.</p>
      </section>
    </>
  );
}
