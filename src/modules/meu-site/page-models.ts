import { emptyBlock, type BlockOf, type BoxNode, type SiteNode } from "./contracts";
import { catalogueItem } from "./presets";

/**
 * Pages that start from a model: a title, and the blocks that page usually has, made of the sections and templates the library already offers.
 * Like those templates, a model **invents no text**: what the person has to write is left empty (the editor shows what goes there), and the
 * only words filled in are the names of the places (the title of the page, the heading of a section that is called what it is) and the text of
 * the contact buttons, which go to the contacts the person filled in. A model of testimonials brings the authorization unticked, so nothing is
 * published before the person confirms it.
 */
export interface PageModel {
  key: string;
  /** What the list of models says. */
  label: string;
  hint: string;
  /** The title the page starts with (the name it has in the menu); the address comes from it. */
  title: string;
  build: () => SiteNode[];
}

export const section = (key: string): SiteNode => {
  const item = catalogueItem(key);
  if (!item) throw new Error(`no template ${key}`);
  return item.create();
};
/** The call to get in touch the starter page has: a heading and a button to the WhatsApp. */
const callToContact = (): SiteNode => ({ ...(emptyBlock("cta") as BlockOf<"cta">), heading: "Fale comigo", buttonLabel: "Chamar no WhatsApp", buttonChannel: "whatsapp" });
const channels = (): SiteNode => {
  const box = emptyBlock("box") as BoxNode;
  const button = (label: string, channel: "whatsapp" | "email" | "instagram"): SiteNode => ({ ...(emptyBlock("button") as BlockOf<"button">), label, channel });
  return {
    ...box,
    name: "Contatos",
    style: { display: "flex", direction: "row", wrap: "wrap", gap: "12px", padding: { top: "24px", right: "20px", bottom: "24px", left: "20px" } },
    children: [button("Chamar no WhatsApp", "whatsapp"), button("Enviar e-mail", "email"), button("Abrir o Instagram", "instagram")],
  };
};

export const PAGE_MODELS: readonly PageModel[] = [
  {
    key: "about",
    label: "Sobre mim",
    hint: "Apresentação, imagem com texto e chamada para contato",
    title: "Sobre mim",
    build: () => [section("about"), section("template-image-text"), callToContact()],
  },
  {
    key: "services",
    label: "Serviços e planos",
    hint: "Seus serviços, três planos e chamada para contato",
    title: "Serviços",
    build: () => [section("services"), section("template-plans"), callToContact()],
  },
  {
    key: "faq",
    label: "Perguntas frequentes",
    hint: "Perguntas e respostas curtas e chamada para contato",
    title: "Perguntas frequentes",
    build: () => [section("faq"), callToContact()],
  },
  {
    key: "testimonials",
    label: "Depoimentos",
    hint: "Três depoimentos (cada um precisa da autorização de quem o deu)",
    title: "Depoimentos",
    build: () => [section("template-testimonials"), callToContact()],
  },
  {
    key: "contact",
    label: "Contato",
    hint: "Os seus contatos, um botão para cada",
    title: "Contato",
    build: () => [{ ...(emptyBlock("text") as BlockOf<"text">), heading: "Contato" }, channels()],
  },
];

export const pageModel = (key: string): PageModel | undefined => PAGE_MODELS.find((entry) => entry.key === key);

/** What a site starts with, by the model the person chose when creating it. */
export const SITE_MODELS = ["single", "complete", "athlete", "trainer"] as const;
export type SiteModel = (typeof SITE_MODELS)[number];
export const SITE_MODEL_LABEL: Record<SiteModel, { label: string; hint: string }> = {
  single: { label: "Uma página só", hint: "Um destaque e uma chamada para contato, para você montar do seu jeito." },
  complete: { label: "Site completo", hint: "Início, Sobre mim, Serviços, Perguntas frequentes e Contato, com menu, para você escrever o que cada um diz." },
  athlete: {
    label: "Atleta e instrutor(a)",
    hint: "Título grande ao lado da sua foto, faixa de números, painéis sobre você, cartões e chamada final, em verde. Com Sobre mim, Serviços e Contato.",
  },
  trainer: {
    label: "Personal trainer",
    hint: "Sua foto à esquerda do título, faixa com suas áreas, cartões coloridos, imagem com texto e chamada final, em laranja. Com Sobre mim, Serviços, Perguntas frequentes e Contato.",
  },
};

/**
 * The sites made of the layouts of the library (the "layout" group of presets.ts): the sections of the home page in order, the pages that come with
 * it, and the look that suits them (an accent of the closed list and a wide page). The first section of the home gets the name of the site as its
 * big title, the way the hero of the complete site does; everything else is left empty, with no text and no picture invented.
 */
export const LAYOUT_SITES = {
  athlete: {
    theme: { accent: "green", width: "wide" },
    home: ["layout-split-hero", "layout-numbers", "layout-about-panels", "layout-cards", "layout-final-band"],
    pages: ["about", "services", "contact"],
  },
  trainer: {
    theme: { accent: "orange", width: "wide" },
    home: ["layout-split-hero-reverse", "layout-link-band", "layout-cards", "template-image-text", "layout-final-band"],
    pages: ["about", "services", "faq", "contact"],
  },
} as const;
