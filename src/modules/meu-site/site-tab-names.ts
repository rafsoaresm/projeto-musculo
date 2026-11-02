/**
 * The tabs of the management of the site, apart from the component that draws them: the server page reads `?aba=` with `siteTabFrom`, and a
 * function of a client module cannot be called on the server.
 */
export const SITE_TABS = ["paginas", "publicacao", "formularios", "configuracoes"] as const;
export type SiteTab = (typeof SITE_TABS)[number];
export const SITE_TAB_LABEL: Record<SiteTab, string> = {
  paginas: "Páginas",
  publicacao: "Publicação",
  formularios: "Formulários e mensagens",
  configuracoes: "Configurações",
};

/** The tab an address asks for; anything unknown opens "Páginas". */
export const siteTabFrom = (value: string | undefined): SiteTab => ((SITE_TABS as readonly string[]).includes(value ?? "") ? (value as SiteTab) : "paginas");
