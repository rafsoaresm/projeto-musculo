import type { Metadata } from "next";
import { requirePlatformAdmin } from "@/modules/auth/server";
import { aiPlatformFor } from "@/db/ai-platform";
import { PageHeading } from "@/components/ui";
import { AiPanelFrame } from "@/modules/gestor/ai-panel";
import { ModelsPanel } from "@/modules/gestor/ai-models";
import { OrganizationsPanel } from "@/modules/gestor/ai-organizations";
import { PlansPanel } from "@/modules/gestor/ai-plans";
import { ProvidersPanel } from "@/modules/gestor/ai-providers";
import { UsagePanel } from "@/modules/gestor/ai-usage";
import { callsBlocked, recentMonths, tabOf } from "@/modules/gestor/ai-view";
import { AI_ORG_ACK_TEXT } from "@/modules/prescricao/planejador/copy";
import { loadAiEnv } from "@/modules/prescricao/planejador/env";
import { monthKey } from "@/modules/prescricao/planejador/quota";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Inteligência artificial · Gestor" };

/**
 * Where the platform manager connects the AI providers' keys, chooses provider and model per task, defines the quota plans, enables AI per
 * organization and watches the use. The manager is checked on the page and again in every action and every repository statement; the key
 * of a provider is never read here (only its masked tail).
 */
export default async function ArtificialIntelligence({ searchParams }: { searchParams: Promise<{ aba?: string; mes?: string }> }) {
  const { aba, mes } = await searchParams;
  const { db, context } = await requirePlatformAdmin();
  const repo = aiPlatformFor(db, context);
  const env = await loadAiEnv();
  const tab = tabOf(aba);
  const [settings, canWrite] = await Promise.all([repo.getSettings(), repo.canWrite()]);
  const facts = { envKill: env.killSwitch, secretsKeyOk: env.secrets !== null, panelKill: settings.killSwitch, canWrite };
  const blocked = callsBlocked(facts);
  const now = new Date();
  const thisMonth = monthKey(now);
  const months = recentMonths(thisMonth, 12);
  const month = mes && months.includes(mes) ? mes : thisMonth;

  let body: React.ReactNode;
  if (tab === "provedores") {
    const [connections, tasks] = await Promise.all([repo.listConnections(), repo.getTasks()]);
    body = <ProvidersPanel connections={connections} tasks={tasks} mockEnabled={env.mockEnabled} canWrite={canWrite} secretsOk={facts.secretsKeyOk} callsBlocked={blocked} />;
  } else if (tab === "modelos") {
    const [connections, tasks] = await Promise.all([repo.listConnections(), repo.getTasks()]);
    body = <ModelsPanel tasks={tasks} connections={connections} mockEnabled={env.mockEnabled} canWrite={canWrite} callsBlocked={blocked} secretsOk={facts.secretsKeyOk} />;
  } else if (tab === "planos") {
    const [plans, tasks] = await Promise.all([repo.listPlans(), repo.getTasks()]);
    body = <PlansPanel plans={plans} tasks={tasks} canWrite={canWrite} />;
  } else if (tab === "organizacoes") {
    const [organizations, plans] = await Promise.all([repo.listOrganizations(thisMonth), repo.listPlans()]);
    body = <OrganizationsPanel organizations={organizations} plans={plans} canWrite={canWrite} ackText={AI_ORG_ACK_TEXT} />;
  } else {
    const [rows, circuits, audit, organizations] = await Promise.all([repo.usage(month), repo.listCircuits(), repo.listAuditAi(30), repo.listOrganizations(thisMonth)]);
    const names = new Map(organizations.map((o) => [o.organizationId, o.organizationName]));
    const readable = audit.map((a) => ({ ...a, subject: names.get(a.subject) ?? a.subject }));
    body = <UsagePanel month={month} months={months} rows={rows} circuits={circuits} audit={readable} />;
  }

  return (
    <>
      <PageHeading
        eyebrow="PLATAFORMA"
        title="Inteligência artificial"
        description="Conecte os provedores, escolha o modelo de cada tarefa, defina quanto cada organização pode usar e acompanhe o consumo."
      />
      <AiPanelFrame tab={tab} facts={facts} kill={{ byEmail: settings.byEmail, at: settings.at }}>
        {body}
      </AiPanelFrame>
    </>
  );
}
