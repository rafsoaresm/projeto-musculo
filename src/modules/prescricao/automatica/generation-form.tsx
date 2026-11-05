"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Notice, Pill } from "@/components/ui";
import { CAUTION_TAGS, EQUIPMENT, MODALITIES, PATTERNS } from "@/modules/biblioteca/metadata/vocabulary";
import { STIMULUS_LABELS } from "@/modules/prescricao/motor/vocabulary";
import type { DoseParam } from "@/modules/prescricao/motor/types";
import { continueProposal, generateProposal } from "./actions";
import type { GenerationQuestion } from "./contracts";
import type { GenerationScreen } from "./service";
import { TargetSuggestionCard } from "./target-suggestions";
import { NETWORK_ERROR, useIntent } from "./use-intent";
import {
  BASIS_LABELS,
  EMPTY_FORM,
  EMPTY_PROGRESSION,
  NOT_UNIVERSAL,
  PARAM_LABELS,
  PROGRESSION_PARAMS,
  answersFromForm,
  coverageSummary,
  formFromAnswers,
  formSuggestionFor,
  openRequired,
  shortDate,
  type GenerationForm as FormState,
  type ProgressionForm,
} from "./view";

const METRIC_TEXT: Record<string, string> = { REPS: "Repetições", TIME: "Tempo", DISTANCE: "Distância", INTERVALS: "Intervalado", CONTINUOUS: "Contínuo" };
const phaseName = (p: { index: number; name: string | null }) => `Fase ${String(p.index).padStart(2, "0")}${p.name ? ` · ${p.name}` : ""}`;

/**
 * "Gerar prescrição automática" (design §6.1 `generation-form`, UI items 1 and 2). The required questions come first (stimulus of
 * each phase, equipment, counts the structure leaves open): nothing is pre-selected and the button waits for them. Then the dose
 * policy, prefilled from the rule set and editable (Q1), the weekly progression of each phase and optional adjustments. While the
 * engine runs, the indicator says how many phases are done; a long periodization is generated in parts, one request after
 * the other, until it is complete.
 */
