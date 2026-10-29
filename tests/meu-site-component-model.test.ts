import { describe, expect, it } from "vitest";
import {
  MAX_COMPONENTS,
  MAX_COMPONENT_NODES,
  MAX_EXPANDED_NODES,
  allNodes,
  componentById,
  componentsOf,
  emptyBlock,
  expandedCount,
  siteContent,
  type BoxNode,
  type ComponentDef,
  type ComponentNode,
  type SiteContent,
  type SiteNode,
} from "@/modules/meu-site/contracts";
import {
  componentView,
  createComponent,
  deleteComponent,
  detachInstance,
  expandInstance,
  insertCopy,
  insertInstance,
  isChanged,
  newInstance,
  openNodes,
  renameComponent,
  resetOverrides,
  setComponentRoot,
  setOverride,
} from "@/modules/meu-site/component-model";
import { REFUSAL_MESSAGE, insertNode, locate, type Outcome } from "@/modules/meu-site/editor-model";
import { blocksPayload, parseBlocks, pasteBlocks } from "@/modules/meu-site/clipboard";

const node = <T extends Parameters<typeof emptyBlock>[0]>(type: T, id: string, over: object = {}) => ({ ...emptyBlock(type, id), ...over }) as SiteNode;
const box = (id: string, children: SiteNode[], over: object = {}) => node("box", id, { children, ...over }) as BoxNode;
const instance = (id: string, componentId: string, overrides: ComponentNode["overrides"] = {}, over: object = {}) => ({ id, type: "component", componentId, overrides, ...over }) as ComponentNode;
const page = (blocks: SiteNode[], components?: ComponentDef[]): SiteContent => ({
  schemaVersion: 3,
  title: "Marina Treinos",
  description: "",
  contact: { whatsapp: "(11) 91234-5678", email: "marina@example.test", instagram: "@marina.treinos" },
  theme: { accent: "blue", mode: "light", width: "narrow" },
  blocks,
  ...(components ? { components } : {}),
});
const ok = (outcome: Outcome) => {
  if (!outcome.ok) throw new Error(`refused: ${outcome.reason}`);
  return outcome;
};
const valid = (content: SiteContent) => expect(siteContent.safeParse(content).success).toBe(true);

/** A page with a card in the middle, and a component made from the card. */
const cardBox = () =>
  box("card", [node("heading", "card-t", { text: "Plano mensal", level: 3 }), node("paragraph", "card-p", { text: "Texto do plano" }), node("button", "card-b", { label: "Quero", channel: "whatsapp" })], {
    name: "Plano",
    style: { radius: "16px", gap: "12px" },
  });
const withCard = () => page([node("text", "antes", { text: "Antes" }), cardBox(), node("text", "depois", { text: "Depois" })]);
const definition = (): ComponentDef => ({ id: "plano", name: "Plano", root: cardBox() });
const withComponent = (...uses: ComponentNode[]) => page([node("text", "antes", { text: "Antes" }), ...uses, node("text", "depois", { text: "Depois" })], [definition()]);

