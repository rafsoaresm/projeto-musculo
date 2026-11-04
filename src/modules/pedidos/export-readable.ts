import { RECOVERY_LABELS } from "@/modules/checkin/contracts";
import { formatCalendarDate, workoutTitle } from "@/modules/training/format";
import { REQUEST_KIND_LABEL, outcomeLabel } from "./contracts";
import {
  EXPORT_CHECKIN_LIMIT,
  EXPORT_INCLUDED,
  EXPORT_NOTICE,
  EXPORT_NOT_INCLUDED,
  EXPORT_REQUEST_LIMIT,
  EXPORT_SESSION_LIMIT,
  type ExportCheckin,
  type ExportLinkSource,
  type ExportPlan,
  type ExportRequest,
  type ExportSession,
  type ExportSource,
} from "./export";

/**
 * "Baixar meus dados" in a form a person reads (slice 0.91): the same content as the JSON of
 * `buildExport`, from the same source, organized in sections. The page and the PDF both draw this and
 * nothing else, so the three formats cannot drift apart. Nothing is computed, scored or classified
 * here: every value is the one recorded, and an empty one is written out in words ("Não informado",
 * "Sem registro", "Não definido"), never as 0, never left blank and never left out.
 */

export type ReadableBlock =
  | { kind: "subtitle"; text: string }
  /** One level under a subtitle: a workout of a delivered plan. */
  | { kind: "heading"; text: string }
  | { kind: "text"; text: string; muted?: boolean }
  | { kind: "list"; items: string[] }
  | { kind: "facts"; rows: { label: string; value: string }[] };

export interface ReadableSection {
  /** Stable, for the anchors of the page. */
  id: string;
  /** Above the title: the workspace and the student, when the login has more than one link. */
  eyebrow: string | null;
  title: string;
  blocks: ReadableBlock[];
}

export interface ReadableExport {
  title: string;
  generatedAt: string;
  sections: ReadableSection[];
}

export const READABLE_TITLE = "Cópia dos meus dados";
/** How an empty field reads, said once at the top of the page and of the PDF. */
export const READABLE_EMPTY_NOTE =
  "Um campo vazio aparece escrito por extenso (“Não informado”, “Sem registro”, “Não definido”), nunca como zero nem em branco.";
/** The same warning the "Baixar meus dados" panel of Minha conta gives, on the page and on each page of the PDF. */
export const READABLE_HEALTH_NOTE = "A cópia tem dados de saúde: guarde-a em um lugar seguro.";

const NOT_INFORMED = "Não informado";
const NO_RECORD = "Sem registro";
/** A field of the delivered plan the professional left empty. */
const NOT_DEFINED = "Não definido";

/** An instant in Brasília time ("03/11/2026, 14:05"), as the screens show it. */
export const readableDateTime = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

const decimal = (value: number) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value);
const yesNo = (value: boolean) => (value ? "Sim" : "Não");
const textOr = (value: string | null | undefined, empty = NO_RECORD) => (value && value.trim() ? value.trim() : empty);
const row = (label: string, value: string) => ({ label, value });
const cutNote = (limit: number): ReadableBlock => ({
  kind: "text",
  text: `A lista passou de ${limit} entradas e foi cortada: aparecem as ${limit} mais recentes.`,
  muted: true,
});
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

function checkinBlocks(item: ExportCheckin): ReadableBlock[] {
  const rows = [
    row("Esforço percebido", item.effort === null ? NOT_INFORMED : `${item.effort} de 10`),
    row("Recuperação", item.recovery === null ? NOT_INFORMED : (RECOVERY_LABELS[item.recovery] ?? String(item.recovery))),
    row("Desconforto", yesNo(item.discomfort)),
  ];
  if (item.discomfort || item.discomfortNotes) rows.push(row("Sobre o desconforto", textOr(item.discomfortNotes)));
  rows.push(row("Observações", textOr(item.notes)));
  for (const entry of item.questions) rows.push(row(entry.question, textOr(entry.answer, "Sem resposta")));
  rows.push(row("Registrado em", readableDateTime(item.createdAt)));
  rows.push(row("Lido pelo profissional", yesNo(item.read)));
  item.replies.forEach((reply, index) =>
    rows.push(
      row(
        item.replies.length === 1 ? "Resposta do profissional" : `Resposta ${index + 1} do profissional`,
        `${reply.body} (${reply.author ?? "Profissional"}, ${readableDateTime(reply.createdAt)})`,
      ),
    ),
  );
  return [{ kind: "subtitle", text: `Check-in de ${formatCalendarDate(item.checkedOn)}` }, { kind: "facts", rows }];
}

function setLine(set: ExportSession["exercises"][number]["sets"][number]): string {
  const reps = set.reps === null ? "repetições não informadas" : plural(set.reps, "repetição", "repetições");
  const load = set.loadKg === null ? "carga não informada" : `${decimal(set.loadKg)} kg`;
  return `Série ${set.setNumber}: ${reps} · ${load}`;
}

