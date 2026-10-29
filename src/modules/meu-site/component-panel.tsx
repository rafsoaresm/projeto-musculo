"use client";
import { Pencil, Undo2, Unlink } from "lucide-react";
import {
  BLOCK_LABEL,
  BUTTON_MAX,
  CHANNELS,
  CHANNEL_LABEL,
  HEADING_MAX,
  NAME_MAX,
  TEXT_MAX,
  allNodes,
  applyOverrides,
  componentById,
  componentsOf,
  type Channel,
  type ComponentNode,
  type OverrideFields,
  type SiteContent,
  type SiteNode,
} from "./contracts";
import { openNodes, renameComponent, resetOverrideField, resetOverrides, setOverride, usesOf } from "./component-model";
import { ImagePicker } from "./image-picker";
import { ALT_MAX, CAPTION_MAX } from "./images";
import type { ImageSupport } from "./editor-inspector";

/** What the panel of an instance asks the editor to do: go into the component, or take the instance back to plain blocks. */
export interface ComponentActions {
  edit: (componentId: string) => void;
  detach: (instanceId: string) => void;
}

type Change = (next: SiteContent, key?: string) => void;

const MAX: Record<string, number> = { text: TEXT_MAX, label: BUTTON_MAX, alt: ALT_MAX, caption: CAPTION_MAX };

/** The names of the open nodes of a component for the person: "Título", "Título 2", "Botão"... (a number only when the kind repeats). */
function labelsOf(nodes: readonly SiteNode[]): Map<string, string> {
  const total = new Map<string, number>();
  for (const entry of nodes) total.set(entry.type, (total.get(entry.type) ?? 0) + 1);
  const seen = new Map<string, number>();
  const out = new Map<string, string>();
  for (const entry of nodes) {
    const at = (seen.get(entry.type) ?? 0) + 1;
    seen.set(entry.type, at);
    out.set(entry.id, (total.get(entry.type) ?? 0) > 1 ? `${BLOCK_LABEL[entry.type]} ${at}` : BLOCK_LABEL[entry.type]);
  }
  return out;
}

/**
 * The settings of an instance of a component: which component it is, going into the component to change it (for every block that uses it),
 * taking the instance back to plain blocks, and the texts, buttons and images that the component leaves open to each instance. A field that this
 * instance changed shows it, with a way back to what the component says.
 */
