/**
 * The three areas of the product and their navigation (handoff V2, section 3).
 * Pure data: no React, no database. A navigation entry marked "planned" is
 * rendered as an honest placeholder; it never pretends to work.
 */
export type SurfaceId = "gestor" | "profissional" | "aluno";

export type IconName =
  | "dashboard"
  | "building"
  | "audit"
  | "card"
  | "handshake"
  | "template"
  | "library"
  | "plug"
  | "users"
  | "clipboard"
  | "calendar"
  | "dumbbell"
  | "book"
  | "globe"
  | "inbox"
  | "settings"
  | "home"
  | "chart"
  | "check"
  | "file"
  | "message"
  | "user";

export interface PlannedInfo {
  /** Roadmap epic (docs/ROADMAP-IMPLEMENTACAO.md). */
  epic: string;
  /** Section of the V2 handoff or of the consolidated project document. */
  reference: string;
  summary: string;
  needs: string;
}

export interface NavItem {
  /** "" is the area home. */
  slug: string;
  label: string;
  icon: IconName;
  status: "available" | "planned";
  /** Shown in the compact mobile bar. */
  primary?: boolean;
  planned?: PlannedInfo;
  /** Replaces the default "Em breve" tag, e.g. "Prévia" in the demonstration. */
  tag?: string;
}
export interface NavGroup {
  label: string;
  items: NavItem[];
}

export interface SurfaceDefinition {
  id: SurfaceId;
  /** Area name used in the interface. */
  label: string;
  /** Who it is for, in the words of the product. */
  audience: string;
  description: string;
  home: string;
}

export const SURFACES: Record<SurfaceId, SurfaceDefinition> = {
  gestor: {
    id: "gestor",
    label: "Gestor da ferramenta",
    audience: "Equipe que opera a plataforma",
    description:
      "Acompanha as organizações e os profissionais que contrataram a ferramenta. Não vê avaliações, treinos nem dados dos alunos.",
    home: "/gestor",
  },
  profissional: {
    id: "profissional",
    label: "Profissional de educação física",
    audience: "Personal trainers e consultorias",
    description:
      "Cadastra alunos, planeja os ciclos e acompanha o atendimento. Cada ação exige vínculo técnico com o aluno.",
    home: "/profissional",
  },
  aluno: {
    id: "aluno",
    label: "Cliente (aluno)",
    audience: "Quem treina com um profissional",
    description:
      "Entra por convite do seu profissional e vê somente o que foi liberado para você.",
    home: "/aluno",
  },
};

export const SURFACE_ORDER: SurfaceId[] = ["gestor", "profissional", "aluno"];

const planned = (
  slug: string,
  label: string,
  icon: IconName,
  info: PlannedInfo,
  primary = false,
): NavItem => ({ slug, label, icon, status: "planned", planned: info, primary });

const gestor: NavGroup[] = [
  {
    label: "PLATAFORMA",
    items: [
      {
        slug: "",
        label: "Visão geral",
        icon: "dashboard",
        status: "available",
        primary: true,
      },
      {
        slug: "organizacoes",
        label: "Organizações",
        icon: "building",
        status: "available",
        primary: true,
      },
      {
        slug: "auditoria",
        label: "Auditoria",
        icon: "audit",
        status: "available",
        primary: true,
      },
    ],
  },
  {
    label: "NEGÓCIO",
    items: [
      planned("planos-saas", "Planos e cobrança", "card", {
        epic: "E6",
        reference: "Projeto consolidado, seções 3 e 4A",
        summary:
          "Planos, limites, assinatura e inadimplência de cada organização. A receita da plataforma fica em um livro separado da receita do profissional.",
        needs:
          "Fatos financeiros normalizados, conciliação e a escolha do meio de cobrança.",
      }),
      planned("afiliados", "Afiliados e comissões", "handshake", {
        epic: "E6",
        reference: "Projeto consolidado, seções 3 e 4E",
        summary:
          "Código informado na contratação e comissão recorrente sobre pagamentos SaaS confirmados, com idempotência por fato financeiro.",
        needs:
          "Pagamentos SaaS confirmados e um livro de comissões que não duplique créditos em reentregas.",
      }),
    ],
  },
  {
    label: "CATÁLOGOS",
    items: [
      planned("templates", "Templates e blocos", "template", {
        epic: "E3",
        reference: "Handoff V2, seção 10.4",
        summary:
          "Templates e blocos aprovados que os profissionais usam no editor do site. Nenhum HTML ou JavaScript arbitrário.",
        needs:
          "Prova do editor Puck no Webflow Cloud e contrato versionado dos blocos.",
      }),
      planned("biblioteca-global", "Biblioteca técnica", "library", {
        epic: "E2 / E7",
        reference: "Handoff V2, seções 6.3 e 7",
        summary:
          "Exercícios e fontes técnicas curados pela plataforma, base das bibliotecas dos profissionais.",
        needs:
          "Modelagem dos exercícios em migrations aditivas e um acervo com direitos de uso verificados.",
      }),
      planned("integracoes", "Integrações", "plug", {
        epic: "E5",
        reference: "Projeto consolidado, seção 4A",
        summary:
          "Saúde dos conectores de e-mail, pagamento e comunicação, com escopo por organização.",
        needs:
          "Escolha do provedor de envio de e-mail e dos demais fornecedores.",
      }),
    ],
  },
];

