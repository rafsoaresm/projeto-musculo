"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { answerDataRequest, erasePhotosForRequest } from "./actions";
import { ANSWER_OUTCOMES, type AnswerOutcome, type RequestKind } from "./contracts";

const ANSWER_LABEL: Record<AnswerOutcome, string> = {
  FULFILLED: "Atendido",
  PARTIALLY_FULFILLED: "Atendido em parte",
  DECLINED: "Não atendido",
};

/**
 * The professional's answer to a request from a student. The student reads the explanation, so a
 * refusal or a partial answer must carry one. A request to erase photos is carried out by the tool
 * (the files are removed from the private storage); everything else is the professional's decision
 * and is answered in words. Fields are controlled and sent from a handler.
 */
export function AnswerRequestForm({
  requestId,
  kind,
  photosStored,
}: {
  requestId: string;
  kind: RequestKind;
  photosStored: number;
}) {
  const router = useRouter();
  const photos = kind === "PHOTOS_DELETION";
  const [outcome, setOutcome] = useState<AnswerOutcome>(photos ? "DECLINED" : "FULFILLED");
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await answerDataRequest(requestId, { outcome, note });
      setFailed(Boolean(result.error));
      setMessage(result.error ?? "Resposta registrada.");
      if (result.answered) router.refresh();
    });
  }

  function erase() {
    startTransition(async () => {
      const result = await erasePhotosForRequest(requestId);
      setConfirming(false);
      setFailed(Boolean(result.error));
      setMessage(
        result.error ??
          (result.erased && result.erased.count > 0
            ? `${result.erased.count} foto${result.erased.count === 1 ? "" : "s"} apagada${result.erased.count === 1 ? "" : "s"}. Pedido atendido.`
            : "Nenhuma foto estava guardada. Pedido atendido."),
      );
      if (result.erased) router.refresh();
    });
  }

  return (
    <div className="stack-form request-answer">
      {photos && (
        <div className="stack-form">
          <p className="small">
            {photosStored > 0
              ? `Há ${photosStored} foto${photosStored === 1 ? "" : "s"} deste aluno guardada${photosStored === 1 ? "" : "s"}. Apagar remove os arquivos do armazenamento privado, não tem volta e fecha o pedido como atendido. A avaliação continua com o resto do registro, e fica anotado que a foto existiu e foi apagada a pedido do aluno.`
              : "Não há foto deste aluno guardada. Atender fecha o pedido."}
          </p>
          {!confirming ? (
            <div className="persist-actions">
              <button type="button" className="button" disabled={pending} onClick={() => setConfirming(true)}>
                {photosStored > 0 ? "Apagar as fotos" : "Atender o pedido"}
              </button>
            </div>
          ) : (
            <div className="persist-actions">
              <button type="button" className="button danger-outline" disabled={pending} onClick={erase}>
                {pending ? "Apagando…" : photosStored > 0 ? "Confirmar: apagar para sempre" : "Confirmar"}
              </button>
              <button type="button" className="button secondary" disabled={pending} onClick={() => setConfirming(false)}>
                Voltar
              </button>
            </div>
          )}
          <p className="small muted">
            Se a lei ou o seu dever profissional mandar manter alguma foto, recuse abaixo e explique: o aluno lê
            o motivo.
          </p>
        </div>
      )}
      <form className="stack-form" onSubmit={submit} aria-label="Responder ao pedido">
        {photos ? (
          <p className="small">Recusar este pedido</p>
        ) : (
          <label>
            Resposta
            <select
              value={outcome}
              onChange={(event) => {
                setOutcome(event.target.value as AnswerOutcome);
                setMessage("");
              }}
            >
              {ANSWER_OUTCOMES.map((option) => (
                <option key={option} value={option}>
                  {ANSWER_LABEL[option]}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          {outcome === "FULFILLED" ? "O que foi feito (opcional)" : "Explicação, que o aluno vai ler"}
          <textarea
            rows={3}
            value={note}
            maxLength={2000}
            required={outcome !== "FULFILLED"}
            onChange={(event) => {
              setNote(event.target.value);
              setMessage("");
            }}
          />
        </label>
        {message && (
          <p role={failed ? "alert" : "status"} className={failed ? "form-error" : "small muted"}>
            {message}
          </p>
        )}
        <div className="persist-actions">
          <button className="button secondary" disabled={pending}>
            {pending ? "Registrando…" : photos ? "Recusar com a explicação" : "Registrar a resposta"}
          </button>
        </div>
        <p className="small muted">
          A resposta é sua: a ferramenta não decide o pedido nem altera nenhum registro por causa dele
          {photos ? ", a não ser apagar as fotos quando você confirma" : ""}. Registros congelados (treino
          entregue, avaliação registrada) continuam como estão.
        </p>
      </form>
    </div>
  );
}
