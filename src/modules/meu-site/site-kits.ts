import {
  SITE_SCHEMA_VERSION,
  emptyBlock,
  newBlockId,
  type BlockOf,
  type BoxNode,
  type BoxTag,
  type Illustration,
  type PageDef,
  type SiteContent,
  type SiteNode,
} from "./contracts";
import type { Style } from "./style";
import { DEFAULT_THEME, type Theme } from "./site-theme";

/**
 * The three complete sites of the Editor Guiado (the user's request of 02/11/2026: "modelos prontos de sites completos para o usuário selecionar e
 * editar"): Personal trainer, Estúdio / assessoria and Treino online / consultoria. Each has five pages (Início, Sobre, Serviços e planos,
 * Depoimentos, Contato), a look of its own and drawings in place of photos (illustrations.tsx), which the person replaces with photos of their own.
 *
 * What is written is neutral copy about how a service of the kind works, to be read and changed; nothing in it is a fact about the person. What only
 * the person can say (their story, their training and registration, the people of the team, the prices, the answers to the questions, testimonies)
 * starts empty: the node's name says what goes there, and an empty text is not on the public page. No numbers, results, credentials or testimonies.
 */
export const SITE_KITS = ["personal", "studio", "online"] as const;
export type SiteKit = (typeof SITE_KITS)[number];

// ---- the bricks ----

const SIDES = (top: string, right: string, bottom = top, left = right) => ({ top, right, bottom, left });
const box = (name: string, tag: BoxTag, style: Style, children: SiteNode[], sizes: { tablet?: Style; mobile?: Style } = {}): BoxNode => ({
  ...(emptyBlock("box") as BoxNode),
  name,
  tag,
  style,
  children,
  ...(sizes.tablet ? { styleTablet: sizes.tablet } : null),
  ...(sizes.mobile ? { styleMobile: sizes.mobile } : null),
});
const heading = (text: string, level: 2 | 3 = 2, style?: Style, name?: string, mobile?: Style): SiteNode =>
  ({ ...emptyBlock("heading"), level, text, ...(style ? { style } : null), ...(name ? { name } : null), ...(mobile ? { styleMobile: mobile } : null) }) as SiteNode;
const paragraph = (text: string, style?: Style, name?: string): SiteNode =>
  ({ ...emptyBlock("paragraph"), text, ...(style ? { style } : null), ...(name ? { name } : null) }) as SiteNode;
const whatsapp = (label: string, style?: Style): SiteNode => ({ ...emptyBlock("button"), label, channel: "whatsapp", ...(style ? { style } : null) }) as SiteNode;
const toPage = (kind: "button" | "link", label: string, page: string, style?: Style): SiteNode => ({ ...emptyBlock(kind), label, page, ...(style ? { style } : null) }) as SiteNode;
const drawing = (illustration: Illustration, ratio: "4:5" | "4:3" | "16:9" | "3:4", style: Style = {}, size: "full" | "medium" = "full"): SiteNode =>
  ({ ...emptyBlock("image"), size, ratio, illustration, style: { radius: "24px", ...style } }) as SiteNode;
const quote = (): SiteNode => ({ ...(emptyBlock("quote") as BlockOf<"quote">), name: "Depoimento autorizado" });

const KICKER: Style = { fontSize: "13px", fontWeight: 700, letterSpacing: "2px", textTransform: "uppercase", color: "accent" };
const LEAD: Style = { fontSize: "18px", color: "muted" };
const SECTION = SIDES("56px", "0px");
const CARD: Style = { display: "flex", direction: "column", gap: "10px", padding: SIDES("24px", "24px"), radius: "18px", borderWidth: "1px", borderStyle: "solid", borderColor: "line", background: "bg" };
const GRID3: Style = { display: "grid", columns: 3, gap: "20px" };
const GRID3_SIZES = { tablet: { columns: 2 } as Style, mobile: { columns: 1 } as Style };
const row = (style: Style = {}) => ({ display: "flex", direction: "row", wrap: "wrap", gap: "12px", align: "center", ...style }) as Style;
const stack = (style: Style = {}) => ({ display: "flex", direction: "column", gap: "14px", ...style }) as Style;

