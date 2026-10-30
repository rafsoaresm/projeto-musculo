"use client";
import type { ReactNode } from "react";
import type { SiteNode } from "./contracts";
import type { ImageSupport } from "./editor-inspector";
import { ImagePicker } from "./image-picker";
import { SCREENS, SCREEN_LABEL, hasOverrides, isHiddenAt, ownStyle, resolveStyle, type Screen } from "./screens";
import { SCREEN_ICON, screenTitle } from "./screen-ui";
import type { Theme } from "./site-theme";
import { ChoiceField, ColorField, LengthField, NumberField, Section, SelectField, type Option } from "./style-controls";
import { SPECS, type Style } from "./style";

/**
 * The style panel: the properties of the selected block, in groups, as in the builders people know. Every control writes a
 * typed value (see style.ts) and every one can be taken back; nothing here accepts text of a stylesheet.
 *
 * The panel is about one size of the screen at a time (the computer, the tablet or the phone). The controls show what the
 * block really has at that size; what comes from a larger size is shown in grey, and a change is written to this size alone.
 */
const option = <T extends string | number>(value: T, label: string): Option<T> => ({ value, label });

const DISPLAYS = [option("flex", "Flex"), option("grid", "Grade"), option("block", "Bloco")] as const;
const DIRECTIONS = [option("row", "Linha"), option("column", "Coluna")] as const;
const WRAPS = [option("nowrap", "Sem quebra"), option("wrap", "Quebrar")] as const;
const ALIGNS = [option("start", "Início"), option("center", "Centro"), option("end", "Fim"), option("stretch", "Esticar"), option("baseline", "Linha base")] as const;
const SELF_ALIGNS = [option("auto", "Auto"), option("start", "Início"), option("center", "Centro"), option("end", "Fim"), option("stretch", "Esticar")] as const;
const JUSTIFIES = [option("start", "Início"), option("center", "Centro"), option("end", "Fim"), option("between", "Entre"), option("around", "Ao redor"), option("evenly", "Igual")] as const;
const FONT_FAMILIES = [option("sans", "Sem serifa"), option("serif", "Com serifa"), option("mono", "Monoespaçada"), option("display", "Título em destaque (condensada)")] as const;
const FONT_WEIGHTS = [
  option(100, "Muito fina (100)"),
  option(200, "Extra leve (200)"),
  option(300, "Leve (300)"),
  option(400, "Normal (400)"),
  option(500, "Média (500)"),
  option(600, "Seminegrito (600)"),
  option(700, "Negrito (700)"),
  option(800, "Extranegrito (800)"),
  option(900, "Preta (900)"),
] as const;
const TEXT_ALIGNS = [option("left", "Esquerda"), option("center", "Centro"), option("right", "Direita"), option("justify", "Justificado")] as const;
const TEXT_TRANSFORMS = [option("none", "Normal"), option("uppercase", "MAIÚSCULAS"), option("lowercase", "minúsculas"), option("capitalize", "Capitalizar")] as const;
const TEXT_DECORATIONS = [option("none", "Nenhuma"), option("underline", "Sublinhado"), option("line-through", "Riscado")] as const;
const BORDER_STYLES = [option("solid", "Sólida"), option("dashed", "Tracejada"), option("dotted", "Pontilhada")] as const;
const SHADOWS = [option("none", "Nenhuma"), option("sm", "Pequena"), option("md", "Média"), option("lg", "Grande"), option("xl", "Enorme")] as const;
const OVERFLOWS = [option("visible", "Visível"), option("hidden", "Cortar"), option("auto", "Rolar")] as const;
const BG_SIZES = [option("cover", "Cobrir"), option("contain", "Conter"), option("auto", "Original")] as const;
const BG_POSITIONS = [
  option("center", "Centro"),
  option("top", "Em cima"),
  option("bottom", "Embaixo"),
  option("left", "À esquerda"),
  option("right", "À direita"),
  option("top-left", "Em cima, esquerda"),
  option("top-right", "Em cima, direita"),
  option("bottom-left", "Embaixo, esquerda"),
  option("bottom-right", "Embaixo, direita"),
] as const;

