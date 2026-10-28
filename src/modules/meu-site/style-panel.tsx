"use client";
import type { ReactNode } from "react";
import type { SiteNode } from "./contracts";
import type { ImageSupport } from "./editor-inspector";
import { ImagePicker } from "./image-picker";
import type { Theme } from "./site-theme";
import { ChoiceField, ColorField, LengthField, NumberField, Section, SelectField, type Option } from "./style-controls";
import { SPECS, type Style } from "./style";

/**
 * The style panel: the properties of the selected block, in groups, as in the builders people know. Every control writes a
 * typed value (see style.ts) and every one can be taken back; nothing here accepts text of a stylesheet.
 */
const option = <T extends string | number>(value: T, label: string): Option<T> => ({ value, label });

const DISPLAYS = [option("flex", "Flex"), option("grid", "Grade"), option("block", "Bloco")] as const;
const DIRECTIONS = [option("row", "Linha"), option("column", "Coluna")] as const;
const WRAPS = [option("nowrap", "Sem quebra"), option("wrap", "Quebrar")] as const;
const ALIGNS = [option("start", "Início"), option("center", "Centro"), option("end", "Fim"), option("stretch", "Esticar"), option("baseline", "Linha base")] as const;
const SELF_ALIGNS = [option("auto", "Auto"), option("start", "Início"), option("center", "Centro"), option("end", "Fim"), option("stretch", "Esticar")] as const;
const JUSTIFIES = [option("start", "Início"), option("center", "Centro"), option("end", "Fim"), option("between", "Entre"), option("around", "Ao redor"), option("evenly", "Igual")] as const;
const FONT_FAMILIES = [option("sans", "Sem serifa"), option("serif", "Com serifa"), option("mono", "Monoespaçada")] as const;
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

function SidesGroup({ group, label, style, spec, onSide }: { group: Sides; label: string; style: Style; spec: typeof SPECS.space | typeof SPECS.margin; onSide: (group: Sides, side: "top" | "right" | "bottom" | "left", value: string | undefined) => void }) {
  const sides = [
    ["top", "cima"],
    ["right", "direita"],
    ["bottom", "baixo"],
    ["left", "esquerda"],
  ] as const;
  return (
    <div className="ve-sides" role="group" aria-label={label}>
      {sides.map(([side, name]) => (
        <LengthField key={side} label={`${label} · ${name}`} value={style[group]?.[side]} spec={spec} onChange={(value) => onSide(group, side, value)} />
      ))}
    </div>
  );
}

