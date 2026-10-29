"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Eye, Pencil, Redo2, Undo2, X } from "lucide-react";
import { referencedAssetIds, resolveServices, type PublishIssue, type SiteContent } from "./contracts";
import { COMPACT_QUERY, CanvasSurface, EditorContext, canvasHooks, useCompact, type CanvasControls, type Drag, type EditorApi, type ManyAction, type NodeAction } from "./editor-canvas";
import { BlockInspector, PageSettings, type ImageSupport } from "./editor-inspector";
import { editorImageUrl, libraryCssImages, libraryImages } from "./image-urls";
import type { RemoveResult, UploadResult } from "./image-picker";
import type { AssetRow } from "@/db/site-assets";
import { useMountPath } from "@/components/use-mount-path";
import { Layers, Library } from "./editor-library";
import { ContextMenu, type MenuEntry } from "./context-menu";
import { applyStyle, blocksPayload, parseBlocks, parseStyle, pasteBlocks, stylePayload, type PasteContext } from "./clipboard";
import { primaryOf, reconcile, selectRange, toggleId } from "./selection";
import type { Landing } from "./drop-geometry";
import {
  REFUSAL_MESSAGE,
  duplicateBlock,
  duplicateBlocks,
  insertNode,
  locate,
  moveBlock,
  moveIntoPrevious,
  moveOut,
  navigate,
  removeBlock,
  removeBlocks,
  setIn,
  shiftBlock,
  unwrapBlock,
  updateBlock,
  updateBlocks,
  wrapBlock,
  wrapBlocks,
  type ManyOutcome,
  type Outcome,
  type Slot,
} from "./editor-model";
import { nodeTitle } from "./node-label";
import { setHidden, toggleHidden } from "./style-model";
import { SCREEN_LABEL, isHiddenAt, type Screen } from "./screens";
import { catalogueItem } from "./presets";
import { PublicAddress } from "./public-address";
import { PublishIssues } from "./publish-issues";
import { SiteRenderer } from "./renderer";
import { buildSiteCss } from "./site-css";
import { InlineSiteStyles } from "./site-styles";
import type { ServiceChoice } from "@/db/sites";

export interface VisualEditorProps {
  content: SiteContent;
  /** A change of the document. `key` joins the typing of one field into one step of the history. */
  onEdit: (next: SiteContent, key?: string) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  services: ServiceChoice[];
  /** The images of the site's library: what is there, whether the storage exists here, and how to send and remove. */
  images: { available: boolean; library: AssetRow[]; upload: (file: File) => Promise<UploadResult>; remove: (assetId: string) => Promise<RemoveResult> };
  slug: string;
  dirty: boolean;
  revision: number;
  pending: boolean;
  live: boolean;
  onSave: () => void;
  onPublish: () => void;
  /** Publishes with the warnings (what stops the publication still does). */
  onPublishAnyway: () => void;
  /** The answers to the buttons pressed here (saved, published, refused). */
  note: ReactNode;
  issues: PublishIssue[];
  onClose: () => void;
}

const END = Number.MAX_SAFE_INTEGER;

/**
 * Where a block added without dragging goes: inside the container that is selected, after the block that is selected, or at
 * the end of the page.
 */
function addSlot(content: SiteContent, selectedId: string | null): Slot {
  const found = selectedId ? locate(content, selectedId) : null;
  if (!found) return { parent: null, index: END };
  if (found.node.type === "box") return { parent: found.node.id, index: END };
  return { parent: found.parentId, index: found.index + 1 };
}

/**
 * The visual editor: the page itself in the middle, the blocks to add on the left, the settings of what is
 * selected on the right. It works on the same document the rest of the screen holds (the draft, with its
 * undo history); saving and publishing are done by the screen that opened it. It takes the whole window, as a
 * modal dialog, so nothing behind it can be reached while editing.
 */
