"use client";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { pageContent, type SiteContent } from "./contracts";
import { SiteRenderer, type ImageResolver } from "./renderer";
import { InlineSiteStyles } from "./site-styles";
import { siteNav } from "./site-nav";
import type { SectionRef } from "./guided-state";
import { PreviewStage, PreviewWidthTools } from "./preview-stage";
import type { PreviewWidth } from "./preview-scale";

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
  const [width, setWidth] = useState<PreviewWidth>("computador");
  const page = useMemo(() => pageContent(content, pageId), [content, pageId]);
  const nav = useMemo(() => siteNav(content, pageId, () => "#", onPage), [content, pageId, onPage]);

  useEffect(() => {
    const root = frame.current;
    if (!root || selected === null) return;
    const target = root.querySelector<HTMLElement>(`[data-guided-section="${CSS.escape(selected)}"], [data-guided-part="${CSS.escape(selected)}"]`);
    if (!target) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Only the preview's own box scrolls: the editor around it stays where it is.
    const box = root.closest<HTMLElement>(".guided-frame-scroll") ?? root;
    const top = target.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 16;
    box.scrollTo({ top, behavior: reduced ? "auto" : "smooth" });
  }, [selected, pageId]);

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
