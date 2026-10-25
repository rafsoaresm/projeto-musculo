"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Notice } from "@/components/ui";
import type { StudentSession } from "@/db/workout-sessions";
import { deleteSession, saveSession } from "./actions";
import { MAX_SETS, PAIN_ADVICE, PAIN_SAVED_TEXT, parseLoadText } from "./contracts";

export interface LoggableExercise {
  id: string;
  name: string;
  /** The prescription as the professional typed it, for the student to see while logging. */
  dose: string;
  notes: string | null;
}

interface SetDraft {
  reps: string;
  load: string;
}
interface ExerciseDraft {
  done: boolean;
  sets: SetDraft[];
  rir: string;
  pain: boolean;
  notes: string;
}

const emptySets = (prescribed: string | null): SetDraft[] => {
  // Only the number of empty rows follows the prescription: no repetition or load is ever filled in.
  const count = prescribed && /^\d{1,2}$/.test(prescribed.trim()) ? Number(prescribed.trim()) : 1;
  return Array.from({ length: Math.max(1, Math.min(count, MAX_SETS)) }, () => ({ reps: "", load: "" }));
};

const loadText = (value: number | null) => (value === null ? "" : String(value).replace(".", ","));

/**
 * The student's log of one workout. Everything is typed or ticked by the student: nothing is
 * prefilled with a number, and "not logged" is not "not done". Fields are controlled and sent from a
 * handler (React 19 resets a form after its action, which would erase the text if the server
 * refuses it).
 */
