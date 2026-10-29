"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatDateTime } from "@/components/ui";
import type { InquiryRow } from "@/db/site-inquiries";
import { convertInquiry, discardInquiry } from "./inquiry-actions";

/**
 * The messages left in the contact form, each with the two things that can be done with it. Discarding asks first (it deletes what the person
 * wrote and nothing else keeps it); turning into a lead does not (it is the way to keep it). The answer stays on screen after the list refreshes,
 * even when it was the last message: the empty state is drawn here too, so this component is not taken away with the list (and the answer, with
 * the link to the new lead, is not lost).
 */
export function InquiryList({ inquiries }: { inquiries: InquiryRow[] }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [answer, setAnswer] = useState<{ text: string; failed: boolean; leadId?: string } | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <>
      {answer && (
        <p role={answer.failed ? "alert" : "status"} className={answer.failed ? "form-error" : "small"}>
          {answer.text}{" "}
          {answer.leadId && (
            <a href={`./${answer.leadId}`}>Abrir o lead</a>
          )}
        </p>
      )}
      {inquiries.length === 0 && (
        <section className="panel">
          <h2>Nenhuma mensagem esperando.</h2>
          <p>Quando alguém escrever no formulário do site, a mensagem aparece aqui.</p>
        </section>
      )}
      {inquiries.length > 0 && (
        <ul className="inquiry-list" aria-label="Mensagens do site">
          {inquiries.map((entry) => {
            const contact = entry.email ?? entry.phone ?? "";
            return (
              <li key={entry.id} className="panel">
                <h2>{entry.name}</h2>
                <p className="small">
                  <strong>{contact}</strong>
                  {entry.page ? ` · da página /${entry.page}` : " · da página inicial"} · {formatDateTime(entry.createdAt)}
                </p>
                {entry.sameContact > 0 && (
                  <p className="small muted">
                    Já há {entry.sameContact === 1 ? "um lead" : `${entry.sameContact} leads`} com este contato em Leads. Se for a mesma pessoa, você pode apagar esta mensagem em vez de criar outro.
                  </p>
                )}
                {entry.message ? <p className="inquiry-message">{entry.message}</p> : <p className="small muted">Sem mensagem: só o contato.</p>}
                <div className="persist-actions">
                  <button
                    type="button"
                    className="button primary"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        const result = await convertInquiry(entry.id);
                        setAnswer({ text: result.message, failed: !result.ok, leadId: result.leadId });
                        setConfirming(null);
                        router.refresh();
                      })
                    }
                  >
                    Virar lead
                  </button>
                  {confirming === entry.id ? (
                    <>
                      <button
                        type="button"
                        className="button danger-outline"
                        disabled={pending}
                        onClick={() =>
                          startTransition(async () => {
                            const result = await discardInquiry(entry.id);
                            setAnswer({ text: result.message, failed: !result.ok });
                            setConfirming(null);
                            router.refresh();
                          })
                        }
                      >
                        Confirmar: apagar a mensagem de {entry.name}
                      </button>
                      <button type="button" className="button secondary" onClick={() => setConfirming(null)}>
                        Voltar
                      </button>
                    </>
                  ) : (
                    <button type="button" className="button secondary" disabled={pending} onClick={() => setConfirming(entry.id)} aria-label={`Apagar a mensagem de ${entry.name}`}>
                      Apagar
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
