"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSite } from "./actions";
import { SLUG_MAX, TITLE_MAX } from "./contracts";
import { SITE_MODELS, SITE_MODEL_LABEL, type SiteModel } from "./page-models";
import { SiteModelThumb } from "./site-model-thumb";

/** The first step: an address, a title and what the site starts with. Everything else is edited afterwards, in the draft. */
export function CreateSite({ suggestedSlug, suggestedTitle }: { suggestedSlug: string; suggestedTitle: string }) {
  const router = useRouter();
  const [slug, setSlug] = useState(suggestedSlug);
  const [title, setTitle] = useState(suggestedTitle);
  const [model, setModel] = useState<SiteModel>("single");
  // The new editor (Frappe Builder) is the one offered first; the first editor stays for whoever prefers its ready-made models.
  const [engine, setEngine] = useState<"frappe" | "native">("frappe");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="stack-form"
      aria-label="Criar o meu site"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const result = await createSite(slug, title, engine === "native" ? model : "single", engine);
          setMessage(result.ok ? "" : result.message);
          if (result.ok) router.refresh();
        });
      }}
    >
      <label>
        Título do site
        <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={TITLE_MAX} autoComplete="off" required />
      </label>
      <label>
        Endereço (letras minúsculas, números e hífens)
        <input value={slug} onChange={(event) => setSlug(event.target.value)} maxLength={SLUG_MAX} autoComplete="off" required />
      </label>
      <fieldset className="ve-choice">
        <legend>Editor</legend>
        <label>
          <input type="radio" name="site-engine" checked={engine === "frappe"} onChange={() => setEngine("frappe")} /> <strong>Editor novo (Frappe Builder).</strong> Blocos livres, roda de cores e hexadecimal, fontes, imagens, cabeçalho e logotipo
          como blocos que você edita.
        </label>
        <label>
          <input type="radio" name="site-engine" checked={engine === "native"} onChange={() => setEngine("native")} /> <strong>Editor anterior.</strong> Mais simples, com modelos de site prontos.
        </label>
      </fieldset>
      {engine === "native" && (
      <fieldset className="ve-choice">
        <legend>Começar com</legend>
        <div className="model-choice">
          {SITE_MODELS.map((entry) => (
            <label key={entry} className="model-card">
              <SiteModelThumb model={entry} />
              <span className="model-head">
                <input type="radio" name="site-model" checked={model === entry} onChange={() => setModel(entry)} />
                <strong>{SITE_MODEL_LABEL[entry].label}.</strong>
              </span>
              <span className="model-hint">{SITE_MODEL_LABEL[entry].hint}</span>
            </label>
          ))}
        </div>
      </fieldset>
      )}
      <p className="small muted">
        {engine === "native" ? (
          <>
            O site fica em <code>/s/{slug || "seu-endereco"}</code> e só aparece para as pessoas depois que você publicar. Dá para mudar o endereço enquanto ele estiver fora do ar.
          </>
        ) : (
          <>
            O site fica em <code>/site/{slug || "seu-endereco"}</code> (e <code>/s/{slug || "seu-endereco"}</code> leva até ele). Só aparece para as pessoas depois que você publicar uma página no editor.
          </>
        )}
      </p>
      {message && (
        <p role="alert" className="form-error">
          {message}
        </p>
      )}
      <div className="persist-actions">
        <button className="button primary" disabled={pending}>
          {pending ? "Criando…" : "Criar meu site"}
        </button>
      </div>
    </form>
  );
}
