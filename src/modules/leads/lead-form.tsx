"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createLead, updateLead } from "./actions";
import type { LeadMatch } from "@/db/leads";
import { HEALTH_WARNING, LEAD_SOURCES_BY_HAND, LEAD_SOURCE_LABEL, LEAD_STAGE_LABEL, NOTE_MAX } from "./contracts";

export interface ServiceOption {
  id: string;
  name: string;
}
interface Values {
  name: string;
  email: string;
  phone: string;
  source: string;
  serviceId: string;
  note: string;
}

/**
 * One form for a new lead and for correcting an existing one. The fields are controlled and sent from the
 * handler: React 19 resets a form after its action, which would erase what was typed whenever the server
 * refuses it. A person who is already in the list is shown before saving, and saving anyway is a second,
 * deliberate click.
 */
export function LeadForm({
  services,
  leadId,
  initial,
  currentService,
}: {
  services: ServiceOption[];
  leadId?: string;
  initial?: Partial<Values>;
  /** The service the lead already has, kept in the list even if it left the offer. */
  currentService?: ServiceOption | null;
}) {
  const router = useRouter();
  const editing = Boolean(leadId);
  const [values, setValues] = useState<Values>({
    name: initial?.name ?? "",
    email: initial?.email ?? "",
    phone: initial?.phone ?? "",
    source: initial?.source ?? "INSTAGRAM",
    serviceId: initial?.serviceId ?? "",
    note: "",
  });
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [matches, setMatches] = useState<LeadMatch[]>([]);
  const [pending, startTransition] = useTransition();
  const options = currentService && !services.some((s) => s.id === currentService.id) ? [...services, { ...currentService, name: `${currentService.name} (fora da oferta)` }] : services;

  const set = (field: keyof Values) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setValues((current) => ({ ...current, [field]: event.target.value }));
    setMessage("");
    setMatches([]);
  };

  function send(confirm: boolean) {
    startTransition(async () => {
      setFailed(false);
      setMessage("");
      const payload = {
        name: values.name,
        email: values.email,
        phone: values.phone,
        source: values.source,
        serviceId: values.serviceId,
        ...(editing ? {} : { note: values.note }),
      };
      if (editing && leadId) {
        const result = await updateLead(leadId, payload);
        setFailed(!result.ok);
        setMessage(result.message);
        if (result.ok) router.refresh();
        return;
      }
      const result = await createLead(payload, confirm);
      if (result.status === "created") {
        router.push(`/profissional/leads/${result.id}`);
        router.refresh();
        return;
      }
      if (result.status === "duplicates") {
        setMatches(result.matches);
        return;
      }
      setFailed(true);
      setMessage(result.message);
    });
  }

  return (
    <form
      className="stack-form"
      aria-label={editing ? "Corrigir os dados do lead" : "Novo lead"}
      onSubmit={(event) => {
        event.preventDefault();
        send(false);
      }}
    >
      <label>
        Nome
        <input value={values.name} onChange={set("name")} maxLength={160} autoComplete="off" required />
      </label>
      <label>
        E-mail
        <input type="email" value={values.email} onChange={set("email")} maxLength={254} autoComplete="off" />
      </label>
      <label>
        Telefone ou WhatsApp
        <input type="tel" value={values.phone} onChange={set("phone")} maxLength={30} autoComplete="off" />
      </label>
      <p className="small muted">Informe pelo menos um dos dois: e-mail ou telefone.</p>
      <label>
        De onde veio
        <select value={values.source} onChange={set("source")}>
          {LEAD_SOURCES_BY_HAND.map((source) => (
            <option key={source} value={source}>
              {LEAD_SOURCE_LABEL[source]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Serviço de interesse
        <select value={values.serviceId} onChange={set("serviceId")}>
          <option value="">Ainda não sei</option>
          {options.map((service) => (
            <option key={service.id} value={service.id}>
              {service.name}
            </option>
          ))}
        </select>
      </label>
      {!editing && (
        <label>
          Primeira anotação (opcional)
          <textarea value={values.note} onChange={set("note")} maxLength={NOTE_MAX} rows={3} />
        </label>
      )}
      <p className="small muted">{HEALTH_WARNING}</p>

      {matches.length > 0 && (
        <div className="notice warning" role="alert">
          <div>
            <p>
              <strong>Esta pessoa parece já estar na lista:</strong>
            </p>
            <ul>
              {matches.map((match) => (
                <li key={match.id}>
                  <Link href={`/profissional/leads/${match.id}`}>{match.name}</Link> ({LEAD_STAGE_LABEL[match.stage]})
                </li>
              ))}
            </ul>
            <div className="persist-actions">
              <button type="button" className="button secondary" disabled={pending} onClick={() => send(true)}>
                Salvar mesmo assim
              </button>
              <button type="button" className="button secondary" disabled={pending} onClick={() => setMatches([])}>
                Voltar e conferir
              </button>
            </div>
          </div>
        </div>
      )}

      {message && (
        <p role={failed ? "alert" : "status"} className={failed ? "form-error" : "small muted"}>
          {message}
        </p>
      )}
      <div className="persist-actions">
        <button className="button primary" disabled={pending}>
          {pending ? "Salvando…" : editing ? "Salvar os dados" : "Salvar lead"}
        </button>
      </div>
    </form>
  );
}
