import { SITE_MODELS_V1 } from "@/modules/meu-site/models";
import type { PageModels, TemplateGroup } from "./protocol";
import { siteModelPage } from "./site-model-blocks";

/** The name of a model's page in the gallery: the editor sends it back to make the page. */
const PAGE_PREFIX = "modelo-";

/**
 * The four site models of the Editor Guiado (handoff "Templates de Sites — CMS V1") as the page models of the Editor Avançado's "Novo"
 * gallery. They are made from the same documents as the Editor Guiado's, converted to blocks when a page is made (site-model-blocks.ts),
 * so there is one source for both editors. `files` is where the app's own files are for this request (the mount path comes with it), for the
 * pictures of the cards; `siteTitle` is the name in the page's header; `whatsapp` the number the WhatsApp buttons go to, when the
 * organization has one written (otherwise they go to the contact part of the page, never to a made-up number).
 */
export function pageModels(options: { files: string; siteTitle: string; whatsapp: () => Promise<string | null> }): PageModels {
  return {
    groups(): TemplateGroup[] {
      return SITE_MODELS_V1.map((model) => {
        const thumbnail = `${options.files}site-models/thumb-${model.key}.webp`;
        return {
          name: model.key,
          title: model.label,
          description: model.hint,
          preview: thumbnail,
          thumbnail,
          categories: ["Modelos do site"],
          pages: [
            {
              name: `${PAGE_PREFIX}${model.key}`,
              page_title: model.label,
              preview: thumbnail,
              thumbnail,
              // The preview of the gallery: the page this model becomes, drawn by the app (profissional/meu-site/modelo-avancado/<key>).
              live_url: `${options.files}profissional/meu-site/modelo-avancado/${model.key}`,
              template_group: model.key,
            },
          ],
        };
      });
    },
    async page(name: string) {
      const model = name.startsWith(PAGE_PREFIX) ? SITE_MODELS_V1.find((entry) => `${PAGE_PREFIX}${entry.key}` === name) : undefined;
      if (!model) return null;
      return { title: model.label, root: siteModelPage(model, options.siteTitle, { whatsapp: await options.whatsapp() }) };
    },
  };
}
