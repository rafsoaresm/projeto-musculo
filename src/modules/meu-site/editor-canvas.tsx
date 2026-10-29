"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
} from "react";
import { ArrowDown, ArrowUp, Copy, GripVertical, Group, Maximize, Minus, Plus, Trash2 } from "lucide-react";
import { BlockHandles, type Guide, type HandleHost } from "./block-handles";
import { actualSize as actualView, fitView, moveBy, percent, reveal as revealBox, steppedScale, wheelScale, zoomAt, type Size, type View } from "./canvas-view";
import { BLOCK_LABEL, type SiteContent, type SiteNode } from "./contracts";
import { landingAt, type Landing, type LayoutNode } from "./drop-geometry";
import { locate, type Slot } from "./editor-model";
import type { EditHooks, FieldSpec } from "./renderer";
import { SCREENS, SCREEN_LABEL, SCREEN_WIDTH, type Screen } from "./screens";
import { SCREEN_ICON } from "./screen-ui";

/**
 * What the editor puts over the page: the fields that can be typed over, the outline and tools of the selected block,
 * the outline of the one under the pointer and the line that shows where a dragged block would land. None of it is inside
 * the page: the page is drawn by SiteRenderer exactly as it is published (a container holds its children directly), and
 * this layer is measured from the page's own elements. So a row is a row and a column is a column, in the editor as on
 * the published page, and the line is drawn where the browser really put things.
 *
 * Dragging uses the browser's own drag and drop, which a finger does not start: the tools of each block (up, down,
 * duplicate, remove), the layers list and the "add" of the library do the same without dragging.
 */
export type Drag = { kind: "new"; key: string } | { kind: "move"; id: string };
export type NodeAction = "up" | "down" | "duplicate" | "delete" | "out" | "into" | "wrap" | "unwrap";

export interface EditorApi {
  content: SiteContent;
  selectedId: string | null;
  /** Selects a block (or nothing). A click in a frame also says which size of the screen it was in, and that size becomes the one being edited. */
  select: (id: string | null, screen?: Screen) => void;
  commitText: (blockId: string, path: string, value: string) => void;
  drag: Drag | null;
  startDrag: (drag: Drag) => void;
  endDrag: () => void;
  /** Where the dragged block would land now, or null when nowhere (or not allowed there). */
  target: Landing | null;
  setTarget: (landing: Landing | null) => void;
  /** Whether what is being dragged may land in the slot. */
  canDrop: (slot: Slot) => boolean;
  drop: (slot: Slot) => void;
  act: (id: string, action: NodeAction) => void;
  /** Changes a block (the change is told which size of the screen is being edited). All the changes with the same `key` are one step of the history. */
  edit: (id: string, change: (entry: SiteNode, screen: Screen) => SiteNode, key: string) => void;
  undo: () => void;
}
export const EditorContext = createContext<EditorApi | null>(null);
function useEditor(): EditorApi {
  const api = useContext(EditorContext);
  if (!api) throw new Error("EditorContext is missing");
  return api;
}

/** Whether the browser can type plain text only into an element; if not, the text is cleaned when it is read. */
function plainTextOnly(): boolean {
  const probe = document.createElement("div");
  try {
    probe.contentEditable = "plaintext-only";
  } catch {
    return false;
  }
  return probe.contentEditable === "plaintext-only";
}

