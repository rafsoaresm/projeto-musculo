"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { saveCheckinForm } from "./actions";
import { MAX_OWN_QUESTIONS, QUESTION_MAX, type CheckinFormShape } from "./contracts";

interface Draft {
  askEffort: boolean;
  askRecovery: boolean;
  askNotes: boolean;
  questions: Array<{ key: string; id: string | null; text: string }>;
}
const draftOf = (form: CheckinFormShape): Draft => ({
  askEffort: form.askEffort,
  askRecovery: form.askRecovery,
  askNotes: form.askNotes,
  questions: form.questions.map((question) => ({ key: question.id, id: question.id, text: question.text })),
});
let counter = 0;

/**
 * What the student's check-in asks, chosen by the professional with an active technical assignment over the student. The existing
 * questions are turned on or off; the professional's own questions are answered by the student in text. Saving writes a new version:
 * the check-ins already made keep the questions they were answered with.
 */
export function CheckinFormEditor({
  studentId,
  form,
  version,
}: {
  studentId: string;
  form: CheckinFormShape;
  version: number | null;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => draftOf(form));
  // After a save the page brings the new version: the draft follows it (ids included), the message stays.
  const [shown, setShown] = useState(version);
  if (shown !== version) {
    setShown(version);
    setDraft(draftOf(form));
  }
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const change = (next: Partial<Draft>) => {
    setDraft((previous) => ({ ...previous, ...next }));
    setMessage("");
  };
  const setQuestion = (index: number, text: string) =>
    change({ questions: draft.questions.map((item, at) => (at === index ? { ...item, text } : item)) });
  const move = (index: number, by: number) => {
    const next = [...draft.questions];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item);
    change({ questions: next });
  };

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await saveCheckinForm(studentId, {
        askEffort: draft.askEffort,
        askRecovery: draft.askRecovery,
        askNotes: draft.askNotes,
        questions: draft.questions.map((item) => ({ id: item.id, text: item.text })),
      });
      if (result.error || !result.saved) {
        setFailed(true);
        setMessage(result.error ?? "Não foi possível salvar. Tente novamente.");
        return;
      }
      setFailed(false);
      setMessage(
        result.saved === "unchanged"
          ? "Nada mudou nas perguntas."
          : `Perguntas salvas (versão ${result.saved.version}). Os próximos check-ins já usam estas perguntas.`,
      );
      router.refresh();
    });
  }

  return (
    <form className="stack-form profile-form" onSubmit={save} aria-label="Perguntas do check-in">
      <fieldset disabled={pending}>
        <legend>Perguntas que já existem</legend>
        <label className="check-row">
          <input type="checkbox" checked={draft.askEffort} onChange={(event) => change({ askEffort: event.target.checked })} />
          Esforço percebido nos últimos dias (0 a 10)
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={draft.askRecovery}
            onChange={(event) => change({ askRecovery: event.target.checked })}
          />
          Quanto sente que recuperou
        </label>
        <label className="check-row">
          <input type="checkbox" checked={draft.askNotes} onChange={(event) => change({ askNotes: event.target.checked })} />
          Observações
        </label>
        <label className="check-row">
          <input type="checkbox" checked disabled />
          Dor ou desconforto (sempre perguntado)
        </label>
      </fieldset>
      <fieldset disabled={pending}>
        <legend>Suas perguntas</legend>
        <p className="small muted">
          O aluno responde com texto. Até {MAX_OWN_QUESTIONS} perguntas, com até {QUESTION_MAX} caracteres cada.
        </p>
        {draft.questions.length === 0 && <p className="small muted">Nenhuma pergunta sua ainda.</p>}
        {draft.questions.map((item, index) => (
          <div key={item.key} className="checkin-question-row">
            <label>
              Pergunta {index + 1}
              <textarea
                rows={2}
                className="checkin-question-text"
                aria-label={`Pergunta ${index + 1}`}
                value={item.text}
                maxLength={QUESTION_MAX}
                required
                onChange={(event) => setQuestion(index, event.target.value.replace(/\n/g, " "))}
              />
            </label>
            <div className="checkin-question-actions">
              <button
                type="button"
                className="button secondary small"
                aria-label={`Subir a pergunta ${index + 1}`}
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                <ArrowUp size={16} />
              </button>
              <button
                type="button"
                className="button secondary small"
                aria-label={`Descer a pergunta ${index + 1}`}
                disabled={index === draft.questions.length - 1}
                onClick={() => move(index, 1)}
              >
                <ArrowDown size={16} />
              </button>
              <button
                type="button"
                className="button danger-outline small"
                aria-label={`Remover a pergunta ${index + 1}`}
                onClick={() => change({ questions: draft.questions.filter((_, at) => at !== index) })}
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
        {draft.questions.length < MAX_OWN_QUESTIONS && (
          <div>
            <button
              type="button"
              className="button secondary"
              onClick={() => change({ questions: [...draft.questions, { key: `new-${++counter}`, id: null, text: "" }] })}
            >
              <Plus size={16} /> Adicionar pergunta
            </button>
          </div>
        )}
      </fieldset>
      {message && (
        <p role={failed ? "alert" : "status"} className={failed ? "form-error" : "small muted"}>
          {message}
        </p>
      )}
      <div className="persist-actions">
        <button className="button primary" disabled={pending}>
          {pending ? "Salvando…" : "Salvar perguntas"}
        </button>
      </div>
      <p className="small muted">
        {version === null
          ? "Hoje o aluno responde as perguntas padrão."
          : `Em uso: versão ${version}.`}{" "}
        Os check-ins já feitos continuam com as perguntas com que foram respondidos.
      </p>
    </form>
  );
}
