import type { Metadata } from "next";
import Link from "next/link";
import { requirePlatformAdmin } from "@/modules/auth/server";
import { currentTerms, termsFor } from "@/db/terms";
import { Notice, PageHeading, Pill, formatDateTime } from "@/components/ui";
import { TermsEditor } from "@/modules/gestor/terms-editor";
import type { Audience } from "@/modules/consentimento/terms";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Termos · Gestor" };

const TABS: Array<{ slug: "aluno" | "profissional"; label: string; audience: Audience }> = [
  { slug: "aluno", label: "Termos do aluno", audience: "STUDENT" },
  { slug: "profissional", label: "Termos do profissional", audience: "PROFESSIONAL" },
];

/**
 * Where the platform manager changes the words people accept when they join. The audience and the
 * version to start from come from the address only as requests: the manager is checked on every read
 * and on every publication.
 */
export default async function Terms({
  searchParams,
}: {
  searchParams: Promise<{ publico?: string; base?: string }>;
}) {
  const { publico, base } = await searchParams;
  const { db, context } = await requirePlatformAdmin();
  const tab = TABS.find((candidate) => candidate.slug === publico) ?? TABS[0];
  const terms = termsFor(db, context);
  const [current, history, draft] = await Promise.all([
    currentTerms(db, tab.audience),
    terms.history(tab.audience),
    terms.draft(tab.audience),
  ]);
  const chosen = base ? history.find((row) => (row.id ?? "inicial") === base) : undefined;
  const startFrom = chosen ? await terms.contentOf(tab.audience, chosen.id) : null;
  const inForce = history[0];
  return (
    <>
      <PageHeading
        eyebrow="PLATAFORMA"
        title="Termos"
        description="O texto que profissionais e alunos leem e aceitam ao entrar. Edite aqui quando for preciso."
      />
      <nav className="terms-tabs" aria-label="Qual texto">
        {TABS.map((candidate) => (
          <Link
            key={candidate.slug}
            href={`/gestor/termos?publico=${candidate.slug}`}
            className={`button ${candidate.slug === tab.slug ? "primary" : "secondary"}`}
            aria-current={candidate.slug === tab.slug ? "page" : undefined}
          >
            {candidate.label}
          </Link>
        ))}
      </nav>
      <Notice>
        <p>
          Trocar qualquer palavra cria uma <strong>nova versão</strong>, e todos aceitam de novo no próximo acesso.
          As versões publicadas não mudam nem somem: o histórico prova o que cada pessoa aceitou. Mudanças de
          conteúdo devem passar pelo responsável jurídico antes de publicar.
        </p>
      </Notice>
      <section className="panel" aria-labelledby="em-vigor">
        <p className="eyebrow">EM VIGOR</p>
        <h2 id="em-vigor">{tab.label}</h2>
        <dl className="detail-list">
          <div>
            <dt>Versão</dt>
            <dd>{current.version}</dd>
          </div>
          <div>
            <dt>Origem</dt>
            <dd>
              {inForce.source === "BASELINE"
                ? "Texto inicial, aprovado pelo advogado em 25/10/2026"
                : `Publicada em ${formatDateTime(inForce.publishedAt ?? "")} por ${inForce.publishedByEmail}`}
            </dd>
          </div>
          <div>
            <dt>Aceites desta versão</dt>
            <dd>{inForce.acceptedBy} pessoas</dd>
          </div>
        </dl>
      </section>
      <section className="panel" aria-labelledby="editar">
        <p className="eyebrow">EDITAR</p>
        <h2 id="editar">Editar: {tab.label.toLowerCase()}</h2>
        {chosen && startFrom && (
          <p className="small muted">
            Começando pelo texto da versão {chosen.version}. As mudanças abaixo são comparadas com o texto em vigor.
          </p>
        )}
        {draft && !chosen && (
          <Notice tone={draft.baseIsCurrent ? "info" : "warning"}>
            <p>
              Continuando o <strong>rascunho salvo</strong> por {draft.updatedByEmail} em {formatDateTime(draft.updatedAt)}.
              {draft.baseIsCurrent
                ? " Ele ainda parte do texto em vigor."
                : " Atenção: o texto em vigor mudou depois que este rascunho foi começado; as diferenças são medidas contra o texto em vigor hoje."}
            </p>
          </Notice>
        )}
        {draft && chosen && (
          <Notice tone="warning">
            <p>
              Existe um <strong>rascunho salvo</strong> por {draft.updatedByEmail}. Salvar um rascunho a partir desta versão o
              substitui. <Link className="account-link" href={`/gestor/termos?publico=${tab.slug}`}>Abrir o rascunho salvo</Link>
            </p>
          </Notice>
        )}
        <TermsEditor
          // The same editor stays mounted when a publication changes the version in force: its message must survive.
          key={`${tab.audience}-${chosen?.version ?? "vigor"}`}
          audience={tab.audience}
          current={current.content}
          initial={startFrom ?? draft?.content ?? current.content}
          acceptedBy={inForce.acceptedBy}
          inForceId={inForce.id}
          draft={{ revision: draft?.revision ?? null, savedAt: draft?.updatedAt ?? null, savedBy: draft?.updatedByEmail ?? null }}
        />
      </section>
      <section className="panel" aria-labelledby="historico">
        <p className="eyebrow">HISTÓRICO</p>
        <h2 id="historico">Versões</h2>
        <div className="table-wrap">
          <table className="data-table stack">
            <caption className="sr-only">Versões do texto, da mais nova para a mais antiga</caption>
            <thead>
              <tr>
                <th scope="col">Versão</th>
                <th scope="col">Quando</th>
                <th scope="col">Quem publicou</th>
                <th scope="col">Motivo</th>
                <th scope="col">Aceites</th>
                <th scope="col">Ação</th>
              </tr>
            </thead>
            <tbody>
              {history.map((row) => (
                <tr key={row.version}>
                  <th scope="row" data-label="Versão">
                    {row.version} {row.current && <Pill tone="success">Em vigor</Pill>}
                  </th>
                  <td data-label="Quando">{row.publishedAt ? formatDateTime(row.publishedAt) : "Texto inicial"}</td>
                  <td data-label="Quem publicou">{row.publishedByEmail ?? "—"}</td>
                  <td data-label="Motivo">{row.changeNote ?? "—"}</td>
                  <td data-label="Aceites">{row.acceptedBy}</td>
                  <td data-label="Ação">
                    <Link
                      className="account-link"
                      href={`/gestor/termos?publico=${tab.slug}&base=${row.id ?? "inicial"}`}
                    >
                      Editar a partir desta
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">SHA-256 do texto em vigor: {current.sha256}</p>
      </section>
    </>
  );
}
