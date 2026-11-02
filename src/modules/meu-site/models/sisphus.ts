/**
 * Sisphus — Premium (Figma "Templates de Sites — CMS V1", page 03, frames `3:834` desktop 1440 and `3:1028` mobile 390). Warm off-white and
 * white bands with two near-black ones (the programs and the footer), a hot orange accent, a dark low-key photo in the hero, flat cards with no
 * border or shadow, everything left-aligned on a 1280 column, and the green WhatsApp pill on every commercial action.
 * The template has no articles section (and the models have no blog for now: the user's decision of 02/11/2026).
 */
import { SITE_SCHEMA_VERSION, emptyBlock, type BlockOf, type SiteContent, type SiteNode } from "../contracts";
import { DEFAULT_THEME } from "../site-theme";
import type { Style } from "../style";
import { box, demoBackground, faq, heading, paragraph, photo, say, sides, textLink, whatsappButton, type ModelMode, whatsappCtaOf } from "./bricks";
import { column } from "./layout";
import type { SiteModelDef } from "./types";

const PALETTE = { primary: "#fc5e21", background: "#f8f8f6", surface: "#ffffff", ink: "#171717", muted: "#626262", dark: "#121212" };

// ---- the rhythm of the page (desktop 1440 / phone 390) ----
const SECTION_PAD = sides("90px", "80px");
const SECTION_PAD_MOBILE = sides("50px", "22px");
const ZERO = sides("0px", "0px");
const band = (name: string, background: Style["background"], children: SiteNode[], extra: Style = {}, mobile: Style = {}, gap = "25px"): SiteNode =>
  box(name, "section", { background, padding: SECTION_PAD, ...extra }, [box("Conteúdo", "div", { display: "flex", direction: "column", gap, maxWidth: "1280px", margin: sides("0px", "auto") }, children)], {
    tablet: { padding: sides("70px", "40px") },
    mobile: { padding: SECTION_PAD_MOBILE, ...mobile },
  });
/**
 * Two parts side by side in the Figma's own proportions (`grow` of each) on a computer, one above the other on a tablet and a phone (0.70: on a
 * 577 px tablet the text's 320 px left the photo a thumbnail). Each part says `basis: "auto"` on the tablet (`STACKED`).
 */
const split = (name: string, first: SiteNode, second: SiteNode, gap: string): SiteNode =>
  box(name, "div", { display: "flex", direction: "row", gap, align: "start" }, [first, second], { tablet: { direction: "column", align: "stretch", gap: "25px" } });
const STACKED = { tablet: { basis: "auto" } };
const eyebrow = (text: string, name?: string) => paragraph(text, { fontSize: "12px", fontWeight: 700, lineHeight: 1.2, color: "accent", margin: ZERO }, undefined, name);
const h2 = (text: string, size = 46, mobile = 32, color: Style["color"] = "ink", name?: string) =>
  heading(text, 2, { fontSize: `${size}px`, fontWeight: 700, lineHeight: 1.2, color, margin: ZERO }, { mobile: { fontSize: `${mobile}px` } }, name);
const lead = (text: string, color: Style["color"] = "muted", size = 18, width = "760px", name?: string) =>
  paragraph(text, { fontSize: `${size}px`, lineHeight: 1.2, color, maxWidth: width, margin: ZERO }, { mobile: { fontSize: size === 18 ? "15px" : `${size}px` } }, name);
/** Three across on a computer; on a tablet one under the other unless said (two cards of a 577 px tablet would be under 260 px each, 0.70). */
const grid = (name: string, children: SiteNode[], gap = "18px", rowGap = gap, tabletColumns = 1): SiteNode =>
  box(name, "div", { display: "grid", columns: 3, gap, align: "stretch" }, children, { tablet: { columns: tabletColumns, gap: rowGap }, mobile: { columns: 1, gap: rowGap } });
/**
 * A card's sides are a share of its width on a computer (0.70): 5 % is the Figma's 24 px of a 1440 page, and at 1024 it leaves the text 240 px
 * at least in three columns. On a tablet and a phone (one card a row) the Figma's 24 px.
 */
