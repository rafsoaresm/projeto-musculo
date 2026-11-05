"use client";
import { useId, useRef, type Dispatch, type KeyboardEvent, type SetStateAction } from "react";
import {
  doseSummary,
  draftDirty,
  draftFor,
  paramField,
  policyFieldId,
  policySubtitle,
  policyTabs,
  policyTitle,
  rowEdited,
  type DraftErrors,
  type PolicyDraft,
  type PolicyTab,
} from "./generation-view";
import type { GenerationScreen } from "./service";
import type { GenerationForm as FormState, PolicyRow } from "./view";

export interface PoliticasProps {
  screen: GenerationScreen;
  form: FormState;
  tab: PolicyTab["id"];
  setTab: Dispatch<SetStateAction<PolicyTab["id"]>>;
  selectedKey: string;
  drafts: Record<string, PolicyDraft>;
  setDrafts: Dispatch<SetStateAction<Record<string, PolicyDraft>>>;
  errors: Record<string, DraftErrors>;
  setErrors: Dispatch<SetStateAction<Record<string, DraftErrors>>>;
  /** What the last save or restore said (a polite status). */
  status: string;
  onEdit: (key: string, trigger: HTMLElement) => void;
  onSave: () => void;
  onRestore: () => void;
}

/**
 * Step 2, "Políticas de dose" (Figma GEN-02 on the desktop, GEN-06 and GEN-07 on the phone): the catalogue of the rule set's dose
 * policies grouped by modality, one compact line per policy with its base dose and "Editar", and the editor of the selected policy.
 * On the desktop the editor is the side panel; on the phone it is its own screen that "Editar" opens (the page's CSS decides which one
 * shows). The editor works on a draft: "Salvar ajustes" checks it field by field and only then records what differs from the rule
 * set's value (a value copied from the default is not an edit); "Restaurar padrão" removes the policy's edits.
 */
