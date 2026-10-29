"use client";
import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import {
  AlignLeft,
  ChartNoAxesColumn,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Columns2,
  Columns3,
  Component,
  Copy,
  CreditCard,
  Grid3x3,
  Eye,
  EyeOff,
  Heading,
  Image as ImageIcon,
  LayoutGrid,
  LayoutPanelTop,
  LayoutTemplate,
  Link as LinkIcon,
  Megaphone,
  MessagesSquare,
  PanelBottom,
  PanelTop,
  Pilcrow,
  Quote,
  RectangleHorizontal,
  Rows3,
  Pencil,
  Square,
  Trash2,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { NAME_MAX, type ComponentDef, type SiteContent, type SiteNode } from "./contracts";
import type { Drag } from "./editor-canvas";
import type { Slot } from "./editor-model";
import { nodeText, nodeTitle } from "./node-label";
import { SCREEN_LABEL, isHiddenAt, type Screen } from "./screens";
import { SCREEN_ICON } from "./screen-ui";
import { CATALOGUE, GROUP_LABEL, type Group } from "./presets";

const ICON: Record<string, LucideIcon> = {
  section: LayoutPanelTop,
  container: Square,
  row: Columns3,
  column: Rows3,
  grid: Grid3x3,
  columns2: Columns2,
  stack: Rows3,
  heading: Heading,
  paragraph: Pilcrow,
  button: RectangleHorizontal,
  link: LinkIcon,
  image: ImageIcon,
  hero: LayoutTemplate,
  text: AlignLeft,
  services: LayoutGrid,
  about: UserRound,
  quote: Quote,
  stats: ChartNoAxesColumn,
  faq: CircleHelp,
  cta: Megaphone,
  "template-navigation": PanelTop,
  "template-highlights": Columns3,
  "template-image-text": ImageIcon,
  "template-plans": CreditCard,
  "template-testimonials": MessagesSquare,
  "template-footer": PanelBottom,
};
const GROUPS: Group[] = ["structure", "element", "section", "template"];

/** The key a component has among the things that can be added: `component:<id>`. */
export const COMPONENT_KEY = "component:";

/** What the library does with the components of the site, besides adding an instance (a click or a drag, like any block). */
export interface LibraryComponents {
  /** The components of the site. */
  list: readonly ComponentDef[];
  edit: (componentId: string) => void;
  copy: (componentId: string) => void;
  remove: (componentId: string) => void;
}

/**
 * The blocks that can be added: dragged onto the page (or into the layers), or (without dragging) added with a click or
 * Enter: inside the container that is selected, after the block that is selected, or at the end of the page.
 */
export function Library({
  onAdd,
  startDrag,
  endDrag,
  components,
  editingComponent,
}: {
  onAdd: (key: string) => void;
  startDrag: (drag: Drag) => void;
  endDrag: () => void;
  components: LibraryComponents;
  /** The name of the component being edited, if one is: its components are not offered then (a component cannot hold another one). */
  editingComponent: string | null;
}) {
  const press = (key: string) => (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onAdd(key);
    }
  };
  return (
    <div className="ve-library">
      {GROUPS.map((group) => (
        <section key={group} aria-label={GROUP_LABEL[group]}>
          <h3 className="ve-subtitle">{GROUP_LABEL[group]}</h3>
          <div className="ve-tiles">
            {CATALOGUE.filter((item) => item.group === group).map((item) => {
              const Icon = ICON[item.key] ?? Square;
              return (
                <div
                  key={item.key}
                  className="ve-tile"
                  role="button"
                  tabIndex={0}
                  draggable
                  aria-label={`Acrescentar ${item.label}`}
                  title="Arraste para a página ou para as camadas, ou clique para acrescentar"
                  onClick={() => onAdd(item.key)}
                  onKeyDown={press(item.key)}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "copy";
                    event.dataTransfer.setData("text/plain", item.key);
                    startDrag({ kind: "new", key: item.key });
                  }}
                  onDragEnd={endDrag}
                >
                  <Icon size={22} aria-hidden="true" />
                  <strong>{item.label}</strong>
                  <span>{item.hint}</span>
                </div>
              );
            })}
          </div>
        </section>
      ))}
      <section aria-label="Componentes">
        <h3 className="ve-subtitle">Componentes</h3>
        {editingComponent !== null ? (
          <p className="small muted">Você está editando o componente “{editingComponent}”. Um componente não pode ter outro componente dentro.</p>
        ) : components.list.length === 0 ? (
          <p className="small muted">Um componente é um bloco que você usa em vários lugares e muda num só. Selecione blocos na página, clique com o botão direito e escolha “Criar componente”.</p>
        ) : (
          <ul className="ve-components">
            {components.list.map((entry) => {
              const key = `${COMPONENT_KEY}${entry.id}`;
              return (
                <li key={entry.id} className="ve-component">
                  <div
                    className="ve-tile"
                    role="button"
                    tabIndex={0}
                    draggable
                    aria-label={`Acrescentar o componente ${entry.name}`}
                    title="Arraste para a página ou para as camadas, ou clique para acrescentar"
                    onClick={() => onAdd(key)}
                    onKeyDown={press(key)}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "copy";
                      event.dataTransfer.setData("text/plain", key);
                      startDrag({ kind: "new", key });
                    }}
                    onDragEnd={endDrag}
                  >
                    <Component size={22} aria-hidden="true" />
                    <strong>{entry.name}</strong>
                    <span>Componente</span>
                  </div>
                  <div className="ve-component-actions" role="group" aria-label={`Ações do componente ${entry.name}`}>
                    <button type="button" className="ve-icon-button" aria-label={`Editar o componente ${entry.name}`} title="Editar o componente: vale para todos os blocos que o usam" onClick={() => components.edit(entry.id)}>
                      <Pencil size={15} aria-hidden="true" />
                    </button>
                    <button type="button" className="ve-icon-button" aria-label={`Acrescentar uma cópia de ${entry.name}`} title="Acrescentar uma cópia: blocos comuns, que não seguem o componente" onClick={() => components.copy(entry.id)}>
                      <Copy size={15} aria-hidden="true" />
                    </button>
                    <button type="button" className="ve-icon-button" aria-label={`Excluir o componente ${entry.name}`} title="Excluir o componente: os blocos que o usam viram blocos comuns" onClick={() => components.remove(entry.id)}>
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <p className="small muted ve-tip">
        Arraste um bloco para a página, para uma linha entre dois blocos ou para dentro de um contêiner. Sem arrastar: selecione um contêiner e clique no bloco
        para colocá-lo dentro dele. Dê dois cliques num texto da página para escrever nele.
      </p>
    </div>
  );
}

/** The name of a layer, typed over in place: Enter keeps it, Escape gives it up, and leaving the field keeps it. It is only for the person (it is not in the page). */
function LayerName({ entry, rename }: { entry: SiteNode; rename: (id: string, name: string | null) => void }) {
  const field = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);
  const finish = (keep: boolean) => {
    if (done.current) return;
    done.current = true;
    rename(entry.id, keep ? (field.current?.value ?? "") : null);
  };
  return (
    <input
      ref={field}
      className="ve-layer-name"
      aria-label={`Nome da camada ${nodeTitle(entry)}`}
      defaultValue={entry.name ?? ""}
      placeholder={nodeTitle(entry)}
      maxLength={NAME_MAX}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          finish(true);
        } else if (event.key === "Escape") {
          event.preventDefault();
          finish(false);
        }
      }}
      onBlur={() => finish(true)}
    />
  );
}