export function GenerationForm({ planId, revisionId, screen }: { planId: string; revisionId: string; screen: GenerationScreen }) {
  const router = useRouter();
  const intent = useIntent();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<string[]>([]);
  const [serverQuestions, setServerQuestions] = useState<GenerationQuestion[]>([]);
  const [progress, setProgress] = useState<string>("");
  const [pending, startTransition] = useTransition();
  const questions = useMemo(() => [...screen.questions, ...serverQuestions.filter((q) => !screen.questions.some((s) => s.code === q.code && s.phaseIndex === q.phaseIndex && s.label === q.label))], [screen.questions, serverQuestions]);
  const open = openRequired(questions, form);
  const required = questions.filter((q) => q.required);
  const info = questions.filter((q) => !q.required);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));
  const stimulusOf = (phaseIndex: number) => form.stimulus.find((s) => s.phaseIndex === phaseIndex);
  // A suggestion accepted for one stimulus is not the rule's suggestion for another: changing the stimulus drops it (the card
  // shows the new one); the professional's own targets stay.
  const setStimulus = (phaseIndex: number, next: FormState["stimulus"][number] | null) =>
    setForm((f) => ({
      ...f,
      stimulus: [...f.stimulus.filter((s) => s.phaseIndex !== phaseIndex), ...(next ? [next] : [])],
      coverage: f.coverage.filter((c) => c.phaseIndex !== phaseIndex || c.basis !== "HEURISTIC_ACCEPTED"),
    }));
  const progressionOf = (phaseIndex: number): ProgressionForm => form.progression.find((p) => p.phaseIndex === phaseIndex) ?? EMPTY_PROGRESSION;
  const setProgression = (phaseIndex: number, patch: Partial<ProgressionForm>) =>
    set("progression", [...form.progression.filter((p) => p.phaseIndex !== phaseIndex), { ...progressionOf(phaseIndex), ...patch, phaseIndex }]);
  const equipment = form.equipment === "NONE" ? [] : form.equipment;

  function submit() {
    const built = answersFromForm(form, screen.policy);
    if (!built.ok) {
      setErrors(built.errors);
      return;
    }
    setErrors([]);
    startTransition(async () => {
      const total = screen.structure.length;
      setProgress(`Gerando a proposta (${total} ${total === 1 ? "fase" : "fases"})…`);
      try {
        const first = intent.take(`generate:${JSON.stringify(built.answers)}`);
        let result = await generateProposal(planId, revisionId, { idempotencyKey: first.key, baseContentVersion: screen.contentVersion, answers: built.answers });
        intent.done();
        if (result.data?.questions) setServerQuestions(result.data.questions);
        // A long periodization is generated in parts (technical limit per request): continue until every phase is there.
        while (!result.error && result.data?.complete === false && result.data.proposalId && result.data.version) {
          const done = result.data.progress;
          setProgress(done ? `Geradas ${done.generated} de ${done.total} fases. Gerando as próximas…` : "Gerando as próximas fases…");
          const next = intent.take(`continue:${result.data.proposalId}:${result.data.version}`);
          result = await continueProposal(planId, revisionId, {
            proposalId: result.data.proposalId,
            idempotencyKey: next.key,
            writeId: next.write,
            expectedVersion: result.data.version,
          });
          intent.done();
        }
        if (result.error) {
          setErrors([result.error]);
          setProgress("");
          if (result.data?.reason === "open_exists" || result.data?.reason === "revision_changed") router.refresh();
          return;
        }
        setProgress("Proposta pronta. Abrindo…");
        router.refresh();
      } catch {
        setErrors([NETWORK_ERROR]);
        setProgress("");
      }
    });
  }

  return (
    <form
      className="panel auto-form"
      aria-labelledby="gerar-titulo"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <p className="eyebrow">PRESCRIÇÃO AUTOMÁTICA</p>
      <h2 id="gerar-titulo">Gerar prescrição automática</h2>
      <p className="muted">
        A ferramenta propõe os exercícios e as doses de todas as sessões da periodização salva, a partir dos dados do aluno e da
        biblioteca. É uma proposta: nada entra no rascunho até você revisar e aplicar, e a aprovação continua sendo sua.
      </p>
      {screen.lastAnswers && (
        <Notice>
          <span>
            Há respostas da geração anterior em {shortDate(screen.lastAnswers.createdAt.slice(0, 10))}.{" "}
            <button
              type="button"
              className="link-button"
              onClick={() => setForm(formFromAnswers(screen.lastAnswers?.answers, screen.structure, screen.policy))}
            >
              Usar as respostas da geração anterior
            </button>
          </span>
        </Notice>
      )}

      <fieldset className="auto-section">
        <legend>Perguntas obrigatórias</legend>
        <p className="small muted">
          {open.length
            ? `${open.length} ${open.length === 1 ? "resposta falta" : "respostas faltam"} para gerar.`
            : "Tudo respondido."}
        </p>
        {screen.structure.map((phase) => {
          const chosen = stimulusOf(phase.index);
          const asked = required.some((q) => q.code === "STIMULUS" && q.phaseIndex === phase.index);
          if (!asked && !chosen) return null;
          return (
            <div key={phase.index} className="auto-question" role="group" aria-label={`Estímulo da ${phaseName(phase)}`}>
              <strong>{phaseName(phase)}: estímulo</strong>
              <span className="small muted">
                {phase.weeks} {phase.weeks === 1 ? "semana" : "semanas"} · {phase.sessionsPerWeek} {phase.sessionsPerWeek === 1 ? "sessão" : "sessões"} por semana ·
                treinos {phase.workouts.map((w) => w.label).join(", ")}
              </span>
              {screen.suggestions.length > 0 && (
                <div className="chip-row">
                  {screen.suggestions.map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      className="chip"
                      aria-pressed={chosen?.value === s.value && chosen.basis === "HEURISTIC_ACCEPTED"}
                      onClick={() => setStimulus(phase.index, { phaseIndex: phase.index, value: s.value, basis: "HEURISTIC_ACCEPTED", ruleId: s.ruleId })}
                    >
                      Sugestão da ferramenta (heurística): {s.label}
                    </button>
                  ))}
                </div>
              )}
              <label>
                Estímulo da fase {phase.index}
                <select
                  value={chosen?.basis === "PROFESSIONAL" ? chosen.value : ""}
                  onChange={(e) => setStimulus(phase.index, e.target.value ? { phaseIndex: phase.index, value: e.target.value, basis: "PROFESSIONAL" } : null)}
                >
                  <option value="">{chosen?.basis === "HEURISTIC_ACCEPTED" ? `Sugestão aceita: ${STIMULUS_LABELS[chosen.value] ?? chosen.value}` : "Escolha…"}</option>
                  {screen.stimulusOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          );
        })}

        <div className="auto-question" role="group" aria-label="Equipamentos disponíveis">
          <strong>Equipamentos disponíveis</strong>
          {(() => {
            const q = required.find((x) => x.code === "EQUIPMENT");
            return q?.context ? <span className="small muted">Na ficha (não interpretado): {q.context}</span> : null;
          })()}
          <label className="check-row">
            <input type="checkbox" checked={form.equipment === "NONE"} onChange={(e) => set("equipment", e.target.checked ? "NONE" : [])} />
            Sem equipamento (só peso do corpo)
          </label>
          <div className="check-grid">
            {Object.entries(EQUIPMENT).map(([code, label]) => (
              <label key={code} className="check-row">
                <input
                  type="checkbox"
                  disabled={form.equipment === "NONE"}
                  checked={equipment.includes(code)}
                  onChange={(e) => set("equipment", e.target.checked ? [...equipment, code] : equipment.filter((c) => c !== code))}
                />
                {label}
              </label>
            ))}
          </div>
          <div className="exercise-actions">
            <button type="button" className="button secondary small" onClick={() => set("equipment", Object.keys(EQUIPMENT))}>
              Marcar todos
            </button>
            <button type="button" className="button secondary small" onClick={() => set("equipment", [])}>
              Limpar
            </button>
          </div>
        </div>

        {required
          .filter((q) => q.code === "EXERCISE_COUNT")
          .map((q) => {
            const current = form.counts.find((c) => c.phaseIndex === q.phaseIndex && c.label === q.label)?.count ?? "";
            const put = (count: string) =>
              set("counts", [...form.counts.filter((c) => !(c.phaseIndex === q.phaseIndex && c.label === q.label)), ...(count ? [{ phaseIndex: q.phaseIndex!, label: q.label!, count }] : [])]);
            return (
              <div key={`${q.phaseIndex}-${q.label}`} className="auto-question" role="group" aria-label={`Quantidade de exercícios, fase ${q.phaseIndex}, treino ${q.label}`}>
                <strong>{q.message}</strong>
                <div className="field-grid">
                  <label>
                    Exercícios no treino
                    <input type="number" min={1} max={30} value={current === "BY_TIME" ? "" : current} disabled={current === "BY_TIME"} onChange={(e) => put(e.target.value)} />
                  </label>
                  <label className="check-row">
                    <input type="checkbox" checked={current === "BY_TIME"} onChange={(e) => put(e.target.checked ? "BY_TIME" : "")} />
                    Pelo tempo disponível
                  </label>
                </div>
              </div>
            );
          })}

        {required
          .filter((q) => q.code === "MODALITIES")
          .map((q) => {
            const current = form.modalities.find((m) => m.phaseIndex === q.phaseIndex && m.label === q.label)?.modalities ?? [];
            const put = (list: string[]) =>
              set("modalities", [...form.modalities.filter((m) => !(m.phaseIndex === q.phaseIndex && m.label === q.label)), { phaseIndex: q.phaseIndex!, label: q.label!, modalities: list }]);
            return (
              <div key={`m-${q.phaseIndex}-${q.label}`} className="auto-question" role="group" aria-label={`Modalidades, fase ${q.phaseIndex}, treino ${q.label}`}>
                <strong>{q.message}</strong>
                <div className="check-grid">
                  {Object.entries(MODALITIES).map(([code, label]) => (
                    <label key={code} className="check-row">
                      <input type="checkbox" checked={current.includes(code)} onChange={(e) => put(e.target.checked ? [...current, code] : current.filter((c) => c !== code))} />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
      </fieldset>

      <fieldset className="auto-section">
        <legend>Doses</legend>
        <p className="small">
          <Pill tone="warning">{BASIS_LABELS.HEURISTIC}</Pill> {NOT_UNIVERSAL} Cada valor proposto mostra a sua base e você revisa tudo antes de aplicar.
        </p>
        <div className="field-grid">
          <label>
            Modo das doses
            <select value={form.doseMode ?? ""} onChange={(e) => set("doseMode", (e.target.value || null) as FormState["doseMode"])}>
              <option value="">Preencher pela política abaixo (padrão da ferramenta)</option>
              <option value="FILL_FROM_POLICY">Preencher pela política abaixo (escolha minha)</option>
              <option value="LEAVE_EMPTY">Deixar todas as doses em branco</option>
            </select>
          </label>
          <label>
            Metadados da biblioteca usados na seleção
            <select value={form.metadataTrust ?? ""} onChange={(e) => set("metadataTrust", (e.target.value || null) as FormState["metadataTrust"])}>
              <option value="">Revisados e inferidos (padrão da ferramenta)</option>
              <option value="REVIEWED_AND_INFERRED">Revisados e inferidos (escolha minha)</option>
              <option value="REVIEWED_ONLY">Só revisados</option>
            </select>
          </label>
        </div>
        <details className="auto-details" open>
          <summary>Política de doses ({screen.rules.id} {screen.rules.version}) · editável</summary>
          <p className="small muted">
            Dose inicial por estímulo, modalidade e medida. “Qualquer estímulo” vale para os estímulos sem linha própria. Mudar um valor
            vale só para esta geração e fica registrado como decisão sua.
          </p>
          <div className="policy-list">
            {screen.policy.map((row) => {
              const title = `${row.stimulus === "*" ? "Qualquer estímulo" : (STIMULUS_LABELS[row.stimulus] ?? row.stimulus)} · ${MODALITIES[row.modality] ?? row.modality} · ${METRIC_TEXT[row.metric] ?? row.metric}`;
              return (
                <div key={row.key} className="policy-row" role="group" aria-label={title}>
                  <strong className="small">{title}</strong>
                  <div className="policy-values">
                    {row.defaults.map((d) => {
                      const cell = `${row.key}:${d.param}`;
                      return (
                        <label key={d.param}>
                          {PARAM_LABELS[d.param]}
                          <input
                            inputMode="decimal"
                            value={form.policy[cell] ?? String(d.value)}
                            onChange={(e) => set("policy", { ...form.policy, [cell]: e.target.value })}
                          />
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </details>
      </fieldset>

      <fieldset className="auto-section">
        <legend>Progressão semanal</legend>
        <p className="small muted">
          Opcional, por fase. Sem progressão, a dose é a mesma em todas as semanas da fase. A progressão vale para os exercícios cuja
          dose tem o parâmetro escolhido; os demais ficam como estão, com aviso.
        </p>
        {screen.structure.map((phase) => {
          const p = progressionOf(phase.index);
          const put = (patch: Partial<ProgressionForm>) => setProgression(phase.index, patch);
          return (
            <div key={phase.index} className="auto-question" role="group" aria-label={`Progressão da ${phaseName(phase)}`}>
              <strong>
                {phaseName(phase)} · {phase.weeks} {phase.weeks === 1 ? "semana" : "semanas"}
              </strong>
              <div className="field-grid">
                <label>
                  Modelo
                  <select value={p.model} onChange={(e) => put({ model: e.target.value as ProgressionForm["model"] })}>
                    <option value="NONE">Sem progressão</option>
                    <option value="LINEAR">Linear (da semana 1 à última)</option>
                    <option value="STEP">Em degraus</option>
                  </select>
                </label>
                {p.model !== "NONE" && (
                  <label>
                    Parâmetro
                    <select value={p.param} onChange={(e) => put({ param: e.target.value as DoseParam })}>
                      {PROGRESSION_PARAMS.map((param) => (
                        <option key={param} value={param}>
                          {PARAM_LABELS[param]}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {p.model === "LINEAR" && (
                  <>
                    <label>
                      Na semana 1
                      <input inputMode="decimal" value={p.from} onChange={(e) => put({ from: e.target.value })} />
                    </label>
                    <label>
                      Na semana {phase.weeks}
                      <input inputMode="decimal" value={p.to} onChange={(e) => put({ to: e.target.value })} />
                    </label>
                  </>
                )}
                {p.model === "STEP" && (
                  <>
                    <label>
                      Muda em
                      <input inputMode="decimal" value={p.delta} onChange={(e) => put({ delta: e.target.value })} placeholder="Ex.: 1 ou -1" />
                    </label>
                    <label>
                      A cada (semanas)
                      <input inputMode="numeric" value={p.everyWeeks} onChange={(e) => put({ everyWeeks: e.target.value })} />
                    </label>
                    <label>
                      Sem passar de (opcional)
                      <input inputMode="decimal" value={p.limit} onChange={(e) => put({ limit: e.target.value })} />
                    </label>
                  </>
                )}
                <label>
                  Semanas de descarga (opcional)
                  <input value={p.deloadWeeks} onChange={(e) => put({ deloadWeeks: e.target.value })} placeholder={`Ex.: ${phase.weeks}`} />
                </label>
                {p.deloadWeeks.trim() && (
                  <label>
                    Fração das séries na descarga
                    <input inputMode="decimal" value={p.deloadMultiplier} onChange={(e) => put({ deloadMultiplier: e.target.value })} placeholder="Ex.: 0,5" />
                  </label>
                )}
              </div>
            </div>
          );
        })}
      </fieldset>

      {screen.targetSuggestions.length > 0 && (
        <details className="auto-details" open={form.coverage.length > 0 || form.coverageByWorkout.length > 0}>
          <summary>Alvos por fase (opcional)</summary>
          <div className="auto-section">
            <p className="small muted">
              Sem alvos, a ferramenta segue a elegibilidade e espalha os padrões pela semana; nada vira alvo sem o seu aceite. Os
              objetivos em texto livre nunca viram restrição.
            </p>
            {screen.targetSuggestions.map((phase) => {
              const structure = screen.structure.find((p) => p.index === phase.phaseIndex);
              if (!structure) return null;
              const current = form.coverage.find((c) => c.phaseIndex === phase.phaseIndex);
              const byWorkout = form.coverageByWorkout.filter((c) => c.phaseIndex === phase.phaseIndex);
              const clear = () =>
                setForm((f) => ({
                  ...f,
                  coverage: f.coverage.filter((c) => c.phaseIndex !== phase.phaseIndex),
                  coverageByWorkout: f.coverageByWorkout.filter((c) => c.phaseIndex !== phase.phaseIndex),
                }));
              if (current || byWorkout.length)
                return (
                  <div key={phase.phaseIndex} className="auto-question" role="group" aria-label={`Alvos da ${phaseName(structure)}`}>
                    <strong>{phaseName(structure)}: alvos</strong>
                    <span className="small">
                      {current && (
                        <>
                          <Pill tone="brand">{BASIS_LABELS[current.basis]}</Pill>{" "}
                        </>
                      )}
                      {coverageSummary(current ?? { phaseIndex: phase.phaseIndex, basis: "PROFESSIONAL" }, byWorkout)}
                    </span>
                    <div className="exercise-actions">
                      <button type="button" className="button secondary small" onClick={clear}>
                        Remover os alvos da fase {phase.phaseIndex}
                      </button>
                    </div>
                  </div>
                );
              const out = formSuggestionFor(phase, form);
              return (
                <TargetSuggestionCard
                  key={phase.phaseIndex}
                  phaseIndex={phase.phaseIndex}
                  suggestion={out.suggestion}
                  reason={out.reason}
                  labels={structure.workouts.map((w) => w.label)}
                  pending={pending}
                  acceptText="Aceitar estes alvos"
                  commitText="Nada é aplicado sem o seu aceite. Ao aceitar, os alvos entram nesta geração e você pode removê-los antes de gerar."
                  onAccept={(entry) => setForm((f) => ({ ...f, coverage: [...f.coverage.filter((c) => c.phaseIndex !== entry.phaseIndex), entry] }))}
                  onApply={(coverage, list) =>
                    setForm((f) => ({
                      ...f,
                      coverage: [...f.coverage.filter((c) => c.phaseIndex !== phase.phaseIndex), ...(coverage ? [coverage] : [])],
                      coverageByWorkout: [...f.coverageByWorkout.filter((c) => c.phaseIndex !== phase.phaseIndex), ...list],
                    }))
                  }
                />
              );
            })}
          </div>
        </details>
      )}

      <details className="auto-details">
        <summary>Ajustes opcionais</summary>
        <div className="auto-section">
          <div className="field-grid">
            <label>
              Tempo por sessão (min)
              <input inputMode="numeric" value={form.availableMinutes} onChange={(e) => set("availableMinutes", e.target.value)} placeholder="Da ficha ou dos treinos" />
            </label>
            <label>
              Tempo disponível
              <select value={form.timeBudget} onChange={(e) => set("timeBudget", e.target.value as FormState["timeBudget"])}>
                <option value="">Como referência, sem cortar (padrão)</option>
                <option value="SOFT">Como referência, sem cortar (escolha minha)</option>
                <option value="HARD">Como limite: não passar do tempo</option>
              </select>
            </label>
          </div>
          <ExercisePicker
            label="Exercícios a evitar"
            library={screen.library}
            chosen={form.excludedExerciseIds}
            onChange={(list) => set("excludedExerciseIds", list)}
          />
          <ExercisePicker
            label="Exercícios preferidos"
            library={screen.library}
            chosen={form.preferredExerciseIds}
            onChange={(list) => set("preferredExerciseIds", list)}
          />
          <fieldset className="auto-subsection">
            <legend>Padrões de movimento a evitar</legend>
            <div className="check-grid">
              {Object.entries(PATTERNS).map(([code, label]) => (
                <label key={code} className="check-row">
                  <input
                    type="checkbox"
                    checked={form.excludedPatterns.includes(code)}
                    onChange={(e) => set("excludedPatterns", e.target.checked ? [...form.excludedPatterns, code] : form.excludedPatterns.filter((c) => c !== code))}
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="auto-subsection">
            <legend>Marcadores de cuidado a evitar</legend>
            <p className="small muted">Valem só para exercícios com marcadores revisados por uma pessoa; os demais não são alcançados.</p>
            <div className="check-grid">
              {Object.entries(CAUTION_TAGS).map(([code, label]) => (
                <label key={code} className="check-row">
                  <input
                    type="checkbox"
                    checked={form.excludedCautionTags.includes(code)}
                    onChange={(e) => set("excludedCautionTags", e.target.checked ? [...form.excludedCautionTags, code] : form.excludedCautionTags.filter((c) => c !== code))}
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </details>

      {info.length > 0 && (
        <div className="auto-section">
          <h3 className="small-heading">O que falta nos registros (não impede a geração)</h3>
          <ul className="auto-list">
            {info.map((q) => (
              <li key={`${q.code}-${q.phaseIndex ?? ""}-${q.label ?? ""}`} className="small">
                {q.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {errors.length > 0 && (
        <div className="error-message" role="alert">
          {errors.map((e) => (
            <p key={e}>{e}</p>
          ))}
        </div>
      )}
      <div className="auto-submit">
        <button className="button primary" disabled={pending || open.length > 0}>
          <Sparkles size={17} aria-hidden="true" /> {pending ? "Gerando…" : "Gerar prescrição automática"}
        </button>
        {open.length > 0 && !pending && (
          <span className="small muted">Falta responder: {open.map((q) => (q.code === "STIMULUS" ? `estímulo da fase ${q.phaseIndex}` : q.code === "EQUIPMENT" ? "equipamentos" : `treino ${q.label} da fase ${q.phaseIndex}`)).join(", ")}.</span>
        )}
      </div>
      <div className="auto-progress" role="status" aria-live="polite">
        {pending && progress && (
          <>
            <span className="spinner" aria-hidden="true" /> {progress}
          </>
        )}
      </div>
    </form>
  );
}

function ExercisePicker({
  label,
  library,
  chosen,
  onChange,
}: {
  label: string;
  library: GenerationScreen["library"];
  chosen: string[];
  onChange: (list: string[]) => void;
}) {
  const [pick, setPick] = useState("");
  const names = new Map(library.map((e) => [e.id, e.name]));
  return (
    <div className="auto-subsection" role="group" aria-label={label}>
      <div className="picker-row">
        <label>
          {label}
          <select value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Escolha da biblioteca…</option>
            {library
              .filter((e) => !chosen.includes(e.id))
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                  {e.metadata === "INFERRED" ? " (metadados inferidos)" : e.metadata === "PENDING" ? " (pendente de curadoria)" : ""}
                </option>
              ))}
          </select>
        </label>
        <button
          type="button"
          className="button secondary small"
          disabled={!pick}
          onClick={() => {
            onChange([...chosen, pick]);
            setPick("");
          }}
        >
          Incluir
        </button>
      </div>
      {chosen.length > 0 && (
        <ul className="chip-row" aria-label={`${label} escolhidos`}>
          {chosen.map((id) => (
            <li key={id}>
              <button type="button" className="chip" aria-label={`Tirar ${names.get(id) ?? id}`} onClick={() => onChange(chosen.filter((c) => c !== id))}>
                {names.get(id) ?? id} ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
