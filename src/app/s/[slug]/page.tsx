import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { publishedSiteBySlug } from "@/db/sites";
import { publicImages } from "@/modules/meu-site/image-urls";
import { SiteRenderer } from "@/modules/meu-site/renderer";

// A page that is public, for anybody: no session, no cookies read, nothing of the tool around it. What it
// shows is the release the pointer names; an address that does not exist, a page never published and one
// taken offline answer the same 404. Not cached: taking a page offline must take effect at once.
export const dynamic = "force-dynamic";

async function load(slug: string) {
  const { env } = await getCloudflareContext({ async: true });
  return publishedSiteBySlug(env.DB, slug);
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const site = await load((await params).slug);
  if (!site) return { title: "Página não encontrada", robots: { index: false, follow: false } };
  return {
    title: { absolute: site.content.title },
    description: site.content.description || undefined,
    robots: { index: true, follow: true },
  };
}

export default async function PublicSite({ params }: { params: Promise<{ slug: string }> }) {
  const site = await load((await params).slug);
  if (!site) notFound();
  return <SiteRenderer content={site.content} images={publicImages(process.env.NEXT_PUBLIC_BASE_PATH || "", site.slug, site.images)} />;
}