export function ComponentPanel({ content, instance, images, onChange, actions }: { content: SiteContent; instance: ComponentNode; images: ImageSupport; onChange: Change; actions: ComponentActions }) {
  const definition = componentById(content, instance.componentId);
  if (!definition) {
    return (
      <>
        <p className="small muted" role="status">
          O componente deste bloco não existe mais. Exclua o bloco.
        </p>
      </>
    );
  }
  const uses = usesOf(content, definition.id);
  const open = openNodes(definition);
  const drawn = new Map(allNodes([applyOverrides(definition.root, instance.overrides)]).map((entry) => [entry.id, entry as unknown as Record<string, unknown>]));
  const original = new Map(allNodes([definition.root]).map((entry) => [entry.id, entry as unknown as Record<string, unknown>]));
  const labels = labelsOf(open.map((entry) => entry.node));
  const changed = (nodeId: string, field: keyof OverrideFields) => instance.overrides[nodeId]?.[field] !== undefined;
  const set = (nodeId: string, field: keyof OverrideFields, value: string) => onChange(setOverride(content, instance.id, nodeId, field, value), `${instance.id}:ov:${nodeId}:${field}`);
  const back = (nodeId: string, field: keyof OverrideFields) => onChange(resetOverrideField(content, instance.id, nodeId, field));
  const anyChange = Object.keys(instance.overrides).length > 0;

  const field = (nodeId: string, kind: keyof OverrideFields, label: string, rows?: number) => {
    const value = String(drawn.get(nodeId)?.[kind] ?? "");
    const ownValue = String(original.get(nodeId)?.[kind] ?? "");
    const max = kind === "text" && drawn.get(nodeId)?.type === "heading" ? HEADING_MAX : MAX[kind];
    return (
      <div key={`${nodeId}-${kind}`} className="ve-override" data-changed={changed(nodeId, kind) || undefined}>
        <label>
          {label}
          {rows ? (
            <textarea value={value} maxLength={max} rows={rows} onChange={(event) => set(nodeId, kind, event.target.value)} />
          ) : (
            <input value={value} maxLength={max} autoComplete="off" onChange={(event) => set(nodeId, kind, event.target.value)} />
          )}
        </label>
        {changed(nodeId, kind) && (
          <button type="button" className="button small secondary" title={ownValue ? `No componente: “${ownValue}”` : "No componente este campo está vazio"} onClick={() => back(nodeId, kind)}>
            <Undo2 size={14} aria-hidden="true" /> {`Voltar ao do componente (${label})`}
          </button>
        )}
      </div>
    );
  };

  return (
    <>
      <p className="small muted" role="status">
        Este bloco é o componente “{definition.name}”, usado em {uses} {uses === 1 ? "lugar" : "lugares"} do site. Mudar o componente muda todos eles; o que você muda aqui vale só para este bloco.
      </p>
      <label>
        Nome do componente
        <input value={definition.name} maxLength={NAME_MAX} autoComplete="off" onChange={(event) => onChange(renameComponent(content, definition.id, event.target.value), `component:${definition.id}:name`)} />
      </label>
      <div className="ve-org" role="group" aria-label="Ações do componente">
        <button type="button" className="button small secondary" onClick={() => actions.edit(definition.id)}>
          <Pencil size={16} aria-hidden="true" /> Editar o componente
        </button>
        <button type="button" className="button small secondary" onClick={() => actions.detach(instance.id)}>
          <Unlink size={16} aria-hidden="true" /> Desvincular (virar blocos comuns)
        </button>
      </div>

      <h3 className="ve-subtitle">O que este bloco muda</h3>
      {open.length === 0 ? (
        <p className="small muted">Este componente não tem textos, botões nem imagens que cada bloco possa mudar: edite o componente para mudar tudo.</p>
      ) : (
        open.map(({ node }) => {
          const name = labels.get(node.id) ?? BLOCK_LABEL[node.type];
          return (
            <div key={node.id} className="faq-item" role="group" aria-label={`${name} do componente`}>
              {(node.type === "heading" || node.type === "paragraph") && field(node.id, "text", name, node.type === "paragraph" ? 4 : 2)}
              {(node.type === "button" || node.type === "link") && (
                <>
                  {field(node.id, "label", `Texto do ${node.type === "link" ? "link" : "botão"}${open.filter((other) => other.node.type === node.type).length > 1 ? ` (${name})` : ""}`)}
                  <label>
                    {`Contato do ${node.type === "link" ? "link" : "botão"} (${name})`}
                    <select
                      value={instance.overrides[node.id]?.channel ?? ""}
                      onChange={(event) => (event.target.value ? set(node.id, "channel", event.target.value as Channel) : back(node.id, "channel"))}
                    >
                      <option value="">Como no componente</option>
                      {CHANNELS.map((channel) => (
                        <option key={channel} value={channel}>
                          {CHANNEL_LABEL[channel]}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              {node.type === "image" && (
                <>
                  <ImagePicker
                    legend={`Imagem (${name})`}
                    name={`override-${instance.id}-${node.id}`}
                    library={images.library}
                    value={String(drawn.get(node.id)?.assetId ?? "")}
                    onChange={(assetId) => set(node.id, "assetId", assetId)}
                    usedIds={images.usedIds}
                    available={images.available}
                    src={images.src}
                    onUpload={images.upload}
                    onRemove={images.remove}
                  />
                  {field(node.id, "alt", `Descrição da imagem (${name})`, 2)}
                  {field(node.id, "caption", `Legenda (${name})`)}
                </>
              )}
            </div>
          );
        })
      )}
      {anyChange && (
        <button type="button" className="button small secondary" onClick={() => onChange(resetOverrides(content, instance.id))}>
          <Undo2 size={14} aria-hidden="true" /> Voltar tudo ao do componente
        </button>
      )}
      {componentsOf(content).length > 0 && <p className="small muted">Para mudar o estilo (tamanho, espaços, cores), use a aba Estilo: vale para este bloco. O estilo de dentro é do componente.</p>}
    </>
  );
}
