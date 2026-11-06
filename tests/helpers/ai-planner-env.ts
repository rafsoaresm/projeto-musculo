import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { aiPlatformFor, type PlanInput, type TaskInput } from "@/db/ai-platform";
import { plansFor } from "@/db/plans";
import type { GenerationAnswersInput } from "@/modules/prescricao/automatica/contracts";
import { plannerService, type PlannerDeps } from "@/modules/prescricao/planejador/orchestration";
import { sealSecret, toBase64Url } from "@/modules/prescricao/planejador/secrets";
import { mockProvider } from "@/modules/prescricao/planejador/provedores/mock";
import type { CallSettings, PlannerProvider, ProviderResult, SafeProviderRequest } from "@/modules/prescricao/planejador/provedores/port";
import { ALL_MIGRATIONS, migrate } from "./migrate";

/**
 * A local D1 (Miniflare/workerd, migrations 0001-0047) with two organizations, students, technical assignments, the real seeded library and
 * the platform manager, for the planner service tests (planner-service, ai-retention). Every identity is a row, as the server derives them
 * from a verified session. Nothing here reaches a network. Names, e-mails and phones are fictitious canaries.
 */
export const NOW = new Date("2026-11-20T15:00:00Z");
export const KEY = "sk-test-CANARY-0123456789abcdef";
export const SECRETS_KEY = toBase64Url(new Uint8Array(32).fill(7));
export const STUDENT = { name: "Zélia Quintanilha Braga", email: "zelia.quintanilha@exemplo.test", phone: "+55 11 98888-7766", birthDate: "1991-03-14", injury: "SEGREDO-LESAO-OMBRO" };

export const V2 = {
  schemaVersion: 2,
  startDate: "2026-11-23",
  phases: [
    { name: "Base", weeks: 4, sessionsPerWeek: 4, workouts: [{ label: "A", exerciseTarget: 5 }, { label: "B", exerciseTarget: 5 }], trainingDays: [0, 1, 3, 4] },
    { name: "Força", weeks: 4, sessionsPerWeek: 4, workouts: [{ label: "A", exerciseTarget: 5 }, { label: "B", exerciseTarget: 5 }], trainingDays: [0, 1, 3, 4] },
  ],
};
export const ANSWERS: GenerationAnswersInput = {
  stimulusByPhase: [1, 2].map((phaseIndex) => ({ phaseIndex, value: "HYPERTROPHY", basis: "PROFESSIONAL" as const })),
  equipmentCodes: ["BARBELL", "RACK", "MACHINE", "DUMBBELL", "BENCH", "CABLE", "PULL_UP_BAR"],
};

export const PLAN_BIG: PlanInput = {
  name: "Plano IA grande", allowance: { mode: "TOTAL", total: 5_000_000 }, perRequestCapPlanning: 200_000, perRequestCapAdjustment: 100_000, requestsPerMinute: 120, costCap: null,
};
export const taskOf = (providerKind: string, modelId: string, over: Partial<TaskInput> = {}): TaskInput => ({
  enabled: true, providerKind, modelId, maxInputTokens: 100_000, maxOutputTokens: 6144, timeoutMs: 25_000, maxRetries: 1, prices: null,
  sendSystemExerciseNames: false, ceilings: { maxOutputTokens: 8192, timeoutMs: 25_000 }, mockAllowed: true, ...over,
});

export type Env = Record<string, string | undefined>;
export const BASE_ENV: Env = { AI_MOCK_ENABLED: "true", AI_SECRETS_KEY: SECRETS_KEY };