function sessionBlocks(item: ExportSession): ReadableBlock[] {
  const blocks: ReadableBlock[] = [
    { kind: "subtitle", text: `Treino ${item.workoutLabel} de ${formatCalendarDate(item.performedOn)}` },
    {
      kind: "facts",
      rows: [
        row("Plano", `${item.planTitle} · fase ${item.phaseIndex}`),
        row("Esforço percebido", item.effort === null ? NOT_INFORMED : `${item.effort} de 10`),
        row("Dor registrada", yesNo(item.painReported)),
        row("Observações", textOr(item.notes)),
        row("Registrado em", readableDateTime(item.createdAt)),
        row("Lido pelo profissional", yesNo(item.read)),
      ],
    },
  ];
  if (item.exercises.length === 0) blocks.push({ kind: "text", text: "Nenhum exercício registrado neste treino.", muted: true });
  for (const exercise of item.exercises) {
    const rows = [
      row("Feito", yesNo(exercise.done)),
      row("Repetições em reserva (RIR)", exercise.rir === null ? NOT_INFORMED : String(exercise.rir)),
      row("Dor", yesNo(exercise.pain)),
      row("Séries", exercise.sets.length === 0 ? NO_RECORD : exercise.sets.map(setLine).join("\n")),
    ];
    rows.push(row("Observações", textOr(exercise.notes)));
    blocks.push({ kind: "facts", rows: [row("Exercício", exercise.name), ...rows] });
  }
  return blocks;
}

type PlanExercise = ExportPlan["phases"][number]["workouts"][number]["exercises"][number];

function rirText(min: number | null, max: number | null): string {
  if (min !== null && max !== null) return min === max ? String(min) : `${min} a ${max}`;
  if (min !== null) return `a partir de ${min}`;
  if (max !== null) return `até ${max}`;
  return NOT_DEFINED;
}

/** Every field of a prescribed exercise, one per line; an empty one says so instead of being left out. */
function planExerciseLines(exercise: PlanExercise): string {
  const rest = [exercise.restSeconds !== null ? `${exercise.restSeconds} s` : null, exercise.restText?.trim() || null]
    .filter(Boolean)
    .join(" · ");
  return [
    `Séries: ${textOr(exercise.sets, NOT_DEFINED)}`,
    `Repetições: ${textOr(exercise.reps, NOT_DEFINED)}`,
    `Carga: ${textOr(exercise.loadInstruction, NOT_DEFINED)}`,
    `Cadência: ${textOr(exercise.cadence, NOT_DEFINED)}`,
    `Descanso: ${rest || NOT_DEFINED}`,
    `Repetições em reserva (RIR): ${rirText(exercise.rirMin, exercise.rirMax)}`,
    `Observações: ${textOr(exercise.notes, NOT_DEFINED)}`,
    `Vídeo: ${textOr(exercise.videoUrl, NOT_DEFINED)}`,
  ].join("\n");
}

function planBlocks(plan: ExportPlan): ReadableBlock[] {
  const blocks: ReadableBlock[] = [
    { kind: "subtitle", text: `${plan.title} · revisão ${plan.revisionNumber}` },
    {
      kind: "facts",
      rows: [
        row("Entregue em", readableDateTime(plan.deliveredAt)),
        row("Entregue por", textOr(plan.deliveredBy, NOT_INFORMED)),
        row("Espaço na entrega", textOr(plan.deliveredOrganizationName, NOT_INFORMED)),
        row("Ciclo", `${formatCalendarDate(plan.startDate)} a ${formatCalendarDate(plan.endDate)}`),
      ],
    },
  ];
  for (const phase of plan.phases) {
    blocks.push({
      kind: "text",
      text:
        `Fase ${phase.index}${phase.name ? ` (${phase.name})` : ""}: ${formatCalendarDate(phase.startDate)} a ${formatCalendarDate(phase.endDate)} · ` +
        `${plural(phase.weeks, "semana", "semanas")} · ${plural(phase.sessionsPerWeek, "sessão", "sessões")} por semana · ` +
        `divisão ${phase.split}`,
    });
    for (const workout of phase.workouts) {
      // "Treino A", then "1.", "2." as the plan PDF numbers them.
      blocks.push({ kind: "heading", text: workoutTitle(workout.label, workout.name) });
      if (workout.exercises.length === 0) {
        blocks.push({ kind: "text", text: "Nenhum exercício neste treino.", muted: true });
        continue;
      }
      blocks.push({
        kind: "facts",
        rows: workout.exercises.map((exercise, index) => row(`${index + 1}. ${exercise.name}`, planExerciseLines(exercise))),
      });
    }
  }
  return blocks;
}

