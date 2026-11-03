"use client";
import { useId } from "react";
import { TriangleAlert } from "lucide-react";
import {
  ACTIVITY_CURRENT,
  ACTIVITY_PAST,
  ANAMNESIS,
  ANAMNESIS_ANSWERS,
  FREQUENCY_UNITS,
  GOALS,
  GOALS_NOTES_LABEL,
  PARQ,
  PARQ_ANSWERS,
  PARQ_DECISIONS,
} from "../catalog";
import { TextAreaField, TextField, UnitField, YesNoField } from "./fields";
import {
  ANAMNESIS_ANSWER_CODES,
  ANAMNESIS_CODES,
  GOAL_CODES,
  PARQ_ANSWER_CODES,
  PARQ_CODES,
  PARQ_DECISION_CODES,
  decisionShown,
  type TriagemForm,
} from "./screening";

/**
 * One question answered with chips (a radio group named by the question): the question on the left and the answers in a column of the same
 * width on every line, as in the Figma frame AV-02, so the answers of all questions line up; on a narrow card the answers go under the question.
 * The description shows when the answer is "Sim", and stays while it holds text, so nothing typed is hidden.
 */
function Question<A extends string>({
  name,
  question,
  answers,
  labels,
  value,
  onChange,
  children,
}: {
  name: string;
  question: string;
  answers: readonly A[];
  labels: Record<A, string>;
  value: A | null;
  onChange: (value: A) => void;
  children?: React.ReactNode;
}) {
  const id = useId();
  return (
    <li className="av2-question" data-answer={value ?? undefined}>
      <span id={id} className="av2-question-text">
        {question}
      </span>
      <div className="av2-answers" role="radiogroup" aria-labelledby={id}>
        {answers.map((answer) => (
          <label key={answer} className="av2-chip" data-tone={answer === "yes" ? "attention" : undefined}>
            <input type="radio" name={name} checked={value === answer} onChange={() => onChange(answer)} />
            <span>{labels[answer]}</span>
          </label>
        ))}
      </div>
      {children}
    </li>
  );
}

/**
 * The "Triagem" step (handoff 3.1, Figma AV-02): the goals of the training, the clinical anamnesis, current and past physical activity, and the
 * PAR-Q of the document; any "Sim" in the PAR-Q shows the attention band and asks for the professional's decision with a note. Nothing here
 * decides fitness: the decision is the professional's, and who recorded it and when are kept when the assessment is finalized.
 */
