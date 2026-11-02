"use client";
import { useLayoutEffect, useRef, useState, type HTMLAttributes, type ReactNode, type RefObject } from "react";
import { PREVIEW_LABEL, PREVIEW_PX, PREVIEW_WIDTHS, previewScale, type PreviewWidth } from "./preview-scale";

/** The buttons that choose the width of the preview. */
export function PreviewWidthTools({ width, onWidth, className = "guided-preview-tools" }: { width: PreviewWidth; onWidth: (width: PreviewWidth) => void; className?: string }) {
  return (
    <div className={className} role="group" aria-label="Largura da prévia">
      {PREVIEW_WIDTHS.map((option) => (
        <button key={option} type="button" className="button small secondary" aria-pressed={width === option} onClick={() => onWidth(option)}>
          {PREVIEW_LABEL[option]}
        </button>
      ))}
    </div>
  );
}

/**
 * The page laid out at the width of a real screen (1280 or 390) in the frame the page's size rules read (`.guided-frame`, container `site-frame`),
 * scaled down to fit the width of the panel. The stage around it takes the scaled height, so the box that holds it scrolls what is seen. A scale is
 * only a drawing: a click lands on the element under the pointer, as on the page itself. Measured again when the panel or the page changes size.
 */
export function PreviewStage({
  width,
  frameRef,
  children,
  ...frame
}: { width: PreviewWidth; frameRef?: RefObject<HTMLDivElement | null>; children: ReactNode } & Omit<HTMLAttributes<HTMLDivElement>, "className" | "style" | "children">) {
  const stage = useRef<HTMLDivElement>(null);
  const ownFrame = useRef<HTMLDivElement>(null);
  const page = frameRef ?? ownFrame;
  const [available, setAvailable] = useState(0);
  const [height, setHeight] = useState(0);

  useLayoutEffect(() => {
    const box = stage.current;
    const inner = page.current;
    if (!box || !inner) return;
    const measure = () => {
      setAvailable(box.clientWidth);
      // The layout height (a transform does not change it).
      setHeight(inner.offsetHeight);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    observer.observe(inner);
    return () => observer.disconnect();
  }, [page]);

  // What is chosen is what is shown, at any width of the panel: only the scale changes (a phone panel shows the computer's page, smaller).
  const scale = previewScale(available, width);
  return (
    <div ref={stage} className="guided-stage" data-scale={scale.toFixed(3)} style={height > 0 ? { height: Math.ceil(height * scale) } : undefined}>
      <div ref={page} className="guided-frame" data-width={width} style={{ width: PREVIEW_PX[width], ...(scale < 1 ? { transform: `scale(${scale})`, margin: 0 } : null) }} {...frame}>
        {children}
      </div>
    </div>
  );
}