describe("making a component from what is selected", () => {
  it("takes the node as the root of the component and leaves an instance where it stood", () => {
    const made = ok(createComponent(withCard(), ["card"]));
    valid(made.content);
    expect(made.content.blocks.map((entry) => entry.type)).toEqual(["text", "component", "text"]);
    const placed = made.content.blocks[1] as ComponentNode;
    expect(placed.id).toBe(made.id);
    expect(placed.name).toBe("Plano");
    expect(placed.overrides).toEqual({});
    const [component] = componentsOf(made.content);
    expect(component).toMatchObject({ name: "Plano", root: { id: "card" } });
    expect(placed.componentId).toBe(component.id);
    expect(allNodes([component.root]).map((entry) => entry.id)).toEqual(["card", "card-t", "card-p", "card-b"]);
    // What is drawn now is what was drawn before: the same nodes, one more box around them.
    expect(expandedCount(made.content)).toBe(expandedCount(withCard()) + 1);
  });
  it("works inside a container, in the same place", () => {
    const content = page([box("wrap", [node("paragraph", "a"), node("paragraph", "b"), node("paragraph", "c")])]);
    const made = ok(createComponent(content, ["b"]));
    valid(made.content);
    const wrap = made.content.blocks[0] as BoxNode;
    expect(wrap.children.map((entry) => entry.type)).toEqual(["paragraph", "component", "paragraph"]);
  });
  it("takes the topmost of what is selected: a node inside another one that is selected goes with it", () => {
    const made = ok(createComponent(withCard(), ["card", "card-t"]));
    expect(made.content.blocks).toHaveLength(3);
    expect(allNodes([componentsOf(made.content)[0].root])).toHaveLength(4);
  });
  it("puts several nodes of the same place in a container, which is the root, and the instance takes the place of the first", () => {
    const content = page([node("paragraph", "x"), node("heading", "a"), node("paragraph", "b"), node("paragraph", "y")]);
    const made = ok(createComponent(content, ["b", "a"]));
    valid(made.content);
    expect(made.content.blocks.map((entry) => entry.type)).toEqual(["paragraph", "component", "paragraph"]);
    const root = componentsOf(made.content)[0].root as BoxNode;
    expect(root).toMatchObject({ type: "box", name: "Componente" });
    expect(root.children.map((entry) => entry.id)).toEqual(["a", "b"]);
  });
  it("refuses nodes that are not in the same place", () => {
    const content = page([box("wrap", [node("paragraph", "a")]), node("paragraph", "b")]);
    expect(createComponent(content, ["a", "b"])).toEqual({ ok: false, reason: "not-siblings" });
  });
  it("refuses what is not there, and what has a component inside (a component never holds another one)", () => {
    expect(createComponent(withCard(), ["sumiu"])).toEqual({ ok: false, reason: "not-found" });
    expect(createComponent(withCard(), [])).toEqual({ ok: false, reason: "not-found" });
    expect(createComponent(withComponent(instance("i", "plano")), ["i"])).toEqual({ ok: false, reason: "nested-component" });
    const content = page([box("wrap", [instance("i", "plano")])], [definition()]);
    expect(createComponent(content, ["wrap"])).toEqual({ ok: false, reason: "nested-component" });
  });
  it("limits the components of a site and the nodes of a component", () => {
    const list = Array.from({ length: MAX_COMPONENTS }, (_, at): ComponentDef => ({ id: `c${at}`, name: `C ${at}`, root: node("paragraph", `cp${at}`) }));
    expect(createComponent(page([node("paragraph", "x")], list), ["x"])).toEqual({ ok: false, reason: "limit-components" });
    const big = box("big", Array.from({ length: MAX_COMPONENT_NODES }, (_, at) => node("paragraph", `n${at}`)));
    expect(createComponent(page([big]), ["big"])).toEqual({ ok: false, reason: "limit-component-nodes" });
    const edge = box("edge", Array.from({ length: MAX_COMPONENT_NODES - 1 }, (_, at) => node("paragraph", `e${at}`)));
    valid(ok(createComponent(page([edge]), ["edge"])).content);
  });
  it("gives each component a name of its own", () => {
    const first = ok(createComponent(withCard(), ["card"]));
    const second = ok(createComponent(first.content, ["depois"], "Plano"));
    expect(componentsOf(second.content).map((entry) => entry.name)).toEqual(["Plano", "Plano 2"]);
    const third = ok(createComponent(second.content, ["antes"], "  plano  "));
    // The name as it was written, with the number that makes it free.
    expect(componentsOf(third.content).map((entry) => entry.name)).toEqual(["Plano", "Plano 2", "plano 3"]);
    expect(componentsOf(ok(createComponent(page([node("paragraph", "p")]), ["p"])).content)[0].name).toBe("Componente");
    expect(componentsOf(ok(createComponent(page([node("paragraph", "p")]), ["p"], "x".repeat(80))).content)[0].name).toHaveLength(40);
  });
  it("leaves to the instance how the node sat in its container (grow, shrink, basis, alignment, at each size) and to the component the rest", () => {
    const sized = box("card", [node("paragraph", "t")], {
      style: { grow: 1, shrink: 1, basis: "240px", gap: "8px", selfAlign: "center" },
      styleTablet: { grow: 2, gap: "4px" },
      styleMobile: { basis: "100%" },
    });
    const made = ok(createComponent(page([sized]), ["card"]));
    valid(made.content);
    const placed = made.content.blocks[0] as ComponentNode;
    expect(placed.style).toEqual({ grow: 1, shrink: 1, basis: "240px", selfAlign: "center" });
    expect(placed.styleTablet).toEqual({ grow: 2 });
    expect(placed.styleMobile).toEqual({ basis: "100%" });
    const root = componentsOf(made.content)[0].root;
    expect(root.style).toEqual({ gap: "8px" });
    expect(root.styleTablet).toEqual({ gap: "4px" });
    expect(root).not.toHaveProperty("styleMobile");
  });
  it("leaves a node with no place of its own with no style on the instance", () => {
    const placed = ok(createComponent(withCard(), ["card"])).content.blocks[1] as ComponentNode;
    expect(placed).not.toHaveProperty("style");
    expect(placed).not.toHaveProperty("styleTablet");
  });
});

