"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { Pencil, Repeat } from "lucide-react";
import { Pill } from "@/components/ui";
import type { PrescribedItem, SessionOccurrence, OccurrenceItem } from "@/db/prescription";
import type { PeriodizationSchedule } from "@/modules/training/contracts";
import { formatCalendarDate } from "@/modules/training/format";
import { revisionOriginLabel } from "./automatica/view";
import { restTextForEditing, storedDoseText } from "./describe";
import { sessionTargets, type SessionScope } from "./occurrences";
import { setOccurrenceIncluded, substituteInSessions, updateOccurrenceDose, type PrescriptionResult } from "./actions";
import type { LibraryOption } from "./prescription-editor";

const SCOPES: Array<{ value: SessionScope; text: string }> = [
  { value: "ONLY", text: "Só nesta sessão" },
  { value: "FROM_WEEK", text: "Nesta fase, a partir desta semana" },
  { value: "PHASE", text: "Todas as semanas da fase" },
];

/**
 * Doses per session of a draft written session by session (OCCURRENCE; design §6.1 `prescription-editor`, UI item 7). Navigation
 * by links: phase, then week; each session of the week lists its exercises with the stored dose and where it came from
 * ("Proposta automática", "Editada por você", "Sua"). The professional edits a dose in one session, from this week on or in the
 * whole phase; leaves an exercise out of a session or brings it back; and substitutes an exercise in chosen sessions. The rows
 * themselves (add, remove, order) are edited in the workout cards above, which apply to every session.
 */
