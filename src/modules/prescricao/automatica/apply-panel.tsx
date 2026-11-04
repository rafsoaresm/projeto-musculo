"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Kpi, Notice } from "@/components/ui";
import type { ApplyCounts, ManualWorkout } from "@/db/prescription-proposals";
import { applyProposal } from "./actions";
import { NETWORK_ERROR, useIntent } from "./use-intent";

/**
 * "Aplicar ao rascunho" (design §6.1 `apply-panel`, UI item 10): what the apply will write, the workouts that already have
 * exercises in the draft (kept unless the professional ticks each one to be replaced), the explicit confirmation an infeasible
 * proposal needs (Q8, recorded), and what blocks it (phases missing, an exercise gone from the library, the draft changed).
 * On success the server takes the professional to the draft, where the existing flow continues.
 */
export function ApplyPanel({
  planId,
  revisionId,
  proposalId,
  version,
  counts,
  manualWorkouts,
  phasesMissing,
  infeasible,
  catalogChanged,
  stale,
}: {
  planId: string;
  revisionId: string;
  proposalId: string;
  version: number;
  counts: ApplyCounts;
  manualWorkouts: ManualWorkout[];
  phasesMissing: number[];
  infeasible: boolean;
  catalogChanged: number;
  stale: boolean;
}) {
  const router = useRouter();
  const intent = useIntent();
  const [replace, setReplace] = useState<string[]>([]);
  const [confirmInfeasible, setConfirmInfeasible] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const key = (w: ManualWorkout) => JSON.stringify([w.phaseIndex, w.label]);
  const blocked = phasesMissing.length > 0 || catalogChanged > 0 || stale || (infeasible && !confirmInfeasible);
  return (
    <section className="panel" aria-labelledby="aplicar-titulo">
      <p className="eyebrow">APLICAR</p>
      <h2 id="aplicar-titulo">Aplicar ao rascunho</h2>
      <p className="muted">
        A proposta é gravada nesta revisão em rascunho, sessão por sessão. Depois você revisa, edita, marca como pronta e aprova como de
        costume: aplicar não aprova nem entrega nada ao aluno.
      </p>
      <div className="kpi-grid compact">
        <Kpi label="Sessões" value={String(counts.occurrences)} />
        <Kpi label="Exercícios novos" value={String(counts.rows)} />
        <Kpi label="Doses por sessão" value={String(counts.doses)} />
        <Kpi label="Já no rascunho (mantidos)" value={String(counts.preserved)} />
      </div>
      {phasesMissing.length > 0 && (
        <Notice tone="warning">Faltam as fases {phasesMissing.join(", ")}. Continue a geração antes de aplicar.</Notice>
      )}
      {catalogChanged > 0 && (
        <Notice tone="warning">
          Um exercício da proposta não está mais disponível na biblioteca: regenere as partes indicadas antes de aplicar.
        </Notice>
      )}
      {stale && <Notice tone="warning">O rascunho mudou desde a geração: atualize a proposta com o rascunho atual antes de aplicar.</Notice>}
      {manualWorkouts.length > 0 && (
        <fieldset className="auto-subsection">
          <legend>Treinos que já têm exercícios no rascunho</legend>
          <p className="small muted">Por padrão eles são mantidos como estão. Marque só os treinos cujos exercícios devem ser substituídos pela proposta.</p>
          {manualWorkouts.map((w) => (
            <label key={key(w)} className="check-row">
              <input
                type="checkbox"
                checked={replace.includes(key(w))}
                onChange={(e) => setReplace(e.target.checked ? [...replace, key(w)] : replace.filter((k) => k !== key(w)))}
              />
              Substituir os {w.rows} {w.rows === 1 ? "exercício" : "exercícios"} do treino {w.label} da fase {w.phaseIndex}
            </label>
          ))}
        </fieldset>
      )}
      {infeasible && (
        <label className="check-row">
          <input type="checkbox" checked={confirmInfeasible} onChange={(e) => setConfirmInfeasible(e.target.checked)} />
          A proposta tem impedimentos (inviável como está). Aplicar mesmo assim: a confirmação fica registrada.
        </label>
      )}
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        className="button primary"
        disabled={pending || blocked}
        onClick={() =>
          startTransition(async () => {
            setError("");
            const confirmedWorkouts = replace.map((k) => {
              const [phaseIndex, label] = JSON.parse(k) as [number, string];
              return { phaseIndex, label };
            });
            try {
              const ids = intent.take(`apply:${version}:${replace.join(",")}:${confirmInfeasible}`);
              // On success the action redirects to the draft (it throws a redirect, handled by Next).
              const result = await applyProposal(planId, revisionId, {
                proposalId,
                idempotencyKey: ids.key,
                expectedVersion: version,
                conflictMode: confirmedWorkouts.length ? "REPLACE_CONFIRMED" : "PRESERVE",
                confirmedWorkouts,
                confirmInfeasible: infeasible && confirmInfeasible,
              });
              intent.done();
              if (result?.error) {
                setError(result.error);
                router.refresh();
              }
            } catch {
              setError(NETWORK_ERROR);
            }
          })
        }
      >
        {pending ? "Aplicando…" : "Aplicar ao rascunho"}
      </button>
    </section>
  );
}
