/**
 * RACE — Performance (Figma "Templates de Sites — CMS V1", page 04, frames `3:1208` desktop 1440 and `3:1408` mobile 390). A clean "performance
 * lab": white and cool-grey bands, a deep navy ink, one electric blue for every accent, a night-stadium sprint photo in the hero, a pale-blue band
 * of numbers, a team of three coaches, flat rounded cards and the green WhatsApp pill on every commercial action.
 * The Figma has no articles section (and a model has none: the user's decision of 02/11/2026, no blog yet).
 */
import { SITE_SCHEMA_VERSION, emptyBlock, type BlockOf, type SiteContent, type SiteNode } from "../contracts";
import { DEFAULT_THEME } from "../site-theme";
import type { Style } from "../style";
import { box, demoBackground, faq, heading, paragraph, photo, say, sides, textLink, whatsappButton, type ModelMode, whatsappCtaOf } from "./bricks";
import type { DemoPhoto } from "./demo-photos";
import type { SiteModelDef } from "./types";

const PALETTE = { primary: "#1153d5", background: "#f5f6f9", surface: "#ffffff", ink: "#0d1320", muted: "#667085", dark: "#091720" };

// ---- the rhythm of the page (desktop 1440 / phone 390) ----
const SECTION_PAD = sides("90px", "80px");
const SECTION_PAD_MOBILE = sides("50px", "22px");
const band = (name: string, background: Style["background"], children: SiteNode[], extra: Style = {}, mobile: Style = {}, gap = "25px"): SiteNode =>
  box(name, "section", { background, padding: SECTION_PAD, ...extra }, [box("Conteúdo", "div", { display: "flex", direction: "column", gap, maxWidth: "1280px", margin: sides("0px", "auto") }, children)], {
    tablet: { padding: sides("70px", "40px") },
    mobile: { padding: SECTION_PAD_MOBILE, ...mobile },
  });
const eyebrow = (text: string, name?: string) => paragraph(text, { fontSize: "12px", fontWeight: 700, lineHeight: 1.2, color: "accent", margin: sides("0px", "0px") }, undefined, name);
const h2 = (text: string, size = 46, mobile = 32, extra: Style = {}, name?: string) =>
  heading(text, 2, { fontSize: `${size}px`, fontWeight: 700, lineHeight: 1.2, color: "ink", margin: sides("0px", "0px"), ...extra }, { mobile: { fontSize: `${mobile}px` } }, name);
const lead = (text: string, size = 18, name?: string) =>
  paragraph(text, { fontSize: `${size}px`, lineHeight: 1.2, color: "muted", maxWidth: "760px", margin: sides("0px", "0px") }, { mobile: { fontSize: "15px" } }, name);
const grid = (name: string, children: SiteNode[], gap = "18px", rowGap = gap): SiteNode =>
  box(name, "div", { display: "grid", columns: 3, gap, align: "stretch" }, children, { tablet: { columns: 2 }, mobile: { columns: 1, gap: rowGap } });
const card = (icon: string, title: string, body: string, background: Style["background"] = "surface"): SiteNode =>
  box("Cartão", "article", { display: "flex", direction: "column", gap: "12px", padding: sides("24px", "24px"), radius: "16px", background }, [
    paragraph(icon, { fontSize: "25px", fontWeight: 700, lineHeight: 1.2, color: "accent", margin: sides("0px", "0px") }, undefined, "Ícone"),
    heading(title, 3, { fontSize: "21px", fontWeight: 700, lineHeight: 1.2, color: "ink", margin: sides("0px", "0px") }),
    paragraph(body, { fontSize: "14px", lineHeight: 1.4, color: "muted", margin: sides("0px", "0px") }),
  ]);
const SPACE = "     ";

