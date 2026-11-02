/**
 * FitNova — Wellness (Figma "Templates de Sites — CMS V1", page 02, frames `3:415` desktop 1440 and `3:632` mobile 390). A light editorial
 * look: white and warm off-white bands, flat white cards, a deep green-black ink, one orange accent (eyebrows, icons, numbers and an orange
 * progress panel), a low-key runner photo in the hero and the green WhatsApp pill on every commercial action.
 * The articles section of the Figma (`3:593`) is left out (the user's decision of 02/11/2026: no blog yet).
 */
import { SITE_SCHEMA_VERSION, emptyBlock, type BlockOf, type SiteContent, type SiteNode } from "../contracts";
import { DEFAULT_THEME } from "../site-theme";
import type { Style } from "../style";
import { box, demoBackground, faq, heading, paragraph, photo, say, sides, textLink, whatsappButton, type ModelMode, whatsappCtaOf } from "./bricks";
import type { SiteModelDef } from "./types";

const PALETTE = { primary: "#f9743a", background: "#f5f5f3", surface: "#ffffff", ink: "#1d2225", muted: "#6f7778", dark: "#121c1e" };

// ---- the rhythm of the page (desktop 1440 / phone 390) ----
const SECTION_PAD = sides("90px", "80px");
const SECTION_PAD_MOBILE = sides("50px", "22px");
const band = (name: string, background: Style["background"], children: SiteNode[], extra: Style = {}, mobile: Style = {}, gap = "25px"): SiteNode =>
  box(name, "section", { background, padding: SECTION_PAD, ...extra }, [box("Conteúdo", "div", { display: "flex", direction: "column", gap, maxWidth: "1280px", margin: sides("0px", "auto") }, children)], {
    tablet: { padding: sides("70px", "40px") },
    mobile: { padding: SECTION_PAD_MOBILE, ...mobile },
  });
const eyebrow = (text: string, color: Style["color"] = "accent", name?: string) =>
  paragraph(text, { fontSize: "12px", fontWeight: 700, lineHeight: 1.2, color, margin: sides("0px", "0px") }, undefined, name);
const h2 = (text: string, size = 46, mobile = 32, color: Style["color"] = "ink", name?: string) =>
  heading(text, 2, { fontSize: `${size}px`, fontWeight: 700, lineHeight: 1.2, color, margin: sides("0px", "0px") }, { mobile: { fontSize: `${mobile}px` } }, name);
const lead = (text: string, name?: string) =>
  paragraph(text, { fontSize: "18px", lineHeight: 1.2, color: "muted", maxWidth: "760px", margin: sides("0px", "0px") }, { mobile: { fontSize: "15px" } }, name);
const grid = (name: string, children: SiteNode[], gap = "18px", rowGap = gap): SiteNode =>
  box(name, "div", { display: "grid", columns: 3, gap, align: "stretch" }, children, { tablet: { columns: 2 }, mobile: { columns: 1, gap: rowGap } });
const card = (icon: string, title: string, body: string, background: Style["background"] = "surface"): SiteNode =>
  box("Cartão", "article", { display: "flex", direction: "column", gap: "12px", padding: sides("24px", "24px"), radius: "16px", background }, [
    paragraph(icon, { fontSize: "25px", fontWeight: 700, lineHeight: 1.2, color: "accent", margin: sides("0px", "0px") }, undefined, "Ícone"),
    heading(title, 3, { fontSize: "21px", fontWeight: 700, lineHeight: 1.2, color: "ink", margin: sides("0px", "0px") }),
    paragraph(body, { fontSize: "14px", lineHeight: 1.4, color: "muted", margin: sides("0px", "0px") }),
  ]);

