"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Notice } from "@/components/ui";
import type { StudentCheckin } from "@/db/student-checkins";
import { PAIN_ADVICE } from "@/modules/execucao/contracts";
import { deleteCheckin, saveCheckin } from "./actions";
import { CHECKIN_URGENCY_NOTICE, DISCOMFORT_SAVED_TEXT, RECOVERY_LABELS } from "./contracts";

/**
 * The student's check-in of today. Everything is chosen or typed by the student: nothing is
 * prefilled and nothing is scored. Fields are controlled and sent from a handler (React 19 resets a
 * form after its action, which would erase the text if the server refuses it).
 */
export function CheckinForm({ studentId, today }: { studentId: string; today: StudentCheckin | null }) {
  const router = useRouter();
  const [effort, setEffort] = useState(today?.effort == null ? "" : String(today.effort));
  const [recovery, setRecovery] = useState(today?.recovery == null ? "" : String(today.recovery));
  const [discomfort, setDiscomfort] = useState(today?.discomfort ?? false);
  const [discomfortNotes, setDiscomfortNotes] = useState(today?.discomfortNotes ?? "");
  const [notes, setNotes] = useState(today?.notes ?? "");
  const [checkinId, setCheckinId] = useState<string | null>(today?.id ?? null);
  const [locked, setLocked] = useState(today !== null && !today.editable);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const touch = () => setMessage("");

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await saveCheckin(studentId, {
        effort: effort === "" ? null : Number(effort),
        recovery: recovery === "" ? null : Number(recovery),
        discomfort,
        discomfortNotes: discomfort ? discomfortNotes : null,
        notes,
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
      setEffort("");
      setRecovery("");
      setDiscomfort(false);
      setDiscomfortNotes("");
      setNotes("");
      setFailed(false);
      setMessage("Check-in apagado.");
      router.refresh();
    });
  }

  return (
    <form className="stack-form profile-form" onSubmit={save}>
      <Notice tone="warning">
        <p>{CHECKIN_URGENCY_NOTICE}</p>
      </Notice>
      <fieldset disabled={locked}>
        <legend>Como você está hoje</legend>
        <label>
          Esforço percebido nos últimos dias (0 a 10), se quiser informar
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
        <label>
          Quanto você sente que recuperou, se quiser informar
          <select
            value={recovery}
            onChange={(event) => {
              setRecovery(event.target.value);
              touch();
            }}
          >
            <option value="">Não informar</option>
            {Object.entries(RECOVERY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={discomfort}
            onChange={(event) => {
              setDiscomfort(event.target.checked);
              touch();
            }}
          />
          Estou com dor ou desconforto
        </label>
        {discomfort && (
          <label>
            Onde e como é? (opcional)
            <textarea
              rows={3}
              value={discomfortNotes}
              maxLength={500}
              onChange={(event) => {
                setDiscomfortNotes(event.target.value);
                touch();
              }}
            />
          </label>
        )}
        <label>
          Observações
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

      {discomfort && !locked && (
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
        Você pode corrigir ou apagar o check-in de hoje, só hoje, desde que ele não tenha relato de
        desconforto nem tenha sido lido pelo profissional. Um check-in por dia. Ele não altera o seu treino.
      </p>
    </form>
  );
}
