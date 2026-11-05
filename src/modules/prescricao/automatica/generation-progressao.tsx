"use client";
import { useState, type Dispatch, type SetStateAction } from "react";
import { CAUTION_TAGS, PATTERNS } from "@/modules/biblioteca/metadata/vocabulary";
import { Pill } from "@/components/ui";
import type { DoseParam } from "@/modules/prescricao/motor/types";
import type { GenerationQuestion } from "./contracts";
import {
  MINUTES_FIELD_ID,
  missingFactsText,
  pendingItems,
  phaseLabel,
  progressionFieldId,
  type FieldErrors,
  type PendingItem,
} from "./generation-view";
import type { GenerationScreen } from "./service";
import { TargetSuggestionCard } from "./target-suggestions";
import {
  BASIS_LABELS,
  EMPTY_PROGRESSION,
  PARAM_LABELS,
  PROGRESSION_PARAMS,
  coverageSummary,
  formSuggestionFor,
  type GenerationForm as FormState,
  type ProgressionForm,
} from "./view";

export interface ProgressaoProps {
  screen: GenerationScreen;
  form: FormState;
  setForm: Dispatch<SetStateAction<FormState>>;
  setField: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  open: GenerationQuestion[];
  info: GenerationQuestion[];
  pending: boolean;
  fieldErrors: FieldErrors;
  clearError: (id: string) => void;
  advancedOpen: boolean;
  setAdvancedOpen: Dispatch<SetStateAction<boolean>>;
  onGoTo: (item: PendingItem) => void;
}

/**
 * Step 3, "Progressão" (Figma GEN-03 on the desktop, GEN-08 on the phone): the weekly progression of each phase (a model and the
 * optional deload weeks; the fields a model needs open under it), "Ajustes opcionais (avançado)" closed by default with everything
 * else the form can say, and on the desktop the panel "Pronto para gerar?" with the exact list of pending answers, each one a link to
 * its field.
 */
