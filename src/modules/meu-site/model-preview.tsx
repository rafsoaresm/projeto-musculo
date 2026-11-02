"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { HOME, pageContent, pagesOf } from "./contracts";
import { previewOf } from "./page-model";
import { SITE_MODEL_LABEL, type SiteModel } from "./page-models";
import { SiteRenderer } from "./renderer";
import { buildSiteCss } from "./site-css";
import { demoFolder } from "./image-urls";
import { demoKeyOf, demoPhotoUrl } from "./models/demo-photos";
import { useMountPath } from "@/components/use-mount-path";
import { InlineSiteStyles } from "./site-styles";
import { siteNav } from "./site-nav";
import { PreviewStage, PreviewWidthTools } from "./preview-stage";
import type { PreviewWidth } from "./preview-scale";

/**
 * A model of site seen whole before it is chosen: every page (through its own menu), at the width of a computer or of a phone. Nothing is created:
 * it is the starting document drawn in the browser, with the name typed in the form. Links and buttons go nowhere here.
 */
export function ModelPreview({ model, title, onUse, onClose }: { model: SiteModel; title: string; onUse: () => void; onClose: () => void }) {
  const content = useMemo(() => previewOf(model, title.trim() || "Seu nome"), [model, title]);
  const [pageId, setPageId] = useState(HOME);
  const [width, setWidth] = useState<PreviewWidth>("computador");
  const closeButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  // Read through a ref, so a new function from the form's render does not move the focus back to "Fechar".
  const closing = useRef(onClose);
  useEffect(() => {
    closing.current = onClose;
  }, [onClose]);
  const page = useMemo(() => pageContent(content, pageId), [content, pageId]);
  const nav = useMemo(() => siteNav(content, pageId, () => "#", setPageId), [content, pageId]);
  // Shown only after a click (never drawn on the server), so the mount path of the window is read here.
  const folder = demoFolder(useMountPath()());
  const css = useMemo(
    () =>
      buildSiteCss(content, {
        container: true,
        imageUrl: (id) => {
          const demo = demoKeyOf(id);
          return demo ? demoPhotoUrl(folder, demo) : null;
        },
      }),
    [content, folder],
  );

  useEffect(() => {
    // Opened over the form: the focus goes to "Fechar", stays inside while it is open (Tab goes round), and goes back to "Ver o modelo" after.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus();
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closing.current();
        return;
      }
      if (event.key !== "Tab" || !dialog.current) return;
      const focusable = [...dialog.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), select, input, textarea, [tabindex]:not([tabindex="-1"])')].filter(
        (element) => element.offsetParent !== null,
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      const inside = dialog.current.contains(document.activeElement);
      if (event.shiftKey && (document.activeElement === first || !inside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !inside)) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", keys);
    return () => {
      window.removeEventListener("keydown", keys);
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  return (
    <div className="model-preview" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="modelo-titulo">
      <header className="model-preview-head">
        <div>
          <h2 id="modelo-titulo">Modelo: {SITE_MODEL_LABEL[model].label}</h2>
          <p className="small muted">
            Assim o site começa. Os textos de exemplo, as cores, o logotipo e as imagens você troca no Editor Guiado; o que só você pode dizer começa em branco.
          </p>
          <p className="model-preview-sample">Exemplo: números, preços, nomes e depoimentos desta prévia não vão para o seu site.</p>
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
        <PreviewWidthTools width={width} onWidth={setWidth} />
      </div>
      <div className="guided-frame-scroll model-preview-frame">
        <PreviewStage
          width={width}
          onClickCapture={(event) => {
            const element = event.target as HTMLElement;
            if (!element.closest(".site-menu") && element.closest("a, button, form")) event.preventDefault();
          }}
        >
          <InlineSiteStyles css={css} />
          <SiteRenderer content={page} images={() => null} nav={nav} demoFolder={folder} />
        </PreviewStage>
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
