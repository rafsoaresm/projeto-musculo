"use client";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useUnsavedGuard } from "@/components/use-unsaved-guard";
import {
  finalizeAssessment,
  saveCompositionSection,
  saveConclusionSection,
  saveMovementSection,
  savePostureSection,
  saveProfileSection,
  saveScreeningSection,
  saveTestsSection,
} from "./actions";
import { DiscardDraftButton } from "./discard-button";
import { COMPOSITION_MODULE, formFromPayload, payloadFromForm, problemsMessage, type CompositionForm, type CompositionPayload } from "./composition";
import { CompositionStep } from "./composition-step";
import { savedAtLabel } from "./autosave";
import { useDraftAutosave, type DraftModule } from "./use-draft-autosave";
import {
  PROFILE_MODULE,
  SCREENING_MODULE,
  profileFromForm,
  screeningFromForm,
  triagemFormFrom,
  triagemProblemsMessage,
  type ProfilePayload,
  type ScreeningPayload,
  type TriagemForm,
} from "./screening";
import { TriagemStep } from "./triagem-step";
import { POSTURE_MODULE, postureFormFrom, postureFromForm, postureProblemsMessage, type PostureForm, type PosturePayload } from "./posture";
import { PostureStep } from "./posture-step";
import { MOVEMENT_MODULE, movementFormFrom, movementFromForm, movementProblemsMessage, type MovementForm, type MovementPayload } from "./flexitest";
import { FlexitestCard } from "./flexitest-card";
import { TESTS_MODULE, testsFormFrom, testsFromForm, testsProblemsMessage, type TestsForm, type TestsPayload } from "./physical-tests";
import { TestsStep } from "./tests-step";
import { CONCLUSION_MODULE, conclusionFromForm, conclusionProblemsMessage, type ConclusionForm, type ConclusionPayload } from "./conclusion";
import { ConclusionCard } from "./conclusion-card";
import { ReviewStep } from "./review-step";
import { reviewDraft } from "./review";
import type { StepKey } from "./steps";

/**
 * The steps of the guided assessment, as in the Figma frames (AV-02 to AV-06) and the flow of the handoff (section 2: "Testes físicos" is a step of
 * its own before "Revisão e entrega"), with the modules of the draft each one edits.
 */
