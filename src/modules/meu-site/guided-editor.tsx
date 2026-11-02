"use client";
import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import type { AssetRow } from "@/db/site-assets";
import { useMountPath } from "@/components/use-mount-path";
import { resolveServices, type SiteContent } from "./contracts";
import { fieldsOf, pageFields, sectionsOf, withField, type Field } from "./guided-model";
import { libraryCssImages, libraryImages } from "./image-urls";
import { SiteRenderer } from "./renderer";
import { buildSiteCss } from "./site-css";
import { InlineSiteStyles } from "./site-styles";
import type { ServiceChoice } from "@/db/sites";

/**
 * The Editor Guiado (handoff V4, Figma `10:162`; the user's decision of 01/11/2026): the sections of the page on the left, the page on the
 * right of them as it will look, and the content of the chosen section in a form. Only what the sections say is edited here (texts, buttons,
 * images and their descriptions, and the page's title and description); the layout stays as the model made it. Saving is the same draft,
 * revision and publication as everywhere else in Meu Site.
 */
export function GuidedEditor({
  content,
  onEdit,
  services,
  library,
  dirty,
  pending,
  live,
  onSave,
  onClose,
  note,
}: {
  content: SiteContent;
  onEdit: (next: SiteContent) => void;
  services: ServiceChoice[];
  library: AssetRow[];
  dirty: boolean;
  pending: boolean;
  live: boolean;
  onSave: () => void;
  onClose: () => void;
  note: ReactNode;
}) {
  const sections = sectionsOf(content);
  const [chosen, setChosen] = useState<string | null>(sections[0]?.id ?? null);
  const section = content.blocks.find((entry) => entry.id === chosen) ?? null;
  const base = useMountPath()();
  const liveServices = useMemo(() => new Map(services.map((service) => [service.id, service])), [services]);
  const resolved = useMemo(() => resolveServices(content, liveServices), [content, liveServices]);
  const images = useMemo(() => libraryImages(base, library), [base, library]);
  const css = useMemo(() => buildSiteCss(resolved, { ...libraryCssImages(base, library), container: true }), [resolved, base, library]);
  const fields = section ? fieldsOf(section) : [];
  const change = (field: Field, value: string) => onEdit(withField(content, field.key, value));

  return (
    <div className="guided" role="dialog" aria-modal="true" aria-labelledby="editor-guiado">
      <header className="guided-head">
        <div>
          <h1 id="editor-guiado">Editor Guiado</h1>
          <p className="small muted">
            Site profissional / Página inicial / {live ? "Publicado" : "Rascunho"}
            {dirty ? " · alterações não salvas" : ""}
          </p>
        </div>
        <div className="persist-actions">
          <Link className="button muted-fill" href="/profissional/meu-site/previa" target="_blank" rel="noopener noreferrer">
            Pré-visualizar
          </Link>
          <button type="button" className="button primary" disabled={pending || !dirty} onClick={onSave}>
            {pending ? "Salvando…" : "Salvar rascunho"}
          </button>
          <button type="button" className="button secondary" onClick={onClose} aria-label="Fechar o Editor Guiado">
            <X size={18} aria-hidden="true" /> Fechar
          </button>
        </div>
      </header>
      {note}
      <div className="guided-grid">
        <nav className="panel guided-sections" aria-labelledby="secoes-do-site">
          <h2 id="secoes-do-site">Seções do site</h2>
          {sections.length === 0 ? (
            <p className="small muted">A página ainda não tem seções.</p>
          ) : (
            <ul>
              {sections.map((entry) => (
                <li key={entry.id}>
                  <button type="button" aria-pressed={entry.id === chosen} onClick={() => setChosen(entry.id)}>
                    {entry.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </nav>
        <section className="panel guided-preview" aria-labelledby="previa-da-pagina">
          <h2 id="previa-da-pagina">Prévia da página</h2>
          <div className="guided-frame">
            <InlineSiteStyles css={css} />
            <SiteRenderer content={resolved} images={images} />
          </div>
        </section>
        <section className="panel guided-form" aria-labelledby="conteudo-da-secao">
          <h2 id="conteudo-da-secao">Conteúdo da seção</h2>
          {section && fields.length === 0 && <p className="small muted">Esta seção não tem textos nem imagens para editar aqui.</p>}
          {fields.map((field) => (
            <FieldInput key={field.key} field={field} library={library} base={base} onChange={(value) => change(field, value)} />
          ))}
          <h3>SEO da página</h3>
          {pageFields(content).map((field) => (
            <FieldInput key={field.key} field={field} library={library} base={base} onChange={(value) => change(field, value)} />
          ))}
        </section>
      </div>
    </div>
  );
}

function FieldInput({ field, library, base, onChange }: { field: Field; library: AssetRow[]; base: string; onChange: (value: string) => void }) {
  if (field.kind === "image")
    return (
      <label>
        {field.label}
        <select value={field.value} onChange={(event) => onChange(event.target.value)}>
          <option value="">Sem imagem</option>
          {library.map((asset, at) => (
            <option key={asset.id} value={asset.id}>
              Imagem {at + 1} ({asset.width} × {asset.height})
            </option>
          ))}
        </select>
        {library.length === 0 && <span className="small muted">Envie imagens pela biblioteca do site para escolher aqui.</span>}
        {field.value && (
          // A small image of the site's own library, behind the session (next/image would fetch it again through the optimizer).
          // eslint-disable-next-line @next/next/no-img-element
          <img className="guided-thumb" src={`${base}/profissional/meu-site/imagens/${field.value}`} alt="" />
        )}
      </label>
    );
  return (
    <label>
      {field.label}
      {field.kind === "multiline" ? (
        <textarea rows={3} value={field.value} maxLength={field.max} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input value={field.value} maxLength={field.max} onChange={(event) => onChange(event.target.value)} autoComplete="off" />
      )}
    </label>
  );
}
