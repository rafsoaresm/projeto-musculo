"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { Pill } from "@/components/ui";
import { loadAlternatives, substituteExercise, type ProposalActionResult } from "./actions";
import { NETWORK_ERROR, useIntent } from "./use-intent";

export interface SubstituteTarget {
  phaseIndex: number;
  slotKey: string;
  week: number;
  slot: number;
  name: string;
  phaseWeeks: number;
}

type Scope = "OCCURRENCE" | "FROM_WEEK" | "PHASE";
const METADATA: Record<string, string | null> = { REVIEWED: "Metadados revisados", INCLUDES_INFERRED: "Inferido (não revisado)", PENDING: "Pendente de curadoria", NOT_APPLICABLE: null };

/**
 * "Substituir" (design §6.1 `substitute-dialog`, UI item 8): the engine's alternatives for the item, each labelled reviewed or
 * inferred with its reasons, or any exercise of the visible library; and where the change applies (this session, from this week
 * on, or the whole phase). The dose is recalculated for the new exercise by the engine; nothing reaches the draft until the apply.
 */
export function SubstituteDialog({
  planId,
  revisionId,
  proposal,
  target,
  library,
  onClose,
}: {
  planId: string;
  revisionId: string;
  proposal: { proposalId: string; expectedVersion: number };
  target: SubstituteTarget;
  library: Array<{ id: string; name: string }>;
  onClose: (result?: ProposalActionResult) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const intent = useIntent();
  const [alternatives, setAlternatives] = useState<Array<{ exerciseId: string; name: string; metadata: string; reasons: string[] }> | null>(null);
  const [choice, setChoice] = useState("");
  const [other, setOther] = useState("");
  const [scope, setScope] = useState<Scope>("PHASE");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    dialog.current?.showModal();
    let alive = true;
    loadAlternatives(planId, revisionId, { proposalId: proposal.proposalId, phaseIndex: target.phaseIndex, slotKey: target.slotKey, week: target.week, slot: target.slot })
      .then((out) => {
        if (!alive) return;
        if (out.error) setError(out.error);
        setAlternatives(out.alternatives ?? []);
      })
      .catch(() => alive && setError(NETWORK_ERROR));
    return () => {
      alive = false;
    };
  }, [planId, revisionId, proposal.proposalId, target]);

  const chosen = other || choice;
  const applies =
    scope === "OCCURRENCE"
      ? { kind: "OCCURRENCE" as const, week: target.week, slot: target.slot }
      : scope === "FROM_WEEK"
        ? { kind: "FROM_WEEK" as const, week: target.week }
        : { kind: "PHASE" as const };

  return (
    <dialog ref={dialog} className="auto-dialog" aria-labelledby="substituir-titulo" onClose={() => onClose()}>
      <form
        method="dialog"
        onSubmit={(event) => {
          event.preventDefault();
          if (!chosen) return;
          setError("");
          startTransition(async () => {
            try {
              const ids = intent.take(`sub:${target.slotKey}:${chosen}:${scope}`);
              const result = await substituteExercise(planId, revisionId, {
                ...proposal,
                idempotencyKey: ids.key,
                writeId: ids.write,
                target: { phaseIndex: target.phaseIndex, slotKey: target.slotKey, applies },
                newExerciseId: chosen,
              });
              intent.done();
              if (result.error) {
                setError(result.error);
                return;
              }
              dialog.current?.close();
              onClose(result);
            } catch {
              setError(NETWORK_ERROR);
            }
          });
        }}
      >
        <h2 id="substituir-titulo">Substituir {target.name}</h2>
        <p className="small muted">
          Semana {target.week}, sessão {target.slot}. A dose é recalculada para o exercício novo e o item passa a constar como trocado por você.
        </p>
        <fieldset className="auto-subsection">
          <legend>Alternativas da ferramenta</legend>
          {alternatives === null ? (
            <p className="small muted" role="status">
              <span className="spinner" aria-hidden="true" /> Buscando alternativas…
            </p>
          ) : alternatives.length === 0 ? (
            <p className="small muted">Nenhuma alternativa compatível com o equipamento informado. Escolha da biblioteca abaixo.</p>
          ) : (
            <ul className="auto-list">
              {alternatives.map((a) => (
                <li key={a.exerciseId}>
                  <label className="check-row">
                    <input
                      type="radio"
                      name="alternativa"
                      value={a.exerciseId}
                      checked={!other && choice === a.exerciseId}
                      onChange={() => {
                        setChoice(a.exerciseId);
                        setOther("");
                      }}
                    />
                    <span>
                      <strong>{a.name}</strong> {METADATA[a.metadata] && <Pill tone={a.metadata === "REVIEWED" ? "success" : "warning"}>{METADATA[a.metadata]}</Pill>}
                      {a.reasons.length > 0 && <span className="small muted"> · {a.reasons.join(" · ")}</span>}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </fieldset>
        <label>
          Ou outro exercício da biblioteca
          <select value={other} onChange={(e) => setOther(e.target.value)}>
            <option value="">Escolha…</option>
            {library.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="auto-subsection">
          <legend>Onde vale a troca</legend>
          <label className="check-row">
            <input type="radio" name="escopo" checked={scope === "OCCURRENCE"} onChange={() => setScope("OCCURRENCE")} />
            Só nesta sessão
          </label>
          {target.week > 1 && (
            <label className="check-row">
              <input type="radio" name="escopo" checked={scope === "FROM_WEEK"} onChange={() => setScope("FROM_WEEK")} />
              Da semana {target.week} em diante
            </label>
          )}
          <label className="check-row">
            <input type="radio" name="escopo" checked={scope === "PHASE"} onChange={() => setScope("PHASE")} />
            Na fase inteira
          </label>
        </fieldset>
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        <div className="exercise-actions">
          <button type="submit" className="button primary small" disabled={pending || !chosen}>
            {pending ? "Substituindo…" : "Substituir"}
          </button>
          <button
            type="button"
            className="button secondary small"
            onClick={() => {
              dialog.current?.close();
            }}
          >
            Cancelar
          </button>
        </div>
      </form>
    </dialog>
  );
}