describe("using a component", () => {
  it("puts an instance in the slot, named as the component", () => {
    const made = ok(insertInstance(withComponent(), "plano", { parent: null, index: 1 }));
    valid(made.content);
    expect(made.content.blocks[1]).toMatchObject({ id: made.id, type: "component", componentId: "plano", name: "Plano", overrides: {} });
  });
  it("refuses a component that is not there, and a place that is full", () => {
    expect(insertInstance(withComponent(), "faltando", { parent: null, index: 0 })).toEqual({ ok: false, reason: "no-component" });
    expect(insertInstance(withComponent(), "plano", { parent: "antes", index: 0 })).toEqual({ ok: false, reason: "not-accepted" });
    expect(newInstance(withComponent(), "faltando")).toBeNull();
    expect(newInstance(withComponent(), "plano")).toMatchObject({ type: "component", componentId: "plano", name: "Plano" });
  });
  it("refuses an instance that would make the page print too much", () => {
    const big: ComponentDef = { id: "grande", name: "Grande", root: box("g", Array.from({ length: MAX_COMPONENT_NODES - 1 }, (_, at) => node("paragraph", `g${at}`))) };
    const fits = Math.floor(MAX_EXPANDED_NODES / (1 + MAX_COMPONENT_NODES));
    let content = page([box("fill", [])], [big]);
    for (let count = 0; count < fits; count++) content = ok(insertInstance(content, "grande", { parent: null, index: 0 })).content;
    valid(content);
    expect(insertInstance(content, "grande", { parent: null, index: 0 })).toEqual({ ok: false, reason: "limit-expanded" });
    // The same refusal for anything else that adds to what is drawn, such as a plain block: here up to the very last node that fits.
    let nearly = content;
    for (let at = 0; expandedCount(nearly) < MAX_EXPANDED_NODES; at++) nearly = ok(insertNode(nearly, node("paragraph", `f${at}`), { parent: "fill", index: 0 })).content;
    expect(expandedCount(nearly)).toBe(MAX_EXPANDED_NODES);
    valid(nearly);
    expect(insertNode(nearly, node("paragraph", "mais"), { parent: "fill", index: 0 })).toEqual({ ok: false, reason: "limit-expanded" });
  });
  it("puts a copy of the nodes of the component in the slot, as plain blocks with new identifiers", () => {
    const made = ok(insertCopy(withComponent(), "plano", { parent: null, index: 1 }));
    valid(made.content);
    const copy = made.content.blocks[1] as BoxNode;
    expect(copy.type).toBe("box");
    expect(copy.id).not.toBe("card");
    expect(allNodes([copy]).map((entry) => entry.id).filter((id) => ["card", "card-t", "card-p", "card-b"].includes(id))).toEqual([]);
    expect((copy.children[0] as { text: string }).text).toBe("Plano mensal");
    expect(insertCopy(withComponent(), "faltando", { parent: null, index: 0 })).toEqual({ ok: false, reason: "no-component" });
  });
});