const profissional: NavGroup[] = [
  {
    label: "ATENDIMENTO",
    items: [
      {
        slug: "",
        label: "Visão geral",
        icon: "dashboard",
        status: "available",
        primary: true,
      },
      {
        slug: "alunos",
        label: "Alunos",
        icon: "users",
        status: "available",
        primary: true,
      },
      planned("avaliacoes", "Avaliações", "clipboard", {
        epic: "E2",
        reference: "Handoff V2, seções 4.2 e 4.3",
        summary:
          "Triagem, indicadores, postura e movimento como registros históricos de cada aluno. Qualquer sinal de triagem coloca a avaliação em revisão necessária. A ferramenta descreve, nunca diagnostica.",
        needs:
          "Persistência das avaliações no SQLite e o instrumento de triagem validado com o responsável técnico.",
      }),
      {
        slug: "periodizacao",
        label: "Periodização",
        icon: "calendar",
        status: "available",
        primary: true,
      },
      {
        slug: "prescricao",
        label: "Prescrição",
        icon: "dumbbell",
        status: "available",
        primary: true,
      },
    ],
  },
  {
    label: "CONHECIMENTO",
    items: [
      {
        slug: "biblioteca",
        label: "Biblioteca de exercícios",
        icon: "book",
        status: "available",
      },
      planned("fontes", "Fontes técnicas", "library", {
        epic: "E7",
        reference: "Handoff V2, seção 7",
        summary:
          "Acervo autorizado com evidências verificáveis. Sem fonte conferida, a resposta é evidência insuficiente; nada é inventado.",
        needs:
          "Acervo com direitos verificados e armazenamento de busca compatível com SQLite. O pgvector deixou de ser pressuposto.",
      }),
    ],
  },
  {
    label: "MARKETING E CAPTAÇÃO",
    items: [
      planned("meu-site", "Meu Site", "globe", {
        epic: "E3",
        reference: "Handoff V2, seções 9, 10 e 11",
        summary:
          "Site público do profissional com editor de blocos por arrastar e soltar, rascunho separado do publicado, prévia e publicação explícita. Nunca exibe dados de alunos.",
        needs:
          "Provas no Webflow Cloud: vários hosts por app, domínios, TLS e o editor Puck.",
      }),
      planned("leads", "Leads", "inbox", {
        epic: "E3",
        reference: "Handoff V2, seções 9 e 11.4",
        summary:
          "Interessados vindos do formulário do site, com origem e conversão deliberada em aluno. O formulário comercial não recebe dados de saúde.",
        needs: "Site publicado e um CRM mínimo com conversão idempotente.",
      }),
    ],
  },
  {
    label: "ESPAÇO",
    items: [
      planned("configuracoes", "Configurações", "settings", {
        epic: "E1",
        reference: "Handoff V2, seção 3",
        summary: "Equipe, papéis, permissões e dados do espaço de trabalho.",
        needs:
          "E-mail verificado, recuperação de senha, convites de equipe e a interface de revogação.",
      }),
    ],
  },
];

const aluno: NavGroup[] = [
  {
    label: "MEU ACOMPANHAMENTO",
    items: [
      {
        slug: "",
        label: "Início",
        icon: "home",
        status: "available",
        primary: true,
      },
      planned("treino", "Treino atual", "dumbbell", {
        epic: "E4",
        reference: "Projeto consolidado, seção 9",
        summary:
          "O treino liberado pelo seu profissional, com exercícios, séries, descanso e vídeo. Só aparece depois que o profissional aprova e entrega.",
        needs:
          "Prescrição persistida, aprovação e entrega de uma revisão imutável.",
      }, true),
      planned("evolucao", "Evolução", "chart", {
        epic: "E4",
        reference: "Projeto consolidado, seção 9",
        summary:
          "Medidas e aderência por data e unidade. Dado ausente continua ausente: nunca vira zero.",
        needs: "Registro de execução e avaliações persistidos.",
      }, true),
      planned("check-in", "Check-in", "check", {
        epic: "E4",
        reference: "Projeto consolidado, seção 9",
        summary:
          "Esforço percebido, recuperação e desconforto relatado. O registro avisa o profissional e não é um canal de urgência.",
        needs: "Fila de acompanhamento do profissional e política de resposta.",
      }),
    ],
  },
  {
    label: "CONTA",
    items: [
      planned("documentos", "Documentos", "file", {
        epic: "E4",
        reference: "Projeto consolidado, seção 9",
        summary:
          "PDFs de planos e resumos que o profissional compartilhou explicitamente com você.",
        needs: "Object Storage privado e geração de PDF a partir da revisão entregue.",
      }),
      planned("mensagens", "Mensagens", "message", {
        epic: "E4",
        reference: "Projeto consolidado, seção 9",
        summary: "Canal com o seu profissional responsável.",
        needs:
          "Provedor de envio escolhido; notificações não carregam dados sensíveis no corpo.",
      }),
      planned("conta", "Minha conta", "user", {
        epic: "E4",
        reference: "Projeto consolidado, seção 9",
        summary: "Dados básicos, consentimentos, segurança e solicitações.",
        needs: "Política de consentimento e fluxos de exportação e exclusão.",
      }),
    ],
  },
];

const NAVIGATION: Record<SurfaceId, NavGroup[]> = {
  gestor,
  profissional,
  aluno,
};

export const navigationFor = (surface: SurfaceId): NavGroup[] =>
  NAVIGATION[surface];

export function findPlanned(surface: SurfaceId, slug: string): NavItem | null {
  for (const group of NAVIGATION[surface])
    for (const item of group.items)
      if (item.slug === slug && item.status === "planned") return item;
  return null;
}
