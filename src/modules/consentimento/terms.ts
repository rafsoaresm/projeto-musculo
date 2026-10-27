/**
 * The terms a person accepts once, when joining the tool. The words in force are chosen by the
 * platform manager (`/gestor/termos`) and kept in the database, one immutable row per version; this
 * file holds the pure parts (the shape, the validation, the hash) and the INITIAL text, which is the
 * one the lawyer approved on 25/10/2026 and which is in force until the manager publishes another.
 *
 * The database keeps, with every acceptance, the version and the SHA-256 of the exact words shown.
 * Changing any word is a new version, and the next access of everyone asks for the new acceptance.
 */
import { z } from "zod";

export type Audience = "PROFESSIONAL" | "STUDENT";

/** The version name of the initial text, approved by the lawyer. Published versions are named by date and time. */
export const BASELINE_VERSION = "2026-10-25-base";

export interface TermsContent {
  title: string;
  intro: string;
  sections: Array<{ heading: string; text: string }>;
  /** The required acknowledgement, said by the person. */
  confirmation: string;
  /** Only for students: a separate, optional choice inside the same acceptance. */
  photos?: { heading: string; text: string; label: string };
}

export const BASELINE: Record<Audience, TermsContent> = {
  STUDENT: {
    title: "Termos e aviso de privacidade do aluno",
    intro:
      "Você está entrando na área do aluno de uma ferramenta que o seu profissional usa para acompanhar o seu treino. Leia antes de aceitar. Você aceita uma única vez, ao entrar.",
    sections: [
      {
        heading: "Quem usa os seus dados",
        text: "O seu profissional responsável usa esta ferramenta para planejar, entregar e acompanhar o seu treino. Dentro da ferramenta, só ele vê os seus dados; a equipe que opera a plataforma não tem tela para eles.",
      },
      {
        heading: "Quais dados são guardados",
        text: "Os dados do seu cadastro e da sua ficha, as avaliações que ele registrar (que podem incluir informações de saúde, como lesões, medicamentos e dor), o treino que ele entregar e o que você registrar depois de treinar: séries, cargas, esforço, dor ou desconforto e observações.",
      },
      {
        heading: "Para que servem",
        text: "Só para o seu atendimento: prescrever, acompanhar e ajustar o seu treino. Não são usados para propaganda e não aparecem para outros alunos. A ferramenta não faz diagnóstico e não altera o seu treino sozinha: quem decide é o seu profissional.",
      },
      {
        heading: "Quanto tempo ficam",
        text: "Enquanto você for atendido e por até 5 anos depois, salvo se você pedir a exclusão antes ou se a lei exigir que algum dado seja mantido.",
      },
      {
        heading: "Os seus direitos",
        text: "Você pode pedir ao seu profissional para ver os seus dados, corrigir, exportar ou excluir, e pode retirar o seu aceite. Hoje a ferramenta ainda não tem uma tela para esses pedidos; faça-os diretamente ao seu profissional, que deve responder em até 15 dias.",
      },
      {
        heading: "Idade",
        text: "Este aceite é para quem tem 18 anos completos. Para menores de 18 anos o aceite precisa ser feito por um responsável, e a ferramenta ainda não oferece esse caminho.",
      },
    ],
    confirmation:
      "Tenho 18 anos completos, li e aceito os termos e o aviso de privacidade.",
    photos: {
      heading: "Fotos da sua postura (opcional)",
      text: "Se você autorizar, o seu profissional poderá registrar fotos da sua postura nas avaliações. As fotos ficam em armazenamento privado, só ele as vê, e a ferramenta remove os dados do aparelho (posição, data e modelo) antes de guardar. Depois que a avaliação é registrada, as fotos não mudam. Recusar não impede você de usar nada: o resto funciona igual. Você pode mudar essa escolha quando quiser, em “Minha conta”: retirar a autorização impede fotos novas; sobre as fotos que já foram guardadas, fale com o seu profissional.",
      label: "Autorizo o meu profissional a registrar fotos da minha postura.",
    },
  },
  PROFESSIONAL: {
    title: "Termos de uso do profissional",
    intro:
      "Você está criando o espaço de atendimento em uma ferramenta que guarda dados de saúde dos seus alunos. Leia antes de aceitar. Você aceita uma única vez, ao entrar.",
    sections: [
      {
        heading: "O que a ferramenta é e não é",
        text: "A ferramenta organiza o seu atendimento: cadastro, avaliações, prescrição e acompanhamento. Ela não faz diagnóstico e não aprova nem libera treino: aprovar e entregar são atos seus, e nenhuma regra automática os substitui. O que você prescreve é de sua responsabilidade técnica.",
      },
      {
        heading: "Os dados dos seus alunos",
        text: "Você é o responsável pelos dados dos alunos que cadastra. Registre só o que é necessário para o atendimento e use-os só para ele. Dados de saúde e fotos não devem ser exportados nem usados para outro fim.",
      },
      {
        heading: "O aceite do aluno",
        text: "Convide o aluno pelo link da ferramenta: é ali que ele lê e aceita o uso dos dados dele e decide sobre as fotos. Não registre dados de saúde nem fotos de quem não aceitou, e não cadastre menores de 18 anos sem o aceite de um responsável.",
      },
      {
        heading: "Pedidos do aluno",
        text: "Quando um aluno pedir para ver, corrigir, exportar ou excluir os dados dele, ou retirar o aceite, você deve atender em até 15 dias. Hoje a ferramenta ainda não tem uma tela para esses pedidos.",
      },
      {
        heading: "A sua conta",
        text: "A conta é pessoal: não compartilhe a senha. Ainda não existe recuperação de senha por e-mail, então guarde-a em um lugar seguro.",
      },
    ],
    confirmation: "Li e aceito os termos de uso.",
  },
};

