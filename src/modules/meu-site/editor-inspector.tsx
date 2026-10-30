"use client";
import { ArrowDown, ArrowLeftToLine, ArrowUp, Component, Copy, Group, IndentIncrease, Plus, Trash2, Ungroup } from "lucide-react";
import {
  ANSWER_MAX,
  AUTHOR_MAX,
  BOX_TAGS,
  BOX_TAG_LABEL,
  BUTTON_MAX,
  CHANNELS,
  CHANNEL_LABEL,
  DESCRIPTION_MAX,
  EYEBROW_MAX,
  FAQ_MAX,
  HEADING_LEVELS,
  HEADING_MAX,
  IMAGE_RATIOS,
  IMAGE_RATIO_LABEL,
  IMAGE_SIZES,
  IMAGE_SIZE_LABEL,
  NAME_MAX,
  QUESTION_MAX,
  QUOTE_MAX,
  STATS_MAX,
  STAT_LABEL_MAX,
  STAT_VALUE_MAX,
  SUBHEADING_MAX,
  TEXT_MAX,
  TITLE_MAX,
  allNodes,
  type BoxTag,
  type Channel,
  type ImageRatio,
  type ImageSize,
  type SiteContent,
  type SiteNode,
} from "./contracts";
import { ancestorsOf, locate, updateBlock, updateBlocks } from "./editor-model";
import { nodeText, nodeTitle } from "./node-label";
import { ACCENTS, ACCENT_LABEL, FONTS, FONT_LABEL, MODES, MODE_LABEL, WIDTHS, WIDTH_LABEL, type Accent, type Font, type Mode, type Theme, type Width } from "./site-theme";
import { brandPalette } from "./brand-color";
import { ownStyle, type Screen } from "./screens";
import { clearStyles, patchSide, patchStyle, resetScreen, setHidden, withScreenStyle } from "./style-model";
import { StylePanel } from "./style-panel";
import type { Style } from "./style";
import { DELIVERY_LABEL } from "@/modules/leads/contracts";
import type { ServiceChoice } from "@/db/sites";
import type { AssetRow } from "@/db/site-assets";
import type { NodeAction } from "./editor-canvas";
import { ImagePicker, type RemoveResult, type UploadResult } from "./image-picker";
import { ComponentPanel, type ComponentActions } from "./component-panel";
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
      <select aria-label={label} value={value ?? ""} onChange={(event) => onChange((event.target.value || undefined) as Channel | undefined)}>
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

/** Where the color of "Minha cor" starts when it is chosen (the person changes it at once). */
const BRAND_START = "#0077b6";
/** The theme with an accent of the list in place of the brand color. */
const withoutBrand = (theme: Theme, accent: Accent): Theme => {
  const { brand: _dropped, ...rest } = theme;
  void _dropped;
  return { ...rest, accent };
};
/** The theme with a font (or none, for the page's own). */
const withFont = (theme: Theme, font: Font | undefined): Theme => {
  const { font: _dropped, ...rest } = theme;
  void _dropped;
  return font ? { ...rest, font } : rest;
};

