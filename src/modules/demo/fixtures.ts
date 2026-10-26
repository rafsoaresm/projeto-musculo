/**
 * FICTIONAL DATA for the demonstration area (DEMO_MODE=true). Nothing here is
 * read from or written to the database, and no name, number or date refers to a
 * real person or customer. Exercise names and the training parameters come from
 * the original master document (seed of 64 exercises and the preset table); no
 * load in kilograms and no scientific reference is invented. Never import this
 * file from a real (authenticated) page.
 */
import type {
  OrganizationRow,
  PlatformAuditRow,
  PlatformSummary,
} from "@/db/platform";
import type { PortalState } from "@/modules/atendimento/student-list";

export const demoSummary: PlatformSummary = {
  organizations: 6,
  professionals: 9,
  students: 112,
  portalAccesses: 58,
  blockedProfessionals: 1,
  requestsOpen: 3,
  requestsOverdue: 1,
};

export const demoOrganizations: OrganizationRow[] = [
  {
    id: "demo-org-1",
    name: "Estúdio Alvorada",
    createdAt: "2026-08-04T12:00:00.000Z",
    ownerName: "Marina Exemplo",
    ownerEmail: "marina@exemplo.test",
    members: 3,
    students: 41,
    portalAccesses: 27,
    blockedMembers: 0,
    requestsOpen: 1,
    requestsOverdue: 0,
  },
  {
    id: "demo-org-2",
    name: "Personal Rafael Modelo",
    createdAt: "2026-08-19T12:00:00.000Z",
    ownerName: "Rafael Modelo",
    ownerEmail: "rafael@exemplo.test",
    members: 1,
    students: 18,
    portalAccesses: 9,
    blockedMembers: 0,
    requestsOpen: 2,
    requestsOverdue: 1,
  },
  {
    id: "demo-org-3",
    name: "Núcleo Movimento",
    createdAt: "2026-09-02T12:00:00.000Z",
    ownerName: "Helena Teste",
    ownerEmail: "helena@exemplo.test",
    members: 2,
    students: 26,
    portalAccesses: 12,
    blockedMembers: 1,
    requestsOpen: 0,
    requestsOverdue: 0,
  },
  {
    id: "demo-org-4",
    name: "Studio Vértice",
    createdAt: "2026-09-15T12:00:00.000Z",
    ownerName: "Paulo Ficção",
    ownerEmail: "paulo@exemplo.test",
    members: 1,
    students: 9,
    portalAccesses: 4,
    blockedMembers: 0,
    requestsOpen: 0,
    requestsOverdue: 0,
  },
  {
    id: "demo-org-5",
    name: "Corpo & Método",
    createdAt: "2026-10-01T12:00:00.000Z",
    ownerName: "Luana Amostra",
    ownerEmail: "luana@exemplo.test",
    members: 1,
    students: 12,
    portalAccesses: 6,
    blockedMembers: 0,
    requestsOpen: 0,
    requestsOverdue: 0,
  },
  {
    id: "demo-org-6",
    name: "Treino em Movimento",
    createdAt: "2026-10-14T12:00:00.000Z",
    ownerName: "Davi Fictício",
    ownerEmail: "davi@exemplo.test",
    members: 1,
    students: 6,
    portalAccesses: 0,
    blockedMembers: 0,
    requestsOpen: 0,
    requestsOverdue: 0,
  },
];

export const demoAudit: PlatformAuditRow[] = [
  {
    id: "demo-audit-3",
    action: "USER_BLOCKED",
    createdAt: "2026-10-20T15:42:00.000Z",
    actorEmail: "gestao@exemplo.test",
    organizationName: "Núcleo Movimento",
    subjectEmail: "colaborador@exemplo.test",
  },
  {
    id: "demo-audit-2",
    action: "USER_UNBLOCKED",
    createdAt: "2026-09-30T10:05:00.000Z",
    actorEmail: "gestao@exemplo.test",
    organizationName: "Studio Vértice",
    subjectEmail: "paulo@exemplo.test",
  },
  {
    id: "demo-audit-1",
    action: "PLATFORM_ADMIN_ACTIVATED",
    createdAt: "2026-08-01T09:00:00.000Z",
    actorEmail: "gestao@exemplo.test",
    organizationName: null,
    subjectEmail: "gestao@exemplo.test",
  },
];

// ---- Professional area

export const demoWorkspace = {
  name: "Estúdio Alvorada",
  role: "Proprietário",
  professional: "Marina Exemplo",
};

/** Plan states from the V2 handoff, section 8. */
export type DemoPlanStatus =
  | "NONE"
  | "DRAFT"
  | "REVIEW_REQUIRED"
  | "READY"
  | "APPROVED"
  | "DELIVERED";

export const planStatusLabel: Record<DemoPlanStatus, string> = {
  NONE: "Sem plano",
  DRAFT: "Rascunho",
  REVIEW_REQUIRED: "Revisão necessária",
  READY: "Pronto",
  APPROVED: "Aprovado",
  DELIVERED: "Entregue",
};
export const planStatusTone: Record<
  DemoPlanStatus,
  "neutral" | "brand" | "success" | "warning"
> = {
  NONE: "neutral",
  DRAFT: "neutral",
  REVIEW_REQUIRED: "warning",
  READY: "brand",
  APPROVED: "brand",
  DELIVERED: "success",
};

