"use client";
import { useCallback, useEffect, useMemo, useReducer, useRef, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { Eye, Redo2, Undo2, X } from "lucide-react";
import { useMountPath } from "@/components/use-mount-path";
import { HOME, pagesOf, referencedAssetIds, resolveServices, type PublishIssue, type SiteContent } from "./contracts";
import { demoFolder, editorImageUrl, libraryCssImages, libraryImages, previewPageUrl } from "./image-urls";
import { buildSiteCss } from "./site-css";
import type { ServiceChoice } from "@/db/sites";
import type { ImageSupport } from "./editor-inspector";
import { GUIDED_TABS, GUIDED_TAB_LABEL, guidedReducer, guidedTrail, normalizeGuided, startGuided, type GuidedTab, type SectionRef } from "./guided-state";
import { GuidedPreview } from "./guided-preview";
import { BrandPanel, ContentPanel, PagesTab, PublishPanel, SeoPanel } from "./guided-panels";

export type GuidedImages = Omit<ImageSupport, "src" | "usedIds">;

/**
 * The Editor Guiado (Figma `10:162`; rebuilt from the user's review of 02/11/2026): five tabs (Páginas, Conteúdo, Marca, SEO, Publicar), every
 * page of the site, the page as it will look next to the form with the section being edited outlined, and a trail that says where the person is.
 * The layout of each section stays as the model made it. On a phone the same tabs show one thing at a time and the preview opens over everything.
 */
export function GuidedEditor(props: {
  content: SiteContent;
  onEdit: (next: SiteContent, key?: string) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  services: ServiceChoice[];
  images: GuidedImages;
  slug: string;
  dirty: boolean;
  pending: boolean;
  live: boolean;
  onSave: () => void;
  onPublish: () => void;
  onPublishAnyway: () => void;
  issues: PublishIssue[];
  note: ReactNode;
  onClose: () => void;
}) {
  const { content, images } = props;
  const [raw, dispatch] = useReducer(guidedReducer, undefined, startGuided);
  // After an undo or a page deleted the state may point at nothing: it is read through normalizeGuided, which falls back to what exists.
  const state = normalizeGuided(content, raw);
  const base = useMountPath()();
  const liveServices = useMemo(() => new Map(props.services.map((service) => [service.id, service])), [props.services]);
  const resolved = useMemo(() => resolveServices(content, liveServices), [content, liveServices]);
  const resolver = useMemo(() => libraryImages(base, images.library), [base, images.library]);
  const css = useMemo(() => buildSiteCss(resolved, { ...libraryCssImages(base, images.library), container: true }), [resolved, base, images.library]);
  const support: ImageSupport = useMemo(
    () => ({ ...images, src: (assetId: string) => editorImageUrl(base, assetId), usedIds: new Set(referencedAssetIds(content)) }),
    [images, base, content],
  );
  const trail = guidedTrail(content, state);
  const pick = useCallback((section: SectionRef) => dispatch({ type: "pick", section }), []);
  const showPage = useCallback((pageId: string) => dispatch({ type: "page", pageId }), []);

  const tabs = useRef<Record<string, HTMLButtonElement | null>>({});
  const onTabKey = (event: KeyboardEvent) => {
    const index = GUIDED_TABS.indexOf(state.tab);
    const next =
      event.key === "ArrowRight" ? (index + 1) % GUIDED_TABS.length : event.key === "ArrowLeft" ? (index - 1 + GUIDED_TABS.length) % GUIDED_TABS.length : event.key === "Home" ? 0 : event.key === "End" ? GUIDED_TABS.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    const tab = GUIDED_TABS[next]!;
    dispatch({ type: "tab", tab });
    tabs.current[tab]?.focus();
  };

  // Escape closes the preview over everything (phone); the editor itself closes with its own button.
  useEffect(() => {
    if (!state.preview) return;
    const close = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") dispatch({ type: "preview", open: false });
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [state.preview]);

  const pageChoices = [{ id: HOME, label: "Página inicial" }, ...pagesOf(content).map((page) => ({ id: page.id, label: page.title || "Página sem título" }))];
  const pageSelect = (
    <label className="guided-page-select">
      Página em edição
      <select value={state.pageId} onChange={(event) => showPage(event.target.value)}>
        {pageChoices.map((choice) => (
          <option key={choice.id} value={choice.id}>
            {choice.label}
          </option>
        ))}
      </select>
    </label>
  );

  const panel: Record<GuidedTab, ReactNode> = {
    paginas: (
      <PagesTab
        content={content}
        pageId={state.pageId}
        slug={props.slug}
        onEdit={props.onEdit}
        onPage={showPage}
        onEditContent={(pageId) => {
          showPage(pageId);
          dispatch({ type: "tab", tab: "conteudo" });
        }}
      />
    ),
    conteudo: (
      <ContentPanel
        content={content}
        state={state}
        pageSelect={pageSelect}
        images={support}
        onEdit={props.onEdit}
        onSection={(section) => dispatch({ type: "section", section })}
        onBack={() => dispatch({ type: "back" })}
        onBrand={() => dispatch({ type: "tab", tab: "marca" })}
      />
    ),
    marca: <BrandPanel content={content} images={support} onEdit={props.onEdit} />,
    seo: <SeoPanel content={content} pageId={state.pageId} pageSelect={pageSelect} slug={props.slug} onEdit={props.onEdit} />,
    publicar: (
      <PublishPanel
        content={content}
        issues={props.issues}
        pending={props.pending}
        dirty={props.dirty}
        live={props.live}
        slug={props.slug}
        onSave={props.onSave}
        onPublish={props.onPublish}
        onPublishAnyway={props.onPublishAnyway}
        onGo={(pageId, section) => dispatch({ type: "pick", pageId, section })}
      />
    ),
  };

  const preview = (
    <GuidedPreview content={resolved} pageId={state.pageId} selected={state.tab === "conteudo" ? state.section : null} css={css} images={resolver} onPick={pick} onPage={showPage} demoFolder={demoFolder(base)} />
  );

  return (
    <div className="guided" role="dialog" aria-modal="true" aria-labelledby="editor-guiado" data-step={state.step} data-preview={state.preview ? "" : undefined}>
      <header className="guided-head">
        <div className="guided-title">
          <h1 id="editor-guiado">Editor Guiado</h1>
          <p className="guided-trail" aria-label="Onde você está">
            <span>{trail.page}</span>
            {state.tab === "conteudo" && trail.section && (
              <>
                {" › "}
                <span>{trail.section}</span>
              </>
            )}
            <span className="guided-status">
              {" · "}
              {props.live ? "Publicado" : "Rascunho"}
              {props.dirty ? " · alterações não salvas" : ""}
            </span>
          </p>
        </div>
        <div className="persist-actions">
          <button type="button" className="button small secondary" onClick={props.undo} disabled={!props.canUndo} aria-label="Desfazer">
            <Undo2 size={16} aria-hidden="true" />
          </button>
          <button type="button" className="button small secondary" onClick={props.redo} disabled={!props.canRedo} aria-label="Refazer">
            <Redo2 size={16} aria-hidden="true" />
          </button>
          <Link className="button muted-fill guided-wide-only" href={`/profissional/meu-site/${previewPageUrl(state.pageId === HOME ? null : state.pageId).slice(2)}`} target="_blank" rel="noopener noreferrer">
            Pré-visualizar
          </Link>
          <button type="button" className="button primary" disabled={props.pending || !props.dirty} onClick={props.onSave}>
            {props.pending ? "Salvando…" : "Salvar rascunho"}
          </button>
          <button type="button" className="button secondary" onClick={props.onClose} aria-label="Fechar o Editor Guiado">
            <X size={18} aria-hidden="true" /> Fechar
          </button>
        </div>
      </header>
      {props.note}
      <div role="tablist" aria-label="Partes do Editor Guiado" className="tab-pills guided-tabs" onKeyDown={onTabKey}>
        {GUIDED_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            id={`guiado-aba-${tab}`}
            aria-selected={state.tab === tab}
            aria-controls="guiado-painel"
            tabIndex={state.tab === tab ? 0 : -1}
            ref={(node) => {
              tabs.current[tab] = node;
            }}
            onClick={() => dispatch({ type: "tab", tab })}
          >
            {GUIDED_TAB_LABEL[tab]}
          </button>
        ))}
      </div>
      <div className="guided-body" data-tab={state.tab}>
        <div id="guiado-painel" role="tabpanel" aria-labelledby={`guiado-aba-${state.tab}`} className="guided-panel">
          {panel[state.tab]}
        </div>
        <section className="panel guided-preview" aria-labelledby="previa-da-pagina">
          <div className="guided-preview-head">
            <h2 id="previa-da-pagina">Prévia da página</h2>
            <button type="button" className="button small secondary guided-narrow-only" onClick={() => dispatch({ type: "preview", open: false })}>
              Fechar prévia
            </button>
          </div>
          {preview}
        </section>
      </div>
      <div className="guided-bar guided-narrow-only">
        <button type="button" className="button primary" onClick={() => dispatch({ type: "preview", open: true })}>
          <Eye size={16} aria-hidden="true" /> Ver prévia
        </button>
      </div>
    </div>
  );
}

