"use client";
import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Lock } from "lucide-react";
import { createAssessmentTemplate, updateAssessmentTemplate } from "./template-actions";
import { TextField } from "./fields";
import {
  MAX_TEMPLATE_NAME,
  ORDERABLE_STEP_LABEL,
  PART_HINT,
  PART_LABEL,
  TEMPLATE_PARTS,
  partsOfStep,
  stepOrderOf,
  type OrderableStep,
  type TemplatePart,
} from "./template";

const STEP_TITLE: Record<OrderableStep, string> = { medidas: "Medidas · composição corporal", movimento: "Movimento · postura e flexibilidade", testes: "Testes físicos" };

/** The parts of one step, each a checkbox with what it holds. */
function Parts({ parts, chosen, onToggle, labelledBy }: { parts: TemplatePart[]; chosen: TemplatePart[]; onToggle: (part: TemplatePart, on: boolean) => void; labelledBy: string }) {
  return (
    <ul className="av2-parts" role="group" aria-labelledby={labelledBy}>
      {parts.map((part) => (
        <li key={part}>
          <label className="av2-part">
            <input type="checkbox" checked={chosen.includes(part)} onChange={(event) => onToggle(part, event.target.checked)} />
            <span>
              <strong>{PART_LABEL[part]}</strong>
              <span className="av2-note">{PART_HINT[part]}</span>
            </span>
          </label>
        </li>
      ))}
    </ul>
  );
}

/**
 * The editor of a model of the Avaliação Física (slice 0.85): its name, which optional parts are on, and the order of the three middle steps.
 * Triagem (anamnese and PAR-Q) is always in and first; Revisão always last. Saving an existing model writes a new version: the drafts already
 * started keep theirs, and nothing recorded changes.
 */
export function TemplateEditor({ template = null }: { template?: { id: string; name: string; version: number; enabled: TemplatePart[] } | null }) {
  const [name, setName] = useState(template?.name ?? "");
  const [chosen, setChosen] = useState<TemplatePart[]>(template ? template.enabled : [...TEMPLATE_PARTS]);
  const [order, setOrder] = useState<OrderableStep[]>(() => stepOrderOf(template ? template.enabled : null));
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const toggle = (part: TemplatePart, on: boolean) => setChosen((current) => (on ? [...current, part] : current.filter((item) => item !== part)));
  const move = (index: number, by: -1 | 1) =>
    setOrder((current) => {
      const next = [...current];
      [next[index], next[index + by]] = [next[index + by], next[index]];
      return next;
    });
  const save = () =>
    startSaving(async () => {
      setError(null);
      const input = { name, parts: chosen, stepOrder: order };
      const result = template ? await updateAssessmentTemplate(template.id, input, template.version) : await createAssessmentTemplate(input);
      if (result?.error) setError(result.error);
    });
  const offCount = TEMPLATE_PARTS.length - chosen.length;

  return (
    <form
      className="av2-cards"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <section className="panel av2-card" aria-labelledby="av2-modelo-nome">
        <h3 id="av2-modelo-nome">Nome do modelo</h3>
        <p className="muted small">
          {template
            ? `Versão ${template.version}. Salvar cria a versão ${template.version + 1}: os rascunhos já iniciados continuam com a versão em que começaram, e as avaliações registradas não mudam.`
            : "O nome aparece na escolha do modelo ao iniciar uma avaliação física."}
        </p>
        <div className="av2-grid">
          <TextField wide label="Nome" value={name} onChange={setName} note={`Até ${MAX_TEMPLATE_NAME} caracteres.`} />
        </div>
      </section>

      <section className="panel av2-card" aria-labelledby="av2-modelo-triagem">
        <h3 id="av2-modelo-triagem">1 · Triagem e segurança</h3>
        <p className="av2-fixed small">
          <Lock size={16} aria-hidden="true" /> Sempre incluída e sempre a primeira etapa: objetivos, anamnese, atividade física e PAR-Q. O PAR-Q
          condiciona a aprovação de planos, por isso não é opcional.
        </p>
      </section>

      {order.map((step, index) => {
        const id = `av2-modelo-${step}`;
        return (
          <section key={step} className="panel av2-card" aria-labelledby={id}>
            <div className="av2-step-head">
              <h3 id={id}>
                {index + 2} · {STEP_TITLE[step]}
              </h3>
              <div className="av2-order" role="group" aria-label={`Ordem da etapa ${ORDERABLE_STEP_LABEL[step]}`}>
                <button type="button" className="button secondary small" disabled={index === 0} onClick={() => move(index, -1)} aria-label={`Subir ${ORDERABLE_STEP_LABEL[step]}`}>
                  <ArrowUp size={16} aria-hidden="true" /> Subir
                </button>
                <button type="button" className="button secondary small" disabled={index === order.length - 1} onClick={() => move(index, 1)} aria-label={`Descer ${ORDERABLE_STEP_LABEL[step]}`}>
                  <ArrowDown size={16} aria-hidden="true" /> Descer
                </button>
              </div>
            </div>
            <p className="muted small">
              Desmarque o que este modelo não usa. Uma etapa sem nada marcado não aparece na avaliação; nas avaliações feitas com o modelo, o que ficou
              de fora aparece como “Não incluído neste modelo”.
            </p>
            <Parts parts={partsOfStep(step)} chosen={chosen} onToggle={toggle} labelledBy={id} />
          </section>
        );
      })}

      <section className="panel av2-card" aria-labelledby="av2-modelo-revisao">
        <h3 id="av2-modelo-revisao">5 · Revisão e entrega</h3>
        <p className="muted small">Sempre a última etapa: pendências, resultados e finalização. As considerações finais são opcionais.</p>
        <Parts parts={partsOfStep("revisao")} chosen={chosen} onToggle={toggle} labelledBy="av2-modelo-revisao" />
      </section>

      <div className="av2-footer">
        <div className="av2-messages">
          <p className="av2-status" role="status">
            {offCount === 0 ? "Todas as partes opcionais incluídas." : `${offCount} ${offCount === 1 ? "parte opcional fora" : "partes opcionais fora"} deste modelo.`}
          </p>
          <div role="alert">{error && <p className="av2-status error">{error}</p>}</div>
        </div>
        <div className="av2-actions">
          <button type="submit" className="button primary" disabled={saving}>
            {saving ? "Salvando…" : template ? "Salvar nova versão" : "Criar modelo"}
          </button>
        </div>
      </div>
    </form>
  );
}