export function Politicas({ screen, form, tab, setTab, selectedKey, drafts, setDrafts, errors, setErrors, status, onEdit, onSave, onRestore }: PoliticasProps) {
  const id = useId();
  const tabs = policyTabs(screen.policy);
  const current = tabs.find((t) => t.id === tab) ?? tabs[0];
  const tabButtons = useRef<Record<string, HTMLButtonElement | null>>({});
  const selected = screen.policy.find((r) => r.key === selectedKey) ?? current?.rows[0];
  const others = tabs.filter((t) => t.id !== current?.id);

  function onKeyDown(event: KeyboardEvent) {
    const index = tabs.findIndex((t) => t.id === current?.id);
    const next = event.key === "ArrowRight" ? index + 1 : event.key === "ArrowLeft" ? index - 1 : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
    if (next === null || !tabs.length) return;
    event.preventDefault();
    const target = tabs[(next + tabs.length) % tabs.length];
    setTab(target.id);
    tabButtons.current[target.id]?.focus();
  }

  return (
    <div className="fig-gen-cols">
      <section className="fig-gen-card fig-gen-catalog" aria-labelledby={`${id}-title`}>
        <h2 id={`${id}-title`} className="fig-gen-card-title fig-gen-d">
          Política de doses
        </h2>
        <p className="fig-gen-hint fig-gen-d">
          Versão {screen.rules.id} {screen.rules.version} • valores padrão editáveis por modalidade.
        </p>
        <div className="fig-gen-tabs" role="tablist" aria-label="Modalidade das políticas" onKeyDown={onKeyDown}>
          {tabs.map((t) => (
            <button
              key={t.id}
              ref={(el) => {
                tabButtons.current[t.id] = el;
              }}
              id={`${id}-tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={t.id === current?.id}
              aria-controls={`${id}-panel`}
              tabIndex={t.id === current?.id ? 0 : -1}
              className="fig-gen-tab"
              onClick={() => setTab(t.id)}
            >
              <span className="fig-gen-d">{t.long}</span>
              <span className="fig-gen-m">{t.short}</span>
            </button>
          ))}
        </div>
        {current && (
          <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${current.id}`} className="fig-gen-panel">
            <div className="fig-gen-thead" aria-hidden="true">
              <span>
                <span className="fig-gen-d">MODALIDADE / ESTÍMULO</span>
                <span className="fig-gen-m">MODALIDADE</span>
              </span>
              <span className="fig-gen-d">DOSE BASE</span>
              <span className="fig-gen-d">AÇÃO</span>
            </div>
            <ul className="fig-gen-rows" aria-label={`Políticas de dose: ${current.long}`}>
              {current.rows.map((row) => {
                const title = policyTitle(row, screen.policy);
                const isSelected = row.key === selected?.key;
                const unsaved = draftDirty(row, form.policy, drafts[row.key]);
                return (
                  <li key={row.key} className="fig-gen-row" data-selected={isSelected ? "true" : undefined}>
                    <span className="fig-gen-row-title">{title}</span>
                    <span className="fig-gen-row-dose">
                      {doseSummary(row, form.policy)}
                      {rowEdited(row, form.policy) && <span className="fig-gen-tag">Editada por você</span>}
                      {unsaved && <span className="fig-gen-tag warn">Não salva</span>}
                    </span>
                    <button type="button" className="fig-gen-btn small fig-gen-row-edit" aria-label={`Editar ${title}`} aria-current={isSelected ? "true" : undefined} onClick={(e) => onEdit(row.key, e.currentTarget)}>
                      <span>Editar</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {others.length > 0 && (
          <p className="fig-gen-hint fig-gen-d">
            As demais políticas estão {others.length === 1 ? "na aba" : "nas abas"} {others.map((t) => t.long).join(" e ")}.
          </p>
        )}
      </section>

      {selected && (
        <Editor
          key={selected.key}
          row={selected}
          screen={screen}
          form={form}
          draft={drafts[selected.key] ?? draftFor(selected, form.policy)}
          errors={errors[selected.key] ?? {}}
          status={status}
          setDraft={(param, value) => {
            setDrafts((d) => ({ ...d, [selected.key]: { ...(d[selected.key] ?? draftFor(selected, form.policy)), [param]: value } }));
            setErrors((e) => ({ ...e, [selected.key]: Object.fromEntries(Object.entries(e[selected.key] ?? {}).filter(([k]) => k !== param)) }));
          }}
          onSave={onSave}
          onRestore={onRestore}
        />
      )}
    </div>
  );
}

function Editor({
  row,
  screen,
  form,
  draft,
  errors,
  status,
  setDraft,
  onSave,
  onRestore,
}: {
  row: PolicyRow;
  screen: GenerationScreen;
  form: FormState;
  draft: PolicyDraft;
  errors: DraftErrors;
  status: string;
  setDraft: (param: string, value: string) => void;
  onSave: () => void;
  onRestore: () => void;
}) {
  const title = policyTitle(row, screen.policy);
  const dirty = draftDirty(row, form.policy, draft);
  return (
    <aside className="fig-gen-card fig-gen-editor" aria-label={`Editar política: ${title}`} data-dirty={dirty ? "true" : undefined}>
      <span className="fig-gen-pill brand fig-gen-d">SELECIONADA</span>
      <div className="fig-gen-default-box fig-gen-m">
        <strong>Padrão da ferramenta</strong>
        <span>
          {screen.rules.id} {screen.rules.version} · parâmetros editáveis
        </span>
      </div>
      <h2 className="fig-gen-editor-title fig-gen-d">
        {title}
      </h2>
      <p className="fig-gen-hint fig-gen-d">{policySubtitle(row)}</p>
      {row.stimulus === "*" && <p className="fig-gen-hint">“Qualquer estímulo” vale para os estímulos desta modalidade e medida que não têm linha própria.</p>}
      <hr className="fig-gen-rule fig-gen-d" />
      <fieldset className="fig-gen-fields">
        <legend className="fig-gen-m">Parâmetros da modalidade</legend>
        <div className="fig-gen-field-grid">
          {row.defaults.map((d) => {
            const f = paramField(d.param);
            const fieldId = policyFieldId(d.param);
            const error = errors[d.param];
            return (
              <div key={d.param} className="fig-gen-field">
                <label htmlFor={fieldId} className="fig-gen-field-label">
                  {f.short}
                  {f.unit && <span className="fig-gen-m"> ({f.unit})</span>}
                </label>
                <div className="fig-gen-input">
                  <input
                    id={fieldId}
                    inputMode="decimal"
                    value={draft[d.param] ?? ""}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={[error ? `${fieldId}-erro` : "", f.unit ? `${fieldId}-unit` : ""].filter(Boolean).join(" ") || undefined}
                    onChange={(e) => setDraft(d.param, e.target.value)}
                  />
                  {f.unit && (
                    <span className="fig-gen-suffix fig-gen-d" aria-hidden="true">
                      {f.unit}
                    </span>
                  )}
                  {f.unit && (
                    <span id={`${fieldId}-unit`} className="sr-only">
                      Unidade: {f.unit === "s" ? "segundos" : "metros"}
                    </span>
                  )}
                </div>
                {error && (
                  <p id={`${fieldId}-erro`} className="fig-gen-error" role="alert">
                    {error}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </fieldset>
      <div className="fig-gen-warn-box fig-gen-d">
        <p className="fig-gen-warn-title">Heurística operacional editável</p>
        <p>Estas doses são parâmetros padrão do motor. O profissional poderá revisá-las antes de aplicar a proposta; não são recomendação universal.</p>
      </div>
      <div className="fig-gen-warn-box fig-gen-m">
        <p className="fig-gen-warn-title">Heurística operacional</p>
        <p>São parâmetros padrão, não recomendações universais. Revise antes de aplicar o plano ao aluno.</p>
      </div>
      <p className="fig-gen-note" role="status" aria-live="polite">
        {dirty ? "Há ajustes não salvos nesta política." : status}
      </p>
      <hr className="fig-gen-rule fig-gen-d" />
      <div className="fig-gen-editor-actions">
        <button type="button" className="fig-gen-btn" onClick={onRestore}>
          Restaurar padrão
        </button>
        <button type="button" className="fig-gen-btn primary fig-gen-d" onClick={onSave}>
          Salvar ajustes
        </button>
      </div>
    </aside>
  );
}
