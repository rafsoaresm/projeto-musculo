"use client";
import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from "lucide-react";
import {
  ANSWER_MAX,
  BLOCK_LABEL,
  BUTTON_MAX,
  CHANNELS,
  CHANNEL_LABEL,
  FAQ_MAX,
  HEADING_MAX,
  QUESTION_MAX,
  SUBHEADING_MAX,
  TEXT_MAX,
  type Block,
  type Channel,
} from "./contracts";
import { DELIVERY_LABEL } from "@/modules/leads/contracts";
import type { ServiceChoice } from "@/db/sites";

function Text({ label, value, max, onChange, rows }: { label: string; value: string; max: number; onChange: (value: string) => void; rows?: number }) {
  return (
    <label>
      {label}
      {rows ? (
        <textarea value={value} maxLength={max} rows={rows} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input value={value} maxLength={max} autoComplete="off" onChange={(event) => onChange(event.target.value)} />
      )}
    </label>
  );
}

function ChannelSelect({ value, onChange }: { value: Channel | undefined; onChange: (value: Channel | undefined) => void }) {
  return (
    <label>
      O botão leva a
      <select value={value ?? ""} onChange={(event) => onChange((event.target.value || undefined) as Channel | undefined)}>
        <option value="">Sem botão</option>
        {CHANNELS.map((channel) => (
          <option key={channel} value={channel}>
            {CHANNEL_LABEL[channel]}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The fields of one block, by its type. The editor holds the whole document; this only edits one block of it. */
export function BlockEditor({
  block,
  index,
  total,
  services,
  onChange,
  onMove,
  onDuplicate,
  onRemove,
}: {
  block: Block;
  index: number;
  total: number;
  services: ServiceChoice[];
  onChange: (block: Block) => void;
  onMove: (by: -1 | 1) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const title = `Bloco ${index + 1}: ${BLOCK_LABEL[block.type]}`;
  const set = (patch: Partial<Block>) => onChange({ ...block, ...patch } as Block);
  const known = new Set(services.map((service) => service.id));
  return (
    <fieldset className="block-editor">
      <legend>{title}</legend>
      <div className="block-tools" role="group" aria-label={`Ações do ${title}`}>
        <button type="button" className="button small secondary" disabled={index === 0} onClick={() => onMove(-1)} aria-label={`Subir o bloco ${index + 1}`}>
          <ArrowUp size={16} />
        </button>
        <button type="button" className="button small secondary" disabled={index === total - 1} onClick={() => onMove(1)} aria-label={`Descer o bloco ${index + 1}`}>
          <ArrowDown size={16} />
        </button>
        <button type="button" className="button small secondary" onClick={onDuplicate} aria-label={`Duplicar o bloco ${index + 1}`}>
          <Copy size={16} />
        </button>
        <button type="button" className="button small danger-outline" onClick={onRemove} aria-label={`Remover o bloco ${index + 1}`}>
          <Trash2 size={16} />
        </button>
      </div>

      {block.type === "hero" && (
        <>
          <Text label="Título do destaque" value={block.heading} max={HEADING_MAX} onChange={(heading) => set({ heading })} />
          <Text label="Subtítulo" value={block.subheading} max={SUBHEADING_MAX} rows={2} onChange={(subheading) => set({ subheading })} />
          <Text label="Texto do botão" value={block.buttonLabel} max={BUTTON_MAX} onChange={(buttonLabel) => set({ buttonLabel })} />
          <ChannelSelect value={block.buttonChannel} onChange={(buttonChannel) => set({ buttonChannel })} />
        </>
      )}

      {block.type === "text" && (
        <>
          <Text label="Título (opcional)" value={block.heading} max={HEADING_MAX} onChange={(heading) => set({ heading })} />
          <Text label="Texto" value={block.text} max={TEXT_MAX} rows={6} onChange={(text) => set({ text })} />
        </>
      )}

      {block.type === "services" && (
        <>
          <Text label="Título da seção" value={block.heading} max={HEADING_MAX} onChange={(heading) => set({ heading })} />
          <Text label="Introdução (opcional)" value={block.intro} max={SUBHEADING_MAX} rows={2} onChange={(intro) => set({ intro })} />
          <div role="group" aria-label={`Serviços do bloco ${index + 1}`} className="check-list">
            {services.length === 0 && (
              <p className="small muted">Você ainda não tem serviços na oferta. Cadastre em Serviços e volte aqui.</p>
            )}
            {services.map((service) => (
              <label key={service.id} className="check-row">
                <input
                  type="checkbox"
                  checked={block.serviceIds.includes(service.id)}
                  onChange={(event) =>
                    set({
                      serviceIds: event.target.checked
                        ? [...block.serviceIds, service.id]
                        : block.serviceIds.filter((serviceId) => serviceId !== service.id),
                    })
                  }
                />
                <span>
                  {service.name} <span className="small muted">({DELIVERY_LABEL[service.delivery]})</span>
                </span>
              </label>
            ))}
            {block.serviceIds
              .filter((serviceId) => !known.has(serviceId))
              .map((serviceId) => (
                <label key={serviceId} className="check-row">
                  <input type="checkbox" checked onChange={() => set({ serviceIds: block.serviceIds.filter((other) => other !== serviceId) })} />
                  <span>Um serviço que saiu da oferta (desmarque para tirar do bloco)</span>
                </label>
              ))}
          </div>
        </>
      )}

      {block.type === "faq" && (
        <>
          <Text label="Título da seção" value={block.heading} max={HEADING_MAX} onChange={(heading) => set({ heading })} />
          {block.items.map((item, position) => (
            <div key={position} className="faq-item" role="group" aria-label={`Pergunta ${position + 1}`}>
              <Text
                label="Pergunta"
                value={item.question}
                max={QUESTION_MAX}
                onChange={(question) => set({ items: block.items.map((other, i) => (i === position ? { ...other, question } : other)) })}
              />
              <Text
                label="Resposta"
                value={item.answer}
                max={ANSWER_MAX}
                rows={3}
                onChange={(answer) => set({ items: block.items.map((other, i) => (i === position ? { ...other, answer } : other)) })}
              />
              <button
                type="button"
                className="button small danger-outline"
                onClick={() => set({ items: block.items.filter((_, i) => i !== position) })}
                aria-label={`Remover a pergunta ${position + 1} do bloco ${index + 1}`}
              >
                <Trash2 size={16} /> Remover pergunta
              </button>
            </div>
          ))}
          {block.items.length < FAQ_MAX && (
            <button type="button" className="button small secondary" onClick={() => set({ items: [...block.items, { question: "", answer: "" }] })}>
              <Plus size={16} /> Acrescentar pergunta
            </button>
          )}
        </>
      )}

      {block.type === "cta" && (
        <>
          <Text label="Título da chamada" value={block.heading} max={HEADING_MAX} onChange={(heading) => set({ heading })} />
          <Text label="Texto (opcional)" value={block.text} max={SUBHEADING_MAX} rows={2} onChange={(text) => set({ text })} />
          <Text label="Texto do botão" value={block.buttonLabel} max={BUTTON_MAX} onChange={(buttonLabel) => set({ buttonLabel })} />
          <ChannelSelect value={block.buttonChannel} onChange={(buttonChannel) => set({ buttonChannel })} />
        </>
      )}
    </fieldset>
  );
}