type Zone = "before" | "after" | "inside";
const END = Number.MAX_SAFE_INTEGER;

/**
 * The structure of the page as a tree: select a block, open and close containers, and drag a block to a new place (before,
 * after or inside another). The way, without a pointer, to select any block, and to see what is inside what.
 */
export function Layers({
  content,
  screen,
  selectedIds,
  select,
  menu,
  renamingId,
  startRename,
  rename,
  toggleHidden,
  drag,
  startDrag,
  endDrag,
  canDrop,
  drop,
}: {
  content: SiteContent;
  /** The size of the screen being edited: the eye of each layer is about it. */
  screen: Screen;
  /** What is selected, in the order it was chosen (the last is the primary). */
  selectedIds: readonly string[];
  /** A click chooses a layer; with Ctrl or Cmd it adds the layer to the selection (or takes it away), with Shift it chooses every layer from the last one chosen to this one. */
  select: (id: string | null, how?: "replace" | "toggle" | "range") => void;
  menu: (id: string, x: number, y: number) => void;
  /** The layer whose name is being typed over (double click, F2, or the menu), if any. */
  renamingId: string | null;
  startRename: (id: string) => void;
  /** Gives the layer the name typed (empty: back to the block's own name), or, with null, gives the rename up. */
  rename: (id: string, name: string | null) => void;
  toggleHidden: (id: string) => void;
  drag: Drag | null;
  startDrag: (drag: Drag) => void;
  endDrag: () => void;
  canDrop: (slot: Slot) => boolean;
  drop: (slot: Slot) => void;
}) {
  const ScreenIcon = SCREEN_ICON[screen];
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const [hint, setHint] = useState<{ id: string; zone: Zone } | null>(null);

  const toggle = (id: string) =>
    setClosed((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const slotFor = (entry: SiteNode, parentId: string | null, index: number, zone: Zone): Slot =>
    zone === "inside" ? { parent: entry.id, index: END } : { parent: parentId, index: zone === "before" ? index : index + 1 };
  const zoneAt = (event: DragEvent<HTMLElement>, holds: boolean): Zone => {
    const rect = event.currentTarget.getBoundingClientRect();
    const at = (event.clientY - rect.top) / Math.max(rect.height, 1);
    if (holds && at > 0.28 && at < 0.72) return "inside";
    return at < 0.5 ? "before" : "after";
  };

  const row = (entry: SiteNode, parentId: string | null, index: number, depth: number) => {
    const holds = entry.type === "box";
    const open = holds && !closed.has(entry.id);
    const text = nodeText(entry);
    const marked = hint?.id === entry.id ? hint.zone : undefined;
    const hidden = isHiddenAt(entry, screen);
    return (
      <li key={entry.id}>
        <div
          className="ve-layer-row"
          data-depth={depth}
          data-drop={drag ? marked : undefined}
          data-hidden={hidden || undefined}
          draggable
          onDragStart={(event) => {
            event.stopPropagation();
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", entry.id);
            startDrag({ kind: "move", id: entry.id });
          }}
          onDragEnd={() => {
            setHint(null);
            endDrag();
          }}
          onDragOver={(event) => {
            if (!drag) return;
            const zone = zoneAt(event, holds);
            if (!canDrop(slotFor(entry, parentId, index, zone))) {
              setHint(null);
              return;
            }
            event.preventDefault();
            event.dataTransfer.dropEffect = drag.kind === "new" ? "copy" : "move";
            setHint((previous) => (previous?.id === entry.id && previous.zone === zone ? previous : { id: entry.id, zone }));
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as globalThis.Node | null)) setHint(null);
          }}
          onDrop={(event) => {
            if (!drag) return;
            const slot = slotFor(entry, parentId, index, zoneAt(event, holds));
            if (!canDrop(slot)) return;
            event.preventDefault();
            setHint(null);
            drop(slot);
          }}
        >
          {holds && entry.children.length > 0 ? (
            <button type="button" className="ve-layer-toggle" aria-expanded={open} aria-label={`${open ? "Fechar" : "Abrir"} ${nodeTitle(entry)}`} onClick={() => toggle(entry.id)}>
              {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          ) : (
            <span className="ve-layer-toggle" aria-hidden="true" />
          )}
          {renamingId === entry.id ? (
            <LayerName entry={entry} rename={rename} />
          ) : (
            <button
              type="button"
              className="ve-layer"
              aria-current={selectedIds.includes(entry.id) ? "true" : undefined}
              data-primary={selectedIds[selectedIds.length - 1] === entry.id && selectedIds.length > 1 ? "" : undefined}
              title="Clique para escolher. Ctrl ou Cmd: junta à seleção. Shift: do último escolhido até aqui. Dois cliques ou F2: dar um nome"
              onClick={(event) => select(entry.id, event.shiftKey ? "range" : event.ctrlKey || event.metaKey ? "toggle" : "replace")}
              onDoubleClick={() => startRename(entry.id)}
              onContextMenu={(event) => {
                event.preventDefault();
                menu(entry.id, event.clientX, event.clientY);
              }}
            >
              <strong>{nodeTitle(entry)}</strong>
              {text && <span className="ve-layer-text">{text}</span>}
            </button>
          )}
          <button
            type="button"
            className="ve-layer-eye"
            aria-pressed={hidden}
            aria-label={`${hidden ? "Mostrar" : "Ocultar"} ${nodeTitle(entry)} no ${SCREEN_LABEL[screen].toLowerCase()}`}
            title={hidden ? `Oculto no ${SCREEN_LABEL[screen].toLowerCase()}: clique para mostrar` : `Ocultar no ${SCREEN_LABEL[screen].toLowerCase()}`}
            onClick={() => toggleHidden(entry.id)}
          >
            {hidden ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
          </button>
        </div>
        {open && entry.type === "box" && (
          <ul className="ve-layers-nested" aria-label={`Dentro de ${nodeTitle(entry)}`}>
            {entry.children.map((child, at) => row(child, entry.id, at, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <div className="ve-library">
      <h3 className="ve-subtitle">Estrutura da página</h3>
      <p className="ve-layers-size small muted">
        <ScreenIcon size={14} aria-hidden="true" /> {SCREEN_LABEL[screen]}
      </p>
      <ul className="ve-layers" aria-label="Blocos da página">
        <li>
          <div className="ve-layer-row" data-depth={0}>
            <span className="ve-layer-toggle" aria-hidden="true" />
            <button type="button" className="ve-layer" aria-current={selectedIds.length === 0 ? "true" : undefined} onClick={() => select(null)}>
              <strong>Configurações da página</strong>
            </button>
          </div>
        </li>
        {content.blocks.map((entry, index) => row(entry, null, index, 0))}
      </ul>
      {content.blocks.length === 0 && <p className="small muted">A página ainda não tem blocos.</p>}
      <p className="small muted ve-tip">Arraste uma camada para cima ou para baixo de outra; no meio de um contêiner, ela entra nele.</p>
    </div>
  );
}
