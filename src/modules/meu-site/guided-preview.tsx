"use client";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { pageContent, type SiteContent } from "./contracts";
import { SiteRenderer, type ImageResolver } from "./renderer";
import { InlineSiteStyles } from "./site-styles";
import { siteNav } from "./site-nav";
import type { SectionRef } from "./guided-state";
import { PreviewStage, PreviewWidthTools } from "./preview-stage";
import type { PreviewWidth } from "./preview-scale";

/** The editor's narrow layout, where the preview opens over everything (globals.css, `.guided[data-preview]`). */
const NARROW_EDITOR = "(max-width: 720px)";

/**
 * The page as it will look (laid out at the width of a computer or of a phone and scaled to the panel, preview-stage.tsx), with the section being
 * edited outlined and brought into view. A click on a section chooses it; a click on the menu
 * shows that page. Nothing in it is followed (links, buttons, the form): it is a picture of the page that answers to the editor.
 */
export function GuidedPreview({
  content,
  pageId,
  selected,
  css,
  images,
  onPick,
  onPage,
  demoFolder,
}: {
  content: SiteContent;
  pageId: string;
  selected: SectionRef | null;
  css: string;
  images: ImageResolver;
  onPick: (section: SectionRef) => void;
  onPage: (pageId: string) => void;
  /** Where the models' sample photos are (they are shown while the site is being made). */
  demoFolder?: string;
}) {
  const frame = useRef<HTMLDivElement>(null);
  // Opened on a phone (the preview over everything, globals.css), it starts at the phone's width; the buttons choose either, and what is pressed is
  // what is shown. The editor is drawn only in the browser (site-workspace.tsx), so the window is there to ask.
  const [width, setWidth] = useState<PreviewWidth>(() => (typeof window !== "undefined" && window.matchMedia(NARROW_EDITOR).matches ? "celular" : "computador"));
  const page = useMemo(() => pageContent(content, pageId), [content, pageId]);
  const nav = useMemo(() => siteNav(content, pageId, () => "#", onPage), [content, pageId, onPage]);

  useEffect(() => {
    const root = frame.current;
    if (!root || selected === null) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Only the preview's own box scrolls: the editor around it stays where it is. Measured on the next frame, after the stage has taken the
    // height of the page at its width (preview-stage.tsx measures it when the page changes size).
    const box = root.closest<HTMLElement>(".guided-frame-scroll") ?? root;
    const frameId = requestAnimationFrame(() => {
      const target = root.querySelector<HTMLElement>(`[data-guided-section="${CSS.escape(selected)}"], [data-guided-part="${CSS.escape(selected)}"]`);
      if (!target) return;
      const top = target.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 16;
      box.scrollTo({ top, behavior: reduced ? "auto" : "smooth" });
    });
    return () => cancelAnimationFrame(frameId);
    // Another width lays the page out again: the section is brought back into view at its new place.
  }, [selected, pageId, width]);

  const click = (event: MouseEvent<HTMLDivElement>) => {
    const element = event.target as HTMLElement;
    // The menu shows another page (its own handler); anything else that would go somewhere stays put.
    if (element.closest(".site-menu")) return;
    if (element.closest("a, button, form, input, textarea, select, summary")) event.preventDefault();
    const hit = element.closest<HTMLElement>("[data-guided-section], [data-guided-part]");
    const ref = hit?.dataset.guidedSection ?? hit?.dataset.guidedPart;
    if (ref) onPick(ref);
  };

  return (
    <>
      <PreviewWidthTools width={width} onWidth={setWidth} />
      <p className="small muted" id="previa-dica">
        Clique em uma parte da página para editar o que ela diz.
      </p>
      <div className="guided-frame-scroll">
        {/* A click chooses a section; the keyboard path is the list of sections. */}
        <PreviewStage width={width} frameRef={frame} onClickCapture={click} aria-describedby="previa-dica">
          <InlineSiteStyles css={css} />
          <SiteRenderer content={page} images={images} nav={nav} locate={{ selected }} demoFolder={demoFolder} />
        </PreviewStage>
      </div>
    </>
  );
}