export async function createPlannerEnv(label: string) {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('test'); } };",
      compatibilityDate: "2026-10-23",
      d1Databases: { DB: label },
      cf: false,
    }),
  );
  const db: D1Database = await mf.getD1Database("DB");
  await migrate(db, ALL_MIGRATIONS);
  const people = ["g1", "tech-a", "tech-a2", "tech-off", "tech-b", "commercial-a", "owner-a"];
  await db.batch([
    ...people.map((p) => db.prepare("INSERT INTO auth_user(id,name,email,created_at,updated_at) VALUES (?1,?1,?2,0,0)").bind(p, `${p}@example.test`)),
    db.prepare(`INSERT INTO users(id) VALUES ${people.map((p) => `('${p}')`).join(",")}`),
    db.prepare("INSERT INTO platform_admins(user_id, created_at) VALUES ('g1','2026-10-01T00:00:00Z')"),
    db.prepare("UPDATE auth_user SET two_factor_enabled = 1 WHERE id = 'g1'"),
    db.prepare("INSERT INTO organizations(id,name) VALUES ('org-a','Studio A'),('org-b','Studio B')"),
    db.prepare(
      `INSERT INTO memberships(organization_id,user_id,role) VALUES ('org-a','tech-a','TECHNICAL'),('org-a','tech-a2','TECHNICAL'),('org-a','tech-off','TECHNICAL'),
       ('org-a','commercial-a','COMMERCIAL'),('org-a','owner-a','OWNER'),('org-b','tech-b','TECHNICAL')`,
    ),
    db.prepare(
      `INSERT INTO professionals(id,organization_id,user_id,display_name) VALUES ('pro-a','org-a','tech-a','Pro A'),('pro-a2','org-a','tech-a2','Pro A2'),
       ('pro-off','org-a','tech-off','Off'),('pro-b','org-b','tech-b','Pro B')`,
    ),
    db.prepare("INSERT INTO students(id,organization_id,display_name) VALUES ('st-1','org-a',?1),('st-2','org-a','Menor Teste'),('st-b','org-b',?1)").bind(STUDENT.name),
    db.prepare(
      `INSERT INTO care_assignments(organization_id,student_id,professional_id) VALUES ('org-a','st-1','pro-a'),('org-a','st-1','pro-off'),('org-a','st-2','pro-a'),
       ('org-a','st-2','pro-a2'),('org-b','st-b','pro-b')`,
    ),
    db.prepare("INSERT INTO student_access(organization_id,student_id,user_id) VALUES ('org-a','st-1','owner-a')"),
    db.prepare(
      `INSERT INTO student_profiles(student_id,organization_id,goal,level,days_per_week,session_minutes,birth_date,email,phone,injuries,updated_by_user_id)
       VALUES ('st-1','org-a','Hipertrofia','Intermediário',4,60,?1,?2,?3,?4,'tech-a'),
              ('st-2','org-a','Hipertrofia','Intermediário',4,60,'2014-05-05',NULL,NULL,NULL,'tech-a'),
              ('st-b','org-b','Hipertrofia','Intermediário',4,60,?1,?2,?3,?4,'tech-b')`,
    ).bind(STUDENT.birthDate, STUDENT.email, STUDENT.phone, STUDENT.injury),
  ]);
  await db.prepare("UPDATE care_assignments SET revoked_at = '2026-11-01T00:00:00Z' WHERE professional_id = 'pro-off'").run();

  const org = (userId: string, organizationId = "org-a") => ({ userId, organizationId });
  const gestor = () => aiPlatformFor(db, { userId: "g1" });
  let seq = 0;
  const id = (prefix: string) => `${prefix}-${String(++seq).padStart(5, "0")}-aaaa-bbbb-cccc`.slice(0, 40);
  const first = <T,>(sql: string, ...binds: unknown[]) => db.prepare(sql).bind(...binds).first<T>();
  const all = async <T,>(sql: string, ...binds: unknown[]) => (await db.prepare(sql).bind(...binds).all<T>()).results;
  const n = async (sql: string, ...binds: unknown[]) => (await first<{ n: number }>(sql, ...binds))!.n;
  const run = (sql: string, ...binds: unknown[]) => db.prepare(sql).bind(...binds).run();

  async function newDraft(student = "st-1", who = "tech-a", organizationId = "org-a", input: unknown = V2) {
    const created = await plansFor(db, org(who, organizationId)).create(student, { title: "Plano de teste", input: input as never });
    if (!created) throw new Error("plan");
    return created;
  }
  async function contentVersion(revisionId: string) {
    return n("SELECT content_version AS n FROM plan_revisions WHERE id = ?1", revisionId);
  }

  /** Gestor side: connects a key (real providers), maps the PLANNER task, creates the plan and enables the organization. */
  async function configure(opts: { provider: string; model: string; task?: Partial<TaskInput>; plan?: Partial<PlanInput>; orgs?: string[]; env?: Env }) {
    const g = gestor();
    if (opts.provider !== "mock") {
      const { secretsConfigFrom } = await import("@/modules/prescricao/planejador/secrets");
      const config = secretsConfigFrom((name) => (opts.env ?? BASE_ENV)[name]);
      await g.saveConnection(opts.provider as "openai", await sealSecret(KEY, opts.provider, config), NOW);
    }
    const tasks = await g.getTasks();
    const planner = tasks.find((t) => t.task === "PLANNER")!;
    const saved = await g.saveTask("PLANNER", taskOf(opts.provider, opts.model, opts.task), planner.version, NOW);
    if (saved !== "saved") throw new Error(`task: ${saved}`);
    const created = await g.savePlan(null, { ...PLAN_BIG, name: `Plano ${id("p")}`, ...opts.plan }, null, NOW);
    if (!created.ok) throw new Error(`plan: ${created.reason}`);
    for (const orgId of opts.orgs ?? ["org-a"]) {
      const row = (await g.listOrganizations("2026-11")).find((o) => o.organizationId === orgId);
      const out = await g.setOrganization(orgId, { quotaPlanId: created.id, enabled: true, ackVersion: "1" }, row?.version ?? 0, "1", NOW);
      if (out !== "saved") throw new Error(`org: ${out}`);
    }
    return { planId: created.id };
  }

  /** A provider that counts calls and can override the answer; the default is the deterministic mock. */
  function spy(override?: (req: SafeProviderRequest, settings: CallSettings) => Promise<ProviderResult> | ProviderResult) {
    const calls: Array<{ settings: CallSettings; user: string }> = [];
    const provider: PlannerProvider = {
      kind: "mock",
      async call(req, settings) {
        calls.push({ settings, user: req.user });
        return override ? override(req, settings) : mockProvider.call(req, settings);
      },
      listModels: (apiKey, fetchImpl, signal) => mockProvider.listModels(apiKey, fetchImpl, signal),
    };
    return { provider, calls };
  }

  const service = (who = "tech-a", organizationId = "org-a", deps: PlannerDeps & { env?: Env } = {}) => {
    const { env, ...rest } = deps;
    return plannerService(db, org(who, organizationId), { now: () => NOW, readEnv: (name) => (env ?? BASE_ENV)[name], sleep: async () => undefined, ...rest });
  };

  return { mf, db, org, gestor, id, first, all, n, run, newDraft, contentVersion, configure, spy, service, dispose: () => mf.dispose() };
}
export type PlannerEnv = Awaited<ReturnType<typeof createPlannerEnv>>;