export function StylePanel({
  node,
  inFlex,
  theme,
  images,
  onStyle,
  onSide,
  onClear,
}: {
  node: SiteNode;
  /** Whether the container that holds the block lays out its content as a flex row or column. */
  inFlex: boolean;
  theme: Theme;
  images: ImageSupport;
  onStyle: (patch: Patch) => void;
  onSide: (group: Sides, side: "top" | "right" | "bottom" | "left", value: string | undefined) => void;
  onClear: () => void;
}) {
  const style: Style = node.style ?? {};
  const isBox = node.type === "box";
  const hasStyle = Object.keys(style).length > 0;
  const flex = style.display === "flex";
  const grid = style.display === "grid";
  const set = <K extends keyof Style>(key: K) => (value: Style[K] | undefined) => onStyle({ [key]: value });

  const sections: ReactNode[] = [];
  if (isBox) {
    sections.push(
      <Section key="layout" title="Layout" defaultOpen>
        <ChoiceField label="Tipo" value={style.display} options={DISPLAYS} onChange={set("display")} />
        {flex && (
          <>
            <ChoiceField label="Direção" value={style.direction} options={DIRECTIONS} onChange={set("direction")} />
            <ChoiceField label="Quebra de linha" value={style.wrap} options={WRAPS} onChange={set("wrap")} />
            <SelectField label="Alinhar (cruzado)" value={style.align} options={ALIGNS} onChange={set("align")} />
            <SelectField label="Distribuir" value={style.justify} options={JUSTIFIES} onChange={set("justify")} />
          </>
        )}
        {grid && (
          <>
            <NumberField label="Colunas" value={style.columns} valid={whole(1, 12)} min={1} max={12} onChange={set("columns")} />
            <SelectField label="Alinhar" value={style.align} options={ALIGNS} onChange={set("align")} />
            <SelectField label="Distribuir" value={style.justify} options={JUSTIFIES} onChange={set("justify")} />
          </>
        )}
        {(flex || grid) && <LengthField label="Espaço entre os blocos" value={style.gap} spec={SPECS.gap} onChange={set("gap")} />}
        {!flex && !grid && <p className="small muted">Escolha Flex ou Grade para organizar o que está dentro deste contêiner.</p>}
      </Section>,
    );
  }
  if (inFlex) {
    sections.push(
      <Section key="child" title="Posição no contêiner">
        <NumberField label="Crescer" value={style.grow} valid={whole(0, 10)} min={0} max={10} onChange={set("grow")} />
        <NumberField label="Encolher" value={style.shrink} valid={whole(0, 10)} min={0} max={10} onChange={set("shrink")} />
        <LengthField label="Tamanho base" value={style.basis} spec={SPECS.width} onChange={set("basis")} />
        <SelectField label="Alinhar este bloco" value={style.selfAlign} options={SELF_ALIGNS} onChange={set("selfAlign")} />
      </Section>,
    );
  }
  sections.push(
    <Section key="spacing" title="Espaçamento">
      <SidesGroup group="padding" label="Margem interna" style={style} spec={SPECS.space} onSide={onSide} />
      <SidesGroup group="margin" label="Margem externa" style={style} spec={SPECS.margin} onSide={onSide} />
    </Section>,
    <Section key="size" title="Tamanho">
      <LengthField label="Largura" value={style.width} spec={SPECS.width} onChange={set("width")} />
      <LengthField label="Largura mínima" value={style.minWidth} spec={SPECS.widthLimit} onChange={set("minWidth")} />
      <LengthField label="Largura máxima" value={style.maxWidth} spec={SPECS.widthLimit} onChange={set("maxWidth")} />
      <LengthField label="Altura" value={style.height} spec={SPECS.height} onChange={set("height")} />
      <LengthField label="Altura mínima" value={style.minHeight} spec={SPECS.heightLimit} onChange={set("minHeight")} />
      <LengthField label="Altura máxima" value={style.maxHeight} spec={SPECS.heightLimit} onChange={set("maxHeight")} />
    </Section>,
  );
  if (node.type !== "image") {
    sections.push(
      <Section key="type" title="Tipografia">
        <SelectField label="Fonte" value={style.fontFamily} options={FONT_FAMILIES} onChange={set("fontFamily")} />
        <LengthField label="Tamanho da letra" value={style.fontSize} spec={SPECS.fontSize} onChange={set("fontSize")} />
        <SelectField label="Peso" value={style.fontWeight} options={FONT_WEIGHTS} onChange={set("fontWeight")} />
        <NumberField
          label="Altura da linha"
          value={style.lineHeight}
          valid={(value) => value >= 0.8 && value <= 3 && Math.abs(value * 20 - Math.round(value * 20)) < 1e-9}
          min={0.8}
          max={3}
          step={0.05}
          onChange={set("lineHeight")}
        />
        <LengthField label="Espaço entre letras" value={style.letterSpacing} spec={SPECS.letter} onChange={set("letterSpacing")} />
        <ChoiceField label="Alinhamento do texto" value={style.textAlign} options={TEXT_ALIGNS} onChange={set("textAlign")} />
        <SelectField label="Caixa" value={style.textTransform} options={TEXT_TRANSFORMS} onChange={set("textTransform")} />
        <SelectField label="Decoração" value={style.textDecoration} options={TEXT_DECORATIONS} onChange={set("textDecoration")} />
        <ColorField label="Cor do texto" value={style.color} theme={theme} onChange={set("color")} />
      </Section>,
    );
  }
  sections.push(
    <Section key="background" title="Fundo">
      <ColorField label="Cor de fundo" value={style.background} theme={theme} onChange={set("background")} />
      <ImagePicker
        legend="Imagem de fundo"
        name={`bg-${node.id}`}
        library={images.library}
        value={style.bgImage ?? ""}
        onChange={(assetId) => onStyle({ bgImage: assetId || undefined })}
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
          <ChoiceField label="Tamanho da imagem" value={style.bgSize} options={BG_SIZES} onChange={set("bgSize")} />
          <SelectField label="Posição da imagem" value={style.bgPosition} options={BG_POSITIONS} onChange={set("bgPosition")} />
          <label className="check-row">
            <input type="checkbox" checked={style.bgRepeat === true} onChange={(event) => onStyle({ bgRepeat: event.target.checked ? true : undefined })} />
            <span>Repetir a imagem</span>
          </label>
          <p className="small muted">A imagem de fundo é pública quando a página for publicada. Não use fotos de alunos.</p>
        </>
      )}
    </Section>,
    <Section key="border" title="Borda, sombra e efeitos">
      <LengthField label="Espessura da borda" value={style.borderWidth} spec={SPECS.border} onChange={set("borderWidth")} />
      <SelectField label="Estilo da borda" value={style.borderStyle} options={BORDER_STYLES} onChange={set("borderStyle")} />
      <ColorField label="Cor da borda" value={style.borderColor} theme={theme} onChange={set("borderColor")} />
      <LengthField label="Arredondamento" value={style.radius} spec={SPECS.radius} onChange={set("radius")} />
      <SelectField label="Sombra" value={style.shadow} options={SHADOWS} onChange={set("shadow")} />
      <NumberField label="Opacidade (%)" value={style.opacity} valid={whole(0, 100)} min={0} max={100} onChange={set("opacity")} />
      <SelectField label="Conteúdo que passa da caixa" value={style.overflow} options={OVERFLOWS} onChange={set("overflow")} />
    </Section>,
  );

  return (
    <div className="ve-fields ve-style-panel">
      <p className="small muted">
        O que você muda aqui vale para este bloco. Cada campo tem um limite e uma lista de valores: nada é digitado como código. Para um campo voltar ao
        padrão, use o botão ao lado dele.
      </p>
      {sections}
      <button type="button" className="button small secondary" disabled={!hasStyle} onClick={onClear}>
        Limpar todo o estilo deste bloco
      </button>
    </div>
  );
}
