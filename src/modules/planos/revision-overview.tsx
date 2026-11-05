"use client";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { PeriodizationSchedule } from "@/modules/training/contracts";
import { phaseTitle, workoutTitle } from "@/modules/training/format";
import { phaseName, phaseWorkouts } from "@/modules/training/periodization";
import { storedDoseText } from "@/modules/prescricao/describe";
import type { WorkoutProgress } from "@/modules/prescricao/summary";

/** The rows of a closed revision as the overview reads them (plain data from the server page). */
export interface OverviewItem {
  id: string;
  phaseIndex: number;
  workoutLabel: string;
  position: number;
  name: string;
  sets: string | null;
  reps: string | null;
  loadInstruction: string | null;
  cadence: string | null;
  restSeconds: number | null;
  restText: string | null;
  rirMin: number | null;
  rirMax: number | null;
  notes: string | null;
  doseText: string | null;
}

/** How many exercises a card lists before "+ N exercícios" (Figma AP-01: four rows). */
const SHOWN = 4;

const STATUS: Record<WorkoutProgress["status"], { text: string; tone: "warning" | "success" | "neutral" }> = {
  BELOW: { text: "Abaixo do alvo", tone: "warning" },
  MET: { text: "Alvo atendido", tone: "success" },
  // The Figma draws "Acima do alvo" in the same amber as "Abaixo do alvo".
  ABOVE: { text: "Acima do alvo", tone: "warning" },
  NO_TARGET: { text: "Sem alvo", tone: "neutral" },
};

/** "3 × 8–12 · 90 s": only what was typed, never completed. */
function shortDose(item: OverviewItem): string {
  const work = item.sets && item.reps ? `${item.sets} × ${item.reps}` : item.sets ? `${item.sets} séries` : item.reps ? `${item.reps} repetições` : "";
  const rest = item.restSeconds !== null ? `${item.restSeconds} s` : "";
  return [work, rest].filter(Boolean).join(" · ");
}