/** The settings of the page itself: title, search description, contacts and look. What nothing selected shows. */
export function PageSettings({ content, onChange, images }: { content: SiteContent; onChange: Change; images: ImageSupport }) {
  const set = (patch: Partial<SiteContent>, key: string) => onChange({ ...content, ...patch }, `page:${key}`);
  const setContact = (field: keyof SiteContent["contact"], value: string) =>
    onChange({ ...content, contact: { ...content.contact, [field]: value } }, `page:contact.${field}`);
  return (
    <div className="ve-fields">
      <p className="small muted">Nada selecionado: estes são os dados do site inteiro. Clique em um bloco para editar o bloco; as outras páginas estão na aba Páginas.</p>
      <Text label="Título do site" value={content.title} max={TITLE_MAX} onChange={(title) => set({ title }, "title")} />
      <Text label="Descrição para buscadores (opcional)" value={content.description} max={DESCRIPTION_MAX} rows={2} onChange={(description) => set({ description }, "description")} />
      <label className="check-row">
        <input type="checkbox" checked={content.indexable !== false} onChange={(event) => set({ indexable: event.target.checked ? undefined : false }, "indexable")} />
        <span>Aparecer nos buscadores (Google e outros)</span>
      </label>
      <p className="small muted">Desmarcado, a página pede aos buscadores que não a listem. Ela continua aberta a quem tem o endereço: não é uma senha.</p>
      <fieldset className="ve-choice">
        <legend>Cor de destaque</legend>
        <div className="ve-swatches">
          {ACCENTS.map((accent: Accent) => (
            <label key={accent} className="ve-swatch-option">
              <input type="radio" name="site-accent" checked={!content.theme.brand && content.theme.accent === accent} onChange={() => set({ theme: withoutBrand(content.theme, accent) }, "theme")} />
              <span className="ve-swatch" data-site-accent={accent} data-site-mode="light" aria-hidden="true" />
              <span>{ACCENT_LABEL[accent]}</span>
            </label>
          ))}
          <label className="ve-swatch-option">
            <input type="radio" name="site-accent" checked={Boolean(content.theme.brand)} onChange={() => set({ theme: { ...content.theme, brand: content.theme.brand ?? BRAND_START } }, "theme")} />
            <span className="ve-swatch" style={{ background: content.theme.brand ?? BRAND_START }} aria-hidden="true" />
            <span>Minha cor</span>
          </label>
        </div>
        {content.theme.brand && (
          <>
            <label>
              Cor da sua marca
              <input type="color" value={content.theme.brand} onChange={(event) => set({ theme: { ...content.theme, brand: event.target.value.toLowerCase() } }, "brand")} />
            </label>
            <p className="small muted">
              A cor é ajustada só o quanto for preciso para o texto ficar legível: o botão fica <strong>{brandPalette(content.theme.brand, "light").solid}</strong> no modo claro e{" "}
              <strong>{brandPalette(content.theme.brand, "dark").solid}</strong> no escuro.
            </p>
          </>
        )}
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
      <fieldset className="ve-choice">
        <legend>Fonte da página</legend>
        <div className="ve-swatches">
          {(["default", ...FONTS] as const).map((font) => (
            <label key={font} className="ve-swatch-option">
              <input type="radio" name="site-font" checked={(content.theme.font ?? "default") === font} onChange={() => set({ theme: withFont(content.theme, font === "default" ? undefined : font) }, "theme")} />
              <span data-site-font={font === "default" ? undefined : font}>{FONT_LABEL[font]}</span>
            </label>
          ))}
        </div>
        <p className="small muted">São as fontes do próprio aparelho de quem visita: nada é baixado. Um bloco ainda pode ter a sua fonte, na aba Estilo.</p>
      </fieldset>
      <fieldset className="ve-choice">
        <legend>Largura da página</legend>
        <div className="ve-swatches">
          {WIDTHS.map((width: Width) => (
            <label key={width} className="ve-swatch-option">
              <input type="radio" name="site-width" checked={content.theme.width === width} onChange={() => set({ theme: { ...content.theme, width } }, "theme")} />
              <span>{WIDTH_LABEL[width]}</span>
            </label>
          ))}
        </div>
        <p className="small muted">Com a largura total, as seções podem ter fundo de ponta a ponta; o conteúdo de cada uma você organiza com contêineres.</p>
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

/** Where a button or a link goes: a contact, another block of the page, or another page of the site. */
function Destination({
  node,
  nodes,
  pages,
  onPatch,
  noun,
}: {
  node: { channel?: Channel; anchor?: string; page?: string };
  nodes: SiteNode[];
  /** The pages of the site a button can go to (the one being edited is not among them). */
  pages: ReadonlyArray<{ id: string; label: string }>;
  onPatch: (changes: Record<string, unknown>) => void;
  noun: string;
}) {
  const kind = node.page !== undefined ? "page" : node.anchor !== undefined ? "block" : node.channel !== undefined ? "contact" : "none";
  return (
    <>
      <label>
        {`O ${noun} leva a`}
        <select
          value={kind}
          onChange={(event) => {
            const next = event.target.value;
            if (next === "none") onPatch({ channel: undefined, anchor: undefined, page: undefined });
            else if (next === "contact") onPatch({ channel: node.channel ?? "whatsapp", anchor: undefined, page: undefined });
            else if (next === "page") onPatch({ channel: undefined, anchor: undefined, page: node.page ?? pages[0]?.id });
            else onPatch({ channel: undefined, anchor: node.anchor ?? nodes[0]?.id, page: undefined });
          }}
        >
          <option value="none">Nenhum lugar (ainda)</option>
          <option value="contact">Um contato</option>
          <option value="block" disabled={nodes.length === 0}>
            Outro bloco desta página
          </option>
          <option value="page" disabled={pages.length === 0 && node.page === undefined}>
            Outra página do site
          </option>
        </select>
      </label>
      {kind === "page" && (
        <label>
          Página de destino
          <select value={node.page ?? ""} onChange={(event) => onPatch({ page: event.target.value || undefined })}>
            {node.page !== undefined && !pages.some((other) => other.id === node.page) && <option value={node.page}>Uma página que não existe mais</option>}
            {pages.map((other) => (
              <option key={other.id} value={other.id}>
                {other.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {kind === "contact" && <ChannelSelect label="Contato de destino" value={node.channel} onChange={(channel) => onPatch({ channel: channel ?? "whatsapp" })} />}
      {kind === "block" && (
        <label>
          Bloco de destino
          <select value={node.anchor ?? ""} onChange={(event) => onPatch({ anchor: event.target.value || undefined })}>
            {node.anchor !== undefined && !nodes.some((other) => other.id === node.anchor) && <option value={node.anchor}>Um bloco que não existe mais</option>}
            {nodes.map((other) => (
              <option key={other.id} value={other.id}>
                {[nodeTitle(other), nodeText(other)].filter(Boolean).join(" · ")}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}

/** The settings of the block that is selected: what it says, how it looks, and where it is in the tree. */
export function BlockInspector({
  content,
  id,
  services,
  images,
  tab,
  onTab,
  screen,
  onScreen,
  onChange,
  act,
  select,
  ids,
  onComponent,
  inComponent,
  pages,
}: {
  content: SiteContent;
  id: string;
  /** The other pages of the site, for a button or a link that goes to one. */
  pages: ReadonlyArray<{ id: string; label: string }>;
  /** Going into a component, taking an instance back to plain blocks, and making a component of what is selected. */
  onComponent: ComponentActions & { create: () => void };
  /** A component is being edited: another one cannot be made from what is in it. */
  inComponent: boolean;
  /** Everything that is selected (the block shown is the last): a change of style is made to all of them. */
  ids: readonly string[];
  services: ServiceChoice[];
  images: ImageSupport;
  tab: "content" | "style";
  onTab: (tab: "content" | "style") => void;
  /** The size of the screen being edited, and a way to change it. */
  screen: Screen;
  onScreen: (screen: Screen) => void;
  onChange: Change;
  act: (id: string, action: NodeAction) => void;
  select: (id: string) => void;
}) {
  const found = locate(content, id);
  if (!found) return null;
  const entry = found.node;
  const patch = (changes: Record<string, unknown>) =>
    onChange(updateBlock(content, id, (current) => ({ ...current, ...changes }) as SiteNode), `${id}:${Object.keys(changes).join(",")}`);
  // With several blocks selected, the style panel is for all of them: each gets the same change on its own style.
  const group = ids.length > 1 && ids.includes(id) ? ids : [id];
  const several = group.length > 1;
  // A change of style is always to one size of the screen: the computer's style, or what the tablet or the phone does differently.
  const withStyle = (change: (style: Style | undefined) => Style | undefined, key: string) =>
    onChange(updateBlocks(content, group, (current) => withScreenStyle(current, screen, change(ownStyle(current, screen)))), `${id}:style:${screen}:${key}`);
  const onNode = (change: (current: SiteNode) => SiteNode, key: string) => onChange(updateBlocks(content, group, change), `${id}:style:${screen}:${key}`);
  const known = new Set(services.map((service) => service.id));
  const label = nodeTitle(entry);
  const above = ancestorsOf(content, id);
  const parent = found.parentId ? locate(content, found.parentId)?.node : undefined;
  const inFlex = parent?.type === "box" && parent.style?.display === "flex";
  const siblingBefore = found.index > 0 ? (found.parentId === null ? content.blocks : parent?.type === "box" ? parent.children : [])[found.index - 1] : undefined;
  const targets = allNodes(content.blocks).filter((other) => other.id !== id);

  return (
    <div className="ve-fields">
      {above.length > 0 && (
        <nav className="ve-crumbs" aria-label="Onde este bloco está">
          {above.map((ancestor) => (
            <button key={ancestor.id} type="button" onClick={() => select(ancestor.id)}>
              {nodeTitle(ancestor)}
            </button>
          ))}
          <span aria-current="true">{label}</span>
        </nav>
      )}
      {several ? (
        <p className="small muted ve-multi-note" role="status">
          {group.length} blocos selecionados: o que você mudar no estilo vale para todos. O painel mostra o que o último escolhido tem.
        </p>
      ) : (
        <div className="ve-tabs" role="group" aria-label="O que editar">
          <button type="button" aria-pressed={tab === "content"} onClick={() => onTab("content")}>
            Conteúdo
          </button>
          <button type="button" aria-pressed={tab === "style"} onClick={() => onTab("style")}>
            Estilo
          </button>
        </div>
      )}

      {several || tab === "style" ? (
        <StylePanel
          node={entry}
          screen={screen}
          onScreen={onScreen}
          inFlex={inFlex}
          theme={content.theme}
          images={images}
          onStyle={(changes) => withStyle((style) => patchStyle(style, changes), Object.keys(changes).join(","))}
          onSide={(group, side, value) => withStyle((style) => patchSide(style, group, side, value), `${group}.${side}`)}
          onHidden={(hide) => onNode((current) => setHidden(current, screen, hide), "hidden")}
          onClear={() => onNode((current) => (screen === "desktop" ? clearStyles(current) : resetScreen(current, screen)), "clear")}
        />
      ) : (
        <>
          <Text label="Nome da camada (só para você; não aparece na página)" value={entry.name ?? ""} max={NAME_MAX} onChange={(name) => patch({ name: name || undefined })} />

          {"eyebrow" in entry && <Text label="Etiqueta acima do título (opcional)" value={entry.eyebrow} max={EYEBROW_MAX} onChange={(eyebrow) => patch({ eyebrow })} />}

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

      {entry.type === "contactForm" && (
        <>
          <Text label="Título do formulário" value={entry.heading} max={HEADING_MAX} onChange={(heading) => patch({ heading })} />
          <Text label="Texto acima dos campos (opcional)" value={entry.text} max={SUBHEADING_MAX} rows={2} onChange={(text) => patch({ text })} />
          <Text label="Texto do botão de enviar" value={entry.buttonLabel} max={BUTTON_MAX} onChange={(buttonLabel) => patch({ buttonLabel })} />
          <p className="small muted">
            Os campos (nome, e-mail ou telefone, mensagem e a caixa do aviso de privacidade) são os da ferramenta e não mudam. O formulário só aparece na página publicada
            depois que a plataforma abrir os formulários públicos e você ligar o recebimento de mensagens em “Mensagens do site”. Quem escreve não vira aluno nem lead
            sozinho: a mensagem espera em Leads até você decidir. Não peça dados de saúde por aqui.
          </p>
        </>
      )}


          {entry.type === "component" && <ComponentPanel content={content} instance={entry} images={images} onChange={onChange} actions={onComponent} />}

          {entry.type === "box" && (
            <>
              <label>
                Tipo de caixa
                <select value={entry.tag} onChange={(event) => patch({ tag: event.target.value as BoxTag })}>
                  {BOX_TAGS.map((tag) => (
                    <option key={tag} value={tag}>
                      {BOX_TAG_LABEL[tag]}
                    </option>
                  ))}
                </select>
              </label>
              <p className="small muted">
                Um contêiner guarda outros blocos. Como eles se organizam (lado a lado, um sobre o outro, em grade) você escolhe na aba Estilo. {entry.children.length === 0 ? "Este está vazio: arraste algo para dentro dele." : `Tem ${entry.children.length} bloco(s) dentro.`}
              </p>
            </>
          )}

          {entry.type === "heading" && (
            <>
              <Text label="Título" value={entry.text} max={HEADING_MAX} rows={2} onChange={(text) => patch({ text })} />
              <label>
                Nível do título
                <select value={entry.level} onChange={(event) => patch({ level: Number(event.target.value) })}>
                  {HEADING_LEVELS.map((level) => (
                    <option key={level} value={level}>
                      {`Título ${level}${level === 2 ? " (seção)" : ""}`}
                    </option>
                  ))}
                </select>
              </label>
              <p className="small muted">O título principal da página (nível 1) é o do primeiro destaque, ou o nome do site.</p>
            </>
          )}
          {entry.type === "paragraph" && <Text label="Parágrafo" value={entry.text} max={TEXT_MAX} rows={6} onChange={(text) => patch({ text })} />}
          {entry.type === "button" && (
            <>
              <Text label="Texto do botão" value={entry.label} max={BUTTON_MAX} onChange={(label) => patch({ label })} />
              <Destination node={entry} nodes={targets} pages={pages} onPatch={patch} noun="botão" />
            </>
          )}
          {entry.type === "link" && (
            <>
              <Text label="Texto do link" value={entry.label} max={BUTTON_MAX} onChange={(label) => patch({ label })} />
              <Destination node={entry} nodes={targets} pages={pages} onPatch={patch} noun="link" />
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
            Proporção
            <select value={entry.ratio ?? "auto"} onChange={(event) => patch({ ratio: event.target.value === "auto" ? undefined : (event.target.value as ImageRatio) })}>
              {IMAGE_RATIOS.map((ratio) => (
                <option key={ratio} value={ratio}>
                  {IMAGE_RATIO_LABEL[ratio]}
                </option>
              ))}
            </select>
          </label>
          <p className="small muted">Com uma proporção, a imagem é cortada no centro para preencher o quadro; “Original” a mostra inteira, como foi enviada.</p>
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
          <div className="ve-org" role="group" aria-label={`Organização de ${label}`}>
            <button type="button" className="button small secondary" disabled={found.index === 0} onClick={() => act(id, "up")}>
              <ArrowUp size={16} /> Acima
            </button>
            <button type="button" className="button small secondary" disabled={found.index === found.count - 1} onClick={() => act(id, "down")}>
              <ArrowDown size={16} /> Abaixo
            </button>
            <button type="button" className="button small secondary" disabled={found.parentId === null} onClick={() => act(id, "out")}>
              <ArrowLeftToLine size={16} /> Sair do contêiner
            </button>
            <button type="button" className="button small secondary" disabled={siblingBefore?.type !== "box"} onClick={() => act(id, "into")}>
              <IndentIncrease size={16} /> Entrar no contêiner de cima
            </button>
            <button type="button" className="button small secondary" onClick={() => act(id, "wrap")}>
              <Group size={16} /> Agrupar
            </button>
            {entry.type === "box" && (
              <button type="button" className="button small secondary" onClick={() => act(id, "unwrap")}>
                <Ungroup size={16} /> Desagrupar
              </button>
            )}
            <button type="button" className="button small secondary" onClick={() => act(id, "duplicate")}>
              <Copy size={16} /> Duplicar
            </button>
            {entry.type !== "component" && (
              <button type="button" className="button small secondary" disabled={inComponent} title={inComponent ? "Dentro de um componente não dá para criar outro" : "Guardar este bloco como um componente, para usar em vários lugares"} onClick={onComponent.create}>
                <Component size={16} /> Criar componente
              </button>
            )}
            <button type="button" className="button small danger-outline" onClick={() => act(id, "delete")}>
              <Trash2 size={16} /> Excluir
            </button>
          </div>
          <p className="small muted">Excluiu sem querer? Use Desfazer (Ctrl+Z).</p>
        </>
      )}
    </div>
  );
}
