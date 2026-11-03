/**
 * The tabs of the student's record (handoff V4 T05, Figma `1:111`), apart from the component that draws them: the server page reads `?aba=`
 * with `studentTabFrom`, and a function of a client module cannot be called on the server.
 * The five labels and their order are the Figma frame's; "Acesso e dados" comes from the V4 text, so the invitation, the consent and the
 * requests about the data are not at the top of the record (AC05.4).
 */
export const STUDENT_TABS = ["resumo", "avaliacoes", "periodizacao", "treinos", "evolucao", "acesso"] as const;
export type StudentTab = (typeof STUDENT_TABS)[number];
export const STUDENT_TAB_LABEL: Record<StudentTab, string> = {
  resumo: "Resumo",
  avaliacoes: "Avaliação Física",
  periodizacao: "Periodização",
  treinos: "Treinos",
  evolucao: "Evolução",
  acesso: "Acesso e dados",
};
/** Anchors of sections inside a tab: an old link to `#pedidos` or `#checkins` opens the tab that holds it. */
export const STUDENT_HASH_TABS: Record<string, StudentTab> = { checkins: "evolucao", pedidos: "acesso" };

/** The tab an address asks for; anything unknown opens "Resumo". */
export const studentTabFrom = (value: string | undefined): StudentTab =>
  (STUDENT_TABS as readonly string[]).includes(value ?? "") ? (value as StudentTab) : "resumo";

/** The address of a tab of the record (with an anchor inside it, when given). */
export const studentTabHref = (studentId: string, tab: StudentTab, anchor?: string) =>
  `/profissional/alunos/${studentId}?aba=${tab}${anchor ? `#${anchor}` : ""}`;