export function OccurrenceEditor({
  planId,
  revisionId,
  selfHref,
  schedule,
  phaseIndex,
  week,
  sessions,
  items,
  library,
  readOnly,
}: {
  planId: string;
  revisionId: string;
  selfHref: string;
  schedule: PeriodizationSchedule;
  phaseIndex: number;
  week: number;
  sessions: SessionOccurrence[];
  items: PrescribedItem[];
  library: LibraryOption[];
  readOnly: boolean;
}) {
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, startTransition] = useTransition();
  const phase = schedule.phases.find((p) => p.index === phaseIndex) ?? schedule.phases[0];
  const weeks = phase.microcycles.map((m) => m.index);
  const ofWeek = sessions.filter((s) => s.week === week);
  const names = new Map(items.map((item) => [item.id, item]));
  const href = (p: number, w?: number) => `${selfHref}?fase=${p}${w ? `&semana=${w}` : ""}#doses-por-sessao`;
  const run = (task: () => Promise<PrescriptionResult>, done: string, after?: () => void) =>
    startTransition(async () => {
      setError("");
      setNotice("");
      const result = await task();
      if (result?.error) setError(result.error);
      else {
        setNotice(done);
        after?.();
      }
    });

  return (
    <section id="doses-por-sessao" className="occurrence-editor" aria-labelledby="doses-por-sessao-titulo">
      <h3 id="doses-por-sessao-titulo">Doses por sessão</h3>
      <p className="small muted">
        Esta revisão tem dose própria em cada sessão de cada semana. Editar nos treinos acima muda todas as sessões daquele exercício; aqui
        você ajusta uma sessão, as semanas seguintes ou a fase.
      </p>
      <nav className="phase-tabs" aria-label="Fase das doses por sessão">
        {schedule.phases.map((p) => (
          <Link
            key={p.index}
            href={href(p.index)}
            scroll={false}
            className={p.index === phase.index ? "phase-tab selected" : "phase-tab"}
            aria-current={p.index === phase.index ? "page" : undefined}
          >
            Fase {String(p.index).padStart(2, "0")}
          </Link>
        ))}
      </nav>
      <nav className="week-nav" aria-label={`Semanas da fase ${phase.index} (doses por sessão)`}>
        {weeks.map((w) => (
          <Link key={w} href={href(phase.index, w)} scroll={false} aria-current={w === week ? "page" : undefined}>
            Semana {w}
          </Link>
        ))}
      </nav>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="small muted" role="status">
          {notice}
        </p>
      )}
      {ofWeek.length === 0 ? (
        <p className="small muted">Nenhuma sessão nesta semana.</p>
      ) : (
        <div className="workout-grid">
          {ofWeek.map((session) => (
            <section key={session.id} className="workout-card" aria-label={`Semana ${session.week}, sessão ${session.slot}, treino ${session.label}`}>
              <header>
                <h4>
                  Sessão {session.slot} · Treino {session.label}
                </h4>
                {session.plannedDate && <span className="small muted">{formatCalendarDate(session.plannedDate)}</span>}
              </header>
              {session.items.length === 0 ? (
                <p className="small muted">Nenhum exercício nesta sessão.</p>
              ) : (
                <ol className="exercise-list">
                  {session.items.map((x) => (
                    <SessionItem
                      key={x.id}
                      x={x}
                      name={names.get(x.prescribedExerciseId)?.name ?? "Exercício"}
                      session={session}
                      sessions={sessions}
                      library={library}
                      readOnly={readOnly}
                      pending={pending}
                      onDose={(ids, fields, scopeText) => run(() => updateOccurrenceDose(planId, revisionId, ids, fields), `Dose salva (${scopeText.toLowerCase()}).`)}
                      onInclude={(included) =>
                        run(() => setOccurrenceIncluded(planId, revisionId, [x.id], included), included ? "Exercício de volta nesta sessão." : "Exercício fora desta sessão.")
                      }
                      onSubstitute={(exerciseId, sessionIds, scopeText) =>
                        run(() => substituteInSessions(planId, revisionId, x.prescribedExerciseId, exerciseId, sessionIds), `Exercício substituído (${scopeText.toLowerCase()}).`)
                      }
                    />
                  ))}
                </ol>
              )}
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

function SessionItem({
  x,
  name,
  session,
  sessions,
  library,
  readOnly,
  pending,
  onDose,
  onInclude,
  onSubstitute,
}: {
  x: OccurrenceItem;
  name: string;
  session: SessionOccurrence;
  sessions: SessionOccurrence[];
  library: LibraryOption[];
  readOnly: boolean;
  pending: boolean;
  onDose: (ids: string[], fields: Record<string, unknown>, scopeText: string) => void;
  onInclude: (included: boolean) => void;
  onSubstitute: (exerciseId: string, sessionIds: string[], scopeText: string) => void;
}) {
  const [mode, setMode] = useState<"view" | "dose" | "substitute">("view");
  const [scope, setScope] = useState<SessionScope>("ONLY");
  const [exerciseId, setExerciseId] = useState("");
  const fromItem = () => ({
    sets: x.sets ?? "",
    reps: x.reps ?? "",
    loadInstruction: x.loadInstruction ?? "",
    cadence: x.cadence ?? "",
    restSeconds: x.restSeconds === null ? "" : String(x.restSeconds),
    restText: restTextForEditing(x),
    rirMin: x.rirMin === null ? "" : String(x.rirMin),
    rirMax: x.rirMax === null ? "" : String(x.rirMax),
    notes: x.notes ?? "",
  });
  const [value, setValue] = useState(fromItem);
  const origin = revisionOriginLabel(x.origin);
  const scopeText = SCOPES.find((s) => s.value === scope)!.text;
  const field = (key: keyof typeof value) => (event: { target: { value: string } }) => setValue({ ...value, [key]: event.target.value });
  const number = (text: string) => (text.trim() === "" ? null : Number(text));
  const scopeChoice = (
    <fieldset className="auto-subsection">
      <legend>Onde vale</legend>
      {SCOPES.map((s) => (
        <label key={s.value} className="check-row">
          <input type="radio" name={`escopo-${x.id}`} checked={scope === s.value} onChange={() => setScope(s.value)} />
          {s.text}
        </label>
      ))}
    </fieldset>
  );
  return (
    <li className={x.included ? undefined : "session-item-out"}>
      <div className="exercise-main">
        <strong>{name}</strong>
        <span className="small muted">{x.included ? storedDoseText(x) || "Sem parâmetros definidos" : "Fora desta sessão"}</span>
        {x.notes && x.included && <span className="small muted">Obs.: {x.notes}</span>}
        <span className="pill-row">
          <Pill tone={origin.tone}>{origin.text}</Pill>
        </span>
      </div>
      {!readOnly && mode === "view" && (
        <div className="exercise-actions">
          {x.included && (
            <button type="button" className="button secondary small" disabled={pending} onClick={() => {
                setValue(fromItem());
                setScope("ONLY");
                setMode("dose");
              }} aria-label={`Editar a dose de ${name} na sessão ${session.slot} da semana ${session.week}`}>
              <Pencil size={15} aria-hidden="true" /> Editar dose
            </button>
          )}
          <button type="button" className="button secondary small" disabled={pending} onClick={() => onInclude(!x.included)}>
            {x.included ? "Tirar desta sessão" : "Incluir nesta sessão"}
          </button>
          {x.included && (
            <button type="button" className="button secondary small" disabled={pending} onClick={() => {
                setScope("ONLY");
                setExerciseId("");
                setMode("substitute");
              }} aria-label={`Substituir ${name} nas sessões`}>
              <Repeat size={15} aria-hidden="true" /> Substituir
            </button>
          )}
        </div>
      )}
      {mode === "dose" && (
        <form
          className="item-form"
          onSubmit={(event) => {
            event.preventDefault();
            const { itemIds } = sessionTargets(sessions, { sessionId: session.id, prescribedExerciseId: x.prescribedExerciseId }, scope);
            onDose(
              itemIds,
              {
                sets: value.sets || null,
                reps: value.reps || null,
                loadInstruction: value.loadInstruction || null,
                cadence: value.cadence || null,
                restSeconds: number(value.restSeconds),
                restText: value.restText || null,
                rirMin: number(value.rirMin),
                rirMax: number(value.rirMax),
                notes: value.notes || null,
              },
              scopeText,
            );
            setMode("view");
          }}
        >
          <div className="field-grid">
            <label>
              Séries
              <input value={value.sets} maxLength={20} onChange={field("sets")} />
            </label>
            <label>
              Repetições
              <input value={value.reps} maxLength={40} onChange={field("reps")} />
            </label>
            <label>
              Carga ou esforço
              <input value={value.loadInstruction} maxLength={120} onChange={field("loadInstruction")} />
            </label>
            <label>
              Cadência
              <input value={value.cadence} maxLength={40} onChange={field("cadence")} />
            </label>
            <label>
              Descanso (segundos)
              <input type="number" min={0} max={3600} step={1} value={value.restSeconds} onChange={field("restSeconds")} />
            </label>
            <label>
              Descanso (texto)
              <input value={value.restText} maxLength={40} onChange={field("restText")} />
            </label>
            <label>
              RIR mínimo
              <input type="number" min={0} max={10} step={1} value={value.rirMin} onChange={field("rirMin")} />
            </label>
            <label>
              RIR máximo
              <input type="number" min={0} max={10} step={1} value={value.rirMax} onChange={field("rirMax")} />
            </label>
          </div>
          <label>
            Observações
            <textarea rows={2} value={value.notes} maxLength={500} onChange={field("notes")} />
          </label>
          {scopeChoice}
          <div className="exercise-actions">
            <button className="button primary small" disabled={pending}>
              Salvar dose
            </button>
            <button type="button" className="button secondary small" onClick={() => setMode("view")}>
              Cancelar
            </button>
          </div>
        </form>
      )}
      {mode === "substitute" && (
        <form
          className="item-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!exerciseId) return;
            const { sessionIds } = sessionTargets(sessions, { sessionId: session.id }, scope);
            onSubstitute(exerciseId, sessionIds, scopeText);
            setMode("view");
          }}
        >
          <label>
            Novo exercício da biblioteca
            <select value={exerciseId} onChange={(e) => setExerciseId(e.target.value)}>
              <option value="">Escolha…</option>
              {library.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>
          {scopeChoice}
          <p className="small muted">O exercício novo recebe a dose que {name} tinha em cada sessão escolhida; {name} sai dessas sessões e fica nas outras.</p>
          <div className="exercise-actions">
            <button className="button primary small" disabled={pending || !exerciseId}>
              Substituir
            </button>
            <button type="button" className="button secondary small" onClick={() => setMode("view")}>
              Cancelar
            </button>
          </div>
        </form>
      )}
    </li>
  );
}
