import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { publishedSiteBySlug, siteEngineBySlug } from "@/db/sites";
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
  const { slug } = await params;
  const { env } = await getCloudflareContext({ async: true });
  // The site was put in the new editor: the main address leads to its pages (the first editor's versions stay stored, unshown).
  if ((await siteEngineBySlug(env.DB, slug)) === "frappe") redirect(`/site/${slug}`);
  const site = await load(slug);
  if (!site) notFound();
  return <PublicSitePage site={site} pageId={HOME} gate={formsGate(env, process.env)} />;
}