/** The dose of a workout in one line when all its rows agree; otherwise it says so (nothing is averaged or invented). */
function workoutDose(rows: OverviewItem[]): string {
  if (rows.length === 0) return "Nenhum exercício";
  const doses = new Set(rows.map(shortDose));
  if (doses.size === 1) {
    const only = [...doses][0]!;
    return only || "Sem dose registrada";
  }
  return "Doses diferentes por exercício";
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The page of a closed revision (ready, approved or delivered), as Figma AP-01/03/04/05/07/08 draw it: phase tabs, one card per workout,
 * the doses of the week and the way to the recorded notes. Everything is read from the revision; nothing here edits it. "Ver sessão
 * completa" opens the whole session of that workout below the cards, and the full prescription stays one step further, folded.
 */
export function RevisionOverview({
  state,
  schedule,
  progress,
  items,
  perSession,
  records,
  access,
  full,
}: {
  state: "READY" | "APPROVED" | "DELIVERED";
  schedule: PeriodizationSchedule;
  progress: WorkoutProgress[];
  items: OverviewItem[];
  /** OCCURRENCE: the doses are written session by session; the week block then says these are the base doses. */
  perSession: boolean;
  /** The recorded alerts, warnings and assumptions of the applied proposal, and where they are read. */
  records: { count: number; href: string } | null;
  /** Shown on a delivered revision whose student has no access yet. */
  access: { text: string; href: string } | null;
  /** The full read-only prescription (every row, with its notes and the per-session doses). */
  full: ReactNode;
}) {
  const ids = useId();
  const phases = schedule.phases;
  const [phaseAt, setPhaseAt] = useState(0);
  const phase = phases[phaseAt] ?? phases[0]!;
  const workouts = phaseWorkouts(phase);
  const [selected, setSelected] = useState<string | null>(null);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [fullOpen, setFullOpen] = useState(false);
  const sessionRef = useRef<HTMLElement>(null);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const current = selected && workouts.some((w) => w.label === selected) ? selected : (workouts[0]?.label ?? "");
  const rowsOf = (label: string) =>
    items
      .filter((item) => item.phaseIndex === phase.index && item.workoutLabel === label)
      .sort((a, b) => a.position - b.position);
  const slotOf = (label: string) => progress.find((slot) => slot.phaseIndex === phase.index && slot.label === label);
  const titleOf = (label: string) => workoutTitle(label, slotOf(label)?.name ?? null);
  const open = (label: string) => {
    setSelected(label);
    setSessionOpen(true);
  };
  // Opening a session brings it into view and moves the reading there.
  useEffect(() => {
    if (!sessionOpen) return;
    sessionRef.current?.scrollIntoView({ block: "nearest" });
    sessionRef.current?.focus({ preventScroll: true });
  }, [sessionOpen, current]);
  const onTabKey = (event: KeyboardEvent) => {
    const next =
      event.key === "ArrowRight"
        ? (phaseAt + 1) % phases.length
        : event.key === "ArrowLeft"
          ? (phaseAt - 1 + phases.length) % phases.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? phases.length - 1
              : -1;
    if (next < 0) return;
    event.preventDefault();
    setPhaseAt(next);
    setSessionOpen(false);
    tabs.current[next]?.focus();
  };

  const below = progress.filter((slot) => slot.status === "BELOW").length;
  const cycle = `${plural(phases.length, "fase", "fases")} · ${plural(schedule.totalWeeks, "semana", "semanas")}`;
  const sessionRows = rowsOf(current);
  const hasRecords = records !== null && records.count > 0;

  return (
    <div className={`fa-overview fa-overview-${state.toLowerCase()}`}>
      <div className="fa-presc-head">
        <div className="fa-presc-title">
          <h2>Prescrição</h2>
          <p className="fa-w">Estrutura do ciclo • {cycle}</p>
          <p className="fa-n fa-presc-meta">{cycle}</p>
        </div>
        <div className="fa-tabs" role="tablist" aria-label="Fases do ciclo" onKeyDown={onTabKey}>
          {phases.map((item, index) => (
            <button
              key={item.index}
              ref={(node) => {
                tabs.current[index] = node;
              }}
              type="button"
              role="tab"
              id={`${ids}-aba-${item.index}`}
              aria-selected={phaseAt === index}
              aria-controls={`${ids}-painel`}
              tabIndex={phaseAt === index ? 0 : -1}
              title={phaseName(item) ? phaseTitle(item.index, phaseName(item)) : undefined}
              className={phaseAt === index ? "fa-tab fa-tab-on" : "fa-tab"}
              onClick={() => {
                setPhaseAt(index);
                setSelected(null);
                setSessionOpen(false);
              }}
            >
              Fase {String(item.index).padStart(2, "0")}
            </button>
          ))}
        </div>
      </div>

      <div id={`${ids}-painel`} role="tabpanel" aria-labelledby={`${ids}-aba-${phase.index}`} className="fa-cards">
        {workouts.map((workout) => {
          const slot = slotOf(workout.label);
          const rows = rowsOf(workout.label);
          const status = slot ? STATUS[slot.status] : null;
          const countText =
            workout.target === null ? plural(rows.length, "exercício", "exercícios") : `${rows.length} de ${workout.target}`;
          const title = titleOf(workout.label);
          return (
            <article
              key={workout.label}
              className={`fa-card${current === workout.label ? " fa-card-on" : ""}`}
              aria-label={title}
            >
              <header className="fa-card-head">
                <h3>{title}</h3>
                <span className="fa-chip fa-chip-sm fa-chip-neutral">{countText}</span>
                {status && <span className={`fa-chip fa-chip-sm fa-chip-${status.tone}`}>{status.text}</span>}
              </header>
              <p className="fa-card-sub">Exercícios desta sessão</p>
              {rows.length === 0 ? (
                <p className="fa-card-empty">Nenhum exercício neste treino.</p>
              ) : (
                <ol className="fa-card-list">
                  {rows.slice(0, SHOWN).map((row, index) => (
                    <li key={row.id}>
                      <span className="fa-card-n">{index + 1}</span> {row.name}
                    </li>
                  ))}
                </ol>
              )}
              {rows.length > SHOWN && (
                <button type="button" className="fa-card-more" onClick={() => open(workout.label)}>
                  + {plural(rows.length - SHOWN, "exercício", "exercícios")}
                </button>
              )}
              <button
                type="button"
                className="fa-btn fa-btn-secondary fa-card-open"
                aria-label={`Ver sessão completa: ${title}`}
                aria-expanded={sessionOpen && current === workout.label}
                aria-controls={`${ids}-sessao`}
                onClick={() => open(workout.label)}
              >
                Ver sessão completa
              </button>
              {/* The phone draws each workout as one tappable row (AP-05). */}
              <button
                type="button"
                className="fa-row"
                aria-label={`${title}: ${countText}${workout.target === null ? "" : " exercícios"}${status ? `, ${status.text}` : ""}. Ver sessão completa`}
                aria-expanded={sessionOpen && current === workout.label}
                aria-controls={`${ids}-sessao`}
                onClick={() => open(workout.label)}
              >
                <span className="fa-row-title">{title}</span>
                <span className={`fa-row-sub${slot?.status === "BELOW" ? " fa-row-below" : ""}`}>
                  {countText}
                  {workout.target === null ? "" : " exercícios"}
                  {status ? ` · ${status.text}` : ""}
                </span>
                <span className="fa-row-go" aria-hidden="true">
                  ›
                </span>
              </button>
            </article>
          );
        })}
      </div>

      {sessionOpen && (
        <section id={`${ids}-sessao`} ref={sessionRef} tabIndex={-1} className="fa-session" aria-labelledby={`${ids}-sessao-t`}>
          <div className="fa-session-head">
            <h3 id={`${ids}-sessao-t`}>
              Sessão completa · {titleOf(current)} · {phaseTitle(phase.index, phaseName(phase))}
            </h3>
            <button type="button" className="fa-btn fa-btn-secondary" onClick={() => setSessionOpen(false)}>
              Fechar sessão
            </button>
          </div>
          {sessionRows.length === 0 ? (
            <p className="fa-card-empty">Nenhum exercício neste treino.</p>
          ) : (
            <ol className="fa-session-list">
              {sessionRows.map((row, index) => (
                <li key={row.id}>
                  <strong>
                    <span className="fa-card-n">{index + 1}</span> {row.name}
                  </strong>
                  <span>{storedDoseText(row) || "Sem dose registrada"}</span>
                  {row.notes && <span className="fa-session-note">{row.notes}</span>}
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      {/* Phone only (AP-05/08): the warning that the desktop shows in the bar and in the confirmation. */}
      {state !== "DELIVERED" && below > 0 && (
        <div className="fa-warnbox fa-n fa-page-warn">
          <strong>
            {below} de {progress.length} {progress.length === 1 ? "treino" : "treinos"} abaixo do alvo
          </strong>
          <p>Revise a distribuição antes de liberar. Os alertas não serão descartados.</p>
        </div>
      )}
      {state === "DELIVERED" && access && (
        <div className="fa-access fa-n">
          <strong>O aluno ainda não possui acesso</strong>
          <p>A entrega foi registrada. O plano aparecerá quando o acesso for habilitado.</p>
          <Link href={access.href}>Gerenciar acesso ›</Link>
        </div>
      )}

      <section className="fa-week" aria-label={perSession ? "Doses base por sessão" : "Semana 1"}>
        <div className="fa-week-text">
          <h3>{perSession ? "Doses base" : "Semana 1"}</h3>
          <p>Doses propostas por sessão · leitura resumida</p>
        </div>
        <ul className="fa-doses">
          {workouts.map((workout) => (
            <li key={workout.label} className="fa-dose">
              <strong>{titleOf(workout.label)}</strong>
              <span>{workoutDose(rowsOf(workout.label))}</span>
            </li>
          ))}
        </ul>
      </section>

      {hasRecords && records && (
        <>
          <section className="fa-records" aria-label="Registros da revisão">
            <div>
              <h3>{plural(records.count, "registro", "registros")} de justificativas, avisos e premissas</h3>
              <p>Disponíveis para auditoria • não precisam ocupar a leitura dos treinos</p>
            </div>
            <Link className="fa-btn fa-btn-secondary" href={records.href}>
              Consultar registros
            </Link>
          </section>
          <Link className="fa-records-link fa-n" href={records.href}>
            {records.count} avisos e premissas ›
          </Link>
        </>
      )}

      {state === "DELIVERED" && access && (
        <div className="fa-access fa-w">
          <p>{access.text}</p>
          <Link href={access.href}>Gerenciar acesso ›</Link>
        </div>
      )}

      <details className="fa-full" open={fullOpen} onToggle={(event) => setFullOpen((event.currentTarget as HTMLDetailsElement).open)}>
        <summary>Prescrição completa e estrutura do ciclo</summary>
        {fullOpen && <div className="fa-full-body">{full}</div>}
      </details>
    </div>
  );
}
