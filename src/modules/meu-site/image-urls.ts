import type { ImageResolver } from "./renderer";
import type { CssContext } from "./style";

/**
 * Where an image is served from. Two places, for two audiences, and the page never mixes them: the public one, under the
 * address of the page, answers only for an image a published version uses; the editor's one needs a login. `base` is the
 * mount path of the app ("" or "/treinador"): a plain `<img>` is not prefixed by the framework.
 */
export const publicImageUrl = (base: string, slug: string, assetId: string) => `${base}/s/${slug}/m/${assetId}`;
export const editorImageUrl = (base: string, assetId: string) => `${base}/profissional/meu-site/imagens/${assetId}`;
/** The stylesheet of a published page, from the page's own address; `version` (the number of the release) only keeps an old copy from being reused. */
export const publicStyleUrl = (base: string, slug: string, version: number) => `${base}/s/${slug}/estilo.css?v=${version}`;

type Dimensions = { width: number; height: number };

/** The images of a published page, as the renderer asks for them. */
export const publicImages =
  (base: string, slug: string, images: Record<string, Dimensions>): ImageResolver =>
  (assetId) => {
    const found = images[assetId];
    return found ? { src: publicImageUrl(base, slug, assetId), width: found.width, height: found.height } : null;
  };

/** The images of the library, for the editor and the preview. */
export const libraryImages =
  (base: string, library: ReadonlyArray<{ id: string } & Dimensions>): ImageResolver =>
  (assetId) => {
    const found = library.find((asset) => asset.id === assetId);
    return found ? { src: editorImageUrl(base, assetId), width: found.width, height: found.height } : null;
  };

/** The addresses the stylesheet may use for a background image: the same ones as the page's own images, nothing else. */
export const publicCssImages = (base: string, slug: string, images: Record<string, Dimensions>): CssContext => ({
  imageUrl: (assetId) => (images[assetId] ? publicImageUrl(base, slug, assetId) : null),
});
export const libraryCssImages = (base: string, library: ReadonlyArray<{ id: string }>): CssContext => ({
  imageUrl: (assetId) => (library.some((asset) => asset.id === assetId) ? editorImageUrl(base, assetId) : null),
});