/**
 * The exact words accepted, in a fixed, unambiguous form (JSON with every part in its place), so that
 * two readings of the same version hash the same and no two different texts can read alike.
 */
export function canonicalText(audience: Audience, version: string, content: TermsContent): string {
  return JSON.stringify({
    version,
    audience,
    title: content.title,
    intro: content.intro,
    sections: content.sections.map((section) => [section.heading, section.text]),
    confirmation: content.confirmation,
    photos: content.photos ? [content.photos.heading, content.photos.text, content.photos.label] : null,
  });
}

const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

/** SHA-256 of the exact text of one audience in one version. */
export async function termsHash(audience: Audience, version: string, content: TermsContent): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalText(audience, version, content))));
}

/** What the person is shown and what they send back: the version they read. Plain data, safe for the browser. */
export interface ShownTerms {
  audience: Audience;
  version: string;
  content: TermsContent;
}

/** The text in force with the proof of it. Where it came from is the manager's to see, not the signer's. */
export interface ResolvedTerms extends ShownTerms {
  sha256: string;
  source: "BASELINE" | "PUBLISHED";
  publishedAt: string | null;
}

// A line break is one character whatever the browser, so the same words always hash the same.
const line = (min: number, max: number) =>
  z
    .string()
    .transform((value) => value.replace(/\r\n?/g, "\n"))
    .pipe(z.string().trim().min(min).max(max));
const sectionSchema = z.object({ heading: line(1, 120), text: line(1, 4000) }).strict();
const photosSchema = z.object({ heading: line(1, 120), text: line(1, 4000), label: line(1, 300) }).strict();
const contentSchema = z
  .object({
    title: line(1, 120),
    intro: line(1, 3000),
    sections: z.array(sectionSchema).min(1).max(20),
    confirmation: line(1, 300),
    photos: photosSchema.optional(),
  })
  .strict();

/**
 * Validates words typed by the manager. The student's terms must keep the photos block (the optional
 * choice of the acceptance lives there) and the professional's must not have one. Throws a ZodError.
 */
