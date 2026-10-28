"use client";
import { ArrowDown, ArrowLeftRight, ArrowUp, Copy, Plus, Trash2 } from "lucide-react";
import {
  ANSWER_MAX,
  AUTHOR_MAX,
  BLOCK_LABEL,
  BUTTON_MAX,
  CHANNELS,
  CHANNEL_LABEL,
  DESCRIPTION_MAX,
  EYEBROW_MAX,
  FAQ_MAX,
  HEADING_MAX,
  IMAGE_SIZES,
  IMAGE_SIZE_LABEL,
  QUESTION_MAX,
  QUOTE_MAX,
  RATIOS,
  RATIO_LABEL,
  STATS_MAX,
  STAT_LABEL_MAX,
  STAT_VALUE_MAX,
  SUBHEADING_MAX,
  TEXT_MAX,
  TITLE_MAX,
  type Block,
  type Channel,
  type ColumnItem,
  type ImageSize,
  type Ratio,
  type SiteContent,
} from "./contracts";
import { locate, updateBlock } from "./editor-model";
import { ACCENTS, ACCENT_LABEL, MODES, MODE_LABEL, type Accent, type Mode } from "./site-theme";
import { DELIVERY_LABEL } from "@/modules/leads/contracts";
import type { ServiceChoice } from "@/db/sites";
import type { AssetRow } from "@/db/site-assets";
import type { BlockAction } from "./editor-canvas";
import { ImagePicker, type RemoveResult, type UploadResult } from "./image-picker";
import { ALT_MAX, CAPTION_MAX } from "./images";

type Change = (next: SiteContent, key?: string) => void;

/** What the editor needs to choose, send and remove the images of the site's library. */
export interface ImageSupport {
  available: boolean;
  library: AssetRow[];
  /** The address of an image of the library for the editor, with the session. */
  src: (assetId: string) => string;
  /** The images the page being edited uses: those are not removed from the library from here. */
  usedIds: ReadonlySet<string>;
  upload: (file: File) => Promise<UploadResult>;
  remove: (assetId: string) => Promise<RemoveResult>;
}

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