describe("taking an instance back to plain blocks", () => {
  it("puts a copy of the component in its place, with the instance's texts and new identifiers", () => {
    const content = withComponent(instance("i", "plano", { "card-t": { text: "Plano trimestral" }, "card-b": { label: "Escolher", channel: "email" } }));
    const made = ok(detachInstance(content, "i"));
    valid(made.content);
    expect(made.content.blocks.map((entry) => entry.type)).toEqual(["text", "box", "text"]);
    const copy = made.content.blocks[1] as BoxNode;
    expect(copy.children[0]).toMatchObject({ text: "Plano trimestral", level: 3 });
    expect(copy.children[1]).toMatchObject({ text: "Texto do plano" });
    expect(copy.children[2]).toMatchObject({ label: "Escolher", channel: "email" });
    expect(copy.style).toEqual({ radius: "16px", gap: "12px" });
    expect(allNodes([copy]).every((entry) => !["card", "card-t", "card-p", "card-b"].includes(entry.id))).toBe(true);
    // The component and the other instances are not touched.
    expect(componentById(made.content, "plano")).toEqual(definition());
  });
  it("keeps the instance's own style over the component's, size by size", () => {
    const content = withComponent(instance("i", "plano", {}, { style: { gap: "4px", grow: 1 }, styleMobile: { hidden: true } }));
    const copy = ok(detachInstance(content, "i")).content.blocks[1] as BoxNode;
    expect(copy.style).toEqual({ radius: "16px", gap: "4px", grow: 1 });
    expect(copy.styleMobile).toEqual({ hidden: true });
    expect(expandInstance(content.blocks[1] as ComponentNode, definition()).style).toEqual({ radius: "16px", gap: "4px", grow: 1 });
  });
  it("is refused for what is not an instance, and for a component that is not there", () => {
    expect(detachInstance(withComponent(instance("i", "plano")), "antes")).toEqual({ ok: false, reason: "not-found" });
    expect(detachInstance(withComponent(instance("i", "plano")), "sumiu")).toEqual({ ok: false, reason: "not-found" });
    expect(detachInstance(page([instance("i", "faltando")]), "i")).toEqual({ ok: false, reason: "no-component" });
  });
});

describe("deleting a component", () => {
  it("turns every instance into plain blocks first, so nothing on the page is lost, and takes the component out of the list", () => {
    const content = withComponent(instance("a", "plano"), instance("b", "plano", { "card-t": { text: "Outro" } }));
    const made = ok(deleteComponent(content, "plano"));
    valid(made.content);
    expect(made.content.blocks.map((entry) => entry.type)).toEqual(["text", "box", "box", "text"]);
    expect("components" in made.content).toBe(false);
    expect(((made.content.blocks[2] as BoxNode).children[0] as { text: string }).text).toBe("Outro");
  });
  it("keeps the other components", () => {
    const other: ComponentDef = { id: "outro", name: "Outro", root: node("paragraph", "o-p", { text: "x" }) };
    const content = { ...withComponent(instance("a", "plano"), instance("b", "outro")), components: [definition(), other] };
    const made = ok(deleteComponent(content, "plano"));
    expect(componentsOf(made.content).map((entry) => entry.id)).toEqual(["outro"]);
    expect((made.content.blocks[2] as ComponentNode).componentId).toBe("outro");
  });
  it("is refused for a component that is not there", () => {
    expect(deleteComponent(withComponent(), "faltando")).toEqual({ ok: false, reason: "no-component" });
  });
  it("changes nothing when one of the instances cannot be put back", () => {
    const deep = (depth: number): SiteNode => (depth === 0 ? instance("leaf", "plano") : box(`d${depth}`, [deep(depth - 1)]));
    // A component whose copy is deeper than the place allows: seven containers deep, with an instance of a component three containers deep.
    const tall: ComponentDef = { id: "plano", name: "Plano", root: box("t1", [box("t2", [box("t3", [box("t4", [box("t5", [node("paragraph", "tp")])])])])]) };
    const content = page([deep(4)], [tall]);
    valid(content);
    expect(deleteComponent(content, "plano")).toEqual({ ok: false, reason: "limit-depth" });
  });
});