function build(title: string, mode: ModelMode): SiteContent {
  // `3:426` (mobile `3:636`): the runner photo under a blue-black veil (22% on the computer, 44% on the phone), the text on the dark left half.
  const hero = box(
    "Destaque",
    "section",
    { ...demoBackground("fitnova-hero"), background: "dark", radius: "22px", overflow: "hidden" },
    [
      box(
        "Texto do destaque",
        "div",
        { display: "flex", direction: "column", gap: "20px", align: "start", minHeight: "610px", padding: sides("128px", "80px", "80px"), background: "#030b0f38" },
        [
          paragraph(`PERSONAL TRAINER • ${title.toUpperCase()}`.slice(0, 80), { fontSize: "13px", fontWeight: 700, color: "white", margin: sides("0px", "0px") }, { mobile: { fontSize: "11px" } }),
          heading("Transforme seu corpo. Cuide da sua mente.", 2, { fontSize: "65px", fontWeight: 700, lineHeight: 1.2, color: "white", maxWidth: "670px", margin: sides("0px", "0px") }, { mobile: { fontSize: "39px" } }),
          paragraph("Acompanhamento personalizado para construir uma vida mais ativa, saudável e equilibrada.", { fontSize: "19px", lineHeight: 1.2, color: "#f5f5f5", maxWidth: "580px", margin: sides("0px", "0px") }, { mobile: { fontSize: "15px" } }),
          whatsappButton(),
          paragraph("✓ Treino personalizado \u00a0 ✓ Acompanhamento de verdade", { fontSize: "13px", fontWeight: 600, color: "white", margin: sides("0px", "0px") }, { mobile: { fontSize: "11px" } }),
        ],
        { tablet: { padding: sides("96px", "40px", "64px") }, mobile: { minHeight: "560px", padding: sides("64px", "22px", "48px"), background: "#030b0f70" } },
      ),
    ],
    { mobile: { radius: "0px", bgPosition: "right" } },
  );

  // `3:435`
  const about = band("Proposta de valor", "bg", [
    eyebrow("SOBRE A METODOLOGIA"),
    h2("Seu progresso merece um plano de verdade."),
    lead("Treinamento inteligente, apoio humano e evolução contínua."),
    grid("Benefícios", [
      card("✓", "Planejamento individual", "Um método construído de acordo com sua rotina e seus objetivos."),
      card("✓", "Acompanhamento constante", "Um método construído de acordo com sua rotina e seus objetivos."),
      card("✓", "Evolução mensurável", "Um método construído de acordo com sua rotina e seus objetivos."),
    ]),
  ]);

  // `3:452`: the photo on the left, the text on the right, both from the top.
  const editorial = box("Apresentação com imagem", "section", { background: "surface", padding: SECTION_PAD }, [
    box(
      "Imagem e texto",
      "div",
      { display: "grid", columns: 2, gap: "36px", align: "start", maxWidth: "1280px", margin: sides("0px", "auto") },
      [
        photo("fitnova-foto", "16:9", { radius: "20px" }, { mobile: {} }, "Foto do método"),
        box("Texto", "div", { display: "flex", direction: "column", gap: "20px", align: "start" }, [
          eyebrow("MÉTODO E RESULTADOS"),
          h2("Uma estratégia sob medida para você.", 39, 29),
          paragraph(
            "Avaliação do seu momento atual, planejamento consistente e ajustes orientados por resultados. Uma experiência de treino pensada para a vida real.",
            { fontSize: "16px", lineHeight: 1.4, color: "muted", maxWidth: "460px", margin: sides("0px", "0px") },
          ),
          whatsappButton(),
        ]),
      ],
      { mobile: { columns: 1, gap: "25px" } },
    ),
  ], { tablet: { padding: sides("70px", "40px") }, mobile: { padding: SECTION_PAD_MOBILE } });

  // `3:461`: six cards in two rows, no lead.
  const services = band("Serviços e especialidades", "bg", [
    eyebrow("O QUE VOCÊ ENCONTRA"),
    h2("Programas pensados para sua evolução", 44, 31),
    grid(
      "Especialidades",
      [
        card("↗", "Treinamento individual", "Aulas, planos e orientações adaptados a diferentes objetivos e níveis."),
        card("✳", "Planejamento de treinos", "Aulas, planos e orientações adaptados a diferentes objetivos e níveis."),
        card("◎", "Orientação de hábitos", "Aulas, planos e orientações adaptados a diferentes objetivos e níveis."),
        card("✦", "Acompanhamento online", "Aulas, planos e orientações adaptados a diferentes objetivos e níveis."),
        card("↗", "Avaliação física", "Aulas, planos e orientações adaptados a diferentes objetivos e níveis."),
        card("◉", "Análise de evolução", "Aulas, planos e orientações adaptados a diferentes objetivos e níveis."),
      ],
      "27px",
      "25px",
    ),
  ]);

  // `3:490`: the steps' cards are white on white in the Figma (they read as columns); here they take the page's background, so they show.
  const process = band("Como funciona", "surface", [
    eyebrow("PASSO A PASSO"),
    h2("Da primeira conversa à sua evolução"),
    lead("Um processo simples, organizado e transparente para você começar."),
    grid(
      "Etapas",
      [
        card("01", "Conte seus objetivos", "Seu progresso é acompanhado e o planejamento pode evoluir com você.", "bg"),
        card("02", "Receba seu plano", "Seu progresso é acompanhado e o planejamento pode evoluir com você.", "bg"),
        card("03", "Treine e acompanhe", "Seu progresso é acompanhado e o planejamento pode evoluir com você.", "bg"),
      ],
      "18px",
      "25px",
    ),
  ]);

  // `3:507`: a narrower photo (470 of 1280) beside the biography.
  const professional = band("Apresentação do profissional", "bg", [
    eyebrow("QUEM ACOMPANHA VOCÊ"),
    h2("Conheça o profissional por trás do método"),
    lead("Formação, experiência e atenção aos detalhes em cada etapa."),
    box(
      "Foto e biografia",
      "div",
      { display: "flex", direction: "row", gap: "36px", align: "start" },
      [
        // The person's own photo: only the preview has a sample (a photo of someone else is never the professional's).
        photo(mode === "preview" ? "fitnova-foto" : undefined, "3:2", { radius: "20px", basis: "470px", shrink: 0 }, { tablet: { basis: "45%" }, mobile: { basis: "auto" } }, "Sua foto"),
        box("Biografia", "div", { display: "flex", direction: "column", gap: "14px", grow: 1, basis: "0px" }, [
          paragraph(say(mode, "SEU NOME AQUI"), { fontSize: "13px", fontWeight: 700, color: "accent", margin: sides("0px", "0px") }, undefined, "Seu nome"),
          heading(say(mode, "Personal trainer • Especialista em treinamento"), 3, { fontSize: "30px", fontWeight: 700, lineHeight: 1.2, color: "ink", maxWidth: "580px", margin: sides("0px", "0px") }, { mobile: { fontSize: "22px" } }, "Sua profissão e especialidade"),
          paragraph(
            say(mode, "Apresente aqui sua história, certificações, experiência e os diferenciais do seu atendimento. O CMS permite substituir todos estes campos."),
            { fontSize: "15px", lineHeight: 1.4, color: "muted", maxWidth: "600px", margin: sides("0px", "0px") },
            undefined,
            "Sua história e formação",
          ),
          paragraph(say(mode, "8+ anos de experiência \u00a0 \u00a0•\u00a0 \u00a0 Atendimento individual"), { fontSize: "15px", fontWeight: 600, color: "accent", margin: sides("0px", "0px") }, undefined, "Destaques (ex.: experiência)"),
        ], { mobile: { basis: "auto" } }),
      ],
      { mobile: { direction: "column", align: "stretch", gap: "25px" } },
    ),
  ]);

  // `11:23` (mobile `11:35`): a photo and the orange panel of what the professional follows (generic copy: no number, no claim).
  const progress = band(
    "Progresso e bem-estar",
    "surface",
    [
      eyebrow("PROGRESSO E BEM-ESTAR"),
      h2("Acompanhe a evolução da sua saúde.", 46, 31),
      box(
        "Imagem e painel",
        "div",
        { display: "grid", columns: 2, gap: "18px", align: "start" },
        [
          photo("fitnova-foto", "16:9", { radius: "18px" }, undefined, "Foto do progresso"),
          box("Painel", "div", { display: "flex", direction: "column", gap: "19px", padding: sides("25px", "25px"), radius: "18px", background: "solid" }, [
            eyebrow("UM PLANO FEITO PARA EVOLUIR", "on"),
            heading("Acompanhe seus resultados.", 3, { fontSize: "41px", fontWeight: 700, lineHeight: 1.2, color: "on", margin: sides("0px", "0px") }, { mobile: { fontSize: "30px" } }),
            paragraph("Seu personal pode avaliar progresso, rotina e constância para adaptar a experiência de treino.", { fontSize: "16px", lineHeight: 1.2, color: "on", margin: sides("0px", "0px") }),
            ...["ATIVIDADE \u00a0/\u00a0 Frequência planejada", "FORÇA \u00a0/\u00a0 Evolução personalizada", "ROTINA \u00a0/\u00a0 Acompanhamento contínuo"].map((line) =>
              paragraph(line, { fontSize: "14px", fontWeight: 700, lineHeight: 1.2, color: "on", margin: sides("0px", "0px") }, undefined, "Indicador"),
            ),
          ]),
        ],
        { mobile: { columns: 1, gap: "18px" } },
      ),
    ],
    {},
    { padding: sides("55px", "22px") },
    "22px",
  );

  // `3:518`
  const stat = (value: string, label: string) =>
    box("Indicador", "div", { display: "flex", direction: "column", gap: "10px" }, [
      paragraph(say(mode, value), { fontSize: "54px", fontWeight: 700, lineHeight: 1.2, color: "accent", margin: sides("0px", "0px") }, { mobile: { fontSize: "39px" } }, "Número (só se for real)"),
      paragraph(say(mode, label), { fontSize: "15px", fontWeight: 600, color: "ink", margin: sides("0px", "0px") }, undefined, "O que o número conta"),
    ]);
  const stats = box(
    "Números e conquistas",
    "section",
    { background: "#fafaf9", padding: sides("45px", "80px", "55px") },
    [box("Conteúdo", "div", { maxWidth: "1280px", margin: sides("0px", "auto") }, [grid("Métricas", [stat("+500", "alunos acompanhados"), stat("98%", "satisfação ilustrativa"), stat("8+", "anos de experiência")], "25px", "25px")])],
    { tablet: { padding: sides("45px", "40px", "55px") }, mobile: { padding: sides("45px", "22px", "55px") } },
  );

  // `3:529`
  const plan = (label: string, name: string, price: string, tagline: string, highlight = false): SiteNode =>
    box(
      "Plano",
      "article",
      { display: "flex", direction: "column", gap: "15px", align: "start", padding: sides("25px", "25px"), radius: "20px", background: highlight ? "dark" : "bg" },
      [
        paragraph(highlight ? say(mode, label) : label, { fontSize: "12px", fontWeight: 700, color: highlight ? "accentOnDark" : "muted", margin: sides("0px", "0px") }, undefined, highlight ? "Selo de destaque (opcional)" : undefined),
        heading(name, 3, { fontSize: "24px", fontWeight: 700, lineHeight: 1.2, color: highlight ? "onDark" : "ink", margin: sides("0px", "0px") }),
        paragraph(say(mode, price), { fontSize: "40px", fontWeight: 700, lineHeight: 1.2, color: highlight ? "onDark" : "ink", margin: sides("0px", "0px") }, undefined, "Valor (R$)"),
        paragraph(say(mode, "por mês"), { fontSize: "14px", color: highlight ? "onDarkMuted" : "muted", margin: sides("0px", "0px") }, undefined, "Periodicidade"),
        paragraph(say(mode, tagline), { fontSize: "15px", color: highlight ? "onDarkMuted" : "muted", margin: sides("0px", "0px") }, undefined, "Para quem é o plano"),
        box(
          "O que inclui",
          "div",
          { display: "flex", direction: "column", gap: "6px" },
          ["Treinos personalizados", "Evolução acompanhada", "Ajustes periódicos", "Suporte dedicado"].map((item) =>
            paragraph(say(mode, `✓ ${item}`), { fontSize: "14px", color: highlight ? "onDark" : "ink", margin: sides("0px", "0px") }, undefined, "O que inclui (item)"),
          ),
        ),
        whatsappButton(),
      ],
    );
  const pricing = band("Planos e investimento", "surface", [
    eyebrow("PLANOS"),
    h2("Escolha o acompanhamento ideal"),
    lead(mode === "preview" ? "Planos ilustrativos: preços e benefícios devem ser definidos pelo profissional." : "Escolha o formato que combina com a sua rotina."),
    grid(
      "Lista de planos",
      [
        plan("PLANO", "Start", "R$ 179", "Comece sua jornada"),
        plan("MAIS POPULAR", "Pro", "R$ 289", "Acompanhamento frequente", true),
        plan("PLANO", "Premium", "R$ 449", "Suporte completo"),
      ],
      "18px",
      "25px",
    ),
  ]);

  // `3:570`: a testimony is the quote block: it is published only once the person's authorization is confirmed (an empty one is not on the page).
  const testimonyNode = {
    ...(emptyBlock("quote") as BlockOf<"quote">),
    name: "Depoimento autorizado",
    eyebrow: say(mode, "★★★★★"),
    quote: say(mode, "Os treinos ficaram mais consistentes, a orientação foi clara e o acompanhamento fez toda a diferença."),
    author: say(mode, "Depoimento de demonstração • não publicar como prova social real"),
    authorized: false,
    style: { background: "surface", radius: "18px", padding: sides("30px", "30px"), fontSize: "30px", fontWeight: 600, lineHeight: 1.2, color: "ink", margin: sides("0px", "0px") },
    styleMobile: { fontSize: "22px" },
  } as SiteNode;
  const testimonials = band("Histórias e resultados", "bg", [
    eyebrow(say(mode, "RESULTADOS"), "accent", "Rótulo dos depoimentos"),
    h2(say(mode, "Histórias reais. Evoluções possíveis."), 46, 32, "ink", "Título dos depoimentos"),
    lead(mode === "preview" ? "Use depoimentos consentidos, dados comprováveis e imagens autorizadas." : ""),
    testimonyNode,
  ]);

  // `3:578`: four questions, 480 wide, no answer written (the person writes them).
  const questions = band("Perguntas frequentes", "surface", [
    faq(
      "DÚVIDAS",
      "Perguntas frequentes",
      ["Como funciona o acompanhamento?", "Preciso treinar em uma academia?", "Os planos são personalizados?", "Como acompanho meus resultados?"],
      [],
      { padding: sides("0px", "0px"), gap: "25px", maxWidth: "480px" },
    ),
  ]);

  // `3:612`
  const contactForm = {
    ...(emptyBlock("contactForm") as BlockOf<"contactForm">),
    name: "Formulário de contato",
    eyebrow: "",
    heading: "",
    text: "",
    buttonLabel: "Enviar mensagem",
    style: { background: "surface", radius: "15px", padding: sides("24px", "24px"), maxWidth: "680px", margin: sides("0px", "0px") },
  } as SiteNode;
  const contact = band("Contato e captura", "bg", [
    eyebrow("ENTRE EM CONTATO"),
    h2("Vamos construir seu próximo resultado?"),
    lead(say(mode, "Um formulário simples para iniciar uma conversa com o personal trainer."), "Texto do contato"),
    contactForm,
  ]);

  // `3:627`
  const footer = box(
    "Rodapé",
    "footer",
    { display: "flex", direction: "column", gap: "25px", align: "start", background: "dark", padding: sides("55px", "80px") },
    [
      paragraph(title.toUpperCase().slice(0, 80), { fontSize: "38px", fontWeight: 700, lineHeight: 1.2, color: "onDark", margin: sides("0px", "0px") }, { mobile: { fontSize: "26px" } }, "Nome do site"),
      paragraph("Treinos e acompanhamento pensados para a sua evolução.", { fontSize: "16px", color: "onDarkMuted", margin: sides("0px", "0px") }),
      box("Links", "div", { display: "flex", direction: "row", wrap: "wrap", gap: "28px" }, [
        textLink("Programas", { fontSize: "14px", color: "onDark", textDecoration: "none" }, { anchor: services.id }),
        textLink("Sobre", { fontSize: "14px", color: "onDark", textDecoration: "none" }, { anchor: about.id }),
        textLink("Resultados", { fontSize: "14px", color: "onDark", textDecoration: "none" }, { anchor: testimonials.id }),
        textLink("Contato", { fontSize: "14px", color: "onDark", textDecoration: "none" }, { anchor: contact.id }),
      ]),
      box("Contatos", "div", { display: "flex", direction: "row", wrap: "wrap", gap: "20px" }, [
        textLink("Instagram", { fontSize: "12px", color: "onDarkMuted" }, { channel: "instagram" }),
        textLink("WhatsApp", { fontSize: "12px", color: "onDarkMuted" }, { channel: "whatsapp" }),
        textLink("E-mail", { fontSize: "12px", color: "onDarkMuted" }, { channel: "email" }),
      ]),
    ],
    { tablet: { padding: sides("55px", "40px") }, mobile: { padding: sides("55px", "22px") } },
  );

  return {
    schemaVersion: SITE_SCHEMA_VERSION,
    title,
    description: "",
    contact: { whatsapp: "", email: "", instagram: "" },
    theme: { ...DEFAULT_THEME, accent: "orange", mode: "light", width: "full", font: "inter", palette: PALETTE },
    blocks: [hero, about, editorial, services, process, professional, progress, stats, pricing, testimonials, questions, contact, footer],
    menu: [
      { label: "Sobre", anchor: about.id },
      { label: "Programas", anchor: services.id },
      { label: "Resultados", anchor: testimonials.id },
      { label: "Contato", anchor: contact.id },
    ],
    headerCta: { label: "Falar no WhatsApp" },
    whatsappCta: whatsappCtaOf(),
  };
}

export const FITNOVA: SiteModelDef = {
  key: "fitnova",
  label: "Bem-estar (claro e laranja)",
  hint: "Foto escura no topo, cartões claros de benefícios e programas, painel laranja de progresso, planos e perguntas frequentes. Branco, cinza e laranja.",
  palette: PALETTE,
  build,
};