/** A title for a section, centered or not, with an optional line above it. */
const sectionTitle = (title: string, kicker = "", align: "left" | "center" = "left"): SiteNode[] => [
  ...(kicker ? [paragraph(kicker, { ...KICKER, textAlign: align })] : []),
  heading(title, 2, { fontSize: "34px", fontWeight: 800, lineHeight: 1.1, textAlign: align }, undefined, { fontSize: "28px" }),
];
/** Three cards of a title and a text (how the service works, what is offered). */
const threeCards = (name: string, cards: Array<[string, string]>, cardStyle: Style = CARD): SiteNode =>
  box(name, "div", GRID3, cards.map(([title, text]) => box("Cartão", "article", cardStyle, [heading(title, 3, { fontSize: "20px", fontWeight: 700 }), paragraph(text)])), GRID3_SIZES);
/** Three plans: a name and a line written, what is included and the value left for the person. */
const plans = (names: Array<[string, string]>): SiteNode =>
  box(
    "Planos",
    "div",
    GRID3,
    names.map(([title, line]) =>
      box("Plano", "article", { ...CARD, shadow: "sm" }, [
        heading(title, 3, { fontSize: "22px", fontWeight: 800 }),
        paragraph(line, { color: "muted" }),
        paragraph("", undefined, "O que inclui e o valor (opcional)"),
        whatsapp("Quero este plano"),
      ]),
    ),
    GRID3_SIZES,
  );
/** A closing band in the brand's color. */
const band = (title: string, text: string, button: string): SiteNode =>
  box(
    "Chamada final",
    "section",
    { display: "grid", columns: 2, gap: "28px", align: "center", padding: SIDES("40px", "40px"), background: "solid", color: "on", radius: "24px", margin: SIDES("40px", "0px") },
    [heading(title, 2, { fontSize: "36px", fontWeight: 800, lineHeight: 1.1 }, undefined, { fontSize: "28px" }), box("Texto e botão", "div", stack({ align: "start" }), [paragraph(text), whatsapp(button, { background: "black", color: "white" })])],
    { mobile: { columns: 1, gap: "16px", padding: SIDES("28px", "20px") } },
  );
/** A picture beside a title and a text (a link under it), picture first or second; one over the other on the phone. */
const pictureAndText = (illustration: Illustration, ratio: "4:5" | "4:3" | "3:4", children: SiteNode[], pictureFirst = true): SiteNode => {
  const text = box("Texto", "div", stack({ justify: "center", align: "start" }), children);
  const picture = drawing(illustration, ratio);
  return box("Imagem e texto", "section", { display: "grid", columns: 2, gap: "40px", align: "center", padding: SECTION }, pictureFirst ? [picture, text] : [text, picture], {
    mobile: { columns: 1, gap: "20px", padding: SIDES("32px", "0px") },
  });
};
const intro = (title: string, text: string, kicker = ""): SiteNode => box("Abertura da página", "section", stack({ padding: SIDES("48px", "0px", "8px") }), [...sectionTitle(title, kicker), paragraph(text, LEAD)]);
const testimonies = (title: string, text: string, button: string, close: [string, string]): SiteNode[] => [
  intro(title, text),
  box("Depoimentos", "section", { ...GRID3, padding: SIDES("24px", "0px") }, [quote(), quote(), quote()], GRID3_SIZES),
  band(close[0], close[1], button),
];
const contactPage = (text: string): SiteNode[] => [
  intro("Contato", text),
  box("Canais", "section", row({ padding: SIDES("8px", "0px", "24px") }), [
    whatsapp("Chamar no WhatsApp"),
    { ...emptyBlock("button"), label: "Enviar e-mail", channel: "email" } as SiteNode,
    { ...emptyBlock("button"), label: "Abrir o Instagram", channel: "instagram" } as SiteNode,
  ]),
  { ...(emptyBlock("contactForm") as BlockOf<"contactForm">), heading: "Envie uma mensagem", text: "", buttonLabel: "Enviar mensagem" },
];

// ---- the pages ----

interface Ids {
  about: string;
  services: string;
  testimonies: string;
  contact: string;
}
const page = (id: string, slug: string, title: string, blocks: SiteNode[]): PageDef => ({ id, slug, title, description: "", blocks });
const pagesOf = (ids: Ids, about: SiteNode[], services: SiteNode[], testimoniesPage: SiteNode[], contact: SiteNode[]): PageDef[] => [
  page(ids.about, "sobre", "Sobre", about),
  page(ids.services, "servicos-e-planos", "Serviços e planos", services),
  page(ids.testimonies, "depoimentos", "Depoimentos", testimoniesPage),
  page(ids.contact, "contato", "Contato", contact),
];

