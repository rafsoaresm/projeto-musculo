import type { Metadata } from "next";
import { requireWorkspace } from "@/modules/auth/server";
import { sitesFor } from "@/db/sites";
import { Notice, PageHeading } from "@/components/ui";
import { canEditSite, canSeeSite } from "@/modules/meu-site/access";
import { slugFromName } from "@/modules/meu-site/contracts";
import { CreateSite } from "@/modules/meu-site/create-site";
import { SiteWorkspace } from "@/modules/meu-site/site-workspace";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Meu Site" };

export default async function MySite() {
  const { db, context, workspace } = await requireWorkspace();
  if (!canSeeSite(workspace.role))
    return (
      <>
        <PageHeading eyebrow={workspace.name} title="Meu Site" />
        <Notice>
          <p>O seu papel neste espaço não vê o site. Ele fica com o proprietário, a gestão e o comercial.</p>
        </Notice>
      </>
    );
  const overview = await sitesFor(db, context).overview();
  const canEdit = canEditSite(workspace.role);
  return (
    <>
      <PageHeading
        eyebrow={workspace.name}
        title="Meu Site"
        description="A página pública do seu trabalho: você arrasta os blocos no editor visual, confere na prévia e publica quando quiser."
      />
      {overview ? (
        <SiteWorkspace
          slug={overview.site.slug}
          initial={overview.draft}
          live={overview.live}
          releases={overview.releases}
          services={overview.services}
          canEdit={canEdit}
        />
      ) : canEdit ? (
        <section className="panel" aria-labelledby="criar-site">
          <h2 id="criar-site">Crie a sua página</h2>
          <p className="muted">
            Comece com um título e um endereço. O site nasce como rascunho: ninguém o vê até você publicar, e só entra o que você escrever.
          </p>
          <CreateSite suggestedSlug={slugFromName(workspace.name)} suggestedTitle={workspace.name} />
        </section>
      ) : (
        <Notice>
          <p>O espaço ainda não tem um site. Só o proprietário ou a gestão criam.</p>
        </Notice>
      )}
    </>
  );
}
