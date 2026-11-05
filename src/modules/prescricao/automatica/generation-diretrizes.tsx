"use client";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { EQUIPMENT, MODALITIES } from "@/modules/biblioteca/metadata/vocabulary";
import { STIMULUS_LABELS } from "@/modules/prescricao/motor/vocabulary";
import type { GenerationQuestion } from "./contracts";
import {
  EQUIPMENT_COLLAPSED,
  EQUIPMENT_FIELD_ID,
  countFieldId,
  equipmentCodes,
  equipmentSelection,
  equipmentStatus,
  equipmentSummary,
  modalityFieldId,
  numberWord,
  phaseLabel,
  phaseSpans,
  stimulusFieldId,
  toggleEquipment,
  weeksText,
  workoutsShort,
  workoutsText,
  type FieldErrors,
} from "./generation-view";
import type { GenerationScreen } from "./service";
import type { GenerationForm as FormState } from "./view";

export interface DiretrizesProps {
  screen: GenerationScreen;
  form: FormState;
  setForm: Dispatch<SetStateAction<FormState>>;
  questions: GenerationQuestion[];
  phone: boolean;
  expanded: boolean;
  setExpanded: Dispatch<SetStateAction<boolean>>;
  fieldErrors: FieldErrors;
  clearError: (id: string) => void;
  onOpenEquipment: (trigger: HTMLElement) => void;
  onSeePolicies: () => void;
  /** The "Dados do aluno" card (drawn by the page's context component). */
  student: ReactNode;
}

/**
 * Step 1, "Diretrizes" (Figma GEN-01 on the desktop, GEN-04 and GEN-05 on the phone): one card per phase with its weeks, workouts and
 * the stimulus select, the equipment as a compact list ("Sem equipamento" excludes the rest), and the questions the structure leaves
 * open for a workout. The equipment list is one piece of markup: on the desktop it sits in its card (collapsed to five rows until
 * "Ver lista completa"), on the phone it is the screen "Equipamentos" that the summary card opens.
 */
