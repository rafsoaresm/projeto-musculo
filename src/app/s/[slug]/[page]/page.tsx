import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { publishedSiteBySlug } from "@/db/sites";
import { pagesOf } from "@/modules/meu-site/contracts";
import { PublicSitePage, publicMetadata } from "@/modules/meu-site/public-site";

// Another page of a published site, at `/s/<slug>/<page>`: the same release as the home page, found by the address the person gave it. The
// stylesheet (`estilo.css`) and the images (`m/`) have routes of their own below the site, which win over this one. An address that is not a
// page of the site, a site never published and one taken offline answer the same 404.
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string; page: string }> };

async function load({ params }: Params) {
  const { slug, page } = await params;
  const { env } = await getCloudflareContext({ async: true });
  const site = await publishedSiteBySlug(env.DB, slug);
  const found = site ? pagesOf(site.content).find((entry) => entry.slug === page) : undefined;
  return { site, found };
}

export async function generateMetadata(props: Params): Promise<Metadata> {
  const { site, found } = await load(props);
  return publicMetadata(site, found?.id ?? "");
}

export default async function PublicSubpage(props: Params) {
  const { site, found } = await load(props);
  if (!site || !found) notFound();
  return <PublicSitePage site={site} pageId={found.id} />;
}
