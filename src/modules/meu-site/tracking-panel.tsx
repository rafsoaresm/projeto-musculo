"use client";
import { useState, useTransition, type InputHTMLAttributes, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Pill } from "@/components/ui";
import { saveSiteTracking } from "./actions";
import { activeTools, trackingEvents, type TrackingField, type TrackingSettings } from "./tracking";

export const GTM_UNAVAILABLE =
  "O Google Tag Manager fica disponível quando o seu site tiver um endereço próprio, separado do app (por segurança: um contêiner do GTM pode rodar qualquer código)";

const reais = (cents: number | null) => (cents === null ? "" : (cents / 100).toFixed(2).replace(".", ","));

/**
 * "Rastreamento e conversões" (Meu Site 0.71), in the Configurações tab of both editors: the IDs of GA4, Google Ads and the Meta Pixel, what counts
 * as a conversion, the value of a contact and the site's privacy notice; what is on, and what each tool receives. The owner and the managers save;
 * the commercial members read. The server reads every field again; the messages of each field are shown next to it.
 */
export function TrackingPanel({ settings, canEdit }: { settings: TrackingSettings; canEdit: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Partial<Record<TrackingField, string>>>({});
  const [warnings, setWarnings] = useState<Partial<Record<TrackingField, string>>>({});
  const [note, setNote] = useState<{ text: string; failed: boolean } | null>(null);
  const tools = activeTools(settings);
  const events = trackingEvents(settings);
  // A new reading of the saved settings draws the form again with them (the IDs as they were kept: upper-case, without spaces).
  const formKey = JSON.stringify(settings);

  const problem = (field: TrackingField) => errors[field] ?? warnings[field];
  const described = (field: TrackingField, hint?: string) => [hint, problem(field) ? `rastreio-${field}-problema` : null].filter(Boolean).join(" ") || undefined;
  const message = (field: TrackingField) =>
    errors[field] ? (
      <p id={`rastreio-${field}-problema`} className="form-error-inline small" role="alert">
        {errors[field]}
      </p>
    ) : warnings[field] ? (
      <p id={`rastreio-${field}-problema`} className="small">
        <strong>Atenção:</strong> {warnings[field]}
      </p>
    ) : null;
  const text = (field: TrackingField, label: string, defaultValue: string, hint: ReactNode, extra: InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="tracking-field">
      <label htmlFor={`rastreio-${field}`}>
        {label}
        <input
          id={`rastreio-${field}`}
          name={field}
          defaultValue={defaultValue}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={errors[field] ? true : undefined}
          aria-describedby={described(field, `rastreio-${field}-dica`)}
          {...extra}
        />
      </label>
      <p id={`rastreio-${field}-dica`} className="small muted">
        {hint}
      </p>
      {message(field)}
    </div>
  );

  return (
    <section className="panel tracking-panel" aria-labelledby="rastreamento">
      <h2 id="rastreamento">Rastreamento e conversões</h2>
      <p className="small muted">
        Ligue o Google Analytics 4, o Google Ads e o Meta Pixel nas páginas publicadas do site. Nada disso é carregado antes de quem visita aceitar, no aviso de cookies que
        aparece no site; quem recusar não é medido. O texto do aviso ainda passa por revisão jurídica.
      </p>
      <p className="small">{tools.length > 0 ? <Pill tone="success">Ativo: {tools.join(", ")}</Pill> : <Pill>Nenhuma ferramenta ligada</Pill>}</p>

      <form
        key={formKey}
        className="stack-form"
        aria-label="Rastreamento e conversões"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const input: Record<string, string> = {};
          data.forEach((value, key) => {
            if (typeof value === "string") input[key] = value;
          });
          startTransition(async () => {
            const result = await saveSiteTracking(input);
            setErrors(result.ok ? {} : (result.errors ?? {}));
            setWarnings(result.ok ? result.warnings : {});
            setNote({ text: result.message, failed: !result.ok });
            if (result.ok) router.refresh();
          });
        }}
      >
        <fieldset className="tracking-fieldset" disabled={!canEdit || pending}>
          <legend>Google Analytics 4</legend>
          {text("ga4", "ID de medição do GA4", settings.ga4Id ?? "", <>Começa com G-. No GA4: Administrador › Fluxos de dados › o seu site.</>, { placeholder: "G-XXXXXXXXXX" })}
        </fieldset>

        <fieldset className="tracking-fieldset" disabled={!canEdit || pending}>
          <legend>Google Ads</legend>
          {text("adsId", "ID do Google Ads", settings.adsId ?? "", <>Começa com AW-. No Google Ads: Metas › Conversões › a ação › Configurar a tag (o valor antes da barra em send_to).</>, {
            placeholder: "AW-123456789",
          })}
          {text("adsLabelLead", "Rótulo da conversão do formulário", settings.adsLabelLead ?? "", <>O texto depois da barra em send_to da ação que conta as mensagens do formulário. Dá para colar “AW-…/rótulo” inteiro.</>)}
          {text("adsLabelContact", "Rótulo da conversão de contato (opcional)", settings.adsLabelContact ?? "", <>De outra ação, para os cliques de contato marcados abaixo (WhatsApp, e-mail…).</>)}
        </fieldset>

        <fieldset className="tracking-fieldset" disabled={!canEdit || pending}>
          <legend>Meta Pixel</legend>
          {text("meta", "ID do Meta Pixel", settings.metaPixelId ?? "", <>Só números (em geral 15 ou 16). No Gerenciador de Eventos da Meta: Fontes de dados › o seu pixel.</>, { inputMode: "numeric" })}
        </fieldset>

        <fieldset className="tracking-fieldset">
          <legend>Google Tag Manager</legend>
          <div className="tracking-field">
            <label htmlFor="rastreio-gtm">
              ID do contêiner do GTM
              <input id="rastreio-gtm" disabled placeholder="GTM-XXXXXXX" aria-describedby="rastreio-gtm-dica" />
            </label>
            <p id="rastreio-gtm-dica" className="small muted">
              {GTM_UNAVAILABLE}.
            </p>
          </div>
        </fieldset>

        <fieldset className="tracking-fieldset" disabled={!canEdit || pending}>
          <legend>O que conta como conversão</legend>
          <p className="small muted">Para o Google Ads e a Meta. O GA4 recebe os eventos de todos; lá você escolhe quais são eventos principais.</p>
          {(
            [
              ["form", "Mensagem pelo formulário"],
              ["whatsapp", "Clique no WhatsApp"],
              ["email", "Clique no e-mail"],
              ["instagram", "Clique no Instagram"],
            ] as const
          ).map(([method, label]) => (
            <label key={method} className="check-row">
              <input type="checkbox" name={`count_${method}`} defaultChecked={settings.count[method]} />
              <span>{label}</span>
            </label>
          ))}
          {text("leadValue", "Valor de um contato (opcional, R$)", reais(settings.leadValueCents), <>Quanto vale para você, em média, um contato que chega pelo site. Vai junto de cada conversão.</>, {
            inputMode: "decimal",
            placeholder: "150,00",
          })}
        </fieldset>

        <fieldset className="tracking-fieldset" disabled={!canEdit || pending}>
          <legend>Aviso de privacidade</legend>
          {text(
            "privacyUrl",
            "Endereço do aviso de privacidade do seu site",
            settings.privacyUrl ?? "",
            <>Aparece no aviso de cookies. Ele deve dizer quais ferramentas o site usa e para quê. Começa com https://.</>,
            { type: "url", inputMode: "url", placeholder: "https://" },
          )}
        </fieldset>

        {canEdit ? (
          <div className="persist-actions">
            <button type="submit" className="button primary" disabled={pending}>
              {pending ? "Salvando…" : "Salvar rastreamento"}
            </button>
          </div>
        ) : (
          <p className="small muted">Só o proprietário ou a gestão mudam o rastreamento.</p>
        )}
        {note && (
          <p role={note.failed ? "alert" : "status"} className={note.failed ? "form-error" : "small"}>
            {note.text}
          </p>
        )}
      </form>

      <h3>O que cada ferramenta recebe</h3>
      <div className="table-wrap">
        <table aria-label="Eventos do site por ferramenta">
          <thead>
            <tr>
              <th scope="col">Evento no site</th>
              <th scope="col">GA4</th>
              <th scope="col">Meta</th>
              <th scope="col">Google Ads</th>
            </tr>
          </thead>
          <tbody>
            {events.map((row) => (
              <tr key={row.event}>
                <th scope="row">{row.event}</th>
                <td>{row.ga4 ? <code>{row.ga4}</code> : "—"}</td>
                <td>{row.meta ? <code>{row.meta}</code> : "—"}</td>
                <td>{row.ads ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="small tracking-help">
        <li>
          No GA4, marque <code>generate_lead</code> como evento principal (Administrador › Eventos). Marque <code>contact</code> só se quiser contar os cliques; não marque{" "}
          <code>form_submit</code>.
        </li>
        <li>No Google Ads, use esta tag <strong>ou</strong> a importação do GA4 para a mesma ação, nunca as duas: a conversão seria contada duas vezes.</li>
        <li>Nenhum evento leva o nome, o e-mail, o telefone ou a mensagem de quem escreveu.</li>
        <li>A conversão do formulário só é contada na página de confirmação, quando a mensagem foi aceita, e uma vez só.</li>
      </ul>
    </section>
  );
}