function ChannelSelect({ label = "O botão leva a", value, onChange }: { label?: string; value: Channel | undefined; onChange: (value: Channel | undefined) => void }) {
  return (
    <label>
      {label}
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

/** The settings of the page itself: title, search description, contacts and look. What nothing selected shows. */
export function PageSettings({ content, onChange, images }: { content: SiteContent; onChange: Change; images: ImageSupport }) {
  const set = (patch: Partial<SiteContent>, key: string) => onChange({ ...content, ...patch }, `page:${key}`);
  const setContact = (field: keyof SiteContent["contact"], value: string) =>
    onChange({ ...content, contact: { ...content.contact, [field]: value } }, `page:contact.${field}`);
  return (
    <div className="ve-fields">
      <p className="small muted">Nada selecionado: estes são os dados da página inteira. Clique em um bloco para editar o bloco.</p>
      <Text label="Título do site" value={content.title} max={TITLE_MAX} onChange={(title) => set({ title }, "title")} />
      <Text label="Descrição para buscadores (opcional)" value={content.description} max={DESCRIPTION_MAX} rows={2} onChange={(description) => set({ description }, "description")} />
      <fieldset className="ve-choice">
        <legend>Cor de destaque</legend>
        <div className="ve-swatches">
          {ACCENTS.map((accent: Accent) => (
            <label key={accent} className="ve-swatch-option">
              <input type="radio" name="site-accent" checked={content.theme.accent === accent} onChange={() => set({ theme: { ...content.theme, accent } }, "theme")} />
              <span className="ve-swatch" data-site-accent={accent} data-site-mode="light" aria-hidden="true" />
              <span>{ACCENT_LABEL[accent]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="ve-choice">
        <legend>Aparência da página</legend>
        <div className="ve-swatches">
          {MODES.map((mode: Mode) => (
            <label key={mode} className="ve-swatch-option">
              <input type="radio" name="site-mode" checked={content.theme.mode === mode} onChange={() => set({ theme: { ...content.theme, mode } }, "theme")} />
              <span>{MODE_LABEL[mode]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <ImagePicker
        legend="Logotipo"
        name="site-logo"
        library={images.library}
        value={content.logoAssetId ?? ""}
        onChange={(assetId) => onChange({ ...content, logoAssetId: assetId || undefined }, "page:logo")}
        allowNone
        noneLabel="Sem logotipo"
        usedIds={images.usedIds}
        available={images.available}
        src={images.src}
        onUpload={images.upload}
        onRemove={images.remove}
      />
      <h3 className="ve-subtitle">Contatos</h3>
      <p className="small muted">Os botões e o rodapé levam a estes contatos. Só aparecem os que estiverem preenchidos.</p>
      <label>
        WhatsApp
        <input type="tel" value={content.contact.whatsapp} maxLength={30} autoComplete="off" onChange={(event) => setContact("whatsapp", event.target.value)} />
      </label>
      <label>
        E-mail de contato
        <input type="email" value={content.contact.email} maxLength={254} autoComplete="off" onChange={(event) => setContact("email", event.target.value)} />
      </label>
      <label>
        Instagram (o nome de usuário)
        <input value={content.contact.instagram} maxLength={31} autoComplete="off" onChange={(event) => setContact("instagram", event.target.value)} />
      </label>
    </div>
  );
}

/** The fields of the block that is selected, and what can be done with it. */
export function BlockInspector({
  content,
  id,
  services,
  images,
  onChange,
  act,
}: {
  content: SiteContent;
  id: string;
  services: ServiceChoice[];
  images: ImageSupport;
  onChange: Change;
  act: (id: string, action: BlockAction) => void;
}) {
  const found = locate(content, id);
  if (!found) return null;
  const entry = found.block;
  const patch = (changes: Record<string, unknown>) =>
    onChange(updateBlock(content, id, (current) => ({ ...current, ...changes }) as Block | ColumnItem), `${id}:${Object.keys(changes).join(",")}`);
  const known = new Set(services.map((service) => service.id));
  const label = BLOCK_LABEL[entry.type];

  return (
    <div className="ve-fields">
      {entry.type !== "columns" && "eyebrow" in entry && (
        <Text label="Etiqueta acima do título (opcional)" value={entry.eyebrow} max={EYEBROW_MAX} onChange={(eyebrow) => patch({ eyebrow })} />
      )}

      {entry.type === "hero" && (
        <>
          <Text label="Título do destaque" value={entry.heading} max={HEADING_MAX} onChange={(heading) => patch({ heading })} />
          <Text label="Subtítulo" value={entry.subheading} max={SUBHEADING_MAX} rows={3} onChange={(subheading) => patch({ subheading })} />
          <Text label="Texto do botão" value={entry.buttonLabel} max={BUTTON_MAX} onChange={(buttonLabel) => patch({ buttonLabel })} />
          <ChannelSelect value={entry.buttonChannel} onChange={(buttonChannel) => patch({ buttonChannel })} />
        </>
      )}

      {entry.type === "text" && (
        <>
          <Text label="Título (opcional)" value={entry.heading} max={HEADING_MAX} onChange={(heading) => patch({ heading })} />
          <Text label="Texto" value={entry.text} max={TEXT_MAX} rows={8} onChange={(text) => patch({ text })} />
        </>
      )}

      {entry.type === "services" && (
        <>
          <Text label="Título da seção" value={entry.heading} max={HEADING_MAX} onChange={(heading) => patch({ heading })} />
          <Text label="Introdução (opcional)" value={entry.intro} max={SUBHEADING_MAX} rows={2} onChange={(intro) => patch({ intro })} />
          <fieldset className="ve-choice">
            <legend>Serviços que aparecem</legend>
            <div className="check-list">
              {services.length === 0 && <p className="small muted">Você ainda não tem serviços na oferta. Cadastre em Serviços e volte aqui.</p>}
              {services.map((service) => (
                <label key={service.id} className="check-row">
                  <input
                    type="checkbox"
                    checked={entry.serviceIds.includes(service.id)}
                    onChange={(event) =>
                      patch({
                        serviceIds: event.target.checked ? [...entry.serviceIds, service.id] : entry.serviceIds.filter((serviceId) => serviceId !== service.id),
                      })
                    }
                  />
                  <span>
                    {service.name} <span className="small muted">({DELIVERY_LABEL[service.delivery]})</span>
                  </span>
                </label>
              ))}
              {entry.serviceIds
                .filter((serviceId) => !known.has(serviceId))
                .map((serviceId) => (
                  <label key={serviceId} className="check-row">
                    <input type="checkbox" checked onChange={() => patch({ serviceIds: entry.serviceIds.filter((other) => other !== serviceId) })} />
                    <span>Um serviço que saiu da oferta (desmarque para tirar do bloco)</span>
                  </label>
                ))}
            </div>
          </fieldset>
        </>
      )}

      {entry.type === "about" && (
        <>
          <Text label="Título" value={entry.heading} max={HEADING_MAX} onChange={(heading) => patch({ heading })} />
          <Text label="Texto" value={entry.text} max={TEXT_MAX} rows={6} onChange={(text) => patch({ text })} />
          <Text label="Destaque numérico (opcional)" value={entry.stat} max={STAT_VALUE_MAX} onChange={(stat) => patch({ stat })} />
          <Text label="Legenda do destaque" value={entry.statLabel} max={STAT_LABEL_MAX} onChange={(statLabel) => patch({ statLabel })} />
          <p className="small muted">Só escreva números que você pode comprovar.</p>
        </>
      )}

      {entry.type === "quote" && (
        <>
          <Text label="Depoimento" value={entry.quote} max={QUOTE_MAX} rows={5} onChange={(quote) => patch({ quote })} />
          <Text label="Quem deu o depoimento" value={entry.author} max={AUTHOR_MAX} onChange={(author) => patch({ author })} />
          <label className="check-row">
            <input type="checkbox" checked={entry.authorized} onChange={(event) => patch({ authorized: event.target.checked })} />
            <span>Tenho a autorização da pessoa para publicar este depoimento.</span>
          </label>
          <p className="small muted">Sem a autorização, o site não publica. Evite promessas de resultado de saúde.</p>
        </>
      )}

      {entry.type === "stats" && (
        <>
          <Text label="Título da seção (opcional)" value={entry.heading} max={HEADING_MAX} onChange={(heading) => patch({ heading })} />
          {entry.items.map((item, position) => (
            <div key={position} className="faq-item" role="group" aria-label={`Indicador ${position + 1}`}>
              <Text label="Número ou passo" value={item.value} max={STAT_VALUE_MAX} onChange={(value) => patch({ items: entry.items.map((other, i) => (i === position ? { ...other, value } : other)) })} />
              <Text label="Legenda" value={item.label} max={STAT_LABEL_MAX} onChange={(itemLabel) => patch({ items: entry.items.map((other, i) => (i === position ? { ...other, label: itemLabel } : other)) })} />
              <button type="button" className="button small danger-outline" aria-label={`Remover o indicador ${position + 1}`} onClick={() => patch({ items: entry.items.filter((_, i) => i !== position) })}>
                <Trash2 size={16} /> Remover indicador
              </button>
            </div>
          ))}
          {entry.items.length < STATS_MAX && (
            <button type="button" className="button small secondary" onClick={() => patch({ items: [...entry.items, { value: "", label: "" }] })}>
              <Plus size={16} /> Acrescentar indicador
            </button>
          )}
        </>
      )}

      {entry.type === "faq" && (
        <>
          <Text label="Título da seção" value={entry.heading} max={HEADING_MAX} onChange={(heading) => patch({ heading })} />
          {entry.items.map((item, position) => (
            <div key={position} className="faq-item" role="group" aria-label={`Pergunta ${position + 1}`}>
              <Text label="Pergunta" value={item.question} max={QUESTION_MAX} onChange={(question) => patch({ items: entry.items.map((other, i) => (i === position ? { ...other, question } : other)) })} />
              <Text label="Resposta" value={item.answer} max={ANSWER_MAX} rows={3} onChange={(answer) => patch({ items: entry.items.map((other, i) => (i === position ? { ...other, answer } : other)) })} />
              <button type="button" className="button small danger-outline" aria-label={`Remover a pergunta ${position + 1}`} onClick={() => patch({ items: entry.items.filter((_, i) => i !== position) })}>
                <Trash2 size={16} /> Remover pergunta
              </button>
            </div>
          ))}
          {entry.items.length < FAQ_MAX && (
            <button type="button" className="button small secondary" onClick={() => patch({ items: [...entry.items, { question: "", answer: "" }] })}>
              <Plus size={16} /> Acrescentar pergunta
            </button>
          )}
        </>
      )}

      {entry.type === "cta" && (
        <>
          <Text label="Título da chamada" value={entry.heading} max={HEADING_MAX} onChange={(heading) => patch({ heading })} />
          <Text label="Texto (opcional)" value={entry.text} max={SUBHEADING_MAX} rows={2} onChange={(text) => patch({ text })} />
          <Text label="Texto do botão" value={entry.buttonLabel} max={BUTTON_MAX} onChange={(buttonLabel) => patch({ buttonLabel })} />
          <ChannelSelect value={entry.buttonChannel} onChange={(buttonChannel) => patch({ buttonChannel })} />
        </>
      )}

      {entry.type === "columns" && (
        <>
          <label>
            Largura das colunas
            <select value={entry.ratio} onChange={(event) => patch({ ratio: event.target.value as Ratio })}>
              {RATIOS.map((ratio) => (
                <option key={ratio} value={ratio}>
                  {RATIO_LABEL[ratio]}
                </option>
              ))}
            </select>
          </label>
          <p className="small muted">
            Cada coluna recebe títulos, parágrafos e botões: arraste da biblioteca ou use os botões “Acrescentar” embaixo de cada coluna. No celular as
            colunas ficam uma sobre a outra.
          </p>
        </>
      )}

      {entry.type === "heading" && <Text label="Título" value={entry.text} max={HEADING_MAX} rows={2} onChange={(text) => patch({ text })} />}
      {entry.type === "paragraph" && <Text label="Parágrafo" value={entry.text} max={TEXT_MAX} rows={6} onChange={(text) => patch({ text })} />}
      {entry.type === "button" && (
        <>
          <Text label="Texto do botão" value={entry.label} max={BUTTON_MAX} onChange={(buttonLabel) => patch({ label: buttonLabel })} />
          <ChannelSelect value={entry.channel} onChange={(channel) => patch({ channel })} />
        </>
      )}

      {entry.type === "image" && (
        <>
          <ImagePicker
            legend="Imagem"
            name={`image-${entry.id}`}
            library={images.library}
            value={entry.assetId}
            onChange={(assetId) => patch({ assetId })}
            usedIds={images.usedIds}
            available={images.available}
            src={images.src}
            onUpload={images.upload}
            onRemove={images.remove}
          />
          <Text label="Descrição da imagem (para quem não consegue vê-la)" value={entry.alt} max={ALT_MAX} rows={2} onChange={(alt) => patch({ alt })} />
          <Text label="Legenda (opcional)" value={entry.caption} max={CAPTION_MAX} onChange={(caption) => patch({ caption })} />
          <label>
            Tamanho
            <select value={entry.size} onChange={(event) => patch({ size: event.target.value as ImageSize })}>
              {IMAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {IMAGE_SIZE_LABEL[size]}
                </option>
              ))}
            </select>
          </label>
        </>
      )}

      <h3 className="ve-subtitle">Organização</h3>
      <div className="ve-org" role="group" aria-label={`Organização do bloco ${label}`}>
        <button type="button" className="button small secondary" disabled={found.index === 0} onClick={() => act(id, "up")}>
          <ArrowUp size={16} /> Acima
        </button>
        <button type="button" className="button small secondary" disabled={found.index === found.count - 1} onClick={() => act(id, "down")}>
          <ArrowDown size={16} /> Abaixo
        </button>
        {found.container !== "root" && (
          <button type="button" className="button small secondary" onClick={() => act(id, "other-column")}>
            <ArrowLeftRight size={16} /> Outra coluna
          </button>
        )}
        <button type="button" className="button small secondary" onClick={() => act(id, "duplicate")}>
          <Copy size={16} /> Duplicar
        </button>
        <button type="button" className="button small danger-outline" onClick={() => act(id, "delete")}>
          <Trash2 size={16} /> Excluir
        </button>
      </div>
      <p className="small muted">Excluiu sem querer? Use Desfazer (Ctrl+Z).</p>
    </div>
  );
}
