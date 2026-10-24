"use client";
import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Copy, Pencil, Plus, Trash2 } from "lucide-react";
import { Pill } from "@/components/ui";
import type { PrescribedItem, Target } from "@/db/prescription";
import type { PeriodizationSchedule } from "@/modules/training/contracts";
import { workoutLabels } from "@/modules/training/periodization";
import { CATEGORIES } from "@/modules/biblioteca/contracts";
import { videoLabel } from "@/modules/biblioteca/labels";
import { describeDose } from "./describe";
import { progressOf, type WorkoutProgress } from "./summary";
import {
  addExercise,
  copyMesocycle,
  copyWorkout,
  duplicateItem,
  moveItems,
  removeItem,
  updateItem,
  type PrescriptionResult,
} from "./actions";

export interface LibraryOption {
  id: string;
  name: string;
  category: string;
}

export const describeItem = describeDose;

const STATUS: Record<WorkoutProgress["status"], { text: string; tone: "warning" | "success" | "neutral" }> = {
  BELOW: { text: "Abaixo do alvo", tone: "warning" },
  MET: { text: "Alvo atendido", tone: "success" },
  ABOVE: { text: "Acima do alvo", tone: "neutral" },
};

/**
 * Manual prescription of one revision. It uses the SAVED structure; nothing is
 * suggested or filled in, and a workout below its target stays a pending item.
 */
export function PrescriptionEditor({
  planId,
  revisionId,
  schedule,
  items,
  library,
  readOnly,
}: {
  planId: string;
  revisionId: string;
  schedule: PeriodizationSchedule;
  items: PrescribedItem[];
  library: LibraryOption[];
  readOnly: boolean;
}) {
  const [phase, setPhase] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copyFromPhase, setCopyFromPhase] = useState("");
  const [pending, startTransition] = useTransition();
  const progress = progressOf(schedule, items);
  const below = progress.filter((slot) => slot.status === "BELOW").length;
  const current = schedule.phases[phase];

  function run(task: () => Promise<PrescriptionResult>, done?: () => void) {
    startTransition(async () => {
      const result = await task();
      setError(result?.error ?? "");
      setNotice(result?.notice ?? "");
      if (!result?.error) done?.();
    });
  }

  return (
    <section className="panel prescription" aria-labelledby="prescricao-titulo">
      <p className="eyebrow">PRESCRIÇÃO</p>
      <h2 id="prescricao-titulo">Exercícios por mesociclo</h2>
      <p className="muted">
        {readOnly
          ? "Esta revisão está fechada: os exercícios abaixo não mudam. Para alterar, crie uma nova revisão."
          : "Você escolhe cada exercício e digita cada valor. Nada é sugerido nem preenchido por padrão, e o alvo de exercícios por treino é só uma referência. A prescrição usa a estrutura já salva."}
      </p>
      <p className="small" role="status">
        <Pill tone={below ? "warning" : "success"}>
          {below
            ? `${below} de ${progress.length} treinos abaixo do alvo`
            : "Todos os treinos atingiram o alvo"}
        </Pill>
      </p>
      <div className="phase-tabs" role="group" aria-label="Selecionar mesociclo">
        {schedule.phases.map((item, index) => (
          <button
            key={item.index}
            type="button"
            aria-pressed={phase === index}
            className={phase === index ? "phase-tab selected" : "phase-tab"}
            onClick={() => {
              setPhase(index);
              setError("");
            }}
          >
            Fase {String(item.index).padStart(2, "0")}
          </button>
        ))}
      </div>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="small muted" role="status">
          {notice}
        </p>
      )}
      {!readOnly && !items.some((item) => item.phaseIndex === current.index) && (
        <div className="copy-phase">
          {schedule.phases
            .filter((other) => items.some((item) => item.phaseIndex === other.index))
            .length > 0 && (
            <>
              <label>
                Copiar o mesociclo de outra fase
                <select
                  value={copyFromPhase}
                  onChange={(event) => setCopyFromPhase(event.target.value)}
                >
                  <option value="">Escolha…</option>
                  {schedule.phases
                    .filter((other) => other.index !== current.index)
                    .filter((other) => items.some((item) => item.phaseIndex === other.index))
                    .map((other) => (
                      <option key={other.index} value={other.index}>
                        Fase {String(other.index).padStart(2, "0")} (
                        {items.filter((item) => item.phaseIndex === other.index).length}{" "}
                        exercícios)
                      </option>
                    ))}
                </select>
              </label>
              <button
                type="button"
                className="button secondary small"
                disabled={pending || !copyFromPhase}
                onClick={() =>
                  run(
                    () =>
                      copyMesocycle(planId, revisionId, Number(copyFromPhase), current.index),
                    () => setCopyFromPhase(""),
                  )
                }
              >
                Copiar mesociclo
              </button>
            </>
          )}
        </div>
      )}
      <div className="workout-grid">
        {workoutLabels(current.split).map((label) => (
          <WorkoutCard
            key={`${current.index}-${label}`}
            planId={planId}
            revisionId={revisionId}
            target={{ phaseIndex: current.index, workoutLabel: label }}
            progress={
              progress.find(
                (slot) => slot.phaseIndex === current.index && slot.label === label,
              ) as WorkoutProgress
            }
            items={items.filter(
              (item) => item.phaseIndex === current.index && item.workoutLabel === label,
            )}
            allProgress={progress}
            library={library}
            readOnly={readOnly}
            pending={pending}
            run={run}
          />
        ))}
      </div>
    </section>
  );
}