/** A text of the page. Double click to type over it; Enter (or a click elsewhere) keeps it, Escape gives it up. */
function EditableText({ field }: { field: FieldSpec }) {
  const api = useEditor();
  const ref = useRef<HTMLSpanElement>(null);
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<"plaintext-only" | "true">("true");

  useEffect(() => {
    const element = ref.current;
    if (!editing || !element) return;
    element.focus();
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, [editing]);

  const start = () => {
    api.select(field.blockId, (ref.current?.closest("[data-frame]") as HTMLElement | null)?.dataset.frame as Screen | undefined);
    setMode(plainTextOnly() ? "plaintext-only" : "true");
    setEditing(true);
  };
  const finish = (keep: boolean) => {
    const element = ref.current;
    setEditing(false);
    if (!element) return;
    if (!keep) {
      element.textContent = field.value;
      return;
    }
    let value = element.innerText.replace(/ /g, " ").replace(/\r\n/g, "\n").replace(/\n+$/, "");
    if (!field.multiline) value = value.replace(/\s*\n\s*/g, " ");
    value = value.slice(0, field.max);
    // What was typed is now in the document; put the text back as the page draws it, so the next render agrees.
    element.textContent = value;
    if (value !== field.value) api.commitText(field.blockId, field.path, value);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (!editing) return;
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      finish(false);
      ref.current?.blur();
    } else if (event.key === "Enter" && (!field.multiline || event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      ref.current?.blur();
    }
  };
  const onPaste = (event: ClipboardEvent<HTMLSpanElement>) => {
    event.preventDefault();
    const pasted = event.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, field.multiline ? pasted : pasted.replace(/\s*\n\s*/g, " "));
  };
  return (
    <span
      ref={ref}
      className="site-editable"
      data-placeholder={field.placeholder}
      data-editing={editing || undefined}
      contentEditable={editing ? mode : undefined}
      suppressContentEditableWarning
      spellCheck={editing}
      title={editing ? undefined : "Dois cliques para escrever aqui"}
      onDoubleClick={editing ? undefined : start}
      onBlur={editing ? () => finish(true) : undefined}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      onDrop={(event) => event.preventDefault()}
    >
      {field.value}
    </span>
  );
}

/** The hooks SiteRenderer needs to draw the page as a canvas: only the texts, which become fields. */
export function canvasHooks(): EditHooks {
  return { text: (field) => <EditableText field={field} /> };
}

// ---- measuring the page ----

const nodeSelector = (id: string) => `[data-block-id="${CSS.escape(id)}"]`;
const frameOf = (target: EventTarget | null): HTMLElement | null => (target as Element | null)?.closest?.<HTMLElement>("[data-frame]") ?? null;
const screenOf = (frame: HTMLElement | null): Screen | undefined => (frame?.dataset.frame as Screen | undefined) ?? undefined;

/**
 * The page as the browser drew it: each node's rectangle, relative to `origin`, in the order of the document. A node that takes
 * no room (hidden at this size of the screen) is marked, so the places to drop stay those of the document without it.
 */
function readLayout(element: Element, origin: DOMRect, isPage: boolean): LayoutNode {
  const rect = element.getBoundingClientRect();
  return {
    id: isPage ? null : element.getAttribute("data-block-id"),
    rect: { left: rect.left - origin.left, top: rect.top - origin.top, right: rect.right - origin.left, bottom: rect.bottom - origin.top },
    holds: isPage || element.getAttribute("data-type") === "box",
    hidden: !isPage && rect.width === 0 && rect.height === 0,
    children: Array.from(element.children)
      .filter((child) => child.hasAttribute("data-block-id"))
      .map((child) => readLayout(child, origin, false)),
  };
}

const labelOf = (entry: SiteNode) => entry.name || BLOCK_LABEL[entry.type];

