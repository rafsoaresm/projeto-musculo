"use client";
import { useState, type DragEvent, type KeyboardEvent } from "react";
import {
  AlignLeft,
  ChartNoAxesColumn,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Columns2,
  Columns3,
  Grid3x3,
  Heading,
  Image as ImageIcon,
  LayoutGrid,
  LayoutPanelTop,
  LayoutTemplate,
  Link as LinkIcon,
  Megaphone,
  Pilcrow,
  Quote,
  RectangleHorizontal,
  Rows3,
  Square,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { type SiteContent, type SiteNode } from "./contracts";
import type { Drag } from "./editor-canvas";
import type { Slot } from "./editor-model";
import { nodeText, nodeTitle } from "./node-label";
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
};
const GROUPS: Group[] = ["structure", "element", "section"];

/**
 * The blocks that can be added: dragged onto the page (or into the layers), or (without dragging) added with a click or
 * Enter: inside the container that is selected, after the block that is selected, or at the end of the page.
 */
export function Library({ onAdd, startDrag, endDrag }: { onAdd: (key: string) => void; startDrag: (drag: Drag) => void; endDrag: () => void }) {
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
      <p className="small muted ve-tip">
        Arraste um bloco para a página, para uma linha entre dois blocos ou para dentro de um contêiner. Sem arrastar: selecione um contêiner e clique no bloco
        para colocá-lo dentro dele. Dê dois cliques num texto da página para escrever nele.
      </p>
    </div>
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
  selectedId,
  select,
  drag,
  startDrag,
  endDrag,
  canDrop,
  drop,
}: {
  content: SiteContent;
  selectedId: string | null;
  select: (id: string | null) => void;
  drag: Drag | null;
  startDrag: (drag: Drag) => void;
  endDrag: () => void;
  canDrop: (slot: Slot) => boolean;
  drop: (slot: Slot) => void;
}) {
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
    return (
      <li key={entry.id}>
        <div
          className="ve-layer-row"
          data-depth={depth}
          data-drop={drag ? marked : undefined}
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
          <button type="button" className="ve-layer" aria-current={selectedId === entry.id ? "true" : undefined} onClick={() => select(entry.id)}>
            <strong>{nodeTitle(entry)}</strong>
            {text && <span className="ve-layer-text">{text}</span>}
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
      <ul className="ve-layers" aria-label="Blocos da página">
        <li>
          <div className="ve-layer-row" data-depth={0}>
            <span className="ve-layer-toggle" aria-hidden="true" />
            <button type="button" className="ve-layer" aria-current={selectedId === null ? "true" : undefined} onClick={() => select(null)}>
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