describe("naming a component", () => {
  it("changes the name, and the name that the instances show in the layers when it was the component's", () => {
    const content = withComponent(instance("a", "plano", {}, { name: "Plano" }), instance("b", "plano", {}, { name: "Meu cartão" }), instance("c", "plano"));
    const renamed = renameComponent(content, "plano", "  Cartão de plano ");
    valid(renamed);
    expect(componentById(renamed, "plano")?.name).toBe("Cartão de plano");
    expect((locate(renamed, "a")!.node as ComponentNode).name).toBe("Cartão de plano");
    expect((locate(renamed, "b")!.node as ComponentNode).name).toBe("Meu cartão");
    expect((locate(renamed, "c")!.node as ComponentNode).name).toBeUndefined();
  });
  it("does not change anything for an empty name, the same name, or a component that is not there", () => {
    const content = withComponent(instance("a", "plano"));
    expect(renameComponent(content, "plano", "   ")).toBe(content);
    expect(renameComponent(content, "plano", "Plano")).toBe(content);
    expect(renameComponent(content, "faltando", "Outro")).toBe(content);
    expect(componentById(renameComponent(content, "plano", "x".repeat(60)), "plano")?.name).toHaveLength(40);
  });
});

describe("editing the component itself", () => {
  it("shows the nodes of the component as the page, and no components", () => {
    const view = componentView(withComponent(instance("i", "plano")), "plano")!;
    expect(view.blocks).toHaveLength(1);
    expect(view.blocks[0].id).toBe("card");
    expect(view.components).toEqual([]);
    expect(componentView(withComponent(), "faltando")).toBeNull();
  });
  it("writes the edited nodes back as the component, and every instance draws the new one", () => {
    const content = withComponent(instance("a", "plano"), instance("b", "plano"));
    const edited = box("card", [node("heading", "card-t", { text: "Plano anual", level: 3 }), node("paragraph", "novo", { text: "Novo texto" })], { style: { radius: "8px" } });
    const made = ok(setComponentRoot(content, "plano", [edited]));
    valid(made.content);
    expect(componentById(made.content, "plano")?.root).toEqual(edited);
    expect(made.id).toBe("card");
    expect(made.content.blocks).toHaveLength(4);
  });
  it("puts several nodes in a container, and refuses none", () => {
    const content = withComponent(instance("a", "plano"));
    const made = ok(setComponentRoot(content, "plano", [node("heading", "h1x", { text: "A" }), node("paragraph", "p1x", { text: "B" })]));
    valid(made.content);
    const root = componentById(made.content, "plano")!.root as BoxNode;
    expect(root).toMatchObject({ type: "box", name: "Componente" });
    expect(root.children.map((entry) => entry.id)).toEqual(["h1x", "p1x"]);
    expect(setComponentRoot(content, "plano", [])).toEqual({ ok: false, reason: "empty-component" });
  });
  it("refuses an instance inside the component, too many nodes, a component that is not there", () => {
    const content = withComponent(instance("a", "plano"));
    expect(setComponentRoot(content, "plano", [box("r", [instance("in", "plano")])])).toEqual({ ok: false, reason: "nested-component" });
    const big = box("r", Array.from({ length: MAX_COMPONENT_NODES }, (_, at) => node("paragraph", `n${at}`)));
    expect(setComponentRoot(content, "plano", [big])).toEqual({ ok: false, reason: "limit-component-nodes" });
    expect(setComponentRoot(content, "faltando", [node("paragraph", "p")])).toEqual({ ok: false, reason: "no-component" });
  });
  it("refuses a component that would make the page print too much with all its instances", () => {
    const content = page(
      Array.from({ length: 15 }, (_, at) => instance(`u${at}`, "plano")),
      [{ id: "plano", name: "Plano", root: box("card", Array.from({ length: 5 }, (_, at) => node("paragraph", `c${at}`))) }],
    );
    valid(content);
    const bigger = box("card", Array.from({ length: 39 }, (_, at) => node("paragraph", `c${at}`)));
    expect(setComponentRoot(content, "plano", [bigger])).toEqual({ ok: false, reason: "limit-expanded" });
  });
  it("takes from the instances the overrides of nodes that are not in the component any more", () => {
    const content = withComponent(instance("a", "plano", { "card-t": { text: "Meu título" }, "card-p": { text: "Meu texto" } }), instance("b", "plano"));
    const edited = box("card", [node("heading", "card-t", { text: "Plano mensal", level: 3 })]);
    const made = ok(setComponentRoot(content, "plano", [edited]));
    valid(made.content);
    expect((locate(made.content, "a")!.node as ComponentNode).overrides).toEqual({ "card-t": { text: "Meu título" } });
    expect((locate(made.content, "b")!.node as ComponentNode).overrides).toEqual({});
  });
  it("round trips through the editor's view: what is edited in the view is the component", () => {
    const content = withComponent(instance("a", "plano"));
    const view = componentView(content, "plano")!;
    const root = view.blocks[0] as BoxNode;
    const changed = { ...view, blocks: [{ ...root, children: [...root.children, node("paragraph", "extra", { text: "Mais um" })] }] };
    const back = ok(setComponentRoot(content, "plano", changed.blocks));
    expect((componentById(back.content, "plano")!.root as BoxNode).children).toHaveLength(4);
  });
});

