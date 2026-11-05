"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { ChevronLeft } from "lucide-react";
import { Pill } from "@/components/ui";
import { loadAlternatives, substituteExercise, type ProposalActionResult } from "./actions";
import { NETWORK_ERROR, useIntent } from "./use-intent";
import { filterByText } from "./workbench";

export interface SubstituteTarget {
  phaseIndex: number;
  slotKey: string;
  week: number;
  slot: number;
  label: string;
  exerciseId: string | null;
  name: string;
  phaseWeeks: number;
}

export interface LibraryEntry {
  id: string;
  name: string;
  category: string;
}

type Scope = "OCCURRENCE" | "FROM_WEEK" | "PHASE";
const METADATA: Record<string, string | null> = { REVIEWED: "Metadados revisados", INCLUDES_INFERRED: "Inferido (não revisado)", PENDING: "Pendente de curadoria", NOT_APPLICABLE: null };
/** The library results listed at once: the search narrows them, the screen never draws the whole library. */
const RESULT_LIMIT = 40;

/**
 * "Substituir" (Figma RX-06; a modal on a wide screen, a full screen on a phone): the engine's alternatives for the item, each
 * labelled reviewed or inferred with its reasons, or any exercise of the visible library found by name or by group (the library
 * has no equipment field, so there is no equipment filter); and where the change applies (this session, from this week on, or
 * the whole phase). The dose is recalculated for the new exercise by the engine; nothing reaches the draft until the apply, and the
 * engine never picks an alternative for the professional.
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
  library: LibraryEntry[];
  onClose: (result?: ProposalActionResult) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const intent = useIntent();
  const [alternatives, setAlternatives] = useState<Array<{ exerciseId: string; name: string; metadata: string; reasons: string[] }> | null>(null);
  const [choice, setChoice] = useState("");
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("");
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

  const applies =
    scope === "OCCURRENCE"
      ? { kind: "OCCURRENCE" as const, week: target.week, slot: target.slot }
      : scope === "FROM_WEEK"
        ? { kind: "FROM_WEEK" as const, week: target.week }
        : { kind: "PHASE" as const };
  const groups = [...new Set(library.map((e) => e.category))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const offered = new Set((alternatives ?? []).map((a) => a.exerciseId));
  const searching = query.trim() !== "" || group !== "";
  const found = searching
    ? filterByText(
        library.filter((e) => e.id !== target.exerciseId && !offered.has(e.id) && (!group || e.category === group)),
        query,
        (e) => `${e.name} ${e.category}`,
      )
    : [];
  const chosenName = library.find((e) => e.id === choice)?.name ?? alternatives?.find((a) => a.exerciseId === choice)?.name ?? "";

  return (
    <dialog ref={dialog} className="rx-dialog rx-subst" aria-labelledby="substituir-titulo" onClose={() => onClose()}>
      <form
        method="dialog"
        onSubmit={(event) => {
          event.preventDefault();
          if (!choice) return;
          setError("");
          startTransition(async () => {
            try {
              const ids = intent.take(`sub:${target.slotKey}:${choice}:${scope}`);
              const result = await substituteExercise(planId, revisionId, {
                ...proposal,
                idempotencyKey: ids.key,
                writeId: ids.write,
                target: { phaseIndex: target.phaseIndex, slotKey: target.slotKey, applies },
                newExerciseId: choice,
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
        <div className="rx-dialog-body">
          <button type="button" className="rx-back" onClick={() => dialog.current?.close()}>
            <ChevronLeft size={16} aria-hidden="true" /> Voltar ao exercício
          </button>
          <h2 id="substituir-titulo" className="rx-modal-title">
            Substituir exercício
          </h2>
          <p className="rx-sub">
            {target.name} • Semana {target.week} • Sessão {target.slot} • Treino {target.label}. A dose é recalculada para o exercício novo e o item passa a constar como
            trocado por você.
          </p>
          <label className="rx-search">
            <span className="sr-only">Buscar nome ou grupo muscular</span>
            <input type="search" value={query} placeholder="Buscar nome ou grupo muscular" onChange={(e) => setQuery(e.target.value)} />
          </label>
          <div className="rx-card rx-filters">
            <label>
              <span className="sr-only">Grupo</span>
              <select value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Grupo de exercícios">
                <option value="">Grupo muscular</option>
                {groups.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <fieldset className="rx-results">
            <legend className="rx-label">Alternativas da ferramenta</legend>
            {alternatives === null ? (
              <p className="small muted" role="status">
                <span className="spinner" aria-hidden="true" /> Buscando alternativas…
              </p>
            ) : alternatives.length === 0 ? (
              <p className="rx-sub">Nenhuma alternativa compatível com o equipamento informado. Busque na biblioteca abaixo.</p>
            ) : (
              <ul className="rx-choices">
                {alternatives.map((a) => (
                  <li key={a.exerciseId}>
                    <label className={choice === a.exerciseId ? "rx-choice selected" : "rx-choice"}>
                      <input type="radio" name="alternativa" value={a.exerciseId} checked={choice === a.exerciseId} onChange={() => setChoice(a.exerciseId)} />
                      <span>
                        <strong>{a.name}</strong> {METADATA[a.metadata] && <Pill tone={a.metadata === "REVIEWED" ? "success" : "warning"}>{METADATA[a.metadata]}</Pill>}
                        {a.reasons.length > 0 && <span className="rx-sub"> · {a.reasons.join(" · ")}</span>}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>
          <fieldset className="rx-results">
            <legend className="rx-label">Resultados da biblioteca</legend>
            {!searching ? (
              <div className="rx-emptycard">
                <strong>Escolha um exercício</strong>
                <p>Digite a busca ou escolha um grupo para encontrar alternativas na biblioteca.</p>
              </div>
            ) : found.length === 0 ? (
              <p className="rx-sub">Nenhum exercício da biblioteca encontrado.</p>
            ) : (
              <>
                <ul className="rx-choices">
                  {found.slice(0, RESULT_LIMIT).map((e) => (
                    <li key={e.id}>
                      <label className={choice === e.id ? "rx-choice selected" : "rx-choice"}>
                        <input type="radio" name="alternativa" value={e.id} checked={choice === e.id} onChange={() => setChoice(e.id)} />
                        <span>
                          <strong>{e.name}</strong> <span className="rx-sub">· {e.category}</span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                {found.length > RESULT_LIMIT && <p className="rx-sub">Mostrando {RESULT_LIMIT} de {found.length}: refine a busca.</p>}
              </>
            )}
          </fieldset>
          <fieldset className="rx-results">
            <legend className="rx-label">Onde vale a troca</legend>
            <label className="check-row rx-choice">
              <input type="radio" name="escopo" checked={scope === "OCCURRENCE"} onChange={() => setScope("OCCURRENCE")} />
              Só nesta sessão
            </label>
            {target.week > 1 && (
              <label className="check-row rx-choice">
                <input type="radio" name="escopo" checked={scope === "FROM_WEEK"} onChange={() => setScope("FROM_WEEK")} />
                Da semana {target.week} em diante
              </label>
            )}
            <label className="check-row rx-choice">
              <input type="radio" name="escopo" checked={scope === "PHASE"} onChange={() => setScope("PHASE")} />
              Na fase inteira
            </label>
          </fieldset>
          <div className="rx-note rx-note-brand">
            <strong>Antes de confirmar</strong>
            <p>A ferramenta não aplica uma alternativa sem a sua escolha. Nada chega ao rascunho antes de Aplicar.</p>
          </div>
          {error && (
            <p className="error-message" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="rx-dialog-foot">
          <p className="rx-sub" role="status">
            {choice ? `Selecionado: ${chosenName}` : "Selecione um exercício para habilitar a confirmação."}
          </p>
          <div className="rx-modal-actions">
            <button type="button" className="rx-btn rx-btn-line" onClick={() => dialog.current?.close()}>
              Cancelar
            </button>
            <button type="submit" className="rx-btn rx-btn-primary" disabled={pending || !choice}>
              {pending ? "Substituindo…" : "Confirmar substituição"}
            </button>
          </div>
        </div>
      </form>
    </dialog>
  );
}
