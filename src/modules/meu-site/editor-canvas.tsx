"use client";
import { createContext, useContext, useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type HTMLAttributes, type KeyboardEvent, type ReactNode } from "react";
import { ArrowDown, ArrowLeftRight, ArrowUp, Copy, GripVertical, Plus, Trash2 } from "lucide-react";
import { BLOCK_LABEL, COLUMN_TYPES, type Block, type BlockType, type ColumnItem, type ColumnType } from "./contracts";
import { columnKey, parseKey, type ContainerKey, type Side, type Slot } from "./editor-model";
import type { EditHooks, FieldSpec, Place } from "./renderer";

/**
 * The pieces the canvas puts around the page: frames with tools, fields that can be typed over, the lines
 * that show where a dragged block would land. They read what they need from `EditorContext`, which the editor
 * provides; the page itself is drawn by SiteRenderer, so the canvas is the real page with a layer on top.
 *
 * Dragging uses the browser's own drag and drop, which a finger does not start: the tools of each block
 * (up, down, duplicate, remove, to the other column), the "add" of the library and the buttons of each column
 * do the same without dragging.
 */
export type Drag = { kind: "new"; type: BlockType } | { kind: "move"; id: string; type: BlockType };
export type BlockAction = "up" | "down" | "duplicate" | "delete" | "other-column";

export interface EditorApi {
  selectedId: string | null;
  select: (id: string | null) => void;
  commitText: (blockId: string, path: string, value: string) => void;
  drag: Drag | null;
  startDrag: (drag: Drag) => void;
  endDrag: () => void;
  /** Whether what is being dragged may land in the slot. */
  acceptsDrag: (slot: Slot) => boolean;
  target: Slot | null;
  setTarget: (slot: Slot | null) => void;
  drop: (slot: Slot) => void;
  act: (id: string, action: BlockAction) => void;
  addToColumn: (columnsId: string, side: Side, type: ColumnType) => void;
}
export const EditorContext = createContext<EditorApi | null>(null);
function useEditor(): EditorApi {
  const api = useContext(EditorContext);
  if (!api) throw new Error("EditorContext is missing");
  return api;
}

const MOVE_HINT = "Arraste pela alça para mudar de lugar";
const SIDE_LABEL: Record<Side, string> = { left: "da esquerda", right: "da direita" };
const END = Number.MAX_SAFE_INTEGER;

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
    let value = element.innerText.replace(/\u00a0/g, " ").replace(/\r\n/g, "\n").replace(/\n+$/, "");
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

/** Where, in a frame, the pointer is: the upper half is "before the block", the lower half "after". */
function slotAt(event: DragEvent<HTMLElement>, place: Place): Slot {
  const rect = event.currentTarget.getBoundingClientRect();
  const before = event.clientY < rect.top + rect.height / 2;
  return { container: place.container, index: before ? place.index : place.index + 1 };
}

const labelOf = (entry: Block | ColumnItem) => BLOCK_LABEL[entry.type];

