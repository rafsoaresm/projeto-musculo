"use client";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Notice } from "@/components/ui";
import { Sheet } from "@/components/sheet";
import type { ApplyCounts, ManualWorkout } from "@/db/prescription-proposals";
import { applyProposal } from "./actions";
import { NETWORK_ERROR, isRedirectError, useIntent } from "./use-intent";

export interface ApplyView {
  counts: ApplyCounts;
  manualWorkouts: ManualWorkout[];
  phasesMissing: number[];
  infeasible: boolean;
  /** Exercises of the proposal that left the visible library. */
  catalogChanged: number;
  /** The draft changed since the proposal was generated. */
  stale: boolean;
}

const sessions = (n: number) => `${n} ${n === 1 ? "sessão" : "sessões"}`;

/**
 * The persistent bar and the confirmation of "Aplicar ao rascunho" (Figma RX-01 and RX-03 on a wide screen, RX-04 and RX-11 on a phone):
 * the bar says what the apply writes and that it neither approves nor delivers; "Prévia da aplicação" and "Aplicar N sessões ao
 * rascunho" open the same confirmation, a modal on a wide screen and a bottom sheet on a phone, with the real counts, the workouts
 * that already have exercises in the draft (kept unless ticked to be replaced), the confirmation an infeasible proposal needs (Q8,
 * recorded) and what blocks it (phases missing, an exercise gone from the library, the draft changed). Repeating the request does not
 * duplicate sessions (idempotency key per intent). On success the server takes the professional to the draft.
 * On the other tabs the bar only takes the professional back to the sessions (`back`), as in RX-02.
 */
