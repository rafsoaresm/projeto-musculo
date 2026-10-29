"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type HTMLAttributes, type PointerEvent } from "react";
import type { Box } from "./canvas-view";
import type { SiteNode } from "./contracts";
import { GESTURE_PREFIX } from "./editor-history";
import {
  SNAP_SCREEN_PX,
  alignmentTargets,
  gapFrom,
  gapStrip,
  heightFrom,
  inward,
  paddingFrom,
  px,
  radiusFrom,
  sideMode,
  sidesFor,
  snapEdge,
  unscale,
  widthFrom,
  type Edge,
} from "./handles";
import type { Screen } from "./screens";
import { setSides, setStyleProps } from "./style-model";

/**
 * The handles over the selected block, as in the builders people know: dragging the right, bottom or corner handle sizes the block (and snaps to the
 * lines of the container and of the blocks before it, which are drawn as guides while it does); the bars just inside each edge change its padding (Shift
 * all four sides, Alt the side across); the bars in the gaps between the children of a row or column change the gap; the dot near the corner changes
 * the rounding. What a handle writes is a typed value in the style of the size of the screen being edited, the same one the style panel writes, so
 * nothing here can make a document the server would refuse (`handles.ts` keeps every number inside the style's own ranges).
 *
 * A drag is one gesture: all its changes carry the same history key, so undoing takes back the whole drag, and Escape gives it up. Handles are
 * for a pointer; the style panel has the same fields for the keyboard, so these are hidden from assistive technology.
 */

export interface Guide {
  axis: "x" | "y";
  /** Where it is, in the coordinates of the canvas layer. */
  at: number;
}

export interface HandleHost {
  node: SiteNode;
  label: string;
  /** The block's own element in the frame being edited. */
  element: () => HTMLElement | null;
  /** The canvas layer's rectangle, which the guides are measured from. */
  origin: () => DOMRect | null;
  /** The zoom of the canvas: a pointer moves by screen pixels, the page is measured in its own. */
  scale: () => number;
  edit: (id: string, change: (entry: SiteNode, screen: Screen) => SiteNode, key: string) => void;
  undo: () => void;
  setGuides: (guides: Guide[]) => void;
  /** Asks to be called whenever the canvas puts the outline over the block again (a zoom, a move, a change of the page). */
  register: (place: () => void) => () => void;
}

interface Pointer {
  dx: number;
  dy: number;
  shift: boolean;
  alt: boolean;
}
interface Result {
  change: (entry: SiteNode, screen: Screen) => SiteNode;
  guides: Guide[];
  text: string;
}
type Update = (pointer: Pointer) => Result;
interface Run {
  id: number;
  x: number;
  y: number;
  key: string;
  moved: boolean;
  update: Update;
}

let gestures = 0;
/** The pointer has to go this far (screen pixels) before it is a drag and not a click. */
const DRAG_THRESHOLD = 3;

