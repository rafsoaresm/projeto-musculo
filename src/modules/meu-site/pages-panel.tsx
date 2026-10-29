"use client";
import { useState } from "react";
import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from "lucide-react";
import { DESCRIPTION_MAX, HOME, MAX_PAGES, PAGE_TITLE_MAX, pageById, pageSlug, pagesOf, type SiteContent } from "./contracts";
import { PAGE_REFUSAL_MESSAGE, setDescription, setInMenu, setSlug, setTitle, type PageRefusal } from "./page-model";
import { PublicAddress } from "./public-address";
import { HOME_LABEL } from "./site-nav";

/** What the editor does with the pages of the site; the screen decides how (the document, the history and what is selected are its). */
export interface PageActions {
  go: (pageId: string) => void;
  add: () => void;
  duplicate: (pageId: string) => void;
  remove: (pageId: string) => void;
  move: (pageId: string, by: -1 | 1) => void;
}

const nameOf = (title: string) => title || "Página sem título";

/**
 * The pages of the site, as a list on the left of the editor: the home page and the others in the order of the menu. A click opens a page in the
 * editor (its blocks are the page, with the same tools as the home page); the buttons under the open page move, copy and delete it.
 */
export function PagesPanel({ content, currentId, actions, slug }: { content: SiteContent; currentId: string; actions: PageActions; slug: string }) {
  const pages = pagesOf(content);
  return (
    <div className="ve-library">
      <h3 className="ve-subtitle">Páginas do site</h3>
      <p className="small muted">
        A página inicial é o endereço do site. As outras têm um endereço depois dele, e as que estão no menu aparecem no cabeçalho de todas as páginas.
      </p>
      <ul className="ve-layers ve-pages" aria-label="Páginas do site">
        <li>
          <div className="ve-layer-row" data-depth={0}>
            <button type="button" className="ve-layer" aria-current={currentId === HOME ? "true" : undefined} aria-label="Abrir a página inicial" onClick={() => actions.go(HOME)}>
              <strong>{HOME_LABEL}</strong>
              <span className="ve-layer-text">Página inicial</span>
            </button>
          </div>
        </li>
        {pages.map((entry, index) => {
          const name = nameOf(entry.title);
          const open = currentId === entry.id;
          return (
            <li key={entry.id}>
              <div className="ve-layer-row" data-depth={0}>
                <button type="button" className="ve-layer" aria-current={open ? "true" : undefined} aria-label={`Abrir a página ${name}`} onClick={() => actions.go(entry.id)}>
                  <strong>{name}</strong>
                  <span className="ve-layer-text">
                    /{entry.slug}
                    {entry.inMenu === false ? " · fora do menu" : ""}
                  </span>
                </button>
              </div>
              {/* The buttons are of the page that is open: a row has no room for them in a narrow panel. */}
              {open && (
                <div className="ve-page-actions" role="group" aria-label={`Ações da página ${name}`}>
                  <button type="button" className="ve-icon-button" aria-label={`Subir a página ${name}`} title="Subir no menu" disabled={index === 0} onClick={() => actions.move(entry.id, -1)}>
                    <ArrowUp size={15} aria-hidden="true" />
                  </button>
                  <button type="button" className="ve-icon-button" aria-label={`Descer a página ${name}`} title="Descer no menu" disabled={index === pages.length - 1} onClick={() => actions.move(entry.id, 1)}>
                    <ArrowDown size={15} aria-hidden="true" />
                  </button>
                  <button type="button" className="ve-icon-button" aria-label={`Duplicar a página ${name}`} title="Duplicar a página com os blocos dela" onClick={() => actions.duplicate(entry.id)}>
                    <Copy size={15} aria-hidden="true" />
                  </button>
                  <button type="button" className="ve-icon-button" aria-label={`Excluir a página ${name}`} title="Excluir a página (dá para desfazer)" onClick={() => actions.remove(entry.id)}>
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p>
        <button type="button" className="button small secondary" disabled={pages.length >= MAX_PAGES} onClick={actions.add}>
          <Plus size={16} aria-hidden="true" /> Nova página
        </button>
      </p>
      {pages.length >= MAX_PAGES && <p className="small muted">O site aceita até {MAX_PAGES} páginas além da inicial.</p>}
      <p className="small muted ve-tip">
        Endereço do site: <PublicAddress slug={slug} />
      </p>
    </div>
  );
}

/**
 * The address of a page, typed over: what is accepted is written to the document at once, and what is not stays only in the field, with the reason
 * (a document with an address the server would refuse could not be saved). Leaving the field with a refused address puts the page's own back.
 */
function AddressField({ content, pageId, slug, onChange }: { content: SiteContent; pageId: string; slug: string; onChange: (next: SiteContent, key: string) => void }) {
  const [draft, setDraft] = useState({ text: slug, basedOn: slug });
  const [problem, setProblem] = useState<PageRefusal | null>(null);
  // The address was changed from outside (the first title of the page makes it, or an undo): the field shows it.
  const typed = pageSlug.safeParse(draft.text);
  if (draft.basedOn !== slug && !(typed.success && typed.data === slug)) setDraft({ text: slug, basedOn: slug });
  return (
    <>
      <label>
        Endereço da página
        <input
          value={draft.text}
          maxLength={40}
          autoComplete="off"
          aria-invalid={problem ? true : undefined}
          onChange={(event) => {
            const text = event.target.value;
            const outcome = setSlug(content, pageId, text);
            setDraft({ text, basedOn: outcome.ok ? pageSlug.safeParse(text).data ?? slug : slug });
            setProblem(outcome.ok ? null : outcome.reason);
            if (outcome.ok) onChange(outcome.content, `page:${pageId}:slug`);
          }}
          onBlur={() => {
            if (problem) {
              setDraft({ text: slug, basedOn: slug });
              setProblem(null);
            }
          }}
        />
      </label>
      {problem && (
        <p className="form-error" role="alert">
          {PAGE_REFUSAL_MESSAGE[problem]}
        </p>
      )}
    </>
  );
}

/** The settings of the page being edited (a page other than the home page): its name in the menu, its address, what search engines show, and whether it is in the menu. */
export function SubpageSettings({ content, pageId, onChange, siteSlug }: { content: SiteContent; pageId: string; onChange: (next: SiteContent, key: string) => void; siteSlug: string }) {
  const page = pageById(content, pageId);
  if (!page) return null;
  return (
    <div className="ve-fields">
      <p className="small muted">
        Nada selecionado: estes são os dados desta página. O título do site, os contatos e as cores são os mesmos em todas as páginas e ficam na página inicial.
      </p>
      <label>
        Título da página
        <input value={page.title} maxLength={PAGE_TITLE_MAX} autoComplete="off" onChange={(event) => onChange(setTitle(content, pageId, event.target.value), `page:${pageId}:title`)} />
      </label>
      <p className="small muted">É o nome da página no menu e na aba do navegador. Sem título, a página fica fora do menu.</p>
      <AddressField key={page.id} content={content} pageId={pageId} slug={page.slug} onChange={onChange} />
      <p className="small muted">
        Endereço completo: <PublicAddress slug={siteSlug} path={`/${page.slug}`} />
      </p>
      <label>
        Descrição para buscadores (opcional)
        <textarea value={page.description} maxLength={DESCRIPTION_MAX} rows={2} onChange={(event) => onChange(setDescription(content, pageId, event.target.value), `page:${pageId}:description`)} />
      </label>
      <label className="check-row">
        <input type="checkbox" checked={page.inMenu !== false} onChange={(event) => onChange(setInMenu(content, pageId, event.target.checked), `page:${pageId}:menu`)} />
        <span>Aparecer no menu do site</span>
      </label>
      <p className="small muted">Fora do menu, a página continua no ar: quem tem o endereço, ou um botão que leve a ela, chega lá.</p>
    </div>
  );
}
