"use client";
import { useActionState, useState, useTransition } from "react";
import { saveExercise } from "./actions";
import { CATEGORIES } from "./contracts";
import { Pill } from "@/components/ui";
import { videoLabel } from "./labels";
import type { ExerciseRecord } from "@/db/exercises";

/**
 * The fields are controlled and the form is sent from onSubmit, not from the
 * `action` prop: React 19 resets a form after its action runs, which erased what
 * the person typed when the server refused it and sent the category select back
 * to its first option after a save. The fields are keyed by the saved record, so
 * after a successful save the form shows what the server kept, including a
 * cleared video review.
 */
function Fields({ exercise }: { exercise?: ExerciseRecord }) {
  const [name, setName] = useState(exercise?.name ?? "");
  const [category, setCategory] = useState(exercise?.category ?? "Core");
  const [level, setLevel] = useState(exercise?.level ?? "");
  const [videoUrl, setVideoUrl] = useState(exercise?.videoUrl ?? "");
  const [notes, setNotes] = useState(exercise?.notes ?? "");
  const [verified, setVerified] = useState(exercise?.videoStatus === "VERIFIED");
  const status = exercise?.videoStatus ?? "NONE";
  const canVerify = Boolean(exercise?.videoUrl) && status !== "SEARCH_LINK";
  return (
    <>
      <label>
        Nome do exercício
        <input
          name="name"
          required
          maxLength={120}
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoComplete="off"
        />
      </label>
      <div className="field-grid">
        <label>
          Categoria
          <select
            name="category"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            {CATEGORIES.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <label>
          Nível (opcional)
          <input
            name="level"
            maxLength={40}
            value={level}
            onChange={(event) => setLevel(event.target.value)}
          />
        </label>
      </div>
      <label>
        Link do vídeo (opcional)
        <input
          name="videoUrl"
          type="url"
          maxLength={500}
          placeholder="https://www.youtube.com/watch?v=…"
          value={videoUrl}
          onChange={(event) => setVideoUrl(event.target.value)}
        />
      </label>
      <p className="small muted">
        Aceitamos links https do YouTube e do Vimeo. Um link de busca não conta
        como vídeo revisado.
      </p>
      {exercise && (
        <p className="small">
          <Pill tone={videoLabel(status).tone}>{videoLabel(status).text}</Pill>
        </p>
      )}
      {canVerify && (
        <>
          <label className="check-row">
            <input
              name="videoVerified"
              type="checkbox"
              checked={verified}
              onChange={(event) => setVerified(event.target.checked)}
            />
            Revisei este vídeo e ele mostra a execução que eu quero prescrever
          </label>
          <p className="small muted">
            Ao trocar o link, a revisão é desfeita e precisa ser marcada de novo
            numa segunda gravação.
          </p>
        </>
      )}
      <label>
        Observações (só da sua organização)
        <textarea
          name="notes"
          rows={4}
          maxLength={1000}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </label>
    </>
  );
}

/** Create (no exercise) or edit one of the organization's own exercises. */
export function ExerciseForm({ exercise }: { exercise?: ExerciseRecord }) {
  const [message, action, sending] = useActionState(
    saveExercise.bind(null, exercise?.id ?? null),
    "",
  );
  const [, startTransition] = useTransition();
  const pending = sending;
  const failed = message && message !== "Alterações salvas.";
  return (
    <form
      className="stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <Fields key={exercise?.updatedAt ?? "new"} exercise={exercise} />
      {message && (
        <p
          role={failed ? "alert" : "status"}
          className={failed ? "form-error" : "small muted"}
        >
          {message}
        </p>
      )}
      <button className="button primary" disabled={pending}>
        {pending ? "Salvando…" : exercise ? "Salvar alterações" : "Criar exercício"}
      </button>
    </form>
  );
}