const num = (value: string): number => Number.parseFloat(value) || 0;
const EDGES: readonly Edge[] = ["top", "right", "bottom", "left"];
const EDGE_NAME: Record<Edge, string> = { top: "de cima", right: "da direita", bottom: "de baixo", left: "da esquerda" };
const HANDLE_NAME = {
  "resize-e": "Largura",
  "resize-s": "Altura",
  "resize-se": "Largura e altura",
} as const;
const toBox = (rect: DOMRect): Box => ({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
const FLEXIBLE = new Set(["flex", "inline-flex", "grid", "inline-grid"]);
/** The most gap handles drawn for one container: a row of more is a list, and one handle for each would be a wall. */
const MOST_GAPS = 24;

/** A handle: a bit of the layer over the page that takes the pointer for a drag. */
function Grip({
  name,
  active,
  onBegin,
  onMove,
  onFinish,
  spanRef,
  ...rest
}: {
  name: string;
  active: string | null;
  onBegin: (event: PointerEvent<HTMLElement>) => void;
  onMove: (event: PointerEvent<HTMLElement>) => void;
  onFinish: (event: PointerEvent<HTMLElement>) => void;
  spanRef?: (element: HTMLSpanElement | null) => void;
} & Omit<HTMLAttributes<HTMLSpanElement>, "onPointerDown" | "onPointerMove" | "onPointerUp" | "onPointerCancel" | "onClick">) {
  return (
    <span
      ref={spanRef}
      data-handle={name}
      data-active={active === name || undefined}
      onPointerDown={onBegin}
      onPointerMove={onMove}
      onPointerUp={onFinish}
      onPointerCancel={onFinish}
      onClick={(event) => event.stopPropagation()}
      {...rest}
    />
  );
}

export function BlockHandles({ host }: { host: HandleHost }) {
  const root = useRef<HTMLDivElement>(null);
  const gaps = useRef<(HTMLSpanElement | null)[]>([]);
  const run = useRef<Run | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [readout, setReadout] = useState<string | null>(null);
  const node = host.node;
  const gapCount = node.type === "box" ? Math.min(MOST_GAPS, Math.max(0, node.children.length - 1)) : 0;

  // Where the handles that depend on the layout go: the strips between the children, and whether the block is too small for the inner ones.
  const reposition = useCallback(() => {
    const element = host.element();
    const holder = root.current;
    const outline = holder?.parentElement;
    if (!element || !holder || !outline) return;
    const frame = outline.getBoundingClientRect();
    holder.toggleAttribute("data-small", frame.width < 110 || frame.height < 70);
    const kids = FLEXIBLE.has(getComputedStyle(element).display)
      ? Array.from(element.children)
          .filter((child) => child.hasAttribute("data-block-id"))
          .map((child) => child.getBoundingClientRect())
          .filter((rect) => rect.width > 0 || rect.height > 0)
      : [];
    gaps.current.forEach((span, index) => {
      if (!span) return;
      const strip = kids[index] && kids[index + 1] ? gapStrip(toBox(kids[index]), toBox(kids[index + 1])) : null;
      if (!strip) {
        span.hidden = true;
        return;
      }
      span.hidden = false;
      span.dataset.axis = strip.axis;
      span.style.left = `${strip.box.left - frame.left}px`;
      span.style.top = `${strip.box.top - frame.top}px`;
      span.style.width = `${strip.box.right - strip.box.left}px`;
      span.style.height = `${strip.box.bottom - strip.box.top}px`;
    });
  }, [host]);
  useLayoutEffect(() => {
    reposition();
  });
  useEffect(() => host.register(reposition), [host, reposition]);

  // ---- what each handle does: given the page as it is when the drag starts, how a pointer movement becomes a change ----

  const resize =
    (axes: { x: boolean; y: boolean }) =>
    (): Update | null => {
      const element = host.element();
      const parent = element?.parentElement;
      const frame = element?.closest<HTMLElement>("[data-frame]");
      if (!element || !parent || !frame) return null;
      const scale = host.scale();
      const origin = frame.getBoundingClientRect();
      const inPage = (rect: DOMRect): Box => ({ left: (rect.left - origin.left) / scale, top: (rect.top - origin.top) / scale, right: (rect.right - origin.left) / scale, bottom: (rect.bottom - origin.top) / scale });
      const mine = inPage(element.getBoundingClientRect());
      const own = getComputedStyle(parent);
      const outer = inPage(parent.getBoundingClientRect());
      const content: Box = { left: outer.left + num(own.paddingLeft), right: outer.right - num(own.paddingRight), top: outer.top + num(own.paddingTop), bottom: outer.bottom - num(own.paddingBottom) };
      const before: Box[] = [];
      for (const sibling of Array.from(parent.children)) {
        if (sibling === element) break;
        const rect = sibling.getBoundingClientRect();
        if (sibling.hasAttribute("data-block-id") && (rect.width > 0 || rect.height > 0)) before.push(inPage(rect));
      }
      const lines = { x: alignmentTargets("x", content, before), y: alignmentTargets("y", content, before) };
      const startWidth = element.offsetWidth;
      const startHeight = element.offsetHeight;
      return ({ dx, dy, alt }) => {
        const guides: Guide[] = [];
        const layer = host.origin();
        const frameNow = frame.getBoundingClientRect();
        const along = (axis: "x" | "y", line: number): Guide | null =>
          layer ? { axis, at: axis === "x" ? frameNow.left - layer.left + line * scale : frameNow.top - layer.top + line * scale } : null;
        let width = startWidth;
        let height = startHeight;
        if (axes.x) {
          width = widthFrom(startWidth, dx);
          const snapped = alt ? null : snapEdge(mine.left + width, lines.x, SNAP_SCREEN_PX / scale);
          if (snapped && snapped.target !== null) {
            width = widthFrom(snapped.edge - mine.left, 0);
            const guide = along("x", snapped.target);
            if (guide) guides.push(guide);
          }
        }
        if (axes.y) {
          height = heightFrom(startHeight, dy);
          const snapped = alt ? null : snapEdge(mine.top + height, lines.y, SNAP_SCREEN_PX / scale);
          if (snapped && snapped.target !== null) {
            height = heightFrom(snapped.edge - mine.top, 0);
            const guide = along("y", snapped.target);
            if (guide) guides.push(guide);
          }
        }
        return {
          change: (entry, screen) => setStyleProps(entry, screen, { ...(axes.x ? { width: px(width) } : null), ...(axes.y ? { height: px(height) } : null) }),
          guides,
          text: axes.x && axes.y ? `${width} × ${height} px` : axes.x ? `Largura ${width} px` : `Altura ${height} px`,
        };
      };
    };

  const padding =
    (edge: Edge) =>
    (): Update | null => {
      const element = host.element();
      if (!element) return null;
      const own = getComputedStyle(element);
      const start = num({ top: own.paddingTop, right: own.paddingRight, bottom: own.paddingBottom, left: own.paddingLeft }[edge]);
      return ({ dx, dy, shift, alt }) => {
        const value = paddingFrom(start, inward(edge, dx, dy));
        const sides = sidesFor(edge, sideMode({ shift, alt }));
        return {
          change: (entry, screen) => setSides(entry, screen, "padding", sides, px(value)),
          guides: [],
          text: `Espaço interno ${sides.length === 4 ? "(os quatro lados)" : sides.length === 2 ? "(os dois lados)" : EDGE_NAME[edge]} ${value} px`,
        };
      };
    };

  const gap =
    () =>
    (grabbed: HTMLElement): Update | null => {
      const element = host.element();
      const axis = grabbed.dataset.axis === "y" ? "y" : "x";
      if (!element) return null;
      const own = getComputedStyle(element);
      const start = num(axis === "x" ? own.columnGap : own.rowGap);
      return ({ dx, dy }) => {
        const value = gapFrom(start, axis === "x" ? dx : dy);
        return { change: (entry, screen) => setStyleProps(entry, screen, { gap: px(value) }), guides: [], text: `Espaço entre os blocos ${value} px` };
      };
    };

  const rounding = (): Update | null => {
    const element = host.element();
    if (!element) return null;
    const own = getComputedStyle(element);
    const size = { width: element.offsetWidth, height: element.offsetHeight };
    const first = own.borderTopLeftRadius.split(" ")[0] ?? "0";
    const start = first.endsWith("%") ? (num(first) / 100) * Math.min(size.width, size.height) : num(first);
    return ({ dx, dy }) => {
      const value = radiusFrom(start, dx, dy, size);
      return { change: (entry, screen) => setStyleProps(entry, screen, { radius: px(value) }), guides: [], text: `Arredondamento ${value} px` };
    };
  };

  // ---- the drag ----

  const begin = (event: PointerEvent<HTMLElement>, name: string, make: (grabbed: HTMLElement) => Update | null) => {
    if (event.button !== 0 || run.current) return;
    event.preventDefault();
    event.stopPropagation();
    const update = make(event.currentTarget);
    if (!update) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    run.current = { id: event.pointerId, x: event.clientX, y: event.clientY, key: `${GESTURE_PREFIX}${host.node.id}:${++gestures}`, moved: false, update };
    setActive(name);
  };
  const move = (event: PointerEvent<HTMLElement>) => {
    const current = run.current;
    if (!current || current.id !== event.pointerId) return;
    if (!current.moved && Math.hypot(event.clientX - current.x, event.clientY - current.y) < DRAG_THRESHOLD) return;
    current.moved = true;
    const scale = host.scale();
    const result = current.update({ dx: unscale(event.clientX - current.x, scale), dy: unscale(event.clientY - current.y, scale), shift: event.shiftKey, alt: event.altKey });
    host.edit(host.node.id, result.change, current.key);
    host.setGuides(result.guides);
    setReadout(result.text);
  };
  const finish = (event: PointerEvent<HTMLElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!run.current || run.current.id !== event.pointerId) return;
    run.current = null;
    setActive(null);
    setReadout(null);
    host.setGuides([]);
  };
  // Escape gives the drag up: what it did is one step of the history, taken back.
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !run.current) return;
      event.preventDefault();
      event.stopPropagation();
      if (run.current.moved) host.undo();
      run.current = null;
      setActive(null);
      setReadout(null);
      host.setGuides([]);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [active, host]);
  // A drag that is over because the block went away (it was removed, or another was chosen) leaves nothing behind.
  useEffect(
    () => () => {
      run.current = null;
      host.setGuides([]);
    },
    [host],
  );

  return (
    <div ref={root} className="ve-handles" aria-hidden="true" data-gesture={active ? "" : undefined}>
      {(Object.keys(HANDLE_NAME) as (keyof typeof HANDLE_NAME)[]).map((name) => (
        <Grip
          key={name}
          name={name}
          active={active}
          className={`ve-handle ve-h-${name.slice(7)}`}
          title={`${HANDLE_NAME[name]}: arraste. Alt: sem encaixe nas guias`}
          onBegin={(event) => begin(event, name, resize({ x: name !== "resize-s", y: name !== "resize-e" }))}
          onMove={move}
          onFinish={finish}
        />
      ))}
      {EDGES.map((edge) => (
        <Grip
          key={edge}
          name={`padding-${edge}`}
          active={active}
          className="ve-handle ve-h-pad"
          data-edge={edge}
          title={`Espaço interno ${EDGE_NAME[edge]}: arraste. Shift: os quatro lados. Alt: os dois lados`}
          onBegin={(event) => begin(event, `padding-${edge}`, padding(edge))}
          onMove={move}
          onFinish={finish}
        />
      ))}
      <Grip name="radius" active={active} className="ve-handle ve-h-radius" title="Arredondamento: arraste" onBegin={(event) => begin(event, "radius", rounding)} onMove={move} onFinish={finish} />
      {Array.from({ length: gapCount }, (_, index) => (
        <Grip
          key={index}
          name={`gap-${index}`}
          active={active}
          className="ve-handle ve-h-gap"
          hidden
          title="Espaço entre os blocos: arraste"
          spanRef={(element) => {
            gaps.current[index] = element;
          }}
          onBegin={(event) => begin(event, `gap-${index}`, gap())}
          onMove={move}
          onFinish={finish}
        />
      ))}
      {readout && <span className="ve-readout">{readout}</span>}
    </div>
  );
}