export function Diretrizes({ screen, form, setForm, questions, phone, expanded, setExpanded, fieldErrors, clearError, onOpenEquipment, onSeePolicies, student }: DiretrizesProps) {
  const required = questions.filter((q) => q.required);
  const spans = phaseSpans(screen.structure);
  const stimulusOf = (phaseIndex: number) => form.stimulus.find((s) => s.phaseIndex === phaseIndex);
  // A suggestion accepted for one stimulus is not the rule's suggestion for another: changing the stimulus drops it (the card
  // shows the new one); the professional's own targets stay.
  const setStimulus = (phaseIndex: number, next: FormState["stimulus"][number] | null) =>
    setForm((f) => ({
      ...f,
      stimulus: [...f.stimulus.filter((s) => s.phaseIndex !== phaseIndex), ...(next ? [next] : [])],
      coverage: f.coverage.filter((c) => c.phaseIndex !== phaseIndex || c.basis !== "HEURISTIC_ACCEPTED"),
    }));
  const asked = screen.structure.filter((phase) => required.some((q) => q.code === "STIMULUS" && q.phaseIndex === phase.index) || stimulusOf(phase.index));
  const { none, codes } = equipmentSelection(form.equipment);
  const equipmentQuestion = required.find((q) => q.code === "EQUIPMENT");
  const all = equipmentCodes();
  const hiddenSelected = codes.filter((c) => all.indexOf(c) >= EQUIPMENT_COLLAPSED - 1);
  const workoutQuestions = required.filter((q) => q.code === "EXERCISE_COUNT" || q.code === "MODALITIES");

  return (
    <div className="fig-gen-cols">
      <div className="fig-gen-main">
        {asked.length > 0 && (
          <section className="fig-gen-card fig-gen-phases" aria-labelledby="fig-gen-phases-title">
            <h2 id="fig-gen-phases-title" className="fig-gen-card-title fig-gen-d">
              01 / Estímulos do ciclo
            </h2>
            <h2 className="fig-gen-card-title fig-gen-m">Estímulo de cada fase</h2>
            <p className="fig-gen-sub fig-gen-d">
              {asked.length > 1 ? `Selecione um estímulo por fase. São ${numberWord(asked.length)} escolhas independentes.` : "Selecione o estímulo da fase."}
            </p>
            <p className="fig-gen-sub fig-gen-m">{asked.length > 1 ? `${numberWord(asked.length)[0].toUpperCase()}${numberWord(asked.length).slice(1)} escolhas independentes` : "Uma escolha"}</p>
            <div className="fig-gen-phase-grid">
              {asked.map((phase) => {
                const chosen = stimulusOf(phase.index);
                const span = spans.find((s) => s.index === phase.index)!;
                const labels = phase.workouts.map((w) => w.label);
                const sessions = `${phase.sessionsPerWeek} ${phase.sessionsPerWeek === 1 ? "sessão" : "sessões"}`;
                const empty = phone ? "Selecionar estímulo" : "Selecionar...";
                return (
                  <div key={phase.index} className="fig-gen-phase" role="group" aria-label={`Estímulo da ${phaseLabel(phase)}`}>
                    <span className="fig-gen-phase-pill fig-gen-d">{phaseLabel(phase)}</span>
                    <strong className="fig-gen-phase-name fig-gen-m">{phaseLabel(phase)}</strong>
                    <p className="fig-gen-phase-weeks fig-gen-d">{weeksText(span)}</p>
                    <p className="fig-gen-phase-meta fig-gen-d">
                      Treinos {workoutsText(labels)} • {sessions}/semana
                    </p>
                    <p className="fig-gen-phase-meta fig-gen-m">
                      {weeksText(span)} · {workoutsShort(labels)} · {phase.sessionsPerWeek} sess./sem
                    </p>
                    <span className="fig-gen-field-label fig-gen-d" aria-hidden="true">
                      Estímulo principal
                    </span>
                    <div className="fig-gen-select">
                      <select
                        id={stimulusFieldId(phase.index)}
                        aria-label={`Estímulo principal da fase ${phase.index}`}
                        value={chosen?.basis === "PROFESSIONAL" ? chosen.value : ""}
                        onChange={(e) => setStimulus(phase.index, e.target.value ? { phaseIndex: phase.index, value: e.target.value, basis: "PROFESSIONAL" } : null)}
                      >
                        <option value="">{chosen?.basis === "HEURISTIC_ACCEPTED" ? `Sugestão aceita: ${STIMULUS_LABELS[chosen.value] ?? chosen.value}` : empty}</option>
                        {screen.stimulusOptions.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    {screen.suggestions.length > 0 && (
                      <div className="fig-gen-chips">
                        {screen.suggestions.map((s) => (
                          <button
                            key={s.value}
                            type="button"
                            className="fig-gen-chip"
                            aria-pressed={chosen?.value === s.value && chosen.basis === "HEURISTIC_ACCEPTED"}
                            onClick={() => setStimulus(phase.index, { phaseIndex: phase.index, value: s.value, basis: "HEURISTIC_ACCEPTED", ruleId: s.ruleId })}
                          >
                            Sugestão da ferramenta (heurística): {s.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="fig-gen-orient fig-gen-d">
              <p className="fig-gen-orient-title">O que esta etapa realmente exige?</p>
              <p>
                Escolha {asked.length > 1 ? `os ${numberWord(asked.length)} estímulos` : "o estímulo"} e informe os equipamentos disponíveis. Objetivo, nível, tempo de sessão e demais campos ausentes continuam
                visíveis como dados não informados — sem pressupor respostas.
              </p>
            </div>
            <div className="fig-gen-early fig-gen-d">
              <p className="fig-gen-early-title">Políticas de dose e progressão</p>
              <p className="fig-gen-muted">Há valores padrão editáveis na próxima etapa. Não é necessário ajustar todas as modalidades para gerar.</p>
              <button type="button" className="fig-gen-btn small" onClick={onSeePolicies}>
                Ver configurações
              </button>
            </div>
          </section>
        )}

        {workoutQuestions.length > 0 && (
          <section className="fig-gen-card fig-gen-questions" aria-labelledby="fig-gen-questions-title">
            <h2 id="fig-gen-questions-title" className="fig-gen-card-title">
              Perguntas dos treinos
            </h2>
            <p className="fig-gen-sub">A periodização não diz quantos exercícios tem cada treino sem alvo, nem a modalidade de alguns estímulos.</p>
            {workoutQuestions.map((q) => {
              if (q.code === "EXERCISE_COUNT") {
                const id = countFieldId(q.phaseIndex!, q.label!);
                const current = form.counts.find((c) => c.phaseIndex === q.phaseIndex && c.label === q.label)?.count ?? "";
                const put = (count: string) => {
                  clearError(id);
                  setForm((f) => ({ ...f, counts: [...f.counts.filter((c) => !(c.phaseIndex === q.phaseIndex && c.label === q.label)), ...(count ? [{ phaseIndex: q.phaseIndex!, label: q.label!, count }] : [])] }));
                };
                return (
                  <div key={`c-${q.phaseIndex}-${q.label}`} className="fig-gen-question" role="group" aria-label={`Quantidade de exercícios, fase ${q.phaseIndex}, treino ${q.label}`}>
                    <strong>{q.message}</strong>
                    <div className="fig-gen-field-row">
                      <div className="fig-gen-field">
                        <label htmlFor={id} className="fig-gen-field-label">
                          Exercícios no treino
                        </label>
                        <input
                          id={id}
                          type="number"
                          min={1}
                          max={30}
                          inputMode="numeric"
                          value={current === "BY_TIME" ? "" : current}
                          disabled={current === "BY_TIME"}
                          aria-invalid={fieldErrors[id] ? true : undefined}
                          aria-describedby={fieldErrors[id] ? `${id}-erro` : undefined}
                          onChange={(e) => put(e.target.value)}
                        />
                        {fieldErrors[id] && (
                          <p id={`${id}-erro`} className="fig-gen-error" role="alert">
                            {fieldErrors[id]}
                          </p>
                        )}
                      </div>
                      <label className="fig-gen-check">
                        <input type="checkbox" checked={current === "BY_TIME"} onChange={(e) => put(e.target.checked ? "BY_TIME" : "")} />
                        Pelo tempo disponível
                      </label>
                    </div>
                  </div>
                );
              }
              const current = form.modalities.find((m) => m.phaseIndex === q.phaseIndex && m.label === q.label)?.modalities ?? [];
              const put = (list: string[]) =>
                setForm((f) => ({ ...f, modalities: [...f.modalities.filter((m) => !(m.phaseIndex === q.phaseIndex && m.label === q.label)), { phaseIndex: q.phaseIndex!, label: q.label!, modalities: list }] }));
              return (
                <div key={`m-${q.phaseIndex}-${q.label}`} className="fig-gen-question" role="group" aria-label={`Modalidades, fase ${q.phaseIndex}, treino ${q.label}`}>
                  <strong>{q.message}</strong>
                  <div className="fig-gen-checks">
                    {Object.entries(MODALITIES).map(([code, label], i) => (
                      <label key={code} className="fig-gen-check">
                        <input
                          id={i === 0 ? modalityFieldId(q.phaseIndex!, q.label!) : undefined}
                          type="checkbox"
                          checked={current.includes(code)}
                          onChange={(e) => put(e.target.checked ? [...current, code] : current.filter((c) => c !== code))}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </section>
        )}
      </div>

      <div className="fig-gen-aside">
        <section className="fig-gen-card fig-gen-eqsum fig-gen-m" aria-label="Resumo dos equipamentos">
          <strong>Equipamentos</strong>
          <p className="fig-gen-muted">{equipmentSummary(form.equipment)}</p>
          <button type="button" className="fig-gen-btn small" onClick={(e) => onOpenEquipment(e.currentTarget)}>
            Selecionar opções ›
          </button>
        </section>

        <section className="fig-gen-card fig-gen-eq" role="group" aria-labelledby="fig-gen-eq-title" data-expanded={expanded}>
          <h2 id="fig-gen-eq-title" className="fig-gen-card-title fig-gen-d">
            02 / Equipamentos
          </h2>
          <p className="fig-gen-hint fig-gen-d">Escolha pelo menos uma opção ou ‘Sem equipamento’.</p>
          {equipmentQuestion?.context && <p className="fig-gen-hint">Na ficha (não interpretado): {equipmentQuestion.context}</p>}
          <div className="fig-gen-eq-status fig-gen-m" role="status">
            <strong>{equipmentStatus(form.equipment)}</strong>
            <span>‘Sem equipamento’ exclui as demais opções.</span>
          </div>
          <div className="fig-gen-eq-grid">
            <label className="fig-gen-tile">
              <input id={EQUIPMENT_FIELD_ID} type="checkbox" checked={none} onChange={(e) => setForm((f) => ({ ...f, equipment: toggleEquipment(f.equipment, "NONE", e.target.checked) }))} />
              <span>Sem equipamento</span>
            </label>
            {Object.entries(EQUIPMENT).map(([code, label], i) => (
              <label key={code} className="fig-gen-tile" data-extra={i >= EQUIPMENT_COLLAPSED - 1 ? "true" : undefined}>
                <input type="checkbox" checked={codes.includes(code)} onChange={(e) => setForm((f) => ({ ...f, equipment: toggleEquipment(f.equipment, code, e.target.checked) }))} />
                <span>{label}</span>
              </label>
            ))}
          </div>
          {!expanded && hiddenSelected.length > 0 && <p className="fig-gen-hint fig-gen-d">Também selecionado na lista completa: {hiddenSelected.map((c) => EQUIPMENT[c]).join(", ")}.</p>}
          <div className="fig-gen-tools">
            <button type="button" className="fig-gen-link" onClick={() => setForm((f) => ({ ...f, equipment: Object.keys(EQUIPMENT) }))}>
              Marcar todos
            </button>
            <button type="button" className="fig-gen-link" onClick={() => setForm((f) => ({ ...f, equipment: [] }))}>
              Limpar
            </button>
          </div>
          <button type="button" className="fig-gen-btn wide fig-gen-d" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
            {expanded ? "Mostrar menos equipamentos" : "Ver lista completa de equipamentos"}
          </button>
        </section>

        <div className="fig-gen-student-slot">{student}</div>
      </div>
    </div>
  );
}