export function TriagemStep({ form, onChange }: { form: TriagemForm; onChange: (form: TriagemForm) => void }) {
  const set = (patch: Partial<TriagemForm>) => onChange({ ...form, ...patch });
  const setCurrent = (patch: Partial<TriagemForm["current"]>) => set({ current: { ...form.current, ...patch } });
  const setPast = (patch: Partial<TriagemForm["past"]>) => set({ past: { ...form.past, ...patch } });
  const unanswered = PARQ_CODES.filter((code) => form.parq[code] === "unanswered").length;
  const withYes = PARQ_CODES.some((code) => form.parq[code] === "yes");

  return (
    <div className="av2-cards">
      <section className="panel av2-card" aria-labelledby="av2-objetivos">
        <h3 id="av2-objetivos">Objetivos do treinamento</h3>
        <p className="muted small">Seleção múltipla para orientar o programa.</p>
        <div className="av2-chips av2-goals" role="group" aria-labelledby="av2-objetivos">
          {GOAL_CODES.map((code) => (
            <label key={code} className="av2-chip">
              <input
                type="checkbox"
                checked={form.goals.includes(code)}
                onChange={(event) => set({ goals: event.target.checked ? [...form.goals, code] : form.goals.filter((goal) => goal !== code) })}
              />
              <span>{GOALS[code]}</span>
            </label>
          ))}
        </div>
        <div className="av2-grid">
          <TextAreaField label={GOALS_NOTES_LABEL} value={form.goalNotes} onChange={(goalNotes) => set({ goalNotes })} />
        </div>
      </section>

      <section className="panel av2-card" aria-labelledby="av2-anamnese">
        <h3 id="av2-anamnese">Anamnese clínica</h3>
        <p className="muted small">Perguntas estruturadas, com descrição quando a resposta for Sim.</p>
        <ul className="av2-questions">
          {ANAMNESIS_CODES.map((code) => {
            const entry = form.anamnesis[code];
            const setEntry = (patch: Partial<typeof entry>) => set({ anamnesis: { ...form.anamnesis, [code]: { ...entry, ...patch } } });
            return (
              <Question
                key={code}
                name={`av2-anamnese-${code}`}
                question={ANAMNESIS[code]}
                answers={ANAMNESIS_ANSWER_CODES}
                labels={ANAMNESIS_ANSWERS}
                value={entry.answer}
                onChange={(answer) => setEntry({ answer })}
              >
                {(entry.answer === "yes" || entry.details !== "") && (
                  <div className="av2-grid av2-question-details">
                    <TextAreaField label="Descrição" context={`de “${ANAMNESIS[code]}”`} value={entry.details} onChange={(details) => setEntry({ details })} />
                  </div>
                )}
              </Question>
            );
          })}
        </ul>
      </section>

      <section className="panel av2-card" aria-labelledby="av2-atividade-atual">
        <h3 id="av2-atividade-atual">Atividade física atual</h3>
        <p className="muted small">Frequência em vezes por semana; campo vazio é “não informado”, nunca zero.</p>
        <div className="av2-grid">
          <YesNoField label={ACTIVITY_CURRENT.practices} value={form.current.practices} onChange={(practices) => setCurrent({ practices })} />
          <TextField label={ACTIVITY_CURRENT.activities} value={form.current.activities} onChange={(activities) => setCurrent({ activities })} />
          <UnitField label={ACTIVITY_CURRENT.frequency} unit={FREQUENCY_UNITS.por_semana} value={form.current.frequency} onChange={(frequency) => setCurrent({ frequency })} />
          <TextField label={ACTIVITY_CURRENT.duration} value={form.current.duration} onChange={(duration) => setCurrent({ duration })} />
          <TextAreaField label={ACTIVITY_CURRENT.notes} context="da atividade atual" value={form.current.notes} onChange={(notes) => setCurrent({ notes })} />
        </div>
      </section>

      <section className="panel av2-card" aria-labelledby="av2-atividade-passada">
        <h3 id="av2-atividade-passada">Atividade física passada</h3>
        <p className="muted small">O que a pessoa praticou antes, se praticou.</p>
        <div className="av2-grid">
          <YesNoField label={ACTIVITY_PAST.practiced} value={form.past.practiced} onChange={(practiced) => setPast({ practiced })} />
          <TextField label={ACTIVITY_PAST.activities} value={form.past.activities} onChange={(activities) => setPast({ activities })} />
          <TextField label={ACTIVITY_PAST.totalTime} value={form.past.totalTime} onChange={(totalTime) => setPast({ totalTime })} />
          <UnitField label={ACTIVITY_PAST.frequency} unit={FREQUENCY_UNITS.por_semana} value={form.past.frequency} onChange={(frequency) => setPast({ frequency })} />
          <TextAreaField label={ACTIVITY_PAST.notes} context="da atividade passada" value={form.past.notes} onChange={(notes) => setPast({ notes })} />
        </div>
      </section>

      <section className="panel av2-card" aria-labelledby="av2-parq">
        <h3 id="av2-parq">PAR-Q • {PARQ_CODES.length} perguntas</h3>
        <p className="muted small">Respostas positivas exigem revisão humana documentada. Uma pergunta sem resposta fica pendente, nunca vira “Não”.</p>
        <ul className="av2-questions">
          {PARQ_CODES.map((code) => (
            <Question
              key={code}
              name={`av2-parq-${code}`}
              question={PARQ[code]}
              answers={PARQ_ANSWER_CODES}
              labels={PARQ_ANSWERS}
              value={form.parq[code]}
              onChange={(answer) => set({ parq: { ...form.parq, [code]: answer } })}
            />
          ))}
        </ul>
        <p className="av2-preview-status" aria-live="polite">
          {unanswered === 0
            ? "Todas as perguntas do PAR-Q respondidas."
            : `${unanswered} de ${PARQ_CODES.length} ${unanswered === 1 ? "pergunta sem resposta" : "perguntas sem resposta"}: cada uma precisa de Sim ou Não para finalizar.`}
        </p>
      </section>

      {decisionShown(form) && (
        <section className="panel av2-card" aria-labelledby="av2-decisao">
          {withYes && (
            <p className="av2-attention">
              <TriangleAlert size={18} aria-hidden="true" /> Atenção: pelo menos uma resposta positiva. Registrar decisão profissional antes de
              finalizar.
            </p>
          )}
          <h3 id="av2-decisao">Decisão profissional</h3>
          <p className="muted small">
            A decisão é sua: o sistema não declara aptidão nem inaptidão. Quem registrou e quando ficam gravados ao finalizar a avaliação.
          </p>
          <div className="av2-chips av2-decisions" role="radiogroup" aria-labelledby="av2-decisao">
            {PARQ_DECISION_CODES.map((decision) => (
              <label key={decision} className="av2-chip">
                <input type="radio" name="av2-decisao" checked={form.decision === decision} onChange={() => set({ decision })} />
                <span>{PARQ_DECISIONS[decision]}</span>
              </label>
            ))}
          </div>
          <div className="av2-grid">
            <TextAreaField
              label="Nota da decisão"
              value={form.decisionNotes}
              onChange={(decisionNotes) => set({ decisionNotes })}
              note="Obrigatória para finalizar: orientação, encaminhamento ou o motivo da decisão."
              rows={3}
            />
          </div>
        </section>
      )}
    </div>
  );
}
