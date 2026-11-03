"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Notice } from "@/components/ui";
import type { StudentCheckin } from "@/db/student-checkins";
import { PAIN_ADVICE } from "@/modules/execucao/contracts";
import { formatCalendarDate } from "@/modules/training/format";
import { deleteCheckin, saveCheckin } from "./actions";
import {
  ANSWER_MAX,
  CHECKIN_URGENCY_NOTICE,
  DISCOMFORT_SAVED_TEXT,
  RECOVERY_LABELS,
  type CheckinFormShape,
} from "./contracts";

interface Values {
  effort: string;
  recovery: string;
  discomfort: boolean;
  discomfortNotes: string;
  notes: string;
  answers: Record<string, string>;
}
const EMPTY: Values = { effort: "", recovery: "", discomfort: false, discomfortNotes: "", notes: "", answers: {} };
const valuesOf = (row: StudentCheckin): Values => ({
  effort: row.effort == null ? "" : String(row.effort),
  recovery: row.recovery == null ? "" : String(row.recovery),
  discomfort: row.discomfort,
  discomfortNotes: row.discomfortNotes ?? "",
  notes: row.notes ?? "",
  answers: Object.fromEntries(row.answers.map((item) => [item.questionId, item.answer])),
});

/**
 * The student's check-in of a day: today by default, or one of the last days of the window (the same as the workout log). Everything is
 * chosen or typed by the student: nothing is prefilled and nothing is scored. A day that already has a check-in opens it, with the
 * questions it was answered with; a new one is asked with the professional's current questions. Fields are controlled and sent from
 * a handler (React 19 resets a form after its action, which would erase the text if the server refuses it).
 */
