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
import { contentOnTheAir } from "@/modules/meu-site/new-editor-forms";
import { SiteHeader } from "@/modules/meu-site/site-header";
import { SiteTabs, siteTabFrom } from "@/modules/meu-site/site-tabs";
import { publicStatus } from "@/modules/meu-site/public-status";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Meu Site" };

export default async function MySite({ searchParams }: { searchParams: Promise<{ editar?: string; aba?: string }> }) {
  const params = await searchParams;
  const startEditing = params.editar === "1";
  const tab = startEditing ? "paginas" : siteTabFrom(params.aba);
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
  const onTheAir = overview ? await contentOnTheAir(env.DB, overview.site.slug, overview.newEditor.published) : { forms: [], code: [], skipped: 0 };
  const status = overview ? publicStatus({ engine: overview.site.engine, guidedLive: overview.live !== null, advancedPublished: overview.newEditor.published.length }) : null;
  const advanced = (part: "pages" | "forms" | "settings") =>
    overview && (
      <NewEditorPanel
        part={part}
        slug={overview.site.slug}
        engine={overview.site.engine}
        engineFixed={overview.site.engineFixed}
        published={overview.newEditor.published}
        pages={overview.newEditor.pages}
        waiting={overview.inquiries.waiting}
        forms={{ forms: onTheAir.forms, skipped: onTheAir.skipped }}
        code={{ pages: onTheAir.code, networkOpen: overview.code.externalOpen }}
        inquiries={{ open: overview.inquiries.open, platformOpen, canWork: canWorkLeads(workspace.role) }}
        canEdit={canEdit}
      />
    );
  return (
    <>
      {!overview && canEdit ? (
        <PageHeading title="Crie seu site profissional" description="Escolha a forma de criação que melhor combina com seu trabalho." />
      ) : (
        <PageHeading
          title="Meu Site"
          description={overview?.site.engine === "frappe" ? "Gerencie o site criado com o Frappe Builder." : "Gerencie seu site e seu conteúdo a partir de um único lugar."}
        />
      )}
      {overview && <SiteHeader overview={overview} canEdit={canEdit} />}
      {overview && overview.site.engine === "frappe" ? (
        <SiteTabs
          initial={tab}
          panels={{
            paginas: (
              <div className="tab-grid">
                {advanced("pages")}
                <section className="panel" aria-labelledby="sobre-edicao">
                  <h2 id="sobre-edicao">Sobre a edição</h2>
                  <p className="small">
                    {overview.site.engineFixed
                      ? "As páginas são editadas no Frappe Builder. Usar o outro editor neste mesmo projeto não é permitido."
                      : "Este site foi criado antes da escolha fixa do editor. O site do editor anterior continua guardado; a troca, enquanto existir, fica em Configurações."}
                  </p>
                </section>
              </div>
            ),
            publicacao: (
              <section className="panel" aria-labelledby="publicacao-avancado">
                <h2 id="publicacao-avancado">Publicação</h2>
                <p>{status?.detail}</p>
                <p className="small muted">
                  Cada página é publicada no Frappe Builder, pelo botão <strong>Publish</strong>, e sai do ar pelo próprio editor.
                </p>
                {canEdit && (
                  <p>
                    <Link className="button secondary" href="/profissional/meu-site/editor" prefetch={false}>
                      Abrir Frappe Builder
                    </Link>
                  </p>
                )}
              </section>
            ),
            formularios: advanced("forms"),
            configuracoes: advanced("settings"),
          }}
        />
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
          startEditing={startEditing}
          initialTab={tab}
          engineFixed={overview.site.engineFixed}
          extra={{
            // A site made before the fixed choice may still hold pages of the advanced editor: they stay visible until the decision about it.
            pages: overview.site.engineFixed ? undefined : advanced("pages"),
            forms: overview.site.engineFixed ? undefined : advanced("forms"),
            settings: advanced("settings"),
          }}
        />
      ) : canEdit ? (
        <CreateSite suggestedSlug={slugFromName(workspace.name)} suggestedTitle={workspace.name} />
      ) : (
        <Notice>
          <p>O espaço ainda não tem um site. Só o proprietário ou a gestão criam.</p>
        </Notice>
      )}
    </>
  );
}