const STEPS = [
  { key: "triagem", label: "Triagem", title: "Triagem e segurança", description: "Objetivos, histórico de saúde e revisão profissional", modules: [PROFILE_MODULE, SCREENING_MODULE] },
  { key: "medidas", label: "Medidas", title: "Composição corporal", description: "Medidas básicas, dobras com prévia calculada, perímetros e diâmetros ósseos", modules: [COMPOSITION_MODULE] },
  {
    key: "movimento",
    label: "Movimento",
    title: "Postura e movimento",
    description: "Observações posturais não diagnósticas, somatotipo registrado pelo profissional e os 15 movimentos do Flexiteste",
    modules: [POSTURE_MODULE, MOVEMENT_MODULE],
  },
  { key: "testes", label: "Testes", title: "Testes físicos", description: "Resistência abdominal, resistência de membros superiores e Cooper 12 minutos", modules: [TESTS_MODULE] },
  { key: "revisao", label: "Revisão", title: "Revisão e conclusão", description: "Pendências, resultados calculados, considerações finais e finalização", modules: [CONCLUSION_MODULE] },
] as const satisfies readonly { key: StepKey; label: string; title: string; description: string | null; modules: readonly string[] }[];

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
  profile,
  screening,
  posture,
  movement,
  tests,
  conclusion,
  initialStep = "triagem",
  suggestedEquation = null,
  amendment = null,
}: {
  studentId: string;
  assessmentId: string;
  assessedOn: string;
  /** From the snapshot the draft took of the student's file; null when the file had none. */
  birthDate: string | null;
  revision: number;
  composition: CompositionPayload;
  profile: ProfilePayload;
  screening: ScreeningPayload;
  posture: PosturePayload;
  movement: MovementPayload;
  tests: TestsPayload;
  conclusion: ConclusionPayload;
  /** The step in the address (?etapa=), so a reload stays where the person was; a new draft starts at step 1. */
  initialStep?: StepKey;
  /** For a reassessment: the reference of the equation of the student's previous assessment, offered (never applied by itself). */
  suggestedEquation?: "male" | "female" | null;
  /** For an amendment (retificação): its reason and the screening of the assessment it amends, as recorded. */
  amendment?: { reason: string; originalScreening: ScreeningPayload | null } | null;
}) {
  const [step, setStep] = useState<StepKey>(initialStep);
  const [form, setForm] = useState<CompositionForm>(() => formFromPayload(composition));
  const [triagem, setTriagem] = useState<TriagemForm>(() => triagemFormFrom(profile, screening));
  const [postureForm, setPostureForm] = useState<PostureForm>(() => postureFormFrom(posture));
  const [movementForm, setMovementForm] = useState<MovementForm>(() => movementFormFrom(movement));
  const [testsForm, setTestsForm] = useState<TestsForm>(() => testsFormFrom(tests));
  const [conclusionForm, setConclusionForm] = useState<ConclusionForm>(() => ({ ...conclusion }));
  const [discardError, setDiscardError] = useState<string | null>(null);
  const [finalizeError, setFinalizeError] = useState<{ text: string; pending?: string[] } | null>(null);
  const [finalizing, startFinalize] = useTransition();
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
  // The two modules of "Triagem" are read from one screen: each is sent only when its own part changed (its content).
  const profileModule: DraftModule = {
    content: JSON.stringify([triagem.goals, triagem.goalNotes]),
    read: () => {
      const read = profileFromForm(triagem);
      return read.payload === null ? { problem: triagemProblemsMessage(read.problems) } : { payload: read.payload };
    },
    send: (payload, revision) => saveProfileSection(assessmentId, payload, revision),
  };
  const screeningModule: DraftModule = {
    content: JSON.stringify([triagem.anamnesis, triagem.current, triagem.past, triagem.parq, triagem.decision, triagem.decisionNotes]),
    read: () => {
      const read = screeningFromForm(triagem);
      return read.payload === null ? { problem: triagemProblemsMessage(read.problems) } : { payload: read.payload };
    },
    send: (payload, revision) => saveScreeningSection(assessmentId, payload, revision),
  };
  const postureModule: DraftModule = {
    content: JSON.stringify(postureForm),
    read: () => {
      const read = postureFromForm(postureForm);
      return read.payload === null ? { problem: postureProblemsMessage(read.problems) } : { payload: read.payload };
    },
    send: (payload, revision) => savePostureSection(assessmentId, payload, revision),
  };
  const movementModule: DraftModule = {
    content: JSON.stringify(movementForm),
    read: () => {
      const read = movementFromForm(movementForm);
      return read.payload === null ? { problem: movementProblemsMessage(read.problems) } : { payload: read.payload };
    },
    send: (payload, revision) => saveMovementSection(assessmentId, payload, revision),
  };
  const testsModule: DraftModule = {
    content: JSON.stringify(testsForm),
    read: () => {
      const read = testsFromForm(testsForm);
      return read.payload === null ? { problem: testsProblemsMessage(read.problems) } : { payload: read.payload };
    },
    send: (payload, revision) => saveTestsSection(assessmentId, payload, revision),
  };
  const conclusionModule: DraftModule = {
    content: JSON.stringify(conclusionForm),
    read: () => {
      const read = conclusionFromForm(conclusionForm);
      return read.payload === null ? { problem: conclusionProblemsMessage(read.problems) } : { payload: read.payload };
    },
    send: (payload, revision) => saveConclusionSection(assessmentId, payload, revision),
  };
  const draft = useDraftAutosave(initialRevision, {
    [PROFILE_MODULE]: profileModule,
    [SCREENING_MODULE]: screeningModule,
    [COMPOSITION_MODULE]: compositionModule,
    [POSTURE_MODULE]: postureModule,
    [MOVEMENT_MODULE]: movementModule,
    [TESTS_MODULE]: testsModule,
    [CONCLUSION_MODULE]: conclusionModule,
  });
  const status = draft.status;
  const alert = discardError ?? draft.alert;
  useUnsavedGuard(draft.unsaved);

  // The review is computed from what is on the screen with the same rule the server finalizes with; a value that is not accepted is named.
  const profileRead = profileFromForm(triagem);
  const screeningRead = screeningFromForm(triagem);
  const compositionRead = payloadFromForm(form);
  const postureRead = postureFromForm(postureForm);
  const movementRead = movementFromForm(movementForm);
  const testsRead = testsFromForm(testsForm);
  const conclusionRead = conclusionFromForm(conclusionForm);
  const problems = [
    ...(profileRead.payload === null ? [`Triagem: ${triagemProblemsMessage(profileRead.problems)}`] : []),
    ...(screeningRead.payload === null ? [`Triagem: ${triagemProblemsMessage(screeningRead.problems)}`] : []),
    ...(compositionRead.payload === null ? [`Medidas: ${problemsMessage(compositionRead.problems)}`] : []),
    ...(postureRead.payload === null ? [`Movimento: ${postureProblemsMessage(postureRead.problems)}`] : []),
    ...(movementRead.payload === null ? [`Movimento: ${movementProblemsMessage(movementRead.problems)}`] : []),
    ...(testsRead.payload === null ? [`Testes: ${testsProblemsMessage(testsRead.problems)}`] : []),
    ...(conclusionRead.payload === null ? [`Revisão: ${conclusionProblemsMessage(conclusionRead.problems)}`] : []),
  ];
  const review = reviewDraft({
    profile: profileRead.payload,
    screening: screeningRead.payload ?? screening,
    composition: compositionRead.payload ?? composition,
    posture: postureRead.payload ?? posture,
    movement: movementRead.payload ?? movement,
    tests: testsRead.payload ?? tests,
    assessedOn,
    birthDate,
    original: amendment ? { screening: amendment.originalScreening } : null,
  });

  /** Saves what is still unsaved, then finalizes the draft at the revision the screen holds; on success the page goes to the record. */
  const finalize = () =>
    startFinalize(async () => {
      setFinalizeError(null);
      if (!(await draft.flush())) {
        setFinalizeError({ text: "Não foi possível salvar tudo antes de finalizar. Confira a mensagem acima e tente de novo." });
        return;
      }
      draft.halt();
      const result = await finalizeAssessment(studentId, assessmentId, draft.revision());
      if (result?.error) {
        if (!result.conflict) draft.resume();
        setFinalizeError({ text: result.error, pending: result.pending });
      }
    });

  /** A failed discard is said until the next change or save: it never hides what autosave says after it. */
  const edit = (next: CompositionForm) => {
    setDiscardError(null);
    setForm(next);
  };
  const editTriagem = (next: TriagemForm) => {
    setDiscardError(null);
    setTriagem(next);
  };
  const editPosture = (next: PostureForm) => {
    setDiscardError(null);
    setPostureForm(next);
  };
  const editMovement = (next: MovementForm) => {
    setDiscardError(null);
    setMovementForm(next);
  };
  const editTests = (next: TestsForm) => {
    setDiscardError(null);
    setTestsForm(next);
  };
  const editConclusion = (next: ConclusionForm) => {
    setDiscardError(null);
    setConclusionForm(next);
  };

  /** On a narrow screen the steps scroll sideways: keep the current one in view (on load and on every change), moving only that row, never the page. */
  const stepsRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const row = stepsRef.current;
    const current = row?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!row || !current) return;
    const left = current.offsetLeft - row.offsetLeft;
    const right = left + current.offsetWidth;
    if (left < row.scrollLeft) row.scrollLeft = left;
    else if (right > row.scrollLeft + row.clientWidth) row.scrollLeft = right - row.clientWidth;
  }, [step]);

  /** Leaving a step saves what changed in it (never an invalid value: the problem is shown and the step still changes). */
  const goTo = (next: StepKey) => {
    if (next === step) return;
    setStep(next);
    // The address keeps the step (a convenience for a reload), relative to the page so it holds under any mount.
    window.history.replaceState(null, "", `?etapa=${next}`);
    void draft.request("step");
  };

  return (
    <div className="av2">
      <nav className="av2-steps" aria-label="Etapas da avaliação física">
        <ol ref={stepsRef}>
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
        {current.description && <p className="muted small">{current.description}</p>}
      </div>

      {step === "triagem" ? (
        <TriagemStep form={triagem} onChange={editTriagem} />
      ) : step === "medidas" ? (
        <CompositionStep form={form} onChange={edit} assessedOn={assessedOn} birthDate={birthDate} suggestedEquation={suggestedEquation} />
      ) : step === "movimento" ? (
        <PostureStep form={postureForm} onChange={editPosture} after={<FlexitestCard form={movementForm} onChange={editMovement} />} />
      ) : step === "testes" ? (
        <TestsStep form={testsForm} onChange={editTests} />
      ) : (
        <ReviewStep
          review={review}
          problems={problems}
          amendment={amendment}
          finalizing={finalizing}
          error={finalizeError}
          onFinalize={finalize}
          onOpenTriagem={() => goTo("triagem")}
          conclusion={<ConclusionCard form={conclusionForm} onChange={editConclusion} />}
        />
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
              void draft.request("button", current.modules);
            }}
          >
            Salvar rascunho
          </button>
          {/* On the last step (Revisão) the next action is the finalize card, not a "Próximo" that leads nowhere. */}
          {index < STEPS.length - 1 && (
            <button type="button" className="button primary" onClick={() => goTo(STEPS[index + 1].key)}>
              Próximo <ArrowRight size={17} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
