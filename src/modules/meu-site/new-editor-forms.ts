import type { D1Database } from "@cloudflare/workers-types";
import { publicBuilderPage } from "@/db/builder-public";
import { describeForm } from "@/modules/frappe-site/form";
import { formsOfPage } from "@/modules/frappe-site/public-page";

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

/** More pages than this are not read here (each one is drawn to be read); the panel says so. */
export const PANEL_PAGES_MAX = 20;

/**
 * The forms of the pages the new editor has on the air, each read the way the public page and the submission read it (the published page, with its
 * components): so what the panel calls ready is what a visitor can send. Only published pages, as visitors see them.
 */
export async function formsOnTheAir(db: D1Database, slug: string, pages: Array<{ name: string; route: string; title: string }>): Promise<{ forms: PanelForm[]; skipped: number }> {
  const forms: PanelForm[] = [];
  for (const page of pages.slice(0, PANEL_PAGES_MAX)) {
    const found = await publicBuilderPage(db, slug, page.route, page.name);
    if (!found) continue;
    for (const definition of formsOfPage(found)) {
      forms.push({ route: found.route, title: page.title, summary: describeForm(definition), problems: definition.problems, ignored: definition.ignored });
    }
  }
  return { forms, skipped: Math.max(0, pages.length - PANEL_PAGES_MAX) };
}