const whole = (min: number, max: number) => (value: number) => Number.isInteger(value) && value >= min && value <= max;

type Patch = Partial<Record<keyof Style, unknown>>;
type Sides = "padding" | "margin";

function SidesGroup({
  group,
  label,
  style,
  inherited,
  spec,
  onSide,
}: {
  group: Sides;
  label: string;
  style: Style;
  inherited: (group: Sides, side: "top" | "right" | "bottom" | "left") => boolean;
  spec: typeof SPECS.space | typeof SPECS.margin;
  onSide: (group: Sides, side: "top" | "right" | "bottom" | "left", value: string | undefined) => void;
}) {
  const sides = [
    ["top", "cima"],
    ["right", "direita"],
    ["bottom", "baixo"],
    ["left", "esquerda"],
  ] as const;
  return (
    <div className="ve-sides-group" role="group" aria-label={label}>
      <span className="ve-field-label" aria-hidden="true">
        {label}
      </span>
      <div className="ve-sides">
        {sides.map(([side, name]) => (
          <LengthField
            key={side}
            label={name.charAt(0).toUpperCase() + name.slice(1)}
            name={`${label} · ${name}`}
            value={style[group]?.[side]}
            inherited={inherited(group, side)}
            spec={spec}
            onChange={(value) => onSide(group, side, value)}
          />
        ))}
      </div>
    </div>
  );
}

const EXPLANATION: Record<Screen, string> = {
  desktop: "O que você muda aqui vale para todos os tamanhos, a não ser que o tablet ou o celular tenham o seu próprio valor.",
  tablet: "O que você muda aqui vale para o tablet e para o celular, a não ser que o celular tenha o seu próprio valor. Em cinza, o que vem do computador.",
  mobile: "O que você muda aqui vale só para o celular. Em cinza, o que vem do tablet ou do computador.",
};

