import type { Metadata } from "next";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireWorkspace } from "@/modules/auth/server";
import { getSiteMediaBucket } from "@/db/binding";
import { siteAssetsFor } from "@/db/site-assets";
import { sitesFor } from "@/db/sites";
import { Notice, PageHeading } from "@/components/ui";
import { canEditSite, canSeeSite } from "@/modules/meu-site/access";
import { slugFromName } from "@/modules/meu-site/contracts";
import { formsGate } from "@/modules/meu-site/inquiries";
import { canWorkLeads } from "@/modules/leads/access";
import { CreateSite } from "@/modules/meu-site/create-site";
import { SiteWorkspace } from "@/modules/meu-site/site-workspace";
import { NewEditorPanel } from "@/modules/meu-site/new-editor-panel";

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
  const bucket = await getSiteMediaBucket();
  const library = overview ? await siteAssetsFor(db, bucket, context).list() : [];
  const { env } = await getCloudflareContext({ async: true });
  const platformOpen = formsGate(env, process.env).open;
  return (
    <>
      <PageHeading
        eyebrow={workspace.name}
        title="Meu Site"
        description="A página pública do seu trabalho: você arrasta os blocos no editor visual, confere na prévia e publica quando quiser."
      />
      {overview && (
        <NewEditorPanel
          slug={overview.site.slug}
          engine={overview.site.engine}
          published={overview.newEditor.published}
          pages={overview.newEditor.pages}
          waiting={overview.inquiries.waiting}
          canEdit={canEdit}
        />
      )}
      {overview && overview.site.engine === "frappe" ? (
        <Notice>
          <p>O site do editor anterior continua guardado. Use “Voltar ao editor anterior” acima para editá-lo ou publicá-lo de novo.</p>
        </Notice>
      ) : overview ? (
        <SiteWorkspace
          slug={overview.site.slug}
          initial={overview.draft}
          live={overview.live}
          releases={overview.releases}
          services={overview.services}
          images={{ available: bucket !== null, library }}
          inquiries={{ ...overview.inquiries, platformOpen, canWork: canWorkLeads(workspace.role) }}
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