const BIG: Style = { fontSize: "60px", fontWeight: 800, lineHeight: 1, letterSpacing: "-1px" };
const BIG_MOBILE: Style = { fontSize: "40px" };

function personal(title: string, ids: Ids): Pick<SiteContent, "theme" | "blocks" | "pages"> {
  const theme: Theme = { accent: "orange", mode: "light", width: "wide", font: "sans" };
  const hero = box(
    "Destaque",
    "section",
    { display: "grid", columns: 2, gap: "48px", align: "center", padding: SIDES("56px", "0px") },
    [
      box("Texto do destaque", "div", stack({ gap: "18px", align: "start" }), [
        paragraph("Personal trainer", KICKER),
        heading(title, 2, { ...BIG, fontFamily: "display", textTransform: "uppercase" }, undefined, BIG_MOBILE),
        paragraph("Treino planejado para o seu objetivo, no seu ritmo, com acompanhamento de perto.", LEAD),
        box("Botões", "div", row(), [whatsapp("Agendar uma conversa"), toPage("link", "Conhecer os planos", ids.services)]),
      ]),
      drawing("pulse", "4:5"),
    ],
    { mobile: { columns: 1, gap: "24px", padding: SIDES("32px", "0px") } },
  );
  const how = box("Como funciona", "section", stack({ gap: "24px", padding: SECTION }), [
    ...sectionTitle("Como funciona o acompanhamento", "Passo a passo"),
    threeCards("Etapas", [
      ["Conversa inicial", "Você conta sua rotina, seu histórico e o que quer alcançar."],
      ["Plano sob medida", "Os treinos são organizados para o seu objetivo e para o tempo que você tem."],
      ["Acompanhamento", "Ajustes ao longo do caminho, com atenção à técnica e à sua evolução."],
    ]),
  ]);
  const about = pictureAndText("weights", "4:3", [...sectionTitle("Sobre mim", "Quem vai te acompanhar"), paragraph("", undefined, "Um resumo da sua história"), toPage("link", "Saiba mais", ids.about)]);
  return {
    theme,
    blocks: [hero, how, about, band("Vamos começar?", "Mande uma mensagem e conte o que você procura.", "Chamar no WhatsApp")],
    pages: pagesOf(
      ids,
      [
        pictureAndText("rings", "4:5", [...sectionTitle("Sobre mim", "Personal trainer"), paragraph("", LEAD, "Sua história e o que te move")]),
        box("Formação", "section", stack({ padding: SIDES("24px", "0px") }), [heading("Formação e experiência", 2, { fontSize: "28px", fontWeight: 800 }), paragraph("", undefined, "Formação e registro (opcional)")]),
        band("Quer treinar comigo?", "Conte o seu objetivo e vamos montar o seu plano.", "Fale comigo"),
      ],
      [
        intro("Serviços e planos", "Escolha o formato que combina com a sua rotina. Valores e condições você confirma comigo."),
        box("Lista de planos", "section", stack({ padding: SIDES("24px", "0px") }), [
          plans([
            ["Presencial", "Treinos acompanhados no local combinado."],
            ["Online", "Treino planejado e acompanhamento a distância."],
            ["Avaliação", "Uma conversa e uma avaliação para começar com segurança."],
          ]),
        ]),
        band("Ficou com alguma dúvida?", "Mande sua pergunta, a resposta vem por mensagem.", "Chamar no WhatsApp"),
      ],
      testimonies("Depoimentos", "O que dizem as pessoas que treinam comigo.", "Fale comigo", ["Quer treinar comigo?", "Comece com uma conversa."]),
      contactPage("Escolha o canal que preferir para falar comigo."),
    ),
  };
}