export function Progressao(props: ProgressaoProps) {
  const { screen, form, setForm, open, fieldErrors, clearError, onGoTo } = props;
  const items = pendingItems(open);
  const progressionOf = (phaseIndex: number): ProgressionForm => form.progression.find((p) => p.phaseIndex === phaseIndex) ?? EMPTY_PROGRESSION;
  const setProgression = (phaseIndex: number, patch: Partial<ProgressionForm>) => {
    clearError(progressionFieldId(phaseIndex));
    setForm((f) => ({ ...f, progression: [...f.progression.filter((p) => p.phaseIndex !== phaseIndex), { ...(f.progression.find((p) => p.phaseIndex === phaseIndex) ?? EMPTY_PROGRESSION), ...patch, phaseIndex }] }));
  };
  const missing = missingFactsText(screen.summary);

  return (
    <div className="fig-gen-cols">
      <section className="fig-gen-card fig-gen-prog" aria-labelledby="fig-gen-prog-title">
        <h2 id="fig-gen-prog-title" className="fig-gen-card-title fig-gen-d">
          Progressão semanal
        </h2>
        <p className="fig-gen-sub fig-gen-d">Opcional por fase; escolha um modelo e indique semanas de descarga apenas quando fizer sentido.</p>
        {screen.structure.map((phase) => {
          const p = progressionOf(phase.index);
          const put = (patch: Partial<ProgressionForm>) => setProgression(phase.index, patch);
          const id = progressionFieldId(phase.index);
          const error = fieldErrors[id];
          return (
            <div key={phase.index} id={id} className="fig-gen-pcard" role="group" tabIndex={-1} aria-label={`Progressão da ${phaseLabel(phase)}`}>
              <h3>
                {phaseLabel(phase)} · {phase.weeks} {phase.weeks === 1 ? "semana" : "semanas"}
              </h3>
              <div className="fig-gen-pgrid">
                <div className="fig-gen-field">
                  <label htmlFor={`${id}-modelo`} className="fig-gen-field-label">
                    Modelo
                  </label>
                  <div className="fig-gen-select">
                    <select id={`${id}-modelo`} value={p.model} onChange={(e) => put({ model: e.target.value as ProgressionForm["model"] })}>
                      <option value="NONE">Sem progressão</option>
                      <option value="LINEAR">Linear (da semana 1 à última)</option>
                      <option value="STEP">Em degraus</option>
                    </select>
                  </div>
                </div>
                <div className="fig-gen-field">
                  <label htmlFor={`${id}-descarga`} className="fig-gen-field-label">
                    <span className="fig-gen-d">Descarga opcional</span>
                    <span className="fig-gen-m">Descarga (opcional)</span>
                  </label>
                  <input id={`${id}-descarga`} value={p.deloadWeeks} placeholder={`Ex.: ${phase.weeks}`} onChange={(e) => put({ deloadWeeks: e.target.value })} />
                </div>
              </div>
              {p.model !== "NONE" && (
                <div className="fig-gen-pgrid more">
                  <div className="fig-gen-field">
                    <label htmlFor={`${id}-param`} className="fig-gen-field-label">
                      Parâmetro
                    </label>
                    <div className="fig-gen-select">
                      <select id={`${id}-param`} value={p.param} onChange={(e) => put({ param: e.target.value as DoseParam })}>
                        {PROGRESSION_PARAMS.map((param) => (
                          <option key={param} value={param}>
                            {PARAM_LABELS[param]}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  {p.model === "LINEAR" && (
                    <>
                      <TextField id={`${id}-from`} label="Na semana 1" value={p.from} onChange={(v) => put({ from: v })} />
                      <TextField id={`${id}-to`} label={`Na semana ${phase.weeks}`} value={p.to} onChange={(v) => put({ to: v })} />
                    </>
                  )}
                  {p.model === "STEP" && (
                    <>
                      <TextField id={`${id}-delta`} label="Muda em" value={p.delta} placeholder="Ex.: 1 ou -1" onChange={(v) => put({ delta: v })} />
                      <TextField id={`${id}-every`} label="A cada (semanas)" mode="numeric" value={p.everyWeeks} onChange={(v) => put({ everyWeeks: v })} />
                      <TextField id={`${id}-limit`} label="Sem passar de (opcional)" value={p.limit} onChange={(v) => put({ limit: v })} />
                    </>
                  )}
                </div>
              )}
              {p.deloadWeeks.trim() && (
                <div className="fig-gen-pgrid more">
                  <TextField id={`${id}-fracao`} label="Fração das séries na descarga" value={p.deloadMultiplier} placeholder="Ex.: 0,5" onChange={(v) => put({ deloadMultiplier: v })} />
                </div>
              )}
              {error && (
                <p className="fig-gen-error" role="alert">
                  {error}
                </p>
              )}
            </div>
          );
        })}
        <p className="fig-gen-hint">
          Sem progressão, a dose é a mesma em todas as semanas da fase. A progressão vale para os exercícios cuja dose tem o parâmetro escolhido; os demais ficam como estão, com aviso.
        </p>

        <Advanced {...props} />

        {open.length > 0 && (
          <button type="button" className="fig-gen-banner fig-gen-m" onClick={() => onGoTo(items[0])}>
            {open.length} {open.length === 1 ? "resposta pendente" : "respostas pendentes"} na etapa Diretrizes
          </button>
        )}
      </section>

      <aside className="fig-gen-card fig-gen-ready fig-gen-d" aria-labelledby="fig-gen-ready-title">
        <h2 id="fig-gen-ready-title" className="fig-gen-card-title">
          Pronto para gerar?
        </h2>
        <span className={`fig-gen-pill${open.length === 0 ? " ok" : ""}`}>{open.length === 0 ? "TUDO RESPONDIDO" : `${open.length} ${open.length === 1 ? "RESPOSTA PENDENTE" : "RESPOSTAS PENDENTES"}`}</span>
        <p className="fig-gen-hint">{open.length === 0 ? "As respostas obrigatórias da etapa Diretrizes estão completas." : "Conclua os dados obrigatórios da etapa Diretrizes:"}</p>
        {items.length > 0 && (
          <ul className="fig-gen-pending">
            {items.map((item) => (
              <li key={`${item.code}-${item.fieldId}`}>
                <button type="button" onClick={() => onGoTo(item)}>
                  <span className="fig-gen-dot" aria-hidden="true" />
                  <span>{item.label}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <hr className="fig-gen-rule" />
        <h3 className="fig-gen-strong">Dados não informados na ficha</h3>
        <p className="fig-gen-hint">{missing ?? "Nível, objetivo, dias por semana e tempo de sessão estão registrados na ficha."}</p>
        {screen.summary.parq !== "CLEAR" && (
          <p className="fig-gen-strong warn small">
            {screen.summary.parq === "NOT_DONE" ? "PAR-Q não realizado" : "PAR-Q com “Sim”"}: permanece sinalizado para revisão profissional.
          </p>
        )}
      </aside>
    </div>
  );
}

function TextField({ id, label, value, onChange, placeholder, mode = "decimal" }: { id: string; label: string; value: string; onChange: (value: string) => void; placeholder?: string; mode?: "decimal" | "numeric" }) {
  return (
    <div className="fig-gen-field">
      <label htmlFor={id} className="fig-gen-field-label">
        {label}
      </label>
      <input id={id} inputMode={mode} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/**
 * "Ajustes opcionais (avançado)": closed. Everything the form could say before the redesign stays here (the Figma does not draw it):
 * the dose mode and the metadata trust, the targets of each phase, the time of the session, exercises and patterns to avoid or
 * prefer, cautions to avoid, and what the records do not say.
 */
function Advanced({ screen, form, setForm, setField, info, pending, fieldErrors, clearError, advancedOpen, setAdvancedOpen }: ProgressaoProps) {
  return (
    <details className="fig-gen-adv" open={advancedOpen} onToggle={(e) => setAdvancedOpen(e.currentTarget.open)}>
      <summary>
        <span>
          <span aria-hidden="true" className="fig-gen-caret">
            ▸
          </span>{" "}
          Ajustes opcionais (avançado)
        </span>
        <span className="fig-gen-adv-state fig-gen-d">{advancedOpen ? "Aberto" : "Fechado por padrão"}</span>
      </summary>
      <div className="fig-gen-adv-body">
        <div className="fig-gen-field-row">
          <div className="fig-gen-field">
            <label htmlFor="fig-gen-dose-mode" className="fig-gen-field-label">
              Modo das doses
            </label>
            <div className="fig-gen-select">
              <select id="fig-gen-dose-mode" value={form.doseMode ?? ""} onChange={(e) => setField("doseMode", (e.target.value || null) as FormState["doseMode"])}>
                <option value="">Preencher pela política (padrão da ferramenta)</option>
                <option value="FILL_FROM_POLICY">Preencher pela política (escolha minha)</option>
                <option value="LEAVE_EMPTY">Deixar todas as doses em branco</option>
              </select>
            </div>
          </div>
          <div className="fig-gen-field">
            <label htmlFor="fig-gen-trust" className="fig-gen-field-label">
              Metadados da biblioteca usados na seleção
            </label>
            <div className="fig-gen-select">
              <select id="fig-gen-trust" value={form.metadataTrust ?? ""} onChange={(e) => setField("metadataTrust", (e.target.value || null) as FormState["metadataTrust"])}>
                <option value="">Revisados e inferidos (padrão da ferramenta)</option>
                <option value="REVIEWED_AND_INFERRED">Revisados e inferidos (escolha minha)</option>
                <option value="REVIEWED_ONLY">Só revisados</option>
              </select>
            </div>
          </div>
        </div>

        {screen.targetSuggestions.length > 0 && (
          <details className="fig-gen-sub-details" open={form.coverage.length > 0 || form.coverageByWorkout.length > 0}>
            <summary>Alvos por fase (opcional)</summary>
            <div className="fig-gen-adv-body">
              <p className="fig-gen-hint">Sem alvos, a ferramenta segue a elegibilidade e espalha os padrões pela semana; nada vira alvo sem o seu aceite. Os objetivos em texto livre nunca viram restrição.</p>
              {screen.targetSuggestions.map((phase) => {
                const structure = screen.structure.find((p) => p.index === phase.phaseIndex);
                if (!structure) return null;
                const current = form.coverage.find((c) => c.phaseIndex === phase.phaseIndex);
                const byWorkout = form.coverageByWorkout.filter((c) => c.phaseIndex === phase.phaseIndex);
                const clear = () =>
                  setForm((f) => ({
                    ...f,
                    coverage: f.coverage.filter((c) => c.phaseIndex !== phase.phaseIndex),
                    coverageByWorkout: f.coverageByWorkout.filter((c) => c.phaseIndex !== phase.phaseIndex),
                  }));
                if (current || byWorkout.length)
                  return (
                    <div key={phase.phaseIndex} className="fig-gen-question" role="group" aria-label={`Alvos da ${phaseLabel(structure)}`}>
                      <strong>{phaseLabel(structure)}: alvos</strong>
                      <span className="small">
                        {current && (
                          <>
                            <Pill tone="brand">{BASIS_LABELS[current.basis]}</Pill>{" "}
                          </>
                        )}
                        {coverageSummary(current ?? { phaseIndex: phase.phaseIndex, basis: "PROFESSIONAL" }, byWorkout)}
                      </span>
                      <div>
                        <button type="button" className="fig-gen-btn small" onClick={clear}>
                          Remover os alvos da fase {phase.phaseIndex}
                        </button>
                      </div>
                    </div>
                  );
                const out = formSuggestionFor(phase, form);
                return (
                  <TargetSuggestionCard
                    key={phase.phaseIndex}
                    phaseIndex={phase.phaseIndex}
                    suggestion={out.suggestion}
                    reason={out.reason}
                    labels={structure.workouts.map((w) => w.label)}
                    pending={pending}
                    acceptText="Aceitar estes alvos"
                    commitText="Nada é aplicado sem o seu aceite. Ao aceitar, os alvos entram nesta geração e você pode removê-los antes de gerar."
                    onAccept={(entry) => setForm((f) => ({ ...f, coverage: [...f.coverage.filter((c) => c.phaseIndex !== entry.phaseIndex), entry] }))}
                    onApply={(coverage, list) =>
                      setForm((f) => ({
                        ...f,
                        coverage: [...f.coverage.filter((c) => c.phaseIndex !== phase.phaseIndex), ...(coverage ? [coverage] : [])],
                        coverageByWorkout: [...f.coverageByWorkout.filter((c) => c.phaseIndex !== phase.phaseIndex), ...list],
                      }))
                    }
                  />
                );
              })}
            </div>
          </details>
        )}

        <div className="fig-gen-field-row">
          <div className="fig-gen-field">
            <label htmlFor={MINUTES_FIELD_ID} className="fig-gen-field-label">
              Tempo por sessão (min)
            </label>
            <input
              id={MINUTES_FIELD_ID}
              inputMode="numeric"
              value={form.availableMinutes}
              placeholder="Da ficha ou dos treinos"
              aria-invalid={fieldErrors[MINUTES_FIELD_ID] ? true : undefined}
              aria-describedby={fieldErrors[MINUTES_FIELD_ID] ? `${MINUTES_FIELD_ID}-erro` : undefined}
              onChange={(e) => {
                clearError(MINUTES_FIELD_ID);
                setField("availableMinutes", e.target.value);
              }}
            />
            {fieldErrors[MINUTES_FIELD_ID] && (
              <p id={`${MINUTES_FIELD_ID}-erro`} className="fig-gen-error" role="alert">
                {fieldErrors[MINUTES_FIELD_ID]}
              </p>
            )}
          </div>
          <div className="fig-gen-field">
            <label htmlFor="fig-gen-budget" className="fig-gen-field-label">
              Tempo disponível
            </label>
            <div className="fig-gen-select">
              <select id="fig-gen-budget" value={form.timeBudget} onChange={(e) => setField("timeBudget", e.target.value as FormState["timeBudget"])}>
                <option value="">Como referência, sem cortar (padrão)</option>
                <option value="SOFT">Como referência, sem cortar (escolha minha)</option>
                <option value="HARD">Como limite: não passar do tempo</option>
              </select>
            </div>
          </div>
        </div>

        <ExercisePicker label="Exercícios a evitar" library={screen.library} chosen={form.excludedExerciseIds} onChange={(list) => setField("excludedExerciseIds", list)} />
        <ExercisePicker label="Exercícios preferidos" library={screen.library} chosen={form.preferredExerciseIds} onChange={(list) => setField("preferredExerciseIds", list)} />

        <fieldset className="fig-gen-fieldset">
          <legend>Padrões de movimento a evitar</legend>
          <div className="fig-gen-checks">
            {Object.entries(PATTERNS).map(([code, label]) => (
              <label key={code} className="fig-gen-check">
                <input
                  type="checkbox"
                  checked={form.excludedPatterns.includes(code)}
                  onChange={(e) => setField("excludedPatterns", e.target.checked ? [...form.excludedPatterns, code] : form.excludedPatterns.filter((c) => c !== code))}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="fig-gen-fieldset">
          <legend>Marcadores de cuidado a evitar</legend>
          <p className="fig-gen-hint">Valem só para exercícios com marcadores revisados por uma pessoa; os demais não são alcançados.</p>
          <div className="fig-gen-checks">
            {Object.entries(CAUTION_TAGS).map(([code, label]) => (
              <label key={code} className="fig-gen-check">
                <input
                  type="checkbox"
                  checked={form.excludedCautionTags.includes(code)}
                  onChange={(e) => setField("excludedCautionTags", e.target.checked ? [...form.excludedCautionTags, code] : form.excludedCautionTags.filter((c) => c !== code))}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        {info.length > 0 && (
          <div>
            <h3 className="fig-gen-strong">O que falta nos registros (não impede a geração)</h3>
            <ul className="auto-list">
              {info.map((q) => (
                <li key={`${q.code}-${q.phaseIndex ?? ""}-${q.label ?? ""}`} className="small">
                  {q.message}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  );
}

function ExercisePicker({ label, library, chosen, onChange }: { label: string; library: GenerationScreen["library"]; chosen: string[]; onChange: (list: string[]) => void }) {
  const [pick, setPick] = useState("");
  const names = new Map(library.map((e) => [e.id, e.name]));
  return (
    <div className="fig-gen-picker" role="group" aria-label={label}>
      <div className="fig-gen-picker-row">
        <div className="fig-gen-field">
          <label htmlFor={`fig-gen-pick-${label}`} className="fig-gen-field-label">
            {label}
          </label>
          <div className="fig-gen-select">
            <select id={`fig-gen-pick-${label}`} value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">Escolha da biblioteca…</option>
              {library
                .filter((e) => !chosen.includes(e.id))
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                    {e.metadata === "INFERRED" ? " (metadados inferidos)" : e.metadata === "PENDING" ? " (pendente de curadoria)" : ""}
                  </option>
                ))}
            </select>
          </div>
        </div>
        <button
          type="button"
          className="fig-gen-btn small"
          disabled={!pick}
          onClick={() => {
            onChange([...chosen, pick]);
            setPick("");
          }}
        >
          Incluir
        </button>
      </div>
      {chosen.length > 0 && (
        <ul className="fig-gen-chips" aria-label={`${label} escolhidos`}>
          {chosen.map((id) => (
            <li key={id}>
              <button type="button" className="fig-gen-chip" aria-label={`Tirar ${names.get(id) ?? id}`} onClick={() => onChange(chosen.filter((c) => c !== id))}>
                {names.get(id) ?? id} ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
