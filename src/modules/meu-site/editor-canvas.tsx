"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { ArrowDown, ArrowUp, Copy, GripVertical, Group, Trash2 } from "lucide-react";
import { BLOCK_LABEL, type SiteContent, type SiteNode } from "./contracts";
import { landingAt, type Landing, type LayoutNode } from "./drop-geometry";
import { locate, type Slot } from "./editor-model";
import type { EditHooks, FieldSpec } from "./renderer";

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
  select: (id: string | null) => void;
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
    api.select(field.blockId);
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

/** The page as the browser drew it: each node's rectangle, relative to `origin`, in the order of the document. */
function readLayout(element: Element, origin: DOMRect, isPage: boolean): LayoutNode {
  const rect = element.getBoundingClientRect();
  return {
    id: isPage ? null : element.getAttribute("data-block-id"),
    rect: { left: rect.left - origin.left, top: rect.top - origin.top, right: rect.right - origin.left, bottom: rect.bottom - origin.top },
    holds: isPage || element.getAttribute("data-type") === "box",
    children: Array.from(element.children)
      .filter((child) => child.hasAttribute("data-block-id"))
      .map((child) => readLayout(child, origin, false)),
  };
}

const labelOf = (entry: SiteNode) => entry.name || BLOCK_LABEL[entry.type];

/** The outline of a block, its name, and what can be done with it. Placed over the block by `place`, which measures the page. */
function SelectionBox({ node, boxRef }: { node: SiteNode; boxRef: React.RefObject<HTMLDivElement | null> }) {
  const api = useEditor();
  const found = locate(api.content, node.id);
  const label = labelOf(node);
  return (
    <div ref={boxRef} className="ve-select" hidden>
      <span className="ve-chip">{label}</span>
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
            const element = event.currentTarget.closest(".ve-surface")?.querySelector(nodeSelector(node.id));
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

/**
 * The page with the editor's layer on top. The click selects the innermost block under the pointer; the pointer shows
 * what it would select; a block dragged over it shows where it would land (a line between two blocks, or the outline of
 * an empty container) and is dropped there.
 */
export function CanvasSurface({ children }: { children: ReactNode }) {
  const api = useEditor();
  const surface = useRef<HTMLDivElement>(null);
  const selection = useRef<HTMLDivElement>(null);
  const hover = useRef<HTMLDivElement>(null);
  const selected = api.selectedId ? locate(api.content, api.selectedId)?.node ?? null : null;

  /** Puts a box over an element of the page, in the coordinates of the surface. */
  const cover = useCallback((box: HTMLElement | null, element: Element | null) => {
    const host = surface.current;
    if (!box || !host) return;
    if (!element) {
      box.hidden = true;
      return;
    }
    const origin = host.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    box.hidden = false;
    box.style.left = `${rect.left - origin.left}px`;
    box.style.top = `${rect.top - origin.top}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;
  }, []);
  const place = useCallback(() => {
    const host = surface.current;
    cover(selection.current, host && api.selectedId ? host.querySelector(nodeSelector(api.selectedId)) : null);
  }, [api.selectedId, cover]);

  // After every render (a style, a text or an image may have moved things) and when the size of the page changes.
  useLayoutEffect(place);
  useEffect(() => {
    const host = surface.current;
    if (!host) return;
    const observer = new ResizeObserver(place);
    observer.observe(host);
    host.addEventListener("load", place, true);
    window.addEventListener("resize", place);
    return () => {
      observer.disconnect();
      host.removeEventListener("load", place, true);
      window.removeEventListener("resize", place);
    };
  }, [place]);

  const nodeAt = (event: MouseEvent | DragEvent) => (event.target as Element).closest?.("[data-block-id]") ?? null;
  const landingFor = (event: DragEvent<HTMLElement>): Landing | null => {
    const host = surface.current;
    const page = host?.querySelector("[data-page-root]");
    if (!host || !page) return null;
    const origin = host.getBoundingClientRect();
    const landing = landingAt(readLayout(page, origin, true), event.clientX - origin.left, event.clientY - origin.top);
    return api.canDrop(landing.slot) ? landing : null;
  };

  return (
    <div
      ref={surface}
      className="ve-surface"
      data-dragging={api.drag ? "" : undefined}
      onClick={(event) => {
        event.stopPropagation();
        api.select(nodeAt(event)?.getAttribute("data-block-id") ?? null);
      }}
      onMouseMove={(event) => {
        if (api.drag) return;
        const element = nodeAt(event);
        cover(hover.current, element && element.getAttribute("data-block-id") !== api.selectedId ? element : null);
      }}
      onMouseLeave={() => cover(hover.current, null)}
      onDragOver={(event) => {
        if (!api.drag) return;
        const landing = landingFor(event);
        api.setTarget(landing);
        if (!landing) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = api.drag.kind === "new" ? "copy" : "move";
      }}
      onDrop={(event) => {
        if (!api.drag) return;
        const landing = landingFor(event);
        if (!landing) return;
        event.preventDefault();
        api.drop(landing.slot);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as globalThis.Node | null)) api.setTarget(null);
      }}
    >
      {children}
      <div className="ve-overlay" aria-hidden={false}>
        <div ref={hover} className="ve-hover" hidden />
        {selected && <SelectionBox node={selected} boxRef={selection} />}
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
    </div>
  );
}
