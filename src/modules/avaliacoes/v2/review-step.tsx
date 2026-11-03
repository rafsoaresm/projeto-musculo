"use client";
import { useState } from "react";
import { CircleCheck, Info, TriangleAlert } from "lucide-react";
import { ResultsList } from "./results-list";
import type { DraftReview, ModuleSummary } from "./review";

const STATE_LABEL: Record<ModuleSummary["state"], string> = {
  ready: "Completa",
  pending: "Com pendências",
  partial: "Parcial",
  filled: "Com medidas",
  not_done: "Não realizado",
};

/**
 * The "Revisão" step (handoff V2 section 7, Figma AV-06 "Revisão e entrega"): a checklist per module, what still blocks the finalize, the results
 * that will be recorded (with method and formula version) and why the others will not, and "Finalizar avaliação" with a confirmation. Optional
 * modules not done do not block; they are recorded as not done, never as a 0.
 */
export function ReviewStep({
  review,
  problems,
  amendment,
  finalizing,
  error,
  onFinalize,
  onOpenTriagem,
}: {
  review: DraftReview;
  /** A value on the screen that is not accepted (named), which would not be saved. */
  problems: string[];
  amendment: { reason: string } | null;
  finalizing: boolean;
  error: { text: string; pending?: string[] } | null;
  onFinalize: () => void;
  /** Goes to step 1 (Triagem), where what blocks the finalize is filled in. */
  onOpenTriagem: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const blockers = [...problems, ...review.pending];
  const blocked = blockers.length > 0;
  return (
    <div className="av2-cards">
      <section className="panel av2-card" aria-labelledby="av2-pendencias">
        <h3 id="av2-pendencias">Pendências para finalizar</h3>
        <p className="muted small">A triagem precisa estar completa. Medidas e movimento podem ficar parciais: o que não foi feito fica como “Não realizado”.</p>
        {blocked ? (
          <>
            <ul className="av2-pending">
              {blockers.map((item) => (
                <li key={item}>
                  <TriangleAlert size={16} aria-hidden="true" /> {item}
                </li>
              ))}
            </ul>
            {review.pending.length > 0 && (
              <p className="av2-pending-where">
                <span className="small muted">As pendências da triagem se resolvem na etapa 1, Triagem.</span>{" "}
                <button type="button" className="button secondary small" onClick={onOpenTriagem}>
                  Abrir a etapa Triagem
                </button>
              </p>
            )}
          </>
        ) : (
          <p className="av2-ready">
            <CircleCheck size={16} aria-hidden="true" /> Nada pendente: a avaliação pode ser finalizada.
          </p>
        )}
        {review.riskFlag && !blocked && (
          <p className="av2-review-note">
            <Info size={16} aria-hidden="true" /> PAR-Q com resposta “Sim”: ao finalizar, a decisão profissional fica registrada com quem a registrou e
            quando.
          </p>
        )}
      </section>

      <section className="panel av2-card" aria-labelledby="av2-modulos">
        <h3 id="av2-modulos">Checklist por etapa</h3>
        <p className="muted small">O que cada etapa tem agora.</p>
        <ul className="av2-modules">
          {review.modules.map((module) => (
            <li key={module.key} className="av2-module">
              <span className="av2-module-head">
                <strong>{module.title}</strong>
                <span className={`pill ${module.state === "pending" ? "warning" : module.state === "ready" ? "success" : module.state === "not_done" ? "" : "brand"}`}>
                  {STATE_LABEL[module.state]}
                </span>
              </span>
              <ul className="av2-module-lines">
                {module.lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel av2-card" aria-labelledby="av2-resultados">
        <h3 id="av2-resultados">Resultados a registrar</h3>
        <p className="muted small">Calculados com as fórmulas versionadas, sem classificação (nenhuma tabela está homologada). Só os marcados como estimativa vêm da equação de um estudo; os demais são conta direta das medidas.</p>
        {review.results.length > 0 ? <ResultsList results={review.results} labelledBy="av2-resultados" /> : <p>Nenhum resultado calculável com o que foi medido.</p>}
        {review.notComputed.length > 0 && (
          <>
            <h4 className="av2-subtitle">Não calculados</h4>
            <ul className="av2-not-computed">
              {review.notComputed.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="panel av2-card" aria-labelledby="av2-finalizar">
        <h3 id="av2-finalizar">{amendment ? "Finalizar a retificação" : "Finalizar avaliação"}</h3>
        <p className="muted small">
          {amendment
            ? "Ao finalizar, a retificação é registrada como uma nova avaliação; a original continua no histórico, marcada como retificada."
            : "Ao finalizar, a avaliação é registrada e não muda mais. Uma correção depois disso é uma retificação, com o motivo escrito."}
        </p>
        {error && (
          <div role="alert" className="av2-status error">
            <p>{error.text}</p>
            {error.pending && (
              <ul>
                {error.pending.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {confirming && !blocked ? (
          <div className="av2-confirm" role="group" aria-labelledby="av2-confirmar">
            <p id="av2-confirmar">
              <strong>Finalizar agora?</strong> Depois disso, nada desta avaliação muda.
            </p>
            <div className="av2-confirm-actions">
              <button type="button" className="button secondary" disabled={finalizing} onClick={() => setConfirming(false)}>
                Cancelar
              </button>
              <button type="button" className="button primary" disabled={finalizing} onClick={onFinalize}>
                {finalizing ? "Finalizando…" : "Confirmar e finalizar"}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="button primary"
            aria-disabled={blocked || undefined}
            aria-describedby={blocked ? "av2-finalizar-motivo" : undefined}
            onClick={() => {
              if (!blocked) setConfirming(true);
            }}
          >
            {amendment ? "Finalizar retificação" : "Finalizar avaliação"}
          </button>
        )}
        {blocked && !confirming && (
          <p id="av2-finalizar-motivo" className="small muted av2-finalize-reason">
            Ainda não pode ser finalizada: resolva {blockers.length === 1 ? "a pendência listada" : `as ${blockers.length} pendências listadas`} em
            “Pendências para finalizar”.
          </p>
        )}
      </section>
    </div>
  );
}
