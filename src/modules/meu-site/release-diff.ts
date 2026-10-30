import { HOME, allNodes, componentsOf, pagesOf, withoutResolvedServices, type ComponentDef, type SiteContent, type SiteNode } from "./contracts";
import { nodeText, nodeTitle } from "./node-label";
import { ACCENT_LABEL, FONT_LABEL, MODE_LABEL, WIDTH_LABEL } from "./site-theme";

/**
 * What changed between two versions of the site (two releases, or a release and the draft), as a list a person can read and the blocks that
 * the page shows marked. Nothing here looks at the screen: it takes two documents and says what is different, by the identifiers that blocks,
 * pages and components keep from one version to the next.
 *
 * A block is the same block in two versions when it has the same identifier. A block that is only in the newer one was added, one that is only
 * in the older one was removed (a container added or removed is told once, not once for each block inside), one with other contents changed (the
 * list says which: "o título e o estilo do computador"), and one in another place (another page, or inside another container) was moved. A
 * different order among the blocks that stayed in the same place is told for the place, not for each block. The services that the release
 * resolved for the public page are left out of the comparison (the draft does not carry them): what is compared is the services chosen.
 */
export type ChangeKind = "added" | "removed" | "changed" | "moved";

export interface Change {
  /** The page it is about: `HOME`, the identifier of a page, or null for the site as a whole (title, contact, look, components). */
  page: string | null;
  kind: ChangeKind;
  /** The block it is about in the newer version (the page shows it marked), or null. */
  blockId: string | null;
  text: string;
}
export type Mark = "added" | "changed";
export interface Diff {
  changes: Change[];
  /** The blocks of the newer version to mark on the page: added ones, and ones that changed or moved (or are in what changed). */
  marks: Map<string, Mark>;
}

/** The most changes the list tells; the rest is counted. */
export const MAX_CHANGES = 200;

const QUOTE_MAX = 40;
const quoted = (value: string) => {
  const flat = value.replace(/\s+/g, " ").trim();
  return `“${flat.length > QUOTE_MAX ? `${flat.slice(0, QUOTE_MAX - 1)}…` : flat}”`;
};
const said = (value: string | undefined) => (value === undefined || value === "" ? "vazio" : quoted(value));

