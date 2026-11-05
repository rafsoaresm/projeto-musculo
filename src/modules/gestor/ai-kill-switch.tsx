"use client";
import { useState } from "react";
import { Pill, formatDateTime } from "@/components/ui";
import { setKillSwitch } from "./ai-actions";
import { Answer, useRunner } from "./ai-ui";

/** The general switch: stops every provider call of the platform, including this panel's own tests. Two clicks; who and when are shown. */
export function KillSwitchCard({ on, byEmail, at, canWrite }: { on: boolean; byEmail: string | null; at: string | null; canWrite: boolean }) {
  const { pending, outcome, run } = useRunner();
  const [asking, setAsking] = useState(false);
  return (
    <section className="panel ai-kill" aria-labelledby="ai-kill-title">
      <div className="ai-kill-head">
        <h2 id="ai-kill-title">Interromper todas as chamadas de IA</h2>
        {on ? <Pill tone="danger">Interrompida</Pill> : <Pill tone="success">Liberada</Pill>}
      </div>
      <p className="small muted">
        O interruptor geral vale para todas as organizações e também para os testes deste painel. Os dados e o histórico ficam como estão; o planejamento por regras continua funcionando.
        {on && at ? ` Interrompida${byEmail ? ` por ${byEmail}` : ""} em ${formatDateTime(at)}.` : !on && at ? ` Última mudança${byEmail ? ` por ${byEmail}` : ""} em ${formatDateTime(at)}.` : ""}
      </p>
      {asking ? (
        <div className="inline-form">
          <span className="small">{on ? "Liberar as chamadas de IA de novo?" : "Interromper agora todas as chamadas de IA?"}</span>
          <button type="button" className={`button small ${on ? "primary" : "danger-outline"}`} disabled={pending || !canWrite} onClick={() => run(() => setKillSwitch(!on), () => setAsking(false))}>
            {pending ? "Aguarde…" : on ? "Confirmar: liberar" : "Confirmar: interromper"}
          </button>
          <button type="button" className="button small secondary" disabled={pending} onClick={() => setAsking(false)}>
            Voltar
          </button>
        </div>
      ) : (
        <button type="button" className={`button small ${on ? "primary" : "danger-outline"}`} disabled={!canWrite} onClick={() => setAsking(true)}>
          {on ? "Liberar as chamadas de IA" : "Interromper todas as chamadas de IA"}
        </button>
      )}
      <Answer outcome={outcome} />
    </section>
  );
}