const CARD_SIZES = { tablet: { padding: sides("24px", "24px") } };
const card = (icon: string, title: string, body: string, dark = false): SiteNode =>
  box("Cartão", "article", { display: "flex", direction: "column", gap: "12px", padding: sides("24px", "5%"), radius: "16px", background: dark ? "dark" : "surface" }, [
    paragraph(icon, { fontSize: "25px", fontWeight: 700, lineHeight: 1.2, color: "accent", margin: ZERO }, undefined, "Ícone"),
    heading(title, 3, { fontSize: "21px", fontWeight: 700, lineHeight: 1.2, color: dark ? "onDark" : "ink", margin: ZERO }),
    paragraph(body, { fontSize: "14px", lineHeight: 1.4, color: dark ? "onDarkMuted" : "muted", margin: ZERO }),
  ], CARD_SIZES);

function build(title: string, mode: ModelMode): SiteContent {
  // 3:845 — a full-bleed photo under a flat dark veil (rgba(3,11,15,.22), .44 on the phone), the text on the left.
  const hero = box(
    "Destaque",
    "section",
    { ...demoBackground("sisphus-hero"), background: "dark", overflow: "hidden" },
    [
      box(
        "Texto do destaque",
        "div",
        { display: "flex", direction: "column", minHeight: "610px", padding: sides("128px", "80px", "80px"), background: "#030b0f38" },
        [
          column({ display: "flex", direction: "column", gap: "20px", align: "start" }, [
            paragraph(`PERSONAL TRAINER • ${title.toUpperCase()}`.slice(0, 80), { fontSize: "13px", fontWeight: 700, color: "white", margin: ZERO }, { mobile: { fontSize: "11px" } }),
            heading("Sua melhor versão ainda está por vir.", 2, { fontSize: "65px", fontWeight: 700, lineHeight: 1.2, color: "white", maxWidth: "670px", margin: ZERO }, { mobile: { fontSize: "39px" } }),
            paragraph("Coaching de alta qualidade com método, consistência e acompanhamento de verdade.", { fontSize: "19px", lineHeight: 1.2, color: "#f5f5f5", maxWidth: "580px", margin: ZERO }, { mobile: { fontSize: "15px" } }),
            whatsappButton(),
            paragraph("✓ Treino personalizado\u00a0\u00a0\u00a0✓ Acompanhamento de verdade", { fontSize: "13px", fontWeight: 600, color: "white", margin: ZERO }, { mobile: { fontSize: "11px" } }),
          ]),
        ],
        { tablet: { padding: sides("96px", "40px", "64px") }, mobile: { minHeight: "560px", padding: sides("64px", "22px", "48px"), background: "#030b0f70" } },
      ),
    ],
    { mobile: { bgPosition: "right" } },
  );

  // 3:854
  const about = band("Sobre a metodologia", "bg", [
    eyebrow("SOBRE A METODOLOGIA"),
    h2("Coaching para uma mudança duradoura."),
    lead("Uma abordagem individual para evoluir com consistência."),
    grid("Benefícios", [
      card("✓", "Planejamento individual", "Um método construído de acordo com sua rotina e seus objetivos."),
      card("✓", "Acompanhamento constante", "Um método construído de acordo com sua rotina e seus objetivos."),
      card("✓", "Evolução mensurável", "Um método construído de acordo com sua rotina e seus objetivos."),
    ]),
  ]);

  // A testimony is the quote block: it is published only once the person's authorization is confirmed (an empty one is not on the page, and the
  // band around it then has nothing to show and is left out too).
  const testimony = (name: string, quote: string, author: string, style: Style, mobile: Style) =>
    ({
      ...(emptyBlock("quote") as BlockOf<"quote">),
      name,
      eyebrow: say(mode, "★★★★★"),
      quote: say(mode, quote),
      author: say(mode, author),
      authorized: false,
      style: { color: "ink", lineHeight: 1.2, margin: ZERO, ...style },
      styleMobile: mobile,
    }) as SiteNode;

  // 3:871 — one big testimony on white, right after the promise.
  const highlight = band(
    "Depoimento em destaque",
    "surface",
    [
      testimony(
        "Depoimento autorizado",
        "Finalmente encontrei um método que se encaixa na minha rotina e me faz evoluir.",
        "Aluna do acompanhamento personalizado",
        { background: "transparent", padding: ZERO, fontSize: "38px", fontWeight: 700 },
        { fontSize: "26px" },
      ),
    ],
    { padding: sides("65px", "80px", "75px") },
    { padding: sides("65px", "22px", "75px") },
  );

  // 3:875 — the photo (≈ 678 of 1280) and the text, top-aligned.
  const editorial = band("Apresentação com imagem", "surface", [
    split(
      "Imagem e texto",
      photo("sisphus-foto", "16:9", { radius: "20px", grow: 4, basis: "0px" }, STACKED, "Foto do método"),
      // The text keeps 320 px at least beside the photo (on a computer, 0.70).
      box("Texto", "div", { display: "flex", direction: "column", gap: "20px", align: "start", grow: 3, basis: "0px", minWidth: "320px" }, [
        eyebrow("MÉTODO E RESULTADOS"),
        h2("O compromisso que muda tudo.", 39, 29),
        paragraph(
          "Avaliação do seu momento atual, planejamento consistente e ajustes orientados por resultados. Uma experiência de treino pensada para a vida real.",
          { fontSize: "16px", lineHeight: 1.4, color: "muted", maxWidth: "460px", margin: ZERO },
        ),
        whatsappButton(),
      ], { tablet: { basis: "auto", minWidth: "0px" } }),
      "36px",
    ),
  ]);

  // 3:884 — the dark band: the cards are the band's own color, so they read as text blocks.
  const services = band("Serviços e especialidades", "dark", [
    eyebrow("O QUE VOCÊ ENCONTRA"),
    h2("Programas pensados para sua evolução", 44, 31, "onDark"),
    grid(
      "Especialidades",
      [
        card("↗", "Coaching individual", "Aulas, planos e orientações adaptados a diferentes objetivos e níveis.", true),
        card("✳", "Treino de força", "Aulas, planos e orientações adaptados a diferentes objetivos e níveis.", true),
        card("◎", "Performance e recuperação", "Aulas, planos e orientações adaptados a diferentes objetivos e níveis.", true),
        card("✦", "Hábitos e estilo de vida", "Aulas, planos e orientações adaptados a diferentes objetivos e níveis.", true),
      ],
      "27px",
      "25px",
    ),
  ]);

  // 3:905 — white cards on white in the Figma: kept as drawn (the step numbers and titles carry it).
  const process = band("Como funciona", "surface", [
    eyebrow("PASSO A PASSO"),
    h2("Da primeira conversa à sua evolução"),
    lead("Um processo simples, organizado e transparente para você começar."),
    grid(
      "Etapas",
      [
        card("01", "Conte seus objetivos", "Seu progresso é acompanhado e o planejamento pode evoluir com você."),
        card("02", "Receba seu plano", "Seu progresso é acompanhado e o planejamento pode evoluir com você."),
        card("03", "Treine e acompanhe", "Seu progresso é acompanhado e o planejamento pode evoluir com você."),
      ],
      "18px",
      "25px",
    ),
  ]);

  // 3:922 — the photo (≈ 470) and the biography (≈ 755).
  const professional = band("Apresentação do profissional", "bg", [
    eyebrow("QUEM ACOMPANHA VOCÊ"),
    h2("Conheça o profissional por trás do método"),
    lead("Formação, experiência e atenção aos detalhes em cada etapa."),
    split(
      "Foto e biografia",
      // The person's own photo: only the preview has a sample (a photo of someone else is never the professional's).
      photo(mode === "preview" ? "sisphus-foto" : undefined, "3:2", { radius: "20px", grow: 5, basis: "0px" }, STACKED, "Sua foto"),
      box("Biografia", "div", { display: "flex", direction: "column", gap: "14px", grow: 8, basis: "0px" }, [
        paragraph(say(mode, "SEU NOME AQUI"), { fontSize: "13px", fontWeight: 700, color: "accent", margin: ZERO }, undefined, "Seu nome"),
        heading(
          say(mode, "Personal trainer • Especialista em treinamento"),
          3,
          { fontSize: "30px", fontWeight: 700, lineHeight: 1.2, color: "ink", maxWidth: "580px", margin: ZERO },
          { mobile: { fontSize: "22px" } },
          "Sua profissão e especialidade",
        ),
        paragraph(
          say(mode, "Apresente aqui sua história, certificações, experiência e os diferenciais do seu atendimento. O CMS permite substituir todos estes campos."),
          { fontSize: "15px", lineHeight: 1.4, color: "muted", maxWidth: "600px", margin: ZERO },
          undefined,
          "Sua história e formação",
        ),
        paragraph(say(mode, "8+ anos de experiência\u00a0\u00a0\u00a0\u00a0•\u00a0\u00a0\u00a0\u00a0Atendimento individual"), { fontSize: "15px", fontWeight: 600, color: "accent", margin: ZERO }, undefined, "Destaques (ex.: experiência)"),
      ], STACKED),
      "36px",
    ),
  ]);

  // 11:67 — the steps of the follow-up in a grey box (≈ 717) and a photo (≈ 499).
  const step = (label: string, body: string) =>
    box("Etapa", "div", { display: "flex", direction: "column", gap: "7px" }, [
      heading(label, 3, { fontSize: "20px", fontWeight: 700, lineHeight: 1.2, color: "ink", margin: ZERO }),
      paragraph(body, { fontSize: "14px", lineHeight: 1.2, color: "muted", margin: ZERO }),
    ]);
  const journey = band(
    "Jornada com indicadores",
    "surface",
    [
      eyebrow("ACOMPANHAMENTO DE ALTA QUALIDADE"),
      h2("Uma transformação construída com método.", 46, 31),
      lead("Não usamos imagens de antes e depois ou números de resultado sem consentimento e comprovação. Mostramos o processo de evolução.", "muted", 16, "920px"),
      split(
        "Etapas e foto",
        box(
          "Etapas do acompanhamento",
          "div",
          { display: "flex", direction: "column", gap: "12px", padding: sides("20px", "20px"), radius: "18px", background: "#f6f6f5", grow: 10, basis: "0px" },
          [
            step("01\u00a0\u00a0Avaliação e objetivos", "Ponto de partida, disponibilidade, histórico e contexto individual."),
            step("02\u00a0\u00a0Plano progressivo", "Metas claras, treino adaptado e indicadores acompanhados."),
            step("03\u00a0\u00a0Revisões periódicas", "Check-ins, ajustes e evolução orientada por dados."),
          ],
          STACKED,
        ),
        photo("sisphus-foto", "4:3", { radius: "18px", grow: 7, basis: "0px" }, STACKED, "Foto do acompanhamento"),
        "26px",
      ),
    ],
    {},
    { padding: sides("55px", "22px") },
    "22px",
  );

  // 3:933
  const stat = (value: string, label: string) =>
    box("Indicador", "div", { display: "flex", direction: "column", gap: "10px" }, [
      paragraph(say(mode, value), { fontSize: "54px", fontWeight: 700, lineHeight: 1.2, color: "accent", margin: ZERO }, { mobile: { fontSize: "39px" } }, "Número (só se for real)"),
      paragraph(say(mode, label), { fontSize: "15px", fontWeight: 600, color: "ink", margin: ZERO }, undefined, "O que o número conta"),
    ]);
  const stats = band(
    "Números e conquistas",
    "#fafaf9",
    [grid("Métricas", [stat("+500", "alunos acompanhados"), stat("98%", "nível de satisfação"), stat("8+", "anos de experiência")], "25px", "25px", 3)],
    { padding: sides("45px", "80px", "55px") },
    { padding: sides("45px", "22px", "55px") },
  );

  // 3:944 — light grey cards, the middle one dark; the prices are the professional's to set.
  const plan = (label: string, name: string, price: string, tagline: string, featured = false): SiteNode =>
    box(
      "Plano",
      "article",
      { display: "flex", direction: "column", gap: "15px", align: "start", padding: sides("25px", "5%"), radius: "20px", background: featured ? "dark" : "#f7f7f7" },
      [
        paragraph(featured ? say(mode, label) : label, { fontSize: "12px", fontWeight: 700, color: featured ? "accentOnDark" : "muted", margin: ZERO }, undefined, featured ? "Selo de destaque (opcional)" : undefined),
        heading(name, 3, { fontSize: "24px", fontWeight: 700, lineHeight: 1.2, color: featured ? "onDark" : "ink", margin: ZERO }),
        paragraph(say(mode, price), { fontSize: "40px", fontWeight: 700, lineHeight: 1.2, color: featured ? "onDark" : "ink", margin: ZERO }, undefined, "Valor (R$)"),
        paragraph(say(mode, "por mês"), { fontSize: "14px", color: featured ? "#d0d0d0" : "muted", margin: ZERO }, undefined, "Periodicidade"),
        paragraph(say(mode, tagline), { fontSize: "15px", color: featured ? "#ececec" : "muted", margin: ZERO }, undefined, "Para quem é o plano"),
        box(
          "O que inclui",
          "div",
          { display: "flex", direction: "column", gap: "6px" },
          ["Treinos personalizados", "Evolução acompanhada", "Ajustes periódicos", "Suporte dedicado"].map((item) =>
            paragraph(say(mode, `✓ ${item}`), { fontSize: "14px", color: featured ? "onDark" : "ink", margin: ZERO }, undefined, "O que inclui (item)"),
          ),
        ),
        whatsappButton(),
      ],
      { tablet: { padding: sides("25px", "25px") } },
    );
  const pricing = band("Planos e investimento", "surface", [
    eyebrow("PLANOS"),
    h2("Escolha o acompanhamento ideal"),
    lead("Escolha o formato que combina com a sua rotina."),
    grid(
      "Lista de planos",
      [
        plan("PLANO", "Core Coaching", "R$ 249", "O essencial do seu desenvolvimento"),
        plan("MAIS POPULAR", "Transformation", "R$ 399", "Jornada de transformação", true),
        plan("PLANO", "Elite Coaching", "R$ 599", "Acompanhamento premium"),
      ],
      "18px",
      "25px",
    ),
  ]);

  // 3:985
  const testimonials = band("Histórias e resultados", "bg", [
    eyebrow(say(mode, "RESULTADOS"), "Rótulo dos depoimentos"),
    h2(say(mode, "Histórias reais. Evoluções possíveis."), 46, 32, "ink", "Título dos depoimentos"),
    lead(mode === "preview" ? "Use depoimentos consentidos, dados comprováveis e imagens autorizadas." : ""),
    testimony(
      "Depoimento autorizado",
      "Os treinos ficaram mais consistentes, a orientação foi clara e o acompanhamento fez toda a diferença.",
      "Aluno do acompanhamento personalizado",
      { background: "surface", radius: "18px", padding: sides("30px", "30px"), fontSize: "30px", fontWeight: 600 },
      { fontSize: "22px" },
    ),
  ]);

  // 3:993
  const questions = band("Perguntas frequentes", "surface", [
    faq(
      "DÚVIDAS",
      "Perguntas frequentes",
      ["Como funciona o acompanhamento?", "Preciso treinar em uma academia?", "Os planos são personalizados?", "Como acompanho meus resultados?"],
      [],
      { padding: ZERO, gap: "25px", maxWidth: "480px" },
      { mobile: { maxWidth: "100%" } },
    ),
  ]);

  // 3:1008
  const contactForm = {
    ...(emptyBlock("contactForm") as BlockOf<"contactForm">),
    name: "Formulário de contato",
    eyebrow: "",
    heading: "",
    text: "",
    buttonLabel: "Enviar mensagem",
    style: { background: "surface", radius: "15px", padding: sides("24px", "24px"), margin: ZERO },
  } as SiteNode;
  // The text on the left and the form's card on the right on a computer; one under the other on a tablet and a phone (0.70).
  const contact = band("Contato e captura", "bg", [
    box("Texto e formulário", "div", { display: "grid", columns: 2, gap: "48px", align: "start" }, [
      box("Texto", "div", { display: "flex", direction: "column", gap: "25px", align: "start" }, [
        eyebrow("ENTRE EM CONTATO"),
        h2("Vamos construir seu próximo resultado?"),
        lead(say(mode, "Um formulário simples para iniciar uma conversa com o personal trainer."), "muted", 18, "760px", "Texto do contato"),
      ]),
      contactForm,
    ], { tablet: { columns: 1, gap: "25px" } }),
  ]);

  // 3:1023
  const footer = box(
    "Rodapé",
    "footer",
    { background: "dark", padding: sides("55px", "80px") },
    [
      column({ display: "flex", direction: "column", gap: "25px", align: "start" }, [
        paragraph(title.toUpperCase().slice(0, 80), { fontSize: "38px", fontWeight: 700, lineHeight: 1.2, color: "onDark", margin: ZERO }, { mobile: { fontSize: "26px" } }, "Nome do site"),
        paragraph("Treinos e acompanhamento pensados para a sua evolução.", { fontSize: "16px", color: "onDarkMuted", margin: ZERO }),
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
    blocks: [hero, about, highlight, editorial, services, process, professional, journey, stats, pricing, testimonials, questions, contact, footer],
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

export const SISPHUS: SiteModelDef = {
  key: "sisphus",
  label: "Premium (preto e laranja)",
  hint: "Foto escura de impacto, depoimento em destaque, programas em faixa preta, jornada do acompanhamento, planos e perguntas frequentes.",
  palette: PALETTE,
  build,
};