function WorkoutCard({
  planId,
  revisionId,
  target,
  progress,
  items,
  allProgress,
  library,
  readOnly,
  pending,
  run,
}: {
  planId: string;
  revisionId: string;
  target: Target;
  progress: WorkoutProgress;
  items: PrescribedItem[];
  allProgress: WorkoutProgress[];
  library: LibraryOption[];
  readOnly: boolean;
  pending: boolean;
  run: (task: () => Promise<PrescriptionResult>, done?: () => void) => void;
}) {
  const [category, setCategory] = useState("");
  const [exerciseId, setExerciseId] = useState("");
  const [customName, setCustomName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [copyFrom, setCopyFrom] = useState("");
  const status = STATUS[progress.status];
  const options = library.filter((option) => !category || option.category === category);
  const sources = allProgress.filter(
    (slot) =>
      slot.count > 0 && !(slot.phaseIndex === target.phaseIndex && slot.label === target.workoutLabel),
  );
  const move = (index: number, direction: -1 | 1) => {
    const ordered = items.map((item) => item.id);
    [ordered[index], ordered[index + direction]] = [ordered[index + direction], ordered[index]];
    run(() => moveItems(planId, revisionId, target, ordered));
  };

  return (
    <section className="workout-card" aria-label={`Treino ${target.workoutLabel}`}>
      <header>
        <h3>Treino {target.workoutLabel}</h3>
        <span className="small muted">
          {progress.count} de {progress.target}
        </span>
        <Pill tone={status.tone}>{status.text}</Pill>
      </header>
      {items.length === 0 ? (
        <p className="small muted">Nenhum exercício neste treino ainda.</p>
      ) : (
        <ol className="exercise-list">
          {items.map((item, index) => {
            const video = videoLabel(item.videoStatus);
            return (
              <li key={item.id}>
                <div className="exercise-main">
                  <strong>{item.name}</strong>
                  <span className="small muted">
                    {describeItem(item) || "Sem parâmetros definidos"}
                  </span>
                  {item.notes && <span className="small muted">Obs.: {item.notes}</span>}
                  {item.videoUrl && (
                    <span className="small">
                      <Pill tone={video.tone}>{video.text}</Pill>{" "}
                      <a href={item.videoUrl} target="_blank" rel="noopener noreferrer">
                        Abrir o link
                      </a>
                    </span>
                  )}
                </div>
                {!readOnly && editing !== item.id && (
                  <div className="exercise-actions">
                    <button
                      type="button"
                      className="button secondary small"
                      aria-label={`Subir ${item.name}`}
                      disabled={pending || index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp size={15} />
                    </button>
                    <button
                      type="button"
                      className="button secondary small"
                      aria-label={`Descer ${item.name}`}
                      disabled={pending || index === items.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown size={15} />
                    </button>
                    <button
                      type="button"
                      className="button secondary small"
                      onClick={() => setEditing(item.id)}
                      aria-label={`Editar ${item.name}`}
                    >
                      <Pencil size={15} /> Editar
                    </button>
                    <button
                      type="button"
                      className="button secondary small"
                      disabled={pending}
                      aria-label={`Duplicar ${item.name}`}
                      onClick={() => run(() => duplicateItem(planId, revisionId, item.id))}
                    >
                      <Copy size={15} />
                    </button>
                    {removing === item.id ? (
                      <>
                        <button
                          type="button"
                          className="button danger-outline small"
                          disabled={pending}
                          onClick={() =>
                            run(() => removeItem(planId, revisionId, item.id), () =>
                              setRemoving(null),
                            )
                          }
                        >
                          Confirmar remoção
                        </button>
                        <button
                          type="button"
                          className="button secondary small"
                          onClick={() => setRemoving(null)}
                        >
                          Manter
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="button danger-outline small"
                        aria-label={`Remover ${item.name}`}
                        onClick={() => setRemoving(item.id)}
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                )}
                {!readOnly && editing === item.id && (
                  <ItemForm
                    item={item}
                    pending={pending}
                    onCancel={() => setEditing(null)}
                    onSave={(fields, name) =>
                      run(() => updateItem(planId, revisionId, item.id, fields, name), () =>
                        setEditing(null),
                      )
                    }
                  />
                )}
              </li>
            );
          })}
        </ol>
      )}
      {!readOnly && (
        <div className="add-exercise">
          <div className="field-grid">
            <label>
              Categoria
              <select value={category} onChange={(e) => { setCategory(e.target.value); setExerciseId(""); }}>
                <option value="">Todas</option>
                {CATEGORIES.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <label>
              Exercício da biblioteca
              <select value={exerciseId} onChange={(e) => setExerciseId(e.target.value)}>
                <option value="">Escolha…</option>
                {options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            type="button"
            className="button secondary small"
            disabled={pending || !exerciseId}
            onClick={() =>
              run(() => addExercise(planId, revisionId, target, { exerciseId }), () => setExerciseId(""))
            }
          >
            <Plus size={15} /> Adicionar da biblioteca
          </button>
          <label>
            Ou um exercício com nome próprio
            <input
              value={customName}
              maxLength={120}
              onChange={(e) => setCustomName(e.target.value)}
              autoComplete="off"
            />
          </label>
          <button
            type="button"
            className="button secondary small"
            disabled={pending || !customName.trim()}
            onClick={() =>
              run(() => addExercise(planId, revisionId, target, { customName }), () => setCustomName(""))
            }
          >
            <Plus size={15} /> Adicionar com nome próprio
          </button>
          {items.length === 0 && sources.length > 0 && (
            <>
              <label>
                Copiar de outro treino
                <select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
                  <option value="">Escolha…</option>
                  {sources.map((slot) => (
                    <option key={`${slot.phaseIndex}|${slot.label}`} value={`${slot.phaseIndex}|${slot.label}`}>
                      Fase {slot.phaseIndex} · Treino {slot.label} ({slot.count})
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="button secondary small"
                disabled={pending || !copyFrom}
                onClick={() => {
                  const [phaseIndex, workoutLabel] = copyFrom.split("|");
                  run(
                    () =>
                      copyWorkout(planId, revisionId, { phaseIndex: Number(phaseIndex), workoutLabel }, target),
                    () => setCopyFrom(""),
                  );
                }}
              >
                Copiar exercícios
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function ItemForm({
  item,
  pending,
  onSave,
  onCancel,
}: {
  item: PrescribedItem;
  pending: boolean;
  onSave: (fields: Record<string, unknown>, customName?: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState({
    name: item.name,
    sets: item.sets ?? "",
    reps: item.reps ?? "",
    loadInstruction: item.loadInstruction ?? "",
    cadence: item.cadence ?? "",
    restSeconds: item.restSeconds === null ? "" : String(item.restSeconds),
    restText: item.restText ?? "",
    rirMin: item.rirMin === null ? "" : String(item.rirMin),
    rirMax: item.rirMax === null ? "" : String(item.rirMax),
    videoUrl: item.videoUrl ?? "",
    notes: item.notes ?? "",
  });
  const set = (key: keyof typeof value) => (event: { target: { value: string } }) =>
    setValue({ ...value, [key]: event.target.value });
  const number = (text: string) => (text.trim() === "" ? null : Number(text));
  return (
    <form
      className="item-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(
          {
            sets: value.sets || null,
            reps: value.reps || null,
            loadInstruction: value.loadInstruction || null,
            cadence: value.cadence || null,
            restSeconds: number(value.restSeconds),
            restText: value.restText || null,
            rirMin: number(value.rirMin),
            rirMax: number(value.rirMax),
            videoUrl: value.videoUrl || null,
            notes: value.notes || null,
          },
          item.exerciseId === null ? value.name : undefined,
        );
      }}
    >
      {item.exerciseId === null && (
        <label>
          Nome
          <input value={value.name} maxLength={120} onChange={set("name")} required />
        </label>
      )}
      <div className="field-grid">
        <label>
          Séries
          <input value={value.sets} maxLength={20} onChange={set("sets")} placeholder="Ex.: 3 ou 3-4" />
        </label>
        <label>
          Repetições
          <input value={value.reps} maxLength={40} onChange={set("reps")} placeholder="Ex.: 8-12" />
        </label>
        <label>
          Carga ou esforço
          <input value={value.loadInstruction} maxLength={120} onChange={set("loadInstruction")} />
        </label>
        <label>
          Cadência
          <input value={value.cadence} maxLength={40} onChange={set("cadence")} />
        </label>
        <label>
          Descanso (segundos)
          <input type="number" min={0} max={3600} step={1} value={value.restSeconds} onChange={set("restSeconds")} />
        </label>
        <label>
          Descanso (texto)
          <input value={value.restText} maxLength={40} onChange={set("restText")} />
        </label>
        <label>
          RIR mínimo
          <input type="number" min={0} max={10} step={1} value={value.rirMin} onChange={set("rirMin")} />
        </label>
        <label>
          RIR máximo
          <input type="number" min={0} max={10} step={1} value={value.rirMax} onChange={set("rirMax")} />
        </label>
      </div>
      <label>
        Link do vídeo desta prescrição (opcional)
        <input type="url" value={value.videoUrl} maxLength={500} onChange={set("videoUrl")} />
      </label>
      <p className="small muted">
        Trocar o link vale só para esta prescrição e não altera a biblioteca. Um link trocado fica como
        não revisado.
      </p>
      <label>
        Observações
        <textarea rows={2} value={value.notes} maxLength={500} onChange={set("notes")} />
      </label>
      <div className="exercise-actions">
        <button className="button primary small" disabled={pending}>
          {pending ? "Salvando…" : "Salvar exercício"}
        </button>
        <button type="button" className="button secondary small" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
