"use client";
import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { OccurrenceOut } from "@/modules/prescricao/motor/types";
import {
  applyAdjustment, getCurrentAdjustment, loadAdjustAlternatives, rejectAdjustment, suggestAdjustment, type AdjustAvailabilityView,
} from "@/modules/prescricao/planejador/adjust-actions";
import type { AlternativeView, SuggestionView } from "@/modules/prescricao/planejador/adjust-service";
import {
  adjustCards, aiButton, applyState, buildIntent, constraintChoices, diffRows, EQUIPMENT_CHOICES, equipmentLabel, INITIAL_BUILDER, OP_LABEL, OP_ORDER, SCOPE_CHOICES,
  STATUS_PILL, targetOptions, type BuilderState, type DiffRows,
} from "./adjust-view";
import { NETWORK_ERROR, useIntent } from "./use-intent";

const NO_AI_NOTE = "Nada é enviado como texto livre: só o item e as opções marcadas.";

/**
 * "Ajustar a proposta" (Figma RX-02 on a wide screen, M-02 on a phone; design V4 §7.6): ONE point change of the open proposal, built from controls
 * (the selected item, an operation, numbers and constraint chips; there is no text field), compared before and after, and applied only when the
 * professional says so. The AI (when the gate is READY) chooses among the engine's alternatives; without it the same panel works with the engine's
 * own list. The engine recomputes volume, duration and audit and checks the constraints: a violated one disables "Aplicar ajuste à proposta".
 * Nothing here approves, applies to the draft or delivers.
 */