export function parseTermsContent(audience: Audience, raw: unknown): TermsContent {
  const parsed = contentSchema
    .superRefine((value, context) => {
      if (audience === "STUDENT" && !value.photos)
        context.addIssue({ code: "custom", path: ["photos"], message: "PHOTOS_BLOCK_REQUIRED" });
      if (audience === "PROFESSIONAL" && value.photos)
        context.addIssue({ code: "custom", path: ["photos"], message: "PHOTOS_BLOCK_NOT_ALLOWED" });
      const headings = value.sections.map((section) => section.heading);
      if (new Set(headings).size !== headings.length)
        context.addIssue({ code: "custom", path: ["sections"], message: "SECTION_HEADING_DUPLICATE" });
    })
    .parse(raw);
  const content: TermsContent = {
    title: parsed.title,
    intro: parsed.intro,
    sections: parsed.sections,
    confirmation: parsed.confirmation,
  };
  if (parsed.photos) content.photos = parsed.photos;
  return content;
}

/**
 * The words of a draft: the same shape and size limits as the text to be published, but fields may be
 * empty and nothing is trimmed, so what the manager typed comes back as typed. Whether it is fit to
 * publish is decided later, by `parseTermsContent`. Throws a ZodError.
 */
const draftLine = (max: number) =>
  z
    .string()
    .transform((value) => value.replace(/\r\n?/g, "\n"))
    .pipe(z.string().max(max));
const draftSchema = z
  .object({
    title: draftLine(120),
    intro: draftLine(3000),
    sections: z.array(z.object({ heading: draftLine(120), text: draftLine(4000) }).strict()).min(1).max(20),
    confirmation: draftLine(300),
    photos: z.object({ heading: draftLine(120), text: draftLine(4000), label: draftLine(300) }).strict().optional(),
  })
  .strict();
export type TermsDraftContent = z.infer<typeof draftSchema>;

/** The largest draft the table accepts (characters of its JSON). */
export const DRAFT_MAX_CHARACTERS = 60000;

export function parseDraftContent(audience: Audience, raw: unknown): TermsDraftContent {
  const parsed = draftSchema
    .superRefine((value, context) => {
      if (audience === "PROFESSIONAL" && value.photos)
        context.addIssue({ code: "custom", path: ["photos"], message: "PHOTOS_BLOCK_NOT_ALLOWED" });
    })
    .parse(raw);
  const content: TermsDraftContent = {
    title: parsed.title,
    intro: parsed.intro,
    sections: parsed.sections,
    confirmation: parsed.confirmation,
  };
  if (parsed.photos) content.photos = parsed.photos;
  if (JSON.stringify(content).length > DRAFT_MAX_CHARACTERS)
    throw new z.ZodError([{ code: "custom", path: [], message: "DRAFT_TOO_LARGE" }]);
  return content;
}

/** The same words, whatever the object identity. */
export const sameContent = (a: TermsContent, b: TermsContent) =>
  canonicalText("STUDENT", "", a) === canonicalText("STUDENT", "", b);

/**
 * A plain list of what differs between two texts, for the manager to read before publishing: which
 * part, and whether it was changed, added or removed. Sections are matched by heading, so moving one
 * is a change of order, and renaming one reads as a removal plus an addition.
 */
export function changedParts(before: TermsContent, after: TermsContent): string[] {
  const out: string[] = [];
  if (before.title !== after.title) out.push("Título alterado");
  if (before.intro !== after.intro) out.push("Introdução alterada");
  const was = new Map(before.sections.map((section) => [section.heading, section.text]));
  const now = new Map(after.sections.map((section) => [section.heading, section.text]));
  for (const [heading, text] of now) {
    if (!was.has(heading)) out.push(`Seção «${heading}» adicionada`);
    else if (was.get(heading) !== text) out.push(`Seção «${heading}» alterada`);
  }
  for (const heading of was.keys()) if (!now.has(heading)) out.push(`Seção «${heading}» removida`);
  const keptBefore = before.sections.map((section) => section.heading).filter((heading) => now.has(heading));
  const keptAfter = after.sections.map((section) => section.heading).filter((heading) => was.has(heading));
  if (keptBefore.join("\n") !== keptAfter.join("\n")) out.push("Ordem das seções alterada");
  if (before.confirmation !== after.confirmation) out.push("Frase de confirmação alterada");
  if (JSON.stringify(before.photos ?? null) !== JSON.stringify(after.photos ?? null)) out.push("Bloco das fotos alterado");
  return out;
}
