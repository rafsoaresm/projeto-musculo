"use client";
import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useUnsavedGuard } from "@/components/use-unsaved-guard";
import { saveCompositionSection } from "./actions";
import { DiscardDraftButton } from "./discard-button";
import { COMPOSITION_MODULE, formFromPayload, payloadFromForm, problemsMessage, type CompositionForm, type CompositionPayload } from "./composition";
import { CompositionStep } from "./composition-step";
import { savedAtLabel } from "./autosave";
import { useDraftAutosave, type DraftModule } from "./use-draft-autosave";

/** The steps of the guided assessment, as in the Figma frames (AV-03, AV-04). Only "Medidas" exists in this version. */
const STEPS = [
  { key: "triagem", label: "Triagem", title: "Triagem e segurança" },
  { key: "medidas", label: "Medidas", title: "Composição corporal" },
  { key: "movimento", label: "Movimento", title: "Postura e movimento" },
  { key: "revisao", label: "Revisão", title: "Revisão e conclusão" },
] as const;
type StepKey = (typeof STEPS)[number]["key"];

/**
 * The guided assessment of the new format (handoff V2): the step chips, the step on screen, and Voltar / Salvar rascunho / Próximo. What is typed
 * stays on the screen when the step changes and is stored by itself after a pause in the typing and when the step changes (and by "Salvar
 * rascunho"), always against the revision the page read, so a save from a stale screen (another tab, another person) is refused and said, never
 * silently written over — and the draft stops saving itself until the page is reloaded (rule in autosave.ts).
 */
export function AssessmentShell({
  studentId,
  assessmentId,
  assessedOn,
  birthDate,
  revision: initialRevision,
  composition,
}: {
  studentId: string;
  assessmentId: string;
  assessedOn: string;
  /** From the snapshot the draft took of the student's file; null when the file had none. */
  birthDate: string | null;
  revision: number;
  composition: CompositionPayload;
}) {
  const [step, setStep] = useState<StepKey>("medidas");
  const [form, setForm] = useState<CompositionForm>(() => formFromPayload(composition));
  const [discardError, setDiscardError] = useState<string | null>(null);
  const index = STEPS.findIndex((item) => item.key === step);
  const current = STEPS[index];

  // The modules of the draft the screen edits; each step that has fields adds its own here.
  const compositionModule = useMemo<DraftModule>(
    () => ({
      content: JSON.stringify(form),
      read: () => {
        const read = payloadFromForm(form);
        return read.payload === null ? { problem: problemsMessage(read.problems) } : { payload: read.payload };
      },
      send: (payload, revision) => saveCompositionSection(assessmentId, payload, revision),
    }),
    [form, assessmentId],
  );
  const draft = useDraftAutosave(initialRevision, { [COMPOSITION_MODULE]: compositionModule });
  const status = draft.status;
  const alert = discardError ?? draft.alert;
  useUnsavedGuard(draft.unsaved);

  /** A failed discard is said until the next change or save: it never hides what autosave says after it. */
  const edit = (next: CompositionForm) => {
    setDiscardError(null);
    setForm(next);
  };

  /** Leaving a step saves what changed in it (never an invalid value: the problem is shown and the step still changes). */
  const goTo = (next: StepKey) => {
    if (next === step) return;
    setStep(next);
    void draft.request("step");
  };

  return (
    <div className="av2">
      <nav className="av2-steps" aria-label="Etapas da avaliação física">
        <ol>
          {STEPS.map((item, position) => (
            <li key={item.key}>
              <button
                type="button"
                className="av2-step"
                aria-current={item.key === step ? "step" : undefined}
                onClick={() => goTo(item.key)}
              >
                {position + 1} {item.label}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <div className="av2-heading">
        <h2>{current.title}</h2>
        {step === "medidas" && <p className="muted small">Medidas básicas, protocolo de dobras e prévia calculada</p>}
      </div>

      {step === "medidas" ? (
        <CompositionStep form={form} onChange={edit} assessedOn={assessedOn} birthDate={birthDate} />
      ) : (
        <section className="panel av2-card">
          <p>Esta etapa chega numa próxima versão.</p>
        </section>
      )}

      <div className="av2-footer">
        {/* Two regions that are always there (a region that changes its role is not reliably read): the quiet line and the alert. */}
        <div className="av2-messages">
          <p className={`av2-status ${status.kind === "problem" ? "error" : status.kind}`} role="status">
            {status.kind === "clean" && "Sem alterações desde que a página abriu."}
            {status.kind === "dirty" && "Alterações não salvas."}
            {status.kind === "saving" && "Salvando…"}
            {status.kind === "saved" && savedAtLabel(status.at)}
            {status.kind === "problem" && status.text}
          </p>
          <div role="alert">{alert && <p className="av2-status error">{alert}</p>}</div>
        </div>
        <div className="av2-actions">
          <DiscardDraftButton
            studentId={studentId}
            assessmentId={assessmentId}
            busy={draft.inFlight}
            // Nothing more is saved from this screen while the draft goes; if it stays (an error), saving comes back.
            onConfirm={() => {
              draft.halt();
              setDiscardError(null);
            }}
            onError={(text) => {
              draft.resume();
              setDiscardError(text);
            }}
          />
          <button type="button" className="button secondary" disabled={index === 0} onClick={() => goTo(STEPS[index - 1].key)}>
            <ArrowLeft size={17} /> Voltar
          </button>
          {/* aria-disabled, not disabled: a save that starts by itself never takes the focus away from the button. A click during a save waits
              for it (the hook queues it); after a conflict it does nothing. The label stays put, so the bar does not move at every save. */}
          <button
            type="button"
            className="button secondary"
            aria-disabled={draft.stopped || undefined}
            onClick={() => {
              if (draft.stopped) return;
              setDiscardError(null);
              void draft.request("button", COMPOSITION_MODULE);
            }}
          >
            Salvar rascunho
          </button>
          <button
            type="button"
            className="button primary"
            disabled={index === STEPS.length - 1}
            onClick={() => goTo(STEPS[index + 1].key)}
          >
            Próximo <ArrowRight size={17} />
          </button>
        </div>
      </div>
    </div>
  );
}