export function AdjustPanel({
  planId, revisionId, proposalId, version, phaseIndex, week, session, initialItem, muscles, availability, onClose,
}: {
  planId: string;
  revisionId: string;
  proposalId: string;
  version: number;
  phaseIndex: number;
  week: number;
  session: OccurrenceOut | null;
  initialItem: string | null;
  /** Primary muscles by exercise id (for "sem aumentar o volume semanal de …"). */
  muscles: Record<string, string[]>;
  availability: AdjustAvailabilityView | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const intent = useIntent();
  const [pending, startTransition] = useTransition();
  const options = useMemo(() => targetOptions(session), [session]);
  const [state, setState] = useState<BuilderState>({ ...INITIAL_BUILDER, itemKey: options.find((o) => o.slotKey === initialItem)?.slotKey ?? options[0]?.slotKey ?? null });
  const [alternatives, setAlternatives] = useState<AlternativeView[] | null>(null);
  const [suggestion, setSuggestion] = useState<SuggestionView | null>(null);
  const [message, setMessage] = useState<{ tone: "error" | "notice"; text: string; engine?: boolean } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [acknowledge, setAcknowledge] = useState(false);
  const [applied, setApplied] = useState<number | null>(null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  const ids = { item: useId(), op: useId(), scope: useId(), reason: useId(), aiReason: useId() };

  const target = options.find((o) => o.slotKey === state.itemKey) ?? null;
  const itemMuscles = target ? muscles[target.exerciseId] ?? [] : [];
  const slot = session?.slot ?? 1;
  const apply = applyState(suggestion, version, now);
  const cards = adjustCards(suggestion, apply);
  const substitution = state.op === "SUBSTITUTE_EXERCISE";
  const button = aiButton(availability, state.op, pending);
  const currentItem = session?.items.find((i) => i.slotKey === state.itemKey) ?? null;
  const diff: DiffRows | null = suggestion?.diff ? diffRows(suggestion.diff) : null;
  const set = <K extends keyof BuilderState>(key: K, value: BuilderState[K]) => {
    setState((s) => ({ ...s, [key]: value }));
    // anything the request depends on changed: the old suggestion no longer answers it
    setSuggestion(null);
    setAcknowledge(false);
    setErrors([]);
    if (key !== "replacement") setAlternatives(null);
  };

  // After an applied change the session is read again: the item the professional was on keeps its place in the list (the exercise may have changed).
  const lastPosition = useRef<number | null>(target?.position ?? null);
  useEffect(() => {
    if (target) lastPosition.current = target.position;
  }, [target]);
  useEffect(() => {
    if (state.itemKey && options.some((o) => o.slotKey === state.itemKey)) return;
    const same = options.find((o) => o.position === lastPosition.current) ?? options[0];
    setState((s) => ({ ...s, itemKey: same?.slotKey ?? null }));
  }, [options, state.itemKey]);

  // A suggestion made before a reload comes back while it still applies to this version.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    void getCurrentAdjustment(planId, revisionId, proposalId).then((found) => found && setSuggestion(found)).catch(() => undefined);
  }, [planId, revisionId, proposalId]);

  function request(useAi: boolean, replacement?: string) {
    const built = buildIntent({ ...state, replacement: replacement ?? state.replacement }, { phaseIndex, week, slot, muscles: itemMuscles, target }, useAi);
    if (!built.ok) return setErrors(built.errors);
    setErrors([]);
    setMessage(null);
    setApplied(null);
    startTransition(async () => {
      try {
        const ids2 = intent.take(`suggest:${version}:${JSON.stringify(built.intent)}`);
        const out = await suggestAdjustment(planId, revisionId, { proposalId, expectedVersion: version, idempotencyKey: ids2.key, intent: built.intent });
        intent.done();
        if (!out.ok) {
          setSuggestion(null);
          setMessage({ tone: "error", text: out.message, engine: out.canUseEngine });
          if (out.reason === "conflict" || out.reason === "stale") router.refresh();
          if (out.canUseEngine) await showAlternatives();
          return;
        }
        setSuggestion(out.suggestion);
        setAcknowledge(false);
        if (replacement) setState((s) => ({ ...s, replacement }));
      } catch {
        setMessage({ tone: "error", text: NETWORK_ERROR });
      }
    });
  }

  /** "Ver alternativas do motor": the engine's list with the ticked constraints already evaluated on each one. */
  async function showAlternatives() {
    const built = buildIntent({ ...state, op: "SUBSTITUTE_EXERCISE", replacement: null }, { phaseIndex, week, slot, muscles: itemMuscles, target }, false);
    if (!built.ok) return setErrors(built.errors);
    try {
      const out = await loadAdjustAlternatives(planId, revisionId, { proposalId, expectedVersion: version, intent: built.intent });
      if (!out.ok) setMessage({ tone: "error", text: out.message });
      else {
        setAlternatives(out.alternatives);
        if (!out.alternatives.length) setMessage({ tone: "notice", text: "Sem alternativa elegível para este item." });
      }
    } catch {
      setMessage({ tone: "error", text: NETWORK_ERROR });
    }
  }

  function submit() {
    if (!suggestion) return;
    setMessage(null);
    startTransition(async () => {
      try {
        const ids2 = intent.take(`apply:${suggestion.adjustmentId}:${version}`);
        const out = await applyAdjustment(planId, revisionId, {
          adjustmentId: suggestion.adjustmentId, proposalId, expectedVersion: suggestion.baseVersion, writeId: ids2.write, idempotencyKey: ids2.key, acknowledgeUncheckable: acknowledge,
        });
        intent.done();
        if (!out.ok) {
          setMessage({ tone: "error", text: out.message });
          if (out.reason === "stale" || out.reason === "conflict" || out.reason === "changed") setSuggestion(null);
          router.refresh();
          return;
        }
        setApplied(out.version);
        setSuggestion(null);
        setAlternatives(null);
        setAcknowledge(false);
        setMessage({ tone: "notice", text: `Ajuste aplicado: versão ${out.version} da proposta.` });
        router.refresh();
      } catch {
        setMessage({ tone: "error", text: NETWORK_ERROR });
      }
    });
  }

  function discard() {
    if (!suggestion) return;
    const id = suggestion.adjustmentId;
    startTransition(async () => {
      try {
        const out = await rejectAdjustment(planId, revisionId, { adjustmentId: id });
        setSuggestion(null);
        setAcknowledge(false);
        if (!out.ok) {
          setMessage({ tone: "error", text: "Esta sugestão já tinha sido decidida ou não existe mais. Confira a versão da proposta." });
          router.refresh();
          return;
        }
        setMessage({ tone: "notice", text: "Sugestão descartada. A proposta continua como estava." });
      } catch {
        setMessage({ tone: "error", text: NETWORK_ERROR });
      }
    });
  }

  const choices = constraintChoices(itemMuscles);
  return (
    <div className="rx-adjust" data-testid="adjust-panel">
      <section className="rx-card rx-adjust-compare" aria-labelledby="rx-adjust-compare-title">
        <header className="rx-card-head">
          <h2 id="rx-adjust-compare-title">Comparar antes e depois</h2>
          <p className="rx-sub">Uma proposta de mudança, com efeito em volume e tempo antes de aceitar.</p>
        </header>

        <article className="rx-adjust-card" aria-label="Versão atual">
          <h3>
            Versão atual · {target?.workout ?? (session ? `Treino ${session.label}` : "—")}
          </h3>
          <p className="rx-sub">{currentItem ? `${currentItem.exerciseName}${currentItem.display.doseText ? ` — ${currentItem.display.doseText}` : ""}` : "Escolha o exercício que será ajustado."}</p>
          <p className="rx-sub rx-adjust-strong">Mantida até decisão humana</p>
        </article>

        <article className="rx-adjust-card rx-adjust-card-hl" aria-label={suggestion?.mode === "AI" ? "Sugestão da IA" : "Alternativa"} aria-live="polite">
          <h3>{suggestion ? (suggestion.mode === "AI" ? "Sugestão da IA" : "Alternativa escolhida") : substitution ? "Sugestão" : "Valores propostos"}</h3>
          {pending && !suggestion && <p className="rx-sub" role="status">{substitution ? "Buscando alternativa…" : "Calculando o efeito…"}</p>}
          {suggestion && (
            <>
              <p className="rx-sub">{suggestion.suggestion.clarification ? suggestion.suggestion.clarification.text : suggestion.suggestion.text}</p>
              {suggestion.suggestion.reasons.length > 0 && (
                <ul className="rx-adjust-pills" aria-label="Motivos">
                  {suggestion.suggestion.reasons.map((r) => (
                    <li key={r.code} className="rx-chip rx-chip-brand">{r.text}</li>
                  ))}
                </ul>
              )}
              {suggestion.suggestion.echoMissing.length > 0 && (
                <p className="rx-sub">A IA não confirmou todas as restrições marcadas; o que vale é a verificação do motor abaixo.</p>
              )}
              <p className="rx-sub rx-adjust-strong">Nenhuma alteração aplicada</p>
            </>
          )}
          {!suggestion && !pending && !alternatives && <p className="rx-sub">{substitution ? "Peça uma alternativa à IA ou veja as alternativas do motor." : "Informe os valores e veja o efeito antes de aplicar."}</p>}
          {alternatives && !suggestion && (
            <ul className="rx-adjust-alts" aria-label="Alternativas do motor">
              {alternatives.map((a) => (
                <li key={a.exerciseId} className="rx-adjust-alt" data-verdict={a.verdict}>
                  <div>
                    <strong>{a.name}</strong>
                    <span className="rx-sub">{[a.metadata, ...a.reasons.slice(0, 2)].filter(Boolean).join(" · ")}</span>
                    <span className="rx-adjust-checks">
                      {a.checks.map((c, i) => (
                        <span key={i} className={`rx-chip rx-chip-${STATUS_PILL[c.status].tone}`} title={c.detail ?? undefined}>
                          {c.text} · {STATUS_PILL[c.status].text}
                        </span>
                      ))}
                    </span>
                  </div>
                  <button type="button" className="rx-btn rx-btn-line" disabled={pending} onClick={() => request(false, a.exerciseId)} aria-label={`Ver o efeito de trocar por ${a.name}`}>
                    Ver impacto
                  </button>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="rx-adjust-card" aria-label="Impacto calculado">
          <h3>Impacto calculado</h3>
          {!diff && (
            <>
              <p className="rx-sub">Auditoria recalculada antes do aceite; mostrar alterações em foco e dose.</p>
              <p className="rx-sub rx-adjust-strong">Preservar exercícios travados</p>
            </>
          )}
          {diff && <DiffView diff={diff} />}
        </article>
      </section>

      <aside className="rx-card rx-adjust-assist" aria-labelledby="rx-adjust-assist-title">
        <header className="rx-card-head">
          <h2 id="rx-adjust-assist-title">Assistente de ajustes</h2>
          <p className="rx-sub">Contexto vinculado à versão da proposta e seus dados estruturados.</p>
        </header>
        <ul className="rx-adjust-thread" aria-label="Pedido e sugestão">
          {cards.map((c) => (
            <li key={c.id} className={c.highlight ? "rx-adjust-card rx-adjust-card-hl" : "rx-adjust-card"}>
              <h3>{c.title}</h3>
              {c.lines.map((line, i) => (
                <p key={i} className={i === c.lines.length - 1 ? "rx-sub rx-adjust-strong" : "rx-sub"}>{line}</p>
              ))}
              {c.pills.length > 0 && (
                <ul className="rx-adjust-pills" aria-label="Motivos">
                  {c.pills.map((p) => (
                    <li key={p} className="rx-chip rx-chip-brand">{p}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>

        <form
          className="rx-adjust-form"
          aria-label="Montar o pedido"
          onSubmit={(event) => {
            event.preventDefault();
            if (substitution) {
              if (button.disabled) void showAlternatives();
              else request(true);
            } else request(false);
          }}
        >
          <div className="rx-adjust-field">
            <label htmlFor={ids.item}>Item</label>
            <select id={ids.item} value={state.itemKey ?? ""} onChange={(e) => set("itemKey", e.target.value || null)} disabled={pending || !options.length}>
              {options.length === 0 && <option value="">Sem exercícios nesta sessão</option>}
              {options.map((o) => (
                <option key={o.slotKey} value={o.slotKey}>
                  {o.position}. {o.name} · {o.workout}
                  {o.locked ? " (travado)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="rx-adjust-field">
            <label htmlFor={ids.op}>O que ajustar</label>
            <select id={ids.op} value={state.op} onChange={(e) => set("op", e.target.value as BuilderState["op"])} disabled={pending}>
              {OP_ORDER.map((op) => (
                <option key={op} value={op}>
                  {OP_LABEL[op]}
                </option>
              ))}
            </select>
          </div>

          {substitution && (
            <div className="rx-adjust-field">
              <label htmlFor={ids.scope}>Onde trocar</label>
              <select id={ids.scope} value={state.scope} onChange={(e) => set("scope", e.target.value as BuilderState["scope"])} disabled={pending}>
                {SCOPE_CHOICES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label(week, slot)}
                  </option>
                ))}
              </select>
            </div>
          )}
          {state.op === "CHANGE_SETS" && <NumberField label="Séries" value={state.sets} onChange={(v) => set("sets", v)} disabled={pending} max={8} />}
          {state.op === "CHANGE_REPS" && (
            <div className="rx-adjust-pair">
              <NumberField label="Repetições (mín.)" value={state.repsMin} onChange={(v) => set("repsMin", v)} disabled={pending} max={100} />
              <NumberField label="Repetições (máx.)" value={state.repsMax} onChange={(v) => set("repsMax", v)} disabled={pending} max={100} />
            </div>
          )}
          {state.op === "CHANGE_RIR" && (
            <div className="rx-adjust-pair">
              <NumberField label="RIR (mín.)" value={state.rirMin} onChange={(v) => set("rirMin", v)} disabled={pending} max={10} />
              <NumberField label="RIR (máx.)" value={state.rirMax} onChange={(v) => set("rirMax", v)} disabled={pending} max={10} />
            </div>
          )}
          {state.op === "CHANGE_REST" && <NumberField label="Pausa (segundos)" value={state.rest} onChange={(v) => set("rest", v)} disabled={pending} max={600} />}
          {!substitution && <p className="rx-sub">A mudança vale para a fase inteira, neste treino.</p>}

          <fieldset className="rx-adjust-checks-box">
            <legend>Restrições</legend>
            {choices
              .filter((c) => substitution || !c.substitutionOnly)
              .map((c) => (
                <div key={c.id} className="rx-adjust-check">
                  <label>
                    <input type="checkbox" checked={state[c.id]} onChange={(e) => set(c.id, e.target.checked)} disabled={pending} />
                    <span>{c.label}</span>
                  </label>
                  {c.id === "maxMinutes" && state.maxMinutes && (
                    <label className="rx-adjust-inline">
                      <span className="sr-only">Máximo de minutos por sessão</span>
                      <input inputMode="numeric" value={state.maxMinutesValue} onChange={(e) => set("maxMinutesValue", e.target.value)} disabled={pending} aria-label="Máximo de minutos por sessão" />
                      <span>min</span>
                    </label>
                  )}
                </div>
              ))}
            {substitution && (
              <div className="rx-adjust-field">
                <label htmlFor="rx-adjust-equipment">Equipamento</label>
                <select id="rx-adjust-equipment" value={state.equipment} onChange={(e) => set("equipment", e.target.value)} disabled={pending}>
                  <option value="">Qualquer</option>
                  {EQUIPMENT_CHOICES.map((code) => (
                    <option key={code} value={code}>
                      {equipmentLabel(code)}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </fieldset>

          {errors.length > 0 && (
            <p className="error-message" role="alert">
              {errors.join(" ")}
            </p>
          )}
          <p className="rx-sub">{NO_AI_NOTE}</p>
          <div className="rx-adjust-actions">
            {substitution ? (
              <>
                <button type="button" className="rx-btn rx-btn-primary" disabled={button.disabled} aria-describedby={button.reason ? ids.aiReason : undefined} onClick={() => request(true)}>
                  {button.label}
                </button>
                <button type="button" className="rx-btn rx-btn-line" disabled={pending || !target} onClick={() => void showAlternatives()}>
                  Ver alternativas do motor
                </button>
              </>
            ) : (
              <button type="submit" className="rx-btn rx-btn-primary" disabled={pending || !target}>
                Ver impacto
              </button>
            )}
          </div>
          {button.reason && substitution && (
            <p id={ids.aiReason} className="rx-sub" role="note">
              {button.reason}
            </p>
          )}
          {availability?.usage?.remaining && substitution && availability.state === "READY" && (
            <p className="rx-sub">Uso da IA neste mês: somente leitura.</p>
          )}
        </form>
      </aside>

      <section className="rx-card rx-bar rx-adjust-bar" aria-label="Aplicar ajuste">
        <p className="rx-bar-text">
          <strong>Proposta editável; não aprova nem altera treinos entregues.</strong>
          <span className="rx-sub" role="status" aria-live="polite" id={ids.reason}>
            {message ? (
              <span className={message.tone === "error" ? "error-text" : undefined} data-testid="adjust-message">
                {message.text}
                {message.engine ? " Use as alternativas do motor." : ""}
              </span>
            ) : applied !== null ? null : apply.reason}
          </span>
          {apply.needsAcknowledgement && (
            <label className="rx-adjust-ack">
              <input type="checkbox" checked={acknowledge} onChange={(e) => setAcknowledge(e.target.checked)} />
              <span>Aplicar mesmo sem poder verificar todas as restrições</span>
            </label>
          )}
        </p>
        <div className="rx-bar-actions">
          <button type="button" className="rx-btn rx-btn-line" onClick={onClose} disabled={pending}>
            Voltar às sessões
          </button>
          <button type="button" className="rx-btn rx-btn-line" onClick={discard} disabled={pending || !suggestion}>
            Descartar sugestão
          </button>
          <button type="button" className="rx-btn rx-btn-primary" disabled={pending || !apply.canApply || (apply.needsAcknowledgement && !acknowledge)} aria-describedby={ids.reason} onClick={submit}>
            Aplicar ajuste à proposta
          </button>
        </div>
      </section>
    </div>
  );
}

function NumberField({ label, value, onChange, disabled, max }: { label: string; value: string; onChange: (value: string) => void; disabled: boolean; max: number }) {
  const id = useId();
  return (
    <div className="rx-adjust-field">
      <label htmlFor={id}>{label}</label>
      <input id={id} inputMode="numeric" autoComplete="off" value={value} maxLength={String(max).length} onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))} disabled={disabled} />
    </div>
  );
}

function DiffView({ diff }: { diff: DiffRows }) {
  return (
    <div className="rx-adjust-diff">
      <p className="rx-sub rx-adjust-strong">{diff.summary}</p>
      {diff.items.length > 0 && (
        <ul className="rx-adjust-diff-items" aria-label="Linhas que mudam">
          {diff.items.map((r) => (
            <li key={r.key}>
              <span className="rx-sub">{r.where} · {r.scope}</span>
              <span className="rx-adjust-before">{r.before}</span>
              <span className="rx-adjust-after">{r.after}</span>
            </li>
          ))}
        </ul>
      )}
      {diff.volume.length > 0 ? (
        <div className="rx-adjust-table-wrap">
          <table className="rx-adjust-table">
            <caption className="rx-sub">Séries ponderadas por semana (só o que muda)</caption>
            <thead>
              <tr><th scope="col">Quando</th><th scope="col">Músculo</th><th scope="col">Antes</th><th scope="col">Depois</th><th scope="col">Δ</th></tr>
            </thead>
            <tbody>
              {diff.volume.map((v) => (
                <tr key={v.key}>
                  <td>{v.where}</td><td>{v.muscle}</td><td>{v.before}</td><td>{v.after}</td><td className={v.tone === "up" ? "rx-adjust-up" : "rx-adjust-down"}>{v.delta}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {diff.truncated > 0 && <p className="rx-sub">e mais {diff.truncated} linhas de volume</p>}
        </div>
      ) : (
        <p className="rx-sub">Volume semanal: sem mudança.</p>
      )}
      {diff.minutes.length > 0 ? (
        <ul className="rx-adjust-minutes" aria-label="Duração estimada">
          {diff.minutes.slice(0, 8).map((m) => (
            <li key={m.key} className="rx-sub">{m.where}: {m.before} → {m.after}</li>
          ))}
          {diff.minutes.length > 8 && <li className="rx-sub">e mais {diff.minutes.length - 8} sessões</li>}
        </ul>
      ) : (
        <p className="rx-sub">Duração: sem mudança.</p>
      )}
      {(diff.introduced.length > 0 || diff.resolved.length > 0) && (
        <div className="rx-adjust-audit">
          {diff.introduced.length > 0 && (
            <>
              <p className="rx-sub rx-adjust-strong">Auditoria: novos pontos</p>
              <ul>{diff.introduced.slice(0, 5).map((f) => <li key={f.key} className="rx-sub">{f.text}</li>)}</ul>
            </>
          )}
          {diff.resolved.length > 0 && (
            <>
              <p className="rx-sub rx-adjust-strong">Auditoria: pontos resolvidos</p>
              <ul>{diff.resolved.slice(0, 5).map((f) => <li key={f.key} className="rx-sub">{f.text}</li>)}</ul>
            </>
          )}
        </div>
      )}
      {diff.constraints.length > 0 && (
        <>
          <p className="rx-sub rx-adjust-strong">Restrições escolhidas</p>
          <ul className="rx-adjust-constraints" aria-label="Restrições escolhidas">
            {diff.constraints.map((c) => (
              <li key={c.key}>
                <span>{c.text}</span>
                <span className={`rx-chip rx-chip-${c.tone}`}>{c.pill}</span>
                {c.detail && <span className="rx-sub">{c.detail}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
