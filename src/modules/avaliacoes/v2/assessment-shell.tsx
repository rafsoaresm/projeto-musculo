"use client";
import { useState, useTransition } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useUnsavedGuard } from "@/components/use-unsaved-guard";
import { saveCompositionSection } from "./actions";
import { DiscardDraftButton } from "./discard-button";
import { formFromPayload, payloadFromForm, problemsMessage, type CompositionForm, type CompositionPayload } from "./composition";
import { CompositionStep } from "./composition-step";

/** The steps of the guided assessment, as in the Figma frames (AV-03, AV-04). Only "Medidas" exists in this version. */
const STEPS = [
  { key: "triagem", label: "Triagem", title: "Triagem e segurança" },
  { key: "medidas", label: "Medidas", title: "Composição corporal" },
  { key: "movimento", label: "Movimento", title: "Postura e movimento" },
  { key: "revisao", label: "Revisão", title: "Revisão e conclusão" },
] as const;
type StepKey = (typeof STEPS)[number]["key"];

type Status = { kind: "clean" } | { kind: "dirty" } | { kind: "saved" } | { kind: "conflict"; text: string } | { kind: "error"; text: string };

/**
 * The guided assessment of the new format (handoff V2): the step chips, the step on screen, and Voltar / Salvar rascunho / Próximo. What is typed
 * stays on the screen when the step changes; it is stored only by "Salvar rascunho", against the revision the page read, so a save from a
 * stale screen (another tab, another person) is refused and said, never silently written over.
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
  const [revision, setRevision] = useState(initialRevision);
  const [status, setStatus] = useState<Status>({ kind: "clean" });
  const [pending, startTransition] = useTransition();
  const index = STEPS.findIndex((item) => item.key === step);
  const current = STEPS[index];
  const dirty = status.kind === "dirty" || status.kind === "error" || status.kind === "conflict";
  useUnsavedGuard(dirty);

  const change = (next: CompositionForm) => {
    setForm(next);
    setStatus((now) => (now.kind === "conflict" ? now : { kind: "dirty" }));
  };

  function save() {
    const read = payloadFromForm(form);
    if (read.payload === null) {
      setStatus({ kind: "error", text: problemsMessage(read.problems) });
      return;
    }
    const payload = read.payload;
    startTransition(async () => {
      const result = await saveCompositionSection(assessmentId, payload, revision);
      if ("saved" in result) {
        setRevision(result.revision);
        setStatus({ kind: "saved" });
      } else if ("conflict" in result) setStatus({ kind: "conflict", text: result.conflict });
      else setStatus({ kind: "error", text: result.error });
    });
  }

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
                onClick={() => setStep(item.key)}
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
        <CompositionStep form={form} onChange={change} assessedOn={assessedOn} birthDate={birthDate} />
      ) : (
        <section className="panel av2-card">
          <p>Esta etapa chega numa próxima versão.</p>
        </section>
      )}

      <div className="av2-footer">
        <p className={`av2-status ${status.kind}`} role={status.kind === "conflict" || status.kind === "error" ? "alert" : "status"}>
          {status.kind === "clean" && "Sem alterações desde que a página abriu."}
          {status.kind === "dirty" && "Alterações não salvas."}
          {status.kind === "saved" && "Rascunho salvo."}
          {(status.kind === "conflict" || status.kind === "error") && status.text}
        </p>
        <div className="av2-actions">
          <DiscardDraftButton
            studentId={studentId}
            assessmentId={assessmentId}
            disabled={pending}
            onError={(text) => setStatus({ kind: "error", text })}
          />
          <button type="button" className="button secondary" disabled={index === 0} onClick={() => setStep(STEPS[index - 1].key)}>
            <ArrowLeft size={17} /> Voltar
          </button>
          <button type="button" className="button secondary" disabled={pending || status.kind === "conflict"} onClick={save}>
            {pending ? "Salvando…" : "Salvar rascunho"}
          </button>
          <button
            type="button"
            className="button primary"
            disabled={index === STEPS.length - 1}
            onClick={() => setStep(STEPS[index + 1].key)}
          >
            Próximo <ArrowRight size={17} />
          </button>
        </div>
      </div>
    </div>
  );
}