export function StylePanel({
  node,
  screen,
  onScreen,
  inFlex,
  theme,
  images,
  onStyle,
  onSide,
  onHidden,
  onClear,
}: {
  node: SiteNode;
  /** The size of the screen being edited. */
  screen: Screen;
  onScreen: (screen: Screen) => void;
  /** Whether the container that holds the block lays out its content as a flex row or column. */
  inFlex: boolean;
  theme: Theme;
  images: ImageSupport;
  onStyle: (patch: Patch) => void;
  onSide: (group: Sides, side: "top" | "right" | "bottom" | "left", value: string | undefined) => void;
  /** Hide or show the block at this size. */
  onHidden: (hide: boolean) => void;
  /** The computer: take all the styles of the block away. The others: take this size's own changes back. */
  onClear: () => void;
}) {
  // What the block really has at this size, and what this size says by itself.
  const style: Style = resolveStyle(node, screen);
  const own: Style = ownStyle(node, screen) ?? {};
  const isBox = node.type === "box";
  const hidden = isHiddenAt(node, screen);
  const hasChanges = screen === "desktop" ? SCREENS.some((size) => Object.keys(ownStyle(node, size) ?? {}).length > 0) : hasOverrides(node, screen);
  const flex = style.display === "flex";
  const grid = style.display === "grid";
  const isInherited = (key: keyof Style) => screen !== "desktop" && own[key] === undefined && style[key] !== undefined;
  const sideInherited = (group: Sides, side: "top" | "right" | "bottom" | "left") => screen !== "desktop" && own[group]?.[side] === undefined && style[group]?.[side] !== undefined;
  /** The three things every control takes: what the block has at this size, whether that is this size's own, and how to change it. */
  const field = <K extends keyof Style>(key: K) => ({
    value: style[key],
    inherited: isInherited(key),
    onChange: (value: Style[K] | undefined) => onStyle({ [key]: value }),
  });
  // The image the size below would draw: a smaller size that does not want it says "no image" (see the background below).
  const belowImage = screen === "desktop" ? "" : (resolveStyle(node, screen === "tablet" ? "desktop" : "tablet").bgImage ?? "");

  const sections: ReactNode[] = [];
  if (isBox) {
    sections.push(
      <Section key="layout" title="Layout" defaultOpen>
        <ChoiceField label="Tipo" {...field("display")} options={DISPLAYS} />
        {flex && (
          <>
            <ChoiceField label="Direção" {...field("direction")} options={DIRECTIONS} />
            <ChoiceField label="Quebra de linha" {...field("wrap")} options={WRAPS} />
            <SelectField label="Alinhar (cruzado)" {...field("align")} options={ALIGNS} />
            <SelectField label="Distribuir" {...field("justify")} options={JUSTIFIES} />
          </>
        )}
        {grid && (
          <>
            <NumberField label="Colunas" {...field("columns")} valid={whole(1, 12)} min={1} max={12} />
            <SelectField label="Alinhar" {...field("align")} options={ALIGNS} />
            <SelectField label="Distribuir" {...field("justify")} options={JUSTIFIES} />
          </>
        )}
        {(flex || grid) && <LengthField label="Espaço entre os blocos" {...field("gap")} spec={SPECS.gap} />}
        {!flex && !grid && <p className="small muted">Escolha Flex ou Grade para organizar o que está dentro deste contêiner.</p>}
      </Section>,
    );
  }
  if (inFlex) {
    sections.push(
      <Section key="child" title="Posição no contêiner">
        <NumberField label="Crescer" {...field("grow")} valid={whole(0, 10)} min={0} max={10} />
        <NumberField label="Encolher" {...field("shrink")} valid={whole(0, 10)} min={0} max={10} />
        <LengthField label="Tamanho base" {...field("basis")} spec={SPECS.width} />
        <SelectField label="Alinhar este bloco" {...field("selfAlign")} options={SELF_ALIGNS} />
      </Section>,
    );
  }
  sections.push(
    <Section key="spacing" title="Espaçamento">
      <SidesGroup group="padding" label="Margem interna" style={style} inherited={sideInherited} spec={SPECS.space} onSide={onSide} />
      <SidesGroup group="margin" label="Margem externa" style={style} inherited={sideInherited} spec={SPECS.margin} onSide={onSide} />
    </Section>,
    <Section key="size" title="Tamanho">
      <LengthField label="Largura" {...field("width")} spec={SPECS.width} />
      <LengthField label="Largura mínima" {...field("minWidth")} spec={SPECS.widthLimit} />
      <LengthField label="Largura máxima" {...field("maxWidth")} spec={SPECS.widthLimit} />
      <LengthField label="Altura" {...field("height")} spec={SPECS.height} />
      <LengthField label="Altura mínima" {...field("minHeight")} spec={SPECS.heightLimit} />
      <LengthField label="Altura máxima" {...field("maxHeight")} spec={SPECS.heightLimit} />
    </Section>,
  );
  if (node.type !== "image") {
    sections.push(
      <Section key="type" title="Tipografia">
        <SelectField label="Fonte" {...field("fontFamily")} options={FONT_FAMILIES} />
        <LengthField label="Tamanho da letra" {...field("fontSize")} spec={SPECS.fontSize} />
        <SelectField label="Peso" {...field("fontWeight")} options={FONT_WEIGHTS} />
        <NumberField
          label="Altura da linha"
          {...field("lineHeight")}
          valid={(value) => value >= 0.8 && value <= 3 && Math.abs(value * 20 - Math.round(value * 20)) < 1e-9}
          min={0.8}
          max={3}
          step={0.05}
        />
        <LengthField label="Espaço entre letras" {...field("letterSpacing")} spec={SPECS.letter} />
        <ChoiceField label="Alinhamento do texto" {...field("textAlign")} options={TEXT_ALIGNS} />
        <SelectField label="Caixa" {...field("textTransform")} options={TEXT_TRANSFORMS} />
        <SelectField label="Decoração" {...field("textDecoration")} options={TEXT_DECORATIONS} />
        <ColorField label="Cor do texto" {...field("color")} theme={theme} />
      </Section>,
    );
  }
  sections.push(
    <Section key="background" title="Fundo">
      <ColorField label="Cor de fundo" {...field("background")} theme={theme} />
      <ImagePicker
        legend="Imagem de fundo"
        name={`bg-${node.id}`}
        library={images.library}
        value={style.bgImage ?? ""}
        // "No image" at the computer is no key. At a smaller size that inherits an image it has to be said: an empty image takes it off there.
        onChange={(assetId) => onStyle({ bgImage: assetId || (belowImage ? "" : undefined) })}
        allowNone
        noneLabel="Sem imagem"
        usedIds={images.usedIds}
        available={images.available}
        src={images.src}
        onUpload={images.upload}
        onRemove={images.remove}
      />
      {style.bgImage && (
        <>
          <ChoiceField label="Tamanho da imagem" {...field("bgSize")} options={BG_SIZES} />
          <SelectField label="Posição da imagem" {...field("bgPosition")} options={BG_POSITIONS} />
          <label className="check-row">
            <input type="checkbox" checked={style.bgRepeat === true} onChange={(event) => onStyle({ bgRepeat: event.target.checked ? true : undefined })} />
            <span>Repetir a imagem</span>
          </label>
          <p className="small muted">A imagem de fundo é pública quando a página for publicada. Não use fotos de alunos.</p>
        </>
      )}
    </Section>,
    <Section key="border" title="Borda, sombra e efeitos">
      <LengthField label="Espessura da borda" {...field("borderWidth")} spec={SPECS.border} />
      <SelectField label="Estilo da borda" {...field("borderStyle")} options={BORDER_STYLES} />
      <ColorField label="Cor da borda" {...field("borderColor")} theme={theme} />
      <LengthField label="Arredondamento" {...field("radius")} spec={SPECS.radius} />
      <SelectField label="Sombra" {...field("shadow")} options={SHADOWS} />
      <NumberField label="Opacidade (%)" {...field("opacity")} valid={whole(0, 100)} min={0} max={100} />
      <SelectField label="Conteúdo que passa da caixa" {...field("overflow")} options={OVERFLOWS} />
    </Section>,
  );

  return (
    <div className="ve-fields ve-style-panel" data-screen={screen}>
      <div className="ve-screens" role="group" aria-label="Tamanho da tela em edição">
        {SCREENS.map((size) => {
          const Icon = SCREEN_ICON[size];
          return (
            <button key={size} type="button" aria-pressed={screen === size} title={screenTitle(size)} aria-label={`Estilo do ${SCREEN_LABEL[size].toLowerCase()}`} onClick={() => onScreen(size)}>
              <Icon size={16} aria-hidden="true" />
              <span>{SCREEN_LABEL[size]}</span>
              {size !== "desktop" && hasOverrides(node, size) && <i className="ve-dot" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      <p className="small muted">{EXPLANATION[screen]} Para um campo voltar ao padrão, use o botão ao lado dele.</p>
      <Section key="visibility" title="Visibilidade" defaultOpen>
        <label className="check-row">
          <input type="checkbox" checked={hidden} onChange={(event) => onHidden(event.target.checked)} />
          <span>Ocultar no {SCREEN_LABEL[screen].toLowerCase()}</span>
        </label>
        <p className="small muted">{hidden ? "O bloco não aparece neste tamanho e não ocupa espaço." : "O bloco aparece neste tamanho."}</p>
        <p className="small muted">Ocultar só esconde na tela: o texto continua no código da página pública. Para tirar de vez, exclua o bloco.</p>
      </Section>
      {sections}
      <button type="button" className="button small secondary" disabled={!hasChanges} onClick={onClear}>
        {screen === "desktop" ? "Limpar todo o estilo deste bloco" : `Voltar o ${SCREEN_LABEL[screen].toLowerCase()} ao que vem do tamanho de cima`}
      </button>
    </div>
  );
}