function requestBlocks(item: ExportRequest): ReadableBlock[] {
  const rows = [
    row("Mensagem", textOr(item.message)),
    row("Pedido em", readableDateTime(item.createdAt)),
    row("Prazo de resposta", readableDateTime(item.dueAt)),
    row("Situação", item.outcome ? outcomeLabel(item.outcome, "student") : "Em andamento"),
  ];
  if (item.outcome) {
    rows.push(row("Resposta do profissional", textOr(item.outcomeNote)));
    rows.push(row("Respondido em", item.decidedAt ? readableDateTime(item.decidedAt) : NOT_INFORMED));
  }
  return [{ kind: "subtitle", text: REQUEST_KIND_LABEL[item.kind] }, { kind: "facts", rows }];
}

function linkSections(link: ExportLinkSource, index: number, many: boolean): ReadableSection[] {
  const eyebrow = many ? `${link.organizationName} · ${link.studentName}` : null;
  const id = (name: string) => (many ? `${name}-${index + 1}` : name);
  const empty = (text: string): ReadableBlock[] => [{ kind: "text", text, muted: true }];
  return [
    {
      id: id("vinculo"),
      eyebrow,
      title: "Seu profissional",
      blocks: [
        {
          kind: "facts",
          rows: [
            row("Espaço", link.organizationName),
            row("Aluno", link.studentName),
            row("Profissional", textOr(link.professionalName, NOT_INFORMED)),
            row("Desde", readableDateTime(link.since)),
          ],
        },
      ],
    },
    {
      id: id("check-ins"),
      eyebrow,
      title: "Check-ins",
      blocks:
        link.checkins.length === 0
          ? empty("Nenhum check-in registrado.")
          : [...(link.checkinsCut ? [cutNote(EXPORT_CHECKIN_LIMIT)] : []), ...link.checkins.flatMap(checkinBlocks)],
    },
    {
      id: id("treinos-registrados"),
      eyebrow,
      title: "Treinos que você registrou",
      blocks:
        link.sessions.length === 0
          ? empty("Nenhum treino registrado.")
          : [...(link.sessionsCut ? [cutNote(EXPORT_SESSION_LIMIT)] : []), ...link.sessions.flatMap(sessionBlocks)],
    },
    {
      id: id("treino-entregue"),
      eyebrow,
      title: "Treino entregue",
      blocks:
        link.plans.length === 0
          ? empty("Nenhum treino entregue.")
          : [
              { kind: "text", text: "A versão mais recente de cada plano, como o seu profissional digitou; um campo que ele deixou em branco aparece como “Não definido”.", muted: true },
              ...link.plans.flatMap(planBlocks),
            ],
    },
    {
      id: id("pedidos"),
      eyebrow,
      title: "Pedidos sobre os seus dados",
      blocks:
        link.requests.length === 0
          ? empty("Nenhum pedido feito.")
          : [...(link.requestsCut ? [cutNote(EXPORT_REQUEST_LIMIT)] : []), ...link.requests.flatMap(requestBlocks)],
    },
  ];
}

export function readableExport(source: ExportSource): ReadableExport {
  const many = source.links.length > 1;
  return {
    title: READABLE_TITLE,
    generatedAt: source.generatedAt.toISOString(),
    sections: [
      {
        id: "sobre",
        eyebrow: null,
        title: "Sobre esta cópia",
        blocks: [
          { kind: "text", text: EXPORT_NOTICE },
          { kind: "text", text: "Ela traz:" },
          { kind: "list", items: EXPORT_INCLUDED },
          { kind: "text", text: "Ela não traz:" },
          { kind: "list", items: EXPORT_NOT_INCLUDED },
          { kind: "text", text: READABLE_EMPTY_NOTE, muted: true },
        ],
      },
      {
        id: "conta",
        eyebrow: null,
        title: "Seus dados de acesso",
        blocks: [{ kind: "facts", rows: [row("Nome", source.account.name), row("E-mail", source.account.email)] }],
      },
      {
        id: "aceites",
        eyebrow: null,
        title: "Aceites dos termos",
        blocks:
          source.acceptances.length === 0
            ? [{ kind: "text", text: "Nenhum aceite registrado.", muted: true }]
            : source.acceptances.map((item) => ({
                kind: "facts" as const,
                rows: [
                  row("Versão dos termos", item.termsVersion),
                  row("Aceito em", readableDateTime(item.acceptedAt)),
                  row("Fotos autorizadas", yesNo(item.photosAuthorized)),
                  row("Impressão do texto (SHA-256)", item.termsSha256),
                ],
              })),
      },
      ...source.links.flatMap((link, index) => linkSections(link, index, many)),
    ],
  };
}

/** `meus-dados-2026-10-26.pdf`, with the day in Brazil. */
export function readablePdfFileName(now: Date): string {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return `meus-dados-${day}.pdf`;
}