function studio(title: string, ids: Ids): Pick<SiteContent, "theme" | "blocks" | "pages"> {
  const theme: Theme = { accent: "purple", mode: "dark", width: "wide", font: "serif" };
  const hero = box("Destaque", "section", stack({ gap: "28px", align: "center", padding: SIDES("48px", "0px") }), [
    box("Texto do destaque", "div", stack({ gap: "16px", align: "center", maxWidth: "760px" }), [
      paragraph("Estúdio de treinamento", { ...KICKER, textAlign: "center" }),
      heading(title, 2, { ...BIG, textAlign: "center" }, undefined, BIG_MOBILE),
      paragraph("Um espaço para treinar com orientação, em grupo ou individualmente.", { ...LEAD, textAlign: "center" }),
      box("Botões", "div", row({ justify: "center" }), [whatsapp("Agendar uma visita"), toPage("link", "Ver modalidades e planos", ids.services)]),
    ]),
    drawing("studio", "16:9", { width: "100%" }),
  ]);
  const modalities = box("Modalidades", "section", stack({ gap: "24px", padding: SECTION }), [
    ...sectionTitle("Modalidades", "O que você encontra aqui", "center"),
    threeCards(
      "Cartões de modalidades",
      [
        ["Treino individual", "Atenção total de quem acompanha, do começo ao fim do treino."],
        ["Treino em grupo", "Turmas pequenas, com orientação para cada pessoa."],
        ["Assessoria", "Planejamento e acompanhamento para quem treina por conta própria."],
      ],
      { ...CARD, background: "soft", borderColor: "softLine" },
    ),
  ]);
  const structure = box(
    "Nossa estrutura",
    "section",
    { display: "grid", columns: 3, gap: "16px", align: "stretch", padding: SECTION },
    [
      drawing("grid", "3:4"),
      box("Texto", "div", stack({ justify: "center", align: "start", padding: SIDES("28px", "24px"), background: "soft", radius: "24px" }), [
        ...sectionTitle("Nossa estrutura"),
        paragraph("Um ambiente pensado para treinar com conforto e com segurança."),
        paragraph("", undefined, "O espaço e como são as aulas"),
        toPage("link", "Conhecer o estúdio", ids.about),
      ]),
      drawing("rings", "3:4"),
    ],
    { mobile: { columns: 1, padding: SIDES("32px", "0px") } },
  );
  const teamMember = () => box("Pessoa da equipe", "article", { ...CARD, background: "soft", borderColor: "softLine" }, [heading("", 3, { fontSize: "20px", fontWeight: 700 }, "Nome de quem atende"), paragraph("", undefined, "Formação e registro (opcional)")]);
  const faq = { ...(emptyBlock("faq") as BlockOf<"faq">), heading: "Perguntas frequentes", items: [
    { question: "Como faço para começar?", answer: "" },
    { question: "Quais são os horários?", answer: "" },
    { question: "Quais são as formas de pagamento?", answer: "" },
  ] } as SiteNode;
  return {
    theme,
    blocks: [hero, modalities, structure, band("Venha conhecer o estúdio", "Agende uma visita e conheça o espaço e a equipe.", "Agendar uma visita")],
    pages: pagesOf(
      ids,
      [
        pictureAndText("studio", "4:3", [...sectionTitle("Sobre o estúdio"), paragraph("", LEAD, "A história e a proposta do estúdio")]),
        box("Equipe", "section", stack({ gap: "24px", padding: SECTION }), [...sectionTitle("Equipe", "Quem vai te acompanhar"), box("Pessoas", "div", GRID3, [teamMember(), teamMember(), teamMember()], GRID3_SIZES)]),
        band("Fale com a equipe", "Tire suas dúvidas e combine uma visita.", "Fale com a equipe"),
      ],
      [
        intro("Serviços e planos", "Formatos para diferentes rotinas e objetivos. Valores e horários você confirma com a equipe."),
        box("Lista de planos", "section", stack({ padding: SIDES("24px", "0px") }), [
          plans([
            ["Aula avulsa", "Para conhecer o estúdio e as modalidades."],
            ["Plano mensal", "Treinos regulares, nas modalidades que você escolher."],
            ["Acompanhamento individual", "Treino planejado e acompanhado só para você."],
          ]),
        ]),
        faq,
        band("Quer conhecer o estúdio?", "Agende uma visita.", "Fale com a equipe"),
      ],
      testimonies("Depoimentos", "O que dizem as pessoas que treinam no estúdio.", "Fale com a equipe", ["Quer conhecer o estúdio?", "Agende uma visita."]),
      contactPage("Escolha o canal que preferir para falar com a equipe."),
    ),
  };
}

