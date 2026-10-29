import {
  MAX_COMPONENTS,
  MAX_COMPONENT_NODES,
  MAX_EXPANDED_NODES,
  NAME_MAX,
  OVERRIDE_FIELDS,
  allNodes,
  applyOverrides,
  componentById,
  componentsOf,
  emptyBlock,
  expandedCount,
  newBlockId,
  type BoxNode,
  type ComponentDef,
  type ComponentNode,
  type OverrideFields,
  type SiteContent,
  type SiteNode,
} from "./contracts";
import { cloneWithNewIds, insertNode, locate, removeBlocks, topmost, updateBlock, type Outcome, type Slot } from "./editor-model";
import { SCREEN_KEY, SCREENS, type Styled } from "./screens";
import type { Style } from "./style";

/**
 * What the visual editor does with components, as functions on the document (no screen here, like editor-model.ts): making a component of
 * what is selected, drawing it again where it is wanted, taking an instance back to plain blocks, deleting or renaming a component,
 * changing what an instance says, and writing back what was edited in the component itself. Every function gives a document that the server
 * accepts, or the reason it does not (`Refusal`).
 */

/** How a node sits in what holds it. When a node becomes a component, its place is the instance's: the instance takes these, the component keeps the rest. */
const SLOT_KEYS = ["grow", "shrink", "basis", "selfAlign"] as const satisfies readonly (keyof Style)[];

function splitSlot(style: Style | undefined): { slot: Style | undefined; rest: Style | undefined } {
  if (!style) return { slot: undefined, rest: undefined };
  const slot: Record<string, unknown> = {};
  const rest: Record<string, unknown> = { ...style };
  for (const key of SLOT_KEYS) {
    if (style[key] !== undefined) {
      slot[key] = style[key];
      delete rest[key];
    }
  }
  return { slot: Object.keys(slot).length > 0 ? (slot as Style) : undefined, rest: Object.keys(rest).length > 0 ? (rest as Style) : undefined };
}

/** The same node with `change` applied to the style of each size; a size left with nothing is taken out. */
function mapStyles<T extends Styled>(entry: T, change: (style: Style | undefined, screen: (typeof SCREENS)[number]) => Style | undefined): T {
  const out = { ...entry } as unknown as Record<string, unknown>;
  for (const screen of SCREENS) {
    const key = SCREEN_KEY[screen];
    const next = change(entry[key], screen);
    if (next && Object.keys(next).length > 0) out[key] = next;
    else delete out[key];
  }
  return out as T;
}

const nameOf = (value: string) => value.replace(/\s+/g, " ").trim().slice(0, NAME_MAX);

function withComponents(content: SiteContent, list: readonly ComponentDef[]): SiteContent {
  const { components: _previous, ...rest } = content;
  void _previous;
  return list.length > 0 ? { ...rest, components: [...list] } : rest;
}

const instancesOf = (content: SiteContent, componentId: string): ComponentNode[] =>
  allNodes(content.blocks).filter((entry): entry is ComponentNode => entry.type === "component" && entry.componentId === componentId);

