"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSite } from "./actions";
import { SLUG_MAX, TITLE_MAX } from "./contracts";
import { OFFERED_SITE_MODELS, SITE_MODEL_LABEL, type SiteModel } from "./page-models";
import { ModelPreview } from "./model-preview";
import { SiteModelThumb } from "./site-model-thumb";
import { useMountPath } from "@/components/use-mount-path";

type Engine = "native" | "frappe";

/** The two editors as the creation offers them (handoff V4, Figma `10:2`): the same weight, nothing chosen beforehand. */
const EDITORS: Record<Engine, { name: string; tag: string; text: string; items: string[]; confirm: string; other: string }> = {
  native: {
    name: "Editor Guiado",
    tag: "Mais simples para começar",
    text: "Personalize por etapas, sem precisar construir cada elemento.",
    items: ["Comece com um modelo pronto", "Ajuste textos, imagens e identidade", "Organize seções sem complexidade"],
    confirm: "Você vai montar as páginas deste site por seções, com textos, imagens e identidade.",
    other: "Editor Avançado",
  },
  frappe: {
    name: "Editor Avançado",
    tag: "Mais liberdade de criação",
    text: "Crie páginas com maior controle visual utilizando o Frappe Builder.",
    items: ["Edite blocos e estrutura do layout", "Personalize estilos e responsividade", "Mais opções de composição visual"],
    confirm: "Você utilizará o Frappe Builder para construir e personalizar as páginas deste site.",
    other: "Editor Guiado",
  },
};

/**
 * Creating the site in two steps: choose the editor, then confirm (Figma `10:2` and `10:46`). The choice is final for this site (decision D1):
 * the server keeps it, and using the other editor means deleting the site and starting again. After creating, the chosen editor opens.
 */
export function CreateSite({ suggestedSlug, suggestedTitle }: { suggestedSlug: string; suggestedTitle: string }) {
  const router = useRouter();
  const [engine, setEngine] = useState<Engine | null>(null);
  const [slug, setSlug] = useState(suggestedSlug);
  const [title, setTitle] = useState(suggestedTitle);
  const [model, setModel] = useState<SiteModel>("trainix");
  const [previewing, setPreviewing] = useState<SiteModel | null>(null);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const heading = useRef<HTMLHeadingElement>(null);
  const mountPath = useMountPath();
  useEffect(() => heading.current?.focus(), [engine]);

  if (!engine)
    return (
      <div className="create-site">
        <ol className="create-steps" aria-label="Etapas">
          <li aria-current="step">1. Escolha</li>
          <li>2. Confirme</li>
        </ol>
        <h2 className="sr-only" tabIndex={-1} ref={heading}>
          Escolha o editor do site
        </h2>
        <div className="editor-cards">
          {(["native", "frappe"] as const).map((key) => (
            <section key={key} className="editor-card" aria-labelledby={`editor-${key}`}>
              <span className="editor-tag">{EDITORS[key].tag}</span>
              <h3 id={`editor-${key}`}>{EDITORS[key].name}</h3>
              <p className="muted">{EDITORS[key].text}</p>
              <ul>
                {EDITORS[key].items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <button type="button" className="button primary" onClick={() => setEngine(key)}>
                Escolher {EDITORS[key].name}
              </button>
            </section>
          ))}
        </div>
        <div className="callout-warning" role="note">
          <strong>Importante: escolha definitiva para este site</strong>
          <p>
            Depois de iniciar a criação, este site só poderá ser editado no editor escolhido. Não será possível alternar entre os dois editores no
            mesmo site.
          </p>
        </div>
      </div>
    );

  const editor = EDITORS[engine];
  return (
    <div className="create-site">
      <ol className="create-steps" aria-label="Etapas">
        <li>1. Escolha</li>
        <li aria-current="step">2. Confirme</li>
      </ol>
      <form
        className="confirm-card stack-form"
        aria-label="Criar o meu site"
        onSubmit={(event) => {
          event.preventDefault();
          startTransition(async () => {
            const result = await createSite(slug, title, engine === "native" ? model : "single", engine);
            setMessage(result.ok ? "" : result.message);
            if (!result.ok) return;
            if (engine === "frappe") router.push("/profissional/meu-site/editor");
            else router.refresh();
          });
        }}
      >
        <span className="editor-tag">{editor.name.toUpperCase()}</span>
        <h2 id="confirmar-editor" tabIndex={-1} ref={heading}>
          Criar site com o {editor.name}?
        </h2>
        <p className="muted">{editor.confirm}</p>
        <label>
          Título do site
          <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={TITLE_MAX} autoComplete="off" required />
        </label>
        <label>
          Endereço (letras minúsculas, números e hífens)
          <input value={slug} onChange={(event) => setSlug(event.target.value)} maxLength={SLUG_MAX} autoComplete="off" required />
        </label>
        {engine === "native" && (
          // The list of models is drawn only after the person chose the Editor Guiado (a click): the window's mount path is there to read.
          <fieldset className="ve-choice">
            <legend>Começar com</legend>
            <div className="model-choice">
              {OFFERED_SITE_MODELS.map((entry) => (
                <div key={entry} className="model-card">
                  <label className="model-pick">
                    <SiteModelThumb model={entry} base={mountPath()} />
                    <span className="model-head">
                      <input type="radio" name="site-model" checked={model === entry} onChange={() => setModel(entry)} />
                      <strong>{SITE_MODEL_LABEL[entry].label}.</strong>
                    </span>
                    <span className="model-hint">{SITE_MODEL_LABEL[entry].hint}</span>
                  </label>
                  <button type="button" className="button small secondary" onClick={() => setPreviewing(entry)} aria-label={`Ver o modelo ${SITE_MODEL_LABEL[entry].label}`}>
                    Ver o modelo
                  </button>
                </div>
              ))}
            </div>
          </fieldset>
        )}
        <p className="small muted">
          O site fica em <code>/{engine === "native" ? "s" : "site"}/{slug || "seu-endereco"}</code> e só aparece para as pessoas depois que você
          publicar.
        </p>
        <div className="callout-warning" role="note">
          <strong>Sua escolha não poderá ser alterada</strong>
          <p>Depois da criação, não será possível editar este mesmo site com o {editor.other}.</p>
        </div>
        {message && (
          <p role="alert" className="form-error">
            {message}
          </p>
        )}
        <div className="persist-actions">
          <button type="button" className="button muted-fill" onClick={() => setEngine(null)} disabled={pending}>
            Voltar e escolher
          </button>
          <button className="button primary" disabled={pending}>
            {pending ? "Criando…" : "Confirmar e criar site"}
          </button>
        </div>
      </form>
      {previewing && (
        <ModelPreview
          model={previewing}
          title={title}
          onUse={() => {
            setModel(previewing);
            setPreviewing(null);
          }}
          onClose={() => setPreviewing(null)}
        />
      )}
    </div>
  );
}
