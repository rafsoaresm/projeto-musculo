"use client";

import { useRef } from "react";
import { Plus, RotateCw, Trash2 } from "lucide-react";
import {
  STRUCTURE_LIMITS,
  phaseSchemaV1,
  type PhaseInputV2,
  type WorkoutInputV2,
} from "../contracts";
import {
  SESSIONS_PER_WEEK_OPTIONS,
  TARGET_OPTIONS,
  dayLabel,
  newWorkout,
  nextLabel,
  removeWorkoutAt,
  rotationOwners,
  setRotationPosition,
  spreadDays,
  updateWorkout,
  workoutsFromSplit,
} from "../structure-draft";

/**
 * One phase of the free structure (v2): any number of weeks, up to 14 sessions a week, workouts with a free
 * label, an optional name, target and focus, a rotation and, when the professional wants dates, the day of
 * each session. Every limit shown here is technical and says so; nothing is a training rule.
 */
export function PhaseEditorV2({
  phase,
  phaseNumber,
  startDate,
  onChange,
}: {
  phase: PhaseInputV2;
  phaseNumber: number;
  startDate: string;
  onChange: (phase: PhaseInputV2) => void;
}) {
  const labels = phase.workouts.map((workout) => workout.label);
  const rotation = phase.rotation ?? labels;
  // Which workout each rotation position belongs to, kept across keystrokes: while a label is being typed it
  // can briefly equal another workout's label, and the text alone would merge their places (structure-draft.ts).
  const owners = useRef<number[] | null>(null);
  const apply = (edit: { phase: PhaseInputV2; owners: number[] | null }) => {
    owners.current = edit.owners;
    onChange(edit.phase);
  };
  const set = (update: Partial<PhaseInputV2>) => {
    if ("rotation" in update) owners.current = update.rotation ? rotationOwners(update.rotation, labels, null) : null;
    onChange({ ...phase, ...update });
  };
  const setWorkout = (index: number, update: Partial<WorkoutInputV2>) =>
    apply(updateWorkout(phase, index, update, owners.current));
  const removeWorkout = (index: number) => apply(removeWorkoutAt(phase, index, owners.current));
  const setSessions = (sessionsPerWeek: number) =>
    set({ sessionsPerWeek, trainingDays: phase.trainingDays ? spreadDays(sessionsPerWeek) : null });
  const focusOf = (workout: WorkoutInputV2) => workout.focus ?? { note: null, minutes: null };
  const setFocus = (index: number, update: Partial<NonNullable<WorkoutInputV2["focus"]>>) => {
    const focus = { ...focusOf(phase.workouts[index]), ...update };
    setWorkout(index, { focus: focus.note === null && focus.minutes === null ? null : focus });
  };
  const id = (part: string) => `fase-${phaseNumber}-${part}`;

  return (
    <div className="phase-editor-v2">
      <div className="field-grid">
        <label>
          Nome da fase (opcional)
          <input
            value={phase.name ?? ""}
            maxLength={STRUCTURE_LIMITS.MAX_PHASE_NAME}
            placeholder="Ex.: Adaptação"
            onChange={(event) => set({ name: event.target.value || null })}
          />
        </label>
        <label>
          Semanas da fase
          <input
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={Number.isFinite(phase.weeks) && phase.weeks > 0 ? phase.weeks : ""}
            onChange={(event) => set({ weeks: Math.trunc(Number(event.target.value)) })}
          />
        </label>
        <label>
          Sessões por semana
          <select value={phase.sessionsPerWeek} onChange={(event) => setSessions(Number(event.target.value))}>
            {SESSIONS_PER_WEEK_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n} {n === 1 ? "sessão" : "sessões"}
              </option>
            ))}
          </select>
        </label>
        <label>
          Preencher com uma divisão
          <select
            value=""
            onChange={(event) => {
              if (event.target.value)
                set({ workouts: workoutsFromSplit(event.target.value, phase.workouts), rotation: null });
            }}
          >
            <option value="">Escolha para substituir os treinos…</option>
            {phaseSchemaV1.shape.split.options.map((split) => (
              <option key={split} value={split}>
                {split}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="field-hint">
        Até {STRUCTURE_LIMITS.MAX_SESSIONS_PER_WEEK} sessões por semana (duas por dia) e {STRUCTURE_LIMITS.MAX_OCCURRENCES}{" "}
        sessões no ciclo: limites técnicos atuais, não recomendação de treino.
      </p>

      <fieldset className="workouts-v2">
        <legend>Treinos da fase</legend>
        <ol>
          {phase.workouts.map((workout, index) => (
            <li key={index} className="workout-row-v2">
              <label>
                Rótulo
                <input
                  aria-label={`Rótulo do treino ${index + 1}`}
                  value={workout.label}
                  maxLength={STRUCTURE_LIMITS.MAX_LABEL}
                  required
                  onChange={(event) => setWorkout(index, { label: event.target.value })}
                />
              </label>
              <label>
                Nome (opcional)
                <input
                  aria-label={`Nome do treino ${index + 1}`}
                  value={workout.name ?? ""}
                  maxLength={STRUCTURE_LIMITS.MAX_WORKOUT_NAME}
                  placeholder="Ex.: Superior"
                  onChange={(event) => setWorkout(index, { name: event.target.value || null })}
                />
              </label>
              <label>
                Alvo
                <select
                  aria-label={`Alvo do treino ${index + 1}`}
                  value={workout.exerciseTarget ?? ""}
                  onChange={(event) =>
                    setWorkout(index, { exerciseTarget: event.target.value ? Number(event.target.value) : null })
                  }
                >
                  <option value="">Sem alvo</option>
                  {TARGET_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {n} {n === 1 ? "exercício" : "exercícios"}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Foco (opcional)
                <input
                  aria-label={`Foco do treino ${index + 1}`}
                  value={focusOf(workout).note ?? ""}
                  maxLength={STRUCTURE_LIMITS.MAX_FOCUS_NOTE}
                  placeholder="Ex.: membros inferiores"
                  onChange={(event) => setFocus(index, { note: event.target.value || null })}
                />
              </label>
              <label>
                Minutos (opcional)
                <input
                  aria-label={`Minutos do treino ${index + 1}`}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={STRUCTURE_LIMITS.MAX_WORKOUT_MINUTES}
                  value={focusOf(workout).minutes ?? ""}
                  onChange={(event) =>
                    setFocus(index, { minutes: event.target.value ? Math.trunc(Number(event.target.value)) : null })
                  }
                />
              </label>
              <button
                type="button"
                className="button secondary small"
                aria-label={`Remover o treino ${workout.label || index + 1}`}
                disabled={phase.workouts.length === 1}
                onClick={() => removeWorkout(index)}
              >
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ol>
        <button
          type="button"
          className="button secondary small"
          onClick={() => set({ workouts: [...phase.workouts, newWorkout(nextLabel(labels), phase.workouts[0]?.exerciseTarget ?? null)] })}
        >
          <Plus size={15} /> Adicionar treino
        </button>
        <p className="field-hint">
          O rótulo tem até {STRUCTURE_LIMITS.MAX_LABEL} caracteres, sem |, / ou \ (limite técnico). O foco é uma anotação sua: é
          exibido, nunca interpretado.
        </p>
      </fieldset>

      <fieldset className="workouts-v2">
        <legend>Rotação</legend>
        <label className="check-row">
          <input
            type="checkbox"
            checked={phase.rotation !== null}
            onChange={(event) =>
              apply({ phase: { ...phase, rotation: event.target.checked ? [...labels] : null }, owners: event.target.checked ? labels.map((_, i) => i) : null })
            }
          />
          Rotação personalizada
        </label>
        {phase.rotation === null ? (
          <p className="small muted">Na ordem dos treinos: {labels.join(", ")}.</p>
        ) : (
          <>
            <ol className="rotation-list">
              {rotation.map((label, index) => (
                <li key={index}>
                  <select
                    aria-label={`Posição ${index + 1} da rotação`}
                    value={label}
                    onChange={(event) =>
                      apply(setRotationPosition(phase, index, event.target.selectedIndex, owners.current))
                    }
                  >
                    {labels.map((option, i) => (
                      <option key={i} value={option}>
                        {option || `Treino ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </li>
              ))}
            </ol>
            <div className="persist-actions">
              <button
                type="button"
                className="button secondary small"
                onClick={() => {
                  const known = rotationOwners(rotation, labels, owners.current);
                  apply({ phase: { ...phase, rotation: [...rotation, labels[0]] }, owners: [...known, 0] });
                }}
              >
                <Plus size={15} /> Adicionar posição
              </button>
              <button
                type="button"
                className="button secondary small"
                disabled={rotation.length === 1}
                onClick={() => {
                  const known = rotationOwners(rotation, labels, owners.current);
                  apply({ phase: { ...phase, rotation: rotation.slice(0, -1) }, owners: known.slice(0, -1) });
                }}
              >
                Remover a última posição
              </button>
            </div>
          </>
        )}
        <div className="rotation-note">
          <RotateCw size={17} />
          <p>
            A rotação continua entre as semanas da mesma fase: a sessão seguinte pega o próximo treino da sequência. Cada
            nova fase recomeça a sua.
          </p>
        </div>
      </fieldset>

      <fieldset className="workouts-v2">
        <legend>Dias de treino</legend>
        <label className="check-row">
          <input
            type="checkbox"
            checked={phase.trainingDays !== null}
            onChange={(event) => set({ trainingDays: event.target.checked ? spreadDays(phase.sessionsPerWeek) : null })}
          />
          Definir os dias de treino
        </label>
        {phase.trainingDays === null ? (
          <p className="small muted">Sem dias definidos, as sessões não têm data prevista (nada é presumido).</p>
        ) : (
          <div className="field-grid" id={id("dias")}>
            {phase.trainingDays.map((day, index) => (
              <label key={index}>
                Sessão {index + 1}
                <select
                  aria-label={`Dia da sessão ${index + 1}`}
                  value={day}
                  onChange={(event) =>
                    set({
                      trainingDays: phase.trainingDays!.map((value, i) => (i === index ? Number(event.target.value) : value)),
                    })
                  }
                >
                  {Array.from({ length: 7 }, (_, offset) => (
                    <option key={offset} value={offset}>
                      {dayLabel(startDate, offset)}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        )}
        {phase.trainingDays !== null && (
          <p className="field-hint">
            O dia 1 é o primeiro dia de cada semana da fase. As sessões seguem em ordem; duas sessões de treinos diferentes podem cair
            no mesmo dia (o aluno registra cada treino uma vez por dia).
          </p>
        )}
      </fieldset>
    </div>
  );
}
