"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { addLeadNote, convertLead, deleteLead, moveLead } from "./actions";
import type { StudentMatch } from "@/db/leads";
import {
  HEALTH_WARNING,
  LEAD_STAGES,
  LEAD_STAGE_LABEL,
  LOST_REASONS,
  LOST_REASON_LABEL,
  NOTE_MAX,
  type LeadStage,
} from "./contracts";

const REASON_LABEL = { email: "mesmo e-mail", phone: "mesmo telefone", name: "mesmo nome" } as const;

/** The answer stays on screen after a refresh: it lives here, not in what the refresh replaces. */
function Answer({ message, failed }: { message: string; failed: boolean }) {
  if (!message) return null;
  return (
    <p role={failed ? "alert" : "status"} className={failed ? "form-error" : "small muted"}>
      {message}
    </p>
  );
}

export function MoveLead({ leadId, stage, converted }: { leadId: string; stage: LeadStage; converted: boolean }) {
  const router = useRouter();
  const [chosen, setChosen] = useState<LeadStage>(stage === "NEW" ? "CONTACT" : "NEW");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  if (converted)
    return <p className="small muted">Este lead virou aluno e não muda mais de etapa.</p>;
  // After a move the chosen stage may be the one the lead is in now: the first other stage is shown and sent.
  const options = LEAD_STAGES.filter((s) => s !== stage);
  const to = options.includes(chosen) ? chosen : options[0];

  return (
    <form
      className="stack-form"
      aria-label="Mudar a etapa do lead"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const result = await moveLead(leadId, stage, { to, lostReason: to === "LOST" ? reason : "", note });
          setFailed(!result.ok);
          setMessage(result.message);
          if (result.ok) setNote("");
          router.refresh();
        });
      }}
    >
      <label>
        Mover para
        <select value={to} onChange={(event) => setChosen(event.target.value as LeadStage)}>
          {options.map((s) => (
            <option key={s} value={s}>
              {LEAD_STAGE_LABEL[s]}
            </option>
          ))}
        </select>
      </label>
      {to === "LOST" && (
        <label>
          Motivo da perda
          <select value={reason} onChange={(event) => setReason(event.target.value)} required>
            <option value="">Escolha o motivo</option>
            {LOST_REASONS.map((r) => (
              <option key={r} value={r}>
                {LOST_REASON_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        Anotação sobre a mudança (opcional)
        <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={NOTE_MAX} rows={2} />
      </label>
      <Answer message={message} failed={failed} />
      <div className="persist-actions">
        <button className="button primary" disabled={pending}>
          {pending ? "Salvando…" : "Mudar a etapa"}
        </button>
      </div>
    </form>
  );
}

export function NoteLead({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="stack-form"
      aria-label="Anotar sobre o lead"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const result = await addLeadNote(leadId, note);
          setFailed(!result.ok);
          setMessage(result.message);
          if (result.ok) setNote("");
          router.refresh();
        });
      }}
    >
      <label>
        Anotação
        <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={NOTE_MAX} rows={3} required />
      </label>
      <p className="small muted">{HEALTH_WARNING}</p>
      <Answer message={message} failed={failed} />
      <div className="persist-actions">
        <button className="button secondary" disabled={pending}>
          {pending ? "Salvando…" : "Anotar"}
        </button>
      </div>
    </form>
  );
}

export function ConvertLead({
  leadId,
  stage,
  studentId,
  matches,
  canConvert,
}: {
  leadId: string;
  stage: LeadStage;
  studentId: string | null;
  matches: StudentMatch[];
  canConvert: boolean;
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const target = done ?? studentId;
  if (target)
    return (
      <div className="stack-form">
        <p>
          <strong>Este lead virou aluno.</strong> A origem e o histórico dele ficam aqui.
        </p>
        <Link className="button secondary" href={`/profissional/alunos/${target}`}>
          Abrir o aluno
        </Link>
        <Answer message={message} failed={failed} />
      </div>
    );
  if (stage !== "WON")
    return <p className="small muted">Marque o lead como “Contratado” para poder convertê-lo em aluno.</p>;
  if (!canConvert)
    return (
      <p className="small muted">
        Quem converte em aluno é quem atende: o proprietário ou a gestão. Avise essa pessoa de que o lead foi contratado.
      </p>
    );

  function run(how: { mode: "create" } | { mode: "link"; studentId: string }) {
    startTransition(async () => {
      const result = await convertLead(leadId, how);
      if (result.status === "error") {
        setFailed(true);
        setMessage(result.message);
      } else {
        setFailed(false);
        setMessage(result.message);
        setDone(result.studentId);
      }
      router.refresh();
    });
  }

  return (
    <div className="stack-form">
      <p className="small muted">
        Converter cria o aluno só com o nome; a ficha e o resto são preenchidos depois, na área do aluno. O lead continua
        aqui, com a origem.
      </p>
      {matches.length > 0 && (
        <div className="notice warning" role="alert">
          <div>
            <p>
              <strong>Esta pessoa parece já ser aluno seu:</strong>
            </p>
            <ul>
              {matches.map((match) => (
                <li key={match.id}>
                  {match.displayName} ({match.reasons.map((r) => REASON_LABEL[r]).join(", ")}){" "}
                  <button
                    type="button"
                    className="button small secondary"
                    disabled={pending}
                    aria-label={`Ligar o lead ao aluno ${match.displayName}`}
                    onClick={() => run({ mode: "link", studentId: match.id })}
                  >
                    Ligar a este aluno
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      <div className="persist-actions">
        <button type="button" className="button primary" disabled={pending} onClick={() => run({ mode: "create" })}>
          {pending ? "Aguarde…" : matches.length > 0 ? "Criar um aluno novo mesmo assim" : "Converter em aluno"}
        </button>
      </div>
      <Answer message={message} failed={failed} />
    </div>
  );
}

/** Two clicks: deleting a lead takes its whole history with it. */
export function DeleteLead({ leadId, name }: { leadId: string; name: string }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  return (
    <div className="stack-form">
      {asking ? (
        <>
          <p className="small">Apagar {name} e todo o histórico dele? Isso não tem volta.</p>
          <div className="persist-actions">
            <button
              type="button"
              className="button danger-outline"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await deleteLead(leadId);
                  setMessage(result.message);
                  setAsking(false);
                  if (result.ok) {
                    router.push("/profissional/leads");
                  }
                  router.refresh();
                })
              }
            >
              {pending ? "Aguarde…" : `Confirmar: apagar ${name}`}
            </button>
            <button type="button" className="button secondary" disabled={pending} onClick={() => setAsking(false)}>
              Voltar
            </button>
          </div>
        </>
      ) : (
        <div className="persist-actions">
          <button type="button" className="button small secondary" onClick={() => (setMessage(""), setAsking(true))}>
            Apagar este lead
          </button>
        </div>
      )}
      <Answer message={message} failed />
    </div>
  );
}
