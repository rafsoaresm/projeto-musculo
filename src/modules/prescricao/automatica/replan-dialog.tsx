"use client";
import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Sheet } from "@/components/sheet";
import { previewReplan } from "@/modules/prescricao/planejador/blueprint-actions";
import { replanConfirmText, replanHref, replanScopeKey, parseReplanScope, type ReplanPreviewCounts, type ReplanScope } from "./review-view";
import { NETWORK_ERROR } from "./use-intent";

const scopes = (phaseIndex: number, hasLater: boolean): ReplanScope[] => [
  { kind: "PHASE", phaseIndex },
  ...(hasLater ? [{ kind: "FROM_PHASE", phaseIndex } as ReplanScope] : []),
  { kind: "FULL" },
];

const scopeText = (s: ReplanScope) => (s.kind === "FULL" ? "Todas as fases geradas" : s.kind === "PHASE" ? `Só a fase ${s.phaseIndex}` : `Desta fase em diante (fase ${s.phaseIndex})`);

/**
 * "Rever estratégia" on the proposal: before going back to the strategy, says what redoing it would replace (the tool's own picks in the scope)
 * and what it keeps (locked, replaced by the professional, already in the draft). Nothing is written here: "Refazer" only opens the strategy
 * step; the proposal changes when the new strategy is confirmed there. Cancel and Esc close it.
 */
export function ReplanDialog({
  open,
  onClose,
  planId,
  revisionId,
  proposalId,
  selfHref,
  phaseIndex,
  hasLaterPhase,
}: {
  open: boolean;
  onClose: () => void;
  planId: string;
  revisionId: string;
  proposalId: string;
  selfHref: string;
  phaseIndex: number;
  hasLaterPhase: boolean;
}) {
  const router = useRouter();
  const titleId = useId();
  const [scopeKey, setScopeKey] = useState(replanScopeKey({ kind: "PHASE", phaseIndex }));
  const [counts, setCounts] = useState<ReplanPreviewCounts | null>(null);
  const [error, setError] = useState("");
  const options = scopes(phaseIndex, hasLaterPhase);
  const scope = parseReplanScope(scopeKey) ?? options[0]!;

  useEffect(() => {
    if (!open) return;
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the counts of a scope are read when the dialog opens or the scope changes
    setCounts(null);
    setError("");
    previewReplan(planId, revisionId, proposalId, scope)
      .then((preview) => {
        if (!alive) return;
        if (!preview) setError("Não foi possível conferir o que seria refeito. Recarregue a página.");
        else setCounts(preview);
      })
      .catch(() => alive && setError(NETWORK_ERROR));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, planId, revisionId, proposalId, replanScopeKey(scope)]);

  const text = counts ? replanConfirmText(scope, counts) : null;
  return (
    <Sheet open={open} onClose={onClose} titleId={titleId}>
      <div className="rx-replan">
        <h2 id={titleId} className="sheet-title">
          Rever a estratégia
        </h2>
        <fieldset className="rx-replan-scope">
          <legend className="rx-label">O que refazer</legend>
          {options.map((o) => {
            const key = replanScopeKey(o);
            return (
              <label key={key} className="rx-replan-option">
                <input type="radio" name="replan-scope" value={key} checked={replanScopeKey(scope) === key} onChange={() => setScopeKey(key)} />
                <span>{scopeText(o)}</span>
              </label>
            );
          })}
        </fieldset>
        <div role="status" aria-live="polite" className="rx-replan-body">
          {error ? <p className="error-message">{error}</p> : text ? <p data-replan-confirm>{text.body}</p> : <p className="rx-sub">Conferindo o que seria refeito…</p>}
        </div>
        <p className="rx-sub">
          Você escolhe a estratégia na tela seguinte; nada na proposta muda até confirmar lá. Não aprova nem entrega nada ao aluno.
        </p>
        <div className="rx-modal-actions">
          <button type="button" className="rx-btn rx-btn-line" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="rx-btn rx-btn-primary" disabled={!counts} onClick={() => router.push(replanHref(selfHref, scope))}>
            Refazer
          </button>
        </div>
      </div>
    </Sheet>
  );
}