export function VisualEditor(props: VisualEditorProps) {
  const { content, onEdit, services } = props;
  const mountPath = useMountPath();
  const dialog = useRef<HTMLDialogElement>(null);
  /** What is selected, in the order it was chosen: the last is the primary, which the panel shows and the handles sit on. */
  const [selection, setSelection] = useState<string[]>([]);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [hasStyleCopy, setHasStyleCopy] = useState(false);
  /** What was copied inside this editor: what the system clipboard cannot always give back (a browser may refuse to read it). */
  const copied = useRef({ blocks: "", style: "" });
  /**
   * The size of the screen being edited: its frame is the active one, and the style panel and the eye of the layers are about it. A window
   * that shows one panel at a time starts on the phone's frame, the others on the computer's.
   */
  const [screen, setScreen] = useState<Screen>(() => (window.matchMedia(COMPACT_QUERY).matches ? "mobile" : "desktop"));
  /** Which frames are on the canvas. */
  const [visible, setVisible] = useState<Record<Screen, boolean>>(() => {
    const phone = window.matchMedia(COMPACT_QUERY).matches;
    return { desktop: !phone, tablet: false, mobile: phone };
  });
  const canvasControls = useRef<CanvasControls>(null);
  const compact = useCompact();
  /**
   * Edits a size of the screen: its frame is shown if it was not. Where one panel is shown at a time the frame takes the place of the one
   * that was there (more can be asked for with the buttons over the canvas).
   */
  const chooseScreen = (next: Screen) => {
    setScreen(next);
    setVisible((previous) => (previous[next] ? previous : compact ? { desktop: false, tablet: false, mobile: false, [next]: true } : { ...previous, [next]: true }));
  };
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [leftTab, setLeftTab] = useState<"blocks" | "layers">("blocks");
  const [inspectorTab, setInspectorTab] = useState<"content" | "style">("content");
  const [panel, setPanel] = useState<"blocks" | "page" | "props">("page");
  const [drag, setDrag] = useState<Drag | null>(null);
  const [target, setTarget] = useState<Landing | null>(null);
  const [message, setMessage] = useState("");
  /** A block to bring into view (one just added, or chosen from a list). A new object each time, so the same block can be asked again. */
  const [scrollTo, setScrollTo] = useState<{ id: string } | null>(null);

  // Taking the dialog out of the page takes it out of the top layer: nothing to undo on the way out (and
  // closing it here would fire a "close" that, in development, ends the editor the moment it opens).
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);

  useEffect(() => {
    if (scrollTo) canvasControls.current?.reveal(scrollTo.id);
  }, [scrollTo]);

  const ids = useMemo(() => reconcile(content, selection), [content, selection]);
  const selected = primaryOf(ids);
  const selectedNow = useRef<string | null>(null);
  useEffect(() => {
    selectedNow.current = selected;
  });
  const resolved = useMemo(() => resolveServices(content, new Map(services.map((service) => [service.id, service]))), [content, services]);
  // The editor is never drawn on the server (it opens on a click), so the browser's address is there.
  const base = mountPath();
  const imageResolver = useMemo(() => libraryImages(base, props.images.library), [base, props.images.library]);
  const imageSupport: ImageSupport = {
    available: props.images.available,
    library: props.images.library,
    src: (assetId) => editorImageUrl(base, assetId),
    usedIds: new Set(referencedAssetIds(content)),
    upload: props.images.upload,
    remove: props.images.remove,
  };

  const apply = (result: Outcome) => {
    if (result.ok) {
      onEdit(result.content);
      setSelection([result.id]);
      setScrollTo({ id: result.id });
      setMessage("");
    } else {
      setMessage(REFUSAL_MESSAGE[result.reason]);
    }
  };
  const applyMany = (result: ManyOutcome) => {
    if (result.ok) {
      onEdit(result.content);
      setSelection(result.ids);
      setScrollTo({ id: result.ids[0] });
      setMessage("");
    } else {
      setMessage(REFUSAL_MESSAGE[result.reason]);
    }
  };

  const canDrop = (slot: Slot): boolean => {
    if (!drag) return false;
    if (drag.kind === "new") {
      const item = catalogueItem(drag.key);
      return item ? insertNode(content, item.create(), slot).ok : false;
    }
    return moveBlock(content, drag.id, slot).ok;
  };
  const act = (id: string, action: NodeAction) => {
    if (action === "up" || action === "down") onEdit(shiftBlock(content, id, action === "up" ? -1 : 1));
    else if (action === "duplicate") apply(duplicateBlock(content, id));
    else if (action === "out") apply(moveOut(content, id));
    else if (action === "into") apply(moveIntoPrevious(content, id));
    else if (action === "wrap") apply(wrapBlock(content, id));
    else if (action === "unwrap") apply(unwrapBlock(content, id));
    else {
      onEdit(removeBlock(content, id));
      setSelection([]);
    }
  };

  // ---- several blocks, the clipboard, the menu ----

  /** What a paste may keep of where it came from: the images and services of this site. */
  const pasteContext = (): PasteContext => ({ assetIds: new Set(props.images.library.map((asset) => asset.id)), serviceIds: new Set(services.map((service) => service.id)) });
  const actMany = (action: ManyAction) => {
    if (ids.length === 0) return;
    if (action === "delete") {
      onEdit(removeBlocks(content, ids));
      setSelection([]);
      setMessage("");
    } else if (action === "duplicate") applyMany(duplicateBlocks(content, ids));
    else apply(wrapBlocks(content, ids));
  };
  /** The text of what is selected, kept here too; with `cut` the blocks leave the page. Null when nothing is selected. */
  const copyBlocks = (cut: boolean): string | null => {
    const payload = blocksPayload(content, ids);
    if (!payload) return null;
    const text = JSON.stringify(payload);
    copied.current.blocks = text;
    if (cut) {
      onEdit(removeBlocks(content, ids));
      setSelection([]);
    }
    setMessage("");
    return text;
  };
  /** Puts the blocks of a copy into the page: inside the container selected, or after the block selected, or at the end. False when the text is not a copy of blocks. */
  const pasteBlocksText = (text: string): boolean => {
    const payload = parseBlocks(text);
    if (!payload) return false;
    applyMany(pasteBlocks(content, payload, addSlot(content, selected), pasteContext()));
    return true;
  };
  const copyStyleOf = (): string | null => {
    const node = selected ? locate(content, selected)?.node : null;
    if (!node) return null;
    const text = JSON.stringify(stylePayload(node));
    copied.current.style = text;
    setHasStyleCopy(true);
    return text;
  };
  const pasteStyleText = (text: string): boolean => {
    const payload = parseStyle(text);
    if (!payload || ids.length === 0) return false;
    const assets = pasteContext().assetIds;
    onEdit(updateBlocks(content, ids, (entry) => applyStyle(entry, payload, assets)));
    setMessage("");
    return true;
  };
  const toSystem = (text: string | null) => {
    if (text) void navigator.clipboard?.writeText(text).catch(() => undefined);
  };
  const readSystem = async (): Promise<string> => {
    try {
      return (await navigator.clipboard.readText()) ?? "";
    } catch {
      return "";
    }
  };
  const pasteFromSystem = async () => {
    if (!pasteBlocksText(await readSystem()) && !pasteBlocksText(copied.current.blocks)) setMessage("Não há blocos copiados para colar.");
  };
  const pasteStyleFromSystem = async () => {
    if (!pasteStyleText(await readSystem()) && !pasteStyleText(copied.current.style)) setMessage("Não há estilo copiado para colar.");
  };
  const startRename = (id: string) => {
    setLeftTab("layers");
    setPanel("blocks");
    setRenaming(id);
  };
  const openMenu = (id: string, x: number, y: number) => {
    setSelection((previous) => (reconcile(content, previous).includes(id) ? previous : [id]));
    setMenu({ id, x, y });
  };
  const menuNode = menu ? locate(content, menu.id)?.node : null;
  const hiddenHere = menuNode ? isHiddenAt(menuNode, screen) : false;
  const menuItems: MenuEntry[] = menuNode
    ? [
        { label: "Copiar", shortcut: "Ctrl+C", run: () => toSystem(copyBlocks(false)) },
        { label: "Recortar", shortcut: "Ctrl+X", run: () => toSystem(copyBlocks(true)) },
        { label: "Colar", shortcut: "Ctrl+V", run: () => void pasteFromSystem() },
        { label: "Duplicar", shortcut: "Ctrl+D", run: () => actMany("duplicate") },
        null,
        { label: "Agrupar em um contêiner", shortcut: "Ctrl+G", run: () => actMany("wrap") },
        { label: "Desagrupar", shortcut: "Ctrl+Shift+G", disabled: !(ids.length === 1 && menuNode.type === "box"), run: () => selected && act(selected, "unwrap") },
        null,
        { label: "Copiar estilo", shortcut: "Ctrl+Alt+C", run: () => toSystem(copyStyleOf()) },
        { label: "Colar estilo", shortcut: "Ctrl+Alt+V", disabled: !hasStyleCopy, run: () => void pasteStyleFromSystem() },
        null,
        { label: hiddenHere ? `Mostrar no ${SCREEN_LABEL[screen].toLowerCase()}` : `Ocultar no ${SCREEN_LABEL[screen].toLowerCase()}`, run: () => onEdit(updateBlocks(content, ids, (entry) => setHidden(entry, screen, !hiddenHere))) },
        { label: "Dar um nome…", shortcut: "F2", disabled: ids.length !== 1, run: () => selected && startRename(selected) },
        null,
        { label: ids.length > 1 ? `Excluir ${ids.length} blocos` : "Excluir", shortcut: "Delete", danger: true, run: () => actMany("delete") },
      ]
    : [];
  const dropAt = (slot: Slot) => {
    if (drag) {
      if (drag.kind === "new") {
        const item = catalogueItem(drag.key);
        if (item) apply(insertNode(content, item.create(), slot));
      } else {
        apply(moveBlock(content, drag.id, slot));
      }
    }
    setDrag(null);
    setTarget(null);
  };
  const startDrag = (next: Drag) => {
    // The screen changes after the browser has taken the drag: changing it inside `dragstart` can cancel it.
    setTimeout(() => setDrag(next), 0);
  };
  const endDrag = () => {
    setDrag(null);
    setTarget(null);
  };

  const api: EditorApi = {
    content,
    selectedId: mode === "edit" ? selected : null,
    selectedIds: mode === "edit" ? ids : [],
    select: (id, size, how = "replace") => {
      setSelection((previous) => (id === null ? [] : how === "toggle" ? toggleId(reconcile(content, previous), id) : [id]));
      if (id) setPanel("page");
      if (size && size !== screen) chooseScreen(size);
    },
    selectMany: (many, size) => {
      setSelection(many);
      if (many.length > 0) setPanel("page");
      if (size && size !== screen) chooseScreen(size);
    },
    actMany,
    menu: openMenu,
    commitText: (blockId, path, value) => onEdit(updateBlock(content, blockId, (entry) => setIn(entry, path, value))),
    drag,
    startDrag,
    endDrag,
    target,
    setTarget: (landing) =>
      setTarget((previous) => (previous && landing && previous.slot.parent === landing.slot.parent && previous.slot.index === landing.slot.index ? previous : landing)),
    canDrop,
    drop: dropAt,
    act,
    edit: (id, change, key) => onEdit(updateBlock(content, id, (entry) => change(entry, screen)), key),
    undo: props.undo,
  };
  const hooks = canvasHooks();
  const add = (key: string) => {
    const item = catalogueItem(key);
    if (item) apply(insertNode(content, item.create(), addSlot(content, selected)));
  };
  // The frames of the canvas are different widths in one window, so their sizes of the screen are container queries (see site-css.ts).
  const styles = useMemo(() => buildSiteCss(resolved, { ...libraryCssImages(base, props.images.library), container: true }), [resolved, base, props.images.library]);

  // Shortcuts: Ctrl/Cmd+S saves, Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z (or Y) redoes; Ctrl/Cmd with + or - zooms the canvas, with 0 puts it back
  // to 100% (with Shift, fits it to the window); the arrows move the canvas when no block is selected. Heard on the document, not on
  // the dialog: after a click on the page itself the focus may be on the body, and the shortcut must still work.
  // Inside a field, undo is the field's own; save and zoom work everywhere.
  const { dirty, pending, onSave, undo, redo } = props;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (modifier && key === "s") {
        event.preventDefault();
        if (dirty && !pending) onSave();
        return;
      }
      if (modifier && (event.code === "Equal" || event.code === "NumpadAdd" || key === "+")) {
        event.preventDefault();
        canvasControls.current?.zoomIn();
        return;
      }
      if (modifier && (event.code === "Minus" || event.code === "NumpadSubtract")) {
        event.preventDefault();
        canvasControls.current?.zoomOut();
        return;
      }
      if (modifier && (event.code === "Digit0" || event.code === "Numpad0")) {
        event.preventDefault();
        if (event.shiftKey) canvasControls.current?.fit();
        else canvasControls.current?.actualSize();
        return;
      }
      if ((event.target as HTMLElement).closest?.("input, textarea, select, [contenteditable]")) return;
      const arrow: Record<string, [number, number]> = { ArrowLeft: [20, 0], ArrowRight: [-20, 0], ArrowUp: [0, 20], ArrowDown: [0, -20] };
      if (!modifier && !event.altKey && !event.shiftKey && arrow[event.key] && !selectedNow.current && !(event.target as HTMLElement).closest?.("button, a, summary, [role='button']")) {
        event.preventDefault();
        canvasControls.current?.pan(...arrow[event.key]);
        return;
      }
      if (modifier && key === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (modifier && key === "y") {
        event.preventDefault();
        redo();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [dirty, pending, onSave, undo, redo]);

  // The selection's own shortcuts and the clipboard. Registered again after every render, so what they do is always about the document as it is now.
  useEffect(() => {
    if (mode !== "edit") return;
    const typing = (target: EventTarget | null) => Boolean((target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable]"));
    const hasTextSelected = () => (window.getSelection()?.toString() ?? "") !== "";
    const onCopy = (event: ClipboardEvent) => {
      if (typing(event.target) || hasTextSelected() || menu) return;
      const text = copyBlocks(false);
      if (!text) return;
      event.clipboardData?.setData("text/plain", text);
      event.preventDefault();
    };
    const onCut = (event: ClipboardEvent) => {
      if (typing(event.target) || hasTextSelected() || menu) return;
      const text = copyBlocks(true);
      if (!text) return;
      event.clipboardData?.setData("text/plain", text);
      event.preventDefault();
    };
    const onPaste = (event: ClipboardEvent) => {
      if (typing(event.target) || menu) return;
      if (pasteBlocksText(event.clipboardData?.getData("text/plain") ?? "")) event.preventDefault();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || typing(event.target) || menu) return;
      const modifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (modifier && event.altKey && event.code === "KeyC") {
        event.preventDefault();
        toSystem(copyStyleOf());
      } else if (modifier && event.altKey && event.code === "KeyV") {
        event.preventDefault();
        void pasteStyleFromSystem();
      } else if (modifier && !event.altKey && key === "d" && ids.length > 0) {
        event.preventDefault();
        actMany("duplicate");
      } else if (modifier && !event.altKey && key === "g" && ids.length > 0) {
        event.preventDefault();
        if (event.shiftKey) {
          if (ids.length === 1 && selected) act(selected, "unwrap");
        } else actMany("wrap");
      } else if (!modifier && !event.altKey && (event.key === "Delete" || event.key === "Backspace") && ids.length > 0) {
        event.preventDefault();
        actMany("delete");
      } else if (!modifier && !event.altKey && event.key === "Escape" && ids.length > 0) {
        event.preventDefault();
        setSelection([]);
      } else if (!modifier && !event.altKey && event.key === "F2" && ids.length === 1 && selected) {
        event.preventDefault();
        startRename(selected);
      } else if (!modifier && !event.altKey && selected && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
        // The arrows walk the tree from the primary: up and down in reading order, left to the container, right into it. With Shift the walk adds to the selection.
        const direction = ({ ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" } as const)[event.key as "ArrowUp"];
        const next = navigate(content, selected, direction);
        event.preventDefault();
        if (!next) return;
        setSelection((previous) => {
          const now = reconcile(content, previous);
          if (!event.shiftKey) return [next];
          return now.includes(next) ? now.filter((id) => id !== selected) : [...now, next];
        });
        setScrollTo({ id: next });
      }
    };
    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCut);
    document.addEventListener("paste", onPaste);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCut);
      document.removeEventListener("paste", onPaste);
      document.removeEventListener("keydown", onKey);
    };
  });

  const statusText = props.dirty ? "Alterações não salvas" : `Rascunho salvo (revisão ${props.revision})`;
  const selectedLabel = selected ? nodeTitle(locate(content, selected)!.node) : null;

  return (
    <dialog
      ref={dialog}
      className="ve"
      aria-label="Editor visual do site"
      onCancel={(event) => event.preventDefault()}
      onClose={props.onClose}
    >
      <header className="ve-top">
        <div className="ve-brand">
          <strong>Meu Site</strong>
          <span>Editor visual</span>
        </div>
        <div className="ve-status">
          <p role="status" className={props.dirty ? "ve-dirty" : undefined}>
            {statusText}
          </p>
          {message && <p role="alert" className="form-error">{message}</p>}
          {props.note}
        </div>
        <div className="ve-toolbar">
          <button type="button" className="ve-icon-button" onClick={props.undo} disabled={!props.canUndo} aria-label="Desfazer" title="Desfazer (Ctrl+Z)">
            <Undo2 size={18} />
          </button>
          <button type="button" className="ve-icon-button" onClick={props.redo} disabled={!props.canRedo} aria-label="Refazer" title="Refazer (Ctrl+Shift+Z)">
            <Redo2 size={18} />
          </button>
          <button type="button" className="button small secondary" aria-pressed={mode === "preview"} onClick={() => setMode(mode === "edit" ? "preview" : "edit")}>
            {mode === "edit" ? <Eye size={16} /> : <Pencil size={16} />}
            {mode === "edit" ? "Prévia" : "Voltar a editar"}
          </button>
          <button type="button" className="button small secondary" disabled={props.pending || !props.dirty} onClick={props.onSave}>
            {props.pending ? "Aguarde…" : "Salvar rascunho"}
          </button>
          <button
            type="button"
            className="button small primary"
            disabled={props.pending || props.dirty}
            title={props.dirty ? "Salve o rascunho antes de publicar" : undefined}
            onClick={props.onPublish}
          >
            {props.live ? "Publicar nova versão" : "Publicar"}
          </button>
          <button type="button" className="ve-icon-button" onClick={props.onClose} aria-label="Fechar o editor" title="Fechar o editor">
            <X size={18} />
          </button>
        </div>
      </header>

      {props.issues.length > 0 && (
        <div className="ve-issues">
          <PublishIssues
            issues={props.issues}
            pending={props.pending}
            onPublishAnyway={props.onPublishAnyway}
            action={(issue) =>
              issue.blockId && locate(content, issue.blockId) ? (
                <button
                  type="button"
                  className="button small secondary"
                  onClick={() => {
                    const blockId = issue.blockId!;
                    setMode("edit");
                    setSelection([blockId]);
                    setScrollTo({ id: blockId });
                    setPanel("props");
                  }}
                >
                  Ir ao bloco
                </button>
              ) : null
            }
          />
        </div>
      )}

      <div className="ve-compact-tabs" role="group" aria-label="Painéis do editor">
        {(["blocks", "page", "props"] as const).map((name) => (
          <button key={name} type="button" aria-pressed={panel === name} data-dot={name === "props" && selected ? "" : undefined} onClick={() => setPanel(name)}>
            {name === "blocks" ? "Blocos" : name === "page" ? "Página" : "Propriedades"}
          </button>
        ))}
      </div>

      <div className="ve-body" data-panel={panel}>
        <aside className="ve-left" aria-label="Blocos e camadas">
          <div className="ve-tabs" role="group" aria-label="Biblioteca">
            <button type="button" aria-pressed={leftTab === "blocks"} onClick={() => setLeftTab("blocks")}>
              Blocos
            </button>
            <button type="button" aria-pressed={leftTab === "layers"} onClick={() => setLeftTab("layers")}>
              Camadas
            </button>
          </div>
          {leftTab === "blocks" ? (
            <Library onAdd={add} startDrag={startDrag} endDrag={endDrag} />
          ) : (
            <Layers
              content={content}
              screen={screen}
              toggleHidden={(blockId) => onEdit(updateBlock(content, blockId, (entry) => toggleHidden(entry, screen)), `${blockId}:hidden:${screen}`)}
              selectedIds={ids}
              select={(id, how = "replace") => {
                setSelection((previous) => {
                  const now = reconcile(content, previous);
                  if (id === null) return [];
                  if (how === "toggle") return toggleId(now, id);
                  if (how === "range") return selectRange(content, primaryOf(now), id);
                  return [id];
                });
                if (id) setScrollTo({ id });
                setPanel("props");
              }}
              menu={openMenu}
              renamingId={renaming}
              startRename={startRename}
              rename={(id, name) => {
                setRenaming(null);
                if (name !== null) onEdit(updateBlock(content, id, (entry) => ({ ...entry, name: name.trim() || undefined }) as typeof entry));
              }}
              drag={drag}
              startDrag={startDrag}
              endDrag={endDrag}
              canDrop={canDrop}
              drop={dropAt}
            />
          )}
        </aside>

        <main className="ve-stage" aria-label="Página">
          <div className="ve-stagebar">
            <div>
              <strong>Seu site</strong>
              <small>{mode === "edit" ? "Arraste, solte e clique em um bloco para editar" : "Prévia: é assim que a página aparece"}</small>
            </div>
            <PublicAddress slug={props.slug} className="ve-address" />
          </div>
          <InlineSiteStyles css={styles} />
          <EditorContext.Provider value={api}>
            <CanvasSurface
              ref={canvasControls}
              screen={screen}
              onScreen={chooseScreen}
              visible={visible}
              onVisible={setVisible}
              interactive={mode === "edit"}
              page={(size) =>
                mode === "edit" ? <SiteRenderer content={resolved} edit={hooks} images={imageResolver} /> : <SiteRenderer content={resolved} images={imageResolver} scope={`${size}-`} />
              }
            />
          </EditorContext.Provider>
        </main>

        <aside className="ve-right" aria-label="Propriedades">
          <div className="ve-panel-head">
            <h2>{selectedLabel ?? "Página"}</h2>
          </div>
          {selected ? (
            <BlockInspector
              key={selected}
              content={content}
              id={selected}
              services={services}
              images={imageSupport}
              tab={inspectorTab}
              onTab={setInspectorTab}
              screen={screen}
              onScreen={chooseScreen}
              onChange={onEdit}
              act={act}
              ids={ids}
              select={(id) => {
                setSelection([id]);
                setScrollTo({ id });
              }}
            />
          ) : (
            <PageSettings content={content} onChange={onEdit} images={imageSupport} />
          )}
        </aside>
      </div>
      {menu && menuNode && <ContextMenu x={menu.x} y={menu.y} label={ids.length > 1 ? `${ids.length} blocos` : nodeTitle(menuNode)} items={menuItems} onClose={() => setMenu(null)} />}
    </dialog>
  );
}