export function CheckinForm({
  studentId,
  today,
  oldest,
  rows,
  currentForm,
}: {
  studentId: string;
  today: string;
  oldest: string;
  rows: StudentCheckin[];
  currentForm: CheckinFormShape;
}) {
  const router = useRouter();
  const initial = rows.find((row) => row.checkedOn === today) ?? null;
  const [day, setDay] = useState(today);
  const [values, setValues] = useState<Values>(initial ? valuesOf(initial) : EMPTY);
  const [checkinId, setCheckinId] = useState<string | null>(initial?.id ?? null);
  const [locked, setLocked] = useState(initial !== null && !initial.editable);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  // The questions of the check-in on the screen: its own version when it exists, the current one for a new check-in.
  const opened = rows.find((row) => row.id === checkinId) ?? null;
  const form = opened?.form ?? currentForm;
  const set = <K extends keyof Values>(key: K, value: Values[K]) => {
    setValues((previous) => ({ ...previous, [key]: value }));
    setMessage("");
  };

  function chooseDay(next: string) {
    setDay(next);
    setMessage("");
    setFailed(false);
    const existing = rows.find((row) => row.checkedOn === next) ?? null;
    if (existing) {
      setValues(valuesOf(existing));
      setCheckinId(existing.id);
      setLocked(!existing.editable);
    } else if (checkinId) {
      // Leaving a check-in that exists: the new day starts empty, nothing is carried from the other.
      setValues(EMPTY);
      setCheckinId(null);
      setLocked(false);
    }
  }

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await saveCheckin(studentId, {
        checkedOn: day,
        effort: form.askEffort && values.effort !== "" ? Number(values.effort) : null,
        recovery: form.askRecovery && values.recovery !== "" ? Number(values.recovery) : null,
        discomfort: values.discomfort,
        discomfortNotes: values.discomfort ? values.discomfortNotes : null,
        notes: form.askNotes ? values.notes : null,
        answers: form.questions.map((question) => ({ questionId: question.id, answer: values.answers[question.id] ?? "" })),
      });
      if (result.error || !result.saved) {
        setFailed(true);
        setMessage(result.error ?? "Não foi possível salvar. Tente novamente.");
        return;
      }
      setFailed(false);
      setCheckinId(result.saved.id);
      if (result.saved.discomfort) {
        setLocked(true);
        setMessage(`${DISCOMFORT_SAVED_TEXT} ${PAIN_ADVICE}`);
      } else {
        setMessage("Check-in salvo. Você pode corrigi-lo ainda hoje.");
      }
      router.refresh();
    });
  }

  function remove() {
    if (!checkinId) return;
    startTransition(async () => {
      const result = await deleteCheckin(studentId, checkinId);
      if (result.error) {
        setFailed(true);
        setMessage(result.error);
        return;
      }
      setCheckinId(null);
      setValues(EMPTY);
      setLocked(false);
      setFailed(false);
      setMessage("Check-in apagado.");
      router.refresh();
    });
  }

  const isToday = day === today;
  return (
    <form className="stack-form profile-form" onSubmit={save} aria-label="Check-in">
      <Notice tone="warning">
        <p>{CHECKIN_URGENCY_NOTICE}</p>
      </Notice>
      <fieldset disabled={pending}>
        <legend>Dia do check-in</legend>
        <label>
          Dia a que o check-in se refere
          <input
            type="date"
            value={day}
            min={oldest}
            max={today}
            required
            onChange={(event) => event.target.value && chooseDay(event.target.value)}
          />
        </label>
        <p className="small muted">
          Hoje ou um dos dias anteriores, a partir de {formatCalendarDate(oldest)}. Um check-in por dia.
        </p>
      </fieldset>
      {locked && opened && !message && (
        <p className="small muted" role="status">
          Este dia já tem check-in e ele não pode mais ser alterado. Ele está no histórico abaixo.
        </p>
      )}
      <fieldset disabled={locked}>
        <legend>{isToday ? "Como você está hoje" : `Como você estava em ${formatCalendarDate(day)}`}</legend>
        {form.askEffort && (
          <label>
            Esforço percebido nos últimos dias (0 a 10), se quiser informar
            <select value={values.effort} onChange={(event) => set("effort", event.target.value)}>
              <option value="">Não informar</option>
              {Array.from({ length: 11 }, (_, value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        )}
        {form.askRecovery && (
          <label>
            Quanto você sente que recuperou, se quiser informar
            <select value={values.recovery} onChange={(event) => set("recovery", event.target.value)}>
              <option value="">Não informar</option>
              {Object.entries(RECOVERY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="check-row">
          <input
            type="checkbox"
            checked={values.discomfort}
            onChange={(event) => set("discomfort", event.target.checked)}
          />
          Estou com dor ou desconforto
        </label>
        {values.discomfort && (
          <label>
            Onde e como é? (opcional)
            <textarea
              rows={3}
              value={values.discomfortNotes}
              maxLength={500}
              onChange={(event) => set("discomfortNotes", event.target.value)}
            />
          </label>
        )}
        {form.questions.map((question) => (
          <label key={question.id}>
            {question.text}
            <textarea
              rows={2}
              value={values.answers[question.id] ?? ""}
              maxLength={ANSWER_MAX}
              onChange={(event) => set("answers", { ...values.answers, [question.id]: event.target.value })}
            />
          </label>
        ))}
        {form.askNotes && (
          <label>
            Observações
            <textarea
              rows={3}
              value={values.notes}
              maxLength={500}
              onChange={(event) => set("notes", event.target.value)}
            />
          </label>
        )}
      </fieldset>

      {values.discomfort && !locked && (
        <Notice tone="warning">
          <p>
            <strong>{PAIN_ADVICE}</strong> Ao salvar, o relato fica registrado para o seu profissional
            ler e não poderá ser alterado nem apagado.
          </p>
        </Notice>
      )}
      {message && (
        <p role={failed ? "alert" : "status"} className={failed ? "form-error" : "small muted"}>
          {message}
        </p>
      )}
      {!locked && (
        <div className="persist-actions">
          <button className="button primary" disabled={pending}>
            {pending ? "Salvando…" : checkinId ? "Salvar a correção" : "Salvar check-in"}
          </button>
          {checkinId && (
            <button type="button" className="button danger-outline" disabled={pending} onClick={remove}>
              <Trash2 size={16} /> Apagar este check-in
            </button>
          )}
        </div>
      )}
      <p className="small muted">
        Você pode corrigir ou apagar um check-in só no dia em que o fez, desde que ele não tenha relato de
        desconforto nem tenha sido lido ou respondido pelo profissional. Ele não altera o seu treino.
      </p>
    </form>
  );
}
