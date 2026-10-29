import type { Metadata } from "next";
import type { PublicSite } from "@/db/sites";
import { HOME, pageById, pageContent } from "./contracts";
import { publicCssImages, publicHomeUrl, publicImages, publicPageUrl, publicStyleUrl, type PublicLevel } from "./image-urls";
import { SiteRenderer } from "./renderer";
import { siteNav } from "./site-nav";
import { buildSiteCss } from "./site-css";

/**
 * A page of a published site: the home page (at `/s/<slug>`) or one of the others (at `/s/<slug>/<page>`). Both routes draw it here, so what
 * differs between them is only the address every relative link is written from (see image-urls.ts).
 */
const levelOf = (pageId: string): PublicLevel => (pageId === HOME ? "home" : "page");

export function publicMetadata(site: PublicSite | null, pageId: string): Metadata {
  const page = pageId === HOME ? undefined : pageById(site?.content ?? {}, pageId);
  if (!site || (pageId !== HOME && !page)) return { title: "Página não encontrada", robots: { index: false, follow: false } };
  const title = page ? `${page.title || page.slug} — ${site.content.title}` : site.content.title;
  return {
    title: { absolute: title },
    description: (page?.description || site.content.description) || undefined,
    // The person can ask search engines not to list the site (it stays open to whoever has the address).
    robots: site.content.indexable === false ? { index: false, follow: false } : { index: true, follow: true },
  };
}

export function PublicSitePage({ site, pageId }: { site: PublicSite; pageId: string }) {
  const level = levelOf(pageId);
  // Every address below is relative to this page's (see image-urls.ts): the mount path of the platform comes along by itself.
  // The styles of the blocks come as a sheet from the site's own address (no `style` attribute, no <style> in the page), one for all the pages.
  // A site that has none does not ask for one.
  const hasStyles = buildSiteCss(site.content, publicCssImages(site.images)) !== "";
  const nav = siteNav(site.content, pageId, (target, slug) => (target === HOME ? publicHomeUrl(site.slug, level) : publicPageUrl(site.slug, slug ?? "", level)));
  return (
    <>
      {hasStyles && <link rel="stylesheet" href={publicStyleUrl(site.slug, site.number, level)} precedence="default" />}
      <SiteRenderer content={pageContent(site.content, pageId)} images={publicImages(site.slug, site.images, level)} nav={nav} />
    </>
  );
}