function build(title: string, mode: ModelMode): SiteContent {
  // `3:1219` (mobile `3:1412`): the sprinter on the right, a flat navy veil (22% on the computer, 44% on the phone), the text on the dark left.
  const hero = box(
    "Destaque",
    "section",
    { ...demoBackground("race-hero"), background: "dark", overflow: "hidden" },
    [
      box(
        "Texto do destaque",
        "div",
        { display: "flex", direction: "column", gap: "20px", align: "start", minHeight: "610px", padding: sides("128px", "80px", "80px"), background: "#030b0f38" },
        [
          paragraph(`PERSONAL TRAINER • ${title.toUpperCase()}`.slice(0, 80), { fontSize: "13px", fontWeight: 700, color: "white", margin: sides("0px", "0px") }, { mobile: { fontSize: "11px" } }),
          heading("TREINE PARA SER MAIS RÁPIDO.", 2, { fontSize: "65px", fontWeight: 700, lineHeight: 1.2, color: "white", maxWidth: "670px", margin: sides("0px", "0px") }, { mobile: { fontSize: "39px" } }),
          paragraph("Metodologia orientada por evidências para ganhar velocidade, potência e eficiência.", { fontSize: "19px", lineHeight: 1.2, color: "#f5f5f5", maxWidth: "580px", margin: sides("0px", "0px") }, { mobile: { fontSize: "15px" } }),
          whatsappButton(),
          paragraph("✓ Treino personalizado   ✓ Acompanhamento de verdade", { fontSize: "13px", fontWeight: 600, color: "white", margin: sides("0px", "0px") }, { mobile: { fontSize: "11px" } }),
        ],
        { tablet: { padding: sides("96px", "40px", "64px") }, mobile: { minHeight: "560px", padding: sides("64px", "22px", "48px"), background: "#030b0f70" } },
      ),
    ],
    { mobile: { bgPosition: "right" } },
  );

  // `3:1228` (mobile `3:1421`): one blue line of what the work is. "Atletas treinados" says who the professional has trained: a fact of theirs.
  const strip = box(
    "Faixa de destaques",
    "section",
    { background: "surface", padding: sides("28px", "80px", "35px") },
    [
      box("Conteúdo", "div", { display: "flex", direction: "row", wrap: "wrap", maxWidth: "1280px", margin: sides("0px", "auto") }, [
        paragraph(say(mode, `ATLETAS TREINADOS${SPACE}•${SPACE}`), { fontSize: "17px", fontWeight: 700, lineHeight: 1.2, color: "accent", margin: sides("0px", "0px") }, { mobile: { fontSize: "11px" } }, "Quem você treina (só se for real)"),
        paragraph(`METODOLOGIA PROGRESSIVA${SPACE}•${SPACE}SUPORTE INDIVIDUAL`, { fontSize: "17px", fontWeight: 700, lineHeight: 1.2, color: "accent", margin: sides("0px", "0px") }, { mobile: { fontSize: "11px" } }),
      ]),
    ],
    { tablet: { padding: sides("28px", "40px", "35px") }, mobile: { padding: sides("28px", "22px", "35px") } },
  );

  // `3:1230`
  const about = band("Sobre a metodologia", "bg", [
    eyebrow("SOBRE A METODOLOGIA"),
    h2("Velocidade não é talento. É treino."),
    lead("Treinamento de sprint com técnica, força e acompanhamento de performance."),
    grid("Benefícios", [
      card("✓", "Planejamento individual", "Um método construído de acordo com sua rotina e seus objetivos."),
      card("✓", "Acompanhamento constante", "Um método construído de acordo com sua rotina e seus objetivos."),
      card("✓", "Evolução mensurável", "Um método construído de acordo com sua rotina e seus objetivos."),
    ]),
  ]);

  // `3:1247`: the photo on the left (678 of 1280), the text on the right, both from the top; on the phone the photo first.
  const editorial = box(
    "Apresentação com imagem",
    "section",
    { background: "surface", padding: SECTION_PAD },
    [
      box(
        "Imagem e texto",
        "div",
        { display: "flex", direction: "row", gap: "36px", align: "start", maxWidth: "1280px", margin: sides("0px", "auto") },
        [
          photo("race-foto", "16:9", { radius: "20px", basis: "678px", shrink: 1, grow: 0 }, { tablet: { basis: "50%" }, mobile: { basis: "auto" } }, "Foto do método"),
          box("Texto", "div", { display: "flex", direction: "column", gap: "20px", align: "start", grow: 1, basis: "0px" }, [
            eyebrow("MÉTODO E RESULTADOS"),
            h2("Treine velocidade com técnica, força e precisão.", 39, 29, { maxWidth: "480px" }),
            paragraph(
              "Avaliação do seu momento atual, planejamento consistente e ajustes orientados por resultados. Uma experiência de treino pensada para a vida real.",
              { fontSize: "16px", lineHeight: 1.4, color: "muted", maxWidth: "460px", margin: sides("0px", "0px") },
            ),
            whatsappButton(),
          ], { mobile: { basis: "auto" } }),
        ],
        { mobile: { direction: "column", align: "stretch", gap: "25px" } },
      ),
    ],
    { tablet: { padding: sides("70px", "40px") }, mobile: { padding: SECTION_PAD_MOBILE } },
  );

  // `3:1256`: six cards in two rows, no lead.
  const services = band("Serviços e especialidades", "bg", [
    eyebrow("O QUE VOCÊ ENCONTRA"),
    h2("Programas para elevar sua performance", 44, 31),
    grid(
      "Especialidades",
      [
        card("↗", "Aceleração", "Aulas, planos e orientações adaptados a diferentes objetivos e níveis."),
        card("✳︎", "Velocidade máxima", "Aulas, planos e orientações adaptados a diferentes objetivos e níveis."),
        card("◎", "Força e potência", "Aulas, planos e orientações adaptados a diferentes objetivos e níveis."),
        card("✦", "Mobilidade", "Aulas, planos e orientações adaptados a diferentes objetivos e níveis."),
        card("↗", "Mudança de direção", "Aulas, planos e orientações adaptados a diferentes objetivos e níveis."),
        card("◉", "Resistência de velocidade", "Aulas, planos e orientações adaptados a diferentes objetivos e níveis."),
      ],
      "27px",
      "25px",
    ),
  ]);

  // `3:1285`: the steps' cards are white on white in the Figma (they read as columns without a card), as here.
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

  // `3:1324`
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
        plan("PLANO", "Starter Speed", "R$ 169", "Construa sua base"),
        plan("MAIS POPULAR", "Pro Speed", "R$ 299", "Evolua sua velocidade", true),
        plan("PLANO", "Elite Performance", "R$ 499", "Performance competitiva"),
      ],
      "18px",
      "25px",
    ),
  ]);

  // `11:119` (mobile `11:139`): three coaches. Their photos and names are of people: only the preview has samples.
  const coach = (demo: DemoPhoto, name: string, role: string): SiteNode =>
    box("Coach", "article", { display: "flex", direction: "column", gap: "10px", align: "start", padding: sides("16px", "16px"), radius: "17px", background: "bg" }, [
      photo(mode === "preview" ? demo : undefined, "4:3", { radius: "18px", width: "100%" }, undefined, "Foto do coach"),
      heading(say(mode, name), 3, { fontSize: "23px", fontWeight: 700, lineHeight: 1.2, color: "ink", margin: sides("0px", "0px") }, undefined, "Nome do coach"),
      paragraph(say(mode, role), { fontSize: "15px", lineHeight: 1.2, color: "muted", margin: sides("0px", "0px") }, undefined, "Especialidade do coach"),
      textLink(say(mode, "Ver acompanhamento →"), { fontSize: "14px", fontWeight: 700, color: "accent", textDecoration: "none" }, { anchor: pricing.id }),
    ]);
  const coaches = band(
    "Coaches de performance",
    "surface",
    [
      eyebrow(say(mode, "COACHES DE PERFORMANCE"), "Rótulo da equipe"),
      h2(say(mode, "Especialistas para levar seu treino mais longe."), 46, 31, {}, "Título da equipe"),
      lead(say(mode, "Três perfis ilustrativos para substituição pelo profissional ou equipe responsável pelo site."), 15, "Quem é a equipe"),
      grid("Equipe", [coach("race-coach-1", "Alex", "Técnica e velocidade"), coach("race-coach-2", "Marina", "Sprint e aceleração"), coach("race-coach-3", "Daniel", "Força e potência")], "20px", "22px"),
    ],
    {},
    { padding: sides("55px", "22px") },
    "22px",
  );

  // `3:1313`: the numbers on a pale tint of the blue, no cards.
  const stat = (value: string, label: string) =>
    box("Indicador", "div", { display: "flex", direction: "column", gap: "10px" }, [
      paragraph(say(mode, value), { fontSize: "54px", fontWeight: 700, lineHeight: 1.2, color: "accent", margin: sides("0px", "0px") }, { mobile: { fontSize: "39px" } }, "Número (só se for real)"),
      paragraph(say(mode, label), { fontSize: "15px", fontWeight: 600, color: "ink", margin: sides("0px", "0px") }, undefined, "O que o número conta"),
    ]);
  const stats = box(
    "Números e conquistas",
    "section",
    { background: "soft", padding: sides("45px", "80px", "55px") },
    [box("Conteúdo", "div", { maxWidth: "1280px", margin: sides("0px", "auto") }, [grid("Métricas", [stat("+500", "alunos acompanhados"), stat("98%", "satisfação ilustrativa"), stat("8+", "anos de experiência")], "25px", "25px")])],
    { tablet: { padding: sides("45px", "40px", "55px") }, mobile: { padding: sides("45px", "22px", "55px") } },
  );

  // `3:1365`: a testimony is the quote block: it is published only once the person's authorization is confirmed (an empty one is not on the page).
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
    eyebrow(say(mode, "RESULTADOS"), "Rótulo dos depoimentos"),
    h2(say(mode, "Histórias reais. Evoluções possíveis."), 46, 32, {}, "Título dos depoimentos"),
    lead(mode === "preview" ? "Use depoimentos consentidos, dados comprováveis e imagens autorizadas." : ""),
    testimonyNode,
  ]);

  // `3:1373`: four questions, 480 wide, no answer written (the person writes them).
  const questions = band("Perguntas frequentes", "surface", [
    faq(
      "DÚVIDAS",
      "Perguntas frequentes",
      ["Como funciona o acompanhamento?", "Preciso treinar em uma academia?", "Os planos são personalizados?", "Como acompanho meus resultados?"],
      [],
      { padding: sides("0px", "0px"), gap: "25px", maxWidth: "480px" },
      { mobile: { maxWidth: "100%" } },
    ),
  ]);

  // `3:1388`
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
    lead(say(mode, "Um formulário simples para iniciar uma conversa com o personal trainer."), 18, "Texto do contato"),
    contactForm,
  ]);

  // `3:1403`
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
    theme: { ...DEFAULT_THEME, accent: "blue", mode: "light", width: "full", font: "inter", palette: PALETTE },
    blocks: [hero, strip, about, editorial, services, process, coaches, stats, pricing, testimonials, questions, contact, footer],
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

export const RACE: SiteModelDef = {
  key: "race",
  label: "Performance (azul e branco)",
  hint: "Foto de corrida no topo, cartões de método e programas, equipe de coaches, números, planos e perguntas frequentes. Azul, branco e marinho.",
  palette: PALETTE,
  build,
};