function online(title: string, ids: Ids): Pick<SiteContent, "theme" | "blocks" | "pages"> {
  const theme: Theme = { accent: "blue", mode: "light", width: "wide", font: "sans" };
  const hero = box(
    "Destaque",
    "section",
    { display: "grid", columns: 2, gap: "48px", align: "center", padding: SIDES("56px", "0px") },
    [
      drawing("screen", "4:3"),
      box("Texto do destaque", "div", stack({ gap: "18px", align: "start" }), [
        paragraph("Consultoria online", KICKER),
        heading(title, 2, BIG, undefined, BIG_MOBILE),
        paragraph("Treino planejado e acompanhamento a distância, de onde você estiver.", LEAD),
        box("Botões", "div", row(), [whatsapp("Quero começar"), toPage("link", "Ver os planos", ids.services)]),
      ]),
    ],
    { mobile: { columns: 1, gap: "24px", padding: SIDES("32px", "0px") } },
  );
  const how = box("Como funciona", "section", stack({ gap: "24px", padding: SECTION }), [
    ...sectionTitle("Como funciona", "Do primeiro contato ao treino", "center"),
    threeCards("Etapas", [
      ["Conversa inicial", "Você conta seus objetivos, sua rotina e onde vai treinar."],
      ["Seu plano de treino", "Você recebe o treino organizado, com as orientações de cada exercício."],
      ["Ajustes e contato", "Os treinos são ajustados conforme você avança, com um canal para tirar dúvidas."],
    ]),
  ]);
  const plansTeaser = pictureAndText("path", "4:3", [...sectionTitle("Planos", "Para cada rotina"), paragraph("Formatos para diferentes rotinas e objetivos.", LEAD), toPage("button", "Ver os planos", ids.services)], false);
  const faq = { ...(emptyBlock("faq") as BlockOf<"faq">), heading: "Perguntas frequentes", items: [
    { question: "Como eu começo?", answer: "" },
    { question: "Preciso treinar em academia?", answer: "" },
    { question: "Como tiro dúvidas durante o plano?", answer: "" },
  ] } as SiteNode;
  return {
    theme,
    blocks: [hero, how, plansTeaser, faq, band("Pronto para começar?", "Mande uma mensagem e conte o seu objetivo.", "Chamar no WhatsApp")],
    pages: pagesOf(
      ids,
      [
        pictureAndText("screen", "4:3", [...sectionTitle("Sobre mim", "Quem vai te acompanhar"), paragraph("", LEAD, "Sua história e como trabalha online")]),
        box("Formação", "section", stack({ padding: SIDES("24px", "0px") }), [heading("Formação e experiência", 2, { fontSize: "28px", fontWeight: 800 }), paragraph("", undefined, "Formação e registro (opcional)")]),
        band("Quer começar?", "Conte o seu objetivo e vamos montar o seu plano.", "Quero começar"),
      ],
      [
        intro("Serviços e planos", "Escolha o formato que combina com você. Valores e condições você confirma comigo."),
        box("Lista de planos", "section", stack({ padding: SIDES("24px", "0px") }), [
          plans([
            ["Mensal", "Para começar e conhecer o acompanhamento."],
            ["Trimestral", "Para construir uma rotina com mais tempo de ajustes."],
            ["Semestral", "Para quem quer acompanhamento de longo prazo."],
          ]),
        ]),
        box("O que está incluído", "section", stack({ padding: SIDES("24px", "0px") }), [heading("O que está incluído", 2, { fontSize: "28px", fontWeight: 800 }), paragraph("", undefined, "Treino, ajustes, canal de contato…")]),
        band("Ficou com alguma dúvida?", "Mande sua pergunta, a resposta vem por mensagem.", "Chamar no WhatsApp"),
      ],
      testimonies("Depoimentos", "O que dizem as pessoas que treinam comigo a distância.", "Quero começar", ["Quer começar?", "Mande uma mensagem."]),
      contactPage("Escolha o canal que preferir para falar comigo."),
    ),
  };
}

const BUILD: Record<SiteKit, (title: string, ids: Ids) => Pick<SiteContent, "theme" | "blocks" | "pages">> = { personal, studio, online };

/** A complete site of a kit, with the name of the site as its first title. Every call has identifiers of its own. */
export function kitContent(kit: SiteKit, title: string): SiteContent {
  const ids: Ids = { about: newBlockId(), services: newBlockId(), testimonies: newBlockId(), contact: newBlockId() };
  const built = BUILD[kit](title, ids);
  return {
    schemaVersion: SITE_SCHEMA_VERSION,
    title,
    description: "",
    contact: { whatsapp: "", email: "", instagram: "" },
    ...built,
    theme: { ...DEFAULT_THEME, ...built.theme },
  };
}

// ---- sections to add in the Editor Guiado (0.64) ----

