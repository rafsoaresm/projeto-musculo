import type { ImageResolver } from "./renderer";
import type { CssContext } from "./style";

/**
 * Where an image is served from. Two places, for two audiences, and the page never mixes them: the public one, under the
 * address of the page, answers only for an image a published version uses; the editor's one needs a login.
 *
 * A plain `<img>` is not prefixed by the framework, and the server cannot know the mount path ("/app" on Webflow Cloud): the
 * platform applies it when it builds, and the variable this repository's own build keeps for it is empty there. So what the
 * server writes (the published page, its stylesheet, the preview) is relative to the address the browser is already at, and
 * the mount path, whatever it is, comes along. Only the editor, which runs in the browser, builds absolute addresses, from
 * the mount path it reads from the address bar.
 */

/**
 * Where in the published site the page that is being drawn is: the home page is at `<mount>/s/<slug>`, and each of the other pages one level
 * below it, at `<mount>/s/<slug>/<page>`. An address relative to the page is not the same from the two, so the ones below take it.
 */
export type PublicLevel = "home" | "page";

/** From the stylesheet of the published page, which is at `<mount>/s/<slug>/estilo.css` (and from any other page of the site: it is as deep). */
export const publicSheetImageUrl = (assetId: string) => `./m/${assetId}`;
/** From the published page, which is at `<mount>/s/<slug>`. The `./` keeps a slug from being read as the scheme of an address. */
export const publicImageUrl = (slug: string, assetId: string, from: PublicLevel = "home") => (from === "home" ? `./${slug}/m/${assetId}` : publicSheetImageUrl(assetId));
/** The stylesheet of a published page, from the page's own address; `version` (the number of the release) only keeps an old copy from being reused. */
export const publicStyleUrl = (slug: string, version: number, from: PublicLevel = "home") => (from === "home" ? `./${slug}/estilo.css?v=${version}` : `./estilo.css?v=${version}`);
/** The home page of the published site, from the home page or from another page. */
export const publicHomeUrl = (slug: string, from: PublicLevel) => (from === "home" ? `./${slug}` : `../${slug}`);
/** Another page of the published site, from the home page or from another page. */
export const publicPageUrl = (slug: string, pageSlug: string, from: PublicLevel) => (from === "home" ? `./${slug}/${pageSlug}` : `./${pageSlug}`);
/** The pages in the preview, which is at `<mount>/profissional/meu-site/previa` (a page is chosen by `?pagina=`). */
export const previewPageUrl = (pageId: string | null) => (pageId === null ? "./previa" : `./previa?pagina=${encodeURIComponent(pageId)}`);
/** The editor's address, absolute: `base` is the mount path the browser is at ("" or "/app"). */
export const editorImageUrl = (base: string, assetId: string) => `${base}/profissional/meu-site/imagens/${assetId}`;
/** From the preview page, which is at `<mount>/profissional/meu-site/previa`. */
export const previewImageUrl = (assetId: string) => `./imagens/${assetId}`;

type Dimensions = { width: number; height: number };

/** The images of a published page, as the renderer asks for them. */
export const publicImages =
  (slug: string, images: Record<string, Dimensions>, from: PublicLevel = "home"): ImageResolver =>
  (assetId) => {
    const found = images[assetId];
    return found ? { src: publicImageUrl(slug, assetId, from), width: found.width, height: found.height } : null;
  };

/** The images of the library, for the editor (`base`: the mount path the browser is at) and the preview (no `base`: relative to the page). */
export const libraryImages =
  (base: string | null, library: ReadonlyArray<{ id: string } & Dimensions>): ImageResolver =>
  (assetId) => {
    const found = library.find((asset) => asset.id === assetId);
    return found ? { src: base === null ? previewImageUrl(assetId) : editorImageUrl(base, assetId), width: found.width, height: found.height } : null;
  };

/** The addresses the stylesheet may use for a background image: the same ones as the page's own images, nothing else. */
export const publicCssImages = (images: Record<string, Dimensions>): CssContext => ({
  imageUrl: (assetId) => (images[assetId] ? publicSheetImageUrl(assetId) : null),
});
/** Same for the library: the editor's sheet (absolute, `base`) or the preview's (`null`: relative to the page it is written into). */
export const libraryCssImages = (base: string | null, library: ReadonlyArray<{ id: string }>): CssContext => ({
  imageUrl: (assetId) => (library.some((asset) => asset.id === assetId) ? (base === null ? previewImageUrl(assetId) : editorImageUrl(base, assetId)) : null),
});
