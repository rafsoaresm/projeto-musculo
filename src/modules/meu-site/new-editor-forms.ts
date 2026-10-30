import type { D1Database } from "@cloudflare/workers-types";
import { publicBuilderPage } from "@/db/builder-public";
import { describeForm } from "@/modules/frappe-site/form";
import { contentOfPage } from "@/modules/frappe-site/public-page";

/** A form on a page that is on the air, as the panel of Meu Site tells it. */
export interface PanelForm {
  /** The route of the page ("" for a page with no route), and its title. */
  route: string;
  title: string;
  /** What the form holds, in a line. */
  summary: string;
  /** What it still lacks to receive messages; empty when it is ready. */
  problems: string[];
  /** Controls in it that are not used, and why. */
  ignored: string[];
}

/** The free code of one page on the air, as the panel of Meu Site tells it. */
export interface PanelCode {
  route: string;
  title: string;
  /** How many blocks of free code the page has, and how many of them ask for something outside the site. */
  blocks: number;
  external: number;
}

/** More pages than this are not read here (each one is drawn to be read); the panel says so. */
export const PANEL_PAGES_MAX = 20;

/**
 * What the pages the new editor has on the air hold that the panel reports: their forms and their free code, each read the way the public page
 * reads it (the published page, with its components). A page is read once for both. Only published pages, as visitors see them.
 */
export async function contentOnTheAir(
  db: D1Database,
  slug: string,
  pages: Array<{ name: string; route: string; title: string }>,
): Promise<{ forms: PanelForm[]; code: PanelCode[]; skipped: number }> {
  const forms: PanelForm[] = [];
  const code: PanelCode[] = [];
  for (const page of pages.slice(0, PANEL_PAGES_MAX)) {
    const found = await publicBuilderPage(db, slug, page.route, page.name);
    if (!found) continue;
    const content = contentOfPage(found);
    for (const definition of content.forms) {
      forms.push({ route: found.route, title: page.title, summary: describeForm(definition), problems: definition.problems, ignored: definition.ignored });
    }
    if (content.code.length > 0) code.push({ route: found.route, title: page.title, blocks: content.code.length, external: content.code.filter((block) => block.external).length });
  }
  return { forms, code, skipped: Math.max(0, pages.length - PANEL_PAGES_MAX) };
}

/** The forms of the pages on the air (see `contentOnTheAir`). */
export async function formsOnTheAir(db: D1Database, slug: string, pages: Array<{ name: string; route: string; title: string }>): Promise<{ forms: PanelForm[]; skipped: number }> {
  const { forms, skipped } = await contentOnTheAir(db, slug, pages);
  return { forms, skipped };
}
