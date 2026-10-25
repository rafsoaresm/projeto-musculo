/**
 * The terms a person accepts once, when joining the tool. The wording lives here, in code; the
 * database keeps the version and the SHA-256 of the exact text that was accepted. Changing any word
 * means a new version, and the next access of everyone asks for the new acceptance.
 *
 * THIS TEXT IS A DRAFT. It was written from what the product does, to be reviewed by a lawyer before
 * real people use the tool. While the version says "rascunho", it is not a reviewed legal text.
 */
export type Audience = "PROFESSIONAL" | "STUDENT";

export const TERMS_VERSION = "2026-10-25-rascunho-2";
export const TERMS_ARE_DRAFT = TERMS_VERSION.includes("rascunho");

export interface Terms {
  audience: Audience;
  title: string;
  intro: string;
  sections: Array<{ heading: string; text: string }>;
  /** The required acknowledgement, said by the person. */
  confirmation: string;
  /** Only for students: a separate, optional choice inside the same acceptance. */
  photos?: { heading: string; text: string; label: string };
}

export const TERMS: Record<Audience, Terms> = {
  STUDENT: {
    audience: "STUDENT",
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
    audience: "PROFESSIONAL",
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

/** The exact words accepted, in a fixed order, so that two readings of the same version hash the same. */
export function canonicalText(audience: Audience): string {
  const terms = TERMS[audience];
  const parts = [terms.title, terms.intro];
  for (const section of terms.sections) parts.push(section.heading, section.text);
  parts.push(terms.confirmation);
  if (terms.photos) parts.push(terms.photos.heading, terms.photos.text, terms.photos.label);
  return `${TERMS_VERSION}\n${audience}\n${parts.join("\n")}`;
}

const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

/** SHA-256 of the exact text of one audience in the current version. */
export async function termsHash(audience: Audience): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalText(audience))));
}