/** A section title still to be written: the node's name says what goes there. */
const blankTitle = (name = "Título da seção"): SiteNode => heading("", 2, { fontSize: "34px", fontWeight: 800, lineHeight: 1.1 }, name, { fontSize: "28px" });
const blankCard = (): SiteNode =>
  box("Cartão", "article", CARD, [heading("", 3, { fontSize: "20px", fontWeight: 700 }, "Título do cartão"), paragraph("", undefined, "Texto do cartão")]);
const blankPlan = (): SiteNode =>
  box("Plano", "article", { ...CARD, shadow: "sm" }, [
    heading("", 3, { fontSize: "22px", fontWeight: 800 }, "Nome do plano"),
    paragraph("", { color: "muted" }, "Para quem é"),
    paragraph("", undefined, "O que inclui e o valor (opcional)"),
    whatsapp("Quero este plano"),
  ]);

export interface GuidedSectionItem {
  key: string;
  label: string;
  hint: string;
  create: () => SiteNode;
}

/**
 * The short list of sections the Editor Guiado adds to a page, built from the same bricks as the three models, so they take the site's look. Every
 * text starts empty (the name of each part says what goes there) and an empty part is not on the public page: nothing is written for the person.
 * The buttons say what they do and go to the site's contacts.
 */
export const GUIDED_SECTIONS: readonly GuidedSectionItem[] = [
  {
    key: "texto",
    label: "Título e texto",
    hint: "Um título e um parágrafo",
    create: () => box("Título e texto", "section", stack({ padding: SECTION }), [blankTitle(), paragraph("", LEAD, "Texto da seção")]),
  },
  {
    key: "imagem-texto",
    label: "Imagem e texto",
    hint: "Uma imagem ao lado do título e do texto",
    create: () => pictureAndText("weights", "4:3", [blankTitle(), paragraph("", LEAD, "Texto ao lado da imagem")]),
  },
  {
    key: "cartoes",
    label: "Três cartões",
    hint: "Etapas, modalidades ou diferenciais",
    create: () => box("Três cartões", "section", stack({ gap: "24px", padding: SECTION }), [blankTitle(), box("Cartões", "div", GRID3, [blankCard(), blankCard(), blankCard()], GRID3_SIZES)]),
  },
  {
    key: "planos",
    label: "Planos",
    hint: "Três planos com botão",
    create: () => box("Planos", "section", stack({ gap: "24px", padding: SECTION }), [blankTitle(), box("Lista de planos", "div", GRID3, [blankPlan(), blankPlan(), blankPlan()], GRID3_SIZES)]),
  },
  {
    key: "perguntas",
    label: "Perguntas frequentes",
    hint: "Perguntas e respostas curtas",
    create: () =>
      ({
        ...(emptyBlock("faq") as BlockOf<"faq">),
        name: "Perguntas frequentes",
        heading: "",
        items: [
          { question: "", answer: "" },
          { question: "", answer: "" },
          { question: "", answer: "" },
        ],
      }) as SiteNode,
  },
  {
    key: "depoimentos",
    label: "Depoimentos",
    hint: "Três depoimentos, só com autorização",
    create: () => box("Depoimentos", "section", stack({ gap: "24px", padding: SECTION }), [blankTitle(), box("Lista de depoimentos", "div", GRID3, [quote(), quote(), quote()], GRID3_SIZES)]),
  },
  {
    key: "chamada",
    label: "Chamada final",
    hint: "Uma faixa na cor do site com botão",
    create: () => band("", "", "Chamar no WhatsApp"),
  },
  {
    key: "contato",
    label: "Canais de contato",
    hint: "WhatsApp, e-mail e Instagram do site",
    create: () =>
      box("Canais de contato", "section", stack({ padding: SECTION }), [
        blankTitle(),
        box("Canais", "div", row(), [
          whatsapp("Chamar no WhatsApp"),
          { ...emptyBlock("button"), label: "Enviar e-mail", channel: "email" } as SiteNode,
          { ...emptyBlock("button"), label: "Abrir o Instagram", channel: "instagram" } as SiteNode,
        ]),
      ]),
  },
  {
    key: "formulario",
    label: "Formulário de contato",
    hint: "Nome, contato e mensagem",
    create: () => ({ ...(emptyBlock("contactForm") as BlockOf<"contactForm">), heading: "Envie uma mensagem", text: "", buttonLabel: "Enviar mensagem" }) as SiteNode,
  },
];