describe("what an instance says", () => {
  const open = (content: SiteContent, nodeId: string, field: Parameters<typeof setOverride>[3], value: string) => setOverride(content, "i", nodeId, field, value);
  const overridesOf = (content: SiteContent) => (locate(content, "i")!.node as ComponentNode).overrides;
  it("lists the nodes of the component that are open, in the order of the page, with the fields", () => {
    expect(openNodes(definition()).map((entry) => [entry.node.id, [...entry.fields]])).toEqual([
      ["card-t", ["text"]],
      ["card-p", ["text"]],
      ["card-b", ["label", "channel"]],
    ]);
  });
  it("keeps what is different from the component, and nothing else", () => {
    const base = withComponent(instance("i", "plano"));
    const changed = open(base, "card-t", "text", "Outro");
    valid(changed);
    expect(overridesOf(changed)).toEqual({ "card-t": { text: "Outro" } });
    expect(isChanged(locate(changed, "i")!.node as ComponentNode)).toBe(true);
    // Back to the component's own text: the override goes away, and so does the node's entry.
    expect(overridesOf(open(changed, "card-t", "text", "Plano mensal"))).toEqual({});
    expect(isChanged(locate(open(changed, "card-t", "text", "Plano mensal"), "i")!.node as ComponentNode)).toBe(false);
    // An empty text is a choice, not "no change".
    expect(overridesOf(open(base, "card-t", "text", ""))).toEqual({ "card-t": { text: "" } });
  });
  it("changes only the fields that are open, of nodes that are there", () => {
    const base = withComponent(instance("i", "plano"));
    expect(open(base, "card-t", "label", "x")).toBe(base);
    expect(open(base, "card", "text", "x")).toBe(base);
    expect(open(base, "sumiu", "text", "x")).toBe(base);
    expect(setOverride(base, "antes", "card-t", "text", "x")).toBe(base);
    expect(setOverride(page([instance("i", "faltando")]), "i", "card-t", "text", "x").blocks[0]).toEqual(instance("i", "faltando"));
  });
  it("does not touch the other instances, and builds the contact override on the button's own contact", () => {
    const base = withComponent(instance("i", "plano"), instance("j", "plano"));
    const changed = open(open(base, "card-b", "label", "Escolher"), "card-b", "channel", "email");
    expect(overridesOf(changed)).toEqual({ "card-b": { label: "Escolher", channel: "email" } });
    expect((locate(changed, "j")!.node as ComponentNode).overrides).toEqual({});
    // The component's own contact is "whatsapp": saying it again is no change.
    expect(overridesOf(open(changed, "card-b", "channel", "whatsapp"))).toEqual({ "card-b": { label: "Escolher" } });
  });
  it("puts a node, or the whole instance, back to what the component says", () => {
    const base = open(open(withComponent(instance("i", "plano")), "card-t", "text", "A"), "card-p", "text", "B");
    expect(overridesOf(resetOverrides(base, "i", "card-t"))).toEqual({ "card-p": { text: "B" } });
    expect(overridesOf(resetOverrides(base, "i"))).toEqual({});
    expect(resetOverrides(base, "antes")).toEqual(base);
  });
  it("is refused by the document when what it says does not fit the node (the screen keeps within the limits, the server checks)", () => {
    const tooLong = open(withComponent(instance("i", "plano")), "card-t", "text", "x".repeat(121));
    expect(siteContent.safeParse(tooLong).success).toBe(false);
  });
});