export function ApplyPanel({
  planId,
  revisionId,
  proposalId,
  version,
  apply,
  back,
  strategy = false,
  onReviewStrategy,
}: {
  planId: string;
  revisionId: string;
  proposalId: string;
  version: number;
  apply: ApplyView | null;
  back?: { title: string; text: string; label: string; onBack: () => void };
  /** The proposal was made from an accepted strategy: the bar then says "Proposta editável; …" and offers "Rever estratégia". */
  strategy?: boolean;
  onReviewStrategy?: () => void;
}) {
  const router = useRouter();
  const intent = useIntent();
  const [replace, setReplace] = useState<string[]>([]);
  const [confirmInfeasible, setConfirmInfeasible] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const [dialog, setDialog] = useState(false);
  const titleId = useId();
  const key = (w: ManualWorkout) => JSON.stringify([w.phaseIndex, w.label]);
  const close = () => {
    setDialog(false);
    setUnderstood(false);
    setError("");
  };

  if (back)
    return (
      <section className="rx-card rx-bar" aria-label={back.label}>
        <p className="rx-bar-text">
          {back.title && <strong>{back.title}</strong>}
          <span className="rx-sub">{back.text}</span>
        </p>
        <div className="rx-bar-actions">
          <button type="button" className="rx-btn rx-btn-primary" onClick={back.onBack}>
            {back.label}
          </button>
        </div>
      </section>
    );
  if (!apply) return null;
  const { counts, manualWorkouts, phasesMissing, infeasible, catalogChanged, stale } = apply;
  const hold = phasesMissing.length > 0 || catalogChanged > 0 || stale;
  const blocked = hold || (infeasible && !confirmInfeasible) || !understood;
  const label = `Aplicar ${sessions(counts.occurrences)} ao rascunho`;
  return (
    <section className="rx-card rx-bar" aria-label="Aplicar ao rascunho">
      <p className="rx-bar-text">
        <strong className="rx-desktop">{strategy ? "Proposta editável; não aprova nem altera treinos entregues." : "Rascunho ainda não alterado"}</strong>
        <span className="rx-sub">
          <span className="rx-desktop">Rascunho ainda não alterado. Aplicar grava sessões; não aprova e não entrega ao aluno.</span>
          <span className="rx-mobile">{hold ? "Há pendências antes de aplicar." : strategy ? "Não aplica, não aprova e não entrega sozinho." : "Nenhuma alteração aplicada ao aluno"}</span>
          {hold && <span className="rx-desktop"> Há pendências antes de aplicar.</span>}
        </span>
      </p>
      <div className="rx-bar-actions">
        {strategy && onReviewStrategy && (
          <button type="button" className="rx-btn rx-btn-line rx-desktop" onClick={onReviewStrategy}>
            Rever estratégia
          </button>
        )}
        <button type="button" className="rx-btn rx-btn-line rx-desktop" onClick={() => setDialog(true)}>
          Prévia da aplicação
        </button>
        <button type="button" className="rx-btn rx-btn-primary" onClick={() => setDialog(true)}>
          {label}
        </button>
      </div>
      <Sheet open={dialog} onClose={() => !pending && close()} titleId={titleId} busy={pending}>
        <div className="rx-apply">
          <span className="rx-grabber" aria-hidden="true" />
          <span className="rx-chip rx-chip-brand rx-desktop">Passo final · revisão</span>
          <h2 id={titleId} className="rx-modal-title">
            <span className="rx-desktop">Aplicar proposta ao rascunho</span>
            <span className="rx-mobile">Confirmar aplicação</span>
          </h2>
          <p className="rx-sub rx-lead">
            <span className="rx-desktop">A proposta será gravada sessão por sessão. Isso não aprova o plano e não entrega treinos ao aluno.</span>
            <span className="rx-mobile">As sessões serão gravadas no rascunho, sem publicar o plano ao aluno.</span>
          </p>
          <hr className="rx-rule" />
          <dl className="rx-tiles rx-tiles-4">
            <div>
              <dt>{counts.occurrences === 1 ? "sessão" : "sessões"}</dt>
              <dd>{counts.occurrences}</dd>
            </div>
            <div>
              <dt>{counts.rows === 1 ? "exercício novo" : "exercícios novos"}</dt>
              <dd>{counts.rows}</dd>
            </div>
            <div>
              <dt>
                <span className="rx-desktop">{counts.doses === 1 ? "dose prescrita" : "doses prescritas"}</span>
                <span className="rx-mobile">{counts.doses === 1 ? "Dose proposta" : "Doses propostas"}</span>
              </dt>
              <dd>{counts.doses}</dd>
            </div>
            <div>
              <dt>
                <span className="rx-desktop">já no rascunho</span>
                <span className="rx-mobile">já mantidos</span>
              </dt>
              <dd>{counts.preserved}</dd>
            </div>
          </dl>
          {phasesMissing.length > 0 && <Notice tone="warning">Faltam as fases {phasesMissing.join(", ")}. Continue a geração antes de aplicar.</Notice>}
          {catalogChanged > 0 && (
            <Notice tone="warning">Um exercício da proposta não está mais disponível na biblioteca: regenere as partes indicadas antes de aplicar.</Notice>
          )}
          {stale && <Notice tone="warning">O rascunho mudou desde a geração: atualize a proposta com o rascunho atual antes de aplicar.</Notice>}
          <div className="rx-confirm-list">
            <h3 className="rx-confirm-title">
              <span className="rx-desktop">O que acontece ao confirmar</span>
              <span className="rx-mobile">Ao confirmar:</span>
            </h3>
            <ol>
              <li>
                <span className="rx-badge" aria-hidden="true">
                  01
                </span>
                {sessions(counts.occurrences)} {counts.occurrences === 1 ? "é adicionada" : "são adicionadas"} ao rascunho deste plano.
              </li>
              <li>
                <span className="rx-badge" aria-hidden="true">
                  02
                </span>
                {manualWorkouts.length > 0
                  ? `${manualWorkouts.length} ${manualWorkouts.length === 1 ? "treino que já tem" : "treinos que já têm"} exercícios no rascunho ${manualWorkouts.length === 1 ? "é mantido" : "são mantidos"} como estão${manualWorkouts.length === 1 ? "" : ", salvo os que você marcar abaixo"}.`
                  : "Repetir o pedido não duplica sessões."}
              </li>
              <li>
                <span className="rx-badge" aria-hidden="true">
                  03
                </span>
                A aprovação e a entrega para o aluno permanecem separadas e continuam sendo suas.
              </li>
            </ol>
          </div>
          {manualWorkouts.length > 0 && (
            <fieldset className="auto-subsection rx-fieldset">
              <legend>Treinos que já têm exercícios no rascunho</legend>
              <p className="small muted">Por padrão eles são mantidos como estão. Marque só os treinos cujos exercícios devem ser substituídos pela proposta.</p>
              {manualWorkouts.map((w) => (
                <label key={key(w)} className="check-row check-row-tap">
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
            <label className="check-row check-row-tap rx-check">
              <input type="checkbox" checked={confirmInfeasible} onChange={(e) => setConfirmInfeasible(e.target.checked)} />
              A proposta tem impedimentos (inviável como está). Aplicar mesmo assim: a confirmação fica registrada.
            </label>
          )}
          <label className="check-row check-row-tap rx-check">
            <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
            <span className="rx-desktop">Entendi que aplicar ao rascunho não publica os treinos</span>
            <span className="rx-mobile">Entendi que a aplicação não entrega o plano.</span>
          </label>
          {error && (
            <p className="error-message" role="alert">
              {error}
            </p>
          )}
          <hr className="rx-rule" />
          <div className="rx-modal-actions">
            <button type="button" className="rx-btn rx-btn-line" disabled={pending} onClick={close}>
              Cancelar
            </button>
            <button
              type="button"
              className="rx-btn rx-btn-primary"
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
                  } catch (caught) {
                    // `redirect()` after a successful apply: the router is already taking the professional to the draft.
                    if (isRedirectError(caught)) return;
                    setError(NETWORK_ERROR);
                  }
                })
              }
            >
              {pending ? (
                "Aplicando…"
              ) : (
                <>
                  <span className="rx-desktop">Confirmar aplicação ao rascunho</span>
                  <span className="rx-mobile">Aplicar {sessions(counts.occurrences)}</span>
                </>
              )}
            </button>
          </div>
        </div>
      </Sheet>
    </section>
  );
}
