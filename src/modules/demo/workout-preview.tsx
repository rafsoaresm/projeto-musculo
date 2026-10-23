"use client";

import { useState } from "react";
import { Notice } from "@/components/ui";
import { demoMesocycles } from "./fixtures";

const meso = demoMesocycles[0];
const workout = meso.workouts[0];
const sets = Number(meso.preset.sets);

/**
 * Illustration of the planned client workout screen. The client records what
 * was done; the prescription itself is never edited from here. Everything lives
 * in this component's state: nothing is saved or sent.
 */
export function WorkoutPreview() {
  const [done, setDone] = useState<Record<string, boolean>>({});
  const total = workout.exercises.length * sets;
  const completed = Object.values(done).filter(Boolean).length;
  return (
    <>
      <Notice>
        <p>
          <strong>Prévia.</strong> O registro de execução ainda não existe na
          ferramenta. Aqui nada é salvo ou enviado ao seu profissional. Os
          vídeos do seed original são links de busca e não vídeos revisados;
          por isso não aparecem nesta tela.
        </p>
      </Notice>
      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">
              {meso.name.toUpperCase()} · {meso.focus.toUpperCase()} · SEMANA 1
            </p>
            <h2>
              Treino {workout.letter} — {workout.title}
            </h2>
          </div>
        </div>
        <div
          className="progress"
          role="progressbar"
          aria-label="Séries concluídas"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={completed}
        >
          <span style={{ width: `${(completed / total) * 100}%` }} />
        </div>
        <p className="small muted progress-label">
          {completed} de {total} séries concluídas
        </p>
        <ol className="exercise-list">
          {workout.exercises.map((exercise, exerciseIndex) => (
            <li key={exercise.name} className="exercise">
              <h3>
                {exerciseIndex + 1}. {exercise.name}
              </h3>
              <p className="small muted">
                {meso.preset.sets} séries · {meso.preset.reps} repetições ·
                descanso {meso.preset.rest} · cadência {meso.preset.cadence} ·
                RIR {meso.preset.rir}
              </p>
              <div className="set-list">
                {Array.from({ length: sets }, (_, setIndex) => {
                  const key = `${exerciseIndex}-${setIndex}`;
                  return (
                    <div className="set-row" key={key}>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={Boolean(done[key])}
                          onChange={(event) =>
                            setDone({ ...done, [key]: event.target.checked })
                          }
                        />
                        <span>Série {setIndex + 1} feita</span>
                      </label>
                      <label>
                        <span className="sr-only">
                          Repetições da série {setIndex + 1} de{" "}
                          {exercise.name}
                        </span>
                        <input
                          inputMode="numeric"
                          placeholder="Reps feitas"
                          maxLength={3}
                        />
                      </label>
                      <label>
                        <span className="sr-only">
                          Carga da série {setIndex + 1} de {exercise.name}
                        </span>
                        <input placeholder="Carga usada" maxLength={12} />
                      </label>
                    </div>
                  );
                })}
              </div>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