/** The outline of a block, its name, and what can be done with it. Placed over the block by `place`, which measures the page. */
function SelectionBox({ node, boxRef, handles }: { node: SiteNode; boxRef: React.RefObject<HTMLDivElement | null>; handles: HandleHost | null }) {
  const api = useEditor();
  const found = locate(api.content, node.id);
  const label = labelOf(node);
  return (
    <div ref={boxRef} className="ve-select" hidden>
      <span className="ve-chip">{label}</span>
      {handles && <BlockHandles host={handles} />}
      <div className="ve-tools" role="toolbar" aria-label={`Ferramentas de ${label}`}>
        <button
          type="button"
          className="ve-grab"
          draggable
          title="Arraste pela alça para mudar de lugar"
          aria-label={`Arrastar ${label}`}
          onClick={(event) => event.stopPropagation()}
          onDragStart={(event) => {
            event.stopPropagation();
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", node.id);
            const element = event.currentTarget.closest(".ve-canvas")?.querySelector(`[data-frame][data-active] ${nodeSelector(node.id)}`);
            if (element) event.dataTransfer.setDragImage(element, 16, 16);
            api.startDrag({ kind: "move", id: node.id });
          }}
          onDragEnd={api.endDrag}
        >
          <GripVertical size={16} />
        </button>
        <button type="button" title="Mover para cima" aria-label={`Mover ${label} para cima`} disabled={!found || found.index === 0} onClick={(event) => { event.stopPropagation(); api.act(node.id, "up"); }}>
          <ArrowUp size={16} />
        </button>
        <button type="button" title="Mover para baixo" aria-label={`Mover ${label} para baixo`} disabled={!found || found.index === found.count - 1} onClick={(event) => { event.stopPropagation(); api.act(node.id, "down"); }}>
          <ArrowDown size={16} />
        </button>
        <button type="button" title="Agrupar em um contêiner" aria-label={`Agrupar ${label} em um contêiner`} onClick={(event) => { event.stopPropagation(); api.act(node.id, "wrap"); }}>
          <Group size={16} />
        </button>
        <button type="button" title="Duplicar" aria-label={`Duplicar ${label}`} onClick={(event) => { event.stopPropagation(); api.act(node.id, "duplicate"); }}>
          <Copy size={16} />
        </button>
        <button type="button" className="ve-danger" title="Excluir" aria-label={`Excluir ${label}`} onClick={(event) => { event.stopPropagation(); api.act(node.id, "delete"); }}>
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
}

// ---- the canvas ----

/** What the keys and the rest of the editor can ask of the canvas. */
export interface CanvasControls {
  zoomIn: () => void;
  zoomOut: () => void;
  /** 100%, the world centered. */
  actualSize: () => void;
  /** The whole width of the frames in the canvas. */
  fit: () => void;
  /** Moves the content by (dx, dy) screen pixels. */
  pan: (dx: number, dy: number) => void;
  /** Brings a block into view, in the frame being edited. */
  reveal: (id: string) => void;
}

/** Below this the editor shows one panel at a time (see globals.css) and the canvas is a plain scrolling area: no zoom, no moving it by hand. */
export const COMPACT_QUERY = "(max-width: 900px)";
const subscribeCompact = (notify: () => void) => {
  const list = window.matchMedia(COMPACT_QUERY);
  list.addEventListener("change", notify);
  return () => list.removeEventListener("change", notify);
};
export function useCompact(): boolean {
  return useSyncExternalStore(subscribeCompact, () => window.matchMedia(COMPACT_QUERY).matches, () => false);
}


/**
 * The canvas: the frames of the sizes of the screen side by side (each as wide as its size), in a world that is zoomed with
 * Ctrl/Cmd + wheel (or the buttons and keys), moved with the wheel, the space bar or the middle button, or by dragging the empty
 * canvas, and fitted with one click. The page in each frame is drawn by the same component as the published page, at the
 * width of the frame. The layer of the editor (outline, tools, line of a drop) is over the canvas, not inside the world, so it
 * keeps its size at any zoom, and it is measured from the page's own elements, in the frame being edited.
 *
 * The view (scale and position) is kept in a ref and written to the DOM, not held as state: a turn of the wheel moves the world and the outline
 * without drawing the page again. On a narrow screen the world is simply laid out at full size in a scrolling area.
 */
export function CanvasSurface({
  ref,
  screen,
  onScreen,
  visible,
  onVisible,
  interactive,
  page,
}: {
  ref?: Ref<CanvasControls>;
  /** The size of the screen being edited: its frame is the active one. */
  screen: Screen;
  onScreen: (screen: Screen) => void;
  visible: Record<Screen, boolean>;
  onVisible: (visible: Record<Screen, boolean>) => void;
  /** False in the preview: the pages are only shown (zoom and position still work). */
  interactive: boolean;
  /** The page, drawn for the frame of a size. */
  page: (screen: Screen) => ReactNode;
}) {
  const api = useEditor();
  const compact = useCompact();
  const shell = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const selection = useRef<HTMLDivElement>(null);
  const hover = useRef<HTMLDivElement>(null);
  const readout = useRef<HTMLSpanElement>(null);
  const view = useRef<View>({ scale: 1, x: 0, y: 0 });
  /** Whether the view is still the one "fit" made (so a change of the window's size fits it again). */
  const fitted = useRef(true);
  const hand = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const spaceHeld = useRef(false);
  const justMoved = useRef(false);
  /** The lines the handles snap to while one is dragged, in the coordinates of the layer over the canvas. */
  const [guides, setGuides] = useState<Guide[]>([]);
  /** What wants to be told when the outline is put over the block again (the handles that depend on the layout). */
  const placers = useRef(new Set<() => void>());
  const registerPlacer = useCallback((fn: () => void) => {
    placers.current.add(fn);
    return () => {
      placers.current.delete(fn);
    };
  }, []);
  const selected = interactive && api.selectedId ? locate(api.content, api.selectedId)?.node ?? null : null;
  const frames = SCREENS.filter((size) => visible[size]);
  const { edit: editNode, undo: undoEdit } = api;
  const selectedNode = selected?.id ?? null;
  const selectedLabel = selected ? labelOf(selected) : "";
  const handleHost = useMemo<HandleHost | null>(
    () =>
      selected && !compact
        ? {
            node: selected,
            label: selectedLabel,
            element: () => inner.current?.querySelector<HTMLElement>(`[data-frame="${screen}"] ${nodeSelector(selected.id)}`) ?? null,
            origin: () => inner.current?.getBoundingClientRect() ?? null,
            scale: () => view.current.scale,
            edit: editNode,
            undo: undoEdit,
            setGuides,
            register: registerPlacer,
          }
        : null,
    // The block's own object changes with every edit of it, which is what keeps `node` current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, selectedNode, selectedLabel, compact, screen, editNode, undoEdit, registerPlacer],
  );

  const size = useCallback((): { canvas: Size; world: Size } => {
    const area = canvas.current;
    const content = world.current;
    return { canvas: { width: area?.clientWidth ?? 0, height: area?.clientHeight ?? 0 }, world: { width: content?.offsetWidth ?? 0, height: content?.offsetHeight ?? 0 } };
  }, []);

  /** Puts a box over an element of the page, in the coordinates of the canvas; hides it when there is no element, or it takes no room. */
  const cover = useCallback((box: HTMLElement | null, element: Element | null) => {
    const host = inner.current;
    if (!box || !host) return;
    const rect = element?.getBoundingClientRect();
    if (!element || !rect || (rect.width === 0 && rect.height === 0)) {
      box.hidden = true;
      return;
    }
    const origin = host.getBoundingClientRect();
    box.hidden = false;
    box.style.left = `${rect.left - origin.left}px`;
    box.style.top = `${rect.top - origin.top}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;
  }, []);
  const place = useCallback(() => {
    const host = inner.current;
    const element = host && interactive && api.selectedId ? host.querySelector(`[data-frame="${screen}"] ${nodeSelector(api.selectedId)}`) : null;
    cover(selection.current, element);
    placers.current.forEach((fn) => fn());
  }, [api.selectedId, screen, interactive, cover]);
  const latestPlace = useRef(place);
  // After every render (a style, a text or an image may have moved things).
  useLayoutEffect(() => {
    latestPlace.current = place;
    place();
  });

  /** Draws the world at a view. */
  const apply = useCallback(
    (next: View) => {
      view.current = next;
      const content = world.current;
      if (content) {
        content.style.transform = `translate(${next.x}px, ${next.y}px) scale(${next.scale})`;
        content.style.setProperty("--ve-scale", String(next.scale));
      }
      if (readout.current) readout.current.textContent = `${percent(next.scale)}%`;
      cover(hover.current, null);
      latestPlace.current();
    },
    [cover],
  );
  const fit = useCallback(() => {
    fitted.current = true;
    const measured = size();
    apply(fitView(measured.canvas, measured.world));
  }, [apply, size]);
  const moved = useCallback(
    (next: View) => {
      fitted.current = false;
      apply(next);
    },
    [apply],
  );
  const zoomBy = useCallback(
    (direction: 1 | -1) => {
      const measured = size();
      moved(zoomAt(view.current, steppedScale(view.current.scale, direction), measured.canvas.width / 2, measured.canvas.height / 2));
    },
    [moved, size],
  );

  useImperativeHandle(
    ref,
    () => ({
      zoomIn: () => !compact && zoomBy(1),
      zoomOut: () => !compact && zoomBy(-1),
      actualSize: () => {
        if (compact) return;
        const measured = size();
        moved(actualView(measured.canvas, measured.world));
      },
      fit: () => !compact && fit(),
      pan: (dx, dy) => !compact && moved(moveBy(view.current, dx, dy)),
      reveal: (id) => {
        const host = inner.current;
        const area = canvas.current;
        const element = host?.querySelector(`[data-frame="${screen}"] ${nodeSelector(id)}`) ?? host?.querySelector(nodeSelector(id));
        if (!element || !area) return;
        if (compact) {
          element.scrollIntoView({ block: "nearest", inline: "nearest" });
          return;
        }
        const origin = area.getBoundingClientRect();
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return;
        moved(revealBox(view.current, { left: rect.left - origin.left, top: rect.top - origin.top, right: rect.right - origin.left, bottom: rect.bottom - origin.top }, size().canvas));
      },
    }),
    [compact, fit, moved, screen, size, zoomBy],
  );

  // The frames that are shown change (or the window goes from wide to narrow): fit them again.
  const framesKey = frames.join();
  useLayoutEffect(() => {
    if (compact) {
      world.current?.style.removeProperty("transform");
      world.current?.style.removeProperty("--ve-scale");
      return;
    }
    fit();
  }, [framesKey, compact, fit]);

  // The canvas changes its size (the window, the panels): the outline follows, and a view that is still the fitted one is fitted again.
  useEffect(() => {
    const area = canvas.current;
    const host = inner.current;
    if (!area || !host) return;
    const observer = new ResizeObserver(() => {
      if (!compact && fitted.current) fit();
      else latestPlace.current();
    });
    observer.observe(area);
    if (world.current) observer.observe(world.current);
    host.addEventListener("load", place, true);
    return () => {
      observer.disconnect();
      host.removeEventListener("load", place, true);
    };
  }, [compact, fit, place]);

  // The wheel moves the world; with Ctrl/Cmd (also what a pinch on a trackpad sends) it zooms around the pointer.
  useEffect(() => {
    // Heard on the whole canvas, the buttons over it included: the wheel over the zoom box moves the page too.
    const area = shell.current;
    const surface = canvas.current;
    if (!area || !surface || compact) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const origin = surface.getBoundingClientRect();
      if (event.ctrlKey || event.metaKey) moved(zoomAt(view.current, wheelScale(view.current.scale, event.deltaY), event.clientX - origin.left, event.clientY - origin.top));
      else if (event.shiftKey && event.deltaX === 0) moved(moveBy(view.current, -event.deltaY, 0));
      else moved(moveBy(view.current, -event.deltaX, -event.deltaY));
    };
    area.addEventListener("wheel", onWheel, { passive: false });
    return () => area.removeEventListener("wheel", onWheel);
  }, [compact, moved]);

  // The space bar turns the pointer into a hand, as long as it is held (and the focus is not on something that uses the key).
  useEffect(() => {
    const area = canvas.current;
    const plain = (target: EventTarget | null) => !(target as HTMLElement | null)?.closest?.("input, textarea, select, button, a, summary, [contenteditable], [role='button'], [role='toolbar']");
    const down = (event: globalThis.KeyboardEvent) => {
      if (event.code !== "Space" || !plain(event.target) || compact) return;
      event.preventDefault();
      spaceHeld.current = true;
      area?.setAttribute("data-hand", "");
    };
    const up = (event: globalThis.KeyboardEvent) => {
      if (event.code !== "Space") return;
      spaceHeld.current = false;
      area?.removeAttribute("data-hand");
    };
    document.addEventListener("keydown", down);
    document.addEventListener("keyup", up);
    return () => {
      document.removeEventListener("keydown", down);
      document.removeEventListener("keyup", up);
    };
  }, [compact]);

  const toggle = (which: Screen, only: boolean) => {
    const next = only ? { desktop: false, tablet: false, mobile: false, [which]: true } : { ...visible, [which]: !visible[which] };
    if (!SCREENS.some((entry) => next[entry])) next[which] = true;
    onVisible(next);
    if (next[which]) onScreen(which);
    else if (screen === which) onScreen([...SCREENS].reverse().find((entry) => next[entry]) ?? which);
  };

  const nodeAt = (event: MouseEvent | DragEvent) => (event.target as Element).closest?.("[data-block-id]") ?? null;
  const landingFor = (event: DragEvent<HTMLElement>): Landing | null => {
    const host = inner.current;
    const pageRoot = frameOf(event.target)?.querySelector("[data-page-root]");
    if (!host || !pageRoot) return null;
    const origin = host.getBoundingClientRect();
    const landing = landingAt(readLayout(pageRoot, origin, true), event.clientX - origin.left, event.clientY - origin.top);
    return api.canDrop(landing.slot) ? landing : null;
  };

  const startHand = (event: PointerEvent<HTMLDivElement>) => {
    if (compact) return;
    const target = event.target as Element;
    const onBackground = !target.closest("[data-frame], button, [role='toolbar'], [data-handle]");
    if (!(event.button === 1 || (event.button === 0 && (spaceHeld.current || onBackground)))) return;
    // Taking the pointer for the hand keeps the browser from moving the focus; the focus leaves what had it (a button, a field), so the keys of the canvas are heard.
    event.preventDefault();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    event.currentTarget.setPointerCapture(event.pointerId);
    hand.current = { x: event.clientX, y: event.clientY, moved: false };
  };
  const moveHand = (event: PointerEvent<HTMLDivElement>) => {
    const grip = hand.current;
    if (!grip) return;
    const dx = event.clientX - grip.x;
    const dy = event.clientY - grip.y;
    if (!grip.moved && Math.hypot(dx, dy) < 3) return;
    grip.moved = true;
    grip.x = event.clientX;
    grip.y = event.clientY;
    event.currentTarget.setAttribute("data-moving", "");
    moved(moveBy(view.current, dx, dy));
  };
  const endHand = (event: PointerEvent<HTMLDivElement>) => {
    const grip = hand.current;
    if (!grip) return;
    hand.current = null;
    event.currentTarget.removeAttribute("data-moving");
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (grip.moved) {
      // The click that ends a drag of the canvas is not a click on the page.
      justMoved.current = true;
      setTimeout(() => (justMoved.current = false), 0);
    }
  };

  return (
    <div ref={shell} className="ve-canvas-shell">
      <div
        ref={canvas}
        className="ve-canvas"
        data-compact={compact || undefined}
        data-interactive={interactive || undefined}
        data-dragging={api.drag ? "" : undefined}
        onPointerDown={startHand}
        onPointerMove={moveHand}
        onPointerUp={endHand}
        onPointerCancel={endHand}
        onClick={(event) => {
          if (!interactive || justMoved.current) return;
          const frame = frameOf(event.target);
          const element = nodeAt(event);
          api.select(element?.getAttribute("data-block-id") ?? null, element ? screenOf(frame) : undefined);
        }}
        onMouseMove={(event) => {
          if (!interactive || api.drag || hand.current) return;
          const element = nodeAt(event);
          const isSelected = element !== null && element.getAttribute("data-block-id") === api.selectedId && screenOf(frameOf(event.target)) === screen;
          cover(hover.current, element && !isSelected ? element : null);
        }}
        onMouseLeave={() => cover(hover.current, null)}
        onDragOver={(event) => {
          if (!interactive || !api.drag) return;
          const landing = landingFor(event);
          api.setTarget(landing);
          if (!landing) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = api.drag.kind === "new" ? "copy" : "move";
        }}
        onDrop={(event) => {
          if (!interactive || !api.drag) return;
          const landing = landingFor(event);
          if (!landing) return;
          event.preventDefault();
          api.drop(landing.slot);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as globalThis.Node | null)) api.setTarget(null);
        }}
      >
        <div ref={inner} className="ve-canvas-inner">
          <div ref={world} className="ve-world">
            {frames.map((frameSize) => {
              const Icon = SCREEN_ICON[frameSize];
              return (
                <section
                  key={frameSize}
                  className="ve-frame"
                  data-frame={frameSize}
                  data-active={frameSize === screen || undefined}
                  aria-label={`Quadro do ${SCREEN_LABEL[frameSize].toLowerCase()}`}
                  style={{ width: SCREEN_WIDTH[frameSize], ...(compact && frameSize === "mobile" ? { maxWidth: "100%" } : null) }}
                >
                  <button
                    type="button"
                    className="ve-frame-label"
                    aria-pressed={frameSize === screen}
                    title={`Editar o ${SCREEN_LABEL[frameSize].toLowerCase()}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onScreen(frameSize);
                    }}
                  >
                    <Icon size={14} aria-hidden="true" />
                    {SCREEN_LABEL[frameSize]}
                    <small>{SCREEN_WIDTH[frameSize]}</small>
                  </button>
                  <div className="ve-frame-page">{page(frameSize)}</div>
                </section>
              );
            })}
          </div>
          {interactive && (
            <div className="ve-overlay" aria-hidden={false}>
              <div ref={hover} className="ve-hover" hidden />
              {selected && <SelectionBox node={selected} boxRef={selection} handles={handleHost} />}
              {guides.map((guide, index) => (
                <div key={index} className="ve-guide" data-axis={guide.axis} style={guide.axis === "x" ? { left: guide.at } : { top: guide.at }} />
              ))}
              {api.drag && api.target?.line && (
                <div
                  className="ve-drop-line"
                  style={{ left: api.target.line.left, top: api.target.line.top, width: api.target.line.right - api.target.line.left, height: api.target.line.bottom - api.target.line.top }}
                />
              )}
              {api.drag && api.target?.box && (
                <div
                  className="ve-drop-box"
                  style={{ left: api.target.box.left, top: api.target.box.top, width: api.target.box.right - api.target.box.left, height: api.target.box.bottom - api.target.box.top }}
                />
              )}
            </div>
          )}
        </div>
      </div>
      <div className="ve-canvas-bar" role="group" aria-label="Quadros da tela">
        {SCREENS.map((entry) => {
          const Icon = SCREEN_ICON[entry];
          return (
            <button
              key={entry}
              type="button"
              aria-pressed={visible[entry]}
              aria-label={`Mostrar o quadro do ${SCREEN_LABEL[entry].toLowerCase()}`}
              title={`${SCREEN_LABEL[entry]} (${SCREEN_WIDTH[entry]} px). Com Ctrl ou Cmd, mostra só este.`}
              onClick={(event) => toggle(entry, event.ctrlKey || event.metaKey)}
            >
              <Icon size={18} aria-hidden="true" />
            </button>
          );
        })}
      </div>
      {!compact && (
        <div className="ve-zoom" role="group" aria-label="Zoom">
          <button type="button" aria-label="Diminuir o zoom" title="Diminuir (Ctrl/Cmd e -)" onClick={() => zoomBy(-1)}>
            <Minus size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="ve-zoom-value"
            aria-label="Zoom: voltar a 100%"
            title="Voltar a 100% (Ctrl/Cmd e 0)"
            onClick={() => {
              const measured = size();
              moved(actualView(measured.canvas, measured.world));
            }}
          >
            <span ref={readout}>100%</span>
          </button>
          <button type="button" aria-label="Aumentar o zoom" title="Aumentar (Ctrl/Cmd e +)" onClick={() => zoomBy(1)}>
            <Plus size={14} aria-hidden="true" />
          </button>
          <button type="button" aria-label="Ajustar à tela" title="Ajustar à tela (Ctrl/Cmd, Shift e 0)" onClick={fit}>
            <Maximize size={14} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
