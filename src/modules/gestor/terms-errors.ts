import { ZodError } from "zod";

/** What to tell the manager when the words they typed cannot be published. Never the raw error. */
export function termsErrorMessage(error: unknown): string {
  if (error instanceof ZodError) {
    const custom = error.issues.map((issue) => issue.message);
    if (custom.includes("PHOTOS_BLOCK_REQUIRED"))
      return "O texto do aluno precisa manter o bloco das fotos: é ali que ele escolhe, se quiser, autorizar as fotos.";
    if (custom.includes("PHOTOS_BLOCK_NOT_ALLOWED")) return "O texto do profissional não tem bloco de fotos.";
    if (custom.includes("SECTION_HEADING_DUPLICATE")) return "Duas seções têm o mesmo título. Dê um título diferente a cada uma.";
    return "Confira os campos: nenhum pode ficar vazio, e há um limite de tamanho para cada texto (títulos até 120 caracteres, textos até 4000).";
  }
  if (error instanceof Error && error.message === "TERMS_DRAFT_UNREADABLE")
    return "O rascunho salvo não pôde ser lido. Descarte-o e comece de novo.";
  if (error instanceof Error && error.message === "TERMS_NOTE_TOO_LONG") return "O motivo da alteração pode ter até 500 caracteres.";
  if (error instanceof Error && error.message === "PLATFORM_ACTION_FORBIDDEN") return "Somente o gestor da plataforma publica os termos.";
  return "Não foi possível publicar. Tente novamente.";
}

/** What to tell the manager when a draft cannot be saved. A draft may be incomplete, so only size and shape matter. */
export function draftErrorMessage(error: unknown): string {
  if (error instanceof ZodError) {
    if (error.issues.some((issue) => issue.message === "PHOTOS_BLOCK_NOT_ALLOWED")) return "O texto do profissional não tem bloco de fotos.";
    if (error.issues.some((issue) => issue.message === "DRAFT_TOO_LARGE"))
      return "O rascunho ficou grande demais para ser salvo. Encurte algum texto.";
    return "Algum campo passou do limite de tamanho (títulos até 120 caracteres, textos até 4000). Encurte e salve de novo.";
  }
  if (error instanceof Error && error.message === "PLATFORM_ACTION_FORBIDDEN") return "Somente o gestor da plataforma edita os termos.";
  return "Não foi possível salvar o rascunho. Tente novamente.";
}
