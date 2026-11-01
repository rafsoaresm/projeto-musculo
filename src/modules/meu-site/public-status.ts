/**
 * What a visitor can see of a site, in one place (handoff V4, defect 2 of the review and AC18.9): every screen that says "no ar" or
 * "fora do ar" asks this. A site is on the air when any public address answers with a page: the guided editor's version at `/s/<address>`,
 * or a published page of the advanced editor at `/site/<address>`, which answers whatever editor the main address shows.
 */
export type SiteEngineName = "native" | "frappe";

export interface PublicStatusInput {
  engine: SiteEngineName;
  /** The guided editor has a published version (`site_published`). */
  guidedLive: boolean;
  /** Pages of the advanced editor published right now. */
  advancedPublished: number;
}

export interface PublicStatus {
  live: boolean;
  /** Short label for a badge: "Publicado" or "Site em rascunho" (Figma 10:76 and 10:119). */
  label: string;
  /** One sentence that says which addresses answer. */
  detail: string;
}

export function publicStatus({ engine, guidedLive, advancedPublished }: PublicStatusInput): PublicStatus {
  const advanced = advancedPublished > 0;
  if (!guidedLive && !advanced) return { live: false, label: "Site em rascunho", detail: "Ninguém vê o site até você publicar." };
  if (engine === "frappe" || !guidedLive)
    return {
      live: true,
      label: "Publicado",
      detail:
        engine === "frappe"
          ? `${advancedPublished === 1 ? "1 página publicada" : `${advancedPublished} páginas publicadas`} no Editor Avançado.`
          : `O endereço principal está fora do ar, mas ${advancedPublished === 1 ? "1 página do Editor Avançado continua publicada" : `${advancedPublished} páginas do Editor Avançado continuam publicadas`} e podem ser abertas pelo endereço direto.`,
    };
  return {
    live: true,
    label: "Publicado",
    detail: advanced
      ? `A versão do Editor Guiado está no ar, e ${advancedPublished === 1 ? "1 página do Editor Avançado também está publicada" : `${advancedPublished} páginas do Editor Avançado também estão publicadas`}.`
      : "A versão do Editor Guiado está no ar.",
  };
}