/** "a, b e c". */
export const joined = (items: readonly string[]): string => (items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`);

/** What each field of a block is called when it changes. */
const FIELD_LABEL: Record<string, string> = {
  eyebrow: "a etiqueta",
  heading: "o título",
  subheading: "o subtítulo",
  text: "o texto",
  intro: "a introdução",
  buttonLabel: "o texto do botão",
  buttonChannel: "o contato do botão",
  label: "o texto",
  channel: "o contato",
  anchor: "o bloco de destino",
  page: "a página de destino",
  stat: "o número",
  statLabel: "a legenda do número",
  quote: "o depoimento",
  author: "o autor",
  authorized: "a autorização do depoimento",
  items: "os itens",
  serviceIds: "os serviços escolhidos",
  assetId: "a imagem",
  alt: "a descrição da imagem",
  caption: "a legenda",
  size: "o tamanho da imagem",
  ratio: "a proporção da imagem",
  level: "o nível do título",
  tag: "o tipo do contêiner",
  name: "o nome da camada",
  style: "o estilo do computador",
  styleTablet: "o estilo do tablet",
  styleMobile: "o estilo do celular",
  componentId: "o componente",
  overrides: "o que este uso muda do componente",
};

interface Placed {
  node: SiteNode;
  page: string;
  parent: string | null;
}
function place(content: SiteContent): Map<string, Placed> {
  const out = new Map<string, Placed>();
  const walk = (nodes: readonly SiteNode[], page: string, parent: string | null) => {
    for (const node of nodes) {
      out.set(node.id, { node, page, parent });
      if (node.type === "box") walk(node.children, page, node.id);
    }
  };
  walk(content.blocks, HOME, null);
  for (const entry of pagesOf(content)) walk(entry.blocks, entry.id, null);
  return out;
}

/** The fields of a block (not what it holds) that are not the same in the two versions, in the order they are written. */
function changedFields(before: SiteNode, after: SiteNode): string[] {
  const a = before as unknown as Record<string, unknown>;
  const b = after as unknown as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((key) => key !== "id" && key !== "children");
  return keys.filter((key) => JSON.stringify(a[key]) !== JSON.stringify(b[key]));
}
const fieldsText = (keys: readonly string[]) => joined([...new Set(keys.map((key) => FIELD_LABEL[key] ?? "o conteúdo"))]);

/** How a block is named in the list: what it is, and a few words of what it says. */
function describe(node: SiteNode): string {
  const text = nodeText(node);
  return text ? `${nodeTitle(node)} ${quoted(text)}` : nodeTitle(node);
}
const nodesInside = (node: SiteNode) => allNodes([node]).length - 1;

export function diffContent(rawBefore: SiteContent, rawAfter: SiteContent): Diff {
  const before = withoutResolvedServices(rawBefore);
  const after = withoutResolvedServices(rawAfter);
  const changes: Change[] = [];
  const marks = new Map<string, Mark>();
  const add = (page: string | null, kind: ChangeKind, text: string, blockId: string | null = null) => changes.push({ page, kind, blockId, text });
  const mark = (id: string, how: Mark) => {
    if (marks.get(id) !== "added") marks.set(id, how);
  };

  // ---- the site ----
  if (before.title !== after.title) add(null, "changed", `O título do site mudou de ${said(before.title)} para ${said(after.title)}.`);
  if (before.description !== after.description) add(null, "changed", `A descrição do site para buscadores mudou de ${said(before.description)} para ${said(after.description)}.`);
  const contacts = [
    ["whatsapp", "O WhatsApp"],
    ["email", "O e-mail de contato"],
    ["instagram", "O Instagram"],
  ] as const;
  for (const [key, label] of contacts) if (before.contact[key] !== after.contact[key]) add(null, "changed", `${label} mudou.`);
  if (before.theme.accent !== after.theme.accent) add(null, "changed", `A cor de destaque mudou de ${ACCENT_LABEL[before.theme.accent]} para ${ACCENT_LABEL[after.theme.accent]}.`);
  if (before.theme.brand !== after.theme.brand) {
    add(null, "changed", after.theme.brand ? (before.theme.brand ? "A cor da marca mudou." : "A cor da marca foi escolhida.") : "A cor da marca foi tirada.");
  }
  if (before.theme.mode !== after.theme.mode) add(null, "changed", `A aparência mudou de ${MODE_LABEL[before.theme.mode]} para ${MODE_LABEL[after.theme.mode]}.`);
  if ((before.theme.font ?? "default") !== (after.theme.font ?? "default")) {
    add(null, "changed", `A fonte da página mudou de ${FONT_LABEL[before.theme.font ?? "default"]} para ${FONT_LABEL[after.theme.font ?? "default"]}.`);
  }
  if (before.theme.width !== after.theme.width) add(null, "changed", `A largura da página mudou de ${WIDTH_LABEL[before.theme.width]} para ${WIDTH_LABEL[after.theme.width]}.`);
  if ((before.logoAssetId ?? "") !== (after.logoAssetId ?? "")) {
    add(null, "changed", after.logoAssetId ? (before.logoAssetId ? "O logotipo mudou." : "O logotipo foi acrescentado.") : "O logotipo foi tirado.");
  }
  if ((before.indexable !== false) !== (after.indexable !== false)) {
    add(null, "changed", after.indexable === false ? "O site passou a pedir aos buscadores que não o listem." : "O site passou a aparecer nos buscadores.");
  }

  // ---- the pages ----
  const pagesBefore = new Map(pagesOf(before).map((entry) => [entry.id, entry]));
  const pagesAfter = new Map(pagesOf(after).map((entry) => [entry.id, entry]));
  const pageName = (id: string, from: typeof pagesAfter) => (id === HOME ? "inicial" : quoted(from.get(id)?.title || from.get(id)?.slug || ""));
  for (const entry of pagesOf(after)) {
    const old = pagesBefore.get(entry.id);
    if (!old) {
      add(entry.id, "added", `A página ${pageName(entry.id, pagesAfter)} foi acrescentada, com o endereço /${entry.slug}.`);
      continue;
    }
    if (old.title !== entry.title) add(entry.id, "changed", `O título da página mudou de ${said(old.title)} para ${said(entry.title)}.`);
    if (old.slug !== entry.slug) add(entry.id, "changed", `O endereço da página mudou de /${old.slug} para /${entry.slug}.`);
    if (old.description !== entry.description) add(entry.id, "changed", "A descrição da página para buscadores mudou.");
    if ((old.inMenu !== false) !== (entry.inMenu !== false)) add(entry.id, "changed", entry.inMenu === false ? "A página saiu do menu." : "A página entrou no menu.");
  }
  for (const old of pagesOf(before)) if (!pagesAfter.has(old.id)) add(old.id, "removed", `A página ${pageName(old.id, pagesBefore)} foi removida.`);
  const common = pagesOf(after).filter((entry) => pagesBefore.has(entry.id)).map((entry) => entry.id);
  const commonBefore = pagesOf(before).filter((entry) => pagesAfter.has(entry.id)).map((entry) => entry.id);
  if (JSON.stringify(common) !== JSON.stringify(commonBefore)) add(null, "moved", "A ordem das páginas no menu mudou.");

  // ---- the blocks ----
  const was = place(before);
  const now = place(after);
  const pageOf = (id: string, side: "before" | "after") => (side === "before" ? was.get(id)!.page : now.get(id)!.page);
  const inside = (id: string, side: "before" | "after") => (side === "before" ? was : now).get(id)?.parent ?? null;
  for (const [id, placed] of now) {
    if (was.has(id)) continue;
    // A block inside a container that was added is told with the container.
    if (placed.parent !== null && !was.has(placed.parent)) continue;
    const count = placed.node.type === "box" ? nodesInside(placed.node) : 0;
    add(placed.page, "added", `Acrescentado: ${describe(placed.node)}${count > 0 ? `, com ${count} ${count === 1 ? "bloco" : "blocos"} dentro` : ""}.`, id);
    mark(id, "added");
  }
  for (const [id, placed] of was) {
    if (now.has(id)) continue;
    if (placed.parent !== null && !now.has(placed.parent) && was.has(placed.parent)) continue;
    const count = placed.node.type === "box" ? nodesInside(placed.node) : 0;
    add(placed.page, "removed", `Removido: ${describe(placed.node)}${count > 0 ? `, com ${count} ${count === 1 ? "bloco" : "blocos"} dentro` : ""}.`);
  }
  for (const [id, placed] of now) {
    const old = was.get(id);
    if (!old) continue;
    const fields = changedFields(old.node, placed.node);
    const elsewhere = pageOf(id, "before") !== placed.page;
    const otherParent = !elsewhere && inside(id, "before") !== inside(id, "after");
    if (fields.length === 0 && !elsewhere && !otherParent) continue;
    const parts: string[] = [];
    if (fields.length > 0) parts.push(`mudou ${fieldsText(fields)}`);
    if (elsewhere) parts.push(`foi para a página ${pageName(placed.page, pagesAfter)}`);
    else if (otherParent) parts.push("foi para outro lugar da página");
    add(placed.page, elsewhere || (fields.length === 0 && otherParent) ? "moved" : "changed", `${describe(placed.node)}: ${joined(parts)}.`, id);
    mark(id, "changed");
  }
  // The order of what stayed in the same place: told for the place.
  const orderOf = (side: Map<string, Placed>, parent: string | null, page: string, keep: ReadonlySet<string>) =>
    [...side].filter(([id, entry]) => entry.parent === parent && entry.page === page && keep.has(id)).map(([id]) => id);
  const places = new Set([...now.values()].map((entry) => `${entry.page}\u0000${entry.parent ?? ""}`));
  for (const key of places) {
    const [page, parent] = key.split("\u0000");
    const owner = parent === "" ? null : parent;
    const stayed = new Set([...now].filter(([id, entry]) => was.has(id) && entry.page === page && entry.parent === owner && was.get(id)!.page === page && was.get(id)!.parent === owner).map(([id]) => id));
    if (stayed.size < 2) continue;
    if (JSON.stringify(orderOf(was, owner, page, stayed)) === JSON.stringify(orderOf(now, owner, page, stayed))) continue;
    if (owner === null) add(page, "moved", "A ordem dos blocos da página mudou.");
    else {
      add(page, "moved", `A ordem dos blocos dentro de ${describe(now.get(owner)!.node)} mudou.`, owner);
      mark(owner, "changed");
    }
  }

  // ---- the components ----
  const defsBefore = new Map(componentsOf(before).map((entry) => [entry.id, entry]));
  const changedDefs = new Set<string>();
  for (const def of componentsOf(after)) {
    const old = defsBefore.get(def.id);
    if (!old) {
      add(null, "added", `O componente ${quoted(def.name)} foi acrescentado.`);
      continue;
    }
    if (old.name !== def.name) add(null, "changed", `O componente ${quoted(old.name)} passou a se chamar ${quoted(def.name)}.`);
    if (JSON.stringify(old.root) !== JSON.stringify(def.root)) {
      add(null, "changed", `O componente ${quoted(def.name)} mudou: vale para todos os blocos que o usam.`);
      changedDefs.add(def.id);
    }
  }
  const defsAfter = new Set(componentsOf(after).map((entry: ComponentDef) => entry.id));
  for (const old of componentsOf(before)) if (!defsAfter.has(old.id)) add(null, "removed", `O componente ${quoted(old.name)} foi removido.`);
  for (const [id, placed] of now) if (placed.node.type === "component" && changedDefs.has(placed.node.componentId)) mark(id, "changed");

  return { changes, marks };
}

/** The first `MAX_CHANGES` changes and how many were left out, for a page that has to show a list. */
export function capped(diff: Diff): { shown: Change[]; left: number } {
  return { shown: diff.changes.slice(0, MAX_CHANGES), left: Math.max(0, diff.changes.length - MAX_CHANGES) };
}

/** What the list says when nothing changed. */
export const NO_CHANGES = "Nada mudou entre estas duas versões.";