export function SessionForm({
  studentId,
  planId,
  phaseIndex,
  workoutLabel,
  exercises,
  prescribedSets,
  initial,
  today,
  oldest,
}: {
  studentId: string;
  planId: string;
  phaseIndex: number;
  workoutLabel: string;
  exercises: LoggableExercise[];
  /** The prescribed number of sets by exercise id, used only to show that many empty rows. */
  prescribedSets: Record<string, string | null>;
  /** A log that can still be corrected, when the student opened one. */
  initial: StudentSession | null;
  today: string;
  oldest: string;
}) {
  const router = useRouter();
  const [performedOn, setPerformedOn] = useState(initial?.performedOn ?? today);
  const [effort, setEffort] = useState(initial?.effort === null || initial === null ? "" : String(initial.effort));
  const [sessionPain, setSessionPain] = useState(false);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [drafts, setDrafts] = useState<Record<string, ExerciseDraft>>(() =>
    Object.fromEntries(
      exercises.map((exercise) => {
        const saved = initial?.exercises.find((row) => row.prescribedExerciseId === exercise.id);
        const draft: ExerciseDraft = saved
          ? {
              done: saved.done,
              sets: saved.sets.length
                ? saved.sets.map((set) => ({ reps: set.reps === null ? "" : String(set.reps), load: loadText(set.loadKg) }))
                : emptySets(prescribedSets[exercise.id] ?? null),
              rir: saved.rir === null ? "" : String(saved.rir),
              pain: saved.pain,
              notes: saved.notes ?? "",
            }
          : { done: false, sets: emptySets(prescribedSets[exercise.id] ?? null), rir: "", pain: false, notes: "" };
        return [exercise.id, draft];
      }),
    ),
  );
  const [savedId, setSavedId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [locked, setLocked] = useState(false);
  const [pending, startTransition] = useTransition();
  const sessionId = savedId ?? initial?.id ?? null;
  const anyPain = sessionPain || Object.values(drafts).some((draft) => draft.pain);

  const touch = () => setMessage("");
  const update = (id: string, patch: Partial<ExerciseDraft>) => {
    setDrafts((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
    touch();
  };
  const updateSet = (id: string, index: number, patch: Partial<SetDraft>) => {
    setDrafts((current) => ({
      ...current,
      [id]: { ...current[id], sets: current[id].sets.map((set, i) => (i === index ? { ...set, ...patch } : set)) },
    }));
    touch();
  };

  /** Turns what was typed into numbers, or returns what is wrong so the student can fix it. */
  function payload(): { ok: true; value: unknown } | { ok: false; problem: string } {
    const built = [];
    for (const exercise of exercises) {
      const draft = drafts[exercise.id];
      const sets = [];
      for (const [index, set] of draft.sets.entries()) {
        const repsText = set.reps.trim();
        const reps = repsText === "" ? null : /^\d{1,3}$/.test(repsText) ? Number(repsText) : undefined;
        const load = set.load.trim() === "" ? null : parseLoadText(set.load);
        if (reps === undefined)
          return { ok: false, problem: `${exercise.name}, série ${index + 1}: use só números inteiros nas repetições.` };
        if (set.load.trim() !== "" && load === null)
          return { ok: false, problem: `${exercise.name}, série ${index + 1}: confira a carga (por exemplo 22,5).` };
        sets.push({ reps, loadKg: load });
      }
      built.push({
        prescribedExerciseId: exercise.id,
        done: draft.done,
        rir: draft.rir === "" ? null : Number(draft.rir),
        pain: draft.pain,
        notes: draft.notes.trim() === "" ? null : draft.notes,
        sets,
      });
    }
    return {
      ok: true,
      value: {
        planId,
        phaseIndex,
        workoutLabel,
        performedOn,
        effort: effort === "" ? null : Number(effort),
        pain: sessionPain,
        notes: notes.trim() === "" ? null : notes,
        exercises: built,
      },
    };
  }

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const built = payload();
    if (!built.ok) {
      setFailed(true);
      setMessage(built.problem);
      return;
    }
    startTransition(async () => {
      const result = await saveSession(studentId, built.value);
      if (result.error || !result.saved) {
        setFailed(true);
        setMessage(result.error ?? "Não foi possível salvar. Tente novamente.");
        return;
      }
      setFailed(false);
      setSavedId(result.saved.id);
      if (result.saved.painReported) {
        setLocked(true);
        setMessage(`${PAIN_SAVED_TEXT} ${PAIN_ADVICE}`);
      } else {
        setMessage("Registro salvo. Você pode corrigir este registro por até 24 horas.");
      }
    });
  }

  function remove() {
    if (!sessionId) return;
    startTransition(async () => {
      const result = await deleteSession(studentId, sessionId);
      if (result.error) {
        setFailed(true);
        setMessage(result.error);
        return;
      }
      router.push("/aluno/treino");
    });
  }

  return (
    <form className="stack-form profile-form" onSubmit={save}>
      <Notice>
        <p>
          Registre o que você fez. Só o que você preencher é salvo: um exercício
          que você não marcar fica sem registro, e isso não quer dizer que você
          não o fez.
        </p>
      </Notice>

      <fieldset disabled={locked}>
        <legend>Data do treino</legend>
        <label>
          Data em que você treinou
          <input
            type="date"
            value={performedOn}
            min={oldest}
            max={today}
            required
            disabled={Boolean(sessionId)}
            onChange={(event) => {
              setPerformedOn(event.target.value);
              touch();
            }}
          />
        </label>
      </fieldset>

      <fieldset disabled={locked}>
        <legend>Exercícios</legend>
        {exercises.map((exercise) => {
          const draft = drafts[exercise.id];
          return (
            <div key={exercise.id} className="session-exercise" role="group" aria-label={exercise.name}>
              <div className="exercise-main">
                <strong>{exercise.name}</strong>
                <span className="small muted">{exercise.dose || "Sem parâmetros definidos"}</span>
                {exercise.notes && <span className="small muted">Obs.: {exercise.notes}</span>}
              </div>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={draft.done}
                  onChange={(event) => update(exercise.id, { done: event.target.checked })}
                />
                Fiz este exercício
              </label>
              {draft.done && (
                <>
                  {draft.sets.map((set, index) => (
                    <div key={index} className="set-row" role="group" aria-label={`Série ${index + 1}`}>
                      <label>
                        Repetições
                        <input
                          value={set.reps}
                          inputMode="numeric"
                          maxLength={3}
                          onChange={(event) => updateSet(exercise.id, index, { reps: event.target.value })}
                        />
                      </label>
                      <label>
                        Carga (kg)
                        <input
                          value={set.load}
                          inputMode="decimal"
                          maxLength={7}
                          onChange={(event) => updateSet(exercise.id, index, { load: event.target.value })}
                        />
                      </label>
                      <button
                        type="button"
                        className="button danger-outline small"
                        disabled={draft.sets.length <= 1}
                        onClick={() =>
                          update(exercise.id, { sets: draft.sets.filter((_, i) => i !== index) })
                        }
                      >
                        <Trash2 size={16} /> Remover série {index + 1}
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="button secondary small"
                    disabled={draft.sets.length >= MAX_SETS}
                    onClick={() => update(exercise.id, { sets: [...draft.sets, { reps: "", load: "" }] })}
                  >
                    <Plus size={16} /> Adicionar série
                  </button>
                  <label>
                    Repetições que sobraram no fim (RIR), se você souber
                    <select value={draft.rir} onChange={(event) => update(exercise.id, { rir: event.target.value })}>
                      <option value="">Não informar</option>
                      {Array.from({ length: 11 }, (_, value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={draft.pain}
                  onChange={(event) => update(exercise.id, { pain: event.target.checked })}
                />
                Senti dor ou desconforto neste exercício
              </label>
              <label>
                Observação sobre este exercício
                <input
                  value={draft.notes}
                  maxLength={300}
                  onChange={(event) => update(exercise.id, { notes: event.target.value })}
                />
              </label>
            </div>
          );
        })}
      </fieldset>

      <fieldset disabled={locked}>
        <legend>Como foi o treino</legend>
        <label>
          Esforço percebido da sessão (0 a 10), se quiser informar
          <select
            value={effort}
            onChange={(event) => {
              setEffort(event.target.value);
              touch();
            }}
          >
            <option value="">Não informar</option>
            {Array.from({ length: 11 }, (_, value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={sessionPain}
            onChange={(event) => {
              setSessionPain(event.target.checked);
              touch();
            }}
          />
          Senti dor ou desconforto durante o treino
        </label>
        <label>
          Observações do treino
          <textarea
            rows={3}
            value={notes}
            maxLength={500}
            onChange={(event) => {
              setNotes(event.target.value);
              touch();
            }}
          />
        </label>
      </fieldset>

      {anyPain && !locked && (
        <Notice tone="warning">
          <p>
            <strong>{PAIN_ADVICE}</strong> Ao salvar, o relato fica registrado
            para o seu profissional ler e não poderá ser alterado nem apagado.
          </p>
        </Notice>
      )}
      {message && (
        <p role={failed ? "alert" : "status"} className={failed ? "form-error" : "small muted"}>
          {message}
        </p>
      )}
      <div className="persist-actions">
        {locked ? (
          <Link className="button primary" href="/aluno/treino">
            Voltar ao treino
          </Link>
        ) : (
          <>
            <button className="button primary" disabled={pending}>
              {pending ? "Salvando…" : "Salvar registro"}
            </button>
            {sessionId && (
              <button type="button" className="button danger-outline" disabled={pending} onClick={remove}>
                <Trash2 size={16} /> Apagar este registro
              </button>
            )}
            <Link className="button secondary" href="/aluno/treino">
              Voltar ao treino
            </Link>
          </>
        )}
      </div>
      <p className="small muted">
        Você pode corrigir ou apagar um registro por até 24 horas, desde que ele
        não tenha relato de dor nem tenha sido lido pelo profissional. Isto é
        um diário do que você fez: ele não altera o seu treino.
      </p>
    </form>
  );
}