/** A name for a component that is not used by another one: "Componente", "Componente 2"... */
function freeName(content: SiteContent, wanted: string): string {
  const taken = new Set(componentsOf(content).map((entry) => entry.name.toLowerCase()));
  const base = nameOf(wanted) || "Componente";
  if (!taken.has(base.toLowerCase())) return base;
  for (let count = 2; count < 1000; count++) {
    const suffix = ` ${count}`;
    const candidate = `${base.slice(0, NAME_MAX - suffix.length)}${suffix}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return base;
}

// ---- making one ----

/**
 * A component made of what is selected, and an instance of it in the place of what was selected. One node becomes the root of the component;
 * several nodes of the same place are put in a container, which becomes the root. The way the root sits in what holds it (grow, shrink, basis,
 * alignment, at each size) goes to the instance, so the page looks as it did. A component cannot hold another one.
 */
export function createComponent(content: SiteContent, ids: readonly string[], wantedName?: string): Outcome {
  const tops = topmost(content, ids);
  if (tops.length === 0) return { ok: false, reason: "not-found" };
  const found = tops.map((id) => locate(content, id)!);
  if (found.some((entry) => allNodes([entry.node]).some((inner) => inner.type === "component"))) return { ok: false, reason: "nested-component" };
  if (componentsOf(content).length >= MAX_COMPONENTS) return { ok: false, reason: "limit-components" };
  const parentId = found[0].parentId;
  if (found.some((entry) => entry.parentId !== parentId)) return { ok: false, reason: "not-siblings" };

  const single = found.length === 1;
  const root: SiteNode = single ? found[0].node : { ...(emptyBlock("box") as BoxNode), name: "Componente", children: found.map((entry) => entry.node) };
  if (allNodes([root]).length > MAX_COMPONENT_NODES) return { ok: false, reason: "limit-component-nodes" };

  // What the root keeps of its own place goes to the instance.
  const slots: Partial<Record<(typeof SCREENS)[number], Style>> = {};
  const kept = single
    ? mapStyles(root, (style, screen) => {
        const parts = splitSlot(style);
        slots[screen] = parts.slot;
        return parts.rest;
      })
    : root;
  const definition: ComponentDef = { id: newBlockId(), name: freeName(content, wantedName ?? (single ? kept.name ?? "" : "Componente")), root: kept };
  const instance: ComponentNode = { id: newBlockId(), type: "component", componentId: definition.id, name: definition.name, overrides: {} };
  const placed = mapStyles(instance as Styled, (_style, screen) => slots[screen]) as ComponentNode;

  const without = removeBlocks(content, tops);
  const inserted = insertNode(without, placed, { parent: parentId, index: found[0].index });
  if (!inserted.ok) return inserted;
  return { ok: true, content: withComponents(inserted.content, [...componentsOf(content), definition]), id: placed.id };
}

// ---- using one ----

/** An instance of a component in the slot. */
export function insertInstance(content: SiteContent, componentId: string, slot: Slot): Outcome {
  const definition = componentById(content, componentId);
  if (!definition) return { ok: false, reason: "no-component" };
  const instance: ComponentNode = { id: newBlockId(), type: "component", componentId, name: definition.name, overrides: {} };
  return insertNode(content, instance, slot);
}

/** A new instance (not yet in the document), as the library gives it for a click or a drag; null when the component is not there. */
export function newInstance(content: SiteContent, componentId: string): ComponentNode | null {
  const definition = componentById(content, componentId);
  return definition ? { id: newBlockId(), type: "component", componentId, name: definition.name, overrides: {} } : null;
}

/** The nodes of the component as plain blocks in the slot, with new identifiers: a copy that does not follow the component. */
export function insertCopy(content: SiteContent, componentId: string, slot: Slot): Outcome {
  const definition = componentById(content, componentId);
  if (!definition) return { ok: false, reason: "no-component" };
  return insertNode(content, cloneWithNewIds(definition.root), slot);
}

// ---- leaving one ----

/**
 * The component as one instance draws it, as plain nodes with the same identifiers as the definition: the instance's texts laid over, and the
 * instance's own style over the root's, size by size (what the instance says wins). The caller gives the nodes new identifiers.
 */
export function expandInstance(instance: ComponentNode, definition: ComponentDef): SiteNode {
  const drawn = applyOverrides(definition.root, instance.overrides);
  return mapStyles(drawn as Styled, (style, screen) => {
    const own = instance[SCREEN_KEY[screen]];
    return own ? { ...style, ...own } : style;
  }) as SiteNode;
}

/** An instance taken back to plain blocks, in its place. */
export function detachInstance(content: SiteContent, instanceId: string): Outcome {
  const from = locate(content, instanceId);
  if (!from || from.node.type !== "component") return { ok: false, reason: "not-found" };
  const definition = componentById(content, from.node.componentId);
  if (!definition) return { ok: false, reason: "no-component" };
  const copy = cloneWithNewIds(expandInstance(from.node, definition));
  const without = removeBlocks(content, [instanceId]);
  return insertNode(without, copy, { parent: from.parentId, index: from.index });
}

/**
 * A component taken out of the site. Every instance of it first becomes plain blocks, so nothing on the page is lost, and the component is
 * gone from the list. Nothing is changed when one of them cannot be put back (the page is full).
 */
export function deleteComponent(content: SiteContent, componentId: string): Outcome {
  if (!componentById(content, componentId)) return { ok: false, reason: "no-component" };
  let current = content;
  for (const instance of instancesOf(content, componentId)) {
    const outcome = detachInstance(current, instance.id);
    if (!outcome.ok) return outcome;
    current = outcome.content;
  }
  return { ok: true, content: withComponents(current, componentsOf(current).filter((entry) => entry.id !== componentId)), id: componentId };
}

export function renameComponent(content: SiteContent, componentId: string, wanted: string): SiteContent {
  const definition = componentById(content, componentId);
  const name = nameOf(wanted);
  if (!definition || name === "" || name === definition.name) return content;
  const list = componentsOf(content).map((entry) => (entry.id === componentId ? { ...entry, name } : entry));
  // The instances that were showing the old name in the layers follow it.
  return instancesOf(content, componentId)
    .filter((instance) => instance.name === definition.name)
    .reduce((current, instance) => updateBlock(current, instance.id, (entry) => ({ ...entry, name })), withComponents(content, list));
}

// ---- editing the component itself ----

/**
 * The document as the editor shows it while the component is being edited: the component's nodes are the page, and there are no components
 * (so none can be put inside another). Null when the component is not there.
 */
export function componentView(content: SiteContent, componentId: string): SiteContent | null {
  const definition = componentById(content, componentId);
  return definition ? { ...content, blocks: [definition.root], components: [] } : null;
}

/** The overrides of an instance without the ones that no longer have a node (or a field that is open) in the component. */
function pruned(instance: ComponentNode, definition: ComponentDef): ComponentNode {
  const nodes = new Map(allNodes([definition.root]).map((entry) => [entry.id, entry]));
  const overrides: ComponentNode["overrides"] = {};
  for (const [nodeId, fields] of Object.entries(instance.overrides)) {
    const target = nodes.get(nodeId);
    const open = target ? (OVERRIDE_FIELDS as Record<string, readonly string[]>)[target.type] : undefined;
    if (!open) continue;
    const kept = Object.fromEntries(Object.entries(fields).filter(([field]) => open.includes(field))) as OverrideFields;
    if (Object.keys(kept).length > 0) overrides[nodeId] = kept;
  }
  return Object.keys(overrides).length === Object.keys(instance.overrides).length && JSON.stringify(overrides) === JSON.stringify(instance.overrides) ? instance : { ...instance, overrides };
}

/**
 * What was edited in the component, written back: the blocks of the editor's view become the component's root (more than one are put in a
 * container, none is refused), and the instances lose the overrides of nodes that are not there any more. Every instance on the page draws the
 * new component.
 */
export function setComponentRoot(content: SiteContent, componentId: string, blocks: readonly SiteNode[]): Outcome {
  const definition = componentById(content, componentId);
  if (!definition) return { ok: false, reason: "no-component" };
  if (blocks.length === 0) return { ok: false, reason: "empty-component" };
  const root: SiteNode = blocks.length === 1 ? blocks[0] : { ...(emptyBlock("box") as BoxNode), name: "Componente", children: [...blocks] };
  const inside = allNodes([root]);
  if (inside.some((entry) => entry.type === "component")) return { ok: false, reason: "nested-component" };
  if (inside.length > MAX_COMPONENT_NODES) return { ok: false, reason: "limit-component-nodes" };
  const next = { ...definition, root };
  const list = componentsOf(content).map((entry) => (entry.id === componentId ? next : entry));
  let changed = withComponents(content, list);
  for (const instance of instancesOf(changed, componentId)) {
    const kept = pruned(instance, next);
    if (kept !== instance) changed = updateBlock(changed, instance.id, () => kept);
  }
  if (expandedCount(changed) > MAX_EXPANDED_NODES) return { ok: false, reason: "limit-expanded" };
  return { ok: true, content: changed, id: root.id };
}

// ---- what an instance says ----

/** The nodes of a component that an instance may change, in the order of the page, with what is open in each. */
export function openNodes(definition: ComponentDef): Array<{ node: SiteNode; fields: readonly (keyof OverrideFields)[] }> {
  return allNodes([definition.root]).flatMap((node) => {
    const fields = (OVERRIDE_FIELDS as Record<string, readonly (keyof OverrideFields)[]>)[node.type];
    return fields ? [{ node, fields }] : [];
  });
}

/**
 * The instance with one field of one node of its component changed. A value that is the component's own takes the override away (the instance
 * follows the component again). A node or a field that is not open changes nothing.
 */
export function setOverride(content: SiteContent, instanceId: string, nodeId: string, field: keyof OverrideFields, value: string): SiteContent {
  const from = locate(content, instanceId);
  if (!from || from.node.type !== "component") return content;
  const definition = componentById(content, from.node.componentId);
  const target = definition ? allNodes([definition.root]).find((entry) => entry.id === nodeId) : undefined;
  const open = target ? (OVERRIDE_FIELDS as Record<string, readonly string[]>)[target.type] : undefined;
  if (!target || !open || !open.includes(field)) return content;
  const original = (target as unknown as Record<string, unknown>)[field];
  return updateBlock(content, instanceId, (entry) => {
    if (entry.type !== "component") return entry;
    const fields: Record<string, unknown> = { ...entry.overrides[nodeId] };
    if (value === (original ?? "")) delete fields[field];
    else fields[field] = value;
    const overrides = { ...entry.overrides };
    if (Object.keys(fields).length > 0) overrides[nodeId] = fields as OverrideFields;
    else delete overrides[nodeId];
    return { ...entry, overrides };
  });
}

/** One field of one node back to what the component says. */
export function resetOverrideField(content: SiteContent, instanceId: string, nodeId: string, field: keyof OverrideFields): SiteContent {
  return updateBlock(content, instanceId, (entry) => {
    if (entry.type !== "component" || entry.overrides[nodeId]?.[field] === undefined) return entry;
    const { [field]: _dropped, ...rest } = entry.overrides[nodeId];
    void _dropped;
    const overrides = { ...entry.overrides };
    if (Object.keys(rest).length > 0) overrides[nodeId] = rest;
    else delete overrides[nodeId];
    return { ...entry, overrides };
  });
}

/** One field (or all the fields of a node, or all the instance's overrides) back to what the component says. */
export function resetOverrides(content: SiteContent, instanceId: string, nodeId?: string): SiteContent {
  return updateBlock(content, instanceId, (entry) => {
    if (entry.type !== "component") return entry;
    if (nodeId === undefined) return { ...entry, overrides: {} };
    const overrides = { ...entry.overrides };
    delete overrides[nodeId];
    return { ...entry, overrides };
  });
}

/** Whether an instance changes anything of its component. */
export const isChanged = (instance: ComponentNode): boolean => Object.keys(instance.overrides).length > 0;
