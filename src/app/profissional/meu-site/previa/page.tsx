import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireWorkspace } from "@/modules/auth/server";
import { getSiteMediaBucket } from "@/db/binding";
import { siteAssetsFor } from "@/db/site-assets";
import { sitesFor } from "@/db/sites";
import { Notice, PageHeading } from "@/components/ui";
import { canSeeSite } from "@/modules/meu-site/access";
import { libraryCssImages, libraryImages } from "@/modules/meu-site/image-urls";
import { SiteRenderer } from "@/modules/meu-site/renderer";
import { buildSiteCss } from "@/modules/meu-site/site-css";
import { InlineSiteStyles } from "@/modules/meu-site/site-styles";

export const dynamic = "force-dynamic";
// The preview is for the person editing: nobody indexes it, and nothing here is cached.
export const metadata: Metadata = { title: "Prévia do site", robots: { index: false, follow: false } };

export default async function SitePreview() {
  const { db, context, workspace } = await requireWorkspace();
  if (!canSeeSite(workspace.role)) redirect("/profissional/meu-site");
  const preview = await sitesFor(db, context).preview();
  if (!preview) redirect("/profissional/meu-site");
  const library = await siteAssetsFor(db, await getSiteMediaBucket(), context).list();
  return (
    <>
      <PageHeading
        eyebrow="Meu Site"
        title="Prévia do rascunho"
        description="É assim que a página aparece com o que está salvo no rascunho. Ninguém vê esta tela."
        aside={
          <Link className="button secondary" href="/profissional/meu-site">
            <ArrowLeft size={20} />
            Voltar ao editor
          </Link>
        }
      />
      <Notice>
        <p>Prévia: os botões de contato funcionam, mas o site só vai ao ar quando você publicar. O que ainda não foi salvo no editor não aparece aqui.</p>
      </Notice>
      <div className="site-preview" aria-label="Prévia da página">
        <InlineSiteStyles css={buildSiteCss(preview.content, libraryCssImages(process.env.NEXT_PUBLIC_BASE_PATH || "", library))} />
        <SiteRenderer content={preview.content} images={libraryImages(process.env.NEXT_PUBLIC_BASE_PATH || "", library)} />
      </div>
    </>
  );
}
