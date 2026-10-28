"use client";
import type { KeyboardEvent } from "react";
import {
  AlignLeft,
  Columns2,
  CircleHelp,
  Heading,
  Image as ImageIcon,
  LayoutGrid,
  LayoutTemplate,
  Megaphone,
  Pilcrow,
  Quote,
  RectangleHorizontal,
  UserRound,
  ChartNoAxesColumn,
  type LucideIcon,
} from "lucide-react";
import { BLOCK_LABEL, type Block, type BlockType, type ColumnItem, type SiteContent } from "./contracts";
import type { Drag } from "./editor-canvas";

interface Tile {
  type: BlockType;
  hint: string;
  icon: LucideIcon;
}
const GROUPS: { title: string; tiles: Tile[] }[] = [
  {
    title: "Seções prontas",
    tiles: [
      { type: "hero", hint: "Título e botão", icon: LayoutTemplate },
      { type: "text", hint: "Título e texto", icon: AlignLeft },
      { type: "services", hint: "Da sua lista", icon: LayoutGrid },
      { type: "about", hint: "Apresentação", icon: UserRound },
      { type: "quote", hint: "Com autorização", icon: Quote },
      { type: "stats", hint: "Números do método", icon: ChartNoAxesColumn },
      { type: "faq", hint: "Respostas curtas", icon: CircleHelp },
      { type: "cta", hint: "Chamada com botão", icon: Megaphone },
    ],
  },
  { title: "Layouts", tiles: [{ type: "columns", hint: "Lado a lado", icon: Columns2 }] },
  {
    title: "Elementos básicos",
    tiles: [
      { type: "heading", hint: "Texto em destaque", icon: Heading },
      { type: "paragraph", hint: "Texto simples", icon: Pilcrow },
      { type: "button", hint: "Leva a um contato", icon: RectangleHorizontal },
      { type: "image", hint: "Da biblioteca do site", icon: ImageIcon },
    ],
  },
];

/** The blocks that can be added: dragged onto the page, or (without dragging) added at the end with a click or Enter. */
export function Library({ onAdd, startDrag, endDrag }: { onAdd: (type: BlockType) => void; startDrag: (drag: Drag) => void; endDrag: () => void }) {
  const press = (type: BlockType) => (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onAdd(type);
    }
  };
  return (
    <div className="ve-library">
      {GROUPS.map((group) => (
        <section key={group.title} aria-label={group.title}>
          <h3 className="ve-subtitle">{group.title}</h3>
          <div className="ve-tiles">
            {group.tiles.map(({ type, hint, icon: Icon }) => (
              <div
                key={type}
                className="ve-tile"
                role="button"
                tabIndex={0}
                draggable
                aria-label={`Acrescentar ${BLOCK_LABEL[type]} ao fim da página`}
                title="Arraste para a página ou clique para acrescentar ao fim"
                onClick={() => onAdd(type)}
                onKeyDown={press(type)}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "copy";
                  event.dataTransfer.setData("text/plain", type);
                  startDrag({ kind: "new", type });
                }}
                onDragEnd={endDrag}
              >
                <Icon size={22} aria-hidden="true" />
                <strong>{BLOCK_LABEL[type]}</strong>
                <span>{hint}</span>
              </div>
            ))}
          </div>
        </section>
      ))}
      <p className="small muted ve-tip">
        Arraste um bloco para a linha entre dois blocos, ou clique nele para acrescentar ao fim. Dê dois cliques num texto da página para escrever
        nele.
      </p>
    </div>
  );
}

/** The structure of the page as a list: the way, without a pointer, to select a block and to see what is inside the columns. */
export function Layers({ content, selectedId, select }: { content: SiteContent; selectedId: string | null; select: (id: string | null) => void }) {
  const row = (entry: Block | ColumnItem, depth: number, position: number) => (
    <li key={entry.id}>
      <button type="button" className="ve-layer" data-depth={depth} aria-current={selectedId === entry.id ? "true" : undefined} onClick={() => select(entry.id)}>
        <span className="ve-layer-number">{position}</span>
        {BLOCK_LABEL[entry.type]}
      </button>
      {entry.type === "columns" && (
        <ul className="ve-layers-nested">
          {entry.left.map((item, index) => row(item, 1, index + 1))}
          {entry.right.map((item, index) => row(item, 1, entry.left.length + index + 1))}
        </ul>
      )}
    </li>
  );
  return (
    <div className="ve-library">
      <h3 className="ve-subtitle">Estrutura da página</h3>
      <ul className="ve-layers" aria-label="Blocos da página">
        <li>
          <button type="button" className="ve-layer" data-depth={0} aria-current={selectedId === null ? "true" : undefined} onClick={() => select(null)}>
            Configurações da página
          </button>
        </li>
        {content.blocks.map((block, index) => row(block, 0, index + 1))}
      </ul>
      {content.blocks.length === 0 && <p className="small muted">A página ainda não tem blocos.</p>}
    </div>
  );
}
