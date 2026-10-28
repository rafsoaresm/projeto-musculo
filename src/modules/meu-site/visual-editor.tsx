"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Eye, Pencil, Redo2, Undo2, X } from "lucide-react";
import { referencedAssetIds, resolveServices, type PublishIssue, type SiteContent } from "./contracts";
import { CanvasSurface, EditorContext, canvasHooks, type Drag, type EditorApi, type NodeAction } from "./editor-canvas";
import { BlockInspector, PageSettings, type ImageSupport } from "./editor-inspector";
import { editorImageUrl, libraryCssImages, libraryImages } from "./image-urls";
import type { RemoveResult, UploadResult } from "./image-picker";
import type { AssetRow } from "@/db/site-assets";
import { useMountPath } from "@/components/use-mount-path";
import { Layers, Library } from "./editor-library";
import type { Landing } from "./drop-geometry";
import {
  REFUSAL_MESSAGE,
  duplicateBlock,
  insertNode,
  locate,
  moveBlock,
  moveIntoPrevious,
  moveOut,
  removeBlock,
  setIn,
  shiftBlock,
  unwrapBlock,
  updateBlock,
  wrapBlock,
  type Outcome,
  type Slot,
} from "./editor-model";
import { nodeTitle } from "./node-label";
import { catalogueItem } from "./presets";
import { PublicAddress } from "./public-address";
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
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
    if (scrollTo) dialog.current?.querySelector(`[data-block-id="${scrollTo.id}"]`)?.scrollIntoView({ block: "nearest" });
  }, [scrollTo]);

  const selected = selectedId && locate(content, selectedId) ? selectedId : null;
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
      setSelectedId(result.id);
      setScrollTo({ id: result.id });
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
      setSelectedId(null);
    }
  };
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
    select: (id) => {
      setSelectedId(id);
      if (id) setPanel("page");
    },
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
  };
  const hooks = canvasHooks();
  const add = (key: string) => {
    const item = catalogueItem(key);
    if (item) apply(insertNode(content, item.create(), addSlot(content, selected)));
  };
  const styles = useMemo(() => buildSiteCss(resolved, libraryCssImages(base, props.images.library)), [resolved, base, props.images.library]);

  // Shortcuts: Ctrl/Cmd+S saves, Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z (or Y) redoes. Heard on the document, not on
  // the dialog: after a click on the page itself the focus may be on the body, and the shortcut must still work.
  // Inside a field, undo is the field's own; save works everywhere.
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
      if ((event.target as HTMLElement).closest?.("input, textarea, select, [contenteditable]")) return;
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
        <div className="notice warning ve-issues" role="alert">
          <div>
            <p>
              <strong>Antes de publicar:</strong>
            </p>
            <ul aria-label="O que falta para publicar">
              {props.issues.map((issue, index) => (
                <li key={index}>
                  {issue.message}{" "}
                  {issue.blockId && locate(content, issue.blockId) && (
                    <button
                      type="button"
                      className="button small secondary"
                      onClick={() => {
                        const blockId = issue.blockId!;
                        setMode("edit");
                        setSelectedId(blockId);
                        setScrollTo({ id: blockId });
                        setPanel("props");
                      }}
                    >
                      Ir ao bloco
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
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
              selectedId={selected}
              select={(id) => {
                setSelectedId(id);
                if (id) setScrollTo({ id });
                setPanel("props");
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
            <div className="ve-device" role="group" aria-label="Tamanho da tela">
              <button type="button" aria-pressed={device === "desktop"} onClick={() => setDevice("desktop")}>
                Computador
              </button>
              <button type="button" aria-pressed={device === "mobile"} onClick={() => setDevice("mobile")}>
                Celular
              </button>
            </div>
          </div>
          <div
            className="ve-stage-scroll"
            data-dragging={drag ? "" : undefined}
            onClick={() => setSelectedId(null)}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setTarget(null);
            }}
          >
            <div className="ve-browser" data-device={device} data-mode={mode}>
              <div className="ve-browserbar" aria-hidden="true">
                <span className="ve-dots">
                  <i />
                  <i />
                  <i />
                </span>
                <PublicAddress slug={props.slug} className="ve-address" />
              </div>
              <InlineSiteStyles css={styles} />
              <EditorContext.Provider value={api}>
                {mode === "edit" ? (
                  <CanvasSurface>
                    <SiteRenderer content={resolved} edit={hooks} images={imageResolver} />
                  </CanvasSurface>
                ) : (
                  <SiteRenderer content={resolved} images={imageResolver} />
                )}
              </EditorContext.Provider>
            </div>
          </div>
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
              onChange={onEdit}
              act={act}
              select={(id) => {
                setSelectedId(id);
                setScrollTo({ id });
              }}
            />
          ) : (
            <PageSettings content={content} onChange={onEdit} images={imageSupport} />
          )}
        </aside>
      </div>
    </dialog>
  );
}
