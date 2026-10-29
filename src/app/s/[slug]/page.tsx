import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { publishedSiteBySlug } from "@/db/sites";
import { HOME } from "@/modules/meu-site/contracts";
import { PublicSitePage, formsGate, publicMetadata } from "@/modules/meu-site/public-site";

// A page that is public, for anybody: no session, no cookies read, nothing of the tool around it. What it
// shows is the release the pointer names; an address that does not exist, a page never published and one
// taken offline answer the same 404. Not cached: taking a page offline must take effect at once.
export const dynamic = "force-dynamic";

async function load(slug: string) {
  const { env } = await getCloudflareContext({ async: true });
  return publishedSiteBySlug(env.DB, slug);
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  return publicMetadata(await load((await params).slug), HOME);
}

export default async function PublicSite({ params }: { params: Promise<{ slug: string }> }) {
  const site = await load((await params).slug);
  if (!site) notFound();
  const { env } = await getCloudflareContext({ async: true });
  return <PublicSitePage site={site} pageId={HOME} gate={formsGate(env, process.env)} />;
}