function Frame({ entry, view, place }: { entry: Block | ColumnItem; view: ReactNode; place: Place }) {
  const api = useEditor();
  const selected = api.selectedId === entry.id;
  const label = labelOf(entry);
  const where = place.container === "root" ? `Bloco ${place.index + 1}` : `Elemento ${place.index + 1}`;
  const target = api.drag ? api.target : null;
  const lineBefore = target?.container === place.container && target.index === place.index;
  const lineAfter = place.index === place.count - 1 && target?.container === place.container && target.index === place.count;
  const dropData = lineBefore ? "before" : lineAfter ? "after" : undefined;
  return (
    <div
      className="ve-frame"
      data-block-id={entry.id}
      data-type={entry.type}
      data-nested={place.container !== "root" || undefined}
      data-selected={selected || undefined}
      data-drop={dropData}
      onClick={(event) => {
        event.stopPropagation();
        api.select(entry.id);
      }}
      onDragOver={(event) => {
        const slot = slotAt(event, place);
        if (!api.acceptsDrag(slot)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = api.drag?.kind === "new" ? "copy" : "move";
        api.setTarget(slot);
      }}
      onDrop={(event) => {
        const slot = slotAt(event, place);
        if (!api.acceptsDrag(slot)) return;
        event.preventDefault();
        event.stopPropagation();
        api.drop(slot);
      }}
    >
      {selected && <span className="ve-chip">{label}</span>}
      <div className="ve-tools" role="toolbar" aria-label={`Ferramentas de ${where}: ${label}`}>
        <button
          type="button"
          className="ve-grab"
          draggable
          title={MOVE_HINT}
          aria-label={`Arrastar ${where}: ${label}`}
          onClick={(event) => event.stopPropagation()}
          onDragStart={(event) => {
            event.stopPropagation();
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", entry.id);
            const frame = event.currentTarget.closest(".ve-frame");
            if (frame) event.dataTransfer.setDragImage(frame, 16, 16);
            api.startDrag({ kind: "move", id: entry.id, type: entry.type });
          }}
          onDragEnd={api.endDrag}
        >
          <GripVertical size={16} />
        </button>
        <button type="button" title="Mover para cima" aria-label={`Mover ${where} para cima`} disabled={place.index === 0} onClick={(event) => { event.stopPropagation(); api.act(entry.id, "up"); }}>
          <ArrowUp size={16} />
        </button>
        <button type="button" title="Mover para baixo" aria-label={`Mover ${where} para baixo`} disabled={place.index === place.count - 1} onClick={(event) => { event.stopPropagation(); api.act(entry.id, "down"); }}>
          <ArrowDown size={16} />
        </button>
        {place.container !== "root" && (
          <button type="button" title="Passar para a outra coluna" aria-label={`Passar ${where} para a outra coluna`} onClick={(event) => { event.stopPropagation(); api.act(entry.id, "other-column"); }}>
            <ArrowLeftRight size={16} />
          </button>
        )}
        <button type="button" title="Duplicar" aria-label={`Duplicar ${where}`} onClick={(event) => { event.stopPropagation(); api.act(entry.id, "duplicate"); }}>
          <Copy size={16} />
        </button>
        <button type="button" className="ve-danger" title="Excluir" aria-label={`Excluir ${where}`} onClick={(event) => { event.stopPropagation(); api.act(entry.id, "delete"); }}>
          <Trash2 size={16} />
        </button>
      </div>
      {view}
    </div>
  );
}

/** The place of a container with nothing in it: the page without blocks, a column without elements. */
function EmptyPlace({ container }: { container: ContainerKey }) {
  const api = useEditor();
  const slot: Slot = { container, index: 0 };
  const active = Boolean(api.drag) && api.target?.container === container;
  return (
    <div
      className="ve-empty"
      data-active={active || undefined}
      onDragOver={(event) => {
        if (!api.acceptsDrag(slot)) return;
        event.preventDefault();
        event.stopPropagation();
        api.setTarget(slot);
      }}
      onDrop={(event) => {
        if (!api.acceptsDrag(slot)) return;
        event.preventDefault();
        event.stopPropagation();
        api.drop(slot);
      }}
    >
      {container === "root"
        ? "A página está sem blocos. Arraste um bloco da biblioteca para cá, ou clique em um deles para acrescentar."
        : "Coluna vazia. Arraste um título, um parágrafo ou um botão para cá."}
    </div>
  );
}

const ADD_LABEL: Record<ColumnType, string> = { heading: "Título", paragraph: "Parágrafo", button: "Botão" };

function ColumnTools({ columnsId, side, count }: { columnsId: string; side: Side; count: number }) {
  const api = useEditor();
  const key = columnKey(columnsId, side);
  const target = api.drag ? api.target : null;
  const line = target?.container === key && target.index >= count && count > 0;
  return (
    <div className="ve-column-tools" role="group" aria-label={`Acrescentar à coluna ${SIDE_LABEL[side]}`} data-drop={line ? "after" : undefined}>
      {COLUMN_TYPES.map((type) => (
        <button
          key={type}
          type="button"
          className="ve-add"
          aria-label={`Acrescentar ${ADD_LABEL[type].toLowerCase()} à coluna ${SIDE_LABEL[side]}`}
          onClick={(event) => {
            event.stopPropagation();
            api.addToColumn(columnsId, side, type);
          }}
        >
          <Plus size={14} /> {ADD_LABEL[type]}
        </button>
      ))}
    </div>
  );
}

/** The hooks SiteRenderer needs to draw the page as a canvas. */
export function canvasHooks(api: EditorApi): EditHooks {
  return {
    text: (field) => <EditableText field={field} />,
    frame: (entry, view, place) => <Frame entry={entry} view={view} place={place} />,
    empty: (container) => <EmptyPlace container={container} />,
    columnProps: (columnsId, side): HTMLAttributes<HTMLDivElement> => {
      const slot: Slot = { container: columnKey(columnsId, side), index: END };
      return {
        onDragOver: (event) => {
          if (!api.acceptsDrag(slot)) return;
          event.preventDefault();
          event.stopPropagation();
          api.setTarget(slot);
        },
        onDrop: (event) => {
          if (!api.acceptsDrag(slot)) return;
          event.preventDefault();
          event.stopPropagation();
          api.drop(slot);
        },
      };
    },
    columnTools: (columnsId, side, count) => <ColumnTools columnsId={columnsId} side={side} count={count} />,
  };
}

export { parseKey };
