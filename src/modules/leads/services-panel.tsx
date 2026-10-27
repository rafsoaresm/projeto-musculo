"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveService, setServiceActive } from "./actions";
import type { ServiceRow } from "@/db/services";
import { DELIVERIES, DELIVERY_LABEL, SERVICE_DESCRIPTION_MAX, type Delivery } from "./contracts";
import { Pill } from "@/components/ui";

function ServiceForm({
  service,
  onDone,
  report,
}: {
  service?: ServiceRow;
  onDone: () => void;
  report: (ok: boolean, message: string) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(service?.name ?? "");
  const [delivery, setDelivery] = useState<Delivery>(service?.delivery ?? "ONLINE");
  const [description, setDescription] = useState(service?.description ?? "");
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="stack-form"
      aria-label={service ? `Editar o serviço ${service.name}` : "Novo serviço"}
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const result = await saveService(service?.id ?? null, { name, delivery, description });
          report(result.ok, result.message);
          if (result.ok) {
            if (!service) {
              setName("");
              setDescription("");
            }
            onDone();
          }
          router.refresh();
        });
      }}
    >
      <label>
        Nome do serviço
        <input value={name} onChange={(event) => setName(event.target.value)} maxLength={160} autoComplete="off" required />
      </label>
      <label>
        Como é entregue
        <select value={delivery} onChange={(event) => setDelivery(event.target.value as Delivery)}>
          {DELIVERIES.map((d) => (
            <option key={d} value={d}>
              {DELIVERY_LABEL[d]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Descrição (opcional)
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={SERVICE_DESCRIPTION_MAX}
          rows={3}
        />
      </label>
      <div className="persist-actions">
        <button className="button primary" disabled={pending}>
          {pending ? "Salvando…" : service ? "Salvar o serviço" : "Criar serviço"}
        </button>
        {service && (
          <button type="button" className="button secondary" disabled={pending} onClick={onDone}>
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}

export function ServicesPanel({ services, canWrite }: { services: ServiceRow[]; canWrite: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const report = (ok: boolean, text: string) => {
    setFailed(!ok);
    setMessage(text);
  };
  return (
    <>
      {canWrite && (
        <section className="panel" aria-labelledby="novo-servico">
          <h2 id="novo-servico">Novo serviço</h2>
          <ServiceForm onDone={() => undefined} report={report} />
        </section>
      )}
      <section className="panel" aria-labelledby="lista-servicos">
        <h2 id="lista-servicos">O que você oferece</h2>
        {message && (
          <p role={failed ? "alert" : "status"} className={failed ? "form-error" : "small muted"}>
            {message}
          </p>
        )}
        {services.length === 0 ? (
          <p>Nenhum serviço cadastrado ainda. Cadastre o que você vende para ligá-lo aos seus leads.</p>
        ) : (
          <ul className="service-list" aria-label="Serviços">
            {services.map((service) => (
              <li key={service.id}>
                {editing === service.id ? (
                  <ServiceForm service={service} onDone={() => setEditing(null)} report={report} />
                ) : (
                  <>
                    <div className="service-main">
                      <h3>{service.name}</h3>
                      <p className="small">
                        <Pill tone={service.active ? "brand" : "neutral"}>{service.active ? DELIVERY_LABEL[service.delivery] : "Fora da oferta"}</Pill>{" "}
                        {service.leads === 1 ? "1 lead" : `${service.leads} leads`}
                      </p>
                      {service.description && <p className="small muted">{service.description}</p>}
                    </div>
                    {canWrite && (
                      <div className="persist-actions">
                        <button
                          type="button"
                          className="button small secondary"
                          aria-label={`Editar ${service.name}`}
                          onClick={() => (setMessage(""), setEditing(service.id))}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          className="button small secondary"
                          disabled={pending}
                          aria-label={`${service.active ? "Tirar da oferta" : "Voltar à oferta"}: ${service.name}`}
                          onClick={() =>
                            startTransition(async () => {
                              const result = await setServiceActive(service.id, !service.active);
                              report(result.ok, result.message);
                              router.refresh();
                            })
                          }
                        >
                          {service.active ? "Tirar da oferta" : "Voltar à oferta"}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