describe("copying instances", () => {
  const context = { assetIds: new Set(["minha-imagem"]), serviceIds: new Set<string>() };
  const slot = { parent: null, index: 1 } as const;
  const copyOf = (content: SiteContent, ids: string[]) => {
    const payload = blocksPayload(content, ids);
    if (!payload) throw new Error("nothing copied");
    return parseBlocks(JSON.stringify(payload))!;
  };

  it("carries the definition of the component with the instance", () => {
    const content = withComponent(instance("i", "plano", { "card-t": { text: "Outro" } }));
    const payload = blocksPayload(content, ["i"])!;
    expect(payload.components).toEqual([definition()]);
    expect(blocksPayload(content, ["antes"])).not.toHaveProperty("components");
    // One component carried once, however many instances use it, and also the ones inside a container.
    const many = page([instance("a", "plano"), box("wrap", [instance("b", "plano")])], [definition()]);
    expect(blocksPayload(many, ["a", "wrap"])!.components).toHaveLength(1);
  });
  it("keeps an instance an instance when it is pasted in the site that has the component, with a new identifier", () => {
    const content = withComponent(instance("i", "plano", { "card-t": { text: "Outro" } }));
    const pasted = pasteBlocks(content, copyOf(content, ["i"]), slot, context);
    expect(pasted.ok).toBe(true);
    if (!pasted.ok) return;
    valid(pasted.content);
    const made = locate(pasted.content, pasted.ids[0])!.node as ComponentNode;
    expect(made).toMatchObject({ type: "component", componentId: "plano", overrides: { "card-t": { text: "Outro" } } });
    expect(made.id).not.toBe("i");
    expect(componentsOf(pasted.content)).toEqual([definition()]);
  });
  it("drops from a pasted instance the images that are not of this site's library", () => {
    const photo: ComponentDef = { id: "foto", name: "Foto", root: node("image", "f-i", { alt: "x" }) };
    const content = page([instance("i", "foto", { "f-i": { assetId: "de-outro-site", alt: "Uma foto" } }, { style: { bgImage: "fundo-de-outro-site" } })], [photo]);
    const pasted = pasteBlocks(content, copyOf(content, ["i"]), slot, context);
    if (!pasted.ok) throw new Error(pasted.reason);
    const made = locate(pasted.content, pasted.ids[0])!.node as ComponentNode;
    expect(made.overrides).toEqual({ "f-i": { alt: "Uma foto" } });
    expect(made).not.toHaveProperty("style");
    const mine = page([instance("i", "foto", { "f-i": { assetId: "minha-imagem" } })], [photo]);
    const kept = pasteBlocks(mine, copyOf(mine, ["i"]), slot, context);
    if (!kept.ok) throw new Error(kept.reason);
    expect((locate(kept.content, kept.ids[0])!.node as ComponentNode).overrides).toEqual({ "f-i": { assetId: "minha-imagem" } });
  });
  it("brings an instance as plain blocks into a site that does not have the component, from the definition the copy carries", () => {
    const testimony: ComponentDef = { id: "dep", name: "Depoimento", root: box("d", [node("quote", "d-q", { quote: "Gostei", author: "Ana", authorized: true }), node("paragraph", "d-p", { text: "Original" })]) };
    const source = page([instance("i", "dep", { "d-p": { text: "Da instância" } }, { style: { gap: "4px" } })], [testimony]);
    const elsewhere = page([node("paragraph", "x")]);
    const pasted = pasteBlocks(elsewhere, copyOf(source, ["i"]), slot, context);
    if (!pasted.ok) throw new Error(pasted.reason);
    valid(pasted.content);
    expect(componentsOf(pasted.content)).toEqual([]);
    const made = locate(pasted.content, pasted.ids[0])!.node as BoxNode;
    expect(made.type).toBe("box");
    expect(made.id).not.toBe("d");
    expect(made.style).toEqual({ gap: "4px" });
    expect(made.children[1]).toMatchObject({ text: "Da instância" });
    // What is pasted as plain blocks is cleaned as any block is: the person has to authorize the testimony again.
    expect(made.children[0]).toMatchObject({ authorized: false });
    expect(allNodes([made]).every((entry) => !["d", "d-q", "d-p"].includes(entry.id))).toBe(true);
  });
  it("does the same inside a container that was copied with it", () => {
    const source = withComponent(instance("i", "plano"));
    const wrapped = { ...source, blocks: [box("wrap", [instance("i", "plano")])] };
    const pasted = pasteBlocks(page([]), copyOf(wrapped, ["wrap"]), { parent: null, index: 0 }, context);
    if (!pasted.ok) throw new Error(pasted.reason);
    valid(pasted.content);
    expect(allNodes(pasted.content.blocks).map((entry) => entry.type)).toEqual(["box", "box", "heading", "paragraph", "button"]);
  });
  it("brings the copy as plain blocks into the view of a component too (a component never holds another one)", () => {
    const content = withComponent(instance("i", "plano"));
    const view = componentView(content, "plano")!;
    const pasted = pasteBlocks(view, copyOf(content, ["i"]), { parent: "card", index: 0 }, context);
    if (!pasted.ok) throw new Error(pasted.reason);
    expect(allNodes(pasted.content.blocks).some((entry) => entry.type === "component")).toBe(false);
    expect(allNodes(pasted.content.blocks)).toHaveLength(8);
  });
  it("refuses, and changes nothing, when the copy points to a component it does not carry and this site does not have", () => {
    const text = JSON.stringify({ format: "meu-site/blocos", version: 1, nodes: [instance("i", "desconhecido")] });
    const payload = parseBlocks(text)!;
    expect(payload).not.toBeNull();
    expect(pasteBlocks(page([]), payload, slot, context)).toEqual({ ok: false, reason: "foreign-component" });
    expect(REFUSAL_MESSAGE["foreign-component"]).toContain("não está neste site");
    // A hand-written copy of an instance of a component this site has is fine.
    expect(pasteBlocks(withComponent(), payload, slot, context)).toEqual({ ok: false, reason: "foreign-component" });
    const known = parseBlocks(JSON.stringify({ format: "meu-site/blocos", version: 1, nodes: [instance("i", "plano")] }))!;
    expect(pasteBlocks(withComponent(), known, slot, context).ok).toBe(true);
  });
  it("reads the definitions of a copy as strictly as the document: one that is not valid, has an instance inside or is too large makes the copy not valid", () => {
    const base = { format: "meu-site/blocos", version: 1, nodes: [instance("i", "plano")] };
    expect(parseBlocks(JSON.stringify({ ...base, components: [definition()] }))).not.toBeNull();
    expect(parseBlocks(JSON.stringify({ ...base, components: [{ ...definition(), name: "" }] }))).toBeNull();
    expect(parseBlocks(JSON.stringify({ ...base, components: [{ ...definition(), root: box("r", [instance("x", "plano")]) }] }))).toBeNull();
    expect(parseBlocks(JSON.stringify({ ...base, components: [{ ...definition(), root: box("r", Array.from({ length: MAX_COMPONENT_NODES }, (_, at) => node("paragraph", `n${at}`))) }] }))).toBeNull();
    expect(parseBlocks(JSON.stringify({ ...base, components: "x" }))).toBeNull();
    expect(parseBlocks(JSON.stringify({ ...base, components: Array.from({ length: MAX_COMPONENTS + 1 }, () => definition()) }))).toBeNull();
  });
});
