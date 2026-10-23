"use client";

import { useId, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { Notice, Pill } from "@/components/ui";
import {
  demoMesocycles,
  planStatusLabel,
  planStatusTone,
  type DemoStudent,
} from "./fixtures";

/**
 * Illustration of the planned prescription screen (handoff V2, section 6.1):
 * one tab per mesocycle, editable exercises with the origin of each field, and
 * approval blocked while the screening asks for professional review.
 * Fictional data. Nothing is saved.
 */
export function PrescriptionPreview({ student }: { student: DemoStudent }) {
  const [selected, setSelected] = useState(0);
  const [message, setMessage] = useState("");
  const id = useId();
  if (student.plan === "NONE") {
    return (
      <div className="empty-inline">
        <h3>Ainda não há plano para {student.displayName}.</h3>
        <p>
          Na ferramenta completa, o plano nasce da avaliação e da periodização.
          Este módulo ainda não existe.
        </p>
      </div>
    );
  }
  const blocked = student.screening === "REVIEW_REQUIRED";
  const delivered = student.plan === "DELIVERED";
  const meso = demoMesocycles[selected];
  return (
    <div className="prescription">
      <div className="prescription-status">
        <Pill tone={planStatusTone[student.plan]}>
          Plano: {planStatusLabel[student.plan]}
        </Pill>
        <Pill tone={blocked ? "warning" : "success"}>
          {blocked ? "Triagem: revisão necessária" : "Triagem: sem sinais marcados"}
        </Pill>
        <Pill>Divisão ABC · 3 sessões por semana</Pill>
      </div>
      {blocked && (
        <Notice tone="warning">
          <p>
            <strong>Revisão profissional necessária.</strong> A triagem tem um
            sinal marcado. O rascunho existe, mas aprovar e entregar ficam
            bloqueados até você registrar a sua revisão. A ferramenta nunca
            libera um aluno clinicamente.
          </p>
        </Notice>
      )}
      {delivered && (
        <Notice>
          <p>
            Esta revisão foi entregue e é imutável. Para mudar algo, crie uma
            nova revisão: a execução já registrada continua ligada a esta.
          </p>
        </Notice>
      )}
      <div role="tablist" aria-label="Mesociclos" className="tabs">
        {demoMesocycles.map((item, index) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`${id}-tab-${index}`}
            aria-selected={selected === index}
            aria-controls={`${id}-panel`}
            tabIndex={selected === index ? 0 : -1}
            className={selected === index ? "tab selected" : "tab"}
            onClick={() => setSelected(index)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight")
                setSelected((selected + 1) % demoMesocycles.length);
              if (event.key === "ArrowLeft")
                setSelected(
                  (selected - 1 + demoMesocycles.length) %
                    demoMesocycles.length,
                );
            }}
          >
            {item.name} · {item.focus}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-tab-${selected}`}
      >
        <p className="small muted preset-line">
          Preset do foco {meso.focus} (documento mestre, editável): {" "}
          {meso.preset.sets} séries · {meso.preset.reps} repetições · descanso{" "}
          {meso.preset.rest} · cadência {meso.preset.cadence} · RIR{" "}
          {meso.preset.rir}. Carga: a definir por você.
        </p>
        <div className="workout-grid">
          {meso.workouts.map((workout) => (
            <section className="workout" key={workout.letter}>
              <header>
                <span className="workout-letter">{workout.letter}</span>
                <div>
                  <h3>{workout.title}</h3>
                  <p className="small muted">
                    Alvo: {workout.exercises.length} exercícios
                  </p>
                </div>
              </header>
              <ol>
                {workout.exercises.map((exercise) => (
                  <li key={exercise.name}>
                    <span>{exercise.name}</span>
                    {exercise.origin === "PROFESSIONAL" ? (
                      <Pill tone="brand">Editado por você</Pill>
                    ) : (
                      <Pill>Sugerido pelas regras</Pill>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
        <p className="small muted">
          Uma edição sua é preservada quando o treino é gerado de novo. Cada
          mesociclo é independente: mudar este não altera o outro.
        </p>
      </div>
      <div className="invite-actions">
        {delivered ? null : (
          <button
            type="button"
            className="button primary small"
            disabled={blocked}
            aria-describedby={blocked ? `${id}-why` : undefined}
            onClick={() =>
              setMessage(
                "Demonstração: nada é salvo. Na ferramenta, aprovar é um ato seu e fica registrado.",
              )
            }
          >
            Aprovar plano
          </button>
        )}
        <button type="button" className="button secondary small" disabled>
          Gerar PDF · em breve
        </button>
      </div>
      {blocked && (
        <p id={`${id}-why`} className="small muted">
          <ShieldAlert size={14} /> Aprovação bloqueada até o registro da
          revisão profissional.
        </p>
      )}
      {message && (
        <p role="status" className="small muted">
          {message}
        </p>
      )}
    </div>
  );
}
