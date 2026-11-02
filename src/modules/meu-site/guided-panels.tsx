"use client";
import { useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import {
  BUTTON_MAX,
  DESCRIPTION_MAX,
  HOME,
  MAX_MENU_LINKS,
  PAGE_TITLE_MAX,
  TITLE_MAX,
  pageById,
  pageContent,
  pagesOf,
  type PublishIssue,
  type SiteContent,
} from "./contracts";
import type { ImageSupport } from "./editor-inspector";
import { ImagePicker } from "./image-picker";
import { PagesPanel, SubpageSettings, type PageActions } from "./pages-panel";
import { PAGE_REFUSAL_MESSAGE, addPage, addPageFrom, deletePage, duplicatePage, linksTo, movePage, setInMenu, setTitle } from "./page-model";
import { PublishIssues } from "./publish-issues";
import { PublicAddress } from "./public-address";
import { sectionFields, sectionsOf, withPageField, type Field } from "./guided-model";
import { FOOTER, HEADER, guidedSections, sectionOfNode, type GuidedState, type SectionRef } from "./guided-state";
import { GUIDED_SECTIONS } from "./site-kits";
import { SECTION_REFUSAL_MESSAGE, addSection, isHiddenSection, moveSection, removeSection, setSectionHidden } from "./guided-sections";
import { brandNote, withAccent, withBrand, withFontChoice, withLogo, withMode, withPaletteColor, withSiteName } from "./guided-brand";
import { PALETTE_HINT, PALETTE_KEYS, PALETTE_LABEL, paletteAdjusted } from "./site-palette";
import { addMenuLink, moveMenuLink, removeMenuLink, withHeaderCta, withMenuAnchor, withMenuLabel } from "./guided-menu";
import { seoPreview } from "./guided-seo";
import { ACCENTS, ACCENT_LABEL, BRAND_START, FONTS, FONT_LABEL, MODES, MODE_LABEL, type Accent, type Mode } from "./site-theme";

type Edit = (next: SiteContent, key?: string) => void;

// ---------------------------------------------------------------- Páginas

export function PagesTab({
  content,
  pageId,
  slug,
  onEdit,
  onPage,
  onEditContent,
}: {
  content: SiteContent;
  pageId: string;
  slug: string;
  onEdit: Edit;
  onPage: (pageId: string) => void;
  onEditContent: (pageId: string) => void;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const done = (outcome: ReturnType<typeof addPage>, after?: (id: string) => void) => {
    if (!outcome.ok) {
      setMessage(PAGE_REFUSAL_MESSAGE[outcome.reason]);
      return;
    }
    setMessage(null);
    onEdit(outcome.content);
    after?.(outcome.id);
  };
  const actions: PageActions = {
    go: onPage,
    add: () => done(addPage(content), (id) => (onPage(id), setMessage("Página criada. Dê um título a ela: é o nome no menu e faz o endereço."))),
    addFrom: (key) => done(addPageFrom(content, key), onPage),
    duplicate: (target) => done(duplicatePage(content, target), onPage),
    remove: (target) => {
      const broken = linksTo(content, target);
      done(deletePage(content, target), () => {
        onPage(HOME);
        setMessage(broken > 0 ? `Página excluída. ${broken} botão(ões) ou link(s) levavam a ela e ficaram sem destino. Dá para desfazer.` : "Página excluída. Dá para desfazer.");
      });
    },
    move: (target, by) => onEdit(movePage(content, target, by)),
  };
  return (
    <div className="guided-pages">
      <PagesPanel content={content} currentId={pageId} actions={actions} slug={slug} />
      {message && (
        <p className="small" role="status">
          {message}
        </p>
      )}
      <p>
        <button type="button" className="button primary small" onClick={() => onEditContent(pageId)}>
          Editar o conteúdo desta página
        </button>
      </p>
      {pageId !== HOME && (
        <section className="guided-subpage" aria-label="Dados da página">
          <SubpageSettings content={content} pageId={pageId} onChange={onEdit} siteSlug={slug} />
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Conteúdo

export function ContentPanel({
  content,
  state,
  pageSelect,
  images,
  onEdit,
  onSection,
  onBack,
  onBrand,
}: {
  content: SiteContent;
  state: GuidedState;
  pageSelect: ReactNode;
  images: ImageSupport;
  onEdit: Edit;
  onSection: (section: SectionRef) => void;
  onBack: () => void;
  onBrand: () => void;
}) {
  const sections = guidedSections(content, state.pageId);
  const current = sections.find((entry) => entry.ref === state.section) ?? null;
  const blocks = pageContent(content, state.pageId).blocks;
  const [adding, setAdding] = useState(false);
  const [said, setSaid] = useState("");
  // After an action the button that had the focus may be gone or disabled: the focus goes to what is next to it, not to the page.
  const focusLater = (selector: string) =>
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`.guided-content ${selector}`)?.focus());
  const ownSection = (ref: SectionRef | null) => (ref ? (blocks.find((entry) => entry.id === ref) ?? null) : null);
  const selected = ownSection(state.section);
  const add = (key: string, label: string) => {
    const outcome = addSection(content, state.pageId, key, selected?.id ?? null);
    if (!outcome.ok) {
      setSaid(SECTION_REFUSAL_MESSAGE[outcome.reason]);
      return;
    }
    onEdit(outcome.content);
    setAdding(false);
    setSaid(`Seção “${label}” acrescentada. Escreva o conteúdo dela; o que ficar vazio não aparece no site.`);
    onSection(outcome.id);
    focusLater("#conteudo-da-secao");
  };
  return (
    <div className="guided-content">
      {/* Above the list and the fields, so on a phone it is read on either step. */}
      <p className="small muted guided-said" role="status">
        {said}
      </p>
      <div className="guided-list">
        {pageSelect}
        <nav aria-labelledby="secoes-do-site">
          <h2 id="secoes-do-site">Seções do site</h2>
          <ul className="guided-section-list">
            {sections.map((entry, index) => {
              const own = ownSection(entry.ref);
              const hidden = own ? isHiddenSection(own) : false;
              // The page's own sections are numbered after the header (index 0): the first can't go up, the last can't go down.
              const position = index - 1;
              return (
                <li key={entry.ref} data-hidden={hidden ? "" : undefined}>
                  <button type="button" className="guided-section-pick" data-section={entry.ref} aria-pressed={entry.ref === state.section} onClick={() => onSection(entry.ref)}>
                    {entry.label}
                    {hidden && <span className="guided-hidden-tag"> · escondida</span>}
                  </button>
                  {own && (
                    <span className="guided-section-tools">
                      <button type="button" aria-label={`Subir a seção ${entry.label}`} disabled={position === 0}
                        data-tool={`up-${own.id}`}
                        onClick={() => {
                          onEdit(moveSection(content, state.pageId, own.id, -1));
                          setSaid(`Seção “${entry.label}” subiu.`);
                          if (position === 1) focusLater(`[data-tool="down-${own.id}"]`);
                        }}
                      >
                        <ArrowUp size={16} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Descer a seção ${entry.label}`}
                        disabled={position === blocks.length - 1}
                        data-tool={`down-${own.id}`}
                        onClick={() => {
                          onEdit(moveSection(content, state.pageId, own.id, 1));
                          setSaid(`Seção “${entry.label}” desceu.`);
                          if (position === blocks.length - 2) focusLater(`[data-tool="up-${own.id}"]`);
                        }}
                      >
                        <ArrowDown size={16} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label={hidden ? `Mostrar a seção ${entry.label} no site` : `Esconder a seção ${entry.label} do site`}
                        aria-pressed={hidden}
                        onClick={() => {
                          onEdit(setSectionHidden(content, state.pageId, own.id, !hidden));
                          setSaid(hidden ? `A seção “${entry.label}” volta a aparecer no site.` : `A seção “${entry.label}” fica escondida: não aparece no site, e o conteúdo dela continua guardado.`);
                        }}
                      >
                        {hidden ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                      </button>
                      <button
                        type="button"
                        aria-label={`Excluir a seção ${entry.label}`}
                        onClick={() => {
                          onEdit(removeSection(content, state.pageId, own.id));
                          setSaid(`Seção “${entry.label}” excluída. Use Desfazer, no topo, para trazê-la de volta.`);
                          // The section that takes its place in the list (the footer of the site after the last one).
                          focusLater(`[data-section="${sections[index + 1]?.ref ?? FOOTER}"]`);
                        }}
                      >
                        <Trash2 size={16} aria-hidden="true" />
                      </button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>
        <button type="button" className="button secondary" aria-expanded={adding} aria-controls="guiado-acrescentar" onClick={() => setAdding((open) => !open)}>
          <Plus size={16} aria-hidden="true" /> Acrescentar seção
        </button>
        {adding && (
          <div id="guiado-acrescentar" className="guided-add" role="group" aria-label="Acrescentar seção">
            <p className="small muted">{selected ? `Entra depois de “${current?.label ?? ""}”.` : "Entra no fim da página."} Ela já vem com a cor e a fonte do site.</p>
            <ul>
              {GUIDED_SECTIONS.map((item) => (
                <li key={item.key}>
                  <button type="button" onClick={() => add(item.key, item.label)}>
                    <strong>{item.label}</strong>
                    <span className="small muted">{item.hint}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <section className="guided-fields" aria-labelledby="conteudo-da-secao">
        <button type="button" className="button small secondary guided-narrow-only" onClick={onBack}>
          <ChevronLeft size={16} aria-hidden="true" /> Seções
        </button>
        <h2 id="conteudo-da-secao" tabIndex={-1}>{current ? current.label : "Conteúdo da seção"}</h2>
        {selected && isHiddenSection(selected) && (
          <p className="notice">
            Esta seção está escondida: não aparece no site.{" "}
            <button type="button" className="button small secondary" onClick={() => onEdit(setSectionHidden(content, state.pageId, selected.id, false))}>
              Mostrar no site
            </button>
          </p>
        )}
        {state.section === HEADER ? (
          <HeaderFields content={content} images={images} onEdit={onEdit} onBrand={onBrand} />
        ) : state.section === FOOTER ? (
          <FooterFields content={content} pageId={state.pageId} onEdit={onEdit} />
        ) : state.section ? (
          <BlockFields content={content} pageId={state.pageId} sectionId={state.section} images={images} onEdit={onEdit} />
        ) : (
          <p className="small muted">Escolha uma seção na lista ou clique nela na prévia.</p>
        )}
      </section>
    </div>
  );
}

function TextField({ label, value, max, rows, onChange, hint }: { label: string; value: string; max: number; rows?: number; onChange: (value: string) => void; hint?: string }) {
  return (
    <label>
      {label}
      {rows ? (
        <textarea rows={rows} value={value} maxLength={max} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input value={value} maxLength={max} autoComplete="off" onChange={(event) => onChange(event.target.value)} />
      )}
      {hint && <span className="small muted">{hint}</span>}
    </label>
  );
}

function LogoPicker({ content, images, onEdit }: { content: SiteContent; images: ImageSupport; onEdit: Edit }) {
  return (
    <ImagePicker
      legend="Logotipo"
      name="guiado-logo"
      library={images.library}
      value={content.logoAssetId ?? ""}
      onChange={(assetId) => onEdit(withLogo(content, assetId), "guided:logo")}
      allowNone
      noneLabel="Sem logotipo"
      usedIds={images.usedIds}
      available={images.available}
      src={images.src}
      onUpload={images.upload}
      onRemove={images.remove}
    />
  );
}

function HeaderFields({ content, images, onEdit, onBrand }: { content: SiteContent; images: ImageSupport; onEdit: Edit; onBrand: () => void }) {
  return (
    <div className="guided-field-list">
      <p className="small muted">O cabeçalho é o mesmo em todas as páginas: o logotipo, o nome do site e o menu.</p>
      <TextField label="Nome do site" value={content.title} max={TITLE_MAX} onChange={(value) => onEdit(withSiteName(content, value), "guided:title")} />
      <LogoPicker content={content} images={images} onEdit={onEdit} />
      <fieldset className="ve-choice">
        <legend>Menu</legend>
        {pagesOf(content).length === 0 ? (
          <p className="small muted">O site tem só a página inicial: o menu aparece quando houver outra página (aba Páginas).</p>
        ) : (
          <ul className="guided-menu-list">
            {pagesOf(content).map((page) => (
              <li key={page.id}>
                <TextField label={`Nome no menu (/${page.slug})`} value={page.title} max={PAGE_TITLE_MAX} onChange={(value) => onEdit(setTitle(content, page.id, value), `guided:menu:${page.id}`)} />
                <label className="check-row">
                  <input type="checkbox" checked={page.inMenu !== false} onChange={(event) => onEdit(setInMenu(content, page.id, event.target.checked))} />
                  <span>Aparecer no menu</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>
      <SectionLinks content={content} onEdit={onEdit} />
      <fieldset className="ve-choice">
        <legend>Botão do WhatsApp no cabeçalho</legend>
        <label className="check-row">
          <input
            type="checkbox"
            checked={Boolean(content.headerCta)}
            onChange={(event) => onEdit(withHeaderCta(content, event.target.checked ? "Falar no WhatsApp" : null))}
          />
          <span>Mostrar o botão no fim do cabeçalho</span>
        </label>
        {content.headerCta && (
          <TextField
            label="Texto do botão"
            value={content.headerCta.label}
            max={BUTTON_MAX}
            onChange={(value) => onEdit(withHeaderCta(content, value), "guided:header-cta")}
            hint={content.contact.whatsapp ? "Leva ao WhatsApp do site." : "Preencha o WhatsApp no rodapé do site: sem número, o botão não aparece na página publicada."}
          />
        )}
      </fieldset>
      <p className="small">
        Cores, fonte e aparência ficam na aba{" "}
        <button type="button" className="link-button" onClick={onBrand}>
          Marca
        </button>
        .
      </p>
    </div>
  );
}

/** The menu's links to parts of the home page (a one-page site): a name and the section each one leads to. */
function SectionLinks({ content, onEdit }: { content: SiteContent; onEdit: Edit }) {
  const sections = sectionsOf(content, HOME);
  const menu = content.menu ?? [];
  const free = sections.find((entry) => !menu.some((link) => link.anchor === entry.id));
  return (
    <fieldset className="ve-choice">
      <legend>Links para as seções da página inicial</legend>
      {menu.length === 0 && <p className="small muted">Nenhum link: o menu mostra só as páginas do site.</p>}
      <ul className="guided-menu-list">
        {menu.map((link, index) => (
          <li key={`${link.anchor}-${index}`}>
            <TextField label={`Nome do link ${index + 1}`} value={link.label} max={BUTTON_MAX} onChange={(value) => onEdit(withMenuLabel(content, index, value), `guided:menu-link:${index}`)} />
            <label>
              Leva à seção
              <select value={link.anchor} onChange={(event) => onEdit(withMenuAnchor(content, index, event.target.value))}>
                {sections.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </label>
            <span className="persist-actions">
              <button type="button" className="button small secondary" disabled={index === 0} onClick={() => onEdit(moveMenuLink(content, index, -1))} aria-label={`Subir o link ${link.label}`}>
                <ArrowUp size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="button small secondary"
                disabled={index === menu.length - 1}
                onClick={() => onEdit(moveMenuLink(content, index, 1))}
                aria-label={`Descer o link ${link.label}`}
              >
                <ArrowDown size={16} aria-hidden="true" />
              </button>
              <button type="button" className="button small secondary" onClick={() => onEdit(removeMenuLink(content, index))} aria-label={`Tirar o link ${link.label}`}>
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </span>
          </li>
        ))}
      </ul>
      {menu.length < MAX_MENU_LINKS && free && (
        <button type="button" className="button small secondary" onClick={() => onEdit(addMenuLink(content, free.id, free.label))}>
          <Plus size={16} aria-hidden="true" /> Acrescentar link
        </button>
      )}
    </fieldset>
  );
}

function FooterFields({ content, pageId, onEdit }: { content: SiteContent; pageId: string; onEdit: Edit }) {
  const own = pageContent(content, pageId).blocks.some((entry) => entry.type === "box" && entry.tag === "footer");
  const contact = (field: keyof SiteContent["contact"], value: string) => onEdit({ ...content, contact: { ...content.contact, [field]: value } }, `guided:contact:${field}`);
  return (
    <div className="guided-field-list">
      <p className="small muted">
        O rodapé está em todas as páginas: o nome do site e os contatos preenchidos abaixo. Os botões de contato das seções levam a estes mesmos contatos.
      </p>
      {own && <p className="small notice info">Esta página tem um rodapé próprio entre as seções; ele aparece no lugar do rodapé do site.</p>}
      <label>
        WhatsApp
        <input type="tel" value={content.contact.whatsapp} maxLength={30} autoComplete="off" onChange={(event) => contact("whatsapp", event.target.value)} />
      </label>
      <label>
        E-mail de contato
        <input type="email" value={content.contact.email} maxLength={254} autoComplete="off" onChange={(event) => contact("email", event.target.value)} />
      </label>
      <label>
        Instagram (o nome de usuário)
        <input value={content.contact.instagram} maxLength={31} autoComplete="off" onChange={(event) => contact("instagram", event.target.value)} />
      </label>
    </div>
  );
}

function BlockFields({ content, pageId, sectionId, images, onEdit }: { content: SiteContent; pageId: string; sectionId: string; images: ImageSupport; onEdit: Edit }) {
  const fields = sectionFields(content, pageId, sectionId);
  const change = (field: Field, value: string) => onEdit(withPageField(content, pageId, field.key, value), `guided:${pageId}:${field.key}`);
  if (fields.length === 0) return <p className="small muted">Esta seção não tem textos nem imagens para editar aqui.</p>;
  return (
    <div className="guided-field-list">
      {fields.map((field) =>
        field.kind === "check" ? (
          <label key={field.key} className="check-row">
            <input type="checkbox" checked={field.value === "true"} onChange={(event) => change(field, event.target.checked ? "true" : "")} />
            <span>{field.label}</span>
          </label>
        ) : field.kind === "image" ? (
          <ImagePicker
            key={field.key}
            legend={field.label}
            name={`guiado-${field.key}`}
            library={images.library}
            value={field.value}
            onChange={(assetId) => change(field, assetId)}
            allowNone={!field.required}
            noneLabel={field.demo ? "Foto de exemplo do modelo (não vai para o site publicado)" : field.illustration ? "Ilustração do modelo" : "Sem imagem"}
            usedIds={images.usedIds}
            available={images.available}
            src={images.src}
            onUpload={images.upload}
            onRemove={images.remove}
          />
        ) : (
          <TextField key={field.key} label={field.label} value={field.value} max={field.max} rows={field.kind === "multiline" ? 3 : undefined} onChange={(value) => change(field, value)} />
        ),
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Marca

export function BrandPanel({ content, images, onEdit }: { content: SiteContent; images: ImageSupport; onEdit: Edit }) {
  const note = content.theme.brand ? brandNote(content.theme.brand, content.theme.mode) : null;
  const palette = content.theme.palette;
  const adjusted = palette ? paletteAdjusted(palette) : [];
  return (
    <div className="guided-field-list">
      <h2>Marca do site</h2>
      <TextField label="Nome do site" value={content.title} max={TITLE_MAX} onChange={(value) => onEdit(withSiteName(content, value), "guided:title")} hint="Aparece no cabeçalho, no rodapé e no título da página inicial." />
      <LogoPicker content={content} images={images} onEdit={onEdit} />
      {palette && (
        <fieldset className="ve-choice guided-palette">
          <legend>Cores do site</legend>
          <p className="small muted">As seis cores do modelo. Troque qualquer uma: o botão do WhatsApp continua verde.</p>
          {PALETTE_KEYS.map((key) => (
            <label key={key} className="guided-palette-row">
              <input type="color" value={palette[key]} onChange={(event) => onEdit(withPaletteColor(content, key, event.target.value), `guided:palette:${key}`)} />
              <span>
                <strong>{PALETTE_LABEL[key]}</strong> <code>{palette[key]}</code>
                <span className="small muted"> {PALETTE_HINT[key]}</span>
              </span>
            </label>
          ))}
          <p className="small muted" role="status">
            {adjusted.length === 0
              ? "Todas as cores são usadas como estão."
              : `Para o texto continuar legível, a página usa um tom mais escuro ou mais claro de: ${adjusted.map((key) => PALETTE_LABEL[key].toLowerCase()).join(", ")}.`}
          </p>
        </fieldset>
      )}
      {!palette && (
      <fieldset className="ve-choice">
        <legend>Cor da marca</legend>
        <div className="ve-swatches">
          {ACCENTS.map((accent: Accent) => (
            <label key={accent} className="ve-swatch-option">
              <input type="radio" name="guiado-cor" checked={!content.theme.brand && content.theme.accent === accent} onChange={() => onEdit(withAccent(content, accent))} />
              <span className="ve-swatch" data-site-accent={accent} data-site-mode="light" aria-hidden="true" />
              <span>{ACCENT_LABEL[accent]}</span>
            </label>
          ))}
          <label className="ve-swatch-option">
            <input type="radio" name="guiado-cor" checked={Boolean(content.theme.brand)} onChange={() => onEdit(withBrand(content, content.theme.brand ?? BRAND_START))} />
            <span className="ve-swatch" style={{ background: content.theme.brand ?? BRAND_START }} aria-hidden="true" />
            <span>Minha cor</span>
          </label>
        </div>
        {content.theme.brand && (
          <>
            <label>
              Cor da sua marca
              <input type="color" value={content.theme.brand} onChange={(event) => onEdit(withBrand(content, event.target.value), "guided:brand")} />
            </label>
            {note && (
              <p className="small muted" role="status">
                {note.adjusted ? "A cor foi ajustada para o texto continuar legível: " : "A cor é usada como está: "}o botão fica <strong>{note.light}</strong> na aparência clara e{" "}
                <strong>{note.dark}</strong> na escura.
              </p>
            )}
          </>
        )}
      </fieldset>
      )}
      {!palette && (
      <fieldset className="ve-choice">
        <legend>Aparência</legend>
        <div className="ve-swatches">
          {MODES.map((mode: Mode) => (
            <label key={mode} className="ve-swatch-option">
              <input type="radio" name="guiado-modo" checked={content.theme.mode === mode} onChange={() => onEdit(withMode(content, mode))} />
              <span>{MODE_LABEL[mode]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      )}
      <fieldset className="ve-choice">
        <legend>Fonte</legend>
        <div className="ve-swatches">
          {(["default", ...FONTS] as const).map((font) => (
            <label key={font} className="ve-swatch-option">
              <input type="radio" name="guiado-fonte" checked={(content.theme.font ?? "default") === font} onChange={() => onEdit(withFontChoice(content, font === "default" ? undefined : font))} />
              <span data-site-font={font === "default" ? undefined : font}>{FONT_LABEL[font]}</span>
            </label>
          ))}
        </div>
        <p className="small muted">Inter vem com o site; as outras são as do próprio aparelho de quem visita.</p>
      </fieldset>
    </div>
  );
}

// ---------------------------------------------------------------- SEO

export function SeoPanel({ content, pageId, pageSelect, slug, onEdit }: { content: SiteContent; pageId: string; pageSelect: ReactNode; slug: string; onEdit: Edit }) {
  const page = pageId === HOME ? undefined : pageById(content, pageId);
  const preview = seoPreview(content, pageId, slug ? `…/s/${slug}${page ? `/${page.slug}` : ""}` : null);
  return (
    <div className="guided-field-list">
      <h2>Como a página aparece no Google</h2>
      {pageSelect}
      {page ? (
        <SubpageSettings content={content} pageId={pageId} onChange={onEdit} siteSlug={slug} />
      ) : (
        <>
          <TextField
            label="Título da página inicial"
            value={content.title}
            max={TITLE_MAX}
            onChange={(value) => onEdit(withSiteName(content, value), "guided:title")}
            hint="Na página inicial o título é o nome do site (o mesmo do cabeçalho)."
          />
          <TextField
            label="Descrição do site para buscadores"
            value={content.description}
            max={DESCRIPTION_MAX}
            rows={3}
            onChange={(value) => onEdit({ ...content, description: value.slice(0, DESCRIPTION_MAX) }, "guided:description")}
            hint="Vale para as páginas que não tiverem descrição própria."
          />
        </>
      )}
      <label className="check-row">
        <input type="checkbox" checked={content.indexable !== false} onChange={(event) => onEdit({ ...content, indexable: event.target.checked ? undefined : false })} />
        <span>Aparecer nos buscadores (vale para o site inteiro)</span>
      </label>
      <div className="guided-serp" role="group" aria-label="Prévia no Google">
        <p className="guided-serp-url">{preview.url}</p>
        <p className="guided-serp-title">{preview.title}</p>
        <p className="guided-serp-description">{preview.description || <span className="muted">Sem descrição.</span>}</p>
      </div>
      {preview.notes.length > 0 && (
        <ul className="small muted">
          {preview.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Publicar

export function PublishPanel({
  content,
  issues,
  pending,
  dirty,
  live,
  slug,
  onSave,
  onPublish,
  onPublishAnyway,
  onGo,
}: {
  content: SiteContent;
  issues: PublishIssue[];
  pending: boolean;
  dirty: boolean;
  live: boolean;
  slug: string;
  onSave: () => void;
  onPublish: () => void;
  onPublishAnyway: () => void;
  onGo: (pageId: string, section: SectionRef) => void;
}) {
  return (
    <div className="guided-field-list">
      <h2>Publicar</h2>
      <p>{live ? "O site está no ar. Publicar põe no ar o rascunho salvo." : "O site ainda não está no ar."}</p>
      <p className="small">
        Endereço: <PublicAddress slug={slug} />
      </p>
      {dirty && <p className="small notice warning">Há alterações não salvas: salve o rascunho antes de publicar, ou elas ficam de fora.</p>}
      <div className="persist-actions">
        <button type="button" className="button secondary" disabled={pending || !dirty} onClick={onSave}>
          Salvar rascunho
        </button>
        <button type="button" className="button primary" disabled={pending || dirty} onClick={onPublish}>
          Publicar
        </button>
      </div>
      <PublishIssues
        issues={issues}
        pending={pending}
        onPublishAnyway={onPublishAnyway}
        action={(issue) => {
          const where = issue.page ?? HOME;
          if (where !== HOME && !pageById(content, where)) return null;
          const section = issue.blockId ? sectionOfNode(content, where, issue.blockId) : null;
          if (!section) return null;
          return (
            <button type="button" className="button small secondary" onClick={() => onGo(where, section)}>
              Ir para
            </button>
          );
        }}
      />
    </div>
  );
}
