"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { HOME, pageContent, pagesOf } from "./contracts";
import { starterOf } from "./page-model";
import { SITE_MODEL_LABEL, type SiteModel } from "./page-models";
import { SiteRenderer } from "./renderer";
import { buildSiteCss } from "./site-css";
import { InlineSiteStyles } from "./site-styles";
import { siteNav } from "./site-nav";

/**
 * A model of site seen whole before it is chosen: every page (through its own menu), at the width of a computer or of a phone. Nothing is created:
 * it is the starting document drawn in the browser, with the name typed in the form. Links and buttons go nowhere here.
 */
export function ModelPreview({ model, title, onUse, onClose }: { model: SiteModel; title: string; onUse: () => void; onClose: () => void }) {
  const content = useMemo(() => starterOf(model, title.trim() || "Seu nome"), [model, title]);
  const [pageId, setPageId] = useState(HOME);
  const [width, setWidth] = useState<"computador" | "celular">("computador");
  const closeButton = useRef<HTMLButtonElement>(null);
  const page = useMemo(() => pageContent(content, pageId), [content, pageId]);
  const nav = useMemo(() => siteNav(content, pageId, () => "#", setPageId), [content, pageId]);
  const css = useMemo(() => buildSiteCss(content, { container: true, imageUrl: () => null }), [content]);

  useEffect(() => {
    closeButton.current?.focus();
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  return (
    <div className="model-preview" role="dialog" aria-modal="true" aria-labelledby="modelo-titulo">
      <header className="model-preview-head">
        <div>
          <h2 id="modelo-titulo">Modelo: {SITE_MODEL_LABEL[model].label}</h2>
          <p className="small muted">
            Assim o site começa. Os textos de exemplo, as cores, o logotipo e as imagens você troca no Editor Guiado; o que só você pode dizer começa em branco.
          </p>
        </div>
        <button type="button" className="button secondary" ref={closeButton} onClick={onClose} aria-label="Fechar a prévia do modelo">
          <X size={18} aria-hidden="true" /> Fechar
        </button>
      </header>
      <div className="model-preview-tools">
        <label>
          Página
          <select value={pageId} onChange={(event) => setPageId(event.target.value)}>
            <option value={HOME}>Início</option>
            {pagesOf(content).map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.title}
              </option>
            ))}
          </select>
        </label>
        <div role="group" aria-label="Largura da prévia" className="guided-preview-tools">
          {(["computador", "celular"] as const).map((option) => (
            <button key={option} type="button" className="button small secondary" aria-pressed={width === option} onClick={() => setWidth(option)}>
              {option === "computador" ? "Computador" : "Celular"}
            </button>
          ))}
        </div>
      </div>
      <div className="guided-frame-scroll model-preview-frame">
        <div
          className="guided-frame"
          data-width={width}
          onClickCapture={(event) => {
            const element = event.target as HTMLElement;
            if (!element.closest(".site-menu") && element.closest("a, button, form")) event.preventDefault();
          }}
        >
          <InlineSiteStyles css={css} />
          <SiteRenderer content={page} images={() => null} nav={nav} />
        </div>
      </div>
      <div className="persist-actions model-preview-actions">
        <button type="button" className="button primary" onClick={onUse}>
          Usar este modelo
        </button>
        <button type="button" className="button secondary" onClick={onClose}>
          Voltar
        </button>
      </div>
    </div>
  );
}