export interface DemoStudent {
  id: string;
  displayName: string;
  portal: PortalState;
  portalNote: string;
  plan: DemoPlanStatus;
  /** Screening state. A flag blocks approval and delivery until reviewed. */
  screening: "NOT_ASSESSED" | "CLEAR" | "REVIEW_REQUIRED";
  note: string;
}

export const demoStudents: DemoStudent[] = [
  {
    id: "ana",
    displayName: "Ana Beatriz Lima",
    portal: "ACTIVE",
    portalNote: "Acesso ativo desde 12/09/2026.",
    plan: "REVIEW_REQUIRED",
    screening: "REVIEW_REQUIRED",
    note: "Triagem com 1 sinal marcado",
  },
  {
    id: "carlos",
    displayName: "Carlos Almeida",
    portal: "ACTIVE",
    portalNote: "Acesso ativo desde 03/10/2026.",
    plan: "DELIVERED",
    screening: "CLEAR",
    note: "Plano entregue · versão 1",
  },
  {
    id: "bruno",
    displayName: "Bruno Teixeira",
    portal: "NONE",
    portalNote: "Ainda sem acesso à área do aluno.",
    plan: "DRAFT",
    screening: "CLEAR",
    note: "Rascunho aguardando aprovação",
  },
  {
    id: "daniela",
    displayName: "Daniela Freitas",
    portal: "INVITED",
    portalNote: "Convite pendente até 28/10/2026.",
    plan: "NONE",
    screening: "NOT_ASSESSED",
    note: "Sem avaliação registrada",
  },
  {
    id: "eduardo",
    displayName: "Eduardo Prado",
    portal: "NONE",
    portalNote: "Ainda sem acesso à área do aluno.",
    plan: "NONE",
    screening: "NOT_ASSESSED",
    note: "Cadastro recém-criado",
  },
];

export const findDemoStudent = (id: string) =>
  demoStudents.find((student) => student.id === id) ?? null;

// ---- Prescription preview (seed exercises and presets from the master document)

export interface DemoExercise {
  name: string;
  /** Who set the field: the rule engine or the professional (edit preserved). */
  origin: "SYSTEM" | "PROFESSIONAL";
}
export interface DemoWorkout {
  letter: string;
  title: string;
  exercises: DemoExercise[];
}
export interface DemoMesocycle {
  id: string;
  name: string;
  focus: string;
  /** Preset values from the master document, section 6.2. */
  preset: {
    sets: string;
    reps: string;
    rest: string;
    cadence: string;
    rir: string;
  };
  workouts: DemoWorkout[];
}

const workouts = (edited: boolean): DemoWorkout[] => [
  {
    letter: "A",
    title: "Peito, tríceps e ombros",
    exercises: [
      { name: "Supino com halteres", origin: "SYSTEM" },
      { name: "Supino inclinado com halteres", origin: "SYSTEM" },
      { name: "Desenvolvimento com halteres", origin: "SYSTEM" },
      { name: "Elevação lateral", origin: "SYSTEM" },
      { name: "Tríceps na polia", origin: "SYSTEM" },
      {
        name: edited ? "Tríceps corda" : "Tríceps francês com halter",
        origin: edited ? "PROFESSIONAL" : "SYSTEM",
      },
    ],
  },
  {
    letter: "B",
    title: "Costas e bíceps",
    exercises: [
      { name: "Puxada na frente", origin: "SYSTEM" },
      { name: "Remada sentada no cabo", origin: "SYSTEM" },
      { name: "Remada unilateral com halter", origin: "SYSTEM" },
      { name: "Face pull", origin: "SYSTEM" },
      { name: "Rosca direta", origin: "SYSTEM" },
      { name: "Rosca martelo", origin: "SYSTEM" },
    ],
  },
  {
    letter: "C",
    title: "Pernas e core",
    exercises: [
      { name: "Leg press 45°", origin: "SYSTEM" },
      { name: "Agachamento goblet", origin: "SYSTEM" },
      { name: "Mesa flexora", origin: "SYSTEM" },
      { name: "Hip thrust", origin: "SYSTEM" },
      { name: "Elevação de panturrilhas", origin: "SYSTEM" },
      { name: "Pallof press", origin: "SYSTEM" },
    ],
  },
];

export const demoMesocycles: DemoMesocycle[] = [
  {
    id: "meso-1",
    name: "Mesociclo 1",
    focus: "Adaptação/base",
    preset: {
      sets: "2",
      reps: "10–15",
      rest: "60–90 s",
      cadence: "3-1-2-0",
      rir: "3–4",
    },
    workouts: workouts(true),
  },
  {
    id: "meso-2",
    name: "Mesociclo 2",
    focus: "Hipertrofia",
    preset: {
      sets: "3",
      reps: "8–12",
      rest: "60–120 s",
      cadence: "3-0-1-0",
      rir: "1–3",
    },
    workouts: workouts(false),
  },
];

export const demoClient = {
  studentName: "Carlos Almeida",
  professionalName: "Marina Exemplo",
  organizationName: "Estúdio Alvorada",
  since: "2026-10-03T12:00:00.000Z",
  plan: {
    title: "Mesociclo 1 · Adaptação/base",
    detail: "Próximo treino: A — Peito, tríceps e ombros.",
    delivered: "Entregue por Marina Exemplo · versão 1 · 05/10/2026.",
  },
};
